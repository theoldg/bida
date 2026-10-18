// Doc: docs/diag.md
/**
 * The flight recorder /diag reads. Kept in `localStorage`, never a table: it
 * has to work when IndexedDB is what's broken.
 */

interface DiagEvent {
  /** Milliseconds since this page started. */
  at: number;
  /** Dotted: `live.start`, `sync.push`, `rebuild`. */
  what: string;
  /** For spans. */
  ms?: number;
  info?: string;
  /** Breaks ties within a millisecond, so a `rebuild` and the read waiting on it never swap. */
  seq: number;
}

/** A launch and a couple of resumes; the oldest go first. */
const LIMIT = 400;

const events: DiagEvent[] = [];
let seq = 0;
const startedAt = Date.now();

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now() - startedAt;

function record(event: DiagEvent): void {
  events.push(event);
  if (events.length > LIMIT) events.splice(0, events.length - LIMIT);
}

export function mark(what: string, info?: string): void {
  record({ at: Math.round(now()), what, info, seq: seq++ });
}

/** Unfinished spans, reported too: a read hanging right now is why somebody opened /diag. */
const running = new Set<DiagEvent>();

/** Returns the call that ends the span; a second call is a no-op. */
export function started(what: string, info?: string): (info?: string) => void {
  const from = now();
  const span: DiagEvent = { at: Math.round(from), what, info, seq: seq++ };
  running.add(span);
  return (done?: string) => {
    if (!running.delete(span)) return;
    span.ms = Math.round(now() - from);
    if (done !== undefined) span.info = done;
    record(span);
  };
}

/** In start order, so "what was it waiting on" shows as an overlap. */
export function timeline(): DiagEvent[] {
  const live = [...running].map((span): DiagEvent => ({
    ...span,
    ms: Math.round(now() - span.at),
    info: `${span.info ? `${span.info} ` : ""}STILL RUNNING`,
  }));
  return [...events, ...slow, ...live].sort((a, b) => a.at - b.at || a.seq - b.seq);
}

export function loadedAt(): number {
  return startedAt;
}

/* ---- slow frames and inputs ------------------------------------------- */

/**
 * What the spans can't see: rendering, layout and the time between a tap and
 * the screen answering. A frame or an input past this is written down, so a
 * report from a phone that "feels slow" says whether the app or the browser
 * spent the time.
 */
const SLOW_MS = 100;
/** Their own ring: a laggy scroll writes one a frame, and would push out the spans that explain it. */
const SLOW_LIMIT = 60;
const slow: DiagEvent[] = [];
let lastInput: { id: number; event: DiagEvent } | undefined;

/** The parts of a `long-animation-frame` entry read here; the DOM lib doesn't type it yet. */
export interface FrameEntry {
  startTime: number;
  duration: number;
  /** Zero when the frame laid nothing out. */
  styleAndLayoutStart?: number;
  scripts?: readonly { duration: number; invoker?: string; sourceFunctionName?: string }[];
}

/** The parts of an `event` (Event Timing) entry read here. */
export interface InputEntry {
  startTime: number;
  duration: number;
  name: string;
  processingStart: number;
  processingEnd: number;
  /** Shared by the pointerdown, pointerup and click of one tap; 0 for a lone event. */
  interactionId?: number;
  target?: { tagName?: string } | null;
}

function noteSlow(event: DiagEvent): void {
  slow.push(event);
  if (slow.length > SLOW_LIMIT) slow.splice(0, slow.length - SLOW_LIMIT);
}

const ms = (n: number) => `${Math.max(0, Math.round(n))}ms`;

/** `script 140ms, layout 60ms, longest DIV.onclick`: whose code the frame was spent in. */
export function noteFrame(frame: FrameEntry): void {
  if (frame.duration < SLOW_MS) return;
  const scripts = frame.scripts ?? [];
  const script = scripts.reduce((sum, s) => sum + s.duration, 0);
  const layout = frame.styleAndLayoutStart ? frame.startTime + frame.duration - frame.styleAndLayoutStart : 0;
  const top = [...scripts].sort((a, b) => b.duration - a.duration)[0];
  // A whole script's invoker is its URL; the chunk's name is what tells two apart.
  const who = top
    ? (top.invoker || top.sourceFunctionName || "script").replace(/^https?:\/\/[^/]+\/(_next\/static\/chunks\/)?/, "").slice(0, 60)
    : undefined;
  noteSlow({
    at: Math.round(frame.startTime), what: "frame.slow", ms: Math.round(frame.duration), seq: seq++,
    info: `script ${ms(script)}, layout ${ms(layout)}${who ? `, longest ${who}` : ""}`,
  });
}

