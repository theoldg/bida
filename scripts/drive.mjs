/**
 * A text-mode driver: a live session you send one command at a time and that
 * answers with the screen written out in words. Anything you would otherwise
 * open a browser to do — reproduce a bug, check a screen after a change, watch
 * two phones disagree — you can do here, in a terminal, without a screenshot.
 *
 * Its first use is the one it is shaped by: handing an agent the app the way a
 * stranger gets it, so it has to work out what to do from what is on screen.
 * That is why nothing here speaks the app's vocabulary — no `#g-name`, no
 * `newGroup`. Every control is a number the last screen just handed you.
 *
 * It runs as a daemon because the alternative is replaying the whole story to
 * take one more step, and IndexedDB, the service worker and a group's history
 * do not survive that honestly. One process holds the Worker, the browser and
 * every phone; commands arrive by file and answers go back the same way.
 *
 *   pnpm drive start &                  # holds the session open
 *   pnpm drive do "goto /" "click 3"
 *   pnpm drive stop
 *
 * Commands:
 *   as <who>            switch phone, creating it on first mention
 *   goto <path>         open a path on the app's own origin
 *   click <n>           press the control numbered <n> on the last screen
 *   fill <n> <text>     type into field <n>
 *   select <n> <label>  choose an option by its visible text
 *   press <Key>         a raw key, e.g. Enter, Escape
 *   hold <n>            long-press it, for menus a tap cannot open
 *   back | forward | reload | screen | wait <ms>
 *   offline on|off      cut this phone's network, or restore it
 *   clipboard           read what the page put on this phone's clipboard
 *   forget              throw this phone away and start it factory-fresh
 *   html [n]            markup and computed style — for calibrating the reader
 *                       below, and off limits to anyone testing blind
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, ensureBuild, serveWorker, launch, newPhone } from "./lib/harness.mjs";

const DIR = join(ROOT, ".drive");
const IN = join(DIR, "in.jsonl");
const RESP = join(DIR, "resp");
const READY = join(DIR, "ready.json");

/* ---- reading the screen ------------------------------------------------- */

/**
 * The page as experienced rather than as written.
 *
 * Four things separate this from dumping `innerText`, and each of them was a
 * wrong answer this script gave before it did them:
 *
 *  - **Layout decides the lines, not tags.** The app writes `<span>` with
 *    `display:block` all over, so a tag list ran "Split" into "3 people".
 *    Computed `display` is the only thing that knows where a line ends.
 *  - **What a modal covers is not on the screen.** With a sheet open the
 *    reader offered every control behind it, and an agent obligingly pressed
 *    something no finger could reach. Reachability is now hit-tested.
 *  - **A phone is 844px tall.** Content under the fold is real but unread;
 *    saying so is often the finding itself.
 *  - **CSS is also text.** `text-transform` is what a person actually reads,
 *    and `text-overflow` is what they never get to. Screen-reader-only text —
 *    Next's route announcer, visually-hidden labels — is read out here as
 *    though it were on the page, so it is left out.
 */
