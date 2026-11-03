import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
const password = process.env.COLLABORATION_LIVE_PASSWORD;
test.beforeAll(() => {
  if (!password)
    throw new Error(
      "Prepare isolated Backend per docs/testing/collaboration-live.md",
    );
});
async function login(browser: Browser, email = "owner@collaboration.test") {
  const context = await browser.newContext({
      baseURL: "http://127.0.0.1:15186",
      serviceWorkers: "block",
    }),
    page = await context.newPage();
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
    data: body,
    headers: { "X-CSRF-Token": token, "Idempotency-Key": key },
  });
}
async function created(context: BrowserContext, path: string, body: object) {
  const r = await api(context, path, body);
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}
const suffix = () => randomUUID().slice(0, 8);
test("revoking a writer permission cancels an open draft and hides facility creation", async ({
  browser,
}) => {
  const owner = await login(browser);
  async function permissions(codes: string[]) {
    const current = await (
        await api(owner.context, "/employees/2?scope=1")
      ).json(),
      membership = current.memberships.find(
        (m: { branchId: string }) => m.branchId === "1",
      );
    const response = await api(
      owner.context,
      "/employees/2/memberships/1?scope=1",
      {
        employeeVersion: current.version,
        version: membership.version,
        role: "staff",
        status: "활성",
        permissions: codes,
      },
      "PUT",
    );
    expect(response.status(), await response.text()).toBe(200);
  }
  let staff: Awaited<ReturnType<typeof login>> | undefined;
  try {
    await permissions(["facilities:write"]);
    staff = await login(browser, "staff@collaboration.test");
    await staff.page.goto("/app/1/facilities?detail=new");
    const panel = staff.page.getByRole("dialog");
    await panel.getByLabel("시설명", { exact: true }).fill("권한 회수 중 초안");
    const types = await (await api(owner.context, "/facility-types")).json();
    await panel
      .getByRole("combobox", { name: "시설 유형", exact: true })
      .selectOption(types.items[0].id);
    await permissions([]);
    await Promise.race([
      panel.getByRole("button", { name: "저장하기", exact: true }).click(),
      expect(
        panel.getByRole("heading", { name: "등록 권한이 없어요", exact: true }),
      ).toBeVisible(),
    ]);
    await expect(panel.getByLabel("시설명", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      staff.page.getByRole("button", { name: "시설 점검 등록", exact: true }),
    ).toHaveCount(0);
    const denied = await api(staff.context, "/facilities?scope=1", {
      branchId: "1",
      typeId: "1",
      name: "권한 회수 후 거부",
    });
    expect(denied.status()).toBe(403);
  } finally {
    await permissions([]);
    await staff?.context.close();
    await owner.context.close();
  }
});
test("staff uses exact canonical lookup for an out-of-scope customer before registering an inquiry", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@collaboration.test");
  try {
    const customer = await created(owner.context, "/customers?scope=all", {
      registeredBranchId: "2",
      name: `타 지점 고객 ${suffix()}`,
      phone: `010${String(Date.now()).slice(-8)}`,
      email: "",
      memo: "",
    });
    const denied = await api(staff.context, `/inquiries?scope=1`, {
      branchId: "1",
      customerId: customer.id,
      subject: "직접 ID 거부",
      body: "검색 전에는 거부",
      source: "전화",
    });
    expect(denied.status()).toBe(404);
    await staff.page.goto("/app/1/inquiries?detail=new");
    const panel = staff.page.getByRole("dialog");
    await panel
      .getByRole("combobox", { name: "고객 선택 방법", exact: true })
      .selectOption("exact");
    await panel.getByLabel("정확 일치 검색어").fill(customer.memberNo);
    await panel
      .getByRole("button", { name: "정확 일치 조회", exact: true })
      .click();
    await panel
      .getByRole("combobox", { name: "조회된 고객", exact: true })
      .selectOption(customer.id);
    const subject = `정확 일치 접수 ${suffix()}`;
    await panel.getByLabel("문의 제목").fill(subject);
    await panel
      .getByLabel("문의 내용")
      .fill("허용된 정확 일치 조회 후 대리 접수");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(
      staff.page.getByRole("button", { name: subject, exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
test("facility registers, edits and completes with two-session conflict comparison and reload persistence", async ({
  browser,
}) => {
  const owner = await login(browser),
    other = await login(browser);
  try {
    const typeName = `냉방 ${suffix()}`,
      name = `시설 실저장 ${suffix()}`;
    await owner.page.goto("/app/1/facilities?detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("시설명", { exact: true }).fill(name);
    await panel.getByText("시설 유형 추가 (사장님)", { exact: true }).click();
    await panel.getByLabel("새 유형 이름", { exact: true }).fill(typeName);
    await panel.getByRole("button", { name: "유형 등록", exact: true }).click();
    await panel
      .getByLabel("시설 유형", { exact: true })
      .selectOption({ label: `${typeName} · 기본 14일` });
    await panel.getByLabel("담당자", { exact: true }).selectOption("2");
    await panel.getByLabel("설명", { exact: true }).fill("초기 설명");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await owner.page.getByRole("button", { name, exact: true }).click();
    await panel.getByRole("button", { name: "수정하기" }).click();
    await panel.getByLabel("시설명", { exact: true }).fill(`${name} 수정`);
    const list = await (
        await api(
          other.context,
          `/facilities?scope=1&q=${encodeURIComponent(name)}`,
        )
      ).json(),
      row = list.items[0];
    const changed = await api(
      other.context,
      `/facilities/${row.id}?scope=1`,
      { version: row.version, description: "다른 세션의 설명" },
      "PATCH",
    );
    expect(changed.status()).toBe(200);
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "최신 내용 확인" }),
    ).toBeVisible();
    await expect(panel.getByLabel("시설명", { exact: true })).toHaveValue(
      `${name} 수정`,
    );
    await panel.getByRole("button", { name: "최신 내용 확인" }).click();
    await expect(
      panel.getByText("다른 세션의 설명", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "최신 기준으로 다시 저장" })
      .click();
    await expect(
      panel.getByRole("button", { name: "점검 완료", exact: true }),
    ).toBeVisible();
    const before = await (
      await api(owner.context, `/facilities/${row.id}?scope=1`)
    ).json();
    expect(before.description).toBe("다른 세션의 설명");
    await panel.getByRole("button", { name: "점검 완료", exact: true }).click();
    await panel.getByLabel("점검 결과", { exact: true }).fill("정상 작동 확인");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "점검 완료", exact: true }),
    ).toBeVisible();
    await expect(
      panel.locator("dd").getByText("정상 작동 확인", { exact: true }),
    ).toBeVisible();
    const saved = await (
      await api(owner.context, `/facilities/${row.id}?scope=1`)
    ).json();
    expect(saved.openWork.status).toBe("대기");
    expect(saved.openWork.assignee.id).toBe("2");
    expect(saved.openWork.id).not.toBe(before.openWork.id);
    expect(saved.nextInspectionOn).not.toBe(before.nextInspectionOn);
    await owner.page.reload();
    await expect(
      owner.page
        .getByRole("dialog")
        .getByText("정상 작동 확인", { exact: true }),
    ).toBeVisible();
    await owner.page
      .getByRole("dialog")
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await owner.page.setViewportSize({ width: 390, height: 844 });
    await owner.page.screenshot({
      path: "qa-artifacts/collaboration-live/facility-mobile.png",
      fullPage: true,
    });
    await expect(owner.page.getByLabel("시설 점검 집계")).toContainText(
      "점검 필요",
    );
  } finally {
    await owner.context.close();
    await other.context.close();
  }
});
test("inquiry selects an allowed customer, staff answers, history and unresolved count refresh", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@collaboration.test");
  try {
    const customer = await created(owner.context, "/customers?scope=all", {
      registeredBranchId: "1",
      name: `문의 고객 ${suffix()}`,
      phone: `010${String(Date.now()).slice(-8)}`,
      email: "",
      memo: "",
    });
    const subject = `대리 접수 ${suffix()}`;
    await owner.page.goto("/app/1/inquiries?detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByLabel("고객 선택", { exact: true })
      .selectOption(customer.id);
    await panel.getByLabel("문의 제목").fill(subject);
    await panel.getByLabel("문의 내용").fill("고객 요청 확인");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await staff.page.goto(`/app/1/inquiries?q=${encodeURIComponent(subject)}`);
    await expect(staff.page.getByLabel("고객 문의 집계")).toContainText(
      "미처리 1건",
    );
    await staff.page
      .getByRole("button", { name: subject, exact: true })
      .click();
    const detail = staff.page.getByRole("dialog");
    await expect(
      detail.getByRole("button", { name: "담당자 변경" }),
    ).toHaveCount(0);
    await owner.page
      .getByRole("button", { name: subject, exact: true })
      .click();
    await panel
      .getByRole("button", { name: "담당자 변경", exact: true })
      .click();
    await panel
      .getByRole("combobox", { name: "담당자", exact: true })
      .selectOption("2");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "담당자 변경", exact: true }),
    ).toBeVisible();
    await staff.page.reload();
    await expect(
      detail.getByRole("button", { name: "담당자 변경", exact: true }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "답변하기" }).click();
    await detail.getByLabel("답변 내용").fill("조치했습니다");
    await detail.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      detail.getByRole("heading", { name: "처리 이력" }),
    ).toBeVisible();
    await expect(detail.getByText(/→ 답변 완료/)).toBeVisible();
    await expect(staff.page.getByLabel("고객 문의 집계")).toContainText(
      "미처리 0건",
    );
    await staff.page.reload();
    await expect(
      staff.page.getByRole("dialog").getByText("조치했습니다", { exact: true }),
    ).toBeVisible();
  } finally {
    await owner.context.close();
    await staff.context.close();
  }
});
test("notice edits target branches and pin, publishes and ends; ordinary staff sees only published targets", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@collaboration.test"),
    other = await login(browser, "cashier@collaboration.test");
  try {
    const title = `공지 실저장 ${suffix()}`;
    await owner.page.goto("/app/1/notices?detail=new");
    const panel = owner.page.getByRole("dialog");
    await panel.getByLabel("공지 제목").fill(title);
    await panel.getByLabel("공지 내용").fill("지점 안내");
    await panel.getByLabel("중요 고정").check();
    await panel.getByLabel("게시 상태").selectOption("임시 저장");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await staff.page.goto(`/app/1/notices?q=${encodeURIComponent(title)}`);
    await expect(
      staff.page.getByRole("button", { name: `중요 · ${title}`, exact: true }),
    ).toHaveCount(0);
    await expect(
      staff.page.getByRole("button", { name: "공지 등록", exact: true }),
    ).toHaveCount(0);
    await staff.page.goto("/app/1/facilities");
    await expect(
      staff.page.getByRole("button", { name: "시설 점검 등록", exact: true }),
    ).toHaveCount(0);
    await owner.page
      .getByRole("button", { name: `중요 · ${title}`, exact: true })
      .click();
    await panel.getByRole("button", { name: "게시하기" }).click();
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "게시 종료", exact: true }),
    ).toBeVisible();
    await staff.page.goto(`/app/1/notices?q=${encodeURIComponent(title)}`);
    await expect(
      staff.page.getByRole("button", { name: `중요 · ${title}`, exact: true }),
    ).toBeVisible();
    await other.page.goto(`/app/2/notices?q=${encodeURIComponent(title)}`);
    await expect(
      other.page.getByRole("button", { name: `중요 · ${title}`, exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "수정하기" }).click();
    await panel.getByLabel("공지 내용").fill("수정된 안내");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "수정하기", exact: true }),
    ).toBeVisible();
    await expect(
      panel.locator("dd").getByText("수정된 안내", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "게시 종료", exact: true }).click();
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel.getByRole("button", { name: "게시하기" })).toBeVisible();
    await staff.page.reload();
    await expect(
      staff.page.getByRole("button", { name: `중요 · ${title}`, exact: true }),
    ).toHaveCount(0);
    for (const [ending, pinned, status] of [
      ["일반", false, "게시 중"],
      ["고정", true, "게시 중"],
      ["초안", true, "임시 저장"],
    ] as const) {
      await created(owner.context, "/notices?scope=1", {
        title: `${title} ${ending}`,
        body: "정렬 검증",
        target: "선택 지점",
        branchIds: ["1"],
        pinned,
        status,
      });
    }
    await staff.page.reload();
    await expect(staff.page.locator("tbody tr")).toHaveCount(2);
    await expect(
      staff.page.locator("tbody tr").first().getByRole("button"),
    ).toHaveText(`중요 · ${title} 고정`);
  } finally {
    await owner.context.close();
    await staff.context.close();
    await other.context.close();
  }
});
test("actual 422 preserves inspection input and committed response loss retries with the same key", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const type = await created(owner.context, "/facility-types", {
      name: `전기 ${suffix()}`,
      defaultInspectionDays: 7,
    });
    const row = await created(owner.context, "/facilities?scope=1", {
      branchId: "1",
      typeId: type.id,
      name: `재시도 ${suffix()}`,
    });
    await owner.page.goto(`/app/1/facilities?detail=${row.id}`);
    const panel = owner.page.getByRole("dialog");
    await panel.getByRole("button", { name: "점검 완료", exact: true }).click();
    await panel.getByLabel("점검 결과", { exact: true }).fill("전원 확인");
    await panel.getByLabel("실제 완료일").fill("2099-01-01");
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("점검 결과", { exact: true })).toHaveValue(
      "전원 확인",
    );
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
    }).format(new Date());
    await panel.getByLabel("실제 완료일").fill(today);
    const keys: string[] = [];
    await owner.page.route(
      `**/api/facilities/${row.id}/inspection/complete?*`,
      async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (keys.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel.getByText(/연결하지 못했습니다/)).toBeVisible();
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "점검 완료", exact: true }),
    ).toBeVisible();
    await expect(
      panel.locator("dd").getByText("전원 확인", { exact: true }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    const saved = await (
      await api(owner.context, `/facilities/${row.id}?scope=1`)
    ).json();
    expect(saved.version).toBe(row.version + 1);
  } finally {
    await owner.context.close();
  }
});
