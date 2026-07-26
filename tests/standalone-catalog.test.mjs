import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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

const shortlist = html.match(
  /<section class="section-shell" id="shortlist">([\s\S]*?)<section class="section-shell" id="comparison">/,
)?.[1];
const changelogSection = html.match(
  /<section class="section-shell" id="changelog">([\s\S]*?)<\/main>/,
)?.[1];

test("embeds the complete catalog and exactly three ranked cards", () => {
  assert.ok(catalog.products.length > 0);
  assert.equal(featured.items.length, 3);
  const embeddedCatalog = JSON.stringify(catalog.products).replaceAll(
    "<",
    "\\u003c",
  );
  assert.match(html, new RegExp(`const products=${escapeRegex(embeddedCatalog)}`));
  assert.equal((shortlist?.match(/<article class="pick-card/g) ?? []).length, 3);
  for (const item of featured.items) {
    assert.match(html, new RegExp(escapeRegex(item.productCode)));
  }
  assert.doesNotMatch(shortlist, /\/ 100/);
  assert.equal((shortlist?.match(/· рейтинг /g) ?? []).length, 3);
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
  assert.ok((html.match(/type="checkbox"/g) ?? []).length >= 5);
  assert.equal((html.match(/<select id="sorting">/g) ?? []).length, 1);
  assert.doesNotMatch(
    html,
    /<select id="(?:family|screen|chip|memory|storage)"/,
  );
});

test("retains exact Apple new-price links and the permanent canonical URL", () => {
  const pricedProducts = catalog.products.filter(
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
    assert.match(
      product.newSourceUrl,
      product.display === "Nano-texture"
        ? /nano-texture-display/
        : /standard-display/,
    );
  }
});

test("renders every enabled market as an independent canonical-site link", () => {
  assert.equal(
    (html.match(/<nav class="market-switcher"/g) ?? []).length,
    1,
  );
  for (const marketProfile of enabledMarketProfiles) {
    assert.match(
      html,
      new RegExp(
        `href="${escapeRegex(
          marketProfile.publication.canonicalUrl,
        )}"[^>]*aria-label="${escapeRegex(marketProfile.siteName)}"`,
      ),
    );
  }
  assert.equal(
    (html.match(/class="market-option active"/g) ?? []).length,
    1,
  );
});

test("contains syntactically valid inline JavaScript", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) {
    assert.doesNotThrow(() => new Function(source));
  }
});

test("renders a USD-only changelog and latest-run result at the page bottom", () => {
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
  assert.match(html, /priceFormula\(p\.taxInclusivePricing\)/);
  assert.match(html, /priceFormula\(p\.newTaxInclusivePricing\)/);
  assert.match(html, /Refurb total · расчёт/);
  assert.match(html, /Новый total · расчёт/);
  assert.doesNotMatch(html, /Итого Apple/);
});

test("keeps Singapore on its existing list-price display contract", () => {
  if (profile.id !== "sg") return;
  assert.equal(profile.tax.model, "included-in-list-price");
  assert.equal(profile.currency.priceFields.taxInclusive, null);
  assert.equal(profile.currency.priceFields.newTaxInclusive, null);
  assert.doesNotMatch(html, /Refurb total · расчёт|Новый total · расчёт/);
  assert.doesNotMatch(html, /priceFormula\(p\.(?:tax|newTax)InclusivePricing\)/);
  assert.match(shortlist, /refurb · налог включён/);
  assert.doesNotMatch(shortlist, /refurb до налога/);
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
