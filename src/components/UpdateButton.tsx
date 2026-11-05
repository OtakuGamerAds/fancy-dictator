/**
 * The update button, after T3 Code's sidebar update control (components/sidebar/
 * DesktopUpdateStatusIcon.tsx and desktopUpdate.logic.ts, MIT License — see
 * THIRD_PARTY_LICENSE_T3CODE.txt). Idle it is T3's "Check for updates" refresh button (spinning
 * while it checks, a check mark when you are up to date). Available → click downloads (a ring
 * shows the progress) → downloaded → click restarts into the new version.
 */
import { CheckIcon, DownloadIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { UpdateState } from "~/lib/types";
import { cn } from "~/lib/utils";

const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function useUpdateState() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    void window.api.getUpdateState().then(setState);
    // `pnpm snapshot` drives the states it renders.
    if (new URLSearchParams(location.search).has("snapshot")) window.__fdSetUpdateState = setState;
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
  const showsUpdate = status === "available" || status === "downloading" || status === "downloaded";
  const interactionDisabled = status === "downloading" || status === "checking";
  const iconStatus = justChecked ? "checked" : status === "checking" ? "checking" : showsUpdate ? status : "idle";
  // T3's update button (SidebarUpdatePill.tsx): a plain round button, filled while it shows an
  // update. Not ui/Button, whose svg nudge (-mx-0.5) would push the progress ring off center.
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={interactionDisabled || undefined}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full outline-hidden ring-ring transition-colors focus-visible:ring-2 focus-visible:ring-inset",
        interactionDisabled ? "cursor-not-allowed" : "cursor-pointer",
        showsUpdate
          ? cn("bg-muted text-foreground", !interactionDisabled && "hover:bg-accent")
          : cn("text-muted-foreground", !interactionDisabled && "hover:bg-accent hover:text-foreground"),
      )}
      onClick={() => {
        if (interactionDisabled) return;
        if (status === "available") void window.api.downloadUpdate();
        else if (status === "downloaded") void window.api.installUpdate();
        else {
          setRequest("requested");
          void window.api.checkForUpdate();
        }
      }}
    >
      <UpdateStatusIcon status={iconStatus} percent={state.downloadPercent} />
    </button>
  );
}

/** T3's DesktopUpdateStatusIcon, plus a brief tick after a check that found nothing new. */
function UpdateStatusIcon({
  status,
  percent,
}: {
  status: "idle" | "checking" | "checked" | "available" | "downloading" | "downloaded";
  percent: number | null;
}) {
  if (status === "available") return <AvailableIcon />;
  if (status === "downloading") return <DownloadingIcon percent={percent} />;
  if (status === "downloaded") return <DownloadedIcon />;
  if (status === "checked") return <CheckIcon aria-hidden className="size-4 text-success-foreground" />;
  return <RefreshCwIcon aria-hidden className={cn("size-4", status === "checking" && "motion-safe:animate-spin")} />;
}

function AvailableIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <DownloadIcon className="size-4" />
      <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current ring-2 ring-background" />
    </span>
  );
}

function DownloadingIcon({ percent }: { percent: number | null }) {
  const normalized = percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <span className="relative grid size-8 place-items-center">
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
      <DownloadIcon className="size-4" />
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
