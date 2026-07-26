import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;
export const REFURBISHED_CATALOG_URL =
  "https://www.apple.com/sg/shop/refurbished/mac/macbook-pro";
export const NEW_CATALOG_BASE_URL = "https://www.apple.com/sg/shop/buy-mac";

const APPLE_ORIGIN = "https://www.apple.com";
const REQUIRED_STRING_FIELDS = [
  "productCode",
  "sourceUrl",
  "title",
  "family",
  "model",
  "screen",
  "display",
  "chip",
  "colour",
  "memory",
  "storage",
  "configurationKey",
];
const REQUIRED_NUMBER_FIELDS = [
  "cpuCores",
  "gpuCores",
  "releaseYear",
  "priceSgd",
];

export const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function normalizeSpaces(value = "") {
  return String(value)
    .replaceAll("&nbsp;", " ")
    .replaceAll("\u00a0", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForMatch(value = "") {
  return normalizeSpaces(value)
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase();
}

export function extractJsonArray(html, propertyName = "tiles") {
  const propertyPattern = new RegExp(`"${propertyName}"\\s*:\\s*\\[`, "g");
  const propertyMatch = propertyPattern.exec(html);
  if (!propertyMatch) {
    throw new Error(`Could not find JSON array property "${propertyName}"`);
  }

  const startIndex = propertyMatch.index + propertyMatch[0].lastIndexOf("[");
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(startIndex, index + 1));
      }
    }
  }

  throw new Error(`Could not close JSON array property "${propertyName}"`);
}

export function capacityInGb(value) {
  const amount = Number(String(value).match(/\d+(?:\.\d+)?/)?.[0] || 0);
  return amount * (/TB$/i.test(String(value)) ? 1024 : 1);
}

export function chipGeneration(value) {
  return Number(String(value).match(/\bM(\d+)\b/i)?.[1] || 0);
}

export function chipTier(value) {
  if (/\bMax\b/i.test(value)) return 2;
  if (/\bPro\b/i.test(value)) return 1;
  return 0;
}

