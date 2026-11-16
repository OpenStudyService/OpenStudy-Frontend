import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

afterEach(cleanup);

it("shows ten page numbers at a time and navigates across groups", async () => {
  function Example() {
    const [page, setPage] = useState(1);
    return <Pagination page={page} totalPages={23} onPageChange={setPage} />;
  }

  const user = userEvent.setup();
  render(<Example />);
  const nav = within(screen.getByRole("navigation", { name: "페이지 이동" }));
  const pageButton = (page: number) =>
    nav.getByRole("button", { name: `${page}페이지` });
  const shownPages = () =>
    nav
      .getAllByRole("button", { name: /^\d+페이지$/ })
      .map((button) => button.textContent);
  const previous = nav.getByRole("button", { name: "이전" });
  const next = nav.getByRole("button", { name: "다음" });

  expect(previous).toBeDisabled();
  expect(shownPages()).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
  ]);
  expect(pageButton(1)).toHaveAttribute("aria-current", "page");
  await user.click(pageButton(10));
  await user.click(next);
  expect(shownPages()).toEqual([
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
  ]);
  expect(pageButton(11)).toHaveAttribute("aria-current", "page");
  await user.click(previous);
  expect(pageButton(10)).toHaveAttribute("aria-current", "page");
  await user.click(next);
  await user.click(pageButton(20));
  await user.click(next);
  expect(shownPages()).toEqual(["21", "22", "23"]);
  await user.click(pageButton(23));
  expect(pageButton(23)).toHaveAttribute("aria-current", "page");
  expect(next).toBeDisabled();
});

it("omits navigation when all results fit on one page", () => {
  const { rerender } = render(
    <Pagination page={1} totalPages={0} onPageChange={vi.fn()} />,
  );
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  rerender(<Pagination page={1} totalPages={1} onPageChange={vi.fn()} />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

it("allows going back to the first page when the total is unavailable", async () => {
  const onPageChange = vi.fn();
  const user = userEvent.setup();
  render(<Pagination page={3} totalPages={0} onPageChange={onPageChange} />);
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "이전" }));
  expect(onPageChange).toHaveBeenCalledWith(1);
});
