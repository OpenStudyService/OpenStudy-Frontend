import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { Panel } from "./primitives";
import { UnsavedChangesBoundary, useDraftGuard } from "./leaveGuard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps edits made while a previous save is pending protected after that save finishes", () => {
  function PendingSave() {
    const [value, setValue] = useState("");
    const leave = useDraftGuard(value);
    const finish = useRef(() => {});
    return (
      <>
        {leave.guard}
        <input
          aria-label="초안"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          onClick={() => {
            finish.current = leave.saved;
          }}
        >
          저장 시작
        </button>
        <button onClick={() => finish.current()}>저장 응답</button>
      </>
    );
  }
  render(<PendingSave />);
  fireEvent.change(screen.getByLabelText("초안"), {
    target: { value: "전송한 값" },
  });
  fireEvent.click(screen.getByText("저장 시작"));
  fireEvent.change(screen.getByLabelText("초안"), {
    target: { value: "응답 전 새 입력" },
  });
  fireEvent.click(screen.getByText("저장 응답"));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByLabelText("초안")).toHaveValue("응답 전 새 입력");
});
function Form({ name }: { name: string }) {
  const [value, setValue] = useState("");
  const leave = useDraftGuard(value);
  return (
    <div>
      {leave.guard}
      <label>
        {name}
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button onClick={() => leave.saved()}>저장 {name}</button>
    </div>
  );
}
function mounted() {
  const router = createMemoryRouter(
    [
      {
        element: (
          <UnsavedChangesBoundary>
            <Outlet />
          </UnsavedChangesBoundary>
        ),
        children: [
          { path: "/edit", element: <Editor /> },
          { path: "/next", element: <h1>다음 화면</h1> },
          { path: "/login", element: <h1>재로그인</h1> },
        ],
      },
    ],
    { initialEntries: ["/edit"] },
  );
  function Editor() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Link to="/next">이동</Link>
        <Link to="/login">세션 종료</Link>
        <Panel open={open} title="편집" onClose={() => setOpen(false)}>
          <Form name="이름" />
          <Form name="권한" />
        </Panel>
      </>
    );
  }
  render(<RouterProvider router={router} />);
  return router;
}
it("combines multiple drafts into one cancelled navigation and retains both inputs", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mounted();
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "첫 입력" },
  });
  fireEvent.change(screen.getByLabelText("권한"), {
    target: { value: "둘째 입력" },
  });
  fireEvent.click(screen.getByText("이동"));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("이름")).toHaveValue("첫 입력");
  expect(screen.getByLabelText("권한")).toHaveValue("둘째 입력");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByText("이동"));
  await screen.findByRole("heading", { name: "다음 화면" });
  expect(confirm).toHaveBeenCalledTimes(2);
});
it("saving one form keeps the other protected; cancelled panel close and reload preserve it", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mounted();
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "변경" },
  });
  fireEvent.change(screen.getByLabelText("권한"), {
    target: { value: "변경" },
  });
  fireEvent.click(screen.getByText("저장 이름"));
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText("저장 권한"));
  const saved = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(saved);
  expect(saved.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(confirm).toHaveBeenCalledTimes(1);
});
it("does not block security redirects and unregisters discarded forms", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mounted();
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "비공개 초안" },
  });
  fireEvent.click(screen.getByText("세션 종료"));
  await screen.findByRole("heading", { name: "재로그인" });
  expect(confirm).not.toHaveBeenCalled();
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
