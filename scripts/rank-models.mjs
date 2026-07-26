#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadMarketContext,
  loadMarketProfile,
} from "./market-profile.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultMarketProfile = await loadMarketProfile("sg");
const defaultPaths = {
  catalog: resolve(projectRoot, "data/catalog.json"),
  policy: resolve(projectRoot, "config/ranking-policy.json"),
  output: resolve(projectRoot, "data/featured.json"),
};

const identityFields = [
  "family",
  "screen",
  "display",
  "chip",
  "cpuCores",
  "gpuCores",
  "memory",
  "storage",
];

const labels = [
  "Лучший выбор",
  "Сильная альтернатива",
  "Ещё один удачный вариант",
];

function fail(message) {
  throw new Error(message);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
}

function validateScoreTable(table, label) {
  requireObject(table, label);
  const entries = Object.entries(table);
  if (entries.length === 0) fail(`${label} must not be empty`);
  for (const [key, score] of entries) {
    requireNonEmptyString(key, `${label} key`);
    requireNonNegativeInteger(score, `${label}.${key}`);
  }
}

function priceContext(marketProfile = defaultMarketProfile) {
  const { source, priceFields } = marketProfile.currency;
  const currencySuffix =
    source.slice(0, 1) + source.slice(1).toLowerCase();
  return {
    refurbishedField: priceFields.refurbished,
    newField: priceFields.new,
    fullScoreField: `fullScoreAtOrBelow${currencySuffix}`,
    zeroScoreField: `zeroScoreAtOrAbove${currencySuffix}`,
    savingField: `saving${currencySuffix}`,
  };
}

export function validatePolicy(
  policy,
  marketProfile = defaultMarketProfile,
) {
  requireObject(policy, "ranking policy");
  if (policy.schemaVersion !== 1) {
    fail(`unsupported ranking policy schemaVersion: ${policy.schemaVersion}`);
  }
  requireNonEmptyString(policy.policyVersion, "policyVersion");
  if (policy.scoreUnit !== "milli-points") {
    fail('scoreUnit must be "milli-points"');
  }
  requirePositiveInteger(policy.shortlistSize, "shortlistSize");

  requireObject(policy.ideal, "ideal");
  for (const field of ["family", "screen", "memory", "storage"]) {
    requireNonEmptyString(policy.ideal[field], `ideal.${field}`);
    if (policy.ideal[field] !== marketProfile.ranking.reference[field]) {
      fail(
        `ideal.${field} must match ${marketProfile.id} market profile reference`,
      );
    }
  }

  requireObject(policy.deduplication, "deduplication");
  if (policy.deduplication.key !== "configurationKey") {
    fail('deduplication.key must be "configurationKey"');
  }
  const { refurbishedField, fullScoreField, zeroScoreField } =
    priceContext(marketProfile);
  const expectedRepresentativeOrdering = [
    `${refurbishedField}:asc`,
    "productCode:asc",
  ];
  if (
    JSON.stringify(policy.deduplication.representativeOrdering) !==
    JSON.stringify(expectedRepresentativeOrdering)
  ) {
    fail(
      `representativeOrdering must be ${expectedRepresentativeOrdering.join(
        ", ",
      )}`,
    );
  }

  const expectedTotalOrdering = [
    "score:desc",
    `${refurbishedField}:asc`,
    "gpuCores:desc",
    "cpuCores:desc",
    "configurationKey:asc",
    "productCode:asc",
  ];
  if (
    JSON.stringify(policy.totalOrdering) !==
    JSON.stringify(expectedTotalOrdering)
  ) {
    fail(`totalOrdering must be ${expectedTotalOrdering.join(", ")}`);
  }

  requireObject(policy.featuredSelection, "featuredSelection");
  if (policy.featuredSelection.key !== "configurationKey") {
    fail('featuredSelection.key must be "configurationKey"');
  }
  if (
    policy.featuredSelection.method !==
    "top-ranked-unique-configurations"
  ) {
    fail(
      'featuredSelection.method must be "top-ranked-unique-configurations"',
    );
  }

  requireObject(policy.components, "components");
  validateScoreTable(
    policy.components.memory?.scoresMilliPoints,
    "components.memory.scoresMilliPoints",
  );
  validateScoreTable(
    policy.components.storage?.scoresMilliPoints,
    "components.storage.scoresMilliPoints",
  );
  validateScoreTable(
    policy.components.formFactor?.scoresMilliPoints,
    "components.formFactor.scoresMilliPoints",
  );
  validateScoreTable(
    policy.components.chipRecency?.generationMilliPoints,
    "components.chipRecency.generationMilliPoints",
  );
  validateScoreTable(
    policy.components.chipRecency?.tierBonusMilliPoints,
    "components.chipRecency.tierBonusMilliPoints",
  );

  const affordability = policy.components.affordability;
  requireObject(affordability, "components.affordability");
  requirePositiveInteger(
    affordability[fullScoreField],
    `components.affordability.${fullScoreField}`,
  );
  requirePositiveInteger(
    affordability[zeroScoreField],
    `components.affordability.${zeroScoreField}`,
  );
  requirePositiveInteger(
    affordability.maxMilliPoints,
    "components.affordability.maxMilliPoints",
  );
  if (
    affordability[fullScoreField] >=
    affordability[zeroScoreField]
  ) {
    fail(
      "affordability full-score price must be below its zero-score price",
    );
  }

  const discount = policy.components.verifiedDiscount;
  requireObject(discount, "components.verifiedDiscount");
  requirePositiveInteger(
    discount.fullScoreAtBasisPoints,
    "components.verifiedDiscount.fullScoreAtBasisPoints",
  );
  if (discount.fullScoreAtBasisPoints > 10000) {
    fail(
      "components.verifiedDiscount.fullScoreAtBasisPoints cannot exceed 10000",
    );
  }
  requirePositiveInteger(
    discount.maxMilliPoints,
    "components.verifiedDiscount.maxMilliPoints",
  );
}

