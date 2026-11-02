import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

const password = process.env.SEAT_LIVE_PASSWORD;
test.beforeAll(() => {
  if (!password)
    throw new Error(
      "Prepare disposable Backend/DB and SEAT_LIVE_PASSWORD using docs/testing/seat-live.md.",
    );
});
async function login(browser: Browser, email = "owner@seat.test") {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:15182",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return { context, page };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
  key = randomUUID(),
) {
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.fetch(`/api${path}`, {
    method,
    headers: { "X-CSRF-Token": token, "Idempotency-Key": key },
    data: body,
  });
}
async function seat(context: BrowserContext, seatNo: string) {
  const response = await api(context, "/seats", {
    branchId: "1",
    zone: "검증 구역",
    seatNo,
    kind: "일반",
    status: "사용 가능",
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function customerPass(context: BrowserContext) {
  const suffix = randomUUID().slice(0, 8);
  const customerResponse = await api(context, "/customers", {
    registeredBranchId: "2",
    name: `타 지점 고객 ${suffix}`,
    phone: "01099887766",
  });
  expect(customerResponse.status()).toBe(201);
  const customer = await customerResponse.json();
  const category = await (
    await api(context, "/product-categories", {
      code: `S${suffix.toUpperCase()}`,
      name: `좌석 ${suffix}`,
      kind: "시간권",
    })
  ).json();
  const product = await (
    await api(context, "/products", {
      name: `좌석 상품 ${suffix}`,
      priceKrw: 10000,
      terms: { kind: "시간권", includedMinutes: 600, validDays: null },
      status: "판매 중",
      categoryId: category.id,
      branchIds: ["2"],
    })
  ).json();
  const paymentResponse = await api(context, "/payments", {
    customerId: customer.id,
    branchId: "2",
    productId: product.id,
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(paymentResponse.status()).toBe(201);
  return { customer, payment: await paymentResponse.json() };
}

test("real staff checks in an exact-match cross-branch customer, owner moves and staff checks out", async ({
  browser,
}) => {
  const owner = await login(browser);
  const staff = await login(browser, "staff@seat.test");
  try {
    const suffix = randomUUID().slice(0, 8);
    const first = await seat(owner.context, `A-${suffix}`);
    const second = await seat(owner.context, `B-${suffix}`);
    const { customer, payment } = await customerPass(owner.context);
    expect(
      (await api(staff.context, `/customers/${customer.id}?scope=1`)).status(),
    ).toBe(404);
    await staff.page.goto(`/app/1/spaces?tab=seats&detail=${first.id}`);
    const panel = staff.page.getByRole("dialog");
    await expect(
      panel.getByRole("button", { name: "좌석 수정", exact: true }),
    ).toHaveCount(0);
    await panel
      .getByRole("button", { name: "직원 예외 입실", exact: true })
      .click();
    await panel.getByLabel("정확한 회원번호").fill(customer.memberNo);
    await panel
      .getByRole("button", { name: "입실 고객 조회", exact: true })
      .click();
    await panel
      .getByRole("combobox", { name: "입실 고객", exact: true })
      .selectOption(customer.id);
    await panel
      .getByRole("combobox", { name: "사용 가능한 이용권", exact: true })
      .selectOption(payment.passId);
    const incoming = staff.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/seat-sessions",
    );
    await panel.getByRole("button", { name: "입실 확정", exact: true }).click();
    const response = await incoming;
    expect(response.status()).toBe(201);
    const session = await response.json();
    await staff.page.reload();
    await expect(
      panel.getByRole("button", { name: "퇴실 처리", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "좌석 이동", exact: true }),
    ).toHaveCount(0);
    await owner.page.goto(`/app/1/spaces?tab=seats&detail=${first.id}`);
    const adminPanel = owner.page.getByRole("dialog");
    await adminPanel
      .getByRole("button", { name: "좌석 이동", exact: true })
      .click();
    await adminPanel
      .getByRole("combobox", { name: "이동할 좌석", exact: true })
      .selectOption(second.id);
    await adminPanel
      .getByRole("button", { name: "좌석 이동 확정", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await api(owner.context, `/seat-sessions/${session.id}`)
            ).json()
          ).seat.id,
      )
      .toBe(second.id);
    await staff.page.goto(`/app/1/spaces?tab=seats&detail=${second.id}`);
    await panel.getByRole("button", { name: "퇴실 처리", exact: true }).click();
    await panel.getByRole("button", { name: "퇴실 확정", exact: true }).click();
    await expect(
      panel.getByText("퇴실을 완료했어요", { exact: true }),
    ).toBeVisible();
    const stored = await (
      await api(staff.context, `/seat-sessions/${session.id}`)
    ).json();
    expect(stored.status).toBe("종료");
    expect(stored.moves).toHaveLength(1);
    expect(stored.passRemainingMinutes).toBeNull();
    await staff.page.setViewportSize({ width: 390, height: 844 });
    await staff.page.screenshot({
      path: "qa-artifacts/seat-live/checkout-mobile.png",
      fullPage: true,
    });
  } finally {
    await Promise.all([owner.context.close(), staff.context.close()]);
  }
});

test("real create UI retries a committed lost response with the same key; board counts and state persist", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    const name = `R-${randomUUID().slice(0, 8)}`;
    await page.goto("/app/1/spaces?tab=seats&detail=new");
    const panel = page.getByRole("dialog");
    await panel.getByLabel("구역", { exact: true }).fill("재시도 구역");
    await panel.getByLabel("좌석 번호", { exact: true }).fill(name);
    const keys: string[] = [];
    await page.route("**/api/seats?*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (keys.length === 1) return route.abort("connectionreset");
      return route.fulfill({ response });
    });
    // The canonical endpoint has no scope query; intercept it as well.
    await page.route("**/api/seats", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (keys.length === 1) return route.abort("connectionreset");
      return route.fulfill({ response });
    });
    await panel
      .getByRole("button", { name: "좌석 등록 완료", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("좌석 번호", { exact: true })).toHaveValue(
      name,
    );
    await panel
      .getByRole("button", { name: "좌석 등록 완료", exact: true })
      .click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    const board = await (await api(context, "/seats/board?branchId=1")).json();
    const seats = board.zones.flatMap(
      (z: { seats: Array<{ id: string; seatNo: string }> }) => z.seats,
    );
    const created = seats.filter((s: { seatNo: string }) => s.seatNo === name);
    expect(created).toHaveLength(1);
    expect(board.counts.total).toBe(seats.length);
    await page.goto(`/app/1/spaces?tab=seats&detail=${created[0].id}`);
    await panel.getByRole("button", { name: "운영 중단", exact: true }).click();
    await panel.getByLabel("처리 사유 (필수)").fill("검증 중단");
    const changed = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/seats/${created[0].id}/status`,
    );
    await panel
      .getByRole("button", { name: "운영 상태 저장", exact: true })
      .click();
    expect((await changed).status()).toBe(200);
    await expect(
      panel.getByRole("button", { name: "운영 재개", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      panel.getByRole("button", { name: "운영 재개", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("real committed check-in, move and checkout responses can each be retried without duplicate effects", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    const suffix = randomUUID().slice(0, 8);
    const first = await seat(context, `L-${suffix}`);
    const second = await seat(context, `M-${suffix}`);
    const { customer, payment } = await customerPass(context);
    const keys = new Map<string, string[]>();
    await page.route("**/api/seat-sessions**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const path = new URL(route.request().url()).pathname;
      const seen = keys.get(path) || [];
      seen.push(route.request().headers()["idempotency-key"]);
      keys.set(path, seen);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (seen.length === 1) return route.abort("connectionreset");
      return route.fulfill({ response });
    });
    await page.goto(`/app/1/spaces?tab=seats&detail=${first.id}`);
    const panel = page.getByRole("dialog");
    await panel
      .getByRole("button", { name: "직원 예외 입실", exact: true })
      .click();
    await panel.getByLabel("정확한 회원번호").fill(customer.memberNo);
    await panel
      .getByRole("button", { name: "입실 고객 조회", exact: true })
      .click();
    await panel
      .getByRole("combobox", { name: "입실 고객", exact: true })
      .selectOption(customer.id);
    await panel
      .getByRole("combobox", { name: "사용 가능한 이용권", exact: true })
      .selectOption(payment.passId);
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel
        .getByRole("button", {
          name: attempt === 0 ? "입실 확정" : "같은 입실 요청 다시 시도",
          exact: true,
        })
        .click();
      if (attempt === 0) await expect(panel.getByRole("alert")).toBeVisible();
    }
    await expect(
      panel.getByRole("button", { name: "좌석 이동", exact: true }),
    ).toBeVisible();
    const storedSeat = await (await api(context, `/seats/${first.id}`)).json();
    const sessionId = storedSeat.activeSession.id;
    await panel.getByRole("button", { name: "좌석 이동", exact: true }).click();
    await panel
      .getByRole("combobox", { name: "이동할 좌석", exact: true })
      .selectOption(second.id);
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel
        .getByRole("button", {
          name: attempt === 0 ? "좌석 이동 확정" : "같은 이동 요청 다시 시도",
          exact: true,
        })
        .click();
      if (attempt === 0) await expect(panel.getByRole("alert")).toBeVisible();
    }
    await expect
      .poll(
        async () =>
          (await (await api(context, `/seat-sessions/${sessionId}`)).json())
            .seat.id,
      )
      .toBe(second.id);
    await page.goto(`/app/1/spaces?tab=seats&detail=${second.id}`);
    await panel.getByRole("button", { name: "퇴실 처리", exact: true }).click();
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel
        .getByRole("button", {
          name: attempt === 0 ? "퇴실 확정" : "같은 퇴실 요청 다시 시도",
          exact: true,
        })
        .click();
      if (attempt === 0) await expect(panel.getByRole("alert")).toBeVisible();
    }
    await expect(
      panel.getByText("퇴실을 완료했어요", { exact: true }),
    ).toBeVisible();
    expect(keys.size).toBe(3);
    for (const values of keys.values()) {
      expect(values).toHaveLength(2);
      expect(values[0]).toBe(values[1]);
    }
    const stored = await (
      await api(context, `/seat-sessions/${sessionId}`)
    ).json();
    expect(stored.status).toBe("종료");
    expect(stored.moves).toHaveLength(1);
    expect(stored.passRemainingMinutes).toBeNull();
  } finally {
    await context.close();
  }
});
