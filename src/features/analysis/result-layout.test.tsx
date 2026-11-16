import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewSpecRenderer } from "./Charts";
import { layoutOf, parseAiResult } from "./domainlens";
import { generatedResponse } from "./generated-results.fixture";

/** A generated result with the components the backend composes for a KPI, a chart and its table. */
function assembled(layout: unknown) {
  const response = generatedResponse("BarChart", {
    category: "d0",
    value: "m0",
  });
  const chart = response.viewSpec.components[0];
  response.viewSpec = {
    ...response.viewSpec,
    components: [
      {
        ...chart,
        id: "kpi",
        componentRef: { id: "KpiGroup", version: "1.0.0" },
        bindings: { values: ["m0"] },
      },
      chart,
      {
        ...chart,
        id: "table",
        componentRef: { id: "PaginatedDataTable", version: "1.0.0" },
        bindings: { columns: ["d0", "m0"] },
      },
    ],
    layout: layout as typeof response.viewSpec.layout,
  };
  return parseAiResult(response);
}

const MOCKUP_LAYOUT = {
  kind: "stack",
  children: [
    { componentId: "kpi" },
    {
      kind: "split",
      children: [{ componentId: "c0" }, { componentId: "table" }],
    },
  ],
};

describe("ViewSpec layout (DomainLens result mock-up)", () => {
  it("keeps a valid layout and repairs an untrusted one", () => {
    const ids = ["kpi", "c0", "table"];
    expect(
      layoutOf(
        { catalogVersion: "x", components: [], layout: MOCKUP_LAYOUT },
        ids,
      ),
    ).toEqual(MOCKUP_LAYOUT);
    // Unknown and repeated leaves are dropped, a split left with one child stacks, a forgotten component is appended.
    expect(
      layoutOf(
        {
          catalogVersion: "x",
          components: [],
          layout: {
            kind: "stack",
            children: [
              { componentId: "kpi" },
              {
                kind: "split",
                children: [{ componentId: "c0" }, { componentId: "ghost" }],
              },
              { componentId: "kpi" },
            ],
          },
        },
        ids,
      ),
    ).toEqual({
      kind: "stack",
      children: [
        { componentId: "kpi" },
        { kind: "stack", children: [{ componentId: "c0" }] },
        { componentId: "table" },
      ],
    });
    // No layout at all: every component in order.
    expect(layoutOf({ catalogVersion: "x", components: [] }, ids)).toEqual({
      kind: "stack",
      children: ids.map((componentId) => ({ componentId })),
    });
  });

  it("draws the KPI row, then the chart beside its table", () => {
    const { container } = render(
      <ViewSpecRenderer parsed={assembled(MOCKUP_LAYOUT)} />,
    );

    expect(screen.getByRole("region", { name: "요약 지표" })).toBeVisible();
    const split = container.querySelector('[data-layout="split"]')!;
    const panels = within(split as HTMLElement).getAllByRole("region");
    expect(panels).toHaveLength(2);
    // The chart panel has no table of its own; the table panel beside it lists the rows.
    expect(within(panels[0]).queryByRole("table")).toBeNull();
    expect(
      within(panels[1]).getByRole("table", { name: "결과 데이터 표" }),
    ).toBeVisible();
  });

  it("opens the server-paged table from the table panel", async () => {
    const detail = {
      datasetId: undefined,
      open: vi.fn(),
      close: vi.fn(),
      render: () => <p>서버 표</p>,
    };
    const parsed = assembled(MOCKUP_LAYOUT);
    const { rerender } = render(
      <ViewSpecRenderer parsed={parsed} detail={detail} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /전체 표 보기/ }));
    expect(detail.open).toHaveBeenCalledWith("q0");

    rerender(
      <ViewSpecRenderer
        parsed={parsed}
        detail={{ ...detail, datasetId: "q0" }}
      />,
    );
    expect(screen.getByText("서버 표")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /간단히 보기/ }));
    expect(detail.close).toHaveBeenCalled();
  });
});
