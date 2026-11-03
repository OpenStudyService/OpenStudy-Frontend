# 사물함 실제 서버 검증

Frontend #24의 MSW·컴포넌트 결과와 실제 DB 저장 결과를 구분한다.

## 격리 환경과 실행

- Backend main `7fcac51`을 별도 추출하고 Java 21로 빌드했다. 원래 Backend 작업 트리·환경 파일·개발 DB를 사용하지 않는다.
- 전용 MySQL 8.4 `lockers_live`: loopback 13327. Backend: 18097. live Vite: 15190.
- local 프로필·메일 비활성화, 공식 ownerBootstrap으로 `owner@lockers.test`를 준비한다. 일반 직원 `staff@lockers.test`는 지점 1 조회·반납, `cashier@lockers.test`는 지점 2 결제 권한을 갖는다. 모든 비밀번호는 검증 전용 무작위 값이다.
- 초기 공통 지점 이름에는 local 샘플 표시가 있지만 사물함·배정·청구·결제는 실제 API와 DB로 생성한다.
- 실제 인증 API로 BrowserContext 세션을 준비한다. 두 OWNER 편집자는 별도로 로그인하며 테스트 간 인증 상태는 메모리에서만 재사용한다. Service Worker 차단, trace 저장 없음.

프로세스 환경 변수 `LOCKERS_LIVE_PASSWORD`에 검증 비밀번호를 지정한다.

```powershell
npm run test:e2e:lockers:live
```

## 실제 시나리오

1. HTTP: 배정·연장의 같은 키 재시도, 요금 일괄 변경 전후의 결제 snapshot, 기존 종료일부터 이어지는 연장, 직원 반납·환불 없음·즉시 재배정, 현황과 목록 건수.
2. HTTP: 28일 배수 위반 422, 결제 실패 후 점유 없음, 중단 사물함 연장 거부와 직원 반납, 권한 403·타 지점 404.
3. UI: 등록·변경·운영 중단·요금 일괄 적용·새로고침. 두 OWNER 세션의 409에서 번호 초안을 유지하고 다른 편집자가 바꾼 요금은 보존한다.
4. UI: 실제 배정·연장이 커밋된 뒤 응답 전달만 끊고 입력·동일 키로 재시도한다. 서버 청구 수·종료일·표시 금액을 확인한다.
5. UI: 일반 직원의 관리·유료 배정·연장·청구 금액 숨김과 조기 반납 안내. 선택 사유를 비워도 반납되고 환불이 발생하지 않는다.
6. UI: 실제 기간 충돌에서 고객·기간 입력을 유지하고 최신 배정 현황을 다시 조회한다.

응답 유실은 Playwright가 실제 서버 응답을 받은 뒤 브라우저 전달을 중단해 만든다. 성공 응답을 HTTP fixture로 대체하지 않는다.

## Mock·산출물 검증

```powershell
npm run test:e2e:lockers:mock
npm run check
npm run test:builds
```

Mock origin은 15191이며 사물함·기존 전체 화면·세 테마·1440/1024/390px 회귀를 실행한다. 이 결과는 실제 DB 저장 검증과 다르다.

## 정리와 한계

종료 시 검증 jar 경로·PID와 컨테이너 ID·이름을 대조하여 이번 서버·DB 컨테이너·익명 볼륨·자격 증명 파일만 정리한다. 운영 배포·실제 모바일 기기·부하·다중 인스턴스 및 Backend 자체 통합 테스트 재실행은 수행하지 않는다.
