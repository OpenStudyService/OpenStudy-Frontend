import { test, expect } from "@playwright/test";
test("login and all owner screens render", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/login.png", fullPage: true });
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.screenshot({ path: "test-results/home.png", fullPage: true });
  for (const route of [
    "tasks",
    "chat/gangnam",
    "members",
    "products",
    "payments",
    "reservations",
    "spaces",
    "facilities",
    "inquiries",
    "notices",
    "attendance",
    "employees",
    "sales",
    "ai",
    "settings",
  ]) {
    await page.goto(`/app/all/${route}`);
    await expect(page.locator("#main")).toBeVisible();
    await expect(page.locator("#main")).not.toContainText(
      "화면을 불러오지 못했습니다",
    );
    await page.waitForTimeout(350);
  }
  expect(errors).toEqual([]);
});
