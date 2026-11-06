import { LoaderCircleIcon, MicIcon, MonitorSpeakerIcon, PauseIcon, PlayIcon } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { SourceToggles } from "~/components/Composer";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { ViewHeader } from "~/components/ViewHeader";
import { Waveform } from "~/components/Waveform";
import { ReplayPlayer } from "~/lib/replayAudio";
import type { ListenMode } from "~/lib/soniox";
import type { ReplaySegment } from "~/lib/types";
import { cn, formatDuration } from "~/lib/utils";

/** What to transcribe: from `start` until now, which sources, and whether to carry on live. */
export interface ReplayRequest {
  start: number;
  mode: ListenMode;
  keepLive: boolean;
}

const LEVEL_MS = 250;
const BARS = 70;
/** Where the start is put when Replay opens: this long before now (or the beginning). */
const DEFAULT_SPAN_MS = 5 * 60_000;

const sourcesOf = (mode: ListenMode) => (mode === "both" ? ["mic", "computer"] : mode === "none" ? [] : [mode]);

/**
 * Going back in time: the last minutes of your mic and the computer's audio on a timeline.
 * Click it to listen from there; "Start here" marks where the part to keep begins (it ends
 * now). Transcribed, it becomes a session as if it had been recorded live from that moment.
 */
export function ReplayView({
  load,
  busy,
  error,
  onBack,
  onTranscribe,
}: {
  /** Everything recorded until now. */
  load(): Promise<ReplaySegment[]>;
  busy: boolean;
  error: string | null;
  onBack(): void;
  onTranscribe(request: ReplayRequest): void;
}) {
  const [segments, setSegments] = useState<ReplaySegment[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [position, setPosition] = useState(0);
  const [start, setStart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ListenMode>("both");
  const [keepLive, setKeepLive] = useState(false);
  const player = useRef<ReplayPlayer | null>(null);

  useEffect(() => {
    const instance = new ReplayPlayer((ms) => {
      setPosition(ms);
      setPlaying(instance.playing);
    });
    player.current = instance;
    void load().then((loaded) => {
      const until = Date.now();
      const from = Math.min(until, ...loaded.map((s) => s.start));
      const begin = Math.max(from, until - DEFAULT_SPAN_MS);
      setSegments(loaded);
      setNow(until);
      setStart(begin);
      setPosition(begin);
    });
    return () => instance.close();
    // Loaded once, when Replay opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const from = segments?.length ? Math.min(...segments.map((s) => s.start)) : now;
  const heard = useMemo(
    () => (segments ?? []).filter((s) => sourcesOf(mode).includes(s.source)),
    [segments, mode],
  );

  const playFrom = (ms: number) => {
    setPosition(ms);
    if (heard.length === 0) return;
    player.current?.play(heard, ms, now);
    setPlaying(true);
  };
  const pause = () => {
    player.current?.stop();
    setPlaying(false);
  };

  if (!segments) {
    return (
      <div>
        <ViewHeader title="Replay" onBack={onBack} />
        <p className="flex justify-center px-4 pb-6 text-muted-foreground text-xs">
          <LoaderCircleIcon className="size-4 animate-spin" />
        </p>
      </div>
    );
  }

  return (
    <div>
      <ViewHeader title="Replay" onBack={onBack} />
      {segments.length === 0 ? (
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
            start={start}
            mode={mode}
            onSeek={(ms) => playFrom(Math.min(ms, now - 1000))}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full before:rounded-full"
              aria-label={playing ? "Pause" : "Play"}
              disabled={heard.length === 0}
              onClick={() => (playing ? pause() : playFrom(position >= now - 500 ? start : position))}
            >
              {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
            </Button>
            <span className="w-12 text-muted-foreground text-xs tabular-nums">−{formatDuration(now - position)}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3 before:rounded-full sm:h-7"
              title="The part to transcribe begins where you are listening"
              onClick={() => setStart(position)}
            >
              Start here
            </Button>
            <span className="ms-auto">
              <SourceToggles mode={mode} onChange={setMode} />
            </span>
          </div>
          <div className="flex items-center gap-2 border-t border-border pt-3">
            {/* T3's switch row, as in Settings. */}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={keepLive} onCheckedChange={setKeepLive} />
              Keep going live
            </label>
            {error && <p className="min-w-0 flex-1 truncate text-end text-error-foreground text-xs" title={error}>{error}</p>}
            <Button
              size="sm"
              className="ms-auto"
              disabled={busy || sourcesOf(mode).length === 0}
              onClick={() => {
                pause();
                onTranscribe({ start, mode, keepLive });
              }}
            >
              {busy && <LoaderCircleIcon className="animate-spin" />}
              {busy ? "Transcribing" : `Transcribe ${formatDuration(now - start)}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The recording on a line from its beginning to now: a lane of loudness per source (the
 * recording row's waveform), the part to transcribe tinted from its start, and where you are
 * listening. A click anywhere listens from there.
 */
function ReplayTimeline({
  segments,
  from,
  to,
  position,
  start,
  mode,
  onSeek,
}: {
  segments: ReplaySegment[];
  from: number;
  to: number;
  position: number;
  start: number;
  mode: ListenMode;
  onSeek(ms: number): void;
}) {
  const span = Math.max(1, to - from);
  const at = (ms: number) => `${Math.min(100, Math.max(0, ((ms - from) / span) * 100))}%`;
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
  const seek = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(from + ((event.clientX - rect.left) / rect.width) * span);
  };
  const on = sourcesOf(mode);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="flex flex-col justify-around text-muted-foreground">
          <MicIcon className="size-3.5" aria-label="Your microphone" />
          <MonitorSpeakerIcon className="size-3.5" aria-label="The computer's audio" />
        </div>
        <div data-no-drag className="relative flex-1 cursor-pointer py-1" onClick={seek}>
          {(["mic", "computer"] as const).map((source) => (
            <Waveform
              key={source}
              levels={lanes[source]}
              height={28}
              className={cn("w-full justify-between", !on.includes(source) && "opacity-30")}
            />
          ))}
          {/* The part to transcribe: from its start to now. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 end-0 rounded-e-md border-s-2 border-primary bg-primary/12"
            style={{ left: at(start) }}
          />
          {/* Where you are listening. */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: at(position) }} />
        </div>
      </div>
      <div className="flex justify-between ps-5.5 text-2xs text-muted-foreground tabular-nums">
        <span>−{formatDuration(span)}</span>
        <span>Now</span>
      </div>
    </div>
  );
}
