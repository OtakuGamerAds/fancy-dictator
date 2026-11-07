import { ChevronDownIcon } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";

/** This close to the end still counts as at the end. */
const AT_END_PX = 8;

/**
 * Following the newest words, as T3 Code's timeline does (useTimelineFollow): the box keeps to
 * its end while you are there; scroll up to read something earlier and it stays put, with a
 * "Scroll to end" button to go back (which follows again, as does scrolling back down).
 * `following` is read when new words come; `restart` changing (a new recording) follows again.
 */
export function useFollowEnd(scrollRef: RefObject<HTMLElement | null>, restart: unknown) {
  const following = useRef(true);
  const [awayFromEnd, setAwayFromEnd] = useState(false);

  const follow = (next: boolean) => {
    following.current = next;
    setAwayFromEnd(!next);
  };
  useLayoutEffect(() => follow(true), [restart]);

  /** For the scroller's onScroll: at the end it follows, anywhere above it does not. */
  const onScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= AT_END_PX;
    if (atEnd !== following.current) follow(atEnd);
  };

  const scrollToEnd = () => {
    follow(true);
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  };

  return { following, onScroll, scrollToEnd, awayFromEnd };
}

/** T3 Code's ScrollToEndButton (TimelineOverlays.tsx), at the bottom of the box. */
export function ScrollToEndButton({ onScrollToEnd }: { onScrollToEnd(): void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center py-1.5">
      <Button
        onPointerDown={(event) => event.preventDefault()}
        onClick={onScrollToEnd}
        className="pointer-events-auto"
        size="xs"
        variant="glass"
      >
        <ChevronDownIcon className="size-3.5" />
        Scroll to end
      </Button>
    </div>
  );
}
