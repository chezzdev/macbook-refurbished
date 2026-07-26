#!/usr/bin/env node

import {
  assertUniqueProfileOwnedPaths,
  loadEnabledMarketProfiles,
} from "./market-profile.mjs";

const commonSourcePaths = [
  "README.md",
  "package.json",
  "package-lock.json",
  "eslint.config.mjs",
  "config/publish.gitignore",
  "config/markets/registry.json",
  "scripts/apple-catalog-lib.mjs",
  "scripts/apple-catalog-lib.test.mjs",
  "scripts/build-enabled-markets.mjs",
  "scripts/html-escape.mjs",
  "scripts/initialize-market.mjs",
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
];

const retiredPublicationPaths = [
  "app",
  "build",
  "db",
  "drizzle",
  "worker",
  "drizzle.config.ts",
  "postcss.config.mjs",
  "tests/rendered-html.test.mjs",
  "tsconfig.json",
  "vite.config.ts",
];

function uniqueSorted(paths) {
  const unique = [...new Set(paths)];
  for (const path of unique) {
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      path.includes("\r") ||
      path.includes("\n") ||
      path.includes("\u001f")
    ) {
      throw new Error(`unsafe publication path: ${path}`);
    }
  }
  return unique.sort();
}

export function buildPublicationManifest(profiles) {
  assertUniqueProfileOwnedPaths(profiles);
  const marketSourcePaths = profiles.flatMap((profile) => [
    `config/markets/${profile.id}.json`,
    profile.ranking.policyPath,
    profile.namespace.catalog,
    profile.namespace.featured,
    profile.namespace.site,
    profile.namespace.updateStatus,
    profile.namespace.updateDelta,
    profile.namespace.changelog,
  ]);
  const publicationArtifacts = profiles.map(
    (profile) => `${profile.publication.artifactDirectory}/index.html`,
  );
  const sourcePaths = uniqueSorted([
    ...commonSourcePaths,
    ...marketSourcePaths,
  ]);
  const immutableSourcePaths = uniqueSorted([
    ...commonSourcePaths,
    ...profiles.flatMap((profile) => [
      `config/markets/${profile.id}.json`,
      profile.ranking.policyPath,
    ]),
  ]);
  return {
    marketIds: profiles.map((profile) => profile.id),
    sourcePaths,
    immutableSourcePaths,
    retiredPublicationPaths: uniqueSorted(retiredPublicationPaths),
    publicationPaths: uniqueSorted([
      ".gitignore",
      ...sourcePaths,
      ...publicationArtifacts,
    ]),
  };
}

if (process.argv[1] === import.meta.filename) {
  const mode = process.argv[2] ?? "--source";
  const { profiles } = await loadEnabledMarketProfiles();
  const manifest = buildPublicationManifest(profiles);
  const values =
    mode === "--source"
      ? manifest.sourcePaths
      : mode === "--immutable-source"
        ? manifest.immutableSourcePaths
      : mode === "--publish"
        ? manifest.publicationPaths
        : mode === "--retired"
          ? manifest.retiredPublicationPaths
          : mode === "--market-ids"
            ? manifest.marketIds
            : null;
  if (!values) {
    throw new Error(
      "Usage: publication-manifest.mjs " +
        "--source|--immutable-source|--publish|--retired|--market-ids",
    );
  }
  process.stdout.write(`${values.join("\n")}\n`);
}
