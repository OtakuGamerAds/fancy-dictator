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

/** "rtl" when the first strong character is Arabic/Hebrew/etc. */
export function textDirection(text: string): "rtl" | "ltr" {
  const match = text.match(/[\p{L}]/u);
  return match && /[֐-ࣿיִ-﷿ﹰ-﻿]/u.test(match[0]) ? "rtl" : "ltr";
}

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
