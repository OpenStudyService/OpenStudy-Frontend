# 최소 직원 선택 데이터의 화면 호환성

## 배경 / 문제

Backend [#17](https://github.com/OpenStudyService/OpenStudy-Backend/issues/17)의 운영 lookups는 직원의 ID·이름만 반환한다. 기존 Frontend는 이를 전체 계정으로 간주하여 직원 선택 폼과 주간 근무표에서 memberships를 직접 읽었다. 기존의 lookups 오류·빈 목록이 정상 최소 목록으로 바뀌면 이 화면들이 예외로 중단될 수 있었다.

Frontend [#4](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/4), Backend #17의 확정 OpenAPI와 기존 공통 오류·프로필 개발 기록을 확인했다. 병합된 Frontend main `b0bd1f2`에서 `fix/minimal-lookup-consumers`를 분리했다. Backend 구현과 기존 체크아웃의 사용자 변경은 이 작업에서 수정하지 않는다.

## 검토한 선택지

- Backend의 최소 응답에 계정 상태·소속·권한을 추가하면 선택 데이터 계약과 정보 최소화 원칙을 훼손한다. 응답을 확장하지 않고 소비자의 잘못된 전제를 수정한다.
- 최소 목록에 가짜 owner/memberships를 채우면 모르는 역할·소속을 실제 정보처럼 취급하게 된다. ID·이름과 시연 응답의 선택적 소속 메타데이터를 타입에서 구분한다.
- 범용 폼이 다른 지점을 선택할 때마다 별도 직원 조회·캐시를 추가하는 대신, 현재 구현 범위에서는 대상 지점이 기존 조회 범위와 다르고 소속 증거가 없으면 선택·저장을 막고 해당 지점으로 이동하도록 안내한다. 신규 업무 API나 범용 조회 구조를 이 호환성 수정에 포함하지 않는다.

## 결정 및 이유

현재 scope로 조회된 최소 직원 행은 서버가 이미 범위를 확인한 선택 데이터로 사용한다. 시연 응답이 owner/memberships를 제공한 경우에는 기존 필터를 유지한다. 최소 행으로 다른 지점의 소속이나 관리 권한을 추론하지 않으며 서버 인가를 클라이언트 필터로 대체하지 않는다.

범용 폼에서 지점을 바꿀 때 소속을 확인할 수 없으면 직원 선택기를 비활성화하고 안내한다. react-hook-form에 이전 선택값이 남아 있더라도 저장 전에 같은 조건을 검사해 제출하지 않는다. 원래 조회 범위로 돌아오면 이전 선택값이 화면과 폼 상태에서 일치하도록 유지한다.

## 구현 내용

- LookupData의 employees를 ID·이름 필수, 기존 시연용 owner/memberships 선택 구조로 변경했다. 이메일·상태·권한을 최소 계약에 추가하지 않았다.
- ResourceForm의 직원 선택은 현재 scope의 최소 이름을 안전하게 표시한다. 다른 지점에 필요한 소속 정보가 없으면 지점 이동 안내와 필드 오류를 제공하며 이전 직원 ID를 전송하지 않는다.
- 직원 선택기를 관찰되는 폼 값과 연결해 지점 변경 후 돌아왔을 때 표시값과 내부 제출값이 어긋나지 않도록 했다.
- WeekSchedule은 최소 이름 목록을 표시하며, 소속 메타데이터가 있는 기존 시연 데이터에는 OWNER·다른 지점·명시적 미배정 직원 제외 동작을 유지한다.
- 근무표·업무·계정 API를 구현하거나 권한 정책을 추가하지 않았다. 부모 작업에서 최신 Backend OpenAPI의 foundation 생성 타입을 갱신했다.

## 검증 결과

- Node.js 24.19.0에서 `npm run check` 성공: TypeScript·ESLint 및 Vitest 122개/15개 파일, 실패·건너뜀 0. `npm run build`의 live 빌드도 통과했다.
- 최소 `{id,name}` fixture의 현재 지점 직원 선택·실제 제출, 지점 변경 후 선택 비활성화·기존 ID 제출 차단·원래 범위 복귀, 기존 시연의 소유자·지점 필터를 확인했다.
- 주간 근무표에서 최소 이름 렌더링, 기존 OWNER·다른 지점 제외, all 범위의 명시적 미배정 직원 제외를 확인했다. 최소 fixture에 가짜 계정 필드가 추가되지 않음을 확인했다.
- 첫 전체 실행은 121개 중 지점 왕복 1개가 실패했다. 폼 내부의 이전 선택값은 남았지만 uncontrolled select의 표시값은 초기화되는 문제를 확인했다. 직원 선택기의 값 구독을 보완한 뒤 새 미배정 회귀 시험을 포함한 122개 전체를 통과했다. 초기 실패는 성공으로 계산하지 않는다.
- `git diff --check` 통과. `graphify update .`로 AST 탐색 자료를 갱신했다. 로컬 그래프는 기존 ignore 규칙에 따라 보관하며 제품 빌드 원본으로 사용하지 않는다.
- MSW 없는 실제 Chrome·전용 MySQL 8.4.11·Backend 작업 브랜치에서 현재 지점의 최소 직원 목록으로 담당자 선택과 주간 근무표 이름 렌더링을 확인했다. 업무/근태 API의 404 안내는 별도로 남았으며 해당 업무 저장 완료를 주장하지 않는다. 독립 OWNER/MANAGER 세션에서 실제 grants 제거 후 열린 직원 상세·메뉴 정리, 복원 후 화면 회복, 소속 회수 시 지점 접근 차단, 계정 제한 후 로그인 이동을 확인했다.

## 남은 작업 / 보류 사항

현재 scope와 다른 지점의 직원 선택이 필요한 후속 업무 화면은 정확한 대상 지점으로 조회하는 흐름을 해당 업무 API와 함께 구현·검증해야 한다. 이번 변경은 정보가 부족한 상태에서 직원 소속을 추정하는 동작을 제공하지 않는다.

Backend #17 및 Frontend #4의 나머지 API·실시간·운영 환경 인수 조건은 별도로 추적한다. 이 수정만으로 두 이슈 전체를 완료 처리하지 않는다. 작업 브랜치의 commit·push·PR과 실제 결합 검증은 부모 작업에서 제공하며 main 병합·자동 병합은 사용자가 수행한다.

## 추가 조사: 서버 중단이 개발 프록시에서 전파되지 않는 문제

부모 작업의 실제 브라우저 검증에서 Backend JVM을 종료하고 새 JVM의 리스닝을 확인했는데도, 안정된 OWNER stream이 60초 동안 최초 resync·open 상태에 머물렀고 error를 관찰하지 못했다. 권한 복원 직후의 늦은 resync가 재시작 성공으로 잘못 집계될 수 있었으므로 그 관찰은 재시작 성공 근거에서 제외하고 OWNER 단독 검증으로 분리했다.

제품 코드를 고치기 전 설치된 Vite 8.3.4 프록시 구현을 확인했다. 응답의 정상 end는 pipe로 전달하지만 upstream SSE가 aborted된 경우 downstream 응답을 종료하는 처리는 없었다. 별도 임시 localhost 포트의 Vite와 가짜 SSE upstream을 띄워 데이터를 보낸 후 upstream socket을 destroy하는 격리 재현을 수행했다. 700ms 뒤 upstream은 파괴됐지만 downstream은 end·close·error가 모두 없고 열린 상태였다. 이는 실제 브라우저 관찰과 같은 경계이며, 격리 재현을 실제 서버 재시작 시험과 구분한다.

`configureSseProxy`를 개발 서버의 기존 `/api` 프록시에 연결했다. 응답 Content-Type이 `text/event-stream`일 때 upstream의 aborted를 downstream destroy로 전달해 브라우저 EventSource가 기존 오류·재연결 처리를 시작할 수 있게 한다. 정상 SSE 데이터·정상 완료와 다른 HTTP 응답은 기존 pipe 처리를 유지한다. 브라우저의 EventSource 구현이나 Backend 이벤트 계약을 바꾸지 않았다.

회귀 시험은 실제 임시 HTTP 서버와 Vite 프록시를 통과시켜 SSE upstream 중단의 downstream 종료, 계속되는 SSE 데이터와 정상 완료, 일반 HTTP 응답 완료를 확인한다. localhost 통신 제한으로 격리 재현의 첫 실행은 연결 권한 오류였으며, 허용된 실행에서 재현·검증했다. 실제 Backend 재시작의 별도 확인 결과는 아래에 기록한다.

추가 수정 후 Node.js 24.19.0의 최종 `npm run check`는 TypeScript·ESLint 및 Vitest 125개/16개 파일(실패·건너뜀 0)을 통과했다. `npm run build` live 빌드도 통과했고, `graphify update .`가 842개 노드·2363개 관계로 갱신됐다.

부모 작업이 보완된 Vite를 재시작한 뒤 실제 Chrome의 안정된 OWNER 연결을 유지한 상태로 Backend JVM을 재시작했다. error 및 readyState 0/2, 기존 제한된 재시도, 새 open·resync(1→2), 닉네임 설정 화면 유지를 확인했다. 연결 생성 횟수는 5회였다. 격리 시험과 별도로 실제 서버 재시작 검증도 통과한 근거는 작업공간의 outputs/workspace-events-17/restart-results.json에 보관했다. 이 파일은 저장소 외부의 로컬 검증 산출물이다.
