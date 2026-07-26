import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildCatalog,
  calculateFixedLocationTaxEstimate,
  hydrateTaxInclusivePrices,
  parseExactNewPriceHtml,
  parseRefurbishedCatalog,
  validateCatalog,
} from "../scripts/apple-catalog-lib.mjs";
import {
  buildInitialSiteDocument,
  initializeMarketNamespace,
} from "../scripts/initialize-market.mjs";
import { buildMarketDisplayCopy } from "../scripts/market-display-copy.mjs";
import {
  assertUniqueProfileOwnedPaths,
  loadEnabledMarketProfiles,
  loadMarketContext,
  loadMarketProfile,
  validateMarketProfile,
  validateMarketRegistry,
} from "../scripts/market-profile.mjs";
import { buildPublicationManifest } from "../scripts/publication-manifest.mjs";
import {
  rankCatalog,
  renderFeaturedJson,
} from "../scripts/rank-models.mjs";
import { updateExchangeRate } from "../scripts/update-exchange-rate.mjs";
import { buildCatalogDelta } from "../scripts/update-changelog.mjs";

const [sg, us, sgContext, usContext, enabledMarketState] = await Promise.all([
  loadMarketProfile("sg"),
  loadMarketProfile("us"),
  loadMarketContext("sg"),
  loadMarketContext("us"),
  loadEnabledMarketProfiles(),
]);
const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const [sgPolicy, usPolicy] = await Promise.all([
  readFile(sgContext.policyPath, "utf8").then(JSON.parse),
  readFile(usContext.policyPath, "utf8").then(JSON.parse),
]);

function tile({
  productCode,
  marketId,
  colour = "Midnight",
  price = 1999,
  storage = "1TB",
  screenInches = 13,
}) {
  return {
    partNumber: productCode,
    productDetailsUrl:
      marketId === "sg"
        ? `/sg/shop/product/${productCode.toLowerCase()}`
        : `/shop/product/${productCode.toLowerCase()}`,
    title:
      `Refurbished ${screenInches}‑inch MacBook Air Apple M5 chip with ` +
      `10‑Core CPU and 10‑Core GPU - ${colour}`,
    filters: {
      dimensions: {
        refurbClearModel: "macbookair",
        dimensionScreensize: `${screenInches}inch`,
        dimensionColor: colour,
        dimensionRelYear: "2026",
        tsMemorySize: "24GB",
        dimensionCapacity: storage,
      },
    },
    price: { currentPrice: { amount: String(price) } },
  };
}

function parseTiles(tiles, profile) {
  return parseRefurbishedCatalog(
    `<script>{"tiles":${JSON.stringify(tiles)}}</script>`,
    profile,
  );
}

function rankingCatalog(profile) {
  const priceField = profile.currency.priceFields.refurbished;
  const newField = profile.currency.priceFields.new;
  const base = {
    configurationKey: "air|13|standard|m5|10|10|24gb|1tb",
    productCode: `${profile.id.toUpperCase()}-IDEAL`,
    family: "Air",
    screen: "13″",
    display: "Standard",
    chip: "M5",
    cpuCores: 10,
    gpuCores: 10,
    memory: "24GB",
    storage: "1TB",
    [priceField]: profile.id === "sg" ? 2100 : 1650,
    [newField]: profile.id === "sg" ? 2400 : 1900,
  };
  const products = [
    base,
    {
      ...base,
      productCode: `${profile.id.toUpperCase()}-IDEAL-COLOUR`,
    },
    {
      ...base,
      configurationKey: "air|13|standard|m5|10|10|24gb|512gb",
      productCode: `${profile.id.toUpperCase()}-512`,
      storage: "512GB",
      [priceField]: profile.id === "sg" ? 1800 : 1400,
      [newField]: profile.id === "sg" ? 2050 : 1600,
    },
    {
      ...base,
      configurationKey: "air|15|standard|m5|10|10|24gb|1tb",
      productCode: `${profile.id.toUpperCase()}-15`,
      screen: "15″",
      [priceField]: profile.id === "sg" ? 2500 : 1950,
      [newField]: profile.id === "sg" ? 2800 : 2200,
    },
    {
      ...base,
      configurationKey: "pro|14|standard|m5-pro|12|16|24gb|1tb",
      productCode: `${profile.id.toUpperCase()}-PRO`,
      family: "Pro",
      screen: "14″",
      chip: "M5 Pro",
      cpuCores: 12,
      gpuCores: 16,
      [priceField]: profile.id === "sg" ? 3200 : 2500,
      [newField]: profile.id === "sg" ? 3600 : 2900,
    },
  ];
  return { schemaVersion: 1, products };
}