function validateCatalog(
  catalog,
  policy,
  marketProfile = defaultMarketProfile,
) {
  requireObject(catalog, "catalog");
  if (catalog.schemaVersion !== 1) {
    fail(`unsupported catalog schemaVersion: ${catalog.schemaVersion}`);
  }
  if (!Array.isArray(catalog.products) || catalog.products.length === 0) {
    fail("catalog.products must be a non-empty array");
  }

  const productCodes = new Set();
  const supported = {
    memory: policy.components.memory.scoresMilliPoints,
    storage: policy.components.storage.scoresMilliPoints,
    formFactor: policy.components.formFactor.scoresMilliPoints,
  };

  for (const [index, product] of catalog.products.entries()) {
    const label = `catalog.products[${index}]`;
    requireObject(product, label);
    for (const field of [
      "configurationKey",
      "productCode",
      "family",
      "screen",
      "display",
      "chip",
      "memory",
      "storage",
    ]) {
      requireNonEmptyString(product[field], `${label}.${field}`);
    }
    requirePositiveInteger(product.cpuCores, `${label}.cpuCores`);
    requirePositiveInteger(product.gpuCores, `${label}.gpuCores`);
    const { refurbishedField, newField } = priceContext(marketProfile);
    requirePositiveInteger(
      product[refurbishedField],
      `${label}.${refurbishedField}`,
    );
    if (product[newField] !== null && product[newField] !== undefined) {
      requirePositiveInteger(product[newField], `${label}.${newField}`);
    }

    if (productCodes.has(product.productCode)) {
      fail(`duplicate productCode: ${product.productCode}`);
    }
    productCodes.add(product.productCode);

    if (!(product.memory in supported.memory)) {
      fail(`${label}.memory is not covered by policy: ${product.memory}`);
    }
    if (!(product.storage in supported.storage)) {
      fail(`${label}.storage is not covered by policy: ${product.storage}`);
    }
    const formFactorKey = `${product.family}|${product.screen}`;
    if (!(formFactorKey in supported.formFactor)) {
      fail(`${label} form factor is not covered by policy: ${formFactorKey}`);
    }
    parseChip(product.chip, policy, label);
  }
}

