import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ViewSpecRenderer } from "./Charts";
import { AiCsvExports } from "./AiExports";
import { parseAiResult, periodOf } from "./domainlens";
import { generatedResponse } from "./generated-results.fixture";

afterEach(cleanup);

describe("AI-generated results (OpenStudy-Frontend#122)", () => {
  it("reads the generated query: title, column names, metric, grouping and period", () => {
    const parsed = parseAiResult(generatedResponse());
    expect(parsed.title).toBe("지점별 결제 승인액");
    expect(parsed.componentTypes).toEqual(["DATA_TABLE"]);
    expect(parsed.datasetList[0].columns.map((c) => c.label)).toEqual(["지점", "결제 승인액"]);
    expect(parsed.generated).toEqual({
      metrics: ["결제 승인액"],
      dimensions: ["지점"],
      period: { from: "2026-11-01", to: "2026-11-30" },
    });
  });

  it("shows the table with readable column names instead of compiler aliases", () => {
    render(<ViewSpecRenderer parsed={parseAiResult(generatedResponse())} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("button", { name: "지점" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "결제 승인액" })).toBeInTheDocument();
    expect(within(table).getByText("가온점")).toBeInTheDocument();
    expect(screen.queryByText("d0")).not.toBeInTheDocument();
  });

  it("draws a generated bar chart with its table", () => {
    const parsed = parseAiResult(generatedResponse("BarChart", { category: "d0", value: "m0" }));
    expect(parsed.primaryComponent).toBe("BAR_CHART");
    render(<ViewSpecRenderer parsed={parsed} />);
    expect(screen.getByText(/가온점 .*42,000/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("draws generated congestion as a heatmap beside its table", () => {
    // The shape the backend compiles for "강남점은 언제 가장 붐벼?": occupancy by weekday (d0) and hour (d1).
    const response = generatedResponse("Heatmap", {
      category: "d0",
      series: "d1",
      value: "m0",
    });
    response.querySpec.source = "seat_occupancy_sample";
    response.querySpec.dimensions = [
      { field: "seat_occupancy_sample.weekday_kst", alias: "d0" },
      { field: "seat_occupancy_sample.hour_kst", alias: "d1" },
    ];
    response.querySpec.metrics = [
      { field: "seats.occupancy_pct", alias: "m0" },
    ];
    const chart = response.viewSpec.components[0];
    response.viewSpec.components = [
      chart,
      {
        ...chart,
        id: "c1",
        componentRef: { id: "PaginatedDataTable", version: "1.0.0" },
        bindings: { columns: ["d0", "d1", "m0"] },
      },
    ];
    response.viewSpec.layout = {
      kind: "stack",
      children: [
        {
          kind: "split",
          children: [{ componentId: "c0" }, { componentId: "c1" }],
        },
      ],
    } as unknown as typeof response.viewSpec.layout;
    const dataset = response.envelope.datasets[0];
    dataset.columns = [
      { alias: "d0", type: "INTEGER", unit: null, precision: null },
      { alias: "d1", type: "INTEGER", unit: null, precision: null },
      { alias: "m0", type: "DECIMAL", unit: "%", precision: 1 },
    ];
    dataset.rows = [
      { d0: 1, d1: 9, m0: 25 },
      { d0: 1, d1: 12, m0: 37.5 },
      { d0: 3, d1: 18, m0: 12.5 },
    ] as unknown as typeof dataset.rows;

    const parsed = parseAiResult(response);
    expect(parsed.title).toBe("요일·시간대별 좌석 점유율");
    render(<ViewSpecRenderer parsed={parsed} />);
    const heatmap = screen.getByRole("region", {
      name: /요일·시간대별 좌석 혼잡도 히트맵/,
    });
    expect(
      within(heatmap).getByText(/월요일 12시 \(37\.5%\)/),
    ).toBeInTheDocument();
    expect(within(heatmap).getByTitle("월요일 12시: (37.5%)")).toHaveTextContent("38%");
    // The table panel lists the same rows under readable names, not d0/d1/m0.
    const table = screen.getByRole("table", { name: "결과 데이터 표" });
    expect(
      within(table).getByRole("button", { name: "요일" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "시간대" }),
    ).toBeInTheDocument();
  });

  it("draws a generated KPI with the metric's name", () => {
    const response = generatedResponse("KpiGroup", { values: ["m0"] });
    response.querySpec.dimensions = [];
    response.envelope.datasets[0].columns = [response.envelope.datasets[0].columns[1]];
    response.envelope.datasets[0].rows = [{ d0: "", m0: 92000 }];
    const parsed = parseAiResult(response);
    expect(parsed.title).toBe("결제 승인액");
    render(<ViewSpecRenderer parsed={parsed} />);
    expect(screen.getAllByText("결제 승인액").length).toBeGreaterThan(0);
  });

  it("leaves a registered analysis result as it was", () => {
    const response = generatedResponse();
    const registered = {
      ...response,
      pocCode: "POC-001",
      analysisId: "openstudy.sales.branchComparison",
      querySpec: { ...response.querySpec, mode: "REGISTERED_ANALYSIS", analysisId: "openstudy.sales.branchComparison" },
    };
    const parsed = parseAiResult(registered);
    expect(parsed.generated).toBeUndefined();
    expect(parsed.title).toBe("지점별 매출 비교");
    expect(parsed.datasetList[0].columns[0].label).toBeUndefined();
    // Unchanged: an unknown component with events is not rendered as a registered view.
    expect(parsed.componentTypes).toEqual([]);
  });

  it("reads a saved result's list of queries and a missing period", () => {
    const response = generatedResponse();
    const parsed = parseAiResult({ ...response, querySpec: [{ ...response.querySpec, filter: null }] });
    expect(parsed.generated?.period).toBeNull();
    expect(periodOf({ kind: "leaf", field: "x", operator: "EQ", values: ["a"] })).toBeNull();
  });
});

describe("CSV export names of AI-generated results", () => {
  it("names a generated dataset after the result instead of its compiler ID", () => {
    render(<AiCsvExports executionId="exec-g" parsed={parseAiResult(generatedResponse())} accessDenied={false} />);
    expect(screen.getByRole("heading", { name: "지점별 결제 승인액" })).toBeInTheDocument();
    expect(screen.queryByText("q0")).not.toBeInTheDocument();
  });

  it("keeps a registered result's own component title", () => {
    const response = generatedResponse();
    const registered = {
      ...response,
      querySpec: { ...response.querySpec, mode: "REGISTERED_ANALYSIS" },
      viewSpec: {
        ...response.viewSpec,
        components: [{ ...response.viewSpec.components[0], componentRef: { id: "DATA_TABLE", version: "1.0.0" }, options: { title: "지점별 매출 상세" }, events: [] }],
      },
    };
    render(<AiCsvExports executionId="exec-r" parsed={parseAiResult(registered)} accessDenied={false} />);
    expect(screen.getByRole("heading", { name: "지점별 매출 상세" })).toBeInTheDocument();
  });
});