test("Singapore and US are equal first-class profiles with isolated state", () => {
  const commonShape = (profile) => ({
    topLevel: Object.keys(profile).sort(),
    storefront: Object.keys(profile.storefront).sort(),
    currency: Object.keys(profile.currency).sort(),
    priceFields: Object.keys(profile.currency.priceFields).sort(),
    namespace: Object.keys(profile.namespace).sort(),
    publication: Object.keys(profile.publication).sort(),
  });
  assert.deepEqual(commonShape(sg), commonShape(us));
  assert.equal(sg.currency.priceFields.taxInclusive, null);
  assert.equal(sg.currency.priceFields.newTaxInclusive, null);
  assert.equal(us.currency.priceFields.taxInclusive, "taxInclusivePriceUsd");
  assert.equal(
    us.currency.priceFields.newTaxInclusive,
    "newTaxInclusivePriceUsd",
  );
  assert.equal(sg.siteName, "MacBook SG Refurbished");
  assert.equal(us.siteName, "MacBook US Refurbished");
  assert.equal(
    buildInitialSiteDocument(sg).pageTitle,
    sg.pageTitle,
  );
  assert.equal(
    buildInitialSiteDocument(us).pageTitle,
    us.pageTitle,
  );
  assert.equal(
    sg.publication.productionUrl,
    "https://macbook-sg-refurbished.pages.dev/",
  );
  assert.equal(
    us.publication.productionUrl,
    "https://macbook-us-refurbished.pages.dev/",
  );
  assert.equal(sg.publication.provider, "cloudflare-pages");
  assert.equal(us.publication.provider, "cloudflare-pages");
  assert.equal(us.publication.approvalRequired, false);
  assert.equal(us.publication.status, "active");
  assert.deepEqual(
    enabledMarketState.profiles.map((profile) => profile.id),
    enabledMarketState.registry.enabledMarkets,
  );
  assert.ok(enabledMarketState.registry.enabledMarkets.includes("sg"));
  assert.ok(enabledMarketState.registry.enabledMarkets.includes("us"));
  assert.equal(
    sg.publication.repository,
    us.publication.repository,
  );
  assert.equal(
    sg.publication.checkoutPath,
    us.publication.checkoutPath,
  );
  assert.notEqual(
    sg.publication.projectSlug,
    us.publication.projectSlug,
  );
  assert.equal(
    sg.namespace.artifactDirectory,
    "outputs/markets/sg",
  );
  assert.equal(
    sg.namespace.catalog,
    "data/markets/sg/catalog.json",
  );
  assert.equal(
    sg.ranking.policyPath,
    "config/ranking-policy.sg.json",
  );
  assert.equal(
    us.namespace.artifactDirectory,
    "outputs/markets/us",
  );
  assert.equal(
    sg.publication.artifactDirectory,
    "markets/sg",
  );
  assert.equal(
    us.publication.artifactDirectory,
    "markets/us",
  );
  assert.equal(
    sg.namespace.artifactDirectory.replace("/sg", "/<market>"),
    us.namespace.artifactDirectory.replace("/us", "/<market>"),
  );
  assert.equal(
    sg.namespace.catalog.replace("/sg/", "/<market>/"),
    us.namespace.catalog.replace("/us/", "/<market>/"),
  );
  assert.equal(
    sg.ranking.policyPath.replace(".sg.", ".<market>."),
    us.ranking.policyPath.replace(".us.", ".<market>."),
  );
  assert.equal(
    sg.publication.artifactDirectory.replace("/sg", "/<market>"),
    us.publication.artifactDirectory.replace("/us", "/<market>"),
  );
  assert.notEqual(sgContext.paths.catalog, usContext.paths.catalog);
  assert.notEqual(sgContext.paths.artifact, usContext.paths.artifact);
  assert.notEqual(sgContext.policyPath, usContext.policyPath);
  assert.deepEqual(sgPolicy.ideal, sg.ranking.reference);
  assert.deepEqual(usPolicy.ideal, us.ranking.reference);
});

test("third-market copy is driven by country and display currency", () => {
  const futureProfile = structuredClone(us);
  futureProfile.id = "ca";
  futureProfile.storefront.countryCode = "CA";
  futureProfile.storefront.countryName = "Canada";
  futureProfile.currency.source = "CAD";
  futureProfile.currency.display = "EUR";
  futureProfile.currency.displayLocale = "de-DE";

  const fixedEstimateCopy = buildMarketDisplayCopy(futureProfile, {
    hasVerifiedTaxEstimate: true,
    hasReferenceLocationTax: true,
    taxLocationName: "Apple Toronto",
    rateDateFormatted: "26.07.2026",
    rateDateLong: "26 июля 2026 года",
  });
  assert.match(fixedEstimateCopy.heroMarketCopy, /^В CA /);
  assert.doesNotMatch(fixedEstimateCopy.heroMarketCopy, /\bUS\b/);
  assert.equal(fixedEstimateCopy.currencyMethodHeading, "EUR — ориентир");

  const convertedCopy = buildMarketDisplayCopy(futureProfile, {
    hasVerifiedTaxEstimate: false,
    hasReferenceLocationTax: false,
    rateDateFormatted: "26.07.2026",
    rateDateLong: "26 июля 2026 года",
  });
  assert.match(convertedCopy.heroCurrencyCopy, /до 1 EUR$/);
  assert.match(convertedCopy.heroMarketCopy, /Цены в EUR/);
  assert.doesNotMatch(convertedCopy.heroCurrencyCopy, /\$1|USD/);
  assert.equal(convertedCopy.currencyMethodHeading, "EUR — ориентир");
  assert.match(convertedCopy.currencyMethodBody, /кросс-курсу/);
});

test("conversion type is consistent with source and display currencies", () => {
  const mismatchedIdentity = structuredClone(us);
  mismatchedIdentity.currency.source = "CAD";
  assert.throws(
    () => validateMarketProfile(mismatchedIdentity),
    /identity currency conversion requires matching source\/display currencies/,
  );

  const sameCurrencyCrossRate = structuredClone(sg);
  sameCurrencyCrossRate.currency.display = "SGD";
  assert.throws(
    () => validateMarketProfile(sameCurrencyCrossRate),
    /cbr-cross-rate conversion requires different source\/display currencies/,
  );
});

