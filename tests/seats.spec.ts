import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function login(page: Page, role = "사장님") {
  await page.goto("/login");
  await page.getByRole("button", { name: `${role}으로 체험` }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
}

const seat = (page: Page, name: string, status = "사용 가능", kind = "일반") =>
  page.getByRole("button", { name: `${name} ${kind} ${status}`, exact: true });

async function lookupMember(page: Page, memberNo: string) {
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "직원 예외 입실", exact: true })
    .click();
  await dialog.getByLabel("정확한 회원번호", { exact: true }).fill(memberNo);
  await dialog
    .getByRole("button", { name: "입실 고객 조회", exact: true })
    .click();
  return dialog;
}

test("owner creates, edits and changes seat operations with reasons across reload", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/all/spaces");
  await page
    .getByRole("combobox", { name: "좌석 지점", exact: true })
    .selectOption("gangnam");
  await page.getByRole("button", { name: "좌석 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("구역", { exact: true }).fill("모니터존 E2E");
  await dialog.getByLabel("좌석 번호", { exact: true }).fill("M-E2E");
  await dialog
    .getByRole("combobox", { name: "좌석 유형", exact: true })
    .selectOption("모니터");
  await dialog
    .getByRole("combobox", { name: "초기 운영 상태", exact: true })
    .selectOption("운영 중단");
  await dialog
    .getByRole("button", { name: "좌석 등록 완료", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await seat(page, "M-E2E", "운영 중단", "모니터").click();
  await dialog.getByRole("button", { name: "운영 재개", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "운영 상태 저장", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("처리 사유 (필수)", { exact: true })
    .fill("장비 점검 완료");
  await dialog
    .getByRole("button", { name: "운영 상태 저장", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "직원 예외 입실", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "좌석 수정", exact: true }).click();
  await dialog.getByLabel("좌석 번호", { exact: true }).fill("M-UPDATED");
  await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "M-UPDATED 상세", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();
  await expect(seat(page, "M-UPDATED", "사용 가능", "모니터")).toBeVisible();
  await page
    .getByRole("combobox", { name: "좌석 유형 필터", exact: true })
    .selectOption("모니터");
  await expect(page.locator("button.seat")).toHaveCount(1);
  await expect(page.locator('[aria-label="좌석 현황"]')).toContainText("전체1");
});

test("exact lookup, check-in, same-branch move and checkout update the shared seat ledger", async ({
  page,
}) => {
  const writes: { path: string; body: unknown; key: string | undefined }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      ["/api/customer-lookups/check-in", "/api/seat-sessions"].some((path) =>
        url.pathname.startsWith(path),
      )
    )
      writes.push({
        path: url.pathname,
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
  });
  await login(page);
  await page.goto("/app/gangnam/spaces");
  await seat(page, "A-01").click();
  const dialog = await lookupMember(page, "DEMO-member-2");
  await dialog
    .getByRole("combobox", { name: "입실 고객", exact: true })
    .selectOption("member-2");
  const passes = dialog.getByRole("combobox", {
    name: "사용 가능한 이용권",
    exact: true,
  });
  await expect(passes.locator("option")).toHaveCount(2);
  await passes.selectOption({ index: 1 });
  await dialog
    .getByLabel("처리 사유 (선택)", { exact: true })
    .fill("현장 직원 배정");
  await dialog.getByRole("button", { name: "입실 확정", exact: true }).click();
  await expect(
    dialog.getByText("A-01 배정을 완료했어요", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(seat(page, "A-01", "사용 중")).toContainText("이서준");
  await seat(page, "A-01", "사용 중").click();
  await dialog.getByRole("button", { name: "좌석 이동", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "이동 가능 좌석 새로고침" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "이동할 좌석", exact: true })
    .selectOption("gangnam-seat-2");
  await dialog
    .getByRole("button", { name: "좌석 이동 확정", exact: true })
    .click();
  await expect(
    dialog.getByText("A-02 배정을 완료했어요", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(seat(page, "A-01")).toBeVisible();
  await seat(page, "A-02", "사용 중").click();
  await dialog.getByRole("button", { name: "퇴실 처리", exact: true }).click();
  await dialog.getByRole("button", { name: "퇴실 확정", exact: true }).click();
  await expect(
    dialog.getByText("퇴실을 완료했어요", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("이용 시간", { exact: true })).toBeVisible();
  await expect(dialog.getByText("초과량", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(seat(page, "A-02")).toBeVisible();
  await page.reload();
  await expect(seat(page, "A-01")).toBeVisible();
  await expect(seat(page, "A-02")).toBeVisible();
  const lookup = writes.find(
    (w) => w.path === "/api/customer-lookups/check-in",
  )!;
  expect(lookup.body).toEqual({
    branchId: "gangnam",
    memberNo: "DEMO-member-2",
  });
  expect(lookup.key).toBeUndefined();
  const commands = writes.filter((w) => w.path !== lookup.path);
  expect(commands.map((w) => w.path)).toEqual([
    "/api/seat-sessions",
    expect.stringMatching(/\/move$/),
    expect.stringMatching(/\/check-out$/),
  ]);
  expect(commands.every((w) => !!w.key && w.key.length >= 16)).toBe(true);
  expect(new Set(commands.map((w) => w.key)).size).toBe(3);
});

test("ordinary staff can process exception stays on mobile without management controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "직원");
  await page.goto("/app/gangnam/spaces");
  await expect(
    page.getByRole("button", { name: "좌석 등록", exact: true }),
  ).toHaveCount(0);
  await seat(page, "A-01").click();
  const dialog = await lookupMember(page, "DEMO-member-2");
  await expect(
    dialog.getByRole("button", { name: "좌석 수정", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "운영 중단", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "입실 고객", exact: true })
    .selectOption("member-2");
  await dialog
    .getByRole("combobox", { name: "사용 가능한 이용권", exact: true })
    .selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "입실 확정", exact: true }).click();
  await expect(
    dialog.getByText("A-01 배정을 완료했어요", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "좌석 이동", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "퇴실 처리", exact: true }).click();
  await dialog.getByRole("button", { name: "퇴실 확정", exact: true }).click();
  await expect(
    dialog.getByText("퇴실을 완료했어요", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
});
