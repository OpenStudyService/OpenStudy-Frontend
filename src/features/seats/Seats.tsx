import { CustomerMergeErrorLink } from "../customers/CustomerMergeErrorLink";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { lazy, Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { ApiError, MOCK } from "../../shared/api/client";
import { formatShortDateTime, formatKrw } from "../../shared/domain/format";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Field, SaveError } from "../organization/shared";
import { seatApi } from "./api";
import { seatLeaveMessage, useSeatLeaveGuard } from "./leaveGuard";
import {
  useSeatBoard,
  useSeatDetail,
  useSeatSession,
  useSeatWrite,
} from "./hooks";
import {
  canUseSeats,
  canWriteSeats,
  canManageSeats,
  occupancyLabel,
  seatKinds,
  seatStatuses,
} from "./model";
import type {
  CheckIn,
  CheckOut,
  CheckInCandidate,
  Seat,
  SeatCounts,
  SeatSession,
  UsablePass,
} from "./model";

const uncertain = (error: Error) =>
  !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
const OccupancyTrend = lazy(() =>
  import("./OccupancyTrend").then(({ OccupancyTrend }) => ({
    default: OccupancyTrend,
  })),
);

export function Seats({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp();
  const authorization = JSON.stringify([
    session.user.id,
    scope,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  return <SeatsWorkspace key={authorization} embedded={embedded} />;
}

function Counts({ counts }: { counts: SeatCounts }) {
  return (
    <div className="grid gap-2 p-5 sm:grid-cols-5" aria-label="좌석 현황">
      {[
        ["전체", counts.total],
        ["사용 중", counts.inUse],
        ["사용 가능", counts.available],
        ["운영 중단", counts.blocked],
        ["점유율", occupancyLabel(counts.occupancyRate)],
      ].map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong className="block text-xl">{value}</strong>
        </div>
      ))}
      <p className="help sm:col-span-5">
        기준 시점: {formatShortDateTime(counts.asOf)} · 유형 필터 기준 전체 좌석
        현황
      </p>
    </div>
  );
}

function SeatsWorkspace({ embedded }: { embedded: boolean }) {
  const { session, scope } = useApp();
  const [params, setParams] = useSearchParams();
  const branches = session.branches.filter((b) =>
    canUseSeats(session.user, b.id),
  );
  const requestedBranch = params.get("seatBranch") || "";
  const branchId =
    scope === "all"
      ? branches.find((b) => b.id === requestedBranch)?.id || ""
      : scope;
  const kind = seatKinds.find((k) => k === params.get("kind")) || "";
  const zone = params.get("zone") || "";
  const status = seatStatuses.find((s) => s === params.get("status")) || "";
  const board = useSeatBoard(branchId, kind);
  const occupancy = useQuery({
    queryKey: ["data", session.user.id, scope, "seats", "occupancy"],
    queryFn: ({ signal }) => seatApi.occupancy(scope, signal),
    enabled: scope === "all" && !branchId,
    retry: false,
  });
  const detail = params.get("detail") || "";
  const showTrend = params.get("seatTrend") === "true";
  const update = (key: string, value: string) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      if (key === "seatBranch") {
        p.delete("zone");
        p.delete("detail");
      }
      return p;
    });
  const selectedBranch = branches.find((b) => b.id === branchId);
  return (
    <section className={embedded ? "" : "page"}>
      {!embedded && (
        <Heading
          title="좌석 관리"
          description="지점의 좌석 배치와 이용 현황을 확인하고 입퇴실을 처리해요."
        />
      )}
      {MOCK && (
        <p className="help mb-4">
          데모 화면입니다. 변경 내용은 실제 좌석·이용권에 반영되지 않습니다.
        </p>
      )}
      <div className="card">
        <div className="filters">
          {scope === "all" && (
            <Field label="좌석 지점">
              <select
                value={branchId}
                onChange={(e) => update("seatBranch", e.target.value)}
              >
                <option value="">전체 지점 현황</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {branchId && (
            <>
              <Field label="구역 필터">
                <select
                  value={zone}
                  onChange={(e) => update("zone", e.target.value)}
                >
                  <option value="">전체 구역</option>
                  {board.data?.zones.map((z) => (
                    <option key={z.zone}>{z.zone}</option>
                  ))}
                </select>
              </Field>
              <Field label="좌석 유형 필터">
                <select
                  value={kind}
                  onChange={(e) => update("kind", e.target.value)}
                >
                  <option value="">전체 유형</option>
                  {seatKinds.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <Field label="좌석 상태 필터">
                <select
                  value={status}
                  onChange={(e) => update("status", e.target.value)}
                >
                  <option value="">전체 상태</option>
                  {seatStatuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Button
                aria-expanded={showTrend}
                onClick={() => update("seatTrend", showTrend ? "" : "true")}
              >
                좌석 점유 추이
              </Button>
              {canWriteSeats(session.user, branchId) && (
                <Button
                  variant="primary"
                  className="ml-auto"
                  onClick={() => update("detail", "new")}
                >
                  좌석 등록
                </Button>
              )}
            </>
          )}
        </div>
        {!branchId ? (
          occupancy.isPending ? (
            <State loading />
          ) : hasBlockingReadError(occupancy) ? (
            <ErrorState
              error={occupancy.error!}
              retry={() => void occupancy.refetch()}
            />
          ) : (
            <div className="grid gap-3 p-5">
              {occupancy.data?.items.map((c) => (
                <article className="card" key={c.branchId}>
                  <Button onClick={() => update("seatBranch", c.branchId)}>
                    {branches.find((b) => b.id === c.branchId)?.name ||
                      c.branchId}{" "}
                    배치도 보기
                  </Button>
                  <Counts counts={c} />
                </article>
              ))}
              {!occupancy.data?.items.length && (
                <State title="조회 가능한 지점이 없어요" />
              )}
            </div>
          )
        ) : !selectedBranch ? (
          <State title="이 지점의 좌석을 조회할 권한이 없어요" />
        ) : board.isPending ? (
          <State loading />
        ) : hasBlockingReadError(board) ? (
          <ErrorState error={board.error!} retry={() => void board.refetch()} />
        ) : (
          board.data && (
            <>
              <Counts counts={board.data.counts} />
              {board.data.zones
                .filter((z) => !zone || zone === z.zone)
                .map((z) => (
                  <div key={z.zone}>
                    <h3 className="px-5 pt-4">{z.zone}</h3>
                    <div className="data-scroll">
                      <div className="seat-grid">
                        {z.seats
                          .filter((s) => !status || status === s.status)
                          .map((s) => (
                            <button
                              key={s.id}
                              className={`seat ${s.status === "사용 중" ? "occupied" : s.status === "운영 중단" ? "unavailable" : ""}`}
                              onClick={() => update("detail", s.id)}
                              aria-label={`${s.seatNo} ${s.kind} ${s.status}`}
                            >
                              <b>{s.seatNo}</b>
                              <small className="text-inherit">
                                {s.kind} · {s.status}
                              </small>
                              {s.activeSession && (
                                <small className="text-inherit">
                                  {s.activeSession.customer.name}
                                </small>
                              )}
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                ))}
              {!board.data.zones
                .flatMap((z) => (!zone || z.zone === zone ? z.seats : []))
                .filter((s) => !status || s.status === status).length && (
                <State title="조건에 맞는 좌석이 없어요" />
              )}
            </>
          )
        )}
      </div>
      {selectedBranch && showTrend && (
        <Suspense fallback={<State loading />}>
          <OccupancyTrend
            key={selectedBranch.id}
            branchId={selectedBranch.id}
            branchName={selectedBranch.name}
            userId={session.user.id}
          />
        </Suspense>
      )}
      {branchId && detail && (
        <SeatPanel
          key={`${branchId}:${detail}`}
          id={detail}
          branchId={branchId}
          onClose={() => update("detail", "")}
        />
      )}
    </section>
  );
}

type Action = "edit" | "status" | "checkin" | "checkout" | "move";
function SeatPanel({
  id,
  branchId,
  onClose,
}: {
  id: string;
  branchId: string;
  onClose: () => void;
}) {
  const { session } = useApp();
  const row = useSeatDetail(id === "new" ? "" : id);
  const [action, setAction] = useState<Action | "">("");
  const [actionSessionId, setActionSessionId] = useState("");
  const [result, setResult] = useState<SeatSession | null>(null);
  const [dirty, setDirty] = useState(false);
  const leave = useSeatLeaveGuard(dirty);
  const saved = () => {
    leave.saved();
    setDirty(false);
    setAction("");
  };
  const seat = row.data;
  const currentSession = useSeatSession(
    action === "checkout" || action === "move"
      ? actionSessionId
      : seat?.activeSession?.id || "",
  );
  const write = canWriteSeats(session.user, branchId);
  const use = canUseSeats(session.user, branchId);
  return (
    <Panel
      open
      title={id === "new" ? "좌석 등록" : `${seat?.seatNo || "좌석"} 상세`}
      description="좌석 운영과 직원 예외 입퇴실을 처리해요."
      onClose={onClose}
    >
      {leave.guard}
      <div onChange={() => setDirty(true)}>
        {result && <SessionResult session={result} />}
        {id === "new" ? (
          write ? (
            <SeatEditor
              branchId={branchId}
              onSaved={() => {
                saved();
                onClose();
              }}
            />
          ) : (
            <State title="좌석을 등록할 권한이 없어요" />
          )
        ) : row.isPending ? (
          <State loading />
        ) : row.error ? (
          <ErrorState error={row.error} retry={() => void row.refetch()} />
        ) : (
          seat &&
          (seat.branchId !== branchId ? (
            <State title="선택한 지점의 좌석이 아니에요" />
          ) : (
            <>
              <p className="mb-4">
                {seat.zone} · {seat.seatNo} · {seat.kind}{" "}
                <Badge>{seat.status}</Badge>
              </p>
              {action === "edit" && write ? (
                <SeatEditor branchId={branchId} seat={seat} onSaved={saved} />
              ) : action === "status" &&
                canManageSeats(session.user, branchId) ? (
                <StatusEditor seat={seat} onSaved={saved} />
              ) : action === "checkin" && use ? (
                <CheckInForm
                  seat={seat}
                  onSaved={(r) => {
                    setResult(r);
                    saved();
                  }}
                />
              ) : (action === "checkout" || action === "move") && use ? (
                currentSession.isPending ? (
                  <State loading />
                ) : currentSession.error ? (
                  <ErrorState
                    error={currentSession.error}
                    retry={() => void currentSession.refetch()}
                  />
                ) : (
                  currentSession.data && (
                    <SessionAction
                      key={action}
                      action={action}
                      session={currentSession.data}
                      onSaved={(r) => {
                        setResult(r);
                        saved();
                      }}
                    />
                  )
                )
              ) : (
                <>
                  {seat.activeSession && (
                    <div className="tip mb-4">
                      <b>
                        {seat.activeSession.customer.name} ·{" "}
                        {seat.activeSession.customer.memberNo}
                      </b>
                      <p>
                        입실{" "}
                        {formatShortDateTime(seat.activeSession.checkedInAt)}
                      </p>
                      {currentSession.error && (
                        <ErrorState
                          error={currentSession.error}
                          retry={() => void currentSession.refetch()}
                        />
                      )}
                      {currentSession.data && (
                        <p>
                          {currentSession.data.pass.productName} ·{" "}
                          {currentSession.data.pass.kind}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {write && (
                      <Button
                        onClick={() => {
                          setResult(null);
                          setAction("edit");
                        }}
                      >
                        좌석 수정
                      </Button>
                    )}
                    {canManageSeats(session.user, branchId) &&
                      seat.status !== "사용 중" && (
                        <Button
                          onClick={() => {
                            setResult(null);
                            setAction("status");
                          }}
                        >
                          {seat.status === "운영 중단"
                            ? "운영 재개"
                            : "운영 중단"}
                        </Button>
                      )}
                    {use && seat.status === "사용 가능" && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setResult(null);
                          setAction("checkin");
                        }}
                      >
                        직원 예외 입실
                      </Button>
                    )}
                    {use && seat.activeSession && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setResult(null);
                          setActionSessionId(seat.activeSession!.id);
                          setAction("checkout");
                        }}
                      >
                        퇴실 처리
                      </Button>
                    )}
                    {write && seat.activeSession && (
                      <Button
                        onClick={() => {
                          setResult(null);
                          setActionSessionId(seat.activeSession!.id);
                          setAction("move");
                        }}
                      >
                        좌석 이동
                      </Button>
                    )}
                  </div>
                </>
              )}
              {action && (
                <Button
                  className="mt-4"
                  variant="quiet"
                  onClick={() => {
                    if (!dirty || window.confirm(seatLeaveMessage)) saved();
                  }}
                >
                  상세로 돌아가기
                </Button>
              )}
            </>
          ))
        )}
      </div>
    </Panel>
  );
}

function useFormErrors(refresh: () => Promise<unknown>) {
  const [error, setError] = useState<Error | null>(null);
  const [latest, setLatest] = useState("");
  const denied =
    error instanceof ApiError && [401, 403, 404].includes(error.status);
  return {
    error,
    setError,
    denied,
    feedback: (
      <SaveError
        error={error}
        latest={latest}
        refresh={async () => {
          try {
            const result = await refresh();
            setLatest(
              typeof result === "string" ? result : "최신 정보를 불러왔어요",
            );
          } catch (error) {
            setError(
              error instanceof Error
                ? error
                : new Error("최신 내용을 불러오지 못했어요"),
            );
          }
        }}
        fieldLabels={{
          zone: "구역",
          seatNo: "좌석 번호",
          kind: "유형",
          reason: "사유",
          toSeatId: "이동할 좌석",
        }}
      />
    ),
  };
}

function SeatEditor({
  branchId,
  seat,
  onSaved,
}: {
  branchId: string;
  seat?: Seat;
  onSaved: () => void;
}) {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const write = useSeatWrite();
  const [zone, setZone] = useState(seat?.zone || "");
  const [seatNo, setSeatNo] = useState(seat?.seatNo || "");
  const [kind, setKind] = useState<Seat["kind"]>(seat?.kind || "일반");
  const [status, setStatus] = useState<"사용 가능" | "운영 중단">("사용 가능");
  const [version, setVersion] = useState(seat?.version);
  const errors = useFormErrors(async () => {
    if (seat) {
      const latest = await write.run(
        `seat-refresh:${seat.id}`,
        {},
        (signal) => seatApi.detail(scope, seat.id, signal),
        false,
      );
      setVersion(latest.version);
      await invalidateReads(
        query,
        session.user.id,
        "seats",
        "seat-sessions",
        "usage",
        "lookups",
        "home",
      );
      return `${latest.zone} · ${latest.seatNo} · ${latest.kind} · ${latest.status} (버전 ${latest.version})`;
    }
    await invalidateReads(
      query,
      session.user.id,
      "seats",
      "seat-sessions",
      "usage",
      "lookups",
      "home",
    );
    await query.invalidateQueries({ queryKey: ["session"] });
  });
  const allowed = canWriteSeats(session.user, branchId) && !errors.denied;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (!allowed) return;
        const body = seat
          ? {
              version: version!,
              zone: zone.trim(),
              seatNo: seatNo.trim(),
              kind,
            }
          : {
              branchId,
              zone: zone.trim(),
              seatNo: seatNo.trim(),
              kind,
              status,
            };
        void write
          .run(
            seat ? `seat-update:${seat.id}` : `seat-create:${branchId}`,
            body,
            (signal, key) =>
              seat
                ? seatApi.update(
                    scope,
                    seat.id,
                    {
                      version: version!,
                      zone: zone.trim(),
                      seatNo: seatNo.trim(),
                      kind,
                    },
                    signal,
                  )
                : seatApi.create(
                    scope,
                    {
                      branchId,
                      zone: zone.trim(),
                      seatNo: seatNo.trim(),
                      kind,
                      status,
                    },
                    signal,
                    key,
                  ),
          )
          .then(onSaved)
          .catch(errors.setError);
      }}
    >
      <fieldset className="contents" disabled={!allowed || write.busy}>
        <Field label="구역">
          <input
            required
            maxLength={80}
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
        </Field>
        <Field label="좌석 번호">
          <input
            required
            maxLength={30}
            value={seatNo}
            onChange={(e) => setSeatNo(e.target.value)}
          />
        </Field>
        <Field label="좌석 유형">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Seat["kind"])}
          >
            {seatKinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        {!seat && (
          <Field label="초기 운영 상태">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option>사용 가능</option>
              <option>운영 중단</option>
            </select>
          </Field>
        )}
        <Button variant="primary" disabled={!zone.trim() || !seatNo.trim()}>
          {seat ? "변경 저장" : "좌석 등록 완료"}
        </Button>
      </fieldset>
      {errors.feedback}
    </form>
  );
}

