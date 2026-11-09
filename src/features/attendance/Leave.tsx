import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { admin } from "../../shared/domain/schema";
import { DataNotice } from "../../shared/ui/DataNotice";
import { Button } from "../../shared/ui/primitives";
import { RequestFeedback } from "./RequestFeedback";
import { RequestList } from "./RequestLists";
import { useRequestWrite } from "./useRequestWrite";
import { shiftTime } from "./api";
import {
  calendarDays,
  leaveBalance,
  leaveGrantDetail,
  leaveGrants,
  leaveRequests,
  type LeaveGrantCreate,
  type LeaveRequestCreate,
} from "./leave-api";

const affectedReads = [
  "leave-balance",
  "leave-grants",
  "leave-grant-detail",
  "leaveRequests",
  "shifts",
  "home",
];
const active = (status?: string) => !status || status === "활성";

function GrantHistory({ id }: { id: string }) {
  const { session, scope } = useApp();
  const detail = useQuery({
    queryKey: ["data", session.user.id, scope, "leave-grant-detail", id],
    queryFn: ({ signal }) => leaveGrantDetail(id, signal),
    retry: false,
  });
  return (
    <>
      <DataNotice
        label="휴가 내역"
        loading={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}
      />
      {detail.data && (
        <ul className="grid gap-1">
          {detail.data.events.map((event, index) => (
            <li key={index}>
              {event.type} · {event.deltaDays > 0 ? "+" : ""}
              {event.deltaDays}일 · {event.actor.name} ·{" "}
              {shiftTime(event.createdAt)}
              {event.leaveRequestId && ` · 휴가 #${event.leaveRequestId}`}
              {event.reason && ` · ${event.reason}`}
            </li>
          ))}
          <li>
            내역 합계{" "}
            {detail.data.events.reduce(
              (sum, event) => sum + event.deltaDays,
              0,
            )}
            일
          </li>
        </ul>
      )}
    </>
  );
}

function GrantHistoryToggle({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "내역 닫기" : "부여·사용·복원 내역"}
      </Button>
      {open && <GrantHistory id={id} />}
    </div>
  );
}

