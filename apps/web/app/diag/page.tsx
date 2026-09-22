"use client";

import { useEffect, useState } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { writeClipboardText } from "@/lib/clipboard";
import { copy } from "@/lib/copy";
import { db } from "@/lib/db/dexie";
import { format, handoff, loadedAt, otherPages, timeline } from "@/lib/diag";
import { route } from "@/lib/group-link";
import { ownKey } from "@/lib/scan/key";
import { setStasMode, stasMode } from "@/lib/scan/stas";
import { VERSION } from "@/lib/version";

/**
 * What this phone has been doing, as text you can send. Linked from nowhere —
 * long-press the wordmark on the groups list. lib/diag.ts is the recorder;
 * this is the readout.
 *
 * Refreshes on a timer rather than live: a live read would be another line in
 * the log it prints.
 */
export default function DiagPage() {
  const [report, setReport] = useState<string>();
  const [copied, setCopied] = useState(false);
  // Read after mount, not during render: the app is a static export, so the
  // first render happens where there is no localStorage to ask.
  const [stas, setStas] = useState(false);

  useEffect(() => { setStas(stasMode()); }, []);

  useEffect(() => {
    let alive = true;
    const build = async () => {
      const text = await collect();
      if (alive) setReport(text);
    };
    void build();
    const timer = setInterval(build, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Screen>
      <Body>
        <TopBar title={copy.diag.title} back={route.groups()} />
        <Scroll>
          {/* Stuck to the top of the scroll, not a `Foot`: the bottom of an
              installed app is the system bar, and `env(safe-area-inset-bottom)`
              reads 0 on Android often enough to cut a foot button in half. */}
          <div className="diag-act">
            <button type="button" className="btn btn-p" disabled={!report}
              onClick={() => {
                writeClipboardText(report ?? "").then(
                  () => setCopied(true),
                  // The clipboard can refuse or be missing (lib/clipboard.ts); the report is
                  // already on screen to select, so there is nothing to recover.
                  () => setCopied(false),
                );
              }}>
              {copied ? copy.diag.copied : copy.diag.copyAll}
            </button>
            {/* Not a setting for a person using the app — it changes how a scan
                talks to whoever took the photo, so it costs a long-press to find
                (lib/scan/stas.ts). */}
            <div className="diag-stas">
              <div>
                <div className="diag-stas-name">{copy.diag.stas}</div>
                <div className="diag-stas-note">{copy.diag.stasNote}</div>
              </div>
              <button type="button" className={`btn ${stas ? "btn-p" : "btn-s"}`}
                aria-pressed={stas}
                onClick={() => { setStasMode(!stas); setStas(!stas); }}>
                {stas ? copy.diag.on : copy.diag.off}
              </button>
            </div>
          </div>
          {/* One <pre>, not a laid-out table: it is read on a phone, pasted
              into a message and diffed against the next one. */}
          <pre className="diag">{report ?? copy.diag.reading}</pre>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * How long the *whole report* may take before it prints what it has.
 *
 * **This screen must never wait on the database** — it is opened because the
 * database isn't answering. Everything that can block races this; the
 * timeline needs no database and prints either way.
 *
 * **One window for the report, not one per question**: awaiting each in turn
 * adds their waits up, and six seconds of "Reading…" is exactly the fault
 * being described (PROBE_MS in lib/db/live.ts).
 */
const PATIENCE_MS = 2000;

/** The one window, started when the report is. */
function patience(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, PATIENCE_MS); });
}

/**
 * The answer, or what it means that there wasn't one. `until` is shared, so
 * a question costs nothing if *started* with the others — see `collect`.
 */
async function within<T>(promise: Promise<T>, otherwise: T, until: Promise<void>): Promise<T> {
  try {
    return await Promise.race([promise, until.then(() => otherwise)]);
  } catch {
    return otherwise;
  }
}

/**
 * The layout viewport, the visible one, and the shell drawn into them. A
 * `shell` taller than `visible` has its last strip off the phone. `safe` is
 * what the browser admits the system bars cover — on Android, often 0 wrongly.
 */
function screenLine(): string {
  const view = window.visualViewport;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)";
  document.body.append(probe);
  const { paddingTop, paddingBottom } = getComputedStyle(probe);
  probe.remove();
  const shell = document.querySelector(".app")?.getBoundingClientRect().height;
  return `${window.innerWidth}×${window.innerHeight} layout`
    + (view ? `, ${Math.round(view.height)}+${Math.round(view.offsetTop)} visible @${view.scale}` : "")
    + `, ${shell === undefined ? "no" : Math.round(shell)} shell`
    + `, safe ${parseInt(paddingTop, 10)}/${parseInt(paddingBottom, 10)}`
    + `, kb ${getComputedStyle(document.documentElement).getPropertyValue("--kb").trim()}`;
}

