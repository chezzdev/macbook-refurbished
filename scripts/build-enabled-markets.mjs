#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadEnabledMarketProfiles, projectRoot } from "./market-profile.mjs";

const execFileAsync = promisify(execFile);
const { profiles } = await loadEnabledMarketProfiles();

for (const profile of profiles) {
  const commands = [
    ["scripts/initialize-market.mjs", "--market", profile.id, "--check"],
    ["scripts/validate-apple-catalog.mjs", "--market", profile.id],
    ["scripts/rank-models.mjs", "--market", profile.id, "--check"],
    ["work/build-expanded-standalone.mjs", "--market", profile.id],
  ];
  for (const argumentsList of commands) {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      argumentsList,
      { cwd: projectRoot },
    );
    if (stdout) process.stdout.write(`${profile.id}: ${stdout}`);
    if (stderr) process.stderr.write(stderr);
  }
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--test", "tests/standalone-catalog.test.mjs"],
    {
      cwd: projectRoot,
      env: { ...process.env, MACBOOK_MARKET_ID: profile.id },
    },
  );
  if (stdout) process.stdout.write(`${profile.id}: ${stdout}`);
  if (stderr) process.stderr.write(stderr);
}
