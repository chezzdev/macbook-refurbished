import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseCbrCrossRate,
  updateExchangeRate,
} from "../scripts/update-exchange-rate.mjs";

const fixture = `<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="25.07.2026" name="Foreign Currency Market">
  <Valute ID="R01235">
    <Nominal>1</Nominal>
    <CharCode>USD</CharCode>
    <Value>78,5796</Value>
  </Valute>
  <Valute ID="R01625">
    <Nominal>1</Nominal>
    <CharCode>SGD</CharCode>
    <Value>60,8099</Value>
  </Valute>
</ValCurs>`;

test("calculates a deterministic SGD to USD cross-rate", () => {
  assert.deepEqual(parseCbrCrossRate(fixture), {
    sgdToUsd: 60.8099 / 78.5796,
    rateDate: "2026-07-25",
    sourceUrl:
      "https://www.cbr.ru/currency_base/daily/" +
      "?UniDbQuery.Posted=True&UniDbQuery.To=25.07.2026",
  });
});

test("updates only the currency-owned part of site data", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "exchange-rate-test-"),
  );
  const sitePath = join(temporaryDirectory, "site.json");
  const initialSite = {
    schemaVersion: 1,
    pageTitle: "Catalog",
    productionUrl: "https://example.com/",
    checkedDateFallback: "2026-01-01",
    currency: {
      sgdToUsd: 0.5,
      rateDate: "2026-01-01",
      sourceUrl: "https://example.com/old",
    },
  };

  try {
    await writeFile(sitePath, JSON.stringify(initialSite), "utf8");
    await updateExchangeRate({
      sitePath,
      fetchTextImpl: async () => ({ html: fixture }),
    });
    const updatedSite = JSON.parse(await readFile(sitePath, "utf8"));
    assert.equal(updatedSite.pageTitle, initialSite.pageTitle);
    assert.equal(updatedSite.productionUrl, initialSite.productionUrl);
    assert.equal(updatedSite.currency.rateDate, "2026-07-25");
    assert.equal(updatedSite.currency.sgdToUsd, 60.8099 / 78.5796);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("fails closed on missing or invalid currency data", () => {
  assert.throws(
    () =>
      parseCbrCrossRate(
        '<ValCurs Date="25.07.2026"><Valute><CharCode>USD</CharCode>' +
          "<Nominal>1</Nominal><Value>78,5</Value></Valute></ValCurs>",
      ),
    /valid SGD rate/,
  );
});
