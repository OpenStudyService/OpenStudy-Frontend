import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, persona = "owner") {
  await page.goto("/login");
  await page.getByRole("button", { name: "사장님으로 체험" }).click();
  await expect(page.getByRole("heading", { name: /안녕하세요/ })).toBeVisible();
  if (persona !== "owner") {
    const status = await page.evaluate(async (persona) => {
      const { token } = await (await fetch("/api/auth/csrf")).json();
      return (
        await fetch("/api/_demo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": token,
          },
          body: JSON.stringify({ persona }),
        })
      ).status;
    }, persona);
    expect(status).toBe(200);
  }
}

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const theme of ["forest", "navy", "sand"]) {
  test(`${theme}: primary and destructive actions remain distinct across widths and focus states`, async ({
    page,
  }, testInfo) => {
    await login(page);
    await page.goto("/app/all/products?tab=categories");
    const primary = page.getByRole("button", {
      name: "분류 등록",
      exact: true,
    });
    const danger = page.getByRole("button", { name: /^사용 중지:/ }).first();
    await expect(primary).toHaveClass(/primary/);
    await expect(danger).toHaveClass(/danger/);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.mouse.move(0, 0);
      await expect(danger).toHaveCSS("color", "rgb(159, 45, 39)");
      await expect(danger).toHaveCSS("background-color", "rgb(255, 244, 242)");
      await expect(primary).toHaveCSS("color", "rgb(255, 255, 255)");
      for (const button of [primary, danger]) {
        const style = await button.evaluate((element) => {
          const css = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            color: css.color,
            background: css.backgroundColor,
            left: rect.left,
            right: rect.right,
          };
        });
        expect(contrast(style.color, style.background)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(style.left).toBeGreaterThanOrEqual(0);
        expect(style.right).toBeLessThanOrEqual(width);
      }
      await danger.hover();
      await expect(danger).toHaveCSS("background-color", "rgb(253, 229, 224)");
      await page.keyboard.press("Tab");
      await danger.focus();
      await expect(danger).toHaveCSS("outline-color", "rgb(180, 60, 51)");
      await expect(danger).toHaveCSS("outline-style", "solid");
      if (width !== 1024)
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${width}.png`),
          fullPage: true,
        });
    }
  });
}

for (const persona of ["owner", "minji", "junho"]) {
  test(`${persona}: branch status colors preserve management permissions and ordinary editing`, async ({
    page,
  }) => {
    await login(page, persona);
    await page.goto("/app/gangnam/branches");
    await expect(page.getByRole("table", { name: "지점 목록" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "지점 등록", exact: true }),
    ).toHaveCount(persona === "owner" ? 1 : 0);
    const edit = page.getByRole("button", {
      name: "지점 수정: 강남점",
      exact: true,
    });
    if (persona === "junho") {
      await expect(edit).toHaveCount(0);
      return;
    }
    await edit.click();
    const panel = page.getByRole("dialog");
    const save = panel.getByRole("button", { name: "지점 저장", exact: true });
    await expect(save).toHaveClass(/primary/);
    await panel
      .getByRole("combobox", { name: "운영 상태", exact: true })
      .selectOption("운영 중지");
    await expect(save).toHaveClass(/danger/);
    await panel
      .getByRole("combobox", { name: "운영 상태", exact: true })
      .selectOption("운영 중");
    await expect(save).toHaveClass(/primary/);
    await expect(save).toBeEnabled();
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(panel).not.toBeVisible();
  });
}
