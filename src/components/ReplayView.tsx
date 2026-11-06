import { LoaderCircleIcon, MicIcon, MonitorSpeakerIcon, PauseIcon, PlayIcon } from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { SourceToggles } from "~/components/Composer";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { ViewHeader } from "~/components/ViewHeader";
import { Waveform } from "~/components/Waveform";
import { ReplayPlayer } from "~/lib/replayAudio";
import type { ListenMode } from "~/lib/soniox";
import type { ReplayKept, ReplaySegment } from "~/lib/types";
import { cn, formatDuration } from "~/lib/utils";

/**
 * What to transcribe: from `start` to `end`, which sources, whether to carry on live (then it
 * ends now), and whether everything up to its end is deleted once it is done.
 */
export interface ReplayRequest {
  start: number;
  end: number;
  mode: ListenMode;
  keepLive: boolean;
  cleanUp: boolean;
}

const LEVEL_MS = 250;
const BARS = 70;
/** Where In is put when Replay opens: this long before now (or the beginning). */
const DEFAULT_SPAN_MS = 5 * 60_000;
/** In and Out stay at least this far apart. */
const MIN_SPAN_MS = 1000;
/** Out dropped: it is heard from this long before it. */
const OUT_LEAD_MS = 3000;

const sourcesOf = (mode: ListenMode) => (mode === "both" ? ["mic", "computer"] : mode === "none" ? [] : [mode]);

/**
 * Going back in time: the last minutes of your mic and the computer's audio on a timeline.
 * Click it to listen from there; drag In and Out to the part to keep, as in a video editor.
 * Transcribed, it becomes a session as if it had been recorded live from In.
 */
