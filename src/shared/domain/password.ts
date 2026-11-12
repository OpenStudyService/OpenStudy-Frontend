export const newPasswordRequirements =
  "영문, 숫자, 특수문자를 각각 하나 이상 포함해 8자 이상 입력해 주세요.";

export function newPasswordError(value: string) {
  if (new TextEncoder().encode(value).length > 72)
    return "비밀번호는 UTF-8 기준 72바이트 이하로 입력해 주세요.";
  // ASCII punctuation and symbols, matching the server's POSIX Punct class.
  if (
    Array.from(value).length < 8 ||
    !/[A-Za-z]/.test(value) ||
    !/[0-9]/.test(value) ||
    !/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(value)
  )
    return newPasswordRequirements;
}
