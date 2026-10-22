// Saved countdowns (Days counter + widgets) — pure, unit-tested.
// The widget (targets/controls/CountdownWidget.swift) reads the same
// `countdowns` array from the App Group state and applies the same rule
// for which one to show: the soonest that is today or later.

import type { AppState, Countdown } from '../types';

// Same rule as dates.ts daysBetween (kept local so this module stays
// import-free for the Node test runner).
function daysBetween(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86_400_000);
}

export const MAX_COUNTDOWNS = 50;

export function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addCountdown(
  state: AppState,
  title: string,
  date: Date,
  now: number = Date.now(),
  id: string = `cd-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  includeToday = false,
): AppState {
  const t = title.trim() || 'Countdown';
  const item: Countdown = {
    id,
    title: t.slice(0, 60),
    date: localMidnight(date),
    createdAt: now,
    includeToday: includeToday === true,
  };
  return { ...state, countdowns: [...state.countdowns, item].slice(-MAX_COUNTDOWNS) };
}

export function deleteCountdown(state: AppState, id: string): AppState {
  return { ...state, countdowns: state.countdowns.filter((c) => c.id !== id) };
}

export function restoreCountdown(state: AppState, item: Countdown): AppState {
  if (state.countdowns.some((c) => c.id === item.id)) return state;
  return { ...state, countdowns: [...state.countdowns, item].slice(-MAX_COUNTDOWNS) };
}

/** Upcoming first (soonest), then past ones (most recent first). */
export function sortCountdowns(list: Countdown[], today: Date = new Date()): Countdown[] {
  const t = localMidnight(today);
  const upcoming = list.filter((c) => c.date >= t).sort((a, b) => a.date - b.date);
  const past = list.filter((c) => c.date < t).sort((a, b) => b.date - a.date);
  return [...upcoming, ...past];
}

/** What the widget shows: the soonest upcoming countdown, else none. */
export function nextCountdown(list: Countdown[], today: Date = new Date()): Countdown | null {
  return sortCountdowns(list, today).find((c) => c.date >= localMidnight(today)) ?? null;
}

/** Same sign rule as dates.ts countedDays. Kept local so tests can load this file alone. */
function withInclude(diff: number, includeToday: boolean): number {
  if (!includeToday) return diff;
  if (diff > 0) return diff + 1;
  if (diff < 0) return diff - 1;
  return 1;
}

export function daysLeft(c: Countdown, today: Date = new Date()): number {
  return withInclude(daysBetween(today, new Date(c.date)), c.includeToday === true);
}

/**
 * `n` is the exclusive midnight difference. includeToday uses the same
 * +1 rule as the big number, and still calls a same-day target Today.
 */
export function describeDaysLeft(n: number, includeToday = false): string {
  if (n === 0) return 'Today';
  if (!includeToday && n === 1) return 'Tomorrow';
  if (!includeToday && n === -1) return 'Yesterday';
  const shown = withInclude(n, includeToday);
  if (shown > 0) return `${shown} days to go`;
  return `${-shown} days ago`;
}
