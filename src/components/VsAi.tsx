import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export { VsAiMark } from "./VsAiMark";

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
