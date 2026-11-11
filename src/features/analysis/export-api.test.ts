import { afterEach, expect, it, vi } from "vitest";
import { abortPrivateRequests, apiCsv } from "../../shared/api/client";
import { csvFilename, csvWillTruncate } from "./export-api";
import { exportSalesReport, type SalesExportOptions } from "./sales-api";

afterEach(() => vi.unstubAllGlobals());

it("uses the RFC 5987 filename and falls back to Seoul time for unavailable or invalid headers", () => {
  const now = new Date("2026-11-10T15:02:00Z");
  const name = "지점별 매출 비교_20261111-0900.csv";
  expect(
    csvFilename(
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "매출",
      now,
    ),
  ).toBe(name);
  for (const header of [
    null,
    "attachment; filename=test.csv",
    "attachment; filename*=UTF-8''%E0%ZZ.csv",
    "attachment; filename*=UTF-8''..%2Ftest.csv",
  ]) {
    expect(csvFilename(header, "매출", now)).toBe("매출_20261111-0002.csv");
  }
});

it("warns only when the known total exceeds 1,000 or truncation was reported", () => {
  expect(csvWillTruncate()).toBe(false);
  expect(csvWillTruncate(1_000)).toBe(false);
  expect(csvWillTruncate(1_001)).toBe(true);
  expect(csvWillTruncate(1_000, true)).toBe(true);
});

it("sends repeated filters and report-specific options, dropping paging fields", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response("\uFEFF데이터\r\n", {
        headers: { "Content-Type": "text/csv; charset=UTF-8" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const options = {
    direction: "asc",
    entryType: "환불",
    page: 3,
    pageSize: 20,
  } as const satisfies SalesExportOptions & { page: number; pageSize: number };
  await exportSalesReport(
    "ledger",
    {
      branchIds: ["1", "2"],
      from: "2026-10-31T15:00:00Z",
      to: "2026-11-30T15:00:00Z",
      refundBasis: "paymentDate",
      purpose: "이용권",
      categoryCode: "TIME",
      methods: ["카드", "현금"],
      productKinds: ["시간권"],
      operatorIds: ["5", "6"],
      processingBranchIds: ["2"],
    },
    options,
  );
  const [path, request] = fetch.mock.calls[0];
  const url = new URL(String(path), window.location.origin);
  expect(url.pathname).toBe("/api/sales/exports/ledger");
  expect([...url.searchParams]).toEqual([
    ["branchIds", "1"],
    ["branchIds", "2"],
    ["from", "2026-10-31T15:00:00Z"],
    ["to", "2026-11-30T15:00:00Z"],
    ["refundBasis", "paymentDate"],
    ["purpose", "이용권"],
    ["categoryCode", "TIME"],
    ["methods", "카드"],
    ["methods", "현금"],
    ["productKinds", "시간권"],
    ["operatorIds", "5"],
    ["operatorIds", "6"],
    ["processingBranchIds", "2"],
    ["direction", "asc"],
    ["entryType", "환불"],
  ]);
  expect(request).toMatchObject({
    method: "GET",
    credentials: "include",
    headers: { Accept: "text/csv, application/json" },
  });
});

it.each([
  [403, "BRANCH_SCOPE_DENIED"],
  [404, "NOT_FOUND"],
  [404, "EXPORT_REPORT_UNKNOWN"],
  [422, "VALIDATION_FAILED"],
  [429, "RATE_LIMITED"],
  [503, "AI_NOT_READY"],
])(
  "preserves ApiError for %s %s instead of returning a CSV",
  async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code, message: "내보내기 오류" }, { status }),
        ),
    );
    await expect(apiCsv("/ai/executions/1/export")).rejects.toMatchObject({
      status,
      detail: { code },
      message: "내보내기 오류",
    });
  },
);

it("rejects JSON success bodies and discards CSV bodies after session cancellation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ message: "잘못된 형식" }));
  vi.stubGlobal("fetch", fetch);
  await expect(apiCsv("/sales/exports/revenue")).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });

  const csv = new Response("CSV", { headers: { "Content-Type": "text/csv" } });
  const body = csv.blob.bind(csv);
  csv.blob = async () => {
    abortPrivateRequests();
    return body();
  };
  fetch.mockResolvedValueOnce(csv);
  await expect(apiCsv("/sales/exports/revenue")).rejects.toMatchObject({
    name: "AbortError",
  });
});
