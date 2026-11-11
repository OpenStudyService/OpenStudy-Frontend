import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/api/client";
import { CsvExportButton } from "./ExportButton";

afterEach(cleanup);

it("announces truncation before the request and blocks a second click while a file loads", async () => {
  let reject!: (error: ApiError) => void;
  const load = vi.fn(
    () =>
      new Promise<never>((_, fail) => {
        reject = fail;
      }),
  );
  render(<CsvExportButton title="최소 원장" total={1_001} load={load} />);
  const button = screen.getByRole("button", { name: "최소 원장 CSV 다운로드" });
  expect(button).toHaveAccessibleDescription("CSV에는 앞의 1,000행만 담겨요.");
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(load).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  reject(
    new ApiError(429, {
      code: "RATE_LIMITED",
      message: "잠시 후 다시 시도해 주세요.",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("RATE_LIMITED");
  expect(button).toBeEnabled();
});