function lexicalCompare(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function compareProducts(left, right) {
  return (
    (left.family === right.family ? 0 : left.family === "Air" ? -1 : 1) ||
    Number(left.screen.replace(/\D/g, "")) -
      Number(right.screen.replace(/\D/g, "")) ||
    chipGeneration(right.chip) - chipGeneration(left.chip) ||
    chipTier(right.chip) - chipTier(left.chip) ||
    right.cpuCores - left.cpuCores ||
    right.gpuCores - left.gpuCores ||
    capacityInGb(right.memory) - capacityInGb(left.memory) ||
    capacityInGb(right.storage) - capacityInGb(left.storage) ||
    left.priceSgd - right.priceSgd ||
    lexicalCompare(left.colour, right.colour) ||
    lexicalCompare(left.productCode, right.productCode)
  );
}

export function buildConfigurationKey(product) {
  return [
    product.family.toLowerCase(),
    product.screen.replace(/\D/g, ""),
    normalizeForMatch(product.display).replaceAll(" ", "-"),
    normalizeForMatch(product.chip).replaceAll(" ", "-"),
    product.cpuCores,
    product.gpuCores,
    product.memory.toLowerCase(),
    product.storage.toLowerCase(),
  ].join("|");
}

function parsePrice(value) {
  return Number(String(value).replace(/[^\d.]/g, ""));
}

function formatCapacity(value = "") {
  return normalizeSpaces(value).toUpperCase();
}

export function parseRefurbishedTile(tile) {
  const dimensions = tile?.filters?.dimensions || {};
  const modelDimension = dimensions.refurbClearModel;
  if (!["macbookair", "macbookpro"].includes(modelDimension)) return null;

  const title = normalizeSpaces(tile.title);
  const family = modelDimension === "macbookair" ? "Air" : "Pro";
  const productDetailsPath = String(tile.productDetailsUrl || "").split("?")[0];
  const product = {
    productCode: normalizeSpaces(tile.partNumber),
    sourceUrl: new URL(productDetailsPath, APPLE_ORIGIN).href,
    title,
    family,
    model: `MacBook ${family}`,
    screen: `${dimensions.dimensionScreensize?.match(/\d+/)?.[0] || ""}″`,
    display: /nano-texture display/i.test(title)
      ? "Nano-texture"
      : "Standard",
    chip: normalizeSpaces(
      title.match(/Apple\s+(M\d+(?:\s+(?:Pro|Max))?)\s+(?:Chip|chip)/i)?.[1] ||
        "",
    ),
    cpuCores: Number(title.match(/(\d+)[‑-]Core CPU/i)?.[1] || 0),
    gpuCores: Number(title.match(/(\d+)[‑-]Core GPU/i)?.[1] || 0),
    colour: normalizeSpaces(
      title.match(/\s[-–—]\s(.+)$/)?.[1] || dimensions.dimensionColor || "",
    ),
    releaseYear: Number(dimensions.dimensionRelYear || 0),
    memory: formatCapacity(dimensions.tsMemorySize),
    storage: formatCapacity(dimensions.dimensionCapacity),
    priceSgd: parsePrice(tile?.price?.currentPrice?.amount),
    newPriceSgd: null,
    newSourceUrl: null,
  };
  product.configurationKey = buildConfigurationKey(product);
  return product;
}

export function parseRefurbishedCatalog(html) {
  const tiles = extractJsonArray(html, "tiles");
  const products = tiles.map(parseRefurbishedTile).filter(Boolean);
  if (products.length === 0) {
    throw new Error("Apple refurbished catalog contained no MacBook Air or Pro products");
  }
  return products;
}

export function parseMemoryFromProductHtml(html) {
  const amount = normalizeSpaces(html).match(/(\d+)GB unified memory/i)?.[1];
  return amount ? `${amount}GB` : "";
}

export function buildNewProductUrl(product) {
  const screen = product.screen.replace(/\D/g, "");
  const chip = normalizeForMatch(product.chip).replaceAll(" ", "-");
  const memory = product.memory.toLowerCase();
  const storage = product.storage.toLowerCase();

  if (product.family === "Air") {
    return `${NEW_CATALOG_BASE_URL}/macbook-air/${screen}-inch-midnight-${chip}-chip-${product.cpuCores}-core-cpu-${product.gpuCores}-core-gpu-${memory}-memory-${storage}-storage`;
  }

  const display =
    product.display === "Nano-texture"
      ? "nano-texture-display"
      : "standard-display";
  return `${NEW_CATALOG_BASE_URL}/macbook-pro/${screen}-inch-silver-${display}-apple-${chip}-chip-${product.cpuCores}-core-cpu-${product.gpuCores}-core-gpu-${memory}-memory-${storage}-storage`;
}

export function parseExactNewPriceHtml(html, product) {
  const title = normalizeForMatch(
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "",
  );
  const expectedFragments = [
    `macbook ${product.family.toLowerCase()}`,
    `${product.screen.replace(/\D/g, "")}-inch`,
    normalizeForMatch(`${product.chip} chip`),
    `${product.cpuCores}-core cpu`,
    `${product.gpuCores}-core gpu`,
    `${product.memory.toLowerCase()} memory`,
    `${product.storage.toLowerCase()} storage`,
  ];
  if (product.family === "Pro") {
    expectedFragments.push(
      product.display === "Nano-texture"
        ? "nano-texture display"
        : "standard display",
    );
  }
  const missingFragment = expectedFragments.find(
    (fragment) => !title.includes(fragment),
  );
  if (missingFragment) {
    throw new Error(
      `Apple buy page title does not contain exact configuration fragment "${missingFragment}"`,
    );
  }

  const offerMatch = html.match(
    /"priceCurrency"\s*:\s*"SGD"\s*,\s*"price"\s*:\s*"?([\d.]+)"?/,
  );
  const exactPrice = Number(offerMatch?.[1] || 0);
  if (!Number.isFinite(exactPrice) || exactPrice <= 0) {
    throw new Error("Exact SGD price not found in Apple product offer");
  }
  return exactPrice;
}

export async function fetchText(
  url,
  { attempts = 4, fetchImpl = fetch, retryDelayMs = 450 } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; AppleCatalogUpdater/1.0; +https://www.apple.com/sg/)",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      return {
        html: await response.text(),
        finalUrl: response.url || url,
      };
    } catch (error) {
      lastError = new Error(`${url}: ${error.message}`);
      if (attempt < attempts) await sleep(retryDelayMs * attempt);
    }
  }
  throw lastError || new Error(`${url}: fetch failed`);
}

