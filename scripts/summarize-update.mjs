#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  loadMarketContext,
  marketIdFromArgv,
} from "./market-profile.mjs";

const { profile, paths } = await loadMarketContext(marketIdFromArgv());
const sourceCurrency = profile.currency.source;
const currencySuffix =
  sourceCurrency.slice(0, 1) + sourceCurrency.slice(1).toLowerCase();
const refurbishedPriceField = profile.currency.priceFields.refurbished;
const changeFromField = `from${currencySuffix}`;
const changeToField = `to${currencySuffix}`;
const [delta, status, featured, site] = await Promise.all([
  readJson(paths.updateDelta),
  readJson(paths.updateStatus),
  readJson(paths.featured),
  readJson(paths.site),
]);
const compact = process.argv.includes("--compact");
const totalChanges = Object.values(delta.counts).reduce(
  (sum, count) => sum + count,
  0,
);
const topCodes = featured.items
  .slice()
  .sort((left, right) => left.rank - right.rank)
  .map((item) => item.productCode)
  .join(", ");

if (compact) {
  console.log(
    delta.hasChanges
      ? `Изменений: ${totalChanges}; +${delta.counts.added}, −${delta.counts.removed}, цены ${
          delta.counts.refurbPriceChanges +
          delta.counts.newPriceChanges +
          (delta.counts.configurationChanges ?? 0) +
          (delta.counts.taxInclusivePriceChanges ?? 0)
        }.`
      : `Без изменений: ${status.counts.products} позиций, топ ${topCodes}.`,
  );
} else {
  const lines = [
    `${profile.siteName} · ${formatDate(delta.checkedAt)}`,
    `Каталог: ${status.counts.products} позиций — ${status.counts.air} Air и ${status.counts.pro} Pro.`,
    `Точная новая цена: ${status.counts.pricedProducts} позиций / ${status.counts.pricedConfigurations} конфигураций; недоступно ${status.counts.unavailableCurrentConfigurations ?? 0} конфигураций.`,
  ];
  if (!delta.hasChanges) {
    lines.push("Изменений с предыдущего запуска нет.");
  } else {
    lines.push(
      `Изменения: +${delta.counts.added}, −${delta.counts.removed}, ` +
        `refurb-цены ${delta.counts.refurbPriceChanges}, ` +
        `новые цены ${delta.counts.newPriceChanges}, ` +
        `конфигурации ${delta.counts.configurationChanges ?? 0}, ` +
        `топ-3 ${delta.counts.featuredChanges}.`,
    );
    lines.push(...detailLines(delta).slice(0, 12));
  }
  lines.push(`Топ-3: ${topCodes}.`);
  lines.push(
    profile.publication.approvalRequired
      ? `Публикация: требуется одобрение проекта ${profile.publication.projectSlug}.`
      : `Сайт: ${profile.publication.productionUrl || site.productionUrl}`,
  );
  console.log(lines.join("\n"));
}

function detailLines(latestDelta) {
  const rate =
    profile.currency.conversion.type === "identity"
      ? 1
      : site.currency[profile.currency.conversion.siteField];
  const displayPrice = new Intl.NumberFormat(profile.currency.displayLocale, {
    style: "currency",
    currency: profile.currency.display,
    minimumFractionDigits: profile.currency.displayFractionDigits,
    maximumFractionDigits: profile.currency.displayFractionDigits,
  });
  const price = (amount) =>
    amount === null ? "нет точной цены" : displayPrice.format(amount * rate);
  const lines = [];
  for (const item of latestDelta.added) {
    lines.push(
      `• Добавлено: ${productLabel(item)} — ${
        price(item[refurbishedPriceField])
      }.`,
    );
  }
  for (const item of latestDelta.removed) {
    lines.push(`• Исчезло: ${productLabel(item)}.`);
  }
  for (const item of latestDelta.refurbPriceChanges) {
    lines.push(
      `• Refurb ${item.product.productCode}: ${
        price(item[changeFromField])
      } → ${price(item[changeToField])}.`,
    );
  }
  for (const item of latestDelta.newPriceChanges) {
    lines.push(
      `• Новый ${item.product.productCode}: ${
        price(item[changeFromField])
      } → ${price(item[changeToField])}.`,
    );
  }
  for (const item of latestDelta.configurationChanges ?? []) {
    lines.push(
      `• Конфигурация ${item.productCode}: ${configurationLabel(
        item.before,
      )} → ${configurationLabel(item.after)}.`,
    );
  }
  for (const item of latestDelta.taxInclusivePriceChanges ?? []) {
    const before =
      ["resolved", "estimated"].includes(item.before?.status)
        ? price(item.before.amount)
        : "не получено";
    const after =
      ["resolved", "estimated"].includes(item.after?.status)
        ? price(item.after.amount)
        : "не получено";
    lines.push(
      `• Итого с налогом ${item.product.productCode}: ${before} → ${after}.`,
    );
  }
  if (latestDelta.featured) {
    lines.push(
      `• Топ-3: ${latestDelta.featured.before.join(", ")} → ` +
        latestDelta.featured.after.join(", "),
    );
  }
  return lines;
}

function configurationLabel(configuration) {
  return (
    `${configuration.family} ${configuration.screen} · ${configuration.display} · ` +
    `${configuration.chip} ${configuration.cpuCores}/${configuration.gpuCores} · ` +
    `${configuration.memory}/${configuration.storage}`
  );
}

function productLabel(product) {
  const display =
    product.display === "Nano-texture" ? " · Nano-texture" : "";
  return (
    `MacBook ${product.family} ${product.screen}${display} · ${product.chip} · ` +
    `${product.memory}/${product.storage} · ${product.productCode}`
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Minsk",
  }).format(new Date(value));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
