import { test, expect } from "@playwright/test";
test("mock schedule creates an overnight shift, keeps conflicts and cancels through canonical routes", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await page.goto("/app/gangnam/attendance?week=2036-11-02");
  await page.getByRole("button", { name: "근무 등록" }).click();
  await page.getByLabel("근무 직원").selectOption("junho");
  await page.getByLabel("시작 (Asia/Seoul)").fill("2036-11-02T22:00");
  await page.getByLabel("종료 (Asia/Seoul)").fill("2036-11-03T06:00");
  await page.getByRole("button", { name: "등록하기" }).click();
  await expect(
    page.getByRole("heading", { name: "예정 근무 상세" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  const cells = page
    .getByRole("rowheader", { name: "박준호" })
    .locator("..")
    .getByRole("cell");
  await expect(
    cells.nth(6).getByRole("button", { name: /예정 근무/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "근무 등록" }).click();
  await page.getByLabel("근무 직원").selectOption("junho");
  await page.getByLabel("시작 (Asia/Seoul)").fill("2036-11-02T22:00");
  await page.getByLabel("종료 (Asia/Seoul)").fill("2036-11-03T06:00");
  await page.getByRole("button", { name: "등록하기" }).click();
  await expect(page.getByRole("alert")).toContainText("2036-11-02 22:00");
  await expect(page.getByLabel("시작 (Asia/Seoul)")).toHaveValue(
    "2036-11-02T22:00",
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: /예정 근무 ·/ }).click();
  await page.getByRole("button", { name: "근무 취소" }).click();
  await expect(page.getByRole("button", { name: "근무 취소" })).toHaveCount(0);
});
