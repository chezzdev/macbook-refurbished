export function buildMarketDisplayCopy(
  profile,
  {
    hasVerifiedTaxEstimate,
    hasReferenceLocationTax,
    taxLocationName = "",
    rateDateFormatted = "",
  },
) {
  const { source, display } = profile.currency;
  const heroCurrencyCopy = hasVerifiedTaxEstimate
    ? "Total = цена + налог + сбор"
    : source === display
      ? `Цены Apple уже указаны в ${display}; конвертация не применяется`
      : `Пересчёт по официальному кросс-курсу на ${rateDateFormatted}, ` +
        `округление до 1 ${display}`;
  const heroMarketCopy = hasVerifiedTaxEstimate
    ? `В ${profile.storefront.countryCode} крупно показан расчётный total ` +
      `для ${taxLocationName}; каталог остаётся общенациональным.`
    : hasReferenceLocationTax
      ? `Цены Apple указаны в ${source}. Каталог ` +
        `${profile.storefront.countryName} остаётся общенациональным; ` +
        "налоговый ориентир привязан к одной точке."
      : `Цены в ${display} крупно, исходные ${source} — рядом.`;
  return {
    convertedPriceHeading: `${display} — ориентир`,
    heroCurrencyCopy,
    heroMarketCopy,
  };
}
