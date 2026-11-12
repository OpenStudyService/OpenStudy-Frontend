import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = [
  "home",
  "tasks",
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
  "chat/gangnam",
  "sales",
  "ai",
  "settings",
];
async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}

test("registration actions sit at the right edge of their filters", async ({
  page,
}) => {
  const screens = [
    ["members?tab=members&q=010", "회원 등록", "q", "010"],
    ["reservations?status=확정", "예약 등록", "status", "확정"],
    ["spaces?tab=rooms&status=사용+가능", "스터디룸 등록", "status", "사용 가능"],
    ["facilities?q=점검", "시설 점검 등록", "q", "점검"],
    ["inquiries?q=문의", "고객 문의 등록", "q", "문의"],
    ["notices?q=공지", "공지 등록", "q", "공지"],
  ];
  await login(page);
  for (const [route, label, filter, value] of screens) {
    await test.step(label, async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/app/gangnam/${route}`);
      const action = page.getByRole("button", { name: label, exact: true });
      const filters = page.locator(".filters").filter({ has: action });
      await expect(action).toHaveCount(1);
      await expect(filters.locator(":scope > :last-child")).toHaveText(label);

      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(action).toBeVisible();
        expect(
          await filters.evaluate((bar) => {
            const padding = Number.parseFloat(getComputedStyle(bar).paddingRight);
            const right = bar.getBoundingClientRect().right - padding;
            const button = bar.lastElementChild!.getBoundingClientRect();
            return Math.abs(button.right - right) <= 1 && button.right <= innerWidth;
          }),
        ).toBe(true);
      }

      await action.click();
      const panel = page.getByRole("dialog", { name: label });
      await expect(panel).toBeVisible();
      await panel.getByRole("button", { name: "닫기" }).click();
      await expect(panel).not.toBeVisible();
      expect(new URL(page.url()).searchParams.get(filter)).toBe(value);
    });
  }
});

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}
for (const width of [1024, 1280, 1440]) {
  test(`major screens are accessible and contained at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    for (const route of routes) {
      await page.goto(`/app/gangnam/${route}`);
      await expect(
        page.locator("#main h1:visible, #main .chat-header h2:visible").first(),
      ).toBeVisible();
      await expect(page.locator("#main .spinner")).toHaveCount(0);
      await expect(page.locator("#main")).not.toContainText(
        "화면을 불러오지 못했습니다",
      );
      expect(
        await page
          .locator("#main")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        route,
      ).toBe(true);
      await accessible(page);
    }
  });
}
test("product draft survives cancelled close, back and reload, then discards once", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "상품 관리", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "상품 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("상품명", { exact: true });
  await input.fill("버리지 않을 초안");
  page.once("dialog", (d) => d.dismiss());
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(input).toHaveValue("버리지 않을 초안");
  page.once("dialog", (d) => d.dismiss());
  await page.evaluate(() => history.back());
  await expect(input).toHaveValue("버리지 않을 초안");
  page.once("dialog", (d) => d.dismiss());
  await page.reload({ timeout: 3000 }).catch(() => {});
  await expect(input).toHaveValue("버리지 않을 초안");
  let warnings = 0;
  page.on("dialog", async (d) => {
    warnings++;
    await d.accept();
  });
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(warnings).toBe(1);
});

