# 자연어 시연·인수 테스트셋

총 34개: 정상 26개 + 상태 8개. 기준 2026-10-17 11:00 Asia/Seoul. 전체 지점, OWNER, 전체-공지 채널이 기본이다. JSON의 수치는 실제 DB 정답이 아닌 **프론트 고정 fixture의 기대값**이다.

| ID | 도메인 | 질문 | 기대 상태 | UI | 기대 행 |
|---|---|---|---|---|---|
| org-active | 지점·직원 | 지점별 활성 직원 수를 보여줘 | ready | bar | 2 |
| org-pending | 지점·직원 | 승인 대기 소속과 초대 현황을 보여줘 | ready | list | 3 |
| customers-new | 회원 | 이번 달 신규 회원 추이를 보여줘 | ready | line | 10 |
| customers-restricted | 회원 | 이용 제한 회원 목록을 보여줘 | ready | table | 12 |
| products-active | 상품·이용권 | 판매 중 상품의 유형별 현황을 보여줘 | ready | donut | 6 |
| passes-expiring | 상품·이용권 | 7일 안에 만료되는 이용권을 보여줘 | ready | table | 3 |
| sales-net | 결제·환불·매출 | 지난달 지점별 순매출을 보여줘 | ready | bar | 2 |
| sales-refunds | 결제·환불·매출 | 이번 달 환불 내역을 보여줘 | ready | table | 3 |
| seats-now | 좌석·입퇴실 | 현재 지점별 좌석 이용 현황을 보여줘 | ready | bar | 2 |
| seats-completed | 좌석·입퇴실 | 오늘 완료된 좌석 이용 내역을 보여줘 | ready | table | 3 |
| rooms-today | 스터디룸·예약 | 오늘의 스터디룸 예약을 보여줘 | ready | calendar | 3 |
| rooms-week | 스터디룸·예약 | 이번 주 룸별 예약 건수를 보여줘 | ready | bar | 4 |
| lockers-status | 사물함 | 사물함 배정 현황을 보여줘 | ready | donut | 6 |
| lockers-ending | 사물함 | 7일 안에 배정 기간이 끝나는 사물함을 보여줘 | ready | list | 3 |
| facilities-overdue | 시설·점검 | 점검 예정일이 지난 시설을 보여줘 | ready | list | 3 |
| facilities-open | 시설·점검 | 진행 중인 시설 작업을 보여줘 | ready | table | 2 |
| tasks-overdue | 업무·채팅 | 기한이 지난 미완료 업무를 보여줘 | ready | list | 3 |
| chat-task-shares | 업무·채팅 | 현재 채널의 업무 공유 메시지를 보여줘 | ready | timeline | 2 |
| support-unanswered | 문의·공지 | 아직 답변하지 않은 문의를 보여줘 | ready | list | 3 |
| notices-live | 문의·공지 | 현재 게시 중인 지점 공지를 보여줘 | ready | list | 2 |
| shifts-week | 근무·근태 | 이번 주 직원 근무표를 보여줘 | ready | calendar | 4 |
| attendance-pending | 근무·근태 | 처리 대기 근태 정정 신청을 보여줘 | ready | table | 2 |
| leave-approved | 휴가·대체근무 | 이번 달 승인된 휴가를 보여줘 | ready | calendar | 3 |
| swaps-pending | 휴가·대체근무 | 처리 대기 대체근무 신청을 보여줘 | ready | table | 2 |
| audit-today | 감사 이력 | 오늘의 업무 변경 이력을 보여줘 | ready | timeline | 3 |
| audit-payments | 감사 이력 | 결제·환불 관련 처리 이력을 보여줘 | ready | timeline | 3 |
| state-clarification | 결제·환불·매출 | 매출 현황을 비교해줘 | clarification | bar | 0 |
| state-unsupported | 결제·환불·매출 | 내년 현금흐름을 예측해줘 | unsupported | bar | 0 |
| state-empty | 결제·환불·매출 | 이번 달 100만 원 이상 환불 내역을 보여줘 | empty | table | 0 |
| state-denied | 결제·환불·매출 | 권한 없는 매출 조회를 시연해줘 | denied | bar | 0 |
| state-scope | 결제·환불·매출 | 접근 범위 밖 지점을 조회해줘 | scope | bar | 0 |
| state-failed | 결제·환불·매출 | 조회 실패를 시연해줘 | failed | bar | 0 |
| state-canceled | 결제·환불·매출 | 조회 취소를 시연해줘 | canceled | bar | 0 |
| state-fallback | 결제·환불·매출 | 지원하지 않는 차트의 표 대체를 시연해줘 | fallback | 표 대체 | 2 |

## 브라우저 시연 순서

1. 전체-공지 채널에서 AI 질문 → 매출 예문 선택 → 보내기.
2. KPI·차트·표의 순매출 합계를 비교하고 표를 정렬한다.
3. 열기 → 상세 확인, 개발자 보기 → 근거 테이블과 협의용 명세 확인.
4. 채널에 공유 → 강남점만 보기. 공유 카드가 원래 전체 지점 합계를 유지하는지 확인한다.
5. 회원 제한 목록에서 다음/이전 페이지를 이동한다.
6. 일정·문의·시설 예문을 선택한다.
7. 상태·예외의 조건 확인, 실패, 취소, 표 대체를 확인한다.
8. 직원 사용자로 바꾸고 공유된 전체 지점 결과가 차단되는지 확인한다. 강남점 채널의 매출 조회는 허용하지만 미확정 도메인은 차단한다.

## 범위·형식 규칙

- 준비된 문장에만 매칭하며 @DomainLenz 접두사, 앞뒤 공백, 문장 끝 구두점은 허용한다. 일반 메시지는 AI 실행을 만들지 않는다.
- 채널이 지점 전용이면 질문으로 지점 범위를 확대할 수 없다. 전사 휴가는 지점 귀속 미확정이므로 전체 지점 OWNER 시연만 허용한다.
- 날짜는 KST의 시작 포함·끝 제외를 기본으로 하되, 예약/근무/휴가는 구간 겹침 조건을 쓴다. fixture 기준 이후의 예정 근무·휴가·예약은 계획 데이터다.
- 데모 표는 가독성을 위해 5행, 확정 M10 정책은 50행 페이지·최대 1,000행/차트 상위 20개다. fixture가 작아 이번 데모는 상한 검증·서버 페이징을 구현하지 않는다.
- 공유는 현재 문서의 메모리 스냅샷이다. 다른 브라우저 사용자에게 전송하거나 서버에 저장하지 않는다. 새로고침하면 초기화된다.
