"use client";
// Doc: docs/diag.md

import Link from "next/link";
import { useEffect, useState } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { writeClipboardText } from "@/lib/clipboard";
import { copy, lang } from "@/lib/copy";
import { db } from "@/lib/db/dexie";
import { pullNotes, type PullNote } from "@/lib/db/stash";
import { format, handoff, loadedAt, otherPages, timeline } from "@/lib/diag";
import { useFold } from "@/lib/fold";
import { route } from "@/lib/group-link";
import { useFlash } from "@/lib/hooks";
import { ownKey } from "@/lib/scan/key";
import { setLang, type Lang } from "@/lib/lang";
import { setStasMode, stasMode } from "@/lib/scan/stas";
import { VERSION } from "@/lib/version";

/**
 * What this phone has been doing, as text you can send (lib/diag.ts records). On
 * a timer rather than live: a live read would be another line in the log.
 */
export default function DiagPage() {
  const [report, setReport] = useState<string>();
  const [copied, setCopied] = useFlash();
  // After mount: the static export's first render has no localStorage.
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

  return (
    <Screen>
      <Body>
        <TopBar title={copy.diag.title} back={route.groups()} />
        <Scroll>
          <WhatIsThis />
          {/* Stuck to the top, not a `Foot`: `env(safe-area-inset-bottom)` reads
              0 on Android often enough to cut a foot button in half. */}
          <div className="diag-act">
            <button type="button" className="btn btn-p" disabled={!report}
              onClick={() => {
                writeClipboardText(report ?? "").then(
                  () => setCopied(true),
                  // The report is already on screen to select.
                  () => setCopied(false),
                );
              }}>
              {copied ? copy.diag.copied : copy.diag.copyAll}
            </button>
            {/* Changes how a scan talks to whoever took the photo, so it costs a
                long-press to find. */}
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
            {/* Polish while it is being translated: "???" is a line not done yet.
                Each language named in itself, so it reads in either. A reload,
                since `copy` is picked once as the app loads. */}
            <div className="diag-stas">
              <div className="diag-stas-name">{copy.diag.lang}</div>
              <div className="diag-langs">
                {(["en", "pl"] as const satisfies readonly Lang[]).map((l) => (
                  <button key={l} type="button" className={`btn ${l === lang ? "btn-p" : "btn-s"}`}
                    aria-pressed={l === lang}
                    onClick={() => { if (l !== lang) { setLang(l); location.reload(); } }}>
                    {copy.languages[l]}
                  </button>
                ))}
              </div>
            </div>
            <Link className="btn btn-s diag-link" href={route.diagCrop()}>{copy.diag.cropLink}</Link>
          </div>
          {/* One <pre>: it is pasted into a message and diffed against the next
              one. */}
          <pre className="diag">{report ?? copy.diag.reading}</pre>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * Above the sticky bar, so it scrolls away once the report is being read; folded,
 * in the balances' idiom, because whoever pastes reports already knows.
 */
function WhatIsThis() {
  const { open, toggle, ref: fold } = useFold<HTMLDivElement>();
  const { ask, lead, tail } = copy.diag.what;
  return (
    <div ref={fold} className="installfold diag-what">
      <button type="button" aria-expanded={open} onClick={toggle}>
        <Icon name="chev" size={10} className={`kvchev${open ? " on" : ""}`} />
        {ask}
      </button>
      {open ? <p>{lead}<strong>{copy.diag.copyAll}</strong>{tail}</p> : null}
    </div>
  );
}

/**
 * **This screen must never wait on the database** — it is opened because the
 * database isn't answering. One window for the whole report, not one per
 * question: their waits would add up.
 */
const PATIENCE_MS = 2000;

function patience(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, PATIENCE_MS); });
}

async function within<T>(promise: Promise<T>, otherwise: T, until: Promise<void>): Promise<T> {
  try {
    return await Promise.race([promise, until.then(() => otherwise)]);
  } catch {
    return otherwise;
  }
}

/** A `shell` taller than `visible` has its last strip off the phone. */
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

