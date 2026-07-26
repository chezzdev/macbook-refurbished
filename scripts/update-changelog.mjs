#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeJsonAtomic } from "./apple-catalog-lib.mjs";
import {
  loadMarketContext,
  loadMarketProfile,
} from "./market-profile.mjs";

const workspaceRoot = resolve(import.meta.dirname, "..");
const defaultMarketProfile = await loadMarketProfile("sg");
const configurationFields = [
  "family",
  "screen",
  "display",
  "chip",
  "cpuCores",
  "gpuCores",
  "memory",
  "storage",
];

function priceContext(marketProfile) {
  const source = marketProfile.currency.source;
  const suffix = source.slice(0, 1) + source.slice(1).toLowerCase();
  return {
    refurbishedField: marketProfile.currency.priceFields.refurbished,
    newField: marketProfile.currency.priceFields.new,
    taxInclusiveField: marketProfile.currency.priceFields.taxInclusive,
    fromField: `from${suffix}`,
    toField: `to${suffix}`,
  };
}

export function buildCatalogDelta({
  previousCatalog,
  currentCatalog,
  previousFeatured,
  currentFeatured,
  checkedAt,
  marketProfile = defaultMarketProfile,
}) {
  const {
    refurbishedField,
    newField,
    taxInclusiveField,
    fromField,
    toField,
  } =
    priceContext(marketProfile);
  const previousProducts = new Map(
    (previousCatalog?.products ?? []).map((product) => [
      product.productCode,
      product,
    ]),
  );
  const currentProducts = new Map(
    (currentCatalog?.products ?? []).map((product) => [
      product.productCode,
      product,
    ]),
  );

  const added = [];
  const removed = [];
  const refurbPriceChanges = [];
  const newPriceChanges = [];
  const taxInclusivePriceChanges = [];
  const configurationChanges = [];

  for (const productCode of sortedUnion(previousProducts, currentProducts)) {
    const before = previousProducts.get(productCode);
    const after = currentProducts.get(productCode);
    if (!before) {
      added.push(productSnapshot(after, marketProfile));
      continue;
    }
    if (!after) {
      removed.push(productSnapshot(before, marketProfile));
      continue;
    }
    const beforeConfiguration = configurationSnapshot(before);
    const afterConfiguration = configurationSnapshot(after);
    if (
      JSON.stringify(beforeConfiguration) !==
      JSON.stringify(afterConfiguration)
    ) {
      configurationChanges.push({
        productCode,
        before: beforeConfiguration,
        after: afterConfiguration,
      });
    }
    if (before[refurbishedField] !== after[refurbishedField]) {
      refurbPriceChanges.push({
        product: productSnapshot(after, marketProfile),
        [fromField]: before[refurbishedField],
        [toField]: after[refurbishedField],
      });
    }
    if ((before[newField] ?? null) !== (after[newField] ?? null)) {
      newPriceChanges.push({
        product: productSnapshot(after, marketProfile),
        [fromField]: before[newField] ?? null,
        [toField]: after[newField] ?? null,
      });
    }
    if (
      taxInclusiveField &&
      JSON.stringify(before.taxInclusivePricing ?? null) !==
        JSON.stringify(after.taxInclusivePricing ?? null)
    ) {
      taxInclusivePriceChanges.push({
        product: productSnapshot(after, marketProfile),
        before: before.taxInclusivePricing ?? null,
        after: after.taxInclusivePricing ?? null,
      });
    }
  }

  const featuredBefore = featuredCodes(previousFeatured);
  const featuredAfter = featuredCodes(currentFeatured);
  const featuredChanged =
    JSON.stringify(featuredBefore) !== JSON.stringify(featuredAfter);
  const counts = {
    added: added.length,
    removed: removed.length,
    refurbPriceChanges: refurbPriceChanges.length,
    newPriceChanges: newPriceChanges.length,
    configurationChanges: configurationChanges.length,
    ...(taxInclusiveField
      ? { taxInclusivePriceChanges: taxInclusivePriceChanges.length }
      : {}),
    featuredChanges: featuredChanged ? 1 : 0,
  };

  return {
    schemaVersion: 1,
    checkedAt,
    hasChanges: Object.values(counts).some((count) => count > 0),
    counts,
    added,
    removed,
    refurbPriceChanges,
    newPriceChanges,
    configurationChanges,
    ...(taxInclusiveField ? { taxInclusivePriceChanges } : {}),
    featured: featuredChanged
      ? { before: featuredBefore, after: featuredAfter }
      : null,
  };
}

