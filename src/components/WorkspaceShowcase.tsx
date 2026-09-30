import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  LockKeyhole,
} from "lucide-react";
import {
  organizationLabels,
  organizationTypes,
  type OrganizationType,
} from "../../shared/domain";
import { organizationIcons } from "./icons";

type Workspace = {
  heading: string;
  copy: string;
  features: string[];
  journey: string[];
};

export function WorkspaceShowcase({
  workspaces,
}: {
  workspaces: Record<OrganizationType, Workspace>;
}) {
  const track = useRef<HTMLDivElement>(null);
  const presentation = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const geometry = useRef({
    enabled: false,
    start: 0,
    distance: 0,
    step: 0,
    leading: 0,
  });
  const active = useRef(0);
  const pending = useRef<number | null>(null);
  const resume = useRef<() => void>(() => {});
  const [{ index, direction }, setSelection] = useState({
    index: 0,
    direction: 1,
  });
  const [pinned, setPinned] = useState(false);

  function activate(next: number) {
    if (active.current === next) return;
    const previous = active.current;
    active.current = next;
    // Keep keyboard focus on an available control when its panel changes.
    const panel = document.getElementById(
      `workspace-panel-${organizationTypes[previous]}`,
    );
    if (panel?.contains(document.activeElement)) {
      document
        .getElementById(`workspace-tab-${organizationTypes[next]}`)
        ?.focus({ preventScroll: true });
    }
    setSelection({ index: next, direction: next > previous ? 1 : -1 });
  }

  useEffect(() => {
    const container = track.current;
    const group = presentation.current;
    const heading = intro.current;
    const card = stage.current;
    if (!container || !group || !heading || !card) return;
    const header = document.querySelector<HTMLElement>(".public-header");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let resizeFrame = 0;
    let settleTimer = 0;

    function update() {
      frame = 0;
      const current = geometry.current;
      if (!current.enabled || !container || !group || !card) return;
      const top = Number.parseFloat(
        group.style.getPropertyValue("--workspace-top"),
      );
      current.start =
        window.scrollY +
        container.getBoundingClientRect().top +
        current.leading -
        top;
      const progress = Math.max(
        0,
        Math.min(1, (window.scrollY - current.start) / current.distance),
      );
      card.style.setProperty("--workspace-progress", String(progress));
      if (pending.current !== null) return;
      activate(
        Math.min(
          organizationTypes.length - 1,
          Math.floor(progress * organizationTypes.length),
        ),
      );
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    function releaseSelection() {
      window.clearTimeout(settleTimer);
      pending.current = null;
      schedule();
    }
    function onScroll() {
      schedule();
      if (pending.current !== null) {
        window.clearTimeout(settleTimer);
        // Native scrollend handles current browsers; this also supports older ones.
        settleTimer = window.setTimeout(releaseSelection, 180);
      }
    }
    function measure() {
      resizeFrame = 0;
      if (!container || !group || !heading || !card) return;
      const previous = geometry.current;
      const wasInside =
        previous.enabled &&
        window.scrollY >= previous.start &&
        window.scrollY <= previous.start + previous.distance;
      const previousProgress = wasInside
        ? (window.scrollY - previous.start) / previous.distance
        : 0;
      const headerHeight = header?.getBoundingClientRect().height || 80;
      // The small viewport stays stable when a phone's browser controls collapse.
      // Recalculating the tour from innerHeight on every such resize causes jumps.
      const viewportHeight =
        Number.parseFloat(getComputedStyle(container, "::before").height) ||
        window.innerHeight;
      const bounds = container.getBoundingClientRect();
      const wasVisible =
        bounds.bottom > headerHeight && bounds.top < viewportHeight;
      const mobile = window.matchMedia("(max-width: 800px)").matches;
      container.dataset.density =
        mobile && viewportHeight <= 620
          ? "tight"
          : (mobile && viewportHeight <= 700) ||
              (!mobile && viewportHeight <= 850)
            ? "compact"
            : "comfortable";
      // Desktop pins the heading and card as one presentation. On a phone,
      // preserve the compact card's full touch area below the section heading.
      const content = mobile ? card : group;
      const leading = mobile
        ? heading.offsetHeight +
          Number.parseFloat(getComputedStyle(heading).marginBottom)
        : 0;
      const height = content.offsetHeight;
      const top =
        headerHeight +
        Math.max(mobile ? 8 : 12, (viewportHeight - headerHeight - height) / 2);
      // Portrait phones use the compact card. Retain readable, unpinned tabs
      // only when zoom, landscape, or enlarged text leaves insufficient space.
      const enabled = !motion.matches && height + top + 12 <= viewportHeight;
      const step = mobile
        ? Math.max(180, Math.min(320, viewportHeight * 0.36))
        : Math.max(280, Math.min(520, viewportHeight * 0.48));
      const distance = step * organizationTypes.length;
      group.style.setProperty("--workspace-top", `${top}px`);
      container.style.setProperty(
        "--workspace-stage-height",
        `${height + leading}px`,
      );
      container.style.setProperty("--workspace-distance", `${distance}px`);
      container.dataset.scroll = String(enabled);
      const start =
        window.scrollY + container.getBoundingClientRect().top + leading - top;
      geometry.current = { enabled, start, distance, step, leading };
      setPinned(enabled);
      if (
        wasInside &&
        enabled &&
        (Math.abs(previous.start - start) > 1 ||
          Math.abs(previous.distance - distance) > 1)
      ) {
        window.scrollTo({
          top: start + previousProgress * distance,
          behavior: "instant",
        });
      } else if (wasInside && !enabled) {
        window.scrollTo({ top: start, behavior: "instant" });
      } else if (
        !previous.enabled &&
        previous.distance > 0 &&
        enabled &&
        wasVisible
      ) {
        // Returning from landscape or enlarged text keeps the chosen workspace.
        window.scrollTo({
          top: start + (active.current + 0.25) * step,
          behavior: "instant",
        });
      }
      update();
    }
    function scheduleMeasure() {
      if (!resizeFrame) resizeFrame = window.requestAnimationFrame(measure);
    }
    function interrupt(event: Event) {
      if (event.defaultPrevented) return;
      if (
        event instanceof globalThis.KeyboardEvent &&
        ![
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        return;
      releaseSelection();
    }
    resume.current = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(releaseSelection, 250);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(group);
    observer.observe(heading);
    observer.observe(card);
    if (header) observer.observe(header);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", releaseSelection);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("keydown", interrupt);
    motion.addEventListener("change", scheduleMeasure);
    measure();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(resizeFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", releaseSelection);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("keydown", interrupt);
      motion.removeEventListener("change", scheduleMeasure);
      resume.current = () => {};
    };
  }, []);

  useEffect(() => {
    const strip = tabs.current;
    const button = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !button) return;
    function center(behavior: ScrollBehavior) {
      if (!strip || !button || strip.scrollWidth <= strip.clientWidth) return;
      const left =
        button.getBoundingClientRect().left -
        strip.getBoundingClientRect().left +
        strip.scrollLeft -
        (strip.clientWidth - button.offsetWidth) / 2;
      strip.scrollTo({ left, behavior });
    }
    center(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    );
    let width = strip.clientWidth;
    const observer = new ResizeObserver(() => {
      if (strip.clientWidth === width) return;
      width = strip.clientWidth;
      center("instant");
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [index]);

  function select(next: number) {
    activate(next);
    const current = geometry.current;
    if (!current.enabled) return;
    pending.current = next;
    resume.current();
    window.scrollTo({
      top: current.start + (next + 0.25) * current.step,
      behavior: "smooth",
    });
  }
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (current < 0) return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[next].focus({ preventScroll: true });
    select(next);
  }

  return (
    <section
      className="hub-section hub-workspaces"
      id="workspaces"
      aria-labelledby="workspace-heading"
    >
      <div className="hub-workspace-track" ref={track}>
        <div className="hub-workspace-presentation" ref={presentation}>
          <div className="hub-section-heading" ref={intro}>
            <div>
              <span className="hub-eyebrow">YOUR ROLE. YOUR WORKSPACE.</span>
              <h2 id="workspace-heading">
                A shared platform.
                <br />A space that feels like yours.
              </h2>
            </div>
            <p>
              Different businesses need different tools. Explore the workspace
              that fits the way you work.
            </p>
          </div>
          <div
            className="hub-workspace-stage"
            ref={stage}
            data-direction={direction > 0 ? "forward" : "backward"}
          >
            <div
              className="hub-workspace-tabs"
              ref={tabs}
              role="tablist"
              onKeyDown={onTabKey}
              aria-label="Organization workspaces"
            >
              {organizationTypes.map((type, i) => (
                <button
                  key={type}
                  type="button"
                  id={`workspace-tab-${type}`}
                  role="tab"
                  aria-controls={`workspace-panel-${type}`}
                  tabIndex={index === i ? 0 : -1}
                  aria-selected={index === i}
                  onClick={() => select(i)}
                >
                  {organizationLabels[type]}
                  <span className="hub-workspace-tab-line" aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="hub-workspace-panels">
              {organizationTypes.map((type, i) => {
                const selected = workspaces[type];
                const Icon = organizationIcons[type];
                const current = index === i;
                return (
                  <div
                    key={type}
                    className={`hub-workspace-panel${current ? " is-active" : ""}`}
                    role="tabpanel"
                    tabIndex={current ? 0 : -1}
                    id={`workspace-panel-${type}`}
                    aria-labelledby={`workspace-tab-${type}`}
                    aria-hidden={!current}
                    inert={!current}
                  >
                    <div className="hub-workspace-copy">
                      <span className="hub-workspace-type">
                        <Icon size={20} />
                        {organizationLabels[type]}
                      </span>
                      <h3>{selected.heading}</h3>
                      <p className="hub-workspace-description">
                        {selected.copy}
                      </p>
                      <ul>
                        {selected.features.map((feature) => (
                          <li key={feature}>
                            <Check size={17} />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <Link
                        className="button button-primary"
                        to={`/register?type=${type}`}
                      >
                        Get started as{" "}
                        {type === "client"
                          ? "a buyer"
                          : type === "other"
                            ? "a partner"
                            : `a ${organizationLabels[type].toLowerCase()}`}
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                    <div className="hub-workspace-journey">
                      <span>FROM FIRST STEP TO WHAT’S NEXT</span>
                      {selected.journey.map((title, step) => (
                        <div
                          key={title}
                          style={{ "--workspace-step": step } as CSSProperties}
                        >
                          <span>{String(step + 1).padStart(2, "0")}</span>
                          <strong>{title}</strong>
                          {step === selected.journey.length - 1 ? (
                            <CircleCheck size={21} />
                          ) : (
                            <ArrowRight size={19} />
                          )}
                        </div>
                      ))}
                      <p>
                        <LockKeyhole size={15} />
                        Your records. Your team. The right access.
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hub-workspace-scroll-footer">
              <span className="hub-workspace-position" aria-hidden="true">
                <strong>{String(index + 1).padStart(2, "0")}</strong> /{" "}
                {String(organizationTypes.length).padStart(2, "0")}
              </span>
              <div className="hub-workspace-progress" aria-hidden="true">
                <span
                  style={
                    pinned
                      ? undefined
                      : {
                          transform: `scaleX(${(index + 1) / organizationTypes.length})`,
                        }
                  }
                />
              </div>
              {pinned && (
                <span className="hub-workspace-scroll-hint">
                  <ArrowDown size={13} />
                  {index === organizationTypes.length - 1
                    ? "Keep exploring"
                    : "Scroll to explore"}
                </span>
              )}
              <a href="#lifecycle" aria-label="Explore the full workflow">
                <span className="hub-workspace-skip-desktop">
                  Explore the full workflow
                </span>
                <span className="hub-workspace-skip-mobile">Full workflow</span>
                <ArrowDown size={14} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
