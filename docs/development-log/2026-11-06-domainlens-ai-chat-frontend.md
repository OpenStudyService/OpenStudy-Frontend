# 2026-11-06 DomainLens AI 채팅 화면 도입(업무 AI 화면 교체)

## 1. 배경 / 문제

- 백엔드에 DomainLens 자연어 조회(`POST /api/ai/queries`)가 이식됐다(OpenStudyService/OpenStudy-Backend#169). 프런트엔드 이식 방법은 `OpenStudy-DomainLenz-Receive/porting.md`에 있다.
- porting.md는 별도 데모 화면 OpenLens를 추가한다.
  - 메뉴: 업무 분석 > OpenLens 데모
  - 주소: 로그인 없이 열리는 `/openlens`
  - 스타일: 전용 CSS 약 2,900줄
- 사용자는 이 화면을 "우리 디자인에 맞춰" 도입하기를 원했다.
- `[M]` 파일(`Layout`·`Router`·`handlers`)은 이식본을 만든 시점의 오래된 `main`을 기준으로 한다. 덮어쓰면 다음이 사라진다.
  - 이탈 확인(`leaveGuard`)
  - 매출·근태·근무 MSW 핸들러

## 2. 검토한 선택지

화면 위치(사용자 선택):

- **AI 분석 화면 교체(선택)**: 기존 `업무 AI`(`/ai`) 화면을 채팅형으로 바꾼다. 메뉴·주소는 그대로 둔다.
- **#70까지 함께**: 레일 `채팅` 전환과 팀 채팅 비활성화까지 한 PR에서 한다. 범위가 커서 제외했다.
- **porting.md대로 데모 메뉴 추가**: 화면이 둘로 나뉜다. 또 백엔드가 로그인을 요구하므로 비로그인 `/openlens`는 동작할 수 없다.

## 3. 결정 및 이유

- `features/analysis/Ai.tsx`를 다시 작성했다.
  - OpenLens 전용 마크업과 CSS 대신 팀 채팅과 같은 클래스를 썼다(`chat-shell`·`chat-header`·`messages`·`message`·`composer`·`card`·`tabs`·`tip`). 테마 3종을 그대로 따르고, #70에서 레일 `채팅`으로 옮기기 쉽다.
  - 이식본의 데모 요소는 넣지 않았다. 내부 식별자를 보여 주는 KPI(대표 컴포넌트·정책 버전), 인위적 지연(650ms), 지점 ID 하드코딩이 여기에 해당한다.
- `domainlens.ts`·`Charts.tsx`(ViewSpecRenderer)와 시각화 컴포넌트 5종은 이식본을 가져왔다.
  - 시각화 컴포넌트는 이미 우리 디자인 토큰(`text-ink`·`bg-soft`·`border-line`·`text-primary`)을 쓴다.
  - 위치는 `features/analysis/views/`로 옮겼다.
- `executeAiQuery`는 CSRF 토큰을 보내도록 고쳤다. 이식본은 토큰 없이 `fetch`해서 백엔드(로그인·CSRF 필요)에서 403이 난다.
  - 거부 응답(403·422·429)도 AI 응답 본문(status·message)을 담고 있어서, 공통 `api()`처럼 던지지 않고 그대로 돌려준다.
  - 401이면 공통 세션 만료 이벤트를 보낸다.
- MSW는 덮어쓰지 않았다. 이식본의 AI 핸들러 블록(`/api/ai/**`)만 기존 핸들러 앞에 추가했다.

## 4. 구현 내용

- **`Ai.tsx`**
  - 화면 안에서만 유지되는 대화다. 대화 저장·다시 열기는 #71에서 한다.
  - 지점(scope)이나 계정이 바뀌면 새 대화로 시작한다(`key`). 이전 답변은 다른 권한으로 조회한 결과이기 때문이다.
  - 분야 탭과 예시 질문 10개를 둔다. 매출 조회 권한이 없으면 매출 예시는 비활성화하고 안내 문구를 보인다.
  - 응답 상태별 화면:
    - 완료: 결과 카드(제목, 보기 전환 버튼, 매출이면 순매출·승인·환불 합계, 기준 시각)
    - 확인 필요: 선택지 버튼(`clarificationChoice` 재전송)
    - 거부·오류: 안내 문구만 보이고 결과는 보이지 않는다.
  - 질문 취소(AbortController), Enter 전송·Shift+Enter 줄바꿈, AI 준비 상태 확인(`/catalog/readiness`).
  - 권한은 `ai:read`가 필요하다. 매출 권한은 서버가 질문별로 판단한다.
- **`shared/api/client.ts`**: `csrf()`를 export했다.
- **MSW**: `/api/ai/queries` 모킹 응답의 매출 기간을 모킹 데이터 기준 시각(2026-10-17)에 맞췄다. 이식본의 2026-11-01~03에는 거래가 없어 0원만 나왔다.
- **테스트**
  - `Ai.test.tsx` 5개: 권한 없음, 완료·보기 전환, 거부, 선택지 재전송, 매출 예시 비활성화와 준비 전 차단
  - `domainlens-views.test.tsx` 2개: 이식본의 ViewSpec 계약·시각화 컴포넌트 테스트

## 5. 검증 결과

- Prettier(변경 파일): 통과
- 단위 테스트: 기존 612개 통과, 신규 7개 통과
- 브라우저(mock 모드, 데스크톱 앱 내장 브라우저):
  - 사장님 체험 계정으로 `업무 AI` 화면을 열어 예시 목록과 질문 전송을 확인했다.
  - 매출 결과 카드(합계, 막대 차트, 표, 기준 시각)가 기존 디자인으로 표시되는 것을 확인했다.
- E2E(`npm run test:e2e:usability`, CI와 같은 설정):
  - 처음 실행에서 390px 반응형 테스트가 실패했다. 모바일 CSS가 채널을 고르지 않은 `chat-shell`의 `chat-main`을 숨겨, 단일 화면인 AI 채팅의 본문이 보이지 않았다.
  - `has-channel`을 붙여 고친 뒤 29개 모두 통과했다.
- `npm run check`(typecheck·lint·단위 619개·도구 테스트·빌드 가드)와 `npm run build`: 통과
- **미검증**
  - 실제 백엔드(#169)와의 연동: 로그인·CSRF로 `/api/ai/queries`를 호출하는 흐름
  - 매출이 아닌 시각화(히트맵·좌석·캘린더·순위·업무 목록)의 브라우저 화면: 모킹이 매출 응답만 돌려준다. 단위 테스트로 렌더링만 확인했다.

## 6. 남은 작업 / 보류 사항

- #70: 레일 `채팅`을 이 화면으로 연결하고, 팀 채팅을 비활성화한다.
- #71: AI 대화 저장·목록·다시 열기·삭제
- MSW `/api/ai/queries`가 질문에 따라 다른 시각화 응답을 돌려주도록 보강한다.
- 기존 SSE 흐름(`/conversations`·`/requests/:id/events`·`/executions/:id`)의 MSW 핸들러와 `getExecution`은 화면에서 더 쓰이지 않는다. 이번 PR에서는 남겨 두었고, 정리는 #70·#71과 함께 한다.
