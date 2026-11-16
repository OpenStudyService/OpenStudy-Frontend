import { expect, type Page } from "@playwright/test";

export async function selectPaymentCustomer(
  page: Page,
  customer: { name: string; memberNo?: string },
) {
  const panel = page.getByRole("dialog", { name: "Mock 결제", exact: true });
  const keyword = panel.getByRole("searchbox", { name: "고객 검색어" });
  await keyword.fill(customer.memberNo ?? customer.name);
  await keyword.press("Enter");
  const search = page.getByRole("dialog", { name: "고객 검색", exact: true });
  await search
    .getByRole("button", { name: customer.name, exact: true })
    .click();
  await expect(search).toBeHidden();
}
