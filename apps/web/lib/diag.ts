/**
 * A flight recorder for the things that make this app wait.
 *
 * It exists because the failure it was built for cannot be caught with
 * devtools: an installed phone pauses on its skeleton rows for ten or twenty
 * seconds, at a moment nobody chose, and by the time a cable is plugged in it
 * is over. Guessing produced three plausible causes and no way to choose
 * between them — a slow `indexedDB.open`, a read queued behind `rebuild`'s
 * readwrite lock on every table, or a live read that died and was re-armed by
 * the watchdog in ./db/live.ts. All three look identical from the outside.
 * They do not look alike on a timeline.
 *
 * **Always on.** A debug flag records nothing on the launch that goes wrong,
 * which is the only launch worth recording. The cost is a bounded array of
 * small objects and a `performance.now()` per event; nothing is formatted
 * until somebody asks for the report.
 *
 * Read it on /diag — long-press the wordmark on the groups list.
 *
 * **The previous session is kept too**, in `localStorage`. The launch that
 * went wrong is over by the time anybody thinks to look at a log, and killing
 * the app to get out of it is exactly what a person does. localStorage rather
 * than a table, deliberately: this recorder has to work on the launch where
 * IndexedDB is the thing that is broken.
 */

/** One thing that happened, or took a while. */
export interface DiagEvent {
  /** Milliseconds since this page started. One clock for every line. */
  at: number;
  /** A dotted name: `live.start`, `sync.push`, `rebuild`. */
  what: string;
  /** How long it took, for the ones that end. */
  ms?: number;
  /** Whatever makes the line worth reading — a key, a count, a reason. */
  info?: string;
  /**
   * Creation order. Not printed — it is what breaks a tie when two things
   * start inside the same millisecond, so that a `rebuild` and the read
   * waiting on it never swap places just because the read finished first.
   */
  seq: number;
}

/**
 * Enough to cover a launch and a couple of resumes, and small enough that
 * nobody has to think about it. The oldest go first; a launch is what matters
 * and a launch is at the start, so the report prints both ends when it wraps.
 */
const LIMIT = 400;

const events: DiagEvent[] = [];
let seq = 0;
/** Wall-clock of the page load, so the relative timeline can be placed in a day. */
const startedAt = Date.now();

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now() - startedAt;

/** Record that something happened. */
export function mark(what: string, info?: string): void {
  events.push({ at: Math.round(now()), what, info, seq: seq++ });
  if (events.length > LIMIT) events.splice(0, events.length - LIMIT);
}

/** Spans that have begun and not ended. */
const running = new Set<DiagEvent>();

/**
 * Record that something *started*, and get back the way to say it finished.
 * The duration is what most of these lines are for: a number beside a name is
 * the difference between "the app was slow" and "the app spent 13s in
 * `rebuild` while the groups list waited for the same tables".
 */
export function started(what: string, info?: string): (info?: string) => void {
  const from = now();
  const span: DiagEvent = { at: Math.round(from), what, info, seq: seq++ };
  // Held while it runs, so that something which never finishes still has a
  // line. A read that is hanging *right now* is the whole reason somebody has
  // this screen open, and recording only on completion is how it would have
  // been the one thing missing from the report.
  running.add(span);
  return (done?: string) => {
    if (!running.delete(span)) return; // already finished; a double call is a no-op
    span.ms = Math.round(now() - from);
    if (done !== undefined) span.info = done;
    events.push(span);
    if (events.length > LIMIT) events.splice(0, events.length - LIMIT);
  };
}


/**
 * The timeline as it stands, in the order things *started* — which is the
 * order that shows one span sitting inside another. Sorted rather than
 * appended in completion order, because the question this recorder answers is
 * "what was the screen waiting on", and that is always an overlap.
 *
 * Anything still running is included, marked with how long it has been going.
 */
export function timeline(): DiagEvent[] {
  const live = [...running].map((span): DiagEvent => ({
    ...span,
    ms: Math.round(now() - span.at),
    info: `${span.info ? `${span.info} ` : ""}STILL RUNNING`,
  }));
  return [...events, ...live].sort((a, b) => a.at - b.at || a.seq - b.seq);
}

/** When the page this timeline describes was loaded. */
export function loadedAt(): number {
  return startedAt;
}

/* ---- surviving the relaunch ------------------------------------------- */

const KEEP = "bida.diag.last";

/**
 * The timeline from before this page loaded, if there is one. Read once, at
 * module load, so that saving over it later can't take it away.
 */
let previous: { at: number; events: DiagEvent[] } | undefined;

/** What the last session recorded, or undefined. */
export function lastSession(): { at: number; events: DiagEvent[] } | undefined {
  return previous;
}

