import { test, expect } from "@playwright/test";
test.setTimeout(90000);
test("Mock customer history reads shared ledgers and summary modal requires a new reason after closing", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  await page.goto("/app/gangnam/members?detail=member-1");
  await page.getByRole("button", { name: "룸·사물함 이력 보기" }).click();
  await expect(
    page.getByRole("region", { name: "허용 지점 룸·사물함 이력" }),
  ).toContainText("룸 예약·사물함 배정 이력");
  const trigger = page.getByRole("button", { name: "타 지점 최소 요약 조회" });
  await trigger.click();
  const panel = page.getByRole("dialog", {
    name: "타 지점 최소 요약",
    exact: true,
  });
  await expect(
    panel.getByRole("heading", { name: "타 지점 최소 요약", exact: true }),
  ).toBeFocused();
  await panel.getByRole("button", { name: "사유를 기록하고 조회" }).click();
  await expect(
    panel.getByText("응대 사유를 1~500자로 입력해 주세요."),
  ).toBeVisible();
  await panel.getByLabel("응대 사유").fill("회원 이용 현황 상담");
  await panel.getByRole("button", { name: "사유를 기록하고 조회" }).click();
  await expect(
    panel.getByRole("region", { name: "타 지점 최소 요약 결과" }),
  ).toBeVisible();
  await expect(panel.getByRole("link")).toHaveCount(0);
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel.getByLabel("응대 사유")).toHaveValue("");
  await expect(
    panel.getByRole("region", { name: "타 지점 최소 요약 결과" }),
  ).toHaveCount(0);
});
