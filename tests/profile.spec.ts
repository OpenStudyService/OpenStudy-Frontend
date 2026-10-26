import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function openProfile(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await page.waitForURL("**/app/**");
  await page.goto("/app/all/settings");
  await expect(page.getByLabel("닉네임", { exact: true })).toBeVisible();
}

test("MSW profile sends nickname/version and updates the header after save and reload", async ({
  page,
}) => {
  await openProfile(page);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByLabel("닉네임", { exact: true }).fill("새 프로필 별명");
  const pending = page.waitForRequest((request) =>
    request.url().endsWith("/api/me/profile"),
  );
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  const request = await pending;
  expect(request.postDataJSON()).toEqual({
    nickname: "새 프로필 별명",
    version: expect.any(Number),
  });
  await expect(page.getByRole("button", { name: "사용자 메뉴" })).toContainText(
    "새 프로필 별명",
  );
  await page.reload();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
    "새 프로필 별명",
  );
  await expect(page.getByRole("button", { name: "사용자 메뉴" })).toContainText(
    "새 프로필 별명",
  );
});

test("MSW conflict preserves input until the user checks the latest version and saves again", async ({
  page,
}) => {
  await openProfile(page);
  await page.getByLabel("닉네임", { exact: true }).fill("미저장 프로필");
  await page.evaluate(async () => {
    const current = await fetch("/api/me").then((response) => response.json());
    const csrf = await fetch("/api/auth/csrf").then((response) =>
      response.json(),
    );
    const response = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.token,
      },
      body: JSON.stringify({
        nickname: "다른 편집 결과",
        version: current.user.version,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  });
  await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
  const profile = page.getByRole("region", { name: "내 프로필", exact: true });
  await expect(profile.getByRole("alert")).toContainText("최신 정보를 확인");
  await expect(profile.getByLabel("닉네임", { exact: true })).toHaveValue(
    "미저장 프로필",
  );
  await expect(
    page.getByText("프로필을 저장했어요.", { exact: true }),
  ).toHaveCount(0);
  await profile
    .getByRole("button", { name: "최신 버전 확인 (입력 유지)" })
    .click();
  await expect(profile.getByRole("status")).toContainText("다른 편집 결과");
  await expect(profile.getByLabel("닉네임", { exact: true })).toHaveValue(
    "미저장 프로필",
  );
  await profile
    .getByRole("button", { name: "프로필 저장", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "사용자 메뉴" })).toContainText(
    "미저장 프로필",
  );
});
