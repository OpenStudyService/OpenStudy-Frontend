import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
const password = process.env.LOCKERS_LIVE_PASSWORD;
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();
test.beforeAll(() => {
  if (!password)
    throw new Error(
      "Prepare isolated Backend per docs/testing/lockers-live.md",
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
      baseURL: "http://127.0.0.1:15190",
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
  const tag = suffix(),
    locker = await created(context, "/lockers?scope=1", {
      branchId: "1",
      lockerNo: `L-${tag}`,
      ratePer4WeeksKrw: 10000,
    });
  const customer = await created(context, "/customers?scope=all", {
    registeredBranchId: "1",
    name: `사물함 고객 ${tag}`,
    phone: `010${String(Date.now()).slice(-8)}`,
    email: "",
    memo: "",
  });
  return {
    locker,
    customer,
    body: {
      branchId: "1",
      lockerId: locker.id,
      customerId: customer.id,
      startDate: today(),
      endDate: plus(today(), 28),
      method: "카드",
    },
  };
}
test("actual assignment/extension keep rate snapshots and idempotency; staff return allows immediate reassignment without refund", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@lockers.test");
  try {
    const f = await fixture(owner.context),
      key = randomUUID(),
      a = await created(
        owner.context,
        "/locker-assignments?scope=1",
        f.body,
        key,
      );
    const replay = await created(
      owner.context,
      "/locker-assignments?scope=1",
      f.body,
      key,
    );
    expect(replay.id).toBe(a.id);
    expect(a.status).toBe("배정");
    expect(a.charges[0]).toMatchObject({
      terms: 1,
      amountKrw: 10000,
      ratePer4WeeksKrw: 10000,
    });
    const overlap = await api(
      owner.context,
      "/locker-assignments?scope=1",
      f.body,
    );
    expect(overlap.status()).toBe(409);
    const rate = await api(owner.context, "/branches/1/locker-rate", {
      ratePer4WeeksKrw: 20000,
    });
    expect(rate.status()).toBe(200);
    const body = {
        version: a.version,
        endDate: plus(a.endDate, 56),
        method: "카드",
      },
      extendKey = randomUUID();
    const response = await api(
      owner.context,
      `/locker-assignments/${a.id}/extend?scope=1`,
      body,
      "POST",
      extendKey,
    );
    expect(response.status()).toBe(200);
    const extended = await response.json();
    expect(extended.endDate).toBe(body.endDate);
    expect(extended.charges[0].amountKrw).toBe(10000);
    expect(extended.charges[1]).toMatchObject({
      terms: 2,
      amountKrw: 40000,
      ratePer4WeeksKrw: 20000,
    });
    const retried = await api(
      owner.context,
      `/locker-assignments/${a.id}/extend?scope=1`,
      body,
      "POST",
      extendKey,
    );
    expect((await retried.json()).charges).toHaveLength(2);
    const hidden = await (
      await api(staff.context, `/locker-assignments/${a.id}?scope=1`)
    ).json();
    expect(hidden.charges).toBeNull();
    const returned = await api(
      staff.context,
      `/locker-assignments/${a.id}/return?scope=1`,
      { version: extended.version, reason: "조기 반납" },
    );
    expect(returned.status()).toBe(200);
    expect((await returned.json()).status).toBe("반납");
    const saved = await (
      await api(owner.context, `/locker-assignments/${a.id}?scope=1`)
    ).json();
    expect(saved.returnedAt).toBeTruthy();
    expect(saved.charges).toHaveLength(2);
    expect(
      saved.charges.every((c: { status: string }) => c.status === "적용"),
    ).toBe(true);
    const replacement = await created(
      owner.context,
      "/locker-assignments?scope=1",
      f.body,
    );
    expect(replacement.id).not.toBe(a.id);
    const list = await (
      await api(
        owner.context,
        "/lockers?scope=1&assignmentState=" +
          encodeURIComponent("사용 중") +
          "&pageSize=100",
      )
    ).json();
    const occupancy = await (
      await api(owner.context, "/lockers/occupancy?scope=1")
    ).json();
    expect(occupancy.items[0].inUse).toBe(list.meta.total);
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
test("actual 28-day validation, payment failure, stopped locker and branch permissions are enforced", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@lockers.test"),
    other = await login(browser, "cashier@lockers.test");
  try {
    const f = await fixture(owner.context);
    expect(
      (
        await api(owner.context, "/locker-assignments?scope=1", {
          ...f.body,
          endDate: plus(today(), 29),
        })
      ).status(),
    ).toBe(422);
    const failed = await created(owner.context, "/locker-assignments?scope=1", {
      ...f.body,
      mockOutcome: "FAILED",
    });
    expect(failed.status).toBe("결제 실패");
    const a = await created(
      owner.context,
      "/locker-assignments?scope=1",
      f.body,
    );
    expect(a.status).toBe("배정");
    expect(
      (
        await api(staff.context, "/locker-assignments?scope=1", f.body)
      ).status(),
    ).toBe(403);
    expect(
      (await api(other.context, `/lockers/${f.locker.id}?scope=all`)).status(),
    ).toBe(404);
    const current = await (
      await api(owner.context, `/lockers/${f.locker.id}?scope=1`)
    ).json();
    const stopped = await api(
      owner.context,
      `/lockers/${f.locker.id}/status?scope=1`,
      { version: current.version, status: "운영 중단", reason: "정비" },
    );
    expect(stopped.status()).toBe(200);
    expect(
      (
        await api(owner.context, `/locker-assignments/${a.id}/extend?scope=1`, {
          version: a.version,
          endDate: plus(a.endDate, 28),
          method: "카드",
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await api(staff.context, `/locker-assignments/${a.id}/return?scope=1`, {
          version: a.version,
          reason: "중단 중 반납",
        })
      ).status(),
    ).toBe(200);
  } finally {
    await owner.context.close();
    await staff.context.close();
    await other.context.close();
  }
});
test("locker UI manages ledger, compares two-editor conflicts and applies branch pricing", async ({
  browser,
}) => {
  const owner = await login(browser),
    other = await login(browser, "owner@lockers.test", "editor");
  try {
    const no = `UI-${suffix()}`;
    await owner.page.goto("/app/1/spaces?tab=lockers&detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("사물함 번호", { exact: true }).fill(no);
    await panel.getByLabel("4주 요금 (원)", { exact: true }).fill("11000");
    const createdResponse = owner.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/lockers",
    );
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    const locker = await (await createdResponse).json();
    await expect(panel).toHaveCount(0);
    await owner.page.getByRole("button", { name: no, exact: true }).click();
    await panel.getByRole("button", { name: "수정하기", exact: true }).click();
    await panel.getByLabel("사물함 번호", { exact: true }).fill(`${no}-EDIT`);
    const response = await api(
      other.context,
      `/lockers/${locker.id}?scope=1`,
      { version: locker.version, ratePer4WeeksKrw: 15000 },
      "PATCH",
    );
    expect(response.status()).toBe(200);
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: /최신.*확인/ }),
    ).toBeVisible();
    await expect(panel.getByLabel("사물함 번호", { exact: true })).toHaveValue(
      `${no}-EDIT`,
    );
    await panel.getByRole("button", { name: /최신.*확인/ }).click();
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "수정하기", exact: true }),
    ).toBeVisible();
    const saved = await (
      await api(owner.context, `/lockers/${locker.id}?scope=1`)
    ).json();
    expect(saved.ratePer4WeeksKrw).toBe(15000);
    expect(saved.lockerNo).toBe(`${no}-EDIT`);
    await panel.getByRole("button", { name: "운영 중단", exact: true }).click();
    await panel.getByLabel("운영 변경 사유", { exact: true }).fill("정비");
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "운영 재개", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await owner.page
      .getByRole("button", { name: "지점 요금 일괄 적용", exact: true })
      .click();
    await panel.getByLabel("4주 요금 (원)", { exact: true }).fill("17000");
    await panel
      .getByRole("button", { name: "요금 일괄 적용", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    const bulk = await (
      await api(owner.context, `/lockers/${locker.id}?scope=1`)
    ).json();
    expect(bulk.ratePer4WeeksKrw).toBe(17000);
    await owner.page.reload();
    await expect(
      owner.page.getByRole("button", { name: `${no}-EDIT`, exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await other.context.close();
  }
});
test("UI assignment and extension preserve input and the same keys after committed responses are lost", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const f = await fixture(owner.context),
      keys: string[] = [],
      ids: string[] = [];
    await owner.page.goto(
      `/app/1/spaces?tab=lockers&detail=${f.locker.id}&assignment=new`,
    );
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByLabel("고객 검색 (이름·회원번호·연락처)")
      .fill(f.customer.name);
    await panel
      .getByRole("combobox", { name: "고객 선택", exact: true })
      .selectOption(f.customer.id);
    await panel.getByLabel("이용 기간 (4주 단위)", { exact: true }).fill("2");
    await owner.page.route("**/api/locker-assignments?*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const r = await route.fetch();
      expect(r.status()).toBe(201);
      ids.push((await r.json()).id);
      if (keys.length === 1) await route.abort("failed");
      else await route.fulfill({ response: r });
    });
    await panel
      .getByRole("button", { name: "Mock 결제 후 배정", exact: true })
      .click();
    await expect(panel.getByText(/연결하지 못했습니다/)).toBeVisible();
    await expect(
      panel.getByLabel("이용 기간 (4주 단위)", { exact: true }),
    ).toHaveValue("2");
    await panel
      .getByRole("button", { name: "Mock 결제 후 배정", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "완료", exact: true }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(ids[1]).toBe(ids[0]);
    await expect(panel.getByText(/20,000원.*적용/)).toBeVisible();
    await owner.page.unroute("**/api/locker-assignments?*");
    await owner.page.goto(
      `/app/1/spaces?tab=lockers&detail=${f.locker.id}&assignment=${ids[0]}`,
    );
    await panel.getByRole("button", { name: "유료 연장", exact: true }).click();
    await panel.getByLabel("연장 기간 (4주 단위)", { exact: true }).fill("1");
    const extendKeys: string[] = [];
    await owner.page.route(
      `**/api/locker-assignments/${ids[0]}/extend?*`,
      async (route) => {
        extendKeys.push(route.request().headers()["idempotency-key"]);
        const r = await route.fetch();
        expect(r.status()).toBe(200);
        if (extendKeys.length === 1) await route.abort("failed");
        else await route.fulfill({ response: r });
      },
    );
    await panel
      .getByRole("button", { name: "Mock 결제 후 연장", exact: true })
      .click();
    await expect(panel.getByText(/연결하지 못했습니다/)).toBeVisible();
    await panel
      .getByRole("button", { name: "Mock 결제 후 연장", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "완료", exact: true }),
    ).toBeVisible();
    expect(extendKeys).toHaveLength(2);
    expect(extendKeys[1]).toBe(extendKeys[0]);
    const current = await (
      await api(owner.context, `/locker-assignments/${ids[0]}?scope=1`)
    ).json();
    expect(current.charges).toHaveLength(2);
    expect(current.endDate).toBe(plus(today(), 84));
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.screenshot({
      path: "qa-artifacts/lockers-live/assignment-mobile.png",
      fullPage: true,
    });
  } finally {
    await owner.context.close();
  }
});
test("ordinary staff cannot manage or pay but returns early after the no-refund notice", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@lockers.test");
  try {
    const f = await fixture(owner.context),
      a = await created(owner.context, "/locker-assignments?scope=1", f.body);
    await staff.page.goto(
      `/app/1/spaces?tab=lockers&detail=${f.locker.id}&assignment=${a.id}`,
    );
    const panel = staff.page.getByRole("dialog");
    await expect(
      panel.getByRole("button", { name: "유료 연장", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("heading", { name: "서버 확정 결제 내역", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "반납 처리", exact: true }).click();
    await expect(panel.getByText(/조기 반납에 따른 환불은/)).toBeVisible();
    await panel
      .getByRole("button", { name: "환불 없이 반납 확정", exact: true })
      .click();
    await expect(panel.getByText(/반납 처리되었습니다/)).toBeVisible();
    await panel.getByRole("button", { name: "완료", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "반납 처리", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "유료 배정", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "수정하기", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      staff.page.getByRole("button", { name: "사물함 등록", exact: true }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("button", {
        name: "지점 요금 일괄 적용",
        exact: true,
      }),
    ).toHaveCount(0);
    const current = await (
      await api(owner.context, `/lockers/${f.locker.id}?scope=1`)
    ).json();
    expect(current.assignmentState).toBe("사용 가능");
    await staff.page.reload();
    await expect(
      staff.page.getByRole("button", { name: f.locker.lockerNo, exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
test("actual assignment period conflict keeps selected customer and dates for a fresh-state retry", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const f = await fixture(owner.context);
    await created(owner.context, "/locker-assignments?scope=1", f.body);
    await owner.page.goto(
      `/app/1/spaces?tab=lockers&detail=${f.locker.id}&assignment=new`,
    );
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByLabel("고객 검색 (이름·회원번호·연락처)")
      .fill(f.customer.name);
    await panel
      .getByRole("combobox", { name: "고객 선택", exact: true })
      .selectOption(f.customer.id);
    await panel
      .getByRole("button", { name: "Mock 결제 후 배정", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(
      panel.getByRole("combobox", { name: "고객 선택", exact: true }),
    ).toHaveValue(f.customer.id);
    await expect(panel.getByLabel("배정 시작일", { exact: true })).toHaveValue(
      today(),
    );
    await expect(
      panel.getByRole("button", { name: "배정 현황 다시 조회", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "배정 현황 다시 조회", exact: true })
      .click();
    await expect(
      panel.getByRole("region", { name: "최신 사물함 배정 현황", exact: true }),
    ).toContainText("배정");
  } finally {
    await owner.context.close();
  }
});
