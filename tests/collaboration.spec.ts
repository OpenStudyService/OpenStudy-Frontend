import { test, expect } from "@playwright/test";
test.setTimeout(90000);
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
test("mock facility uses separate condition/work states, completion refreshes due date and survives reload", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/facilities?detail=facility-1");
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("점검 필요", { exact: true })).toBeVisible();
  await expect(panel.getByText("진행 중", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "점검 완료", exact: true }).click();
  await panel.getByLabel("점검 결과", { exact: true }).fill("Mock 완료 결과");
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "점검 완료", exact: true }),
  ).toBeVisible();
  await expect(
    panel.locator("dd").getByText("Mock 완료 결과", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("2026-10-31", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog").getByText("Mock 완료 결과", { exact: true }),
  ).toBeVisible();
});
test("mock inquiry answer refreshes unresolved summary and processing history", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/inquiries?detail=inquiry-1");
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "답변하기" }).click();
  await panel.getByLabel("답변 내용").fill("현장 조치 완료");
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "처리 이력" })).toBeVisible();
  await expect(panel.getByText(/→ 답변 완료/)).toBeVisible();
  await expect(page.getByLabel("고객 문의 집계")).toContainText("미처리 0건");
});
test("mock notice draft, publish, edit pin and end use canonical commands", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/notices?detail=new");
  const panel = page.getByRole("dialog");
  await panel.getByLabel("공지 제목").fill("Mock 지점 공지");
  await panel.getByLabel("공지 내용").fill("안내문");
  await panel.getByLabel("게시 상태").selectOption("임시 저장");
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mock 지점 공지", exact: true })
    .click();
  await panel.getByRole("button", { name: "수정하기" }).click();
  await panel.getByLabel("중요 고정").check();
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await panel.getByRole("button", { name: "게시하기" }).click();
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "게시 종료", exact: true }),
  ).toBeVisible();
});
