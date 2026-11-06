import { cn } from "~/lib/utils";

/** A row of thin bars from the most recent microphone levels (oldest first), `height` px tall. */
export function Waveform({ levels, height = 16, className }: { levels: number[]; height?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex items-center gap-[3px]", className)} style={{ height }}>
      {levels.map((level, index) => {
        // Speech RMS sits around 0.02–0.3; lift quiet input so it is still visible.
        const scaled = Math.min(1, Math.sqrt(level * 6));
        return (
          <span
            key={index}
            className="w-[2px] rounded-full bg-muted-foreground/70 transition-[height] duration-100"
            style={{ height: `${Math.max(3, Math.round(scaled * height))}px` }}
          />
        );
      })}
    </div>
  );
}