function StatusEditor({ seat, onSaved }: { seat: Seat; onSaved: () => void }) {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const write = useSeatWrite();
  const [reason, setReason] = useState("");
  const [status] = useState<"사용 가능" | "운영 중단">(
    seat.status === "운영 중단" ? "사용 가능" : "운영 중단",
  );
  const [version, setVersion] = useState(seat.version);
  const errors = useFormErrors(async () => {
    const latest = await write.run(
      `seat-refresh:${seat.id}`,
      {},
      (signal) => seatApi.detail(scope, seat.id, signal),
      false,
    );
    setVersion(latest.version);
    await invalidateReads(
      query,
      session.user.id,
      "seats",
      "seat-sessions",
      "usage",
      "lookups",
      "home",
    );
    await query.invalidateQueries({ queryKey: ["session"] });
    return `${latest.zone} · ${latest.seatNo} · ${latest.kind} · ${latest.status} (버전 ${latest.version})`;
  });
  const allowed =
    canManageSeats(session.user, seat.branchId) &&
    seat.status !== "사용 중" &&
    !errors.denied;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (!allowed) return;
        const body = { version, status, reason: reason.trim() };
        void write
          .run(`seat-status:${seat.id}`, body, (signal) =>
            seatApi.status(scope, seat.id, body, signal),
          )
          .then(onSaved)
          .catch(errors.setError);
      }}
    >
      <fieldset className="contents" disabled={!allowed || write.busy}>
        <p className="tip">운영 상태를 {status}(으)로 변경해요.</p>
        <Reason value={reason} onChange={setReason} required />
        <Button variant="primary" disabled={!reason.trim()}>
          운영 상태 저장
        </Button>
      </fieldset>
      {errors.feedback}
    </form>
  );
}

