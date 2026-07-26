import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { calculateFixedLocationTaxAmounts } from "./fixed-location-tax.mjs";

export const DEFAULT_MARKET_ID = "sg";
export const projectRoot = resolve(import.meta.dirname, "..");
export const COMMON_PUBLICATION_SOURCE_PATHS = Object.freeze([
  "README.md",
  "package.json",
  "package-lock.json",
  "eslint.config.mjs",
  "config/publish.gitignore",
  "config/markets/registry.json",
  "scripts/apple-catalog-lib.mjs",
  "scripts/apple-catalog-lib.test.mjs",
  "scripts/build-enabled-markets.mjs",
  "scripts/fixed-location-tax.mjs",
  "scripts/html-escape.mjs",
  "scripts/initialize-market.mjs",
  "scripts/market-display-copy.mjs",
  "scripts/market-profile.mjs",
  "scripts/print-market-workflow-config.mjs",
  "scripts/publication-manifest.mjs",
  "scripts/rank-models.mjs",
  "scripts/summarize-enabled-markets.mjs",
  "scripts/summarize-update.mjs",
  "scripts/update-apple-catalog.mjs",
  "scripts/update-changelog.mjs",
  "scripts/update-exchange-rate.mjs",
  "scripts/validate-apple-catalog.mjs",
  "tests/changelog.test.mjs",
  "tests/exchange-rate.test.mjs",
  "tests/html-escape.test.mjs",
  "tests/market-engine.test.mjs",
  "tests/rank-models.test.mjs",
  "tests/standalone-catalog.test.mjs",
  "work/build-expanded-standalone.mjs",
  "work/daily-update.zsh",
  "work/update-all-markets.zsh",
  "work/update-market-site.zsh",
  "work/update-published-site.zsh",
]);

const cache = new Map();
let registryCache;

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireAppleUrl(value, label) {
  requireString(value, label);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.apple.com") {
    throw new Error(`${label} must be an https://www.apple.com URL`);
  }
}

