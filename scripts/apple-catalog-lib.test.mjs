import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalog,
  buildConfigurationKey,
  buildNewProductUrl,
  DEFAULT_MARKET_PROFILE,
  extractJsonArray,
  hasExactNewProductSource,
  hydrateCurrentNewPrices,
  parseExactNewPriceHtml,
  parseMemoryFromProductHtml,
  parseRefurbishedCatalog,
  validateCatalog,
} from "./apple-catalog-lib.mjs";
import { loadMarketProfile } from "./market-profile.mjs";

const ES_MARKET_PROFILE = await loadMarketProfile("es");

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

test("Spanish catalog parsing normalizes localized fields and decimal prices", () => {
  const spanishTile = {
    ...tile,
    partNumber: "FDH74Y/A",
    productDetailsUrl: "/es/shop/product/fdh74y/a?fnode=example",
    title:
      "MacBook Air reacondicionado de 13 pulgadas con chip M5 de Apple, " +
      "CPU de 10 núcleos y GPU de 10 núcleos - Plata",
    filters: {
      dimensions: {
        ...tile.filters.dimensions,
        dimensionColor: "silver",
        tsMemorySize: "24gb",
        dimensionCapacity: "1tb",
      },
    },
    price: {
      currentPrice: {
        amount: "1.679,00 €",
        raw_amount: "1679.00",
      },
    },
  };
  const [product] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([spanishTile])}}</script>`,
    ES_MARKET_PROFILE,
  );
  assert.equal(product.priceEur, 1679);
  assert.equal(product.colour, "Silver");
  assert.equal(product.chip, "M5");
  assert.equal(product.cpuCores, 10);
  assert.equal(product.gpuCores, 10);
  assert.equal(product.memory, "24GB");
  assert.equal(product.storage, "1TB");
  assert.equal(parseMemoryFromProductHtml("24 GB de memoria unificada"), "24GB");
  assert.match(
    buildNewProductUrl(product, ES_MARKET_PROFILE),
    /13-pulgadas-silver-chip-m5-cpu-de-10-n%C3%BAcleos/,
  );
  assert.equal(
    parseExactNewPriceHtml(
      "<title>Comprar MacBook Air, 13 pulgadas, chip M5, CPU de 10 núcleos, " +
        "GPU de 10 núcleos, Plata, 24 GB de memoria, 1 TB de capacidad - " +
        "Apple (ES)</title>" +
        '<script>{"priceCurrency":"EUR","price":1979.00}</script>',
      product,
      ES_MARKET_PROFILE,
    ),
    1979,
  );

  const [legacyProduct] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([
      {
        ...spanishTile,
        partNumber: "G15Z7Y/A",
        title:
          'MacBook Air reacondicionado de 13" con chip M2 de Apple, ' +
          "CPU de ocho núcleos y GPU de diez núcleos - Blanco estrella",
      },
    ])}}</script>`,
    ES_MARKET_PROFILE,
  );
  assert.equal(legacyProduct.chip, "M2");
  assert.equal(legacyProduct.cpuCores, 8);
  assert.equal(legacyProduct.gpuCores, 10);
  assert.equal(legacyProduct.colour, "Starlight");
});

