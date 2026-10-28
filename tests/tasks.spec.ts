import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function request(page: Page, path: string, body?: object) {
  return page.evaluate(
    async ({ path, body }) => {
      const csrf = await fetch("/api/auth/csrf").then((r) => r.json());
      const response = await fetch(
        `/api${path}`,
        body
          ? {
              method: path.startsWith("/tasks/") ? "PATCH" : "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf.token,
              },
              body: JSON.stringify(body),
            }
          : undefined,
      );
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body },
  );
}
async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
test("staff creator can register, assign another employee, and edit the full task", async ({
  page,
}) => {
  await login(page);
  await request(page, "/_demo", { persona: "junho" });
  await page.goto("/app/gangnam/tasks");
  await page.getByRole("button", { name: "업무 등록", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("업무 제목").fill("직원 등록 인수인계 E2E");
  await panel.getByLabel("내용", { exact: true }).fill("현장 확인");
  await panel.getByLabel("담당자", { exact: true }).selectOption("minji");
  await panel.getByLabel("기한").fill("2026-10-30");
  await panel.getByRole("button", { name: "업무 등록", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page
    .getByRole("button", { name: "직원 등록 인수인계 E2E", exact: true })
    .click();
  await expect(panel.getByText("박준호", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "수정하기" }).click();
  await panel.getByLabel("내용", { exact: true }).fill("등록자가 내용 수정");
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    panel.getByText("등록자가 내용 수정", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText(/내용:.*등록자가 내용 수정/)).toBeVisible();
});
test("real demo HTTP version conflict preserves input and another editor's unchanged fields", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/tasks?detail=task-2&edit=1&q=인수인계");
  const panel = page.getByRole("dialog"),
    title = panel.getByLabel("업무 제목");
  await title.fill("충돌 후 내 제목 E2E");
  const original = await request(page, "/tasks/task-2?scope=gangnam");
  await request(page, "/tasks/task-2", {
    version: original.version,
    body: "다른 편집자의 본문 E2E",
  });
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "최신 내용 확인" }),
  ).toBeVisible();
  await expect(title).toHaveValue("충돌 후 내 제목 E2E");
  await panel.getByRole("button", { name: "최신 내용 확인" }).click();
  await expect(panel.getByRole("heading", { name: /최신 업무/ })).toBeVisible();
  await panel.getByRole("button", { name: "최신 기준으로 다시 저장" }).click();
  await expect(panel.getByRole("button", { name: "수정하기" })).toBeVisible();
  const saved = await request(page, "/tasks/task-2?scope=gangnam");
  expect(saved.title).toBe("충돌 후 내 제목 E2E");
  expect(saved.body).toBe("다른 편집자의 본문 E2E");
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "업무 검색" })).toHaveValue(
    "인수인계",
  );
});
test("dirty input survives cancelled Escape navigation and direct edit URLs enforce task ownership", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/tasks?detail=new");
  const panel = page.getByRole("dialog");
  await panel.getByLabel("업무 제목").fill("저장 전 이탈 확인");
  const dismissed = new Promise<void>((resolve) =>
    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
      resolve();
    }),
  );
  await page.keyboard.press("Escape");
  await dismissed;
  await expect(panel.getByLabel("업무 제목")).toHaveValue("저장 전 이탈 확인");
  const accepted = new Promise<void>((resolve) =>
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    }),
  );
  await page.keyboard.press("Escape");
  await accepted;
  await expect(panel).not.toBeVisible();
  await request(page, "/_demo", { persona: "junho" });
  await page.goto("/app/gangnam/tasks?detail=task-1&edit=1");
  await expect(
    page.getByRole("heading", { name: "이 업무를 수정할 권한이 없어요" }),
  ).toBeVisible();
  await expect(page.getByLabel("업무 제목")).toHaveCount(0);
});
