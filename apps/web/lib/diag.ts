/**
 * A flight recorder for the things that make this app wait.
 *
 * An installed phone pausing on skeleton rows for ten seconds is over before
 * devtools can be attached, and a slow `indexedDB.open`, a read queued behind
 * `rebuild`'s lock and a dead live read look identical — except on a timeline.
 *
 * **Always on**: a debug flag records nothing on the launch that goes wrong.
 * The cost is a bounded array and a `performance.now()` per event.
 *
 * Read it on /diag — long-press the wordmark on the groups list.
 *
 * **The last few pages' timelines are kept too**, in `localStorage`, never a
 * table: it has to work when IndexedDB is what's broken, and people kill the
 * app before thinking to look.
 */

/** One thing that happened, or took a while. */
interface DiagEvent {
  /** Milliseconds since this page started. One clock for every line. */
  at: number;
  /** A dotted name: `live.start`, `sync.push`, `rebuild`. */
  what: string;
  /** How long it took, for the ones that end. */
  ms?: number;
  /** Whatever makes the line worth reading — a key, a count, a reason. */
  info?: string;
  /**
   * Creation order, not printed: breaks ties within a millisecond, so a
   * `rebuild` and the read waiting on it never swap places.
   */
  seq: number;
}

/**
 * Enough for a launch and a couple of resumes. The oldest go first; the report
 * prints both ends when it wraps, since the launch is at the start.
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
 * The duration is the point.
 */
export function started(what: string, info?: string): (info?: string) => void {
  const from = now();
  const span: DiagEvent = { at: Math.round(from), what, info, seq: seq++ };
  // Held while it runs, so a read hanging *right now* — the reason somebody
  // opened this screen — is in the report.
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
 * The timeline in the order things *started*, so one span shows inside
 * another — "what was it waiting on" is always an overlap. Running spans are
 * included, with how long they've been going.
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

const KEEP = "bida.diag.pages";
/**
 * How many page logs to keep, this one included. More than one because a
 * paste loads `/join` as a second page, which would overwrite the one that
 * hung.
 */
const PAGES = 5;

/** One page's timeline, as kept: when it loaded, where, and what it recorded. */
interface KeptPage { at: number; url: string; events: DiagEvent[] }

const readKept = (): KeptPage[] => {
  try {
    return (JSON.parse(localStorage.getItem(KEEP) ?? "[]") as KeptPage[]).filter((p) => Array.isArray(p.events));
  } catch {
    return [];
  }
};

/**
 * Every other page's kept timeline, **newest first**. Read when asked, not at
 * load: a page opened after this one is often the one that matters.
 */
export function otherPages(): KeptPage[] {
  return readKept().filter((page) => page.at !== startedAt).sort((a, b) => b.at - a.at);
}

/**
 * Keep this page's timeline for the next one, in its own slot. On `pagehide`
 * and on going hidden; neither fires when the OS kills the process, so best
 * effort.
 */
function save(): void {
  try {
    // `timeline()`, not `events`: a read still hanging when the app is
    // backgrounded or killed is precisely what the next page needs to see.
    const mine: KeptPage = { at: startedAt, url: hideSecrets(location.pathname + location.search + location.hash), events: timeline() };
    const kept = [...readKept().filter((page) => page.at !== startedAt), mine]
      .sort((a, b) => a.at - b.at).slice(-PAGES);
    localStorage.setItem(KEEP, JSON.stringify(kept));
  } catch {
    // A full or disabled localStorage costs the kept logs, nothing else.
  }
}

let watching = false;

/** Start keeping the timeline across pages. Idempotent; called by `arm()`. */
export function keep(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  try {
    localStorage.removeItem("bida.diag.last");
  } catch {
    // Only a leftover from when one log was kept.
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
}

/**
 * One line per event, fixed-width, **newest first**. Plain text: read on a
 * phone, pasted into a message. Newest first because a phone pastes the top of
 * a long report; the timestamps still show containment, and `timeline()`
 * keeps start order.
 */
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

/**
 * A URL with every group secret in its fragment masked:
 * `#id.secret~id.secret` → `#id.…~id.…`. The report is pasted into chats.
 */
export function hideSecrets(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash) + url.slice(hash).replace(/\.[A-Za-z0-9_-]+/g, ".…");
}

const ARRIVALS = "bida.diag.arrivals";
const FIRST = "bida.diag.first";
const NOTES = "bida.diag.notes";

/** One page load: where it landed, how, and whether as the home-screen app. */
interface Arrival {
  at: number; url: string; nav: string; app: boolean;
  /** The manifest the head was given (`manifestScript`): `static`, `carry:<groups>`, or `none`. */
  mf?: string;
}

/**
 * Every page load's URL, written by an inline script before Next runs — to
 * answer which URL the home-screen icon opened (docs/ios.md, experiment A),
 * since the router rewrites the address before /diag is opened. The first load
 * in a storage is kept apart: on iOS the home-screen app has its own storage,
 * so that is the icon's first launch. `hideSecrets`'s mask, inlined because
 * this runs before any bundle.
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
    "", "loads, newest first:",
    ...read<Arrival[]>(ARRIVALS, []).reverse().map(arrival),
    "", "install steps, newest first:",
    ...(notes.length ? notes.reverse().map((n) => `${when(n.at)}  ${n.what}${n.info ? `  ${n.info}` : ""}`) : ["none"]),
  ].join("\n");
}