function Reason({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <Field label={required ? "처리 사유 (필수)" : "처리 사유 (선택)"}>
      <textarea
        maxLength={500}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function CheckInForm({
  seat,
  onSaved,
}: {
  seat: Seat;
  onSaved: (r: SeatSession) => void;
}) {
  const { session } = useApp();
  const query = useQueryClient();
  const write = useSeatWrite();
  const [method, setMethod] = useState<"memberNo" | "phone">("memberNo");
  const [value, setValue] = useState("");
  const [candidates, setCandidates] = useState<CheckInCandidate[] | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [passId, setPassId] = useState("");
  const [reason, setReason] = useState("");
  const [retryBody, setRetryBody] = useState<CheckIn | null>(null);
  const errors = useFormErrors(async () => {
    const body = { branchId: seat.branchId, [method]: value.trim() };
    const refreshed = await write.run(
      `seat-lookup:${seat.id}`,
      body,
      async (signal) => {
        await invalidateReads(
          query,
          session.user.id,
          "seats",
          "seat-sessions",
          "usage",
          "lookups",
          "home",
        );
        await query.invalidateQueries({ queryKey: ["session"] });
        signal.throwIfAborted();
        return candidates ? seatApi.lookup(body, signal) : null;
      },
      false,
    );
    if (refreshed) setCandidates(refreshed.items);
  });
  const candidate = candidates?.find((c) => c.customer.id === customerId);
  const usable =
    candidate?.status === "정상" &&
    !candidate.activeSession &&
    candidate.usablePasses.some((p) => p.id === passId);
  const allowed =
    canUseSeats(session.user, seat.branchId) &&
    seat.status === "사용 가능" &&
    !errors.denied;
  const reset = () => {
    setCandidates(null);
    setCustomerId("");
    setPassId("");
  };
  const submit = (body: CheckIn) => {
    void write
      .run(`seat-checkin:${seat.id}`, body, (signal, key) =>
        seatApi.checkIn(body, signal, key),
      )
      .then(onSaved)
      .catch((error: Error) => {
        errors.setError(error);
        setRetryBody(uncertain(error) ? body : null);
      });
  };
  return (
    <div className="grid gap-4">
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (!allowed) return;
          const body = { branchId: seat.branchId, [method]: value.trim() };
          void write
            .run(
              `seat-lookup:${seat.id}`,
              body,
              (signal) => seatApi.lookup(body, signal),
              false,
            )
            .then((r) => {
              setCandidates(r.items);
              setCustomerId("");
              setPassId("");
              errors.setError(null);
            })
            .catch(errors.setError);
        }}
      >
        <fieldset className="contents" disabled={!allowed || write.busy}>
          <p className="help">
            회원번호 또는 연락처 전체를 정확히 입력해 주세요.
          </p>
          <Field label="고객 조회 방식">
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as typeof method);
                reset();
              }}
            >
              <option value="memberNo">회원번호</option>
              <option value="phone">연락처</option>
            </select>
          </Field>
          <Field
            label={method === "memberNo" ? "정확한 회원번호" : "정확한 연락처"}
          >
            <input
              required
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                reset();
              }}
            />
          </Field>
          <Button disabled={!value.trim()}>입실 고객 조회</Button>
        </fieldset>
      </form>
      {candidates && !candidates.length && (
        <p role="status">일치하는 고객이 없어요.</p>
      )}
      {candidates && candidates.length > 0 && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            if (!allowed || !usable) return;
            const body = {
              seatId: seat.id,
              customerId,
              passId,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            };
            submit(body);
          }}
        >
          <fieldset className="contents" disabled={!allowed || write.busy}>
            <Field label="입실 고객">
              <select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setPassId("");
                }}
              >
                <option value="">고객 선택</option>
                {candidates.map((c) => (
                  <option key={c.customer.id} value={c.customer.id}>
                    {c.customer.name} · {c.customer.memberNo} · {c.status}
                    {c.activeSession ? " · 이미 입실 중" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {candidate && (
              <>
                <p>
                  {candidate.customer.name} · {candidate.customer.memberNo}{" "}
                  <Badge>{candidate.status}</Badge>
                </p>
                {candidate.activeSession && (
                  <FieldError>이미 입실 중인 고객입니다.</FieldError>
                )}
                <Field label="사용 가능한 이용권">
                  <select
                    value={passId}
                    onChange={(e) => setPassId(e.target.value)}
                  >
                    <option value="">이용권 선택</option>
                    {candidate.usablePasses.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.productName} · {p.kind} · {passBalance(p)}
                      </option>
                    ))}
                  </select>
                </Field>
                {!candidate.usablePasses.length && (
                  <p role="status">지금 사용할 수 있는 이용권이 없어요.</p>
                )}
                {candidate.usablePasses.find((p) => p.id === passId) && (
                  <p className="help">
                    만료:{" "}
                    {candidate.usablePasses.find((p) => p.id === passId)
                      ?.expiresAt
                      ? formatShortDateTime(
                          candidate.usablePasses.find((p) => p.id === passId)!
                            .expiresAt!,
                        )
                      : "없음"}
                  </p>
                )}
              </>
            )}
            <Reason value={reason} onChange={setReason} />
            <Button variant="primary" disabled={!usable}>
              입실 확정
            </Button>
          </fieldset>
        </form>
      )}
      {errors.feedback}
      <CustomerMergeErrorLink error={errors.error} />
      {retryBody && (
        <Button
          disabled={
            write.busy ||
            errors.denied ||
            !canUseSeats(session.user, seat.branchId)
          }
          onClick={() => submit(retryBody)}
        >
          같은 입실 요청 다시 시도
        </Button>
      )}
    </div>
  );
}
function passBalance(p: UsablePass) {
  return p.kind === "시간권"
    ? `${p.remainingMinutes}분`
    : p.kind === "정액권"
      ? formatKrw(p.remainingCreditKrw || 0)
      : "기간권";
}

