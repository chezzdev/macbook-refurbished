#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fetchText, writeJsonAtomic } from "./apple-catalog-lib.mjs";
import {
  DEFAULT_MARKET_ID,
  loadMarketContext,
  loadMarketProfile,
  marketIdFromArgv,
} from "./market-profile.mjs";

const defaultMarketProfile = await loadMarketProfile(DEFAULT_MARKET_ID);

export const CBR_DAILY_XML_URL =
  "https://www.cbr.ru/scripts/XML_daily.asp";

export function parseCbrCrossRate(
  xml,
  options,
) {
  const { sourceCurrency, displayCurrency, siteField } = options ?? {};
  if (
    !/^[A-Z]{3}$/.test(sourceCurrency ?? "") ||
    !/^[A-Z]{3}$/.test(displayCurrency ?? "") ||
    typeof siteField !== "string" ||
    siteField.length === 0
  ) {
    throw new Error(
      "CBR cross-rate requires sourceCurrency, displayCurrency, and siteField",
    );
  }
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

  const currencyRate = (code) =>
    code === "RUB" ? { nominal: 1, value: 1 } : currencies.get(code);
  const source = currencyRate(sourceCurrency);
  const display = currencyRate(displayCurrency);
  for (const [code, currency] of [
    [sourceCurrency, source],
    [displayCurrency, display],
  ]) {
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
  const sourceToDisplayRate =
    (source.value / source.nominal) / (display.value / display.nominal);
  if (!Number.isFinite(sourceToDisplayRate) || sourceToDisplayRate <= 0) {
    throw new Error(
      `Calculated ${sourceCurrency} to ${displayCurrency} rate is invalid: ` +
        sourceToDisplayRate,
    );
  }

  return {
    [siteField]: sourceToDisplayRate,
    sourceCurrency,
    displayCurrency,
    conversionType: "cbr-cross-rate",
    sourceToDisplayRate,
    rateDate,
    sourceUrl:
      "https://www.cbr.ru/currency_base/daily/" +
      `?UniDbQuery.Posted=True&UniDbQuery.To=${day}.${month}.${year}`,
  };
}

export async function updateExchangeRate({
  fetchTextImpl = fetchText,
  sitePath,
  marketProfile = defaultMarketProfile,
} = {}) {
  sitePath ??= (await loadMarketContext(marketProfile.id)).paths.site;
  const currentSite = JSON.parse(await readFile(sitePath, "utf8"));
  if (currentSite?.schemaVersion !== 1) {
    throw new Error(`${sitePath} schemaVersion must be 1`);
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
  const currency = parseCbrCrossRate(html, {
    sourceCurrency: marketProfile.currency.source,
    displayCurrency: marketProfile.currency.display,
    siteField: marketProfile.currency.conversion.siteField,
  });
  const updatedSite = {
    ...currentSite,
    currency,
  };
  await writeJsonAtomic(sitePath, updatedSite);
  return updatedSite;
}

export function sourceToDisplayRateFromSite(site, marketProfile) {
  if (marketProfile.currency.conversion.type === "identity") return 1;
  const siteField = marketProfile.currency.conversion.siteField;
  const rate = Number(site?.currency?.[siteField]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Missing positive currency conversion ${siteField} for ${marketProfile.id}`,
    );
  }
  return rate;
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
    console.log(
      `Confirmed identity ${profile.currency.display} display conversion ` +
        `for ${profile.siteName}.`,
    );
  } else {
    const siteField = profile.currency.conversion.siteField;
    console.log(
      `Updated ${profile.currency.source} to ${profile.currency.display} rate: ` +
        `${site.currency[siteField]} ` +
        `for ${site.currency.rateDate}.`,
    );
  }
}
