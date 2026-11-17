import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ListCard, ListFilters, ListFooter, ListTable } from "./ListLayout";

afterEach(cleanup);

const columns = ["이름", "상태", "등록일"];
function table(props: Partial<Parameters<typeof ListTable>[0]> = {}) {
  return render(
    <ListTable
      label="시험 목록"
      columns={columns}
      isEmpty={false}
      empty={{ title: "비어 있어요", message: "조건을 바꿔 주세요." }}
      {...props}
    >
      <tr>
        <td>행</td>
      </tr>
    </ListTable>,
  );
}
function placeholderCell() {
  const cells = within(
    screen.getByRole("table", { name: "시험 목록" }),
  ).getAllByRole("cell");
  expect(cells).toHaveLength(1);
  return cells[0];
}

it("renders headers and rows when there is data", () => {
  table();
  expect(
    screen.getAllByRole("columnheader").map((th) => th.textContent),
  ).toEqual(columns);
  expect(screen.getByRole("cell", { name: "행" })).toBeInTheDocument();
});

it("shows the empty state inside the table spanning every column", () => {
  table({ isEmpty: true });
  const cell = placeholderCell();
  expect(cell).toHaveAttribute("colspan", "3");
  expect(within(cell).getByText("비어 있어요")).toBeInTheDocument();
  expect(within(cell).getByText("조건을 바꿔 주세요.")).toBeInTheDocument();
});

it("shows loading inside the table before empty", () => {
  table({ loading: true, isEmpty: true });
  expect(within(placeholderCell()).getByRole("status")).toBeInTheDocument();
});

it("shows errors inside the table with an optional retry", async () => {
  const retry = vi.fn();
  table({ error: new Error("실패했어요"), onRetry: retry, isEmpty: true });
  const cell = placeholderCell();
  expect(within(cell).getByText("실패했어요")).toBeInTheDocument();
  await userEvent.click(
    within(cell).getByRole("button", { name: "다시 시도" }),
  );
  expect(retry).toHaveBeenCalledOnce();
});

it("prefers an explicit state over loading and errors", () => {
  table({
    state: <p>조건이 올바르지 않아요</p>,
    loading: true,
    error: new Error("실패했어요"),
  });
  expect(
    within(placeholderCell()).getByText("조건이 올바르지 않아요"),
  ).toBeInTheDocument();
  expect(screen.queryByText("실패했어요")).not.toBeInTheDocument();
});

it("places filter actions at the end of the filter bar inside the card", () => {
  const { container } = render(
    <ListCard>
      <ListFilters actions={<button>등록</button>}>
        <select aria-label="상태" />
      </ListFilters>
    </ListCard>,
  );
  const bar = container.querySelector(".card > .filters")!;
  expect(bar.lastElementChild).toHaveClass("ml-auto");
  expect(
    within(bar.lastElementChild as HTMLElement).getByRole("button", {
      name: "등록",
    }),
  ).toBeInTheDocument();
});

it("omits the action slot when there are no actions", () => {
  const { container } = render(
    <ListFilters actions={false}>
      <select aria-label="상태" />
    </ListFilters>,
  );
  expect(container.querySelector(".ml-auto")).toBeNull();
});

function footer(props: Partial<Parameters<typeof ListFooter>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ListFooter
      page={1}
      pageSize={20}
      total={45}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

it("shows the total and lets users jump to a numbered page", async () => {
  const onChange = footer();
  expect(screen.getByText("총 45건")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "1페이지" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await userEvent.click(screen.getByRole("button", { name: "3페이지" }));
  expect(onChange).toHaveBeenCalledWith(3);
});

it("disables next on the last page", async () => {
  const onChange = footer({ page: 3 });
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "이전" }));
  expect(onChange).toHaveBeenCalledWith(2);
});

it("only shows the total for a single page", () => {
  footer({ total: 20 });
  expect(screen.getByText("총 20건")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "페이지 이동" })).toBeNull();
});

it.each([
  [{ loading: true }, "항목 수 확인 중"],
  [{ error: true }, "항목 수 확인 불가"],
])("hides paging while the count is unknown (%o)", (state, text) => {
  footer({ page: 2, ...state });
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "페이지 이동" })).toBeNull();
});
