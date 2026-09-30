import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  FileCheck2,
  FileText,
  GitCompareArrows,
  Handshake,
  LockKeyhole,
  Package,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UsersRound,
  Wallet,
  Workflow,
} from "lucide-react";
import { Logo } from "./ui";

const workflows = [
  {
    label: "Source & procure",
    Icon: Package,
    stages: [
      { title: "Requirement", Icon: FileText },
      { title: "Quotation", Icon: GitCompareArrows },
      { title: "Approved order", Icon: FileCheck2 },
    ],
    copy: "From a business need to an approved order. Every decision connected.",
  },
  {
    label: "Recruit & deploy",
    Icon: UsersRound,
    stages: [
      { title: "Hiring need", Icon: FileText },
      { title: "Candidate", Icon: UsersRound },
      { title: "Joining", Icon: UserCheck },
    ],
    copy: "Bring hiring teams and recruitment partners into one shared journey.",
  },
  {
    label: "Deliver & grow",
    Icon: Workflow,
    stages: [
      { title: "Agreement", Icon: Handshake },
      { title: "Milestone", Icon: FileCheck2 },
      { title: "Payment", Icon: Wallet },
    ],
    copy: "Keep delivery, milestones and payment visibility together.",
  },
];
const connections = [
  "M180 0V10Q180 20 170 20H70Q60 20 60 30V48",
  "M180 0V48",
  "M180 0V10Q180 20 190 20H290Q300 20 300 30V48",
];
const stepDuration = 2300;

/** An illustrative workflow, independent of customer records or AI requests. */
export function ConnectedWorkspace() {
  const root = useRef<HTMLDivElement>(null);
  const [{ track, step }, setPosition] = useState({ track: 0, step: 0 });
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const timerState = useRef({ key: "", remaining: stepDuration });
  const running = visible && !hidden && !reduced && !paused;

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(motion.matches);
    const updateVisibility = () => setHidden(document.hidden);
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(
      ([entry]) =>
        setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.25),
      { threshold: 0.25 },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    const key = `${track}-${step}`;
    if (timerState.current.key !== key)
      timerState.current = { key, remaining: stepDuration };
    if (!running) return;
    const started = performance.now();
    const remaining = timerState.current.remaining;
    const timer = window.setTimeout(() => {
      setPosition((current) =>
        current.step < 2
          ? { ...current, step: current.step + 1 }
          : { track: (current.track + 1) % workflows.length, step: 0 },
      );
    }, remaining);
    return () => {
      window.clearTimeout(timer);
      timerState.current.remaining = Math.max(
        0,
        remaining - (performance.now() - started),
      );
    };
  }, [running, track, step]);

  function select(index: number) {
    setPaused(true);
    setPosition({ track: index, step: 0 });
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? workflows.length - 1
          : (track + (event.key === "ArrowRight" ? 1 : -1) + workflows.length) %
            workflows.length;
    select(index);
    root.current
      ?.querySelector<HTMLButtonElement>(`#track-tab-${index}`)
      ?.focus({ preventScroll: true });
  }

  return (
    <div
      className="hub-network"
      ref={root}
      role="region"
      aria-label="Connected workspace overview"
      data-running={running}
      data-reduced-motion={reduced}
      onFocusCapture={(event) => {
        // Reading or navigating the graphic must never race an automatic change.
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(true);
      }}
    >
      <div className="hub-network-heading">
        <span>
          <i aria-hidden="true" /> THE CONNECTED WORKSPACE
        </span>
        {!reduced && (
          <button
            type="button"
            className="hub-network-playback"
            aria-label={
              paused ? "Play workflow animation" : "Pause workflow animation"
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPaused((current) => !current)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        )}
      </div>
      <div className="hub-identity">
        <div className="hub-identity-logo">
          <Logo compact />
        </div>
        <div className="hub-identity-copy">
          <span>ONE SHARED BUSINESS IDENTITY</span>
          <h2>Connected by trust.</h2>
        </div>
        <span className="hub-identity-shield" aria-hidden="true">
          <ShieldCheck size={23} />
        </span>
      </div>
      <svg
        className="hub-network-connections"
        viewBox="0 0 360 48"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {connections.map((d) => (
          <path key={d} d={d} className="hub-connection-base" />
        ))}
        <path
          key={`line-${track}`}
          d={connections[track]}
          className="hub-connection-active"
        />
        <path
          key={`signal-${track}`}
          d={connections[track]}
          pathLength="100"
          className="hub-connection-signal"
        />
        {[60, 180, 300].map((cx, index) => (
          <circle
            key={cx}
            cx={cx}
            cy="46"
            r="2.5"
            className={track === index ? "is-active" : ""}
          />
        ))}
      </svg>
      <div
        className="hub-network-tabs"
        role="tablist"
        onKeyDown={onTabKey}
        aria-label="Explore business workflows"
      >
        {workflows.map(({ label, Icon }, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            tabIndex={track === index ? 0 : -1}
            aria-selected={track === index}
            aria-controls={`track-panel-${index}`}
            id={`track-tab-${index}`}
            onFocus={() => setPaused(true)}
            onClick={() => select(index)}
          >
            <span className="hub-network-tab-icon">
              <Icon size={20} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="hub-track-panels">
        {workflows.map((workflow, index) => (
          <div
            key={workflow.label}
            className="hub-track-panel"
            role="tabpanel"
            tabIndex={track === index ? 0 : -1}
            id={`track-panel-${index}`}
            aria-labelledby={`track-tab-${index}`}
            hidden={track !== index}
            onFocus={() => setPaused(true)}
          >
            <div className="hub-track-label">
              <span>YOUR WORKFLOW, CONNECTED</span>
              <span className="hub-track-count" aria-hidden="true">
                0{index + 1}
                <span> / 03</span>
              </span>
            </div>
            <ol className="hub-track-stages">
              {workflow.stages.map(({ title, Icon }, stage) => (
                <li
                  key={title}
                  data-state={
                    stage === step ? "current" : stage < step ? "past" : "next"
                  }
                  aria-current={
                    track === index && stage === step ? "step" : undefined
                  }
                >
                  <span className="hub-track-node" aria-hidden="true">
                    {!reduced && stage < step ? (
                      <Check size={17} />
                    ) : (
                      <Icon size={17} />
                    )}
                  </span>
                  <strong>{title}</strong>
                  <span className="hub-track-step-number" aria-hidden="true">
                    0{stage + 1}
                  </span>
                </li>
              ))}
            </ol>
            <p>{workflow.copy}</p>
            <div className="hub-track-progress" aria-hidden="true">
              {workflow.stages.map((stage, position) => (
                <span
                  key={stage.title}
                  data-state={
                    position === step
                      ? "current"
                      : position < step
                        ? "past"
                        : "next"
                  }
                >
                  <i key={`${track}-${step}`} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="hub-network-bottom">
        <span>
          <LockKeyhole size={13} /> Role-based access
        </span>
        <span>
          <Sparkles size={14} /> VS AI assistance
        </span>
      </div>
    </div>
  );
}
