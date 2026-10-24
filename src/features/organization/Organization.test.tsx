import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { components } from "../../shared/api/foundation.generated";
import type {
  CurrentUser,
  Employee as SessionEmployee,
} from "../../shared/domain/schema";
import { permissions, can, admin } from "../../shared/domain/schema";
import { api, ApiError } from "../../shared/api/client";
import { BranchForm, EmployeeDetail, MembershipForm } from "./Organization";
import {
  canManageBranch,
  canManageMembership,
  copyPreset,
  defaultHours,
  hoursError,
  membershipBody,
  rolePermissions,
} from "./model";
import type {
  Branch,
  Employee,
  Membership,
  MembershipInput,
  Preset,
} from "./model";
import { validateOrganization } from "./api";

const context = vi.hoisted(() => ({
  session: {} as CurrentUser,
  scope: "all",
}));
vi.mock("../../app/context", () => ({ useApp: () => context }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const stamp = "2026-10-24T00:00:00Z";
const branch: Branch = {
  id: "1",
  branchId: "1",
  code: "BR001",
  version: 1,
  name: "강남점",
  address: "서울",
  phone: "02-123-4567",
  weeklyHours: defaultHours(),
  hours: "매일 24시간",
  status: "운영 중",
  createdAt: stamp,
  updatedAt: stamp,
};
const membership: Membership = {
  branchId: "1",
  role: "staff",
  status: "활성",
  version: 3,
  permissions: [],
};
const employee: Employee = {
  id: "20",
  branchId: "1",
  version: 4,
  createdAt: stamp,
  updatedAt: stamp,
  name: "직원",
  email: "staff@example.com",
  status: "활성",
  nickname: "직원",
  avatar: "",
  owner: false,
  memberships: [membership, { ...membership, branchId: "2", version: 8 }],
};
const presets: Preset[] = [
  {
    id: "1",
    version: 1,
    name: "일반 직원 기본",
    role: "staff",
    system: true,
    permissions: [],
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: "2",
    version: 1,
    name: "운영 담당",
    role: "staff",
    system: false,
    permissions: ["operations:write"],
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: "3",
    version: 1,
    name: "지점 관리자 기본",
    role: "admin",
    system: true,
    permissions: [...permissions],
    createdAt: stamp,
    updatedAt: stamp,
  },
];
const definitions: components["schemas"]["PermissionDefinition"][] =
  permissions.map((code) => ({
    code,
    description: code,
    adminOnly: code === "people:manage",
  }));
function actor(
  role: "owner" | "admin" | "staff",
  grants = [...permissions],
): SessionEmployee {
  return {
    ...employee,
    id: "10",
    owner: role === "owner",
    memberships: [
      {
        branchId: "1",
        role: role === "staff" ? "staff" : "admin",
        permissions: grants,
      },
    ],
  };
}
function setActor(role: "owner" | "admin" | "staff") {
  context.session = {
    user: actor(role),
    branches: [branch],
    asOf: stamp,
    snapshotVersion: "1",
  };
}
beforeEach(() => {
  vi.mocked(api).mockReset();
  setActor("owner");
});
afterEach(cleanup);

describe("organization policies", () => {
  it("checks all seven days, closure and overnight boundaries", () => {
    expect(hoursError(defaultHours())).toBeUndefined();
    const overnight = defaultHours();
    overnight[0] = {
      weekday: 1,
      isClosed: false,
      opensMinute: 1200,
      closesMinute: 1560,
    };
    expect(hoursError(overnight)).toBeUndefined();
    expect(hoursError(overnight.slice(1))).toBeDefined();
    expect(
      hoursError(overnight.map((h) => ({ ...h, weekday: 1 }))),
    ).toBeDefined();
    overnight[0].closesMinute = 1200;
    expect(hoursError(overnight)).toBeDefined();
    overnight[0] = {
      weekday: 1,
      isClosed: true,
      opensMinute: null,
      closesMinute: null,
    };
    expect(hoursError(overnight)).toBeUndefined();
    overnight[0].opensMinute = 0;
    expect(hoursError(overnight)).toBeDefined();
  });
  it("requires the explicit manager grant and prevents self, owner and manager edits", () => {
    expect(canManageBranch(actor("admin", []), "1")).toBe(false);
    expect(canManageMembership(actor("admin", []), employee, membership)).toBe(
      false,
    );
    expect(canManageMembership(actor("admin"), employee, membership)).toBe(
      true,
    );
    expect(
      canManageMembership(actor("admin"), employee, {
        ...membership,
        role: "admin",
      }),
    ).toBe(false);
    expect(
      canManageMembership(actor("owner"), employee, {
        ...membership,
        role: "admin",
      }),
    ).toBe(true);
    expect(
      canManageMembership(
        actor("owner"),
        { ...employee, id: "10" },
        membership,
      ),
    ).toBe(false);
    expect(
      canManageMembership(
        actor("admin"),
        { ...employee, owner: true },
        membership,
      ),
    ).toBe(false);
    expect(
      canManageMembership(actor("owner"), employee, {
        ...membership,
        status: "회수",
      }),
    ).toBe(false);
  });
  it("removes revoked memberships and individually withdrawn manager grants from navigation access", () => {
    const manager = actor("admin", ["operations:write"]);
    expect(can(manager, "1", "sales:read")).toBe(false);
    expect(can(manager, "1", "operations:write")).toBe(true);
    manager.memberships[0].status = "회수";
    expect(can(manager, "all")).toBe(false);
    expect(admin(manager, "1")).toBe(false);
  });
  it("copies presets without sharing their arrays and sends only one membership with both versions", () => {
    expect(rolePermissions("staff")).toEqual([]);
    expect(rolePermissions("admin")).toHaveLength(9);
    const copy = copyPreset(presets[1]);
    copy.permissions.push("sales:read");
    expect(presets[1].permissions).toEqual(["operations:write"]);
    expect(
      membershipBody(employee, membership, { ...copy, status: "활성" }),
    ).toEqual({
      employeeVersion: 4,
      version: 3,
      role: "staff",
      status: "활성",
      presetId: "2",
      permissions: ["operations:write", "sales:read"],
    });
  });
  it("rejects legacy preview responses without inventing editable versions or hours", () => {
    const legacy = { ...branch, weeklyHours: undefined };
    expect(() =>
      validateOrganization("/branches?scope=all", {
        items: [legacy],
        meta: { page: 1, pageSize: 20, total: 1 },
      }),
    ).toThrow("이 서버는 지점·직원 관리 계약을 지원하지 않습니다");
    expect(() =>
      validateOrganization("/employees/20", {
        ...employee,
        memberships: [{ branchId: "1", role: "staff", permissions: [] }],
      }),
    ).toThrow(ApiError);
    expect(() => validateOrganization("/branches/1", branch)).not.toThrow();
  });
});

it.each([
  ["owner", 2, true],
  ["admin", 1, false],
  ["staff", 0, false],
] as const)("shows only allowed controls for %s", (role, forms, global) => {
  setActor(role);
  render(
    <EmployeeDetail
      employee={employee}
      presets={presets}
      definitions={definitions}
      onSaved={vi.fn()}
    />,
  );
  expect(
    screen.queryAllByRole("button", { name: "이 지점 소속 저장" }),
  ).toHaveLength(forms);
  expect(
    screen.queryAllByRole("button", { name: "계정 정보 저장" }),
  ).toHaveLength(global ? 1 : 0);
  expect(
    screen.getByRole("textbox", { name: "로그인 이메일 (변경 불가)" }),
  ).toHaveAttribute("readonly");
  if (role === "admin")
    expect(screen.getByLabelText("소속 역할")).toBeDisabled();
});

it("preserves membership inputs on 409 and explicitly refreshes both versions before retry", async () => {
  const user = userEvent.setup(),
    onSaved = vi.fn(),
    refresh = vi.fn().mockResolvedValue({
      ...employee,
      version: 9,
      memberships: [{ ...membership, version: 7 }, employee.memberships[1]],
    });
  vi.mocked(api)
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "VERSION_CONFLICT",
        message: "다른 사용자가 수정했습니다.",
        requestId: "req-409",
      }),
    )
    .mockResolvedValue({
      employeeVersion: 10,
      membership: { ...membership, version: 8 },
    });
  render(
    <MembershipForm
      employee={employee}
      membership={membership}
      presets={presets}
      definitions={definitions}
      refresh={refresh}
      onSaved={onSaved}
    />,
  );
  await user.selectOptions(screen.getByLabelText("권한 프리셋 복사"), "2");
  await user.click(screen.getByRole("button", { name: "이 지점 소속 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("req-409");
  expect(screen.getByLabelText("operations:write")).toBeChecked();
  expect(screen.getByLabelText("people:manage (관리자 전용)")).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "계정 v9, 소속 v7",
  );
  expect(screen.getByLabelText("operations:write")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "이 지점 소속 저장" }));
  expect(vi.mocked(api).mock.calls[1]).toEqual([
    "/employees/20/memberships/1?scope=all",
    {
      method: "PUT",
      body: {
        employeeVersion: 9,
        version: 7,
        role: "staff",
        status: "활성",
        permissions: ["operations:write"],
        presetId: "2",
      },
    },
  ]);
  expect(onSaved).toHaveBeenCalledOnce();
  expect(employee.memberships[1]).toEqual({
    ...membership,
    branchId: "2",
    version: 8,
  });
});

