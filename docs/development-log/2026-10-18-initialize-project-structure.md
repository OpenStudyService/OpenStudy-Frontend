# 프론트엔드 프로젝트 초기 커밋 준비

## 배경과 결정

연결된 `OpenStudyService/OpenStudy-Frontend` 저장소에는 초기 README와 Git 제외 규칙만 있었다. 현재까지 구현한 프론트엔드를 `main` 기준의 `chore/initialize-project-structure` 브랜치에서 하나의 초기 구성 커밋으로 정리한다.

## 포함한 작업

- React 19, TypeScript, Vite, Tailwind CSS 기반 앱과 라우팅·공통 UI·테마.
- 인증, 홈, 업무·채팅, 운영 자원, 근태, 매출·AI, 설정 화면.
- API 클라이언트, Zod 계약, OpenAPI 및 생성 타입, MSW 시연 데이터와 HTTP·SSE 처리.
- Vitest·Testing Library 및 Playwright 테스트, API·검증·요구사항 추적 문서, 기존 목업과 승인된 미리보기.
- npm 잠금 파일, 개발·빌드·린트·타입 검사 설정과 공개 환경 설정.

## Git 포함 기준

의존성, npm 캐시, live·demo 빌드, TypeScript 캐시, 테스트 결과·리포트, 로그, 개인 IDE 설정과 로컬 환경·키 파일을 제외했다. 재현에 필요한 `.env.example`, `.env.mock`, `.env.live`는 공개 설정만 포함하므로 커밋한다. 개인별 설정은 무시되는 `.env*.local` 파일에 둔다. 승인된 목업 미리보기와 생성 API 타입은 구현·인계 자료로 보존한다.

## 검증

- `npm run check`: 타입 검사·린트 통과, 테스트 4개 파일의 29개 항목 통과.
- `npm run test:builds`: live·demo 빌드 성공. 이후 Playwright 미리보기 서버 시작 단계에서 진행이 멈춰 중단했다. 이번 실행의 브라우저 시나리오는 미검증이며, 기존 검증 기록과 구분한다.
- `git check-ignore`: 의존성·캐시·빌드·테스트 결과와 로컬 환경 파일의 제외 확인.
- 커밋 대상에서 대표적인 개인 키·서비스 토큰 패턴 검색: 일치 없음.

## 후속 범위

실제 백엔드 연동·세션·권한·메일·실시간 전달 및 DomainLens 검증은 기존 API 인계·검증 문서의 후속 범위를 따른다. 워크스페이스 상위 `docs/`를 참조하는 문서는 별도 관리 자료이며 이 프론트엔드 저장소에는 포함하지 않는다. 이번 작업은 로컬 브랜치 생성과 커밋까지이며 원격 push는 수행하지 않는다.
