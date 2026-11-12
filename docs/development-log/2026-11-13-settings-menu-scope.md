# 설정 메뉴 범위 조사 및 분류안

## 1. 배경 / 문제

설정 화면에 로그인 사용자 본인의 옵션과 지점·공간 운영, OWNER 감사 기능이 함께 있다. [#108](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/108)에서 메뉴 범위를 결정한 뒤 [#111](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/111)에서 구현한다. 계정 화면의 이력과 기존 운영 권한을 확인했다. [프로필 PR #15](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/15) · [계정 보안 PR #92](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/92) · [감사 로그 PR #94](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/94) · [휴무일 연동 PR #89](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/89)

## 2. 검토한 선택지

- 지점 관리와 변경 이력을 각각 사이드바에 배치하고 개인 설정은 사용자 메뉴에서 연다.
- 변경 이력을 지점 관리의 OWNER 전용 탭으로 두어 사이드바 항목을 줄인다.
- 업무 메뉴를 분리하면서 데스크톱 개인 설정 바로가기도 유지해 한 번에 진입할 수 있게 한다.

## 3. 결정 및 이유

**사용자 확인 대기.** 첫 번째 안을 추천한다. 현재 일반 직원도 자기 지점 정보와 휴무일을 볼 수 있어 새 지점 관리 메뉴에서도 조회 권한을 보존한다. 두 스터디룸 탭은 같은 컴포넌트를 렌더링하므로 기존 공간 관리 탭에 통합할 수 있다. 변경 이력에는 지점이 없는 이벤트도 있으므로 OWNER 전용 운영 관리에 둔다. 개인 설정을 사용자 메뉴로 모으면 화면 크기에 따른 설정 바로가기 중복을 줄일 수 있다.

## 4. 구현 내용

- [설정 메뉴 범위 설계 문서](../design/settings-menu-scope.md)에 현재 화면과 역할, 네 진입 경로, 외부 서비스 5곳의 공식 자료, 항목별 분류, 권한 및 기존 주소 호환 제안을 기록했다.
- 저장소의 화면 코드와 API는 이번 문서 변경 범위에서 제외했다.

## 5. 검증 결과

- 원래 저장소의 그래프에서 관련 컴포넌트를 찾아 최신 `origin/main`의 별도 worktree에서 코드와 링크 위치를 확인했다. 문서 변경이므로 그래프 갱신은 생략했다.
- Chrome 데스크톱 MSW 데모에서 OWNER·지점 관리자·일반 직원의 설정 카드와 지점 버튼, 설정 진입 링크, 공간 관리 스터디룸 및 기존 감사 주소의 접근 차이를 확인했다. 모바일 표시, 세부 폼 저장, 감사 상세 및 실제 API 동작은 브라우저에서 확인하지 않았다.
- 문서 변경이므로 프로젝트 테스트·타입 검사·린트·빌드는 실행하지 않았다.

## 6. 남은 작업 / 보류 사항

- 사용자 확인을 받아 분류안과 메뉴 진입, 권한 및 기존 주소 동작을 확정한다.
- 결정과 #111의 범위·인수 조건을 대조한다. 필요한 이슈 문구 변경은 제안 후 사용자 확인을 받는다.
