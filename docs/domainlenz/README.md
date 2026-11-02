# OpenStudy × DomainLenz 개발자 전달 패키지

OpenStudy 채널에서 자연어 조회 결과를 어떤 화면으로 보여주고 싶은지 설명하는 **프론트 시뮬레이션**이다. 실제 DomainLenz·OpenAI·DB를 호출하거나 업무 데이터를 수정하지 않는다. 13개 업무군의 정상 질문 26개와 상태·예외 질문 8개를 제공한다.

## 바로 시연하기

**[단독 HTML 열기](./OpenStudy_DomainLenz_Demo.html)** — 파일을 다운로드한 뒤 Chrome/Edge에서 연다. 인터넷·서버·로그인이 필요 없다. 모든 스크립트·스타일·데이터가 파일에 포함된다.

1. `전체-공지` 채널에서 **AI 질문 → 결제·환불·매출 → 지난달 지점별 순매출**을 선택한다.
2. 보내기를 누르고 개인 결과의 KPI·차트·표를 확인한다.
3. 상세와 개발자 보기를 열어 화면과 조회 명세의 연결을 확인한다.
4. 채널에 공유한 뒤 ‘강남점만 보기’를 누른다. 기존 공유 카드는 전체 지점 결과를 유지한다.
5. 회원 목록 페이지, 예약 일정, 시설 점검, 상태·예외 예문을 확인한다.
6. 시연 사용자를 직원으로 변경해 공유 결과의 열람 제한을 확인한다.

프로젝트 채팅에서 확인하려면 프론트 저장소 루트에서 다음을 실행한다.

```sh
npm ci
npm run dev
```

`사장님으로 체험` → 팀 채팅 → 전체-공지로 이동한다. AI 질문 버튼은 **mock 모드의 일반 채널에만** 나타난다. 일반 메시지·DM·스레드의 기존 전송 동작은 유지한다. 실제 API 모드에는 데모 코드·데이터가 포함되지 않는다.

## 전달 자료

- [DB 도메인 사전·관계도](./domain-catalog.md): 실제 테이블·필드·관계, 권한, 원본 API 준비 상태
- [자연어 질문과 시연 순서](./test-cases.md)
- [기대값을 포함한 테스트셋 JSON](./natural-language-tests.json)
- [커밋된 DDL·OpenAPI 확인 결과](./schema-evidence.json)
- [연동 계약과 남은 결정](./integration-contract.md)
- [대표 화면](./screenshots/): 채팅 결과·예문·모바일 화면

## 재생성

```sh
npm run build:domainlenz
```

동일한 `src/mocks/domainlenz/` 시나리오와 React 렌더러에서 HTML과 전달 JSON·문서를 생성한다. 백엔드 저장소가 있는 환경에서는 **커밋된** 마이그레이션의 모든 참조 컬럼을 확인한다. 다른 위치라면 `DOMAINLENZ_BACKEND_ROOT`로 지정한다. 프론트만 받은 환경에서는 함께 제공된 스키마 확인 자료를 재사용하며 재검증으로 기록하지 않는다.

검증 명령은 다음과 같다. 브라우저 검증은 전용 5186 포트를 사용하며 로컬 Chrome이 필요하다(CI에서는 Playwright Chromium).

```sh
npm run check
npm run test:e2e:domainlenz
npm run test:builds
```

## 시연 기준과 한계

- 기준 시각: **2026-10-17 11:00 Asia/Seoul**. 실제 현재 날짜와 다르며, ‘오늘·지난달’은 이 시각 기준이다.
- 수치는 서로 일치하도록 구성한 고정 가상 데이터다. 다른 탭의 Mock 원장 및 실제 DB와 동기화하지 않는다.
- 자유 자연어 해석을 하지 않는다. 준비된 문장과 접두사·공백·끝 구두점 변형만 지원한다.
- 개인 질의는 다른 시연 사용자에게 보이지 않는다. 공유는 현재 문서 메모리의 읽기 전용 스냅샷이며 새로고침하면 사라진다. 다른 브라우저·서버로 전달하지 않는다.
- 이름은 가상·마스킹 값이며 연락처, 개인 사유, 토큰·감사 원문 JSON을 포함하지 않는다.
- 권한 검사는 화면 동작 시뮬레이션이다. 실제 채널 공유·동적 열람 권한과 보관 정책은 서버 연동 시 확정해야 한다.
- CSV 내보내기·업무 쓰기·임의 자연어 후속 질문·실제 엔진 성능 측정은 이번 범위에 포함하지 않는다.

이번 산출물은 [Backend #92 계약](https://github.com/OpenStudyService/OpenStudy-Backend/issues/92), [Backend #97 실제 엔진 연동](https://github.com/OpenStudyService/OpenStudy-Backend/issues/97), [Frontend #32 실제 분석 연결](https://github.com/OpenStudyService/OpenStudy-Frontend/issues/32)의 검토 자료다. 이 이슈들의 인수 조건이 완료되었다는 의미는 아니다.