export function ReplayView({
  load,
  busy,
  error,
  onBack,
  onTranscribe,
}: {
  /** Everything recorded until now. */
  load(): Promise<ReplayKept>;
  busy: boolean;
  error: string | null;
  onBack(): void;
  onTranscribe(request: ReplayRequest): void;
}) {
  const [kept, setKept] = useState<ReplayKept | null>(null);
  const [now, setNow] = useState(Date.now());
  const [position, setPosition] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ListenMode>("both");
  const [keepLive, setKeepLive] = useState(false);
  const [cleanUp, setCleanUp] = useState(true);
  const player = useRef<ReplayPlayer | null>(null);

  useEffect(() => {
    const instance = new ReplayPlayer((ms) => {
      setPosition(ms);
      setPlaying(instance.playing);
    });
    player.current = instance;
    void load().then((loaded) => {
      const until = Date.now();
      const from = Math.max(loaded.since, Math.min(until, ...loaded.segments.map((s) => s.start)));
      const start = Math.max(from, until - DEFAULT_SPAN_MS);
      setKept(loaded);
      setNow(until);
      setRange({ start, end: until });
      setPosition(start);
    });
    return () => instance.close();
    // Loaded once, when Replay opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const segments = kept?.segments ?? [];
  const from = kept ? Math.max(kept.since, Math.min(now, ...segments.map((s) => s.start))) : now;
  // Carrying on live, the part ends now.
  const end = keepLive ? now : range.end;
  const heard = useMemo(() => segments.filter((s) => sourcesOf(mode).includes(s.source)), [segments, mode]);

  const playFrom = (ms: number) => {
    const at = Math.max(from, Math.min(ms, now - 500));
    setPosition(at);
    if (heard.length === 0) return;
    player.current?.play(heard, at, now);
    setPlaying(true);
  };
  const pause = () => {
    player.current?.stop();
    setPlaying(false);
  };

  return (
    <div>
      <ViewHeader title="Replay" onBack={onBack} />
      {!kept ? (
        <p className="flex justify-center px-4 pb-6">
          <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
        </p>
      ) : segments.length === 0 ? (
        <p className="px-4 pb-6 text-center text-muted-foreground text-xs">
          Nothing recorded yet: Replay keeps what is heard from when it was turned on.
        </p>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-3">
          <ReplayTimeline
            segments={segments}
            from={from}
            to={now}
            position={position}
            start={range.start}
            end={end}
            endLocked={keepLive}
            mode={mode}
            onSeek={playFrom}
            onRange={(next) => setRange((current) => ({ ...current, ...next }))}
            onDrop={(edge, ms) => playFrom(edge === "start" ? ms : ms - OUT_LEAD_MS)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full before:rounded-full"
              aria-label={playing ? "Pause" : "Play"}
              disabled={heard.length === 0}
              onClick={() => (playing ? pause() : playFrom(position >= now - 500 ? range.start : position))}
            >
              {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">−{formatDuration(now - position)}</span>
            <span className="ms-auto">
              <SourceToggles mode={mode} onChange={setMode} />
            </span>
          </div>
          <div className="flex items-center gap-3 border-t border-border pt-3">
            {/* T3's switch, as in Settings. */}
            <div className="flex flex-col gap-1.5 text-xs">
              <label className="flex cursor-pointer items-center gap-2" title="Carry on recording into the same session (it ends now)">
                <Switch checked={keepLive} onCheckedChange={setKeepLive} />
                Keep going live
              </label>
              <label
                className="flex cursor-pointer items-center gap-2"
                title="Once it is transcribed, forget everything recorded up to its end"
              >
                <Switch checked={cleanUp} onCheckedChange={setCleanUp} />
                Clean up after
              </label>
            </div>
            {error && (
              <p className="min-w-0 flex-1 truncate text-end text-error-foreground text-xs" title={error}>
                {error}
              </p>
            )}
            <Button
              size="sm"
              className="ms-auto"
              disabled={busy || sourcesOf(mode).length === 0}
              onClick={() => {
                pause();
                onTranscribe({ start: range.start, end, mode, keepLive, cleanUp });
              }}
            >
              {busy && <LoaderCircleIcon className="animate-spin" />}
              {busy ? "Transcribing" : `Transcribe ${formatDuration(end - range.start)}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The recording on a line from its beginning to now: a lane of loudness per source (the
 * recording row's waveform), the part to transcribe between its In and Out marks (dragged, as in
 * a video editor), and where you are listening. A click anywhere else listens from there.
 */
function ReplayTimeline({
  segments,
  from,
  to,
  position,
  start,
  end,
  endLocked,
  mode,
  onSeek,
  onRange,
  onDrop,
}: {
  segments: ReplaySegment[];
  from: number;
  to: number;
  position: number;
  start: number;
  end: number;
  /** Out stays at now (carrying on live). */
  endLocked: boolean;
  mode: ListenMode;
  onSeek(ms: number): void;
  onRange(range: { start?: number; end?: number }): void;
  /** A mark was let go of at `ms`. */
  onDrop(edge: "start" | "end", ms: number): void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const span = Math.max(1, to - from);
  const percent = (ms: number) => Math.min(100, Math.max(0, ((ms - from) / span) * 100));
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return from + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span;
  };
  const lanes = useMemo(() => {
    const bars = { mic: new Array<number>(BARS).fill(0), computer: new Array<number>(BARS).fill(0) };
    for (const segment of segments) {
      segment.levels.forEach((level, i) => {
        const bar = Math.floor(((segment.start + i * LEVEL_MS - from) / span) * BARS);
        if (bar >= 0 && bar < BARS) bars[segment.source][bar] = Math.max(bars[segment.source][bar]!, level);
      });
    }
    return bars;
  }, [segments, from, span]);
  const on = sourcesOf(mode);

  /** A mark, dragged with the pointer held on it. */
  const mark = (edge: "start" | "end") => {
    const at = edge === "start" ? start : end;
    const move = (event: PointerEvent<HTMLElement>) => {
      const ms = timeAt(event.clientX);
      return edge === "start" ? Math.min(ms, end - MIN_SPAN_MS) : Math.max(ms, start + MIN_SPAN_MS);
    };
    const locked = edge === "end" && endLocked;
    return (
      <div
        role="slider"
        aria-label={edge === "start" ? "In" : "Out"}
        aria-valuetext={`${formatDuration(to - at)} ago`}
        className={cn(
          "absolute -inset-y-1 z-10 flex w-3 -translate-x-1/2 justify-center",
          locked ? "pointer-events-none" : "cursor-ew-resize",
        )}
        style={{ left: `${percent(at)}%` }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (locked) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(edge);
        }}
        onPointerMove={(event) => {
          if (dragging === edge) onRange({ [edge]: move(event) });
        }}
        onPointerUp={(event) => {
          if (dragging !== edge) return;
          setDragging(null);
          onDrop(edge, move(event));
        }}
      >
        {/* The mark: a line with a bracket at its top, like In and Out in a video editor. */}
        <span className="h-full w-0.5 rounded-full bg-primary" />
        <span
          className={cn(
            "absolute top-0 h-2 w-1.5 border-primary border-t-2",
            edge === "start" ? "left-1/2 border-s-2" : "right-1/2 border-e-2",
          )}
        />
        {dragging === edge && (
          <span className="absolute -top-5 rounded bg-popover px-1 text-2xs text-foreground tabular-nums shadow-sm">
            −{formatDuration(to - at)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="flex flex-col justify-around text-muted-foreground">
          <MicIcon className="size-3.5" aria-label="Your microphone" />
          <MonitorSpeakerIcon className="size-3.5" aria-label="The computer's audio" />
        </div>
        <div ref={track} data-no-drag className="relative flex-1 cursor-pointer py-1" onClick={(event) => onSeek(timeAt(event.clientX))}>
          {(["mic", "computer"] as const).map((source) => (
            <Waveform
              key={source}
              levels={lanes[source]}
              height={28}
              className={cn("w-full justify-between", !on.includes(source) && "opacity-30")}
            />
          ))}
          {/* The part to transcribe, between In and Out. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 bg-primary/12"
            style={{ left: `${percent(start)}%`, right: `${100 - percent(end)}%` }}
          />
          {/* Where you are listening. */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${percent(position)}%` }} />
          {mark("start")}
          {mark("end")}
        </div>
      </div>
      <div className="flex justify-between ps-5.5 text-2xs text-muted-foreground tabular-nums">
        <span>−{formatDuration(span)}</span>
        <span>Now</span>
      </div>
    </div>
  );
}