function SessionAction({
  action,
  session: usage,
  onSaved,
}: {
  action: "checkout" | "move";
  session: SeatSession;
  onSaved: (r: SeatSession) => void;
}) {
  const { session } = useApp();
  const query = useQueryClient();
  const board = useSeatBoard(usage.branchId);
  const current = useSeatSession(usage.id);
  const write = useSeatWrite();
  const [reason, setReason] = useState("");
  const [toSeatId, setToSeatId] = useState("");
  const [retryBody, setRetryBody] = useState<
    (CheckOut & { toSeatId?: string }) | null
  >(null);
  const errors = useFormErrors(async () => {
    await invalidateReads(
      query,
      session.user.id,
      "seats",
      "seat-sessions",
      "usage",
      "lookups",
      "home",
    );
    await query.invalidateQueries({ queryKey: ["session"] });
  });
  const latest = current.data || usage;
  const destinations =
    board.data?.zones
      .flatMap((z) => z.seats)
      .filter((s) => s.id !== latest.seat.id && s.status === "사용 가능") || [];
  const allowed =
    latest.status === "이용 중" &&
    !errors.denied &&
    (action === "move"
      ? canWriteSeats(session.user, usage.branchId)
      : canUseSeats(session.user, usage.branchId));
  const submit = (body: CheckOut & { toSeatId?: string }) => {
    void write
      .run(`seat-${action}:${usage.id}`, body, (signal, key) =>
        action === "move"
          ? seatApi.move(
              usage.id,
              { ...body, toSeatId: body.toSeatId! },
              signal,
              key,
            )
          : seatApi.checkOut(usage.id, body, signal, key),
      )
      .then(onSaved)
      .catch((error: Error) => {
        errors.setError(error);
        setRetryBody(uncertain(error) ? body : null);
      });
  };
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !allowed ||
          (action === "move" && !destinations.some((s) => s.id === toSeatId))
        )
          return;
        const body = {
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(action === "move" ? { toSeatId } : {}),
        };
        submit(body);
      }}
    >
      <p>
        {latest.customer.name} · {latest.customer.memberNo} · 현재 좌석{" "}
        {latest.seat.seatNo}
      </p>
      <fieldset className="contents" disabled={!allowed || write.busy}>
        {action === "move" ? (
          <>
            <p className="help">
              이동해도 최초 입실 시각과 이용권은 유지됩니다.
            </p>
            {board.isPending ? (
              <State loading />
            ) : hasBlockingReadError(board) ? (
              <ErrorState
                error={board.error!}
                retry={() => void board.refetch()}
              />
            ) : (
              <Field label="이동할 좌석">
                <select
                  required
                  value={toSeatId}
                  onChange={(e) => setToSeatId(e.target.value)}
                >
                  <option value="">같은 지점의 사용 가능한 좌석 선택</option>
                  {destinations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.zone} · {s.seatNo} · {s.kind}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Button type="button" onClick={() => void board.refetch()}>
              이동 가능 좌석 새로고침
            </Button>
          </>
        ) : (
          <p className="tip">
            서버가 퇴실 시각과 이용량·차감량·초과량을 확정합니다.
          </p>
        )}
        <Reason value={reason} onChange={setReason} />
        <Button
          variant="primary"
          disabled={
            action === "move" && !destinations.some((s) => s.id === toSeatId)
          }
        >
          {action === "move" ? "좌석 이동 확정" : "퇴실 확정"}
        </Button>
      </fieldset>
      {errors.feedback}
      {retryBody && (
        <Button
          type="button"
          disabled={
            write.busy ||
            errors.denied ||
            !(action === "move"
              ? canWriteSeats(session.user, usage.branchId)
              : canUseSeats(session.user, usage.branchId))
          }
          onClick={() => submit(retryBody)}
        >
          같은 {action === "move" ? "이동" : "퇴실"} 요청 다시 시도
        </Button>
      )}
    </form>
  );
}

function SessionResult({ session }: { session: SeatSession }) {
  return (
    <div className="tip mb-5" role="status">
      <b>
        {session.status === "종료"
          ? "퇴실을 완료했어요"
          : `${session.seat.seatNo} 배정을 완료했어요`}
      </b>
      {session.status === "종료" && (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <dt>이용 시간</dt>
          <dd>{session.usedMinutes}분</dd>
          <dt>차감</dt>
          <dd>
            {session.deductedMinutes}분 · {formatKrw(session.deductedKrw)}
          </dd>
          <dt>초과량</dt>
          <dd>
            {session.overageMinutes}분 · {formatKrw(session.overageKrw)}
          </dd>
          <dt>처리 후 잔량</dt>
          <dd>
            {session.passRemainingMinutes === null
              ? ""
              : `${session.passRemainingMinutes}분`}
            {session.passRemainingCreditKrw === null
              ? ""
              : formatKrw(session.passRemainingCreditKrw)}
            {session.pass.kind === "기간권" ? "기간권" : ""}
          </dd>
        </dl>
      )}
    </div>
  );
}
