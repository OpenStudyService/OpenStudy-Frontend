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

1. PR에서 타입 검사·린트·테스트와 live 빌드를 확인한다.
2. 변경을 `main`에 병합한다. Actions가 같은 빌드 산출물을 배포한다.
3. 첫 배포나 재시도는 **Actions → Frontend CI and S3 deployment → Run workflow**에서 `main`으로 실행한다.
4. 캐시 갱신과 `/`, `/login` 확인이 끝나면 작업 요약의 HTTPS 주소에 접속한다.

빌드는 Node.js 24와 `npm ci`, `npm run check`, `npm run build`를 사용한다.
`VITE_API_MODE=live`, `VITE_API_BASE_URL=/api`로 고정한다. 비밀값을 Vite 변수에 넣지 않는다.
시연용 `build:demo`는 배포하지 않는다. 소스맵과 `mockServiceWorker.js`도 게시하지 않는다.

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
```

이 검사는 AWS를 호출하지 않는다. 실제 배포는 GitHub Actions에서 실행한다.
