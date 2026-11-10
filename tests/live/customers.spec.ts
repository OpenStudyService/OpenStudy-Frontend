import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const ownerEmail = process.env.CUSTOMER_LIVE_OWNER_EMAIL;
const password = process.env.CUSTOMER_LIVE_PASSWORD;
const readerEmail = process.env.CUSTOMER_LIVE_READER_EMAIL;
const writerEmail = process.env.CUSTOMER_LIVE_WRITER_EMAIL;
const baseURL = process.env.CUSTOMER_LIVE_BASE_URL || "http://127.0.0.1:15179";
type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  memo: string | null;
  status: string;
  statusReason: string | null;
  version: number;
  memberNo: string;
  registeredBranchId: string;
};
test.beforeAll(() => {
  if (!ownerEmail || !password || !readerEmail || !writerEmail)
    throw new Error(
      "Use the disposable environment in docs/testing/customer-live.md and provide CUSTOMER_LIVE_* fixture environment variables.",
    );
});
async function login(browser: Browser, email = ownerEmail!) {
  const context = await browser.newContext({
    baseURL,
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
) {
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.fetch(`/api${path}`, {
    method,
    headers: { "X-CSRF-Token": token, "Idempotency-Key": randomUUID() },
    data: body,
  });
}
async function create(
  context: BrowserContext,
  name: string,
  branch = "1",
  phone = "01099992222",
): Promise<Customer> {
  const response = await api(context, "/customers?scope=all", {
    registeredBranchId: branch,
    name,
    phone,
    email: null,
    memo: null,
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function detail(page: Page, id: string, edit = false) {
  await page.goto(
    `/app/all/members?tab=members&detail=${id}${edit ? "&edit=1" : ""}`,
  );
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  return panel;
}
test("real API: owner registration, reload, edit and status persist without browser storage", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    await page.goto("/app/all/members?tab=members");
    await page.getByRole("button", { name: "회원 등록", exact: true }).click();
    const panel = page.getByRole("dialog");
    const name = `등록 ${randomUUID().slice(0, 8)}`;
    await expect(panel.getByLabel("등록 지점")).toHaveValue("");
    await panel.getByLabel("등록 지점").selectOption("1");
    await panel.getByLabel("회원 이름").fill(name);
    await panel.getByLabel("연락처", { exact: true }).fill("010-9999-2222");
    await panel
      .getByLabel("이메일", { exact: true })
      .fill("registration@customer.test");
    await panel.getByLabel("응대 메모").fill("실서버 응대 메모");
    const registered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/customers",
    );
    await panel.getByRole("button", { name: "회원 등록", exact: true }).click();
    const response = await registered;
    expect(response.status()).toBe(201);
    const customer = (await response.json()) as Customer;
    await expect(panel).not.toBeVisible();
    await page.reload();
    const shown = await detail(page, customer.id);
    await expect(
      shown.getByText(customer.memberNo, { exact: true }),
    ).toBeVisible();
    await expect(
      shown.getByText("실서버 응대 메모", { exact: true }),
    ).toBeVisible();
    await shown.getByRole("button", { name: "수정하기" }).click();
    await shown.getByLabel("응대 메모").fill("수정된 실서버 메모");
    await shown.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      shown.getByText("수정된 실서버 메모", { exact: true }),
    ).toBeVisible();
    await shown.getByRole("button", { name: "상태 변경", exact: true }).click();
    await shown.getByLabel("상태", { exact: true }).selectOption("이용 제한");
    await shown.getByLabel("변경 사유").fill("실서버 상태 변경 검증");
    await shown.getByRole("button", { name: "상태 저장", exact: true }).click();
    await expect(shown.getByRole("button", { name: "수정하기" })).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole("dialog")
        .getByText("실서버 상태 변경 검증", { exact: true }),
    ).toBeVisible();
    const saved = (await (
      await api(context, `/customers/${customer.id}?scope=all`)
    ).json()) as Customer;
    expect(saved.status).toBe("이용 제한");
    expect(saved.memo).toBe("수정된 실서버 메모");
    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(stored).not.toContain(name);
    expect(stored).not.toContain("registration@customer.test");
    expect(stored).not.toContain("수정된 실서버 메모");
  } finally {
    await context.close();
  }
});
test("real API: two user sessions preserve the draft and another writer's fields after 409", async ({
  browser,
}) => {
  const first = await login(browser);
  const second = await login(browser, writerEmail!);
  try {
    const customer = await create(
      first.context,
      `충돌 ${randomUUID().slice(0, 8)}`,
    );
    const firstPanel = await detail(first.page, customer.id, true);
    await firstPanel.getByLabel("회원 이름").fill("충돌 후 내 이름");
    const secondPanel = await detail(second.page, customer.id, true);
    await secondPanel.getByLabel("응대 메모").fill("다른 직원이 저장한 메모");
    await secondPanel
      .getByRole("button", { name: "저장하기", exact: true })
      .click();
    await expect(
      secondPanel.getByText("다른 직원이 저장한 메모", { exact: true }),
    ).toBeVisible();
    const rejected = first.page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/customers/${customer.id}`,
    );
    await firstPanel
      .getByRole("button", { name: "저장하기", exact: true })
      .click();
    expect((await rejected).status()).toBe(409);
    await expect(firstPanel.getByLabel("회원 이름")).toHaveValue(
      "충돌 후 내 이름",
    );
    await firstPanel.getByRole("button", { name: "최신 내용 확인" }).click();
    await expect(
      firstPanel.getByRole("heading", { name: /최신 회원 · 버전/ }),
    ).toBeVisible();
    const resent = first.page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === `/api/customers/${customer.id}`,
    );
    await firstPanel
      .getByRole("button", { name: "최신 기준으로 다시 저장" })
      .click();
    const payload = (await resent).postDataJSON();
    expect(Object.keys(payload).sort()).toEqual(["name", "version"]);
    await expect(
      firstPanel.getByRole("button", { name: "수정하기" }),
    ).toBeVisible();
    const saved = (await (
      await api(first.context, `/customers/${customer.id}?scope=all`)
    ).json()) as Customer;
    expect(saved.name).toBe("충돌 후 내 이름");
    expect(saved.memo).toBe("다른 직원이 저장한 메모");
  } finally {
    await first.context.close();
    await second.context.close();
  }
});
test("real API: reader cannot change customers and another branch's customer stays hidden", async ({
  browser,
}) => {
  const owner = await login(browser);
  const reader = await login(browser, readerEmail!);
  try {
    const home = await create(
      owner.context,
      `범위 안 ${randomUUID().slice(0, 8)}`,
    );
    const away = await create(
      owner.context,
      `범위 밖 ${randomUUID().slice(0, 8)}`,
      "2",
    );
    const panel = await detail(reader.page, home.id, true);
    await expect(
      reader.page.getByRole("button", { name: "회원 등록", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByLabel("회원 이름")).toHaveCount(0);
    expect(
      (
        await api(
          reader.context,
          `/customers/${home.id}?scope=all`,
          { version: home.version, name: "거절된 이름" },
          "PATCH",
        )
      ).status(),
    ).toBe(403);
    expect(
      (await api(reader.context, `/customers/${away.id}?scope=all`)).status(),
    ).toBe(404);
    const listing = await (
      await api(
        reader.context,
        `/customers?scope=all&q=${encodeURIComponent(away.name)}`,
      )
    ).json();
    expect(listing.meta.total).toBe(0);
    await detail(reader.page, away.id);
    await expect(
      reader.page.getByRole("dialog").getByText(away.name, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await owner.context.close();
    await reader.context.close();
  }
});
test("real API: server 422 field error keeps input and a corrected retry succeeds", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    const customer = await create(context, `검증 ${randomUUID().slice(0, 8)}`);
    const panel = await detail(page, customer.id, true);
    await panel.getByLabel("연락처", { exact: true }).fill("01099993333");
    await page.evaluate((id) => {
      const original = window.fetch.bind(window);
      let changed = false;
      window.fetch = (input, init) => {
        if (
          !changed &&
          init?.method === "PATCH" &&
          String(input).includes(`/customers/${id}`)
        ) {
          changed = true;
          const body = JSON.parse(String(init.body));
          return original(input, {
            ...init,
            body: JSON.stringify({ ...body, phone: "12" }),
          });
        }
        return original(input, init);
      };
    }, customer.id);
    const rejected = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/customers/${customer.id}`,
    );
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    expect((await rejected).status()).toBe(422);
    await expect(panel.getByLabel("연락처", { exact: true })).toHaveValue(
      "01099993333",
    );
    await expect(panel.getByText(/숫자 9~11자리/)).toBeVisible();
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel.getByRole("button", { name: "수정하기" })).toBeVisible();
    const saved = (await (
      await api(context, `/customers/${customer.id}?scope=all`)
    ).json()) as Customer;
    expect(saved.phone).toBe("01099993333");
  } finally {
    await context.close();
  }
});

