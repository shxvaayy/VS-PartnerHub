import { useId } from "react";
import { brandColors, brandPaths } from "../../shared/brand";

export function BrandMark({
  light = false,
  className = "brand-mark",
}: {
  light?: boolean;
  className?: string;
}) {
  const id = `vs-mark-${useId().replace(/:/g, "")}`;
  const color = light ? brandColors.light : brandColors.dark;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={color.start} />
          <stop offset="1" stopColor={color.end} />
        </linearGradient>
      </defs>
      <path
        d={brandPaths.tile}
        fill={`url(#${id})`}
        stroke={color.edge}
        strokeOpacity=".28"
      />
      <path
        d="M6 18A12 12 0 0 1 18 6h28"
        fill="none"
        stroke={color.edge}
        strokeOpacity=".22"
      />
      <path d={brandPaths.s} fill={color.s} />
      <path d={brandPaths.v} fill={color.v} />
      <path
        d="M42 56h5a9 9 0 0 0 9-9v-5"
        fill="none"
        stroke={color.edge}
        strokeOpacity=".32"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandLoader() {
  return (
    <span className="brand-loader" aria-hidden="true">
      <svg className="brand-loader-ring" viewBox="0 0 80 80">
        <circle className="brand-loader-track" cx="40" cy="40" r="34" />
        <circle className="brand-loader-inner" cx="40" cy="40" r="28" />
        <circle
          className="brand-loader-orbit"
          cx="40"
          cy="40"
          r="34"
          pathLength="100"
        />
      </svg>
      <BrandMark className="brand-loader-logo" />
    </span>
  );
}