test("identity tax-included market renders no conversion methodology", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "macbook-jp-build-"));
  const copiedProject = join(fixtureRoot, "project");
  const namespaceRoot = join(fixtureRoot, "state");
  try {
    await mkdir(join(copiedProject, "work"), { recursive: true });
    await Promise.all([
      cp(join(projectRoot, "scripts"), join(copiedProject, "scripts"), {
        recursive: true,
      }),
      cp(
        join(projectRoot, "config/markets"),
        join(copiedProject, "config/markets"),
        { recursive: true },
      ),
      cp(
        join(projectRoot, "work/build-expanded-standalone.mjs"),
        join(copiedProject, "work/build-expanded-standalone.mjs"),
        { recursive: true },
      ),
    ]);

    const profile = structuredClone(sg);
    profile.id = "jp";
    profile.siteName = "MacBook JP Refurbished";
    profile.pageTitle = "MacBook JP Refurbished — comparison";
    profile.storefront = {
      countryCode: "JP",
      countryName: "Japan",
      baseUrl: "https://www.apple.com/jp",
      refurbishedCatalogUrl:
        "https://www.apple.com/jp/shop/refurbished/mac",
      newCatalogBaseUrl: "https://www.apple.com/jp/shop/buy-mac",
    };
    profile.currency = {
      source: "JPY",
      display: "JPY",
      sourceFractionDigits: 0,
      displayFractionDigits: 0,
      displayLocale: "ja-JP",
      secondarySymbol: null,
      secondaryLocale: "ja-JP",
      priceFields: {
        refurbished: "priceJpy",
        new: "newPriceJpy",
        taxInclusive: null,
        newTaxInclusive: null,
      },
      conversion: {
        type: "identity",
        siteField: null,
      },
    };
    profile.ranking.policyPath = "config/ranking-policy.jp.json";
    profile.namespace = {
      catalog: "data/markets/jp/catalog.json",
      featured: "data/markets/jp/featured.json",
      site: "data/markets/jp/site.json",
      updateStatus: "data/markets/jp/update-status.json",
      updateDelta: "data/markets/jp/update-delta.json",
      changelog: "data/markets/jp/changelog.json",
      artifactDirectory: "outputs/markets/jp",
    };
    profile.publication = {
      ...profile.publication,
      projectSlug: "macbook-jp-refurbished",
      artifactDirectory: "markets/jp",
      productionUrl: "https://macbook-jp-refurbished.pages.dev/",
      canonicalUrl: "https://macbook-jp-refurbished.pages.dev/",
    };
    validateMarketProfile(profile);

    const registryPath = join(
      copiedProject,
      "config/markets/registry.json",
    );
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.enabledMarkets.push("jp");
    await writeFile(
      registryPath,
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(copiedProject, "config/markets/jp.json"),
      `${JSON.stringify(profile, null, 2)}\n`,
      "utf8",
    );

    const sourceProducts = JSON.parse(
      await readFile(sgContext.paths.catalog, "utf8"),
    ).products.slice(0, 3);
    const products = sourceProducts.map((product, index) => {
      const copy = {
        ...product,
        productCode: `JP-${index + 1}`,
        priceJpy: 200000 + index * 10000,
        newPriceJpy: null,
        newSourceUrl: null,
      };
      delete copy.priceSgd;
      delete copy.newPriceSgd;
      return copy;
    });
    const checkedAt = "2026-07-26T12:00:00.000Z";
    const documents = new Map([
      [profile.namespace.catalog, {
        schemaVersion: 1,
        marketId: "jp",
        source: {
          refurbishedCatalogUrl:
            profile.storefront.refurbishedCatalogUrl,
          newCatalogBaseUrl: profile.storefront.newCatalogBaseUrl,
          tax: {
            model: "included-in-list-price",
            acquisition: null,
            referenceLocation: null,
            availabilityPolicy: "catalog-wide",
            filterByDeliveryOrPickup: false,
          },
        },
        products,
      }],
      [profile.namespace.featured, {
        schemaVersion: 1,
        items: products.map((product, index) => ({
          rank: index + 1,
          configurationKey: product.configurationKey,
          productCode: product.productCode,
          score: 90000 - index,
          label: `Choice ${index + 1}`,
          headline: product.title,
          reason: "Synthetic identity-market fixture",
        })),
      }],
      [profile.namespace.site, buildInitialSiteDocument(profile)],
      [profile.namespace.updateStatus, {
        schemaVersion: 1,
        status: "success",
        checkedAt,
        counts: {
          products: products.length,
          air: products.filter((product) => product.family === "Air").length,
          pro: products.filter((product) => product.family === "Pro").length,
        },
      }],
      [profile.namespace.changelog, {
        schemaVersion: 1,
        latestRun: {
          schemaVersion: 1,
          checkedAt,
          hasChanges: false,
          counts: {
            added: 0,
            removed: 0,
            refurbPriceChanges: 0,
            newPriceChanges: 0,
            configurationChanges: 0,
            featuredChanges: 0,
          },
          added: [],
          removed: [],
          refurbPriceChanges: [],
          newPriceChanges: [],
          configurationChanges: [],
          featured: null,
        },
        entries: [],
      }],
    ]);
    for (const [relativePath, document] of documents) {
      const filePath = join(namespaceRoot, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        `${JSON.stringify(document, null, 2)}\n`,
        "utf8",
      );
    }

    await execFileAsync(
      process.execPath,
      ["work/build-expanded-standalone.mjs", "--market", "jp"],
      {
        cwd: copiedProject,
        env: {
          ...process.env,
          MACBOOK_NAMESPACE_ROOT: namespaceRoot,
        },
      },
    );
    const html = await readFile(
      join(namespaceRoot, profile.namespace.artifactDirectory, "index.html"),
      "utf8",
    );
    assert.match(html, /JPY — основная валюта/);
    assert.match(
      html,
      /Цены Apple уже указаны в JPY; пересчёт по кросс-курсу не применяется\./,
    );
    assert.doesNotMatch(
      html,
      /Конвертация сделана по официальному кросс-курсу/,
    );
    assert.doesNotMatch(html, /JPY — ориентир/);
    assert.match(html, /Цены Apple и все сравнения показаны в JPY\./);
    assert.doesNotMatch(html, /исходные JPY — рядом/);
    assert.match(html, /￥200,000/);
    assert.doesNotMatch(html, /￥200,000\.00/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("enabled-market registry rejects ambiguous profile lists", () => {
  assert.throws(
    () =>
      validateMarketRegistry({
        schemaVersion: 1,
        defaultMarket: "sg",
        enabledMarkets: ["sg", "sg"],
      }),
    /duplicate enabled market id/,
  );
  assert.throws(
    () =>
      validateMarketRegistry({
        schemaVersion: 1,
        defaultMarket: "us",
        enabledMarkets: ["sg"],
      }),
    /defaultMarket must be enabled/,
  );
});

test("workflow config selects one shared checkout and each market artifact", async () => {
  const configurations = await Promise.all(
    enabledMarketState.registry.enabledMarkets.map(async (marketId) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["scripts/print-market-workflow-config.mjs", marketId],
        { cwd: projectRoot },
      );
      return stdout.trim().split("\u001f");
    }),
  );
  const configurationsById = new Map(
    configurations.map((configuration) => [configuration[0], configuration]),
  );
  const sgWorkflow = configurationsById.get("sg");
  const usWorkflow = configurationsById.get("us");
  assert.equal(sgWorkflow[9], "outputs/markets/sg");
  assert.equal(usWorkflow[9], "outputs/markets/us");
  assert.equal(sgWorkflow[14], usWorkflow[14]);
  assert.equal(sgWorkflow[15], usWorkflow[15]);
  assert.equal(sgWorkflow[16], "markets/sg");
  assert.equal(usWorkflow[16], "markets/us");
  assert.equal(sgWorkflow[18], "false");
  assert.equal(usWorkflow[18], "false");
  assert.equal(sgWorkflow[12], "cloudflare-pages");
  assert.equal(usWorkflow[12], "cloudflare-pages");
});

