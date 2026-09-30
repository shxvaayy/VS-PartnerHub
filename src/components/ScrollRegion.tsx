import type { HTMLAttributes } from "react";

export default function ScrollRegion({
  label,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div
      {...props}
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.target !== event.currentTarget ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        const element = event.currentTarget;
        const end = element.scrollWidth - element.clientWidth;
        if (end <= 0) return;
        const step = Math.max(40, Math.round(element.clientWidth / 5));
        const targets: Record<string, number> = {
          ArrowLeft: element.scrollLeft - step,
          ArrowRight: element.scrollLeft + step,
          Home: 0,
          End: end,
        };
        const next = targets[event.key];
        if (next === undefined) return;
        // Safari does not consistently scroll a focused overflow region with
        // arrow keys. Handle the region itself without taking keys from its controls.
        event.preventDefault();
        element.scrollLeft = Math.max(0, Math.min(end, next));
      }}
    />
  );
}