async function mapInBatches(items, batchSize, mapper) {
  const output = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    output.push(...(await Promise.all(batch.map(mapper))));
  }
  return output;
}

export async function hydrateMissingMemory(
  products,
  { fetchTextImpl = fetchText, batchSize = 4 } = {},
) {
  const missing = products.filter((product) => !product.memory);
  const memoryByProductCode = new Map(
    await mapInBatches(missing, batchSize, async (product) => {
      const { html } = await fetchTextImpl(product.sourceUrl);
      const memory = parseMemoryFromProductHtml(html);
      if (!memory) {
        throw new Error(
          `${product.productCode}: unified memory not found on Apple product page`,
        );
      }
      return [product.productCode, memory];
    }),
  );

  return products.map((product) => {
    const memory = memoryByProductCode.get(product.productCode) || product.memory;
    const hydrated = { ...product, memory };
    hydrated.configurationKey = buildConfigurationKey(hydrated);
    return hydrated;
  });
}

export function newestChipGeneration(products) {
  const generation = Math.max(...products.map((product) => chipGeneration(product.chip)));
  if (!Number.isFinite(generation) || generation <= 0) {
    throw new Error("Could not identify an Apple M-series chip generation");
  }
  return generation;
}

export async function hydrateCurrentNewPrices(
  products,
  { fetchTextImpl = fetchText, batchSize = 4 } = {},
) {
  const currentChipGeneration = newestChipGeneration(products);
  const currentProducts = products.filter(
    (product) => chipGeneration(product.chip) === currentChipGeneration,
  );
  const uniqueConfigurations = [
    ...new Map(
      currentProducts.map((product) => [product.configurationKey, product]),
    ).values(),
  ];

  const priceEntries = await mapInBatches(
    uniqueConfigurations,
    batchSize,
    async (product) => {
      const newSourceUrl = buildNewProductUrl(product);
      const { html } = await fetchTextImpl(newSourceUrl);
      const newPriceSgd = parseExactNewPriceHtml(html, product);
      return [product.configurationKey, { newPriceSgd, newSourceUrl }];
    },
  );
  const pricesByConfiguration = new Map(priceEntries);

  return {
    currentChipGeneration,
    pricedConfigurationCount: pricesByConfiguration.size,
    products: products.map((product) => {
      const exactPrice = pricesByConfiguration.get(product.configurationKey);
      return {
        ...product,
        newPriceSgd: exactPrice?.newPriceSgd ?? null,
        newSourceUrl: exactPrice?.newSourceUrl ?? null,
      };
    }),
  };
}

function assertAppleUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.apple.com") {
    throw new Error(`${label} must be an https://www.apple.com URL`);
  }
}

