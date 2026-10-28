import { test, expect } from "@playwright/test";
const routes = [
  "home",
  "tasks",
  "chat/gangnam",
  "members",
  "products",
  "payments",
  "spaces",
  "reservations",
  "facilities",
  "inquiries",
  "notices",
  "attendance",
  "employees",
  "sales",
  "ai",
  "settings",
];
for (const width of [1440, 1024, 390])
  test(`all screens fit at ${width}px and form focus returns`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/login");
    await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/login-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "사장님으로 체험" }).click();
    await expect(
      page.getByRole("heading", { name: /안녕하세요/ }),
    ).toBeVisible();
    for (const route of routes) {
      await page.goto(`/app/gangnam/${route}`);
      await expect(page.locator("#main")).toBeVisible();
      await expect(
        page.locator("#main h1:visible, #main .chat-header h2:visible").first(),
      ).toBeVisible();
      await expect(page.locator("#main .spinner")).toHaveCount(0);
      await expect(page.locator("#main")).not.toContainText(
        "화면을 불러오지 못했습니다",
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          { message: `${route} should not overflow at ${width}` },
        )
        .toBe(true);
    }
    await page.goto("/app/gangnam/tasks");
    const trigger = page.getByRole("button", {
      name: "업무 등록",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("업무 제목").fill("좁은 화면 입력 유지");
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByLabel("기한").fill("2026-10-20");
    await dialog
      .getByRole("button", { name: "업무 등록", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "업무 등록", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: `test-results/task-form-${width}.png` });
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Escape");
    if (width === 390) {
      await page.goto("/app/gangnam/chat");
      await page.getByRole("link", { name: /강남점-운영/ }).click();
      await expect(
        page.getByRole("textbox", { name: "메시지", exact: true }),
      ).toBeInViewport();
      await expect(page.locator("article").first()).toBeVisible();
      await page.screenshot({ path: "test-results/chat-mobile.png" });
      await page
        .locator("article")
        .first()
        .getByRole("button", { name: "답글 달기" })
        .click();
      await expect(
        page.getByRole("textbox", { name: "스레드 답글" }),
      ).toBeInViewport();
      await page.screenshot({ path: "test-results/thread-mobile.png" });
      await page.getByRole("button", { name: "스레드 닫기" }).click();
      await expect(
        page.getByRole("textbox", { name: "메시지", exact: true }),
      ).toBeInViewport();
    }
    expect(errors).toEqual([]);
  });
test("three themes persist and keep private inputs unchanged", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [theme, label] of [
    ["forest", "포레스트"],
    ["navy", "네이비"],
    ["sand", "샌드"],
  ]) {
    await page.goto("/login");
    await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
    await page
      .getByLabel("이메일", { exact: true })
      .fill("owner@openstudy.test");
    await page
      .getByRole("button", { name: `${label} 테마`, exact: true })
      .click();
    await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(
      "owner@openstudy.test",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ path: `test-results/theme-${theme}-login.png` });
    await page.getByRole("button", { name: "사장님으로 체험" }).click();
    await expect(
      page.getByRole("heading", { name: /안녕하세요/ }),
    ).toBeVisible();
    for (const route of ["home", "tasks", "chat/gangnam", "ai"]) {
      await page.goto(`/app/gangnam/${route}`);
      await expect(page.locator("#main")).toBeVisible();
      if (route === "home")
        await expect(
          page.getByRole("heading", { name: /안녕하세요/ }),
        ).toBeVisible();
      if (route === "tasks")
        await expect(
          page.getByRole("button", {
            name: "스터디룸 A 냉방 상태 확인",
            exact: true,
          }),
        ).toBeVisible();
      if (route.startsWith("chat"))
        await expect(page.locator("article").first()).toBeVisible();
      if (route === "ai")
        await expect(
          page.getByRole("heading", { name: "업무 AI", exact: true }),
        ).toBeVisible();
      await page.screenshot({
        path: `test-results/theme-${theme}-${route.replace("/", "-")}.png`,
      });
    }
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.goto("/app/gangnam/settings");
    await page.getByRole("button", { name: /사용자 메뉴/ }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();
    await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  }
});
