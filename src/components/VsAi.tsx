import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { brandPaths } from "../../shared/brand";

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
      <svg className="vs-ai-monogram" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="20" fill="#183f34" />
        <rect
          x="1"
          y="1"
          width="62"
          height="62"
          rx="19"
          fill="none"
          stroke="#d2efa1"
          strokeOpacity=".25"
        />
        <path d={brandPaths.v} fill="#d2efa1" />
        <path d={brandPaths.s} fill="#f7faf3" />
      </svg>
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

// Only a completed, authorized server response is revealed. No synthetic tokens
// or progress percentages are used while waiting for the actual provider.
export function AiReply({
  text,
  animate,
  onComplete,
}: {
  text: string;
  animate: boolean;
  onComplete: () => void;
}) {
  const [length, setLength] = useState(animate ? 0 : text.length);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!animate || motion.matches) {
      setLength(text.length);
      if (animate) complete.current();
      return;
    }
    const ends = [...text.matchAll(/\S+\s*/g)].map(
      (match) => match.index! + match[0].length,
    );
    const duration = Math.min(1800, Math.max(280, ends.length * 32));
    const start = performance.now();
    let frame = 0;
    setLength(0);
    const tick = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      const word = Math.max(0, Math.ceil(progress * ends.length) - 1);
      setLength(progress === 1 ? text.length : ends[word] || 0);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else complete.current();
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      setLength(text.length);
      complete.current();
    };
    frame = requestAnimationFrame(tick);
    motion.addEventListener("change", finish, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", finish);
    };
  }, [text, animate]);
  const revealing = animate && length < text.length;
  return (
    <div className="ai-markdown" data-revealing={revealing}>
      <div className="ai-reply-text" aria-hidden={revealing || undefined}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) =>
              href?.startsWith("/app/") ? (
                <Link to={href}>{children}</Link>
              ) : (
                <span>{children}</span>
              ),
          }}
        >
          {revealing ? text.slice(0, length) : text}
        </ReactMarkdown>
      </div>
      {revealing && <span className="sr-only">VS AI is writing a reply.</span>}
    </div>
  );
}
