import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ViewSpecRenderer } from "./Charts";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
  COMPONENT_TYPES,
  normalizeComponentType,
  parseAiResult,
  POC_QUESTIONS,
} from "./domainlens";
import { CongestionHeatmap } from "./views/CongestionHeatmap";
import { RankedBarChart } from "./views/RankedBarChart";
import { SeatMapCard } from "./views/SeatMapCard";
import { RoomWeekCalendar } from "./views/RoomWeekCalendar";
import { UrgentTaskList } from "./views/UrgentTaskList";

afterEach(cleanup);

describe("DomainLens ViewSpec contract (ported from OpenStudy-DomainLenz)", () => {
  it("supports all 9 ViewSpec component types", () => {
    const nineTypes = [
      "KPI",
      "BAR_CHART",
      "LINE_CHART",
      "RANKED_BAR_CHART",
      "DATA_TABLE",
      "HEATMAP",
      "SEAT_MAP",
      "WEEK_CALENDAR",
      "TASK_LIST",
    ] as const;

    for (const t of nineTypes) {
      expect(COMPONENT_TYPES).toContain(t);
      expect(normalizeComponentType(t)).toBe(t);

      const parsed = parseAiResult({
        requestId: `req-${t}`,
        executionId: `exec-${t}`,
        status: "COMPLETED",
        envelope: {
          requestId: `req-${t}`,
          executionId: `exec-${t}`,
          status: "COMPLETED",
          asOf: "2026-11-02T05:00:00Z",
          snapshotVersion: "openstudy-semantic-1.0.0",
          policyVersion: "openstudy-policy-v1",
          warnings: [],
          datasets: [
            {
              id: "sample",
              columns: [
                { alias: "val", type: "INTEGER", unit: null, precision: 0 },
              ],
              rows: [{ val: 42 }],
            },
          ],
          view: {
            catalogVersion: "openstudy-ui-1.0.0",
            components: [
              {
                id: `comp-${t}`,
                componentRef: { id: t, version: "1.0.0" },
                datasetId: "sample",
                bindings: {},
                options: {},
                events: [],
              },
            ],
          },
        },
      });

      expect(parsed.primaryComponent).toBe(t);
      expect(parsed.componentTypes).toContain(t);
      expect(parsed.policyVersion).toBe("openstudy-policy-v1");
      expect(parsed.snapshotVersion).toBe("openstudy-semantic-1.0.0");
    }

    expect(normalizeComponentType("bar")).toBeUndefined();
    expect(normalizeComponentType("line")).toBeUndefined();
    expect(normalizeComponentType("table")).toBeUndefined();
    expect(POC_QUESTIONS).toHaveLength(10);
  });

  it("renders the 5 new specialized ViewSpec visualization components", () => {
    render(
      <MemoryRouter>
        <div>
          <CongestionHeatmap
            rows={[
              {
                weekday: 2,
                hour_kst: 15,
                occupied_seat_samples: 94,
                seat_sample_capacity: 120,
                sampled_occupancy_pct: 78.3,
              },
              {
                weekday: 3,
                hour_kst: 18,
                occupied_seat_samples: 94,
                seat_sample_capacity: 120,
                sampled_occupancy_pct: 78.3,
              },
            ]}
          />
          <RankedBarChart
            rows={[
              {
                product_id: 9110002,
                product: "종일 시간권 100시간 (데모)",
                issued_units: 7,
                refunded_units: 0,
                net_units: 7,
                approved_krw: 980000,
                refund_krw: 0,
                net_krw: 980000,
              },
            ]}
          />
          <SeatMapCard
            seats={[
              { seat_id: 1, seat_no: "A-01", occupancy_state: "AVAILABLE" },
              { seat_id: 2, seat_no: "A-02", occupancy_state: "OCCUPIED" },
              { seat_id: 24, seat_no: "B-12", occupancy_state: "BLOCKED" },
            ]}
            summary={{
              total: 24,
              available: 11,
              occupied: 12,
              blocked: 1,
              occupied_pct: 50.0,
            }}
          />
          <RoomWeekCalendar
            branchSummaries={[
              {
                branch_id: 9100001,
                branch_name: "강남점 (데모)",
                total: 3,
                confirmed_count: 1,
                completed_count: 1,
                cancelled_count: 1,
                billable_booking_amount_krw: 80000,
              },
            ]}
            reservations={[
              {
                reservation_id: 9500001,
                branch_name: "강남점 (데모)",
                room_name: "강남 Room A",
                start_at: "2026-11-02T10:00:00Z",
                end_at: "2026-11-02T12:00:00Z",
                status: "CONFIRMED",
                billable_amount_krw: 40000,
              },
            ]}
          />
          <UrgentTaskList
            rows={[
              {
                id: 9600001,
                title: "강남점 스터디룸 프로젝터 긴급 점검",
                branch_name: "강남점 (데모)",
                priority: "URGENT",
                status: "TODO",
                due_at: "2026-11-02T09:00:00Z",
                assignee_employee_id: 9200001,
              },
            ]}
            scope="9100001"
          />
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("viewspec-heatmap")).toBeInTheDocument();
    expect(screen.getByText(/화요일 15시 \(78\.3%\)/)).toBeInTheDocument();

    expect(screen.getByTestId("viewspec-ranked-bar")).toBeInTheDocument();
    expect(screen.getByText("종일 시간권 100시간 (데모)")).toBeInTheDocument();

    expect(screen.getByTestId("viewspec-seat-map")).toBeInTheDocument();
    expect(screen.getByText("A-01")).toBeInTheDocument();
    expect(screen.getByText("11석")).toBeInTheDocument();

    expect(screen.getByTestId("viewspec-week-calendar")).toBeInTheDocument();
    expect(screen.getByText("강남 Room A")).toBeInTheDocument();

    expect(screen.getByTestId("viewspec-task-list")).toBeInTheDocument();
    expect(
      screen.getByText("강남점 스터디룸 프로젝터 긴급 점검"),
    ).toBeInTheDocument();
  });
});

