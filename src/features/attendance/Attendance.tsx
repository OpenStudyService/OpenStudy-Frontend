import { useQuery } from "@tanstack/react-query";
import { api, MOCK } from "../../shared/api/client";
import { asArray } from "../../shared/api/read-model";
import { useApp } from "../../app/context";
import { DataNotice } from "../../shared/ui/DataNotice";
import { ResourceGroup } from "../records/ResourcePage";
import { ClockCard } from "./ClockCard";
export function Attendance() {
  const { session } = useApp();
  return (
    <ResourceGroup
      title="근무 관리"
      description="예정 근무와 실제 출퇴근을 구분해 확인하고 나의 근무 시간을 기록해요."
      intro={
        <>
          <ClockCard key={session.user.id} />
          {MOCK && <LeaveBalances />}
        </>
      }
      tabs={[
        { resource: "shifts", label: "근무표" },
        { resource: "attendance", label: "출퇴근·휴게" },
        ...(MOCK
          ? [
              { resource: "corrections" as const, label: "기록 정정" },
              { resource: "leaveRequests" as const, label: "휴가 신청·승인" },
              {
                resource: "leaveGrants" as const,
                label: "휴가 부여",
                admin: true,
              },
              { resource: "substitutions" as const, label: "대체근무" },
            ]
          : []),
      ]}
    />
  );
}
function LeaveBalances() {
  const { session, scope } = useApp();
  const balances = useQuery({
    queryKey: ["data", session.user.id, scope, "leave-balances"],
    queryFn: async () =>
      asArray<{ employeeId: string; name: string; balance: number }>(
        await api(`/leave-balances?scope=${scope}`),
      ),
    retry: false,
  });
  return (
    <section className="card mb-5 p-5">
      <h2>휴가 잔여량</h2>
      <DataNotice
        label="휴가 정보"
        loading={balances.isPending}
        error={balances.error}
        retry={() => void balances.refetch()}
      />
      {balances.data?.map((b) => (
        <p key={b.employeeId}>
          {b.name} · {b.balance}일
        </p>
      ))}
    </section>
  );
}