/**
 * Which stores answer a read. Locks are per store, so the hanging reads name
 * the transaction holding one. **Probed separately, in parallel**: one
 * transaction over all would let one wedged store hide the rest.
 */
async function stores(until: Promise<void>): Promise<string> {
  const d = db();
  const held = (await Promise.all(d.tables.map(async (table) =>
    (await within(table.count().then(() => true), false, until)) ? undefined : table.name,
  ))).filter((name): name is string => name !== undefined);
  return held.length === 0
    ? `all ${d.tables.length} answer`
    : `${held.join(", ")} NOT READING — held by a write somewhere on this origin`;
}

/**
 * Every copy of the app open on this origin, as the service worker sees them.
 * More than one, with another hidden or frozen, is the likeliest reason for
 * reads that all hang at once and all clear together.
 */
function copies(): Promise<string> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve("no worker to ask");
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }: MessageEvent<{
      build: string;
      clients: { self: boolean; path: string; visibility: string; focused: boolean; lifecycle?: string }[];
    }>) => {
      resolve(`${data.clients.length} (worker ${data.build.slice(0, 8)})` + data.clients.map((c) =>
        `\n              ${c.self ? "this" : "OTHER"} ${c.path} ${c.visibility}`
        + `${c.focused ? " focused" : ""}${c.lifecycle ? ` ${c.lifecycle}` : ""}`).join(""));
    };
    worker.postMessage({ type: "clients" }, [channel.port2]);
  });
}

/**
 * The report: what this phone holds, then what it has been doing. Counts
 * first: 14s of `rebuild` means one thing over 200 ops, another over 20,000.
 */
