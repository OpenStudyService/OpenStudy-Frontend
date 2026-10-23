import type { Page } from "../domain/schema";
import { ApiError } from "./client";

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asCollections<T extends { [K in keyof T]: unknown[] }>(
  defaults: T,
  value: unknown,
): T {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      asArray((source as Record<string, unknown>)[key]),
    ]),
  ) as T;
}

export function asPage<T>(value: unknown): Page<T> {
  const source =
    value && typeof value === "object" ? (value as Partial<Page<T>>) : {};
  const items = asArray<T>(source.items);
  // Foundation endpoints use meta; legacy demo domains still return flat pages.
  const meta =
    "meta" in source && source.meta && typeof source.meta === "object"
      ? (source.meta as Partial<Page<T>>)
      : source;
  return {
    items,
    page: typeof meta.page === "number" && meta.page > 0 ? meta.page : 1,
    pageSize:
      typeof meta.pageSize === "number" && meta.pageSize > 0
        ? meta.pageSize
        : 20,
    total:
      typeof meta.total === "number" && meta.total >= 0
        ? meta.total
        : items.length,
    ...(source.nextCursor ? { nextCursor: source.nextCursor } : {}),
  };
}

export function isAccessError(error: unknown): boolean {
  return error instanceof ApiError && [401, 403].includes(error.status);
}
