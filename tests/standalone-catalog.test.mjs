import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const [html, catalog, featured, changelog, site] = await Promise.all([
  readFile(
    new URL("outputs/macbook-air-refurbished-comparison.html", projectRoot),
    "utf8",
  ),
  readFile(new URL("data/catalog.json", projectRoot), "utf8").then(JSON.parse),
  readFile(new URL("data/featured.json", projectRoot), "utf8").then(JSON.parse),
  readFile(new URL("data/changelog.json", projectRoot), "utf8").then(JSON.parse),
  readFile(new URL("data/site.json", projectRoot), "utf8").then(JSON.parse),
]);

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
});

test("keeps SGD secondary inside the table and USD-only everywhere above it", () => {
  assert.ok(shortlist);
  assert.doesNotMatch(shortlist, /S\$|\bSGD\b/);
  assert.match(html, /class="sgd-secondary"/);
  assert.ok(
    html.includes(
      `<span class="sgd-secondary">(S$'+sgd.format(amountSgd)+')</span>`,
    ),
  );
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
    (product) => product.newPriceSgd !== null && product.newSourceUrl,
  );
  assert.ok(pricedProducts.length > 0);
  for (const product of pricedProducts) {
    assert.match(html, new RegExp(escapeRegex(product.newSourceUrl)));
  }
  assert.match(
    html,
    new RegExp(
      escapeRegex(`<link rel="canonical" href="${site.productionUrl}">`),
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
  assert.doesNotMatch(changelogSection, /S\$|\bSGD\b/);
  const latestDate = changelog.latestRun.checkedAt
    .slice(0, 10)
    .split("-")
    .reverse()
    .join(".");
  assert.match(changelogSection, new RegExp(escapeRegex(latestDate)));
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
