import { useState, type FormEvent } from "react";
import { useApp } from "../../app/context";
import { Button } from "../../shared/ui/primitives";
import type { components } from "../../shared/api/foundation.generated";
import { seoulInput, shiftTime, type Shift } from "./api";
import type { AttendanceRecord } from "./attendance-api";
import { RequestFeedback } from "./RequestFeedback";
import { useRequestWrite } from "./useRequestWrite";

type Schemas = components["schemas"];
type Interval = { id: string; label: string; start: string; end: string };

function IntervalRequest({
  title,
  intervals,
  replacements,
  submit,
}: {
  title: string;
  intervals: Interval[];
  replacements?: { id: string; name: string }[];
  submit: (
    interval: string,
    start: string,
    end: string,
    reason: string,
    replacement: string,
  ) => {
    path: string;
    body: Schemas["AttendanceCorrectionCreate"] | Schemas["ShiftSwapCreate"];
  };
}) {
  const [selected, setSelected] = useState(intervals[0].id);
  const current = intervals.find((i) => i.id === selected) ?? intervals[0];
  const [success, setSuccess] = useState(false);
  const write = useRequestWrite("attendance-corrections", "shift-swaps");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const instant = (name: string) =>
      new Date(`${fields.get(name)}+09:00`).toISOString();
    const reason = String(fields.get("reason")).trim();
    if (!reason) return;
    const { path, body } = submit(
      current.id,
      instant("start"),
      instant("end"),
      reason,
      String(fields.get("replacement")),
    );
    void write.create(path, body, () => {
      form.reset();
      setSuccess(true);
    });
  }
  return (
    <form className="grid gap-3" onSubmit={save}>
      <h3>{title}</h3>
      <fieldset
        disabled={write.busy}
        className="grid gap-3"
        onChange={() => setSuccess(false)}
      >
        {intervals.length > 1 && (
          <label>
            정정 구간
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {intervals.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {replacements && (
          <label>
            대체 직원
            <select name="replacement" required defaultValue="">
              <option value="">직원 선택</option>
              {replacements.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div key={current.id} className="grid gap-3">
          <label>
            변경 시작 시각 (서울)
            <input
              required
              name="start"
              type="datetime-local"
              step="1"
              defaultValue={current.start}
            />
          </label>
          <label>
            변경 종료 시각 (서울)
            <input
              required
              name="end"
              type="datetime-local"
              step="1"
              defaultValue={current.end}
            />
          </label>
        </div>
        <label>
          신청 사유
          <textarea required name="reason" maxLength={500} />
        </label>
        <Button type="submit" disabled={write.busy || success}>
          신청하기
        </Button>
      </fieldset>
      {write.error && <RequestFeedback error={write.error} />}
      {success && <p role="status">신청을 접수했습니다.</p>}
    </form>
  );
}

export function CorrectionForm({ row }: { row: AttendanceRecord }) {
  const { session } = useApp();
  if (
    row.employee.id !== session.user.id ||
    row.status !== "퇴근" ||
    !row.clockOutAt
  )
    return null;
  const secondsInput = (value: string) =>
    `${seoulInput(value)}:${new Date(value).toISOString().slice(17, 19)}`;
  const intervals = [
    {
      id: "",
      label: "출퇴근",
      start: secondsInput(row.clockInAt),
      end: secondsInput(row.clockOutAt),
    },
  ];
  for (const item of row.breaks) {
    if (item.endedAt)
      intervals.push({
        id: item.id,
        label: `휴게 · ${shiftTime(item.startedAt)}`,
        start: secondsInput(item.startedAt),
        end: secondsInput(item.endedAt),
      });
  }
  return (
    <IntervalRequest
      title="기록 정정 신청"
      intervals={intervals}
      submit={(breakId, start, end, reason) => ({
        path: `/attendance-records/${encodeURIComponent(row.id)}/corrections`,
        body: breakId
          ? {
              kind: "휴게",
              breakId,
              breakStartedAt: start,
              breakEndedAt: end,
              reason,
            }
          : { kind: "출퇴근", clockInAt: start, clockOutAt: end, reason },
      })}
    />
  );
}

export function SwapForm({ row }: { row: Shift }) {
  const { session, lookups } = useApp();
  if (
    row.employee.id !== session.user.id ||
    row.status === "취소" ||
    Date.parse(row.startsAt) <= Date.parse(session.asOf) ||
    lookups.branches.some(
      (branch) => branch.id === row.branchId && branch.status === "운영 중지",
    )
  )
    return null;
  const replacements = lookups.employees.filter(
    (employee) =>
      employee.id !== session.user.id &&
      (!employee.memberships ||
        employee.memberships.some(
          (membership) =>
            membership.branchId === row.branchId &&
            (!membership.status || membership.status === "활성"),
        )),
  );
  return (
    <IntervalRequest
      title="대체근무 신청"
      replacements={replacements}
      intervals={[
        {
          id: row.id,
          label: "근무",
          start: seoulInput(row.startsAt),
          end: seoulInput(row.endsAt),
        },
      ]}
      submit={(_, start, end, reason, replacementEmployeeId) => ({
        path: `/shifts/${encodeURIComponent(row.id)}/swaps`,
        body: {
          replacementEmployeeId,
          proposedStartsAt: start,
          proposedEndsAt: end,
          reason,
        },
      })}
    />
  );
}