it("sends seven structured days including a closed day and separate status command", async () => {
  const user = userEvent.setup(),
    onSaved = vi.fn();
  vi.mocked(api)
    .mockResolvedValueOnce({ ...branch, version: 2 })
    .mockResolvedValueOnce({ ...branch, version: 3, status: "운영 중지" });
  render(<BranchForm branch={branch} scope="1" onSaved={onSaved} />);
  await user.selectOptions(screen.getByLabelText("운영 상태"), "운영 중지");
  await user.click(screen.getAllByRole("checkbox", { name: "휴무" })[0]);
  await user.click(screen.getByRole("button", { name: "지점 저장" }));
  expect(api).toHaveBeenCalledTimes(2);
  const body = vi.mocked(api).mock.calls[0][1]
    ?.body as components["schemas"]["BranchUpdate"];
  expect(body.weeklyHours).toHaveLength(7);
  expect(body.weeklyHours![0]).toEqual({
    weekday: 1,
    isClosed: true,
    opensMinute: null,
    closesMinute: null,
  });
  expect(body).not.toHaveProperty("status");
  expect(vi.mocked(api).mock.calls[1]).toEqual([
    "/branches/1/status?scope=1",
    { method: "POST", body: { version: 2, status: "운영 중지" } },
  ]);
  expect(onSaved).toHaveBeenCalledOnce();
});

