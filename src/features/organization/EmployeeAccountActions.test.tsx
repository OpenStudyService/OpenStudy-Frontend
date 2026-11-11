import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../shared/api/client";
import { useUi } from "../../app/store";
import type { CurrentUser } from "../../shared/domain/schema";
import { EmployeeAccountActions } from "./EmployeeAccountActions";
import type { Employee, Membership } from "./model";

const ctx = vi.hoisted(() => ({ session: {} as CurrentUser, scope: "all" }));
vi.mock("../../app/context", () => ({ useApp: () => ctx }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const membership: Membership = {
  branchId: "1",
  status: "활성",
  role: "admin",
  version: 1,
  permissions: ["people:manage"],
};
const employee: Employee = {
  createdAt: "2026-11-11T00:00:00Z",
  updatedAt: "2026-11-11T00:00:00Z",
  branchId: "1",
  nickname: "직원",
  avatar: "",
  id: "10",
  name: "직원",
  email: "staff@example.test",
  status: "활성",
  owner: false,
  version: 1,
  memberships: [{ ...membership, role: "staff", permissions: [] }],
};

beforeEach(() => {
  ctx.scope = "all";
  ctx.session = {
    user: { ...employee, id: "actor", memberships: [membership] },
  } as CurrentUser;
});
afterEach(() => {
  cleanup();
  useUi.getState().clearPrivate();
  vi.mocked(api).mockReset();
});

function show(target: Employee) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EmployeeAccountActions employee={target} />
    </QueryClientProvider>,
  );
}
const reset = () => screen.queryByRole("button", { name: "비밀번호 초기화" });
const unlock = () => screen.queryByRole("button", { name: "로그인 잠금 해제" });

it.each(["staff", "revoked-target", "owner-target", "wrong-branch"])(
  "hides both actions for %s",
  (reason) => {
    if (reason === "staff")
      ctx.session.user.memberships = [{ ...membership, role: "staff" }];
    const target = {
      ...employee,
      owner: reason === "owner-target",
      memberships: [
        {
          ...employee.memberships[0],
          status:
            reason === "revoked-target" ? ("회수" as const) : ("활성" as const),
          branchId: reason === "wrong-branch" ? "2" : "1",
        },
      ],
    };
    show(target);
    expect(reset()).toBeNull();
    expect(unlock()).toBeNull();
  },
);

it.each(["self", "inactive"])("offers only unlock for %s", (reason) => {
  show({
    ...employee,
    id: reason === "self" ? "actor" : "10",
    status: reason === "inactive" ? "비활성" : "활성",
  });
  expect(reset()).toBeNull();
  expect(unlock()).toBeVisible();
});

it("checks other managed branches when the selected branch's membership is revoked", async () => {
  ctx.scope = "1";
  ctx.session.user.memberships.push({ ...membership, branchId: "2" });
  vi.mocked(api).mockResolvedValue({
    ...employee,
    memberships: [{ ...employee.memberships[0], branchId: "2" }],
  });
  show({
    ...employee,
    memberships: [{ ...employee.memberships[0], status: "회수" }],
  });
  expect(
    await screen.findByRole("button", { name: "비밀번호 초기화" }),
  ).toBeVisible();
  expect(api).toHaveBeenCalledWith(
    "/employees/10?scope=all",
    expect.anything(),
  );
});

it("confirms the impact before queuing a reset and uses the unlock result", async () => {
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  vi.mocked(api)
    .mockResolvedValueOnce({ delivery: "PENDING" })
    .mockResolvedValueOnce({ wasLocked: false });
  show(employee);
  fireEvent.click(reset()!);
  expect(api).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith(
    expect.stringMatching(/즉시.*모든 기기.*이메일/),
  );
  fireEvent.click(reset()!);
  expect(api).toHaveBeenCalledWith("/employees/10/password-reset", {
    method: "POST",
  });
  await vi.waitFor(() =>
    expect(useUi.getState().notice).toContain("발송이 예약"),
  );
  fireEvent.click(unlock()!);
  expect(api).toHaveBeenCalledWith("/employees/10/login-unlock", {
    method: "POST",
  });
  await vi.waitFor(() =>
    expect(useUi.getState().notice).toContain("잠긴 상태가 아니었어요"),
  );
});
