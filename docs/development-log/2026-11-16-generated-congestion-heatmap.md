# 2026-11-16 생성 경로의 요일·시간대 혼잡도 히트맵

## 1. 배경 / 문제

- 사용자 요청(2026-11-16): 요일·시간대 혼잡도 질문을 LLM 호출로 만든 QuerySpec·ViewSpec으로 조회한다.
- Backend가 이 질문을 생성 경로로 처리하면서 ViewSpec에 `Heatmap` 컴포넌트를 보낸다.
  - 바인딩: 요일 `category: d0`, 시간대 `series: d1`, 점유율 `value: m0`
  - 배치: 히트맵과 표를 좌우로 놓는 split
- 화면의 히트맵은 등록 분석 POC-002의 고정 열 이름(`weekday`, `hour_kst`, `sampled_occupancy_pct`)과 좌석 수 열이 있어야만 그렸다.

## 2. 결정 및 이유

- **바인딩을 따른다**: 히트맵은 고정 열 이름 대신 ViewSpec 바인딩이 가리키는 열을 읽는다. 등록 분석(자기 열 이름)과 생성 결과(d0·d1·m0)를 같은 컴포넌트로 그린다.
- **좌석 수는 선택 항목**: 생성 결과는 점유율만 보낸다. 칸의 "n/m석" 표시는 좌석 수가 있을 때만 한다.

## 3. 구현 내용

- `domainlens.ts`
  - 생성 컴포넌트 `Heatmap`을 화면의 `HEATMAP`에 연결했다.
  - 이름표를 추가했다: 좌석 점유율, 요일, 시간대.
- `Charts.tsx`: `HEATMAP`이 바인딩(category·series·value)의 숫자 열로 칸을 만든다.
- `views/CongestionHeatmap.tsx`: 이용 좌석 수와 가용 좌석 수가 없으면 점유율만 표시한다.

## 4. 검증 결과

- `generated-results.test.tsx`에 시험 1개를 추가했다.
  - 생성 혼잡도 응답의 제목이 "요일·시간대별 좌석 점유율"이다.
  - 히트맵 칸("월요일 12시 37.5%")이 그려진다.
  - 표 패널의 열 이름이 d0 대신 "요일"·"시간대"로 표시된다.
- `npm run typecheck`, `npm run lint`, `npm run build` 통과. `npm test` 94개 파일, 852개 통과.
- 실행하지 않은 검증: 실제 Backend·Qwen과 연결한 브라우저 확인(Backend 개발 기록의 남은 작업 참고).

## 5. 남은 작업 / 보류 사항

- 표 패널의 요일은 1~7 숫자로 보인다. 히트맵에는 요일 이름이 나온다.
