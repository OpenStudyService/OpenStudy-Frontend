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
    const tabList = page.getByRole("tablist", { name: "매출 조회 화면" });
    await expect(tabList.getByRole("tab")).toHaveText([
      "요약",
      "판매 분석",
      "추세",
      "원장",
      "일별 마감",
      "이용권 사용량",
    ]);
    const tabListBox = (await tabList.boundingBox())!;
    const filtersBox = (await filters.boundingBox())!;
    expect(tabListBox.y + tabListBox.height).toBeLessThanOrEqual(filtersBox.y);
    expect(
      await tabList.getByRole("tab").evaluateAll((tabs) =>
        tabs.every((tab) => {
          const rect = tab.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.right <= window.innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight
          );
        }),
      ),
    ).toBe(true);
    const advanced = filters.getByRole("button", {
      name: "고급 필터",
      exact: true,
    });
    const branchGroup = filters.getByRole("group", { name: "집계 지점" });
    const branchBox = (await branchGroup.boundingBox())!;
    expect((await advanced.boundingBox())!.y).toBeGreaterThanOrEqual(
      branchBox.y + branchBox.height,
    );
    const advancedPanel = filters.getByRole("region", {
      name: "매출 고급 필터",
    });
    await expect(advancedPanel).toBeHidden();
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await advanced.click();
    await expect(advancedPanel).toBeVisible();
    await expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect((await filters.boundingBox())!.height).toBeGreaterThan(
      filtersBox.height,
    );
    expect(await hasNoHorizontalOverflow()).toBe(true);
    for (const [field, choice] of [
      ["결제 수단", "카드"],
      ["상품 유형", "시간권"],
      ["환불 처리 지점", "강남점"],
    ]) {
      await advancedPanel
        .getByRole("button", { name: `${field}, 전체` })
        .click();
      const dropdown = page.getByRole("dialog", { name: field, exact: true });
      const checkbox = dropdown.getByRole("checkbox", { name: choice });
      await checkbox.click();
      await expect(checkbox).toBeChecked();
      await checkbox.click();
      await expect(checkbox).not.toBeChecked();
      await page.keyboard.press("Escape");
      await expect(dropdown).toBeHidden();
      await expect(advancedPanel).toBeVisible();
    }
    await advanced.press("Space");
    await expect(advancedPanel).toBeHidden();
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await expect(advanced).toBeFocused();
    await filters.getByLabel("환불 집계 기준").selectOption("paymentDate");
    await expect(page).toHaveURL(/refundBasis=paymentDate/);
    await filters.getByLabel("결제 용도").selectOption("이용권");
    await expect(page).toHaveURL(/[?&]purpose=/);
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
    const ledgerTab = page.getByRole("tab", { name: "원장" });
    await ledgerTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/[?&]view=daily-closings/);
    await expect(page.getByLabel("마감 목록 시작일")).toBeVisible();
    await expect(filters).toHaveCount(0);
    expect(await hasNoHorizontalOverflow()).toBe(true);

    await page.getByRole("tab", { name: "이용권 사용량" }).click();
    await expect(page).toHaveURL(/[?&]view=pass-usage/);
    await page.reload();
    const usageTab = page.getByRole("tab", {
      name: "이용권 사용량",
      selected: true,
    });
    await expect(usageTab).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "이용 지점별 이용권 사용량" }),
    ).toBeVisible();
    const usageFilters = page.getByRole("region", {
      name: "이용권 사용량 조회 조건",
    });
    await expect(usageFilters.getByLabel("시작일")).toHaveValue("2026-09-01");
    await expect(
      usageFilters.getByRole("button", { name: "상품 유형, 전체" }),
    ).toBeVisible();
    await expect(page.getByLabel("환불 집계 기준")).toHaveCount(0);
    expect(await hasNoHorizontalOverflow()).toBe(true);

    await ledgerTab.click();
    await expect(filters.getByLabel("환불 집계 기준")).toHaveValue(
      "paymentDate",
    );
    await expect(filters.getByLabel("결제 용도")).toHaveValue("이용권");
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
