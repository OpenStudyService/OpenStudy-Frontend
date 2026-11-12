import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
const password = process.env.ROOMS_LIVE_PASSWORD;
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();
test.beforeAll(() => {
  if (!password)
    throw new Error("Prepare isolated Backend per docs/testing/rooms-live.md");
});
async function login(
  browser: Browser,
  email = "owner@rooms.test",
  label = "primary",
) {
  const key = `${email}:${label}`,
    state = sessions.get(key),
    context = await browser.newContext({
      baseURL: "http://127.0.0.1:15188",
      serviceWorkers: "block",
      storageState: state,
    }),
    page = await context.newPage();
  if (!state) {
    await page.goto("/login");
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login$/);
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
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
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
function kstDate(iso: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(iso),
  );
}
function kstHour(iso: string) {
  return String(
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso)),
    ),
  );
}
function period(offset = 24) {
  const start = new Date((Math.floor(Date.now() / 3600000) + offset) * 3600000);
  return {
    startAt: start.toISOString(),
    endAt: new Date(+start + 7200000).toISOString(),
  };
}
async function fixture(context: BrowserContext) {
  const tag = suffix(),
    room = await created(context, "/rooms?scope=1", {
      branchId: "1",
      roomNo: `R-${tag}`,
      name: `룸 ${tag}`,
      capacity: 4,
      ratePerHourKrw: 8000,
    });
  const customer = await created(context, "/customers?scope=all", {
    registeredBranchId: "1",
    name: `룸 고객 ${tag}`,
    phone: `010${String(Date.now()).slice(-8)}`,
    email: "",
    memo: "",
  });
  return {
    room,
    customer,
    body: {
      branchId: "1",
      roomId: room.id,
      customerId: customer.id,
      ...period(),
      partySize: 2,
      method: "카드",
    },
  };
}
test("real reservation cancel/rebook, billing and list/calendar/detail remain consistent", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@rooms.test");
  try {
    const f = await fixture(owner.context),
      key = randomUUID(),
      booking = await created(
        owner.context,
        "/room-reservations?scope=1",
        f.body,
        key,
      );
    const replay = await created(
      owner.context,
      "/room-reservations?scope=1",
      f.body,
      key,
    );
    expect(replay.id).toBe(booking.id);
    expect(booking.billing).toMatchObject({
      ratePerHourKrw: 8000,
      hours: 2,
      amountKrw: 16000,
      paymentStatus: "승인",
    });
    const overlap = await api(
      owner.context,
      "/room-reservations?scope=1",
      f.body,
    );
    expect(overlap.status()).toBe(409);
    expect((await overlap.json()).code).toBe("ROOM_TIME_CONFLICT");
    const cancelKey = randomUUID(),
      cancelBody = { version: booking.version, reason: "시간 변경" };
    const response = await api(
      owner.context,
      `/room-reservations/${booking.id}/cancel?scope=1`,
      cancelBody,
      "POST",
      cancelKey,
    );
    expect(response.status()).toBe(200);
    const cancelled = await response.json();
    expect(cancelled.status).toBe("취소");
    expect(cancelled.billing.paymentStatus).toBe("환불");
    const cancelReplay = await api(
      owner.context,
      `/room-reservations/${booking.id}/cancel?scope=1`,
      cancelBody,
      "POST",
      cancelKey,
    );
    expect((await cancelReplay.json()).version).toBe(cancelled.version);
    const next = await created(
      owner.context,
      "/room-reservations?scope=1",
      f.body,
    );
    expect(next.id).not.toBe(booking.id);
    expect(next.billing.paymentId).not.toBe(booking.billing.paymentId);
    const startedResponse = await api(
      staff.context,
      `/room-reservations/${next.id}/start?scope=1`,
      { version: next.version },
    );
    expect(startedResponse.status()).toBe(200);
    const started = await startedResponse.json();
    expect(started.status).toBe("이용 중");
    expect(started.billing).toBeNull();
    const complete = await api(
      staff.context,
      `/room-reservations/${next.id}/complete?scope=1`,
      { version: started.version },
    );
    expect(complete.status()).toBe(200);
    expect((await complete.json()).status).toBe("완료");
    const list = await (
      await api(owner.context, `/room-reservations?scope=1&roomId=${f.room.id}`)
    ).json();
    const calendar = await (
      await api(
        owner.context,
        `/room-reservations/calendar?branchId=1&roomId=${f.room.id}&from=${encodeURIComponent(f.body.startAt)}&to=${encodeURIComponent(f.body.endAt)}`,
      )
    ).json();
    const detail = await (
      await api(owner.context, `/room-reservations/${next.id}?scope=1`)
    ).json();
    expect(
      list.items.find((r: { id: string }) => r.id === next.id).status,
    ).toBe(detail.status);
    expect(
      calendar.items.find((r: { id: string }) => r.id === next.id).status,
    ).toBe(detail.status);
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
test("real input errors, failed payment and permissions never create fake confirmed bookings", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@rooms.test"),
    other = await login(browser, "cashier@rooms.test");
  try {
    const f = await fixture(owner.context);
    const bad = await api(owner.context, "/room-reservations?scope=1", {
      ...f.body,
      startAt: new Date(Date.parse(f.body.startAt) + 60000).toISOString(),
    });
    expect(bad.status()).toBe(422);
    expect((await bad.json()).code).toBe("RESERVATION_TIME_INVALID");
    const failed = await created(owner.context, "/room-reservations?scope=1", {
      ...f.body,
      mockOutcome: "FAILED",
    });
    expect(failed.status).toBe("결제 실패");
    expect(failed.billing.paymentStatus).toBe("실패");
    const success = await created(
      owner.context,
      "/room-reservations?scope=1",
      f.body,
    );
    expect(success.status).toBe("확정");
    expect(
      (await api(staff.context, "/room-reservations?scope=1", f.body)).status(),
    ).toBe(403);
    expect(
      (
        await api(
          staff.context,
          `/room-reservations/${success.id}/cancel?scope=1`,
          { version: success.version, reason: "권한 없음" },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await api(other.context, `/room-reservations/${success.id}?scope=all`)
      ).status(),
    ).toBe(404);
  } finally {
    await owner.context.close();
    await staff.context.close();
    await other.context.close();
  }
});
test("room UI registers, preserves draft on two-session conflict, updates only changed fields and stops operation", async ({
  browser,
}) => {
  const owner = await login(browser),
    other = await login(browser, "owner@rooms.test", "second-editor");
  try {
    const tag = suffix(),
      name = `UI 룸 ${tag}`;
    await owner.page.goto("/app/1/spaces?tab=rooms&detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("룸 번호", { exact: true }).fill(`UI-${tag}`);
    await panel.getByLabel("룸 이름", { exact: true }).fill(name);
    await panel.getByLabel("정원", { exact: true }).fill("4");
    await panel.getByLabel("시간당 요금 (원)", { exact: true }).fill("9000");
    const creation = owner.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/rooms",
    );
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    const room = await (await creation).json();
    await expect(panel).toHaveCount(0);
    await owner.page
      .getByRole("button", { name: `${room.roomNo} · ${name}`, exact: true })
      .click();
    await panel.getByRole("button", { name: "수정하기", exact: true }).click();
    await panel.getByLabel("룸 이름", { exact: true }).fill(`${name} 수정`);
    const edited = await api(
      other.context,
      `/rooms/${room.id}?scope=1`,
      { version: room.version, ratePerHourKrw: 12000 },
      "PATCH",
    );
    expect(edited.status()).toBe(200);
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "최신 내용 확인", exact: true }),
    ).toBeVisible();
    await expect(panel.getByLabel("룸 이름", { exact: true })).toHaveValue(
      `${name} 수정`,
    );
    await panel
      .getByRole("button", { name: "최신 내용 확인", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "최신 기준으로 다시 저장", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "수정하기", exact: true }),
    ).toBeVisible();
    const saved = await (
      await api(owner.context, `/rooms/${room.id}?scope=1`)
    ).json();
    expect(saved.name).toBe(`${name} 수정`);
    expect(saved.ratePerHourKrw).toBe(12000);
    await panel.getByRole("button", { name: "운영 중단", exact: true }).click();
    await panel.getByLabel("운영 변경 사유").fill("시설 정비");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "운영 재개", exact: true }),
    ).toBeVisible();
    await owner.page.reload();
    await expect(
      owner.page.getByRole("dialog").getByText("운영 중단", { exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await other.context.close();
  }
});
test("reservation UI keeps create/cancel idempotency keys after real commits lose their responses and rebooks as a new record", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const f = await fixture(owner.context);
    await owner.page.goto("/app/1/reservations?detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByLabel("고객 검색 (이름·회원번호·연락처)")
      .fill(f.customer.name);
    await panel
      .getByRole("combobox", { name: "고객 선택", exact: true })
      .selectOption(f.customer.id);
    await panel
      .getByRole("combobox", { name: "예약 룸", exact: true })
      .selectOption(f.room.id);
    await panel
      .getByLabel("예약 날짜", { exact: true })
      .fill(kstDate(f.body.startAt));
    await panel
      .getByRole("combobox", { name: "시작 시각 (한국 시간)", exact: true })
      .selectOption(kstHour(f.body.startAt));
    await panel
      .getByRole("combobox", { name: "이용 시간", exact: true })
      .selectOption("2");
    const createKeys: string[] = [],
      createdIds: string[] = [];
    await owner.page.route("**/api/room-reservations?*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      createKeys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      createdIds.push((await response.json()).id);
      if (createKeys.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
    await expect(panel.getByText(/연결하지 못했습니다/)).toBeVisible();
    await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "예약 취소", exact: true }),
    ).toBeVisible();
    expect(createKeys).toHaveLength(2);
    expect(createKeys[0]).toBe(createKeys[1]);
    expect(createdIds[0]).toBe(createdIds[1]);
    await expect(panel.getByText(/16,000/)).toBeVisible();
    const id = createdIds[0],
      cancelKeys: string[] = [];
    await owner.page.route(
      `**/api/room-reservations/${id}/cancel?*`,
      async (route) => {
        cancelKeys.push(route.request().headers()["idempotency-key"]);
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (cancelKeys.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await panel.getByRole("button", { name: "예약 취소", exact: true }).click();
    await panel
      .getByLabel("취소 사유", { exact: true })
      .fill("새 예약으로 변경");
    await panel
      .getByRole("button", { name: "예약 취소·전액 환불", exact: true })
      .click();
    await expect(panel.getByText(/연결하지 못했습니다/)).toBeVisible();
    await expect(panel.getByLabel("취소 사유", { exact: true })).toHaveValue(
      "새 예약으로 변경",
    );
    await panel
      .getByRole("button", { name: "예약 취소·전액 환불", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "새 예약으로 재예약", exact: true }),
    ).toBeVisible();
    expect(cancelKeys).toHaveLength(2);
    expect(cancelKeys[0]).toBe(cancelKeys[1]);
    await owner.page.unroute("**/api/room-reservations?*");
    await panel
      .getByRole("button", { name: "새 예약으로 재예약", exact: true })
      .click();
    await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "예약 취소", exact: true }),
    ).toBeVisible();
    await owner.page.reload();
    await expect(
      owner.page
        .getByRole("dialog")
        .getByRole("button", { name: "예약 취소", exact: true }),
    ).toBeVisible();
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.screenshot({
      path: "qa-artifacts/rooms-live/reservation-mobile.png",
      fullPage: true,
    });
  } finally {
    await owner.context.close();
  }
});
test("ordinary staff has no booking/manage/cancel controls but can start and finish a real reservation", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@rooms.test");
  try {
    const f = await fixture(owner.context),
      booking = await created(
        owner.context,
        "/room-reservations?scope=1",
        f.body,
      );
    await staff.page.goto(`/app/1/reservations?detail=${booking.id}`);
    const panel = staff.page.getByRole("dialog");
    await expect(
      staff.page.getByRole("button", { name: "예약 등록", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "예약 취소", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByText(/16,000/)).toHaveCount(0);
    await panel.getByRole("button", { name: "이용 시작", exact: true }).click();
    await panel.getByRole("button", { name: "이용 시작", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "이용 완료", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "이용 완료", exact: true }).click();
    await panel.getByRole("button", { name: "이용 완료", exact: true }).click();
    await expect(
      panel.locator("dd").getByText("완료", { exact: true }),
    ).toBeVisible();
    await staff.page.reload();
    await expect(
      staff.page
        .getByRole("dialog")
        .locator("dd")
        .getByText("완료", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await staff.page.goto(`/app/1/spaces?tab=rooms&detail=${f.room.id}`);
    await expect(
      staff.page.getByRole("button", { name: "스터디룸 등록", exact: true }),
    ).toHaveCount(0);
    await expect(
      staff.page
        .getByRole("dialog")
        .getByRole("button", { name: "수정하기", exact: true }),
    ).toHaveCount(0);
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
test("real overlap preserves booking input and reloads the latest schedule", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const f = await fixture(owner.context);
    await created(owner.context, "/room-reservations?scope=1", f.body);
    await owner.page.goto("/app/1/reservations?detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByLabel("고객 검색 (이름·회원번호·연락처)")
      .fill(f.customer.name);
    await panel
      .getByRole("combobox", { name: "고객 선택", exact: true })
      .selectOption(f.customer.id);
    await panel
      .getByRole("combobox", { name: "예약 룸", exact: true })
      .selectOption(f.room.id);
    await panel
      .getByLabel("예약 날짜", { exact: true })
      .fill(kstDate(f.body.startAt));
    await panel
      .getByRole("combobox", { name: "시작 시각 (한국 시간)", exact: true })
      .selectOption(kstHour(f.body.startAt));
    await panel
      .getByRole("combobox", { name: "이용 시간", exact: true })
      .selectOption("2");
    await panel.getByRole("button", { name: "예약 등록", exact: true }).click();
    await expect(
      panel.getByText(/선택 시간이 다른 예약과 겹칩니다/),
    ).toBeVisible();
    await expect(
      panel.getByRole("combobox", { name: "예약 룸", exact: true }),
    ).toHaveValue(f.room.id);
    await expect(
      panel.getByRole("region", { name: "최신 예약 일정", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("region", { name: "최신 예약 일정", exact: true }),
    ).toContainText("확정");
  } finally {
    await owner.context.close();
  }
});

test("real closure warns about existing bookings and blocks new bookings", async ({
  browser,
}) => {
  const owner = await login(browser);
  const staff = await login(browser, "staff@rooms.test");
  try {
    const fixtureData = await fixture(owner.context);
    const bookingBody = { ...fixtureData.body, ...period(48) };
    const booking = await created(
      owner.context,
      "/room-reservations?scope=1",
      bookingBody,
    );
    const date = kstDate(bookingBody.startAt);
    const path = "/branches/1/closures";
    await owner.page.goto("/app/1/branches");
    await owner.page.getByRole("button", { name: /휴무일 관리:/ }).click();
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("휴무 날짜 (한국 시간)").fill(date);
    await panel.getByLabel("휴무 안내 문구").fill("실제 휴무 검증");
    await panel.getByRole("button", { name: "휴무일 등록" }).click();
    await expect(panel.getByText(/기존 예약 \d+건이 있어요/)).toBeVisible();
    await expect(
      panel.getByText(new RegExp(fixtureData.room.name + ".*확정")),
    ).toBeVisible();

    const { items } = await (
      await api(owner.context, path + "?from=" + date + "&to=" + date)
    ).json();
    const closure = items.find((row: { date: string }) => row.date === date);
    expect(closure).toMatchObject({ canEdit: true, canDelete: true });
    const duplicate = await api(owner.context, path, { date });
    expect(duplicate.status()).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: "BRANCH_CLOSURE_EXISTS",
      closureId: closure.id,
    });
    const blocked = await api(
      owner.context,
      "/room-reservations?scope=1",
      bookingBody,
    );
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: "BRANCH_CLOSED_DAY",
      closedDate: date,
    });
    expect(
      (await api(owner.context, "/room-reservations/" + booking.id)).status(),
    ).toBe(200);

    expect((await api(staff.context, "/branches/2/closures")).status()).toBe(
      403,
    );
    expect((await api(staff.context, path, { date })).status()).toBe(403);
    const staffList = await (await api(staff.context, path)).json();
    expect(staffList.items).toContainEqual(
      expect.objectContaining({
        id: closure.id,
        canEdit: false,
        canDelete: false,
      }),
    );
    await staff.page.goto("/app/1/branches");
    await expect(
      staff.page.getByRole("button", { name: /휴무일 관리:/ }),
    ).toHaveCount(0);

    await owner.page.goto("/app/1/reservations?detail=new");
    const reservation = owner.page.getByRole("dialog");
    await reservation.locator('input[type="date"]').fill(date);
    await expect(
      reservation.getByText("지점 휴무일에는 새 예약을 시작할 수 없어요."),
    ).toBeVisible();
    await expect(
      reservation.getByRole("combobox", { name: "시작 시각 (한국 시간)" }),
    ).toBeDisabled();

    await owner.page.goto("/app/1/branches");
    await owner.page.getByRole("button", { name: /휴무일 관리:/ }).click();
    owner.page.once("dialog", (dialog) => dialog.accept());
    const row = panel.getByRole("article").filter({
      has: owner.page.getByRole("heading", { name: date, exact: true }),
    });
    await row.getByRole("button", { name: "휴무일 삭제" }).click();
    await expect(row).toHaveCount(0);
  } finally {
    await Promise.all([owner.context.close(), staff.context.close()]);
  }
});

test("real product sale period and limit can be configured and cleared", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const { customer } = await fixture(owner.context);
    const tag = suffix();
    const category = await created(owner.context, "/product-categories", {
      code: "P" + tag.toUpperCase(),
      name: "검증 분류 " + tag,
      kind: "시간권",
    });
    const product = await created(owner.context, "/products?scope=all", {
      name: "판매 제한 검증 " + tag,
      priceKrw: 12000,
      terms: { kind: "시간권", includedMinutes: 60, validDays: null },
      status: "판매 중",
      categoryId: category.id,
      branchIds: ["1"],
    });
    const path = "/products/" + product.id;
    const payment = {
      customerId: customer.id,
      productId: product.id,
      branchId: "1",
      method: "카드",
    };
    const assertSaleError = async (detail: Record<string, unknown>) => {
      const response = await api(owner.context, "/payments", payment);
      expect(response.status(), await response.text()).toBe(409);
      expect(await response.json()).toMatchObject(detail);
    };

    const salesStartsAt = period().startAt.replace(".000Z", "Z");
    const salesEndsAt = period(48).startAt.replace(".000Z", "Z");
    const seoulInput = (instant: string) =>
      new Date(Date.parse(instant) + 9 * 3600000).toISOString().slice(0, 16);
    await owner.page.goto("/app/1/products");
    await owner.page
      .getByRole("table", { name: "상품 목록" })
      .getByRole("button", { name: product.name, exact: true })
      .click();
    const panel = owner.page.getByRole("dialog");
    const start = panel.getByLabel("판매 시작", { exact: true });
    const end = panel.getByLabel("판매 종료", { exact: true });
    const limit = panel.getByLabel("판매 한도 (개)");
    const save = panel.getByRole("button", { name: "상품 정보 저장" });
    async function saveAndRead() {
      const saved = owner.page.waitForResponse(
        (r) =>
          r.url().endsWith("/api" + path) && r.request().method() === "PATCH",
      );
      await save.click();
      const response = await saved;
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    }
    await start.fill(seoulInput(salesStartsAt));
    await end.fill(seoulInput(salesEndsAt));
    await limit.fill("1");
    expect(await saveAndRead()).toMatchObject({
      salesStartsAt,
      salesEndsAt,
      salesLimit: 1,
      remainingQuantity: 1,
    });
    await assertSaleError({
      code: "PRODUCT_NOT_IN_SALE_PERIOD",
      salesStartsAt,
      salesEndsAt,
    });

    await start.fill("");
    await end.fill("");
    expect(await saveAndRead()).toMatchObject({
      salesStartsAt: null,
      salesEndsAt: null,
      salesLimit: 1,
    });
    await created(owner.context, "/payments", payment);
    await assertSaleError({
      code: "PRODUCT_SALE_LIMIT_REACHED",
      salesLimit: 1,
      soldQuantity: 1,
    });

    await limit.fill("");
    const unlimited = await saveAndRead();
    expect(unlimited).toMatchObject({
      salesLimit: null,
      remainingQuantity: null,
    });
    await created(owner.context, "/payments", payment);
    const stopped = await api(
      owner.context,
      path + "/status",
      { version: unlimited.version, status: "판매 중지" },
      "POST",
    );
    expect(stopped.status(), await stopped.text()).toBe(200);
    await assertSaleError({ code: "PRODUCT_NOT_ON_SALE" });
  } finally {
    await owner.context.close();
  }
});
