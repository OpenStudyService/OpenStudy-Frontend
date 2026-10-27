# 2026-10-27 실제 서버·SMTP 초대 흐름 검증

관련 이슈: [Frontend #6](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/6), [Backend #18](https://github.com/OpenStudyService/OpenStudy-Backend/issues/18). 기존 UI/MSW 구현 [PR #11](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/11)과 수락 서버 [Backend PR #37](https://github.com/OpenStudyService/OpenStudy-Backend/pull/37)이 병합된 뒤 남은 실제 연동을 검증했다.

실제 검증에서 발견한 지점 홈·반복 SSE 연결 수정은 [Backend PR #39](https://github.com/OpenStudyService/OpenStudy-Backend/pull/39)에서 검토한다. 이번 live 성공은 해당 Backend 브랜치를 사용한 결과이며 main 병합은 사용자 대기다.

## 1. 배경 / 문제

이전 기록의 90개 단위 테스트와 MSW 브라우저 검증은 실제 SMTP 수신 링크·MySQL 세션·두 브라우저 승인 갱신의 증거가 아니었다. #6의 남은 검증과 서버 계약에서 발견한 초대 화면 차이를 해결한다. 상품 작업과 사용자 미커밋 변경을 보호하기 위해 frontend `90eab21` 기준 `fix/invitation-live-integration`, backend `b650acd` 기준 독립 worktree를 사용했다.

## 2. 검토한 선택지

기존 MSW 테스트를 실제 서버 테스트로 바꾸면 기본 검증에 DB/메일 의존성이 생긴다. 별도 live 설정과 실행 명령을 추가해 기존 MSW 검증과 구분했다. 실제 메일 링크는 관리자 DTO나 DB 토큰을 읽지 않고 로컬 SMTP 수신기에서 가져오기로 했다.

신규 계정 링크를 다른 계정으로 로그인한 브라우저에서 열면 서버가 수락을 403으로 거부한다. 자동 로그아웃은 진행 중인 다른 계정 업무를 사용자 의사 없이 종료하므로, 같은 초대 화면에서 명시적으로 로그아웃한 후 이어가게 했다. fragment를 다시 주소에 붙이거나 저장소에 보관하지 않는다.

## 3. 결정 및 이유

- MySQL 8.4.11 일회용 컨테이너와 Mailpit v1.27을 loopback에만 열었다. 기존 checkout의 `.env`나 사용자 DB, 운영 SMTP 자격증명을 사용하지 않았다. 실제 외부 수신자는 없다.
- 실제 Spring 서버의 SMTP worker·초대/계정/소속/세션을 사용하며 Chrome의 독립 context로 관리자와 직원을 분리했다. 홈 업무 내용은 `local` 프로필의 읽기 전용 샘플이며 업무 모듈 전체 구현 검증을 뜻하지 않는다.
- 승인 대기 계정의 다른 지점 수락은 첫 승인·재로그인 이후로 제한하는 확정 정책을 화면에 안내한다. 서버 권한 검사는 그대로 유지한다.
- 메일/수락 요청의 비밀값이 trace에 남지 않도록 live request-body trace를 껐다. 메일과 토큰은 테스트 프로세스 메모리에서만 읽으며 원시 메일·스크린샷·중간 산출물을 커밋하지 않는다.

## 4. 구현 내용

- 신규 계정 링크의 기존 로그인 세션을 안내하고 `로그아웃하고 계속`으로 같은 메모리 토큰의 수락을 이어간다. 로그아웃 실패 시 수락하지 않는다.
- 첫 승인 전 추가 지점 링크에는 승인·재로그인 후 메일 링크를 다시 열라는 안내와 비활성 수락 버튼을 표시한다.
- `playwright.live.config.ts`, `tests/live/invitations.spec.ts`, `npm run test:e2e:live`와 [재현 방법](../testing/invitation-live.md)을 추가했다. 기본 E2E에서 live 테스트를 제외했다.
- 실제 링크에서 일반 직원이 구체 지점 홈에 진입할 때 Backend 로컬 샘플의 직원 목록 필터가 `people:manage`를 강제하여 홈 전체를 403으로 거부하는 결함을 발견했다. 별도 Backend 작업 브랜치에서 필터용 허용 지점 조회를 변경하고 직원 정보 비노출·타 지점 403을 유지하는 MySQL 회귀 테스트를 추가했다. 상품 코드와 공통 API/인증 코드는 수정하지 않았다.
- 같은 서버의 반복 브라우저 실행에서 SSE가 DB 연결을 보유해 Hikari active10/idle0 고갈, 초대 생성500·로그인대기가 발생했다. 별도 Backend에서 `open-in-view=false`와 작은 풀의 실제 SSE 회귀를 추가했다. 신규 회귀는 수정 전 실패하고 수정 후 통과했다. 타임아웃 확대만으로 해결했다고 해석하지 않는다.

## 5. 검증 결과

- Node 24.19.0·Chrome·Java 21.0.12.1·Docker Desktop 27.2.0, MySQL 8.4.11, Mailpit v1.27, frontend live 15176 → backend 18086 환경.
- TypeScript·ESLint·live build 통과. 최종 Vitest **127개/16개 파일** 통과(실패·건너뜀 0), 실제 서버 live **4개** 통과(1.6분). 성공한 추가 지점 홈 screenshot도 시각 확인했다.
- 첫 live 실행 3개는 실패했다. 실제 홈 403 외에 테스트가 서버의 링크 오류 문구와 다르게 기대한 점, 반려 명령 완료 전에 직원 새로고침을 누른 점을 수정했다. 이 실행을 성공으로 집계하지 않는다.
- 수정 후 live 4개 모두 통과(1.7분): 실제 수신 링크 신규 수락→제한 로그인→별도 관리자 승인→15초 poll→재로그인→업무 지점 진입, 기존 직원 추가 지점 수락과 기존 WORKSPACE/지점 유지, 첫 승인 전 추가 수락403·승인 후 성공, 재발급 이전 링크·만료 링크 거부, 실제 CSRF 거부, 반려 사유, 기존 로그인 계정 로그아웃 후 신규 수락.
- 프론트 전체 Vitest의 첫 제한 실행에서 SSE 소켓 3개 EACCES 실패가 있었으며, 정식 권한 실행에서 전부 통과했다.
- Backend 집중 MySQL 회귀 5개 통과·bootJar 성공. 최초 fixture의 잘못된 `global_role=STAFF`는 실제 enum `EMPLOYEE`로 바로잡았다. 실패 실행은 성공 수에 포함하지 않는다.
- Backend 지점 홈 수정 후 전체 **197개/25개 suite** 통과(9분45초), SSE 설정 수정 후 최종 전체 **198개/26개 suite**, 실패·오류·건너뜀 0, `test bootJar` 성공(6분21초).
- SSE 설정 수정 후 같은 서버를 재시작하지 않고 실제 서버 live suite 4개를 **세 번 연속(12개) 통과**했다(각1.6분). 마지막 실행은 API 목록도 고유 이메일·초대 대기 상태로 좁혀 누적 데이터에 영향을 받지 않는다. 서버 로그의 Hikari 연결 부족은 0건이었다. 설정 수정 전 반복 실행의 생성500·로그인대기는 성공으로 집계하지 않는다.
- 반복 실행 시 누적된 초대가 목록 첫 페이지에 있다는 테스트 가정을 제거하고 실제 초대 POST 201 완료 후 고유 이메일로 검색하도록 보완했다. 실제 작업 완료를 기다린 뒤 반려 상태를 새로고침한다.
- 양쪽 `graphify update .` AST 갱신 완료. Frontend 869 nodes/2,393 edges, Backend 2,059 nodes/5,528 edges. SQL/PDF 파서 의존성과 Gradle AST 경고는 탐색의 제한이며 실행 검증과 구분한다. 추적하지 않던 그래프는 로컬 탐색 자료로만 유지한다.

## 6. 남은 작업 / 보류 사항

- 운영 SMTP 제공자·TLS·실제 수신함·스팸 분류·운영 HTTPS 프록시 미검증. 로컬 Mailpit 수신 성공과 구분한다.
- Backend #18 전체의 재시작·동시성·운영 환경 검증을 완료한 것으로 주장하지 않는다. 이번 결과는 초대 화면과 실제 서버의 연결 부분이다.
- 이슈 원문·구조를 재작성하거나 Backend #15를 수정하지 않는다. PR 생성이나 테스트 통과만으로 상위 이슈 전체를 닫지 않는다.
- 브랜치 push와 PR 준비 후 main 병합은 사용자에게 맡긴다.
