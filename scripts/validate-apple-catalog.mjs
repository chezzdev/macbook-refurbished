import { resolve } from "node:path";
import { readAndValidateCatalog } from "./apple-catalog-lib.mjs";

const catalogPath = resolve(import.meta.dirname, "../data/catalog.json");
const catalog = await readAndValidateCatalog(catalogPath);
const pricedCount = catalog.products.filter(
  (product) => product.newPriceSgd !== null,
).length;

console.log(
  `Valid catalog: ${catalog.products.length} products, ${pricedCount} with exact current-new prices.`,
);
