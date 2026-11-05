# 출퇴근·근태 실제 연동 검증 — Frontend #29

## 환경과 격리

- Frontend main `ac006f2`(PR #66 병합)에서 별도 `feature/attendance-api-integration` 작업 트리를 만들었다.
- Backend는 원본 작업 트리 대신 별도 clone의 main `aa2ebc87c92f04873517e2914bbeb8c0b812677b`(PR #160 병합)을 빌드했다. 미커밋 소스·환경 파일을 복사하지 않았다.
- MySQL 8.4 일회용 컨테이너 `openstudy-attendance-fe29-mysql`, DB `attendance_fe29`, 포트 `13340`; Backend `18130`, live Vite `15229`, mock Vite `15230`, 실제 설치된 Google Chrome.
- `local` 프로필은 합성 OWNER 초기화에만 사용했다. `--openstudy.local-preview.enabled=false`로 샘플 기능을 끄고, 메일 발송도 비활성화했다.
- 신규 작업 트리에 lockfile 기준 `npm ci`로 의존성을 설치했다. 기존 Frontend 변경, Backend 작업 트리·환경 파일과 다른 작업의 DB/서버는 사용하지 않는다.

## 재현 절차

1. 빈 임시 디렉터리에 Backend를 clone하고 위 커밋을 checkout한다. JDK 21을 `JAVA_HOME`에 지정하고 `gradlew.bat bootJar`를 실행한다.
2. 이번 검증만 사용하는 비밀번호로 새 `mysql:8.4` 컨테이너와 DB를 만든다. 다른 DB·볼륨을 재사용하지 않는다.
3. Backend 프로세스에 `DB_URL=jdbc:mysql://127.0.0.1:13340/attendance_fe29?useSSL=false&allowPublicKeyRetrieval=true`, `DB_USERNAME=root`, 일회용 `DB_PASSWORD`, `BOOTSTRAP_OWNER_EMAIL=owner@workforce.test`, 임의의 합성 `BOOTSTRAP_OWNER_PASSWORD`, `OPENSTUDY_INVITATION_MAIL_ENABLED=false`를 전달한다. `.env`를 만들거나 원본에서 복사하지 않는다.
4. 별도 jar를 `--spring.profiles.active=local --server.port=18130 --openstudy.local-preview.enabled=false`로 실행한다. Flyway V1~V6와 서버 응답을 확인한다.
5. **비어 있던 이번 DB에만** [workforce.sql](../../tests/fixtures/workforce.sql), [attendance.sql](../../tests/fixtures/attendance.sql)을 순서대로 적용한다. 새 OWNER ID는 1이다. 직원들의 비밀번호 해시는 합성 OWNER에서 복사한다.
6. Frontend 시험 프로세스의 `WORKFORCE_LIVE_PASSWORD`에 합성 OWNER 비밀번호를 지정한다.

```powershell
npm run check
npm run test:e2e:attendance:live
npm run test:e2e:attendance:mock
npm run test:builds
graphify update .
```

실제 서버 시험은 기록과 소속 회수 상태를 남기므로 새 DB에서 실행한다. 반복 로그인으로 기본 요청 제한에 도달하면 이번 검증 서버만 재시작한다. 운영 보안 설정을 완화하지 않는다.

## 검증 근거

| 종류 | 확인 내용 |
| --- | --- |
| 단위·MSW HTTP fixture | 명령 경로·정확한 본문·CSRF·등록 키, 상태별 버튼, 불명확한 실패 뒤 키 유지, 과거 멱등 응답 이후 현재 재조회, 잘못된 응답을 성공/빈 목록으로 처리하지 않음, version 충돌 후 상태 갱신, 직원 필터·대리 명령 없음 |
| MSW 공유 원장 | 예정 근무 연결, 휴게 중 퇴근 거부, 중복 출근, 소속 회수 뒤 진행 중 정리, 타인 조회 차단, 초 단위 계산 후 한 번의 분 버림, 목록·상세·주간·근무 요약의 단일 계산 |
| 실제 서버·DB·Chrome | 출근·휴게·퇴근 전체, 지점 탐색 변경 중 현재 근태 유지, 실제 예정 근무 연결과 네 조회의 값 일치, 응답 유실 후 단일 기록·현재 복구, 동시 휴게 명령 하나만 성공, MANAGER/STAFF 혼합 소속 조회 범위, 운영 중지·소속 회수 뒤 정리 |
| 실제 서버의 과거 합성 기록 | SQL fixture `9001`의 두 휴게 구간(초 포함)을 Backend가 498분으로 계산하고 목록·상세·주간에 동일하게 표시 |
| 기존 근무표 실제 회귀 | 일요일 야간 등록·수정·취소·상태 필터, 비공개 지점 충돌과 입력 유지, 직원 관리 제한, version 충돌, 운영 중지 지점의 취소 허용 |
| Mock Chrome | 새 출퇴근 전체와 본인 조회 제한, 기존 근무 관리·휴가 복원·반응형·테마 |
| 산출물 Chrome | live/mock 프로덕션 빌드 격리, MSW/데모 유입 방지, 실제 API 실패 표시 |

실제 서버 시험은 성공 응답을 fixture로 대체하지 않는다. 응답 유실 시나리오만 `route.fetch()`로 실제 명령의 DB 커밋을 확인한 뒤 브라우저 응답을 끊는다. 별도 HTTP 재시도는 동일 키의 과거 201이 반환돼도 현재 API는 null임을 확인한다. UI의 멱등 응답 처리 자체는 HTTP fixture와 함께 검증한다.

SQL `9001`은 과거 시간 경계 검증 자료이며 출퇴근 명령이 생성한 기록으로 주장하지 않는다. 나머지 실제 상태 전이·연결·응답 유실·조회 범위·정리 시험은 실제 명령이 생성한 기록을 사용한다.

## 제한과 정리

운영 배포·운영 DB·실제 모바일 기기·다중 서버 부하와 Backend 자체 전체 테스트는 미검증이다. 휴가·대체근무·근태 정정(M12)은 이번 범위 밖이며 live에서 데모 동작을 제공하지 않는다.

기존 채팅 세션 만료 시험의 별도 main 재현 결과는 [이전 근무표 검증 기록](workforce-live.md)에 남아 있다. 이번 관련 회귀 구성에는 해당 범위 밖 시험을 포함하지 않는다.

완료 시 jar 절대 경로·PID와 컨테이너 전체 ID를 확인해 이번 서버만 종료하고 `docker rm -f -v openstudy-attendance-fe29-mysql`로 전용 DB/익명 볼륨을 제거한다. 별도 Backend clone도 절대 경로를 확인해 삭제한다. 임시 자격 증명은 검증 프로세스 환경에만 전달한다.

2026-11-05 실행에서는 위 정리를 완료했고 검증 서버 종료, 전용 컨테이너 부재, 별도 Backend 사본 경로 삭제를 확인했다.
