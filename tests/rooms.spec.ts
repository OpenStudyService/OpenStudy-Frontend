import { test, expect } from "@playwright/test";
test.setTimeout(90000);
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
test("Mock room management uses canonical fields and keeps saved edits on reload", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/spaces?tab=rooms&detail=new");
  const panel = page.getByRole("dialog");
  const name = `Mock 룸 ${Date.now()}`;
  await panel.getByLabel("룸 번호", { exact: true }).fill(`E2E-${Date.now()}`);
  await panel.getByLabel("룸 이름", { exact: true }).fill(name);
  await panel.getByLabel("정원", { exact: true }).fill("4");
  await panel.getByLabel("시간당 요금 (원)", { exact: true }).fill("7000");
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(`${name}$`) }).click();
  await panel.getByRole("button", { name: "수정하기", exact: true }).click();
  await panel.getByLabel("룸 이름", { exact: true }).fill(`${name} 수정`);
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "수정하기", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("dialog")
      .locator("dd")
      .getByText(`${name} 수정`, { exact: true }),
  ).toBeVisible();
});
test("Mock reservations provide calendar/list views and enforce whole-hour controls", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/reservations?detail=new");
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByRole("combobox", { name: "시작 시각 (한국 시간)", exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .getByRole("combobox", { name: "이용 시간", exact: true })
      .locator("option"),
  ).toHaveCount(24);
  await expect(panel.getByText(/실제 금전 이동 없음/)).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "달력 보기", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "달력 보기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "목록 보기", exact: true }),
  ).toBeVisible();
});
