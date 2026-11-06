import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

/** Same helper as T3 Code's `~/lib/utils` cn(). */
export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

/** 0:04, 1:23, 12:05 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

export function formatAgo(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** When a session was recorded: "Today, 18:42", "Yesterday, 09:10", "Nov 3, 14:05". */
export function formatWhen(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return d.toDateString();
  };
  if (date.toDateString() === day(0)) return `Today, ${time}`;
  if (date.toDateString() === day(1)) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const when = date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `${when}, ${time}`;
}

/**
 * "rtl" when most of the letters are Arabic/Hebrew/etc., so Arabic that starts with an
 * English word ("Oh, oh, الله يسلمك…") still reads right to left. A tie goes to the first letter.
 */
export function textDirection(text: string): "rtl" | "ltr" {
  const letters = text.match(/\p{L}/gu) ?? [];
  const rtl = letters.filter((letter) => RTL_LETTER.test(letter)).length;
  const ltr = letters.length - rtl;
  if (rtl !== ltr) return rtl > ltr ? "rtl" : "ltr";
  return letters[0] !== undefined && RTL_LETTER.test(letters[0]) ? "rtl" : "ltr";
}
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;

/**
 * Put Soniox's words after the box's text. Soniox sends pieces of words that carry their own
 * spaces ("مش" + "كلة", "Ok" + "ay", "غلط" + "،"), so a piece that `continues` what Soniox
 * already wrote is joined as is. A space is only added where new speech meets text that
 * was there before (typed, or from an earlier recording).
 */
export function joinSpoken(base: string, piece: string, continues: boolean): string {
  if (!piece) return base;
  if (!base.trim()) return base + piece.trimStart();
  if (continues || /\s$/.test(base) || /^\s/.test(piece)) return base + piece;
  return `${base} ${piece}`;
}
