# 2026-11-02 — DomainLenz 채팅 데모와 개발자 전달 패키지

## 1. 배경 / 문제

DomainLenz 개발자에게 OpenStudy에서 자연어로 조회할 DB 도메인, 테스트 질문, 결과 UI를 함께 전달할 실행 가능한 데모가 필요했다. 작업공간의 `docs/domainlenz/DomainLens_SpringAI_OpenAI_Demo.html`을 참고했다. 기존 별도 AI 화면은 지난달 지점별 매출에 한정되어 있었고 채널 내 AI 결과를 설명하지 못했다.

관련 범위는 [Frontend #32](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/32), [Backend #92](https://github.com/OpenStudyService/OpenStudy-Backend/issues/92), [Backend #97](https://github.com/OpenStudyService/OpenStudy-Backend/issues/97)이다. 이번 작업은 실제 엔진 연동 이슈를 완료하지 않는다.

프론트 main `242af5b`에서 별도 worktree와 `feature/domainlenz-chat-demo`를 만들었다. 원래 프론트 작업공간의 미추적 `.gitattributes`와 백엔드 작업 중 변경은 수정·스테이징하지 않았다.

## 2. 검토한 선택지

- 실제 API/엔진 연결 대신 프론트 시뮬레이션을 선택했다. 사용자는 전체 업무 도메인, 기존 채널 안 호출, 개인 조회 후 공유, 준비된 예문 중심, 단독 HTML 추가 제공을 선택했다.
- 별도 HTML을 따로 구현하면 앱과 시연 결과가 달라질 수 있어, 동일한 시나리오·React 결과 렌더러를 두 진입점에서 사용했다.
- 변경 중인 백엔드 파일을 근거로 문서를 만들지 않고, 커밋된 마이그레이션·OpenAPI를 특정 리비전에 고정해 재현 가능한 자료를 만들었다.

## 3. 결정 및 이유

- 채널 mock 모드에서만 AI 질문 버튼과 `@DomainLenz` 처리를 추가했다. 일반 메시지·DM·스레드는 기존 전송 경로를 유지한다. 채팅 DTO/API와 DB 스키마를 변경하지 않았다.
- 데모 조회와 공유는 브라우저 메모리에서만 재현한다. 개인 결과는 사용자/지점/채널 화면 수명과 함께 정리하고, 공유 카드는 독립 복제본으로 유지한다. 열람 시 현재 시연 권한과 범위를 다시 확인한다.
- 미확정 도메인 AI 권한은 새 제품 권한으로 임의 확정하지 않고 OWNER 시연만 허용한다. 매출은 모든 대상 지점의 AI·매출 권한, 환불 목록은 결제 조회 권한도 확인한다. 전사 휴가의 지점 귀속은 미확정으로 남긴다.
- 시각은 기존 데모와 같은 2026-10-17 11:00 Asia/Seoul이다. 실제 DB 수치나 다른 탭의 Mock 원장과 일치한다고 주장하지 않고, 데모 자체의 합계·단위를 검증한다.
- 초기 imported `MOCK` 변수로 lazy import를 감쌌을 때 live 빌드에 불필요한 데모 청크가 남았다. `import.meta.env.VITE_API_MODE`의 직접 분기로 변경해 모듈 탐색 전에 제거되게 했고 기존 산출물 검사에 전용 fixture 서명도 추가했다.

## 4. 구현 내용

- 13개 업무군 × 정상 질문 2개와 상태 8개, 총 34개 시나리오를 구성했다. KPI·막대·선·도넛·표·일정·목록·타임라인을 공통 데이터셋에서 렌더링한다.
- 예문 갤러리·검색, 4단계 진행, 취소/교체 후 늦은 응답 차단, 표 정렬·페이지 이동·상세, 매출의 지점 축소, 개발자 보기를 제공한다. 예문 밖의 자유 질문은 지원 안내를 표시한다.
- `DemoScenario`/`DemoResult`를 기준으로 UI와 QuerySpec/ViewSpec 협의용 초안을 연결했다. 허용된 UI 타입만 선택하고 미등록 차트는 같은 수치의 표로 대체한다. 실제 엔진 wire schema로 사용하지 않는다.
- 매출은 승인·환불을 독립 집계한 후 원결제 지점별로 결합하는 기존 정책을 설명한다. 물리 원장에 없는 환불 실패 상태 예문은 사용하지 않고 빈 결과 예문을 100만원 이상 환불 조회로 구성했다.
- Backend `898ba3231e8e50209a7b891e177b4b742576a0d0`의 커밋된 DDL V1/V2와 OpenAPI에서 모든 참조 컬럼을 대조했다. OpenAPI 존재와 실제 구현/실행 검증 여부를 구분했다. 인증 비밀·연락처·메모·문의 본문·감사 원문 JSON은 전달 데이터에 포함하지 않는다.
- `docs/domainlenz/`에 실행 안내, DB 사전·관계도, 질문 목록, 기대값 JSON, 스키마 확인 자료, 연동 계약, 화면 4장을 제공한다. `npm run build:domainlenz`로 자산이 모두 포함된 단독 HTML과 문서를 생성한다.
- 전용 Playwright 포트 5186과 결과 디렉터리를 사용한다. 다른 개발 서버 재사용과 동시 테스트 결과 디렉터리 충돌을 피하고 live 테스트를 데모 실행 대상에서 제외한다.

## 5. 검증 결과

- `npm run check` 통과: TypeScript·ESLint, Vitest **44개 파일 / 387개**, 실제 메일 도구의 가드 단위 검사 **9개**, 빌드 검사 단위 테스트 **20개**. 메일 발송 검증을 의미하지 않는다.
- `npm run test:e2e:domainlenz` 통과: Chrome **17개**. 기존 채팅 읽음·스레드·재전송·업무 공유·DM, 신규 AI 개인 조회·공유 스냅샷·지점 제한, 업무 입력/충돌, 1440/1024/390px 및 3개 테마를 확인했다.
- 위 Chrome 검사에서 단독 HTML의 **34개 시나리오 전체**를 네트워크 차단 상태로 실행했다. 기대 상태·행 수, 정렬·페이지·상세·표 대체와 오류/HTTP 요청 부재를 확인했다. 예문 창 Escape 포커스 복귀, 사용자 변경 시 개인 결과 제거·공유 열람 제한, 모바일 overflow도 확인했다.
- `npm run test:builds` 통과: live/demo 빌드 및 산출물 검사, 기존 Chrome 모드 검사 **5개**. live에는 DomainLenz 데모 모듈·fixture가 없으며 demo에는 기존 MSW 흐름이 유지된다. 기존 큰 청크 권고 경고는 남아 있다.
- 데스크톱 예문·결과 및 모바일 예문·결과 PNG 4장을 생성하고 직접 확인했다. 긴 결과를 표시할 때 제목과 요약부터 읽도록 스크롤을 조정했다.
- `graphify update .` AST 갱신 성공: **1,888 nodes / 5,472 edges / 100 communities**. API/LLM 비용 없이 실행했고 기존 ignore 규칙에 따라 그래프 산출물은 로컬에 유지한다.
- 초기 SSE 테스트의 샌드박스 localhost `EACCES`는 로컬 포트 접근이 가능한 실행에서 재검증해 통과했다. 초기 JSON import 속성·포커스 복귀·live 청크 잔존 문제도 수정 후 재검증했다. 실제 DB fixture가 필요한 테스트가 basename 패턴으로 잘못 선택된 실행은 성공으로 기록하지 않았으며 최종 전용 설정은 17개 전체 통과다.
- 전달 ZIP은 작업공간 `outputs/OpenStudy_DomainLenz_Demo.zip`에 생성했다. HTML·문서·JSON·화면 11개 파일이며 소스·환경 파일·자격증명은 포함하지 않는다.

## 6. 남은 작업 / 보류 사항

- 실제 DomainLenz starter·모델·DB 연결, 정형 API와의 수치 동등성, 실제 권한·공유 보관 정책·진행 이벤트 계약, 성능·비용 측정은 후속 작업이다.
- 권한 미확정 도메인 정책과 전사 휴가의 지점 귀속, 실제 채널 공유 권한 회수·보관·다중 사용자 전달을 협의해야 한다.
- 서버 페이징·CSV·업무 변경·일반 자연어 해석은 데모 범위가 아니다. 시연 성공을 #32/#92/#97 또는 상위 자연어 기능의 완료로 간주하지 않는다.
- 원격 main 직접 push·PR 병합·자동 병합은 하지 않는다. 작업 브랜치 push와 PR 준비 후 사용자 검토·병합에 맡긴다.

## 7. 전달 기록

- 구현·문서·화면·테스트를 `4cf069c`로 커밋하고 `feature/domainlenz-chat-demo`를 push했다.
- [Frontend PR #56](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/56)을 생성했다. 실제 연동 이슈를 닫지 않고 참고 관계만 연결했으며 사용자 검토·병합 대기 상태다.
- 최종 AST 갱신은 **1,897 nodes / 5,482 edges / 96 communities**다. 생성 HTML의 Radix 내장 CSS 템플릿에서 공백만 있는 줄을 정리해 `git diff --cached --check`를 통과했고, 재생성 후 오프라인 갤러리·공유·모바일 Chrome 검사 1개를 추가로 통과했다.
- 전달 ZIP을 최종 HTML·문서·화면으로 다시 생성했다. 저장 위치는 작업공간 `outputs/OpenStudy_DomainLenz_Demo.zip`이며 압축 해제 후 `OpenStudy_DomainLenz_Demo.html`을 열면 된다.
- PR 생성 시 base는 main `242af5b`였다. 원격 main 갱신, 병합 및 자동 병합은 수행하지 않았다.