/**
 * Keep this session's timeline for the next one to read.
 *
 * On `pagehide` and on going hidden, which between them cover the ways a phone
 * leaves an app: backgrounded, swiped away, reloaded, killed. Neither is
 * guaranteed on a process the OS terminates outright, so this is a best
 * effort — which still beats the certainty of losing it.
 */
function save(): void {
  try {
    // `timeline()`, not `events`: a read still hanging when the app is
    // backgrounded or killed is precisely what the next session needs to see.
    localStorage.setItem(KEEP, JSON.stringify({ at: startedAt, events: timeline() }));
  } catch {
    // A full or disabled localStorage costs the previous session, nothing else.
  }
}

let watching = false;

/** Start keeping the timeline across launches. Idempotent; called by `arm()`. */
export function keep(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  try {
    const held = localStorage.getItem(KEEP);
    if (held) previous = JSON.parse(held) as { at: number; events: DiagEvent[] };
  } catch {
    previous = undefined;
  }
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
  previous = undefined;
}

/**
 * One line per event, fixed-width, newest last.
 *
 * Plain text on purpose: it is read on a phone, pasted into a message, and
 * diffed against the next one. A table that needs a viewer is a table nobody
 * sends.
 */
export function format(rows: readonly DiagEvent[] = timeline()): string {
  return rows
    .map((e) => {
      const at = `${(e.at / 1000).toFixed(2)}s`.padStart(8);
      const took = e.ms === undefined ? "" : ` ${`+${e.ms}ms`.padStart(8)}`;
      return `${at}${took || " ".repeat(9)}  ${e.what}${e.info ? `  ${e.info}` : ""}`;
    })
    .join("\n");
}

/* ---- the home-screen hand-off ----------------------------------------- */

/**
 * A URL with every group secret in its fragment masked: `#id.secret~id.secret`
 * becomes `#id.…~id.…`. The report is pasted into chats, and a secret there is
 * the group handed over; the ids and the shape are what the question needs.
 */
export function hideSecrets(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash) + url.slice(hash).replace(/\.[A-Za-z0-9_-]+/g, ".…");
}

const ARRIVALS = "bida.diag.arrivals";
const FIRST = "bida.diag.first";
const NOTES = "bida.diag.notes";

/** One page load: where it landed, how, and whether as the home-screen app. */
export interface Arrival {
  at: number; url: string; nav: string; app: boolean;
  /** The manifest the head was given (`manifestScript`): `static`, `carry:<groups>`, or `none`. */
  mf?: string;
}

/**
 * Every page load's URL, written by an inline script before Next has run.
 *
 * It exists for one question iOS won't answer anywhere else: which URL did the
 * home-screen icon open (docs/ios.md, experiment A)? By the time anyone opens
 * /diag the app has moved on — `/install` hands off to `/join` or `/`, the
 * router rewrites the address — so the URL has to be caught at the door. The
 * very first load in a storage is kept apart and never overwritten, because on
 * iOS the home-screen app's storage is its own and its first load *is* the
 * icon's first launch. Same mask as `hideSecrets`, inlined: this runs before
 * any bundle does.
 */
export const arrivalScript = `try{var l=location,n=performance.getEntriesByType&&performance.getEntriesByType("navigation")[0],e={at:Date.now(),url:l.pathname+l.search+l.hash.replace(/\\.[A-Za-z0-9_-]+/g,".…"),nav:n?n.type:"?",app:matchMedia("(display-mode: standalone)").matches||navigator.standalone===true},m=document.querySelector("link[rel=manifest]"),c=localStorage.getItem("bida.carry");e.mf=!m?"none":m.href.indexOf("blob:")===0?"carry:"+(c?c.split("~").length:"?"):"static";a=JSON.parse(localStorage.getItem("${ARRIVALS}")||"[]");a.push(e);localStorage.setItem("${ARRIVALS}",JSON.stringify(a.slice(-12)));if(!localStorage.getItem("${FIRST}"))localStorage.setItem("${FIRST}",JSON.stringify(e))}catch(x){}`;

/** A timeline mark that also outlives the session — for steps that happen once. */
export function note(what: string, info?: string): void {
  mark(what, info);
  try {
    const held = JSON.parse(localStorage.getItem(NOTES) ?? "[]") as { at: number; what: string; info?: string }[];
    held.push({ at: Date.now(), what, info });
    localStorage.setItem(NOTES, JSON.stringify(held.slice(-30)));
  } catch {
    // No localStorage costs the note's second life, not the mark.
  }
}

/** The arrivals and notes above, as the report's lines. */
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
    "", "loads, newest last:",
    ...read<Arrival[]>(ARRIVALS, []).map(arrival),
    "", "install steps, newest last:",
    ...(notes.length ? notes.map((n) => `${when(n.at)}  ${n.what}${n.info ? `  ${n.info}` : ""}`) : ["none"]),
  ].join("\n");
}
