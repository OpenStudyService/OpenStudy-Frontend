import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AppRuntime } from "../../app/AppRuntime";
import { createAppQueryClient } from "../../app/queryClient";
import { InvitationAccept } from "./Acceptance";

const preview = {
  name: "직원",
  email: "new@example.test",
  branch: { id: "1", name: "강남" },
  role: "staff",
  expiresAt: "2099-01-01T00:00:00Z",
  acceptanceMode: "NEW_ACCOUNT",
};

function mountInvitation() {
  const query = createAppQueryClient();
  render(
    <QueryClientProvider client={query}>
      <MemoryRouter initialEntries={["/invitations/accept#token=secret-link"]}>
        <InvitationAccept />
        <AppRuntime query={query} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return query;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it.each(["csrf", "preview", "after preview"])(
  "opens the invitation when /me returns 401 during %s",
  async (phase) => {
    const me = deferredResponse();
    const csrf = deferredResponse();
    const invitation = deferredResponse();
    const fetch = vi.fn((url: string) => {
      if (url.endsWith("/me")) return me.promise;
      if (url.endsWith("/auth/csrf")) return csrf.promise;
      return invitation.promise;
    });
    vi.stubGlobal("fetch", fetch);
    const query = mountInvitation();
    query.setQueryData(["private-data"], ["private"]);
    const resolveCsrf = () => csrf.resolve(Response.json({ token: "csrf" }));
    const resolvePreview = () => invitation.resolve(Response.json(preview));

    if (phase !== "csrf") await act(resolveCsrf);
    if (phase === "after preview") {
      await act(resolvePreview);
      expect(screen.queryByLabelText("새 계정 비밀번호")).toBeNull();
    }
    await act(() => {
      me.resolve(
        Response.json(
          { code: "SESSION_EXPIRED", message: "로그인이 필요합니다." },
          { status: 401 },
        ),
      );
    });
    expect(query.getQueryData(["private-data"])).toBeUndefined();
    if (phase === "csrf") await act(resolveCsrf);
    if (phase !== "after preview") await act(resolvePreview);

    expect(await screen.findByLabelText("새 계정 비밀번호")).toBeVisible();
    expect(screen.queryByText("요청을 완료하지 못했어요")).toBeNull();
  },
);

it("retries the preview in place with a fresh CSRF token", async () => {
  let csrfRequests = 0;
  let previewRequests = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/me")) {
      return Response.json(
        { code: "SESSION_EXPIRED", message: "로그인이 필요합니다." },
        { status: 401 },
      );
    }
    if (url.endsWith("/auth/csrf")) {
      return Response.json({ token: `csrf-${++csrfRequests}` });
    }
    previewRequests++;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(
      `csrf-${previewRequests}`,
    );
    expect(JSON.parse(String(init.body))).toEqual({ token: "secret-link" });
    return previewRequests === 1
      ? Response.json(
          { code: "CSRF_INVALID", message: "인증 요청을 다시 시도해 주세요." },
          { status: 403 },
        )
      : Response.json(preview);
  });
  mountInvitation();
  await userEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  expect(await screen.findByLabelText("새 계정 비밀번호")).toBeVisible();
  expect(csrfRequests).toBe(2);
});