test("publication workflow shares one lock and keeps prepare-only non-canonical", async () => {
  const [perMarketWorkflow, allMarketsWorkflow] = await Promise.all([
    readFile(
      join(projectRoot, "work/update-market-site.zsh"),
      "utf8",
    ),
    readFile(
      join(projectRoot, "work/update-all-markets.zsh"),
      "utf8",
    ),
  ]);
  assert.match(perMarketWorkflow, /\.publication-update\.lock/);
  assert.match(allMarketsWorkflow, /\.publication-update\.lock/);
  assert.match(
    perMarketWorkflow,
    /MACBOOK_PUBLICATION_LOCK_OWNER:-market-\$\{market_id\}-\$\$/,
  );
  assert.match(
    allMarketsWorkflow,
    /export MACBOOK_PUBLICATION_LOCK_OWNER=/,
  );
  assert.match(
    allMarketsWorkflow,
    /batch_source_head="\$\(git -C "\$workspace_dir" rev-parse HEAD\)"/,
  );
  assert.match(
    allMarketsWorkflow,
    /export MACBOOK_SOURCE_HEAD="\$batch_source_head"/,
  );
  assert.match(
    allMarketsWorkflow,
    /"\$\{batch_snapshot_dir\}\/work\/update-market-site\.zsh"/,
  );

  const prepareOnlyBranch = perMarketWorkflow.slice(
    perMarketWorkflow.indexOf('if [[ "$prepare_only" == "true" ]]'),
    perMarketWorkflow.indexOf('print "6/8 Syncing'),
  );
  assert.ok(prepareOnlyBranch.length > 0);
  assert.doesNotMatch(prepareOnlyBranch, /promote_staged_outputs/);
  assert.match(prepareOnlyBranch, /Prepared artifact:/);
  assert.match(
    perMarketWorkflow,
    /node_modules\/\.bin\/wrangler/,
  );
  assert.doesNotMatch(perMarketWorkflow, /npx --yes/);
  assert.match(perMarketWorkflow, /--immutable-source/);
  assert.match(perMarketWorkflow, /--retired/);
  assert.match(perMarketWorkflow, /retired_publication_paths/);
  assert.match(perMarketWorkflow, /ls-files --error-unmatch/);
  assert.match(
    perMarketWorkflow,
    /Live publication refuses uncommitted source\/config changes/,
  );
  assert.match(perMarketWorkflow, /git -C "\$workspace_dir" archive "\$source_head"/);
  assert.match(perMarketWorkflow, /execution_root="\$source_snapshot_dir"/);
  assert.match(
    perMarketWorkflow,
    /source_file="\$\{execution_root\}\/\$\{relative_file\}"/,
  );
  assert.match(
    perMarketWorkflow,
    /staged_file="\$\{staging_dir\}\/\$\{relative_file\}"/,
  );
  assert.doesNotMatch(perMarketWorkflow, /relative_file:t/);
});

test("publication manifest derives every market path from enabled profiles", () => {
  const futureProfile = structuredClone(us);
  futureProfile.id = "ca";
  futureProfile.publication.projectSlug = "macbook-ca-refurbished";
  futureProfile.ranking.policyPath = "config/ranking-policy.ca.json";
  futureProfile.namespace = {
    catalog: "data/markets/ca/catalog.json",
    featured: "data/markets/ca/featured.json",
    site: "data/markets/ca/site.json",
    updateStatus: "data/markets/ca/update-status.json",
    updateDelta: "data/markets/ca/update-delta.json",
    changelog: "data/markets/ca/changelog.json",
    artifactDirectory: "outputs/markets/ca",
  };
  futureProfile.publication.artifactDirectory = "markets/ca";
  const manifest = buildPublicationManifest([sg, us, futureProfile]);

  assert.deepEqual(manifest.marketIds, ["sg", "us", "ca"]);
  for (const expectedPath of [
    "config/markets/ca.json",
    "config/ranking-policy.ca.json",
    "data/markets/ca/catalog.json",
    "data/markets/ca/changelog.json",
    "markets/ca/index.html",
  ]) {
    assert.ok(
      manifest.publicationPaths.includes(expectedPath),
      `missing ${expectedPath}`,
    );
  }
  for (const retiredPath of [
    "config/ranking-policy.json",
    "data/catalog.json",
    "data/changelog.json",
    "data/featured.json",
    "data/site.json",
    "data/update-delta.json",
    "data/update-status.json",
    "index.html",
  ]) {
    assert.ok(manifest.retiredPublicationPaths.includes(retiredPath));
    assert.ok(manifest.publicationPaths.includes(retiredPath));
  }
  assert.ok(
    manifest.immutableSourcePaths.includes("config/markets/ca.json"),
  );
  assert.ok(
    manifest.immutableSourcePaths.includes("config/ranking-policy.ca.json"),
  );
  assert.ok(
    !manifest.immutableSourcePaths.includes("data/markets/ca/catalog.json"),
  );
});

