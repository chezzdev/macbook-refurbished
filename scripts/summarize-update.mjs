#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const [delta, status, featured, site] = await Promise.all([
  readJson("data/update-delta.json"),
  readJson("data/update-status.json"),
  readJson("data/featured.json"),
  readJson("data/site.json"),
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
      ? `Изменений: ${totalChanges}; +${delta.counts.added}, −${delta.counts.removed}, цены ${delta.counts.refurbPriceChanges + delta.counts.newPriceChanges}.`
      : `Без изменений: ${status.counts.products} позиций, топ ${topCodes}.`,
  );
} else {
  const lines = [
    `MacBook Refurbished SG · ${formatDate(delta.checkedAt)}`,
    `Каталог: ${status.counts.products} позиций — ${status.counts.air} Air и ${status.counts.pro} Pro.`,
  ];
  if (!delta.hasChanges) {
    lines.push("Изменений с предыдущего запуска нет.");
  } else {
    lines.push(
      `Изменения: +${delta.counts.added}, −${delta.counts.removed}, ` +
        `refurb-цены ${delta.counts.refurbPriceChanges}, ` +
        `новые цены ${delta.counts.newPriceChanges}, ` +
        `топ-3 ${delta.counts.featuredChanges}.`,
    );
    lines.push(...detailLines(delta).slice(0, 12));
  }
  lines.push(`Топ-3: ${topCodes}.`);
  lines.push(`Сайт: ${site.productionUrl}`);
  console.log(lines.join("\n"));
}

function detailLines(latestDelta) {
  const rate = site.currency.sgdToUsd;
  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const price = (amount) =>
    amount === null ? "нет точной цены" : usd.format(amount * rate);
  const lines = [];
  for (const item of latestDelta.added) {
    lines.push(`• Добавлено: ${productLabel(item)} — ${price(item.priceSgd)}.`);
  }
  for (const item of latestDelta.removed) {
    lines.push(`• Исчезло: ${productLabel(item)}.`);
  }
  for (const item of latestDelta.refurbPriceChanges) {
    lines.push(
      `• Refurb ${item.product.productCode}: ${price(item.fromSgd)} → ${price(item.toSgd)}.`,
    );
  }
  for (const item of latestDelta.newPriceChanges) {
    lines.push(
      `• Новый ${item.product.productCode}: ${price(item.fromSgd)} → ${price(item.toSgd)}.`,
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

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(resolve(workspaceRoot, relativePath), "utf8"),
  );
}
