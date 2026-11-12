import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

const password = process.env.HISTORY_LIVE_PASSWORD;
test.beforeAll(() => {
  if (!password)
    throw new Error(
      "Prepare isolated fixtures and HISTORY_LIVE_PASSWORD using docs/testing/pass-history-live.md.",
    );
});
async function login(browser: Browser, email = "owner@history.test") {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:15183",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return { context, page };
}
async function api(
  context: BrowserContext,
  path: string,
  body?: object,
  key = randomUUID(),
) {
  if (!body) return context.request.get(`/api${path}`);
  const { token } = await (await context.request.get("/api/auth/csrf")).json();
  return context.request.post(`/api${path}`, {
    headers: { "X-CSRF-Token": token, "Idempotency-Key": key },
    data: body,
  });
}
async function fixture(context: BrowserContext, kind = "시간권") {
  const suffix = randomUUID().slice(0, 8);
  const customerResponse = await api(context, "/customers", {
    registeredBranchId: "1",
    name: `History ${suffix}`,
    phone: "01099881234",
  });
  expect(customerResponse.status()).toBe(201);
  const customer = await customerResponse.json();
  const categoryResponse = await api(context, "/product-categories", {
    code: `H${suffix.toUpperCase()}`,
    name: `History ${suffix}`,
    kind,
  });
  expect(categoryResponse.status()).toBe(201);
  const category = await categoryResponse.json();
  const terms =
    kind === "시간권"
      ? { kind, includedMinutes: 600, validDays: null }
      : kind === "정액권"
        ? { kind, creditKrw: 10000, hourlyRateKrw: 1500, validDays: null }
        : { kind, periodDays: 28 };
  const productResponse = await api(context, "/products", {
    name: `History ${kind} ${suffix}`,
    priceKrw: 10000,
    terms,
    status: "판매 중",
    categoryId: category.id,
    branchIds: ["1"],
  });
  expect(productResponse.status()).toBe(201);
  const product = await productResponse.json();
  const paymentResponse = await api(context, "/payments", {
    customerId: customer.id,
    branchId: "1",
    productId: product.id,
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(paymentResponse.status()).toBe(201);
  const payment = await paymentResponse.json();
  return { customer, payment, product };
}

test("real adjustment persists, history reconciles and cross-branch seat history distinguishes purchase/use scope", async ({
  browser,
}) => {
  const owner = await login(browser),
    staff = await login(browser, "staff@history.test"),
    cashier = await login(browser, "cashier@history.test");
  try {
    const { customer, payment } = await fixture(owner.context);
    await owner.page.goto(`/app/1/members?tab=passes&detail=${payment.passId}`);
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByRole("button", { name: "이용권 조정", exact: true })
      .click();
    await panel.getByLabel("조정 후 남은 시간 (분)").fill("700");
    await panel.getByLabel("조정 사유 (필수)").fill("실제 DB 잔량 보정");
    await panel.getByRole("button", { name: "조정 저장", exact: true }).click();
    await expect(panel.getByRole("form")).toHaveCount(0);
    await expect(panel.getByText("700분", { exact: true })).toBeVisible();
    await owner.page.reload();
    await expect(panel.getByText("700분", { exact: true })).toBeVisible();
    const seatResponse = await api(owner.context, "/seats", {
      branchId: "2",
      zone: "History",
      seatNo: `H-${randomUUID().slice(0, 8)}`,
      kind: "일반",
      status: "사용 가능",
    });
    expect(seatResponse.status()).toBe(201);
    const seat = await seatResponse.json();
    const incoming = await api(owner.context, "/seat-sessions", {
      seatId: seat.id,
      customerId: customer.id,
      passId: payment.passId,
      reason: "입실 검증",
    });
    expect(incoming.status()).toBe(201);
    const session = await incoming.json();
    expect(
      (
        await api(owner.context, `/seat-sessions/${session.id}/check-out`, {
          reason: "타 지점 퇴실 사유",
        })
      ).status(),
    ).toBe(200);
    await owner.page.goto(`/app/1/members?tab=members&detail=${customer.id}`);
    await panel.getByRole("button", { name: "구매·사용 내역 보기" }).click();
    await expect(
      panel.getByText("사유: 실제 DB 잔량 보정", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("다른 지점 이용은 지점·일시·증감량만 표시해요.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.getByText(/타 지점 퇴실 사유/)).toHaveCount(0);
    await expect(
      panel
        .getByRole("table", { name: "이용권 전체 원장 대조" })
        .getByText("일치", { exact: true }),
    ).toBeVisible();
    const history = await (
      await api(owner.context, `/customers/${customer.id}/pass-history?scope=1`)
    ).json();
    const ledger = history.passes[0];
    expect(ledger.issuedMinutes + ledger.ledgerMinutes).toBe(
      ledger.remainingMinutes,
    );
    const outside = history.events.find(
      (e: { type: string }) => e.type === "이용",
    );
    expect(outside).toMatchObject({
      branchId: "2",
      reason: null,
      actor: null,
      seatSessionId: null,
      usedMinutes: null,
    });
    await panel
      .getByLabel("조회 시작 (한국 시각, 포함)")
      .fill("2099-01-01T09:00");
    await panel.getByRole("button", { name: "기간 적용", exact: true }).click();
    await expect(
      panel.getByText("선택한 기간의 내역이 없어요", { exact: true }),
    ).toBeVisible();
    await expect(
      panel
        .getByRole("table", { name: "이용권 전체 원장 대조" })
        .getByText("일치", { exact: true }),
    ).toBeVisible();
    await staff.page.goto(`/app/1/members?tab=passes&detail=${payment.passId}`);
    await expect(
      staff.page
        .getByRole("dialog")
        .getByText("보유 이용권 상세", { exact: true }),
    ).toBeVisible();
    await expect(
      staff.page.getByRole("button", { name: "이용권 조정", exact: true }),
    ).toHaveCount(0);
    const current = await (
      await api(owner.context, `/passes/${payment.passId}`)
    ).json();
    expect(
      (
        await api(
          staff.context,
          `/passes/${payment.passId}/adjustments?scope=1`,
          {
            version: current.version,
            reason: "권한 거부",
            remainingMinutes: 800,
          },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await api(
          cashier.context,
          `/passes/${payment.passId}/adjustments?scope=2`,
          {
            version: current.version,
            reason: "구매 지점 외",
            remainingMinutes: 800,
          },
        )
      ).status(),
    ).toBe(404);
    await cashier.page.goto(
      `/app/2/spaces?tab=usage&customerId=${customer.id}`,
    );
    const table = cashier.page.getByRole("table", {
      name: "입퇴실 이력",
      exact: true,
    });
    await expect(
      table.getByRole("cell", {
        name: `${customer.name} ${customer.memberNo}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(table.getByRole("cell", { name: /지점 1/ })).toBeVisible();
    await table
      .getByRole("button", { name: customer.name, exact: true })
      .click();
    await expect(
      cashier.page.getByRole("dialog").getByText("종료", { exact: true }),
    ).toBeVisible();
    const ended = await (
      await api(cashier.context, `/seat-sessions/${session.id}?scope=2`)
    ).json();
    expect(ended.passRemainingMinutes).toBeNull();
    expect(
      (
        await (
          await api(
            cashier.context,
            `/seat-sessions?scope=2&customerId=${customer.id}&from=${encodeURIComponent(session.checkedInAt)}`,
          )
        ).json()
      ).meta.total,
    ).toBe(1);
    expect(
      (
        await (
          await api(
            cashier.context,
            `/seat-sessions?scope=2&customerId=${customer.id}&to=${encodeURIComponent(session.checkedInAt)}`,
          )
        ).json()
      ).meta.total,
    ).toBe(0);
    await cashier.page.screenshot({
      path: "qa-artifacts/history-live/seat-history-desktop.png",
      fullPage: true,
    });
  } finally {
    await owner.context.close();
    await staff.context.close();
    await cashier.context.close();
  }
});

test("two real browser sessions recover 409 without overwriting an untouched balance", async ({
  browser,
}) => {
  const first = await login(browser),
    second = await login(browser);
  try {
    const { payment } = await fixture(first.context);
    const pass = await (
      await api(first.context, `/passes/${payment.passId}`)
    ).json();
    await first.page.goto(`/app/1/members?tab=passes&detail=${pass.id}`);
    const panel = first.page.getByRole("dialog");
    await panel
      .getByRole("button", { name: "이용권 조정", exact: true })
      .click();
    await panel.getByLabel("만료 없음", { exact: true }).uncheck();
    await panel
      .getByLabel("조정 후 만료 일시 (한국 시각)")
      .fill("2027-01-01T09:00");
    await panel.getByLabel("조정 사유 (필수)").fill("충돌 후 기간만 조정");
    expect(
      (
        await api(second.context, `/passes/${pass.id}/adjustments?scope=1`, {
          version: pass.version,
          reason: "다른 세션 잔량 조정",
          remainingMinutes: 500,
        })
      ).status(),
    ).toBe(200);
    await panel.getByRole("button", { name: "조정 저장", exact: true }).click();
    await expect(
      panel.getByRole("region", { name: "조정 충돌 확인" }),
    ).toBeVisible();
    await expect(panel.getByLabel("조정 사유 (필수)")).toHaveValue(
      "충돌 후 기간만 조정",
    );
    await panel
      .getByRole("button", { name: "최신 이용권 확인", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "최신 버전에 조정 저장", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "최신 버전에 조정 저장", exact: true })
      .click();
    await expect(panel.getByRole("form")).toHaveCount(0);
    const result = await (
      await api(second.context, `/passes/${pass.id}`)
    ).json();
    expect(result.remainingMinutes).toBe(500);
    expect(result.expiresAt).toBe("2027-01-01T00:00:00Z");
  } finally {
    await first.context.close();
    await second.context.close();
  }
});

test("real commit followed by browser response loss retries the original key once", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    const { payment, customer } = await fixture(owner.context);
    const requests: { key: string | undefined; body: unknown }[] = [];
    await owner.page.goto(`/app/1/members?tab=passes&detail=${payment.passId}`);
    await owner.page.setViewportSize({ width: 390, height: 844 });
    const panel = owner.page.getByRole("dialog");
    await panel
      .getByRole("button", { name: "이용권 조정", exact: true })
      .click();
    await panel.getByLabel("조정 후 남은 시간 (분)").fill("700");
    await panel.getByLabel("조정 사유 (필수)").fill("응답 유실 검증");
    await owner.page.route(
      `**/api/passes/${payment.passId}/adjustments?*`,
      async (route) => {
        const request = route.request();
        requests.push({
          key: request.headers()["idempotency-key"],
          body: request.postDataJSON(),
        });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (requests.length === 1) await route.abort("failed");
        else await route.fulfill({ response });
      },
    );
    await panel.getByRole("button", { name: "조정 저장", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "같은 조정 다시 시도", exact: true }),
    ).toBeEnabled();
    await expect(panel.getByLabel("조정 후 남은 시간 (분)")).toBeDisabled();
    await owner.page.screenshot({
      path: "qa-artifacts/history-live/adjustment-mobile.png",
      fullPage: true,
    });
    await panel
      .getByRole("button", { name: "같은 조정 다시 시도", exact: true })
      .click();
    await expect(panel.getByRole("form")).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    const history = await (
      await api(owner.context, `/customers/${customer.id}/pass-history?scope=1`)
    ).json();
    expect(
      history.events.filter((e: { type: string }) => e.type === "조정"),
    ).toHaveLength(1);
    expect(history.passes[0].remainingMinutes).toBe(700);
  } finally {
    await owner.context.close();
  }
});

test("credit and period forms use their own fields and refunded passes remain unadjustable", async ({
  browser,
}) => {
  const owner = await login(browser);
  try {
    for (const kind of ["정액권", "기간권"]) {
      const { payment } = await fixture(owner.context, kind);
      await owner.page.goto(
        `/app/1/members?tab=passes&detail=${payment.passId}`,
      );
      const panel = owner.page.getByRole("dialog");
      await panel
        .getByRole("button", { name: "이용권 조정", exact: true })
        .click();
      if (kind === "정액권")
        await panel.getByLabel("조정 후 남은 금액 (원)").fill("12000");
      else {
        await expect(
          panel.getByLabel("만료 없음", { exact: true }),
        ).toHaveCount(0);
        await panel
          .getByLabel("조정 후 만료 일시 (한국 시각)")
          .fill("2027-01-01T09:00");
      }
      await panel.getByLabel("조정 사유 (필수)").fill(`${kind} 조정`);
      await panel
        .getByRole("button", { name: "조정 저장", exact: true })
        .click();
      await expect(panel.getByRole("form")).toHaveCount(0);
      const pass = await (
        await api(owner.context, `/passes/${payment.passId}`)
      ).json();
      if (kind === "정액권") expect(pass.remainingCreditKrw).toBe(12000);
      else expect(pass.expiresAt).toBe("2027-01-01T00:00:00Z");
      expect(
        (
          await api(owner.context, `/payments/${payment.id}/refund`, {
            reason: "환불 후 조정 금지",
          })
        ).status(),
      ).toBe(200);
      await owner.page.reload();
      await expect(panel.getByText("환불", { exact: true })).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "이용권 조정", exact: true }),
      ).toHaveCount(0);
    }
  } finally {
    await owner.context.close();
  }
});