function parseChip(chip, policy, label = "product") {
  const match = /^(M\d+)(?: (Pro|Max))?$/.exec(chip);
  if (!match) fail(`${label}.chip has unsupported format: ${chip}`);
  const generation = match[1];
  const tier = match[2] ?? "base";
  if (
    !(generation in policy.components.chipRecency.generationMilliPoints) ||
    !(tier in policy.components.chipRecency.tierBonusMilliPoints)
  ) {
    fail(`${label}.chip is not covered by policy: ${chip}`);
  }
  return { generation, tier };
}

function assertConfigurationIdentity(configurationKey, products) {
  const baseline = products[0];
  for (const product of products.slice(1)) {
    for (const field of identityFields) {
      if (product[field] !== baseline[field]) {
        fail(
          `configurationKey ${configurationKey} contains conflicting ${field} values`,
        );
      }
    }
  }
}

function selectRepresentatives(
  products,
  marketProfile = defaultMarketProfile,
) {
  const { refurbishedField } = priceContext(marketProfile);
  const groups = new Map();
  for (const product of products) {
    const group = groups.get(product.configurationKey);
    if (group) group.push(product);
    else groups.set(product.configurationKey, [product]);
  }

  const representatives = [];
  const sortedKeys = [...groups.keys()].sort(compareText);
  for (const configurationKey of sortedKeys) {
    const productsForConfiguration = groups.get(configurationKey);
    assertConfigurationIdentity(configurationKey, productsForConfiguration);
    productsForConfiguration.sort(
      (left, right) =>
        left[refurbishedField] - right[refurbishedField] ||
        compareText(left.productCode, right.productCode),
    );
    representatives.push(productsForConfiguration[0]);
  }
  return representatives;
}

function scoreAffordability(price, policy, marketProfile) {
  const component = policy.components.affordability;
  const { fullScoreField, zeroScoreField } = priceContext(marketProfile);
  if (price <= component[fullScoreField]) {
    return component.maxMilliPoints;
  }
  if (price >= component[zeroScoreField]) return 0;
  const priceSpan =
    component[zeroScoreField] - component[fullScoreField];
  const priceRoom = component[zeroScoreField] - price;
  return Math.trunc((priceRoom * component.maxMilliPoints) / priceSpan);
}

function discountMetrics(product, policy, marketProfile) {
  const { refurbishedField, newField, savingField } =
    priceContext(marketProfile);
  if (
    product[newField] === null ||
    product[newField] === undefined ||
    product[newField] <= product[refurbishedField]
  ) {
    return { [savingField]: 0, basisPoints: 0, score: 0 };
  }

  const component = policy.components.verifiedDiscount;
  const saving = product[newField] - product[refurbishedField];
  const basisPoints = Math.trunc(
    (saving * 10000) / product[newField],
  );
  const cappedBasisPoints = Math.min(
    basisPoints,
    component.fullScoreAtBasisPoints,
  );
  const score = Math.trunc(
    (cappedBasisPoints * component.maxMilliPoints) /
      component.fullScoreAtBasisPoints,
  );
  return { [savingField]: saving, basisPoints, score };
}

function scoreProduct(product, policy, marketProfile) {
  const { generation, tier } = parseChip(product.chip, policy);
  const components = policy.components;
  const { refurbishedField } = priceContext(marketProfile);
  const discount = discountMetrics(product, policy, marketProfile);
  const scoreBreakdown = {
    memory: components.memory.scoresMilliPoints[product.memory],
    storage: components.storage.scoresMilliPoints[product.storage],
    formFactor:
      components.formFactor.scoresMilliPoints[
        `${product.family}|${product.screen}`
      ],
    chipRecency:
      components.chipRecency.generationMilliPoints[generation] +
      components.chipRecency.tierBonusMilliPoints[tier],
    affordability: scoreAffordability(
      product[refurbishedField],
      policy,
      marketProfile,
    ),
    verifiedDiscount: discount.score,
  };
  const score = Object.values(scoreBreakdown).reduce(
    (total, componentScore) => total + componentScore,
    0,
  );
  return { product, score, scoreBreakdown, discount, generation, tier };
}

