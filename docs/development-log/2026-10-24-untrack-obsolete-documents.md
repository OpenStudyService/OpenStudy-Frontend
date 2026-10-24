# 이전 디자인 참고 자료의 Git 추적 해제

## 1. 배경 / 문제

사용자가 원격 저장소의 불필요한 자료를 정리하고 로컬에는 보존하도록 요청했다. React 구현 전 참고한 OpenOffice HTML과 정적 목업 캡처가 현재 소스와 함께 추적되고 있었다.

## 2. 검토한 선택지

목업 전체를 제거할 경우 app.js를 읽는 일러스트 추출 스크립트가 동작하지 않는다. 따라서 실행 가능한 OpenStudy 목업과 검증 도구는 유지하고 이전 참고 HTML·정적 캡처만 Git 추적에서 제외했다. API 명세는 타입 생성 입력이므로 유지한다.

## 3. 결정 및 이유

현재 앱과 목업으로 화면을 확인할 수 있으므로 이전 참고 HTML 3개와 캡처 9개를 로컬 자료로 전환한다. 생성·에셋 추출 입력을 유지하여 프로젝트 실행과 개발 명령에 영향을 주지 않는다.

## 4. 구현 내용

Git 추적에서 제외한 파일 12개:

- `docs/mockup/openoffice(참고용)/openoffice-login-mockup.html`
- `docs/mockup/openoffice(참고용)/openoffice-staff-chat-mockup.html`
- `docs/mockup/openoffice(참고용)/openoffice-staff-mockup.html`
- `docs/mockup/openstudy/previews/chat-mobile.png`
- `docs/mockup/openstudy/previews/chat.png`
- `docs/mockup/openstudy/previews/home-forest.png`
- `docs/mockup/openstudy/previews/home-mobile.png`
- `docs/mockup/openstudy/previews/home-navy.png`
- `docs/mockup/openstudy/previews/home-sand.png`
- `docs/mockup/openstudy/previews/login-mobile.png`
- `docs/mockup/openstudy/previews/login.png`
- `docs/mockup/openstudy/previews/settings.png`

`git rm --cached`로 원래 경로에 파일을 남기고 두 경로를 .gitignore에 추가했다. 작업공간의 `outputs/docs-untracking-2026-10-24/openstudy-frontend/`에도 별도 보관했다. 이 경로는 이 작업환경의 보관 위치이며 clone 시 제공되는 산출물이 아니다. 목업 README의 이미지 링크를 제거하고 로컬 보관·재현 방법을 안내했다. 수정 전 README도 before-edit/에 보존했다.

## 5. 검증 결과

- 대상 12개의 원래 파일과 별도 보관본이 사전 SHA-256과 일치했다.
- 대상의 Git 추적 해제와 ignore 적용, 수정 Markdown의 로컬 링크, `git diff --check`를 확인했다.
- API 타입 생성 입력과 일러스트 추출 입력을 계속 추적하며 실행 코드·설정 명령은 변경하지 않았다.
- 기존 개발 기록을 수정하거나 삭제하지 않았다. 문서·ignore 변경이므로 앱 빌드와 브라우저 테스트는 다시 실행하지 않았다.

## 6. 남은 작업 / 보류 사항

Git 과거 커밋의 자료는 이력으로 유지한다. 이 기록은 구현·검증 결과이며 원격 반영 여부는 해당 정리 PR의 상태를 따른다.
