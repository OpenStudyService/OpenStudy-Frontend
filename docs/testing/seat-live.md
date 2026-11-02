# 좌석 실제 Backend·DB 검증

Frontend #21의 실제 서버 검증은 MSW와 분리하여 실행한다.

## 환경 준비

- Backend main `adcf15c`(PR #139~#143 포함)을 별도 디렉터리에 추출한다. 기존 Backend 작업 트리나 `.env`를 사용하지 않는다.
- Java 21, MySQL 8.4, Node 24, Chrome을 사용한다.
- 일회용 DB `seat_live`를 loopback 13322 포트에 제공하고, 무작위 비밀번호를 환경 변수로 설정한다.
- Backend `DB_URL`·`DB_USERNAME`·`DB_PASSWORD`를 해당 DB로 지정하고 포트 18092에서 실행한다. MySQL 준비와 Flyway 적용 후 공식 `ownerBootstrap` 태스크를 실행한다.
- OWNER 계정은 `owner@seat.test`로 만든다. 검증 전용 지점 1·2, 지점 1의 활성 STAFF `staff@seat.test`(추가 권한 없음), 지점 2의 활성 STAFF `outsider@seat.test`를 준비한다. 계정은 테스트 전용 동일 비밀번호를 사용한다.
- 계정과 멤버십 fixture를 운영 DB에 적용하지 않는다. 나머지 고객·상품·이용권·좌석은 테스트가 실제 API로 생성한다.

## 실행

PowerShell의 `SEAT_LIVE_PASSWORD` 환경 변수에 검증 계정 비밀번호를 설정하고 실행한다.

```powershell
npm run test:e2e:seats:live
```

설정은 live Vite 15182에서 Backend 18092로 프록시한다. Service Worker를 차단하고 trace를 저장하지 않는다. 결과·스크린샷은 git에서 제외된 `qa-artifacts/seat-live/`에 저장한다.

## 검증 범위

- 실제 결제 API가 발급한 타 지점 고객의 시간권을, 일반 고객 상세 조회 권한이 없는 STAFF가 정확 일치 조회로 찾아 입실시킨다.
- 권한 없는 직원에게 좌석 수정·이동 버튼이 보이지 않는지 확인하고, OWNER의 좌석 이동 후 STAFF가 퇴실·차감 결과를 확인한다.
- 같은 이용 기록의 이동 이력과 종료 상태를 재조회한다. 종료된 이용 상세의 현재 잔량은 PR #143 계약대로 null이다.
- 좌석 등록 요청은 실제 서버 처리를 완료한 뒤 브라우저 응답만 끊는다. 동일 키로 재시도하여 좌석이 한 개만 생성되는지 확인한다.
- 배치도·현황 합계와 운영 중단 후 새로고침을 확인한다.

독립 Backend 복사본에서 `SeatIntegrationTests`, `SeatSessionIntegrationTests`, `SeatSessionMoveIntegrationTests`도 실행한다. Backend 자체 통합 테스트와 브라우저가 연결한 실제 MySQL 검증 결과는 개발 기록에 따로 남긴다.

## 정리와 한계

검증 후 생성한 PID의 jar 경로와 리스닝 포트를 대조하여 해당 서버만 종료한다. 저장한 컨테이너 ID와 이름을 대조해 해당 DB만 제거하고 임시 자격 증명 파일을 삭제한다.

이 검증은 격리된 로컬 환경이다. 운영 배포·부하·다중 인스턴스·실기기 검증은 별도이며, MSW 성공을 실제 Backend 검증으로 간주하지 않는다. QR 입퇴실과 #22의 이력·수동 조정 화면은 포함하지 않는다.