function reasonCodesFor(scored, policy) {
  const { product, discount, generation, tier } = scored;
  const codes = [];
  if (product.memory === policy.ideal.memory) {
    codes.push(`MEMORY_IDEAL_${product.memory}`);
  } else {
    codes.push(`MEMORY_${product.memory.replace("GB", "GB")}`);
  }
  if (product.storage === policy.ideal.storage) {
    codes.push(`STORAGE_IDEAL_${product.storage}`);
  } else {
    codes.push(`STORAGE_${product.storage}`);
  }
  if (
    product.family === policy.ideal.family &&
    product.screen === policy.ideal.screen
  ) {
    codes.push(
      `FORM_IDEAL_${product.family.toUpperCase()}_${product.screen.replace(/\D/g, "")}`,
    );
  } else {
    codes.push(
      `FORM_${product.family.toUpperCase()}_${product.screen.replace(/\D/g, "")}`,
    );
  }
  codes.push(`CHIP_GENERATION_${generation}`);
  if (tier !== "base") codes.push(`CHIP_TIER_${tier.toUpperCase()}`);

  const affordability = policy.components.affordability;
  if (scored.scoreBreakdown.affordability * 4 >= affordability.maxMilliPoints * 3) {
    codes.push("PRICE_HIGH_VALUE");
  } else if (
    scored.scoreBreakdown.affordability * 2 >= affordability.maxMilliPoints
  ) {
    codes.push("PRICE_BALANCED");
  } else {
    codes.push("PRICE_PREMIUM");
  }
  if (discount.score > 0) codes.push("DISCOUNT_VERIFIED");
  return codes;
}

function russianCapacity(capacity) {
  return capacity.replace("GB", " ГБ").replace("TB", " ТБ");
}

function headlineFor(product) {
  const displaySuffix =
    product.display === "Nano-texture" ? " · Nano-texture display" : "";
  return `MacBook ${product.family} ${product.screen}${displaySuffix} · ${
    product.chip
  } (${product.cpuCores}-ядерный CPU, ${
    product.gpuCores
  }-ядерный GPU) · ${russianCapacity(
    product.memory,
  )} · ${russianCapacity(product.storage)}`;
}

function reasonFor(scored, policy) {
  const { product, discount } = scored;
  const exactForm =
    product.family === policy.ideal.family &&
    product.screen === policy.ideal.screen;
  const exactMemory = product.memory === policy.ideal.memory;
  const exactStorage = product.storage === policy.ideal.storage;

  let reason;
  if (exactForm && exactMemory && exactStorage) {
    reason = `Точно соответствует целевой конфигурации: MacBook Air ${
      product.screen
    }, ${russianCapacity(product.memory)} памяти и SSD на ${russianCapacity(
      product.storage,
    )}.`;
  } else if (exactMemory && exactStorage) {
    reason = `${russianCapacity(
      product.memory,
    )} памяти и SSD на ${russianCapacity(
      product.storage,
    )} соответствуют цели; здесь они в корпусе MacBook ${product.family} ${
      product.screen
    }.`;
  } else if (exactForm && exactMemory) {
    reason = `Соответствует целевым параметрам MacBook Air ${
      product.screen
    } и ${russianCapacity(
      product.memory,
    )} памяти; главный компромисс — SSD на ${russianCapacity(
      product.storage,
    )}.`;
  } else {
    reason = `${russianCapacity(
      product.memory,
    )} памяти, SSD на ${russianCapacity(product.storage)} и чип ${
      product.chip
    } дают один из лучших вариантов рядом с целевой конфигурацией.`;
  }

  if (discount.score > 0) {
    reason += " Подтверждённая скидка усиливает ценность.";
  } else {
    reason += " Цена учтена в оценке ценности.";
  }
  return reason;
}

function recommendationKeyFor(product, policy) {
  if (policy.featuredSelection.key !== "configurationKey") {
    fail("featured selection must use configurationKey");
  }
  return product.configurationKey;
}

