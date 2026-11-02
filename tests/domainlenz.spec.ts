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
test("standalone runs all 34 scenarios offline without network requests or runtime errors", async ({
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
