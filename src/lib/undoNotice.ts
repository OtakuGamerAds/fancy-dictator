/**
 * The undo notice, ported from T3 Code's hooks/showThreadUndoNotice.ts (MIT License — see
 * THIRD_PARTY_LICENSE_T3CODE.txt). Same behavior: an action shows one compact notice
 * ("Deleted, Ctrl+Z to undo"), repeats of the same action group into one ("Deleted 3"),
 * and after 5 seconds the notice expires and the actions can no longer be undone.
 * T3 keeps the state in zustand; here a tiny store with useSyncExternalStore does the same.
 */
import { useSyncExternalStore } from "react";

export type UndoAction = "Deleted" | "Cleared";

type UndoOptions = {
  action: UndoAction;
  undo: () => void | Promise<void>;
};

type UndoNotice = {
  action: UndoAction;
  count: number;
  undo: () => Promise<void>;
};

let notice: UndoNotice | null = null;
const listeners = new Set<() => void>();

function setNotice(next: UndoNotice | null) {
  notice = next;
  for (const listener of listeners) listener();
}

export function useUndoNotice(): UndoNotice | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notice,
  );
}

export const UNDO_LABEL = "Ctrl+Z to undo";

let liveUndos: UndoOptions[] = [];
let expiry: ReturnType<typeof setTimeout> | undefined;
// A new notice owns Ctrl+Z even inside a text field, until the user presses
// another key or edits text. After that, Ctrl+Z is the field's own undo again.
let shortcutClaimed = false;

function refreshNotice() {
  const latest = liveUndos.at(-1);
  if (!latest) {
    clearTimeout(expiry);
    setNotice(null);
    return;
  }
  const group: UndoOptions[] = [];
  for (let index = liveUndos.length - 1; index >= 0; index--) {
    const entry = liveUndos[index]!;
    if (entry.action !== latest.action) break;
    group.push(entry);
  }
  setNotice({
    action: latest.action,
    count: group.length,
    undo: async () => {
      const current = group.filter((entry) => liveUndos.includes(entry));
      // Take them off the list before awaiting, so a repeated Ctrl+Z cannot restore a group twice.
      liveUndos = liveUndos.filter((entry) => !group.includes(entry));
      refreshNotice();
      // Newest first, the reverse of the order they were done.
      for (const { undo } of current) await undo();
    },
  });
}

export function undoLatestAction(): boolean {
  if (!notice) return false;
  void notice.undo();
  return true;
}

/** Whether Ctrl+Z should undo the notice's actions even while a text field is focused. */
export function undoClaimsShortcut(): boolean {
  return shortcutClaimed && notice !== null;
}

/** Called on any other keypress or text edit; hands Ctrl+Z back to text fields. */
export function releaseUndoShortcut() {
  shortcutClaimed = false;
}

/** Shows one compact confirmation for the currently undoable actions. */
export function showUndoNotice(options: UndoOptions) {
  liveUndos.push(options);
  shortcutClaimed = true;
  refreshNotice();
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    liveUndos = [];
    refreshNotice();
  }, 5_000);
}
