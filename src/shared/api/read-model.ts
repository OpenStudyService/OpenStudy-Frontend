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
  return {
    items,
    page: typeof source.page === "number" && source.page > 0 ? source.page : 1,
    pageSize:
      typeof source.pageSize === "number" && source.pageSize > 0
        ? source.pageSize
        : 20,
    total:
      typeof source.total === "number" && source.total >= 0
        ? source.total
        : items.length,
    ...(source.nextCursor ? { nextCursor: source.nextCursor } : {}),
  };
}

export function isAccessError(error: unknown): boolean {
  return error instanceof ApiError && [401, 403].includes(error.status);
}
