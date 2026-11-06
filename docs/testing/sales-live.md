# 매출·지점 비교·최소 원장 실제 연동 검증 — #30 1차

## 환경

- Frontend 최초 main `972fbdb`에서 시작했으며 재개 후 최종 기준은 main `3dfa936`의 `feature/sales-revenue-integration`이다.
- Backend는 원본 작업 트리 대신 `git archive 90f5ec2`로 추출한 독립 사본을 JDK 21로 빌드한다. 미커밋 소스와 `.env`를 복사하지 않는다.
- 전용 MySQL 8.4 컨테이너 `openstudy-sales-fe30-mysql`, DB `sales_fe30`, loopback 포트 `13360`; Backend `18160`, live preview `15330`, mock preview `15331`, Google Chrome.
- local 프로필은 합성 OWNER 초기화에 사용하며 `--openstudy.local-preview.enabled=false`와 메일 비활성화를 명시한다.

## 재현

1. 독립 Backend 사본에서 `gradlew.bat bootJar --no-daemon`을 실행한다.
2. 다른 DB/볼륨을 재사용하지 않고 전용 MySQL과 빈 `sales_fe30` DB를 만든다. 비밀번호는 임의의 합성 값으로 정하고 로그·커밋에 넣지 않는다.
3. Backend 프로세스 환경에 `DB_URL=jdbc:mysql://127.0.0.1:13360/sales_fe30?useSSL=false&allowPublicKeyRetrieval=true`, `DB_USERNAME=root`, 합성 `DB_PASSWORD`, `BOOTSTRAP_OWNER_EMAIL=owner@sales.test`, 합성 `BOOTSTRAP_OWNER_PASSWORD`, `OPENSTUDY_INVITATION_MAIL_ENABLED=false`를 전달한다.
4. jar를 `--spring.profiles.active=local --server.port=18160 --openstudy.local-preview.enabled=false`로 실행하고 migration V1~V6와 OWNER ID 1 생성을 확인한다.
5. **이번 빈 일회용 DB에만** [sales.sql](../../tests/fixtures/sales.sql)을 적용한다. 직원 비밀번호 해시는 합성 OWNER에서 복사하며 실제 사용자 DB를 읽지 않는다.
6. 시험 프로세스 환경 `SALES_LIVE_PASSWORD`에 합성 비밀번호를 전달한다.

두 전용 E2E 명령은 먼저 해당 모드의 운영 산출물을 빌드하고 preview 서버를 실행한다. live preview는 기존 Vite 프록시를 통해 실제 Backend로 요청한다. 같은 디렉터리에서 live/mock 개발 서버를 동시에 띄울 때 발생한 초기 진입 지연과 의존성 최적화 경합 가능성을 제거하기 위해 이 구성을 선택했다. 실제 계정 인증·거래 준비는 API로 수행한 뒤 매출 화면에 진입하므로 로그인 UI·홈 인수 검증을 포함하지 않는다. Backend는 stdout 수집 대기와 구분할 수 있도록 파일 로그로 실행한다.

```powershell
npm run check
npm run test:e2e:sales:live
npm run test:e2e:sales:mock
npm run test:builds
graphify update .
```

## 검증 구분

| 종류 | 범위 |
| --- | --- |
| API 단위 | 반복 지점 조건, KST/윤년/366일, 잘못된 응답·합계·단위·기간·원장 개인정보·필터 거절 |
| UI 단위 | URL·필터·페이지, 권한별 지점·결제 링크, 늦은 응답·계정 전환, noData와 실제 0원, 오류 대체 금지 |
| MSW 공유 원장 | 실제 데모 결제·환불·룸·사물함 handler와 집계 합계, 원결제 지점, 두 환불 기준, 페이지·소비 차감 제외 |
| 실제 Backend·DB·Chrome | API로 고객·상품·승인 결제·환불 생성 후 세 조회 합계, 화면·새로고침·조건 복원, sales 전용 직원과 무권한 직원, 빈 기간·기간 상한 |
| Mock Chrome | 세 테마/1440·1024·390px, 심각 접근성 위반 검사, 기존 업무·반응형·전체 화면 회귀 |
| 산출물 Chrome | live/mock 빌드 격리·실제 API 실패 노출(HTTP fixture) |

실제 서버 시험은 성공 응답을 fixture로 바꾸지 않고 service worker를 차단한다. 운영 배포·실기기·성능 검증 및 Backend 자체 전체 테스트와 구분한다. Mock 전체 새로고침의 구매 스냅샷 복원은 기존 메모리 원장 제한이 있으며 실제 DB 영속성과 동일하다고 주장하지 않는다.

## 정리

jar 절대 경로와 PID, 컨테이너 전체 ID·이름을 대조한 후 이번 서버·컨테이너·익명 볼륨만 종료·제거한다. 자격 증명과 독립 Backend 사본은 경로가 이번 QA 디렉터리 안에 있음을 확인한 뒤 제거한다. 기존 Backend/Frontend 서버·환경 파일·개발 DB는 사용하거나 정리하지 않는다.

2026-11-06 최종 실행: 실제 서버 Chrome 3개(19.9초), Mock Chrome 10개(57.7초), 산출물 Chrome 5개(9.7초), 전체 단위·컴포넌트 612개와 typecheck·lint 통과. 위 정리를 완료했다. `qa-artifacts/sales-live/`와 `qa-artifacts/sales-mock/`의 합성 데이터 캡처는 로컬 검토용이며 커밋하지 않는다.
