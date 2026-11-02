# 2026-11-02 대화상자 초기 포커스와 업무 입력 경합 수정

## 1. 배경 / 문제

[PR #59의 build 작업](https://github.com/OpenStudyService/OpenStudy-Frontend/actions/runs/41457345878/job/125317275370?pr=59)이 422개 테스트 중 업무 테스트 두 개에서 실패했다. 로그에서 생성 제목 `새 업무`가 `새`로, 편집 제목의 ` 유지` 추가 입력이 누락된 것을 확인했다. 사용자가 지적한 Panel 초기 포커스 코드를 graphify로 찾아 확인했다.

패널은 Radix의 `onOpenAutoFocus`를 막은 뒤 제목 포커스를 `requestAnimationFrame`으로 지연했다. 그 사이 입력에 포커스하고 타이핑이 시작되면 지연 콜백이 제목으로 포커스를 옮길 수 있다. 이는 CI의 입력 일부 누락 증상과 일치한다. 단순 테스트 제한 시간 증가는 이 실행 순서를 해결하지 않는다.

## 2. 검토한 선택지

사용자가 제안한 제목 포커스의 동기 이동을 적용하기로 했다. DOM이 준비된 Radix `onOpenAutoFocus`에서 이미 존재하는 제목을 바로 선택할 수 있으므로 별도의 프레임 대기가 필요하지 않다.

## 3. 결정 및 이유

main `2897b05`에서 `fix/panel-focus-race`를 만들었다. 초기 제목 포커스를 동기적으로 옮겨 이후 사용자의 입력과 경합하지 않게 한다. 접근성 제목 포커스, 트리거 저장, 닫은 뒤 포커스 복원은 유지한다. 기존 `.gitattributes`는 포함하지 않는다.

수정 전용 PR을 main 대상으로 준비하고 같은 수정 커밋을 #59 작업 브랜치에도 적용해 기존 실패 CI도 새 커밋으로 검증한다. main 직접 push·PR 병합·자동 병합은 수행하지 않는다.

## 4. 구현 내용

`src/shared/ui/primitives.tsx`의 `Panel.onOpenAutoFocus`에서 제목 포커스를 감싼 `requestAnimationFrame`만 제거했다. 입력 테스트를 기다리게 하거나 단언을 약화하지 않는다.

## 5. 검증 결과

검증 결과는 아래에 실행한 뒤 누적한다. 로컬 반복 성공은 모든 실행 환경에서 비결정적 문제가 절대 없다는 증명으로 간주하지 않는다.

## 6. 남은 작업 / 보류 사항

수정 전용 PR과 #59 새 커밋의 GitHub build 결과를 확인한다. PR 병합은 사용자가 수행한다.
- main 기준: `npx vitest run src/features/tasks/Tasks.test.tsx` 20개를 독립 프로세스로 10회 반복해 200개 실행 모두 통과했다. `npm run check`의 타입·린트·405개 테스트·메일 도구 9개·빌드 가드 19개도 통과했다. graphify 갱신과 diff 검사를 완료했다.
- PR #59 기준: 같은 수정 커밋을 적용한 뒤 업무 테스트 20개를 10회 반복해 모두 통과했다(추가 200개 실행). npm run check의 타입·린트·전체 422개 테스트·메일 도구 9개·빌드 가드 19개도 통과했다. 수정 전용 PR은 [#60](https://github.com/OpenStudyService/OpenStudy-Frontend/pull/60)이다. 두 브랜치의 초기 포커스 코드는 동일하다.
