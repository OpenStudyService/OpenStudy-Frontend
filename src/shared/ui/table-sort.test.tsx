import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { ListTable } from "./ListLayout";
import { useLocalTableSort } from "./table-sort";

const rows = [
  { name: "A", amount: 100 },
  { name: "B", amount: 9 },
  { name: "C", amount: null },
];

function ExampleTable() {
  const sorting = useLocalTableSort<(typeof rows)[number]>([
    { label: "이름", value: (row) => row.name },
    { label: "금액", value: (row) => row.amount },
  ]);
  return (
    <ListTable
      label="금액 목록"
      columns={sorting.columns}
      isEmpty={false}
      empty={{ title: "" }}
    >
      {sorting.order(rows).map((row) => (
        <tr key={row.name}>
          <td>{row.name}</td>
          <td>{row.amount}</td>
        </tr>
      ))}
    </ListTable>
  );
}

it("orders by numeric values in both directions and keeps missing values last", async () => {
  render(<ExampleTable />);
  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
  const amount = screen.getByRole("button", { name: "금액" });
  await userEvent.click(amount);
  expect(names()).toEqual(["B", "A", "C"]);
  await userEvent.click(amount);
  expect(names()).toEqual(["A", "B", "C"]);
  expect(amount.closest("th")).toHaveAttribute("aria-sort", "descending");
  expect(rows.map((row) => row.name)).toEqual(["A", "B", "C"]);
});
