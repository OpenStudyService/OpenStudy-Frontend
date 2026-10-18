const paths: Record<string, string> = {
  logo: "M4 5v15l8-3 8 3V5l-8-2-8 2Zm8-2v14",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  tasks: "M9 5h11v16H4V5h3m2-2h6v4H9V3Zm-2 9 2 2 4-4m2 3h3M7 18h11",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5ZM7 9h10M7 13h6",
  members:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 8",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 10h2m4 0h2m-8 4h2m4 0h2",
  seats:
    "M5 11V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M3 10v7h18v-7M5 17v4m14-4v4M3 13h18",
  facility:
    "m14 6 4 4m-2-7a6 6 0 0 0-7 8L3 17a2.8 2.8 0 0 0 4 4l6-6a6 6 0 0 0 8-7l-4 4-5-5 4-4Z",
  inquiry:
    "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  notice: "m3 11 16-7v16L3 14v-3Zm4 4 2 6h3l-2-5M21 8v7",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  settings:
    "m9 3-1 3-3 1 1 4-2 2 3 3 3-1 3 2 3-2 3 1 2-3-2-3 1-3-3-1-1-3H9Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  leaf: "M20 3C8 2 3 8 6 16c5 5 15 0 14-13ZM4 21 16 9",
  search: "m21 21-5-5m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 5 7 7-7 7",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  check: "m5 12 4 4L19 6",
  send: "m22 2-7 20-4-9L2 9l20-7ZM11 13 22 2",
  logout: "M9 4H4v16h5m4-13 5 5-5 5m-4-5h12",
  money: "M3 5h18v14H3V5Zm4 4h.01M17 15h.01M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  ai: "m12 3 2 6 6 3-6 2-2 7-2-7-7-2 7-3 2-6Zm8 0v4m-2-2h4",
  info: "M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  eye: "M2 12c5-9 15-9 20 0-5 9-15 9-20 0Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
};
export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.info} />
    </svg>
  );
}
