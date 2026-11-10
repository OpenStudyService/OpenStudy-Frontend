import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import type { components } from "../shared/api/foundation.generated";
import { businessDate } from "../shared/domain/schema";
import { shiftClosureDate } from "../shared/domain/closures";
import { handlers } from "./handlers";
import { store } from "./store";

const server = setupServer(...handlers);
const read = (query: string) =>
  fetch(new URL("/api/home/summary?" + query, window.location.origin));

beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => store.reset());
afterAll(() => server.close());

it("matches scoped seat occupancy and serves the six home cards without messages", async () => {
  const response = await read("scope=gangnam");
  expect(response.status).toBe(200);
  const summary: components["schemas"]["HomeSummary"] = await response.json();
  expect(Object.keys(summary).sort()).toEqual([
    "closures",
    "facilities",
    "inquiries",
    "meta",
    "notices",
    "seats",
    "shifts",
    "tasks",
  ]);
  expect(summary.meta.branchIds).toEqual(["gangnam"]);
  expect(summary.meta.taskFilter).toEqual({
    mine: false,
    assigneeId: null,
    defaulted: true,
  });
  expect(summary.seats.occupancy).toEqual({
    state: "value",
    percent: 3.1,
    numerator: 1,
    denominator: 32,
  });
  expect(summary.seats.link).toMatchObject({
    screen: "seat-board",
    branchId: "gangnam",
  });
  expect(summary.facilities.link.query).toEqual({ inspectionDue: "true" });
  expect(
    summary.shifts.colleagues.every(
      (shift) => !("id" in shift) && !("link" in shift),
    ),
  ).toBe(true);
});

it("accepts explicit task filters and rejects conflicting ones", async () => {
  const mine = await (await read("scope=all&mine=true")).json();
  expect(mine.meta.taskFilter).toEqual({
    mine: true,
    assigneeId: null,
    defaulted: false,
  });
  expect(mine.tasks.today).toEqual(mine.tasks.mine);
  const assigned = await (await read("scope=all&assigneeId=owner")).json();
  expect(assigned.meta.taskFilter).toEqual({
    mine: false,
    assigneeId: "owner",
    defaulted: false,
  });
  expect(assigned.tasks.today).toEqual(mine.tasks.today);
  expect((await read("scope=all&mine=true&assigneeId=owner")).status).toBe(422);
});

it("returns closure notices for the scoped branches from today through day seven", async () => {
  const at = store.now();
  const date = businessDate(at);
  store.db.branchClosures = [
    ["gangnam", date],
    ["seongsu", date],
    ["gangnam", shiftClosureDate(date, 7)],
    ["gangnam", shiftClosureDate(date, 8)],
    ["gangnam", shiftClosureDate(date, -1)],
  ].map(([branchId, date], index) => ({
    id: String(index),
    branchId,
    date,
    note: "휴무 안내",
    version: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: { id: "owner", name: "사장님" },
  }));
  const result = await (await read("scope=gangnam")).json();
  expect(result.closures).toEqual([
    {
      branchId: "gangnam",
      branchName: "강남점",
      date,
      note: "휴무 안내",
      today: true,
    },
    {
      branchId: "gangnam",
      branchName: "강남점",
      date: shiftClosureDate(date, 7),
      note: "휴무 안내",
      today: false,
    },
  ]);
});
