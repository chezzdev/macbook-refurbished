#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchText, writeJsonAtomic } from "./apple-catalog-lib.mjs";
import {
  loadMarketContext,
  loadMarketProfile,
  marketIdFromArgv,
} from "./market-profile.mjs";

const defaultMarketProfile = await loadMarketProfile("sg");

export const CBR_DAILY_XML_URL =
  "https://www.cbr.ru/scripts/XML_daily.asp";

export function parseCbrCrossRate(xml) {
  const dateMatch = xml.match(/<ValCurs[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/i);
  if (!dateMatch) {
    throw new Error("CBR response does not contain a daily rate date");
  }

  const currencies = new Map(
    [...xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/gi)].map(
      ([, block]) => {
        const code = block.match(/<CharCode>([^<]+)<\/CharCode>/i)?.[1];
        const nominal = parseLocalizedNumber(
          block.match(/<Nominal>([^<]+)<\/Nominal>/i)?.[1],
        );
        const value = parseLocalizedNumber(
          block.match(/<Value>([^<]+)<\/Value>/i)?.[1],
        );
        return [code, { nominal, value }];
      },
    ),
  );

  const usd = currencies.get("USD");
  const sgd = currencies.get("SGD");
  for (const [code, currency] of [["USD", usd], ["SGD", sgd]]) {
    if (
      !currency ||
      !Number.isFinite(currency.nominal) ||
      currency.nominal <= 0 ||
      !Number.isFinite(currency.value) ||
      currency.value <= 0
    ) {
      throw new Error(`CBR response does not contain a valid ${code} rate`);
    }
  }

  const [, day, month, year] = dateMatch;
  const rateDate = `${year}-${month}-${day}`;
  const sgdToUsd = (sgd.value / sgd.nominal) / (usd.value / usd.nominal);
  if (!Number.isFinite(sgdToUsd) || sgdToUsd <= 0 || sgdToUsd >= 2) {
    throw new Error(`Calculated SGD to USD rate is implausible: ${sgdToUsd}`);
  }

  return {
    sgdToUsd,
    rateDate,
    sourceUrl:
      "https://www.cbr.ru/currency_base/daily/" +
      `?UniDbQuery.Posted=True&UniDbQuery.To=${day}.${month}.${year}`,
  };
}

export async function updateExchangeRate({
  fetchTextImpl = fetchText,
  sitePath = resolve(import.meta.dirname, "../data/site.json"),
  marketProfile = defaultMarketProfile,
} = {}) {
  const currentSite = JSON.parse(await readFile(sitePath, "utf8"));
  if (currentSite?.schemaVersion !== 1) {
    throw new Error("data/site.json schemaVersion must be 1");
  }
  if (marketProfile.currency.conversion.type === "identity") {
    const updatedSite = {
      ...currentSite,
      currency: {
        sourceCurrency: marketProfile.currency.source,
        displayCurrency: marketProfile.currency.display,
        conversionType: "identity",
        sourceToDisplayRate: 1,
      },
    };
    await writeJsonAtomic(sitePath, updatedSite);
    return updatedSite;
  }
  const { html } = await fetchTextImpl(CBR_DAILY_XML_URL);
  const currency = parseCbrCrossRate(html);
  const updatedSite = {
    ...currentSite,
    currency,
  };
  await writeJsonAtomic(sitePath, updatedSite);
  return updatedSite;
}

function parseLocalizedNumber(value) {
  return Number(String(value ?? "").trim().replace(",", "."));
}

if (process.argv[1] === import.meta.filename) {
  const { profile, paths } = await loadMarketContext(marketIdFromArgv());
  const site = await updateExchangeRate({
    sitePath: paths.site,
    marketProfile: profile,
  });
  if (profile.currency.conversion.type === "identity") {
    console.log(`Confirmed identity USD display conversion for ${profile.siteName}.`);
  } else {
    console.log(
      `Updated SGD to USD rate: ${site.currency.sgdToUsd} ` +
        `for ${site.currency.rateDate}.`,
    );
  }
}
