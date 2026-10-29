import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function login(page: Page, who: "사장님" | "직원") {
  await page.goto("/login");
  await page.getByRole("button", { name: `${who}으로 체험` }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
const isProductWrite =
  (method: string, path: RegExp) => (r: import("@playwright/test").Request) =>
    r.method() === method && path.test(new URL(r.url()).pathname);

test("owner registers a period pass, changes it, stops sales and reads the before/after history", async ({
  page,
}) => {
  await login(page, "사장님");
  await page.goto("/app/all/products");
  await expect(page.getByRole("heading", { name: "상품·요율" })).toBeVisible();
  await expect(
    page.getByText(/10시간\(600분\)|100시간\(6,000분\)/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /삭제/ })).toHaveCount(0);

  await page.getByRole("button", { name: "상품 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("상품명").fill("검증 4주 기간권");
  await dialog.getByLabel("판매 금액 (원)").fill("0");
  await dialog.getByLabel("상품 유형").selectOption("기간권");
  await dialog.getByLabel("이용 기간 (일)").fill("28");
  await dialog.getByLabel("분류").selectOption({ label: "기간권" });
  await dialog.getByLabel("강남점").check();
  await dialog.getByRole("button", { name: "상품 등록", exact: true }).click();
  await expect(dialog.getByText(/0원은 등록할 수 없어요/)).toBeVisible();
  await dialog.getByLabel("판매 금액 (원)").fill("90000");
  const created = page.waitForRequest(
    isProductWrite("POST", /^\/api\/products$/),
  );
  await dialog.getByRole("button", { name: "상품 등록", exact: true }).click();
  const request = await created;
  expect(request.headers()["idempotency-key"]).toBeTruthy();
  expect(request.postDataJSON()).toEqual({
    name: "검증 4주 기간권",
    priceKrw: 90000,
    terms: { kind: "기간권", periodDays: 28 },
    status: "판매 중",
    categoryId: "cat-period",
    branchIds: ["gangnam"],
  });
  await expect(dialog).not.toBeVisible();

  await page.getByLabel("상품명·코드 검색").fill("검증");
  await page
    .getByRole("button", { name: "상품 상세: 검증 4주 기간권" })
    .click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByLabel("상품 유형")).toBeDisabled();
  await detail.getByLabel("판매 금액 (원)").fill("95000");
  const patched = page.waitForRequest(
    isProductWrite("PATCH", /^\/api\/products\/[^/]+$/),
  );
  await detail.getByRole("button", { name: "상품 정보 저장" }).click();
  expect((await patched).postDataJSON()).toEqual({
    version: 1,
    priceKrw: 95000,
  });
  await expect(detail.getByText("상품 정보를 저장했어요.")).toBeVisible();

  await detail.getByRole("button", { name: "판매 중지", exact: true }).click();
  await detail.getByRole("button", { name: "중지 확인" }).click();
  await expect(detail.getByText("판매를 중지했어요.")).toBeVisible();
  await expect(detail.getByRole("button", { name: "판매 재개" })).toBeVisible();

  await expect(
    detail.getByText("판매 금액: 90,000원 → 95,000원"),
  ).toBeVisible();
  await expect(
    detail.getByText("판매 상태: 판매 중 → 판매 중지"),
  ).toBeVisible();
  await expect(detail.getByText(/v1 · 최초 등록/)).toBeVisible();
  await expect(detail.getByRole("button", { name: /삭제/ })).toHaveCount(0);
});

test("a staff member sees only the branch's products and cannot manage sale status or history", async ({
  page,
}) => {
  await login(page, "직원");
  await page.goto("/app/all/products");
  await expect(page.getByRole("heading", { name: "상품·요율" })).toBeVisible();
  await expect(page.getByRole("button", { name: /삭제/ })).toHaveCount(0);
  const product = page.getByRole("button", { name: /^상품 상세:/ }).first();
  await product.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "판매 중지" })).toHaveCount(
    0,
  );
  await expect(dialog.getByRole("heading", { name: "변경 이력" })).toHaveCount(
    0,
  );
});

test("category conflict compares the current name and preserves another editor's status", async ({
  page,
}) => {
  await login(page, "사장님");
  await page.goto("/app/all/products?tab=categories");
  const category = await page.evaluate(async () => {
    const { token } = await fetch("/api/auth/csrf").then((r) => r.json());
    const response = await fetch("/api/product-categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        code: "CONFLICT_UI",
        name: "충돌 검증 분류",
        kind: "시간권",
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  await page.reload();
  await page.getByRole("button", { name: "분류 수정: 충돌 검증 분류" }).click();
  const editor = page.getByRole("form", { name: "분류 이름 편집" });
  await editor.getByLabel("분류 이름 변경").fill("입력을 유지한 분류");
  await page.evaluate(async (category) => {
    const { token } = await fetch("/api/auth/csrf").then((r) => r.json());
    const response = await fetch(`/api/product-categories/${category.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({
        version: category.version,
        name: "다른 창의 분류",
        status: "비활성",
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, category);
  await editor.getByRole("button", { name: "이름 저장" }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "다른 사용자가 수정했습니다",
  );
  await expect(editor.getByLabel("분류 이름 변경")).toHaveValue(
    "입력을 유지한 분류",
  );
  await expect(
    editor.getByRole("button", { name: "이름 저장" }),
  ).toBeDisabled();
  await editor
    .getByRole("button", { name: "최신 버전 확인 (입력 유지)" })
    .click();
  await expect(editor.getByRole("status")).toContainText(
    "다른 창의 분류 / 비활성 (v2)",
  );
  const saved = page.waitForRequest(
    isProductWrite("PATCH", /\/product-categories\/[^/]+$/),
  );
  await editor.getByRole("button", { name: "최신 기준으로 이름 저장" }).click();
  expect((await saved).postDataJSON()).toEqual({
    version: 2,
    name: "입력을 유지한 분류",
  });
  await expect(editor).not.toBeVisible();
  const card = page
    .locator("article")
    .filter({ hasText: "입력을 유지한 분류" });
  await expect(card.getByText("비활성", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator("article")
      .filter({ hasText: "입력을 유지한 분류" })
      .getByText("비활성", { exact: true }),
  ).toBeVisible();
});
