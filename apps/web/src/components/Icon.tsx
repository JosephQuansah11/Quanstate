import type { SVGProps } from "react";

type IconName =
  | "mic" | "stop" | "swap" | "settings" | "translate" | "learn" | "play"
  | "arrow" | "check" | "book" | "globe" | "bolt" | "close" | "search" | "wave" | "chevron" | "waveform";

const PATHS: Record<IconName, string> = {
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm7 9a7 7 0 0 1-6 6.92V22h-2v-3.08A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0h2Z",
  stop: "M7 7h10v10H7z",
  swap: "M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5c0 .5-.05 1-.15 1.47l2.02 1.58-2 3.46-2.4-.95c-.74.64-1.6 1.14-2.55 1.44L14.5 22h-4l-.42-2.5a8.6 8.6 0 0 1-2.55-1.44l-2.4.95-2-3.46 2.02-1.58a8.8 8.8 0 0 1 0-2.94L3.13 9.45l2-3.46 2.4.95c.74-.64 1.6-1.14 2.55-1.44L10.5 3h4l.42 2.5c.95.3 1.81.8 2.55 1.44l2.4-.95 2 3.46-2.02 1.58c.1.47.15.97.15 1.47Z",
  translate: "M4 5h8M8 3v2c0 3.5-2 6.5-5 8m2-5c0 2.5 2.5 4.5 6 5m3-3-5 12m0 0-4-9m4 9h8m-2-5 3 7",
  learn: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Zm0 0v16M8 7h8M8 11h6",
  play: "M8 5v14l11-7-11-7Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m6 9 6 6 6-6",
  waveform: "M3 12h2l2-5 3 14 3-16 3 12 2-5h3",
  check: "m5 13 4 4L19 7",
  book: "M6 3h9l5 5v13H6V3Zm9 0v6h5M9 13h6M9 17h6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5 0 4.5-4 4.5-9S14.5 3 12 3 7.5 7 7.5 12s2 9 4.5 9ZM3.5 9h17M3.5 15h17",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  close: "M6 6l12 12M18 6 6 18",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5",
  wave: "M4 12h2m2-4v8m3-12v16m3-10v4m3-8v12m3-6h2",
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
