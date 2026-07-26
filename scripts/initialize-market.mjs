#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
  DEFAULT_MARKET_ID,
  loadMarketContext,
} from "./market-profile.mjs";
import { writeJsonAtomic } from "./apple-catalog-lib.mjs";

export function buildInitialSiteDocument(profile) {
  return {
    schemaVersion: 1,
    siteName: profile.siteName,
    pageTitle: profile.pageTitle,
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

export function reconcileSiteDocument(profile, existingSite = null) {
  const initialSite = buildInitialSiteDocument(profile);
  return {
    ...initialSite,
    currency:
      profile.currency.conversion.type === "identity"
        ? initialSite.currency
        : existingSite?.currency ?? null,
  };
}

function validateDynamicCurrency(profile, site) {
  const currency = site.currency;
  if (profile.currency.conversion.type === "identity") {
    if (
      !isDeepStrictEqual(
        currency,
        buildInitialSiteDocument(profile).currency,
      )
    ) {
      throw new Error(
        `${profile.id} site currency does not match its identity profile`,
      );
    }
    return;
  }
  const siteField = profile.currency.conversion.siteField;
  if (
    currency?.sourceCurrency !== profile.currency.source ||
    currency?.displayCurrency !== profile.currency.display ||
    currency?.conversionType !== profile.currency.conversion.type ||
    !Number.isFinite(currency?.sourceToDisplayRate) ||
    currency.sourceToDisplayRate <= 0 ||
    !Number.isFinite(currency?.[siteField]) ||
    currency[siteField] <= 0
  ) {
    throw new Error(
      `${profile.id} site currency does not match its conversion profile`,
    );
  }
}

export async function initializeMarketNamespace({
  marketId,
  check = false,
  namespaceRoot,
} = {}) {
  const { profile, paths } = await loadMarketContext(marketId, {
    namespaceRoot,
  });
  let existingSite = null;
  try {
    existingSite = JSON.parse(await readFile(paths.site, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const reconciledSite = reconcileSiteDocument(profile, existingSite);
  if (!existingSite) {
    if (check) {
      throw new Error(`${paths.site} is not initialized`);
    }
    await writeJsonAtomic(paths.site, reconciledSite);
  } else if (!isDeepStrictEqual(existingSite, reconciledSite)) {
    if (check) {
      throw new Error(`${paths.site} does not match its market profile`);
    }
    await writeJsonAtomic(paths.site, reconciledSite);
    existingSite = reconciledSite;
  }
  if (check) validateDynamicCurrency(profile, reconciledSite);

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
      market: { type: "string", default: DEFAULT_MARKET_ID },
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
