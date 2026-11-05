/**
 * The update button, after T3 Code's sidebar update control (components/sidebar/
 * DesktopUpdateStatusIcon.tsx and desktopUpdate.logic.ts, MIT License — see
 * THIRD_PARTY_LICENSE_T3CODE.txt). Idle it is T3's "Check for updates" refresh button (spinning
 * while it checks, a check mark when you are up to date). Available → click downloads (a ring
 * shows the progress) → downloaded → click restarts into the new version.
 */
import { CheckIcon, DownloadIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import type { UpdateState } from "~/lib/types";

const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function useUpdateState() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    void window.api.getUpdateState().then(setState);
    return window.api.onUpdateState(setState);
  }, []);
  return state;
}

function tooltip(state: UpdateState): string {
  if (state.status === "checking") return "Checking for updates…";
  if (state.status === "up-to-date") return `Up to date (${state.currentVersion}). Click to check again.`;
  if (state.status === "error") return `${state.message ?? "Could not check for updates"}. Click to try again.`;
  if (state.status === "idle") return "Check for updates";
  if (state.status === "available") {
    return state.errorContext === "download"
      ? `Download failed for ${state.availableVersion}. Click to retry.`
      : `Update ${state.availableVersion ?? "available"} ready to download`;
  }
  if (state.status === "downloading") {
    const progress = typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  return state.message ?? "Update failed";
}

export function UpdateButton() {
  const state = useUpdateState();
  const status = state?.status;
  // A check you asked for gets a moment of "up to date" feedback, then the plain button again.
  const [justChecked, setJustChecked] = useState(false);
  // "requested" → "checking" (the check started) → done: only then is the result this check's.
  const [request, setRequest] = useState<"none" | "requested" | "checking">("none");
  useEffect(() => {
    if (request === "requested" && status === "checking") setRequest("checking");
    if (request !== "checking" || status === "checking") return;
    setRequest("none");
    if (status !== "up-to-date") return;
    setJustChecked(true);
    const timer = setTimeout(() => setJustChecked(false), 2000);
    return () => clearTimeout(timer);
  }, [request, status]);

  // Updates only run in the installed app; from source there is nothing to show.
  if (!state?.enabled) return null;

  const label = tooltip(state);
  const idle = status === "idle" || status === "up-to-date" || status === "error" || status === "checking";
  return (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={status === "downloading" || status === "checking"}
      className={idle ? undefined : "text-foreground"}
      onClick={() => {
        if (status === "available") void window.api.downloadUpdate();
        else if (status === "downloaded") void window.api.installUpdate();
        else {
          setRequest("requested");
          void window.api.checkForUpdate();
        }
      }}
    >
      {idle &&
        (justChecked ? (
          <CheckIcon className="text-success-foreground" />
        ) : (
          <RefreshCwIcon className={status === "checking" ? "animate-spin" : undefined} />
        ))}
      {status === "available" && <AvailableIcon />}
      {status === "downloading" && <DownloadingIcon percent={state.downloadPercent} />}
      {status === "downloaded" && <DownloadedIcon />}
    </Button>
  );
}

function AvailableIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <DownloadIcon className="size-4" />
      <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background" />
    </span>
  );
}

function DownloadingIcon({ percent }: { percent: number | null }) {
  const normalized = percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <span className="relative grid size-7 place-items-center">
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={RADIUS} fill="none" className="stroke-current/22" strokeWidth="1.5" />
        <circle
          cx="16"
          cy="16"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - normalized / 100)}
          strokeLinecap="round"
          strokeWidth="1.5"
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <DownloadIcon className="size-3.5" />
    </span>
  );
}

function DownloadedIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <RotateCwIcon className="size-4" />
      <span className="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-foreground text-background ring-2 ring-background">
        <CheckIcon className="size-2" strokeWidth={3} />
      </span>
    </span>
  );
}
