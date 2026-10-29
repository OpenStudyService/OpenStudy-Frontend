import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.goto("/app/all/members?tab=members");
  await expect(
    page.getByRole("searchbox", { name: "회원 검색" }),
  ).toBeVisible();
}
async function api(page: Page, path: string, body?: object, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const { token } = await fetch("/api/auth/csrf").then((response) =>
        response.json(),
      );
      const response = await fetch(
        `/api${path}`,
        body
          ? {
              method,
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
    { path, body, method },
  );
}
async function register(page: Page, name: string) {
  await page.getByRole("button", { name: "회원 등록", exact: true }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByLabel("등록 지점")).toHaveValue("");
  await panel.getByLabel("등록 지점").selectOption("gangnam");
  await panel.getByLabel("회원 이름").fill(name);
  await panel.getByLabel("연락처", { exact: true }).fill("010-9999-2222");
  await panel
    .getByLabel("이메일", { exact: true })
    .fill("customer-ui@example.test");
  await panel.getByLabel("응대 메모").fill("저장소 비노출 검증 메모");
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/customers",
  );
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/customers",
  );
  await panel.getByRole("button", { name: "회원 등록", exact: true }).click();
  const request = await sent;
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  await expect(panel).not.toBeVisible();
  expect(request.headers()["idempotency-key"]).toBeTruthy();
  expect(request.postDataJSON()).toEqual({
    registeredBranchId: "gangnam",
    name,
    phone: "01099992222",
    email: "customer-ui@example.test",
    memo: "저장소 비노출 검증 메모",
  });
  const listed = await api(
    page,
    `/customers?scope=all&q=${encodeURIComponent(name)}`,
  );
  expect(listed.status).toBe(200);
  const customer = listed.data.items.find(
    (row: { name: string }) => row.name === name,
  );
  expect(customer).toBeTruthy();
  expect(customer.memberNo).toBeTruthy();
  return customer;
}
async function open(page: Page, name: string) {
  await page.getByRole("searchbox", { name: "회원 검색" }).fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  return page.getByRole("dialog");
}

test("owner registers, edits and changes customer status without storing private fields", async ({
  page,
}) => {
  await login(page);
  const name = "회원 연결 E2E";
  const customer = await register(page, name);
  const panel = await open(page, name);
  await expect(
    panel.getByText(customer.memberNo, { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "수정하기" }).click();
  await expect(panel.getByLabel("등록 지점")).toBeDisabled();
  await panel.getByLabel("응대 메모").fill("상세 편집 후 메모");
  const patched = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === `/api/customers/${customer.id}`,
  );
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  expect((await patched).postDataJSON()).toEqual({
    version: 1,
    memo: "상세 편집 후 메모",
  });
  await expect(
    panel.getByText("상세 편집 후 메모", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "상태 변경", exact: true }).click();
  await panel.getByLabel("상태", { exact: true }).selectOption("이용 제한");
  await panel.getByLabel("변경 사유").fill("상태 변경 검증");
  await panel.getByRole("button", { name: "상태 저장", exact: true }).click();
  const result = await api(page, `/customers/${customer.id}?scope=all`);
  expect(result.data.status).toBe("이용 제한");
  expect(result.data.statusReason).toBe("상태 변경 검증");
  const list = (
    await api(page, `/customers?scope=all&q=${encodeURIComponent(name)}`)
  ).data.items[0];
  expect(list).not.toHaveProperty("memo");
  expect(list).not.toHaveProperty("email");
  expect(list).not.toHaveProperty("statusReason");
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stored).not.toContain(name);
  expect(stored).not.toContain("customer-ui@example.test");
  expect(stored).not.toContain("상세 편집 후 메모");
});

test("HTTP version conflict keeps the draft and sends only changed fields after explicit comparison", async ({
  page,
}) => {
  await login(page);
  const customer = await register(page, "충돌 검증 회원");
  const panel = await open(page, "충돌 검증 회원");
  await panel.getByRole("button", { name: "수정하기" }).click();
  await panel.getByLabel("회원 이름").fill("내가 바꾼 회원 이름");
  const competing = await api(
    page,
    `/customers/${customer.id}?scope=all`,
    { version: 1, memo: "다른 편집자의 최신 메모" },
    "PATCH",
  );
  expect(competing.status).toBe(200);
  await panel.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "최신 내용 확인" }),
  ).toBeVisible();
  await expect(panel.getByLabel("회원 이름")).toHaveValue(
    "내가 바꾼 회원 이름",
  );
  await panel.getByRole("button", { name: "최신 내용 확인" }).click();
  await expect(
    panel.getByRole("heading", { name: /최신 회원 · 버전 2/ }),
  ).toBeVisible();
  const patched = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === `/api/customers/${customer.id}`,
  );
  await panel.getByRole("button", { name: "최신 기준으로 다시 저장" }).click();
  expect((await patched).postDataJSON()).toEqual({
    version: 2,
    name: "내가 바꾼 회원 이름",
  });
  const result = (await api(page, `/customers/${customer.id}?scope=all`)).data;
  expect(result.name).toBe("내가 바꾼 회원 이름");
  expect(result.memo).toBe("다른 편집자의 최신 메모");
});

test("URL filters survive reload and a cancelled keyboard close preserves registration input", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("searchbox", { name: "회원 검색" }).fill("010");
  await page.getByLabel("회원 상태 필터").selectOption("정상");
  await page.getByLabel("회원 정렬").selectOption("name");
  await page.getByLabel("정렬 방향").selectOption("asc");
  await page.getByLabel("페이지당 항목 수").selectOption("20");
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "회원 검색" })).toHaveValue(
    "010",
  );
  await expect(page.getByLabel("회원 상태 필터")).toHaveValue("정상");
  await expect(page.getByLabel("회원 정렬")).toHaveValue("name");
  await page.getByRole("button", { name: "회원 등록", exact: true }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("회원 이름").fill("저장 전 이탈 검증");
  const dismissed = new Promise<void>((resolve) =>
    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
      resolve();
    }),
  );
  await page.keyboard.press("Escape");
  await dismissed;
  await expect(panel.getByLabel("회원 이름")).toHaveValue("저장 전 이탈 검증");
  const accepted = new Promise<void>((resolve) =>
    page.once("dialog", async (dialog) => {
      await dialog.accept();
      resolve();
    }),
  );
  await page.keyboard.press("Escape");
  await accepted;
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("searchbox", { name: "회원 검색" })).toHaveValue(
    "010",
  );
});

test("readonly staff cannot edit directly or read another branch's customer", async ({
  page,
}) => {
  await login(page);
  const home = (await api(page, "/customers?scope=gangnam&pageSize=100")).data
    .items[0];
  const other = (
    await api(page, "/customers?scope=seongsu&pageSize=100")
  ).data.items.find((row: { id: string }) => row.id !== home.id);
  expect(home).toBeTruthy();
  expect(other).toBeTruthy();
  await api(page, "/_demo", { persona: "junho" });
  await page.goto(`/app/gangnam/members?tab=members&detail=${home.id}&edit=1`);
  await expect(
    page.getByRole("heading", { name: "이 회원을 수정할 권한이 없어요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "회원 등록", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("회원 이름")).toHaveCount(0);
  expect((await api(page, `/customers/${other.id}?scope=gangnam`)).status).toBe(
    404,
  );
  expect(
    (
      await api(
        page,
        `/customers/${home.id}?scope=gangnam`,
        { version: 1, name: "거절된 수정" },
        "PATCH",
      )
    ).status,
  ).toBe(403);
});