/**
 * `click on BUTTON: waited 80ms, ran 30ms, drew 20ms` — queued behind other
 * work, slow in its own handler, or slow to paint. One line per tap: its
 * pointerdown, pointerup and click share an interaction, and the longest speaks.
 */
export function noteInput(input: InputEntry): void {
  if (input.duration < SLOW_MS || !input.interactionId) return;
  const event: DiagEvent = {
    at: Math.round(input.startTime), what: "input.slow", ms: Math.round(input.duration), seq: seq++,
    info: `${input.name} on ${input.target?.tagName ?? "nothing"}: waited ${ms(input.processingStart - input.startTime)}, `
      + `ran ${ms(input.processingEnd - input.processingStart)}, drew ${ms(input.startTime + input.duration - input.processingEnd)}`,
  };
  if (lastInput?.id === input.interactionId) {
    if ((lastInput.event.ms ?? 0) >= (event.ms ?? 0)) return;
    const i = slow.indexOf(lastInput.event);
    if (i >= 0) slow.splice(i, 1);
  }
  lastInput = { id: input.interactionId, event };
  noteSlow(event);
}

/** For the report's head: a paste cut short still says whether frames were slow. */
export function slowSummary(): string {
  if (!watchingSlow) return "not measured: this browser reports neither";
  const frames = slow.filter((e) => e.what === "frame.slow");
  const inputs = slow.filter((e) => e.what === "input.slow");
  const longest = (rows: DiagEvent[]) => rows.length ? `, longest ${Math.max(...rows.map((e) => e.ms ?? 0))}ms` : "";
  return `${frames.length} frame(s)${longest(frames)}, ${inputs.length} input(s)${longest(inputs)} over ${SLOW_MS}ms`
    + (slow.length >= SLOW_LIMIT ? `, the last ${SLOW_LIMIT} kept` : "");
}

let watchingSlow = false;

/**
 * Idempotent. Chrome reports both, Safari neither yet, and the head says so.
 * `buffered`, so starting late still hands over what this page already drew.
 */
export function watchSlow(): void {
  if (watchingSlow || typeof window === "undefined") return;
  const types = typeof PerformanceObserver === "undefined" ? [] : PerformanceObserver.supportedEntryTypes ?? [];
  const watch = (type: string, note: (entry: never) => void, extra: object = {}) => {
    if (!types.includes(type)) return;
    try {
      const take = (entries: PerformanceEntryList) => { for (const entry of entries) note(entry as never); };
      const observer = new PerformanceObserver((list) => take(list.getEntries()));
      observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      // Now, not a task later: a cold /diag prints its head straight after.
      take(observer.takeRecords());
      watchingSlow = true;
    } catch { /* costs these lines, nothing else */ }
  };
  watch("long-animation-frame", noteFrame);
  watch("event", noteInput, { durationThreshold: SLOW_MS });
}

/* ---- surviving the relaunch ------------------------------------------- */

const KEEP = "bida.diag.pages";
/** This one included. Not just one: a paste loads `/join` as a page that would overwrite the one that hung. */
const PAGES = 5;

interface KeptPage { at: number; url: string; events: DiagEvent[] }

const readKept = (): KeptPage[] => {
  try {
    return (JSON.parse(localStorage.getItem(KEEP) ?? "[]") as KeptPage[]).filter((p) => Array.isArray(p.events));
  } catch {
    return [];
  }
};

/** Newest first. Read when asked, not at load: a page opened after this one often matters most. */
export function otherPages(): KeptPage[] {
  return readKept().filter((page) => page.at !== startedAt).sort((a, b) => b.at - a.at);
}

/** Best effort: nothing fires when the OS kills the process. */
function save(): void {
  try {
    // `timeline()`, so a read still hanging is kept too.
    const mine: KeptPage = { at: startedAt, url: hideSecrets(location.pathname + location.search + location.hash), events: timeline() };
    const kept = [...readKept().filter((page) => page.at !== startedAt), mine]
      .sort((a, b) => a.at - b.at).slice(-PAGES);
    localStorage.setItem(KEEP, JSON.stringify(kept));
  } catch {
    // Costs the kept logs, nothing else.
  }
}

