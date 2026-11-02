import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChannelDemo from "./ChannelDemo";
import {
  domains,
  scenarios,
  matchScenario,
  querySpecFor,
  scopedRows,
} from "./catalog";
import {
  canReadDemo,
  chartData,
  clearDemoShares,
  makeResult,
  resultTotal,
  sharedSnapshot,
  shareResult,
} from "./model";
import type { DemoViewer } from "./model";
import { ResultCard } from "./ResultCard";
import exported from "../../../docs/domainlenz/natural-language-tests.json" with { type: "json" };
import evidence from "../../../docs/domainlenz/schema-evidence.json" with { type: "json" };
const owner: DemoViewer = {
  id: "owner",
  name: "시연 사장님",
  owner: true,
  active: true,
  aiBranches: [],
  salesBranches: [],
  paymentBranches: [],
};
const sales = scenarios.find((s) => s.id === "sales-net")!;
const props = {
  viewer: owner,
  scope: "all",
  channelId: "general",
  channelName: "전체-공지",
  request: null,
  galleryOpen: false,
  onGalleryOpen: vi.fn(),
  onPick: vi.fn(),
};
afterEach(() => {
  cleanup();
  clearDemoShares();
  vi.useRealTimers();
});
describe("scenario contract", () => {
  it("keeps developer exports aligned with the UI and verified physical fields", () => {
    expect(exported.cases.map((c) => c.id)).toEqual(scenarios.map((s) => s.id));
    const fields = new Set(
      evidence.domains.flatMap((d) =>
        d.sources.flatMap((s) => s.fields.map((f) => `${s.table}.${f}`)),
      ),
    );
    for (const s of scenarios) {
      const spec = querySpecFor(s, "all");
      expect(exported.cases.find((c) => c.id === s.id)?.querySpec).toEqual(
        JSON.parse(JSON.stringify(spec)),
      );
      for (const filter of [...spec.filters, ...spec.timeConstraints])
        expect(fields.has(filter.field)).toBe(true);
    }
  });
  it("covers 13 domains with at least two cases, two extra showcase cases and eight states", () => {
    expect(domains).toHaveLength(13);
    expect(scenarios).toHaveLength(36);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(36);
    for (const d of domains)
      expect(
        scenarios.filter((s) => s.domainId === d.id && s.outcome === "ready"),
      ).toHaveLength(["products", "seats"].includes(d.id) ? 3 : 2);
    expect(
      new Set(
        scenarios.filter((s) => s.outcome !== "ready").map((s) => s.outcome),
      ).size,
    ).toBe(8);
    for (const s of scenarios) {
      expect(matchScenario(`  @DomainLenz ${s.prompt}!  `)?.id).toBe(s.id);
      expect(
        s.rows.every((r) => s.columns.every((c) => r[c.key] !== undefined)),
      ).toBe(true);
    }
    expect(matchScenario("아무 자유 질문")).toBeUndefined();
  });
  it("uses one source for chart totals, KPI and rows, preserves branch boundaries", () => {
    for (const s of scenarios.filter((s) => s.valueKey)) {
      const r = makeResult(s, "all", "general");
      expect(chartData(r).reduce((n, d) => n + d.value, 0)).toBe(
        resultTotal(r),
      );
    }
    expect(resultTotal(makeResult(sales, "all", "general"))).toBe(29200000);
    expect(resultTotal(makeResult(sales, "gangnam", "gangnam"))).toBe(17200000);
    expect(scopedRows(sales, "unknown")).toEqual([]);
    const clone = makeResult(sales, "all", "general");
    clone.rows[0].net = 0;
    expect(sales.rows[0].net).toBe(17200000);
    for (const row of sales.rows)
      expect(row.net).toBe(Number(row.approved) - Number(row.refunds));
  });
  it("describes physical date fields and distinct approval/refund aggregates", () => {
    const spec = querySpecFor(sales, "all");
    expect(spec.timeConstraints.map((c) => c.field)).toEqual([
      "payments.approved_at",
      "payments.approved_at",
      "refunds.refunded_at",
      "refunds.refunded_at",
    ]);
    const room = querySpecFor(
      scenarios.find((s) => s.id === "rooms-today")!,
      "gangnam",
    );
    expect(room.timeConstraints.map((c) => c.op)).toEqual(["LT", "GT"]);
    expect(
      querySpecFor(
        scenarios.find((s) => s.outcome === "denied")!,
        "all",
      ).status,
    ).toBe("NOT_EXECUTED");
  });
  it("requires all branch grants, extra payment access, and OWNER for unsettled domains", () => {
    const viewer = {
      ...owner,
      owner: false,
      aiBranches: ["gangnam"],
      salesBranches: ["gangnam"],
    };
    expect(canReadDemo(viewer, sales, "gangnam")).toBe(true);
    expect(canReadDemo(viewer, sales, "all")).toBe(false);
    expect(canReadDemo(viewer, scenarios[0], "gangnam")).toBe(false);
    expect(
      canReadDemo(
        viewer,
        scenarios.find((s) => s.id === "sales-refunds")!,
        "gangnam",
      ),
    ).toBe(false);
    expect(canReadDemo({ ...owner, active: false }, sales, "all")).toBe(false);
  });
  it("publishes an immutable snapshot once", () => {
    const result = makeResult(sales, "all", "general");
    shareResult("general", { id: "one", author: "A", result });
    result.rows[0].net = 0;
    shareResult("general", { id: "one", author: "A", result });
    expect(sharedSnapshot("general")).toHaveLength(1);
    expect(resultTotal(sharedSnapshot("general")[0].result)).toBe(29200000);
  });
});
describe("conversation and renderer", () => {
  it("runs once in StrictMode; cancellation and replacement suppress late results", async () => {
    vi.useFakeTimers();
    const view = render(
      <StrictMode>
        <ChannelDemo {...props} request={{ id: "one", text: sales.prompt }} />
      </StrictMode>,
    );
    await act(() => vi.advanceTimersByTime(100));
    expect(screen.getAllByText(`@DomainLenz ${sales.prompt}`)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "조회 취소" }));
    await act(() => vi.advanceTimersByTime(2000));
    expect(document.querySelector(".dl-result")).toBeNull();
    view.rerender(
      <StrictMode>
        <ChannelDemo {...props} request={{ id: "two", text: sales.prompt }} />
      </StrictMode>,
    );
    await act(() => vi.advanceTimersByTime(100));
    view.rerender(
      <StrictMode>
        <ChannelDemo
          {...props}
          request={{ id: "three", text: "등록되지 않은 질문" }}
        />
      </StrictMode>,
    );
    await act(() => vi.advanceTimersByTime(2000));
    expect(document.querySelector(".dl-result")).toBeNull();
    expect(
      screen.getByText("새 질문을 시작해 이전 조회를 취소했습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText(/자유 자연어 해석을 실행하지/)).toBeInTheDocument();
  });
  it("does not reveal private results to a different viewer; shared scope is rechecked", async () => {
    vi.useFakeTimers();
    const view = render(
      <ChannelDemo {...props} request={{ id: "one", text: sales.prompt }} />,
    );
    await act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole("button", { name: "채널에 공유 ↗" }));
    expect(screen.getByLabelText("채널에 공유된 AI 결과")).toBeInTheDocument();
    view.unmount();
    render(
      <ChannelDemo
        {...props}
        viewer={{ ...owner, id: "staff", owner: false }}
      />,
    );
    expect(
      screen.queryByText(`@DomainLenz ${sales.prompt}`),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".dl-result")).toBeNull();
    expect(screen.getByText(/공유된 결과를 볼 권한/)).toBeInTheDocument();
  });
  it("sorts and pages data and opens the selected record", () => {
    render(
      <ResultCard
        result={makeResult(
          scenarios.find((s) => s.id === "customers-restricted")!,
          "all",
          "general",
        )}
      />,
    );
    expect(screen.getByText("M-DEMO-001")).toBeInTheDocument();
    expect(screen.queryByText("M-DEMO-006")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("M-DEMO-006")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "회원번호 ↕" }));
    fireEvent.click(screen.getByRole("button", { name: "회원번호 ↑" }));
    expect(screen.getByText("M-DEMO-012")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "가상회원 12** 상세보기" }),
    );
    expect(
      within(screen.getByLabelText("조회 항목 상세")).getByText("M-DEMO-012"),
    ).toBeInTheDocument();
  });
  it("falls back to a table without losing numeric data", () => {
    render(
      <ResultCard
        result={makeResult(
          scenarios.find((s) => s.outcome === "fallback")!,
          "all",
          "general",
        )}
      />,
    );
    expect(screen.getByText(/TABLE FALLBACK/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("29,200,000원")).toBeInTheDocument();
  });
  it("renders seat counts as a consistent synthetic layout and heatmap cells from both branches", () => {
    const view = render(
      <ResultCard
        result={makeResult(
          scenarios.find((s) => s.id === "seats-now")!,
          "all",
          "general",
        )}
      />,
    );
    expect(document.querySelectorAll(".dl-seat-grid button")).toHaveLength(80);
    expect(document.querySelectorAll(".dl-seat-grid .occupied")).toHaveLength(
      53,
    );
    expect(document.querySelectorAll(".dl-seat-grid .available")).toHaveLength(
      24,
    );
    view.unmount();
    const scenario = scenarios.find((s) => s.id === "seats-heatmap")!;
    render(<ResultCard result={makeResult(scenario, "all", "general")} />);
    expect(document.querySelectorAll(".dl-heatmap button")).toHaveLength(35);
    const monday = scenario.rows
      .filter((r) => r.label === "월" && r.slot === "09–12시")
      .reduce((sum, r) => sum + Number(r.value), 0);
    expect(
      screen.getByRole("button", { name: `월요일 09–12시 ${monday}건` }),
    ).toBeInTheDocument();
  });
  it("unmount cancels all pending work", async () => {
    vi.useFakeTimers();
    const view = render(
      <ChannelDemo {...props} request={{ id: "one", text: sales.prompt }} />,
    );
    await act(() => vi.advanceTimersByTime(100));
    view.unmount();
    await act(() => vi.advanceTimersByTime(2000));
    expect(sharedSnapshot("general")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
