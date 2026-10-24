# OpenStudy 프론트엔드

승인된 `docs/mockup/openstudy/` 디자인을 React로 옮긴 스터디카페 백오피스입니다. 현재 완료 범위는 **프론트엔드와 MSW 기반 통합 시연**입니다. 실제 백엔드, 이메일 발송, DomainLens 엔진은 별도 연결합니다. 기존 HTML 목업은 보존했습니다.

정상 입퇴실은 고객이 QR 등으로 직접 처리하는 흐름입니다. 현재 좌석 화면의 직원용 배정·퇴실은 정상 처리 실패 시 예외 지원을 위한 기능입니다. 고객 화면·인증·QR 연동은 후속 범위이며 현재 MSW 시연을 고객 입퇴실 연동 완료로 보지 않습니다.

## 실행

Node.js **24.19.0**, npm **11.10.1**에서 검증했습니다. npm과 `package-lock.json`을 사용합니다.

```sh
cd openstudy-frontend
npm ci
npm run dev
```

표시되는 localhost 주소로 접속합니다. `index.html`을 파일로 열면 React 앱과 MSW가 실행되지 않습니다. Playwright는 설치된 Google Chrome을 사용합니다.

공개 실행 설정인 `.env.mock`과 `.env.live`는 Git에 포함합니다. 개인별 API 주소나 환경 설정은 `.env.local`, `.env.mock.local`, `.env.live.local`에 작성합니다. 로컬 환경 파일과 비밀 값은 커밋하지 않습니다. 사용할 설정은 `.env.example`을 참고하세요.

| 명령                     | 동작                                                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| `npm run dev`            | mock 모드, MSW HTTP·SSE 사용                                              |
| `npm run dev:live`       | live 모드, 실제 `/api` 서버 사용                                          |
| `npm run build`          | 실제 API를 사용하는 배포 빌드                                             |
| `npm run build:demo`     | 데모 데이터 표시와 MSW를 포함하는 시연 빌드                               |
| `npm run preview`        | 마지막 빌드 결과 미리보기                                                 |
| `npm run check`          | strict 타입 검사, ESLint, Vitest·Testing Library                          |
| `npm run test:e2e`       | Chrome에서 사용자 흐름과 반응형 검증                                      |
| `npm run test:builds`    | live·demo 빌드 후 두 배포 결과의 동작·모드 분리 검증                      |
| `npm run api:foundation` | 인접 `openstudy-backend`의 정본 foundation OpenAPI에서 기반 API 타입 생성 |
| `npm run api:generate`   | Zod·폼 정의 → OpenAPI → TypeScript 타입 재생성                            |

## 체험

실서버 모드에서도 업무 데이터가 없어도 메뉴·홈 카드·목록의 열과 필터·예약 달력 등의 화면 구조를 유지합니다. 빈 배열, 빈 객체, `null`, 204 및 비어 있는 성공 응답은 빈 상태로 표시합니다. `/lookups`가 없거나 일시적으로 실패해도 현재 로그인 정보의 지점·본인 정보를 사용하여 본문을 표시합니다. API 미구현(404/501)과 연결 오류는 안내와 재시도 버튼으로 표시하고, 확인하지 못한 홈·매출 수치는 `—`로 구분합니다. 인증·권한 오류(401/403)는 빈 데이터로 처리하지 않습니다.

로그인 화면의 **사장님으로 체험 / 직원으로 체험** 버튼으로 시작합니다. 설정 → 데모·검증 도구에서 사장님, 지점 관리자, 직원과 API 시나리오를 선택할 수 있습니다.

- 이메일: `owner@openstudy.test`, `minji@openstudy.test`, `junho@openstudy.test`, `yujin@openstudy.test`, `doyun@openstudy.test`.
- mock 로그인은 위 이메일과 **8자 이상의 임의 비밀번호**로 역할을 선택합니다. 비밀번호를 저장·비교하는 실제 인증이 아닙니다. 활성화된 초대 계정도 동일합니다.
- 두 지점: 강남점·성수점. 기준 시각: **2026-10-17 11:00 KST**에서 탭 실행 중 흐르는 시계. 지난달 매출 기준 구간은 **2026-09-01 이상 ~ 2026-10-01 미만**입니다.
- 테마는 `openstudy-theme` localStorage에 저장합니다. 모킹 원장과 선택 계정은 `openstudy-mock-v1` sessionStorage에 저장하여 같은 탭의 새로고침 후 유지합니다. 채팅 작성 초안은 메모리에만 둡니다.
- 설정의 **가상 데이터 초기화**로 원장을 초기화합니다. 다른 탭·다른 사용자의 브라우저와 원장을 공유하지 않습니다.

추천 흐름: 강남점 업무 등록 → 담당 박준호 지정 → 상세의 운영 채널에 공유 → 설정에서 직원 박준호로 전환 → 채팅 스레드 보고 → 연결 업무 완료 → 홈·목록·카드 확인.

## 구현한 화면과 흐름

