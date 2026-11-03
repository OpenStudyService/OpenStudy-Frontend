# 스터디룸·예약 실제 Backend 검증

Frontend #23의 MSW 계약 검사와 실제 DB 저장 검증을 구분한다.

## 격리 환경

- Backend main `7fcac51`을 `git archive`로 별도 디렉터리에 추출하고 Java 21로 `bootJar`를 빌드했다. 원래 Backend의 작업 파일·환경 파일을 복사하거나 변경하지 않았다.
- 검증 전용 MySQL 8.4 DB `rooms_live`만 사용한다. DB loopback 포트 13326, Backend 18096, live Vite 15188이다. 기존 개발 DB는 사용하지 않는다.
- local 프로필·메일 비활성화, 공식 `ownerBootstrap`으로 OWNER `owner@rooms.test`를 준비한다. 무작위 검증 비밀번호를 사용한다.
- 지점 1 직원 `staff@rooms.test`는 일반 조회·이용 처리만 가능하다. 지점 2 직원 `cashier@rooms.test`는 지점 2의 `payments:write`만 보유한다. 초기 지점 선택 데이터에는 local 샘플 이름이 있으나 룸·예약·결제·환불·이용 기록은 실제 API와 DB로 생성한다.
- OWNER의 두 편집 세션은 별도로 로그인한다. 테스트 간 인증 상태는 메모리에서만 재사용하고 파일·trace에 저장하지 않는다. Service Worker는 차단한다.

## 실행

검증 비밀번호를 프로세스 환경 변수 `ROOMS_LIVE_PASSWORD`에 지정한다.

```powershell
npm run test:e2e:rooms:live
```

## 실제 검증 범위

1. 실제 HTTP: 같은 키 예약 재시도, 서버 요금 snapshot, 중복 시간 409, 취소·전액 환불·같은 키 취소 재시도, 같은 시간 신규 예약의 새 예약/결제 ID, 직원 이용 시작·완료, 달력·목록·상세 정합성.
2. 실제 HTTP: 정시 위반 422, Mock 결제 실패는 `201`이지만 상태는 `결제 실패`, 이후 동일 시간 정상 예약 가능, 예약·취소 권한과 타 지점 상세 접근 거부.
3. Chrome UI: 룸 등록·수정·운영 중단과 새로고침 유지. 다른 OWNER 세션이 요금을 바꾼 후 409에서 이름 초안을 보존하고 변경한 필드만 재저장한다.
4. Chrome UI: 실제 예약 생성/취소가 커밋된 뒤 응답 전달만 끊는다. 입력과 동일 요청 키를 유지해 재시도하고, 취소 후 새 예약·새 결제로 다시 등록한다.
5. Chrome UI: 일반 직원에게 관리·예약·취소·결제 금액은 노출하지 않으면서 이용 시작·완료를 허용한다.
6. Chrome UI: 실제 시간 충돌에서 입력을 보존하고 최신 서버 일정을 다시 불러온다.

응답 유실은 Playwright가 실제 서버 응답을 받은 후 브라우저 전달을 중단해 만든다. 가짜 성공 HTTP fixture가 아니다. 정확히 시작 시각이 된 취소 경계·늦은 응답·권한 회수는 컴포넌트/모델 검사와 구분한다.

## Mock·기본 검사

```powershell
npm run test:e2e:rooms:mock
npm run check
npm run test:builds
```

Mock Chrome은 전용 origin 15189에서 룸·예약, 1440/1024/390px, 세 테마와 전체 화면 회귀를 실행한다. MSW 성공을 실제 DB 저장 성공으로 간주하지 않는다.

## 정리와 한계

검증 종료 후 jar 경로·PID, 컨테이너 ID·이름을 확인하여 이번 서버·DB 컨테이너·익명 볼륨만 제거하고 임시 자격 증명 파일을 삭제한다.

운영 배포·실제 모바일 기기·부하·다중 인스턴스 및 Backend 자체 통합 테스트 재실행은 범위 밖이다. 룸 견적 API는 현재 계약에 없다. 예약 전 시간당 요금과 등록 후 확정 결제 금액은 모두 서버 응답을 사용한다.
