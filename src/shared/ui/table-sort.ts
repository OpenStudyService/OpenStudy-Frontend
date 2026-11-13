import { useState } from "react";
import { useSearchParams } from "react-router";

export type SortDirection = "asc" | "desc";
export type TableSort = { sort: string; direction: SortDirection };

export function sortColumn(
  label: string,
  key: string,
  current: TableSort | undefined,
  change: (next: TableSort) => void,
  initial: SortDirection = "asc",
) {
  const direction = current?.sort === key ? current.direction : undefined;
  return {
    label,
    direction,
    onSort: () =>
      change({
        sort: key,
        direction: direction ? (direction === "asc" ? "desc" : "asc") : initial,
      }),
  };
}

export function useTableSort(
  defaults: TableSort,
  prefix = "",
  pageKey = prefix ? `${prefix}Page` : "page",
) {
  const [params, setParams] = useSearchParams();
  const sortKey = prefix ? `${prefix}Sort` : "sort";
  const directionKey = prefix ? `${prefix}Direction` : "direction";
  const sort = params.get(sortKey) ?? defaults.sort;
  const direction = params.get(directionKey);
  const value = {
    sort,
    direction:
      direction === "asc" || direction === "desc"
        ? direction
        : defaults.direction,
  };
  function change(next: TableSort) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set(sortKey, next.sort);
        updated.set(directionKey, next.direction);
        updated.delete(pageKey);
        return updated;
      },
      { replace: true },
    );
  }
  return {
    value,
    fallback: <Row>(values: Record<string, (row: Row) => SortValue>) =>
      Object.hasOwn(values, sort) ? values[sort] : undefined,
    column: (label: string, key: string, initial?: SortDirection) =>
      sortColumn(label, key, value, change, initial),
  };
}

type SortValue = string | number | null | undefined;
const collator = new Intl.Collator("ko", { numeric: true });

export function sortRows<Row>(
  rows: Row[],
  value: (row: Row) => SortValue,
  direction: SortDirection,
) {
  return rows.toSorted((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left == null || right == null)
      return Number(left == null) - Number(right == null);
    const comparison =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : collator.compare(String(left), String(right));
    return direction === "asc" ? comparison : -comparison;
  });
}

export function useLocalTableSort<Row>(
  columns: { label: string; value: (row: Row) => SortValue }[],
) {
  const [sort, setSort] = useState<TableSort>();
  return {
    columns: columns.map(({ label }, index) =>
      sortColumn(label, String(index), sort, setSort),
    ),
    order: (rows: Row[]) => {
      if (!sort) return rows;
      const value = columns[Number(sort.sort)].value;
      return sortRows(rows, value, sort.direction);
    },
  };
}
