/** The shape OpenStudy-Backend#233 returned for "이번 달 지점별 결제 금액 합계 보여줘" with the live model. */
export function generatedResponse(component = "PaginatedDataTable", bindings: Record<string, unknown> = { columns: ["d0", "m0"] }) {
  return {
    requestId: "req-g",
    executionId: "exec-g",
    status: "COMPLETED",
    resultCategory: "GENERATED_EXECUTION",
    pocCode: null,
    analysisId: null,
    intentDomain: "sales",
    semanticStatus: "GENERATED",
    querySpec: {
      id: "q0",
      source: "payment",
      grain: "payment",
      mode: "AGGREGATE",
      dimensions: [{ field: "branch.name", alias: "d0" }],
      metrics: [{ field: "sales.approved_amount_krw", alias: "m0" }],
      filter: {
        kind: "group",
        junction: "AND",
        children: [
          { kind: "leaf", field: "payment.paid_at", operator: "GTE", values: ["2026-10-31T15:00:00Z"] },
          { kind: "leaf", field: "payment.paid_at", operator: "LT", values: ["2026-11-30T15:00:00Z"] },
        ],
      },
      orderBy: [],
      pagination: { page: 0, size: 10 },
      limit: 10,
      analysisId: null,
    },
    viewSpec: {
      catalogVersion: "openstudy-ui-1.0.0",
      components: [
        {
          id: "c0",
          componentRef: { id: component, version: "1.0.0" },
          datasetId: "q0",
          bindings,
          options: {},
          events: [
            { event: "export", actionId: "requestCsv" },
            { event: "pageChange", actionId: "page" },
            { event: "sortChange", actionId: "sort" },
          ],
        },
      ],
      layout: { kind: "stack", children: [{ componentId: "c0" }] },
    },
    envelope: {
      requestId: "req-g",
      executionId: "exec-g",
      status: "COMPLETED",
      datasets: [
        {
          id: "q0",
          columns: [
            { alias: "d0", type: "STRING", unit: null, precision: null },
            { alias: "m0", type: "INTEGER", unit: "KRW", precision: 0 },
          ],
          rows: [
            { d0: "가온점", m0: 42000 },
            { d0: "나래점", m0: 50000 },
          ],
        },
      ],
      asOf: "2026-11-13T08:00:00Z",
      warnings: [],
    },
  };
}
