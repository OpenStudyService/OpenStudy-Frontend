import { test, expect, type Page, type Route } from "@playwright/test";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const liveOrigin = "http://127.0.0.1:4173";
const mockOrigin = "http://127.0.0.1:4174";
const mockPaymentNotice = "Mock 결제·실제 금전 이동 없음";

// These are HTTP fixtures for built-browser behavior, not Backend/DB evidence.
const timestamp = "2026-11-01T00:00:00Z";
const branch = {
  id: "branch-1",
  branchId: "branch-1",
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  name: "빌드 검증 지점",
  address: "검증 주소",
  phone: "021234567",
  hours: "24시간",
  status: "운영 중",
};
const owner = {
  id: "build-owner",
  branchId: "all",
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  email: "owner@build.test",
  name: "빌드 검증 사용자",
  nickname: "빌드 검증 사용자",
  avatar: "",
  owner: true,
  status: "활성",
  memberships: [],
};
const pageOf = (items: unknown[]) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length },
});

async function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
async function authenticatedFixture(page: Page) {
  let paymentReads = 0;
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me")
      return json(route, {
        user: owner,
        branches: [branch],
        asOf: timestamp,
        snapshotVersion: "build-fixture",
        sessionMode: "WORKSPACE",
      });
    if (path === "/api/lookups")
      return json(route, { branches: [branch], employees: [owner] });
    if (path === "/api/workspace/events") return route.fulfill({ status: 204 });
    if (path === "/api/auth/csrf") return json(route, { token: "build-csrf" });
    if (path === "/api/customers")
      return json(
        route,
        pageOf([
          {
            id: "customer-1",
            memberNo: "BUILD001",
            name: "빌드 검증 고객",
            phone: "01012345678",
            status: "정상",
            registeredBranchId: branch.id,
            registeredAt: timestamp,
          },
        ]),
      );
    if (path === "/api/products")
      return json(
        route,
        pageOf([
          {
            id: "product-1",
            name: "빌드 검증 시간권",
            priceKrw: 9000,
            terms: { kind: "시간권", includedMinutes: 600, validDays: null },
            status: "판매 중",
            branchIds: [branch.id],
          },
        ]),
      );
    if (path === "/api/payments") {
      if (route.request().method() === "GET") paymentReads += 1;
      return json(
        route,
        { code: "BUILD_API_UNAVAILABLE", message: "결제 API 연결 시험 오류" },
        503,
      );
    }
    return json(
      route,
      { code: "BUILD_API_UNAVAILABLE", message: "보조 API 연결 시험 오류" },
      503,
    );
  });
  return { requests, paymentReads: () => paymentReads };
}

async function expectNoMockRuntime(page: Page, requests: string[]) {
  expect(
    requests.some(
      (url) =>
        url.includes("mockServiceWorker") ||
        /assets\/browser-/.test(url) ||
        new URL(url).pathname.startsWith("/api/_demo"),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.length),
    ),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(
        (key) => key.startsWith("openstudy-mock"),
      ),
    ),
  ).toEqual([]);
}

test("live build surfaces real API failures without activating MSW or demo login", async ({
  page,
}) => {
  const loaded: string[] = [];
  page.on("request", (request) => loaded.push(request.url()));
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "TEST_BACKEND_UNAVAILABLE",
        message: "실서버 연결 시험 오류",
      }),
    }),
  );
  await page.goto(`${liveOrigin}/login`);
  await expect(
    page.getByText("실서버 연결 시험 오류", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "사장님으로 체험" }),
  ).toHaveCount(0);
  await expect(page.getByText("실제 API 연결", { exact: true })).toBeVisible();
  await expectNoMockRuntime(page, loaded);
});

test("authenticated live list failures stay errors and lazy settings have no demo controls", async ({
  page,
}) => {
  const fixture = await authenticatedFixture(page);
  await page.goto(`${liveOrigin}/app/all/payments`);
  await expect(page.getByText("실제 API 연결", { exact: true })).toBeVisible();
  await expect(
    page.getByText("결제 API 연결 시험 오류", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "조건에 맞는 결제가 없어요" }),
  ).toHaveCount(0);
  await expect(page.getByText("결제 승인", { exact: true })).toHaveCount(0);
  const reads = fixture.paymentReads();
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect.poll(fixture.paymentReads).toBeGreaterThan(reads);
  await expect(
    page.getByText("결제 API 연결 시험 오류", { exact: true }),
  ).toBeVisible();
  await page.goto(`${liveOrigin}/app/all/settings`);
  await expect(
    page.getByRole("heading", { name: "설정", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "데모·검증 도구" }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "체험 계정" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "가상 데이터 초기화" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "세션 만료 재현" }),
  ).toHaveCount(0);
  await expectNoMockRuntime(page, fixture.requests);
});

