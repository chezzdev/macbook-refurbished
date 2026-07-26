#!/usr/bin/env node

import { loadMarketContext } from "./market-profile.mjs";

const marketId = process.argv[2] ?? "sg";
const { profile } = await loadMarketContext(marketId);
const values = [
  profile.id,
  profile.siteName,
  `config/markets/${profile.id}.json`,
  profile.namespace.catalog,
  profile.namespace.featured,
  profile.namespace.site,
  profile.namespace.updateStatus,
  profile.namespace.updateDelta,
  profile.namespace.changelog,
  profile.namespace.artifactDirectory,
  profile.ranking.policyPath,
  profile.publication.projectSlug,
  profile.publication.provider,
  profile.publication.productionUrl ?? "",
  profile.publication.repository ?? "",
  profile.publication.checkoutPath,
  profile.publication.artifactDirectory,
  profile.publication.branch,
  String(profile.publication.approvalRequired),
];
if (values.some((value) => String(value).includes("\u001f"))) {
  throw new Error("market workflow values cannot contain unit separators");
}
process.stdout.write(`${values.join("\u001f")}\n`);
