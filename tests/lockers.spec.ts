import { test, expect } from "@playwright/test";
test.setTimeout(90000);
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
test("Mock locker management persists create/update/status and refreshes occupancy", async ({
  page,
}) => {
  await login(page);
  const no = `E2E-${Date.now()}`;
  await page.goto("/app/gangnam/spaces?tab=lockers&detail=new");
  const panel = page.getByRole("dialog");
  await panel.getByLabel("사물함 번호", { exact: true }).fill(no);
  await panel.getByLabel("4주 요금 (원)", { exact: true }).fill("12000");
  await panel.getByRole("button", { name: "저장", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: no, exact: true }).click();
  await panel.getByRole("button", { name: "수정하기", exact: true }).click();
  await panel.getByLabel("4주 요금 (원)", { exact: true }).fill("13000");
  await panel.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "수정하기", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "운영 중단", exact: true }).click();
  await panel.getByLabel("운영 변경 사유", { exact: true }).fill("정비");
  await panel.getByRole("button", { name: "저장", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "운영 재개", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "운영 재개", exact: true }),
  ).toBeVisible();
});
test("Mock assignment form exposes 28-day blocks and explicitly labels payment simulation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/spaces?tab=lockers");
  await page.getByRole("button", { name: "L-01", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "유료 배정", exact: true }).click();
  await expect(
    panel.getByLabel("이용 기간 (4주 단위)", { exact: true }),
  ).toHaveAttribute("step", "1");
  await expect(panel.getByText(/28일의 배수/)).toBeVisible();
  await expect(panel.getByText(/실제 금전 이동 없음/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Mock 결제 후 배정", exact: true }),
  ).toBeVisible();
});
