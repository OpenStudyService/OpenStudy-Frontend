# 고객 룸·사물함 이력 및 타 지점 요약 검증 (#25)

## 검증 환경

- Frontend main `38f79e2`에서 `feature/customer-cross-branch-history`를 생성했다.
- Backend는 #72의 병합 PR #156을 포함한 커밋 `613fafd`를 `git archive`로 별도 `qa-artifacts/customer-spaces-live/backend/`에 풀었다. 원본 작업 트리·환경 파일을 복사하지 않았다.
- MySQL 8.4 일회용 컨테이너 / 별도 DB `customer_spaces_live`, localhost 13328 / Backend 18098 / live Vite 15192 / Mock Vite 15193을 사용한다. 기존 개발 DB는 사용하지 않는다.
- 무작위 비밀번호의 OWNER·일반 STAFF·타 지점 결제 STAFF만 생성한다. 자격 증명은 무시되는 QA 디렉터리에 잠시 보관하고 종료 시 삭제한다. 메일 발송은 비활성화한다.

## 실행

```powershell
npm run check
npm run test:e2e:customer-spaces:mock
# 별도 서버·일회용 DB를 준비하고 현재 셸에만 비밀번호를 설정한다.
npm run test:e2e:customer-spaces:live
npm run test:builds
graphify update .
```

실제 시험은 `CUSTOMER_SPACES_LIVE_PASSWORD`를 요구한다. 자동으로 기존 서버나 개발 DB를 선택하지 않는다. 테스트는 OWNER / `staff@lockers.test`의 합성 계정을 사용한다(앞선 격리 환경 스크립트를 재사용한 계정 이름이다).

## 서로 다른 검증 근거

- API·UI 단위 테스트: 최소 필드·고객/지점/중복 응답 검증, 사유 필수·422 입력 보존, 중복 제출, 닫기·scope/권한 변경 후 결과 제거, 현재 권한에 따른 결제 링크 차단. UI 요청 대역 검증이며 실제 저장 근거가 아니다.
- MSW: 기존 고객·예약·배정·이용권 원장 공유, 사유별 열람 기록, 조회 범위 유지, MANAGER/권한 STAFF/권한 회수, nullable 청구. 실제 서버와 구분한다.
- 실제 Backend + 일회용 DB + Chrome: HTTP 1개와 UI 2개. 양 지점 룸 예약·실제 이용 시작·사물함 배정·이용권 구매를 실제 저장하고 고객 이력과 대조한다. 새로고침, 대상 지점 상세 링크, 결제 정보 제한, 실제 권한 관리 화면의 부여·회수, CSRF 포함 사유 POST와 요청 키 없음, 범위 밖 고객 요약 후 일반 상세/이력 404를 검증한다.
- 일회용 DB 읽기로 `CROSS_BRANCH_SUMMARY` 출처와 `CROSS_BRANCH_SUMMARY_DENIED` 감사 기록이 생성됐음을 별도로 확인한다. OWNER의 무소속 지점 열람은 Backend 계약대로 감사 이벤트에 기록된다.
- Mock Chrome: 사유 대화상자의 이름·초기 제목 포커스·닫기 후 포커스 복귀·재열기 시 사유/결과 초기화, 기존 전체 화면·반응형·테마 회귀.
- production: live/mock 빌드 및 오염 검사와 별도 Chrome 산출물 검사. live 실패를 데모 데이터로 대체하지 않는다.

## 제한과 정리

실제 모바일 기기·운영 배포·부하·다중 인스턴스와 Backend 자체 통합 테스트 재실행은 미검증이다. 390px Chrome 캡처는 모바일 기기 검증이 아니다. Mock Worker 초기화 중 `/api/me` 프록시 연결 오류가 발생할 수 있으며 검증 성공과 구분해 개발 기록에 적는다.

생성한 Java 프로세스의 명령행이 해당 QA jar인지, 컨테이너의 전체 ID와 이름이 QA 기록과 일치하는지 확인한 뒤 해당 프로세스·컨테이너·익명 볼륨·임시 자격 증명만 정리한다. Playwright가 생성한 Vite는 해당 실행이 종료하면서 정리한다. 운영 환경과 다른 작업의 서버를 중지하지 않는다.
