export function readCatalogViewState(
  search,
  {
    filterNames,
    allowedFilterValues,
    allowedSortingValues,
    defaultSorting,
  },
) {
  const parameters = new URLSearchParams(search);
  const filters = {};
  for (const name of filterNames) {
    const allowed = new Set(allowedFilterValues[name] ?? []);
    filters[name] = [
      ...new Set(
        parameters
          .getAll(name)
          .filter((value) => allowed.has(value)),
      ),
    ];
  }
  const requestedSorting = parameters.get("sort");
  return {
    filters,
    sorting: allowedSortingValues.includes(requestedSorting)
      ? requestedSorting
      : defaultSorting,
  };
}

export function writeCatalogViewSearch(
  search,
  state,
  {
    filterNames,
    allowedFilterValues,
    allowedSortingValues,
    defaultSorting,
  },
) {
  const parameters = new URLSearchParams(search);
  for (const name of filterNames) parameters.delete(name);
  parameters.delete("sort");

  for (const name of filterNames) {
    const allowed = new Set(allowedFilterValues[name] ?? []);
    const selected = Array.isArray(state.filters?.[name])
      ? state.filters[name]
      : [];
    for (const value of new Set(selected)) {
      if (allowed.has(value)) parameters.append(name, value);
    }
  }
  if (
    state.sorting !== defaultSorting &&
    allowedSortingValues.includes(state.sorting)
  ) {
    parameters.set("sort", state.sorting);
  }

  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}
