import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
const password = process.env.CUSTOMER_SPACES_LIVE_PASSWORD;
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();
test.beforeAll(() => {
  if (!password)
    throw new Error(
      "Prepare isolated Backend per docs/testing/customer-spaces-live.md",
    );
});
async function login(
  browser: Browser,
  email = "owner@lockers.test",
  label = "primary",
) {
  const key = `${email}:${label}`,
    state = sessions.get(key),
    context = await browser.newContext({
      baseURL: "http://127.0.0.1:15192",
      serviceWorkers: "block",
      storageState: state,
    }),
    page = await context.newPage();
  if (!state) {
    const { token } = await (
      await context.request.get("/api/auth/csrf", { timeout: 30000 })
    ).json();
    const response = await context.request.post("/api/auth/login", {
      data: { email, password },
      headers: { "X-CSRF-Token": token },
    });
    expect(response.status(), await response.text()).toBe(200);
    sessions.set(key, await context.storageState());
  }
  return { context, page };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
  key = randomUUID(),
) {
  if (!body) return context.request.get(`/api${path}`, { timeout: 30000 });
  const { token } = await (
    await context.request.get("/api/auth/csrf", { timeout: 30000 })
  ).json();
  return context.request.fetch(`/api${path}`, {
    method,
    data: body,
    headers: { "X-CSRF-Token": token, "Idempotency-Key": key },
  });
}
async function created(
  context: BrowserContext,
  path: string,
  body: object,
  key = randomUUID(),
) {
  const response = await api(context, path, body, "POST", key);
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
const suffix = () => randomUUID().slice(0, 8);
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
const plus = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);

async function fixture(context: BrowserContext) {
  const tag = suffix();
  const customer = await created(context, "/customers", {
    registeredBranchId: "1",
    name: `이력 고객 ${tag}`,
    phone: "01099334455",
    memo: "요약에 숨겨야 할 메모",
  });
  const reservations = [],
    assignments = [];
  for (const branchId of ["1", "2"]) {
    const room = await created(context, "/rooms", {
      branchId,
      roomNo: `H${tag}`,
      name: `이력 룸 ${tag}`,
      capacity: 4,
      ratePerHourKrw: 8000,
    });
    const startAt =
      new Date(Date.now() + 86400000).toISOString().slice(0, 13) + ":00:00Z";
    const r = await created(context, "/room-reservations", {
      branchId,
      roomId: room.id,
      customerId: customer.id,
      startAt,
      endAt: new Date(Date.parse(startAt) + 3600000).toISOString(),
      partySize: 2,
      method: "카드",
    });
    const use = await api(context, `/room-reservations/${r.id}/start`, {
      version: r.version,
    });
    expect(use.status(), await use.text()).toBe(200);
    reservations.push(await use.json());
    const locker = await created(context, "/lockers", {
      branchId,
      lockerNo: `H${tag}`,
      ratePer4WeeksKrw: 20000,
    });
    assignments.push(
      await created(context, "/locker-assignments", {
        branchId,
        lockerId: locker.id,
        customerId: customer.id,
        startDate: today(),
        endDate: plus(today(), 28),
        method: "카드",
      }),
    );
  }
  const category = await created(context, "/product-categories", {
    code: `H${tag.toUpperCase()}`,
    name: `이력 ${tag}`,
    kind: "시간권",
  });
  const product = await created(context, "/products", {
    name: `요약 이용권 ${tag}`,
    priceKrw: 17500,
    terms: { kind: "시간권", includedMinutes: 600, validDays: null },
    status: "판매 중",
    categoryId: category.id,
    branchIds: ["2"],
  });
  await created(context, "/payments", {
    branchId: "2",
    customerId: customer.id,
    productId: product.id,
    method: "카드",
  });
  return { customer, reservations, assignments, product };
}

async function resetStaffGrant(context: BrowserContext) {
  const list = await (
    await api(context, "/employees?scope=1&q=staff%40lockers.test")
  ).json();
  const staff = list.items.find(
    (e: { email: string }) => e.email === "staff@lockers.test",
  );
  const employee = await (
    await api(context, `/employees/${staff.id}?scope=1`)
  ).json();
  const membership = employee.memberships.find(
    (m: { branchId: string }) => m.branchId === "1",
  );
  if (!membership.permissions.includes("customers:cross-branch-read")) return;
  const response = await api(
    context,
    `/employees/${staff.id}/memberships/1?scope=1`,
    {
      employeeVersion: employee.version,
      version: membership.version,
      role: membership.role,
      status: membership.status,
      permissions: membership.permissions.filter(
        (p: string) => p !== "customers:cross-branch-read",
      ),
    },
    "PUT",
  );
  expect(response.status(), await response.text()).toBe(200);
}

