/**
 * Ported from T3 Code's components/sidebar/SidebarThreadUndoNotice.tsx (MIT License — see
 * THIRD_PARTY_LICENSE_T3CODE.txt): "Deleted, Ctrl+Z to undo", fading in and out.
 */
import { Undo2Icon } from "lucide-react";
import { useState } from "react";

import { InlineButton } from "~/components/ui/button";
import { UNDO_LABEL, undoLatestAction, useUndoNotice } from "~/lib/undoNotice";
import { cn } from "~/lib/utils";

export function UndoNotice({ className }: { className?: string }) {
  const notice = useUndoNotice();
  const summary = notice ? (notice.count === 1 ? notice.action : `${notice.action} ${notice.count}`) : null;

  // Keeps the last text on screen while it fades out, then unmounts on transitionend.
  const [shownSummary, setShownSummary] = useState(summary);
  if (summary && summary !== shownSummary) setShownSummary(summary);
  const text = summary ?? shownSummary;
  if (!text) return null;

  return (
    <div
      aria-hidden={!summary}
      inert={!summary}
      onTransitionEnd={(event) => {
        if (!summary && event.target === event.currentTarget) setShownSummary(null);
      }}
      className={cn(
        "@container flex h-6 min-w-0 flex-row-reverse flex-wrap justify-end gap-x-1 overflow-hidden text-2xs leading-6 whitespace-nowrap text-muted-foreground transition-opacity duration-200 ease-out starting:opacity-0",
        !summary && "opacity-0",
        className,
      )}
    >
      <InlineButton className="min-w-0 shrink" onClick={undoLatestAction}>
        <span className="flex h-6 min-w-0 flex-wrap justify-end overflow-hidden">
          <Undo2Icon className="-ml-4 h-6 w-4 @max-[1rem]:invisible" />
          <span>{UNDO_LABEL}</span>
        </span>
      </InlineButton>
      <span>{text},</span>
    </div>
  );
}