로그인·초대 수락·승인 대기, 홈, 업무, 채널·DM·스레드, 회원·보유 이용권, 상품·요율, 결제·환불, 좌석 배치·입퇴실·사물함·룸, 예약 달력·목록, 시설·점검, 문의, 공지, 주간 근무표·출퇴근·휴게·정정·휴가·대체근무, 직원·초대·권한, 매출, AI, 설정을 제공합니다.

목록과 상세·등록·수정·승인 화면은 API를 통합니다. 조회는 TanStack Query, 변경은 mutation/API 클라이언트를 사용하며 서버 응답 후 목록·홈·연결 카드 등을 다시 조회합니다. 업무 원장을 Zustand에 중복 저장하지 않습니다. `all`은 허용된 전체 지점이며 변경 폼에서는 대상 지점을 선택합니다.

로그인 이메일은 변경 불가 ID입니다. 설정에서는 읽기 전용으로 표시하며 프로필은 닉네임·사진만 수정합니다. 관리자 직원 수정에서도 이메일을 변경할 수 없고, MSW는 직접 요청의 email 필드도 거절합니다. 계정 생성·초대 입력과 고객 원장의 연락용 이메일은 이 제한과 구분합니다.

- `/app/:scope/...`의 `detail`, `edit`, `action`, `thread`, `tab`, 검색·필터·정렬·페이지·날짜·보기 매개변수는 주소에서 복원합니다.
- 1100px 이상 전체 탐색, 641~1099px 보조 탐색 서랍, 640px 이하 하단 탐색과 모바일 대화·스레드 구조를 사용합니다.
- 포레스트·네이비·샌드 토큰, Radix 상세 패널·메뉴의 포커스, 본문 건너뛰기, 오류 레이블, 모션 감소를 적용했습니다.
- AI 시연은 **지난달 지점별 매출**만 지원합니다. SSE 진행·취소·확인 질문·실패와 표·막대·선 차트 렌더링을 제공합니다. SQL이나 HTML을 실행하지 않습니다.

## 코드 구조

```text
src/app/             초기화, 라우트, 공통 레이아웃, 테마·UI 상태
src/features/        인증, 홈, 운영 폼·상세, 채팅, 근태, 매출·AI, 설정
src/shared/api/      fetch·CSRF·오류·취소, SSE 재연결, 생성 타입
src/shared/domain/   Zod 데이터 계약, 권한 함수, 화면·폼 정의
src/shared/ui/       디자인 컴포넌트, SVG 아이콘·목업 일러스트
src/mocks/           seed, 탭 세션 원장, 승인 규칙, MSW HTTP·SSE
tests/               브라우저 시나리오, 화면 크기·테마 캡처
docs/api/            OpenAPI와 API 인계 계약
```

일반 목록은 페이지, 채팅·답글은 커서 기반입니다. 민감 명령은 멱등 키와 버전을 검사하며 실패한 폼은 입력을 보존합니다. Mock 결제는 실제 금전 이동이 없습니다. 실패 거래의 재결제는 조건을 확인하고 새 결제를 등록합니다. 예약 변경은 기존 미사용 예약 취소·환불 후 새 예약 등록으로 표현합니다.

## 서버 연결과 검증 경계

백엔드 구현 전 API 정본은 [OpenStudy API 명세서 v1.0](../docs/api/README.md)입니다. 현재 MSW와의 차이 및 연결할 때 필요한 프론트 변경은 [호환 차이표](../docs/api/compatibility.md)를 따릅니다.

환경 변수는 `.env.example`, 상세 계약은 [API 인계 문서](docs/api/README.md), 요구사항 연결은 [화면 추적표](docs/traceability.md), 실제 수행 결과는 [검증 기록](docs/verification.md)에 있습니다.

`live` 모드는 API 실패를 데모 데이터로 대체하지 않습니다. **실제 HttpOnly 세션·CSRF 보안, 서버 권한·동시 트랜잭션, 실제 초대 메일, 두 브라우저 사이 실시간 전달, DomainLens 실엔진·DB 값은 이 프로젝트의 모킹 테스트로 보장하지 않습니다.** 서버 연결 뒤 별도 통합 검증합니다.

기반 API 타입은 `src/shared/api/foundation.generated.ts`를 사용합니다. 정본은 [backend 기반 OpenAPI](https://github.com/OpenStudyService/OpenStudy-Backend/blob/main/docs/design/foundation/openapi.json)이며 프론트에 복제하지 않습니다. 설정의 지점 관리와 직원 목록·지점 소속·권한 프리셋은 이 계약을 사용합니다. 초대·상품 등 아직 전환하지 않은 전체 업무 데모 화면은 기존 계약(`generated.ts`)을 유지합니다.

조직 관리는 `src/features/organization/`에서 정본 DTO와 별도 폼을 관리합니다. 지점 운영시간은 월~일 7개 구조화 값, 직원 소속 저장은 한 지점의 PUT과 계정·소속 두 버전을 사용합니다. 409에서는 입력을 보존하고 최신 서버 내용을 확인한 후 저장할 수 있습니다. 지점·직원 API가 아직 기존 미리보기 응답을 반환하면 부족한 운영시간·버전을 만들어 편집하지 않고 계약 미지원 오류를 표시합니다. MSW 검증은 실제 서버 권한·DB 동시 수정·세션 폐기 검증을 대신하지 않습니다.
