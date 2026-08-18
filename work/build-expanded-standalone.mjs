import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hasExactNewProductSource } from "../scripts/apple-catalog-lib.mjs";
import { escapeHtml } from "../scripts/html-escape.mjs";
import {
  readCatalogViewState,
  writeCatalogViewSearch,
  writeOwnedChoiceSearch,
} from "../scripts/catalog-view-state.mjs";
import { recommendConfigurations } from "../scripts/configuration-picker.mjs";
import {
  calculateTaxLocationAmounts,
  screenInchesFromLabel,
} from "../scripts/fixed-location-tax.mjs";
import { buildMarketDisplayCopy } from "../scripts/market-display-copy.mjs";
import {
  loadEnabledMarketProfiles,
  loadMarketContext,
  marketIdFromArgv,
} from "../scripts/market-profile.mjs";
import { sourceToDisplayRateFromSite } from "../scripts/update-exchange-rate.mjs";

const { profile, paths } = await loadMarketContext(marketIdFromArgv());
const { profiles: enabledMarketProfiles } =
  await loadEnabledMarketProfiles();
if (!enabledMarketProfiles.some((marketProfile) => marketProfile.id === profile.id)) {
  throw new Error(`Market ${profile.id} is not enabled`);
}
const refurbishedPriceField = profile.currency.priceFields.refurbished;
const newPriceField = profile.currency.priceFields.new;
const taxInclusivePriceField = profile.currency.priceFields.taxInclusive;
const newTaxInclusivePriceField =
  profile.currency.priceFields.newTaxInclusive;
const hasReferenceLocationTax =
  [
    "apple-checkout-reference-location",
    "verified-fixed-location-estimate",
  ].includes(profile.tax.model);
const hasVerifiedTaxEstimate =
  profile.tax.model === "verified-fixed-location-estimate";
const taxLocationSwitcher = profile.tax.locationSwitcher ?? null;
const hasTaxLocationSwitcher =
  hasVerifiedTaxEstimate &&
  Array.isArray(taxLocationSwitcher?.locations) &&
  taxLocationSwitcher.locations.length > 1;
const displayedRefurbishedPriceField = hasVerifiedTaxEstimate
  ? taxInclusivePriceField
  : refurbishedPriceField;
const sourceCurrency = profile.currency.source;
const displayCurrency = profile.currency.display;
const currencySuffix =
  sourceCurrency.slice(0, 1) + sourceCurrency.slice(1).toLowerCase();
const changeFromField = `from${currencySuffix}`;
const changeToField = `to${currencySuffix}`;

