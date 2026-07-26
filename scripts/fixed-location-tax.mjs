export function roundCurrency(value, minorUnitDigits = 2) {
  const factor = 10 ** minorUnitDigits;
  return Math.floor(value * factor + 0.5 + 1e-9) / factor;
}

export function screenInchesFromLabel(value) {
  const match = String(value).match(/\d+/);
  const screenInches = match ? Number(match[0]) : Number.NaN;
  if (!Number.isSafeInteger(screenInches) || screenInches <= 0) {
    throw new Error(`Invalid screen size: ${value}`);
  }
  return screenInches;
}

export function calculateFixedLocationTaxAmounts({
  preTaxAmount,
  screenInches,
  estimate,
}) {
  if (!Number.isFinite(preTaxAmount) || preTaxAmount < 0) {
    throw new Error("preTaxAmount must be a non-negative number");
  }
  if (!Number.isSafeInteger(screenInches) || screenInches <= 0) {
    throw new Error("screenInches must be a positive integer");
  }
  const recyclingFeeAmount =
    estimate.recyclingFeeByScreenInches[String(screenInches)];
  if (!Number.isFinite(recyclingFeeAmount)) {
    throw new Error(
      `No recycling fee is configured for ${screenInches} inches`,
    );
  }
  const salesTaxAmount = roundCurrency(
    preTaxAmount * estimate.salesTaxRate,
    estimate.minorUnitDigits,
  );
  const estimatedTotalAmount = roundCurrency(
    preTaxAmount + salesTaxAmount + recyclingFeeAmount,
    estimate.minorUnitDigits,
  );
  return {
    preTaxAmount,
    salesTaxAmount,
    recyclingFeeAmount,
    estimatedTotalAmount,
  };
}
