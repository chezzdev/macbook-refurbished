#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadMarketContext } from "./market-profile.mjs";
import { writeJsonAtomic } from "./apple-catalog-lib.mjs";

export function buildInitialSiteDocument(profile) {
  return {
    schemaVersion: 1,
    siteName: profile.siteName,
    pageTitle: `${profile.siteName} — refurbished MacBook comparison`,
    productionUrl: profile.publication.productionUrl,
    canonicalUrl: profile.publication.canonicalUrl,
    plannedProductionUrl: profile.publication.plannedUrl ?? null,
    currency:
      profile.currency.conversion.type === "identity"
        ? {
            sourceCurrency: profile.currency.source,
            displayCurrency: profile.currency.display,
            conversionType: "identity",
            sourceToDisplayRate: 1,
          }
        : null,
    tax:
      [
        "apple-checkout-reference-location",
        "verified-fixed-location-estimate",
      ].includes(profile.tax.model)
        ? {
            model: profile.tax.model,
            acquisition: profile.tax.acquisition,
            referenceLocation: profile.tax.referenceLocation,
            taxInclusiveSourcePolicy: profile.tax.taxInclusiveSourcePolicy,
            ...(profile.tax.estimate
              ? { estimate: profile.tax.estimate }
              : {}),
            availabilityPolicy: profile.tax.availabilityPolicy,
            filterByDeliveryOrPickup: profile.tax.filterByDeliveryOrPickup,
          }
        : { model: profile.tax.model },
  };
}

export async function initializeMarketNamespace({
  marketId,
  check = false,
} = {}) {
  const { profile, paths } = await loadMarketContext(marketId);
  let existingSite = null;
  try {
    existingSite = JSON.parse(await readFile(paths.site, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (!existingSite) {
    if (check) {
      throw new Error(`${paths.site} is not initialized`);
    }
    await writeJsonAtomic(paths.site, buildInitialSiteDocument(profile));
  } else if (
    profile.id === "sg" &&
    existingSite.productionUrl !== profile.publication.productionUrl
  ) {
    throw new Error("Singapore site migration cannot change its production URL");
  } else if (
    profile.publication.status === "active" &&
    (
      existingSite.productionUrl !== profile.publication.productionUrl ||
      existingSite.canonicalUrl !== profile.publication.canonicalUrl ||
      existingSite.plannedProductionUrl !==
        (profile.publication.plannedUrl ?? null) ||
      JSON.stringify(existingSite.tax) !==
        JSON.stringify(buildInitialSiteDocument(profile).tax)
    )
  ) {
    if (check) {
      throw new Error(`${paths.site} does not match its active publication`);
    }
    existingSite = {
      ...existingSite,
      productionUrl: profile.publication.productionUrl,
      canonicalUrl: profile.publication.canonicalUrl,
      plannedProductionUrl: profile.publication.plannedUrl ?? null,
      tax: buildInitialSiteDocument(profile).tax,
    };
    await writeJsonAtomic(paths.site, existingSite);
  }

  for (const requiredPath of [paths.catalog, paths.featured]) {
    try {
      await access(requiredPath);
    } catch (error) {
      if (check) {
        throw new Error(`${requiredPath} is not initialized`, { cause: error });
      }
    }
  }
  return { profile, paths, createdSite: !existingSite };
}

if (process.argv[1] === import.meta.filename) {
  const { values } = parseArgs({
    options: {
      market: { type: "string", default: "sg" },
      check: { type: "boolean", default: false },
    },
  });
  const result = await initializeMarketNamespace({
    marketId: values.market,
    check: values.check,
  });
  console.log(
    result.createdSite
      ? `Initialized ${result.profile.siteName} namespace.`
      : `${result.profile.siteName} namespace is already initialized.`,
  );
}
