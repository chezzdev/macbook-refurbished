import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCatalogDelta,
  buildChangelog,
} from "../scripts/update-changelog.mjs";

const checkedAt = "2026-07-27T05:00:00.000Z";

function product(productCode, overrides = {}) {
  return {
    productCode,
    family: "Air",
    screen: "13″",
    display: "Standard",
    chip: "M5",
    cpuCores: 10,
    gpuCores: 10,
    memory: "24GB",
    storage: "512GB",
    priceSgd: 1999,
    newPriceSgd: 2199,
    configurationKey: `air|13|standard|m5|10|10|24gb|512gb|${productCode}`,
    ...overrides,
  };
}

function catalog(products) {
  return { schemaVersion: 1, products };
}

function featured(codes) {
  return {
    schemaVersion: 1,
    items: codes.map((productCode, index) => ({
      rank: index + 1,
      productCode,
    })),
  };
}

test("finds availability, price, new-price, and featured changes deterministically", () => {
  const delta = buildCatalogDelta({
    previousCatalog: catalog([
      product("REMOVED"),
      product("PRICE", { priceSgd: 1900 }),
      product("NEWPRICE", { newPriceSgd: null }),
    ]),
    currentCatalog: catalog([
      product("NEWPRICE"),
      product("PRICE"),
      product("ADDED"),
    ]),
    previousFeatured: featured(["PRICE", "REMOVED", "NEWPRICE"]),
    currentFeatured: featured(["PRICE", "ADDED", "NEWPRICE"]),
    checkedAt,
  });

  assert.equal(delta.hasChanges, true);
  assert.deepEqual(delta.counts, {
    added: 1,
    removed: 1,
    refurbPriceChanges: 1,
    newPriceChanges: 1,
    featuredChanges: 1,
  });
  assert.equal(delta.added[0].productCode, "ADDED");
  assert.equal(delta.removed[0].productCode, "REMOVED");
  assert.deepEqual(delta.refurbPriceChanges[0], {
    product: delta.refurbPriceChanges[0].product,
    fromSgd: 1900,
    toSgd: 1999,
  });
  assert.deepEqual(delta.newPriceChanges[0], {
    product: delta.newPriceChanges[0].product,
    fromSgd: null,
    toSgd: 2199,
  });
  assert.deepEqual(delta.featured, {
    before: ["PRICE", "REMOVED", "NEWPRICE"],
    after: ["PRICE", "ADDED", "NEWPRICE"],
  });
});

test("creates one baseline and does not grow history on unchanged runs", () => {
  const currentCatalog = catalog([product("A"), product("B")]);
  const noChanges = buildCatalogDelta({
    previousCatalog: currentCatalog,
    currentCatalog,
    previousFeatured: featured(["A", "B"]),
    currentFeatured: featured(["A", "B"]),
    checkedAt,
  });
  assert.equal(noChanges.hasChanges, false);

  const initial = buildChangelog({
    existingChangelog: null,
    delta: noChanges,
    currentCatalog,
  });
  assert.equal(initial.entries.length, 1);
  assert.equal(initial.entries[0].type, "baseline");

  const repeated = buildChangelog({
    existingChangelog: initial,
    delta: { ...noChanges, checkedAt: "2026-07-28T05:00:00.000Z" },
    currentCatalog,
  });
  assert.equal(repeated.entries.length, 1);
  assert.equal(repeated.latestRun.checkedAt, "2026-07-28T05:00:00.000Z");
});