test("enabled market profiles cannot share state or policy paths", () => {
  const collidingMarket = structuredClone(us);
  collidingMarket.id = "ca";
  collidingMarket.ranking.policyPath = "config/ranking-policy.ca.json";
  assert.throws(
    () => assertUniqueProfileOwnedPaths([sg, us, collidingMarket]),
    /ca\.namespace\.catalog must be data\/markets\/ca\/catalog\.json/,
  );

  const internallyCollidingMarket = structuredClone(us);
  internallyCollidingMarket.id = "ca";
  internallyCollidingMarket.ranking.policyPath =
    "config/ranking-policy.ca.json";
  internallyCollidingMarket.namespace = {
    ...internallyCollidingMarket.namespace,
    catalog: "data/markets/ca/catalog.json",
    featured: "data/markets/ca/catalog.json",
    site: "data/markets/ca/site.json",
    updateStatus: "data/markets/ca/update-status.json",
    updateDelta: "data/markets/ca/update-delta.json",
    changelog: "data/markets/ca/changelog.json",
    artifactDirectory: "outputs/markets/ca",
  };
  assert.throws(
    () => assertUniqueProfileOwnedPaths([internallyCollidingMarket]),
    /ca\.namespace\.featured must be data\/markets\/ca\/featured\.json/,
  );

  const baseFutureMarket = structuredClone(us);
  baseFutureMarket.id = "ca";
  baseFutureMarket.publication.projectSlug = "macbook-ca-refurbished";
  baseFutureMarket.ranking.policyPath = "config/ranking-policy.ca.json";
  baseFutureMarket.namespace = {
    catalog: "data/markets/ca/catalog.json",
    featured: "data/markets/ca/featured.json",
    site: "data/markets/ca/site.json",
    updateStatus: "data/markets/ca/update-status.json",
    updateDelta: "data/markets/ca/update-delta.json",
    changelog: "data/markets/ca/changelog.json",
    artifactDirectory: "outputs/markets/ca",
  };
  baseFutureMarket.publication.artifactDirectory = "markets/ca";
  assert.doesNotThrow(() => validateMarketProfile(baseFutureMarket));

  const aliasedMarket = structuredClone(baseFutureMarket);
  aliasedMarket.namespace.catalog = "data/markets/ca/./catalog.json";
  assert.throws(
    () => assertUniqueProfileOwnedPaths([aliasedMarket]),
    /ca\.namespace\.catalog must be data\/markets\/ca\/catalog\.json/,
  );

  const artifactCollisionMarket = structuredClone(baseFutureMarket);
  artifactCollisionMarket.namespace.catalog =
    "outputs/markets/ca/index.html";
  assert.throws(
    () => assertUniqueProfileOwnedPaths([artifactCollisionMarket]),
    /ca\.namespace\.catalog must be data\/markets\/ca\/catalog\.json/,
  );

  const sourceCollisionMarket = structuredClone(baseFutureMarket);
  sourceCollisionMarket.namespace.catalog = "scripts/market-profile.mjs";
  assert.throws(
    () => assertUniqueProfileOwnedPaths([sourceCollisionMarket]),
    /ca\.namespace\.catalog must be data\/markets\/ca\/catalog\.json/,
  );

  const publicationCollisionMarket = structuredClone(baseFutureMarket);
  publicationCollisionMarket.namespace.catalog = "markets/ca/index.html";
  assert.throws(
    () => assertUniqueProfileOwnedPaths([publicationCollisionMarket]),
    /ca\.namespace\.catalog must be data\/markets\/ca\/catalog\.json/,
  );

  const rootCollisionMarket = structuredClone(baseFutureMarket);
  rootCollisionMarket.namespace.catalog = ".gitignore";
  assert.throws(
    () => assertUniqueProfileOwnedPaths([rootCollisionMarket]),
    /ca\.namespace\.catalog must be data\/markets\/ca\/catalog\.json/,
  );

  const caseAliasMarket = structuredClone(sg);
  caseAliasMarket.namespace.catalog = "DATA/CATALOG.JSON";
  assert.throws(
    () => validateMarketProfile(caseAliasMarket),
    /sg\.namespace\.catalog must be data\/markets\/sg\/catalog\.json/,
  );

  const splitRepositoryMarket = structuredClone(baseFutureMarket);
  splitRepositoryMarket.publication.repository =
    "git@github.com:chezzdev/macbook-refurbished-ca.git";
  assert.throws(
    () => validateMarketProfile(splitRepositoryMarket),
    /must use the unified Cloudflare publication repository/,
  );
});

test("staging preserves complete profile-relative namespace paths", async () => {
  const stagingRoot = join(tmpdir(), "profile-stage-layout");
  const stagedContext = await loadMarketContext("us", {
    namespaceRoot: stagingRoot,
  });
  assert.equal(
    stagedContext.paths.catalog,
    join(stagingRoot, "data/markets/us/catalog.json"),
  );
  assert.equal(
    stagedContext.paths.artifact,
    join(stagingRoot, "outputs/markets/us/index.html"),
  );
  const stagedSgContext = await loadMarketContext("sg", {
    namespaceRoot: stagingRoot,
  });
  assert.equal(
    stagedSgContext.paths.catalog,
    join(stagingRoot, "data/markets/sg/catalog.json"),
  );
  assert.equal(
    stagedSgContext.paths.artifact,
    join(stagingRoot, "outputs/markets/sg/index.html"),
  );
});

test("both profiles use the same parser, exact-match, catalog, and ranking path", () => {
  for (const [profile, policy] of [
    [sg, sgPolicy],
    [us, usPolicy],
  ]) {
    const [parsed] = parseTiles(
      [tile({ productCode: `${profile.id}-ONE`, marketId: profile.id })],
      profile,
    );
    const priceField = profile.currency.priceFields.refurbished;
    const newField = profile.currency.priceFields.new;
    assert.equal(parsed[priceField], 1999);
    assert.equal(parsed[newField], null);
    assert.match(parsed.sourceUrl, new RegExp(profile.storefront.baseUrl));

    const exactHtml =
      "<title>Buy 13-inch MacBook Air - Apple M5 chip, 10-core CPU, " +
      "10-core GPU, 24GB memory, 1TB storage</title>" +
      `<script>{"priceCurrency":"${profile.currency.source}","price":2199}</script>`;
    assert.equal(parseExactNewPriceHtml(exactHtml, parsed, profile), 2199);
    assert.throws(
      () =>
        parseExactNewPriceHtml(
          exactHtml.replace("24GB memory", "16GB memory"),
          parsed,
          profile,
        ),
      /24gb memory/,
    );

    const ranked = rankCatalog(rankingCatalog(profile), policy, profile);
    assert.equal(ranked.items.length, 3);
    assert.equal(
      ranked.items.filter((item) =>
        item.productCode.includes("IDEAL"),
      ).length,
      1,
    );
  }
});

