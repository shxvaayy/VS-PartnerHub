import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

export default function ActionMenu({
  label,
  icon,
  items,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  items: { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"first" | "last" | null>(null);
  const id = useId();
  const buttons = () => [
    ...(panel.current?.querySelectorAll<HTMLButtonElement>("button") || []),
  ];
  const close = (restoreFocus = false) => {
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  const show = (focus: "first" | "last") => {
    if (open) {
      const options = buttons();
      (focus === "first" ? options[0] : options.at(-1))?.focus();
    } else {
      initialFocus.current = focus;
      setOpen(true);
    }
  };

  useLayoutEffect(() => {
    if (!open || !panel.current || !trigger.current || !root.current) return;
    const position = () => {
      const popup = panel.current;
      if (!popup || !trigger.current || !root.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const parent = root.current.getBoundingClientRect();
      const margin = 12,
        gap = 7;
      const width = Math.min(
        Math.max(205, anchor.width),
        document.documentElement.clientWidth - margin * 2,
      );
      popup.style.width = `${width}px`;
      popup.style.minWidth = "0";
      const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
      const topInset = Math.max(margin, (topbar?.bottom || 0) + 8);
      const bottomSpace = innerHeight - anchor.bottom - gap - margin;
      const topSpace = anchor.top - gap - topInset;
      const fullHeight = popup.scrollHeight + 2;
      const above =
        bottomSpace < Math.min(fullHeight, 180) && topSpace > bottomSpace;
      const height = Math.floor(
        Math.min(fullHeight, Math.max(44, above ? topSpace : bottomSpace)),
      );
      const left = Math.max(
        margin,
        Math.min(
          anchor.right - width,
          document.documentElement.clientWidth - width - margin,
        ),
      );
      const top = Math.max(
        topInset,
        Math.min(
          above ? anchor.top - gap - height : anchor.bottom + gap,
          innerHeight - height - margin,
        ),
      );
      popup.style.left = `${left - parent.left}px`;
      popup.style.right = "auto";
      popup.style.top = `${top - parent.top}px`;
      popup.style.maxHeight = `${height}px`;
      popup.style.transformOrigin = above ? "bottom right" : "top right";
    };
    position();
    const options = buttons();
    if (initialFocus.current)
      (initialFocus.current === "first" ? options[0] : options.at(-1))?.focus({
        preventScroll: true,
      });
    initialFocus.current = null;
    const scroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      const anchor = trigger.current?.getBoundingClientRect();
      const header = document.querySelector(".topbar")?.getBoundingClientRect();
      if (
        !anchor ||
        anchor.bottom <= (header?.bottom || 0) ||
        anchor.top >= innerHeight
      ) {
        close(Boolean(panel.current?.contains(document.activeElement)));
        return;
      }
      // Scrolling a trigger into view can finish after its click. Reposition
      // the open options instead of immediately dismissing the user's action.
      position();
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = buttons();
    if (!options.length) return;
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length;
    options[next]?.focus();
  };

  if (!items.length) return null;
  return (
    <details
      className="action-menu"
      ref={root}
      open={open}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget &&
          !root.current?.contains(event.relatedTarget as Node)
        )
          close();
      }}
    >
      <summary
        id={`${id}-trigger`}
        ref={trigger}
        className="button button-primary"
        aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          initialFocus.current = null;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      >
        {icon}
        {label}
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      {open && (
        <div
          id={`${id}-options`}
          ref={panel}
          className="action-menu-panel"
          role="group"
          aria-labelledby={`${id}-trigger`}
          onKeyDown={navigate}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                close(true);
                onSelect(item.value);
              }}
            >
              <span>{item.label}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </details>
  );
}
