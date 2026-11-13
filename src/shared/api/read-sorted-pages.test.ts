import { expect, it, vi } from "vitest";
import { readListPage } from "./read-sorted-pages";

it("moves rows from later server pages into the first sorted page", async () => {
  const rows = Array.from({ length: 103 }, (_, index) => ({
    id: String(index),
    amount: 103 - index,
  }));
  const read = vi.fn(async (page: number, pageSize: number) => ({
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: rows.length },
  }));
  const first = await readListPage(read, 1, 2, "asc", (row) => row.amount);
  const second = await readListPage(read, 2, 2, "asc", (row) => row.amount);
  expect(first.items.map((row) => row.amount)).toEqual([1, 2]);
  expect(second.items.map((row) => row.amount)).toEqual([3, 4]);
  expect(second.meta).toEqual({ page: 2, pageSize: 2, total: 103 });
  expect(read.mock.calls).toEqual([
    [1, 100],
    [2, 100],
    [1, 100],
    [2, 100],
  ]);
});