test("exact-new parsing rejects a redirected or inexact configuration", () => {
  const [product] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  const exactHtml =
    "<title>Buy 13-inch MacBook Air - Midnight, Apple M5 chip, 10-core CPU, 10-core GPU, 24GB memory, 512GB storage</title>" +
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
  assert.throws(
    () =>
      parseExactNewPriceHtml(
        exactHtml.replace("Midnight", "Sky Blue"),
        product,
      ),
    /midnight/,
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
            "<title>Buy 13-inch MacBook Air - Midnight, Apple M5 chip, 10-core CPU, 10-core GPU, 24GB memory, 512GB storage</title>" +
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

test("keeps isolated unavailable exact-new configurations null", async () => {
  const [first] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  const second = {
    ...first,
    productCode: "TEST2ZP/A",
    storage: "1TB",
  };
  second.configurationKey = buildConfigurationKey(second);

  const result = await hydrateCurrentNewPrices([first, second], {
    fetchTextImpl: async (url) => {
      if (url.includes("1tb")) {
        throw new Error("Apple offer is unavailable");
      }
      return {
        html:
          "<title>Buy 13-inch MacBook Air - Midnight, Apple M5 chip, 10-core CPU, " +
          "10-core GPU, 24GB memory, 512GB storage</title>" +
          '<script>{"priceCurrency":"SGD","price":2199}</script>',
        finalUrl: url,
      };
    },
  });

  assert.equal(result.pricedConfigurationCount, 1);
  assert.equal(result.unavailableConfigurationCount, 1);
  assert.equal(result.products[0].newPriceSgd, 2199);
  assert.equal(result.products[1].newPriceSgd, null);
  assert.equal(result.products[1].newSourceUrl, null);
});

test("matches and links every colour variant independently", async () => {
  const [midnight] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  const [skyBlue] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([
      {
        ...tile,
        partNumber: "TEST2ZP/A",
        title: tile.title.replace("Midnight", "Sky Blue"),
        filters: {
          dimensions: {
            ...tile.filters.dimensions,
            dimensionColor: "Sky Blue",
          },
        },
      },
    ])}}</script>`,
  );
  assert.equal(midnight.configurationKey, skyBlue.configurationKey);

  const requestedUrls = [];
  const result = await hydrateCurrentNewPrices([midnight, skyBlue], {
    fetchTextImpl: async (url) => {
      requestedUrls.push(url);
      const colour = url.includes("sky-blue") ? "Sky Blue" : "Midnight";
      return {
        html:
          `<title>Buy 13-inch MacBook Air - ${colour}, Apple M5 chip, 10-core CPU, ` +
          "10-core GPU, 24GB memory, 512GB storage</title>" +
          '<script>{"priceCurrency":"SGD","price":2199}</script>',
        finalUrl: url,
      };
    },
  });

  assert.equal(result.pricedConfigurationCount, 1);
  assert.equal(result.pricedColourVariantCount, 2);
  assert.equal(result.unavailableColourVariantCount, 0);
  assert.equal(requestedUrls.length, 2);
  assert.match(result.products[0].newSourceUrl, /13-inch-midnight-/);
  assert.match(result.products[1].newSourceUrl, /13-inch-sky-blue-/);
});

test("fails closed when colour variants fail inside otherwise matched configurations", async () => {
  const baseProducts = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([
      tile,
      {
        ...tile,
        partNumber: "TEST2ZP/A",
        title: tile.title.replace("Midnight", "Sky Blue"),
        filters: {
          dimensions: {
            ...tile.filters.dimensions,
            dimensionColor: "Sky Blue",
          },
        },
      },
    ])}}</script>`,
  );
  const products = [
    ...baseProducts,
    ...baseProducts.map((product, index) => {
      const copy = {
        ...product,
        productCode: `TEST${index + 3}ZP/A`,
        storage: "1TB",
      };
      copy.configurationKey = buildConfigurationKey(copy);
      return copy;
    }),
  ];
  const marketProfile = structuredClone(DEFAULT_MARKET_PROFILE);
  marketProfile.currentNewPricing.minimumExactVariantMatchRatio = 0.75;

  await assert.rejects(
    hydrateCurrentNewPrices(products, {
      marketProfile,
      fetchTextImpl: async (url) => {
        if (url.includes("sky-blue")) {
          throw new Error("Apple colour offer unavailable");
        }
        const storage = url.includes("1tb") ? "1TB" : "512GB";
        return {
          html:
            "<title>Buy 13-inch MacBook Air - Midnight, Apple M5 chip, 10-core CPU, " +
            `10-core GPU, 24GB memory, ${storage} storage</title>` +
            '<script>{"priceCurrency":"SGD","price":2199}</script>',
          finalUrl: url,
        };
      },
    }),
    /2\/4 colour variants matched/,
  );
});

test("fails closed when exact-new matching fails systemically", async () => {
  const [product] = parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify([tile])}}</script>`,
  );
  await assert.rejects(
    hydrateCurrentNewPrices([product], {
      fetchTextImpl: async () => {
        throw new Error("systemic Apple failure");
      },
    }),
    /Exact current-new matching failed closed: 0\/1/,
  );
});

test("matches nano-texture MacBook Pro prices as a distinct exact configuration", () => {
  const nanoProduct = {
    family: "Pro",
    screen: "14″",
    display: "Nano-texture",
    chip: "M5 Pro",
    colour: "Silver",
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

test("matches localized Spanish nano-texture MacBook Pro configurations", () => {
  const nanoProduct = {
    family: "Pro",
    screen: "14″",
    display: "Nano-texture",
    chip: "M5 Pro",
    colour: "Space Black",
    cpuCores: 15,
    gpuCores: 16,
    memory: "48GB",
    storage: "2TB",
  };
  assert.match(
    buildNewProductUrl(nanoProduct, ES_MARKET_PROFILE),
    /14-pulgadas-space-black-pantalla-con-vidrio-nanotexturizado-chip-m5-pro-de-apple/,
  );
  assert.equal(
    parseExactNewPriceHtml(
      "<title>Comprar MacBook Pro, 14 pulgadas, chip M5 Pro, CPU de 15 núcleos, " +
        "GPU de 16 núcleos, Negro espacial, Pantalla con vidrio nanotexturizado, " +
        "48 GB de memoria, 2 TB de capacidad - Apple (ES)</title>" +
        '<script>{"priceCurrency":"EUR","price":5374.00}</script>',
      nanoProduct,
      ES_MARKET_PROFILE,
    ),
    5374,
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
  assert.equal(catalog.marketId, "sg");
  assert.deepEqual(catalog.source.tax, {
    model: "included-in-list-price",
    acquisition: null,
    referenceLocation: null,
    availabilityPolicy: "catalog-wide",
    filterByDeliveryOrPickup: false,
  });
  assert.equal(catalog.products[0].colour, "Midnight");
  assert.equal(validateCatalog(catalog), true);
  const wrongColourSource = {
    ...product,
    newPriceSgd: 2199,
    newSourceUrl: buildNewProductUrl(
      { ...product, colour: "Sky Blue" },
      DEFAULT_MARKET_PROFILE,
    ),
  };
  assert.equal(
    hasExactNewProductSource(wrongColourSource, DEFAULT_MARKET_PROFILE),
    false,
  );
  assert.throws(
    () => buildCatalog([wrongColourSource], DEFAULT_MARKET_PROFILE),
    /newSourceUrl must match its exact colour variant/,
  );
  assert.equal(
    validateCatalog(
      { ...catalog, products: [wrongColourSource] },
      DEFAULT_MARKET_PROFILE,
      { allowStaleNewPriceProvenance: true },
    ),
    true,
  );
  assert.throws(
    () => validateCatalog({ ...catalog, generatedAt: "2026-07-26T00:00:00Z" }),
    /must not contain timestamps/,
  );
});
