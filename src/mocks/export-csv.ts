import { HttpResponse } from "msw/http";
import { CSV_ROW_LIMIT, exportFilename } from "../features/analysis/export-api";

function field(value: unknown) {
  const text = value == null ? "-" : String(value);
  const safe =
    typeof value === "string" && text !== "-" && /^[=+\-@\t\r]/.test(text)
      ? "'" + text
      : text;
  return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

export function mockCsv({
  title,
  filename = title,
  conditions,
  asOf,
  money,
  columns,
  rows,
  total = rows.length,
}: {
  title: string;
  filename?: string;
  conditions: string;
  asOf: string;
  money: boolean;
  columns: string[];
  rows: unknown[][];
  total?: number;
}) {
  const now = new Date();
  const data = rows.slice(0, CSV_ROW_LIMIT);
  const body = [
    ["항목", "값"],
    ["제목", title],
    ["조회 조건", conditions],
    ["단위", money ? "원" : "-"],
    ["통화", money ? "KRW" : "-"],
    ["기준 시각", asOf],
    ["생성 시각", now.toISOString()],
    [
      "행 수",
      `${data.length.toLocaleString("en-US")} / 전체 ${total.toLocaleString("en-US")}`,
    ],
    ["잘림", total > CSV_ROW_LIMIT ? "예 (최대 1,000행)" : "아니오"],
    [],
    columns,
    ...data,
  ]
    .map((row) => row.map(field).join(","))
    .join("\r\n");
  return new HttpResponse("\uFEFF" + body + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=UTF-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exportFilename(filename, "csv", now))}`,
      "Cache-Control": "no-store",
    },
  });
}
