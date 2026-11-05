import { test, expect } from "@playwright/test";
test("mock attendance shares clock, break and out records with list, detail and the weekly schedule", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.goto("/app/gangnam/attendance");
  const card = page.getByRole("region", { name: "본인 출퇴근" });
  await card.getByRole("button", { name: "출근하기" }).click();
  await expect(card.getByRole("button", { name: "휴게 시작" })).toBeEnabled();
  await card.getByRole("button", { name: "휴게 시작" }).click();
  await expect(card.getByRole("button", { name: "퇴근하기" })).toHaveCount(0);
  await card.getByRole("button", { name: "휴게 종료" }).click();
  const out = page.waitForResponse((r) =>
    r.url().endsWith("/api/me/attendance/clock-out"),
  );
  await card.getByRole("button", { name: "퇴근하기" }).click();
  const record = await (await out).json();
  await expect(card.getByText("퇴근", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "출퇴근·휴게" }).click();
  await page.getByLabel("조회 대상", { exact: true }).selectOption("true");
  await expect(
    page.getByRole("cell", { name: `${record.workedMinutes}분`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("cell", { name: "김서연", exact: true })
    .locator("..")
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("dialog").getByText(`실근무: ${record.workedMinutes}분`),
  ).toBeVisible();
  await page.goto(`/app/gangnam/attendance?week=${record.workDate}`);
  await expect(page.getByRole("rowheader", { name: "김서연" })).toBeVisible();
  await expect(
    page
      .getByText(/실제 출퇴근.*강남점/)
      .filter({ hasText: `실근무 ${record.workedMinutes}분` }),
  ).toBeVisible();
});
test("mock attendance staff sees only personal records and no staff management filters", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "직원으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.goto("/app/gangnam/attendance?tab=attendance");
  await expect(page.getByLabel("근태 직원", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("조회 대상", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "이민지", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "출근하기" })).toBeEnabled();
});