/** Probed separately, in parallel: one wedged store must not hide the rest. */
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
 * More than one copy, another frozen, is the likeliest reason every read hangs.
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
 * Counts first: 14s of `rebuild` means one thing over 200 ops, another over
 * 20,000.
 */
async function collect(): Promise<string> {
  const d = db();
  const lines: string[] = [];
  const say = (k: string, v: string | number) => lines.push(`${`${k}:`.padEnd(14)}${v}`);

  say("version", VERSION);
  say("recorded", new Date(loadedAt()).toISOString());
  say("now", new Date().toISOString());
  say("up", `${((Date.now() - loadedAt()) / 1000).toFixed(0)}s`);

  // **Every question that can block is started here**, so they share one window.
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
  // Skipped rather than failed on, so without this the ledger has holes and says
  // nothing.
  const unreadLine = within(
    (async () => (await d.groupKeys.toArray())
      .flatMap((key) => (key.unreadable ? [{ groupId: key.groupId, ...key.unreadable }] : [])))(),
    [],
    until,
  );
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
  // Which key — never the key itself, in a report pasted into chats.
  const scanKeyLine = within(
    (async () => (await ownKey()) ? "own" : "shared")(),
    "no answer",
    until,
  );
  const copiesLine = within(copies(), "no answer from the worker", until);
  // The worker writes to no timeline: this is the only proof a push pulled
  // anything.
  const pullsLine = within<PullNote[] | undefined>(pullNotes(), undefined, until);

  const counts = await countsLine;
  if (counts) {
    say("ops", `${counts.ops} (${counts.pending} unsynced)`);
    say("rows", `${counts.groups} groups, ${counts.members} members, `
      + `${counts.expenses} expenses, ${counts.settlements} transfers, `
      + `${counts.rates} rates, ${counts.identities} identities, ${counts.keys} group keys`);
  } else {
    say("ops", `NO ANSWER in ${PATIENCE_MS}ms — the database is not reading`);
  }
  say("db", `v${d.verno}, ${d.isOpen() ? "open" : "CLOSED"}`);

  for (const row of await unreadLine) {
    say("unreadable", `${row.count} op(s) in ${row.groupId} from seq ${row.fromSeq} — `
      + "this build cannot open them; update the app");
  }

  say("storage", await storageLine);
  say("stas", stasMode() ? "on" : "off");
  say("lang", lang);
  say("scan key", await scanKeyLine);
  say("display", matchMedia("(display-mode: standalone)").matches ? "installed" : "browser");
  say("screen", screenLine());
  say("online", String(navigator.onLine));
  say("worker", navigator.serviceWorker?.controller ? "controlling" : "none");
  say("stores", await storeLine);
  say("copies", await copiesLine);
  const pulls = await pullsLine;
  if (!pulls) say("pull ahead", "no answer");
  else if (pulls.length === 0) say("pull ahead", "none recorded");
  for (const note of [...(pulls ?? [])].reverse()) {
    say("pull ahead", `${new Date(note.at).toISOString()} ${note.group} ${note.outcome}`);
  }

  const rows = timeline();

  // Up here: a pasted report gets cut short, and this is the block people get
  // asked for.
  const presses = [...otherPages().flatMap((page) => page.events), ...rows]
    .filter((e) => e.what === "menu.trace" || e.what === "dialog.trace")
    .slice(-6)
    .reverse()
    .map((e) => `${(e.at / 1000).toFixed(2)}s  ${e.what.replace(".trace", "")}  ${e.info ?? ""}`);
  if (presses.length) lines.push("", "menus and dialogs, newest first:", ...presses);
  const past = otherPages().map((page) =>
    `---- page ${new Date(page.at).toISOString()} ${page.url} (${page.events.length} events) ----\n\n`
    + `${format(page.events)}\n\n`).join("");

  /**
   * A phone pastes the top and stops, so the order is what the first screenful
   * needs. Secrets masked throughout.
   */
  return `${lines.join("\n")}\n\n---- this page (${rows.length} events) ----\n\n${format(rows)}\n\n`
    + `${past}---- home screen ----\n\n${handoff()}\n`;
}