test("actual HTTP space history matches ledgers, scopes and nullable fees; summary is minimal", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@lockers.test");
  try {
    await resetStaffGrant(owner.context);
    const f = await fixture(owner.context);
    const history = await (
      await api(
        owner.context,
        `/customers/${f.customer.id}/space-history?scope=all`,
      )
    ).json();
    expect(
      history.reservations.map((r: { id: string }) => r.id).sort(),
    ).toEqual(f.reservations.map((r) => r.id).sort());
    expect(history.assignments.map((r: { id: string }) => r.id).sort()).toEqual(
      f.assignments.map((r) => r.id).sort(),
    );
    expect(history.assignments[0].charges[0].amountKrw).toBe(20000);
    const local = await (
      await api(
        staff.context,
        `/customers/${f.customer.id}/space-history?scope=all`,
      )
    ).json();
    expect(local.reservations).toHaveLength(1);
    expect(local.assignments).toHaveLength(1);
    expect(local.reservations[0]).toMatchObject({
      branchId: "1",
      billing: null,
    });
    expect(local.assignments[0]).toMatchObject({
      branchId: "1",
      charges: null,
    });
    expect(
      (
        await api(
          staff.context,
          `/customers/${f.customer.id}/cross-branch-summary`,
          { branchId: "1", reason: "상담" },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await api(
          owner.context,
          `/customers/${f.customer.id}/cross-branch-summary`,
          { branchId: "1", reason: " " },
        )
      ).status(),
    ).toBe(422);
    const response = await api(
      owner.context,
      `/customers/${f.customer.id}/cross-branch-summary`,
      { branchId: "1", reason: "고객 응대" },
    );
    const summary = await response.json();
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(Object.keys(summary).sort()).toEqual([
      "asOf",
      "customerId",
      "passes",
      "usages",
    ]);
    expect(summary.passes[0]).toMatchObject({
      productName: f.product.name,
      status: "활성",
    });
    expect(summary.usages).toHaveLength(4);
    for (const row of summary.usages)
      expect(Object.keys(row).sort()).toEqual([
        "branchId",
        "endAt",
        "kind",
        "startAt",
      ]);
    expect(JSON.stringify(summary)).not.toContain(f.customer.phone);
    expect(JSON.stringify(summary)).not.toContain("요약에 숨겨야 할 메모");
    const payment = f.assignments.find((a) => a.branchId === "2").charges[0]
      .paymentId;
    expect([403, 404]).toContain(
      (await api(staff.context, `/payments/${payment}?scope=2`)).status(),
    );
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});

test("actual owner UI persists history after reload and links to the target branch reservation, assignment and payment", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const f = await fixture(owner.context);
    await owner.page.goto(`/app/all/members?detail=${f.customer.id}`);
    await owner.page
      .getByRole("button", { name: "룸·사물함 이력 보기" })
      .click();
    const history = owner.page.getByRole("region", {
      name: "허용 지점 룸·사물함 이력",
    });
    await expect(
      history.getByRole("link", { name: "룸 예약 상세" }),
    ).toHaveCount(2);
    const r = f.reservations.find((r) => r.branchId === "2");
    await expect(
      history.locator(`a[href="/app/2/reservations?detail=${r.id}"]`),
    ).toBeVisible();
    const a = f.assignments.find((a) => a.branchId === "2");
    const payment = history.locator(
      `a[href="/app/2/payments?detail=${a.charges[0].paymentId}"]`,
    );
    await expect(payment).toBeVisible();
    await payment.click();
    await expect(owner.page).toHaveURL(
      new RegExp(`/app/2/payments\\?detail=${a.charges[0].paymentId}`),
    );
    await expect(owner.page.getByRole("dialog")).toBeVisible();
    await owner.page.goto(`/app/1/members?detail=${f.customer.id}`);
    await owner.page.reload();
    await owner.page
      .getByRole("button", { name: "룸·사물함 이력 보기" })
      .click();
    await expect(
      owner.page.getByRole("link", { name: "룸 예약 상세" }),
    ).toHaveCount(1);
    await expect(
      owner.page.getByRole("link", { name: "사물함 배정 상세" }),
    ).toHaveCount(1);
    await owner.page.getByRole("link", { name: "룸 예약 상세" }).click();
    await expect(owner.page).toHaveURL(
      new RegExp(`/app/1/reservations\\?detail=`),
    );
    await expect(owner.page.getByRole("dialog")).toContainText(f.customer.name);
  } finally {
    await owner.context.close();
  }
});

