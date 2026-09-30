import { BrandMark } from "./BrandMark";

export function VsAiMark({
  hero = false,
  active = false,
}: {
  hero?: boolean;
  active?: boolean;
}) {
  return (
    <span
      className={`vs-ai-mark ${hero ? "vs-ai-mark-hero" : ""} ${active ? "vs-ai-mark-active" : ""}`}
      aria-hidden="true"
    >
      <span className="vs-ai-halo" />
      <BrandMark className="vs-ai-monogram" />
      <span className="vs-ai-spark">
        <svg viewBox="0 0 20 20">
          <path
            d="M10 1.5 12.4 7.6 18.5 10 12.4 12.4 10 18.5 7.6 12.4 1.5 10 7.6 7.6Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </span>
  );
}
