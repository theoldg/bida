"use client";

import { useEffect, useState } from "react";
import { Body, Foot, Screen, Scroll, TopBar } from "../../components/chrome";
import { copy } from "../../lib/copy";
import { db } from "../../lib/db/dexie";
import { format, lastSession, loadedAt, timeline } from "../../lib/diag";
import { route } from "../../lib/group-link";

/**
 * What this phone has been doing, as text you can send.
 *
 * Not linked from anywhere — long-press the wordmark on the groups list. A
 * diagnostics screen earns no room in an app this size, and this one is for
 * one question: when the ledger sits on its skeleton rows for ten seconds,
 * what was it waiting for? lib/diag.ts is the recorder; this is the readout.
 *
 * It refreshes on a timer rather than live, because a live read here would be
 * another line in the log it is printing.
 */
export default function DiagPage() {
  const [report, setReport] = useState<string>();
  const [copied, setCopied] = useState(false);

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
          {/* One <pre>, not a laid-out table: it is read on a phone, pasted
              into a message and diffed against the next one. */}
          <pre className="diag">{report ?? copy.diag.reading}</pre>
        </Scroll>
      </Body>
      <Foot>
        <button type="button" className="btn btn-p btn-lg" disabled={!report}
          onClick={() => {
            navigator.clipboard.writeText(report ?? "").then(
              () => setCopied(true),
              // The clipboard refuses on an insecure context or a denied
              // permission. The whole report is already on screen to be
              // selected or photographed, so there is nothing to recover.
              () => setCopied(false),
            );
          }}>
          {copied ? copy.diag.copied : copy.diag.copyAll}
        </button>
      </Foot>
    </Screen>
  );
}

/**
 * How long any one question here may take before the report gives up on it.
 *
 * **This screen must never wait on the database.** It is opened because the
 * database is not answering, and the first version of it asked Dexie for row
 * counts and then sat on "Reading…" forever — a diagnostics screen that hangs
 * on the fault it is diagnosing. Everything that can block is raced against
 * this, and the timeline, which needs no database at all, is printed either
 * way.
 */
const PATIENCE_MS = 2000;

/** The answer, or what it means that there wasn't one. */
async function within<T>(promise: Promise<T>, otherwise: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(otherwise), PATIENCE_MS); }),
    ]);
  } catch {
    return otherwise;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The report: what this phone holds, then what it has been doing.
 *
 * The counts come first because they are the scale the timings have to be read
 * against — 14s of `rebuild` means one thing over 200 ops and another over
 * 20,000.
 */
async function collect(): Promise<string> {
  const d = db();
  const lines: string[] = [];
  const say = (k: string, v: string | number) => lines.push(`${`${k}:`.padEnd(14)}${v}`);

  say("recorded", new Date(loadedAt()).toISOString());
  say("now", new Date().toISOString());
  say("up", `${((Date.now() - loadedAt()) / 1000).toFixed(0)}s`);

  const counts = await within(
    (async () => {
      const [ops, pending, groups, members, expenses, settlements, rates, identities] =
        await Promise.all([
          d.ops.count(), d.ops.where("pending").equals(1).count(), d.groups.count(),
          d.members.count(), d.expenses.count(), d.settlements.count(),
          d.rates.count(), d.identities.count(),
        ]);
      return { ops, pending, groups, members, expenses, settlements, rates, identities };
    })(),
    undefined,
  );

  if (counts) {
    say("ops", `${counts.ops} (${counts.pending} unsynced)`);
    say("rows", `${counts.groups} groups, ${counts.members} members, `
      + `${counts.expenses} expenses, ${counts.settlements} transfers, `
      + `${counts.rates} rates, ${counts.identities} identities`);
  } else {
    // Not a failure to report — a finding, and the loudest line in the file.
    say("ops", `NO ANSWER in ${PATIENCE_MS}ms — the database is not reading`);
  }
  say("db", `v${d.verno}, ${d.isOpen() ? "open" : "CLOSED"}`);

  // Whether this origin is evictable is the difference between "the browser
  // closed our connection" being a wild guess and a likely story.
  say("storage", await within(
    (async () => {
      const persisted = await navigator.storage?.persisted?.();
      const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
      return `${persisted ? "persisted" : "EVICTABLE"}`
        + (usage && quota
          ? `, ${Math.round(usage / 1024)}kB of ${Math.round(quota / 1048576)}MB`
          : "");
    })(),
    "no answer",
  ));

  say("display", matchMedia("(display-mode: standalone)").matches ? "installed" : "browser");
  say("online", String(navigator.onLine));
  say("worker", navigator.serviceWorker?.controller ? "controlling" : "none");

  const rows = timeline();
  const before = lastSession();

  // The previous session first, because it is usually the interesting one: the
  // launch that hung is the launch you killed the app to get out of, so by the
  // time this screen is open it is already history.
  const past = before
    ? `---- previous session, ${new Date(before.at).toISOString()} `
      + `(${before.events.length} events) ----\n\n${format(before.events)}\n\n`
    : "";

  return `${lines.join("\n")}\n\n${past}`
    + `---- this session (${rows.length} events) ----\n\n${format(rows)}\n`;
}
