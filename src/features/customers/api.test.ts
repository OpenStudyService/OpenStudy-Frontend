import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../shared/api/client";
import { customerApi } from "./api";
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn().mockResolvedValue({}),
}));
afterEach(() => vi.clearAllMocks());
it("uses the canonical customer API for bounded selection without a mock/live response branch", async () => {
  const signal = new AbortController().signal;
  await customerApi.list(
    "gangnam",
    { q: "회원", page: 2, pageSize: 20 },
    signal,
  );
  expect(api).toHaveBeenCalledWith(
    "/customers?scope=gangnam&q=%ED%9A%8C%EC%9B%90&page=2&pageSize=20",
    { signal },
  );
  await customerApi.detail("all", "x/y", signal);
  expect(api).toHaveBeenLastCalledWith("/customers/x%2Fy?scope=all", {
    signal,
  });
});
it("preserves the logical creation key and sends canonical update/status bodies", async () => {
  const signal = new AbortController().signal;
  const body = { registeredBranchId: "1", name: "신규", phone: "01012345678" };
  await customerApi.create("all", body, signal, "same-key");
  expect(api).toHaveBeenLastCalledWith("/customers?scope=all", {
    method: "POST",
    body,
    signal,
    key: "same-key",
  });
  await customerApi.update("1", "2", { version: 3, memo: null }, signal);
  expect(api).toHaveBeenLastCalledWith("/customers/2?scope=1", {
    method: "PATCH",
    body: { version: 3, memo: null },
    signal,
  });
  await customerApi.changeStatus(
    "1",
    "2",
    { version: 4, status: "비활성", reason: "요청" },
    signal,
  );
  expect(api).toHaveBeenLastCalledWith("/customers/2/status?scope=1", {
    method: "POST",
    body: { version: 4, status: "비활성", reason: "요청" },
    signal,
  });
});