test("actual permission UI grants and revokes summary access; staff sees minimum data without payment links", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@lockers.test", "permission-test");
  try {
    await resetStaffGrant(owner.context);
    const f = await fixture(owner.context);
    const definitions = await (await api(owner.context, "/permissions")).json();
    const label = definitions.find(
      (p: { code: string }) => p.code === "customers:cross-branch-read",
    ).description;
    await staff.page.goto(`/app/1/members?detail=${f.customer.id}`);
    await staff.page
      .getByRole("button", { name: "룸·사물함 이력 보기" })
      .click();
    await expect(
      staff.page.getByRole("link", { name: "사물함 배정 상세" }),
    ).toHaveCount(1);
    await expect(
      staff.page.getByRole("link", { name: "관련 결제 상세" }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("button", { name: /타 지점 최소 요약/ }),
    ).toHaveCount(0);
    await owner.page.goto("/app/1/employees");
    await owner.page
      .getByRole("table", { name: "직원 목록" })
      .getByRole("button", { name: "Lockers Staff", exact: true })
      .click();
    const panel = owner.page.getByRole("dialog");
    const grant = panel.getByRole("checkbox", { name: label, exact: true });
    await grant.check();
    const save = owner.page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && r.url().includes("/memberships/1"),
    );
    await panel.getByRole("button", { name: "이 지점 소속 저장" }).click();
    expect((await save).status()).toBe(200);
    // Observe the actual permission event before opening a form. Reloading during
    // the outstanding event can correctly clear the private panel a second time.
    await staff.page
      .getByRole("button", { name: "타 지점 최소 요약 조회" })
      .click();
    await staff.page
      .getByRole("button", { name: "사유를 기록하고 조회" })
      .click();
    await expect(
      staff.page.getByText("응대 사유를 1~500자로 입력해 주세요."),
    ).toBeVisible();
    await staff.page.getByLabel("응대 사유").fill("타 지점 이용 확인");
    const served = staff.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/cross-branch-summary"),
    );
    await staff.page
      .getByRole("button", { name: "사유를 기록하고 조회" })
      .click();
    const response = await served;
    expect(response.status()).toBe(200);
    expect(response.request().headers()["idempotency-key"]).toBeUndefined();
    expect(response.request().postDataJSON()).toEqual({
      branchId: "1",
      reason: "타 지점 이용 확인",
    });
    const summary = staff.page.getByRole("region", {
      name: "타 지점 최소 요약 결과",
    });
    await expect(summary).toContainText(f.product.name);
    await expect(summary).toContainText("지점 2");
    await expect(summary.getByRole("link")).toHaveCount(0);
    await expect(summary).not.toContainText("17,500");
    await staff.page.setViewportSize({ width: 390, height: 844 });
    await staff.page.screenshot({
      path: "qa-artifacts/customer-spaces-live/summary-mobile.png",
      fullPage: true,
    });
    const foreign = await created(owner.context, "/customers", {
      registeredBranchId: "2",
      name: `범위 밖 ${suffix()}`,
      phone: "01088776655",
    });
    expect(
      (await api(staff.context, `/customers/${foreign.id}?scope=1`)).status(),
    ).toBe(404);
    const foreignSummary = await api(
      staff.context,
      `/customers/${foreign.id}/cross-branch-summary`,
      { branchId: "1", reason: "범위 확장 없음 확인" },
    );
    expect(foreignSummary.status()).toBe(200);
    expect(
      (await api(staff.context, `/customers/${foreign.id}?scope=1`)).status(),
    ).toBe(404);
    expect(
      (
        await api(
          staff.context,
          `/customers/${foreign.id}/space-history?scope=1`,
        )
      ).status(),
    ).toBe(404);
    await grant.uncheck();
    const revoked = owner.page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && r.url().includes("/memberships/1"),
    );
    await panel.getByRole("button", { name: "이 지점 소속 저장" }).click();
    expect((await revoked).status()).toBe(200);
    const denied = await api(
      staff.context,
      `/customers/${f.customer.id}/cross-branch-summary`,
      { branchId: "1", reason: "회수 후 재검사" },
    );
    expect(denied.status()).toBe(403);
    await staff.page.reload();
    await expect(
      staff.page.getByRole("button", { name: /타 지점 최소 요약/ }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("region", { name: "타 지점 최소 요약 결과" }),
    ).toHaveCount(0);
  } finally {
    await resetStaffGrant(owner.context);
    await owner.context.close();
    await staff.context.close();
  }
});
