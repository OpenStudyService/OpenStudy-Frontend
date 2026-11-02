import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, role = "사장님") {
  await page.goto("/login");
  await page.getByRole("button", { name: `${role}으로 체험` }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}
async function api(page: Page, path: string, body?: object) {
  return page.evaluate(
    async ({ path, body }) => {
      const { token } = await (await fetch("/api/auth/csrf")).json();
      const response = await fetch(
        `/api${path}`,
        body
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": token,
                "Idempotency-Key": crypto.randomUUID(),
              },
              body: JSON.stringify(body),
            }
          : undefined,
      );
      return { status: response.status, data: await response.json() };
    },
    { path, body },
  );
}
async function purchase(page: Page, productId = "time100") {
  const response = await api(page, "/payments", {
    customerId: "member-2",
    branchId: "gangnam",
    productId,
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(response.status).toBe(201);
  return response.data;
}
test("adjustments persist in shared demo views and history filters use UTC boundaries", async ({
  page,
}) => {
  await login(page);
  const payment = await purchase(page);
  await page.goto(`/app/gangnam/members?tab=passes&detail=${payment.passId}`);
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "이용권 조정", exact: true }).click();
  await panel.getByLabel("조정 후 남은 시간 (분)").fill("700");
  await panel.getByLabel("조정 사유 (필수)").fill("E2E 잔량 보정");
  await panel.getByRole("button", { name: "조정 저장", exact: true }).click();
  await expect(
    panel.getByRole("form", { name: "이용권 수동 조정" }),
  ).toHaveCount(0);
  await expect(panel.getByText("700분", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("tab", { name: /회원/ }).click();
  await page.getByRole("button", { name: "이서준", exact: true }).click();
  await panel.getByRole("button", { name: "구매·사용 내역 보기" }).click();
  await expect(
    panel.getByText("사유: E2E 잔량 보정", { exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .getByRole("table", { name: "이용권 전체 원장 대조" })
      .getByText("일치", { exact: true })
      .first(),
  ).toBeVisible();
  await panel
    .getByLabel("조회 시작 (한국 시각, 포함)")
    .fill("2099-01-01T09:00");
  const request = page.waitForRequest(
    (r) => r.url().includes("/pass-history?") && r.url().includes("2099"),
  );
  await panel.getByRole("button", { name: "기간 적용", exact: true }).click();
  expect(new URL((await request).url()).searchParams.get("from")).toBe(
    "2099-01-01T00:00:00.000Z",
  );
  await expect(
    panel.getByText("선택한 기간의 내역이 없어요", { exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .getByRole("table", { name: "이용권 전체 원장 대조" })
      .getByText("일치", { exact: true })
      .first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("button", { name: "전체 기간", exact: true }).click();
  await expect(
    panel.getByText("사유: E2E 잔량 보정", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "qa-artifacts/history-msw/customer-mobile.png",
    fullPage: true,
  });
});
test("history lists scoped usage with purchase branch, stable filters and readonly movement detail", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/all/spaces?tab=usage");
  const table = page.getByRole("table", { name: "입퇴실 이력", exact: true });
  await expect(
    table.getByRole("cell", { name: "김지우 DEMO-member-1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("이용 지점 필터").selectOption("gangnam");
  await page.getByLabel("이용 상태 필터").selectOption("이용 중");
  await expect(table.getByText("퇴실 시 확정", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "김지우 이용 상세", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("이동 이력이 없어요.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(/이용 지점: 강남점 · 구매 지점: 강남점/),
  ).toBeVisible();
  await page.screenshot({
    path: "qa-artifacts/history-msw/seat-history-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("이용 상태 필터")).toHaveValue("이용 중");
});
test("read-only staff and refunded passes have no adjustment action", async ({
  page,
}) => {
  await login(page);
  const payment = await purchase(page);
  expect(
    (await api(page, `/payments/${payment.id}/refund`, { reason: "환불 검증" }))
      .status,
  ).toBe(200);
  await page.goto(`/app/gangnam/members?tab=passes&detail=${payment.passId}`);
  await expect(
    page.getByRole("dialog").getByText("환불", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이용권 조정", exact: true }),
  ).toHaveCount(0);
  await api(page, "/auth/logout", {});
  await login(page, "직원");
  await page.goto("/app/gangnam/members?tab=passes&detail=pass-1");
  await expect(
    page.getByRole("dialog").getByText("보유 이용권 상세", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이용권 조정", exact: true }),
  ).toHaveCount(0);
});
