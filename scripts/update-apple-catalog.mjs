import {
  buildCatalog,
  buildSuccessStatus,
  fetchText,
  hydrateCurrentNewPrices,
  hydrateMissingMemory,
  hydrateTaxInclusivePrices,
  parseRefurbishedCatalog,
  writeJsonAtomic,
} from "./apple-catalog-lib.mjs";
import {
  loadMarketContext,
  marketIdFromArgv,
} from "./market-profile.mjs";

export async function updateCatalog({
  marketId = "sg",
  fetchTextImpl = fetchText,
  quoteTaxInclusivePrice,
} = {}) {
  const { profile, paths } = await loadMarketContext(marketId);
  const checkedAt = new Date().toISOString();

  const { html } = await fetchTextImpl(
    profile.storefront.refurbishedCatalogUrl,
  );
  const parsedProducts = parseRefurbishedCatalog(html, profile);
  const productsWithMemory = await hydrateMissingMemory(parsedProducts, {
    fetchTextImpl,
  });
  const {
    currentChipGeneration,
    pricedConfigurationCount,
    unavailableConfigurationCount,
    products: pricedProducts,
  } = await hydrateCurrentNewPrices(productsWithMemory, {
    fetchTextImpl,
    marketProfile: profile,
  });
  const {
    estimatedCount: taxEstimatedCount,
    resolvedCount: taxResolvedCount,
    unresolvedCount: taxUnresolvedCount,
    products: taxHydratedProducts,
  } = await hydrateTaxInclusivePrices(pricedProducts, {
    marketProfile: profile,
    quoteTaxInclusivePrice,
  });
  const catalog = buildCatalog(taxHydratedProducts, profile);
  const updateStatus = buildSuccessStatus(catalog.products, {
    checkedAt,
    currentChipGeneration,
    pricedConfigurationCount,
    unavailableConfigurationCount,
    marketProfile: profile,
    taxResolvedCount,
    taxEstimatedCount,
    taxUnresolvedCount,
  });

  // A failed scrape or validation never replaces the last known-good catalog.
  await writeJsonAtomic(paths.catalog, catalog);
  await writeJsonAtomic(paths.updateStatus, updateStatus);

  console.log(
    `Updated ${paths.catalog} for ${profile.siteName}: ` +
      `${updateStatus.counts.products} products ` +
      `(${updateStatus.counts.air} Air, ${updateStatus.counts.pro} Pro), ` +
      `${updateStatus.counts.pricedProducts} with exact current-new prices.`,
  );
  return { catalog, updateStatus };
}

if (process.argv[1] === import.meta.filename) {
  await updateCatalog({ marketId: marketIdFromArgv() });
}