export function rankCatalog(
  catalog,
  policy,
  marketProfile = defaultMarketProfile,
) {
  const { refurbishedField } = priceContext(marketProfile);
  validatePolicy(policy, marketProfile);
  validateCatalog(catalog, policy, marketProfile);
  const representatives = selectRepresentatives(
    catalog.products,
    marketProfile,
  );
  if (representatives.length < policy.shortlistSize) {
    fail(
      `catalog has only ${representatives.length} unique configurations; ${policy.shortlistSize} required`,
    );
  }

  const ranked = representatives.map((product) =>
    scoreProduct(product, policy, marketProfile),
  );
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.product[refurbishedField] - right.product[refurbishedField] ||
      right.product.gpuCores - left.product.gpuCores ||
      right.product.cpuCores - left.product.cpuCores ||
      compareText(
        left.product.configurationKey,
        right.product.configurationKey,
      ) ||
      compareText(left.product.productCode, right.product.productCode),
  );

  const selected = [];
  const seenRecommendationKeys = new Set();
  for (const scored of ranked) {
    const recommendationKey = recommendationKeyFor(scored.product, policy);
    if (seenRecommendationKeys.has(recommendationKey)) continue;
    seenRecommendationKeys.add(recommendationKey);
    selected.push({ ...scored, recommendationKey });
    if (selected.length === policy.shortlistSize) break;
  }
  if (selected.length < policy.shortlistSize) {
    fail(
      `catalog has only ${selected.length} distinct recommendations; ${policy.shortlistSize} required`,
    );
  }

  return {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    ideal: {
      family: policy.ideal.family,
      screen: policy.ideal.screen,
      memory: policy.ideal.memory,
      storage: policy.ideal.storage,
    },
    items: selected.map((scored, index) => ({
      rank: index + 1,
      recommendationKey: scored.recommendationKey,
      configurationKey: scored.product.configurationKey,
      productCode: scored.product.productCode,
      score: scored.score,
      scoreBreakdown: scored.scoreBreakdown,
      reasonCodes: reasonCodesFor(scored, policy),
      label: labels[index] ?? `Место ${index + 1}`,
      headline: headlineFor(scored.product),
      reason: reasonFor(scored, policy),
    })),
  };
}

export function renderFeaturedJson(featured) {
  return `${JSON.stringify(featured, null, 2)}\n`;
}

export async function runRanking({
  catalogPath,
  policyPath,
  outputPath,
  check = false,
  marketId = "sg",
  marketProfile,
} = {}) {
  const context = marketProfile
    ? null
    : await loadMarketContext(marketId);
  const activeProfile = marketProfile ?? context.profile;
  catalogPath ??=
    context?.paths.catalog ?? defaultPaths.catalog;
  policyPath ??=
    context?.policyPath ?? defaultPaths.policy;
  outputPath ??=
    context?.paths.featured ?? defaultPaths.output;
  const [catalogText, policyText] = await Promise.all([
    readFile(catalogPath, "utf8"),
    readFile(policyPath, "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  const policy = JSON.parse(policyText);
  const featured = rankCatalog(catalog, policy, activeProfile);
  const output = renderFeaturedJson(featured);

  if (check) {
    const existing = await readFile(outputPath, "utf8");
    if (existing !== output) {
      fail(`${outputPath} is stale; run scripts/rank-models.mjs`);
    }
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
  }

  return { featured, output };
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    const optionNames = {
      "--catalog": "catalogPath",
      "--policy": "policyPath",
      "--output": "outputPath",
      "--market": "marketId",
    };
    const optionName = optionNames[argument];
    if (!optionName) fail(`unknown argument: ${argument}`);
    const value = argumentsList[index + 1];
    if (!value) fail(`${argument} requires a path`);
    options[optionName] =
      optionName === "marketId" ? value : resolve(process.cwd(), value);
    index += 1;
  }
  return options;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runRanking(parseArguments(process.argv.slice(2)))
    .then(({ featured }) => {
      process.stdout.write(
        `Ranked ${featured.items.length} configurations with policy ${featured.policyVersion}.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
