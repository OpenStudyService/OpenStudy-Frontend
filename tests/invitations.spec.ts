import { test, expect } from "@playwright/test";
// Browser UI against the MSW contract fixture; SMTP and live backend are separate verification.
test("F03 new acceptance and approved limited session requires login", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.goto("/app/gangnam/employees?tab=invitations");
  await page.getByLabel("초대 이름", { exact: true }).fill("초대 동료");
  await page
    .getByLabel("초대 이메일 (발송 후 변경 불가)")
    .fill("invite-new@example.test");
  await page.getByRole("button", { name: "초대 이메일 발송 요청" }).click();
  await expect(
    page.getByRole("button", { name: "초대 상세: 초대 동료" }),
  ).toBeVisible();
  await expect(page.locator('a[href*="token="]')).toHaveCount(0);
  const mailToken = await page.evaluate(async () => {
    const response = await fetch("/api/invitations?scope=gangnam").then((r) =>
      r.json(),
    );
    const moduleUrl = "/src/mocks/invitations.ts";
    const mock = await import(/* @vite-ignore */ moduleUrl);
    const token = mock.invitationMailLink(response.items[0].id);
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": "openstudy-mock-csrf" },
    });
    window.dispatchEvent(new Event("openstudy:session-expired"));
    return token;
  });
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  await page.evaluate(async (token) => {
    const routerUrl = "/src/app/Router.tsx";
    const { router } = await import(/* @vite-ignore */ routerUrl);
    await router.navigate(`/invitations/accept#token=${token}`);
  }, mailToken);
  await expect(page.getByLabel("새 계정 비밀번호")).toBeVisible();
  await expect(page).toHaveURL(/\/invitations\/accept$/);
  await page.getByLabel("새 계정 비밀번호").fill("demo-password");
  await page.getByRole("button", { name: "초대 수락", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "초대 수락이 완료됐어요" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "로그인으로 돌아가기" }).click();
  await page
    .getByLabel("이메일", { exact: true })
    .fill("invite-new@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "최종 승인을 기다리고 있어요" }),
  ).toBeVisible();
  // The fixture changes the manager state through the contract command, without promoting this session.
  await page.evaluate(async () => {
    const { token } = await fetch("/api/auth/csrf").then((r) => r.json());
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
    };
    const demo = async (persona: string) =>
      fetch("/api/_demo", {
        method: "POST",
        headers,
        body: JSON.stringify({ persona }),
      });
    const moduleUrl = "/src/mocks/store.ts",
      { store } = await import(/* @vite-ignore */ moduleUrl);
    const id = store.persona;
    await demo("owner");
    const list = await fetch("/api/invitations?scope=gangnam").then((r) =>
      r.json(),
    );
    const i = list.items[0];
    await fetch(`/api/invitations/${i.id}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: i.version }),
    });
    await demo(id);
  });
  await page.getByRole("button", { name: "승인 상태 새로고침" }).click();
  await expect(
    page.getByRole("heading", { name: "승인이 완료됐어요" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "다시 로그인" }).click();
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  await page
    .getByLabel("이메일", { exact: true })
    .fill("invite-new@example.test");
  await page.getByLabel("비밀번호", { exact: true }).fill("demo-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /안녕하세요, 초대 동료/ }),
  ).toBeVisible();
});
test("F03 missing/expired fragment fails without a query token request", async ({
  page,
}) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto("/invitations/accept?token=unsafe-query");
  await expect(
    page.getByText("유효한 이메일 초대 링크를 다시 열어 주세요."),
  ).toBeVisible();
  expect(urls.some((u) => u.includes("/api/invitations/preview"))).toBe(false);
  await page.goto("/invitations/accept#token=expired-link");
  await expect(page.getByText(/만료·재발급·취소된 초대 링크/)).toBeVisible();
  await expect(page).toHaveURL(/\/invitations\/accept$/);
  expect(urls.some((u) => u.includes("/api/invitations/preview?"))).toBe(false);
});
