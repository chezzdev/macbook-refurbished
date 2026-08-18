#!/usr/bin/env node

import {
  assertUniqueProfileOwnedPaths,
  COMMON_PUBLICATION_SOURCE_PATHS,
  loadEnabledMarketProfiles,
} from "./market-profile.mjs";

const retiredPublicationPaths = [
  "app",
  "build",
  "config/ranking-policy.json",
  "data/catalog.json",
  "data/changelog.json",
  "data/featured.json",
  "data/site.json",
  "data/update-delta.json",
  "data/update-status.json",
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
      path.split("/").includes(".") ||
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
  if (profiles.length === 0) {
    throw new Error("publication manifest requires at least one market");
  }
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
    marketArtifacts: profiles.map((profile) => ({
      marketId: profile.id,
      relativePath: `${profile.publication.artifactDirectory}/index.html`,
    })),
    marketBuildArtifacts: profiles.map((profile) => ({
      marketId: profile.id,
      localRelativePath: `${profile.namespace.artifactDirectory}/index.html`,
      publicationRelativePath:
        `${profile.publication.artifactDirectory}/index.html`,
    })),
    repository: profiles[0].publication.repository,
    branch: profiles[0].publication.branch,
    sourcePaths,
    immutableSourcePaths,
    retiredPublicationPaths: uniqueSorted(retiredPublicationPaths),
    publicationPaths: uniqueSorted([
      ".gitignore",
      ...sourcePaths,
      ...publicationArtifacts,
      ...retiredPublicationPaths,
    ]),
  };
}

if (process.argv[1] === import.meta.filename) {
  const mode = process.argv[2] ?? "--source";
  const { profiles } = await loadEnabledMarketProfiles();
  const manifest = buildPublicationManifest(profiles);
  if (mode === "--repository") {
    process.stdout.write(`${manifest.repository}\n`);
    process.exit(0);
  }
  if (mode === "--branch") {
    process.stdout.write(`${manifest.branch}\n`);
    process.exit(0);
  }
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
            : mode === "--market-artifacts"
            ? manifest.marketArtifacts.map(
                  ({ marketId, relativePath }) =>
                    `${marketId}\u001f${relativePath}`,
                )
            : mode === "--market-build-artifacts"
              ? manifest.marketBuildArtifacts.map(
                  ({
                    marketId,
                    localRelativePath,
                    publicationRelativePath,
                  }) =>
                    `${marketId}\u001f${localRelativePath}\u001f${publicationRelativePath}`,
                )
            : null;
  if (!values) {
    throw new Error(
      "Usage: publication-manifest.mjs " +
        "--source|--immutable-source|--publish|--retired|--market-ids|" +
        "--market-artifacts|--market-build-artifacts|--repository|--branch",
    );
  }
  process.stdout.write(`${values.join("\n")}\n`);
}
