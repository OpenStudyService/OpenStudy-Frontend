// Local SVG from the approved mockup; no external image dependency.
export function RoomArt() {
  return (
    <svg
      className="room-art"
      viewBox="0 0 520 310"
      role="img"
      aria-label="책과 식물이 놓인 햇살 가득한 스터디카페"
    >
      <defs>
        <pattern
          id="room-grid"
          width="27"
          height="27"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M27 0H0v27"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".05"
          />
        </pattern>
      </defs>
      <path fill="url(#room-grid)" d="M0 0h520v310H0z" />
      <path d="M30 260h460" stroke="currentColor" strokeOpacity=".2" />
      <rect
        x="135"
        y="18"
        width="228"
        height="163"
        rx="112"
        fill="var(--surface)"
        fillOpacity=".7"
      />
      <path
        d="M135 177V94a114 100 0 0 1 228 0v83M249 20v158M136 106h226"
        fill="none"
        stroke="currentColor"
        strokeOpacity=".22"
        strokeWidth="3"
      />
      <path d="m270 108-40 70h57l42-70" fill="var(--accent)" fillOpacity=".5" />
      <path
        d="m212 145-20 33h29l20-33"
        fill="var(--accent)"
        fillOpacity=".35"
      />
      <rect
        x="99"
        y="178"
        width="303"
        height="12"
        rx="4"
        fill="currentColor"
        opacity=".6"
      />
      <path
        d="M118 190v69m264-69v69"
        stroke="currentColor"
        strokeWidth="8"
        opacity=".4"
      />
      <rect
        x="232"
        y="139"
        width="85"
        height="40"
        rx="4"
        fill="var(--primary)"
      />
      <path d="m232 177-8 5h102l-9-5" fill="var(--rail)" />
      <rect x="239" y="145" width="71" height="27" rx="1" fill="var(--soft)" />
      <path
        d="m253 153 6 5-6 5m15 0h15"
        stroke="var(--primary)"
        fill="none"
        strokeWidth="2"
      />
      <rect x="153" y="166" width="42" height="7" rx="1" fill="#c6b18d" />
      <rect x="160" y="159" width="40" height="7" rx="1" fill="var(--accent)" />
      <rect
        x="152"
        y="173"
        width="49"
        height="5"
        rx="1"
        fill="var(--primary)"
        opacity=".5"
      />
      <path
        d="M345 163h18v15h-18zm18 3c10-2 10 10 0 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity=".7"
      />
      <path
        d="M343 153c-3-4 4-5 1-9m8 9c-3-4 4-5 1-9"
        stroke="currentColor"
        strokeOpacity=".35"
        fill="none"
      />
      <rect
        x="222"
        y="199"
        width="65"
        height="37"
        rx="12"
        fill="var(--accent)"
      />
      <path
        d="m228 234-5 26m57-26 5 26"
        stroke="currentColor"
        strokeWidth="4"
        opacity=".4"
      />
      <path
        d="M65 244c0-47 6-72 2-108m0 52c-22-3-29-17-29-31 25 1 28 14 29 31Zm1-24c21-2 33-20 31-34-23 5-29 17-31 34Zm0-20c-20-8-21-22-16-35 16 10 18 24 16 35Zm-1 65c-21-2-32-15-33-28 25 0 33 13 33 28Zm1 15c22-5 35-18 32-34-25 6-29 21-32 34Z"
        fill="var(--primary)"
        fillOpacity=".65"
        stroke="currentColor"
        strokeOpacity=".3"
      />
      <path d="M45 231h42l-7 29H52Z" fill="#c7b294" />
      <path
        d="M423 246v-39m0 16c-16-2-22-12-23-22 20 1 23 13 23 22Zm0-11c16-3 19-13 18-21-15 2-18 13-18 21Z"
        fill="var(--primary)"
        opacity=".55"
      />
      <path d="M408 239h30l-5 21h-20Z" fill="var(--accent)" />
      <circle cx="416" cy="65" r="20" fill="var(--accent)" opacity=".5" />
      <path
        d="M416 53v13l8 5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        opacity=".6"
      />
    </svg>
  );
}
