export function buildMarketDisplayCopy(
  profile,
  {
    hasVerifiedTaxEstimate,
    hasReferenceLocationTax,
    hasTaxLocationSwitcher = false,
    taxLocationName = "",
    rateDateFormatted = "",
    rateDateLong = "",
  },
) {
  const { source, display } = profile.currency;
  const usesIdentityConversion = source === display;
  const roundingQuantum = new Intl.NumberFormat(
    profile.currency.displayLocale,
    {
      useGrouping: false,
      minimumFractionDigits: profile.currency.displayFractionDigits,
      maximumFractionDigits: profile.currency.displayFractionDigits,
    },
  ).format(10 ** -profile.currency.displayFractionDigits);
  const heroCurrencyCopy = hasVerifiedTaxEstimate
    ? hasTaxLocationSwitcher
      ? "Total = цена + налог + применимые сборы"
      : "Total = цена + налог + сбор"
    : source === display
      ? `Цены Apple уже указаны в ${display}; конвертация не применяется`
      : `Пересчёт по официальному кросс-курсу на ${rateDateFormatted}, ` +
        `округление до ${roundingQuantum} ${display}`;
  const heroMarketCopy = hasVerifiedTaxEstimate
    ? hasTaxLocationSwitcher
      ? `В ${profile.storefront.countryCode} крупно показан расчётный total ` +
        "для выбранного штата; каталог остаётся общенациональным."
      : `В ${profile.storefront.countryCode} крупно показан расчётный total ` +
        `для ${taxLocationName}; каталог остаётся общенациональным.`
    : hasReferenceLocationTax
      ? `Цены Apple указаны в ${source}. Каталог ` +
        `${profile.storefront.countryName} остаётся общенациональным; ` +
        "налоговый ориентир привязан к одной точке."
      : usesIdentityConversion
        ? `Цены Apple и все сравнения показаны в ${display}.`
        : `Цены в ${display} крупно, исходные ${source} — рядом.`;
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
