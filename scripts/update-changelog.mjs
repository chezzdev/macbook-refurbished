#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeJsonAtomic } from "./apple-catalog-lib.mjs";

const workspaceRoot = resolve(import.meta.dirname, "..");

export function buildCatalogDelta({
  previousCatalog,
  currentCatalog,
  previousFeatured,
  currentFeatured,
  checkedAt,
}) {
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

  for (const productCode of sortedUnion(previousProducts, currentProducts)) {
    const before = previousProducts.get(productCode);
    const after = currentProducts.get(productCode);
    if (!before) {
      added.push(productSnapshot(after));
      continue;
    }
    if (!after) {
      removed.push(productSnapshot(before));
      continue;
    }
    if (before.priceSgd !== after.priceSgd) {
      refurbPriceChanges.push({
        product: productSnapshot(after),
        fromSgd: before.priceSgd,
        toSgd: after.priceSgd,
      });
    }
    if ((before.newPriceSgd ?? null) !== (after.newPriceSgd ?? null)) {
      newPriceChanges.push({
        product: productSnapshot(after),
        fromSgd: before.newPriceSgd ?? null,
        toSgd: after.newPriceSgd ?? null,
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
  currentCatalogPath = resolve(workspaceRoot, "data/catalog.json"),
  currentFeaturedPath = resolve(workspaceRoot, "data/featured.json"),
  updateStatusPath = resolve(workspaceRoot, "data/update-status.json"),
  changelogPath = resolve(workspaceRoot, "data/changelog.json"),
  deltaPath = resolve(workspaceRoot, "data/update-delta.json"),
} = {}) {
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

function productSnapshot(product) {
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
    priceSgd: product.priceSgd,
    newPriceSgd: product.newPriceSgd ?? null,
  };
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
    },
  });
  const { delta } = await updateChangelog({
    previousCatalogPath: values["previous-catalog"],
    previousFeaturedPath: values["previous-featured"],
  });
  console.log(
    delta.hasChanges
      ? `Recorded ${Object.values(delta.counts).reduce((sum, count) => sum + count, 0)} change groups.`
      : "Catalog data is unchanged.",
  );
}
