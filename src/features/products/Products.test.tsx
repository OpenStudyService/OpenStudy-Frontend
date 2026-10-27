import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProductManagement } from "./Products";
import { api, ApiError } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
import type { Product, ProductCategory } from "./model";

const context = vi.hoisted(() => ({
  session: {} as CurrentUser,
  scope: "all",
  lookups: { employees: [{ id: "owner", name: "김서연" }] },
}));
vi.mock("../../app/context", () => ({ useApp: () => context }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));

const category = (over: Partial<ProductCategory> = {}): ProductCategory => ({
  id: "c-time",
  version: 1,
  createdAt: "",
  updatedAt: "",
  code: "TIME",
  name: "시간권",
  kind: "시간권",
  status: "활성",
  ...over,
});
const categories = [
  category(),
  category({ id: "c-period", code: "PERIOD", name: "기간권", kind: "기간권" }),
  category({ id: "c-credit", code: "CREDIT", name: "정액권", kind: "정액권" }),
];
const time = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  version: 3,
  createdAt: "2026-10-17T00:00:00Z",
  updatedAt: "2026-10-17T00:00:00Z",
  code: "T10",
  name: "10시간권",
  priceKrw: 15000,
  terms: { kind: "시간권", includedMinutes: 600, validDays: null },
  status: "판매 중",
  category: categories[0],
  branchIds: ["gangnam"],
  canEdit: true,
  ...over,
});
const snapshot = (over: object = {}) => ({
  schemaVersion: 1,
  code: "T10",
  name: "10시간권",
  priceKrw: 15000,
  terms: { kind: "시간권", includedMinutes: 600, validDays: null },
  status: "판매 중",
  categoryCode: "TIME",
  categoryName: "시간권",
  branchIds: ["gangnam"],
  ...over,
});
const revisions = {
  items: [
    {
      id: "r2",
      productId: "p1",
      version: 3,
      changedAt: "2026-10-17T03:00:00Z",
      actorId: "owner",
      changeType: "UPDATED",
      before: snapshot({ priceKrw: 12000 }),
      after: snapshot(),
    },
    {
      id: "r1",
      productId: "p1",
      version: 1,
      changedAt: "2026-10-16T03:00:00Z",
      actorId: "owner",
      changeType: "CREATED",
      before: null,
      after: snapshot({ priceKrw: 12000 }),
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2 },
};
let products: Product[];
let failures: Record<string, ApiError>;
const conflict = (latest: number) =>
  new ApiError(409, {
    code: "VERSION_CONFLICT",
    message: "다른 사용자가 수정했습니다. 최신 내용을 확인해 주세요.",
    latestVersion: latest,
    reloadUrl: "/api/products/p1",
  });
const calls = () =>
  vi
    .mocked(api)
    .mock.calls.filter(([, options]) => options?.method !== undefined)
    .map(([path, options]) => ({ path, ...options }));

function session(role: "owner" | "manager" | "writer") {
  const memberships = (permissions: string[], r: "admin" | "staff") => [
    {
      branchId: "gangnam",
      role: r,
      permissions,
      status: "활성",
      version: 1,
    },
  ];
  context.session = {
    user: {
      id: role,
      status: "활성",
      owner: role === "owner",
      memberships:
        role === "owner"
          ? []
          : role === "manager"
            ? memberships(["operations:write"], "admin")
            : memberships(["operations:write"], "staff"),
    } as unknown as CurrentUser["user"],
    branches: [
      { id: "gangnam", name: "강남점", status: "운영 중" },
      { id: "seongsu", name: "성수점", status: "운영 중" },
    ] as CurrentUser["branches"],
    sessionMode: "WORKSPACE",
    asOf: "now",
    snapshotVersion: "1",
  };
}
beforeEach(() => {
  session("owner");
  failures = {};
  products = [time()];
  vi.mocked(api).mockImplementation(async (path, options) => {
    const method = options?.method ?? "GET";
    const failure = failures[`${method} ${path.split("?")[0]}`];
    if (failure) throw failure;
    const clean = path.split("?")[0];
    if (clean === "/product-categories")
      return { items: categories, meta: { page: 1, pageSize: 100, total: 3 } };
    if (clean === "/products" && method === "GET")
      return {
        items: products,
        meta: { page: 1, pageSize: 20, total: products.length },
      };
    if (clean === "/products" && method === "POST")
      return { ...products[0], id: "new" };
    if (clean === "/products/p1/history") return revisions;
    if (clean === "/products/p1" && method === "GET") return products[0];
    if (clean.startsWith("/products/p1"))
      return { ...products[0], version: products[0].version + 1 };
    throw new Error(`unexpected ${method} ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <ProductManagement />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const open = async (name = "10시간권") => {
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: `상품 상세: ${name}` }),
  );
  return screen.findByRole("dialog");
};

it("lists terms with explicit units and unlimited validity, and never offers delete", async () => {
  mount();
  await screen.findByText(/10시간\(600분\)/);
  expect(screen.getByText(/유효기간 무기한/)).toBeVisible();
  expect(screen.getByText(/판매 지점: 강남점/)).toBeVisible();
  expect(screen.getByRole("button", { name: "상품 등록" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
  const dialog = await open();
  expect(within(dialog).queryByRole("button", { name: /삭제/ })).toBeNull();
  expect(
    within(dialog).getByRole("button", { name: "판매 중지" }),
  ).toBeVisible();
});

it("explains a read-only shared product and hides every write control", async () => {
  session("writer");
  products = [time({ canEdit: false })];
  const dialog = await open();
  expect(screen.getByText(/조회 전용/)).toBeVisible();
  expect(within(dialog).getByRole("note")).toHaveTextContent(
    "모든 지점에 대한 운영 설정 권한",
  );
  expect(within(dialog).getByLabelText("판매 금액 (원)")).toBeDisabled();
  expect(
    within(dialog).queryByRole("button", { name: "상품 정보 저장" }),
  ).toBeNull();
  expect(
    within(dialog).queryByRole("button", { name: "판매 중지" }),
  ).toBeNull();
  expect(within(dialog).queryByText("변경 이력")).toBeNull();
});

it("lets a writer edit but leaves sale status, branches and history to managers", async () => {
  session("writer");
  const dialog = await open();
  expect(
    within(dialog).getByRole("button", { name: "상품 정보 저장" }),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: "판매 중지" }),
  ).toBeNull();
  expect(within(dialog).queryByText("변경 이력")).toBeNull();
  expect(within(dialog).getByText(/지점 관리자 권한/)).toBeVisible();
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/history"),
    expect.anything(),
  );
});

it("sends only the registered kind's fields and null for unlimited validity", async () => {
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "상품 등록" }),
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("상품명"), " 새 시간권 ");
  await userEvent.type(
    within(dialog).getByLabelText("판매 금액 (원)"),
    "15000",
  );
  await userEvent.type(within(dialog).getByLabelText("제공 시간 (분)"), "600");
  await userEvent.click(within(dialog).getByLabelText(/무기한/));
  await userEvent.selectOptions(
    within(dialog).getByLabelText("분류"),
    "c-time",
  );
  await userEvent.click(within(dialog).getByLabelText("강남점"));
  await userEvent.click(
    within(dialog).getByRole("button", { name: "상품 등록" }),
  );
  expect(calls()).toEqual([
    {
      path: "/products",
      method: "POST",
      key: expect.any(String),
      body: {
        name: "새 시간권",
        priceKrw: 15000,
        terms: { kind: "시간권", includedMinutes: 600, validDays: null },
        status: "판매 중",
        categoryId: "c-time",
        branchIds: ["gangnam"],
      },
    },
  ]);
});

it("blocks a zero price and an empty validity without calling the server", async () => {
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "상품 등록" }),
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("상품명"), "무료");
  await userEvent.type(within(dialog).getByLabelText("판매 금액 (원)"), "0");
  await userEvent.type(within(dialog).getByLabelText("제공 시간 (분)"), "60");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "상품 등록" }),
  );
  expect(
    await within(dialog).findByText(/0원은 등록할 수 없어요/),
  ).toBeVisible();
  expect(within(dialog).getByText(/‘무기한’을 선택/)).toBeVisible();
  expect(within(dialog).getByText(/분류를 선택/)).toBeVisible();
  expect(calls()).toEqual([]);
});

it("offers the other kinds' unit fields only after the kind changes", async () => {
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "상품 등록" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText("이용 기간 (일)")).toBeNull();
  await userEvent.selectOptions(
    within(dialog).getByLabelText("상품 유형"),
    "기간권",
  );
  expect(within(dialog).getByLabelText("이용 기간 (일)")).toBeVisible();
  expect(within(dialog).queryByLabelText("제공 시간 (분)")).toBeNull();
  expect(within(dialog).queryByLabelText(/무기한/)).toBeNull();
  await userEvent.selectOptions(
    within(dialog).getByLabelText("상품 유형"),
    "정액권",
  );
  expect(within(dialog).getByLabelText("충전 금액 (원)")).toBeVisible();
  expect(within(dialog).getByLabelText("시간당 요율 (원)")).toBeVisible();
});

it("keeps the kind fixed when editing and sends only the changed field", async () => {
  const dialog = await open();
  expect(within(dialog).getByLabelText("상품 유형")).toBeDisabled();
  const price = within(dialog).getByLabelText("판매 금액 (원)");
  await userEvent.clear(price);
  await userEvent.type(price, "16000");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "상품 정보 저장" }),
  );
  expect(calls()).toEqual([
    {
      path: "/products/p1",
      method: "PATCH",
      body: { version: 3, priceKrw: 16000 },
    },
  ]);
});

it("keeps the input after a version conflict and never overwrites the newer fields", async () => {
  failures["PATCH /products/p1"] = conflict(4);
  const dialog = await open();
  const price = within(dialog).getByLabelText("판매 금액 (원)");
  await userEvent.clear(price);
  await userEvent.type(price, "16000");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "상품 정보 저장" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "다른 사용자가 수정했습니다",
  );
  expect(price).toHaveValue("16000");
  // Someone else renamed the product meanwhile.
  products = [time({ version: 4, name: "10시간권 (개편)" })];
  delete failures["PATCH /products/p1"];
  await userEvent.click(
    within(dialog).getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  expect(await within(dialog).findByRole("status")).toHaveTextContent(
    "10시간권 (개편) / 15,000원 / 판매 중 (v4)",
  );
  expect(price).toHaveValue("16000");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "상품 정보 저장" }),
  );
  expect(calls().at(-1)).toEqual({
    path: "/products/p1",
    method: "PATCH",
    body: { version: 4, priceKrw: 16000 },
  });
});

it("asks for confirmation before stopping sales and then sends the status", async () => {
  const dialog = await open();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "판매 중지" }),
  );
  expect(calls()).toEqual([]);
  await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(calls()).toEqual([]);
  await userEvent.click(
    within(dialog).getByRole("button", { name: "판매 중지" }),
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "중지 확인" }),
  );
  expect(calls()).toEqual([
    {
      path: "/products/p1/status",
      method: "POST",
      body: { version: 3, status: "판매 중지" },
    },
  ]);
});

it("returns the branch selection to the saved set when the change is rejected", async () => {
  failures["PUT /products/p1/branches"] = new ApiError(403, {
    code: "SCOPE_DENIED",
    message: "판매 지점은 관련 모든 지점의 지점 관리자만 바꿀 수 있습니다.",
  });
  const dialog = await open();
  const seongsu = within(dialog).getByRole("checkbox", { name: "성수점" });
  await userEvent.click(seongsu);
  expect(seongsu).toBeChecked();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "판매 지점 저장" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "지점 관리자만",
  );
  expect(seongsu).not.toBeChecked();
  expect(
    within(dialog).getByRole("checkbox", { name: "강남점" }),
  ).toBeChecked();
});

it("keeps the branch selection on a version conflict so it can be compared", async () => {
  failures["PUT /products/p1/branches"] = conflict(4);
  const dialog = await open();
  const seongsu = within(dialog).getByRole("checkbox", { name: "성수점" });
  await userEvent.click(seongsu);
  await userEvent.click(
    within(dialog).getByRole("button", { name: "판매 지점 저장" }),
  );
  await within(dialog).findByRole("button", {
    name: "최신 버전 확인 (입력 유지)",
  });
  expect(seongsu).toBeChecked();
});

it("shows what changed in each revision and the first registration", async () => {
  const dialog = await open();
  expect(await within(dialog).findByText("v3", { exact: false })).toBeVisible();
  expect(
    within(dialog).getByText("판매 금액: 12,000원 → 15,000원"),
  ).toBeVisible();
  expect(within(dialog).getByText("판매 금액: 12,000원")).toBeVisible();
  expect(within(dialog).getAllByText(/김서연/)).toHaveLength(2);
  expect(within(dialog).getByText(/최초 등록/)).toBeVisible();
});

it("restricts category writes to the owner", async () => {
  session("manager");
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "분류" }));
  await screen.findByText("PERIOD · 기간권");
  expect(screen.queryByRole("button", { name: "분류 등록" })).toBeNull();
  expect(screen.queryByRole("button", { name: /분류 수정/ })).toBeNull();
});
