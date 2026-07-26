#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnabledMarketProfiles, projectRoot } from "./market-profile.mjs";

const execFileAsync = promisify(execFile);
const compact = process.argv.includes("--compact");
const { profiles } = await loadEnabledMarketProfiles();
const summaries = [];

for (const profile of profiles) {
  const argumentsList = [
    "scripts/summarize-update.mjs",
    "--market",
    profile.id,
  ];
  if (compact) argumentsList.push("--compact");
  const { stdout } = await execFileAsync(process.execPath, argumentsList, {
    cwd: projectRoot,
  });
  summaries.push(stdout.trim());
}

console.log(summaries.join(compact ? " | " : "\n\n"));
