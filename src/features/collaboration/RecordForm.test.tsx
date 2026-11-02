import { RecordDetail } from "./RecordDetail";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppContext } from "../../app/context";
import type { components } from "../../shared/api/foundation.generated";
import { ApiError } from "../../shared/api/client";
import { MockStore } from "../../mocks/store";
import { RecordForm } from "./RecordForm";
import { recordApi } from "./api";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({
  recordApi: { detail: vi.fn(), write: vi.fn(), types: vi.fn() },
}));
let row: components["schemas"]["Notice"];
beforeEach(() => {
  vi.resetAllMocks();
  const store = new MockStore(false);
  store.persona = "owner";
  context.value = {
    scope: "gangnam",
    session: {
      user: store.user(),
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "test",
    },
    lookups: { ...store.db },
  };
  row = {
    id: "n1",
    version: 1,
    title: "원래 제목",
    body: "원래 본문",
    target: "선택 지점",
    branchIds: ["gangnam"],
    pinned: false,
    status: "게시 중",
    author: { id: "owner", name: "사장님" },
    publishedAt: store.now(),
    createdAt: store.now(),
    updatedAt: store.now(),
    canEdit: true,
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const saved = vi.fn(),
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecordForm resource="notices" row={row} mode="edit" onSaved={saved} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { saved, client, user: userEvent.setup(), ...view };
}
it("commits the returned version before the next command and cancels an older detail read", async () => {
  const savedRow = { ...row, title: "원래 제목 수정", version: 2 };
  vi.mocked(recordApi.write).mockResolvedValue(savedRow);
  const { user, client, saved } = mount(),
    key = ["data", "owner", "gangnam", "notices", "detail", row.id];
  client.setQueryData(key, row);
  let resolve!: (value: typeof row) => void;
  let signal!: AbortSignal;
  const pending = client
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal: s }) => {
        signal = s;
        return new Promise<typeof row>((r) => {
          resolve = r;
        });
      },
    })
    .catch(() => undefined);
  await user.type(screen.getByLabelText("공지 제목"), " 수정");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(signal.aborted).toBe(true);
  expect(client.getQueryData(key)).toEqual(savedRow);
  resolve(row);
  await pending;
  expect(client.getQueryData(key)).toEqual(savedRow);
});
it("keeps input and the original version until explicit latest comparison, then patches only edited fields", async () => {
  const latest = { ...row, version: 2, body: "다른 편집자의 본문" };
  vi.mocked(recordApi.write)
    .mockRejectedValueOnce(
      new ApiError(409, { code: "VERSION_CONFLICT", message: "충돌" }),
    )
    .mockResolvedValue({ ...latest, title: "내 제목", version: 3 });
  vi.mocked(recordApi.detail).mockResolvedValue(latest);
  const { user, saved } = mount();
  await user.clear(screen.getByLabelText("공지 제목"));
  await user.type(screen.getByLabelText("공지 제목"), "내 제목");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(screen.getByLabelText("공지 제목")).toHaveValue("내 제목");
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  expect(
    await screen.findByText("다른 편집자의 본문", { exact: true }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(vi.mocked(recordApi.write).mock.calls[0][4]).toEqual({
    version: 1,
    title: "내 제목",
  });
  expect(vi.mocked(recordApi.write).mock.calls[1][4]).toEqual({
    version: 2,
    title: "내 제목",
  });
});
it("renders field validation errors, retains input and retries without duplicate submissions", async () => {
  let resolve!: (value: typeof row) => void;
  vi.mocked(recordApi.write)
    .mockRejectedValueOnce(
      new ApiError(422, {
        code: "VALIDATION_FAILED",
        message: "확인",
        fieldErrors: { title: "제목을 확인하세요" },
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  const { user, saved } = mount();
  await user.type(screen.getByLabelText("공지 제목"), " 수정");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText("title: 제목을 확인하세요")).toBeVisible();
  expect(screen.getByLabelText("공지 제목")).toHaveValue("원래 제목 수정");
  await user.dblClick(screen.getByRole("button", { name: "저장하기" }));
  expect(recordApi.write).toHaveBeenCalledTimes(2);
  resolve(row);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});
it("aborts a departed panel and ignores its late successful write callback", async () => {
  let resolve!: (value: typeof row) => void;
  let signal!: AbortSignal;
  vi.mocked(recordApi.write).mockImplementation((_r, _s, _id, _a, _b, s) => {
    signal = s;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const { user, saved, unmount } = mount();
  await user.type(screen.getByLabelText("공지 제목"), " 수정");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  unmount();
  expect(signal.aborted).toBe(true);
  resolve(row);
  await new Promise((r) => setTimeout(r, 0));
  expect(saved).not.toHaveBeenCalled();
});
it("blocks further saves after authorization is revoked and refreshes the session", async () => {
  vi.mocked(recordApi.write).mockRejectedValue(
    new ApiError(403, { code: "FORBIDDEN", message: "권한 회수" }),
  );
  const { user, client } = mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await user.type(screen.getByLabelText("공지 제목"), " 수정");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText(/접근 권한이 변경/)).toBeVisible();
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
});

it("blocks a direct facility registration URL for a staff member without write permission", () => {
  const store = new MockStore(false);
  store.persona = "junho";
  context.value.session.user = store.user();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecordDetail resource="facilities" id="new" onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("등록 권한이 없어요")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "저장하기" }),
  ).not.toBeInTheDocument();
});
