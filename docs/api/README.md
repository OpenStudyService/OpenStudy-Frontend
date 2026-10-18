# 프론트엔드 API 인계 계약

> 2026-10-18: 이 문서는 현재 프론트/MSW 구현 스냅샷입니다. **백엔드 구현 기준은 [OpenStudy API 명세서 v1.0](../../../docs/api/README.md)**과 [OpenAPI](../../../docs/api/openapi.json)를 사용합니다. 초대 토큰·실제 메일·동시성·근태 원본 등 차이는 [전환 목록](../../../docs/api/compatibility.md)을 확인하세요. 이 폴더의 자동 생성기는 운영용 정본을 덮어쓰지 않습니다.

기준은 개정 요구사항 v1.0과 승인된 React 개발 계획입니다. `openapi.json`은 OpenStudy **컨슈머 계약 초안**이며 백엔드 구현 완료를 의미하지 않습니다. 엔진 소유 DomainLens 계약과 구분합니다.

## 모드·인증·에러

- `VITE_API_MODE=live|mock`, `VITE_API_BASE_URL=/api`. Vite 개발 프록시의 `API_PROXY_TARGET=http://localhost:8080`은 서버 설정이며 클라이언트 번들에 노출하지 않습니다.
- 모든 fetch와 SSE는 쿠키를 포함합니다. 서버는 운영 환경에서 `HttpOnly; Secure; SameSite=Lax` 세션을 발급합니다. 프론트는 세션 토큰을 읽거나 저장하지 않습니다.
- `GET /api/auth/csrf → {token}`, 변경 요청은 `X-CSRF-Token`. 로그인·초대 수락에도 필요합니다. 모킹 CSRF 값은 공개 시연용이며 실제 세션에 결합된 CSRF 검증을 대체하지 않습니다.
- `POST /auth/login {email,password}`, `POST /auth/logout {}`, `GET /me → {user,branches,asOf,snapshotVersion}`, `PATCH /me/profile {nickname,avatar}`.
- 이메일은 계정 생성 시 확정되는 변경 불가 로그인 ID입니다. 본인 프로필/관리자 직원 PATCH의 email 필드는 거부합니다. 초대·로그인의 이메일 입력과 고객 원장의 연락용 이메일은 유지합니다. 최신 [정책 개정](../../../docs/revised/2026-10-18/email-login-id-policy.md)을 따릅니다.
- `user`는 `status`, `owner`, `memberships:[{branchId,role,permissions}]`를 포함합니다. `all`의 유효 권한은 각 지점별로 다시 검사합니다.
- 오류 본문: `{code,message,fieldErrors?,requestId?}`. 401 인증 만료, 403 권한, 404 대상 없음, 409 경합, 410 초대 만료, 422 입력, 5xx 서버 오류. 401이면 개인 캐시·초안을 정리합니다.

## 목록·등록·상세

`GET /{resource}?scope=&q=&status=&assigneeId=&mine=&date=&sort=&direction=&page=&pageSize=&from=&to=` → `{items,total,page,pageSize}`. 페이지 크기는 1~100입니다. 기간 필터 `from/to`는 달력·근무표 조회용 포괄 날짜 구간입니다. 일반 매출의 `start/end`는 별도의 반개구간입니다. 정렬 기본값은 등록일 내림차순입니다.

`GET /{resource}/{id}?scope=`, `POST /{resource}`, `PATCH /{resource}/{id}`. 수정에는 `version`이 필수이며 다른 지점으로 직접 옮기는 수정은 거부합니다. 등록·변경 허용 필드는 `src/shared/domain/catalog.ts`, 응답 DTO는 `schema.ts`가 원본입니다. `npm run api:generate`로 OpenAPI와 생성 타입을 갱신합니다. 공통 통신·오류 타입은 생성 계약을 참조하고 각 도메인 타입은 같은 Zod 원본에서 추론합니다.

대상: branches, employees, invitations, tasks, channels, members, products, passes, payments, seats, usage, lockers, rooms, reservations, facilities, inquiries, notices, shifts, attendance, corrections, leaveGrants, leaveRequests, substitutions, messages, audit. 모든 자원이 직접 등록·수정을 허용하는 것은 아닙니다. 결제·근태 등의 확정값은 아래 명령에서 생성합니다.

선택 항목 `/lookups?scope=`, 집계 `/home?scope=`, 특정 응대 고객의 전 지점 이력 `/members/{id}/history`. 일반 직원의 타 지점 전체 고객 목록 조회는 허용하지 않습니다. 결제 정보는 별도 조회 권한이 있어야 합니다.

## 명령

`POST /{resource}/{id}/{action}?scope=`. 본문은 아래 입력 + **version**, 거래·예약·승인 등에는 **Idempotency-Key** 헤더가 필요합니다. 같은 키·같은 입력은 동일 응답을 반환하고 다른 입력은 409입니다. 재전송 중 응답 유실에도 같은 논리 요청 키를 유지합니다. 원장 동시성은 mock 원자적 스냅샷으로만 재현하며 실제 서버 트랜잭션 검증은 별도입니다.

