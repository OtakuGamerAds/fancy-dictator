import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import type { HistoryEntry } from "~/lib/types";
import { cn, formatAgo, formatDuration, textDirection } from "~/lib/utils";

interface HistoryPanelProps {
  history: HistoryEntry[];
  onCopy(text: string): Promise<void>;
  onDelete(id: string): void;
  onClear(): void;
}

/**
 * Recent transcriptions under the composer, drawn like your own messages in T3 Code's
 * timeline (TimelineUserMessageRow): end-aligned bg-message bubbles, actions on hover.
 */
/** Only the latest few show; the rest wait behind "Show more". */
const RECENT_COUNT = 3;

export function HistoryPanel({ history, onCopy, onDelete, onClear }: HistoryPanelProps) {
  const [showAll, setShowAll] = useState(false);
  // The gaps between messages drag the window too, unless the list scrolls: a drag region
  // would swallow the mouse wheel.
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  });
  const visible = showAll ? history : history.slice(0, RECENT_COUNT);
  const hiddenCount = history.length - visible.length;
  return (
    <div className="px-2 pt-1 pb-2">
      {history.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted-foreground text-xs">Your transcriptions will show up here.</p>
      ) : (
        <>
          <ul ref={listRef} data-no-drag={scrollable || undefined} className="flex max-h-[340px] flex-col gap-3 overflow-y-auto px-2 py-2">
            {visible.map((entry) => (
              <HistoryMessage key={entry.id} entry={entry} onCopy={onCopy} onDelete={onDelete} />
            ))}
          </ul>
          <div className="flex items-center justify-center gap-1 pt-1">
            {(hiddenCount > 0 || showAll) && history.length > RECENT_COUNT && (
              <>
                <Button variant="ghost-muted" size="xs" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show less" : `Show ${hiddenCount} more`}
                </Button>
                <span className="text-muted-foreground/60 text-xs">·</span>
              </>
            )}
            <Button variant="ghost-muted" size="xs" onClick={onClear}>
              Clear all
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function HistoryMessage({
  entry,
  onCopy,
  onDelete,
}: {
  entry: HistoryEntry;
  onCopy(text: string): Promise<void>;
  onDelete(id: string): void;
}) {
  const [copied, setCopied] = useState(false);
  // Long messages show 3 lines and a "Show more" link, like a post on social media.
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [entry.text, expanded]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <li className="group flex flex-col items-end">
      <div
        dir={textDirection(entry.text)}
        data-no-drag
        className="min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground text-sm leading-relaxed"
      >
        {/* The clamp is on the text itself, not the padded bubble, so no half line peeks out. */}
        <p
          ref={textRef}
          data-selectable
          className={cn("whitespace-pre-wrap wrap-break-word", !expanded && "line-clamp-3")}
        >
          {entry.text}
        </p>
        {(overflows || expanded) && (
          <button
            type="button"
            className="mt-1 cursor-pointer font-medium text-muted-foreground text-xs hover:text-foreground hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
      <div className="mt-1 flex h-6 items-center gap-0.5 pe-1 text-muted-foreground text-xs">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-focus-visible:opacity-100">
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Copy"
            title="Copy"
            onClick={() => void onCopy(entry.text).then(() => setCopied(true))}
          >
            {copied ? <CheckIcon className="text-success-foreground" /> : <CopyIcon />}
          </Button>
          <Button
            variant="ghost-destructive"
            size="icon-xs"
            aria-label="Delete"
            title="Delete"
            onClick={() => onDelete(entry.id)}
          >
            <Trash2Icon />
          </Button>
        </div>
        <span className="ps-1 tabular-nums">
          {formatAgo(entry.createdAt)} · {formatDuration(entry.durationMs)}
        </span>
      </div>
    </li>
  );
}
