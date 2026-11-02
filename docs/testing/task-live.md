# 업무 실제 Backend·DB 검증

이 문서는 Frontend #26의 재현 조건과 실제 검증 범위를 설명한다. MSW 테스트 및 빌드용 HTTP fixture와 별도로 실행한다.

## 실행 환경

- Frontend 작업 기준: main `5445819` 이후의 #26 작업 브랜치.
- Backend: main `3bef6413717b65574b4d64a077e7c2899b871094` (Backend #75, PR #138 포함).
- Java 21, MySQL 8.4, Chrome, 프로젝트의 Node 24 의존성.
- 일회용 DB `task_live`: loopback `127.0.0.1:13321`.
- Backend `127.0.0.1:18091`, live Vite `127.0.0.1:15181`.

기존 Backend 작업 트리와 사용자 DB를 사용하지 않는다. 고정한 Backend 커밋을 별도 디렉터리에 추출하고 `.env`는 복사하지 않는다. 로컬 포트가 이미 사용 중이면 먼저 다른 포트로 환경과 Playwright 설정을 함께 변경한다.

## 준비

1. 고정 Backend 커밋에서 `bootJar`를 빌드한다. 독립 MySQL 컨테이너를 생성하고 무작위 비밀번호를 환경 변수로 전달한다.
2. Backend의 정본 환경 변수와 실행 지침에 따라 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`를 해당 DB로 지정하고 포트 18091에서 실행한다. Flyway 적용과 health 응답을 확인한다.
3. Backend의 공식 `ownerBootstrap` 태스크로 OWNER를 생성한다. 운영 DB에 fixture SQL을 실행하지 않는다.
4. 격리 DB에 다음 테스트 계정을 준비한다. 모두 테스트 전용 동일 비밀번호를 사용한다. 이 테스트는 아래 ID와 지점 구성을 전제로 한다.

| ID | 환경 변수 | 조건 |
| --- | --- | --- |
| 1 | `TASK_LIVE_OWNER_EMAIL` | OWNER, 지점 멤버십 없음 |
| 2 | `TASK_LIVE_CREATOR_EMAIL` | 활성 STAFF, 지점 1 활성 멤버십 |
| 3 | `TASK_LIVE_ASSIGNEE_EMAIL` | 활성 STAFF, 지점 1 활성 멤버십 |
| 4 | `TASK_LIVE_READER_EMAIL` | 활성 STAFF, 지점 1 활성 멤버십, 업무 작성자·담당자 아님 |
| 5 | `TASK_LIVE_OUTSIDER_EMAIL` | 활성 STAFF, 지점 2만 접근 |
| 6 | 테스트 내부 고정 ID | LEFT 직원, 지점 1 멤버십, 담당자 후보에서 제외 |

작성자와 담당자 ID는 `TASK_LIVE_CREATOR_ID`, `TASK_LIVE_ASSIGNEE_ID`로 바꿀 수 있다. 나머지 fixture ID/지점 조건은 테스트와 일치시킨다. 계정 생성과 멤버십 fixture는 해당 Backend 스키마를 기준으로 준비한다.

## 실행

PowerShell 세션에 `TASK_LIVE_PASSWORD` 및 표의 다섯 이메일 환경 변수를 설정한 후 실행한다. 비밀번호를 커밋하거나 로그·스크린샷에 출력하지 않는다.

```powershell
npm run test:e2e:tasks:live
```

테스트 설정은 live Vite와 실제 Backend 사이를 프록시한다. Service Worker를 차단하고 trace를 저장하지 않는다. 결과와 데스크톱·모바일 스크린샷은 git에서 제외된 `qa-artifacts/task-live/`에 저장한다. 각 실행은 임의의 업무 제목을 사용하므로 독립 fixture 환경 안에서 반복할 수 있다.

## 확인하는 실제 동작

1. STAFF가 업무를 등록하고 재조회한다. 체크 항목 추가·수정·삭제·완료 및 업무 진행·완료·할 일 전환 후 새로고침과 API 재조회로 저장 결과와 이력을 확인한다.
2. 두 세션이 같은 업무를 수정해 실제 409를 발생시킨다. 사용자 제목 입력을 유지하고 최신 본문을 비교한 뒤 변경한 필드와 최신 버전만 PATCH하여 다른 사용자의 본문이 보존되는지 확인한다.
3. 실제 후보 API가 지점 1 활성 직원 2·3·4만 반환하는지 확인한다. 조회 전용 사용자의 수정 UI 비노출과 직접 수정 403, 타 지점 조회 404, 퇴사 직원 배정 422를 확인한다.
4. 등록 요청을 실제 서버에 전달해 커밋한 뒤 브라우저 응답만 끊는다. 동일 멱등 키로 재시도하여 검색 결과가 한 건인지 확인한다. 검색·내 업무·상태·정렬·페이지 URL과 집계를 재조회하고 모바일 상세를 확인한다.

응답 유실 시험은 Playwright `route.fetch()`로 실제 서버 처리를 완료한 후 `route.abort()`를 호출한다. 서버 응답 fixture나 MSW로 성공을 대신하지 않는다.

Backend 자체 회귀 검사는 독립 Backend 디렉터리에서 다음과 같이 실행한다. 이것은 브라우저가 연결한 MySQL 검증과 별도의 Backend 테스트 결과다.

```powershell
.\gradlew.bat --no-daemon test --tests com.openstudy.modules.task.TaskIntegrationTests
```

## 정리 및 한계

검증 후 생성한 PID와 jar 경로·리스닝 포트를 확인하여 해당 Backend만 종료한다. 생성 시 저장한 컨테이너 ID와 이름을 대조한 뒤 해당 컨테이너만 제거하고 임시 자격 증명 파일을 삭제한다. 사용자 DB와 기존 프로세스는 종료하지 않는다.

이 검증은 격리된 로컬 실제 서버·DB 결과다. 운영 배포, HTTPS, 다중 인스턴스, SMTP, #27 채팅 공유 API 연동은 검증하지 않는다. MSW 브라우저 회귀와 live/mock 빌드 검사는 개발 기록에 별도로 기재한다.