test("US fixed-location estimate reproduces Apple checkout and screen fees", async () => {
  const products = parseTiles(
    [
      tile({ productCode: "US-TAX-1", marketId: "us", price: 1500 }),
      tile({
        productCode: "US-TAX-2",
        marketId: "us",
        colour: "Sky Blue",
        price: 1600,
        screenInches: 15,
      }),
    ],
    us,
  );
  products[0].newPriceUsd = 1799;
  products[0].newSourceUrl =
    "https://www.apple.com/shop/buy-mac/macbook-air/13-inch";
  const estimated = await hydrateTaxInclusivePrices(products, {
    marketProfile: us,
  });
  const sgCatalog = buildCatalog(
    parseTiles(
      [tile({ productCode: "SG-SCHEMA", marketId: "sg", price: 1500 })],
      sg,
    ),
    sg,
  );
  const usCatalog = buildCatalog(estimated.products, us);
  assert.deepEqual(
    Object.keys(sgCatalog).sort(),
    Object.keys(usCatalog).sort(),
  );
  assert.deepEqual(
    Object.keys(sgCatalog.source).sort(),
    Object.keys(usCatalog.source).sort(),
  );
  assert.equal(sgCatalog.marketId, "sg");
  assert.equal(usCatalog.marketId, "us");
  assert.equal(sgCatalog.source.tax.model, sg.tax.model);
  assert.equal(usCatalog.source.tax.model, us.tax.model);
  assert.equal(estimated.products.length, products.length);
  assert.equal(estimated.estimatedCount, products.length);
  assert.equal(estimated.resolvedCount, 0);
  assert.equal(estimated.unresolvedCount, 0);
  assert.equal(estimated.products[0].taxInclusivePricing.salesTaxAmount, 157.5);
  assert.equal(estimated.products[0].taxInclusivePricing.recyclingFeeAmount, 4);
  assert.equal(estimated.products[0].taxInclusivePriceUsd, 1661.5);
  assert.equal(
    estimated.products[0].newTaxInclusivePricing.salesTaxAmount,
    188.9,
  );
  assert.equal(
    estimated.products[0].newTaxInclusivePricing.recyclingFeeAmount,
    4,
  );
  assert.equal(estimated.products[0].newTaxInclusivePriceUsd, 1991.9);
  assert.equal(estimated.products[1].taxInclusivePricing.salesTaxAmount, 168);
  assert.equal(estimated.products[1].taxInclusivePricing.recyclingFeeAmount, 5);
  assert.equal(estimated.products[1].taxInclusivePriceUsd, 1773);
  assert.equal(estimated.products[1].newTaxInclusivePriceUsd, null);
  assert.equal(estimated.products[1].newTaxInclusivePricing, null);
  for (const product of estimated.products) {
    assert.equal(product.taxInclusivePricing.status, "estimated");
    assert.equal(product.taxInclusivePricing.locationId, "apple-beverly-center");
    assert.equal(
      product.taxInclusivePricing.provenance.provider,
      "Calculated estimate",
    );
  }
  assert.equal(validateCatalog(usCatalog, us), true);
  const tamperedTax = structuredClone(usCatalog);
  tamperedTax.source.tax.model = "included-in-list-price";
  assert.throws(
    () => validateCatalog(tamperedTax, us),
    /tax metadata does not match/,
  );

  const checkoutExample = {
    ...products[0],
    priceUsd: 1529,
    screen: "13″",
  };
  const verifiedPricing = calculateFixedLocationTaxEstimate(
    checkoutExample,
    us,
  );
  assert.equal(verifiedPricing.salesTaxAmount, 160.55);
  assert.equal(verifiedPricing.recyclingFeeAmount, 4);
  assert.equal(verifiedPricing.amount, 1693.55);

  const taxDelta = buildCatalogDelta({
    previousCatalog: { products },
    currentCatalog: { products: estimated.products },
    previousFeatured: { items: [] },
    currentFeatured: { items: [] },
    checkedAt: "2026-07-26T12:00:00.000Z",
    marketProfile: us,
  });
  assert.equal(taxDelta.counts.taxInclusivePriceChanges, products.length);
  assert.equal(taxDelta.taxInclusivePriceChanges.length, products.length);

  const tampered = structuredClone(estimated.products);
  tampered[0].taxInclusivePriceUsd += 1;
  assert.throws(
    () => buildCatalog(tampered, us),
    /tax estimate does not match its profile policy/,
  );
  const tamperedNew = structuredClone(estimated.products);
  tamperedNew[0].newTaxInclusivePriceUsd += 1;
  assert.throws(
    () => buildCatalog(tamperedNew, us),
    /new tax estimate does not match its profile policy/,
  );
});