describe("employee detail version baselines", () => {
  function setupDetail() {
    const server = { employee: structuredClone(employee) };
    vi.mocked(api).mockImplementation(
      async <T,>(path: string, options: Parameters<typeof api>[1] = {}) => {
        const current = server.employee;
        function conflict(): never {
          throw new ApiError(409, {
            code: "VERSION_CONFLICT",
            message: "다른 사용자가 수정했습니다.",
            requestId: "external-change",
          });
        }
        if (options.method === "PATCH") {
          const body = options.body as components["schemas"]["EmployeeUpdate"];
          if (body.version !== current.version) conflict();
          server.employee = {
            ...current,
            ...body,
            version: current.version + 1,
          };
          return structuredClone(server.employee) as T;
        }
        if (options.method === "PUT") {
          const body = options.body as MembershipInput;
          const branchId = path.match(/memberships\/(\d+)/)![1];
          const membership = current.memberships.find(
            (m) => m.branchId === branchId,
          )!;
          if (
            body.employeeVersion !== current.version ||
            body.version !== membership.version
          )
            conflict();
          const updated = {
            ...membership,
            role: body.role,
            status: body.status,
            permissions: [...body.permissions],
            version: membership.version + 1,
          };
          server.employee = {
            ...current,
            version: current.version + 1,
            memberships: current.memberships.map((m) =>
              m.branchId === branchId ? updated : m,
            ),
          };
          return {
            employeeVersion: server.employee.version,
            membership: structuredClone(updated),
          } as T;
        }
        return structuredClone(current) as T;
      },
    );
    render(
      <EmployeeDetail
        employee={employee}
        presets={presets}
        definitions={definitions}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const profile = within(
      screen.getByRole("button", { name: "계정 정보 저장" }).closest("form")!,
    );
    const memberships = screen
      .getAllByRole("button", { name: "이 지점 소속 저장" })
      .map((button) => within(button.closest("form")!));
    return { server, profile, memberships, user: userEvent.setup() };
  }
  async function save(
    user: ReturnType<typeof userEvent.setup>,
    form: ReturnType<typeof within>,
    name: string,
  ) {
    const button = form.getByRole("button", { name });
    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
  }
  function writes(method: string) {
    return vi
      .mocked(api)
      .mock.calls.filter(([, options]) => options?.method === method);
  }
  it("shares repeated membership saves with a dirty profile without replacing its inputs", async () => {
    const { server, profile, memberships, user } = setupDetail();
    await user.clear(profile.getByLabelText("직원 이름"));
    await user.type(profile.getByLabelText("직원 이름"), "작성 중 이름");
    await user.selectOptions(
      profile.getByLabelText("계정 전체 상태"),
      "이용 제한",
    );
    await save(user, memberships[0], "이 지점 소속 저장");
    await save(user, memberships[0], "이 지점 소속 저장");
    expect(profile.getByLabelText("직원 이름")).toHaveValue("작성 중 이름");
    expect(profile.getByLabelText("계정 전체 상태")).toHaveValue("이용 제한");
    await save(user, profile, "계정 정보 저장");
    expect(writes("PATCH")[0][1]?.body).toMatchObject({
      version: 6,
      name: "작성 중 이름",
      status: "이용 제한",
    });
    expect(server.employee.version).toBe(7);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shares the employee version between branches while retaining each branch version and draft", async () => {
    const { server, memberships, user } = setupDetail();
    await user.click(memberships[1].getByLabelText("sales:read"));
    await save(user, memberships[0], "이 지점 소속 저장");
    expect(memberships[1].getByLabelText("sales:read")).toBeChecked();
    await save(user, memberships[1], "이 지점 소속 저장");
    expect(writes("PUT")[1][1]?.body).toMatchObject({
      employeeVersion: 5,
      version: 8,
      permissions: ["sales:read"],
    });
    expect(server.employee.version).toBe(6);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("shares a successful profile save with dirty membership forms", async () => {
    const { server, profile, memberships, user } = setupDetail();
    await user.click(memberships[0].getByLabelText("operations:write"));
    await user.clear(profile.getByLabelText("직원 이름"));
    await user.type(profile.getByLabelText("직원 이름"), "새 이름");
    await save(user, profile, "계정 정보 저장");
    expect(memberships[0].getByLabelText("operations:write")).toBeChecked();
    await save(user, memberships[0], "이 지점 소속 저장");
    expect(writes("PUT")[0][1]?.body).toMatchObject({
      employeeVersion: 5,
      version: 3,
      permissions: ["operations:write"],
    });
    expect(server.employee.version).toBe(6);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps a real external conflict and dirty profile even after another form explicitly refreshes and saves", async () => {
    const { server, profile, memberships, user } = setupDetail();
    await user.clear(profile.getByLabelText("직원 이름"));
    await user.type(profile.getByLabelText("직원 이름"), "내 입력");
    await user.click(memberships[0].getByLabelText("members:write"));
    server.employee = { ...server.employee, version: 5, name: "외부 이름" };
    await save(user, memberships[0], "이 지점 소속 저장");
    expect(memberships[0].getByRole("alert")).toHaveTextContent(
      "external-change",
    );
    expect(memberships[0].getByLabelText("members:write")).toBeChecked();
    await user.click(
      memberships[0].getByRole("button", {
        name: "최신 버전 확인 (입력 유지)",
      }),
    );
    await save(user, memberships[0], "이 지점 소속 저장");
    expect(server.employee.version).toBe(6);
    await save(user, profile, "계정 정보 저장");
    expect(profile.getByRole("alert")).toHaveTextContent("external-change");
    expect(writes("PATCH")[0][1]?.body).toMatchObject({
      version: 4,
      name: "내 입력",
    });
    expect(profile.getByLabelText("직원 이름")).toHaveValue("내 입력");
    expect(server.employee.name).toBe("외부 이름");
    await user.click(
      profile.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
    );
    expect(profile.getByLabelText("직원 이름")).toHaveValue("내 입력");
    await save(user, profile, "계정 정보 저장");
    expect(server.employee.name).toBe("내 입력");
    expect(writes("PATCH")[1][1]?.body).toMatchObject({ version: 6 });
  });
  it("initializes a newly discovered membership without rebasing existing stale forms", async () => {
    const { server, profile, memberships, user } = setupDetail();
    server.employee = {
      ...server.employee,
      version: 5,
      memberships: [
        ...server.employee.memberships,
        { ...membership, branchId: "3", version: 1 },
      ],
    };
    await save(user, memberships[0], "이 지점 소속 저장");
    await user.click(
      memberships[0].getByRole("button", {
        name: "최신 버전 확인 (입력 유지)",
      }),
    );
    const third = within(
      screen
        .getAllByRole("button", { name: "이 지점 소속 저장" })[2]
        .closest("form")!,
    );
    await save(user, third, "이 지점 소속 저장");
    expect(writes("PUT")[1]).toEqual([
      "/employees/20/memberships/3?scope=all",
      {
        method: "PUT",
        body: {
          employeeVersion: 5,
          version: 1,
          role: "staff",
          status: "활성",
          permissions: [],
        },
      },
    ]);
    await save(user, profile, "계정 정보 저장");
    expect(profile.getByRole("alert")).toHaveTextContent("external-change");
    expect(writes("PATCH")[0][1]?.body).toMatchObject({ version: 4 });
    expect(server.employee.version).toBe(6);
  });
});
