import { expect, test } from "@playwright/test";

for (const [account, canManage, owner] of [
  ["owner", true, true],
  ["minji", true, false],
  ["junho", false, false],
] as const) {
  test(`settings and operations navigation for ${account}`, async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .getByLabel("이메일", { exact: true })
      .fill(`${account}@openstudy.test`);
    await page.locator('input[type="password"]').fill("demo12345");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/[^/]+\/home$/);
    await page.goto("/app/gangnam/home");

    await expect(
      page.getByRole("link", { name: "지점 관리", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "변경 이력", exact: true }),
    ).toHaveCount(owner ? 1 : 0);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/app/gangnam/home");
      const settingsLink = page
        .getByRole("navigation", {
          name: width === 390 ? "모바일 빠른 탐색" : "빠른 탐색",
          exact: true,
        })
        .getByRole("link", { name: "설정", exact: true });
      await expect(settingsLink).toBeVisible();
      await expect(page.locator('.topbar a[href$="/settings"]')).toHaveCount(0);
      if (width === 390) {
        await page.getByRole("button", { name: "메뉴 열기" }).click();
        await expect(
          page.getByRole("dialog").locator('a[href$="/settings"]'),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
      }
      await settingsLink.click();
      await expect(page).toHaveURL(/\/app\/gangnam\/settings$/);
      await expect(
        page.getByRole("heading", { name: "개인 설정" }),
      ).toBeVisible();
      await expect(settingsLink).toHaveAttribute("aria-current", "page");
      const personalSections = page.locator("main h2");
      await expect(personalSections).toHaveText([
        "화면 테마",
        "내 프로필",
        "비밀번호 변경",
      ]);
      await page.getByRole("button", { name: "사용자 메뉴" }).click();
      await expect(
        page.getByRole("menuitem", { name: "개인 설정" }),
      ).toBeVisible();
      await page.getByRole("menuitem", { name: "데모·검증 도구" }).click();
      await expect(page).toHaveURL(/\/app\/gangnam\/demo-tools$/);
      await expect(
        page.getByRole("combobox", { name: "체험 계정" }),
      ).toHaveValue(account);
    }

    await page.goto("/app/gangnam/settings?branchSearch=강남&branchPage=1");
    await expect(page).toHaveURL(/\/app\/gangnam\/branches\?/);
    await expect(page.getByLabel("지점 검색")).toHaveValue("강남");
    await expect(
      page.getByRole("button", {
        name: canManage ? "휴무일 관리: 강남점" : "휴무일 보기: 강남점",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "지점 수정: 강남점" }),
    ).toHaveCount(canManage ? 1 : 0);
    await expect(
      page.getByRole("button", { name: "지점 등록", exact: true }),
    ).toHaveCount(owner ? 1 : 0);

    const roomQuery = new URLSearchParams({
      tab: "rooms",
      status: "사용 가능",
      page: "1",
    });
    await page.goto("/app/gangnam/settings?" + roomQuery);
    await expect(page).toHaveURL(/\/app\/gangnam\/spaces\?/);
    await expect(page.getByRole("tab", { name: "스터디룸" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("룸 운영 상태 필터")).toHaveValue("사용 가능");
    await expect(
      page.getByRole("button", { name: "스터디룸 등록", exact: true }),
    ).toHaveCount(canManage ? 1 : 0);

    roomQuery.set("detail", "gangnam-room-a");
    await page.goto("/app/gangnam/settings?" + roomQuery);
    const room = page.getByRole("dialog", { name: "스터디룸 A" });
    await expect(room).toBeVisible();
    await expect(room.getByRole("button", { name: "수정하기" })).toHaveCount(
      canManage ? 1 : 0,
    );

    if (owner) {
      await page.goto(
        "/app/gangnam/settings?tab=audit&requestId=mock-audit-request&detail=1",
      );
      await expect(page).toHaveURL(
        /\/app\/gangnam\/audit\?requestId=mock-audit-request&detail=1$/,
      );
      const detail = page.getByRole("dialog", { name: "변경 이력 상세" });
      await detail.getByRole("button", { name: "같은 요청 보기" }).click();
      await expect(detail).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "변경 이력", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/적용 기간 \(서울 날짜\)/)).toBeVisible();
      const url = new URL(page.url());
      expect(url.pathname).toBe("/app/gangnam/audit");
      expect(url.searchParams.get("requestId")).toBe("mock-audit-request");
      expect(url.searchParams.has("from")).toBe(true);
      const filters = page.getByRole("form", { name: "감사 로그 검색 조건" });
      await filters
        .getByRole("button", { name: "초기화", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app\/gangnam\/audit$/);
      const table = page.getByRole("table", { name: "변경 이력 검색 결과" });
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(table).toBeVisible();
        await expect(
          filters.getByRole("button", { name: "검색", exact: true }),
        ).toBeVisible();
        const viewport = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          contentWidth: document.documentElement.scrollWidth,
        }));
        expect(viewport.contentWidth).toBeLessThanOrEqual(viewport.width);
      }
      await table
        .getByRole("button", { name: "감사 기록 1 상세: PROFILE_UPDATED" })
        .click();
      await expect(detail).toBeVisible();
    } else {
      const auditRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/audit-events")) {
          auditRequests.push(request.url());
        }
      });
      for (const route of ["settings?tab=audit&detail=5", "audit?detail=5"]) {
        await page.goto("/app/gangnam/" + route);
        await expect(
          page.getByText("변경 이력을 볼 권한이 없어요"),
        ).toBeVisible();
      }
      expect(auditRequests).toEqual([]);
    }
  });
}
