import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  Layers3,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { organizationLabels, organizationTypes } from "../../shared/domain";
import { organizationIcons } from "./icons";

const platformLinks = [
  {
    href: "/#platform",
    title: "Platform overview",
    detail: "One connected business platform",
    Icon: Layers3,
  },
  {
    href: "/#lifecycle",
    title: "Procurement lifecycle",
    detail: "From requirement to payment",
    Icon: GitCompareArrows,
  },
  {
    href: "/#intelligence",
    title: "VS AI",
    detail: "Intelligence for everyday work",
    Icon: Sparkles,
  },
  {
    href: "/#trust",
    title: "Trust & governance",
    detail: "Identity, access and accountability",
    Icon: ShieldCheck,
  },
];

type MenuName = "platform" | "workspaces";

function canHover(event: PointerEvent) {
  return (
    event.pointerType === "mouse" &&
    window.matchMedia("(any-hover: hover) and (any-pointer: fine)").matches
  );
}

export function PublicDesktopNav() {
  const [open, setOpen] = useState<MenuName | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const interaction = useRef<"hover" | "click" | "keyboard" | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const focusFrame = useRef<number | undefined>(undefined);
  const location = useLocation();

  const cancelPending = useCallback(() => {
    clearTimeout(enterTimer.current);
    clearTimeout(leaveTimer.current);
    if (focusFrame.current !== undefined)
      cancelAnimationFrame(focusFrame.current);
  }, []);
  const dismiss = useCallback(() => {
    cancelPending();
    interaction.current = null;
    setOpen(null);
  }, [cancelPending]);

  const enter = (item: MenuName, event: PointerEvent) => {
    if (!canHover(event)) return;
    cancelPending();
    // Pointer movement must not hide a link that a keyboard user is reading.
    const panel = root.current?.querySelector(".hub-nav-panel:not([hidden])");
    if (open === item || panel?.contains(document.activeElement)) return;
    enterTimer.current = setTimeout(() => {
      interaction.current = "hover";
      setOpen(item);
    }, 100);
  };
  const leave = (event: PointerEvent) => {
    if (!canHover(event)) return;
    cancelPending();
    // The small grace period also covers diagonal movement into the panel.
    leaveTimer.current = setTimeout(() => {
      const panel = root.current?.querySelector(".hub-nav-panel:not([hidden])");
      if (
        panel?.contains(document.activeElement) ||
        (interaction.current === "keyboard" &&
          root.current?.contains(document.activeElement))
      )
        return;
      dismiss();
    }, 220);
  };

  useEffect(() => dismiss(), [location.pathname, location.hash, dismiss]);
  useEffect(() => cancelPending, [cancelPending]);
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (open) {
        event.preventDefault();
        if (root.current?.contains(document.activeElement)) {
          root.current
            .querySelector<HTMLButtonElement>(`#public-${open}-trigger`)
            ?.focus();
        }
      }
      dismiss();
    };
    const media = window.matchMedia("(max-width: 1023px)");
    const resize = () => {
      if (media.matches) dismiss();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    media.addEventListener("change", resize);
    window.addEventListener("scroll", dismiss, { passive: true });
    resize();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      media.removeEventListener("change", resize);
      window.removeEventListener("scroll", dismiss);
    };
  }, [open, dismiss]);

  return (
    <div
      className="hub-nav-links"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}
      onKeyDown={(event) => {
        interaction.current = "keyboard";
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        root.current
          ?.querySelector<HTMLButtonElement>(`#public-${open}-trigger`)
          ?.focus();
        dismiss();
      }}
    >
      {(["platform", "workspaces"] as const).map((item) => (
        <div
          className="hub-nav-disclosure"
          key={item}
          onPointerEnter={(event) => enter(item, event)}
          onPointerLeave={leave}
        >
          <button
            id={`public-${item}-trigger`}
            className="hub-nav-trigger"
            type="button"
            tabIndex={0}
            aria-expanded={open === item}
            aria-controls={`public-${item}-panel`}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              cancelPending();
              if (open === item && interaction.current !== "hover") {
                dismiss();
              } else {
                interaction.current = event.detail === 0 ? "keyboard" : "click";
                setOpen(item);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              cancelPending();
              interaction.current = "keyboard";
              setOpen(item);
              const last = event.key === "ArrowUp";
              focusFrame.current = requestAnimationFrame(() => {
                const links = root.current?.querySelectorAll<HTMLAnchorElement>(
                  `#public-${item}-panel a`,
                );
                links?.[last ? links.length - 1 : 0]?.focus({
                  preventScroll: true,
                });
              });
            }}
          >
            {item === "platform" ? "Platform" : "Who it’s for"}
            <ChevronDown size={13} />
          </button>
          <div
            id={`public-${item}-panel`}
            className={`hub-nav-panel hub-nav-panel-${item}`}
            hidden={open !== item}
          >
            <div className="hub-nav-panel-body">
              <div className="hub-nav-panel-intro">
                <span className="hub-nav-panel-eyebrow">VS PARTNERHUB</span>
                <strong>
                  {item === "platform"
                    ? "Better together.\nBuilt for business."
                    : "Your business.\nYour workspace."}
                </strong>
                <p>
                  {item === "platform"
                    ? "Connect your partners, people and business operations in one place."
                    : "Purpose-built experiences, united by one organization identity."}
                </p>
                <a
                  tabIndex={0}
                  href={item === "platform" ? "/#platform" : "/#workspaces"}
                  onClick={dismiss}
                >
                  {item === "platform"
                    ? "Explore the platform"
                    : "Explore workspaces"}
                  <ArrowUpRight size={15} />
                </a>
              </div>
              <div className="hub-nav-panel-links">
                {item === "platform"
                  ? platformLinks.map(({ href, title, detail, Icon }) => (
                      <a tabIndex={0} href={href} key={href} onClick={dismiss}>
                        <span className="hub-nav-link-icon">
                          <Icon size={19} />
                        </span>
                        <span>
                          <strong>{title}</strong>
                          <small>{detail}</small>
                        </span>
                        <ChevronRight size={14} />
                      </a>
                    ))
                  : organizationTypes.map((type) => {
                      const Icon = organizationIcons[type];
                      return (
                        <Link
                          tabIndex={0}
                          key={type}
                          to={`/register?type=${type}`}
                          onClick={dismiss}
                        >
                          <span className="hub-nav-link-icon">
                            <Icon size={18} />
                          </span>
                          <strong>{organizationLabels[type]}</strong>
                          <ArrowUpRight size={13} />
                        </Link>
                      );
                    })}
              </div>
            </div>
          </div>
        </div>
      ))}
      <Link
        tabIndex={0}
        to="/partners"
        aria-current={
          location.pathname.startsWith("/partners") ? "page" : undefined
        }
      >
        Partner network
      </Link>
      <Link
        tabIndex={0}
        to="/contact"
        aria-current={location.pathname === "/contact" ? "page" : undefined}
      >
        Contact
      </Link>
    </div>
  );
}
