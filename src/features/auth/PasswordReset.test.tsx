import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Login } from "./Login";
import { BrowserRouter, Route, Routes } from "react-router";
import { api, ApiError } from "../../shared/api/client";
import { PasswordForm } from "./PasswordForm";
import { newPasswordError } from "../../shared/domain/password";
import { PasswordReset } from "./PasswordReset";

vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
vi.mock("../../app/context", () => ({
  useSession: () => ({
    data: { user: { owner: true, status: "활성" }, sessionMode: "WORKSPACE" },
  }),
}));
afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
  window.history.replaceState(null, "", "/");
});

function openLink() {
  window.history.replaceState(
    null,
    "",
    "/password-reset?token=unused#token=reset-fixture",
  );
  render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <BrowserRouter>
          <Routes>
            <Route path="/password-reset" element={<PasswordReset />} />
            <Route path="/login" element={<Login />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
const preview = {
  emailHint: "ju***@example.test",
  expiresAt: "2026-11-11T03:00:00Z",
};
const invalidLink = () =>
  new ApiError(422, {
    code: "PASSWORD_RESET_LINK_INVALID",
    message: "invalid",
  });

it("scrubs the fragment and sends only body fields before returning to login", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/preview") ? preview : undefined,
  );
  openLink();
  expect(await screen.findByText(preview.emailHint)).toBeVisible();
  expect(document.querySelector("time")).toHaveAttribute(
    "datetime",
    preview.expiresAt,
  );
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe("/password-reset");
  expect(api).toHaveBeenCalledWith(
    "/password-resets/preview",
    expect.objectContaining({
      method: "POST",
      body: { token: "reset-fixture" },
    }),
  );
  fireEvent.change(screen.getByLabelText("새 비밀번호"), {
    target: { value: "  valid-pass1  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "새 비밀번호 저장" }));
  expect(
    await screen.findByText(
      "비밀번호를 재설정했어요. 새 비밀번호로 로그인해 주세요.",
    ),
  ).toBeVisible();
  expect(api).toHaveBeenLastCalledWith(
    "/password-resets/complete",
    expect.objectContaining({
      method: "POST",
      body: { token: "reset-fixture", newPassword: "  valid-pass1  " },
    }),
  );
});

it.each(["preview", "complete"])(
  "gives a single unusable-link message when %s rejects a link",
  async (stage) => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith(stage)) throw invalidLink();
      return preview;
    });
    openLink();
    if (stage === "complete") {
      fireEvent.change(await screen.findByLabelText("새 비밀번호"), {
        target: { value: "valid-pass1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "새 비밀번호 저장" }));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "관리자에게 재설정 링크를 다시 요청",
    );
    if (stage === "complete")
      expect(screen.getByLabelText(/새 비밀번호/)).toBeDisabled();
  },
);

it("validates code points and UTF-8 bytes without trimming", () => {
  for (const invalid of ["1234567!", "Letters!", "Letters1 ", "A1!😀😀😀😀"]) {
    expect(newPasswordError(invalid)).toBeTruthy();
  }
  expect(newPasswordError("😀".repeat(7))).toBeTruthy();
  expect(newPasswordError("A1!" + "가".repeat(23))).toBeUndefined();
  expect(newPasswordError("A1!" + "가".repeat(24))).toBeTruthy();
});

it.each([
  ["CURRENT_PASSWORD_MISMATCH", "currentPassword", 422],
  ["PASSWORD_SAME_AS_CURRENT", "newPassword", 422],
  ["VALIDATION_FAILED", "newPassword", 422],
  ["RATE_LIMITED", "", 429],
])(
  "shows the appropriate password error for %s",
  async (code, field, status) => {
    const submit = vi.fn().mockRejectedValue(
      new ApiError(status, {
        code,
        message: "서버 오류",
        fieldErrors: { [field]: "비밀번호 필드 오류" },
      }),
    );
    render(<PasswordForm change submit={submit} />);
    fireEvent.change(screen.getByLabelText("기존 비밀번호"), {
      target: { value: "old-password" },
    });
    fireEvent.change(screen.getByLabelText("새 비밀번호"), {
      target: { value: "new-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("new-password1", "old-password"),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      field ? "비밀번호 필드 오류" : "잠시 후 다시 시도",
    );
    if (field)
      expect(document.querySelector(`input[name="${field}"]`)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
  },
);