const readJson = async (fileName, { optional = false } = {}) => {
  try {
    return JSON.parse(await readFile(fileName, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw new Error(`Cannot read ${fileName}: ${error.message}`, { cause: error });
  }
};

const catalogDocument = await readJson(paths.catalog);
const featuredDocument = await readJson(paths.featured);
const changelogDocument = await readJson(paths.changelog);
const site = await readJson(paths.site);
const updateStatus = await readJson(paths.updateStatus, { optional: true });

const catalogProducts = Array.isArray(catalogDocument)
  ? catalogDocument
  : catalogDocument?.products;
if (!Array.isArray(catalogProducts) || catalogProducts.length === 0) {
  throw new Error(`${paths.catalog} must contain a non-empty products array`);
}
const products = catalogProducts.map((product) => {
  const hasVerifiedNewPrice =
    Number.isFinite(product[newPriceField]) &&
    product.newSourceUrl &&
    hasExactNewProductSource(product, profile);
  if (hasVerifiedNewPrice) return product;
  return {
    ...product,
    [newPriceField]: null,
    newSourceUrl: null,
    ...(newTaxInclusivePriceField
      ? {
          [newTaxInclusivePriceField]: null,
          newTaxInclusivePricing: null,
        }
      : {}),
  };
});
if (hasTaxLocationSwitcher) {
  for (const location of taxLocationSwitcher.locations) {
    for (const product of products) {
      calculateTaxLocationAmounts({
        preTaxAmount: product[refurbishedPriceField],
        screenInches: screenInchesFromLabel(product.screen),
        estimate: location.estimate,
      });
    }
  }
}

const featuredEntries = Array.isArray(featuredDocument) ? featuredDocument : featuredDocument?.items;
if (!Array.isArray(featuredEntries)) {
  throw new Error(`${paths.featured} must contain an items array`);
}
if (
  changelogDocument?.schemaVersion !== 1 ||
  !Array.isArray(changelogDocument.entries) ||
  !changelogDocument.latestRun
) {
  throw new Error(`${paths.changelog} must contain latestRun and entries`);
}

const rate = sourceToDisplayRateFromSite(site, profile);

const rateDate = site?.currency?.rateDate;
const rateSourceUrl = site?.currency?.sourceUrl;
const pageTitle =
  site?.pageTitle ||
  `${profile.siteName} — сравнение refurbished-моделей`;
const canonicalUrl = profile.publication.canonicalUrl;
const checkedAt = updateStatus?.checkedAt || site?.checkedDateFallback || rateDate;
const isoDate = (value) => String(value || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
const formatRussianDate = (value) => {
  const date = isoDate(value);
  if (!date) return "дата не указана";
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
};
const formatRussianLongDate = (value) => {
  const date = isoDate(value);
  if (!date) return "неизвестную дату";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`)).replace(/\s+г\.$/, " года");
};
const checkedDate = formatRussianDate(checkedAt);
const checkedDateLong = formatRussianLongDate(checkedAt);
const rateDateFormatted = formatRussianDate(rateDate);
const embeddedProducts = JSON.stringify(products).replaceAll("<", "\\u003c");
const embeddedTaxLocations = JSON.stringify(
  taxLocationSwitcher?.locations ?? [],
).replaceAll("<", "\\u003c");
const displayFormatter = new Intl.NumberFormat(profile.currency.displayLocale, {
  style: "currency",
  currency: displayCurrency,
  minimumFractionDigits: profile.currency.displayFractionDigits,
  maximumFractionDigits: profile.currency.displayFractionDigits,
});
const taxDisplayFormatter = new Intl.NumberFormat(
  profile.currency.displayLocale,
  {
    style: "currency",
    currency: displayCurrency,
    minimumFractionDigits: profile.currency.displayFractionDigits,
    maximumFractionDigits: profile.currency.displayFractionDigits,
  },
);
const displayPrice = (amount) => displayFormatter.format(amount * rate);
const taxDisplayPrice = (amount) =>
  taxDisplayFormatter.format(amount * rate);
const mainPrice = (amount) =>
  hasVerifiedTaxEstimate ? taxDisplayPrice(amount) : displayPrice(amount);
const taxFormula = (pricing) =>
  [
    pricing.preTaxAmount,
    pricing.salesTaxAmount,
    pricing.recyclingFeeAmount,
  ].map(taxDisplayPrice).join(" + ");
const capacityNumber = (value) => Number(value.replace(/\D/g, "")) * (value.endsWith("TB") ? 1024 : 1);
const chipNumber = (value) => Number(value.match(/\d+/)?.[0] || 0);
const chipTier = (value) => (value.includes("Max") ? 2 : value.includes("Pro") ? 1 : 0);
const colourNames = {
  Silver: "Серебристый",
  Midnight: "Тёмная ночь",
  "Space Grey": "Серый космос",
  "Space Black": "Чёрный космос",
  Starlight: "Сияющая звезда",
  "Sky Blue": "Небесно-голубой",
};
const colourClasses = {
  Silver: "silver",
  Midnight: "midnight",
  "Space Grey": "space-grey",
  "Space Black": "space-black",
  Starlight: "starlight",
  "Sky Blue": "sky-blue",
};
const variantsByConfiguration = new Map();
for (const product of products) {
  const variants = variantsByConfiguration.get(product.configurationKey) ?? [];
  variants.push(product);
  variantsByConfiguration.set(product.configurationKey, variants);
}
const configurationGroups = [...variantsByConfiguration.values()];
const colourPicker = (product, placement) => {
  const variants = variantsByConfiguration.get(product.configurationKey) ?? [product];
  const buttons = variants.map((variant) => {
    const colourName = colourNames[variant.colour] || variant.colour;
    const colourClass = colourClasses[variant.colour] || "";
    const pressed = variant.productCode === product.productCode;
    return `<button class="colour-swatch ${escapeHtml(colourClass)}" type="button" data-colour-code="${escapeHtml(variant.productCode)}" data-configuration-key="${escapeHtml(product.configurationKey)}" aria-label="Выбрать ${escapeHtml(colourName)}" aria-pressed="${pressed}" title="${escapeHtml(colourName)}"></button>`;
  }).join("");
  return `<div class="colour-picker ${placement === "table" ? "table-colours" : "pick-colours"}"><span class="colour-swatches">${buttons}</span><span class="colour-name">${escapeHtml(colourNames[product.colour] || product.colour)}</span></div>`;
};

const airCount = configurationGroups.filter(
  ([product]) => product.family === "Air",
).length;
const proCount = configurationGroups.filter(
  ([product]) => product.family === "Pro",
).length;
const configurationCount = configurationGroups.length;
const minimumPrice = Math.min(
  ...products.map((product) => product[displayedRefurbishedPriceField]),
);
const maximumPrice = Math.max(
  ...products.map((product) => product[displayedRefurbishedPriceField]),
);
const chips = [...new Set(products.map((product) => product.chip))].sort((a, b) =>
  chipNumber(a) - chipNumber(b) || chipTier(a) - chipTier(b),
);
const families = [
  ...new Set([
    ...products.map((product) => product.family),
    profile.ranking.reference.family,
  ].filter(Boolean)),
].sort((a, b) => a.localeCompare(b));
const screens = [...new Set(products.map((product) => product.screen))]
  .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
const pickerScreenLabels = {
  "13-14": "13–14″",
  "15-16": "15–16″",
};
const pickerScreens = Object.keys(pickerScreenLabels);
const memories = [
  ...new Set([
    ...products.map((product) => product.memory),
    profile.ranking.reference.memory,
  ].filter(Boolean)),
].sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
const storages = [
  ...new Set([
    ...products.map((product) => product.storage),
    profile.ranking.reference.storage,
  ].filter(Boolean)),
].sort((a, b) => capacityNumber(a) - capacityNumber(b));
const defaultPickerPreferences = {
  family: profile.ranking.reference.family,
  screen: "",
  memory: profile.ranking.reference.memory,
  storage: profile.ranking.reference.storage,
  budget: null,
};
const recommendationOptions = {
  priceField: displayedRefurbishedPriceField,
  priceMultiplier: rate,
};
const initialRecommendations = recommendConfigurations(
  products,
  defaultPickerPreferences,
  recommendationOptions,
);
const embeddedDefaultPickerPreferences = JSON.stringify(
  defaultPickerPreferences,
).replaceAll("<", "\\u003c");
const embeddedRecommendationOptions = JSON.stringify(
  recommendationOptions,
).replaceAll("<", "\\u003c");
const embeddedRecommendConfigurations = recommendConfigurations.toString();
const embeddedEscapeHtml = escapeHtml.toString();
const productChangeLabel = (product) => {
  const display =
    product.display === "Nano-texture" ? " · Nano-texture" : "";
  return `MacBook ${product.family} ${product.screen}${display} · ${
    product.chip
  } · ${product.memory}/${product.storage} · ${product.productCode}`;
};
const changeCount = (counts = {}) =>
  Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
const priceTransition = (fromPrice, toPrice) =>
  `${fromPrice === null ? "нет точной цены" : displayPrice(fromPrice)} → ${
    toPrice === null ? "нет точной цены" : displayPrice(toPrice)
  }`;
const configurationSummary = (configuration) =>
  `${configuration.family} ${configuration.screen} · ${configuration.display} · ${configuration.chip} ${configuration.cpuCores}/${configuration.gpuCores} · ${configuration.memory}/${configuration.storage}`;
const changeItems = (entry) => {
  const items = [];
  if (entry.featured) {
    items.push(
      `Топ-3: ${entry.featured.before.join(", ")} → ${
        entry.featured.after.join(", ")
      }`,
    );
  }
  for (const item of entry.refurbPriceChanges || []) {
    items.push(
      `Refurb-цена ${item.product.productCode}: ${
        priceTransition(item[changeFromField], item[changeToField])
      }`,
    );
  }
  for (const item of entry.newPriceChanges || []) {
    items.push(
      `Цена нового ${item.product.productCode}: ${
        priceTransition(item[changeFromField], item[changeToField])
      }`,
    );
  }
  for (const item of entry.configurationChanges || []) {
    items.push(
      `Конфигурация ${item.productCode}: ${configurationSummary(item.before)} → ${configurationSummary(item.after)}`,
    );
  }
  for (const item of entry.taxInclusivePriceChanges || []) {
    const before = ["resolved", "estimated"].includes(item.before?.status)
      ? taxDisplayPrice(item.before.amount)
      : "не получено";
    const after = ["resolved", "estimated"].includes(item.after?.status)
      ? taxDisplayPrice(item.after.amount)
      : "не получено";
    items.push(
      `Итого с налогом ${item.product.productCode}: ${before} → ${after}`,
    );
  }
  for (const item of entry.added || []) {
    items.push(
      `Добавлено: ${productChangeLabel(item)} · ${
        displayPrice(item[refurbishedPriceField])
      }`,
    );
  }
  for (const item of entry.removed || []) {
    items.push(`Исчезло: ${productChangeLabel(item)}`);
  }
  return items;
};
const changelogEntry = (entry) => {
  if (entry.type === "baseline") {
    return `<article class="change-entry">
      <div class="change-entry-head"><time>${escapeHtml(formatRussianLongDate(entry.checkedAt))}</time><span>Старт отслеживания</span></div>
      <p>Зафиксирована исходная точка: ${escapeHtml(entry.counts.products)} позиций — ${escapeHtml(entry.counts.air)} Air и ${escapeHtml(entry.counts.pro)} Pro.</p>
    </article>`;
  }
  const items = changeItems(entry);
  const visibleItems = items.slice(0, 10);
  const hiddenCount = items.length - visibleItems.length;
  return `<article class="change-entry">
    <div class="change-entry-head"><time>${escapeHtml(formatRussianLongDate(entry.checkedAt))}</time><span>${escapeHtml(changeCount(entry.counts))} изменений</span></div>
    <ul>${visibleItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}${
      hiddenCount > 0 ? `<li>И ещё ${escapeHtml(hiddenCount)} изменений.</li>` : ""
    }</ul>
  </article>`;
};
const latestChangeCount = changeCount(changelogDocument.latestRun.counts);
const changelogHtml = changelogDocument.entries
  .map(changelogEntry)
  .join("");

const cardPrice = (product) =>
  hasVerifiedTaxEstimate
    ? `<strong>${taxDisplayPrice(product[taxInclusivePriceField])}</strong><span>total · расчёт</span><small class="price-formula">${taxFormula(product.taxInclusivePricing)}</small>`
    : profile.tax.model === "included-in-list-price"
      ? `<strong>${displayPrice(product[refurbishedPriceField])}</strong><span>refurb · налог включён</span>`
      : `<strong>${displayPrice(product[refurbishedPriceField])}</strong><span>refurb до налога</span>`;
const pickerFieldLabels = {
  family: "Линейка",
  screen: "Экран",
  memory: "RAM",
  storage: "SSD",
};
const recommendationHeadline = (product) =>
  `MacBook ${product.family} ${product.screen} · ${product.chip} · ${product.memory} / ${product.storage}`;
const recommendationFacts = (item) => {
  const facts = [];
  if (item.differences.length === 0) {
    facts.push("Все выбранные параметры совпали.");
  } else {
    facts.push(
      ...item.differences.map(
        (difference) =>
          `${pickerFieldLabels[difference.field]}: ${difference.actual} вместо ${difference.target}`,
      ),
    );
  }
  if (item.savingComparedToClosest > 0) {
    facts.push(
      `${displayFormatter.format(item.savingComparedToClosest)} дешевле самого точного варианта.`,
    );
  }
  if (item.overBudgetBy > 0) {
    facts.push(
      `${displayFormatter.format(item.overBudgetBy)} сверх указанного бюджета.`,
    );
  }
  return facts;
};
const card = ({ item, highlighted = false }) => {
  const product =
    variantsByConfiguration.get(item.product.configurationKey)?.[0] ??
    item.product;
  const matchLabel = item.preferenceCount > 0
    ? `${item.matchCount} из ${item.preferenceCount} совпало`
    : "Подбор по цене";
  return `<article class="pick-card${highlighted ? " featured" : ""}" data-product-code="${escapeHtml(product.productCode)}">
    <span class="pick-label">${escapeHtml(item.label)}</span>
    <span class="pick-match">${escapeHtml(matchLabel)}</span>
    <div class="pick-chip">${escapeHtml(product.chip)}</div>
    <h3>${escapeHtml(recommendationHeadline(product))}</h3>
    <ul class="pick-facts">${recommendationFacts(item).map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>
    <div class="pick-price" data-role="pick-price">${cardPrice(product)}</div>
    <div class="pick-actions">${colourPicker(product, "card")}<a class="pick-link" href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noreferrer">Открыть у Apple ↗</a></div>
  </article>`;
};

const shortlistHtml = initialRecommendations.items
  .map((item, index) => card({ item, highlighted: index === 0 }))
  .join("");
const selectOptions = (
  values,
  { includeAny = true, labels = {}, selected = "" } = {},
) =>
  `${includeAny ? `<option value=""${selected === "" ? " selected" : ""}>Не важно</option>` : ""}${values
    .map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(labels[value] || value)}</option>`)
    .join("")}`;

const checkboxes = (name, values, labels = {}) => values
  .map((value, index) => `<label class="check-option" for="${escapeHtml(name)}-${index}"><input id="${escapeHtml(name)}-${index}" type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}"><span>${escapeHtml(labels[value] || value)}</span></label>`)
  .join("");
const filterDropdown = (name, title, values, labels = {}) => `<div class="filter-field">
  <span class="control-label">${escapeHtml(title)}</span>
  <details class="filter-dropdown" data-filter="${escapeHtml(name)}">
    <summary><span class="filter-value">Все</span></summary>
    <div class="dropdown-menu">${checkboxes(name, values, labels)}</div>
  </details>
</div>`;
const exactNewPriceCount = products.filter((product) =>
  Number.isFinite(product[newPriceField]) && product.newSourceUrl,
).length;
const catalogUrl = catalogDocument?.source?.refurbishedCatalogUrl ||
  profile.storefront.refurbishedCatalogUrl;
const canonicalLink = canonicalUrl
  ? `\n  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">`
  : "";
const marketSwitcherHtml = enabledMarketProfiles
  .map((marketProfile) => {
    const isCurrent = marketProfile.id === profile.id;
    const siblingMarketUrl = `../${marketProfile.id}/`;
    return `<a class="market-option${isCurrent ? " active" : ""}" href="${escapeHtml(siblingMarketUrl)}"${isCurrent ? ' aria-current="page"' : ""} aria-label="${escapeHtml(marketProfile.siteName)}">${escapeHtml(marketProfile.storefront.countryCode)}</a>`;
  })
  .join("");
const rateLink = rateSourceUrl
  ? `<a href="${escapeHtml(rateSourceUrl)}" target="_blank" rel="noreferrer">Курс валют ↗</a>`
  : "";
const taxLocation = profile.tax.referenceLocation;
const taxReferenceLabel = taxLocation
  ? `${taxLocation.name}, ${taxLocation.street}, ${taxLocation.city}, ${taxLocation.region} ${taxLocation.postalCode}`
  : "";
const defaultTaxLocation = hasTaxLocationSwitcher
  ? taxLocationSwitcher.locations.find(
      (location) => location.id === taxLocationSwitcher.defaultLocationId,
    )
  : null;
const taxLocationDetail = (location) => {
  if (!location) return "";
  const reference = location.referenceLocation;
  return location.kind === "apple-store"
    ? `${reference.name} · ${reference.street} · ${reference.city}, ${reference.region} ${reference.postalCode}`
    : `Delivery ZIP ${reference.postalCode} · ${reference.city}, ${reference.region}`;
};
const taxLocationFeeSummary = (location) => {
  const labels = location?.estimate?.additionalFees?.map((fee) => fee.label) ?? [];
  return labels.length > 0 ? labels.join(" + ") : "без отдельного сбора";
};
const taxLocationMethodFormula = (location) => {
  const fees = location?.estimate?.additionalFees ?? [];
  const tax = `налог ${taxRatePercent(location)}%`;
  return fees.length > 0
    ? `${tax} + ${fees.map((fee) => fee.label).join(" + ")}`
    : `${tax}; без отдельного сбора`;
};
const taxRatePercent = (location) =>
  Number((location.estimate.salesTaxRate * 100).toFixed(4));
const taxLocationButtonsHtml = hasTaxLocationSwitcher
  ? taxLocationSwitcher.locations
      .map(
        (location) =>
          `<button type="button" data-tax-location="${escapeHtml(location.id)}" aria-pressed="${location.id === taxLocationSwitcher.defaultLocationId ? "true" : "false"}" title="${escapeHtml(location.label)}">${escapeHtml(location.shortLabel)}</button>`,
      )
      .join("")
  : "";
const taxLocationHeaderHtml = hasTaxLocationSwitcher
  ? `<div class="header-tax-switcher"><span>Итого для</span><div class="tax-location-switcher" role="group" aria-label="Штат для расчёта">${taxLocationButtonsHtml}</div></div>`
  : "";
const {
  currencyMethodBody,
  currencyMethodHeading,
  heroCurrencyCopy,
  heroMarketCopy,
} = buildMarketDisplayCopy(profile, {
  hasVerifiedTaxEstimate,
  hasReferenceLocationTax,
  hasTaxLocationSwitcher,
  taxLocationName: taxLocation?.name,
  rateDateFormatted,
  rateDateLong: formatRussianLongDate(rateDate),
});
const heroAsideHtml = hasTaxLocationSwitcher
  ? `<div class="tax-location-card">
      <div class="tax-location-head"><span>Расчётный total для</span><span class="tax-location-code" id="tax-location-short-label">${escapeHtml(defaultTaxLocation.shortLabel)}</span></div>
      <strong id="tax-location-label">${escapeHtml(defaultTaxLocation.label)}</strong>
      <small id="tax-location-detail">${escapeHtml(taxLocationDetail(defaultTaxLocation))}</small>
      <small id="tax-location-formula">${escapeHtml(`${taxRatePercent(defaultTaxLocation)}% tax · ${taxLocationFeeSummary(defaultTaxLocation)}`)}</small>
    </div>`
  : `<div class="hero-note"><span>Основная валюта</span><strong>${escapeHtml(displayCurrency)}</strong><small>${escapeHtml(heroCurrencyCopy)}</small></div>`;
const conversionMethodDisclosure =
  sourceCurrency === displayCurrency
    ? ""
    : ` ${currencyMethodHeading}: ${currencyMethodBody}`;
const taxMethodCopy = hasVerifiedTaxEstimate
  ? hasTaxLocationSwitcher
    ? `<article id="tax-method"><span>03</span><h3>Расчётный total</h3><p id="tax-method-copy">Цена + ${escapeHtml(taxLocationMethodFormula(defaultTaxLocation))}. Ориентир: ${escapeHtml(taxLocationDetail(defaultTaxLocation))}. Проверено в Apple checkout ${escapeHtml(formatRussianDate(defaultTaxLocation.verification.verifiedAt))}.${escapeHtml(conversionMethodDisclosure)}</p></article>`
    : `<article><span>03</span><h3>Расчётный total</h3><p>Цена + налог ${escapeHtml(profile.tax.estimate.salesTaxRate * 100)}% + сбор. Ориентир: ${escapeHtml(taxReferenceLabel)}.${escapeHtml(conversionMethodDisclosure)}</p></article>`
  : hasReferenceLocationTax
    ? `<article><span>03</span><h3>Налоговый ориентир</h3><p>Итоговая цена запрашивается только из собственного checkout-потока Apple для ${escapeHtml(taxReferenceLabel)}. Доставка и самовывоз не фильтруют общенациональный каталог; недоступная котировка явно остаётся нерешённой.${escapeHtml(conversionMethodDisclosure)}</p></article>`
    : `<article><span>03</span><h3>${escapeHtml(currencyMethodHeading)}</h3><p>${escapeHtml(currencyMethodBody)}</p></article>`;
const clientPriceFormatterSource =
  sourceCurrency !== displayCurrency
    ? `const sourcePrice=new Intl.NumberFormat(${JSON.stringify(profile.currency.secondaryLocale)},{minimumFractionDigits:${profile.currency.sourceFractionDigits},maximumFractionDigits:${profile.currency.sourceFractionDigits}});
    const sourceAmount=amount=>${JSON.stringify(profile.currency.secondarySymbol || sourceCurrency)}+sourcePrice.format(amount);
    const tablePrice=amount=>'<strong class="primary-currency">'+primaryCurrency.format(amount*rate)+'</strong> <span class="source-secondary">('+sourceAmount(amount)+')</span>';`
    : `const tablePrice=amount=>'<strong class="primary-currency">'+primaryCurrency.format(amount*rate)+'</strong>';`;
const sourceTaxFormulaSource =
  sourceCurrency !== displayCurrency
    ? `const sourcePriceFormula=pricing=>'<small class="source-tax-formula">('+
      sourceAmount(pricing.preTaxAmount)+' + '+
      sourceAmount(pricing.salesTaxAmount)+' + '+
      sourceAmount(pricing.recyclingFeeAmount)+')</small>';
    `
    : "";
const sourceTaxFormulaCall =
  sourceCurrency !== displayCurrency
    ? "+sourcePriceFormula(p.taxInclusivePricing)"
    : "";
const newSourceTaxFormulaCall =
  sourceCurrency !== displayCurrency
    ? "+sourcePriceFormula(p.newTaxInclusivePricing)"
    : "";
const clientTaxFormatterSource = hasTaxLocationSwitcher
  ? `const requestedTaxState=new URLSearchParams(window.location.search).get("state")?.toUpperCase();
    let activeTaxLocation=taxLocations.find(location=>location.shortLabel===requestedTaxState)||
      taxLocations.find(location=>location.id===defaultTaxLocationId);
    const roundTaxAmount=(amount,digits)=>{
      const factor=10**digits;
      return Math.floor(amount*factor+0.5+1e-9)/factor;
    };
    const screenInches=p=>Number(p.screen.match(/\\d+/)?.[0]||0);
    const taxPricingFor=(p,priceField)=>{
      const preTaxAmount=p[priceField];
      if(!Number.isFinite(preTaxAmount)||preTaxAmount<=0)return null;
      const estimate=activeTaxLocation.estimate;
      const inches=screenInches(p);
      const salesTaxAmount=roundTaxAmount(preTaxAmount*estimate.salesTaxRate,estimate.minorUnitDigits);
      const feeAmounts=estimate.additionalFees.map(fee=>({
        id:fee.id,
        label:fee.label,
        amount:fee.type==="fixed"?fee.amount:fee.amountByScreenInches[String(inches)]
      }));
      const additionalFeeAmount=roundTaxAmount(feeAmounts.reduce((sum,fee)=>sum+fee.amount,0),estimate.minorUnitDigits);
      return {
        amount:roundTaxAmount(preTaxAmount+salesTaxAmount+additionalFeeAmount,estimate.minorUnitDigits),
        preTaxAmount,
        salesTaxAmount,
        feeAmounts
      };
    };
    const formulaAmounts=pricing=>[pricing.preTaxAmount,pricing.salesTaxAmount,...pricing.feeAmounts.map(fee=>fee.amount)];
    const priceFormula=pricing=>'<small class="price-formula">'+
      formulaAmounts(pricing).map(amount=>taxCurrency.format(amount*rate)).join(' + ')+'</small>';
    const sourcePriceFormula=pricing=>${sourceCurrency !== displayCurrency}?
      '<small class="source-tax-formula">('+formulaAmounts(pricing).map(sourceAmount).join(' + ')+')</small>':'';
    const refurbishedPrice=p=>{
      const pricing=taxPricingFor(p,refurbishedPriceField);
      return '<a class="price-link" href="'+escapeHtml(p.sourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть refurbished у Apple"><strong class="primary-currency">'+taxCurrency.format(pricing.amount*rate)+'</strong>'+priceFormula(pricing)+sourcePriceFormula(pricing)+'</a>';
    };
    const exactNewPrice=p=>{
      const pricing=taxPricingFor(p,newPriceField);
      return pricing?
        '<a class="price-link" href="'+escapeHtml(p.newSourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть новую конфигурацию у Apple"><strong class="primary-currency">'+taxCurrency.format(pricing.amount*rate)+'</strong>'+priceFormula(pricing)+sourcePriceFormula(pricing)+'</a>':
        '<span class="na">—</span>';
    };
    const comparableRefurbishedPrice=p=>taxPricingFor(p,refurbishedPriceField).amount;
    const comparableNewPrice=p=>taxPricingFor(p,newPriceField)?.amount??null;
    const comparisonPrice=amount=>'<strong class="primary-currency">'+taxCurrency.format(amount*rate)+'</strong>';`
  : hasVerifiedTaxEstimate
    ? `${sourceTaxFormulaSource}const priceFormula=pricing=>'<small class="price-formula">'+
      taxCurrency.format(pricing.preTaxAmount*rate)+' + '+
      taxCurrency.format(pricing.salesTaxAmount*rate)+' + '+
      taxCurrency.format(pricing.recyclingFeeAmount*rate)+'</small>';
    const refurbishedPrice=p=>'<a class="price-link" href="'+escapeHtml(p.sourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть refurbished у Apple"><strong class="primary-currency">'+taxCurrency.format(p[taxInclusivePriceField]*rate)+'</strong>'+priceFormula(p.taxInclusivePricing)${sourceTaxFormulaCall}+'</a>';
    const exactNewPrice=p=>p[newTaxInclusivePriceField]?
      '<a class="price-link" href="'+escapeHtml(p.newSourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть новую конфигурацию у Apple"><strong class="primary-currency">'+taxCurrency.format(p[newTaxInclusivePriceField]*rate)+'</strong>'+priceFormula(p.newTaxInclusivePricing)${newSourceTaxFormulaCall}+'</a>':
      '<span class="na">—</span>';
    const comparableRefurbishedPrice=p=>p[taxInclusivePriceField];
    const comparableNewPrice=p=>p[newTaxInclusivePriceField];
    const comparisonPrice=amount=>'<strong class="primary-currency">'+taxCurrency.format(amount*rate)+'</strong>';`
    : hasReferenceLocationTax
      ? `const taxPrice=p=>p[taxInclusivePriceField]?
      '<small class="tax-inclusive">Итого Apple: '+taxCurrency.format(p[taxInclusivePriceField]*rate)+'</small>':
      '<small class="tax-unresolved">Итого с налогом: не получено</small>';
    const refurbishedPrice=p=>'<a class="price-link" href="'+escapeHtml(p.sourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть refurbished у Apple">'+tablePrice(p[refurbishedPriceField])+taxPrice(p)+'</a>';
    const exactNewPrice=p=>p[newPriceField]?'<a class="price-link" href="'+escapeHtml(p.newSourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть новую конфигурацию у Apple">'+tablePrice(p[newPriceField])+'</a>':'<span class="na">—</span>';
    const comparableRefurbishedPrice=p=>p[refurbishedPriceField];
    const comparableNewPrice=p=>p[newPriceField];
    const comparisonPrice=tablePrice;`
      : `const refurbishedPrice=p=>'<a class="price-link" href="'+escapeHtml(p.sourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть refurbished у Apple">'+tablePrice(p[refurbishedPriceField])+'</a>';
    const exactNewPrice=p=>p[newPriceField]?'<a class="price-link" href="'+escapeHtml(p.newSourceUrl)+'" target="_blank" rel="noreferrer" title="Открыть новую конфигурацию у Apple">'+tablePrice(p[newPriceField])+'</a>':'<span class="na">—</span>';
    const comparableRefurbishedPrice=p=>p[refurbishedPriceField];
    const comparableNewPrice=p=>p[newPriceField];
    const comparisonPrice=tablePrice;`;
const clientPickerPriceSource = hasTaxLocationSwitcher
  ? `const pickerPrice=p=>{
      const pricing=taxPricingFor(p,refurbishedPriceField);
      return '<strong>'+taxCurrency.format(pricing.amount*rate)+'</strong><span>total · расчёт</span>'+priceFormula(pricing);
    };`
  : hasVerifiedTaxEstimate
    ? `const pickerPrice=p=>'<strong>'+taxCurrency.format(p[taxInclusivePriceField]*rate)+'</strong><span>total · расчёт</span>'+priceFormula(p.taxInclusivePricing);`
  : profile.tax.model === "included-in-list-price"
    ? `const pickerPrice=p=>'<strong>'+primaryCurrency.format(p[refurbishedPriceField]*rate)+'</strong><span>refurb · налог включён</span>';`
    : `const pickerPrice=p=>'<strong>'+primaryCurrency.format(p[refurbishedPriceField]*rate)+'</strong><span>refurb до налога</span>';`;
const refurbishedHeader = hasVerifiedTaxEstimate
  ? "Refurb total · расчёт"
  : hasReferenceLocationTax
    ? "Цена refurb до налога"
    : "Цена refurb";
const newHeader = hasVerifiedTaxEstimate
  ? "Новый total · расчёт"
  : hasReferenceLocationTax
    ? "Цена нового до налога"
    : "Цена нового";
const clientTaxLocationUiSource = hasTaxLocationSwitcher
  ? `const taxRatePercent=location=>Number((location.estimate.salesTaxRate*100).toFixed(4));
    const taxLocationDetail=location=>{
      const reference=location.referenceLocation;
      return location.kind==="apple-store"?
        reference.name+" · "+reference.street+" · "+reference.city+", "+reference.region+" "+reference.postalCode:
        "Delivery ZIP "+reference.postalCode+" · "+reference.city+", "+reference.region;
    };
    const taxFeeSummary=location=>{
      const labels=location.estimate.additionalFees.map(fee=>fee.label);
      return labels.length?labels.join(" + "):"без отдельного сбора";
    };
    const taxMethodFormula=location=>{
      const labels=location.estimate.additionalFees.map(fee=>fee.label);
      const tax="налог "+taxRatePercent(location)+"%";
      return labels.length?tax+" + "+labels.join(" + "):tax+"; без отдельного сбора";
    };
    const renderTaxLocationUi=()=>{
      document.querySelectorAll("[data-tax-location]").forEach(button=>
        button.setAttribute("aria-pressed",String(button.dataset.taxLocation===activeTaxLocation.id))
      );
      document.querySelector("#tax-location-label").textContent=activeTaxLocation.label;
      document.querySelector("#tax-location-short-label").textContent=activeTaxLocation.shortLabel;
      document.querySelector("#tax-location-detail").textContent=taxLocationDetail(activeTaxLocation);
      document.querySelector("#tax-location-formula").textContent=
        taxRatePercent(activeTaxLocation)+"% tax · "+taxFeeSummary(activeTaxLocation);
      const totals=products.map(comparableRefurbishedPrice);
      document.querySelector("#price-range-value").textContent=
        taxCurrency.format(Math.min(...totals)*rate)+" – "+taxCurrency.format(Math.max(...totals)*rate);
      document.querySelectorAll(".pick-card[data-product-code]").forEach(card=>{
        const product=products.find(p=>p.productCode===card.dataset.productCode);
        const pricing=taxPricingFor(product,refurbishedPriceField);
        card.querySelector('[data-role="pick-price"]').innerHTML=
          '<strong>'+taxCurrency.format(pricing.amount*rate)+'</strong>'+
          '<span>total · расчёт</span>'+priceFormula(pricing)+sourcePriceFormula(pricing);
      });
      document.querySelector("#refurbished-price-header").textContent=
        "Refurb total · "+activeTaxLocation.shortLabel;
      document.querySelector("#new-price-header").textContent=
        "Новый total · "+activeTaxLocation.shortLabel;
      const deliveryNote=activeTaxLocation.methodNote?
        " "+activeTaxLocation.methodNote:"";
      document.querySelector("#tax-method-copy").textContent=
        "Цена + "+taxMethodFormula(activeTaxLocation)+
        ". Ориентир: "+taxLocationDetail(activeTaxLocation)+
        ". Проверено в Apple checkout "+activeTaxLocation.verification.verifiedAt+"."+deliveryNote;
    };
    const activateTaxLocation=locationId=>{
      const nextLocation=taxLocations.find(location=>location.id===locationId);
      if(!nextLocation)return;
      if(nextLocation.id===activeTaxLocation.id){
        synchronizeCatalogViewUrl();
        return;
      }
      activeTaxLocation=nextLocation;
      synchronizeCatalogViewUrl();
      renderTaxLocationUi();
      updatePersonalizedRecommendations();
    };`
  : "";
const clientTaxLocationEventsSource = hasTaxLocationSwitcher
  ? `document.querySelectorAll("[data-tax-location]").forEach(button=>
      button.addEventListener("click",()=>activateTaxLocation(button.dataset.taxLocation))
    );
    renderTaxLocationUi();`
  : "";
const taxLocationCss = hasTaxLocationSwitcher
  ? `
    .header-tax-switcher{display:flex;align-items:center;gap:10px;border-left:1px solid var(--line);padding-left:18px}
    .header-tax-switcher>span{font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
    .tax-location-card{min-height:165px;background:var(--white);border:1px solid var(--ink);padding:18px;display:grid;gap:9px;box-shadow:7px 7px 0 var(--ink)}
    .tax-location-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .tax-location-head>span,.tax-location-card small{font-size:11px;color:var(--muted)}
    .tax-location-head>span:first-child{font-weight:800;text-transform:uppercase;letter-spacing:.07em}
    .tax-location-head .tax-location-code{display:grid;place-items:center;min-width:38px;height:28px;padding:0 8px;background:var(--ink);color:var(--paper);font:850 10px ui-monospace,SFMono-Regular,Menlo,monospace}
    .tax-location-card>strong{font-size:28px;letter-spacing:-.04em}
    .tax-location-switcher{display:flex}
    .tax-location-switcher button{width:34px;padding:0;border-right:0;background:transparent;color:var(--ink);cursor:pointer}
    .tax-location-switcher button:last-child{border-right:1px solid var(--ink)}
    .tax-location-switcher button:hover,.tax-location-switcher button[aria-pressed="true"]{background:var(--blue);color:white}
    .stable-tax-columns{min-width:1250px;table-layout:fixed}
    .stable-tax-columns th{white-space:nowrap}
    .stable-tax-columns th:nth-child(1),.stable-tax-columns td:nth-child(1){width:172px}
    .stable-tax-columns th:nth-child(2),.stable-tax-columns td:nth-child(2){width:60px}
    .stable-tax-columns th:nth-child(3),.stable-tax-columns td:nth-child(3){width:92px}
    .stable-tax-columns th:nth-child(4),.stable-tax-columns td:nth-child(4),.stable-tax-columns th:nth-child(5),.stable-tax-columns td:nth-child(5){width:68px}
    .stable-tax-columns th:nth-child(6),.stable-tax-columns td:nth-child(6){width:104px}
    .stable-tax-columns th:nth-child(7),.stable-tax-columns td:nth-child(7){width:154px}
    .stable-tax-columns th:nth-child(8),.stable-tax-columns td:nth-child(8),.stable-tax-columns th:nth-child(9),.stable-tax-columns td:nth-child(9){width:185px;min-width:185px;max-width:185px}
    .stable-tax-columns th:nth-child(10),.stable-tax-columns td:nth-child(10){width:162px;min-width:162px;max-width:162px}
    #tax-location-formula{font-weight:750;color:var(--ink)}`
  : "";
const responsiveHeroAsideCss = hasTaxLocationSwitcher
  ? ".hero-note,.tax-location-card{max-width:520px}"
  : ".hero-note{max-width:480px}";
const clientTaxLocationDataSource = hasTaxLocationSwitcher
  ? `    const taxLocations=${embeddedTaxLocations};
    const defaultTaxLocationId=${JSON.stringify(taxLocationSwitcher.defaultLocationId)};
    const defaultTaxLocation=taxLocations.find(location=>location.id===defaultTaxLocationId);
    const taxStateOptions={
      parameter:"state",
      allowedValues:taxLocations.map(location=>location.shortLabel.toLowerCase()),
      defaultValue:defaultTaxLocation.shortLabel.toLowerCase(),
    };
`
  : "";
const clientOwnedChoiceSource = hasTaxLocationSwitcher
  ? `    const writeOwnedChoiceSearch=${writeOwnedChoiceSearch.toString()};
`
  : "";
const clientViewSearchSource = hasTaxLocationSwitcher
  ? `let search=writeCatalogViewSearch(location.search,currentViewState(),viewStateOptions);
      search=writeOwnedChoiceSearch(search,{
        ...taxStateOptions,
        value:activeTaxLocation.shortLabel.toLowerCase(),
      });`
  : "const search=writeCatalogViewSearch(location.search,currentViewState(),viewStateOptions);";
const clientModelMetadataSource = hasTaxLocationSwitcher
  ? `<strong>MacBook \${escapeHtml(p.family)}</strong><small>\${escapeHtml(p.releaseYear)} · \${escapeHtml(p.productCode)}</small>\${p.display==="Nano-texture"?'<small class="model-display">Nano-texture</small>':""}`
  : `<strong>MacBook \${escapeHtml(p.family)}</strong><small>\${escapeHtml(p.releaseYear)} · \${escapeHtml(p.productCode)}\${p.display==="Nano-texture"?" · Nano-texture":""}</small>`;

const html = `<!doctype html>
<html lang="${escapeHtml(profile.language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Сравнение ${products.length} восстановленных MacBook Air и MacBook Pro из Apple ${escapeHtml(profile.storefront.countryName)}: цены в ${escapeHtml(displayCurrency)}, память, SSD, экран и чип.">
  <title>${escapeHtml(pageTitle)}</title>${canonicalLink}
  <style>
    :root{--paper:#f5f1e8;--ink:#11110f;--muted:#68675f;--line:#c9c5ba;--lime:#d9ff43;--blue:#254bff;--white:#fffef9}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
    a{color:inherit}
    button,select,input{font:inherit}
    .topbar{height:64px;padding:0 4vw;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ink);position:sticky;top:0;background:rgba(245,241,232,.94);backdrop-filter:blur(12px);z-index:10}
    .wordmark{font-weight:900;letter-spacing:.08em;text-decoration:none}
    .topbar-actions,.section-nav,.market-switcher${hasTaxLocationSwitcher ? ",.header-tax-switcher" : ""}{display:flex;align-items:center}
    .topbar-actions{gap:26px}
    .section-nav{gap:26px;font-size:13px}
    .section-nav a{text-decoration:none}
    .market-switcher{gap:4px;border-left:1px solid var(--line);padding-left:18px}
    .market-switcher>span{font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-right:4px}
    .market-option${hasTaxLocationSwitcher ? ",.tax-location-switcher button" : ""}{display:grid;place-items:center;min-width:34px;height:30px;border:1px solid var(--ink);font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none}
    .market-option:hover,.market-option.active{background:var(--ink);color:var(--paper)}
    .hero{padding:72px 4vw 0;border-bottom:1px solid var(--ink)}
    .eyebrow,.section-index{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
    .live-dot{display:inline-block;width:8px;height:8px;background:#67cc45;border-radius:50%;margin-right:8px}
    h1{font-size:clamp(56px,9vw,136px);line-height:.86;letter-spacing:-.075em;margin:42px 0 56px;max-width:1400px}
    .hero-grid{display:grid;grid-template-columns:1.35fr .65fr;gap:8vw;align-items:end;margin-bottom:56px}
    .lede{font-size:clamp(22px,2.4vw,36px);line-height:1.15;letter-spacing:-.035em;margin:0;max-width:820px}
    .hero-note{background:var(--lime);border:1px solid var(--ink);padding:20px;display:grid;gap:8px;box-shadow:7px 7px 0 var(--ink)}
    .hero-note span,.hero-note small{font-size:12px}.hero-note strong{font-size:22px}${taxLocationCss}
    .hero-stats{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink)}
    .hero-stats div{padding:24px 0;border-right:1px solid var(--ink);display:grid;gap:5px}
    .hero-stats div:not(:first-child){padding-left:24px}.hero-stats div:last-child{border-right:0}
    .hero-stats strong{font-size:clamp(22px,3vw,40px);letter-spacing:-.04em}.hero-stats span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
    .hero-stats .price-range strong{font-size:clamp(18px,1.8vw,28px);line-height:1.1}
    .section-shell{padding:90px 4vw;border-bottom:1px solid var(--ink)}
    .section-heading{display:flex;justify-content:space-between;align-items:end;gap:30px;margin-bottom:40px}
    .section-heading h2{font-size:clamp(42px,6vw,78px);line-height:.9;letter-spacing:-.06em;margin:13px 0 0}
    .section-heading p{max-width:460px;margin:0;color:var(--muted);font-size:17px}
    .preference-picker{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr)) minmax(170px,1.15fr) auto;gap:10px;align-items:end;background:var(--ink);padding:14px;margin-bottom:22px}
    .picker-field{display:grid;gap:5px;min-width:0}
    .control-label{font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--paper)}
    .picker-field select,.picker-budget{width:100%;min-height:48px;border:0;border-radius:0;background:var(--white);color:var(--ink);padding:12px}
    .picker-budget{display:flex;align-items:center;gap:8px;padding:0 12px}
    .picker-field select,.picker-budget input,.picker-reset{font-family:inherit;font-size:16px;font-weight:400;letter-spacing:normal}
    .picker-budget input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--ink);padding:12px 0}
    .picker-budget input::placeholder{color:var(--muted);opacity:1}
    .picker-budget b{font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
    .picker-reset{height:48px;border:1px solid var(--paper);background:transparent;color:var(--paper);padding:0 18px;cursor:pointer}
    .picker-field select:focus-visible,.picker-budget:focus-within,.picker-reset:focus-visible{outline:3px solid var(--lime);outline-offset:2px}
    .picker-context{margin:-8px 0 24px;color:var(--muted);font-size:13px}
    .picks-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .pick-card{position:relative;background:var(--white);border:1px solid var(--ink);padding:26px;min-height:410px;display:flex;flex-direction:column}
    .pick-card.featured{background:var(--lime)}
    .pick-label{font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em}
    .pick-match{position:absolute;right:20px;top:20px;border:1px solid var(--ink);padding:5px 7px;font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.05em}
    .pick-chip{font-size:clamp(54px,6vw,86px);font-weight:900;letter-spacing:-.08em;line-height:1;margin:32px 0 10px;white-space:nowrap}
    .pick-card h3{font-size:28px;letter-spacing:-.04em;margin:0 0 15px}
    .pick-facts{display:grid;gap:7px;color:#4e4d47;line-height:1.35;margin:0 0 25px;padding-left:18px;font-size:14px}
    .pick-price{margin-top:auto;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.pick-price strong{font-size:31px}.pick-price span{color:var(--muted)}
    .pick-actions{display:grid;gap:14px;margin-top:20px}.pick-link{font-weight:750;text-underline-offset:4px}
    .decision-note{margin-top:20px;background:var(--ink);color:var(--paper);padding:22px 26px;display:flex;gap:20px;align-items:center}
    .decision-note p{margin:0;font-size:18px}.decision-mark{display:grid;place-items:center;background:var(--blue);border-radius:50%;width:36px;height:36px;font-weight:900;flex:0 0 auto}
    .filters{position:relative;z-index:5;display:grid;grid-template-columns:repeat(5,minmax(120px,1fr)) minmax(210px,1.5fr) auto;gap:10px;align-items:end;background:var(--ink);padding:14px}
    .filter-field,.sort-control{display:grid;gap:5px;min-width:0}
    .filter-dropdown{position:relative;min-width:0}
    .filter-dropdown summary{position:relative;display:flex;align-items:center;min-height:48px;padding:12px 34px 12px 12px;background:var(--white);color:var(--ink);cursor:pointer;list-style:none}
    .filter-dropdown summary::-webkit-details-marker{display:none}
    .filter-dropdown summary::after{content:"⌄";position:absolute;right:12px;top:50%;font-size:18px;line-height:1;transform:translateY(-50%);transition:transform .15s ease}
    .filter-dropdown[open] summary{background:var(--lime)}
    .filter-dropdown[open] summary::after{transform:translateY(-50%) rotate(180deg)}
    .filter-value,.sort-control select,.reset{font-family:inherit;font-size:16px;font-weight:400;letter-spacing:normal}
    .filter-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dropdown-menu{position:absolute;top:calc(100% + 6px);left:0;min-width:max(100%,210px);max-height:310px;overflow:auto;background:var(--white);border:1px solid var(--ink);box-shadow:6px 6px 0 var(--ink);z-index:20}
    .check-option{display:flex;align-items:center;gap:9px;min-height:40px;padding:9px 11px;background:var(--white);color:var(--ink);border-bottom:1px solid var(--line);font-size:12px;font-weight:700;cursor:pointer;user-select:none}
    .check-option:last-child{border-bottom:0}
    .check-option:has(input:checked){background:var(--lime)}
    .check-option input{width:15px;height:15px;margin:0;accent-color:var(--blue)}
    select{border:0;border-radius:0;background:var(--white);color:var(--ink);padding:12px 32px 12px 12px;min-height:43px}
    .sort-control select{width:100%;min-width:0;min-height:48px}
    .reset{border:1px solid var(--paper);background:transparent;color:var(--paper);padding:0 18px;cursor:pointer;align-self:end;height:48px}
    .filter-dropdown summary:focus-visible,.sort-control select:focus-visible,.reset:focus-visible{outline:3px solid var(--lime);outline-offset:2px}
    .result-count{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.07em;margin:22px 0 12px}
    .table-wrap{overflow:auto;border:1px solid var(--ink);background:var(--white)}
    table{width:100%;border-collapse:collapse;min-width:1200px}
    th{text-align:left;background:var(--ink);color:var(--paper);font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;padding:13px 12px}
    td{padding:14px 12px;border-bottom:1px solid var(--line);font-size:14px}
    tbody tr:hover{background:#eeeadf}.recommended{background:#efffc0}
    .model{display:flex;align-items:center;gap:12px}.model small{display:block;color:var(--muted);margin-top:4px;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}
    .model-mark{display:grid;place-items:center;width:42px;height:42px;background:var(--ink);color:white;border-radius:9px;font-weight:900}
    .chip-name{display:inline-block;background:#e8e5dc;padding:7px 9px;font-weight:850;white-space:nowrap}.chip-m5{background:var(--blue);color:white}
    .colour-picker{min-width:0}.colour-swatches{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.colour-swatch{display:block;width:18px;height:18px;flex:0 0 18px;padding:0;border:1px solid #777;border-radius:50%;cursor:pointer}.colour-swatch[aria-pressed="true"]{outline:2px solid var(--ink);outline-offset:2px}.colour-swatch:focus-visible{outline:3px solid var(--blue);outline-offset:3px}.colour-name{font-size:12px;color:var(--muted);white-space:normal}.pick-colours{display:flex;align-items:center;gap:11px;flex-wrap:wrap}.table-colours{display:grid;gap:8px;min-width:112px}
    .silver{background:#e7e8e8}.midnight{background:#252a32}.space-grey{background:#838487}.space-black{background:#222}.starlight{background:#f1e5c9}.sky-blue{background:#b9d5e7}
    .primary-currency{font-size:18px}.source-secondary,.tax-inclusive,.tax-unresolved,.price-formula,.source-tax-formula{display:block;font-size:11px;font-weight:400;color:var(--muted);white-space:nowrap}.pick-price small{flex-basis:100%;font-size:12px;color:var(--muted)}.badge{display:inline-block;background:var(--blue);color:white;margin-left:8px;padding:3px 5px;font-size:9px;text-transform:uppercase;letter-spacing:.06em}
    .price-link{color:inherit;text-decoration-color:#aaa;text-underline-offset:3px}
    .saving{font-weight:800;color:#187235}.overpay{font-weight:800;color:#c12b22}.na{color:var(--muted)}
    .empty{padding:40px;text-align:center}.empty button{border:0;background:none;text-decoration:underline;cursor:pointer}
    .method-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--ink);border:1px solid var(--ink)}
    .method-grid article{background:var(--paper);padding:28px;min-height:220px}.method-grid span{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--blue)}
    .method-grid h3{font-size:25px;margin:35px 0 12px}.method-grid p{line-height:1.5;color:var(--muted);margin:0}
    .change-latest{display:flex;justify-content:space-between;gap:20px;align-items:center;background:var(--lime);border:1px solid var(--ink);padding:18px 22px;margin-bottom:18px}.change-latest strong{font-size:18px}.change-latest span{font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.06em}
    .changelog-list{display:grid;gap:12px}.change-entry{border:1px solid var(--ink);background:var(--white);padding:22px}.change-entry-head{display:flex;justify-content:space-between;gap:20px;margin-bottom:15px}.change-entry-head time{font-size:19px;font-weight:850}.change-entry-head span{font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;color:var(--blue)}.change-entry p{margin:0;color:var(--muted);line-height:1.5}.change-entry ul{margin:0;padding-left:20px;display:grid;gap:9px;line-height:1.45}
    footer{padding:30px 4vw;display:flex;justify-content:space-between;gap:20px;font-size:12px;color:var(--muted)}
    footer div{display:flex;gap:20px;flex-wrap:wrap}
    @media(max-width:1100px){.preference-picker{grid-template-columns:repeat(3,minmax(0,1fr))}.picker-reset{width:100%}.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.sort-control{grid-column:span 2}.reset{width:100%}}
    @media(max-width:850px){.section-nav{display:none}.topbar-actions{gap:10px}.market-switcher${hasTaxLocationSwitcher ? ",.header-tax-switcher" : ""}{padding-left:10px}.hero{padding-top:48px}h1{margin-bottom:40px}.hero-grid,.picks-grid,.method-grid{grid-template-columns:1fr}${responsiveHeroAsideCss}.hero-stats{grid-template-columns:1fr}.hero-stats div{border-right:0;border-bottom:1px solid var(--ink);padding:18px 0!important}.section-shell{padding:70px 4vw}.section-heading{display:block}.section-heading p{margin-top:20px}.reset{width:100%}.pick-card{min-height:340px}.change-latest,.change-entry-head{align-items:flex-start;flex-direction:column}footer{display:block}footer div{margin-top:15px}}
    @media(max-width:620px){${hasTaxLocationSwitcher ? ".topbar{height:auto;min-height:64px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}.topbar-actions{display:contents}.market-switcher{grid-column:2;grid-row:1;height:64px}.header-tax-switcher{grid-column:1/-1;grid-row:2;margin:0 -4vw;padding:8px 4vw;border-left:0;border-top:1px solid var(--line);justify-content:space-between}.header-tax-switcher .tax-location-switcher{margin-left:auto}" : ""}h1{font-size:54px}.lede{font-size:22px}.preference-picker,.filters{grid-template-columns:1fr}.sort-control{grid-column:auto}.dropdown-menu{position:static;min-width:0;margin-top:6px;box-shadow:none}.section-heading h2{font-size:44px}.pick-chip{font-size:58px}.pick-match{position:static;align-self:flex-start;margin-top:10px}}
    @media print{.topbar,.filters{display:none}.hero{padding-top:30px}.section-shell{padding:40px 3vw}.table-wrap{overflow:visible}table{min-width:0}th,td{padding:8px;font-size:8px}}
  </style>
</head>
<body>
  <header class="topbar">
    <a class="wordmark" href="#top">MAC / FINDER</a>
    <div class="topbar-actions">
      <nav class="section-nav" aria-label="Разделы"><a href="#shortlist">Подбор</a><a href="#comparison">Все модели</a><a href="#method">О данных</a><a href="#changelog">Изменения</a></nav>
${taxLocationHeaderHtml ? `      ${taxLocationHeaderHtml}\n` : ""}      <nav class="market-switcher" aria-label="Выбор рынка"><span>Рынок</span>${marketSwitcherHtml}</nav>
    </div>
  </header>

  <main>
    <section class="hero" id="top">
      <div class="eyebrow"><span class="live-dot"></span>${escapeHtml(profile.siteName)} · Apple ${escapeHtml(profile.storefront.countryName)} · ${checkedDate}</div>
      <h1>MacBook Air<br>или Pro?</h1>
      <div class="hero-grid">
        <p class="lede">В одной таблице — все доступные 13″ и 15″ Air плюс все 14″ и 16″ MacBook Pro. ${escapeHtml(heroMarketCopy)}</p>
        ${heroAsideHtml}
      </div>
      <div class="hero-stats">
        <div><strong>${configurationCount}</strong><span>конфигураций · ${products.length} цветовых вариантов</span></div>
        <div><strong>${airCount} Air · ${proCount} Pro</strong><span>конфигурации в каталоге</span></div>
        <div class="price-range"><strong${hasTaxLocationSwitcher ? ' id="price-range-value"' : ""}>${mainPrice(minimumPrice)} – ${mainPrice(maximumPrice)}</strong><span>${hasVerifiedTaxEstimate ? "диапазон total · расчёт" : hasReferenceLocationTax ? "диапазон до налога" : "диапазон цен"}</span></div>
      </div>
    </section>

    <section class="section-shell" id="shortlist">
      <div class="section-heading"><div><span class="section-index">01</span><h2>Что подойдёт вам?</h2></div><p>Опишите желаемую конфигурацию. Подбор мгновенно пересчитается по моделям, которые сейчас есть у Apple.</p></div>
      <form class="preference-picker" id="preference-picker">
        <label class="picker-field"><span class="control-label">Линейка</span><select id="target-family" name="ideal-family">${selectOptions(families, { selected: defaultPickerPreferences.family })}</select></label>
        <label class="picker-field"><span class="control-label">Экран</span><select id="target-screen" name="ideal-screen">${selectOptions(pickerScreens, { labels: pickerScreenLabels, selected: defaultPickerPreferences.screen })}</select></label>
        <label class="picker-field"><span class="control-label">Память</span><select id="target-memory" name="ideal-memory">${selectOptions(memories, { selected: defaultPickerPreferences.memory })}</select></label>
        <label class="picker-field"><span class="control-label">SSD</span><select id="target-storage" name="ideal-storage">${selectOptions(storages, { selected: defaultPickerPreferences.storage })}</select></label>
        <label class="picker-field"><span class="control-label">Максимальный бюджет</span><span class="picker-budget"><input id="target-budget" name="max-price" type="number" min="1" step="1" inputmode="decimal" placeholder="Без лимита"><b>${escapeHtml(displayCurrency)}</b></span></label>
        <button class="picker-reset" id="picker-reset" type="button">Вернуть пример</button>
      </form>
      <p class="picker-context" id="picker-summary" aria-live="polite"></p>
      <div class="picks-grid" id="personal-picks">${shortlistHtml}</div>
      <div class="decision-note"><span class="decision-mark">!</span><p><strong>Без магического рейтинга:</strong> сначала учитывается близость к выбранному железу и бюджету; недобор RAM или SSD штрафуется сильнее, чем небольшой запас сверху.</p></div>
    </section>

    <section class="section-shell" id="comparison">
      <div class="section-heading"><div><span class="section-index">02</span><h2>Полная таблица</h2></div><p>Фильтруйте по линейке, диагонали и железу. Одна строка — одна конфигурация; доступные цвета собраны внутри.</p></div>
      <div class="filters">
        ${filterDropdown("family", "Линейка", families, { Air: "MacBook Air", Pro: "MacBook Pro" })}
        ${filterDropdown("screen", "Экран", screens)}
        ${filterDropdown("chip", "Чип", chips)}
        ${filterDropdown("memory", "Память", memories)}
        ${filterDropdown("storage", "SSD", storages)}
        <label class="sort-control"><span class="control-label">Сортировка</span><select id="sorting"><option value="recommended">Сначала рекомендуемые</option><option value="price-asc">Цена: по возрастанию</option><option value="price-desc">Цена: по убыванию</option><option value="memory">Больше памяти</option><option value="newest">Сначала новые чипы</option></select></label>
        <button class="reset" id="reset" type="button">Сбросить</button>
      </div>
      <div class="result-count" id="count"></div>
      <div class="table-wrap">
        <table${hasTaxLocationSwitcher ? ' class="stable-tax-columns"' : ""}>
          <thead><tr><th>Модель</th><th>Экран</th><th>Чип</th><th>RAM</th><th>SSD</th><th>CPU / GPU</th><th>Цвет</th><th${hasTaxLocationSwitcher ? ' id="refurbished-price-header"' : ""}>${escapeHtml(refurbishedHeader)}</th><th${hasTaxLocationSwitcher ? ' id="new-price-header"' : ""}>${escapeHtml(newHeader)}</th><th>Скидка</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
        <div class="empty" id="empty" hidden>Такой комбинации сейчас нет. <button id="empty-reset" type="button">Сбросить фильтры</button></div>
      </div>
    </section>

    <section class="section-shell" id="method">
      <div class="section-heading"><div><span class="section-index">03</span><h2>Что важно знать</h2></div></div>
      <div class="method-grid">
        <article><span>01</span><h3>Остатки меняются</h3><p>Снимок каталога проверен ${checkedDateLong}. Apple не публикует расписание пополнений, а отдельные модели могут исчезнуть в любой момент.</p></article>
        <article><span>02</span><h3>Новая цена — только точная</h3><p>Для ${exactNewPriceCount} цветовых вариантов проверены те же экран, чип, ядра, RAM, SSD и цвет. Если точного совпадения нет, новая цена не приписывается.</p></article>
        ${taxMethodCopy}
      </div>
    </section>

    <section class="section-shell" id="changelog">
      <div class="section-heading"><div><span class="section-index">04</span><h2>Что изменилось</h2></div><p>История доступности, цен и рекомендаций. Записываются только реальные изменения каталога.</p></div>
      <div class="change-latest">
        <strong>${changelogDocument.latestRun.hasChanges ? `За последнюю проверку найдено ${latestChangeCount} изменений.` : "С предыдущей проверки изменений нет."}</strong>
        <span>Проверено ${escapeHtml(formatRussianDate(changelogDocument.latestRun.checkedAt))}</span>
      </div>
      <div class="changelog-list">${changelogHtml}</div>
    </section>
  </main>

  <footer><p>Независимый справочник. Не связан с Apple Inc.</p><div><a href="${escapeHtml(catalogUrl)}" target="_blank" rel="noreferrer">Весь каталог Apple ↗</a>${rateLink}</div></footer>

  <script>
    const products=${embeddedProducts};
    const rate=${rate};
    const refurbishedPriceField=${JSON.stringify(refurbishedPriceField)};
    const newPriceField=${JSON.stringify(newPriceField)};
    const taxInclusivePriceField=${JSON.stringify(taxInclusivePriceField)};
    const newTaxInclusivePriceField=${JSON.stringify(newTaxInclusivePriceField)};
${clientTaxLocationDataSource}    const hasDynamicTaxLocations=${hasTaxLocationSwitcher};
    const escapeHtml=${embeddedEscapeHtml};
    const recommendConfigurations=${embeddedRecommendConfigurations};
    const recommendationOptions=${embeddedRecommendationOptions};
    const defaultPickerPreferences=${embeddedDefaultPickerPreferences};
    const pickerScreenLabels=${JSON.stringify(pickerScreenLabels)};
    const names=${JSON.stringify(colourNames)};
    const classes=${JSON.stringify(colourClasses)};
    const primaryCurrency=new Intl.NumberFormat(${JSON.stringify(profile.currency.displayLocale)},{style:"currency",currency:${JSON.stringify(displayCurrency)},minimumFractionDigits:${profile.currency.displayFractionDigits},maximumFractionDigits:${profile.currency.displayFractionDigits}});
    const taxCurrency=new Intl.NumberFormat(${JSON.stringify(profile.currency.displayLocale)},{style:"currency",currency:${JSON.stringify(displayCurrency)},minimumFractionDigits:${profile.currency.displayFractionDigits},maximumFractionDigits:${profile.currency.displayFractionDigits}});
    ${clientPriceFormatterSource}
    ${clientTaxFormatterSource}
    ${clientPickerPriceSource}
    const variantsByConfiguration=new Map();
    products.forEach(product=>{
      const variants=variantsByConfiguration.get(product.configurationKey)||[];
      variants.push(product);
      variantsByConfiguration.set(product.configurationKey,variants);
    });
    const configurationGroups=[...variantsByConfiguration.values()];
    const selectedCodesByConfiguration=new Map(configurationGroups.map(variants=>{
      const product=variants[0];
      return [product.configurationKey,product.productCode];
    }));
    const selectedVariant=(configurationKey,fallback)=>{
      const variants=variantsByConfiguration.get(configurationKey)||[];
      const selectedCode=selectedCodesByConfiguration.get(configurationKey);
      return variants.find(product=>product.productCode===selectedCode)||
        variants.find(product=>product.productCode===fallback?.productCode)||
        variants[0]||fallback;
    };
    const colourPickerMarkup=(product,placement)=>{
      const variants=variantsByConfiguration.get(product.configurationKey)||[product];
      const buttons=variants.map(variant=>{
        const colourName=names[variant.colour]||variant.colour;
        const colourClass=classes[variant.colour]||"";
        const pressed=variant.productCode===product.productCode;
        return '<button class="colour-swatch '+escapeHtml(colourClass)+'" type="button" '+
          'data-colour-code="'+escapeHtml(variant.productCode)+'" '+
          'data-configuration-key="'+escapeHtml(product.configurationKey)+'" '+
          'aria-label="Выбрать '+escapeHtml(colourName)+'" aria-pressed="'+pressed+'" '+
          'title="'+escapeHtml(colourName)+'"></button>';
      }).join("");
      return '<div class="colour-picker '+(placement==="table"?"table-colours":"pick-colours")+
        '" role="group" aria-label="Доступные цвета"><span class="colour-swatches">'+buttons+
        '</span><span class="colour-name">'+escapeHtml(names[product.colour]||product.colour)+'</span></div>';
    };
${clientTaxLocationUiSource ? `    ${clientTaxLocationUiSource}\n` : ""}
    const readCatalogViewState=${readCatalogViewState.toString()};
    const writeCatalogViewSearch=${writeCatalogViewSearch.toString()};
${clientOwnedChoiceSource}    const filterNames=["family","screen","chip","memory","storage"];
    const sorting=document.querySelector("#sorting");
    const viewStateOptions={
      filterNames,
      allowedFilterValues:Object.fromEntries(filterNames.map(name=>[
        name,[...document.querySelectorAll(\`input[name="\${name}"]\`)].map(input=>input.value),
      ])),
      allowedSortingValues:[...sorting.options].map(option=>option.value),
      defaultSorting:sorting.options[0].value,
    };
    const memoryNumber=value=>Number(value.replace(/\\D/g,""));
    const storageNumber=value=>Number(value.replace(/\\D/g,""))*(value.endsWith("TB")?1024:1);
    const chipNumber=value=>Number(value.match(/\\d+/)?.[0]||0);
    const chipTier=value=>value.includes("Max")?2:value.includes("Pro")?1:0;
    let recommendedConfigurationKeys=[];
    let currentRecommendations=null;
    const score=p=>{
      const rank=recommendedConfigurationKeys.indexOf(p.configurationKey);
      return rank>=0?1000000-rank*1000:(p.chip.startsWith("M5")?100:50)+memoryNumber(p.memory)/10-p[refurbishedPriceField]/10000;
    };
    const pickerFields=["family","screen","memory","storage"];
    const pickerParameters={family:"ideal-family",screen:"ideal-screen",memory:"ideal-memory",storage:"ideal-storage",budget:"max-price"};
    const pickerFieldLabels={family:"Линейка",screen:"Экран",memory:"RAM",storage:"SSD"};
    const pickerControls={
      family:document.querySelector("#target-family"),
      screen:document.querySelector("#target-screen"),
      memory:document.querySelector("#target-memory"),
      storage:document.querySelector("#target-storage"),
      budget:document.querySelector("#target-budget"),
    };
    const pickerAllowedValues=Object.fromEntries(pickerFields.map(field=>[
      field,new Set([...pickerControls[field].options].map(option=>option.value)),
    ]));
    const readPickerState=()=>{
      const parameters=new URLSearchParams(location.search);
      const preferences={};
      pickerFields.forEach(field=>{
        const requested=parameters.get(pickerParameters[field]);
        preferences[field]=requested===null?defaultPickerPreferences[field]:
          requested==="any"?"":pickerAllowedValues[field].has(requested)?requested:
          defaultPickerPreferences[field];
      });
      const requestedBudget=Number(parameters.get(pickerParameters.budget));
      preferences.budget=Number.isFinite(requestedBudget)&&requestedBudget>0?requestedBudget:null;
      return preferences;
    };
    const currentPickerPreferences=()=>({
      family:pickerControls.family.value,
      screen:pickerControls.screen.value,
      memory:pickerControls.memory.value,
      storage:pickerControls.storage.value,
      budget:Number(pickerControls.budget.value)>0?Number(pickerControls.budget.value):null,
    });
    const restorePickerState=()=>{
      const preferences=readPickerState();
      pickerFields.forEach(field=>{pickerControls[field].value=preferences[field]});
      pickerControls.budget.value=preferences.budget??"";
    };
    const synchronizePickerUrl=()=>{
      const parameters=new URLSearchParams(location.search);
      const preferences=currentPickerPreferences();
      pickerFields.forEach(field=>{
        parameters.set(pickerParameters[field],preferences[field]||"any");
      });
      parameters.delete(pickerParameters.budget);
      if(preferences.budget!==null){
        parameters.set(pickerParameters.budget,String(preferences.budget));
      }
      const search=parameters.toString();
      history.replaceState(history.state,"",location.pathname+(search?"?"+search:"")+location.hash);
    };
    const pickerFactText=(item,closest)=>{
      const facts=item.differences.length===0?
        ["Все выбранные параметры совпали."]:
        item.differences.map(difference=>
          pickerFieldLabels[difference.field]+": "+difference.actual+" вместо "+difference.target
        );
      if(item.savingComparedToClosest>0){
        facts.push(primaryCurrency.format(item.savingComparedToClosest)+" дешевле самого точного варианта.");
      }
      if(item.kind==="headroom"&&item.product.chip!==closest.product.chip){
        facts.push("Чип "+item.product.chip+" вместо "+closest.product.chip+".");
      }
      if(item.overBudgetBy>0){
        facts.push(primaryCurrency.format(item.overBudgetBy)+" сверх указанного бюджета.");
      }
      return facts;
    };
    const recommendationCard=(item,index,closest)=>{
      const product=selectedVariant(item.product.configurationKey,item.product);
      const displayItem={...item,product};
      const matchLabel=item.preferenceCount>0?
        item.matchCount+" из "+item.preferenceCount+" совпало":"Подбор по цене";
      const headline="MacBook "+product.family+" "+product.screen+" · "+product.chip+" · "+product.memory+" / "+product.storage;
      const facts=pickerFactText(displayItem,closest).map(fact=>"<li>"+escapeHtml(fact)+"</li>").join("");
      return '<article class="pick-card'+(index===0?" featured":"")+'" data-product-code="'+escapeHtml(product.productCode)+'">'+
        '<span class="pick-label">'+escapeHtml(item.label)+'</span>'+
        '<span class="pick-match">'+escapeHtml(matchLabel)+'</span>'+
        '<div class="pick-chip">'+escapeHtml(product.chip)+'</div>'+
        '<h3>'+escapeHtml(headline)+'</h3>'+
        '<ul class="pick-facts">'+facts+'</ul>'+
        '<div class="pick-price" data-role="pick-price">'+pickerPrice(product)+'</div>'+
        '<div class="pick-actions">'+colourPickerMarkup(product,"card")+
        '<a class="pick-link" href="'+escapeHtml(product.sourceUrl)+'" target="_blank" rel="noreferrer">Открыть у Apple ↗</a></div>'+
        '</article>';
    };
    const renderRecommendationCards=()=>{
      if(!currentRecommendations)return;
      const closestItem=currentRecommendations.items[0];
      const closest={
        ...closestItem,
        product:selectedVariant(closestItem.product.configurationKey,closestItem.product),
      };
      document.querySelector("#personal-picks").innerHTML=currentRecommendations.items
        .map((item,index)=>recommendationCard(item,index,closest)).join("");
    };
    const updatePickerSummary=preferences=>{
      const parts=[];
      if(preferences.family)parts.push("MacBook "+preferences.family);
      if(preferences.screen)parts.push(pickerScreenLabels[preferences.screen]||preferences.screen);
      if(preferences.memory)parts.push(preferences.memory+" RAM");
      if(preferences.storage)parts.push(preferences.storage+" SSD");
      if(preferences.budget)parts.push("до "+primaryCurrency.format(preferences.budget));
      document.querySelector("#picker-summary").textContent=
        "Сейчас ищем: "+(parts.length?parts.join(" · "):"любую конфигурацию по минимальной цене")+". Выбор сохранён в ссылке.";
    };
    const updatePersonalizedRecommendations=()=>{
      const preferences=currentPickerPreferences();
      const recommendationProducts=hasDynamicTaxLocations?
        products.map(product=>({
          ...product,
          [recommendationOptions.priceField]:taxPricingFor(product,refurbishedPriceField).amount,
        })):products;
      currentRecommendations=recommendConfigurations(recommendationProducts,preferences,recommendationOptions);
      recommendedConfigurationKeys=currentRecommendations.items.map(item=>item.product.configurationKey);
      renderRecommendationCards();
      updatePickerSummary(preferences);
      render();
    };
    const resetPicker=()=>{
      pickerFields.forEach(field=>{pickerControls[field].value=defaultPickerPreferences[field]});
      pickerControls.budget.value="";
      updatePersonalizedRecommendations();
      synchronizePickerUrl();
    };
    const selected=name=>new Set([...document.querySelectorAll(\`input[name="\${name}"]:checked\`)].map(input=>input.value));
    const updateFilterLabels=()=>document.querySelectorAll(".filter-dropdown").forEach(dropdown=>{
      const checked=[...dropdown.querySelectorAll("input:checked")];
      const value=dropdown.querySelector(".filter-value");
      value.textContent=checked.length===0?"Все":checked.length===1?checked[0].nextElementSibling.textContent:checked.length+" выбрано";
    });
    const currentViewState=()=>({
      filters:Object.fromEntries(filterNames.map(name=>[name,[...selected(name)]])),
      sorting:sorting.value,
    });
    const restoreCatalogViewState=()=>{
      const state=readCatalogViewState(location.search,viewStateOptions);
      filterNames.forEach(name=>document.querySelectorAll(\`input[name="\${name}"]\`).forEach(input=>{
        input.checked=state.filters[name].includes(input.value);
      }));
      sorting.value=state.sorting;
    };
    const synchronizeCatalogViewUrl=()=>{
      ${clientViewSearchSource}
      history.replaceState(history.state,"",location.pathname+search+location.hash);
    };
    const reset=()=>{
      document.querySelectorAll(".filter-dropdown input").forEach(input=>input.checked=false);
      sorting.value=viewStateOptions.defaultSorting;
      updateFilterLabels();
      render();
      synchronizeCatalogViewUrl();
    };
    const render=()=>{
      const selections=Object.fromEntries(filterNames.map(name=>[name,selected(name)]));
      let result=configurationGroups.filter(group=>{
        const p=group[0];
        return filterNames.every(name=>selections[name].size===0||selections[name].has(p[name]));
      });
      result.sort((leftGroup,rightGroup)=>{
        const a=selectedVariant(leftGroup[0].configurationKey,leftGroup[0]);
        const b=selectedVariant(rightGroup[0].configurationKey,rightGroup[0]);
        return sorting.value==="price-asc"?comparableRefurbishedPrice(a)-comparableRefurbishedPrice(b):
          sorting.value==="price-desc"?comparableRefurbishedPrice(b)-comparableRefurbishedPrice(a):
          sorting.value==="memory"?memoryNumber(b.memory)-memoryNumber(a.memory)||storageNumber(b.storage)-storageNumber(a.storage)||comparableRefurbishedPrice(a)-comparableRefurbishedPrice(b):
          sorting.value==="newest"?chipNumber(b.chip)-chipNumber(a.chip)||chipTier(b.chip)-chipTier(a.chip)||comparableRefurbishedPrice(a)-comparableRefurbishedPrice(b):
          score(b)-score(a)||a[refurbishedPriceField]-b[refurbishedPriceField];
      });
      const visibleVariantCount=result.reduce((sum,group)=>sum+group.length,0);
      document.querySelector("#count").textContent=
        result.length+" из "+configurationGroups.length+" конфигураций · "+
        visibleVariantCount+" цветовых вариантов";
      document.querySelector("#empty").hidden=result.length!==0;
      document.querySelector("#rows").innerHTML=result.map(group=>{
        const p=selectedVariant(group[0].configurationKey,group[0]);
        const refurbishedComparisonPrice=comparableRefurbishedPrice(p);
        const newComparisonPrice=comparableNewPrice(p);
        const difference=newComparisonPrice?newComparisonPrice-refurbishedComparisonPrice:null;
        const discount=difference===null?'<span class="na">нет цены</span>':difference>=0?
          \`<span class="saving">−\${comparisonPrice(difference)} · \${Math.round(difference/newComparisonPrice*100)}%</span>\`:
          \`<span class="overpay">+\${comparisonPrice(-difference)} · \${Math.round(-difference/newComparisonPrice*100)}%</span>\`;
        const rowClass=recommendedConfigurationKeys.includes(p.configurationKey)?"recommended":"";
        const chipClass=p.chip.startsWith("M5")?"chip-m5":"";
        return \`<tr class="\${rowClass}" data-configuration-key="\${escapeHtml(p.configurationKey)}">
          <td><div class="model"><span class="model-mark">\${p.family==="Air"?"A":"P"}</span><div>${clientModelMetadataSource}</div></div></td>
          <td><strong>\${escapeHtml(p.screen)}</strong></td>
          <td><span class="chip-name \${chipClass}">\${escapeHtml(p.chip)}</span></td>
          <td><strong>\${escapeHtml(p.memory)}</strong></td>
          <td><strong>\${escapeHtml(p.storage)}</strong></td>
          <td>\${escapeHtml(p.cpuCores)} / \${escapeHtml(p.gpuCores)} ядер</td>
          <td>\${colourPickerMarkup(p,"table")}</td>
          <td>\${refurbishedPrice(p)}</td>
          <td>\${exactNewPrice(p)}</td>
          <td>\${discount}</td>
        </tr>\`;
      }).join("");
    };
    document.querySelectorAll(".filter-dropdown input").forEach(input=>input.addEventListener("change",()=>{updateFilterLabels();render();synchronizeCatalogViewUrl()}));
    document.querySelectorAll(".filter-dropdown").forEach(dropdown=>dropdown.addEventListener("toggle",()=>{
      if(dropdown.open)document.querySelectorAll(".filter-dropdown[open]").forEach(other=>{if(other!==dropdown)other.removeAttribute("open")});
    }));
    document.addEventListener("click",event=>document.querySelectorAll(".filter-dropdown[open]").forEach(dropdown=>{if(!dropdown.contains(event.target))dropdown.removeAttribute("open")}));
    document.addEventListener("click",event=>{
      const colourButton=event.target.closest?.(".colour-swatch");
      if(!colourButton)return;
      selectedCodesByConfiguration.set(
        colourButton.dataset.configurationKey,
        colourButton.dataset.colourCode,
      );
      renderRecommendationCards();
      render();
    });
    sorting.addEventListener("change",()=>{render();synchronizeCatalogViewUrl()});
    document.querySelector("#reset").addEventListener("click",reset);
    document.querySelector("#empty-reset").addEventListener("click",reset);
${clientTaxLocationEventsSource ? `    ${clientTaxLocationEventsSource}\n` : ""}
    pickerFields.forEach(field=>pickerControls[field].addEventListener("change",()=>{
      updatePersonalizedRecommendations();
      synchronizePickerUrl();
    }));
    pickerControls.budget.addEventListener("input",()=>{
      updatePersonalizedRecommendations();
      synchronizePickerUrl();
    });
    document.querySelector("#preference-picker").addEventListener("submit",event=>{
      event.preventDefault();
      updatePersonalizedRecommendations();
      synchronizePickerUrl();
    });
    document.querySelector("#picker-reset").addEventListener("click",resetPicker);
    restoreCatalogViewState();
    restorePickerState();
    updateFilterLabels();
    updatePersonalizedRecommendations();
    synchronizePickerUrl();
    synchronizeCatalogViewUrl();
  </script>
</body>
</html>`;

await mkdir(dirname(paths.artifact), { recursive: true });
const outputPath = paths.artifact;
const temporaryOutputPath = `${outputPath}.tmp`;
await writeFile(temporaryOutputPath, html);
await rename(temporaryOutputPath, outputPath);
console.log(`Wrote ${html.length} bytes`);
