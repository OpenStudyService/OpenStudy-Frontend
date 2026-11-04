/** Run only against the disposable workforce DB described in docs/testing/workforce-live.md. */
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(browser: Browser, email = "manager@workforce.test") {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:15229",
    serviceWorkers: "block",
  });
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  const response = await context.request.post("/api/auth/login", {
    data: { email, password: process.env.WORKFORCE_LIVE_PASSWORD },
    headers: { "X-CSRF-Token": csrf.token },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { context, page: await context.newPage() };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
) {
  if (!body) return context.request.get(`/api${path}`);
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.fetch(`/api${path}`, {
    method,
    data: body,
    headers: { "X-CSRF-Token": csrf.token, "Idempotency-Key": randomUUID() },
  });
}
const input = (
  day: string,
  start = "09:00",
  end = "18:00",
  branchId = "1",
  employeeId = "3",
) => ({
  branchId,
  employeeId,
  startsAt: `${day}T${start}:00+09:00`,
  endsAt: `${day}T${end}:00+09:00`,
  plannedBreakMinutes: 30,
});
test("stopped branch blocks new shifts and edits while an existing shift can still be cancelled", async ({
  browser,
}) => {
  const owner = await login(browser, "owner@workforce.test"),
    manager = await login(browser);
  try {
    const branch = await (await api(owner.context, "/branches/3")).json();
    const resumed = await api(owner.context, "/branches/3/status", {
      version: branch.version,
      status: "운영 중",
    });
    expect(resumed.status(), await resumed.text()).toBe(200);
    const created = await api(
        owner.context,
        "/shifts",
        input("2036-11-07", "09:00", "18:00", "3"),
      ),
      row = await created.json();
    expect(created.status(), JSON.stringify(row)).toBe(201);
    const stop = await api(owner.context, "/branches/3/status", {
      version: (await resumed.json()).version,
      status: "운영 중지",
    });
    expect(stop.status()).toBe(200);
    await manager.page.goto(`/app/3/attendance?detail=${row.id}`);
    await expect(
      manager.page.getByRole("button", { name: "근무 수정" }),
    ).toBeDisabled();
    const cancelled = manager.page.waitForResponse((r) =>
      r.url().endsWith(`/api/shifts/${row.id}/cancel`),
    );
    await manager.page.getByRole("button", { name: "근무 취소" }).click();
    expect((await cancelled).status()).toBe(200);
    await manager.page
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await manager.page.getByRole("button", { name: "근무 등록" }).click();
    await expect(
      manager.page.getByRole("button", { name: "등록하기" }),
    ).toBeDisabled();
  } finally {
    await owner.context.close();
    await manager.context.close();
  }
});
test("manager creates, edits and cancels a Sunday overnight shift in the correct week and list", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    await page.goto("/app/1/attendance?week=2036-11-02");
    await page.getByRole("button", { name: "근무 등록" }).click();
    await page.getByLabel("근무 직원").selectOption("3");
    await page.getByLabel("시작 (Asia/Seoul)").fill("2036-11-02T22:00");
    await page.getByLabel("종료 (Asia/Seoul)").fill("2036-11-03T06:00");
    await page.getByLabel("예정 휴게 (분)").fill("30");
    const created = page.waitForResponse(
      (r) =>
        r.url().includes("/api/shifts?") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "등록하기" }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const shift = await response.json();
    expect(shift.workDate).toBe("2036-11-02");
    await expect(page.getByText("실제 출퇴근 기록이 없습니다.")).toBeVisible();
    await page.getByLabel("종료 (Asia/Seoul)").fill("2036-11-03T07:00");
    const updated = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/shifts/${shift.id}`) &&
        r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "근무 수정" }).click();
    expect((await updated).status()).toBe(200);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    const cells = page
      .getByRole("rowheader", { name: "QA Staff" })
      .locator("..")
      .getByRole("cell");
    await expect(
      cells.nth(6).getByRole("button", { name: /예정 근무/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /예정 근무 ·/ })).toHaveCount(
      1,
    );
    await page.getByRole("button", { name: "목록 보기" }).click();
    await page.getByLabel("시작일", { exact: true }).fill("2036-11-02");
    await page.getByLabel("종료일", { exact: true }).fill("2036-11-02");
    await page.getByRole("button", { name: /2036.*22:00/ }).click();
    const cancelled = page.waitForResponse((r) =>
      r.url().endsWith(`/api/shifts/${shift.id}/cancel`),
    );
    await page.getByRole("button", { name: "근무 취소" }).click();
    expect((await cancelled).status()).toBe(200);
    await expect(page.getByRole("button", { name: "근무 수정" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("조건에 맞는 근무가 없어요.")).toBeVisible();
    await page.getByLabel("근무 상태", { exact: true }).selectOption("취소");
    await expect(
      page.getByRole("cell", { name: "취소", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test("real cross-branch conflicts remain redacted and preserve the entered times", async ({
  browser,
}) => {
  const owner = await login(browser, "owner@workforce.test"),
    manager = await login(browser);
  try {
    const hidden = await api(
      owner.context,
      "/shifts",
      input("2036-11-04", "09:00", "18:00", "2"),
    );
    expect(hidden.status(), await hidden.text()).toBe(201);
    await manager.page.goto("/app/1/attendance");
    await manager.page.getByRole("button", { name: "근무 등록" }).click();
    await manager.page.getByLabel("근무 직원").selectOption("3");
    await manager.page.getByLabel("시작 (Asia/Seoul)").fill("2036-11-04T10:00");
    await manager.page.getByLabel("종료 (Asia/Seoul)").fill("2036-11-04T17:00");
    const conflict = manager.page.waitForResponse(
      (r) =>
        r.url().includes("/api/shifts?") && r.request().method() === "POST",
    );
    await manager.page.getByRole("button", { name: "등록하기" }).click();
    const r = await conflict;
    expect(r.status()).toBe(409);
    const body = await r.json();
    expect(body.conflicts[0].shift).toBeNull();
    await expect(manager.page.getByRole("alert")).toContainText(
      "다른 지점 근무",
    );
    await expect(manager.page.getByRole("alert")).toContainText("10:00");
    await expect(manager.page.getByRole("alert")).toContainText("17:00");
    await expect(manager.page.getByRole("alert")).not.toContainText("QA Two");
    await expect(manager.page.getByLabel("시작 (Asia/Seoul)")).toHaveValue(
      "2036-11-04T10:00",
    );
  } finally {
    await owner.context.close();
    await manager.context.close();
  }
});
test("staff sees only their own schedule, no management or live attendance commands", async ({
  browser,
}) => {
  const manager = await login(browser),
    staff = await login(browser, "staff@workforce.test");
  try {
    expect(
      (await api(manager.context, "/shifts", input("2036-11-05"))).status(),
    ).toBe(201);
    expect(
      (
        await api(
          manager.context,
          "/shifts",
          input("2036-11-05", "09:00", "18:00", "1", "4"),
        )
      ).status(),
    ).toBe(201);
    const calls: string[] = [];
    staff.page.on("request", (r) => {
      if (r.url().includes("/api/")) calls.push(r.url());
    });
    await staff.page.goto("/app/1/attendance?week=2036-11-05");
    await expect(
      staff.page.getByRole("rowheader", { name: "QA Staff" }),
    ).toBeVisible();
    await expect(
      staff.page.getByRole("rowheader", { name: "QA Other" }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("button", { name: "근무 등록" }),
    ).toHaveCount(0);
    await staff.page.getByRole("button", { name: /예정 근무 ·/ }).click();
    await expect(
      staff.page.getByRole("heading", { name: "예정 근무 상세" }),
    ).toBeVisible();
    await expect(
      staff.page.getByRole("button", { name: "근무 수정" }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("button", { name: "근무 취소" }),
    ).toHaveCount(0);
    await staff.page.getByRole("button", { name: "닫기", exact: true }).click();
    await staff.page.getByRole("tab", { name: "출퇴근·휴게" }).click();
    await expect(
      staff.page.getByRole("button", {
        name: /출근하기|휴게 시작|휴게 종료|퇴근하기/,
      }),
    ).toHaveCount(0);
    expect(
      calls.filter((url) =>
        /\/attendance(?:[/?]|$)|\/me\/attendance|\/attendance-records/.test(
          url,
        ),
      ),
    ).toEqual([]);
    const rows = await (
      await api(staff.context, "/shifts?scope=1&from=2036-11-05&to=2036-11-05")
    ).json();
    expect(
      rows.items.every(
        (s: { employee: { id: string } }) => s.employee.id === "3",
      ),
    ).toBe(true);
  } finally {
    await manager.context.close();
    await staff.context.close();
  }
});
test("concurrent edit returns real version conflict and allows explicit refresh without losing inputs", async ({
  browser,
}) => {
  const { context, page } = await login(browser);
  try {
    const created = await api(context, "/shifts", input("2036-11-06")),
      row = await created.json();
    expect(created.status()).toBe(201);
    await page.goto(`/app/1/attendance?detail=${row.id}`);
    await expect(page.getByLabel("종료 (Asia/Seoul)")).toHaveValue(
      "2036-11-06T18:00",
    );
    const remote = await api(
      context,
      `/shifts/${row.id}`,
      { version: row.version, plannedBreakMinutes: 60 },
      "PATCH",
    );
    expect(remote.status()).toBe(200);
    await page.getByLabel("종료 (Asia/Seoul)").fill("2036-11-06T19:00");
    const conflict = page.waitForResponse(
      (r) => r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "근무 수정" }).click();
    expect((await conflict).status()).toBe(409);
    await page
      .getByRole("button", { name: "최신 버전 확인 (입력 유지)" })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("종료 (Asia/Seoul)")).toHaveValue(
      "2036-11-06T19:00",
    );
    const updated = page.waitForResponse(
      (r) => r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "근무 수정" }).click();
    expect((await updated).status()).toBe(200);
  } finally {
    await context.close();
  }
});
