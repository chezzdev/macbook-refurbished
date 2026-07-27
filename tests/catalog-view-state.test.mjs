import assert from "node:assert/strict";
import test from "node:test";

import {
  readCatalogViewState,
  writeCatalogViewSearch,
  writeOwnedChoiceSearch,
} from "../scripts/catalog-view-state.mjs";

const options = {
  filterNames: ["family", "screen", "chip", "memory", "storage"],
  allowedFilterValues: {
    family: ["Air", "Pro"],
    screen: ["13″", "14″", "15″", "16″"],
    chip: ["M4", "M5 Pro"],
    memory: ["16GB", "24GB"],
    storage: ["512GB", "1TB"],
  },
  allowedSortingValues: [
    "recommended",
    "price-asc",
    "price-desc",
    "memory",
    "newest",
  ],
  defaultSorting: "recommended",
};

test("reads valid repeated filters and ignores invalid URL values", () => {
  const state = readCatalogViewState(
    "?family=Air&family=Air&family=Studio&screen=13%E2%80%B3&sort=price-asc",
    options,
  );
  assert.deepEqual(state, {
    filters: {
      family: ["Air"],
      screen: ["13″"],
      chip: [],
      memory: [],
      storage: [],
    },
    sorting: "price-asc",
  });
});

test("falls back to the default sorting for an unsupported value", () => {
  assert.equal(
    readCatalogViewState("?sort=random", options).sorting,
    "recommended",
  );
});

test("writes a deterministic shareable query and preserves unrelated params", () => {
  const search = writeCatalogViewSearch(
    "?utm_source=friend&family=Pro&sort=newest",
    {
      filters: {
        family: ["Air", "Pro", "Air"],
        screen: ["13″"],
        chip: [],
        memory: ["24GB"],
        storage: [],
      },
      sorting: "price-desc",
    },
    options,
  );
  assert.equal(
    search,
    "?utm_source=friend&family=Air&family=Pro&screen=13%E2%80%B3&memory=24GB&sort=price-desc",
  );
  assert.deepEqual(
    readCatalogViewState(search, options),
    {
      filters: {
        family: ["Air", "Pro"],
        screen: ["13″"],
        chip: [],
        memory: ["24GB"],
        storage: [],
      },
      sorting: "price-desc",
    },
  );
});

test("reset removes owned params while keeping unrelated query state", () => {
  assert.equal(
    writeCatalogViewSearch(
      "?family=Air&screen=13%E2%80%B3&sort=memory&utm_campaign=test",
      {
        filters: Object.fromEntries(
          options.filterNames.map((name) => [name, []]),
        ),
        sorting: "recommended",
      },
      options,
    ),
    "?utm_campaign=test",
  );
});

test("writes a non-default owned choice while preserving unrelated params", () => {
  assert.equal(
    writeOwnedChoiceSearch(
      "?utm_source=friend&state=invalid&family=Air",
      {
        parameter: "state",
        value: "co",
        allowedValues: ["ca", "co", "ma", "sd"],
        defaultValue: "ca",
      },
    ),
    "?utm_source=friend&family=Air&state=co",
  );
});

test("removes default or unsupported owned choices from the query", () => {
  const choiceOptions = {
    parameter: "state",
    allowedValues: ["ca", "co", "ma", "sd"],
    defaultValue: "ca",
  };
  assert.equal(
    writeOwnedChoiceSearch("?state=xx&utm_campaign=test", {
      ...choiceOptions,
      value: "ca",
    }),
    "?utm_campaign=test",
  );
  assert.equal(
    writeOwnedChoiceSearch("?state=sd&utm_campaign=test", {
      ...choiceOptions,
      value: "xx",
    }),
    "?utm_campaign=test",
  );
});
