# S3 정적 웹 자동 배포

[README로 돌아가기](../README.md)

GitHub Actions가 `main`의 변경을 검사·빌드하고 S3에 게시한다.
웹 접속은 비공개 S3 앞의 CloudFront HTTPS 주소를 사용한다.
S3·CloudFront·OIDC 역할은 [OpenStudy-Infra의 Terraform](https://github.com/OpenStudyService/OpenStudy-Infra/tree/main/terraform/frontend)이 관리한다.

## 1. 인프라 생성과 변수 등록

[인프라 구축 순서](https://github.com/OpenStudyService/OpenStudy-Infra/blob/main/docs/frontend-deployment.md)를 따른다.
Terraform의 `github_actions_variables` 출력값 5개를 이 저장소의 Actions **Variables**에 등록한다.

`AWS_ACCOUNT_ID`, `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`를 사용한다.
장기 AWS Access Key는 등록하지 않는다. OIDC로 단기 자격 증명을 받는다.
역할 ARN이 없으면 검사·빌드만 실행한다. AWS에 배포하지 않는다.

## 2. 배포 실행

1. PR에서 타입 검사·린트·테스트, live·Mock 산출물 검사와 두 빌드의 브라우저 시험을 확인한다.
2. 변경을 `main`에 병합한다. Actions가 같은 빌드 산출물을 배포한다.
3. 첫 배포나 재시도는 **Actions → Frontend CI and S3 deployment → Run workflow**에서 `main`으로 실행한다.
4. 캐시 갱신과 `/`, `/login` 확인이 끝나면 작업 요약의 HTTPS 주소에 접속한다.

CI는 Node.js 24에서 `npm ci`, `npm run check`, 배포 절차 시험, `npm run test:builds`를 실행한다. 브라우저 시험에는 설치한 Playwright Chromium을 사용한다.
`.env.live`와 `.env.mock`의 모드에 맞춰 빌드하며 `VITE_API_BASE_URL=/api`를 사용한다. 선택한 모드와 `VITE_API_MODE`가 모순되면 빌드를 거부한다. 비밀값을 Vite 변수에 넣지 않는다.

운영 빌드는 `dist/`, 시연 빌드는 `dist-demo/`에 만든다. live에는 MSW 워커·소스맵을 생성하지 않는다. 각 빌드 후 `scripts/check-build.mjs`가 청크의 모듈 출처(`build-provenance.json`)와 디렉터리 전체의 내용을 검사한다. 미참조 JS·지연 로딩 청크·복사한 워커·소스맵도 검사 대상이다. 정식 Mock 결제 API의 안내와 결과 선택은 허용한다.

검사한 `dist/` 전체를 같은 커밋의 배포 artifact로 전달한다. 업로드 시 문제 파일을 제외해 검사를 우회하지 않는다. 배포 스크립트도 첫 AWS 호출 전에 받은 산출물을 다시 검사한다. `dist-demo/`는 배포하지 않는다.

해시 파일을 먼저 게시하고 `index.html`을 마지막에 게시한다.
기존 브라우저 탭을 위해 이전 해시 파일을 즉시 삭제하지 않는다.
실패한 작업은 로그를 확인한 뒤 다시 실행한다. 이전 버전 복구는 정상 커밋으로 되돌려 배포한다.

## 3. API 연결과 전체 정리

Backend 연결 전에는 웹 화면만 제공한다. 실제 로그인과 업무 API는 동작하지 않는다.
CloudFront의 `/api`·`/api/*` HTTPS 원본은 Infra의 `api_origin_domain_name`으로 설정한다.
세션·CSRF·SSE는 Backend 연결 후 별도 검증한다.

사용 후에는 Actions의 `AWS_DEPLOY_ROLE_ARN` 변수를 삭제한다.
진행 중인 배포 종료를 확인한 뒤 Infra의 `terraform/frontend`를 전체 삭제한다.
전체 명령은 [인프라 배포·정리 순서](https://github.com/OpenStudyService/OpenStudy-Infra/blob/main/docs/frontend-deployment.md#6-사용-후-전체-삭제)를 따른다.

## 로컬 배포 절차 검사

```sh
node --test scripts/deploy-static.test.mjs
npm run test:build:guard
npm run test:builds
```

배포 절차 시험은 가짜 AWS·curl만 사용하고, 오염된 산출물이 외부 호출 전에 차단되는지 확인한다. 빌드 브라우저 시험은 HTTP fixture를 사용하며 실제 Backend·DB 검증이 아니다. 실제 S3·CloudFront 배포는 GitHub Actions에서 실행한다.

같은 origin에서 이전 데모 워커가 등록되어 있으면 live 시작 시 해당 워커만 해제하고, 현재 문서가 여전히 제어 중이면 한 번 새로고침한 뒤 API를 사용한다. 복구할 수 없으면 시작 오류를 표시한다. 운영 origin의 기존 객체·캐시 상태와 실제 배포는 별도 운영 검증 대상이다.
