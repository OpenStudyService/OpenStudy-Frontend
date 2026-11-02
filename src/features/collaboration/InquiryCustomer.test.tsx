import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InquiryCustomer } from "./InquiryCustomer";
import { seatApi } from "../seats/api";
vi.mock("../../app/context", () => ({
  useApp: () => ({ session: { user: { owner: false } } }),
}));
vi.mock("../payments/shared", () => ({
  CustomerSelector: () => <div>허용된 고객 검색</div>,
}));
vi.mock("../seats/api", () => ({ seatApi: { lookup: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("cancels an old exact lookup when the user changes the search text and ignores late results", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof seatApi.lookup>>) => void;
  let signal!: AbortSignal;
  vi.mocked(seatApi.lookup).mockImplementation((_b, s) => {
    signal = s;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const user = userEvent.setup();
  render(<InquiryCustomer branchId="1" value="" onChange={vi.fn()} />);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "고객 선택 방법" }),
    "exact",
  );
  await user.type(screen.getByLabelText("정확 일치 검색어"), "C001");
  await user.click(screen.getByRole("button", { name: "정확 일치 조회" }));
  await user.type(screen.getByLabelText("정확 일치 검색어"), "2");
  expect(signal.aborted).toBe(true);
  resolve({
    items: [
      {
        customer: { id: "old", name: "이전 고객", memberNo: "C001" },
        status: "정상",
        activeSession: null,
        usablePasses: [],
      },
    ],
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(
    screen.queryByRole("option", { name: /이전 고객/ }),
  ).not.toBeInTheDocument();
});
