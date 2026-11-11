import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api, clearCsrf } from "../shared/api/client";
import { AppRuntime } from "./AppRuntime";
import { useUi, type Theme } from "./store";

afterEach(() => {
  cleanup();
  clearCsrf();
  vi.unstubAllGlobals();
  useUi.getState().clearPrivate();
  useUi.getState().setTheme("forest");
  localStorage.removeItem("openstudy-theme");
  delete document.documentElement.dataset.theme;
});

it("shows re-login guidance when a previously active session is rejected", async () => {
  const query = new QueryClient();
  query.setQueryData(["session"], { user: { id: "10" } });
  query.setQueryData(["data", "10"], "private");
  render(<AppRuntime query={query} />);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "SESSION_EXPIRED", message: "로그인이 필요합니다." },
          { status: 401 },
        ),
      ),
  );
  await act(async () => {
    await expect(api("/lookups")).rejects.toMatchObject({ status: 401 });
  });
  expect(query.getQueryData(["session"])).toBeNull();
  expect(query.getQueryData(["data", "10"])).toBeUndefined();
  expect(screen.getByRole("status")).toHaveTextContent("다시 로그인해 주세요");
});

it("applies all three theme choices to the document and restores the last choice on reload", async () => {
  render(<AppRuntime query={new QueryClient()} />);
  const themes: Theme[] = ["forest", "navy", "sand"];
  for (const theme of themes) {
    act(() => useUi.getState().setTheme(theme));
    expect(document.documentElement).toHaveAttribute("data-theme", theme);
    expect(localStorage.getItem("openstudy-theme")).toBe(theme);
  }
  vi.resetModules();
  const reloaded = await import("./store");
  expect(reloaded.useUi.getState().theme).toBe("sand");
});
