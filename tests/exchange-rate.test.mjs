import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseCbrCrossRate,
  sourceToDisplayRateFromSite,
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
  <Valute ID="R01350">
    <Nominal>1</Nominal>
    <CharCode>CAD</CharCode>
    <Value>57,2500</Value>
  </Valute>
  <Valute ID="R01239">
    <Nominal>1</Nominal>
    <CharCode>EUR</CharCode>
    <Value>92,3400</Value>
  </Valute>
</ValCurs>`;

test("calculates a deterministic SGD to USD cross-rate", () => {
  assert.deepEqual(
    parseCbrCrossRate(fixture, {
      sourceCurrency: "SGD",
      displayCurrency: "USD",
      siteField: "sgdToUsd",
    }),
    {
      sgdToUsd: 60.8099 / 78.5796,
      sourceCurrency: "SGD",
      displayCurrency: "USD",
      conversionType: "cbr-cross-rate",
      sourceToDisplayRate: 60.8099 / 78.5796,
      rateDate: "2026-07-25",
      sourceUrl:
        "https://www.cbr.ru/currency_base/daily/" +
        "?UniDbQuery.Posted=True&UniDbQuery.To=25.07.2026",
    },
  );
});

test("drives a future market conversion and builder lookup from its profile", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "exchange-rate-market-test-"),
  );
  const sitePath = join(temporaryDirectory, "site.json");
  const marketProfile = {
    id: "ca",
    currency: {
      source: "CAD",
      display: "EUR",
      conversion: {
        type: "cbr-cross-rate",
        siteField: "cadToEur",
      },
    },
  };

  try {
    await writeFile(
      sitePath,
      JSON.stringify({ schemaVersion: 1, siteName: "MacBook CA Refurbished" }),
      "utf8",
    );
    const updatedSite = await updateExchangeRate({
      sitePath,
      marketProfile,
      fetchTextImpl: async () => ({ html: fixture }),
    });
    assert.equal(updatedSite.currency.cadToEur, 57.25 / 92.34);
    assert.equal(
      sourceToDisplayRateFromSite(updatedSite, marketProfile),
      57.25 / 92.34,
    );
    assert.equal(updatedSite.currency.sourceCurrency, "CAD");
    assert.equal(updatedSite.currency.displayCurrency, "EUR");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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
        {
          sourceCurrency: "SGD",
          displayCurrency: "USD",
          siteField: "sgdToUsd",
        },
      ),
    /valid SGD rate/,
  );
  assert.throws(
    () => parseCbrCrossRate(fixture),
    /requires sourceCurrency, displayCurrency, and siteField/,
  );
});
