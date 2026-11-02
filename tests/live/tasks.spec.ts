import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { components } from "../../src/shared/api/foundation.generated";

type Task = components["schemas"]["Task"];
const password = process.env.TASK_LIVE_PASSWORD;
const ownerEmail = process.env.TASK_LIVE_OWNER_EMAIL;
const creatorEmail = process.env.TASK_LIVE_CREATOR_EMAIL;
const assigneeEmail = process.env.TASK_LIVE_ASSIGNEE_EMAIL;
const readerEmail = process.env.TASK_LIVE_READER_EMAIL;
const outsiderEmail = process.env.TASK_LIVE_OUTSIDER_EMAIL;
const creatorId = process.env.TASK_LIVE_CREATOR_ID || "2";
const assigneeId = process.env.TASK_LIVE_ASSIGNEE_ID || "3";
const baseURL = "http://127.0.0.1:15181";
test.beforeAll(() => {
  if (
    ![
      password,
      ownerEmail,
      creatorEmail,
      assigneeEmail,
      readerEmail,
      outsiderEmail,
    ].every(Boolean)
  )
    throw new Error(
      "Prepare disposable task Backend/MySQL and TASK_LIVE_* fixture accounts in docs/testing/task-live.md.",
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
async function create(
  context: BrowserContext,
  title: string,
  assigned = assigneeId,
): Promise<Task> {
  const response = await api(context, "/tasks?scope=1", {
    branchId: "1",
    title,
    body: "원래 본문",
    assigneeId: assigned,
    category: "운영",
    priority: "긴급",
    dueAt: "2030-01-02T03:04:00Z",
    checklist: ["초기 점검"],
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function open(page: Page, id: string, edit = false) {
  await page.goto(`/app/1/tasks?detail=${id}${edit ? "&edit=1" : ""}`);
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  return panel;
}
async function detail(context: BrowserContext, id: string): Promise<Task> {
  const response = await api(context, `/tasks/${id}?scope=1`);
  expect(response.status()).toBe(200);
  return response.json();
}

test("real API: staff creates, edits checklist and state; reload preserves data and processing history", async ({
  browser,
}) => {
  const { context, page } = await login(browser, creatorEmail!);
  try {
    await page.goto("/app/1/tasks?detail=new");
    const panel = page.getByRole("dialog");
    const title = `실서버 업무 ${randomUUID().slice(0, 8)}`;
    await panel.getByLabel("업무 제목").fill(title);
    await panel.getByLabel("내용", { exact: true }).fill("실제 DB 본문");
    await expect(
      panel.getByRole("combobox", { name: "담당자", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("combobox", { name: "담당자", exact: true })
      .selectOption(assigneeId);
    await panel.getByLabel("기한", { exact: true }).fill("2030-01-02T12:04");
    await panel
      .getByLabel("체크리스트", { exact: true })
      .fill("실제 초기 항목");
    const madePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/tasks",
    );
    await panel.getByRole("button", { name: "업무 등록", exact: true }).click();
    const madeResponse = await madePromise;
    expect(madeResponse.status()).toBe(201);
    const made: Task = await madeResponse.json();
    expect(made.createdBy.id).toBe(creatorId);
    expect(made.assignee.id).toBe(assigneeId);
    await expect(panel).not.toBeVisible();
    await open(page, made.id);
    await page.reload();
    await expect(
      panel.getByText("실제 DB 본문", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("checkbox", { name: "실제 초기 항목", exact: true })
      .click();
    await expect(
      panel.getByRole("checkbox", { name: "실제 초기 항목", exact: true }),
    ).toBeChecked();
    await panel.getByLabel("새 체크 항목").fill("추가 항목");
    await panel.getByRole("button", { name: "항목 추가", exact: true }).click();
    await expect(
      panel.getByRole("checkbox", { name: "추가 항목", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "추가 항목 수정", exact: true })
      .click();
    await panel.getByLabel("체크 항목 내용 수정").fill("수정한 추가 항목");
    await panel.getByRole("button", { name: "항목 저장", exact: true }).click();
    await expect(
      panel.getByRole("checkbox", { name: "수정한 추가 항목", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "수정한 추가 항목 삭제", exact: true })
      .click();
    await expect(
      panel.getByRole("checkbox", { name: "수정한 추가 항목", exact: true }),
    ).toHaveCount(0);
    for (const action of ["진행하기", "완료하기", "할 일로 변경"]) {
      await panel.getByRole("button", { name: action, exact: true }).click();
      await panel.getByRole("button", { name: action, exact: true }).click();
      await expect(
        panel.getByRole("button", { name: "수정하기", exact: true }),
      ).toBeVisible();
    }
    await page.reload();
    const stored = await detail(context, made.id);
    expect(stored.status).toBe("할 일");
    expect(stored.completedAt).toBeNull();
    expect(stored.checklist).toHaveLength(1);
    expect(stored.checklist[0].done).toBe(true);
    const events = await (
      await api(context, `/tasks/${made.id}/events?scope=1&pageSize=100`)
    ).json();
    expect(events.items.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining([
        "CREATED",
        "CHECKLIST_ADDED",
        "CHECKLIST_CHANGED",
        "CHECKLIST_REMOVED",
        "STATUS_CHANGED",
      ]),
    );
    await expect(
      panel.getByRole("heading", { name: "처리 이력" }),
    ).toBeVisible();
    await page.screenshot({
      path: "qa-artifacts/task-live/task-detail-desktop.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("real two-user 409: keep draft, compare current data and PATCH only changed content", async ({
  browser,
}) => {
  const owner = await login(browser);
  const assigned = await login(browser, assigneeEmail!);
  try {
    const task = await create(
      owner.context,
      `충돌 업무 ${randomUUID().slice(0, 8)}`,
    );
    const panel = await open(owner.page, task.id, true);
    await panel.getByLabel("업무 제목").fill("내가 수정한 제목");
    const other = await api(
      assigned.context,
      `/tasks/${task.id}?scope=1`,
      { version: task.version, body: "다른 사용자의 본문" },
      "PATCH",
    );
    expect(other.status()).toBe(200);
    await panel.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(panel.getByLabel("업무 제목")).toHaveValue("내가 수정한 제목");
    await expect(
      panel.getByRole("button", { name: "최신 내용 확인", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "최신 내용 확인", exact: true })
      .click();
    await expect(
      panel.getByText("다른 사용자의 본문", { exact: true }),
    ).toBeVisible();
    const patchPromise = owner.page.waitForRequest(
      (r) =>
        r.method() === "PATCH" &&
        new URL(r.url()).pathname === `/api/tasks/${task.id}`,
    );
    await panel
      .getByRole("button", { name: "최신 기준으로 다시 저장", exact: true })
      .click();
    expect((await patchPromise).postDataJSON()).toEqual({
      version: task.version + 1,
      title: "내가 수정한 제목",
    });
    await expect(
      panel.getByRole("button", { name: "수정하기", exact: true }),
    ).toBeVisible();
    await owner.page.reload();
    const stored = await detail(owner.context, task.id);
    expect(stored.title).toBe("내가 수정한 제목");
    expect(stored.body).toBe("다른 사용자의 본문");
  } finally {
    await Promise.all([owner.context.close(), assigned.context.close()]);
  }
});

test("real permissions and assignees: active same-branch candidates, reader403 and outsider404", async ({
  browser,
}) => {
  const owner = await login(browser);
  const reader = await login(browser, readerEmail!);
  const outsider = await login(browser, outsiderEmail!);
  try {
    const task = await create(
      owner.context,
      `권한 업무 ${randomUUID().slice(0, 8)}`,
    );
    const candidates = await (
      await api(owner.context, "/assignee-candidates?branchId=1")
    ).json();
    expect(
      candidates.items.map((candidate: { id: string }) => candidate.id).sort(),
    ).toEqual([creatorId, assigneeId, "4"].sort());
    const panel = await open(reader.page, task.id);
    await expect(panel.getByText(task.title, { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "수정하기", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByLabel("새 체크 항목")).toHaveCount(0);
    expect(
      (
        await api(
          reader.context,
          `/tasks/${task.id}?scope=1`,
          { version: task.version, title: "권한 없음" },
          "PATCH",
        )
      ).status(),
    ).toBe(403);
    expect((await api(outsider.context, `/tasks/${task.id}`)).status()).toBe(
      404,
    );
    expect(
      (
        await api(owner.context, "/tasks", {
          branchId: "1",
          title: "잘못된 담당자",
          assigneeId: "6",
          category: "운영",
        })
      ).status(),
    ).toBe(422);
  } finally {
    await Promise.all([
      owner.context.close(),
      reader.context.close(),
      outsider.context.close(),
    ]);
  }
});

test("real filters restore from URL; create response loss reuses key and creates one row", async ({
  browser,
}) => {
  const { context, page } = await login(browser, creatorEmail!);
  try {
    const title = `재시도 ${randomUUID().slice(0, 8)}`;
    await page.goto("/app/1/tasks?detail=new");
    const panel = page.getByRole("dialog");
    await panel.getByLabel("업무 제목").fill(title);
    await panel
      .getByRole("combobox", { name: "담당자", exact: true })
      .selectOption(creatorId);
    const keys: string[] = [];
    await page.route("**/api/tasks?**", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (keys.length === 1) return route.abort("connectionreset");
      return route.fulfill({ response });
    });
    await panel.getByRole("button", { name: "업무 등록", exact: true }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByLabel("업무 제목")).toHaveValue(title);
    await panel.getByRole("button", { name: "업무 등록", exact: true }).click();
    await expect(panel).not.toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    const query = new URLSearchParams({
      q: title,
      mine: "true",
      status: "할 일",
      sort: "createdAt",
      direction: "desc",
      page: "1",
      pageSize: "20",
    });
    await page.goto(`/app/1/tasks?${query}`);
    await page.reload();
    await expect(
      page.getByRole("searchbox", { name: "업무 검색" }),
    ).toHaveValue(title);
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toBeVisible();
    const result = await (await api(context, `/tasks?scope=1&${query}`)).json();
    expect(result.meta.total).toBe(1);
    const summary = await (
      await api(
        context,
        `/tasks/summary?scope=1&q=${encodeURIComponent(title)}&mine=true`,
      )
    ).json();
    expect(summary.totals.todo).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(
      page.getByRole("dialog").getByText(title, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "qa-artifacts/task-live/task-detail-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