export function LeaveBalances() {
  const { session, scope, lookups } = useApp();
  const [employee, setEmployee] = useState("");
  const selected =
    admin(session.user, scope) &&
    lookups.employees.some((person) => person.id === employee)
      ? employee
      : "";
  const balance = useQuery({
    queryKey: ["data", session.user.id, scope, "leave-balance", selected],
    queryFn: ({ signal }) => leaveBalance(selected || undefined, signal),
    retry: false,
  });
  return (
    <section className="card mb-5 grid gap-2 p-5" aria-label="휴가 잔여량">
      <h2>휴가 잔여량</h2>
      {admin(session.user, scope) && (
        <label>
          잔여량 조회 대상
          <select
            value={selected}
            onChange={(event) => setEmployee(event.target.value)}
          >
            <option value="">본인</option>
            {lookups.employees
              .filter((person) => person.id !== session.user.id)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <DataNotice
        label="휴가 잔여량"
        loading={balance.isPending}
        error={balance.error}
        retry={() => void balance.refetch()}
      />
      {balance.data && (
        <>
          <p>
            {balance.data.employee.name} · 잔여{" "}
            {balance.data.totalRemainingDays}일
          </p>
          {balance.data.grants.map((grant) => (
            <div key={grant.grantId} className="border-t py-2">
              <p>
                {grant.validFrom} ~ {grant.validThrough} · 잔여{" "}
                {grant.remainingDays}일{grant.expired && " · 만료"}
              </p>
              {(!selected || admin(session.user, grant.originBranchId)) && (
                <GrantHistoryToggle id={grant.grantId} />
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function LeaveRequestForm() {
  const { session, scope, lookups } = useApp();
  const branches = lookups.branches.filter(
    (branch) =>
      branch.status !== "운영 중지" &&
      session.user.memberships.some(
        (membership) =>
          membership.branchId === branch.id && active(membership.status),
      ),
  );
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState("");
  const [saved, setSaved] = useState(false);
  const write = useRequestWrite("leave-requests");
  const maximum = calendarDays(start, end);
  let issue = "";
  if (start && end && (maximum < 1 || start.slice(0, 4) !== end.slice(0, 4))) {
    issue = "같은 해에서 시작일 이후의 종료일을 선택해 주세요.";
  } else if (
    days &&
    (Number(days) < 0.5 || !Number.isInteger(Number(days) * 2))
  ) {
    issue = "신청 일수는 0.5일 단위로 입력해 주세요.";
  } else if (days && Number(days) > maximum) {
    issue = `신청 일수는 기간의 달력 일수(${maximum}일)를 넘을 수 없습니다.`;
  }
  if (!branches.length) return null;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body: LeaveRequestCreate = {
      branchId: String(fields.get("branch")),
      startsOn: start,
      endsOn: end,
      requestedDays: Number(days),
      reason: String(fields.get("reason")).trim(),
    };
    if (issue || !body.reason) return;
    void write.create("/leave-requests", body, () => {
      form.reset();
      setStart("");
      setEnd("");
      setDays("");
      setSaved(true);
    });
  }

  return (
    <form
      className="card grid gap-3 p-4"
      onSubmit={save}
      onChange={() => setSaved(false)}
    >
      <h3>휴가 신청</h3>
      <fieldset className="grid gap-3" disabled={write.busy}>
        <label>
          신청 지점
          <select
            name="branch"
            required
            defaultValue={
              branches.find((branch) => branch.id === scope)?.id ??
              (branches.length === 1 ? branches[0].id : "")
            }
          >
            <option value="">지점 선택</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          시작일
          <input
            type="date"
            required
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          종료일
          <input
            type="date"
            required
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <label>
          신청 일수
          <input
            type="number"
            required
            min="0.5"
            step="0.5"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </label>
        <label>
          사유
          <textarea name="reason" required maxLength={500} />
        </label>
        {issue && <p role="alert">{issue}</p>}
        <Button type="submit" disabled={write.busy || !!issue || saved}>
          휴가 신청 등록
        </Button>
      </fieldset>
      {write.error && <RequestFeedback error={write.error} />}
      {saved && <p role="status">휴가 신청을 접수했습니다.</p>}
    </form>
  );
}

export function LeaveRequests() {
  const { scope, session } = useApp();
  return (
    <>
      <LeaveRequestForm key={`${session.user.id}:${scope}`} />
      <RequestList
        resource="leave-requests"
        service={leaveRequests}
        title="휴가 신청·승인"
        effects={affectedReads}
      >
        {(row) => (
          <>
            <h3>
              {row.employee.name} · {row.requestedDays}일
            </h3>
            <p>
              {row.startsOn} ~ {row.endsOn}
            </p>
            {row.allocations.map((allocation) => (
              <p key={allocation.grantId}>
                부여 #{allocation.grantId} ·{" "}
                {allocation.restored ? "복원" : "사용"} {allocation.days}일
              </p>
            ))}
          </>
        )}
      </RequestList>
    </>
  );
}

function GrantForm() {
  const { scope, session, lookups } = useApp();
  const branches = lookups.branches.filter(
    (branch) => admin(session.user, branch.id) && branch.status !== "운영 중지",
  );
  const [branch, setBranch] = useState(
    branches.find((item) => item.id === scope)?.id ??
      (branches.length === 1 ? branches[0].id : ""),
  );
  const [saved, setSaved] = useState(false);
  const write = useRequestWrite(...affectedReads);
  if (!branches.length) return null;
  const employees = lookups.employees.filter(
    (employee) =>
      !employee.memberships ||
      employee.memberships.some(
        (membership) =>
          membership.branchId === branch && active(membership.status),
      ),
  );
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body: LeaveGrantCreate = {
      originBranchId: branch,
      employeeId: String(fields.get("employee")),
      grantYear: Number(fields.get("year")),
      validFrom: String(fields.get("from")),
      validThrough: String(fields.get("to")),
      grantedDays: Number(fields.get("days")),
      reason: String(fields.get("reason")).trim(),
    };
    if (!branches.some((item) => item.id === branch) || !body.reason) return;
    void write.create("/leave-grants", body, () => {
      form.reset();
      setSaved(true);
    });
  }
  return (
    <form
      className="card grid gap-3 p-4"
      onSubmit={save}
      onChange={() => setSaved(false)}
    >
      <h3>휴가 부여 등록</h3>
      <fieldset className="grid gap-3" disabled={write.busy}>
        <label>
          부여 지점
          <select
            required
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            <option value="">지점 선택</option>
            {branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          부여 직원
          <select
            key={branch}
            name="employee"
            required
            defaultValue=""
            disabled={!branch}
          >
            <option value="">직원 선택</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          부여 연도
          <input name="year" type="number" required min="2000" max="2100" />
        </label>
        <label>
          유효 시작일
          <input name="from" type="date" required />
        </label>
        <label>
          유효 종료일
          <input name="to" type="date" required />
        </label>
        <label>
          부여 일수
          <input
            name="days"
            type="number"
            required
            min="0.5"
            max="366"
            step="0.5"
          />
        </label>
        <label>
          부여 사유
          <textarea name="reason" required maxLength={500} />
        </label>
        <Button type="submit" disabled={write.busy || !branch || saved}>
          휴가 부여하기
        </Button>
      </fieldset>
      {write.error && <RequestFeedback error={write.error} />}
      {saved && <p role="status">휴가를 부여했습니다.</p>}
    </form>
  );
}

export function LeaveGrants() {
  const { session, scope } = useApp();
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: ["data", session.user.id, scope, "leave-grants", page],
    queryFn: ({ signal }) => leaveGrants(scope, page, signal),
    enabled: admin(session.user, scope),
    retry: false,
  });
  if (!admin(session.user, scope)) return null;
  return (
    <section className="grid gap-3 p-4">
      <GrantForm key={`${session.user.id}:${scope}`} />
      <DataNotice
        label="휴가 부여 목록"
        loading={rows.isPending}
        error={rows.error}
        retry={() => void rows.refetch()}
      />
      {rows.data?.items.map((row) => (
        <article className="card grid gap-2 p-4" key={row.id}>
          <h3>
            {row.employee.name} · {row.grantYear}년 부여
          </h3>
          <p>
            {row.validFrom} ~ {row.validThrough} · 부여 {row.grantedDays}일 ·
            잔여 {row.remainingDays}일{row.expired && " · 만료"}
          </p>
          <GrantHistoryToggle id={row.id} />
        </article>
      ))}
      <div className="flex items-center gap-3">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          이전
        </Button>
        <span>
          {page}페이지 · {rows.data?.total ?? 0}건
        </span>
        <Button
          disabled={!rows.data || page * 20 >= rows.data.total}
          onClick={() => setPage(page + 1)}
        >
          다음
        </Button>
      </div>
    </section>
  );
}
