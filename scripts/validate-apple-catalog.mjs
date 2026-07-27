import {
  hasExactNewProductSource,
  readAndValidateCatalog,
} from "./apple-catalog-lib.mjs";
import {
  loadMarketContext,
  marketIdFromArgv,
} from "./market-profile.mjs";

const { profile, paths } = await loadMarketContext(marketIdFromArgv());
const allowStaleNewPriceProvenance = process.argv.includes(
  "--allow-stale-new-price-provenance",
);
const catalog = await readAndValidateCatalog(paths.catalog, profile, {
  allowStaleNewPriceProvenance,
});
const newPriceField = profile.currency.priceFields.new;
const pricedCount = catalog.products.filter(
  (product) => product[newPriceField] !== null,
).length;
const verifiedPricedCount = catalog.products.filter(
  (product) =>
    product[newPriceField] !== null &&
    hasExactNewProductSource(product, profile),
).length;

console.log(
  `Valid ${profile.id.toUpperCase()} catalog: ${catalog.products.length} products, ` +
    `${verifiedPricedCount} with verified exact-colour current-new prices.` +
    (allowStaleNewPriceProvenance && pricedCount !== verifiedPricedCount
      ? ` ${pricedCount - verifiedPricedCount} stale provenance entries will render unpriced.`
      : ""),
);
