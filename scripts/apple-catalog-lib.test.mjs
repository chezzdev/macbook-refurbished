import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalog,
  buildConfigurationKey,
  buildNewProductUrl,
  extractJsonArray,
  hydrateCurrentNewPrices,
  parseExactNewPriceHtml,
  parseRefurbishedCatalog,
  validateCatalog,
} from "./apple-catalog-lib.mjs";

const tile = {
  partNumber: "TEST1ZP/A",
  productDetailsUrl: "/sg/shop/product/test1zp/a?fnode=example",
  title:
    "Refurbished 13‑inch MacBook Air Apple M5 chip with 10‑Core CPU and 10‑Core GPU - Midnight",
  filters: {
    dimensions: {
      refurbClearModel: "macbookair",
      dimensionScreensize: "13inch",
      dimensionColor: "midnight",
      dimensionRelYear: "2026",
      tsMemorySize: "24GB",
      dimensionCapacity: "512GB",
    },
  },
  price: { currentPrice: { amount: "S$ 1,999.00" } },
};

test("extractJsonArray handles whitespace and brackets inside JSON strings", () => {
  const html = '<script>{"tiles" : ["]", {"nested":[1,2]}], "other":true}</script>';
  assert.deepEqual(extractJsonArray(html), ["]", { nested: [1, 2] }]);
});

test("refurbished catalog parsing preserves required normalized fields", () => {
  const products = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  assert.deepEqual(products[0], {
    productCode: "TEST1ZP/A",
    sourceUrl: "https://www.apple.com/sg/shop/product/test1zp/a",
    title:
      "Refurbished 13‑inch MacBook Air Apple M5 chip with 10‑Core CPU and 10‑Core GPU - Midnight",
    family: "Air",
    model: "MacBook Air",
    screen: "13″",
    display: "Standard",
    chip: "M5",
    cpuCores: 10,
    gpuCores: 10,
    colour: "Midnight",
    releaseYear: 2026,
    memory: "24GB",
    storage: "512GB",
    priceSgd: 1999,
    newPriceSgd: null,
    newSourceUrl: null,
    configurationKey: "air|13|standard|m5|10|10|24gb|512gb",
  });
});

test("exact-new parsing rejects a redirected or inexact configuration", () => {
  const [product] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  const exactHtml =
    "<title>Buy 13-inch MacBook Air - Apple M5 chip, 10-core CPU, 10-core GPU, 24GB memory, 512GB storage</title>" +
    '<script>{"priceCurrency":"SGD","price":2199.00}</script>';
  assert.equal(parseExactNewPriceHtml(exactHtml, product), 2199);
  assert.throws(
    () =>
      parseExactNewPriceHtml(
        exactHtml.replace("24GB memory", "16GB memory"),
        product,
      ),
    /24gb memory/,
  );
});

test("only newest-generation exact configurations receive new prices", async () => {
  const [currentProduct] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  const legacyProduct = {
    ...currentProduct,
    productCode: "OLD1ZP/A",
    chip: "M4",
  };
  legacyProduct.configurationKey = buildConfigurationKey(legacyProduct);

  const result = await hydrateCurrentNewPrices(
    [legacyProduct, currentProduct],
    {
      fetchTextImpl: async (url) => {
        assert.equal(url, buildNewProductUrl(currentProduct));
        return {
          html:
            "<title>Buy 13-inch MacBook Air - Apple M5 chip, 10-core CPU, 10-core GPU, 24GB memory, 512GB storage</title>" +
            '<script>{"priceCurrency":"SGD","price":2199}</script>',
          finalUrl: url,
        };
      },
    },
  );

  assert.equal(result.products[0].newPriceSgd, null);
  assert.equal(result.products[0].newSourceUrl, null);
  assert.equal(result.products[1].newPriceSgd, 2199);
});

test("matches nano-texture MacBook Pro prices as a distinct exact configuration", () => {
  const nanoProduct = {
    family: "Pro",
    screen: "14″",
    display: "Nano-texture",
    chip: "M5 Pro",
    cpuCores: 15,
    gpuCores: 16,
    memory: "48GB",
    storage: "2TB",
  };
  assert.match(buildNewProductUrl(nanoProduct), /nano-texture-display/);
  assert.equal(
    parseExactNewPriceHtml(
      "<title>Buy MacBook Pro, 14-inch, M5 Pro Chip, 15-core CPU, " +
        "16-core GPU, Silver, Nano-texture display, 48GB memory, " +
        "2TB storage - Apple (SG)</title>" +
        '<script>{"priceCurrency":"SGD","price":5374.00}</script>',
      nanoProduct,
    ),
    5374,
  );
  assert.throws(
    () =>
      parseExactNewPriceHtml(
        "<title>Buy MacBook Pro, 14-inch, M5 Pro Chip, 15-core CPU, " +
          "16-core GPU, Silver, Standard display, 48GB memory, " +
          "2TB storage - Apple (SG)</title>" +
          '<script>{"priceCurrency":"SGD","price":5149.00}</script>',
        nanoProduct,
      ),
    /nano-texture display/,
  );
});

test("catalog validation enforces stable ordering and rejects timestamps", () => {
  const [product] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  const other = {
    ...product,
    productCode: "TEST2ZP/A",
    colour: "Sky Blue",
  };
  const catalog = buildCatalog([other, product]);
  assert.equal(catalog.products[0].colour, "Midnight");
  assert.equal(validateCatalog(catalog), true);
  assert.throws(
    () => validateCatalog({ ...catalog, generatedAt: "2026-07-26T00:00:00Z" }),
    /must not contain timestamps/,
  );
});