test("fixed-location tax policy is currency-explicit for a future market", () => {
  const futureProfile = structuredClone(us);
  futureProfile.id = "ca";
  futureProfile.siteName = "MacBook CA Refurbished";
  futureProfile.pageTitle = "MacBook CA Refurbished — comparison";
  futureProfile.storefront = {
    countryCode: "CA",
    countryName: "Canada",
    baseUrl: "https://www.apple.com/ca",
    refurbishedCatalogUrl:
      "https://www.apple.com/ca/shop/refurbished/mac",
    newCatalogBaseUrl: "https://www.apple.com/ca/shop/buy-mac",
  };
  futureProfile.currency = {
    source: "CAD",
    display: "EUR",
    sourceFractionDigits: 2,
    displayFractionDigits: 2,
    displayLocale: "de-DE",
    secondarySymbol: "C$",
    secondaryLocale: "en-CA",
    priceFields: {
      refurbished: "priceCad",
      new: "newPriceCad",
      taxInclusive: "taxInclusivePriceCad",
      newTaxInclusive: "newTaxInclusivePriceCad",
    },
    conversion: {
      type: "cbr-cross-rate",
      siteField: "cadToEur",
    },
  };
  futureProfile.tax.referenceLocation = {
    id: "apple-toronto",
    name: "Apple Toronto",
    street: "100 Example Street",
    city: "Toronto",
    region: "ON",
    postalCode: "M5V 1A1",
    country: "CA",
  };
  futureProfile.tax.estimate = {
    ...futureProfile.tax.estimate,
    currency: "CAD",
    salesTaxRate: 0.13,
    recyclingFeeByScreenInches: {
      "13": 5,
      "14": 5,
      "15": 6,
      "16": 6,
    },
  };
  futureProfile.tax.acquisition.verification = {
    productCode: "CA-VERIFY",
    productUrl:
      "https://www.apple.com/ca/shop/product/ca-verify/example",
    currency: "CAD",
    screenInches: 13,
    preTaxAmount: 1000,
    salesTaxAmount: 130,
    recyclingFeeAmount: 5,
    estimatedTotalAmount: 1135,
  };
  futureProfile.ranking.policyPath = "config/ranking-policy.ca.json";
  futureProfile.namespace = {
    catalog: "data/markets/ca/catalog.json",
    featured: "data/markets/ca/featured.json",
    site: "data/markets/ca/site.json",
    updateStatus: "data/markets/ca/update-status.json",
    updateDelta: "data/markets/ca/update-delta.json",
    changelog: "data/markets/ca/changelog.json",
    artifactDirectory: "outputs/markets/ca",
  };
  futureProfile.publication = {
    ...futureProfile.publication,
    projectSlug: "macbook-ca-refurbished",
    artifactDirectory: "markets/ca",
    productionUrl: "https://macbook-ca-refurbished.pages.dev/",
    canonicalUrl: "https://macbook-ca-refurbished.pages.dev/",
  };

  assert.doesNotThrow(() => validateMarketProfile(futureProfile));
  const estimate = calculateFixedLocationTaxEstimate(
    { screen: "13″", priceCad: 1000 },
    futureProfile,
  );
  assert.equal(estimate.currency, "CAD");
  assert.equal(estimate.salesTaxAmount, 130);
  assert.equal(estimate.recyclingFeeAmount, 5);
  assert.equal(estimate.amount, 1135);

  const mismatchedVerificationFee = structuredClone(futureProfile);
  mismatchedVerificationFee.tax.acquisition.verification.recyclingFeeAmount =
    99;
  mismatchedVerificationFee.tax.acquisition.verification.estimatedTotalAmount =
    1229;
  assert.throws(
    () => validateMarketProfile(mismatchedVerificationFee),
    /does not reproduce/,
  );

  const mismatchedCurrency = structuredClone(futureProfile);
  mismatchedCurrency.tax.estimate.currency = "USD";
  assert.throws(
    () => validateMarketProfile(mismatchedCurrency),
    /fixed-location tax estimate/,
  );
  assert.throws(
    () =>
      calculateFixedLocationTaxEstimate(
        { screen: "13″", priceCad: 1000 },
        mismatchedCurrency,
      ),
    /currency must match the source currency/,
  );

  const invalidDisplayPrecision = structuredClone(futureProfile);
  invalidDisplayPrecision.currency.displayFractionDigits = 5;
  assert.throws(
    () => validateMarketProfile(invalidDisplayPrecision),
    /displayFractionDigits/,
  );
});

test("US namespace migration seeds identity currency and active hosting", () => {
  const site = buildInitialSiteDocument(us);
  assert.equal(site.siteName, "MacBook US Refurbished");
  assert.equal(site.productionUrl, us.publication.productionUrl);
  assert.equal(site.canonicalUrl, us.publication.canonicalUrl);
  assert.equal(site.plannedProductionUrl, us.publication.plannedUrl);
  assert.equal(site.currency.sourceToDisplayRate, 1);
  assert.deepEqual(site.tax.referenceLocation, us.tax.referenceLocation);
  assert.equal(site.tax.filterByDeliveryOrPickup, false);
});