for (const width of [1024, 1440]) {
  test(`major edit forms are accessible and fit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    for (const [route, name] of [
      ["tasks", "업무 등록"],
      ["members", "회원 등록"],
      ["products", "상품 등록"],
      ["payments", "Mock 결제"],
      ["attendance", "근무 등록"],
      ["employees", "직원 상세: 박준호"],
    ]) {
      await page.goto(`/app/gangnam/${route}`);
      await page.getByRole("button", { name, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".spinner")).toHaveCount(0);
      await accessible(page);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        route,
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    }
  });
}

test("saved product closes without warning and a new draft remains protected", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/products");
  await page.getByRole("button", { name: "상품 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("상품명").fill("접근성 저장 검증");
  await dialog.getByLabel("판매 금액 (원)").fill("10000");
  await dialog.getByLabel("상품 유형").selectOption("기간권");
  await dialog.getByLabel("이용 기간 (일)").fill("28");
  await dialog.getByLabel("분류").selectOption({ label: "기간권" });
  let warnings = 0;
  page.on("dialog", async (d) => {
    warnings++;
    await d.dismiss();
  });
  await dialog.getByRole("button", { name: "상품 등록", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "상품 상세: 접근성 저장 검증",
      exact: true,
    }),
  ).toBeVisible();
  expect(warnings).toBe(0);
  await page.getByRole("button", { name: "상품 등록", exact: true }).click();
  await dialog.getByLabel("상품명").fill("다음 입력");
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("상품명")).toHaveValue("다음 입력");
  expect(warnings).toBe(1);
});

test("branch switching is cancelled before drafts disappear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/app/gangnam/employees?tab=invitations");
  await page.getByLabel("초대 이름", { exact: true }).fill("보존할 입력");
  page.once("dialog", (d) => d.dismiss());
  await page.getByLabel("현재 지점", { exact: true }).selectOption("seongsu");
  await expect(page).toHaveURL(/\/gangnam\/employees/);
  await expect(page.getByLabel("초대 이름", { exact: true })).toHaveValue(
    "보존할 입력",
  );
  await expect(page.getByLabel("현재 지점", { exact: true })).toHaveValue(
    "gangnam",
  );
});
test("keyboard opens a form, traps focus and restores it; all themes retain visible focus", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/tasks");
  const trigger = page.getByRole("button", { name: "업무 등록", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "업무 등록", exact: true }),
  ).toBeFocused();
  await accessible(page);
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "닫기", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "닫기", exact: true }),
  ).toBeFocused();
  for (const theme of ["forest", "navy", "sand"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    expect(
      await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement!);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      }),
    ).toBe(true);
    await accessible(page);
  }
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("workspace reads follow menu and refresh actions", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/"))
      reads.push(url.pathname + url.search);
  });
  await login(page);
  await page.goto("/app/gangnam/tasks?q=확인&page=2");
  const menu = page.getByRole("link", { name: "업무 관리", exact: true });
  const refresh = page.getByRole("button", {
    name: "화면 새로고침",
    exact: true,
  });
  const taskReads = () => reads.filter((url) => url.startsWith("/api/tasks?"));
  await expect(page.getByText(/^마지막 조회/).locator("time")).toHaveAttribute(
    "datetime",
    /T/,
  );
  await expect(refresh).toBeEnabled();
  const initialReads = taskReads().length;
  expect(initialReads).toBeGreaterThan(0);
  const idleReads = reads.length;

  await page.clock.install();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await page.clock.fastForward(60_000);
  expect(reads).toHaveLength(idleReads);

  const nextTaskResponse = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/tasks" && response.ok(),
    );
  const menuResponse = nextTaskResponse();
  await menu.click();
  await (await menuResponse).finished();
  expect(taskReads()).toHaveLength(initialReads + 1);
  await expect(refresh).toBeEnabled();

  const refreshResponse = nextTaskResponse();
  await refresh.click();
  await (await refreshResponse).finished();
  expect(taskReads()).toHaveLength(initialReads + 2);
  expect(new Set(taskReads()).size).toBe(1);
  await expect(page).toHaveURL(/page=2/);

  await page.getByRole("link", { name: "대시보드" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  const entryResponse = nextTaskResponse();
  await menu.click();
  await (await entryResponse).finished();
  expect(taskReads().length).toBeGreaterThan(initialReads + 2);
  expect(
    reads.some((url) =>
      /\/workspace\/events|\/requests\/[^/]+\/events/.test(url),
    ),
  ).toBe(false);
});
