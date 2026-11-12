import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("sales tabs retain filters and fit desktop, tablet and mobile widths", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  for (const [theme, width] of [
    ["forest", 1440],
    ["navy", 1024],
    ["sand", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app/all/settings");
    await page
      .getByRole("button", {
        name:
          theme === "forest"
            ? /포레스트 차분한/
            : theme === "navy"
              ? /네이비 또렷한/
              : /샌드 따뜻한/,
      })
      .click();
    await page.goto("/app/all/sales?from=2026-09-01&to=2026-10-01");
    const summary = page.getByRole("region", {
      name: "매출 요약",
      exact: true,
    });
    await expect(
      summary.getByText("400,000원", { exact: true }).first(),
    ).toBeVisible();
    const hasNoHorizontalOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    await expect(
      page.getByRole("table", { name: "지점별 매출 상세 금액과 건수" }),
    ).toBeVisible();
    expect(await hasNoHorizontalOverflow()).toBe(true);
    const summaryTab = page.getByRole("tab", { name: "요약", selected: true });
    await expect(summaryTab).toHaveClass(/\bactive\b/);
    const filters = page.getByRole("region", { name: "매출 조회 조건" });
    await filters.getByLabel("환불 집계 기준").selectOption("paymentDate");
    await filters.getByLabel("결제 용도").selectOption("이용권");
    await summaryTab.focus();
    await page.keyboard.press("ArrowRight");
    for (const [tab, view, table] of [
      ["판매 분석", "sales", "이용권 상품 판매 순위"],
      ["추세", "trend", "순매출 추세 상세"],
      ["원장", "ledger", "매출 근거 승인·환불 항목"],
    ]) {
      const trigger = page.getByRole("tab", { name: tab });
      if (view !== "sales") await trigger.click();
      await expect(trigger).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(new RegExp(`[?&]view=${view}`));
      await expect(page.getByRole("tabpanel", { name: tab })).toHaveCount(1);
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      await expect(page.getByRole("table", { name: table })).toBeVisible();
      await expect(summary).toHaveCount(0);
      await expect(filters.getByLabel("시작일")).toHaveValue("2026-09-01");
      await expect(filters.getByLabel("종료일 (미포함)")).toHaveValue(
        "2026-10-01",
      );
      await expect(filters.getByLabel("환불 집계 기준")).toHaveValue(
        "paymentDate",
      );
      await expect(filters.getByLabel("결제 용도")).toHaveValue("이용권");
      expect(await hasNoHorizontalOverflow()).toBe(true);
    }
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "원장", selected: true }),
    ).toBeVisible();
    await expect(filters.getByLabel("환불 집계 기준")).toHaveValue(
      "paymentDate",
    );
    await expect(filters.getByLabel("결제 용도")).toHaveValue("이용권");
    await expect(
      page.getByRole("table", { name: "매출 근거 승인·환불 항목" }),
    ).toBeVisible();
    await expect(
      page.getByText("매출 응답을 확인할 수 없어요", { exact: false }),
    ).toHaveCount(0);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await page.screenshot({
      path: `qa-artifacts/sales-mock/${theme}-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/app/all/sales?from=2020-01-01&to=2020-01-02&view=ledger");
  await expect(
    page.getByText("조회 조건에 맞는 거래가 없어요", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /지점별 순매출/ })).toHaveCount(0);
});
