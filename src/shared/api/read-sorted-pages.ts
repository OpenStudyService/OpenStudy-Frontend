import { sortRows } from "../ui/table-sort";
import type { SortDirection } from "../ui/table-sort";

export async function readSortedPages<Row>(
  read: (
    page: number,
    pageSize: number,
  ) => Promise<{ items: Row[]; total: number }>,
  page: number,
  pageSize: number,
  direction: SortDirection,
  value: Parameters<typeof sortRows<Row>>[1],
  rowId: (row: Row) => string,
) {
  const batchSize = 100;
  const first = await read(1, batchSize);
  const rows = [...first.items];
  const ids = new Set(rows.map(rowId));
  if (ids.size !== rows.length || rows.length > first.total)
    throw new Error("목록이 변경되었습니다. 다시 조회해 주세요.");
  for (let index = 2; rows.length < first.total; index++) {
    const next = await read(index, batchSize);
    if (
      !next.items.length ||
      next.total !== first.total ||
      rows.length + next.items.length > first.total
    ) {
      throw new Error("목록이 변경되었습니다. 다시 조회해 주세요.");
    }
    for (const row of next.items) {
      const id = rowId(row);
      if (ids.has(id))
        throw new Error("목록이 변경되었습니다. 다시 조회해 주세요.");
      ids.add(id);
      rows.push(row);
    }
  }
  return sortRows(rows, value, direction).slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
}

export async function readListPage<
  Page extends {
    items: { id: string }[];
    meta: { page: number; pageSize: number; total: number };
  },
>(
  read: (page: number, pageSize: number) => Promise<Page>,
  page: number,
  pageSize: number,
  direction: SortDirection,
  value?: (
    row: NoInfer<Page>["items"][number],
  ) => string | number | null | undefined,
): Promise<Page> {
  if (
    !value ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    return read(page, pageSize);
  const first = await read(1, 100);
  const items = await readSortedPages<Page["items"][number]>(
    async (index, size) => {
      const result = index === 1 ? first : await read(index, size);
      return { items: result.items, total: result.meta.total };
    },
    page,
    pageSize,
    direction,
    value,
    (row) => row.id,
  );
  return { ...first, items, meta: { ...first.meta, page, pageSize } };
}

export async function readFlatListPage<Row extends { id: string }>(
  read: (
    page: number,
    pageSize: number,
  ) => Promise<{
    items: Row[];
    page: number;
    pageSize: number;
    total: number;
  }>,
  page: number,
  pageSize: number,
  direction: SortDirection,
  value?: Parameters<typeof sortRows<NoInfer<Row>>>[1],
) {
  if (!value) return read(page, pageSize);
  const first = await read(1, 100);
  const items = await readSortedPages(
    (index, size) => (index === 1 ? Promise.resolve(first) : read(index, size)),
    page,
    pageSize,
    direction,
    value,
    (row) => row.id,
  );
  return { ...first, items, page, pageSize };
}
