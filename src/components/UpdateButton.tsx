/**
 * The update button, after T3 Code's sidebar update control (components/sidebar/
 * DesktopUpdateStatusIcon.tsx and desktopUpdate.logic.ts, MIT License — see
 * THIRD_PARTY_LICENSE_T3CODE.txt): it only appears when there is something to do.
 * Available → click downloads (a ring shows the progress) → downloaded → click restarts
 * into the new version.
 */
import { CheckIcon, DownloadIcon, RotateCwIcon } from "lucide-react";
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
  if (!state || (status !== "available" && status !== "downloading" && status !== "downloaded")) return null;

  const label = tooltip(state);
  return (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={status === "downloading"}
      className="text-foreground"
      onClick={() => {
        if (status === "available") void window.api.downloadUpdate();
        else if (status === "downloaded") void window.api.installUpdate();
      }}
    >
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
