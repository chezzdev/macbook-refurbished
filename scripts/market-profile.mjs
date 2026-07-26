import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

export const DEFAULT_MARKET_ID = "sg";
export const projectRoot = resolve(import.meta.dirname, "..");

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
    profile.tax?.availabilityPolicy !== "catalog-wide" ||
    profile.tax?.filterByDeliveryOrPickup !== false
  ) {
    throw new Error(
      "market profiles must keep catalog scope independent of delivery and pickup",
    );
  }
  if (profile.tax?.model === "apple-checkout-reference-location") {
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
    if (profile.tax.taxInclusiveSourcePolicy !== "apple-flow-only") {
      throw new Error(
        "reference-location tax-inclusive prices must use Apple flow provenance",
      );
    }
    if (
      profile.tax.acquisition?.adapter !== "apple-checkout" ||
      !["available", "unavailable"].includes(profile.tax.acquisition?.status)
    ) {
      throw new Error(
        "reference-location tax acquisition must declare Apple checkout status",
      );
    }
    requireString(
      profile.currency.priceFields.taxInclusive,
      "currency.priceFields.taxInclusive",
    );
  } else if (profile.tax?.model !== "included-in-list-price") {
    throw new Error(`unsupported tax model: ${profile.tax?.model}`);
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
  validateNamespacePath(
    profile.publication?.checkoutPath,
    "publication.checkoutPath",
  );
  validateNamespacePath(
    profile.publication?.artifactDirectory,
    "publication.artifactDirectory",
  );
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
  if (profile.id === "sg") {
    if (
      profile.siteName !== "MacBook SG Refurbished" ||
      profile.publication.productionUrl !==
        "https://macbook-sg-refurbished.pages.dev/" ||
      profile.publication.projectSlug !== "macbook-sg-refurbished" ||
      profile.publication.repository !==
        "git@github.com:chezzdev/macbook-refurbished-sg.git" ||
      profile.publication.checkoutPath !== "work/gh-pages-site" ||
      profile.publication.artifactDirectory !== "markets/sg" ||
      profile.publication.canonicalUrl !==
        "https://macbook-sg-refurbished.pages.dev/" ||
      profile.publication.approvalRequired !== false
    ) {
      throw new Error("Singapore publication identity is immutable");
    }
  }
  if (profile.id === "us") {
    if (
      profile.siteName !== "MacBook US Refurbished" ||
      profile.publication.repository !==
        "git@github.com:chezzdev/macbook-refurbished-sg.git" ||
      profile.publication.checkoutPath !== "work/gh-pages-site" ||
      profile.publication.artifactDirectory !== "markets/us" ||
      profile.publication.projectSlug !== "macbook-us-refurbished" ||
      profile.publication.canonicalUrl !==
        "https://macbook-us-refurbished.pages.dev/" ||
      profile.publication.plannedUrl !==
        "https://macbook-us-refurbished.pages.dev/"
    ) {
      throw new Error("US publication identity does not match its approved plan");
    }
    if (profile.publication.approvalRequired === true) {
      if (
        profile.publication.status !== "approval-required" ||
        profile.publication.productionUrl !== null
      ) {
        throw new Error("Unapproved US publication must remain fail-closed");
      }
    } else if (profile.publication.status === "approved-pending-provision") {
      if (
        profile.publication.provider !== "sites" ||
        profile.publication.productionUrl !== null
      ) {
        throw new Error(
          "US provision-pending publication must use Sites without a production URL",
        );
      }
    } else if (
      profile.publication.status !== "active" ||
      typeof profile.publication.productionUrl !== "string" ||
      profile.publication.productionUrl.length === 0
    ) {
      throw new Error(
        "Approved US publication must declare an active repository and production URL",
      );
    }
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

export async function loadEnabledMarketProfiles() {
  const registry = await loadMarketRegistry();
  const profiles = await Promise.all(
    registry.enabledMarkets.map((marketId) => loadMarketProfile(marketId)),
  );
  const uniqueProjectSlugs = new Set();
  const uniqueCanonicalUrls = new Set();
  const uniqueArtifactDirectories = new Set();
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
          ? resolve(namespaceRoot, basename(value))
          : resolveProfilePath(profile, value),
      ]),
  );
  paths.artifactDirectory = namespaceRoot
    ? resolve(namespaceRoot)
    : resolveProfilePath(profile, profile.namespace.artifactDirectory);
  paths.artifact = resolve(paths.artifactDirectory, "index.html");
  return {
    profile,
    paths,
    policyPath: resolveProfilePath(profile, profile.ranking.policyPath),
  };
}