function sampleView(
  over: Record<string, unknown> = {},
  rows = [
    { day: "2026-11-02", net: null },
    { day: "2026-11-01", net: 0 },
  ] as { day: string; net: number | string | null }[],
) {
  return parseAiResult({
    envelope: {
      requestId: "req",
      status: "READY",
      datasets: [
        {
          id: "daily",
          columns: [
            { alias: "day", type: "DATE" },
            { alias: "net", type: "INTEGER" },
          ],
          rows,
        },
      ],
      view: {
        components: [
          {
            id: "trend",
            componentRef: { id: "LINE_CHART", version: "1.0.0" },
            datasetId: "daily",
            bindings: { category: "day", value: "net" },
            ...over,
          },
        ],
      },
    },
  });
}

it.each([
  { componentRef: { id: "constructor", version: "1.0.0" } },
  { componentRef: { id: "HTML", version: "1.0.0" } },
  { events: [{ event: "onClick", actionId: "javascript:alert(1)" }] },
])("rejects an unregistered component or arbitrary events (%j)", (spec) => {
  render(<ViewSpecRenderer parsed={sampleView(spec)} />);
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});

it("renders option text safely, orders time series and distinguishes zero from missing values", async () => {
  const html = '<img src=x onerror="alert(1)">';
  render(
    <ViewSpecRenderer
      parsed={sampleView({ options: { title: html, onClick: "alert(1)" } })}
    />,
  );
  expect(screen.getByRole("heading", { name: html })).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("2026-11-010");
  expect(screen.getByRole("cell", { name: "해당 없음" })).toBeVisible();
  expect(
    screen.getByText(/2026-11-01 0, 2026-11-02 해당 없음/),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole("button", { name: "day" })).toHaveFocus();
  await user.keyboard("{Enter}{Enter}");
  expect(screen.getAllByRole("row")[1]).toHaveTextContent(
    "2026-11-02해당 없음",
  );
});

it.each([
  sampleView({ bindings: { category: "day", value: "missing" } }),
  sampleView({}, [{ day: "2026-11-01", net: "12" }]),
])(
  "falls back to the original table for missing or mistyped bindings",
  (parsed) => {
    render(<ViewSpecRenderer parsed={parsed} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "표시 명세와 데이터가 일치하지 않아",
    );
    expect(screen.getByRole("table")).toBeVisible();
  },
);
