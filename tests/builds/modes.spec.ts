import { test, expect } from "@playwright/test";
test("live build surfaces real API failures without activating MSW or demo login", async ({
  page,
}) => {
  const loaded: string[] = [];
  page.on("request", (request) => loaded.push(request.url()));
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "TEST_BACKEND_UNAVAILABLE",
        message: "실서버 연결 시험 오류",
      }),
    }),
  );
  await page.goto("http://127.0.0.1:4173/login");
  await expect(
    page.getByText("실서버 연결 시험 오류", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "사장님으로 체험" }),
  ).toHaveCount(0);
  expect(
    loaded.some(
      (url) =>
        url.includes("mockServiceWorker") || /assets\/browser-/.test(url),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.length),
    ),
  ).toBe(0);
});
test("demo production build logs in through its bundled MSW worker", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await expect(page.getByText("데모 데이터", { exact: true })).toBeVisible();
  await page.goto("http://127.0.0.1:4174/app/gangnam/chat/gangnam");
  await expect(page.locator("article").first()).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