function requireHttpsUrl(value, label) {
  requireString(value, label);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be an HTTPS URL`);
  }
}

function validateNamespacePath(value, label) {
  requireString(value, label);
  if (isAbsolute(value)) {
    throw new Error(`${label} must be relative to the project root`);
  }
  const absolutePath = resolve(projectRoot, value);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  if (
    value.includes("\\") ||
    value !== relativePath
  ) {
    throw new Error(
      `${label} must use a normalized project-relative path`,
    );
  }
  return relativePath;
}

function assertCanonicalProfileLayout(profile) {
  const dataPrefix = `data/markets/${profile.id}`;
  const expectedNamespace = {
    catalog: `${dataPrefix}/catalog.json`,
    featured: `${dataPrefix}/featured.json`,
    site: `${dataPrefix}/site.json`,
    updateStatus: `${dataPrefix}/update-status.json`,
    updateDelta: `${dataPrefix}/update-delta.json`,
    changelog: `${dataPrefix}/changelog.json`,
    artifactDirectory: `outputs/markets/${profile.id}`,
  };
  for (const [key, expectedPath] of Object.entries(expectedNamespace)) {
    if (profile.namespace?.[key] !== expectedPath) {
      throw new Error(
        `${profile.id}.namespace.${key} must be ${expectedPath}`,
      );
    }
  }
  const expectedPolicyPath = `config/ranking-policy.${profile.id}.json`;
  if (profile.ranking?.policyPath !== expectedPolicyPath) {
    throw new Error(
      `${profile.id}.ranking.policyPath must be ${expectedPolicyPath}`,
    );
  }
  if (
    profile.publication?.artifactDirectory !== `markets/${profile.id}`
  ) {
    throw new Error(
      `${profile.id}.publication.artifactDirectory must be markets/${profile.id}`,
    );
  }
  if (
    profile.publication?.repository !==
      "git@github.com:chezzdev/macbook-refurbished-sg.git" ||
    profile.publication?.checkoutPath !== "work/gh-pages-site" ||
    profile.publication?.branch !== "main" ||
    profile.publication?.provider !== "cloudflare-pages"
  ) {
    throw new Error(
      `${profile.id}.publication must use the unified Cloudflare publication repository`,
    );
  }
  if (
    profile.publication?.projectSlug !==
      `macbook-${profile.id}-refurbished`
  ) {
    throw new Error(
      `${profile.id}.publication.projectSlug must be macbook-${profile.id}-refurbished`,
    );
  }
}

export function validateMarketProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("market profile must be an object");
  }
  if (profile.schemaVersion !== 1) {
    throw new Error("market profile schemaVersion must be 1");
  }
  requireString(profile.id, "market profile id");
  if (!/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(profile.id)) {
    throw new Error(`invalid market profile id: ${profile.id}`);
  }
  requireString(profile.siteName, "market profile siteName");
  requireString(profile.pageTitle, "market profile pageTitle");
  requireString(profile.language, "market profile language");
  requireString(profile.locale, "market profile locale");
  requireString(profile.storefront?.countryCode, "storefront.countryCode");
  requireString(profile.storefront?.countryName, "storefront.countryName");
  requireAppleUrl(profile.storefront?.baseUrl, "storefront.baseUrl");
  requireAppleUrl(
    profile.storefront?.refurbishedCatalogUrl,
    "storefront.refurbishedCatalogUrl",
  );
  requireAppleUrl(
    profile.storefront?.newCatalogBaseUrl,
    "storefront.newCatalogBaseUrl",
  );

  for (const field of ["source", "display"]) {
    if (!/^[A-Z]{3}$/.test(profile.currency?.[field] ?? "")) {
      throw new Error(`currency.${field} must be an ISO 4217 code`);
    }
  }
  requireString(
    profile.currency?.displayLocale,
    "currency.displayLocale",
  );
  requireString(
    profile.currency?.secondaryLocale,
    "currency.secondaryLocale",
  );
  for (const field of [
    "sourceFractionDigits",
    "displayFractionDigits",
  ]) {
    if (
      !Number.isSafeInteger(profile.currency?.[field]) ||
      profile.currency[field] < 0 ||
      profile.currency[field] > 4
    ) {
      throw new Error(`currency.${field} must be an integer from 0 to 4`);
    }
  }
  for (const field of ["refurbished", "new"]) {
    requireString(
      profile.currency?.priceFields?.[field],
      `currency.priceFields.${field}`,
    );
  }
  if (!["identity", "cbr-cross-rate"].includes(profile.currency?.conversion?.type)) {
    throw new Error("currency.conversion.type is unsupported");
  }
  if (
    profile.currency.conversion.type === "identity" &&
    profile.currency.conversion.siteField !== null
  ) {
    throw new Error("identity currency conversion.siteField must be null");
  }
  if (profile.currency.conversion.type === "cbr-cross-rate") {
    requireString(
      profile.currency.conversion.siteField,
      "currency.conversion.siteField",
    );
  }
  if (
    !Number.isSafeInteger(profile.currentNewPricing?.minimumExactMatchCount) ||
    profile.currentNewPricing.minimumExactMatchCount < 1 ||
    !Number.isFinite(profile.currentNewPricing?.minimumExactMatchRatio) ||
    profile.currentNewPricing.minimumExactMatchRatio <= 0 ||
    profile.currentNewPricing.minimumExactMatchRatio > 1
  ) {
    throw new Error(
      "currentNewPricing must declare a positive minimum count and ratio in (0, 1]",
    );
  }

  if (
    profile.tax?.availabilityPolicy !== "catalog-wide" ||
    profile.tax?.filterByDeliveryOrPickup !== false
  ) {
    throw new Error(
      "market profiles must keep catalog scope independent of delivery and pickup",
    );
  }
  if (
    ["apple-checkout-reference-location", "verified-fixed-location-estimate"]
      .includes(profile.tax?.model)
  ) {
    const location = profile.tax.referenceLocation;
    for (const field of [
      "id",
      "name",
      "street",
      "city",
      "region",
      "postalCode",
      "country",
    ]) {
      requireString(location?.[field], `tax.referenceLocation.${field}`);
    }
    if (location.country !== profile.storefront.countryCode) {
      throw new Error(
        "tax reference country must match the market storefront country",
      );
    }
    requireString(
      profile.currency.priceFields.taxInclusive,
      "currency.priceFields.taxInclusive",
    );
    if (profile.tax.model === "verified-fixed-location-estimate") {
      requireString(
        profile.currency.priceFields.newTaxInclusive,
        "currency.priceFields.newTaxInclusive",
      );
    }
    if (profile.tax.model === "apple-checkout-reference-location") {
      if (profile.tax.taxInclusiveSourcePolicy !== "apple-flow-only") {
        throw new Error(
          "Apple checkout tax-inclusive prices must use Apple flow provenance",
        );
      }
      if (
        profile.tax.acquisition?.adapter !== "apple-checkout" ||
        !["available", "unavailable"].includes(profile.tax.acquisition?.status)
      ) {
        throw new Error(
          "Apple checkout tax acquisition must declare adapter status",
        );
      }
    } else {
      const estimate = profile.tax.estimate;
      const verification = profile.tax.acquisition?.verification;
      if (estimate?.currency !== profile.currency.source) {
        throw new Error(
          "fixed-location tax estimate currency must match the source currency",
        );
      }
      if (
        profile.tax.taxInclusiveSourcePolicy !== "verified-manual-estimate" ||
        profile.tax.acquisition?.adapter !== "manual-calculation" ||
        profile.tax.acquisition?.status !== "verified" ||
        !Number.isFinite(estimate?.salesTaxRate) ||
        estimate.salesTaxRate <= 0 ||
        estimate.salesTaxRate >= 1 ||
        estimate.rounding !== "nearest-minor-unit" ||
        !Number.isSafeInteger(estimate.minorUnitDigits) ||
        estimate.minorUnitDigits < 0 ||
        estimate.minorUnitDigits > 4
      ) {
        throw new Error(
          "fixed-location tax estimate must declare its verified calculation policy",
        );
      }
      const recyclingFees = Object.entries(
        estimate.recyclingFeeByScreenInches ?? {},
      );
      if (recyclingFees.length === 0) {
        throw new Error(
          "tax.estimate.recyclingFeeByScreenInches must not be empty",
        );
      }
      for (const [screen, fee] of recyclingFees) {
        if (!/^\d+$/.test(screen) || !Number.isFinite(fee) || fee < 0) {
          throw new Error(
            "tax.estimate.recyclingFeeByScreenInches must contain non-negative fees",
          );
        }
      }
      for (const field of [
        "appleTaxPolicyUrl",
        "salesTaxSourceUrl",
        "recyclingFeeSourceUrl",
      ]) {
        requireHttpsUrl(estimate?.[field], `tax.estimate.${field}`);
      }
      requireString(
        profile.tax.acquisition?.verifiedAt,
        "tax.acquisition.verifiedAt",
      );
      if (verification?.currency !== estimate.currency) {
        throw new Error(
          "tax verification currency must match the estimate currency",
        );
      }
      requireString(
        verification?.productCode,
        "tax.acquisition.verification.productCode",
      );
      requireAppleUrl(
        verification?.productUrl,
        "tax.acquisition.verification.productUrl",
      );
      if (
        !Number.isSafeInteger(verification?.screenInches) ||
        verification.screenInches <= 0
      ) {
        throw new Error(
          "tax.acquisition.verification.screenInches must be a positive integer",
        );
      }
      for (const field of [
        "preTaxAmount",
        "salesTaxAmount",
        "recyclingFeeAmount",
        "estimatedTotalAmount",
      ]) {
        if (!Number.isFinite(verification?.[field]) || verification[field] < 0) {
          throw new Error(
            `tax.acquisition.verification.${field} must be non-negative`,
          );
        }
      }
      const expected = calculateFixedLocationTaxAmounts({
        preTaxAmount: verification.preTaxAmount,
        screenInches: verification.screenInches,
        estimate,
      });
      if (
        verification.salesTaxAmount !== expected.salesTaxAmount ||
        verification.recyclingFeeAmount !== expected.recyclingFeeAmount ||
        verification.estimatedTotalAmount !== expected.estimatedTotalAmount
      ) {
        throw new Error(
          "fixed-location tax policy does not reproduce its Apple checkout verification",
        );
      }
    }
  } else if (profile.tax?.model !== "included-in-list-price") {
    throw new Error(`unsupported tax model: ${profile.tax?.model}`);
  } else if (
    profile.currency.priceFields.taxInclusive !== null ||
    profile.currency.priceFields.newTaxInclusive !== null
  ) {
    throw new Error(
      "included-in-list-price markets must not declare tax-inclusive output fields",
    );
  }

  requireString(profile.ranking?.policyPath, "ranking.policyPath");
  for (const field of ["family", "screen", "memory", "storage"]) {
    requireString(profile.ranking?.reference?.[field], `ranking.reference.${field}`);
  }
  for (const field of [
    "catalog",
    "featured",
    "site",
    "updateStatus",
    "updateDelta",
    "changelog",
    "artifactDirectory",
  ]) {
    validateNamespacePath(profile.namespace?.[field], `namespace.${field}`);
  }
  validateNamespacePath(profile.ranking.policyPath, "ranking.policyPath");

  requireString(profile.publication?.projectSlug, "publication.projectSlug");
  requireString(profile.publication?.repository, "publication.repository");
  requireString(profile.publication?.branch, "publication.branch");
  requireHttpsUrl(profile.publication?.canonicalUrl, "publication.canonicalUrl");
  if (profile.publication?.plannedUrl !== null) {
    requireHttpsUrl(profile.publication?.plannedUrl, "publication.plannedUrl");
  }
  validateNamespacePath(
    profile.publication?.checkoutPath,
    "publication.checkoutPath",
  );
  validateNamespacePath(
    profile.publication?.artifactDirectory,
    "publication.artifactDirectory",
  );
  assertCanonicalProfileLayout(profile);
  if (
    profile.namespace.artifactDirectory !==
      `outputs/markets/${profile.id}` ||
    profile.publication.artifactDirectory !==
      `markets/${profile.id}`
  ) {
    throw new Error(
      "market artifact directories must use symmetric outputs/markets/<id> and markets/<id> paths",
    );
  }
  if (profile.publication.status === "active") {
    if (
      profile.publication.approvalRequired !== false ||
      profile.publication.productionUrl !==
        profile.publication.canonicalUrl
    ) {
      throw new Error(
        `${profile.id} active publication must use its canonical production URL without an approval gate`,
      );
    }
    requireHttpsUrl(
      profile.publication.productionUrl,
      "publication.productionUrl",
    );
  } else if (profile.publication.status === "approval-required") {
    if (
      profile.publication.approvalRequired !== true ||
      profile.publication.productionUrl !== null
    ) {
      throw new Error(
        `${profile.id} approval-required publication must remain fail-closed`,
      );
    }
  } else if (profile.publication.status === "approved-pending-provision") {
    if (
      profile.publication.approvalRequired !== false ||
      profile.publication.productionUrl !== null
    ) {
      throw new Error(
        `${profile.id} provision-pending publication must have approval and no production URL`,
      );
    }
  } else {
    throw new Error(
      `${profile.id}.publication.status is unsupported: ${profile.publication.status}`,
    );
  }
  return true;
}

export function validateMarketRegistry(registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error("market registry must be an object");
  }
  if (registry.schemaVersion !== 1) {
    throw new Error("market registry schemaVersion must be 1");
  }
  requireString(registry.defaultMarket, "market registry defaultMarket");
  if (
    !Array.isArray(registry.enabledMarkets) ||
    registry.enabledMarkets.length === 0
  ) {
    throw new Error("market registry enabledMarkets must be a non-empty array");
  }
  const uniqueIds = new Set();
  for (const marketId of registry.enabledMarkets) {
    requireString(marketId, "market registry market id");
    if (!/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(marketId)) {
      throw new Error(`invalid enabled market id: ${marketId}`);
    }
    if (uniqueIds.has(marketId)) {
      throw new Error(`duplicate enabled market id: ${marketId}`);
    }
    uniqueIds.add(marketId);
  }
  if (!uniqueIds.has(registry.defaultMarket)) {
    throw new Error("market registry defaultMarket must be enabled");
  }
  return true;
}

export async function loadMarketProfile(marketId = DEFAULT_MARKET_ID) {
  if (!/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(marketId)) {
    throw new Error(`Invalid market id: ${marketId}`);
  }
  if (!cache.has(marketId)) {
    const profilePath = resolve(projectRoot, `config/markets/${marketId}.json`);
    let profile;
    try {
      profile = JSON.parse(await readFile(profilePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Market profile not found: ${profilePath}`, {
          cause: error,
        });
      }
      throw error;
    }
    validateMarketProfile(profile);
    cache.set(marketId, Object.freeze(profile));
  }
  return cache.get(marketId);
}

