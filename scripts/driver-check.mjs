#!/usr/bin/env node
/**
 * `pnpm driver` — the text driver (`pnpm drive`, docs/drive.md) still starts,
 * reads a screen, presses what it numbered, photographs in both themes, keeps
 * two phones apart, refuses a stale number and stops.
 *
 * It is how an agent looks at the app, and nothing else runs it: a driver that
 * rotted would be found by the next agent who needed it, mid-task. This drives
 * it the way that agent does — through `start`, `do` and `stop` — in a
 * directory of its own, so a session already open is left alone.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, ensureBuild, reporter } from "./lib/harness.mjs";

const { report: said, finish } = reporter(null);
// A screen is long; it is worth printing only beside a failure.
const report = (ok, label, detail) => said(ok, label, ok ? undefined : detail);
const DIR = mkdtempSync(join(tmpdir(), "drive-check-"));
const env = { ...process.env, DRIVE_DIR: DIR };
const SCRIPT = join(ROOT, "scripts/drive.mjs");

ensureBuild();
const daemon = spawn("node", [SCRIPT, "start"], { env, stdio: ["ignore", "pipe", "inherit"] });
let log = "";
daemon.stdout.on("data", (d) => { log += d; });
const exited = new Promise((ok) => daemon.on("exit", ok));

const until = async (test, ms) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (test()) return true;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return false;
};

/** One `pnpm drive …`, as an agent sends it. */
const drive = (mode, ...cmds) =>
  spawnSync("node", [SCRIPT, mode, ...cmds], { env, encoding: "utf8", timeout: 90_000 }).stdout ?? "";
const run = (...cmds) => drive("do", ...cmds);
/** The number the last screen gave the control whose line matches. */
const numbered = (screen, re) => screen.split("\n").find((l) => re.test(l))?.match(/\[(\d+)\]/)?.[1];

try {
  const ready = await until(() => existsSync(join(DIR, "ready.json")), 120_000);
  report(ready, "start: the session comes up", ready ? undefined : log.slice(-400));
  if (!ready) throw new Error("no session");

  const demo = run("goto /demo");
  report(demo.includes("# Passage to Alderaan") && /\[\d+\] link /.test(demo),
    "goto: the screen comes back as text, its controls numbered", demo.slice(0, 400));
  report(!demo.includes("!!"), "and with nothing wrong beside it", demo.match(/.*!!.*/g)?.join("\n"));

  const form = run(`click ${numbered(demo, /"Add an entry"/)}`);
  report(form.includes("/g/entry/edit") && /\(•\) \[\d+\] button "Evenly"/.test(form),
    "click: presses what the number named, and a set reads with its choice marked", form.slice(0, 400));

  const typed = run(`type ${numbered(form, /input text "Amount/)} 90`);
  report(/input text "Amount[^"]*" = "90/.test(typed), "type: keys reach the field", typed.match(/.*Amount.*/)?.[0]);

  const shots = run("shot light", "theme dark", "shot dark");
  const light = join(DIR, "shots/light.png"), dark = join(DIR, "shots/dark.png");
  const both = existsSync(light) && existsSync(dark);
  report(both && statSync(light).size > 1000, "shot: a picture lands in the session's shots/", shots.slice(-300));
  report(both && !readFileSync(light).equals(readFileSync(dark)), "theme dark: and the second is the other look");

  const stale = run("click 999", "screen");
  report(stale.includes("nothing is numbered 999"), "a number never handed out is refused, not guessed at", stale);
  report(stale.includes("not run: the command before it failed"), "and the rest of that batch is dropped");

  const other = run("as bruno goto /");
  report(/^bruno · /m.test(other) && !other.includes("Passage to Alderaan"),
    "as: a second name is a second phone, with nothing of the first", other.slice(0, 300));
  report(run("as me screen").includes("/g/entry/edit"), "and the first is where it was left");

  report(run("fly 3").includes("no such command: fly"), "an unknown command says so");

  report(drive("stop").includes("stopped"), "stop: answers");
  report(await until(() => daemon.exitCode !== null, 20_000), "and the daemon exits, taking its browser and Worker");
} catch (e) {
  report(false, "the driver run ended early", e.message);
} finally {
  if (daemon.exitCode === null) { daemon.kill(); await exited; }
  rmSync(DIR, { recursive: true, force: true });
}
finish();
