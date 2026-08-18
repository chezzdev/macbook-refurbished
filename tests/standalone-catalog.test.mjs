import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasExactNewProductSource } from "../scripts/apple-catalog-lib.mjs";
import {
  loadEnabledMarketProfiles,
  loadMarketContext,
} from "../scripts/market-profile.mjs";

const { profile, paths } = await loadMarketContext(
  process.env.MACBOOK_MARKET_ID ?? "sg",
);
const { profiles: enabledMarketProfiles } =
  await loadEnabledMarketProfiles();
const [html, catalog, featured, changelog] = await Promise.all([
  readFile(paths.artifact, "utf8"),
  readFile(paths.catalog, "utf8").then(JSON.parse),
  readFile(paths.featured, "utf8").then(JSON.parse),
  readFile(paths.changelog, "utf8").then(JSON.parse),
]);
const newPriceField = profile.currency.priceFields.new;
const newTaxInclusivePriceField =
  profile.currency.priceFields.newTaxInclusive;
const renderedProducts = catalog.products.map((product) => {
  if (
    Number.isFinite(product[newPriceField]) &&
    product.newSourceUrl &&
    hasExactNewProductSource(product, profile)
  ) {
    return product;
  }
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

const shortlist = html.match(
  /<section class="section-shell" id="shortlist">([\s\S]*?)<section class="section-shell" id="comparison">/,
)?.[1];
const changelogSection = html.match(
  /<section class="section-shell" id="changelog">([\s\S]*?)<\/main>/,
)?.[1];

test("embeds the complete catalog and exactly three personalized cards", () => {
  assert.ok(catalog.products.length > 0);
  assert.equal(featured.items.length, 3);
  const embeddedCatalog = JSON.stringify(renderedProducts).replaceAll(
    "<",
    "\\u003c",
  );
  assert.match(html, new RegExp(`const products=${escapeRegex(embeddedCatalog)}`));
  assert.equal((shortlist?.match(/<article class="pick-card/g) ?? []).length, 3);
  assert.doesNotMatch(shortlist, /\/ 100/);
  assert.doesNotMatch(shortlist, /· рейтинг /);
  assert.equal((shortlist?.match(/class="pick-match"/g) ?? []).length, 3);
  assert.equal(
    (shortlist?.match(/data-product-code="/g) ?? []).length,
    3,
  );
});

test("renders a client-side ideal configuration picker", () => {
  assert.match(shortlist, /id="preference-picker"/);
  for (const field of ["family", "screen", "memory", "storage", "budget"]) {
    assert.match(shortlist, new RegExp(`id="target-${field}"`));
  }
  assert.equal(
    (shortlist?.match(/class="control-label"/g) ?? []).length,
    5,
  );
  assert.match(
    html,
    /\.picker-field select,.picker-budget input,.picker-reset\{font-family:inherit;font-size:16px/,
  );
  assert.match(html, /\.picker-budget:focus-within/);
  assert.match(html, /const recommendConfigurations=function recommendConfigurations/);
  assert.match(html, /const readPickerState=\(\)=>\{/);
  assert.match(html, /const synchronizePickerUrl=\(\)=>\{/);
  assert.match(html, /ideal-family/);
  assert.match(html, /ideal-screen/);
  assert.match(html, /ideal-memory/);
  assert.match(html, /ideal-storage/);
  assert.match(html, /max-price/);
  assert.match(
    html,
    /parameters\.set\(pickerParameters\[field\],preferences\[field\]\|\|"any"\)/,
  );
  assert.doesNotMatch(
    html,
    /preferences\[field\]!==defaultPickerPreferences\[field\]/,
  );
  assert.match(html, /updatePersonalizedRecommendations\(\)/);
  assert.match(shortlist, /Без магического рейтинга/);
  const screenPicker = shortlist?.match(
    /<select id="target-screen"[^>]*>([\s\S]*?)<\/select>/,
  )?.[1];
  assert.equal((screenPicker?.match(/<option /g) ?? []).length, 3);
  assert.match(screenPicker, /value="" selected>Не важно/);
  assert.match(screenPicker, /value="13-14">13–14″/);
  assert.match(screenPicker, /value="15-16">15–16″/);
  assert.doesNotMatch(screenPicker, /поменьше|побольше/);
  for (const [field, value] of [
    ["family", profile.ranking.reference.family],
    ["memory", profile.ranking.reference.memory],
    ["storage", profile.ranking.reference.storage],
  ]) {
    const options = shortlist?.match(
      new RegExp(`<select id="target-${field}"[^>]*>([\\s\\S]*?)<\\/select>`),
    )?.[1];
    assert.match(
      options,
      new RegExp(`value="${escapeRegex(value)}"(?: selected)?>`),
    );
  }
});

test("aggregates colour variants with one shared picker state", () => {
  assert.match(shortlist, /class="colour-picker pick-colours"/);
  assert.match(shortlist, /class="colour-swatch [^"]+"/);
  assert.match(shortlist, /aria-pressed="true"/);
  assert.match(html, /const variantsByConfiguration=new Map\(\)/);
  assert.match(
    html,
    /const selectedCodesByConfiguration=new Map\(configurationGroups\.map/,
  );
  assert.match(html, /colourPickerMarkup\(p,"table"\)/);
  assert.match(
    html,
    /result\.length\+" из "\+configurationGroups\.length\+" конфигураций · "/,
  );
  assert.match(html, /visibleVariantCount\+" цветовых вариантов"/);
  assert.doesNotMatch(shortlist, />Цвет</);
  assert.doesNotMatch(shortlist, /✓|✔/);

  const firstByConfiguration = new Map();
  for (const product of renderedProducts) {
    if (!firstByConfiguration.has(product.configurationKey)) {
      firstByConfiguration.set(product.configurationKey, product);
    }
  }
  const initialCardCodes = [
    ...(shortlist?.matchAll(
      /<article class="pick-card[^"]*" data-product-code="([^"]+)"/g,
    ) ?? []),
  ].map((match) => match[1]);
  for (const productCode of initialCardCodes) {
    const product = renderedProducts.find(
      (candidate) => candidate.productCode === productCode,
    );
    assert.equal(
      productCode,
      firstByConfiguration.get(product.configurationKey).productCode,
    );
  }
});

test("keeps secondary source currency inside the table only", () => {
  assert.ok(shortlist);
  if (profile.currency.source !== profile.currency.display) {
    assert.doesNotMatch(
      shortlist,
      new RegExp(
        `${escapeRegex(profile.currency.secondarySymbol)}|\\b${profile.currency.source}\\b`,
      ),
    );
    assert.match(html, /class="source-secondary"/);
    assert.match(
      html,
      new RegExp(escapeRegex(profile.currency.secondarySymbol)),
    );
  } else {
    assert.doesNotMatch(html, /class="source-secondary"/);
  }
});

test("renders checkbox dropdown filters and one sorting select", () => {
  assert.equal((html.match(/<details class="filter-dropdown"/g) ?? []).length, 5);
  assert.equal((html.match(/<div class="filter-field">/g) ?? []).length, 5);
  assert.equal((html.match(/class="control-label"/g) ?? []).length, 11);
  assert.doesNotMatch(html, /class="filter-title"/);
  assert.ok((html.match(/type="checkbox"/g) ?? []).length >= 5);
  assert.equal((html.match(/<select id="sorting">/g) ?? []).length, 1);
  assert.match(html, /\.filter-field,.sort-control\{display:grid;gap:5px;min-width:0\}/);
  assert.match(html, /\.sort-control select\{width:100%;min-width:0;min-height:48px\}/);
  assert.doesNotMatch(
    html,
    /<select id="(?:family|screen|chip|memory|storage)"/,
  );
});

test("embeds shared URL view-state restoration and synchronization", () => {
  assert.match(html, /const readCatalogViewState=function readCatalogViewState/);
  assert.match(html, /const writeCatalogViewSearch=function writeCatalogViewSearch/);
  assert.match(
    html,
    /allowedFilterValues:Object\.fromEntries\(filterNames\.map\(name=>\[/,
  );
  assert.match(html, /const restoreCatalogViewState=\(\)=>\{/);
  assert.match(html, /readCatalogViewState\(location\.search,viewStateOptions\)/);
  assert.match(html, /const synchronizeCatalogViewUrl=\(\)=>\{/);
  assert.match(
    html,
    /history\.replaceState\(history\.state,"",location\.pathname\+search\+location\.hash\)/,
  );
  assert.match(html, /restoreCatalogViewState\(\);/);
  assert.match(html, /synchronizeCatalogViewUrl\(\);/);
  assert.match(html, /sorting\.addEventListener\("change",\(\)=>\{render\(\);synchronizeCatalogViewUrl\(\)\}\)/);
});

test("retains exact Apple new-price links and the permanent canonical URL", () => {
  const pricedProducts = renderedProducts.filter(
    (product) => product[newPriceField] !== null && product.newSourceUrl,
  );
  assert.ok(pricedProducts.length > 0);
  for (const product of pricedProducts) {
    assert.match(html, new RegExp(escapeRegex(product.newSourceUrl)));
  }
  assert.match(
    html,
    new RegExp(
      escapeRegex(
        `<link rel="canonical" href="${profile.publication.canonicalUrl}">`,
      ),
    ),
  );
  for (const product of pricedProducts.filter(
    (item) => item.family === "Pro",
  )) {
    const localizedDisplayPath =
      profile.storefront.newProductUrlStyle === "spanish"
        ? product.display === "Nano-texture"
          ? /pantalla-con-vidrio-nanotexturizado/
          : /pantalla-est%C3%A1ndar/
        : product.display === "Nano-texture"
          ? /nano-texture-display/
          : /standard-display/;
    assert.match(
      product.newSourceUrl,
      localizedDisplayPath,
    );
  }
});

test("renders every enabled market as a portable sibling route", () => {
  assert.equal(
    (html.match(/<nav class="market-switcher"/g) ?? []).length,
    1,
  );
  for (const marketProfile of enabledMarketProfiles) {
    assert.match(
      html,
      new RegExp(
        `href="${escapeRegex(
          `../${marketProfile.id}/`,
        )}"[^>]*aria-label="${escapeRegex(marketProfile.siteName)}"`,
      ),
    );
  }
  assert.equal(
    (html.match(/class="market-option active"/g) ?? []).length,
    1,
  );
  const renderedMarketIds = [
    ...html.matchAll(
      /class="market-option(?: active)?" href="\.\.\/([^/]+)\//g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(
    renderedMarketIds,
    enabledMarketProfiles.map((marketProfile) => marketProfile.id),
  );
  assert.deepEqual(renderedMarketIds, [...renderedMarketIds].sort());
});

test("contains syntactically valid inline JavaScript", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) {
    assert.doesNotThrow(() => new Function(source));
  }
});

test("renders a primary-currency changelog and latest-run result at the page bottom", () => {
  assert.ok(changelogSection);
  assert.match(changelogSection, /Что изменилось/);
  assert.match(changelogSection, /Старт отслеживания|изменений/);
  if (profile.currency.source !== profile.currency.display) {
    assert.doesNotMatch(
      changelogSection,
      new RegExp(
        `${escapeRegex(profile.currency.secondarySymbol)}|\\b${profile.currency.source}\\b`,
      ),
    );
  }
  const latestDate = changelog.latestRun.checkedAt
    .slice(0, 10)
    .split("-")
    .reverse()
    .join(".");
  assert.match(changelogSection, new RegExp(escapeRegex(latestDate)));
});

test("renders explicit fixed-location tax estimates for the US market", () => {
  if (profile.id !== "us") return;
  assert.equal(profile.tax.model, "verified-fixed-location-estimate");
  assert.ok(
    catalog.products.every(
      (product) =>
        product.taxInclusivePricing?.status === "estimated" &&
        Number.isFinite(product.taxInclusivePriceUsd) &&
        product.taxInclusivePriceUsd > product.priceUsd,
    ),
  );
  const exactNewProducts = catalog.products.filter(
    (product) => product[newPriceField] !== null,
  );
  const unavailableNewProducts = catalog.products.filter(
    (product) => product[newPriceField] === null,
  );
  assert.ok(exactNewProducts.length > 0);
  assert.ok(
    exactNewProducts.every(
      (product) =>
        product.newTaxInclusivePricing?.status === "estimated" &&
        Number.isFinite(product[newTaxInclusivePriceField]) &&
        product[newTaxInclusivePriceField] > product[newPriceField],
    ),
  );
  assert.ok(
    unavailableNewProducts.every(
      (product) =>
        product.newTaxInclusivePricing === null &&
        product[newTaxInclusivePriceField] === null,
    ),
  );
  assert.match(html, /Расчётный total/);
  assert.match(html, /taxPricingFor\(p,refurbishedPriceField\)/);
  assert.match(html, /taxPricingFor\(p,newPriceField\)/);
  assert.match(
    html,
    /<header class="topbar">[\s\S]*class="header-tax-switcher"[\s\S]*data-tax-location=/,
  );
  assert.match(html, /<table class="stable-tax-columns">/);
  assert.match(
    html,
    /\.stable-tax-columns th:nth-child\(8\)[\s\S]*min-width:185px/,
  );
  const tableMinimumWidth = Number(
    html.match(/\.stable-tax-columns\{min-width:(\d+)px;table-layout:fixed}/)?.[1],
  );
  assert.ok(
    tableMinimumWidth <= 1255,
    `US comparison table ${tableMinimumWidth}px exceeds its 1366px viewport budget`,
  );
  assert.match(html, /\.tax-location-card\{min-height:165px/);
  assert.match(
    html,
    /\.market-option,\.tax-location-switcher button\{[^}]*min-width:34px;height:30px[^}]*font:800 11px/,
  );
  assert.match(
    html,
    /\.tax-location-switcher button\{width:34px;padding:0;border-right:0/,
  );
  assert.match(
    html,
    /const refurbishedPrice=p=>\{[\s\S]*href="'\+escapeHtml\(p\.sourceUrl\)\+'"/,
  );
  assert.doesNotMatch(html, /<th>Apple<\/th>/);
  assert.match(
    html,
    /p\.display==="Nano-texture"\?'<small class="model-display">Nano-texture<\/small>'/,
  );
  assert.match(html, /const writeOwnedChoiceSearch=function writeOwnedChoiceSearch/);
  assert.match(html, /search=writeOwnedChoiceSearch\(search,\{/);
  assert.doesNotMatch(
    html,
    /activeTaxLocation\.kind==="delivery-zip"\?[\s\S]*South Dakota/,
  );
  assert.doesNotMatch(
    html,
    /class="tax-location-card"[\s\S]*class="tax-location-switcher"/,
  );
  assert.equal((html.match(/data-tax-location="/g) ?? []).length, 4);
  assert.match(html, /data-tax-location="apple-beverly-center"/);
  assert.match(html, /data-tax-location="apple-cherry-creek"/);
  assert.match(html, /data-tax-location="apple-boylston-street"/);
  assert.match(html, /data-tax-location="sioux-falls-delivery-57105"/);
  assert.match(html, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(html, /history\.replaceState/);
  assert.match(
    html,
    /const recommendationProducts=hasDynamicTaxLocations\?[\s\S]*\[recommendationOptions\.priceField\]:taxPricingFor\(product,refurbishedPriceField\)\.amount/,
  );
  assert.match(
    html,
    /activeTaxLocation=nextLocation;[\s\S]*renderTaxLocationUi\(\);[\s\S]*updatePersonalizedRecommendations\(\);/,
  );
  assert.match(html, /Refurb total · расчёт/);
  assert.match(html, /Новый total · расчёт/);
  assert.doesNotMatch(html, /Итого Apple/);
});

test("keeps tax-included markets on the list-price display contract", () => {
  if (profile.tax.model !== "included-in-list-price") return;
  assert.equal(profile.tax.model, "included-in-list-price");
  assert.equal(profile.currency.priceFields.taxInclusive, null);
  assert.equal(profile.currency.priceFields.newTaxInclusive, null);
  assert.doesNotMatch(html, /Refurb total · расчёт|Новый total · расчёт/);
  assert.doesNotMatch(html, /priceFormula\(p\.(?:tax|newTax)InclusivePricing\)/);
  assert.doesNotMatch(html, /data-tax-location="/);
  assert.doesNotMatch(html, /header-tax-switcher/);
  assert.doesNotMatch(html, /stable-tax-columns/);
  assert.match(html, /<th>Apple<\/th>/);
  assert.match(html, /class="open" href="/);
  assert.match(shortlist, /refurb · налог включён/);
  assert.doesNotMatch(shortlist, /refurb до налога/);
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
