# 2026-11-02 — Frontend #34 live·Mock 빌드 분리와 운영 번들 검사

## 1. 배경 / 문제

[Frontend #34](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/34), NFR-OPS-08 및 Backend [ADR-M11-001 M11-D07](https://github.com/OpenStudyService/OpenStudy-Backend/blob/main/docs/db/ADR-M11-001.md)은 live 산출물에서 MSW·데모 사용자 전환·가상 원장 초기화·임의 결제 실패 입력 코드를 제외하도록 요구한다. 화면에서 숨기는 것만으로는 인수 조건을 만족하지 않는다.

Frontend main `d1983c9`([PR #52](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/52) 병합)에서 `chore/live-bundle-isolation`을 만들었다. 이슈·정책·현재 Vite 설정·배포 스크립트·기존 빌드 모드 시험을 대조했다. 기존 live 빌드는 MSW를 실행하지 않지만 `public/mockServiceWorker.js`를 그대로 복사하고 소스맵을 생성했다. CI는 업로드 시 이 파일을 제외했으며, 전체 산출물에 데모 코드가 없는지 검증하는 명령은 없었다.

기존 모드별 빌드·브라우저 시험과 API 오류 처리를 재사용했다. 서브에이전트에 산출물 검사기, 빌드/소스 분리, 브라우저 시험을 분담했다. 재개 시 GPT-6.1 Terra Codex로 독립 코드 검토, GPT-6.1 Sol로 실제 빌드·Chrome 검증을 수행하고 주 에이전트가 CI·배포 차단·문서·최종 검증을 통합했다. 작업 전부터 있던 미추적 `.gitattributes`는 제외한다.

## 2. 검토한 선택지

- 파일명이나 몇 개 문자열만 확인하면 이름이 바뀐 MSW 청크나 축소된 데모 모듈을 놓친다. Vite가 각 JS 청크의 실제 모듈 출처를 기록하고, 검사기는 그 목록과 디렉터리 전체의 내용을 함께 확인한다.
- 배포 직전에 문제 파일을 지우거나 업로드 대상에서 빼면 잘못된 live 빌드가 성공한 것처럼 보인다. live 빌드에서는 처음부터 워커·소스맵을 만들지 않고, 검사한 `dist/` 전체를 artifact로 전달한다. 배포 진입점에서도 다시 검사한다.
- 모든 `Mock` 문자열을 금지하면 정식 API의 Mock 결제 기능까지 지워진다. 데모 구현·제어 경로와 임의 실패 필드만 금지하고, 정식 `mockOutcome` 및 실제 금전 이동 없음 안내는 허용한다.
- 기존 워커의 `unregister()`만으로 현재 문서의 제어가 즉시 풀리지는 않는다. API 화면을 렌더하기 전에 해당 워커를 해제하고 제어가 남으면 한 번 새로고침한다. 복구 가드가 남거나 저장할 수 없으면 오류를 표시해 무한 새로고침과 이전 모킹 응답 사용을 막는다.

## 3. 결정 및 이유

- live는 `dist/`, mock은 `dist-demo/`에 출력한다. `--mode live|mock`과 `VITE_API_MODE`의 불일치 및 모드를 지정하지 않은 일반 production 빌드는 거부한다.
- live는 MSW 워커를 public 복사 대상에서 제외하고 소스맵을 생성하지 않는다. favicon 등 일반 public 자산은 유지한다. 예약의 임의 실패 입력과 데모 분기 문자열은 컴파일 시 제거한다. mock 전용 요청 계약 시험은 mock 모듈에서 그대로 지원한다.
- `build-provenance.json`에는 스키마 버전·모드·청크 파일·상대 모듈 경로만 담는다. 검사기는 메타데이터 자체도 검증하며, 등록되지 않은 JS·잘못된 경로·없는 청크·빈 산출물·모드 불일치를 거부한다. 모듈 출처만 믿지 않고 미참조 파일·중첩 경로·지연 청크·소스맵까지 검사한다.
- live는 MSW/mock 모듈, 데모 API·원장·사용자 전환 및 `simulateFailure` 흔적을 거부한다. mock은 반대로 워커·MSW·데모 초기화가 실제로 포함돼야 통과한다. 정식 Mock 결제는 두 모드에서 유지한다.
- 로그인과 앱 상단에는 **실제 API 연결** / **데모 데이터**를 표시한다. Backend의 로컬 샘플 여부는 별도 표시로 유지한다. API 실패를 성공·빈 목록으로 바꾸는 경로는 추가하지 않는다.
- `build`, `build:demo`, `test:builds`에 산출물 검사를 연결한다. CI는 설치한 Chromium으로 두 빌드의 브라우저 시험을 실행하며, 배포는 live의 검사 완료 산출물만 받는다. `deploy-static.sh`는 첫 AWS 호출 전에 다시 검사한다.

## 4. 구현 내용

- `vite.config.ts`: 모드 일치 검증, live public 자산 선별 복사·소스맵 제외, 모드별 출력 경로, 청크 모듈 출처 manifest.
- `scripts/check-build.mjs`: 기존 산출물 전체를 검사하는 CLI 및 재사용 함수. `check-build.test.mjs`에서 실제 파일을 오염시켜 차단을 확인한다.
- `src/main.tsx`: 같은 origin·base의 이전 데모 워커 active/waiting/installing만 제거하고, 현재 문서 제어가 남으면 1회 복구한다. 관계없는 서비스 워커는 제거하지 않는다.
- 로그인·공통 레이아웃의 모드 표시, 예약 폼의 임의 실패 필드/데모 분기 제거를 빌드 시점으로 이동했다.
- npm·CI·배포 스크립트 및 사용 문서 갱신. 배포 시험은 Windows Git Bash와 Linux에서 가짜 명령을 먼저 사용하도록 PATH를 명시한다.

## 5. 검증 결과

### 정적 검사·자동 시험

- `npm run check` 통과: TypeScript·ESLint, **36개 파일 / 단위·컴포넌트 279개**, 기존 실제 메일 도구 시험 **9개**, 산출물 검사기 시험 **19개**.
- 검사기 시험은 축소 후 문자열이 사라진 MSW/mock 모듈, 다른 이름의 중첩 JS, 유니코드 escape를 쓴 임의 실패 입력, 미참조 복사 자산, 워커·소스맵, 잘못된 manifest·모드·경로·누락 파일 등을 거부했다. 정식 Mock 결제 문자열·필드는 통과했다.
- `node --test scripts/deploy-static.test.mjs`: **4개 통과**. 정상 업로드 순서·실패 전파·불완전 빌드·오염된 artifact의 외부 호출 전 차단을 가짜 AWS/curl로 검증했다. 실제 AWS 배포는 하지 않았다.
- 실제 Vite CLI의 모드 불일치(`--mode live`, 환경 변수 mock)와 불명확한 production 모드는 모두 **exit 1**로 거부됐다. 정상 출력에 영향을 주지 않는 별도 경로로 실행했다.

### 프로덕션 빌드·브라우저

- `npm run test:builds` 통과: live **12 files / 8 chunks**, mock **25 files / 10 chunks**의 실제 빌드와 산출물 검사 성공.
- Chrome **5개 모두 통과(9.6초)**: live 로그인 오류, 인증된 결제 목록 오류·재시도와 지연 로딩 설정의 데모 도구 부재, 정식 Mock 결제 FAILED 요청과 API 503 오류 유지, mock 로그인·채팅·원장 초기화, 이전 같은 origin 워커가 실제 제어하는 브라우저의 live 복구.
- 워커 복구 시험은 검사 후 `dist/mockServiceWorker.js`를 일시적으로 만들고 실제 브라우저에 등록·제어시킨 뒤, 파일을 제거하고 live 재진입을 확인한다. `finally`로 정리하며 브라우저 시험 후 live/mock 검사를 다시 통과했다. live 워커 파일 부재도 별도로 확인했다.
- 브라우저 API 응답은 시험용 HTTP fixture다. 이 결과는 실제 Backend·DB·PG 결제 검증이 아니다. 기존 #20의 실제 Backend/DB 결과를 이번 빌드 검증으로 대체하거나 다시 수행했다고 기록하지 않는다.
- 기존 500kB 청크 크기 권고는 남으며 빌드는 성공했다.

## 6. 남은 작업 / 보류 사항

- 실제 S3·CloudFront 배포, 운영 API·DB, 운영 origin의 과거 객체·캐시 상태는 검증하지 않았다. 배포 스크립트는 이전 해시 자산을 유지하며 원격 객체를 일괄 삭제하지 않는다. 이번 범위는 새 live 산출물 검사 및 기존 브라우저 워커의 해제·복구다.
- 검사기는 정상 빌드의 모듈 출처와 알려진 데모 서명을 교차 검사하는 회귀 방지 장치다. 임의로 조작된 산출물의 진위를 보증하는 전자서명이나 보안 분석 도구를 대신하지 않는다.
- 작업 브랜치 push·PR 준비까지만 수행하며 main 직접 push·병합·자동 병합은 하지 않는다.

## 7. 전달 기록

- Frontend `graphify update .` 성공: **1,498 nodes / 4,589 edges / 79 communities**. AST만 사용했고 LLM/API 비용은 없다. 심벌이 없는 설정·데이터 파일 안내와 community 라벨 갱신 안내가 있었으며 코드 그래프 갱신은 완료됐다. 기존 ignore 정책에 따라 산출물은 로컬에 유지한다.
- `git diff --check` 통과. 새 작업 관련 변경만 커밋·push하고 기존 `.gitattributes`는 제외한다. 원격 main은 작업 기준인 `d1983c9` 상태임을 다시 확인했다.
- 워크스페이스 전체 그래프도 갱신했다(**8,889 nodes / 20,080 edges / 623 communities**). SQL 파서 미설치 및 Backend Gradle 구문의 부분 추출 경고는 남으며 실제 빌드 검증을 대체하는 근거로 사용하지 않는다.
- 구현 커밋 **`bb5a9ea`**를 작업 브랜치에 커밋·push하고 [Frontend PR #53](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/53)을 생성했다. #34를 연결했고 검증 경계와 후속 운영 검증을 PR에 구분했다. 사용자 main 검토·병합 대기 상태다.
