import { ChevronLeftIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

/** A view's title, with Back to the main view at its left (Settings, Replay). */
export function ViewHeader({ title, onBack }: { title: string; onBack(): void }) {
  return (
    <div className="relative flex h-11 items-center justify-center px-2">
      <Button variant="ghost-muted" size="icon-sm" className="absolute start-2" aria-label="Back" onClick={onBack}>
        <ChevronLeftIcon />
      </Button>
      <h1 className="font-semibold text-foreground text-sm">{title}</h1>
    </div>
  );
}
