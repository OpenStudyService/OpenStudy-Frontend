import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import fixture from "../docs/domainlenz/natural-language-tests.json" with { type: "json" };
const offline = pathToFileURL(
  resolve("docs/domainlenz/OpenStudy_DomainLenz_Demo.html"),
).href;
const shots = resolve("docs/domainlenz/screenshots");
test("channel integration keeps ordinary chat, private query and immutable shared snapshot separate", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await page.goto("/app/all/chat/general");
  const input = page.getByRole("textbox", { name: "메시지", exact: true });
  await input.fill("일반 채팅 회귀 확인");
  await page.getByRole("button", { name: /보내기/ }).click();
  await expect(
    page.locator(".message").filter({ hasText: "일반 채팅 회귀 확인" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "✦ AI 질문", exact: true }).click();
  await page
    .getByRole("button", { name: /지난달 지점별 순매출을 보여줘/ })
    .click();
  await expect(input).toHaveValue("@DomainLenz 지난달 지점별 순매출을 보여줘");
  await page.getByRole("button", { name: /보내기/ }).click();
  await expect(
    page.locator('.dl-answer [data-scenario="sales-net"]'),
  ).toBeVisible();
  await expect(page.locator(".dl-answer .dl-kpis")).toContainText(
    "29,200,000원",
  );
  await page.getByRole("button", { name: "채널에 공유 ↗" }).click();
  const shared = page.getByLabel("채널에 공유된 AI 결과");
  await expect(shared.locator(".dl-kpis")).toContainText("29,200,000원");
  await page.getByRole("button", { name: "강남점만 보기 ↗" }).click();
  await expect(
    page
      .locator('.dl-answer [data-scenario="sales-net"]')
      .last()
      .locator(".dl-kpis"),
  ).toContainText("17,200,000원");
  await expect(shared.locator(".dl-kpis")).toContainText("29,200,000원");
  await page.getByRole("button", { name: "성수점만 보기 ↗" }).last().click();
  await expect(
    page
      .locator('.dl-answer [data-scenario="sales-net"]')
      .last()
      .locator(".dl-kpis"),
  ).toContainText("12,000,000원");
  await page.goto("/app/gangnam/chat/gangnam");
  await expect(page.locator(".dl-result")).toHaveCount(0);
  await input.fill("@DomainLenz 지난달 지점별 순매출을 보여줘");
  await page.getByRole("button", { name: /보내기/ }).click();
  await expect(page.locator(".dl-kpis")).toContainText("17,200,000원");
  await page.getByRole("button", { name: "성수점만 보기 ↗" }).click();
  await expect(
    page.getByText("현재 채널의 지점 범위를 넓힐 수 없습니다."),
  ).toBeVisible();
});
test("standalone runs all 36 scenarios offline without network requests or runtime errors", async ({
  page,
  context,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await context.setOffline(true);
  for (const c of fixture.cases) {
    await page.goto(offline);
    await page
      .getByRole("textbox", { name: "메시지", exact: true })
      .fill(`@DomainLenz ${c.prompt}`);
    await page.getByRole("button", { name: "보내기 ↗", exact: true }).click();
    if (c.expected.displayResult) {
      const card = page.locator(`[data-scenario="${c.id}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator("tbody tr")).toHaveCount(
        Math.min(5, c.expected.rowCount),
      );
      if (c.outcome === "fallback")
        await expect(card.locator(".dl-eyebrow")).toContainText(
          "TABLE FALLBACK",
        );
      if (c.id === "customers-restricted") {
        await card.getByRole("button", { name: "다음", exact: true }).click();
        await expect(card.getByText("M-DEMO-006")).toBeVisible();
        await card
          .getByRole("button", { name: "가상회원 6** 상세보기" })
          .click();
        await expect(card.getByLabel("조회 항목 상세")).toContainText(
          "M-DEMO-006",
        );
      }
    } else {
      await expect(page.locator(`.dl-state-${c.outcome}`)).toBeVisible();
      await expect(page.locator(".dl-result")).toHaveCount(0);
    }
  }
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("v8 layout resizes panels and renders heatmap, seats, calendar, trace and domain navigation", async ({
  page,
  context,
}) => {
  await mkdir(shots, { recursive: true });
  await context.setOffline(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(offline);
  await expect(
    page.locator(".v8-recommendations .dl-showcase-grid>button"),
  ).toHaveCount(6);
  await page.screenshot({ path: resolve(shots, "05-v8-workspace.png") });
  await page.getByRole("slider", { name: "대화 화면 가로 너비" }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".v8-size-toolbar output")).toHaveText("1560px");
  await page.getByRole("button", { name: "초기화", exact: true }).click();
  await page.getByRole("separator").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("separator")).toHaveAttribute(
    "aria-valuenow",
    "324",
  );
  await page.getByRole("button", { name: "입력창 높이 늘리기" }).click();
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toHaveCSS("height", "88px");
  await page.getByRole("button", { name: "입력창 높이 줄이기" }).click();
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toHaveCSS("height", "64px");
  await page.getByRole("button", { name: /언제 이용이 가장 많을까/ }).click();
  await expect(
    page.getByRole("textbox", { name: "메시지", exact: true }),
  ).toHaveValue("@DomainLenz 지난주 요일·시간대별 좌석 이용 건수를 보여줘");
  await page.getByRole("button", { name: "보내기 ↗", exact: true }).click();
  const heat = page.locator('[data-scenario="seats-heatmap"]');
  await expect(heat.locator(".dl-heatmap button")).toHaveCount(35);
  await expect(page.locator(".v8-recommendations")).toHaveCount(0);
  await heat.locator(".dl-heatmap button").first().click();
  await expect(heat.getByRole("status")).toContainText("월요일 09–12시");
  await page.screenshot({ path: resolve(shots, "06-v8-heatmap.png") });
  await page.locator(".v8-trace-trigger").click();
  await expect(page.getByRole("dialog")).toContainText(
    "seat_sessions.effective_checked_in_at",
  );
  await page.screenshot({ path: resolve(shots, "09-v8-trace.png") });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "채널에 공유 ↗", exact: true })
    .click();
  await page
    .locator(".v8-sidebar nav")
    .getByRole("button", { name: /공유 기록/ })
    .click();
  await expect(page.locator(".v8-record .dl-heatmap button")).toHaveCount(35);
  await page
    .locator(".v8-sidebar nav")
    .getByRole("button", { name: /DB 도메인/ })
    .click();
  await expect(page.locator(".v8-domain-grid>details")).toHaveCount(13);
  await page.getByText("좌석·입퇴실", { exact: true }).click();
  await expect(page.locator(".v8-domain-grid")).toContainText(
    "effective_checked_in_at",
  );
  await page
    .locator(".v8-sidebar nav")
    .getByRole("button", { name: /업무 AI/ })
    .click();
  const input = page.getByRole("textbox", { name: "메시지", exact: true });
  await input.fill("현재 지점별 좌석 이용 현황을 보여줘");
  await page.getByRole("button", { name: "보내기 ↗", exact: true }).click();
  const seats = page.locator('.dl-answer [data-scenario="seats-now"]');
  await expect(seats.locator(".dl-seat-grid button")).toHaveCount(80);
  await expect(seats.locator(".dl-seat-grid .available")).toHaveCount(24);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect((await page.locator(".v8-topbar").boundingBox())?.y).toBe(0);
  await page.screenshot({ path: resolve(shots, "07-v8-seatmap.png") });
  await input.fill("오늘의 스터디룸 예약을 보여줘");
  await page.getByRole("button", { name: "보내기 ↗", exact: true }).click();
  const calendar = page.locator('.dl-answer [data-scenario="rooms-today"]');
  await expect(calendar.locator(".dl-week-calendar>section")).toHaveCount(7);
  await expect(calendar.locator(".dl-week-calendar article")).toHaveCount(3);
  await page.screenshot({ path: resolve(shots, "08-v8-calendar.png") });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(page.locator(".v8-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "메뉴 닫기" }).click();
  await expect(page.locator(".v8-sidebar")).not.toBeVisible();
  await page.screenshot({ path: resolve(shots, "10-v8-mobile-workspace.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("v8 guided workflow completes three queries and records their terminal states", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.goto(offline);
  await page.getByRole("button", { name: /워크플로/ }).click();
  await expect(
    page.locator('.dl-answer [data-scenario="sales-net"]'),
  ).toBeVisible();
  await expect(
    page.locator('.dl-answer [data-scenario="seats-heatmap"]'),
  ).toBeVisible();
  await expect(
    page.locator('.dl-answer [data-scenario="products-top5"]'),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /워크플로/ })).toBeVisible();
  await page.locator(".v8-trace-trigger").click();
  await expect(page.locator(".v8-trace-list>div")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: /워크플로/ }).click();
  await page.getByRole("button", { name: "조회 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: /워크플로/ })).toBeVisible();
  await page.waitForTimeout(1900);
  await expect(page.locator(".dl-conversation")).toHaveCount(1);
  await expect(page.locator(".dl-result")).toHaveCount(0);
});
test("offline gallery, keyboard focus, shared access and responsive layouts", async ({
  page,
  context,
}) => {
  await mkdir(shots, { recursive: true });
  await context.setOffline(true);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(offline);
  await page.getByRole("button", { name: "✦ AI 질문", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: resolve(shots, "01-question-gallery.png") });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "✦ AI 질문", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "메시지", exact: true })
    .fill("@DomainLenz 지난달 지점별 순매출을 보여줘");
  await page.keyboard.press("Enter");
  await expect(page.locator(".dl-kpis")).toContainText("29,200,000원");
  await page.screenshot({ path: resolve(shots, "02-chat-result.png") });
  await page.getByRole("button", { name: "채널에 공유 ↗" }).click();
  await page.getByLabel("시연 사용자").selectOption("staff");
  await expect(page.getByText(/공유된 결과를 볼 권한/)).toBeVisible();
  await expect(page.locator(".dl-question")).toHaveCount(0);
  await page.getByLabel("시연 사용자").selectOption("owner");
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("textbox", { name: "메시지", exact: true })
    .fill("@DomainLenz 현재 지점별 좌석 이용 현황을 보여줘");
  await page.getByRole("button", { name: "보내기 ↗", exact: true }).click();
  await expect(page.locator(".dl-result")).toBeVisible();
  await page.screenshot({ path: resolve(shots, "03-mobile-result.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "✦ AI 질문", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: resolve(shots, "04-mobile-gallery.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
