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

for (const width of [1100, 1099, 390]) {
  test(`home and chat start with the menu collapsed at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const rail = page.getByRole("navigation", {
      name: "빠른 탐색",
      exact: true,
    });
    const bottomNav = page.getByRole("navigation", {
      name: "모바일 빠른 탐색",
    });
    const quickNav = width === 390 ? bottomNav : rail;
    const fixedSidebar = page.locator(".workspace > .sidebar");
    const openMenu = page.getByRole("button", { name: "메뉴 열기" });
    const dialog = page.getByRole("dialog", { name: "메뉴", exact: true });
    const menu = width === 1100 ? fixedSidebar : dialog;

    await page.goto("/app/gangnam/home");
    await expect(quickNav).toBeVisible();
    await expect(width === 390 ? rail : bottomNav).toBeHidden();
    await expect(fixedSidebar).toHaveCount(0);
    await expect(openMenu).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".main-shell")).toHaveCSS(
      "width",
      `${width - (width === 390 ? 0 : 70)}px`,
    );
    const closedBackground = await openMenu.evaluate(
      (button) => getComputedStyle(button).backgroundColor,
    );
    const closedIcon = await openMenu.locator("svg path").getAttribute("d");
    await openMenu.focus();
    await page.keyboard.press("Enter");
    await expect(menu.getByLabel("현재 지점")).toHaveValue("gangnam");
    await expect(menu.getByRole("link", { name: "회원 관리" })).toBeVisible();
    await expect
      .poll(async () => (await menu.boundingBox())?.x)
      .toBe(width === 390 ? 0 : 70);
    if (width === 1100) {
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".main-shell")).toHaveCSS("width", "808px");
      const closeMenu = page.getByRole("button", { name: "메뉴 접기" });
      await expect(closeMenu).toHaveAttribute("aria-expanded", "true");
      await expect(closeMenu).not.toHaveCSS(
        "background-color",
        closedBackground,
      );
      expect(await closeMenu.locator("svg path").getAttribute("d")).not.toBe(
        closedIcon,
      );
      await closeMenu.click();
      await expect(menu).toBeHidden();
      await expect(openMenu).toHaveAttribute("aria-expanded", "false");
      await openMenu.click();
      await expect(fixedSidebar).toBeFocused();
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(openMenu).toBeFocused();
    await page.mouse.move(0, 0);
    await expect(openMenu).toHaveCSS("background-color", closedBackground);
    expect(await openMenu.locator("svg path").getAttribute("d")).toBe(
      closedIcon,
    );

    await quickNav.getByRole("link", { name: "채팅", exact: true }).click();
    await expect(page).toHaveURL(/\/gangnam\/chat$/);
    await page.reload();
    await expect(openMenu).toBeVisible();
    await expect(fixedSidebar).toHaveCount(0);
    await openMenu.click();
    await menu.getByLabel("현재 지점").selectOption("seongsu");
    await expect(page).toHaveURL(/\/seongsu\/chat$/);
    await expect(menu).toBeHidden();
    await openMenu.click();
    await expect(menu.getByLabel("현재 지점")).toHaveValue("seongsu");
    await page.goBack();
    await expect(page).toHaveURL(/\/gangnam\/chat$/);
    await expect(menu).toBeHidden();
    await openMenu.click();
    await expect(menu).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/gangnam\/home$/);
    await expect(menu).toBeHidden();

    for (const [label, route] of [
      ["업무", "tasks"],
      ["설정", "settings"],
    ]) {
      await quickNav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(`/app/gangnam/${route}`);
      if (width === 1100) {
        await expect(fixedSidebar).toBeVisible();
        await expect(openMenu).toBeHidden();
      } else {
        await expect(fixedSidebar).toBeHidden();
        await expect(openMenu).toBeVisible();
        await openMenu.click();
        await expect(dialog.getByLabel("현재 지점")).toHaveValue("gangnam");
        await expect
          .poll(async () => (await dialog.boundingBox())?.x)
          .toBe(width === 390 ? 0 : 70);
        const closeMenu = dialog.getByRole("button", {
          name: "닫기",
          exact: true,
        });
        const topbarButton = page.locator(".mobile-menu");
        await expect(topbarButton).toHaveAttribute("aria-expanded", "true");
        await expect(closeMenu).not.toHaveCSS(
          "background-color",
          closedBackground,
        );
        const closeBackground = await closeMenu.evaluate(
          (button) => getComputedStyle(button).backgroundColor,
        );
        await expect(topbarButton).toHaveCSS(
          "background-color",
          closeBackground,
        );
        await closeMenu.click();
        await expect(dialog).toBeHidden();
        await expect(openMenu).toBeFocused();
      }
    }
  });
}

test("registration actions sit at the right edge of their filters", async ({
  page,
}) => {
  const screens = [
    ["tasks?q=확인", "업무 등록", "q", "확인"],
    ["members?tab=members&q=010", "회원 등록", "q", "010"],
    ["reservations?status=확정", "예약 등록", "status", "확정"],
    ["spaces?tab=seats&status=사용+가능", "좌석 등록", "status", "사용 가능"],
    [
      "spaces?tab=rooms&status=사용+가능",
      "스터디룸 등록",
      "status",
      "사용 가능",
    ],
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
            const padding = Number.parseFloat(
              getComputedStyle(bar).paddingRight,
            );
            const right = bar.getBoundingClientRect().right - padding;
            const button = bar.lastElementChild!.getBoundingClientRect();
            return (
              Math.abs(button.right - right) <= 1 && button.right <= innerWidth
            );
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
      ["employees", "박준호"],
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
    page.getByRole("table", { name: "상품 목록" }).getByRole("button", {
      name: "접근성 저장 검증",
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
  // 초대 폼은 오른쪽 패널로 옮겨 지점 선택과 함께 조작할 수 없으므로 화면 안에 있는 분류 등록 폼으로 확인한다.
  await page.goto("/app/gangnam/products?tab=categories");
  await page.getByLabel("분류 이름", { exact: true }).fill("보존할 입력");
  page.once("dialog", (d) => d.dismiss());
  await page.getByLabel("현재 지점", { exact: true }).selectOption("seongsu");
  await expect(page).toHaveURL(/\/gangnam\/products/);
  await expect(page.getByLabel("분류 이름", { exact: true })).toHaveValue(
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

test("menus show their controls without dedicated refresh buttons", async ({
  page,
}) => {
  const screens = [
    ["spaces?tab=rooms", "룸 운영 상태 필터"],
    ["spaces?tab=lockers", "사물함 점유 상태 필터"],
    ["spaces?tab=seats", "좌석 상태 필터"],
    ["reservations", "예약 상태 필터"],
    ["facilities", "시설 점검 검색"],
    ["inquiries", "고객 문의 검색"],
    ["notices", "공지 검색"],
    ["attendance?tab=attendance", "근태 상태"],
    ["attendance?tab=corrections", "기록 정정"],
    ["attendance?tab=substitutions", "대체근무"],
    ["attendance?tab=leaveRequests", "휴가 신청·승인"],
    ["employees?tab=invitations", "초대 이름·이메일 검색"],
  ];
  const main = page.locator("main#main");
  const refreshButtons = main.getByRole("button", { name: /새로고침$/ });
  const requestLists = ["기록 정정", "대체근무", "휴가 신청·승인"];
  await login(page);
  for (const [route, control] of screens) {
    await test.step(route, async () => {
      await page.goto(`/app/gangnam/${route}`);
      const content = requestLists.includes(control)
        ? main.getByRole("region", { name: control, exact: true })
        : main.getByLabel(control);
      await expect(content).toBeVisible();
      if (route === "attendance?tab=attendance") {
        await expect(
          main.getByRole("heading", { name: "나의 출퇴근" }),
        ).toBeVisible();
      }
      await expect(refreshButtons).toHaveCount(0);
    });
  }
  await page.goto("/app/gangnam/sales");
  await main.getByRole("tab", { name: "일별 마감", exact: true }).click();
  await expect(main.getByLabel("마감 목록 시작일")).toBeVisible();
  await expect(refreshButtons).toHaveCount(0);

  await page.goto("/app/gangnam/settings?tab=rooms");
  await expect(main.getByLabel("룸 운영 상태 필터")).toBeVisible();
  await expect(refreshButtons).toHaveCount(0);

  await page.goto("/app/gangnam/settings?tab=audit");
  await expect(main.getByText(/적용 기간 \(서울 날짜\)/)).toBeVisible();
  await expect(refreshButtons).toHaveCount(0);
});

test("space menu reselect and browser reload requery the current locker filters", async ({
  page,
}) => {
  const route = "/app/gangnam/spaces?tab=lockers&assignmentState=사용+가능";
  const lockerReads = () =>
    ["/api/lockers", "/api/lockers/occupancy"].map((path) =>
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === path &&
          (path !== "/api/lockers" ||
            url.searchParams.get("assignmentState") === "사용 가능") &&
          response.request().method() === "GET" &&
          response.ok()
        );
      }),
    );
  await login(page);
  await Promise.all([...lockerReads(), page.goto(route)]);
  const currentUrl = page.url();
  await Promise.all([
    ...lockerReads(),
    page.getByRole("link", { name: "공간 관리", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(currentUrl);
  await Promise.all([...lockerReads(), page.reload()]);
  await expect(page).toHaveURL(currentUrl);
});

test("room list can retry a failed read from its error message", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/gangnam/spaces?tab=rooms");
  const status = page.getByLabel("룸 운영 상태 필터");
  await expect(status).toBeVisible();
  const scenario = (value: "error" | "normal") =>
    page.evaluate(async (value) => {
      const url = "/src/mocks/store.ts";
      const { store } = await import(/* @vite-ignore */ url);
      store.scenario = value;
    }, value);
  await scenario("error");
  await status.selectOption("운영 중단");
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeVisible();
  await scenario("normal");
  const retryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/rooms" && response.ok(),
  );
  await retry.click();
  await retryResponse;
  await expect(retry).toHaveCount(0);
  await expect(status).toHaveValue("운영 중단");
});

test("workspace reads follow menu actions without a refresh control", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/"))
      reads.push(url.pathname + url.search);
  });
  await login(page);
  const nextTaskResponse = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/tasks" && response.ok(),
    );
  const initialResponse = nextTaskResponse();
  await page.goto("/app/gangnam/tasks?q=확인&page=2");
  await (await initialResponse).finished();
  const menu = page.getByRole("link", { name: "업무 관리", exact: true });
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole("button", { name: "화면 새로고침", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/^마지막 조회/)).toHaveCount(0);
  const taskReads = () => reads.filter((url) => url.startsWith("/api/tasks?"));
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

  const menuResponse = nextTaskResponse();
  await menu.click();
  await (await menuResponse).finished();
  expect(taskReads()).toHaveLength(initialReads + 1);
  expect(new Set(taskReads()).size).toBe(1);
  await expect(page).toHaveURL(/page=2/);

  await page.getByRole("link", { name: "대시보드" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  const entryResponse = nextTaskResponse();
  await page
    .getByRole("navigation", { name: "빠른 탐색", exact: true })
    .getByRole("link", { name: "업무", exact: true })
    .click();
  await (await entryResponse).finished();
  expect(taskReads().length).toBeGreaterThan(initialReads + 1);
  expect(
    reads.some((url) =>
      /\/workspace\/events|\/requests\/[^/]+\/events/.test(url),
    ),
  ).toBe(false);
});