const READ = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = [];        // { text, where } in document order
  let n = 0, line = "", lineWhere = "on", alerts = 0;

  // Numbers are handed out fresh every read, so the last read's have to go
  // first. They used to linger, and a sheet is where that bit: its five options
  // took 1-5 while the form behind them still wore 1-20, so \`click 1\` matched
  // the older element, waited for a control under the scrim to become
  // pressable, and timed out. Same stale numbers were what \`html <n>\` read.
  for (const el of document.querySelectorAll("[data-drive]")) el.removeAttribute("data-drive");

  // A native modal makes the rest of the document inert, which is exactly the
  // question being asked; :modal answers it without knowing the app's classes.
  const modal = [...document.querySelectorAll("dialog[open]")].filter((d) => d.matches(":modal")).pop() ?? null;
  let behind = 0;

  const BLOCKISH = new Set(["block", "flow-root", "list-item", "table", "table-row", "table-caption", "flex", "grid"]);
  const CONTROL = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  // Sets whose members are alternatives rather than separate offers. Reading
  // them out as loose buttons loses the only thing that matters about them:
  // that they are one question, and which answer is currently given.
  const SETS = { tablist: "tabs", radiogroup: "options", listbox: "list", menu: "menu", tabs: "tabs" };

  const isControl = (el) => CONTROL.has(el.tagName) || el.getAttribute("role") === "button";

  const breaks = (el, style, parentStyle) =>
    el.tagName === "BR" || BLOCKISH.has(style.display) ||
    // A flex or grid item is a block box whatever it was written as.
    (parentStyle && ["flex", "grid", "inline-flex", "inline-grid"].includes(parentStyle.display));

  /** Visually hidden but still spoken: real to a screen reader, absent to an eye. */
  const srOnly = (style, r) =>
    style.clipPath === "inset(50%)" ||
    style.clip === "rect(0px, 0px, 0px, 0px)" ||
    (style.position === "absolute" && (r.width <= 1 || r.height <= 1) &&
     (style.overflow === "hidden" || style.overflow === "clip"));

  const hidden = (el, style) =>
    style.display === "none" || style.visibility === "hidden" || style.opacity === "0" ||
    el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true" || el.inert;

  const cased = (text, style) => {
    const t = style.textTransform;
    if (t === "uppercase") return text.toUpperCase();
    if (t === "lowercase") return text.toLowerCase();
    if (t === "capitalize") return text.replace(/\\b\\p{L}/gu, (c) => c.toUpperCase());
    return text;
  };

  /** Where a person's finger would land: on it, past the fold, or nowhere. */
  const reach = (el) => {
    if (modal && !modal.contains(el)) return "behind";
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return "behind";
    if (r.bottom <= 0) return "above";
    if (r.top >= vh) return "below";
    const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return "behind";
    return el.contains(hit) || hit.contains(el) ? "on" : "covered";
  };

  /** Text the box is too narrow to show — the ellipsis a person actually sees. */
  const clipped = (el, style) =>
    (style.overflow === "hidden" || style.overflow === "clip") && el.scrollWidth > el.clientWidth + 1;

  const flush = () => {
    const t = line.replace(/[^\\S\\n]+/g, " ").replace(/ ?\\n ?/g, "\\n").trim();
    if (t) out.push({ text: alerts ? \`  ‼ \${t}\` : t, where: lineWhere });
    line = "";
  };

  /** Content drawn by CSS rather than written in the markup, e.g. separators. */
  const pseudo = (el, which) => {
    const c = getComputedStyle(el, which).content;
    if (!c || c === "none" || c === "normal" || c.startsWith("url") || c.includes("counter")) return "";
    const text = c.replace(/^["']|["']$/g, "");
    // Icon fonts live in the private use area and mean nothing written down.
    return /[\\uE000-\\uF8FF]/.test(text) ? "" : text;
  };

  /**
   * A control's label, kept on the lines its layout gives it and then joined
   * with a separator: "Dinner | Ana paid · split 3 ways | €120.00" reads, while
   * the same words run together do not.
   */
  const labelOf = (el) => {
    const parts = [];
    const gather = (node, parentStyle) => {
      if (node.nodeType === 3) {
        const t = cased(node.nodeValue, parentStyle).replace(/\\s+/g, " ");
        if (t.trim()) parts.push({ text: t, br: false });
        return;
      }
      if (node.nodeType !== 1) return;
      const style = getComputedStyle(node);
      if (hidden(node, style) || srOnly(style, node.getBoundingClientRect())) return;
      const br = breaks(node, style, parentStyle);
      if (br) parts.push({ text: "", br: true });
      const before = pseudo(node, "::before");
      if (before) parts.push({ text: before, br: false });
      for (const c of node.childNodes) gather(c, style);
      const after = pseudo(node, "::after");
      if (after) parts.push({ text: after, br: false });
      if (clipped(node, style)) parts.push({ text: "…", br: false });
      if (br) parts.push({ text: "", br: true });
    };
    gather(el, getComputedStyle(el.parentElement ?? el));
    const lines = [];
    let cur = "";
    for (const p of parts) {
      if (p.br) { if (cur.trim()) lines.push(cur.trim()); cur = ""; } else cur += p.text;
    }
    if (cur.trim()) lines.push(cur.trim());
    const joined = lines.join(" | ").replace(/\\s+/g, " ").trim();
    if (joined) return { text: joined, spoken: false };
    // An icon-only control's accessible name is the whole of what it offers.
    // Saying where the name came from is the difference between "this button is
    // fine" and "this button is a mystery to anyone not looking at the icon".
    return { text: el.getAttribute("aria-label") || el.title || el.querySelector("img")?.alt || "", spoken: true };
  };

  const field = (el) => {
    const named = el.getAttribute("aria-label") || el.placeholder || el.name || "";
    if (el.tagName === "SELECT")
      return \`select "\${named}" = \${JSON.stringify(el.selectedOptions[0]?.text ?? "")} of [\${[...el.options].map((o) => o.text).join(" | ")}]\`;
    if (el.type === "checkbox" || el.type === "radio") return \`\${el.type} "\${named}" \${el.checked ? "[x]" : "[ ]"}\`;
    const kind = el.tagName === "TEXTAREA" ? "textarea" : \`input \${el.type}\`;
    return \`\${kind} "\${named}" = \${el.value ? JSON.stringify(el.value) : "(empty)"}\${el.readOnly ? " (read-only)" : ""}\`;
  };

  /** What the control itself claims about being the chosen one; null if silent. */
  const chosenSays = (el) => {
    for (const a of ["aria-selected", "aria-checked", "aria-pressed"]) {
      const v = el.getAttribute(a);
      if (v === "true") return true;
      if (v === "false") return false;
    }
    const cur = el.getAttribute("aria-current");
    if (cur) return cur !== "false";
    if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) return el.checked;
    return null;
  };

  /** How a control is painted — the difference a person reads as "this one". */
  const look = (el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.color, s.fontWeight, s.borderBottomColor, s.boxShadow, s.opacity].join("|");
  };

  /**
   * The odd one out of a set of look-alikes, or -1.
   *
   * The app marks some of its choice sets with ARIA and paints others without
   * saying anything, so appearance is the fallback — and when the fallback is
   * what answered, the dump says so, because a control that is only visibly
   * selected is a finding rather than a detail.
   */
  const oddOne = (els) => {
    const looks = els.map(look);
    const tally = new Map();
    for (const l of looks) tally.set(l, (tally.get(l) ?? 0) + 1);
    if (tally.size !== 2) return -1;
    const rare = [...tally].find(([, count]) => count === 1);
    return rare ? looks.indexOf(rare[0]) : -1;
  };

  /** Number a control and describe it. Returns its rendered text, or "" if unreachable. */
  const emit = (el) => {
    const where = reach(el);
    if (where === "behind" || where === "covered") { behind++; return null; }
    // Only what a finger can reach gets a number. A control you cannot press is
    // not an option, and numbering it invites pressing it anyway.
    el.setAttribute("data-drive", String(++n));
    const isField = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const name = isField ? null : labelOf(el);
    const what = isField
      ? field(el)
      : \`\${el.tagName === "A" ? "link" : el.tagName.toLowerCase()} \${name.text ? \`"\${name.text}"\` : "(NO ACCESSIBLE NAME)"}\`;
    const flags = [
      name?.spoken && name.text ? "icon only" : "",
      el.disabled ? "disabled" : "",
      el === document.activeElement ? "focused" : "",
    ].filter(Boolean);
    return { where, text: \`[\${n}] \${what}\${flags.length ? \` (\${flags.join(", ")})\` : ""}\` };
  };

  /**
   * A set of alternatives, read as one question. Short sets go on a line, long
   * ones stack, and either way the chosen answer is marked rather than left for
   * the reader to infer from four buttons that look alike in text.
   */
  const emitSet = (kids, kind, name) => {
    const says = kids.map(chosenSays);
    let chosen = says.indexOf(true);
    let byLook = false;
    if (chosen < 0 && !says.some((v) => v !== null)) {
      chosen = oddOne(kids);
      byLook = chosen >= 0;
    }
    const rows = kids.map((el, i) => {
      const got = emit(el);
      if (!got) return null;
      const mark = chosen < 0 ? "" : i === chosen ? "(•) " : "( ) ";
      return { ...got, text: mark + got.text };
    }).filter(Boolean);
    if (!rows.length) return;

    const header = \`\${SETS[kind] ?? "choice"}\${name ? \` "\${name}"\` : ""}\${byLook ? " — selection shown only by styling, not to a screen reader" : ""}\${chosen < 0 && !byLook ? " — nothing marked as chosen" : ""}\`;
    const oneLine = rows.map((r) => r.text).join("   ");
    if (rows.length <= 6 && oneLine.length <= 96 && rows.every((r) => r.where === rows[0].where)) {
      out.push({ text: \`  \${header}: \${oneLine}\`, where: rows[0].where });
      return;
    }
    out.push({ text: \`  \${header}:\`, where: rows[0].where });
    for (const r of rows) out.push({ text: \`    \${r.text}\`, where: r.where });
  };

  const walk = (node, parentStyle) => {
    if (node.nodeType === 3) { line += cased(node.nodeValue, parentStyle); return; }
    if (node.nodeType !== 1) return;
    const el = node, tag = el.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg", "IFRAME"].includes(tag)) return;

    const style = getComputedStyle(el);
    if (hidden(el, style)) return;
    const rect = el.getBoundingClientRect();
    if (srOnly(style, rect)) return;
    if (rect.width === 0 && rect.height === 0 && el.children.length === 0 && tag !== "INPUT") return;

    if (isControl(el)) {
      flush();
      const got = emit(el);
      if (got) out.push({ text: \`  \${got.text}\`, where: got.where });
      return;
    }

    // A set of alternatives is read as one thing, so it is taken here rather
    // than met one button at a time on the way down.
    const role = el.getAttribute("role");
    const kids = [...el.children].filter((c) => isControl(c) && !hidden(c, getComputedStyle(c)));
    if (kids.length >= 2 && kids.length === el.children.length &&
        (SETS[role] || (new Set(kids.map((k) => k.tagName)).size === 1 && oddOne(kids) >= 0))) {
      flush();
      emitSet(kids, role, el.getAttribute("aria-label") ?? "");
      return;
    }

    const heading = /^H[1-6]$/.test(tag);
    const br = breaks(el, style, parentStyle);
    if (br || heading) flush();
    // Text under a modal's scrim is not on the screen either, so the line it
    // would contribute is dropped below. Text merely under a small popup still
    // is on the screen, which is why only \`behind\` disqualifies it.
    lineWhere = reach(el);
    // A live region is the app raising its voice; the dump does the same.
    const shouts = role === "alert" || role === "status";
    if (shouts) alerts++;
    const before = pseudo(el, "::before");
    if (before) line += before;
    for (const child of el.childNodes) walk(child, style);
    const after = pseudo(el, "::after");
    if (after) line += after;
    if (clipped(el, style)) line += "…";
    if (heading) { const t = line.replace(/\\s+/g, " ").trim(); line = ""; if (t) out.push({ text: \`# \${t}\`, where: lineWhere }); }
    else if (br) flush();
    if (shouts) alerts--;
  };

  walk(document.body, getComputedStyle(document.body));
  flush();

  // Group the lines by reachability, in the order a person meets them: what is
  // on the screen, then what a scroll would bring, then a count of the rest.
  const lines = [];
  let last = null;
  const LABEL = { above: "↑ scrolled past, above the screen", below: "↓ below the fold — a scroll away" };
  for (const item of out) {
    if (item.where === "behind") continue;
    if (item.where !== last && LABEL[item.where]) lines.push(\`── \${LABEL[item.where]} ──\`);
    else if (item.where === "on" && last && last !== "on") lines.push("── back on screen ──");
    last = item.where;
    lines.push(item.text);
  }
  // Keyboard is the only way into some controls, so where focus sits is part of
  // the screen. A numbered control wears it as "(focused)"; anywhere else there
  // is nothing to hang it on, and saying nothing reads as "nothing is focused"
  // when it may equally mean "focus is somewhere your key press will go".
  const active = document.activeElement;
  if (!active || active === document.body) lines.push("── nothing has keyboard focus ──");
  else if (!active.hasAttribute("data-drive"))
    lines.push(\`── keyboard focus is on <\${active.tagName.toLowerCase()}>, not a numbered control ──\`);

  if (modal) lines.unshift(\`── a sheet is open\${modal.getAttribute("aria-label") ? \`: "\${modal.getAttribute("aria-label")}"\` : ""} — only what is in it can be pressed ──\`);
  if (behind) lines.push(\`── \${behind} control\${behind === 1 ? "" : "s"} out of reach behind it ──\`);
  return { url: location.href, title: document.title, lines };
})()`;

/* ---- the daemon --------------------------------------------------------- */

async function start() {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(RESP, { recursive: true });
  writeFileSync(IN, "");

  ensureBuild();
  console.log("starting the Worker (static export + sync API on one origin)…");
  const { base, close } = await serveWorker({ state: join(DIR, "d1") });
  const browser = await launch();
  console.log(`ready on ${base} — send commands with: pnpm drive do "goto /"`);
  writeFileSync(READY, JSON.stringify({ pid: process.pid, base }));

  const phones = new Map();
  let current = "me";

  /** A phone belongs to one person: its own storage, its own device identity. */
  const phone = async (who) => {
    if (!phones.has(who)) {
      // The invite link reaches the next person through the clipboard, so a
      // phone that cannot read its own clipboard cannot follow the app's
      // central journey.
      const ctx = await newPhone(browser, { permissions: ["clipboard-read", "clipboard-write"] });
      const page = await ctx.newPage();
      const noise = [];
      page.on("pageerror", (e) => noise.push(`page error: ${e.message.split("\n")[0]}`));
      page.on("console", (m) => { if (m.type() === "error") noise.push(`console error: ${m.text().slice(0, 300)}`); });
      page.on("requestfailed", (r) => {
        const why = r.failure()?.errorText ?? "";
        // An offline phone failing to reach the API is the test, not news.
        if (!why.includes("ERR_INTERNET_DISCONNECTED")) noise.push(`request failed: ${r.url().replace(base, "")} (${why})`);
      });
      phones.set(who, { ctx, page, noise });
    }
    return phones.get(who);
  };

  const stop = async () => { await browser.close(); close(); rmSync(READY, { force: true }); process.exit(0); };

  const run = async (line) => {
    const [head, ...rest] = line.trim().split(/\s+/);
    let verb = head, args = rest;
    if (verb === "as") { current = args[0]; [verb, ...args] = args.slice(1); }
    const who = current;
    const { page, ctx, noise } = await phone(who);
    const arg = args.join(" ");

    /**
     * The control a number names, or a reason it names none.
     *
     * Both ways of getting this wrong used to arrive as the same five-second
     * timeout, and they want opposite responses: a number nobody handed out
     * means read the screen again, while a number matching twice means this
     * script lost track and no press should be guessed at. Playwright is told
     * `strict` as well, because the page can re-render between counting and
     * pressing and a wrong press is worse than a failed one.
     */
    const target = async (n) => {
      const sel = `[data-drive="${Number(n)}"]`;
      const found = await page.locator(sel).count();
      if (found === 0) throw new Error(`nothing is numbered ${n} on this screen — read it again`);
      if (found > 1) throw new Error(`${n} names ${found} controls — the screen was read wrong`);
      return sel;
    };

    switch (verb) {
      case undefined: case "screen": break;
      case "goto": await page.goto(arg.startsWith("http") ? arg : base + (arg.startsWith("/") ? arg : `/${arg}`), { waitUntil: "domcontentloaded" }); break;
      case "click": await page.click(await target(args[0]), { timeout: 5000, strict: true }); break;
      case "fill": await page.fill(await target(args[0]), args.slice(1).join(" "), { strict: true }); break;
      case "select": await page.selectOption(await target(args[0]), { label: args.slice(1).join(" ") }, { strict: true }); break;
      case "press": await page.keyboard.press(args[0]); break;
      // Some actions live behind a long press and nowhere else, so a driver
      // that can only click cannot reach them at all. A right click is the
      // same `contextmenu` event a touch hold sends.
      case "hold": await page.click(await target(args[0]), { button: "right", strict: true }); break;
      case "back": await page.goBack(); break;
      case "forward": await page.goForward(); break;
      case "reload": await page.reload(); break;
      case "wait": await page.waitForTimeout(Number(args[0] ?? 500)); break;
      case "offline": await ctx.setOffline(args[0] !== "off"); break;
      case "forget": await ctx.close(); phones.delete(who); return { who, url: "(phone thrown away)", title: "", lines: [], noise: [] };
      case "clipboard": {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        return { who, url: page.url().replace(base, ""), title: "", lines: [`clipboard: ${text}`], noise: noise.splice(0) };
      }
      case "html": {
        const dump = await page.evaluate((sel) => {
          const seen = [];
          const walk = (el, depth) => {
            const s = getComputedStyle(el);
            const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.nodeValue.trim()).filter(Boolean).join(" / ");
            const aria = [...el.attributes].filter((a) => a.name === "role" || a.name.startsWith("aria-") || a.name === "type" || a.name === "name").map((a) => ` ${a.name}="${a.value}"`).join("");
            seen.push(`${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? ` class="${el.className}"` : ""}${aria}> display:${s.display}${s.position !== "static" ? ` pos:${s.position}` : ""}${s.overflow !== "visible" ? ` overflow:${s.overflow}` : ""}${s.textTransform !== "none" ? ` case:${s.textTransform}` : ""} :: ${own.slice(0, 90)}`);
            for (const c of el.children) walk(c, depth + 1);
          };
          walk(document.querySelector(sel), 0);
          return seen.join("\n");
        }, args[0] ? await target(args[0]) : "body");
        return { who, url: page.url().replace(base, ""), title: "", lines: dump.split("\n"), noise: [] };
      }
      default: throw new Error(`no such command: ${verb}`);
    }

    // Long enough for a render and a sync round trip, short enough to stay a
    // conversation. `screen` again is how to see what a slow thing settled into.
    await page.waitForTimeout(verb === "goto" || verb === "reload" ? 700 : 350);
    const seen = await page.evaluate(READ);
    return { ...seen, who, url: seen.url.replace(base, ""), noise: noise.splice(0) };
  };

  let done = 0;
  for (;;) {
    const lines = readFileSync(IN, "utf8").split("\n").filter(Boolean);
    for (; done < lines.length; done++) {
      const { seq, cmd } = JSON.parse(lines[done]);
      if (cmd === "stop") { writeFileSync(join(RESP, `${seq}.txt`), "stopped\n"); await stop(); }
      let body;
      try {
        const s = await run(cmd);
        body = [
          "=".repeat(72),
          `${s.who} · ${s.url}${s.title ? ` · "${s.title}"` : ""}`,
          "-".repeat(72),
          ...(s.lines.length ? s.lines : ["(blank screen)"]),
          ...s.noise.map((w) => `  !! ${w}`),
        ].join("\n");
      } catch (e) {
        body = `!! "${cmd}" did not work: ${e.message.split("\n")[0]}`;
      }
      writeFileSync(join(RESP, `${seq}.txt`), `${body}\n`);
    }
    await new Promise((ok) => setTimeout(ok, 80));
  }
}

/* ---- the client --------------------------------------------------------- */

function send(commands) {
  if (!existsSync(READY)) {
    console.error("no session running — start one with: pnpm drive start &");
    process.exit(1);
  }
  let seq = readFileSync(IN, "utf8").split("\n").filter(Boolean).length;
  return commands.map((cmd) => {
    appendFileSync(IN, `${JSON.stringify({ seq, cmd })}\n`);
    return { seq: seq++, cmd };
  });
}

async function collect(wanted) {
  for (const { seq, cmd } of wanted) {
    const file = join(RESP, `${seq}.txt`);
    const deadline = Date.now() + 60_000;
    while (!existsSync(file)) {
      if (Date.now() > deadline) { console.error(`timed out waiting for: ${cmd}`); process.exit(1); }
      await new Promise((ok) => setTimeout(ok, 80));
    }
    console.log(`\n$ ${cmd}`);
    process.stdout.write(readFileSync(file, "utf8"));
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "start") await start();
else if (mode === "do") await collect(send(rest));
else if (mode === "stop") await collect(send(["stop"]));
else { console.error("usage: drive.mjs start | do <command>… | stop"); process.exit(1); }
