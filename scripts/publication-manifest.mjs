#!/usr/bin/env node

import {
  assertUniqueProfileOwnedPaths,
  COMMON_PUBLICATION_SOURCE_PATHS,
  loadEnabledMarketProfiles,
} from "./market-profile.mjs";

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
    ...COMMON_PUBLICATION_SOURCE_PATHS,
    ...marketSourcePaths,
  ]);
  const immutableSourcePaths = uniqueSorted([
    ...COMMON_PUBLICATION_SOURCE_PATHS,
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
