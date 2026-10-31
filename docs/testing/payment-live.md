# 결제·보유 이용권·환불 실제 서버 검증

`npm run test:e2e:payments:live`는 MSW 없이 실제 Backend·MySQL과 Chrome을 사용한다. 기본 MSW 시험과 분리한다. 운영 계정이나 사용자 DB를 사용하지 않는다.

## 준비

1. Java 21, Node 24, Docker Desktop, Chrome을 준비한다. 병합된 Backend main의 독립 사본에서 `bootJar`를 빌드한다. 기존 작업 트리의 `.env`를 복사하지 않는다.
2. 전용 MySQL 8.4 컨테이너를 `127.0.0.1:13320`에 게시하고 `payment_live` DB와 임의 비밀번호를 준비한다. 이미 사용 중인 포트·컨테이너는 종료하지 않는다.
3. 전용 DB를 가리키는 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`와 `SPRING_PROFILES_ACTIVE=local`, `OPENSTUDY_LOCAL_PREVIEW_ENABLED=true`, `SERVER_PORT=18090`, `SERVER_ADDRESS=127.0.0.1`로 Backend를 시작한다. 마이그레이션 및 로컬 지점 1·2가 준비된 뒤 공식 `ownerBootstrap` 명령으로 OWNER를 만든다.
4. 이 전용 DB에 같은 일회용 비밀번호를 사용하는 활성 STAFF 두 명과 지점 1 소속을 준비한다. 계산원은 `payments:write`만, 조회자는 `payments:read`만 부여한다. 운영 계정 권한을 변경하지 않는다.
5. 다음 환경 변수를 설정한다. 비밀번호와 fixture는 Git에서 제외된 디렉터리에서만 관리한다.

```powershell
$env:PAYMENT_LIVE_OWNER_EMAIL='owner@payment.test'
$env:PAYMENT_LIVE_SELLER_EMAIL='seller@payment.test'
$env:PAYMENT_LIVE_READER_EMAIL='reader@payment.test'
$env:PAYMENT_LIVE_PASSWORD='<일회용 fixture 비밀번호>'
npm run test:e2e:payments:live
```

기본 검증 지점은 `1`이며 `PAYMENT_LIVE_BRANCH_ID`로 바꿀 수 있다. 설정은 Vite live를 `15180`에서 시작해 Backend `18090`으로 프록시한다. 서비스 워커를 차단하고 trace는 끈다. 시험은 매번 고유 고객·분류·상품을 API로 생성한다.

## 검증 범위와 한계

- 세 유형의 실제 UI 결제 승인, 서버 가격, 발급 시작·만료·잔량 및 새로고침 지속성
- 정식 `mockOutcome=FAILED`, 실패 기록과 미발급, 고객·지점·상태 목록 필터
- 실제 서버에서 처리된 결제·환불의 응답만 브라우저에서 끊은 뒤, 같은 멱등 키로 재시도하여 중복을 만들지 않음
- 원결제 금액·승인 시각 보존, 실제 환불 후 새로고침
- 조회 직원의 환불 버튼 비노출·직접 환불 403, 범위 밖 조회 거절, 장부 읽기 권한이 없는 계산원의 이용권 경유 환불

응답 유실 시험은 성공을 가짜 응답으로 대체하지 않는다. `route.fetch()`로 실제 서버 처리를 완료한 다음 응답 전달만 중단한다. 사용 이력·만료 경계·동시 요청·롤백의 HTTP/DB 정합성은 Backend `PaymentIntegrationTests`로 별도 확인한다. MSW 검증 결과, 이 브라우저 시험, Backend 통합 시험, 운영 환경 검증은 서로 구분해 개발 기록에 남긴다.

## 정리

이번 실행에서 만든 PID·명령·포트와 컨테이너 ID·이름을 대조한 후 해당 리소스만 종료한다. 전용 DB 컨테이너 및 일회용 자격증명 fixture를 제거한다. 사용자 DB와 기존 서버는 변경하지 않는다.
