/** Shared display rules. Ratios use percentage points (12.5 means 12.5%). */
const numbers = new Intl.NumberFormat("ko-KR");
const signedNumbers = new Intl.NumberFormat("ko-KR", {
  signDisplay: "exceptZero",
});
const dateOptions = {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
} as const;
const shortDateTime = new Intl.DateTimeFormat("ko-KR", dateOptions);
const fullDateTime = new Intl.DateTimeFormat("ko-KR", {
  ...dateOptions,
  year: "numeric",
  second: "2-digit",
});
const businessDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
});

export function formatNumber(
  value: number | bigint | null | undefined,
  signed = false,
) {
  return typeof value === "bigint" ||
    (typeof value === "number" && Number.isFinite(value))
    ? (signed ? signedNumbers : numbers).format(value)
    : "—";
}

export function formatKrw(
  value: number | bigint | null | undefined,
  signed = false,
) {
  const number = formatNumber(value, signed);
  return number === "—" ? number : `${number}원`;
}

export function formatPhone(phone: string) {
  if (phone.startsWith("02")) {
    return phone.replace(/^(02)(\d{3,4})(\d{4})$/, "$1-$2-$3");
  }
  if (phone.startsWith("050")) {
    return phone.replace(/^(050\d)(\d{3,4})(\d{4})$/, "$1-$2-$3");
  }
  return phone.replace(/^(0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");
}

export function formatPercent(rate: number | null | undefined, digits = 1) {
  if (rate === null) return "해당 없음";
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "—";
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rate)}%`;
}

function parsedDate(iso: string | null | undefined) {
  if (!iso?.trim()) return undefined;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function formatDateTime(iso: string | null | undefined) {
  const date = parsedDate(iso);
  return date ? fullDateTime.format(date) : "—";
}

export function formatShortDateTime(iso: string | null | undefined) {
  const date = parsedDate(iso);
  return date ? shortDateTime.format(date) : "—";
}

export function formatBusinessDate(iso: string | null | undefined) {
  const date = parsedDate(iso);
  return date ? businessDay.format(date) : "—";
}