async function collect(): Promise<string> {
  const d = db();
  const lines: string[] = [];
  const say = (k: string, v: string | number) => lines.push(`${`${k}:`.padEnd(14)}${v}`);

  // First, because every line under it describes a phone and none of them say
  // which build it was running (lib/version.ts).
  say("version", VERSION);
  say("recorded", new Date(loadedAt()).toISOString());
  say("now", new Date().toISOString());
  say("up", `${((Date.now() - loadedAt()) / 1000).toFixed(0)}s`);

  // **Every question that can block is started here** and read in printing
  // order below, so they share one window (PATIENCE_MS). A new blocking line
  // belongs up here too.
  const until = patience();
  const storeLine = stores(until);
  const countsLine = within(
    (async () => {
      const [ops, pending, groups, members, expenses, settlements, rates, identities, keys] =
        await Promise.all([
          d.ops.count(), d.ops.where("pending").equals(1).count(), d.groups.count(),
          d.members.count(), d.expenses.count(), d.settlements.count(),
          d.rates.count(), d.identities.count(), d.groupKeys.count(),
        ]);
      return { ops, pending, groups, members, expenses, settlements, rates, identities, keys };
    })(),
    undefined,
    until,
  );
  // Ops the server had and this build could not open. Skipped rather than
  // failed on (lib/db/sync.ts), so without this line the app shows a ledger
  // with holes in it and says nothing at all.
  const unreadLine = within(
    (async () => (await d.groupKeys.toArray())
      .flatMap((key) => (key.unreadable ? [{ groupId: key.groupId, ...key.unreadable }] : [])))(),
    [],
    until,
  );
  // Whether this origin is evictable is the difference between "the browser
  // closed our connection" being a wild guess and a likely story.
  const storageLine = within(
    (async () => {
      const persisted = await navigator.storage?.persisted?.();
      const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
      return `${persisted ? "persisted" : "EVICTABLE"}`
        + (usage && quota
          ? `, ${Math.round(usage / 1024)}kB of ${Math.round(quota / 1048576)}MB`
          : "");
    })(),
    "no answer",
    until,
  );
  // Which key this phone scans with — never the key itself, a credential in a
  // report pasted into chats. It decides where a failed scan went: ours, or
  // Google directly (lib/scan/key.ts).
  const scanKeyLine = within(
    (async () => (await ownKey()) ? "own" : "shared")(),
    "no answer",
    until,
  );
  const copiesLine = within(copies(), "no answer from the worker", until);

  const counts = await countsLine;
  if (counts) {
    say("ops", `${counts.ops} (${counts.pending} unsynced)`);
    say("rows", `${counts.groups} groups, ${counts.members} members, `
      + `${counts.expenses} expenses, ${counts.settlements} transfers, `
      + `${counts.rates} rates, ${counts.identities} identities, ${counts.keys} group keys`);
  } else {
    // Not a failure to report — a finding, and the loudest line in the file.
    say("ops", `NO ANSWER in ${PATIENCE_MS}ms — the database is not reading`);
  }
  say("db", `v${d.verno}, ${d.isOpen() ? "open" : "CLOSED"}`);

  for (const row of await unreadLine) {
    say("unreadable", `${row.count} op(s) in ${row.groupId} from seq ${row.fromSeq} — `
      + "this build cannot open them; update the app");
  }

  say("storage", await storageLine);
  say("stas", stasMode() ? "on" : "off");
  say("scan key", await scanKeyLine);
  say("display", matchMedia("(display-mode: standalone)").matches ? "installed" : "browser");
  // The screen actually painted beside the one laid out for; when they differ,
  // that strip is what a person reports as "the tabs are gone"
  // (lib/viewport.ts).
  say("screen", screenLine());
  say("online", String(navigator.onLine));
  say("worker", navigator.serviceWorker?.controller ? "controlling" : "none");
  say("stores", await storeLine);
  say("copies", await copiesLine);

  const rows = timeline();

  // Up here, not in the timeline: a pasted report gets cut short, and this is
  // the block people get asked for. Every page's, since the bad press was often
  // pages ago; menus and dialogs together, since one can open the other.
  const presses = [...otherPages().flatMap((page) => page.events), ...rows]
    .filter((e) => e.what === "menu.trace" || e.what === "dialog.trace")
    .slice(-6)
    .reverse()
    .map((e) => `${(e.at / 1000).toFixed(2)}s  ${e.what.replace(".trace", "")}  ${e.info ?? ""}`);
  if (presses.length) lines.push("", "menus and dialogs, newest first:", ...presses);
  // Each page headed by its address, secrets masked, newest first: a paste that
  // loads `/join` is a second page beside this one.
  const past = otherPages().map((page) =>
    `---- page ${new Date(page.at).toISOString()} ${page.url} (${page.events.length} events) ----\n\n`
    + `${format(page.events)}\n\n`).join("");

  /**
   * **The head, then everything else newest first.** A phone pastes the top and
   * stops, so the order is what the first screenful needs: counts, this page's
   * timeline newest first, earlier pages, and last the home-screen hand-off
   * (docs/ios.md, experiment A). Secrets masked throughout.
   */
  return `${lines.join("\n")}\n\n---- this page (${rows.length} events) ----\n\n${format(rows)}\n\n`
    + `${past}---- home screen ----\n\n${handoff()}\n`;
}