export function buildChangelog({
  existingChangelog,
  delta,
  currentCatalog,
  maximumEntries = 30,
}) {
  const priorEntries = Array.isArray(existingChangelog?.entries)
    ? existingChangelog.entries
    : [];
  let entries = [...priorEntries];

  if (entries.length === 0) {
    entries.push({
      type: "baseline",
      checkedAt: delta.checkedAt,
      counts: catalogCounts(currentCatalog),
    });
  }
  if (delta.hasChanges) {
    entries.unshift({
      type: "changes",
      checkedAt: delta.checkedAt,
      counts: delta.counts,
      added: delta.added,
      removed: delta.removed,
      refurbPriceChanges: delta.refurbPriceChanges,
      newPriceChanges: delta.newPriceChanges,
      configurationChanges: delta.configurationChanges,
      ...("taxInclusivePriceChanges" in delta
        ? { taxInclusivePriceChanges: delta.taxInclusivePriceChanges }
        : {}),
      featured: delta.featured,
    });
  }

  return {
    schemaVersion: 1,
    latestRun: delta,
    entries: entries.slice(0, maximumEntries),
  };
}

export async function updateChangelog({
  previousCatalogPath,
  previousFeaturedPath,
  currentCatalogPath,
  currentFeaturedPath,
  updateStatusPath,
  changelogPath,
  deltaPath,
  marketId = "sg",
  marketProfile,
} = {}) {
  const context = marketProfile
    ? null
    : await loadMarketContext(marketId);
  const activeProfile = marketProfile ?? context.profile;
  currentCatalogPath ??=
    context?.paths.catalog ?? resolve(workspaceRoot, "data/catalog.json");
  currentFeaturedPath ??=
    context?.paths.featured ?? resolve(workspaceRoot, "data/featured.json");
  updateStatusPath ??=
    context?.paths.updateStatus ??
    resolve(workspaceRoot, "data/update-status.json");
  changelogPath ??=
    context?.paths.changelog ?? resolve(workspaceRoot, "data/changelog.json");
  deltaPath ??=
    context?.paths.updateDelta ??
    resolve(workspaceRoot, "data/update-delta.json");
  const [
    previousCatalog,
    previousFeatured,
    currentCatalog,
    currentFeatured,
    updateStatus,
    existingChangelog,
  ] = await Promise.all([
    readJsonOptional(previousCatalogPath),
    readJsonOptional(previousFeaturedPath),
    readJsonRequired(currentCatalogPath),
    readJsonRequired(currentFeaturedPath),
    readJsonRequired(updateStatusPath),
    readJsonOptional(changelogPath),
  ]);

  if (!Array.isArray(currentCatalog?.products)) {
    throw new Error("Current catalog must contain products");
  }
  if (!Array.isArray(currentFeatured?.items)) {
    throw new Error("Current featured data must contain items");
  }
  if (typeof updateStatus?.checkedAt !== "string") {
    throw new Error("Update status must contain checkedAt");
  }

  const delta = buildCatalogDelta({
    previousCatalog,
    currentCatalog,
    previousFeatured,
    currentFeatured,
    checkedAt: updateStatus.checkedAt,
    marketProfile: activeProfile,
  });
  const changelog = buildChangelog({
    existingChangelog,
    delta,
    currentCatalog,
  });

  await writeJsonAtomic(deltaPath, delta);
  await writeJsonAtomic(changelogPath, changelog);
  return { delta, changelog };
}

function productSnapshot(product, marketProfile) {
  const { refurbishedField, newField, taxInclusiveField } =
    priceContext(marketProfile);
  return {
    productCode: product.productCode,
    family: product.family,
    screen: product.screen,
    display: product.display,
    chip: product.chip,
    cpuCores: product.cpuCores,
    gpuCores: product.gpuCores,
    memory: product.memory,
    storage: product.storage,
    [refurbishedField]: product[refurbishedField],
    [newField]: product[newField] ?? null,
    ...(taxInclusiveField
      ? {
          [taxInclusiveField]: product[taxInclusiveField] ?? null,
          taxInclusivePricing: product.taxInclusivePricing,
        }
      : {}),
  };
}

function configurationSnapshot(product) {
  return Object.fromEntries(
    configurationFields.map((field) => [field, product[field]]),
  );
}

function catalogCounts(catalog) {
  const products = catalog.products;
  return {
    products: products.length,
    air: products.filter((product) => product.family === "Air").length,
    pro: products.filter((product) => product.family === "Pro").length,
    configurations: new Set(
      products.map((product) => product.configurationKey),
    ).size,
  };
}

function featuredCodes(featured) {
  return (featured?.items ?? [])
    .slice()
    .sort((left, right) => left.rank - right.rank)
    .map((item) => item.productCode);
}

function sortedUnion(left, right) {
  return [...new Set([...left.keys(), ...right.keys()])].sort(compareText);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function readJsonRequired(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonOptional(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

if (process.argv[1] === import.meta.filename) {
  const { values } = parseArgs({
    options: {
      "previous-catalog": { type: "string" },
      "previous-featured": { type: "string" },
      market: { type: "string", default: "sg" },
    },
  });
  const { delta } = await updateChangelog({
    previousCatalogPath: values["previous-catalog"],
    previousFeaturedPath: values["previous-featured"],
    marketId: values.market,
  });
  console.log(
    delta.hasChanges
      ? `Recorded ${Object.values(delta.counts).reduce((sum, count) => sum + count, 0)} change groups.`
      : "Catalog data is unchanged.",
  );
}
