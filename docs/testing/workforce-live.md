# 근무표 실제 연동 검증 (#29 부분 구현)

## 검증 환경

- Frontend `91dfc48`에서 `feature/workforce-api` 작업 브랜치와 별도 작업 트리를 만들었다.
- Backend 원본 작업 트리와 환경 파일은 사용하지 않는다. 별도 clone의 `main` 병합 커밋 `44ba20187469015516c93a2bccd126ab34cfba01`을 빌드했다.
- MySQL 8.4 일회용 컨테이너 `openstudy-fe29-mysql`, DB `workforce_fe29`, 포트 `13339`. 기존 컨테이너·DB는 사용하지 않는다.
- JDK 21 / Backend 18129 / live Vite 15229 / mock Vite 15230 / 실제 설치된 Google Chrome.
- Backend는 `local` 프로필의 합성 OWNER 초기화만 사용한다. `--openstudy.local-preview.enabled=false`로 샘플 응답·데이터를 비활성화하고 메일 발송도 끈다.
- 합성 OWNER `owner@workforce.test`, 관리자 `manager@workforce.test`, 직원 `staff@workforce.test`, 다른 직원 `other@workforce.test`. 비밀번호는 프로세스 환경으로 전달하며 원본 `.env`를 읽거나 복사하지 않는다.

## 재현 절차

1. 빈 임시 디렉터리에 Backend를 clone하고 위 커밋을 checkout한다. `.env` 없이 `JAVA_HOME`에 JDK 21을 지정하고 `gradlew.bat bootJar`를 실행한다.
2. 새 MySQL 8.4 컨테이너를 만들고 위 DB와 포트를 지정한다. DB 비밀번호는 이 컨테이너에만 사용하는 임의 값으로 정한다. 볼륨을 다른 작업과 공유하지 않는다.
3. Backend 실행 프로세스에 `DB_URL=jdbc:mysql://127.0.0.1:13339/workforce_fe29?useSSL=false&allowPublicKeyRetrieval=true`, `DB_USERNAME=root`, 일회용 `DB_PASSWORD`, `BOOTSTRAP_OWNER_EMAIL=owner@workforce.test`, 임의 `BOOTSTRAP_OWNER_PASSWORD`, `OPENSTUDY_INVITATION_MAIL_ENABLED=false`를 전달한다.
4. `java -jar <별도 사본의 jar> --spring.profiles.active=local --server.port=18129 --openstudy.local-preview.enabled=false`로 시작한다. Flyway V1~V6 완료와 서버 응답을 확인한다.
5. **이번에 만든 DB에만** [합성 fixture](../../tests/fixtures/workforce.sql)를 적용한다. 빈 DB에서 생성된 OWNER의 ID가 1이어야 한다.
6. Frontend 실행 셸에서 `WORKFORCE_LIVE_PASSWORD`를 위 합성 OWNER 비밀번호로 설정하고 아래 명령을 실행한다.

```powershell
npm run check
npm run test:e2e:workforce:live
npm run test:e2e:workforce:mock
npm run test:builds
graphify update .
```

실제 서버 시험은 근무·취소 기록을 남긴다. 재실행은 새 DB를 권장한다. 같은 DB에서 디버깅할 때는 이 전용 DB의 `shift_events`, `shifts`, `idempotency_records`만 초기화했다. 반복 로그인으로 기본 제한(계정 10회·IP 30회/15분)에 도달한 경우, 이번에 띄운 검증 서버만 재시작했다. 보안 설정을 완화하지 않았다.

## 검증 근거의 구분

- 단위/HTTP fixture: Seoul 변환, 월요일·일요일 경계, 서버가 반환한 실근무 분 표시, 조회 실패 처리, 요청 본문·CSRF·등록 키 재사용, 충돌 상세·입력 유지, 일반 직원 관리 버튼 차단.
- MSW 공유 원장: canonical DTO로 등록·수정·취소, 멱등 재시도, 버전 충돌, 일반 직원 조회 범위, 비공개 지점 충돌. mock 모드에만 포함되며 실제 저장 근거가 아니다.
- 실제 Backend/DB/Chrome: 일요일 야간 근무의 시작일·주 귀속, 목록 필터, 상세 재조회 후 수정·취소, 비공개 지점 충돌과 입력 유지, 일반 직원 본인 제한, 버전 충돌 후 명시적 새로고침, 운영 중지 지점의 수정 차단·취소 허용. HTTP 응답을 가로채 성공시키지 않는다.
- Mock Chrome: 새 근무 관리 흐름과 기존 휴가 승인/복원·주간 표시, 390/768/1024 화면 및 테마 회귀.
- 빌드 Chrome: 기존 live/mock 산출물 모드 격리 5개. HTTP fixture를 쓰는 산출물 시험은 실제 서버 시험과 구분한다.

## 제한

Backend #84는 위 main에 없다. 출근·휴게·퇴근, 현재 상태 버튼, 관리자 근태 목록·상세의 실제 연결과 목록/상세 실근무 분 일치는 후속 검증 대상이다. 주간 응답과 연결 근태 요약은 지원하지만 #84가 생성한 실제 기록으로 검증하지 않았다. 운영 서버·운영 DB·실제 휴대기기도 미검증이다.

확대 실행한 기존 `extended.spec.ts`의 `channel participants and session expiration`은 세션 종료 뒤 `/api/auth/csrf`가 MSW를 거치지 않아 Vite proxy 연결 거부와 JSON 파싱 오류로 실패했다. 격리된 변경 전 main `91dfc48`에서도 같은 테스트를 단독 실행해 동일하게 재현했다. 관련 근무·휴가·반응형 회귀 설정은 이 채팅 테스트를 포함하지 않는다.

## 정리

검증이 끝나면 실행한 jar 절대 경로와 PID를 확인해 해당 서버만 종료한다. 컨테이너 ID와 이름을 확인하고 `docker rm -f -v openstudy-fe29-mysql`로 이번 컨테이너·익명 볼륨을 제거한다. 별도 Backend 사본과 비교용 main 작업 트리도 삭제하고 프로세스의 임시 자격 증명을 제거한다. 기존 Backend 작업 트리·환경 파일·다른 Docker 컨테이너는 그대로 둔다.

2026-11-04 실행에서는 위 정리를 완료했다. 서버 종료, 전용 컨테이너 삭제, 두 사본 경로의 부재를 확인했다.
