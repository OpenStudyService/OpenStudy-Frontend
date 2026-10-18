# 요구사항·화면·WBS 추적표

기준: 개정 요구사항 v1.0(2026-10-17). 업무 주소는 `/app/:scope/` 아래입니다. 아래 연결은 프론트 구현 위치를 설명하며 요구사항 전체의 실서버 검수 완료를 뜻하지 않습니다. 원본 WBS의 진행률·공수는 이 프론트 작업으로 임의 변경하지 않았습니다.

2026-10-18 입퇴실 주체 정정: 정상 입퇴실은 고객 QR 등 직접 행동이고, 아래 OS-SEAT 연결의 직원용 화면은 상태/이력 조회와 정상 처리 실패 시 예외 지원 경로입니다. 고객 화면·QR 실제 연동과 그 수용 검증은 후속 범위입니다.

| 요구사항 | 제목 | 화면·구현 경계 | 기존 WBS | 현재 검증 범위 |
|---|---|---|---|---|
| OS-AUTH-001 | ID와 비밀번호 로그인 | /login · /invitations/accept · /pending-approval | W07, W08 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AUTH-002 | 승인 상태 검사 | /login · /invitations/accept · /pending-approval | W07, W08 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AUTH-003 | 세션과 로그아웃 | /login · /invitations/accept · /pending-approval | W07, W08 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AUTH-004 | 초기 관리자 발급 | /login · /invitations/accept · /pending-approval | W07, W08 | 서버 책임. mock 계정·비밀번호 비저장만 제공 |
| OS-AUTH-005 | 프로필 관리 | /login · /invitations/accept · /pending-approval | W07, W08 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AUTH-006 | 자격 증명 보호 | /login · /invitations/accept · /pending-approval | W07, W08 | 서버 책임. mock 계정·비밀번호 비저장만 제공 |
| OS-BR-001 | 지점 정보 | settings | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-BR-002 | 지점 선택과 집계 | settings | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-BR-003 | 자원과 소속 | settings | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-BR-004 | 중지와 이력 보존 | settings | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-EMP-001 | 직원 목록과 상태 | employees | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-EMP-002 | 복수 지점 배정 | employees | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-EMP-003 | 기본 협업 권한 | employees | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-EMP-004 | 운영 및 민감 권한 | employees | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-EMP-005 | 회수와 감사 | employees | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-EMP-006 | 응대 고객 이력 예외 | employees | W09, W10 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INV-001 | 이메일 초대 생성 | employees?tab=invitations | W11, W12 | 화면·발송 결과 모킹, 실제 이메일 미연결 |
| OS-INV-002 | 일회성 토큰 | employees?tab=invitations | W11, W12 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INV-003 | 대상자 확인과 수락 | employees?tab=invitations | W11, W12 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INV-004 | 관리자 최종 승인 | employees?tab=invitations | W11, W12 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INV-005 | 재발급과 취소 | employees?tab=invitations | W11, W12 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INV-006 | 중복과 감사 | employees?tab=invitations | W11, W12 | 프론트·MSW 대응, 실서버 미검증 |
| OS-TASK-001 | 등록과 배정 | tasks | W13, W14 | 프론트·MSW 대응, 실서버 미검증 |
| OS-TASK-002 | 목록과 필터 | tasks | W13, W14 | 프론트·MSW 대응, 실서버 미검증 |
| OS-TASK-003 | 상태와 체크리스트 | tasks | W13, W14 | 프론트·MSW 대응, 실서버 미검증 |
| OS-TASK-004 | 업무 이력 | tasks | W13, W14 | 프론트·MSW 대응, 실서버 미검증 |
| OS-TASK-005 | 채팅 공유 | tasks | W13, W14 | 프론트·MSW 대응, 실서버 미검증 |
| OS-TASK-006 | 동시 변경 | tasks | W13, W14 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-001 | 채널과 참여자 | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-002 | DM | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-003 | 메시지 전송 | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-004 | 스레드 보고 | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-005 | 읽지 않은 표시 | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-006 | 이력과 재접속 | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-CHAT-007 | 업무 카드와 구분 | chat | W15, W16 | 프론트·MSW 대응, 실서버 미검증 |
| OS-MEM-001 | 공통 고객 등록 | members | W17, W18 | 프론트·MSW 대응, 실서버 미검증 |
| OS-MEM-002 | 검색과 상세 | members | W17, W18 | 프론트·MSW 대응, 실서버 미검증 |
| OS-MEM-003 | 연결 이력 | members | W17, W18 | 프론트·MSW 대응, 실서버 미검증 |
| OS-MEM-004 | 상태 변경 | members | W17, W18 | 프론트·MSW 대응, 실서버 미검증 |
| OS-MEM-005 | 비활성화와 보존 | members | W17, W18 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-001 | 상품 관리 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-002 | 구매 조건 보존 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-003 | 시간권 차감 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-004 | 기간권 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-005 | 정액권 차감 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-006 | 전 지점 사용 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-007 | 상태와 조정 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PASS-008 | 미사용 환불 연결 | products · members?tab=passes | W19, W20 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-001 | 거래 기록 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-002 | Mock 승인과 실패 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-003 | 검색과 권한 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-004 | 중복 처리 방지 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-005 | 전액 환불 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-006 | 환불 이력과 원장 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-PAY-007 | 재시도와 경합 | payments | W21, W22 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SEAT-001 | 좌석 등록과 배치 | spaces | W23, W24 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SEAT-002 | 현장 배정 | spaces | W23, W24 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SEAT-003 | 좌석 이동 | spaces | W23, W24 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SEAT-004 | 종료와 차감 | spaces | W23, W24 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SEAT-005 | 이용 이력 | spaces | W23, W24 | 프론트·MSW 대응, 실서버 미검증 |
| OS-RSV-001 | 스터디룸 자원 | reservations | W25, W26 | 프론트·MSW 대응, 실서버 미검증 |
| OS-RSV-002 | 예약 목록 | reservations | W25, W26 | 프론트·MSW 대응, 실서버 미검증 |
| OS-RSV-003 | 예약과 선결제 | reservations | W25, W26 | 프론트·MSW 대응, 실서버 미검증 |
| OS-RSV-004 | 시간 중복 방지 | reservations | W25, W26 | 프론트·MSW 대응, 실서버 미검증 |
| OS-RSV-005 | 변경과 취소 | reservations | W25, W26 | 프론트·MSW 대응, 실서버 미검증 |
| OS-RSV-006 | 실제 이용 기록 | reservations | W25, W26 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LOCK-001 | 상태 관리 | spaces?tab=lockers | W27, W28 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LOCK-002 | 배정과 기간 | spaces?tab=lockers | W27, W28 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LOCK-003 | 연장과 반납 | spaces?tab=lockers | W27, W28 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LOCK-004 | 이력과 만료 | spaces?tab=lockers | W27, W28 | 프론트·MSW 대응, 실서버 미검증 |
| OS-FAC-001 | 시설 정보 | facilities | W29, W30 | 프론트·MSW 대응, 실서버 미검증 |
| OS-FAC-002 | 자원 상태 | facilities | W29, W30 | 프론트·MSW 대응, 실서버 미검증 |
| OS-FAC-003 | 주기와 예정일 | facilities | W29, W30 | 프론트·MSW 대응, 실서버 미검증 |
| OS-FAC-004 | 기록과 감사 | facilities | W29, W30 | 프론트·MSW 대응, 실서버 미검증 |
| OS-FAC-005 | 미처리 조회 | facilities | W29, W30 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INQ-001 | 대리 접수 | inquiries | W31, W32 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INQ-002 | 조회와 담당 | inquiries | W31, W32 | 프론트·MSW 대응, 실서버 미검증 |
| OS-INQ-003 | 답변과 상태 | inquiries | W31, W32 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NOTI-001 | 내부 공지 관리 | notices | W31, W32 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NOTI-002 | 중요 표시 | notices | W31, W32 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NOTI-003 | 검색과 이력 | notices | W31, W32 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SHIFT-001 | 근무 계획 | attendance?tab=shifts | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SHIFT-002 | 주간/개인 조회 | attendance?tab=shifts | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SHIFT-003 | 중복과 변경 | attendance?tab=shifts | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SHIFT-004 | 계획과 실적 분리 | attendance?tab=shifts | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-ATT-001 | 출퇴근 기록 | attendance | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-ATT-002 | 휴게 기록 | attendance | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-ATT-003 | 기록 조회 | attendance | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-ATT-004 | 정정 신청 | attendance | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-ATT-005 | 승인과 반려 | attendance | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-ATT-006 | 감사와 재계산 | attendance | W33, W34 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LEAVE-001 | 부여량 설정 | attendance?tab=leaveRequests | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LEAVE-002 | 휴가 신청 | attendance?tab=leaveRequests | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LEAVE-003 | 승인과 반려 | attendance?tab=leaveRequests | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LEAVE-004 | 취소와 복원 | attendance?tab=leaveRequests | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-LEAVE-005 | 잔여량과 조회 | attendance?tab=leaveRequests | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SWAP-001 | 대체 신청 | attendance?tab=substitutions | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SWAP-002 | 승인과 반영 | attendance?tab=substitutions | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SWAP-003 | 변경 이력 | attendance?tab=substitutions | W35, W36 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SALE-001 | 기본 집계 | sales | W37, W38 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SALE-002 | 귀속 지점 | sales | W37, W38 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SALE-003 | 두 환불 기준 | sales | W37, W38 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SALE-004 | 원장 연결과 비교 | sales | W37, W38 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SALE-005 | 중복 매출 방지 | sales | W37, W38 | 프론트·MSW 대응, 실서버 미검증 |
| OS-HOME-001 | 운영 홈 | home | W06, W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-HOME-002 | 역할별 우선 정보 | home | W06, W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-HOME-003 | 슬랙식 탐색 | home | W06, W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-HOME-004 | 테마와 반응형 | home | W06, W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AI-001 | 공개 계약 연동 | ai | W04, W42, W43, W44, W45 | 공개 경로·잠정 DTO 어댑터. 실엔진 계약 연결 대기 |
| OS-AI-002 | 의미와 지표 | ai | W04, W42, W43, W44, W45 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AI-003 | 범위 있는 자연어 | ai | W04, W42, W43, W44, W45 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AI-004 | IR와 실행 | ai | W04, W42, W43, W44, W45 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AI-005 | 동일 권한 | ai | W04, W42, W43, W44, W45 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AI-006 | 안전한 결과 화면 | ai | W04, W42, W43, W44, W45 | 프론트·MSW 대응, 실서버 미검증 |
| OS-AI-007 | 실패와 정합성 | ai | W04, W42, W43, W44, W45 | 동일 mock 원장 비교. 실제 엔진·DB 미검증 |
| OS-SET-001 | 설정 범위 | settings | W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SET-002 | 상태 안내 | settings | W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-SET-003 | 알림 경계 | settings | W39 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-001 | 인증과 권한 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-002 | 일관성과 멱등 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-003 | 비밀값과 입력 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-004 | 감사 추적 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-005 | 사용성 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-006 | 응답 목표 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 로딩·취소 UI 제공. 서버 응답 목표 실측 대기 |
| OS-NFR-007 | 시간과 금액 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-008 | 재현 가능한 데이터 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-009 | 실측 검증 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 프론트·MSW 대응, 실서버 미검증 |
| OS-NFR-010 | 인프라 인계 | 전체 화면 · shared/api · mocks | W02, W05, W40, W46, W47, W48 | 빌드·인계 문서 제공. 실제 배포·재기동 검증 대기 |

## 프론트 전용 작업 추적

| 추가 작업 | 결과물 | 검증 |
|---|---|---|
| FE-MOCK-01 공통 API·가상 원장 | mocks/store·domain·handlers, API 클라이언트 | 도메인 규칙·실제 HTTP 브라우저 흐름 |
| FE-FORM-01 운영 입력·상태 처리 | ResourceForm·RecordPanel·필드 계약 | 입력 검증·실패 보존·충돌·승인 시나리오 |
| FE-SSE-01 채팅·AI 수신 | shared/api/stream, Chat, Ai | 브라우저 재전송·재연결·IME·AI 취소 |
| FE-DESIGN-01 React 시각 구현 | 세 테마·레이아웃·RoomArt·아이콘 | 1440·1024·390 화면 캡처·가로 넘침 검사 |
| FE-CONTRACT-01 서버 전환 | OpenAPI·생성 타입·DomainLens 어댑터 | 모드별 빌드·계약 생성·인계 문서 |

테스트 이름과 실제 실행 결과는 verification.md를 참고합니다. 실제 개발 시간 추적 자료가 없으므로 기존 전체 프로젝트 299시간을 프론트 공수로 재사용하거나 임의 실측값을 기록하지 않았습니다.
