import { seatHandlers } from "./seats";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { collaborationHandlers } from "./collaboration";
import { http, HttpResponse } from "msw/http";
import { store } from "./store";
import { recordApi } from "../features/collaboration/api";
import { api, clearCsrf } from "../shared/api/client";

const server = setupServer(
  http.get("/api/auth/csrf", () =>
    HttpResponse.json({ token: "openstudy-mock-csrf" }),
  ),
  ...collaborationHandlers,
  ...seatHandlers,
);
const signal = () => new AbortController().signal;
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
  clearCsrf();
});
it("completes exactly one inspection with the same key and returns the next open work and due date", async () => {
  const row = await recordApi.detail(
    "facilities",
    "gangnam",
    "facility-1",
    signal(),
  );
  if (!("openWork" in row)) throw new Error("facility expected");
  const body = {
    version: row.version,
    result: "점검 완료",
    completedOn: "2026-10-17",
    facilityStatus: "정상",
  };
  const key = crypto.randomUUID();
  const saved = await recordApi.write(
    "facilities",
    "gangnam",
    row.id,
    "inspection/complete",
    body,
    signal(),
    key,
  );
  const retried = await recordApi.write(
    "facilities",
    "gangnam",
    row.id,
    "inspection/complete",
    body,
    signal(),
    key,
  );
  expect(retried).toEqual(saved);
  expect(saved).toMatchObject({
    status: "정상",
    nextInspectionOn: "2026-10-31",
    openWork: { status: "대기", assignee: row.openWork.assignee },
    lastInspection: { result: "점검 완료" },
  });
  expect(
    (await recordApi.summary("facilities", "gangnam", "", signal())).totals
      .inspectionDue,
  ).toBe(0);
});
it("keeps facility condition separate from work processing status, rejects empty result and stale writes", async () => {
  const row = await recordApi.detail(
    "facilities",
    "gangnam",
    "facility-1",
    signal(),
  );
  await expect(
    recordApi.write(
      "facilities",
      "gangnam",
      row.id,
      "inspection/complete",
      {
        version: row.version,
        completedOn: "2026-10-17",
        result: " ",
        facilityStatus: "정상",
      },
      signal(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({
    status: 422,
    detail: { fieldErrors: { result: expect.any(String) } },
  });
  const changed = await recordApi.write(
    "facilities",
    "gangnam",
    row.id,
    "",
    { version: row.version, workStatus: "대기" },
    signal(),
    "",
  );
  expect(changed).toMatchObject({
    status: "점검 필요",
    openWork: { status: "대기" },
  });
  await expect(
    recordApi.write(
      "facilities",
      "gangnam",
      row.id,
      "",
      { version: row.version, name: "stale" },
      signal(),
      "",
    ),
  ).rejects.toMatchObject({
    status: 409,
    detail: { code: "VERSION_CONFLICT" },
  });
});
it("a staff member can answer and gets updated history and unresolved counts", async () => {
  store.persona = "junho";
  const row = await recordApi.detail(
    "inquiries",
    "gangnam",
    "inquiry-1",
    signal(),
  );
  expect(row).toMatchObject({ canChangeAssignee: false });
  await recordApi.write(
    "inquiries",
    "gangnam",
    row.id,
    "answer",
    { version: row.version, answer: "냉방을 조치했습니다." },
    signal(),
    "",
  );
  expect(
    (await recordApi.summary("inquiries", "gangnam", "", signal())).totals
      .unresolved,
  ).toBe(0);
  expect(
    (await recordApi.events("gangnam", row.id, 1, signal())).items[0],
  ).toMatchObject({
    actor: { id: "junho" },
    newStatus: "답변 완료",
    message: "냉방을 조치했습니다.",
  });
});
it("staff cannot assign another employee or write facilities or all-branch notices", async () => {
  store.persona = "junho";
  await expect(
    recordApi.write(
      "inquiries",
      "gangnam",
      "inquiry-1",
      "assignee",
      { version: 1, assigneeId: "junho" },
      signal(),
      "",
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    recordApi.write(
      "facilities",
      "gangnam",
      "facility-1",
      "",
      { version: 1, name: "denied" },
      signal(),
      "",
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    recordApi.write(
      "notices",
      "gangnam",
      undefined,
      "",
      { title: "denied", body: "denied", target: "전체" },
      signal(),
      "key",
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it("visibility is applied before pinned ordering and excludes ended and draft notices for staff", async () => {
  const create = (title: string, status: string, pinned: boolean) =>
    recordApi.write(
      "notices",
      "gangnam",
      undefined,
      "",
      {
        title,
        body: title,
        target: "선택 지점",
        branchIds: ["gangnam"],
        pinned,
        status,
      },
      signal(),
      crypto.randomUUID(),
    );
  await create("draft", "임시 저장", true);
  const ended = await create("ended", "게시 중", true);
  await recordApi.write(
    "notices",
    "gangnam",
    ended.id,
    "status",
    { version: ended.version, status: "게시 종료" },
    signal(),
    "",
  );
  await create("normal", "게시 중", false);
  await create("important", "게시 중", true);
  store.persona = "junho";
  const page = await recordApi.list("notices", "gangnam", "", signal());
  expect(page.items.every((x) => x.status === "게시 중")).toBe(true);
  const titles = page.items.map((x) => ("title" in x ? x.title : ""));
  expect(titles).not.toContain("draft");
  expect(titles).not.toContain("ended");
  expect(titles.indexOf("important")).toBeLessThan(titles.indexOf("normal"));
  await expect(
    recordApi.detail("notices", "gangnam", ended.id, signal()),
  ).rejects.toMatchObject({ status: 404 });
});
it("rejects malformed success bodies instead of reporting a fake success", async () => {
  const { http, HttpResponse } = await import("msw/http");
  server.use(
    http.post("/api/facilities", () => HttpResponse.json({ success: true })),
  );
  await expect(
    recordApi.write(
      "facilities",
      "gangnam",
      undefined,
      "",
      {},
      signal(),
      "key",
    ),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  // A live adapter never calls legacy /members or a command endpoint.
  expect(
    (await api<{ items: unknown[] }>("/facility-types")).items,
  ).toHaveLength(2);
});

it("an out-of-scope demo customer requires exact lookup evidence for the same actor and branch", async () => {
  const c = {
    ...store.db.members[0],
    id: "outside",
    memberNo: "C-EXACT",
    branchIds: ["seongsu"],
  };
  store.db.members.push(c);
  store.persona = "junho";
  const body = {
    branchId: "gangnam",
    customerId: c.id,
    subject: "정확 조회 후 접수",
    body: "현장 문의",
    source: "전화",
  };
  await expect(
    recordApi.write(
      "inquiries",
      "gangnam",
      undefined,
      "",
      body,
      signal(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 404 });
  const found = await api<{ items: unknown[] }>("/customer-lookups/check-in", {
    method: "POST",
    body: { branchId: "gangnam", memberNo: c.memberNo },
  });
  expect(found.items).toHaveLength(1);
  const result = await recordApi.write(
    "inquiries",
    "gangnam",
    undefined,
    "",
    body,
    signal(),
    crypto.randomUUID(),
  );
  expect(result).toMatchObject({
    customer: { id: c.id },
    subject: body.subject,
  });
});
