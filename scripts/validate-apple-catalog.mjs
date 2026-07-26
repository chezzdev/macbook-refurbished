import { readAndValidateCatalog } from "./apple-catalog-lib.mjs";
import {
  loadMarketContext,
  marketIdFromArgv,
} from "./market-profile.mjs";

const { profile, paths } = await loadMarketContext(marketIdFromArgv());
const catalog = await readAndValidateCatalog(paths.catalog, profile);
const newPriceField = profile.currency.priceFields.new;
const pricedCount = catalog.products.filter(
  (product) => product[newPriceField] !== null,
).length;

console.log(
  `Valid ${profile.id.toUpperCase()} catalog: ${catalog.products.length} products, ` +
    `${pricedCount} with exact current-new prices.`,
);
