import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../mocks/handlers";
import { store } from "../../mocks/store";
import { Ai } from "./Ai";

vi.mock("../../app/context", () => ({
  useApp: () => ({
    session: { user: store.activeUser(), branches: store.db.branches },
    scope: "all",
  }),
}));

const server = setupServer(...handlers);
const requests: { method: string; path: string }[] = [];
beforeAll(() => {
  server.listen();
  server.events.on("request:start", ({ request }) => {
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
    });
  });
});
afterAll(() => server.close());
afterEach(cleanup);

it("uses only the canonical AI routes for questions and saved conversations", async () => {
  store.reset();
  store.persona = "owner";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <Ai />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText("AI에게 질문"), "지점별 매출");
  const send = screen.getByRole("button", { name: "질문하기" });
  await waitFor(() => expect(send).toBeEnabled());
  await user.click(send);
  const saved = await screen.findByRole("button", {
    name: /^지점별 매출$/,
  });
  await user.click(saved);
  expect(
    await screen.findByText(/저장된 질문을 현재 권한과 기준 시각으로/),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "지점별 매출 제목 변경" }),
  );
  const title = screen.getByLabelText("대화 제목");
  await user.clear(title);
  await user.type(title, "수정된 제목");
  await user.click(screen.getByRole("button", { name: "저장" }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(
    await screen.findByRole("button", { name: "수정된 제목 삭제" }),
  );
  expect(await screen.findByText(/아직 저장된 대화가 없어요/)).toBeVisible();

  expect(requests).toEqual(
    expect.arrayContaining([
      { method: "GET", path: "/api/ai/catalog/readiness" },
      { method: "POST", path: "/api/ai/queries" },
      { method: "GET", path: "/api/ai/conversations" },
      ...["GET", "PATCH", "DELETE"].map((method) => ({
        method,
        path: expect.stringMatching(/^\/api\/ai\/conversations\/conv-/),
      })),
    ]),
  );
  expect(requests.filter(({ path }) => !path.startsWith("/api/ai/"))).toEqual([
    { method: "GET", path: "/api/auth/csrf" },
  ]);
  client.clear();
});