test("live keeps the official Mock payment outcome but never replaces a failed API submission with success", async ({
  page,
}) => {
  const fixture = await authenticatedFixture(page);
  await page.goto(`${liveOrigin}/app/all/payments?detail=new`);
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByText(mockPaymentNotice, { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("combobox", { name: "판매 지점", exact: true })
    .selectOption(branch.id);
  await panel
    .getByRole("combobox", { name: "고객 선택", exact: true })
    .selectOption("customer-1");
  await panel
    .getByRole("combobox", { name: "판매 상품", exact: true })
    .selectOption("product-1");
  await panel
    .getByRole("combobox", { name: "Mock 결제 결과", exact: true })
    .selectOption("FAILED");
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  const submitted = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/payments" &&
      request.method() === "POST",
  );
  await panel
    .getByRole("button", { name: "Mock 결제 요청", exact: true })
    .click();
  expect((await submitted).postDataJSON()).toEqual({
    customerId: "customer-1",
    branchId: branch.id,
    productId: "product-1",
    method: "카드",
    mockOutcome: "FAILED",
  });
  await expect(panel.getByRole("alert")).toContainText(
    "결제 API 연결 시험 오류",
  );
  await expect(
    panel.getByRole("button", { name: "같은 결제 다시 시도" }),
  ).toBeVisible();
  await expect(panel.getByText("결제 승인", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("결제 실패", { exact: true })).toHaveCount(0);
  await expectNoMockRuntime(page, fixture.requests);
});
test("demo production build logs in through its bundled MSW worker", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${mockOrigin}/login`);
  await expect(page.getByText("데모 데이터", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await expect(page.getByText("데모 데이터", { exact: true })).toBeVisible();
  await page.goto(`${mockOrigin}/app/gangnam/chat/gangnam`);
  await expect(page.locator("article").first()).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toBeVisible();
  await page.goto(`${mockOrigin}/app/all/settings`);
  await expect(
    page.getByRole("heading", { name: "데모·검증 도구" }),
  ).toBeVisible();
  const reset = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/_demo" &&
      request.method() === "POST" &&
      request.postDataJSON().reset === true,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "가상 데이터 초기화", exact: true })
    .click();
  expect((await reset).postDataJSON()).toEqual({
    reset: true,
    scenario: "normal",
  });
  await expect(
    page.getByRole("button", { name: "가상 데이터 초기화", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("데모 데이터", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
  ).toContain("mockServiceWorker.js");
  expect(errors).toEqual([]);
});

test("live recovers from a same-origin worker left by an older demo build", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    json(
      route,
      { code: "BUILD_API_UNAVAILABLE", message: "현재 서버 응답" },
      503,
    ),
  );
  await page.goto(`${liveOrigin}/login`);
  await expect(page.getByText("현재 서버 응답", { exact: true })).toBeVisible();
  // Intentional negative fixture after artifact checks: exercise the real
  // browser worker lifecycle without shipping a worker in the live output.
  const workerPath = fileURLToPath(
    new URL("../../dist/mockServiceWorker.js", import.meta.url),
  );
  let created = false;
  try {
    await writeFile(
      workerPath,
      `
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname === "/api/me")
    event.respondWith(new Response(JSON.stringify({ code: "STALE_MOCK_WORKER", message: "과거 데모 워커 응답" }), { status: 503, headers: { "Content-Type": "application/json" } }));
});
`,
      { flag: "wx" },
    );
    created = true;
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/mockServiceWorker.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          ),
        );
    });
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    ).toContain("mockServiceWorker.js");
    await unlink(workerPath);
    created = false;
    await page.goto(`${liveOrigin}/login`);
    await expect(
      page.getByText("현재 서버 응답", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("과거 데모 워커 응답", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("실제 API 연결", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller),
    ).toBeNull();
    expect(
      await page.evaluate(() =>
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => registrations.length),
      ),
    ).toBe(0);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("openstudy:live-worker-recovery"),
      ),
    ).toBeNull();
  } finally {
    if (created) await unlink(workerPath);
    await page
      .evaluate(() =>
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations.map((registration) => registration.unregister()),
            ),
          ),
      )
      .catch(() => undefined);
  }
});