let watching = false;

/** Idempotent. */
export function keep(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  try {
    // A leftover from when one log was kept.
    localStorage.removeItem("bida.diag.last");
  } catch { /* nothing to clean */ }
  addEventListener("pagehide", save);
  watchSlow();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}

/** Test seam: an empty recorder. */
export function forget(): void {
  events.length = 0;
  slow.length = 0;
  lastInput = undefined;
  seq = 0;
  running.clear();
}

/** Fixed-width, newest first: a phone pastes the top of a long report. */
export function format(rows: readonly DiagEvent[] = timeline()): string {
  return [...rows]
    .reverse()
    .map((e) => {
      const at = `${(e.at / 1000).toFixed(2)}s`.padStart(8);
      const took = e.ms === undefined ? "" : ` ${`+${e.ms}ms`.padStart(8)}`;
      return `${at}${took || " ".repeat(9)}  ${e.what}${e.info ? `  ${e.info}` : ""}`;
    })
    .join("\n");
}

/* ---- the home-screen hand-off ----------------------------------------- */

/** `#id.secret~id.secret` → `#id.…~id.…`: the report is pasted into chats. */
export function hideSecrets(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash) + url.slice(hash).replace(/\.[A-Za-z0-9_-]+/g, ".…");
}

const ARRIVALS = "bida.diag.arrivals";
const FIRST = "bida.diag.first";
const NOTES = "bida.diag.notes";

interface Arrival {
  at: number; url: string; nav: string;
  /** Opened as the home-screen app. */
  app: boolean;
  /** `static`, `carry:<groups>`, or `none` (`manifestScript`). */
  mf?: string;
}

/**
 * Every page load's URL, recorded before Next rewrites it: which URL did the
 * home-screen icon open (docs/ios.md)? The first load is kept apart, since the
 * iOS home-screen app has its own storage. Inlines `hideSecrets`: no bundle has run.
 */
export const arrivalScript = `try{var l=location,n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0],e={at:Date.now(),url:l.pathname+l.search+l.hash.replace(/\\.[A-Za-z0-9_-]+/g,".…"),nav:n?n.type:"?",app:matchMedia("(display-mode: standalone)").matches||navigator.standalone===true},m=document.querySelector("link[rel=manifest]"),c=localStorage.getItem("bida.carry");e.mf=!m?"none":m.href.indexOf("blob:")===0?"carry:"+(c?c.split("~").length:"?"):"static";a=JSON.parse(localStorage.getItem("${ARRIVALS}")||"[]");a.push(e);localStorage.setItem("${ARRIVALS}",JSON.stringify(a.slice(-12)));if(!localStorage.getItem("${FIRST}"))localStorage.setItem("${FIRST}",JSON.stringify(e))}catch(x){}`;

/** A mark that outlives the session, for steps that happen once. */
export function keepNote(what: string, info?: string): void {
  mark(what, info);
  try {
    const held = JSON.parse(localStorage.getItem(NOTES) ?? "[]") as { at: number; what: string; info?: string }[];
    held.push({ at: Date.now(), what, info });
    localStorage.setItem(NOTES, JSON.stringify(held.slice(-30)));
  } catch {
    // Costs the note's second life, not the mark.
  }
}

export function handoff(): string {
  const read = <T>(key: string, otherwise: T): T => {
    try { return (JSON.parse(localStorage.getItem(key) ?? "null") as T | null) ?? otherwise; }
    catch { return otherwise; }
  };
  const when = (at: number) => new Date(at).toISOString().slice(5, 19).replace("T", " ");
  const arrival = (a: Arrival) =>
    `${when(a.at)}  ${a.app ? "APP" : "tab"} ${a.nav.padEnd(12)} ${(a.mf ?? "").padEnd(8)} ${a.url}`;
  const first = read<Arrival | undefined>(FIRST, undefined);
  const notes = read<{ at: number; what: string; info?: string }[]>(NOTES, []);
  return [
    `first load:   ${first ? arrival(first) : "none recorded"}`,
    "", "loads, newest first:",
    ...read<Arrival[]>(ARRIVALS, []).reverse().map(arrival),
    "", "install steps, newest first:",
    ...(notes.length ? notes.reverse().map((n) => `${when(n.at)}  ${n.what}${n.info ? `  ${n.info}` : ""}`) : ["none"]),
  ].join("\n");
}
