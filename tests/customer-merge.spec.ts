import { test, expect } from "@playwright/test";

test("demo owner compares and merges duplicate customers", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();

  await page.goto("/app/gangnam/members?tab=members");
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

  await page.getByRole("button", { name: "중복 고객 확인" }).click();
  const panel = page.getByRole("dialog");
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
  await panel.getByRole("button", { name: "고객 병합", exact: true }).click();
  await expect(panel.getByText("흡수된 고객 1명")).toBeVisible();

  await panel.getByRole("button", { name: "닫기" }).click();
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
