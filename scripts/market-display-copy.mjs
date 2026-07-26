export function buildMarketDisplayCopy(
  profile,
  {
    hasVerifiedTaxEstimate,
    hasReferenceLocationTax,
    taxLocationName = "",
    rateDateFormatted = "",
    rateDateLong = "",
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
  const usesIdentityConversion = source === display;
  return {
    currencyMethodBody: usesIdentityConversion
      ? `Цены Apple уже указаны в ${display}; пересчёт по кросс-курсу не применяется.`
      : `Конвертация сделана по официальному кросс-курсу на ${rateDateLong}. ` +
        "Банк или карта могут посчитать иначе.",
    currencyMethodHeading: usesIdentityConversion
      ? `${display} — основная валюта`
      : `${display} — ориентир`,
    heroCurrencyCopy,
    heroMarketCopy,
  };
}
