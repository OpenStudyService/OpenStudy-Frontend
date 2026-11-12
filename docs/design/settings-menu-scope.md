# 설정 메뉴 범위

- 제안일: 2026-11-13
- 상태: **사용자 확인 대기**
- 관련 작업: [조사·결정 #108](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/108), [후속 구현 #111](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/111)

## 현재 화면과 권한

조사 기준은 `origin/main`의 `c3f7071`이다. 아래 표의 권한과 경로는 코드 기준이며, 확인한 브라우저 동작은 별도로 적었다. 일반 직원과 지점 관리자는 활성 소속이 있는 범위에서 접근하며, OWNER와 함께 공통 로그인·활성 상태 검사를 거친다. `all`에서 지점 관리자 여부는 활성 관리자 소속이 하나라도 있는지로 판단한다. 실제 데이터와 수정 권한은 대상 지점에 적용된다. [세션과 지점 가드](../../src/app/Layout.tsx#L153-L195) · [권한 함수](../../src/shared/domain/schema.ts#L466-L494)

| 항목 | 일반 직원 | 지점 관리자 | OWNER | 현재 진입 및 중복 |
| --- | --- | --- | --- | --- |
| 화면 테마 | 표시 | 표시 | 표시 | 설정 상단의 선택기와 미리보기 카드에서 포레스트·네이비·샌드 선택. 로그인에도 같은 선택기가 있고 같은 브라우저 저장값을 사용한다. [설정 테마](../../src/features/settings/Settings.tsx#L16-L75) · [로그인 선택기](../../src/features/auth/Login.tsx#L138-L152) · [브라우저 저장](../../src/app/store.ts#L3-L37) |
| 내 프로필 | 본인 | 본인 | 본인 | 설정 본문에서 닉네임 및 프로필 사진 변경·제거, 로그인 이메일 확인. 헤더에 표시한 이름·사진을 갱신하며 사용자 메뉴는 같은 설정 화면으로 연결된다. [프로필](../../src/features/settings/ProfileForm.tsx#L77-L226) · [사용자 메뉴](../../src/app/Layout.tsx#L372-L403) |
| 비밀번호 변경 | 본인 | 본인 | 본인 | 설정 본문의 `PasswordForm`에서 `POST /me/password`. 로그인 전 비밀번호 재설정은 별도 흐름이다. [변경](../../src/features/settings/Settings.tsx#L77-L98) · [재설정 주소](../../src/app/Router.tsx#L49-L53) |
| 알림 범위 | 표시 | 표시 | 표시 | 설정 본문에 직원 초대 이메일과 미지원 알림 채널 안내가 있다. 사용자 입력이나 저장 기능은 없다. [안내](../../src/features/settings/Settings.tsx#L99-L105) |
| 데모·검증 도구 | MOCK에서 표시 | MOCK에서 표시 | MOCK에서 표시 | 설정 본문에서 체험 계정 전환, API 시나리오·정상 응답 복원, 세션 만료 및 가상 데이터 초기화. 로그인에도 일부 체험 계정 진입이 있다. [노출 및 기능](../../src/features/settings/Settings.tsx#L106-L107) · [도구](../../src/features/settings/Settings.tsx#L139-L261) · [로그인 체험](../../src/features/auth/Login.tsx#L240-L272) |
| 지점 설정 | 지점 목록·검색, 운영 정보·휴무일 조회 | 동일 조회, 담당 지점 휴무일 관리, 해당 지점의 `operations:write` 보유 시 지점 수정 | 조회·휴무일 관리·수정, 지점 등록 | 설정 본문에 역할 제한 없이 렌더링한다. 이름·코드·주소·전화·상태·운영시간, 요일별 운영시간 편집과 휴무일 패널을 포함한다. 헤더 지점 선택기는 조회 범위를 바꾼다. [화면과 버튼](../../src/features/organization/BranchManagement.tsx#L44-L115) · [지점 폼](../../src/features/organization/BranchManagement.tsx#L232-L309) · [수정 권한](../../src/features/organization/model.ts#L43-L57) · [휴무일 권한](../../src/features/organization/BranchClosures.tsx#L21-L39) |
| 공간·운영 환경 → 스터디룸 | 설정에서는 숨김. 공간 관리에서는 표시 | 설정과 공간 관리에 표시 | 설정과 공간 관리에 표시 | 설정 그룹의 기본 탭이며 `?tab=rooms`로도 진입한다. 공간 관리의 같은 탭과 두 경로 모두 `ResourceGroup → ResourcePage → Rooms`를 사용한다. 등록·수정은 대상 지점 `operations:write`로 판단한다. 예약 관리는 별도 예약 업무다. [설정 탭](../../src/features/settings/Settings.tsx#L109-L135) · [공간·예약 라우트](../../src/app/Router.tsx#L88-L105) · [공통 탭](../../src/features/records/ResourcePage.tsx#L1358-L1410) · [렌더링](../../src/features/records/ResourcePage.tsx#L223-L245) · [등록](../../src/features/rooms/RoomPages.tsx#L39-L85) · [수정](../../src/features/rooms/RoomPanel.tsx#L13-L42) |
| 공간·운영 환경 → 변경 이력 | 숨김, 직접 접근 시 권한 안내 | 숨김, 직접 접근 시 권한 안내 | 표시 | 설정에서 `?tab=audit`로 감사 로그 검색, `detail`로 기록 상세와 전후 비교, 요청 ID로 관련 기록 조회. 별도 사이드바 항목은 없다. [탭과 거부](../../src/features/settings/Settings.tsx#L109-L133) · [OWNER 가드와 URL](../../src/features/settings/AuditLog.tsx#L24-L75) · [상세·비교](../../src/features/settings/AuditDetail.tsx#L44-L123) |

설정의 네 진입 경로는 모두 `/app/:scope/settings`를 연다. 요청의 `/settings`는 이 주소의 설정 부분을 가리킨다. 기준 코드에는 루트 `/settings` 라우트가 없다. [라우터](../../src/app/Router.tsx#L37-L68) · [설정 자식 경로](../../src/app/Router.tsx#L133-L148)

| 진입 경로 | 코드에서 확인한 위치 | 추천안 |
| --- | --- | --- |
| 사이드바의 환경설정 → 설정 | 데스크톱 사이드바와 모바일 메뉴 서랍이 같은 메뉴 목록 사용. [메뉴](../../src/app/Layout.tsx#L77-L85) · [사이드바](../../src/app/Layout.tsx#L285-L301) · [서랍](../../src/app/Layout.tsx#L475-L482) | 개인 설정 링크와 빈 그룹 제거 |
| 설정 아이콘 | 코드상 헤더와 분리된 데스크톱 빠른 탐색 레일 하단. [빠른 탐색](../../src/app/Layout.tsx#L313-L343) | 제거 |
| 헤더 사용자 메뉴 → 내 프로필·테마 | 아바타 버튼의 드롭다운. [사용자 메뉴](../../src/app/Layout.tsx#L372-L410) | **개인 설정**으로 이름 변경하고 유지 |
| 빠른 이동 목록 | 모바일 하단 빠른 탐색의 설정 링크. [하단 메뉴](../../src/app/Layout.tsx#L458-L474) | 설정 바로가기 제거 |

### MSW 데모에서 확인한 화면

Chrome 데스크톱에서 OWNER, 지점 관리자(강남점), 일반 직원(강남점)으로 열었다. 세 계정에서 테마·프로필·비밀번호·알림 안내·데모 도구·지점 목록, 데스크톱 설정 레일·사이드바와 사용자 메뉴 링크를 확인했다. OWNER는 지점 등록·수정과 휴무일 관리, 지점 관리자는 강남점 수정과 휴무일 관리, 직원은 강남점 휴무일 보기가 표시됐다. 공간 관리의 스터디룸 탭은 세 역할에서 열렸고, 등록 버튼은 이 데모의 OWNER·지점 관리자에게 표시됐다. 감사 탭의 직접 주소는 OWNER에서 목록 요청이 발생했고 관리자·직원은 권한 안내가 표시됐으며 감사 요청이 관찰되지 않았다. 모바일 표시와 세부 폼 저장·감사 상세는 코드 기준이다.

## 외부 서비스 조사

2026-11-13에 공개 공식 도움말로 확인했다. 제품마다 요금제와 역할에 따라 메뉴가 달라질 수 있다.

| 서비스 | 내 계정·개인 설정 | 조직·매장·공간 설정 위치 | 변경 이력·감사 로그 | 공식 자료 |
| --- | --- | --- | --- | --- |
| Slack | 사이드바 프로필 사진 메뉴에서 프로필 편집과 Preferences로 진입. 알림·테마를 개인 단위로 조정 | 사이드바의 조직 이름 → Tools & settings → Organization settings. 워크스페이스 단위 설정도 Tools & settings에서 진입 | Enterprise는 Organization settings → Security → Audit logs. 워크스페이스 접속 기록도 관리자 설정 영역에 둔다 | [프로필·알림](https://slack.com/help/articles/218080037-Getting-started-for-new-Slack-users) · [테마](https://slack.com/intl/en-gb/help/articles/205166337-change-your-slack-theme) · [조직 감사](https://slack.com/help/articles/360000394286-Audit-logs-in-Slack) · [워크스페이스 접속 기록](https://slack.com/help/articles/360002084807-View-access-logs-for-your-workspace) |
| Microsoft Teams | 프로필 옆 Settings and more → Settings. 개인 사진·표시 테마·언어·지역과 알림 설정 | 별도 Teams admin center에서 팀·회의·메시지 정책과 Teams Rooms 기기 관리 | Microsoft Purview 포털의 Audit에서 Teams 활동 검색 | [개인 설정](https://support.microsoft.com/en-us/teams/notifications-settings/change-settings-in-microsoft-teams) · [알림](https://support.microsoft.com/en-us/teams/notifications-settings/manage-notifications-in-microsoft-teams) · [관리 정책](https://learn.microsoft.com/en-us/microsoftteams/settings-policies-reference) · [룸 기기 관리](https://learn.microsoft.com/en-us/MicrosoftTeams/rooms/rooms-manage) · [Teams 감사](https://learn.microsoft.com/en-us/purview/audit-teams-audit-log-events) |
| Shopify | 관리자 화면의 프로필 메뉴에서 계정 관리. 언어·지역, 계정 Security의 비밀번호·2단계 인증 등 | Shopify admin의 Settings → Locations에서 매장·창고 등 위치 관리 | Settings → General → Resources → Store activity log. 사용자 관리 활동은 Settings → Users → Security에서 별도 조회 | [계정·보안](https://help.shopify.com/en/manual/your-account/manage-account/) · [언어·지역](https://help.shopify.com/en/manual/your-account/languages) · [매장 위치](https://help.shopify.com/en/manual/inventory-and-locations/locations/setup) · [활동 기록](https://help.shopify.com/en/manual/shopify-admin/activity-logs) |
| Square | Dashboard의 Account & Settings → Personal information. 로그인·보안, 언어·시간대 | 같은 대분류의 My business → Locations에서 지점·영업시간 관리. 예약에 쓰는 방·장비는 Dashboard의 Items & services → Items → Resources에서 관리 | Appointments → Settings → History에서 예약 내역을 내보낼 수 있다. 조직 전체의 관리자 변경 감사 로그 위치는 조사 자료에서 확인하지 못했다 | [개인·사업 정보](https://squareup.com/help/us/en/article/3861-edit-your-account-and-business-settings) · [지점](https://squareup.com/help/us/en/article/5580-manage-multiple-locations-with-square) · [예약 자원](https://squareup.com/help/us/en/article/7065-square-appointments-resource-management) · [예약 내역](https://squareup.com/help/us/en/article/5351-manage-your-square-appointments-account-settings) |
| Jira Cloud | 상단 Settings → Personal Jira settings의 General·Notification settings. 프로필에서 이름·사진 등 계정 정보 관리 | 프로젝트에 해당하는 Space에서 Space settings로 진입. 사이트 공통 설정은 관리자용 Settings 영역 | 관리자 권한으로 Settings → System → Audit Log에서 Space·권한·워크플로 변경 등을 조회 | [개인 설정](https://support.atlassian.com/jira-software-cloud/docs/manage-your-jira-personal-settings/) · [프로필](https://support.atlassian.com/jira-software-cloud/docs/manage-your-user-profile/) · [Space 구성](https://support.atlassian.com/jira-cloud-administration/docs/configure-a-space/) · [감사 로그](https://support.atlassian.com/jira-cloud-administration/docs/audit-activities-in-jira-applications/) |

### 공통 패턴

- 개인 설정은 내 계정에 적용되는 프로필·로그인 보안과 내 화면·언어·테마·알림을 다룬다. 프로필이나 인접한 설정 메뉴에서 찾는 사례가 많다. [Slack](https://slack.com/help/articles/218080037-Getting-started-for-new-Slack-users) · [Teams](https://support.microsoft.com/en-us/teams/notifications-settings/change-settings-in-microsoft-teams) · [Jira](https://support.atlassian.com/jira-software-cloud/docs/manage-your-jira-personal-settings/)
- 지점과 공간 자원은 업무 단위별 관리 메뉴에서 찾을 수 있다. 별도 관리자 포털을 쓰는 방식과 동일한 설정 대분류 아래 개인·사업 영역을 분리하는 방식이 모두 있다. [Teams Rooms](https://learn.microsoft.com/en-us/MicrosoftTeams/rooms/rooms-manage) · [Shopify Locations](https://help.shopify.com/en/manual/inventory-and-locations/locations/setup) · [Square](https://squareup.com/help/us/en/article/3861-edit-your-account-and-business-settings)
- 관리 변경 감사는 권한을 요구하는 조직 설정·시스템·보안 영역에 둔다. 서비스별 권한 기준이 달라 OpenStudy에는 현재 OWNER 제한을 적용한다. [Slack](https://slack.com/help/articles/360000394286-Audit-logs-in-Slack) · [Shopify](https://help.shopify.com/en/manual/shopify-admin/activity-logs) · [Jira](https://support.atlassian.com/jira-cloud-administration/docs/audit-activities-in-jira-applications/)

## 분류안

| 현재 항목 | 분류 | 추천 위치와 노출 |
| --- | --- | --- |
| 화면 테마 | 남김(개인 설정) | 사용자 메뉴 → 개인 설정. 모든 활성 역할. 로그인 화면 테마 선택도 유지 |
| 내 프로필 | 남김(개인 설정) | 사용자 메뉴 → 개인 설정. 모든 활성 역할에서 본인만 수정 |
| 비밀번호 변경 | 남김(개인 설정) | 사용자 메뉴 → 개인 설정. 모든 활성 역할에서 본인만 변경 |
| 알림 범위 | 통합·삭제 | 개인 설정의 안내 카드를 제거한다. 직원 초대 화면의 기존 발송 상태와 안내를 해당 기능의 정보로 사용한다. [초대 안내](../../src/features/invitations/Management.tsx#L116-L128) 알림 설정 UI 추가는 별도 작업으로 다룬다 |
| 데모·검증 도구 | 통합·삭제 | 개인 설정의 카드를 제거하고 MOCK 사용자 메뉴의 **데모·검증 도구**로 진입을 통합한다. 제안 주소는 `/app/:scope/demo-tools`이며 별도 사이드바 그룹은 없다. MOCK에서는 모든 활성 역할에 표시하고 live에서는 메뉴와 직접 진입을 제공하지 않는다 |
| 지점 설정 | 운영 메뉴로 이동 | 사이드바 **매장 운영 → 지점 관리** (`/app/:scope/branches`). 세 역할 모두 허용 지점 목록·운영 정보·휴무일 조회. 지점 관리자는 기존 담당 지점 수정·휴무일 관리 조건 적용, OWNER는 지점 등록도 가능 |
| 공간·운영 환경 → 스터디룸 | 통합·삭제 | 사이드바 **매장 운영 → 공간 관리 → 스터디룸** (`/app/:scope/spaces?tab=rooms`)만 사용. 기존 공간 관리에서 세 역할의 탭 노출을 유지하고 등록·수정은 대상 지점 `operations:write`로 검사 |
| 공간·운영 환경 → 변경 이력 | 운영 메뉴로 이동 | 새 사이드바 그룹 **운영 관리 → 변경 이력** (`/app/:scope/audit`). 활성 OWNER만 메뉴와 검색·상세에 접근 |

스터디룸과 변경 이력을 각 업무 메뉴에 연결한 뒤 설정의 **공간·운영 환경** 그룹을 제거한다. 설정에서 두 운영 화면으로 진입하던 주소는 아래 호환 규칙으로 이어 준다. 일반 직원에게는 기존 공간 관리와 지점 정보 읽기 동선을 제공한다.

### 비교한 배치

| 안 | 구성 | 장점 | 단점 |
| --- | --- | --- | --- |
| **A. 업무 메뉴 분리와 사용자 메뉴 진입 (추천)** | 매장 운영에 지점 관리·기존 공간 관리, OWNER용 운영 관리에 변경 이력. 개인 설정은 사용자 메뉴에 배치 | 직원의 지점 조회 동선을 보존한다. 여러 영역의 변경 기록을 OWNER가 사이드바에서 바로 찾을 수 있다. 모바일 하단의 중복 링크를 줄인다 | OWNER 화면에 항목 하나인 그룹이 생긴다. 기존 설정 아이콘 사용자는 사용자 메뉴를 열어야 한다 |
| B. 지점 관리 안에 변경 이력 | 매장 운영 → 지점 관리에 OWNER 전용 변경 이력 탭 추가. 개인 설정은 사용자 메뉴에 배치 | 새 사이드바 그룹 없이 운영 관련 정보를 가까이 둔다 | 지점 외 대상이나 지점 없는 시스템 이벤트도 지점 관리 안에서 찾아야 한다. 지점 검색과 감사 검색의 주소·화면 문맥이 섞인다 |
| C. 운영 배치는 A와 같고 개인 설정 바로가기 추가 | 사용자 메뉴와 기존 데스크톱 빠른 탐색 레일에 개인 설정을 유지. 모바일 하단과 사이드바 중복은 제거 | 데스크톱 한 번 클릭 접근을 유지한다 | 화면 폭에 따라 접근 방식이 달라지고 같은 목적지의 진입점이 두 곳 남는다 |

### 주소 호환 제안

| 기존 주소 | 제안 동작 |
| --- | --- |
| `/app/:scope/settings` | 같은 주소에서 제목이 **개인 설정**인 화면을 연다. 예전 기본 화면에는 개인 설정·지점·스터디룸이 함께 있었으므로 명시적인 탭이 없는 주소는 개인 설정으로 해석한다 |
| `/app/:scope/settings?tab=audit` | 활성 OWNER는 동일 `:scope`의 `/audit`로 히스토리를 교체해 이동한다. `tab`을 빼고 기존 감사 필터, 페이지, 요청 ID 및 `detail`을 보존한다. 비 OWNER의 예전 주소·새 주소는 모두 권한 안내를 표시하고 감사 API를 호출하지 않는다. [검색 파라미터](../../src/features/settings/audit-model.ts#L8-L27) · [상세 및 요청 ID](../../src/features/settings/AuditLog.tsx#L36-L75) |
| `/app/:scope/settings?tab=rooms` | 동일 `:scope`의 `/spaces?tab=rooms`로 히스토리를 교체한다. 룸의 `status`, `page`, `detail`을 보존하고 새 화면의 기존 조회·쓰기 조건을 적용한다. [룸 URL 상태](../../src/features/rooms/RoomPages.tsx#L21-L58) |
| `/app/:scope/settings?branchSearch=…&branchPage=…` | 명시된 운영 탭이 없고 지점 검색·페이지 조건이 있으면 동일 `:scope`의 `/branches`로 히스토리를 교체하고 지점 조건을 보존한다. 운영 탭이 명시된 링크에서는 해당 탭의 조건만 전달한다. [지점 URL 상태](../../src/features/organization/BranchManagement.tsx#L44-L51) · [목록 검색 규칙](../../src/features/organization/shared.tsx#L114-L133) |

## 사용자 확인 항목

1. **개인 설정 진입**을 사용자 메뉴 하나로 둘지(A), 데스크톱 빠른 탐색 아이콘도 남길지(C).
2. **지점 관리**를 매장 운영에 두고 직원의 운영 정보·휴무일 조회를 유지할지.
3. **스터디룸**을 공간 관리의 기존 탭 하나로 통합하고 현재 등록·수정 권한을 적용할지.
4. **변경 이력**을 OWNER 전용 운영 관리 메뉴(A)에 둘지, 지점 관리의 OWNER 전용 탭(B)으로 둘지.
5. **알림 범위** 안내 카드를 제거하고 **데모·검증 도구**를 MOCK 사용자 메뉴로 옮길지.
6. **기존 주소**의 탭·필터·상세 호환을 위 표대로 적용할지.

## 후속 구현

사용자 결정 뒤 [#111](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/111)의 작업 범위와 인수 조건을 대조한다. 개인 설정 진입 정리, 안내 카드·MOCK 도구 처리, 직원 지점 조회 보존 및 감사·스터디룸·지점 주소 호환은 확정안에 따라 이슈에 명시할 후보 항목이다. 이슈 본문 수정은 사용자 확인 뒤 진행한다.
