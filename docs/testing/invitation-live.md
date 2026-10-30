# 실제 서버·메일 링크 초대 검증

외부 SMTP와 실제 수신함을 사용하는 검증은 [실제 수신함으로 직원 초대 검증](./invitation-real-mail.md)을 따른다. 아래 명령은 Mailpit 기반 로컬 자동 회귀이며 외부 메일 수신 성공을 뜻하지 않는다.

`npm run test:e2e:live`는 MSW를 사용하지 않는다. 실제 Spring 서버·MySQL·SMTP worker가 만든 메일을 Mailpit에서 읽고 서로 다른 Chrome context로 관리자와 초대받은 직원을 검증한다. 기본 `test:e2e`는 이 테스트를 실행하지 않는다.

## 전용 로컬 환경

Node 24, Java 21, Docker Desktop, Chrome이 필요하다. 아래 컨테이너 이름과 DB는 검증 전용이다. 사용자 DB와 기존 `.env`를 연결하지 않는다. 지정한 이름이 이미 있다면 소유자를 확인하고 별도 검증 환경을 준비한다.

```powershell
docker run --detach --name openstudy-invitation-live-db --publish 127.0.0.1:13316:3306 --env MYSQL_ROOT_PASSWORD=invitation-local-only --env MYSQL_DATABASE=invitation_live --env MYSQL_USER=invitation_app --env MYSQL_PASSWORD=invitation-local-only mysql:8.4
docker run --detach --name openstudy-invitation-live-mail --publish 127.0.0.1:11025:1025 --publish 127.0.0.1:18025:8025 axllent/mailpit:v1.27
```

MySQL 준비 후 Backend의 별도 worktree에서 실행한다. 아래 값은 일회용 로컬 테스트 자격증명이며 실제 계정에 사용하지 않는다. 기존 `.env`가 없는 독립 checkout을 사용한다. `JAVA_HOME`은 설치한 JDK 21 경로로 지정한다.

```powershell
$env:DB_URL='jdbc:mysql://127.0.0.1:13316/invitation_live?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true'
$env:DB_USERNAME='invitation_app'
$env:DB_PASSWORD='invitation-local-only'
$env:SPRING_PROFILES_ACTIVE='local'
$env:BOOTSTRAP_OWNER_EMAIL='owner@invitation.test'
$env:BOOTSTRAP_OWNER_PASSWORD='Invitation-local-2026!'
.\gradlew.bat bootJar --no-daemon
& "$env:JAVA_HOME/bin/java.exe" -jar build/libs/openstudy-backend-0.0.1-SNAPSHOT.jar --server.port=18086 --spring.mail.host=127.0.0.1 --spring.mail.port=11025 --spring.mail.properties.mail.smtp.localhost=localhost --openstudy.invitation-mail.enabled=true --openstudy.invitation-mail.from=no-reply@invitation.test --openstudy.invitation-mail.acceptance-url=http://127.0.0.1:15176/invitations/accept
```

`local` 프로필이 빈 DB에 샘플 지점 두 개를 준비한다. 초대·계정·소속·세션·승인은 실제 DB/API이며 홈의 업무 내용은 읽기 전용 로컬 샘플이다. [Backend PR #39](https://github.com/OpenStudyService/OpenStudy-Backend/pull/39)의 일반 직원 지점 홈 수정과, 반복 SSE 연결이 DB 연결을 보유하지 않도록 `spring.jpa.open-in-view=false`를 명시한 설정도 필요하다([개발 기록](../development-log/2026-10-27-invitation-live-integration.md)).

프론트 checkout에서 실행한다. 15176 포트의 live Vite 서버는 Playwright가 직접 시작하며 기존 서버를 재사용하지 않는다. 18086으로 프록시한다.

```powershell
npm ci
$env:INVITATION_LIVE_OWNER_EMAIL='owner@invitation.test'
$env:INVITATION_LIVE_OWNER_PASSWORD='Invitation-local-2026!'
$env:INVITATION_LIVE_DB_CONTAINER='openstudy-invitation-live-db'
npm run test:e2e:live
```

## 검증 범위와 데이터

- 신규 메일 링크 수락 → 제한 로그인 → 다른 브라우저 승인 → 15초 poll 갱신 → 기존 제한 세션의 업무 403 유지 → 재로그인 → 지점 진입.
- 첫 승인 전 추가 지점 수락 403 및 화면 안내, 승인·재로그인 후 같은 초대 수락. 기존 직원은 비밀번호 변경 없이 기존 업무 세션·지점을 유지하며 추가 승인 뒤 새 지점에 들어간다.
- 재발급 전 링크와 만료 링크의 동일 오류, 실제 서버 CSRF 거부, 반려 사유 표시.
- 다른 계정으로 로그인한 상태에서 신규 링크를 열면 화면에서 로그아웃한 뒤 같은 링크의 수락을 계속한다.

매 실행마다 고유 이메일을 만들고 메일 원문·토큰은 메모리에서만 읽는다. 관리자 API에서 링크를 가져오거나 테스트용 수락 API를 만들지 않는다. request-body trace는 끄며 실패 screenshot·테스트 결과는 Git에서 제외한다. 만료 검사는 `INVITATION_LIVE_DB_CONTAINER`의 전용 `invitation_live.employee_invitations`에서 해당 실행의 초대 1건 기한만 과거로 바꾼다. 컨테이너 이름은 `openstudy-invitation-live-` 접두사로 제한한다. 다른 DB 이름·자격증명을 받지 않는다.

완료 후 서버를 종료하고 이번에 만든 컨테이너만 제거한다.

```powershell
docker rm --force --volumes openstudy-invitation-live-db openstudy-invitation-live-mail
```

외부 사람에게 메일을 보내지 않는다. 운영 SMTP 제공자·TLS·수신함·스팸 처리·운영 HTTPS 프록시는 별도 검증이다. Backend #18 전체 완료를 뜻하지 않는다.