test("real duplicate comparison, OWNER merge and use of an absorbed pass", async ({
  browser,
}) => {
  const owner = await login(browser);
  const reader = await login(browser, readerEmail!);
  try {
    const tag = randomUUID().slice(0, 8);
    const phone = "010" + String(Date.now()).slice(-8);
    const target = await create(owner.context, "대상 " + tag, "1", phone);
    const absorbed = await create(owner.context, "흡수 " + tag, "1", phone);
    const mergePath = `/customers/${target.id}/merge`;
    const body = {
      version: target.version,
      absorbedCustomerId: absorbed.id,
      absorbedVersion: absorbed.version,
      reason: "합성 중복 기록",
    };

    await reader.page.goto("/app/1/members?tab=members");
    await expect(
      reader.page.getByRole("heading", { name: "회원 관리" }),
    ).toBeVisible();
    await expect(
      reader.page.getByRole("button", { name: "중복 고객 확인" }),
    ).toHaveCount(0);
    expect((await api(reader.context, "/customer-duplicates")).status()).toBe(
      403,
    );
    expect((await api(reader.context, mergePath, body)).status()).toBe(403);
    const self = await api(owner.context, mergePath, {
      ...body,
      absorbedCustomerId: target.id,
    });
    expect(self.status()).toBe(422);
    expect(await self.json()).toMatchObject({ code: "CUSTOMER_MERGE_SELF" });

    async function created(path: string, input: object) {
      const response = await api(owner.context, path, input);
      expect(response.status(), await response.text()).toBe(201);
      return response.json();
    }
    const category = await created("/product-categories", {
      code: "M" + tag.toUpperCase(),
      name: "병합 분류 " + tag,
      kind: "시간권",
    });
    const product = await created("/products", {
      categoryId: category.id,
      branchIds: ["1"],
      name: "병합 이용권 " + tag,
      status: "판매 중",
      priceKrw: 10000,
      terms: { kind: "시간권", includedMinutes: 60, validDays: null },
    });
    const paymentBody = {
      branchId: "1",
      productId: product.id,
      method: "카드",
    };
    await created("/payments", { ...paymentBody, customerId: target.id });
    const payment = await created("/payments", {
      ...paymentBody,
      customerId: absorbed.id,
    });

    await owner.page.goto("/app/all/members?tab=members");
    await owner.page.getByRole("button", { name: "중복 고객 확인" }).click();
    const panel = owner.page.getByRole("dialog");
    await panel.getByRole("button", { name: "고객 비교: " + phone }).click();
    await expect(panel.getByRole("note")).toContainText(
      "병합은 되돌릴 수 없어요",
    );
    await panel
      .getByRole("combobox", { name: "남는 고객", exact: true })
      .selectOption(target.id);
    await panel
      .getByRole("combobox", { name: "흡수할 고객", exact: true })
      .selectOption(absorbed.id);
    await expect(
      panel.getByRole("heading", { name: "결제 이력 · 총 1건" }),
    ).toHaveCount(2);
    await expect(
      panel.getByRole("heading", { name: "이용권 이력" }),
    ).toHaveCount(2);
    const reason = panel.getByLabel("병합 사유");
    await reason.fill(body.reason);
    const submit = panel.getByRole("button", {
      name: "고객 병합",
      exact: true,
    });
    await expect(submit).toBeEnabled();

    const modified = await api(
      owner.context,
      `/customers/${absorbed.id}`,
      { version: absorbed.version, memo: "병합 직전 다른 세션 변경" },
      "PATCH",
    );
    expect(modified.status(), await modified.text()).toBe(200);
    const failed = owner.page.waitForResponse(
      (r) =>
        r.url().endsWith("/api" + mergePath) && r.request().method() === "POST",
    );
    await submit.click();
    const conflict = await failed;
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(reason).toHaveValue(body.reason);
    await expect(
      panel.getByRole("combobox", { name: "남는 고객", exact: true }),
    ).toHaveValue(target.id);
    await expect(
      panel.getByRole("combobox", { name: "흡수할 고객", exact: true }),
    ).toHaveValue(absorbed.id);
    await panel
      .getByRole("button", { name: "최신 고객 정보와 이력 다시 확인" })
      .click();

    const successful = owner.page.waitForResponse(
      (r) =>
        r.url().endsWith("/api" + mergePath) && r.request().method() === "POST",
    );
    await submit.click();
    const merged = await successful;
    expect(merged.status(), await merged.text()).toBe(200);
    expect(await merged.json()).toMatchObject({
      id: target.id,
      absorbedCustomerCount: 1,
    });
    await expect(
      owner.page.getByRole("dialog").getByText("흡수된 고객 1명"),
    ).toBeVisible();

    await reader.page.goto(`/app/1/members?tab=members&detail=${absorbed.id}`);
    const record = reader.page.getByRole("dialog");
    await expect(record.getByText("병합됨", { exact: true })).toBeVisible();
    await expect(record.getByRole("button", { name: "수정하기" })).toHaveCount(
      0,
    );
    await record.getByRole("button", { name: "병합 이력 보기" }).click();
    await expect(record.getByText(body.reason, { exact: true })).toBeVisible();
    await record
      .getByRole("link", {
        name: `${target.name} (${target.memberNo})`,
        exact: true,
      })
      .first()
      .click();
    await expect(reader.page).toHaveURL(
      new RegExp("detail=" + target.id + "$"),
    );

    const stale = await api(owner.context, mergePath, body);
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "CUSTOMER_ALREADY_MERGED",
      mergedIntoCustomerId: target.id,
    });
    async function rejectedMerged(path: string, input: object) {
      const response = await api(owner.context, path, input);
      expect(response.status(), await response.text()).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "CUSTOMER_NOT_ACTIVE",
        mergedIntoCustomerId: target.id,
      });
    }
    await rejectedMerged("/payments", {
      ...paymentBody,
      customerId: absorbed.id,
    });
    const room = await created("/rooms?scope=1", {
      branchId: "1",
      roomNo: "M-" + tag,
      name: "병합 검증 룸",
      capacity: 4,
      ratePerHourKrw: 10000,
    });
    const start = (Math.floor(Date.now() / 3600000) + 72) * 3600000;
    await rejectedMerged("/room-reservations?scope=1", {
      branchId: "1",
      roomId: room.id,
      customerId: absorbed.id,
      partySize: 1,
      method: "카드",
      startAt: new Date(start).toISOString(),
      endAt: new Date(start + 3600000).toISOString(),
    });
    const locker = await created("/lockers?scope=1", {
      branchId: "1",
      lockerNo: "M-" + tag,
      ratePer4WeeksKrw: 10000,
    });
    const day = (timestamp: number) =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
        timestamp,
      );
    const now = Date.now();
    await rejectedMerged("/locker-assignments?scope=1", {
      branchId: "1",
      lockerId: locker.id,
      customerId: absorbed.id,
      method: "카드",
      startDate: day(now),
      endDate: day(now + 28 * 86400000),
    });

    const seat = await created("/seats", {
      branchId: "1",
      zone: "병합 검증",
      seatNo: "M-" + tag,
      kind: "일반",
      status: "사용 가능",
    });
    await rejectedMerged("/seat-sessions", {
      seatId: seat.id,
      customerId: absorbed.id,
      passId: payment.passId,
    });
    await owner.page.goto(`/app/1/spaces?tab=seats&detail=${seat.id}`);
    const checkIn = owner.page.getByRole("dialog");
    await checkIn.getByRole("button", { name: "직원 예외 입실" }).click();
    await checkIn.getByLabel("정확한 회원번호").fill(absorbed.memberNo);
    await checkIn.getByRole("button", { name: "입실 고객 조회" }).click();
    await checkIn
      .getByRole("combobox", { name: "입실 고객", exact: true })
      .selectOption(target.id);
    await checkIn
      .getByRole("combobox", { name: "사용 가능한 이용권" })
      .selectOption(payment.passId);
    const checkedIn = owner.page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/seat-sessions" &&
        r.request().method() === "POST",
    );
    await checkIn.getByRole("button", { name: "입실 확정" }).click();
    const session = await checkedIn;
    expect(session.status(), await session.text()).toBe(201);
    expect(await session.json()).toMatchObject({
      customer: { id: target.id },
      pass: { id: payment.passId },
    });
  } finally {
    await Promise.all([owner.context.close(), reader.context.close()]);
  }
});
