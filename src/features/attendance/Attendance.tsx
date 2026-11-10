import { useApp } from "../../app/context";
import { ResourceGroup } from "../records/ResourcePage";
import { ClockCard } from "./ClockCard";
import { LeaveBalances } from "./Leave";
export function Attendance() {
  const { session } = useApp();
  return (
    <ResourceGroup
      title="근무 관리"
      description="예정 근무와 실제 출퇴근을 구분해 확인하고 나의 근무 시간을 기록해요."
      intro={
        <>
          <ClockCard key={`clock:${session.user.id}`} />
          <LeaveBalances key={`leave:${session.user.id}`} />
        </>
      }
      tabs={[
        { resource: "shifts", label: "근무표" },
        { resource: "attendance", label: "출퇴근·휴게" },
        { resource: "corrections", label: "기록 정정" },
        { resource: "substitutions", label: "대체근무" },
        { resource: "leaveRequests", label: "휴가 신청·승인" },
        { resource: "leaveGrants", label: "휴가 부여", admin: true },
      ]}
    />
  );
}
