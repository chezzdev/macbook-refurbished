export function recommendConfigurations(
  products,
  preferences,
  {
    priceField,
    priceMultiplier = 1,
    shortlistSize = 3,
  } = {},
) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("products must be a non-empty array");
  }
  if (typeof priceField !== "string" || priceField.length === 0) {
    throw new Error("priceField must be a non-empty string");
  }
  if (!Number.isFinite(priceMultiplier) || priceMultiplier <= 0) {
    throw new Error("priceMultiplier must be a positive number");
  }
  if (!Number.isSafeInteger(shortlistSize) || shortlistSize <= 0) {
    throw new Error("shortlistSize must be a positive integer");
  }

  const compareText = (left, right) => {
    const leftText = String(left);
    const rightText = String(right);
    if (leftText < rightText) return -1;
    if (leftText > rightText) return 1;
    return 0;
  };
  const capacityNumber = (value) => {
    const amount = Number(String(value).replace(/\D/g, ""));
    return amount * (String(value).endsWith("TB") ? 1024 : 1);
  };
  const screenNumber = (value) =>
    Number(String(value).replace(/[^\d.]/g, ""));
  const screenGroupFor = (value) => {
    const normalized = String(value || "");
    if (normalized === "13-14" || normalized.startsWith("13–14")) {
      return "13-14";
    }
    if (normalized === "15-16" || normalized.startsWith("15–16")) {
      return "15-16";
    }
    const size = screenNumber(normalized);
    if (size >= 13 && size < 15) return "13-14";
    if (size >= 15 && size < 17) return "15-16";
    return "";
  };
  const screenGroupLabel = (value) =>
    value === "13-14" ? "13–14″" : value === "15-16" ? "15–16″" : value;
  const chipRank = (product) => {
    const generation = Number(String(product.chip).match(/\d+/)?.[0] || 0);
    const tier = String(product.chip).includes("Max")
      ? 2
      : String(product.chip).includes("Pro")
        ? 1
        : 0;
    return (
      generation * 1_000_000 +
      tier * 100_000 +
      Number(product.gpuCores || 0) * 100 +
      Number(product.cpuCores || 0)
    );
  };
  const configurationKeyFor = (product) =>
    product.configurationKey ||
    [
      product.family,
      product.screen,
      product.display,
      product.chip,
      product.cpuCores,
      product.gpuCores,
      product.memory,
      product.storage,
    ].join("|");
  const priceFor = (product) => Number(product[priceField]) * priceMultiplier;
  const target = {
    family: String(preferences?.family || ""),
    screen: screenGroupFor(preferences?.screen),
    memory: String(preferences?.memory || ""),
    storage: String(preferences?.storage || ""),
    budget:
      Number.isFinite(Number(preferences?.budget)) &&
      Number(preferences?.budget) > 0
        ? Number(preferences.budget)
        : null,
  };
  const orderedValues = (field, toNumber) =>
    [
      ...new Set(
        products
          .map((product) => product[field])
          .concat(target[field] || [])
          .filter(Boolean),
      ),
    ].sort((left, right) =>
      toNumber(left) - toNumber(right) || compareText(left, right),
    );
  const memories = orderedValues("memory", capacityNumber);
  const storages = orderedValues("storage", capacityNumber);
  const stepDistance = (actual, desired, ordered) =>
    Math.abs(ordered.indexOf(actual) - ordered.indexOf(desired));

  const representativesByConfiguration = new Map();
  for (const product of products) {
    const price = priceFor(product);
    if (!Number.isFinite(price) || price <= 0) continue;
    const configurationKey = configurationKeyFor(product);
    const existing = representativesByConfiguration.get(configurationKey);
    if (
      !existing ||
      price < priceFor(existing) ||
      (price === priceFor(existing) &&
        compareText(product.productCode, existing.productCode) < 0)
    ) {
      representativesByConfiguration.set(configurationKey, product);
    }
  }
  if (representativesByConfiguration.size === 0) {
    throw new Error("catalog has no configurations with a valid price");
  }
  const effectiveShortlistSize = Math.min(
    shortlistSize,
    representativesByConfiguration.size,
  );

  const scoreCandidate = (product) => {
    const differences = [];
    let fitPenalty = 0;
    let matchCount = 0;
    let preferenceCount = 0;
    let underTargetCount = 0;

    const compareExact = (field, penalty) => {
      if (!target[field]) return;
      preferenceCount += 1;
      if (product[field] === target[field]) {
        matchCount += 1;
      } else {
        fitPenalty += penalty;
        differences.push({
          field,
          target: target[field],
          actual: product[field],
          direction: "different",
        });
      }
    };
    const compareOrdered = (
      field,
      ordered,
      undershootPenalty,
      overshootPenalty,
    ) => {
      if (!target[field]) return;
      preferenceCount += 1;
      if (product[field] === target[field]) {
        matchCount += 1;
        return;
      }
      const actualIndex = ordered.indexOf(product[field]);
      const targetIndex = ordered.indexOf(target[field]);
      const isUnder = actualIndex < targetIndex;
      const steps = stepDistance(product[field], target[field], ordered);
      fitPenalty +=
        steps * (isUnder ? undershootPenalty : overshootPenalty);
      if (isUnder) underTargetCount += 1;
      differences.push({
        field,
        target: target[field],
        actual: product[field],
        direction: isUnder ? "under" : "over",
      });
    };
    const compareScreenGroup = () => {
      if (!target.screen) return;
      preferenceCount += 1;
      const actualGroup = screenGroupFor(product.screen);
      if (actualGroup === target.screen) {
        matchCount += 1;
        return;
      }
      const isUnder =
        actualGroup === "13-14" && target.screen === "15-16";
      fitPenalty += 12;
      if (isUnder) underTargetCount += 1;
      differences.push({
        field: "screen",
        target: screenGroupLabel(target.screen),
        actual: product.screen,
        direction: isUnder ? "under" : "over",
      });
    };

    compareExact("family", 28);
    compareScreenGroup();
    compareOrdered("memory", memories, 18, 5);
    compareOrdered("storage", storages, 16, 4);

    const price = priceFor(product);
    const overBudgetBy =
      target.budget === null ? 0 : Math.max(0, price - target.budget);
    return {
      product,
      configurationKey: configurationKeyFor(product),
      price,
      fitPenalty,
      matchCount,
      preferenceCount,
      differences,
      underTargetCount,
      chipRank: chipRank(product),
      overBudgetBy,
    };
  };

  const candidates = [...representativesByConfiguration.values()].map(
    scoreCandidate,
  );
  const compareClosest = (left, right) =>
    Number(left.overBudgetBy > 0) - Number(right.overBudgetBy > 0) ||
    left.fitPenalty - right.fitPenalty ||
    left.price - right.price ||
    right.chipRank - left.chipRank ||
    compareText(left.configurationKey, right.configurationKey) ||
    compareText(left.product.productCode, right.product.productCode);
  candidates.sort(compareClosest);
  const closest = candidates[0];
  const selected = [];
  const selectedKeys = new Set();
  const add = (candidate, kind, label) => {
    if (!candidate || selectedKeys.has(candidate.configurationKey)) return;
    selectedKeys.add(candidate.configurationKey);
    selected.push({
      ...candidate,
      kind,
      label,
      savingComparedToClosest: Math.max(0, closest.price - candidate.price),
    });
  };
  add(closest, "closest", "Ближе всего");

  const savingCandidates = candidates
    .filter(
      (candidate) =>
        !selectedKeys.has(candidate.configurationKey) &&
        candidate.price < closest.price &&
        candidate.fitPenalty <= closest.fitPenalty + 24 &&
        (closest.overBudgetBy > 0 || candidate.overBudgetBy === 0),
    )
    .sort(
      (left, right) =>
        left.price - right.price ||
        left.fitPenalty - right.fitPenalty ||
        right.chipRank - left.chipRank ||
        compareText(left.configurationKey, right.configurationKey),
    )
    .map((candidate) => ({
      ...candidate,
      savingComparedToClosest: closest.price - candidate.price,
    }));
  const saving = savingCandidates[0];
  if (saving) {
    add(saving, "saving", "Можно сэкономить");
  } else {
    add(
      candidates.find(
        (candidate) => !selectedKeys.has(candidate.configurationKey),
      ),
      "alternative",
      "Близкая альтернатива",
    );
  }

  const targetMemory = target.memory
    ? capacityNumber(target.memory)
    : null;
  const targetStorage = target.storage
    ? capacityNumber(target.storage)
    : null;
  const headroomCeiling =
    target.budget ?? Math.max(closest.price, closest.price * 1.5);
  const isAtLeastTarget = (candidate) =>
    (targetMemory === null ||
      capacityNumber(candidate.product.memory) >= targetMemory) &&
    (targetStorage === null ||
      capacityNumber(candidate.product.storage) >= targetStorage);
  const exactForm = (candidate) =>
    (!target.family || candidate.product.family === target.family) &&
    (!target.screen ||
      screenGroupFor(candidate.product.screen) === target.screen);
  const addsHeadroom = (candidate) =>
    candidate.chipRank > closest.chipRank ||
    (targetMemory !== null &&
      capacityNumber(candidate.product.memory) > targetMemory) ||
    (targetStorage !== null &&
      capacityNumber(candidate.product.storage) > targetStorage);
  const headroomComparator = (left, right) =>
    right.chipRank - left.chipRank ||
    left.fitPenalty - right.fitPenalty ||
    left.price - right.price ||
    compareText(left.configurationKey, right.configurationKey);
  const headroomBase = candidates.filter(
    (candidate) =>
      !selectedKeys.has(candidate.configurationKey) &&
      candidate.price <= headroomCeiling &&
      candidate.overBudgetBy === 0 &&
      isAtLeastTarget(candidate) &&
      addsHeadroom(candidate),
  );
  const headroom =
    headroomBase.filter(exactForm).sort(headroomComparator)[0] ||
    headroomBase.sort(headroomComparator)[0];
  if (headroom) {
    add(headroom, "headroom", "Больше запаса");
  } else {
    add(
      candidates.find(
        (candidate) => !selectedKeys.has(candidate.configurationKey),
      ),
      "alternative",
      "Ещё один вариант",
    );
  }

  for (const candidate of candidates) {
    if (selected.length >= effectiveShortlistSize) break;
    add(candidate, "alternative", `Вариант ${selected.length + 1}`);
  }
  return {
    preferences: target,
    items: selected.slice(0, effectiveShortlistSize),
  };
}
