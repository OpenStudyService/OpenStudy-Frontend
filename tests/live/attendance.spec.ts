/** Real Backend + disposable DB + Chrome. No successful API responses are mocked. */
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
const states = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();
async function login(browser: Browser, email = "staff@workforce.test") {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:15229",
    serviceWorkers: "block",
    storageState: states.get(email),
  });
  if (!states.has(email)) {
    const csrf = await (await context.request.get("/api/auth/csrf")).json();
    const r = await context.request.post("/api/auth/login", {
      data: { email, password: process.env.WORKFORCE_LIVE_PASSWORD },
      headers: { "X-CSRF-Token": csrf.token },
    });
    expect(r.status(), await r.text()).toBe(200);
    states.set(email, await context.storageState());
  }
  return { context, page: await context.newPage() };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  method = "POST",
  key?: string,
) {
  if (!body) return context.request.get(`/api${path}`);
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.fetch(`/api${path}`, {
    method,
    data: body,
    headers: {
      "X-CSRF-Token": csrf.token,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
  });
}
async function end(context: BrowserContext) {
  let r = await (await api(context, "/me/attendance/current")).json();
  if (r.attendance?.status === "휴게 중") {
    await api(context, "/me/attendance/break-end", {
      version: r.attendance.version,
    });
    r = await (await api(context, "/me/attendance/current")).json();
  }
  if (r.attendance)
    await api(context, "/me/attendance/clock-out", {
      version: r.attendance.version,
    });
}
test("real personal clock, break and out link the plan and agree across record, week and shift views", async ({
  browser,
}) => {
  const staff = await login(browser),
    manager = await login(browser, "manager@workforce.test");
  let shiftId = "";
  try {
    const now = Date.parse(
        (await (await api(staff.context, "/me/attendance/current")).json())
          .asOf,
      ),
      start = Math.floor((now - 3600000) / 60000) * 60000;
    const created = await api(
      manager.context,
      "/shifts",
      {
        branchId: "1",
        employeeId: "3",
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 5 * 3600000).toISOString(),
        plannedBreakMinutes: 30,
      },
      "POST",
      randomUUID(),
    );
    expect(created.status(), await created.text()).toBe(201);
    shiftId = (await created.json()).id;
    await staff.page.goto("/app/1/attendance");
    const card = staff.page.getByRole("region", { name: "본인 출퇴근" });
    const inside = staff.page.waitForResponse((r) =>
      r.url().endsWith("/api/me/attendance/clock-in"),
    );
    await card.getByRole("button", { name: "출근하기" }).click();
    const clocked = await (await inside).json();
    expect(clocked.shiftId).toBe(shiftId);
    expect(clocked.workedMinutes).toBeNull();
    await expect(card.getByText("근무 중", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "휴게 종료" })).toHaveCount(
      0,
    );
    // Changing the browsing scope never loses work recorded at another branch.
    await staff.page.getByLabel("현재 지점", { exact: true }).selectOption("2");
    await expect(card.getByRole("button", { name: "휴게 시작" })).toBeEnabled();
    await expect(card).toContainText("QA One");
    await card.getByRole("button", { name: "휴게 시작" }).click();
    await expect(card.getByText("휴게 중", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "퇴근하기" })).toHaveCount(0);
    await card.getByRole("button", { name: "휴게 종료" }).click();
    await expect(card.getByRole("button", { name: "퇴근하기" })).toBeEnabled();
    const outside = staff.page.waitForResponse((r) =>
      r.url().endsWith("/api/me/attendance/clock-out"),
    );
    await card.getByRole("button", { name: "퇴근하기" }).click();
    const left = await (await outside).json();
    await expect(card.getByText("퇴근", { exact: true })).toBeVisible();
    const detail = await (
        await api(staff.context, `/attendance-records/${left.id}`)
      ).json(),
      rows = await (
        await api(
          staff.context,
          "/attendance-records?scope=1&mine=true&pageSize=100",
        )
      ).json(),
      week = await (
        await api(
          staff.context,
          `/shifts/weekly?scope=1&weekOf=${left.workDate}`,
        )
      ).json(),
      shift = await (await api(staff.context, `/shifts/${shiftId}`)).json();
    expect([
      detail.workedMinutes,
      rows.items.find((r: { id: string }) => r.id === left.id).workedMinutes,
      week.attendance.find((r: { id: string }) => r.id === left.id)
        .workedMinutes,
      shift.attendance[0].workedMinutes,
    ]).toEqual(Array(4).fill(left.workedMinutes));
    await staff.page.goto(`/app/1/attendance?tab=attendance&detail=${left.id}`);
    const panel = staff.page.getByRole("dialog");
    await expect(
      panel.getByText(`실근무: ${left.workedMinutes}분`),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /출근|퇴근|휴게/ }),
    ).toHaveCount(0);
    await staff.page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(
      staff.page
        .getByRole("cell", { name: `${left.workedMinutes}분`, exact: true })
        .first(),
    ).toBeVisible();
  } finally {
    await end(staff.context);
    if (shiftId) {
      const row = await (
        await api(manager.context, `/shifts/${shiftId}`)
      ).json();
      await api(manager.context, `/shifts/${shiftId}/cancel`, {
        version: row.version,
      });
    }
    await staff.context.close();
    await manager.context.close();
  }
});
test("historical seconds fixture is calculated by the Backend as 498 minutes in list, detail and week", async ({
  browser,
}) => {
  const staff = await login(browser);
  try {
    await staff.page.goto(
      "/app/1/attendance?tab=attendance&from=2026-11-01&to=2026-11-01",
    );
    await expect(
      staff.page.getByRole("cell", { name: "498분", exact: true }),
    ).toBeVisible();
    await staff.page.getByRole("button", { name: "2026-11-01 09:00" }).click();
    await expect(
      staff.page.getByRole("dialog").getByText("실근무: 498분"),
    ).toBeVisible();
    const detail = await (
      await api(staff.context, "/attendance-records/9001")
    ).json();
    expect(detail.workedMinutes).toBe(498);
    expect(detail.breaks).toHaveLength(2);
    await staff.page.goto("/app/1/attendance?week=2026-11-01");
    await expect(staff.page.getByText(/실제 출퇴근.*QA One/)).toContainText(
      "실근무 498분",
    );
  } finally {
    await staff.context.close();
  }
});
test("a committed clock-in with a lost response recovers current and does not duplicate or resurrect after replay", async ({
  browser,
}) => {
  const staff = await login(browser);
  let key = "";
  try {
    const before = await (
      await api(
        staff.context,
        "/attendance-records?scope=all&mine=true&pageSize=100",
      )
    ).json();
    await staff.page.route("**/api/me/attendance/clock-in", async (route) => {
      key = route.request().headers()["idempotency-key"];
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await staff.page.goto("/app/1/attendance");
    const card = staff.page.getByRole("region", { name: "본인 출퇴근" });
    await card.getByRole("button", { name: "출근하기" }).click();
    await expect(card.getByRole("alert")).toBeVisible();
    await expect(card.getByRole("button", { name: "휴게 시작" })).toBeEnabled();
    await expect(card.getByRole("button", { name: "출근하기" })).toHaveCount(0);
    const after = await (
      await api(
        staff.context,
        "/attendance-records?scope=all&mine=true&pageSize=100",
      )
    ).json();
    expect(after.meta.total).toBe(before.meta.total + 1);
    await card.getByRole("button", { name: "퇴근하기" }).click();
    await expect(card.getByRole("button", { name: "출근하기" })).toBeEnabled();
    const replay = await api(
      staff.context,
      "/me/attendance/clock-in",
      { branchId: "1" },
      "POST",
      key,
    );
    expect(replay.status()).toBe(201);
    expect((await replay.json()).status).toBe("근무 중");
    expect(
      (await (await api(staff.context, "/me/attendance/current")).json())
        .attendance,
    ).toBeNull();
    await staff.page.getByRole("link", { name: "근무 관리", exact: true }).click();
    await expect(card.getByRole("button", { name: "휴게 시작" })).toHaveCount(
      0,
    );
  } finally {
    await end(staff.context);
    await staff.context.close();
  }
});
test("two real state commands cannot both start a break and the browser reloads the server state", async ({
  browser,
}) => {
  const staff = await login(browser);
  try {
    const r = await api(
      staff.context,
      "/me/attendance/clock-in",
      { branchId: "1" },
      "POST",
      randomUUID(),
    );
    expect(r.status()).toBe(201);
    const current = await r.json();
    await staff.page.goto("/app/1/attendance");
    await expect(
      staff.page.getByRole("button", { name: "휴게 시작" }),
    ).toBeEnabled();
    const responses = await Promise.all([
      api(staff.context, "/me/attendance/break-start", {
        version: current.version,
      }),
      api(staff.context, "/me/attendance/break-start", {
        version: current.version,
      }),
    ]);
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
    await staff.page
      .getByRole("link", { name: "근무 관리", exact: true })
      .click();
    await expect(
      staff.page.getByRole("button", { name: "휴게 종료" }),
    ).toBeEnabled();
    await expect(
      staff.page.getByRole("button", { name: "퇴근하기" }),
    ).toHaveCount(0);
  } finally {
    await end(staff.context);
    await staff.context.close();
  }
});
test("mixed manager roles and staff filters never reveal another employee outside the managed branch", async ({
  browser,
}) => {
  const other = await login(browser, "other@workforce.test"),
    manager = await login(browser, "manager@workforce.test"),
    staff = await login(browser);
  try {
    const b = await api(
      other.context,
      "/me/attendance/clock-in",
      { branchId: "2" },
      "POST",
      randomUUID(),
    );
    expect(b.status()).toBe(201);
    const hidden = await b.json();
    await end(other.context);
    const a = await api(
      other.context,
      "/me/attendance/clock-in",
      { branchId: "1" },
      "POST",
      randomUUID(),
    );
    expect(a.status()).toBe(201);
    await end(other.context);
    await manager.page.goto("/app/1/attendance?tab=attendance&employeeId=4");
    await expect(
      manager.page.getByRole("cell", { name: "QA Other", exact: true }),
    ).toBeVisible();
    await manager.page
      .getByLabel("현재 지점", { exact: true })
      .selectOption("2");
    await expect(
      manager.page.getByRole("cell", { name: "QA Other", exact: true }),
    ).toHaveCount(0);
    await expect(
      manager.page.getByLabel("근태 직원", { exact: true }),
    ).toHaveCount(0);
    expect(
      (await api(manager.context, `/attendance-records/${hidden.id}`)).status(),
    ).toBe(404);
    await staff.page.goto("/app/1/attendance?tab=attendance");
    await expect(
      staff.page.getByLabel("근태 직원", { exact: true }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("cell", { name: "QA Other", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await (
          await api(staff.context, "/attendance-records?scope=1&employeeId=4")
        ).json()
      ).items,
    ).toEqual([]);
    expect(
      (
        await api(staff.context, `/attendance-records/${(await a.json()).id}`)
      ).status(),
    ).toBe(404);
  } finally {
    await end(other.context);
    await other.context.close();
    await manager.context.close();
    await staff.context.close();
  }
});
test("stopped branch and revoked membership preserve ongoing break-end and clock-out cleanup", async ({
  browser,
}) => {
  const owner = await login(browser, "owner@workforce.test"),
    staff = await login(browser, "cleanup@workforce.test");
  try {
    const branch = await (await api(owner.context, "/branches/3")).json();
    const resumed = await api(owner.context, "/branches/3/status", {
      version: branch.version,
      status: "운영 중",
    });
    expect(resumed.status()).toBe(200);
    const clocked = await api(
      staff.context,
      "/me/attendance/clock-in",
      { branchId: "3" },
      "POST",
      randomUUID(),
    );
    expect(clocked.status()).toBe(201);
    const stopped = await api(owner.context, "/branches/3/status", {
      version: (await resumed.json()).version,
      status: "운영 중지",
    });
    expect(stopped.status()).toBe(200);
    await staff.page.goto("/app/1/attendance");
    await staff.page.getByRole("button", { name: "휴게 시작" }).click();
    await expect(
      staff.page.getByRole("button", { name: "휴게 종료" }),
    ).toBeEnabled();
    const employee = await (
        await api(owner.context, "/employees/5?scope=3")
      ).json(),
      membership = employee.memberships.find(
        (m: { branchId: string }) => m.branchId === "3",
      );
    const revoked = await api(
      owner.context,
      "/employees/5/memberships/3?scope=3",
      {
        employeeVersion: employee.version,
        version: membership.version,
        role: "staff",
        status: "회수",
        permissions: [],
      },
      "PUT",
    );
    expect(revoked.status(), await revoked.text()).toBe(200);
    await staff.page.reload();
    await staff.page.getByRole("button", { name: "휴게 종료" }).click();
    await expect(
      staff.page.getByRole("button", { name: "휴게 시작" }),
    ).toBeDisabled();
    await staff.page.getByRole("button", { name: "퇴근하기" }).click();
    await expect(
      staff.page.getByRole("button", { name: "출근하기" }),
    ).toBeEnabled();
    await expect(
      staff.page.getByRole("option", { name: "QA Stopped" }),
    ).toHaveCount(0);
    expect(
      (await (await api(staff.context, "/me/attendance/current")).json())
        .attendance,
    ).toBeNull();
  } finally {
    await end(staff.context);
    await owner.context.close();
    await staff.context.close();
  }
});
test("M12 real attendance correction refreshes minutes and records rejection and cancellation", async ({
  browser,
}) => {
  const staff = await login(browser);
  const manager = await login(browser, "manager@workforce.test");
  try {
    await staff.page.goto("/app/1/attendance?tab=attendance&detail=9001");
    const dialog = staff.page.getByRole("dialog");
    await dialog.getByLabel("변경 종료 시각 (서울)").fill("2026-11-01T17:30");
    await dialog.getByLabel("신청 사유").fill("실제 퇴근 시각 정정");
    const response = staff.page.waitForResponse((r) =>
      r.url().endsWith("/9001/corrections"),
    );
    await dialog.getByRole("button", { name: "신청하기" }).click();
    const created = await response;
    expect(created.status(), await created.text()).toBe(201);
    const correction = await created.json();
    await manager.page.goto("/app/1/attendance?tab=corrections");
    const card = manager.page
      .getByRole("article")
      .filter({ hasText: correction.id });
    await card.getByRole("button", { name: "승인", exact: true }).click();
    await expect(card).toContainText("승인 ·");
    await manager.page.getByRole("tab", { name: "출퇴근·휴게" }).click();
    await expect(
      manager.page.getByRole("row").filter({ hasText: "468분" }),
    ).toBeVisible();

    const path = "/attendance-records/9001/corrections";
    const body = {
      kind: "출퇴근",
      clockInAt: "2026-11-01T00:00:00Z",
      clockOutAt: "2026-11-01T08:00:00Z",
      reason: "추가 정정",
    };
    const key = randomUUID();
    const rejected = await api(staff.context, path, body, "POST", key);
    expect(rejected.status(), await rejected.text()).toBe(201);
    const row = await rejected.json();
    expect(
      (await (await api(staff.context, path, body, "POST", key)).json()).id,
    ).toBe(row.id);
    await manager.page.getByRole("tab", { name: "기록 정정" }).click();
    const rejectedCard = manager.page
      .getByRole("article")
      .filter({ hasText: `#${row.id} ·` });
    await rejectedCard
      .getByRole("button", { name: "반려", exact: true })
      .click();
    await rejectedCard.getByLabel("반려 사유").fill("확인 자료가 필요합니다.");
    await rejectedCard.getByRole("button", { name: "반려 확정" }).click();
    await expect(rejectedCard).toContainText(
      "반려 사유: 확인 자료가 필요합니다.",
    );
    const cancelled = await (
      await api(staff.context, path, body, "POST", randomUUID())
    ).json();
    const result = await api(
      staff.context,
      `/attendance-corrections/${cancelled.id}/cancel`,
      { version: cancelled.version },
    );
    expect(result.status(), await result.text()).toBe(200);
    expect((await result.json()).status).toBe("취소");
  } finally {
    await staff.context.close();
    await manager.context.close();
  }
});

test("M12 real swaps approve, restore, reject and cancel", async ({
  browser,
}) => {
  const staff = await login(browser);
  const manager = await login(browser, "manager@workforce.test");
  try {
    const startsAt = new Date(
      Math.ceil((Date.now() + 10 * 86400000) / 60000) * 60000,
    ).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
    const created = await api(
      manager.context,
      "/shifts",
      {
        branchId: "1",
        employeeId: "3",
        startsAt,
        endsAt,
        plannedBreakMinutes: 0,
      },
      "POST",
      randomUUID(),
    );
    expect(created.status(), await created.text()).toBe(201);
    const shift = await created.json();
    await staff.page.goto(`/app/1/attendance?tab=shifts&detail=${shift.id}`);
    const dialog = staff.page.getByRole("dialog");
    await dialog.getByLabel("대체 직원").selectOption("2");
    await dialog.getByLabel("신청 사유").fill("대체근무 요청");
    const response = staff.page.waitForResponse((r) =>
      r.url().endsWith(`/${shift.id}/swaps`),
    );
    await dialog.getByRole("button", { name: "신청하기" }).click();
    const swapResponse = await response;
    expect(swapResponse.status(), await swapResponse.text()).toBe(201);
    const swap = await swapResponse.json();
    await manager.page.goto("/app/1/attendance?tab=substitutions");
    const card = manager.page
      .getByRole("article")
      .filter({ hasText: `#${swap.id} ·` });
    await card.getByRole("button", { name: "승인", exact: true }).click();
    await expect(card).toContainText("승인 ·");
    expect(
      (await (await api(manager.context, `/shifts/${shift.id}`)).json())
        .employee.id,
    ).toBe("2");
    await card.getByRole("button", { name: "승인 취소", exact: true }).click();
    await expect(card).toContainText("취소 ·");
    expect(
      (await (await api(manager.context, `/shifts/${shift.id}`)).json())
        .employee.id,
    ).toBe("3");
    const body = {
      replacementEmployeeId: "2",
      proposedStartsAt: startsAt,
      proposedEndsAt: endsAt,
      reason: "대체근무 요청",
    };
    for (const action of ["reject", "cancel"]) {
      const request = await api(
        staff.context,
        `/shifts/${shift.id}/swaps`,
        body,
        "POST",
        randomUUID(),
      );
      expect(request.status(), await request.text()).toBe(201);
      const row = await request.json();
      const result = await api(
        action === "cancel" ? staff.context : manager.context,
        `/shift-swaps/${row.id}/${action}`,
        { version: row.version },
      );
      expect(result.status(), await result.text()).toBe(200);
    }
  } finally {
    await staff.context.close();
    await manager.context.close();
  }
});
test("M12 real leave grant, request, approval, restoration and refusal", async ({
  browser,
}) => {
  const staff = await login(browser);
  const manager = await login(browser, "manager@workforce.test");
  try {
    const future = new Date(Date.now() + 4 * 86400000);
    const day = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
    }).format(future);
    const year = day.slice(0, 4);
    await manager.page.goto("/app/1/attendance?tab=leaveGrants");
    await manager.page.getByLabel("부여 직원").selectOption("3");
    await manager.page.getByLabel("부여 연도").fill(year);
    await manager.page.getByLabel("유효 시작일").fill(`${year}-01-01`);
    await manager.page.getByLabel("유효 종료일").fill(`${year}-12-31`);
    await manager.page.getByLabel("부여 일수").fill("2");
    await manager.page.getByLabel("부여 사유").fill("M12 실제 연동 검증");
    const grantResponse = manager.page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/leave-grants") &&
        r.request().method() === "POST",
    );
    await manager.page.getByRole("button", { name: "휴가 부여하기" }).click();
    const grant = await grantResponse;
    expect(grant.status(), await grant.text()).toBe(201);

    await staff.page.goto("/app/1/attendance?tab=leaveRequests");
    await expect(
      staff.page.getByRole("tab", { name: "휴가 부여", exact: true }),
    ).toHaveCount(0);
    await staff.page.getByLabel("시작일", { exact: true }).fill(day);
    await staff.page.getByLabel("종료일", { exact: true }).fill(day);
    await staff.page.getByLabel("신청 일수").fill("0.3");
    await expect(staff.page.getByRole("alert")).toContainText("0.5일 단위");
    await staff.page.getByLabel("신청 일수").fill("1.5");
    await expect(staff.page.getByRole("alert")).toContainText("달력 일수(1일)");
    await staff.page.getByLabel("신청 일수").fill("0.5");
    await staff.page.getByLabel("사유", { exact: true }).fill("실제 반차 신청");
    const submitted = staff.page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/leave-requests") &&
        r.request().method() === "POST",
    );
    await staff.page.getByRole("button", { name: "휴가 신청 등록" }).click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(201);
    const request = await response.json();
    const staffCard = staff.page
      .getByRole("article")
      .filter({ hasText: `#${request.id} ·` });
    await expect(
      staffCard.getByRole("button", { name: "승인", exact: true }),
    ).toHaveCount(0);
    await manager.page.getByRole("tab", { name: "휴가 신청·승인" }).click();
    const balance = manager.page.getByRole("region", { name: "휴가 잔여량" });
    await balance.getByLabel("잔여량 조회 대상").selectOption("3");
    await balance.getByRole("button", { name: "부여·사용·복원 내역" }).click();
    const card = manager.page
      .getByRole("article")
      .filter({ hasText: `#${request.id} ·` });
    await card.getByRole("button", { name: "승인", exact: true }).click();
    await expect(balance).toContainText("QA Staff · 잔여 1.5일");
    await expect(balance).toContainText("사용 · -0.5일");
    await expect(balance).toContainText("내역 합계 1.5일");
    await card.getByRole("button", { name: "승인 취소", exact: true }).click();
    await expect(balance).toContainText("QA Staff · 잔여 2일");
    await expect(balance).toContainText("복원 · +0.5일");
    await expect(balance).toContainText("내역 합계 2일");

    const startsAt = new Date(`${day}T09:00:00+09:00`).toISOString();
    const endsAt = new Date(`${day}T10:00:00+09:00`).toISOString();
    const shift = await api(
      manager.context,
      "/shifts",
      {
        branchId: "1",
        employeeId: "3",
        startsAt,
        endsAt,
        plannedBreakMinutes: 0,
      },
      "POST",
      randomUUID(),
    );
    expect(shift.status(), await shift.text()).toBe(201);
    const shiftId = (await shift.json()).id;
    const body = {
      branchId: "1",
      startsOn: day,
      endsOn: day,
      requestedDays: 0.5,
      reason: "겹치는 근무 확인",
    };
    const make = async () => {
      const result = await api(
        staff.context,
        "/leave-requests",
        body,
        "POST",
        randomUUID(),
      );
      expect(result.status(), await result.text()).toBe(201);
      return result.json();
    };
    const conflicting = await make();
    await manager.page
      .getByRole("link", { name: "근무 관리", exact: true })
      .click();
    const conflictCard = manager.page
      .getByRole("article")
      .filter({ hasText: `#${conflicting.id} ·` });
    await conflictCard
      .getByRole("button", { name: "승인", exact: true })
      .click();
    await expect(conflictCard).toContainText(`근무 #${shiftId}`);
    await conflictCard
      .getByRole("button", { name: "반려", exact: true })
      .click();
    await expect(conflictCard).toContainText("반려 ·");
    const cancelled = await make();
    const result = await api(
      staff.context,
      `/leave-requests/${cancelled.id}/cancel`,
      { version: cancelled.version },
    );
    expect(result.status(), await result.text()).toBe(200);
    expect((await result.json()).status).toBe("취소");
  } finally {
    await staff.context.close();
    await manager.context.close();
  }
});
