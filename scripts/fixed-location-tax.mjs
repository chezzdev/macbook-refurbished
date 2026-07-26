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

export function calculateTaxLocationAmounts({
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
  if (
    !Number.isFinite(estimate?.salesTaxRate) ||
    estimate.salesTaxRate <= 0 ||
    estimate.salesTaxRate >= 1
  ) {
    throw new Error("estimate.salesTaxRate must be a number in (0, 1)");
  }
  if (
    !Number.isSafeInteger(estimate.minorUnitDigits) ||
    estimate.minorUnitDigits < 0 ||
    estimate.minorUnitDigits > 4
  ) {
    throw new Error(
      "estimate.minorUnitDigits must be an integer from 0 to 4",
    );
  }

  const feeAmounts = (estimate.additionalFees ?? []).map((fee) => {
    let amount;
    if (fee.type === "fixed") {
      amount = fee.amount;
    } else if (fee.type === "screen-size") {
      amount = fee.amountByScreenInches?.[String(screenInches)];
    } else {
      throw new Error(`Unsupported additional fee type: ${fee.type}`);
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `No non-negative ${fee.id || "additional"} fee is configured for ${screenInches} inches`,
      );
    }
    return {
      id: fee.id,
      label: fee.label,
      amount,
    };
  });
  const salesTaxAmount = roundCurrency(
    preTaxAmount * estimate.salesTaxRate,
    estimate.minorUnitDigits,
  );
  const additionalFeeAmount = roundCurrency(
    feeAmounts.reduce((sum, fee) => sum + fee.amount, 0),
    estimate.minorUnitDigits,
  );
  const estimatedTotalAmount = roundCurrency(
    preTaxAmount + salesTaxAmount + additionalFeeAmount,
    estimate.minorUnitDigits,
  );
  return {
    preTaxAmount,
    salesTaxAmount,
    feeAmounts,
    additionalFeeAmount,
    estimatedTotalAmount,
  };
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
  const calculated = calculateTaxLocationAmounts({
    preTaxAmount,
    screenInches,
    estimate: {
      ...estimate,
      additionalFees: [
        {
          id: "recycling-fee",
          label: "Recycling fee",
          type: "fixed",
          amount: recyclingFeeAmount,
        },
      ],
    },
  });
  return {
    preTaxAmount,
    salesTaxAmount: calculated.salesTaxAmount,
    recyclingFeeAmount,
    estimatedTotalAmount: calculated.estimatedTotalAmount,
  };
}
