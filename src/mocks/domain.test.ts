import { describe, expect, it } from "vitest";
import { MockStore } from "./store";
import { command, create, rowsFor, sales, sendMessage, update } from "./domain";
import { charge, overlap, text } from "../shared/domain/schema";
function owner() {
  const s = new MockStore(false);
  s.persona = "owner";
  return s;
}
const payment = {
  branchId: "gangnam",
  memberId: "member-6",
  productId: "credit",
  method: "Mock 카드",
};
describe("shared customers, projections and channel authorization", () => {
  it("links an existing customer at another branch without creating a duplicate", () => {
    const s = owner(),
      member = s.db.members.find((m) => m.branchIds.length === 1)!;
    const target = member.branchId === "gangnam" ? "seongsu" : "gangnam";
    const count = s.db.members.length;
    const linked = create(s, "members", {
      branchId: target,
      name: member.name,
      phone: member.phone,
      email: member.email,
      status: member.status,
      note: "",
    });
    expect(linked.id).toBe(member.id);
    expect(s.db.members).toHaveLength(count);
    expect(s.get("members", member.id).branchIds).toContain(target);
    expect(() =>
      create(s, "members", {
        branchId: target,
        name: member.name,
        phone: member.phone,
      }),
    ).toThrow(/이미/);
  });
  it("projects expired allocation without discarding its original assignment history", () => {
    const s = owner(),
      locker = s.db.lockers[0];
    Object.assign(locker, {
      memberId: "member-1",
      startsOn: "2026-09-01",
      endsOn: "2026-10-01",
      status: "사용 중",
    });
    const projected = rowsFor(s, "lockers", locker.branchId).find(
      (l) => l.id === locker.id,
    )!;
    expect(text(projected, "status")).toBe("기간 만료");
    expect(s.get("lockers", locker.id).memberId).toBe("member-1");
  });
  it("rejects channel participants from another branch and overposted protected fields", () => {
    const s = owner();
    expect(() =>
      create(s, "channels", {
        branchId: "gangnam",
        name: "운영",
        description: "",
        participantIds: ["doyun"],
      }),
    ).toThrow(/활성 직원/);
    expect(() =>
      create(s, "tasks", { branchId: "gangnam", owner: true }),
    ).toThrow(/허용되지 않은/);
    s.persona = "junho";
    expect(() =>
      create(s, "channels", {
        branchId: "gangnam",
        name: "운영",
        description: "",
        participantIds: ["junho"],
      }),
    ).toThrow(/관리자/);
  });
});
describe("authorization and consumer scope", () => {
  it("denies staff payments and foreign branch reads", () => {
    const s = owner();
    s.persona = "junho";
    expect(() => rowsFor(s, "payments", "gangnam")).toThrow(/권한/);
    expect(() => rowsFor(s, "tasks", "seongsu")).toThrow(/권한/);
    expect(
      rowsFor(s, "tasks", "all").every((t) => t.branchId === "gangnam"),
    ).toBe(true);
  });
  it("filters all-branch financial results by each membership grant", () => {
    const s = owner(),
      u = s.get("employees", "junho");
    u.memberships = [
      { branchId: "gangnam", role: "staff", permissions: ["payments:read"] },
      { branchId: "seongsu", role: "staff", permissions: [] },
    ];
    s.persona = u.id;
    expect(
      rowsFor(s, "payments", "all").every((p) => p.branchId === "gangnam"),
    ).toBe(true);
  });
  it("lets assigned staff complete tasks but refuses reassignment", () => {
    const s = owner();
    s.persona = "junho";
    const t = s.get("tasks", "task-2");
    expect(() =>
      update(s, "tasks", t.id, { version: 1, assigneeId: "minji" }),
    ).toThrow(/상태와 체크리스트/);
    command(s, "tasks", t.id, "complete", { version: 1 });
    expect(t.status).toBe("완료");
    expect(() =>
      command(s, "tasks", "task-1", "complete", { version: 1 }),
    ).toThrow(/본인/);
  });
  it("does not expose unrelated customer history", async () => {
    const { customerHistory } = await import("./domain");
    const s = owner();
    s.persona = "junho";
    expect(() => customerHistory(s, "member-3")).toThrow(/응대/);
    expect(customerHistory(s, "member-1").payments).toEqual([]);
  });
  it("protects version and readonly fields", () => {
    const s = owner();
    expect(() =>
      update(s, "tasks", "task-1", { version: 99, status: "완료" }),
    ).toThrow(/다른 사용자/);
    expect(() =>
      update(s, "tasks", "task-1", { version: 1, history: [] }),
    ).toThrow(/허용되지 않은/);
  });
});
describe("shared ledger and idempotency", () => {
  it("issues one pass for one approval and snapshots product rate", () => {
    const s = owner(),
      before = s.db.passes.length;
    const first = s.transaction("p1", payment, () =>
      create(s, "payments", payment),
    );
    const again = s.transaction("p1", payment, () =>
      create(s, "payments", payment),
    );
    expect(again).toEqual(first);
    expect(s.db.passes.length).toBe(before + 1);
    s.db.products.find((p) => p.id === "credit")!.hourlyRate = 9999;
    expect(s.db.passes.at(-1)?.hourlyRate).toBe(1500);
    expect(() =>
      s.transaction("p1", { ...payment, memberId: "member-1" }, () => null),
    ).toThrow(/다른 내용/);
  });
  it("does not issue on failed payment", () => {
    const s = owner(),
      before = s.db.passes.length;
    create(s, "payments", { ...payment, simulateFailure: true });
    expect(s.db.passes.length).toBe(before);
    expect(s.db.payments.at(-1)?.status).toBe("실패");
  });
  it("refunds unused expired period passes and rejects used ones", () => {
    const s = owner(),
      p = s.db.passes.find((p) => p.id === "pass-2")!;
    p.expiresAt = "2026-10-01T00:00:00Z";
    p.status = "만료";
    const result = command(s, "payments", p.paymentId, "refund", {
      version: 1,
      reason: "미사용",
    });
    expect(result).toMatchObject({ status: "환불" });
    expect(p.status).toBe("환불");
    expect(() =>
      command(s, "payments", "pay-1", "refund", {
        version: 1,
        reason: "사용함",
      }),
    ).toThrow(/실제 사용/);
  });
  it("rolls back partial mutations on validation failure", () => {
    const s = owner();
    expect(() =>
      s.transaction("bad", {}, () =>
        command(s, "payments", "pay-2", "refund", { version: 1, reason: "" }),
      ),
    ).toThrow();
    expect(s.get("payments", "pay-2").status).toBe("승인");
    expect(s.get("passes", "pass-2").status).toBe("활성");
  });
  it("does not reuse authorized results after permission revocation", () => {
    const s = owner();
    s.transaction("key", {}, () => ({ secret: 1 }));
    s.user().owner = false;
    s.user().memberships = [];
    expect(() => s.transaction("key", {}, () => null)).toThrow(/권한이 변경/);
  });
  it("prevents concurrent booking and releases canceled time", () => {
    const s = owner(),
      p = {
        branchId: "gangnam",
        memberId: "member-6",
        roomId: "gangnam-room-a",
        startsAt: "2026-10-18T05:00:00Z",
        endsAt: "2026-10-18T06:00:00Z",
        people: 3,
      };
    const r = create(s, "reservations", p);
    expect(() =>
      s.transaction("collision", p, () => create(s, "reservations", p)),
    ).toThrow(/이미 예약/);
    command(s, "reservations", r.id, "cancel", {
      version: 1,
      reason: "일정 변경",
    });
    expect(() => create(s, "reservations", p)).not.toThrow();
    expect(s.db.payments.find((x) => x.reservationId === r.id)?.status).toBe(
      "환불",
    );
  });
  it("does not reserve room on failed charge", () => {
    const s = owner(),
      p = {
        branchId: "gangnam",
        memberId: "member-6",
        roomId: "gangnam-room-a",
        startsAt: "2026-10-18T05:00:00Z",
        endsAt: "2026-10-18T06:00:00Z",
        people: 3,
      };
    create(s, "reservations", { ...p, simulateFailure: true });
    expect(() => create(s, "reservations", p)).not.toThrow();
  });
  it("charges once on checkout, cannot assign a customer twice", () => {
    const s = owner(),
      seat = s.get("seats", "gangnam-seat-1");
    command(s, "seats", seat.id, "assign", {
      version: 1,
      memberId: "member-6",
      passId: "pass-6",
    });
    expect(() =>
      command(s, "seats", "gangnam-seat-2", "assign", {
        version: 1,
        memberId: "member-6",
        passId: "pass-6",
      }),
    ).toThrow(/다른 좌석/);
    const payload = { version: seat.version };
    s.transaction("out", payload, () =>
      command(s, "seats", seat.id, "checkout", payload),
    );
    const remain = s.get("passes", "pass-6").remaining;
    s.transaction("out", payload, () =>
      command(s, "seats", seat.id, "checkout", payload),
    );
    expect(s.get("passes", "pass-6").remaining).toBe(remain);
    expect(seat.status).toBe("이용 가능");
  });
  it("uses half-open ranges and correct rounding", () => {
    expect(
      overlap(
        "2026-01-01T00:00Z",
        "2026-01-01T01:00Z",
        "2026-01-01T01:00Z",
        "2026-01-01T02:00Z",
      ),
    ).toBe(false);
    expect(
      charge("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "정액권", 1500),
    ).toEqual({ minutes: 1, charged: 25 });
    expect(
      charge("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "시간권", 0)
        .charged,
    ).toBe(0);
  });
  it("separates the two refund date bases and excludes consumption from sales", () => {
    const s = owner(),
      processed = sales(s, "all", "2026-09-01", "2026-10-01", "processed"),
      original = sales(s, "all", "2026-09-01", "2026-10-01", "original");
    expect(processed.reduce((v, r) => v + r.net, 0)).toBe(400000);
    expect(original.reduce((v, r) => v + r.net, 0)).toBe(300000);
  });
});
describe("collaboration and workforce consistency", () => {
  it("deduplicates messages and rejects foreign channel/thread", () => {
    const s = owner();
    s.persona = "junho";
    const p = {
      channelId: "gangnam",
      parentId: "",
      taskId: "",
      text: "보고 완료",
      clientMessageId: "m1",
    };
    const a = sendMessage(s, p),
      b = sendMessage(s, p);
    expect(a.id).toBe(b.id);
    expect(() =>
      sendMessage(s, { ...p, channelId: "seongsu", clientMessageId: "m2" }),
    ).toThrow(/참여하지/);
    expect(() =>
      sendMessage(s, { ...p, parentId: "msg-5", clientMessageId: "m3" }),
    ).toThrow(/스레드/);
  });
  it("calculates next check date in date-only space", () => {
    const s = owner(),
      r = create(s, "facilities", {
        branchId: "gangnam",
        title: "점검",
        category: "정기 점검",
        assigneeId: "junho",
        body: "필터",
        cycleDays: 14,
        lastChecked: "2026-10-01",
      });
    expect(r).toMatchObject({ nextCheck: "2026-10-15" });
  });
  it("approves/cancels leave exactly once", async () => {
    const { leaveBalance } = await import("./domain");
    const s = owner();
    s.persona = "junho";
    const r = create(s, "leaveRequests", {
      branchId: "gangnam",
      startsOn: "2026-10-20",
      endsOn: "2026-10-20",
      amount: 1,
      reason: "개인 일정",
    });
    expect(leaveBalance(s, "junho", "2026-10-20")).toBe(15);
    s.persona = "owner";
    command(s, "leaveRequests", r.id, "approve", { version: 1 });
    expect(leaveBalance(s, "junho", "2026-10-20")).toBe(14);
    command(s, "leaveRequests", r.id, "cancel", { version: r.version });
    expect(leaveBalance(s, "junho", "2026-10-20")).toBe(15);
    expect(() =>
      command(s, "leaveRequests", r.id, "cancel", { version: r.version }),
    ).toThrow(/이미 처리/);
  });
  it("updates and restores the original shift on substitute approval/cancel", () => {
    const s = owner();
    s.persona = "junho";
    const r = create(s, "substitutions", {
      branchId: "gangnam",
      shiftId: "shift-junho",
      substituteId: "minji",
      startsAt: "2026-10-18T00:00:00Z",
      endsAt: "2026-10-18T09:00:00Z",
      reason: "대체근무",
    });
    s.persona = "owner";
    command(s, "substitutions", r.id, "approve", { version: 1 });
    expect(s.get("shifts", "shift-junho").employeeId).toBe("minji");
    command(s, "substitutions", r.id, "cancel", { version: r.version });
    expect(s.get("shifts", "shift-junho").employeeId).toBe("junho");
  });
});
