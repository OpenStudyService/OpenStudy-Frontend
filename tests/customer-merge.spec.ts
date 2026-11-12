import { test, expect } from "@playwright/test";

test("demo owner compares and merges duplicate customers", async ({ page }) => {
  const duplicatesResponse = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/customer-duplicates",
    );
  const duplicates = page.getByRole("button", { name: /중복 의심 \d+건/ });
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();

  const [initial] = await Promise.all([
    duplicatesResponse(),
    page.goto("/app/gangnam/members?tab=members"),
  ]);
  expect(await initial.json()).toMatchObject({ meta: { total: 0 } });
  await expect(duplicates).toHaveCount(0);
  await page.getByRole("tab", { name: "보유 이용권" }).click();

  const { target, absorbed, phone } = await page.evaluate(async () => {
    const phone = "010" + String(Date.now()).slice(-8);
    const { token } = await (await fetch("/api/auth/csrf")).json();
    async function create(name: string) {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ registeredBranchId: "gangnam", name, phone }),
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()) as { id: string; memberNo: string };
    }
    const target = await create("데모 대상");
    const absorbed = await create("데모 중복");
    return { target, absorbed, phone };
  });

  await page.getByRole("tab", { name: "회원 목록" }).click();
  const filters = page.locator(".filters").filter({ has: duplicates });
  const register = filters.getByRole("button", { name: "회원 등록" });
  await expect(duplicates).toHaveText("중복 의심 1건");
  await expect(register).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const duplicateBox = (await duplicates.boundingBox())!;
    const registerBox = (await register.boundingBox())!;
    const filtersBox = (await filters.boundingBox())!;
    const rightPadding = await filters.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingRight),
    );
    expect(duplicateBox.y).toBeCloseTo(registerBox.y, 0);
    expect(duplicateBox.x + duplicateBox.width).toBeLessThan(registerBox.x);
    expect(duplicateBox.x).toBeGreaterThanOrEqual(filtersBox.x);
    expect(registerBox.x + registerBox.width).toBeCloseTo(
      filtersBox.x + filtersBox.width - rightPadding,
      0,
    );
    expect(registerBox.x + registerBox.width).toBeLessThanOrEqual(width);
    if (width === 375) {
      const searchBox = (await filters.getByRole("searchbox").boundingBox())!;
      expect(duplicateBox.y).toBeGreaterThan(searchBox.y);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await duplicates.click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByRole("heading", { name: "중복 고객 확인" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "고객 비교: " + phone }).click();
  await panel
    .getByRole("combobox", { name: "남는 고객" })
    .selectOption(target.id);
  await panel
    .getByRole("combobox", { name: "흡수할 고객" })
    .selectOption(absorbed.id);
  await expect(panel.getByRole("note")).toContainText(
    "병합은 되돌릴 수 없어요",
  );
  await expect(
    panel.getByRole("heading", { name: "결제 이력 · 총 0건" }),
  ).toHaveCount(2);
  await expect(panel.getByRole("heading", { name: "이용권 이력" })).toHaveCount(
    2,
  );
  await panel
    .getByRole("textbox", { name: "병합 사유" })
    .fill("데모 중복 확인");
  const [refreshed] = await Promise.all([
    duplicatesResponse(),
    panel.getByRole("button", { name: "고객 병합", exact: true }).click(),
  ]);
  expect(await refreshed.json()).toMatchObject({ meta: { total: 0 } });
  await expect(panel.getByText("흡수된 고객 1명")).toBeVisible();

  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(duplicates).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "회원 상태 필터" })
    .selectOption("병합됨");
  await page.getByRole("button", { name: "데모 중복", exact: true }).click();
  await expect(panel.getByText("병합됨", { exact: true })).toBeVisible();
  await panel
    .getByRole("link", { name: `데모 대상 (${target.memberNo})` })
    .click();
  await expect(panel.getByText("흡수된 고객 1명")).toBeVisible();
});
