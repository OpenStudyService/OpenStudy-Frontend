import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}

test("owner creates a branch with structured overnight hours", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/all/settings");
  await page.getByRole("button", { name: "지점 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("지점 이름", { exact: true })
    .fill("구조화 운영시간 검증점");
  await dialog.getByLabel("주소", { exact: true }).fill("서울 테스트로 24");
  await dialog.getByLabel("연락처", { exact: true }).fill("02-123-4567");
  await dialog.getByLabel("월요일 시작(분)", { exact: true }).fill("1200");
  await dialog.getByLabel("월요일 종료(분)", { exact: true }).fill("1560");
  const request = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/branches",
  );
  await dialog.getByRole("button", { name: "지점 저장", exact: true }).click();
  const saved = await request;
  expect(saved.headers()["idempotency-key"]).toBeTruthy();
  expect(saved.postDataJSON().weeklyHours).toHaveLength(7);
  expect(saved.postDataJSON().weeklyHours[0]).toEqual({
    weekday: 1,
    isClosed: false,
    opensMinute: 1200,
    closesMinute: 1560,
  });
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "구조화 운영시간 검증점", exact: true }),
  ).toBeVisible();
});

test("membership editor sends one branch with both versions and preserves email", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/all/employees");
  await page
    .getByRole("button", { name: "직원 상세: 박준호", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("로그인 이메일 (변경 불가)", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await dialog
    .getByRole("combobox", { name: "권한 프리셋 복사", exact: true })
    .selectOption({ label: "일반 직원 기본" });
  await dialog.getByLabel("운영 설정 변경", { exact: true }).check();
  const request = page.waitForRequest(
    (r) =>
      r.method() === "PUT" &&
      new URL(r.url()).pathname === "/api/employees/junho/memberships/gangnam",
  );
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === "/api/employees/junho/memberships/gangnam",
  );
  await dialog
    .getByRole("button", { name: "이 지점 소속 저장", exact: true })
    .click();
  const sent = (await request).postDataJSON();
  expect(sent.employeeVersion).toBeGreaterThan(0);
  expect(sent.version).toBeGreaterThan(0);
  expect(sent.permissions).toEqual(["operations:write"]);
  expect(sent).not.toHaveProperty("memberships");
  expect(sent).not.toHaveProperty("email");
  expect((await response).status()).toBe(200);
});
