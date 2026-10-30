# 고객 화면 실제 서버 검증

`tests/live/customers.spec.ts`는 MSW 없이 실제 Backend·MySQL과 Chrome을 사용한다. 기본 데모 E2E와 분리되어 있으며, 사용자 DB와 기존 Backend 작업 트리를 사용하지 않는다.

## 검증 범위

- OWNER의 고객 등록 → 새로고침 → 상세 → 메모 수정 → 사유를 포함한 상태 변경 → 새로고침 후 지속성
- OWNER와 `members:write` 직원의 서로 다른 브라우저 세션에서 실제 409, 입력 보존, 최신값 비교와 변경 필드만 재저장
- 읽기 전용 직원의 등록·직접 수정 차단(403), 다른 지점 고객 비노출(404·목록 total 0)
- 한 번의 PATCH 요청 연락처만 잘못된 값으로 바꿔 실제 서버 422를 발생시키고, 화면 입력 보존과 수정 재시도 확인
- 고객 이름·이메일·메모가 브라우저 저장소에 기록되지 않음

고객의 구매·사용 내역, 결제·환불, 타 지점 최소 요약은 이 시험 범위가 아니다. 운영 배포 환경 검증도 포함하지 않는다.

## 실행 환경

Node 24, Java 21, Docker Desktop 및 Chrome이 필요하다. Backend는 확정 main 커밋의 독립 아카이브 또는 checkout을 사용하며 `.env`를 복사하지 않는다. 검증에 사용하는 다음 리소스는 일회용이다.

| 리소스             | 값                                         |
| ------------------ | ------------------------------------------ |
| MySQL              | `customer_live`, loopback 포트 13319       |
| Backend            | loopback 포트 18089                        |
| Vite live          | loopback 포트 15179 → Backend 18089 프록시 |
| 예시 컨테이너 이름 | `openstudy-customer-live-20261029-db`      |

포트나 컨테이너 이름이 이미 사용 중이면 중단하고 다른 전용 값을 선택한다. 기존 서비스나 컨테이너를 종료하지 않는다.

1. 임의 비밀번호로 전용 MySQL 8.4 컨테이너를 만들고 `MYSQL_DATABASE=customer_live`와 전용 DB 사용자를 설정한다. 포트는 `127.0.0.1`에만 게시한다.
2. 독립 Backend 소스를 Java 21로 `bootJar` 빌드한다. `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` 환경 변수는 전용 DB만 가리킨다. `local` 프로필과 `OPENSTUDY_LOCAL_PREVIEW_ENABLED=true`로 서버를 시작해 Flyway와 로컬 지점 두 개를 준비한다.
3. 마이그레이션이 완료되면 같은 전용 DB 환경으로 `ownerBootstrap`을 실행한다. 현재 명령은 `OWNER_EMAIL`, `OWNER_NAME`, `OWNER_PASSWORD`를 읽는 오프라인 초기화 명령이다. 서버 시작만으로 OWNER가 만들어지지 않는다.
4. 검증 전용 DB에만 활성 직원 두 명과 첫 번째 지점의 활성 STAFF 소속을 준비한다. 한 명은 권한 없는 reader, 한 명은 `members:write`가 있는 writer다. 초대는 이번 시험 범위가 아니므로 전용 DB fixture로 준비할 수 있다. 두 계정과 OWNER는 아래 시험에서 하나의 일회용 비밀번호를 사용한다.
5. 기본 로컬 fixture의 지점 ID는 `1`, `2`다. 다른 초기화 환경이면 시험의 fixture 지점 ID도 맞춘다.

## Playwright 실행

시험은 다음 환경 변수를 요구한다. 값에는 실제 직원 계정이나 운영 자격증명을 사용하지 않는다.

```powershell
$env:CUSTOMER_LIVE_OWNER_EMAIL='owner@customer.test'
$env:CUSTOMER_LIVE_READER_EMAIL='reader@customer.test'
$env:CUSTOMER_LIVE_WRITER_EMAIL='writer@customer.test'
$env:CUSTOMER_LIVE_PASSWORD='<일회용 fixture 비밀번호>'
$env:CUSTOMER_LIVE_BASE_URL='http://127.0.0.1:15179'
```

저장소의 `playwright.customers.config.ts`는 고객 시험만 실행하고 Vite live 서버를 15179 포트에서 직접 시작하여 Backend 18089로 프록시한다. `reuseExistingServer=false`, `trace=off`를 사용한다. 기존 초대 시험의 환경 변수나 Mailpit은 필요하지 않으며, `test:e2e:live`의 초대 검증과 독립적이다.

```powershell
npm run test:e2e:customers:live
```

비밀번호·세션·요청 본문을 시험 로그나 trace에 출력하지 않는다. 시험은 매번 고유 고객 이름을 만들어 기존 실행 데이터와 분리한다. 실패 화면과 일회용 실행 설정·로그는 `qa-artifacts/` 등 Git에서 제외된 디렉터리에 둔다.

## 정리

시험이 끝나면 이번 실행이 생성한 Backend 프로세스와 MySQL 컨테이너만 종료·제거한다. 경로를 재귀 삭제할 경우 절대 경로가 해당 전용 작업 디렉터리 안인지 먼저 확인한다. 자격증명 fixture 파일도 Git에 추가하지 않는다. 실행 결과는 개발 기록에 실제 통과·실패·미검증 항목으로 구분해 남긴다.
