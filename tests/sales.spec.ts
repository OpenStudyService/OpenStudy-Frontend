import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("sales shared ledger, filters, empty period and keyboard access across themes and widths", async ({
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
    await expect(
      page.getByRole("table", { name: "매출 근거 승인·환불 항목" }),
    ).toBeVisible();
    await expect(
      page.getByText("매출 응답을 확인할 수 없어요", { exact: false }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
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
  await page.getByLabel("환불 집계 기준").selectOption("paymentDate");
  await expect(page).toHaveURL(/refundBasis=paymentDate/);
  await page.reload();
  await expect(page.getByLabel("환불 집계 기준")).toHaveValue("paymentDate");
  await page.goto("/app/all/sales?from=2020-01-01&to=2020-01-02");
  await expect(
    page.getByText("조회 조건에 맞는 거래가 없어요", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /지점별 순매출/ })).toHaveCount(0);
});
