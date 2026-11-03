# 채팅 독립 읽음 실제 연동 검증 (#27 / Backend #155)

## 환경

- Frontend main `6506107` 기준 `feature/chat-independent-read`.
- Backend PR #157 병합 커밋 `027f692`를 `git archive`로 `qa-artifacts/chat-read-live/backend/`에 추출한다. 개발 중인 근무표·OpenAPI 변경이나 원본 환경 파일을 복사하지 않는다.
- MySQL 8.4 / 일회용 DB `chat_read_live` / localhost 13329, Backend 18099, live Vite 15194, Mock Vite 15195.
- 합성 OWNER `owner@chat.test`, STAFF `staff@chat.test`, 다른 지점 STAFF를 무작위 비밀번호로 준비한다. 메일 발송은 비활성화한다. 기존 개발 DB를 사용하지 않는다.
- 임시 자격 증명은 무시되는 QA 디렉터리에만 두고 종료 시 삭제한다. Playwright trace는 실제 세션에서 끈다.

## 명령

```powershell
npm run check
npm run test:e2e:chat-read:mock
# 위의 일회용 서버를 준비한 현재 셸에서 CHAT_LIVE_PASSWORD를 설정한다.
npm run test:e2e:chat-read:live
npm run test:builds
graphify update .
```

정본 타입은 병합된 `027f692:docs/design/foundation/openapi.json`을 무시되는 QA 파일로 추출해 `openapi-typescript`로 생성했다. 원본 Backend의 미커밋 OpenAPI를 생성 입력으로 사용하지 않았다.

## 서로 다른 검증 근거

- **단위·요청 대역**: bigint 문자열, 본문/스레드 경로·본문, 미확인 합계·잘못된 응답 거부, 가려진 탭/패널/모달·스크롤 조건, 명시적 읽음 재시도, 취소된 이전 응답 무시, 과거 원문의 새 답글 메타정보 재조회.
- **MSW HTTP fixture**: 실제 `api()` transport를 사용해 CSRF와 요청 키 없음, `messageId`/`replyId`, 422 오류 전달을 확인한다. 저장은 구현하지 않는 fixture이며 실제 Backend 검증이 아니다.
- **MSW 데모 공유 원장**: 독립 읽음·본인 제외·재참여 기준 위치는 기존 demo sequence 저장소를 사용한다. 새 참가자와 남은 참가자는 자동 읽음으로 바뀌지 않는다. live의 bigint ID 저장소와 구분한다.
- **실제 Backend·일회용 DB·Chrome**: 신규 3개와 기존 4개를 함께 실행한다. 두 사용자 브라우저의 본문/두 스레드 독립 미확인, 모바일에서 가려진 본문, 스크롤 위의 새 메시지, 실제 커밋 뒤 응답 유실과 동일 대상 재시도, 같은 사용자 두 세션의 동시/과거 위치 갱신, 잘못된 대상·참여 종료 거부·재참여 기준 위치, 기존 전송·스레드·과거 페이지·채널 설정·충돌·업무 카드·권한 회귀를 확인한다.
- **Mock Chrome**: 기존 채팅 7개와 반응형·테마·전체 화면 5개. 기존 demo DM 회귀도 포함하지만 새 live DM은 구현하지 않는다.
- **프로덕션 산출물**: live/mock 오염 검사와 별도 Chrome 산출물 시험. 해당 산출물 시험의 HTTP 대역은 실제 DB 저장 근거가 아니다.

## 제한 및 정리

- 운영 DB의 V6 전환, 운영 배포, 실제 모바일 기기, 부하·답글 다량 분포·다중 인스턴스, Backend 자체 전체 테스트 재실행은 미검증이다. 일회용 DB에는 Flyway가 V6까지 실제 적용된다.
- 채팅은 기존 15초/포커스·사용자 새로고침 방식이다. DM·채팅 전용 실시간 수신(M14)은 제외한다. 읽음 요청은 감사·workspace 이벤트를 만들지 않는 서버 계약을 따른다.
- 서버 jar 경로와 PID, 컨테이너 전체 ID·이름을 확인한 뒤 생성한 서버·컨테이너·익명 볼륨·임시 자격 증명만 정리한다. 기존 개발 환경이나 다른 작업의 서버는 종료하지 않는다.
