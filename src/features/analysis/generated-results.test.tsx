import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ViewSpecRenderer } from "./Charts";
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
    expect(within(table).getByRole("button", { name: "결제 승인액 (KRW)" })).toBeInTheDocument();
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
