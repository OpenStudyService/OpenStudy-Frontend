/** Uses the existing room, locker, pass and customer ledgers. Mock success is not server verification. */
import { http } from "msw/http";
import { z } from "zod";
import type { CrossBranchSummary } from "../features/customers/history-api";
import { canReadCrossBranch } from "../features/customers/history-api";
import { can } from "../shared/domain/schema";
import { assert, store } from "./store";
import { customer } from "./customers";
import { booking } from "./rooms";
import { assignmentView } from "./lockers";
import { passView, paymentResponse } from "./payments";

type Interaction = {
  actorId: string;
  customerId: string;
  branchId: string;
  reason: string;
  at: string;
};
const interactions = new WeakMap<typeof store.events, Interaction[]>();
export const summaryInteractions = () => interactions.get(store.events) ?? [];
const assignments = () => store.db.lockers.flatMap((r) => r.assignments ?? []);
export const customerHistoryHandlers = [
  http.get(
    "/api/customers/:id/space-history",
    paymentResponse(({ request, params }, actor) => {
      const id = String(params.id);
      customer(actor, request, id); // General visibility remains the authoritative gate.
      const scope = new URL(request.url).searchParams.get("scope") ?? "all";
      const selected = (branchId: string) =>
        (scope === "all" || scope === branchId) && can(actor, branchId);
      return {
        customerId: id,
        reservations:
          store.scenario === "empty"
            ? []
            : store.db.reservations
                .filter((r) => r.memberId === id && selected(r.branchId))
                .map((r) => booking(r, actor)),
        assignments:
          store.scenario === "empty"
            ? []
            : assignments()
                .filter((r) => r.customer.id === id && selected(r.branchId))
                .map((r) => assignmentView(r, actor)),
      };
    }),
  ),
  http.post(
    "/api/customers/:id/cross-branch-summary",
    paymentResponse(
      async ({ request, params }, actor): Promise<CrossBranchSummary> => {
        const body = z
          .object({
            branchId: z.string().min(1),
            reason: z.string().trim().min(1).max(500),
          })
          .strict()
          .parse(await request.json());
        assert(
          store.db.branches.some((b) => b.id === body.branchId) &&
            canReadCrossBranch(actor, body.branchId),
          "타 지점 요약 권한이 없어요.",
          403,
          "FORBIDDEN",
        );
        const id = String(params.id);
        assert(
          store.db.members.some((r) => r.id === id),
          "고객을 찾을 수 없어요.",
          404,
          "NOT_FOUND",
        );
        const asOf = store.now();
        const log = interactions.get(store.events) ?? [];
        log.push({ actorId: actor.id, customerId: id, ...body, at: asOf });
        interactions.set(store.events, log); // Does not qualify a customer for exact lookup/inquiry targeting.
        const usages: CrossBranchSummary["usages"] = [
          ...store.db.usage
            .filter((r) => r.memberId === id)
            .map((r) => ({
              kind: "좌석" as const,
              branchId: r.branchId,
              startAt: r.startedAt,
              endAt: r.endedAt || null,
            })),
          ...store.db.reservations
            .filter((r) => r.memberId === id)
            .map((r) => booking(r, actor, true))
            .filter((r) => r.usage)
            .map((r) => ({
              kind: "스터디룸" as const,
              branchId: r.branchId,
              startAt: r.usage!.startedAt,
              endAt: r.usage!.endedAt,
            })),
          ...assignments()
            .filter(
              (r) =>
                r.customer.id === id && ["배정", "반납"].includes(r.status),
            )
            .flatMap((r) => {
              const startAt = new Date(
                `${r.startDate}T00:00:00+09:00`,
              ).toISOString();
              return Date.parse(startAt) > Date.parse(asOf) ||
                (r.returnedAt &&
                  Date.parse(r.returnedAt) <= Date.parse(startAt))
                ? []
                : [
                    {
                      kind: "사물함" as const,
                      branchId: r.branchId,
                      startAt,
                      endAt: r.returnedAt,
                    },
                  ];
            }),
        ];
        return {
          customerId: id,
          passes:
            store.scenario === "empty"
              ? []
              : store.db.passes
                  .filter((r) => r.memberId === id)
                  .map((r) => {
                    const p = passView(actor, r);
                    return {
                      kind: p.kind,
                      productName: p.productName,
                      status: p.status,
                      expiresAt: p.expiresAt,
                    };
                  }),
          usages:
            store.scenario === "empty"
              ? []
              : usages
                  .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
                  .slice(0, 50),
          asOf,
        };
      },
    ),
  ),
];