| 자원 / 명령 | 추가 입력·정책 |
|---|---|
| tasks / progress, complete, reopen | 담당 직원 또는 관리자, 체크리스트는 PATCH |
| tasks / share | 지점의 참여 운영 채널에 연결 카드 메시지 생성 |
| payments / refund | reason, refundBranchId. 승인·실제 미사용 전액만 허용 |
| passes / adjust | remaining, expiresAt, reason. 관리자 전용 |
| seats / assign | memberId, passId. 한 고객·좌석당 활성 이용 하나 |
| seats / move, checkout | targetSeatId / 추가 입력 없음. 이용권 요율 스냅샷으로 분 올림·원 올림, 초과량 분리 |
| lockers / assign, extend, return | memberId, startsOn, endsOn / endsOn / reason |
| reservations / start, finish, cancel | 추가 입력 없음 / 추가 입력 없음 / reason |
| facilities / inspect | result, condition. 점검일·다음 예정일·감사 갱신 |
| attendance / break, resume, clockout | 본인 기록만 처리 |
| corrections / approve, reject | 기존 원본 비교·재계산 / reason |
| leaveRequests / approve, reject, cancel | 승인 시 잔여량 확인, 취소는 한 번 복원, 반려 reason |
| substitutions / approve, reject, cancel | 원근무 버전과 직원 충돌 재검사·원본 보존, 반려 reason |
| invitations / approve, reject, reissue, cancel | 최종 승인 후 소속 활성화. 재발급 시 이전 링크 폐기 |
| employees / permissions | memberships 배열, 변경하는 지점의 관리자 권한 확인 |

`POST /payments {branchId,memberId,productId,method,simulateFailure?}`: 승인 결제와 이용권을 함께 생성. `POST /reservations {branchId,memberId,roomId,startsAt,endsAt,people,simulateFailure?}`: 30분 단위 룸 예약과 별도 결제. 결제 실패에는 확정 자원·이용권이 남지 않습니다. `simulateFailure`는 mock 전용이며 실서버 공개 입력에 포함하지 않습니다.

`POST /attendance/clockin {branchId}`. `GET /leave-balances?scope=&on=`. 휴가 자동 발생 없이 관리자 부여 원장에서 승인 사용량을 차감합니다. 노동법·급여 계산을 제공하는 시스템이 아닙니다.

초대: `/invitations/preview?token=`, `/invitations/accept {token,email,password?}`. 24시간·일회성. 기존 직원은 본인 인증, 신규 계정은 초대 이메일에 결합합니다. 메일 발송 결과와 승인 상태는 분리합니다. MSW는 발송을 시뮬레이션합니다.

## 직원 채팅 SSE

- `GET /chat/channels?scope=` → 참여 대화와 본인 unread.
- `POST /chat/dm {employeeId}` → 두 참여자의 기존 DM 재사용.
- `GET /chat/{channelId}/messages?before=&after=&parent=` → `{items,nextCursor?,total}`. 최근 30개, 이전 커서. parent가 있으면 스레드만 조회합니다.
- `POST /chat/{channelId}/messages {text,parentId,taskId,clientMessageId}`. 재전송에 같은 clientMessageId와 멱등 키를 사용합니다.
- `POST /chat/{channelId}/read {sequence}` → 읽음 위치를 감소시키지 않습니다.
- `GET /workspace/events?scope=&cursor=`. `connected`, `workspace`, `heartbeat` 이벤트. workspace는 `{id,type,resource,entityId,branchId,...}`. type은 message/changed/read/permissions.
- 서버는 `Last-Event-ID` 및 재연결 시 `cursor`를 지원해야 합니다. 클라이언트는 1~10초 백오프로 한 연결을 재생성하고, 연결 복구 시 REST 이력도 재조회합니다. 프록시는 SSE 버퍼링을 끄고 하트비트보다 긴 타임아웃을 설정합니다.

## DomainLens 어댑터 경계

PRD 2.0의 공개 경로를 따릅니다: 대화 생성 `/conversations`, 요청 `/conversations/{id}/requests`, SSE `/requests/{id}/events`, 취소 `/requests/{id}/cancel`, 실행 `/executions/{id}`, readiness `/catalog/readiness`. 직원 채팅과 섞지 않습니다.

PRD만으로 엔진의 확정 JSON Schema·실행 DTO를 제공받을 수 없으므로 현재의 `{viewSpec:{component,title},rows,asOf,start,end,currency,timeZone,refundBasis}`는 **OpenStudy 표시용 잠정 DTO**입니다. `src/features/analysis/domainlens.ts`에 검증 경계를 두었습니다. 실엔진 산출물 수령 시 엔진 소유 버전·스키마를 고정하고 이 어댑터에서 바인딩합니다. 현재는 엔진 SDK 연동 완료를 주장하지 않습니다.

accepted/retrieving/generating/validating/executing/completed/clarification/failed/canceled를 처리합니다. 표·막대·선 컴포넌트만 허용하고 모르는 ViewSpec은 대체 안내를 표시합니다. 렌더링은 React 텍스트·허용 차트만 사용하며 임의 HTML·SQL·스크립트 실행 경로가 없습니다. 모킹 AI는 원장의 일반 매출 함수를 호출하는 테스트 더블입니다.

## 배포·실서버 인계

1. `npm ci && npm run check && npm run build`, 결과 `dist/` 배포. 자산 경로는 `/` 기준입니다.
2. `/api`를 백엔드에 우선 프록시하고 나머지 SPA 경로는 `index.html`로 재작성합니다. 존재하지 않는 API를 HTML로 재작성하지 않습니다.
3. HTTPS, 쿠키 속성·도메인·Path, CSRF 토큰 회전, 세션 만료·로그아웃을 직접 검증합니다. 별도 출처라면 credentials CORS·명시 Origin 설정이 필요합니다.
4. SSE 버퍼링 해제·연결 제한·하트비트·재연결 커서를 검증합니다. 두 실제 사용자 간 메시지·읽음·권한 회수도 검사합니다.
5. 직접 API 권한 변조, 트랜잭션 경합·멱등 저장, 초대 실제 메일·만료, 서버 재시작 후 보존을 검사합니다.
6. DomainLens 라이브러리 버전·등록 지표·권한·시계·환불 기준·DTO를 확정하고 실제 DB의 일반 매출과 AI 결과를 비교합니다.
