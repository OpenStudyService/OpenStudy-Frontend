# 2026-11-06 팀 채팅 제외·채팅 탭의 AI 채팅 전환 기록

## 1. 배경 / 문제

사용자가 화면의 팀 채팅을 보고 서비스 범위를 바꾸기로 했다. 팀 채팅은 넣지 않고, 채팅 화면은 DomainLens로 자연어 DB 조회만 하는 AI 채팅 하나로 둔다.

Frontend에서 팀 채팅과 연결된 곳:

- `features/chat`(채널·메시지·스레드·읽음·업무 카드), 설정의 채널 관리(`ChannelManagement`), 업무 상세의 채널 공유(`TaskShare`·`TaskPanel`)
- 레일 `채팅`과 `/chat`·`/chat/:channelId` 주소, 공통 SSE의 채팅 읽음 이벤트(`Layout`)
- 홈의 메시지 영역, MSW 채널 핸들러, Playwright 팀 채팅 시나리오
- 업무 분석 아래에 따로 있는 `AI 분석`(`/ai`, `features/analysis/Ai`)
- 열린 이슈: #31(홈 메시지 영역), #44(1:1 대화)

## 2. 검토한 선택지

Backend 개발 기록과 같다(OpenStudyService/OpenStudy-Backend `docs/development-log/2026-11-06-team-chat-scope-removal.md`). 화면에 관한 선택지는 다음과 같다.

- 팀 채팅 화면: 코드 삭제 / 비활성화
- AI 채팅: 채팅 탭에 자연어 분석 화면을 두고 이력은 화면 세션 안에서만 / 서버에 대화 저장 / `AI 분석` 메뉴 유지
- 홈 메시지 자리: 최근 AI 대화 / AI 채팅 바로가기만

## 3. 결정 및 이유

모두 사용자 선택이다. 근거는 OpenStudyService/OpenStudy-Backend#166(ADR-M10-002, SRS v1.14 POL-50·51)이다.

- 레일 `채팅`은 AI 채팅이다. `AI 분석` 메뉴는 채팅 탭으로 합친다.
- 팀 채팅 화면은 Backend와 같은 기준으로 지우지 않고 비활성화한다.
- 홈 메시지 영역은 데이터 없는 AI 채팅 바로가기로 바꾼다.
- AI 대화는 서버에 저장하고, 화면에서 목록·다시 열기·삭제를 제공한다.
- 이번 작업은 문서·이슈만 바꾼다.

## 4. 구현 내용

- `docs/traceability.md`에 팀 채팅 제외 안내를 추가했다. 기존 행은 당시 연결로 남겼다.
- 이슈: #44를 닫았다(not planned). #31·#32 범위를 고쳤다. #70(팀 채팅 비활성화·채팅 탭 전환)과 #71(AI 대화 목록·다시 열기·삭제)을 등록했다.
- 코드는 바꾸지 않았다.

## 5. 검증 결과

- 문서 변경만 있어 typecheck·lint·테스트·빌드는 실행하지 않았다.
- 화면 동작은 바뀌지 않았다. 팀 채팅 화면은 아직 열린다(#70 전까지).

## 6. 남은 작업 / 보류 사항

- #70: 팀 채팅 비활성화와 채팅 탭 전환
- #71: AI 대화 화면(선행: Backend #92 계약)
- `docs/api/openapi.json`은 Backend 계약이 갱신된 뒤(OpenStudyService/OpenStudy-Backend#167·#90·#92) 동기화한다.