test("existing market site documents are normalized through one schema", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "macbook-site-schema-"));
  const context = await loadMarketContext("sg", {
    namespaceRoot: fixtureRoot,
  });
  const legacySite = {
    schemaVersion: 1,
    pageTitle: sg.pageTitle,
    productionUrl: sg.publication.productionUrl,
    checkedDateFallback: "2026-07-26",
    currency: {
      sgdToUsd: 0.75,
      sourceCurrency: "SGD",
      displayCurrency: "USD",
      conversionType: "cbr-cross-rate",
      sourceToDisplayRate: 0.75,
    },
    canonicalUrl: sg.publication.canonicalUrl,
    plannedProductionUrl: null,
    tax: { model: "included-in-list-price" },
  };
  try {
    await Promise.all(
      [context.paths.catalog, context.paths.featured].map(async (filePath) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, "{}\n", "utf8");
      }),
    );
    await mkdir(dirname(context.paths.site), { recursive: true });
    await writeFile(
      context.paths.site,
      `${JSON.stringify(legacySite, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      initializeMarketNamespace({
        marketId: "sg",
        namespaceRoot: fixtureRoot,
        check: true,
      }),
      /does not match its market profile/,
    );
    await initializeMarketNamespace({
      marketId: "sg",
      namespaceRoot: fixtureRoot,
    });
    const normalized = JSON.parse(
      await readFile(context.paths.site, "utf8"),
    );
    assert.equal(normalized.siteName, sg.siteName);
    assert.equal(normalized.pageTitle, sg.pageTitle);
    assert.equal("checkedDateFallback" in normalized, false);
    assert.deepEqual(normalized.currency, legacySite.currency);
    await assert.doesNotReject(
      initializeMarketNamespace({
        marketId: "sg",
        namespaceRoot: fixtureRoot,
        check: true,
      }),
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("US currency adapter is an identity conversion and performs no rate fetch", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "macbook-us-currency-"));
  const sitePath = join(fixtureRoot, "site.json");
  try {
    await writeFile(
      sitePath,
      `${JSON.stringify(buildInitialSiteDocument(us), null, 2)}\n`,
      "utf8",
    );
    const updated = await updateExchangeRate({
      sitePath,
      marketProfile: us,
      fetchTextImpl: async () => {
        throw new Error("identity conversion must not fetch");
      },
    });
    assert.deepEqual(updated.currency, {
      sourceCurrency: "USD",
      displayCurrency: "USD",
      conversionType: "identity",
      sourceToDisplayRate: 1,
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("enabled profiles reproduce their selected featured artifacts", async () => {
  const stagedMarketId = process.env.MACBOOK_STAGED_MARKET_ID;
  const stagedNamespaceRoot =
    process.env.MACBOOK_STAGED_NAMESPACE_ROOT;
  const profilesToCheck = stagedMarketId
    ? enabledMarketState.profiles.filter(
        (profile) => profile.id === stagedMarketId,
      )
    : enabledMarketState.profiles;
  assert.ok(profilesToCheck.length > 0);

  for (const profile of profilesToCheck) {
    const context = await loadMarketContext(profile.id, {
      namespaceRoot:
        profile.id === stagedMarketId ? stagedNamespaceRoot : undefined,
    });
    const [catalog, expectedFeatured, policy] = await Promise.all([
      readFile(context.paths.catalog, "utf8").then(JSON.parse),
      readFile(context.paths.featured, "utf8"),
      readFile(context.policyPath, "utf8").then(JSON.parse),
    ]);
    const actual = renderFeaturedJson(
      rankCatalog(catalog, policy, profile),
    );
    assert.equal(actual, expectedFeatured);
  }
});

test("the shared UI builder renders the US profile without Singapore assumptions", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "macbook-us-market-"));
  const fixtureContext = await loadMarketContext("us", {
    namespaceRoot: fixtureRoot,
  });
  const checkedAt = "2026-07-26T12:00:00.000Z";
  try {
    const parsedProducts = parseTiles(
      [
        tile({
          productCode: "US-IDEAL-A",
          marketId: "us",
          price: 1500,
        }),
        tile({
          productCode: "US-IDEAL-B",
          marketId: "us",
          colour: "Sky Blue",
          price: 1500,
        }),
        tile({
          productCode: "US-512",
          marketId: "us",
          price: 1300,
          storage: "512GB",
        }),
        tile({
          productCode: "US-2TB",
          marketId: "us",
          price: 2100,
          storage: "2TB",
        }),
      ],
      us,
    );
    parsedProducts[0].newPriceUsd = 1799;
    parsedProducts[0].newSourceUrl =
      "https://www.apple.com/shop/buy-mac/macbook-air/13-inch";
    const { products } = await hydrateTaxInclusivePrices(parsedProducts, {
      marketProfile: us,
    });
    const catalog = buildCatalog(products, us);
    const featured = rankCatalog(catalog, usPolicy, us);
    const emptyDelta = {
      schemaVersion: 1,
      checkedAt,
      hasChanges: false,
      counts: {
        added: 0,
        removed: 0,
        refurbPriceChanges: 0,
        newPriceChanges: 0,
        featuredChanges: 0,
      },
      added: [],
      removed: [],
      refurbPriceChanges: [],
      newPriceChanges: [],
      featured: null,
    };
    const files = new Map([
      [fixtureContext.paths.catalog, catalog],
      [fixtureContext.paths.featured, featured],
      [fixtureContext.paths.site, {
        ...buildInitialSiteDocument(us),
        checkedDateFallback: "2026-07-26",
      }],
      [fixtureContext.paths.updateStatus, {
        schemaVersion: 1,
        status: "success",
        checkedAt,
        counts: {
          products: products.length,
          air: products.length,
          pro: 0,
        },
      }],
      [fixtureContext.paths.changelog, {
        schemaVersion: 1,
        latestRun: emptyDelta,
        entries: [
          {
            type: "baseline",
            checkedAt,
            counts: {
              products: products.length,
              air: products.length,
              pro: 0,
              configurations: 3,
            },
          },
        ],
      }],
    ]);
    await Promise.all(
      [...files].map(async ([filePath, value]) => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(
          filePath,
          `${JSON.stringify(value, null, 2)}\n`,
          "utf8",
        );
      }),
    );

    await execFileAsync(
      process.execPath,
      ["work/build-expanded-standalone.mjs", "--market", "us"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          MACBOOK_NAMESPACE_ROOT: fixtureRoot,
        },
      },
    );
    const html = await readFile(fixtureContext.paths.artifact, "utf8");
    assert.match(html, /MacBook US Refurbished/);
    assert.match(html, /Apple Beverly Center/);
    assert.match(html, /Расчётный total/);
    assert.match(html, /10\.5%/);
    assert.match(html, /\$1,661\.50/);
    assert.match(html, /\$1,500\.00 \+ \$157\.50 \+ \$4\.00/);
    assert.match(html, /"newTaxInclusivePriceUsd":1991\.9/);
    assert.match(html, /priceFormula\(p\.newTaxInclusivePricing\)/);
    assert.ok(
      html.includes(
        `<link rel="canonical" href="${us.publication.canonicalUrl}">`,
      ),
    );
    assert.match(
      html,
      /href="https:\/\/macbook-sg-refurbished\.pages\.dev\/"[^>]*aria-label="MacBook SG Refurbished"/,
    );
    assert.ok(
      html.includes(
        `href="${us.publication.canonicalUrl}" aria-current="page" aria-label="MacBook US Refurbished"`,
      ),
    );
    assert.doesNotMatch(html, /class="source-secondary"/);
    assert.doesNotMatch(html, /Apple Singapore|priceSgd|newPriceSgd/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
