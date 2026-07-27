import assert from "node:assert/strict";
import test from "node:test";

import { recommendConfigurations } from "../scripts/configuration-picker.mjs";

const preferences = {
  family: "Air",
  screen: "13-14",
  memory: "24GB",
  storage: "1TB",
};

function product(overrides = {}) {
  return {
    configurationKey: "air|13|standard|m4|10|10|24gb|1tb",
    productCode: "EXACT-B",
    family: "Air",
    screen: "13″",
    display: "Standard",
    chip: "M4",
    cpuCores: 10,
    gpuCores: 10,
    memory: "24GB",
    storage: "1TB",
    priceUsd: 1600,
    ...overrides,
  };
}

function catalog() {
  return [
    product(),
    product({ productCode: "EXACT-A" }),
    product({
      configurationKey: "air|13|standard|m5|10|10|24gb|512gb",
      productCode: "SAVE",
      chip: "M5",
      storage: "512GB",
      priceUsd: 1400,
    }),
    product({
      configurationKey: "air|13|standard|m5|10|10|24gb|2tb",
      productCode: "HEADROOM",
      chip: "M5",
      storage: "2TB",
      priceUsd: 1900,
    }),
    product({
      configurationKey: "pro|16|standard|m5-max|16|40|64gb|4tb",
      productCode: "OVERKILL",
      family: "Pro",
      screen: "16″",
      chip: "M5 Max",
      cpuCores: 16,
      gpuCores: 40,
      memory: "64GB",
      storage: "4TB",
      priceUsd: 3900,
    }),
  ];
}

test("returns three distinct strategies relative to the selected ideal", () => {
  const result = recommendConfigurations(catalog(), preferences, {
    priceField: "priceUsd",
  });

  assert.deepEqual(
    result.items.map((item) => [
      item.kind,
      item.product.productCode,
    ]),
    [
      ["closest", "EXACT-A"],
      ["saving", "SAVE"],
      ["headroom", "HEADROOM"],
    ],
  );
  assert.equal(result.items[0].matchCount, 4);
  assert.deepEqual(result.items[0].differences, []);
  assert.deepEqual(result.items[1].differences, [
    {
      field: "storage",
      target: "1TB",
      actual: "512GB",
      direction: "under",
    },
  ]);
  assert.equal(result.items[1].savingComparedToClosest, 200);
});

test("treats 13–14 and 15–16 inches as two size preferences", async (context) => {
  const groups = [
    ["13-14", ["13″", "14″"]],
    ["15-16", ["15″", "16″"]],
  ];

  for (const [screenPreference, actualScreens] of groups) {
    await context.test(screenPreference, () => {
      for (const actualScreen of actualScreens) {
        const result = recommendConfigurations(
          [
            product({
              configurationKey: `screen-${actualScreen}`,
              productCode: `SCREEN-${actualScreen}`,
              screen: actualScreen,
            }),
          ],
          {
            family: "",
            screen: screenPreference,
            memory: "24GB",
            storage: "1TB",
          },
          { priceField: "priceUsd" },
        );
        assert.equal(result.items[0].matchCount, 3);
        assert.doesNotMatch(
          JSON.stringify(result.items[0].differences),
          /"field":"screen"/,
        );
      }
    });
  }
});

test("collapses colour duplicates by price and then product code", () => {
  const products = catalog();
  products.push(
    product({
      productCode: "EXACT-CHEAPEST",
      priceUsd: 1550,
    }),
  );
  const result = recommendConfigurations(products, preferences, {
    priceField: "priceUsd",
  });
  assert.equal(result.items[0].product.productCode, "EXACT-CHEAPEST");
});

test("treats a maximum budget as a hard preference when options fit it", () => {
  const result = recommendConfigurations(
    catalog(),
    { ...preferences, budget: 1450 },
    { priceField: "priceUsd" },
  );
  assert.equal(result.items[0].product.productCode, "SAVE");
  assert.equal(result.items[0].overBudgetBy, 0);
});

test("does not promise headroom when the budget leaves no genuine upgrade", () => {
  const result = recommendConfigurations(
    catalog(),
    { ...preferences, budget: 1450 },
    { priceField: "priceUsd" },
  );
  assert.equal(result.items[2].kind, "alternative");
  assert.equal(result.items[2].label, "Ещё один вариант");
});

test("penalizes undershooting memory more than a modest overshoot", () => {
  const products = [
    product({
      configurationKey: "air-under",
      productCode: "UNDER",
      memory: "16GB",
      priceUsd: 1500,
    }),
    product({
      configurationKey: "air-over",
      productCode: "OVER",
      memory: "32GB",
      priceUsd: 1500,
    }),
    product({
      configurationKey: "air-other",
      productCode: "OTHER",
      memory: "36GB",
      priceUsd: 1700,
    }),
  ];
  const result = recommendConfigurations(products, preferences, {
    priceField: "priceUsd",
  });
  assert.equal(result.items[0].product.productCode, "OVER");
});

test("is deterministic across input order", () => {
  const forward = recommendConfigurations(catalog(), preferences, {
    priceField: "priceUsd",
  });
  const reverse = recommendConfigurations(
    catalog().reverse(),
    preferences,
    { priceField: "priceUsd" },
  );
  assert.deepEqual(reverse, forward);
});

test("returns every available configuration when a small market has fewer than three", () => {
  const products = catalog();
  const result = recommendConfigurations(
    [products[0], products[2]],
    preferences,
    { priceField: "priceUsd" },
  );
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].product.productCode, "EXACT-B");
});