export async function loadMarketRegistry() {
  if (!registryCache) {
    const registryPath = resolve(projectRoot, "config/markets/registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    validateMarketRegistry(registry);
    registryCache = Object.freeze({
      ...registry,
      enabledMarkets: Object.freeze([...registry.enabledMarkets]),
    });
  }
  return registryCache;
}

function pathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function assertUniqueProfileOwnedPaths(profiles) {
  const policyOwners = new Map();
  const outputOwners = new Map();
  const immutableSourcePaths = [
    ...COMMON_PUBLICATION_SOURCE_PATHS,
    ...profiles.flatMap((profile) => [
      `config/markets/${profile.id}.json`,
      profile.ranking.policyPath,
    ]),
  ].map((value) => validateNamespacePath(value, "immutable source path"));
  const immutableSourceRoots = new Set(
    immutableSourcePaths.map((value) =>
      value.includes("/") ? value.split("/", 1)[0] : value,
    ),
  );
  const reservedPublicationTargets = new Set([
    ".gitignore",
    ...profiles.map(
      (profile) => `${profile.publication.artifactDirectory}/index.html`,
    ),
  ].map((value) =>
    validateNamespacePath(value, "reserved publication target"),
  ));

  for (const profile of profiles) {
    assertCanonicalProfileLayout(profile);
    const policyPath = validateNamespacePath(
      profile.ranking.policyPath,
      `${profile.id}.ranking.policyPath`,
    );
    const previousPolicyOwner = policyOwners.get(policyPath);
    if (previousPolicyOwner) {
      throw new Error(
        `profile-owned path collision: ${policyPath} is used by ` +
          `${previousPolicyOwner} and ${profile.id}.ranking.policyPath`,
      );
    }
    policyOwners.set(policyPath, `${profile.id}.ranking.policyPath`);

    const outputPaths = [
      ...Object.entries(profile.namespace)
        .filter(([key]) => key !== "artifactDirectory")
        .map(([key, value]) => [`namespace.${key}`, value]),
      [
        "namespace.artifact",
        `${profile.namespace.artifactDirectory}/index.html`,
      ],
    ];
    for (const [label, value] of outputPaths) {
      const normalizedPath = validateNamespacePath(
        value,
        `${profile.id}.${label}`,
      );
      const owner = `${profile.id}.${label}`;
      const topLevel = normalizedPath.split("/", 1)[0];
      if (
        immutableSourcePaths.some((sourcePath) =>
          pathsOverlap(normalizedPath, sourcePath),
        ) ||
        immutableSourceRoots.has(topLevel)
      ) {
        throw new Error(
          `profile output path overlaps immutable source: ${normalizedPath}`,
        );
      }
      for (const publicationTarget of reservedPublicationTargets) {
        if (pathsOverlap(normalizedPath, publicationTarget)) {
          throw new Error(
            `profile output path overlaps reserved publication target: ` +
              normalizedPath,
          );
        }
      }
      for (const [existingPath, existingOwner] of outputOwners) {
        if (pathsOverlap(normalizedPath, existingPath)) {
          throw new Error(
            `profile-owned path collision: ${normalizedPath} is used by ` +
              `${existingOwner} and ${owner}`,
          );
        }
      }
      outputOwners.set(normalizedPath, owner);
    }
  }
}

export async function loadEnabledMarketProfiles() {
  const registry = await loadMarketRegistry();
  const profiles = await Promise.all(
    registry.enabledMarkets.map((marketId) => loadMarketProfile(marketId)),
  );
  const uniqueProjectSlugs = new Set();
  const uniqueCanonicalUrls = new Set();
  const uniqueArtifactDirectories = new Set();
  assertUniqueProfileOwnedPaths(profiles);
  for (const profile of profiles) {
    const publicationKeys = [
      ["projectSlug", profile.publication.projectSlug, uniqueProjectSlugs],
      ["canonicalUrl", profile.publication.canonicalUrl, uniqueCanonicalUrls],
      [
        "artifactDirectory",
        profile.publication.artifactDirectory,
        uniqueArtifactDirectories,
      ],
    ];
    for (const [label, value, seen] of publicationKeys) {
      if (seen.has(value)) {
        throw new Error(`enabled markets must have unique publication ${label}`);
      }
      seen.add(value);
    }
  }
  return { registry, profiles };
}

export function resolveProfilePath(profile, profilePath) {
  validateNamespacePath(profilePath, "profile path");
  return resolve(projectRoot, profilePath);
}

export function marketIdFromArgv(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      market: { type: "string", default: DEFAULT_MARKET_ID },
    },
  });
  return values.market;
}

export async function loadMarketContext(
  marketId = DEFAULT_MARKET_ID,
  {
    namespaceRoot = process.env.MACBOOK_NAMESPACE_ROOT,
  } = {},
) {
  const profile = await loadMarketProfile(marketId);
  const paths = Object.fromEntries(
    Object.entries(profile.namespace)
      .filter(([key]) => key !== "artifactDirectory")
      .map(([key, value]) => [
        key,
        namespaceRoot
          ? resolve(namespaceRoot, value)
          : resolveProfilePath(profile, value),
      ]),
  );
  paths.artifactDirectory = namespaceRoot
    ? resolve(namespaceRoot, profile.namespace.artifactDirectory)
    : resolveProfilePath(profile, profile.namespace.artifactDirectory);
  paths.artifact = resolve(paths.artifactDirectory, "index.html");
  return {
    profile,
    paths,
    policyPath: resolveProfilePath(profile, profile.ranking.policyPath),
  };
}
