import { resolve } from "node:path";
import {
  REFURBISHED_CATALOG_URL,
  buildCatalog,
  buildSuccessStatus,
  fetchText,
  hydrateCurrentNewPrices,
  hydrateMissingMemory,
  parseRefurbishedCatalog,
  writeJsonAtomic,
} from "./apple-catalog-lib.mjs";

const workspaceRoot = resolve(import.meta.dirname, "..");
const catalogPath = resolve(workspaceRoot, "data/catalog.json");
const statusPath = resolve(workspaceRoot, "data/update-status.json");

async function updateCatalog() {
  const checkedAt = new Date().toISOString();

  try {
    const { html } = await fetchText(REFURBISHED_CATALOG_URL);
    const parsedProducts = parseRefurbishedCatalog(html);
    const productsWithMemory = await hydrateMissingMemory(parsedProducts);
    const {
      currentChipGeneration,
      pricedConfigurationCount,
      products: pricedProducts,
    } = await hydrateCurrentNewPrices(productsWithMemory);
    const catalog = buildCatalog(pricedProducts);
    const status = buildSuccessStatus(catalog.products, {
      checkedAt,
      currentChipGeneration,
      pricedConfigurationCount,
    });

    // A failed scrape or validation never replaces the last known-good catalog.
    await writeJsonAtomic(catalogPath, catalog);
    await writeJsonAtomic(statusPath, status);

    console.log(
      `Updated ${catalogPath}: ${status.counts.products} products ` +
        `(${status.counts.air} Air, ${status.counts.pro} Pro), ` +
        `${status.counts.pricedProducts} with exact current-new prices.`,
    );
  } catch (error) {
    // Keep both last known-good data files untouched on any fetch, parse,
    // exact-configuration, or validation failure.
    throw error;
  }
}

await updateCatalog();
