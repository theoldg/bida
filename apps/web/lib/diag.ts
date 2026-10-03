/**
 * A flight recorder for the things that make this app wait, read on /diag.
 * A slow `indexedDB.open`, a read queued behind `rebuild`'s lock and a dead
 * live read look identical except on a timeline.
 *
 * Always on: a debug flag records nothing on the launch that goes wrong. The
 * last few pages' timelines are kept in `localStorage`, never a table: it has
 * to work when IndexedDB is what's broken.
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
  return [...events, ...live].sort((a, b) => a.at - b.at || a.seq - b.seq);
}

export function loadedAt(): number {
  return startedAt;
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}

/** Test seam: an empty recorder. */
export function forget(): void {
  events.length = 0;
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
