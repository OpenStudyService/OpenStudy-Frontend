# 2026-11-13 · AI 채팅 실제 API 인수 조건 점검 (#32)

## 1. 배경 / 문제

[Frontend #32](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/32)의 2026-11-06 변경은 JSON 요청·응답과 다음 API 인가를 기준으로 삼는다. [#76](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/76), [#79](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/79), [#84](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/84)에서 구현한 동작을 Frontend 원격 main `49c8c17`에서 대조했다. 이전 기록은 [채팅 도입](2026-11-06-domainlens-ai-chat-frontend.md), [대화 기록](2026-11-06-ai-conversation-history.md), [화면 갱신 정책](2026-11-06-explicit-refresh-policy.md), [정식 계약 전환](2026-11-08-ai-chat-contract.md)을 참고했다.

Backend 선행 이슈는 [#92](https://github.com/OpenStudyService/OpenStudy-Backend/issues/92), [#96](https://github.com/OpenStudyService/OpenStudy-Backend/issues/96), [#170](https://github.com/OpenStudyService/OpenStudy-Backend/issues/170)이 모두 닫힌 상태다.

## 2. 검토한 선택지

브라우저 대기 중 취소 경로를 연결할 수 있는지 Backend 원격 main `ac88232`의 OpenAPI와 실행 코드를 검토했다. 기존 검증에서 빠졌던 권한 회수는 Backend 스냅샷과 일회용 MySQL을 사용해 다른 세션에서 재현하는 방법을 택했다.

## 3. 결정 및 이유

`POST /api/ai/requests/{requestId}/cancel`은 본인의 기존 실행을 찾아 `CANCELED`로 기록한다. 질문과 대화 내 요청 제출 경로는 모두 동기 실행을 끝낸 후 서버 ID를 반환한다. `AiWorkspaceService.executeQuery`는 트랜잭션 안에서 ID를 생성하고 실행 기록을 저장한다. `clientRequestKey`는 중복 제출 키이며 취소의 조회 키가 아니다. 화면은 기존 대기 취소를 사용하고, 실행 중 서버 취소에는 별도 Backend 계약이 필요하다. [Backend OpenAPI](https://github.com/OpenStudyService/OpenStudy-Backend/blob/ac88232c092a57bf9083e0b5480bafab3cdc6337/docs/design/foundation/openapi.json) · [서비스 구현](https://github.com/OpenStudyService/OpenStudy-Backend/blob/ac88232c092a57bf9083e0b5480bafab3cdc6337/src/main/java/com/openstudy/modules/ai/service/AiWorkspaceService.java#L705)

## 4. 구현 내용

### 코드 변경 전 인수 조건 대조표

| 현재 인수 조건 | 상태 | 코드·시험·개발 기록 근거 | 검증 수준 |
| --- | --- | --- | --- |
| 준비 상태, 질문 입력, JSON 제출 및 완료 | 충족 | `Ai.tsx`의 `readiness`, `MAX_QUESTION`(정식 계약 500자), `ask`, `outcome`. `domainlens.ts`의 `executeAiQuery`. `uses only the canonical AI routes for questions and saved conversations`. #84 기록의 live 매출 KPI. | 단위·컴포넌트, MSW 계약, 실제 Backend·DB(playback) |
| 처리 중 표시 및 중복 제출 차단 | 충족 | `Ai.tsx`의 `busy`, `abort.current`, `clientRequestKey`, `Working` 표시. `blocks duplicate submissions and discards a response received after cancellation`. #84 기록의 동일 키 재시도·REPLAY. | 단위·컴포넌트 |
| 확인 필요 및 선택 재전송 | 충족 | `Ai.tsx`의 `outcome`, 선택 ID를 넣는 `ask`. `resends a clarification choice with its option id`. #84 기록의 live 지점 확인 선택·재요청. | 단위·컴포넌트, 실제 Backend·DB(playback) |
| 제한 시간과 늦은 응답 차단 | 일부 충족 | `Ai.tsx`의 60초 `AbortSignal.timeout`과 응답 직후 `throwIfAborted`, `domainlens.ts`의 fetch 신호 및 본문 파싱 후 확인. 위 중복·취소 시험은 취소 후 지연 응답을 검증한다. #84 기록에는 60초 결정과 늦은 응답 차단이 있으며 제한 시간 자체의 별도 실행 증거는 확인되지 않았다. | 단위·컴포넌트(취소), 제한 시간 경과 미검증 |
| 사용자 대기 취소 | 충족 | `Ai.tsx`의 질문 대기 취소 버튼과 취소 안내, 위 중복·취소 시험. #84 PR의 데모 브라우저 대기 취소 회귀 시험. | 단위·컴포넌트, 데모 브라우저 |
| 실행 중 서버 취소 및 저장 상태 | 미충족 | #84의 잔여 항목. Backend `AiWorkspaceController.cancelRequest`, `AiWorkspaceService.cancelRequest`는 저장된 본인 실행을 대상으로 한다. 실행 전에 프런트엔드에서 쓸 수 있는 ID와 실행 중단 계약이 없다. | 원격 계약·소스 확인, 실행 중 취소 미검증 |
| 실패 유형별 안내 | 일부 충족 | `Ai.tsx`의 `failureMessage`, `AiConditions.tsx`의 `reuseFailure`. `shows a specific message for %s`는 입력·검증·지원 불가·권한·기간·요청 빈도를 검증한다. #84 기록의 준비 사유와 실패별 문구. 엔진 예산·조회 오류의 정식 경로 응답과 실제 문구는 별도 확인이 필요하다. | 단위·컴포넌트, 예산·조회 오류 실제 응답 미검증 |
| 빈 결과, 적용 조건 및 기준 시각 | 충족 | `Ai.tsx`의 결과 카드와 빈 데이터셋 분기, `AiConditions.tsx`의 조건 표시. #84 기록에서 live 빈 좌석 결과, 시계열의 0원 값과 기준 시각을 확인했다. | 단위·컴포넌트, 실제 Backend·DB(playback) |
| 세션 만료 및 권한 감지 후 이전 결과 정리 | 일부 충족 | `domainlens.ts`의 401 이벤트, `Ai.tsx`의 `expire`, 접근 키 및 `clearOnDenial`, `AppRuntime.tsx`의 비공개 캐시 제거. `announces truncation and clears old results on a scope change and on session expiry`, `clears sales results when permission is revoked within the same scope`. #84 기록의 live 지점 변경·로그아웃. 최신 Backend가 200과 함께 보내는 `PERMISSION_LOST`는 안내에만 쓰였으며 이전 카드는 남았다. | 단위·컴포넌트, 실제 Backend·DB(playback, 지점 변경·로그아웃) |
| 실제 Backend 권한 회수 후 다음 API 차단·결과 정리 | 일부 충족 | Backend `AiConversationHistoryIntegrationTests.aSavedQuestionTheEmployeeMayNoLongerRunShowsTheReasonInsteadOfData`는 현재 권한으로 다시 열기를 검증한다. Frontend #84 기록의 실제 권한 회수는 미검증으로 남았다. | 단위·컴포넌트, Backend 통합 테스트 이력, 회수 전후 live 화면 미검증 |
| 실제 Qwen 호출 | 일부 충족 | #84의 실제 Backend·DB 연결은 playback으로 확인했다. Qwen 호출은 키·비용 승인과 실제 응답 검증이 필요하다. | 실제 Backend·DB(playback), Qwen 미검증 |
| SSE 진행·재연결·상태 polling 및 요청 없는 즉시 삭제 | 정책 변경으로 제외 | 2026-11-06 이슈 갱신과 화면 갱신 정책. `Ai.tsx`는 JSON 대기 상태와 응답의 단계 기록을 표시한다. | 정책·코드 확인 |

Chrome에서 매출 권한 회수 후 허용된 좌석 질문을 보내자 서버가 200과 `context.resetReason=PERMISSION_LOST`를 반환했다. 화면은 조건 상속이 끊겼다고 안내하면서 이전 매출 카드와 표를 계속 표시했다. `Ai.tsx`에서 이 신호를 기존 403 정리 경로와 함께 처리해 현재 질문과 응답만 표시한다. 회귀 시험은 이전 결과가 지워지고 새 응답과 권한 변경 안내가 유지되는지 검사한다.

## 5. 검증 결과

- Frontend live 모드와 Chrome을 Backend 원격 main `ac88232`의 독립 빌드, 일회용 MySQL 8.4.11에 연결했다. 브라우저 서비스 워커를 차단하고 Backend 모델은 playback으로 실행했다.
- 직원이 일별 매출 질문에 200과 결과를 받은 뒤 별도 관리자 세션에서 소속 수정 API로 `sales:read`를 회수했다. 직원 세션은 열린 상태에서 기존 결과를 계속 표시했다. 다음 매출 질문은 403 `SALES_PERMISSION_DENIED`와 빈 결과 본문(`envelope: null`)을 반환했고 이전 카드가 지워졌다. 저장 대화 다시 열기는 해당 질문에 `REFUSED`를 반환했고 결과는 없었다.
- 수정 후에는 회수 다음 요청이 허용된 좌석 질문이어도 200 `PERMISSION_LOST`를 감지해 이전 매출 카드를 지우고 좌석 결과를 표시했다. 이어진 매출 요청의 403과 저장 대화 차단도 재확인했다.
- Chrome에서 실제 Backend의 200 응답 전달을 보류해 화면 제한 시간 60초(관측 60,131ms), 제한 시간 안내, 늦은 결과 차단, 새 질문 제출 가능 상태를 확인했다. 이 검증에서 서버는 이미 요청을 처리했다.
- `npm run typecheck`, `npm run lint`, 관련 Vitest 2개 파일 32개, `npm test` 전체 89개 파일 805개, `npm run build`와 live 산출물 검사 통과. Vite는 일부 번들이 500 kB를 넘는다는 경고를 출력했다.
- `graphify update .`로 작업 worktree의 그래프를 갱신했다. 설치된 파서에서 SQL 파일 3개의 AST 추출을 지원하지 않는다는 경고가 있었다.

## 6. 남은 작업 / 보류 사항

- **실행 중 서버 취소**는 Backend 계약을 기다린다. #32에서 브라우저 대기 취소와 서버 실행 중단을 각각 추적한다.
- **실패 분류** 중 기간 제한과 요청 빈도 제한은 기존 안내와 시험이 있다. OpenAPI는 질문 처리의 500을 공통 오류로 정의하며, 정식 질문 실패 목록에는 엔진 예산 초과와 조회 실패를 구별하는 전용 코드가 없다. Backend가 안정된 오류 코드와 응답을 제공하면 각각의 안내와 계약 시험을 연결할 수 있다.
- **실제 Qwen** 검증에는 승인된 키와 비용 한도, 검증용 데이터, 준비된 임베딩 카탈로그, `OPENSTUDY_AI_MODEL_MODE=live`와 `QWEN_API_KEY`가 필요하다. 대상 모델·엔드포인트 설정을 확인한 뒤 실제 호출 및 토큰 기록과 화면 결과를 대조한다. 이번 작업에서는 playback만 실행했다.

### Backend 후속 이슈 초안 · 실행 중인 자연어 분석 요청 취소 계약

**목적**

사용자가 대기 중인 AI 질문을 취소하면 본인의 진행 중 실행을 서버에서도 종료하고 최종 상태를 확인할 수 있게 한다.

**작업 범위**

실행 전부터 브라우저가 사용할 식별자를 제공한다. 사전 발급 ID 또는 이미 전달한 `clientRequestKey`로 본인 실행을 찾는 계약을 확정한다. 취소를 모델·조회 단계에 전달하고 최종 상태를 저장한다. 동기 JSON 화면 정책을 유지한다.

**인수 조건**

- [ ] 질문 최종 응답 전에도 취소할 실행을 식별할 수 있다.
- [ ] 본인 요청만 취소할 수 있으며 다른 직원의 요청은 404로 처리한다.
- [ ] 취소가 먼저 확정되면 실행 중단 신호가 전달되고 결과 없이 `CANCELED`가 저장된다.
- [ ] 완료가 먼저 확정된 경우의 응답과 상태를 정의하고, 재시도 시 동일한 확정 결과를 반환한다.

**의존성 및 검증**

기존 질문·취소 경로와 중복 제출 키를 기준으로 OpenAPI를 갱신한다. 실행을 보류할 수 있는 playback과 일회용 DB로 소유권, 중복 취소, 취소와 완료의 순서를 확인한다. Frontend에서는 대기 취소 후 늦게 온 결과가 표시되지 않는지 함께 확인한다. [Frontend #32](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/32) · [Backend #92](https://github.com/OpenStudyService/OpenStudy-Backend/issues/92) · [Backend #170](https://github.com/OpenStudyService/OpenStudy-Backend/issues/170)
