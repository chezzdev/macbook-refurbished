import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  rankCatalog,
  renderFeaturedJson,
  runRanking,
} from "../scripts/rank-models.mjs";

const policy = JSON.parse(
  await readFile(
    new URL("../config/ranking-policy.sg.json", import.meta.url),
    "utf8",
  ),
);

function product(overrides = {}) {
  return {
    configurationKey: "air-13-m2-8-10-24-1tb",
    productCode: "IDEAL-A",
    family: "Air",
    screen: "13″",
    display: "Standard",
    chip: "M2",
    cpuCores: 8,
    gpuCores: 10,
    memory: "24GB",
    storage: "1TB",
    priceSgd: 2149,
    newPriceSgd: null,
    ...overrides,
  };
}

function representativeCatalog() {
  return {
    schemaVersion: 1,
    source: {
      url: "https://www.apple.com/sg/shop/refurbished/mac/macbook-air",
    },
    products: [
      product(),
      product({
        configurationKey: "air-13-m5-10-10-24-512gb",
        productCode: "AIR13-M5",
        chip: "M5",
        cpuCores: 10,
        memory: "24GB",
        storage: "512GB",
        priceSgd: 1999,
        newPriceSgd: 2199,
      }),
      product({
        configurationKey: "air-15-m5-10-10-24-1tb",
        productCode: "AIR15-M5",
        screen: "15″",
        chip: "M5",
        cpuCores: 10,
        memory: "24GB",
        storage: "1TB",
        priceSgd: 2509,
        newPriceSgd: 2949,
      }),
      product({
        configurationKey: "pro-14-m5max-16-40-24-1tb",
        productCode: "PRO-MAX",
        family: "Pro",
        screen: "14″",
        chip: "M5 Max",
        cpuCores: 16,
        gpuCores: 40,
        memory: "24GB",
        storage: "1TB",
        priceSgd: 4199,
        newPriceSgd: 4599,
      }),
    ],
  };
}

test("keeps the reasonable exact ideal above newer and more powerful models", () => {
  const featured = rankCatalog(representativeCatalog(), policy);

  assert.deepEqual(
    featured.items.map((item) => item.productCode),
    ["IDEAL-A", "AIR13-M5", "AIR15-M5"],
  );
  assert.ok(
    featured.items[0].reasonCodes.includes("FORM_IDEAL_AIR_13"),
  );
  assert.ok(
    featured.items[0].reasonCodes.includes("MEMORY_IDEAL_24GB"),
  );
  assert.ok(
    featured.items[0].reasonCodes.includes("STORAGE_IDEAL_1TB"),
  );
  assert.equal(
    Object.values(featured.items[0].scoreBreakdown).reduce(
      (sum, component) => sum + component,
      0,
    ),
    featured.items[0].score,
  );
  assert.equal(
    featured.items.some((item) => item.productCode === "PRO-MAX"),
    false,
  );
  for (const item of featured.items) {
    assert.doesNotMatch(
      `${item.label} ${item.headline} ${item.reason}`,
      /S\$|SGD/,
    );
  }
});

test("scores current Singapore 8TB storage configurations", () => {
  const featured = rankCatalog(
    {
      schemaVersion: 1,
      products: [
        product({
          configurationKey: "pro-16-m5max-16-40-48-8tb",
          productCode: "PRO-8TB",
          family: "Pro",
          screen: "16″",
          chip: "M5 Max",
          cpuCores: 16,
          gpuCores: 40,
          memory: "48GB",
          storage: "8TB",
          priceSgd: 4999,
        }),
      ],
    },
    { ...policy, shortlistSize: 1 },
  );

  assert.equal(featured.items[0].scoreBreakdown.storage, 13000);
  assert.ok(featured.items[0].reasonCodes.includes("STORAGE_8TB"));
});

test("collapses colour duplicates and selects by price, then product code", () => {
  const catalog = representativeCatalog();
  catalog.products.push(
    product({
      productCode: "IDEAL-Z",
      priceSgd: 2199,
    }),
    product({
      productCode: "IDEAL-0",
      priceSgd: 2149,
    }),
    product({
      configurationKey: "air-15-m5-10-10-24-1tb",
      productCode: "AIR15-A",
      screen: "15″",
      chip: "M5",
      cpuCores: 10,
      memory: "24GB",
      storage: "1TB",
      priceSgd: 2509,
      newPriceSgd: 2949,
    }),
  );

  const featured = rankCatalog(catalog, policy);
  assert.equal(featured.items[0].productCode, "IDEAL-0");
  assert.equal(
    featured.items.find(
      (item) => item.configurationKey === "air-15-m5-10-10-24-1tb",
    ).productCode,
    "AIR15-A",
  );
});

test("keeps distinct hardware configurations and collapses only colours", () => {
  const catalog = {
    schemaVersion: 1,
    products: [
      product(),
      product({
        productCode: "IDEAL-COLOUR",
      }),
    product({
      configurationKey: "aaa-weaker-ideal",
      productCode: "IDEAL-WEAKER",
      gpuCores: 8,
    }),
    product({
        configurationKey: "nano-ideal",
        productCode: "IDEAL-NANO",
        display: "Nano-texture",
      }),
    ],
  };

  const featured = rankCatalog(catalog, policy);
  assert.deepEqual(
    new Set(featured.items.map((item) => item.configurationKey)),
    new Set([
      "air-13-m2-8-10-24-1tb",
      "aaa-weaker-ideal",
      "nano-ideal",
    ]),
  );
  assert.equal(
    featured.items.filter(
      (item) => item.configurationKey === "air-13-m2-8-10-24-1tb",
    ).length,
    1,
  );
});

test("is byte-deterministic across input order and repeated file generation", async () => {
  const catalog = representativeCatalog();
  const reversedCatalog = {
    ...catalog,
    products: [...catalog.products].reverse(),
  };
  const forwardBytes = renderFeaturedJson(rankCatalog(catalog, policy));
  const reversedBytes = renderFeaturedJson(
    rankCatalog(reversedCatalog, policy),
  );
  assert.equal(reversedBytes, forwardBytes);

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "rank-models-test-"),
  );
  const catalogPath = join(temporaryDirectory, "catalog.json");
  const policyPath = join(temporaryDirectory, "policy.json");
  const outputPath = join(temporaryDirectory, "featured.json");

  try {
    await Promise.all([
      writeFile(catalogPath, JSON.stringify(catalog), "utf8"),
      writeFile(policyPath, JSON.stringify(policy), "utf8"),
    ]);
    await runRanking({ catalogPath, policyPath, outputPath });
    const firstBytes = await readFile(outputPath, "utf8");
    await runRanking({ catalogPath, policyPath, outputPath });
    const secondBytes = await readFile(outputPath, "utf8");
    assert.equal(firstBytes, secondBytes);
    assert.equal(firstBytes, forwardBytes);
    await runRanking({
      catalogPath,
      policyPath,
      outputPath,
      check: true,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("fails closed when one configuration key hides different hardware", () => {
  const catalog = representativeCatalog();
  catalog.products.push(
    product({
      productCode: "CONFLICT",
      memory: "16GB",
    }),
  );

  assert.throws(
    () => rankCatalog(catalog, policy),
    /contains conflicting memory values/,
  );
});