export function validateProducts(products) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("Catalog products must be a non-empty array");
  }

  const seenProductCodes = new Set();
  const pricesByConfiguration = new Map();
  for (const [index, product] of products.entries()) {
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof product[field] !== "string" || !product[field].trim()) {
        throw new Error(`products[${index}].${field} must be a non-empty string`);
      }
    }
    for (const field of REQUIRED_NUMBER_FIELDS) {
      if (!Number.isFinite(product[field]) || product[field] <= 0) {
        throw new Error(`products[${index}].${field} must be a positive number`);
      }
    }
    if (!["Air", "Pro"].includes(product.family)) {
      throw new Error(`products[${index}].family must be Air or Pro`);
    }
    const allowedScreens = product.family === "Air" ? ["13″", "15″"] : ["14″", "16″"];
    if (!allowedScreens.includes(product.screen)) {
      throw new Error(
        `products[${index}].screen must be a supported MacBook ${product.family} size`,
      );
    }
    if (product.model !== `MacBook ${product.family}`) {
      throw new Error(`products[${index}].model does not match family`);
    }
    if (!["Standard", "Nano-texture"].includes(product.display)) {
      throw new Error(
        `products[${index}].display must be Standard or Nano-texture`,
      );
    }
    if (product.family === "Air" && product.display !== "Standard") {
      throw new Error(
        `products[${index}].display must be Standard for MacBook Air`,
      );
    }
    if (seenProductCodes.has(product.productCode)) {
      throw new Error(`Duplicate productCode: ${product.productCode}`);
    }
    seenProductCodes.add(product.productCode);
    assertAppleUrl(product.sourceUrl, `products[${index}].sourceUrl`);

    const expectedKey = buildConfigurationKey(product);
    if (product.configurationKey !== expectedKey) {
      throw new Error(
        `products[${index}].configurationKey must be "${expectedKey}"`,
      );
    }

    const hasNewPrice =
      Number.isFinite(product.newPriceSgd) && product.newPriceSgd > 0;
    const hasNewUrl =
      typeof product.newSourceUrl === "string" && product.newSourceUrl.length > 0;
    if (hasNewPrice !== hasNewUrl) {
      throw new Error(
        `products[${index}] must have both newPriceSgd and newSourceUrl, or neither`,
      );
    }
    if (!hasNewPrice) {
      if (product.newPriceSgd !== null || product.newSourceUrl !== null) {
        throw new Error(
          `products[${index}] unpriced fields must both be explicit null`,
        );
      }
    } else {
      assertAppleUrl(product.newSourceUrl, `products[${index}].newSourceUrl`);
      const previousPrice = pricesByConfiguration.get(product.configurationKey);
      if (previousPrice !== undefined && previousPrice !== product.newPriceSgd) {
        throw new Error(
          `Configuration ${product.configurationKey} has inconsistent new prices`,
        );
      }
      pricesByConfiguration.set(product.configurationKey, product.newPriceSgd);
    }
  }

  for (let index = 1; index < products.length; index += 1) {
    if (compareProducts(products[index - 1], products[index]) > 0) {
      throw new Error(`Catalog is not stably sorted at products[${index}]`);
    }
  }
  return true;
}

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Catalog schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (
    catalog?.source?.refurbishedCatalogUrl !== REFURBISHED_CATALOG_URL ||
    catalog?.source?.newCatalogBaseUrl !== NEW_CATALOG_BASE_URL
  ) {
    throw new Error("Catalog source metadata does not match Apple Singapore");
  }
  const serialized = JSON.stringify(catalog);
  if (
    /"(?:generatedAt|updatedAt|checkedAt|timestamp|lastUpdated)"/i.test(serialized)
  ) {
    throw new Error("Catalog must not contain timestamps");
  }
  return validateProducts(catalog.products);
}

export function buildCatalog(products) {
  const sortedProducts = [...products].sort(compareProducts);
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    source: {
      refurbishedCatalogUrl: REFURBISHED_CATALOG_URL,
      newCatalogBaseUrl: NEW_CATALOG_BASE_URL,
    },
    products: sortedProducts,
  };
  validateCatalog(catalog);
  return catalog;
}

export function buildSuccessStatus(
  products,
  { checkedAt, currentChipGeneration, pricedConfigurationCount },
) {
  const pricedProducts = products.filter(
    (product) => product.newPriceSgd !== null,
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "success",
    checkedAt,
    currentChipGeneration: `M${currentChipGeneration}`,
    counts: {
      products: products.length,
      air: products.filter((product) => product.family === "Air").length,
      pro: products.filter((product) => product.family === "Pro").length,
      configurations: new Set(
        products.map((product) => product.configurationKey),
      ).size,
      pricedProducts: pricedProducts.length,
      pricedConfigurations: pricedConfigurationCount,
      unpricedLegacyProducts: products.length - pricedProducts.length,
    },
  };
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function readAndValidateCatalog(filePath) {
  const catalog = JSON.parse(await readFile(filePath, "utf8"));
  validateCatalog(catalog);
  return catalog;
}
