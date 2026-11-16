# 2026-11-16 AI 결과를 ViewSpec 배치대로 조립 (결과 목업 방식)

## 1. 배경 / 문제

- AI 결과 화면은 ViewSpec의 `layout`을 받기만 하고 쓰지 않았다.
- 컴포넌트를 보기 탭(차트·표·KPI)으로 하나씩 전환해 보여 줬다.
- 사용자가 동적 UI의 기준으로 DomainLens 전달 목업(`openstudy-domainlens-handoff/01_DEMO/OpenStudy_DomainLens_v9-6_Final_Stage6.html`)을 지정했다. 목업은 결과를 한 화면에 조립한다.
  - 머리말: 제목, 기간, 유형 배지("BAR + TABLE")
  - KPI 카드 행
  - 차트·표 split(1.35 : 0.65)
  - 하단: ViewSpec 구성
- 사용자 결정(2026-11-16): 목업대로 모든 섹션을 layout에 따라 한 화면에 조립하고 보기 탭은 없앤다.

## 2. 검토한 선택지

- **탭 유지 + 배치 적용**: 기존 흐름은 덜 바뀌지만 목업과 다르다. 사용자가 택하지 않았다.
- **탭 제거 + 조립(채택)**: 이전 "표로 보기"의 서버 페이지 넘기기·정렬 표는 표 패널의 "전체 표 보기"로 옮겼다.

## 3. 결정 및 이유

- **layout은 신뢰하지 않는 입력으로 다룬다** (`layoutOf`)
  - 알 수 없거나 중복된 컴포넌트 참조는 버린다.
  - 자식이 2개가 아닌 split은 세로 나열로 바꾼다.
  - layout에서 빠진 컴포넌트는 끝에 붙인다.
  - layout이 없으면 모든 컴포넌트를 순서대로 쌓는다.
- **폭 기준**: split과 KPI 열 수는 화면 폭이 아니라 결과 카드 폭을 기준으로 바꾼다(CSS container query 720px). 결과 카드가 대화 영역 안에 있어 화면 폭과 카드 폭이 다르기 때문이다.
- **표가 따로 없는 차트**: ViewSpec에 차트의 행을 나열하는 표 컴포넌트가 없으면 차트 패널이 표를 함께 보여 준다. 수치를 글로 읽을 수 있어야 하고, "전체 표 보기"를 열 자리도 필요하기 때문이다.
- **전체 표 권한 거절**: 전체 표가 권한 문제로 거절되면 이전 수치를 보여 주지 않고, 거절 사유와 다시 조회만 보여 준다(기존 동작 유지).

## 4. 구현 내용

- `domainlens.ts`: `ViewLayoutNode` 타입과 `layoutOf`(배치 정리). 쓰지 않게 된 보기 모드 매핑(`toViewMode`)을 지웠다.
- `Charts.tsx`
  - `ViewSpecRenderer`가 layout 트리를 재귀로 그린다. `stack`은 세로, `split`은 2열, `grid`는 반응형 카드다.
  - KPI는 카드 행으로 두고, 나머지는 제목 머리말이 있는 패널에 넣는다.
  - `ComponentView`에 `withTable`을 추가했다. 표 패널이 따로 있으면 차트가 표를 중복해 그리지 않는다.
  - `DetailTable` 계약: 행을 나열하는 패널에서 서버 페이지 표를 열고 닫는다.
- `Ai.tsx`
  - 보기 탭과 턴별 `view` 상태를 지웠다.
  - 머리말에 기간 부제와 유형 배지를 넣었다.
  - 하단에 "ViewSpec · KPI · BAR_CHART · DATA_TABLE"을 표시한다.
  - 결과 카드 최대 폭을 `max-w-3xl`에서 `max-w-5xl`로 넓혔다.
- `styles.css`: `.result-*` 배치·KPI·패널·배지 스타일과 container query.
- `mocks/ai.ts`: 데모 응답을 Backend와 같은 구성(합계 KPI, 막대, 상세 표, `stack[KPI, split[막대, 표]]`)으로 바꿨다.

## 5. 검증 결과

- `npm run typecheck`, `npm run lint`, `npm run build`(live 산출물 검사 포함) 통과.
- `npm test`: 94개 파일, 850개 통과.
  - 추가: `result-layout.test.tsx` 3개(배치 정리, KPI 행과 차트·표 split, 전체 표 열기·닫기).
  - 보기 탭을 쓰던 시험 8개는 새 화면 기준으로 고쳤다. 권한 거절 시험 4개는 거절 사유 표시를 계속 확인한다.
- **브라우저 확인**(데모 모드, `vite --mode mock`, 사장님 체험 계정, "이번 달 지점별 매출을 비교해줘")
  - 1440px
    - 배지 "BAR + TABLE", KPI 3개 한 행
    - 차트 646px · 표 311px 좌우 배치(약 1.35 : 0.65)
    - 하단 "ViewSpec · KPI · BAR_CHART · DATA_TABLE"
  - "전체 표 보기": 표 패널 안에서 서버 페이지 표(데이터 종류 선택, 페이지 이동)로 바뀌고 "간단히 보기"로 돌아온다.
  - 1024px: 결과 카드가 572px이라 split이 1열로 쌓인다.
  - 375px: KPI 2열, split 1열, 가로 스크롤 없음.
- 실행하지 않은 검증
  - 실제 Backend·DB와 연결한 live 확인
  - Playwright 회귀

## 6. 남은 작업 / 보류 사항

- 목업의 KPI 보조 설명("승인일 기준" 등)과 하단 데이터 근거 문구는 ViewSpec에 해당 항목이 없어 표시하지 않는다.
- 패널 머리말의 보조 문구는 표의 행 수만 표시한다.
