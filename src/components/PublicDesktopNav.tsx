import { useEffect, useRef, useState } from "react";
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

export function PublicDesktopNav() {
  const [open, setOpen] = useState<"platform" | "workspaces" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(null), [location.pathname, location.hash]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const media = window.matchMedia("(max-width: 800px)");
    const resize = () => {
      if (media.matches) setOpen(null);
    };
    document.addEventListener("pointerdown", close);
    media.addEventListener("change", resize);
    return () => {
      document.removeEventListener("pointerdown", close);
      media.removeEventListener("change", resize);
    };
  }, [open]);

  return (
    <div
      className="hub-nav-links"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        root.current
          ?.querySelector<HTMLButtonElement>(`#public-${open}-trigger`)
          ?.focus();
        setOpen(null);
      }}
    >
      {(["platform", "workspaces"] as const).map((item) => (
        <div className="hub-nav-disclosure" key={item}>
          <button
            id={`public-${item}-trigger`}
            className="hub-nav-trigger"
            type="button"
            tabIndex={0}
            aria-expanded={open === item}
            aria-controls={`public-${item}-panel`}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              setOpen(open === item ? null : item);
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
                onClick={() => setOpen(null)}
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
                    <a
                      tabIndex={0}
                      href={href}
                      key={href}
                      onClick={() => setOpen(null)}
                    >
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
                        onClick={() => setOpen(null)}
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
