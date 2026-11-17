import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

afterEach(cleanup);

it("shifts the range on previous, next and direct navigation", async () => {
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
      .map((button) => Number(button.textContent));
  const previous = nav.getByRole("button", { name: "이전" });
  const next = nav.getByRole("button", { name: "다음" });

  expect(previous).toBeDisabled();
  expect(shownPages()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(pageButton(1)).toHaveAttribute("aria-current", "page");
  await user.click(pageButton(10));
  await user.click(next);
  expect(shownPages()).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  expect(pageButton(11)).toHaveAttribute("aria-current", "page");
  await user.click(previous);
  expect(shownPages()).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  expect(pageButton(10)).toHaveAttribute("aria-current", "page");
  await user.click(pageButton(15));
  await user.click(pageButton(20));
  expect(shownPages()).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  await user.click(pageButton(23));
  expect(pageButton(23)).toHaveAttribute("aria-current", "page");
  expect(next).toBeDisabled();
});

it.each([
  [1, 23, 1, 10],
  [12, 23, 8, 17],
  [23, 23, 14, 23],
  [3, 6, 1, 6],
])(
  "centers page %i of %i where the available range permits",
  (page, totalPages, first, last) => {
    render(
      <Pagination page={page} totalPages={totalPages} onPageChange={vi.fn()} />,
    );
    const numbers = screen.getAllByRole("button", { name: /^\d+페이지$/ });
    expect(numbers.map((button) => Number(button.textContent))).toEqual(
      Array.from({ length: last - first + 1 }, (_, index) => first + index),
    );
    expect(numbers[page - first]).toHaveAttribute("aria-current", "page");
  },
);

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
