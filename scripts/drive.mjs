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
 *   fill <n> <text>     put a value in field <n> in one go
 *   type <n> <text>     key it in one character at a time, at the caret
 *   select <n> <label>  choose an option by its visible text
 *   press <Key> [times] a raw key, e.g. Enter, Escape, Backspace 3
 *   hold <n>            long-press it, for menus a tap cannot open
 *   back | forward | reload | screen | wait <ms>
 *   offline on|off      cut this phone's network, or restore it
 *   receipt <name>      hand this phone a canned receipt — see `receipt list`
 *                       (it answers a bill typed into "Type it in" as well)
 *   clipboard           read what the page put on this phone's clipboard
 *   forget              throw this phone away and start it factory-fresh
 *   html [n]            markup and computed style — for calibrating the reader
 *                       below, and off limits to anyone testing blind
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, ensureBuild, serveWorker, launch, newPhone } from "./lib/harness.mjs";
import { PHOTO, receiptList, stubScan } from "./lib/receipts.mjs";

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

  /**
   * A scrim: something laid over the whole screen, swallowing the taps meant
   * for what is under it. Not every sheet is a \`<dialog>\` — the row menu is a
   * fixed veil with a \`role="menu"\` beside it, so \`:modal\` never saw it and
   * the dump went on reading out the ledger behind it as though a finger could
   * reach it. The hit test already knew better; this asks it.
   *
   * Walking up from what is painted at the centre finds only what is genuinely
   * on top: a full-screen layer *behind* the content is never an ancestor of
   * the element the point lands on.
   */
  const veil = (() => {
    if (modal) return null;
    for (let el = document.elementFromPoint(vw / 2, vh / 2); el; el = el.parentElement) {
      if (getComputedStyle(el).position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.9 && r.height >= vh * 0.9) return el;
    }
    return null;
  })();

  /** The sheet the scrim belongs to, for naming it — it sits beside the veil, not inside it. */
  const overlay = veil
    ? [...document.querySelectorAll('[role="menu"],[role="dialog"],[role="listbox"]')]
        .filter((el) => el !== veil && getComputedStyle(el).position === "fixed").pop() ?? null
    : null;

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
    if (el.contains(hit) || hit.contains(el)) return "on";
    // Under a scrim there is nothing to distinguish from being behind a modal:
    // it is off the screen a person has. Without one, something small is merely
    // sitting on top — a floating button over a row — and the row is still there.
    return veil ? "behind" : "covered";
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
   * Same-tag siblings painted in exactly two ways: the shape of a segmented
   * control, whether or not it says so in ARIA. This only asks whether they
   * are one question; \`oddOne\` is what answers it.
   *
   * An option a person picks has words on it, and the members of one set are
   * labelled the same way — which is what separates a segmented control from a
   * control standing between two fields. The transfer's two sides and the swap
   * button between them are three buttons painted two ways, and were read out
   * as a question whose answer was the swap: an invented choice, marked on the
   * one control that was not an option at all.
   */
  const alternatives = (els) => {
    const words = (el) => (el.innerText ?? "").trim().length > 0;
    return new Set(els.map((e) => e.tagName)).size === 1
      && new Set(els.map(look)).size === 2
      && new Set(els.map(words)).size === 1;
  };

  /**
   * The odd one out of a set of look-alikes, or -1.
   *
   * The app marks some of its choice sets with ARIA and paints others without
   * saying anything, so appearance is the fallback — and when the fallback is
   * what answered, the dump says so, because a control that is only visibly
   * selected is a finding rather than a detail.
   *
   * Two is not a set with an odd one out: both members differ from the other
   * one, and the tally cannot tell them apart. It answered anyway, and always
   * with the first — under a header that then swore the styling had said so,
   * which is worse than saying nothing. Three is the smallest number with a
   * majority to be odd against.
   */
  const oddOne = (els) => {
    if (els.length < 3) return -1;
    const looks = els.map(look);
    const tally = new Map();
    for (const l of looks) tally.set(l, (tally.get(l) ?? 0) + 1);
    if (tally.size !== 2) return -1;
    const rare = [...tally].find(([, count]) => count === 1);
    return rare ? looks.indexOf(rare[0]) : -1;
  };

  /** Number a control and describe it. Returns its rendered text, or "" if unreachable. */
  const emit = (el, inSet = false) => {
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
      // A control on its own can still say it is the chosen one — the row you
      // picked, the page you are on. Inside a set the (•) already says it, and
      // saying it twice reads as two different claims.
      !inSet && chosenSays(el) === true ? "chosen" : "",
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
      const got = emit(el, true);
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
    if (kids.length >= 2 && kids.length === el.children.length && (SETS[role] || alternatives(kids))) {
      flush();
      emitSet(kids, role, el.getAttribute("aria-label") ?? "");
      return;
    }

    const heading = /^H[1-6]$/.test(tag);
    const br = breaks(el, style, parentStyle);
    if (br || heading) flush();
    // Text under a scrim is not on the screen either — \`reach\` calls it
    // \`behind\`, and the line it would contribute is dropped below. Text merely
    // under a small popup still is, which is what \`covered\` keeps separate.
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
    // Only a fold has a far side to come back from. This used to fire off the
    // end of a \`covered\` run too, announcing a return from somewhere the dump
    // had never said you were.
    else if (item.where === "on" && LABEL[last]) lines.push("── back on screen ──");
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

  const sheet = modal ?? overlay ?? veil;
  if (sheet) {
    const named = sheet.getAttribute("aria-label");
    lines.unshift(\`── a sheet is open\${named ? \`: "\${named}"\` : ""} — only what is listed can be pressed ──\`);
  }
  if (behind) lines.push(\`── \${behind} control\${behind === 1 ? "" : "s"} out of reach\${sheet ? " behind it" : ""} ──\`);
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
      // An offline phone failing to reach the API is the test, not news — and
      // it arrives twice, as a failed request and as the console error the
      // browser logs beside it. Both are dropped, or `offline on` answers
      // every command with a warning about the thing you just asked for.
      const offlineChatter = (text) => text.includes("ERR_INTERNET_DISCONNECTED");
      page.on("pageerror", (e) => noise.push(`page error: ${e.message.split("\n")[0]}`));
      page.on("console", (m) => {
        if (m.type() === "error" && !offlineChatter(m.text())) noise.push(`console error: ${m.text().slice(0, 300)}`);
      });
      page.on("requestfailed", (r) => {
        const why = r.failure()?.errorText ?? "";
        if (!offlineChatter(why)) noise.push(`request failed: ${r.url().replace(base, "")} (${why})`);
      });
      phones.set(who, { ctx, page, noise, chooser: null });
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
      // `fill` sets a value; it does not type one. The amount field regroups
      // digits and puts the caret back on every keystroke, and a whole value
      // dropped in fires that once — so the code the owner most wants stressed
      // was the code `fill` could not reach. This keys it in one character at a
      // time, at the caret, which is also how `press Backspace` gets to run
      // against a separator it has to delete through.
      case "type": await page.locator(await target(args[0])).pressSequentially(args.slice(1).join(" "), { delay: 20, timeout: 5000 }); break;
      case "select": await page.selectOption(await target(args[0]), { label: args.slice(1).join(" ") }, { strict: true }); break;
      case "press": for (let i = Math.max(1, Number(args[1] ?? 1)); i > 0; i--) await page.keyboard.press(args[0]); break;
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
      // Scanning is the only thing the app does that needs both a camera and
      // a network, so a driver that can only press buttons cannot reach the
      // who-had-what grid at all. This is the world the phone photographs,
      // in the same family as `offline` — it arms nothing on the screen. The
      // scan button is still the app's own, pressed by number like any other:
      // the hidden file input's click opens a real chooser, and this answers
      // it with a real (1x1) photo the client really downscales.
      case "receipt": {
        const say = (lines) => ({ who, url: page.url().replace(base, ""), title: "", lines, noise: noise.splice(0) });
        if (!args[0] || args[0] === "list") return say(["receipts on offer:", ...receiptList()]);
        if (args[0] === "off") {
          await page.unroute("**/api/groups/*/scan").catch(() => {});
          if (phones.get(who).chooser) page.off("filechooser", phones.get(who).chooser);
          phones.get(who).chooser = null;
          return say(["this phone scans for real again — which needs a key it hasn't got"]);
        }
        const fixture = await stubScan(page, args[0]);
        // Persistent, not one-shot: rescanning is a thing people do, and an
        // arming spent by the first press would answer the second with the
        // silence of a cancelled chooser.
        if (!phones.get(who).chooser) {
          const answer = (chooser) => chooser
            .setFiles({ name: "receipt.png", mimeType: "image/png", buffer: PHOTO })
            .catch(() => { /* the page moved on; the next press arms again */ });
          phones.get(who).chooser = answer;
          page.on("filechooser", answer);
        }
        return say([
          `the next bill this phone reads answers as "${args[0]}" (${fixture.exercises}) — ${fixture.note}`,
          "press the app's own scan or upload button; a scan is a round trip, so read the screen again if it is still working",
          "the stub answers a typed bill too: press \"Type it in\", fill the box and press \"Read it\"",
        ]);
      }
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
  // The batch a command failed in. Everything after a failure was written
  // against a screen that never arrived: the numbers in it mean something else
  // now, and carrying on presses whatever happens to be wearing them — which
  // one day is Delete. A batch stops at its first failure and says so.
  let aborted = null;
  for (;;) {
    const lines = readFileSync(IN, "utf8").split("\n").filter(Boolean);
    for (; done < lines.length; done++) {
      const { seq, batch, cmd } = JSON.parse(lines[done]);
      if (cmd === "stop") { writeFileSync(join(RESP, `${seq}.txt`), "stopped\n"); await stop(); }
      if (batch !== undefined && batch === aborted) {
        writeFileSync(join(RESP, `${seq}.txt`), `-- "${cmd}" not run: the command before it failed\n`);
        continue;
      }
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
        aborted = batch;
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
  // One `do` is one batch, so the daemon can drop the rest of it when a command
  // in it fails. The first sequence number names it: unique without agreeing
  // on anything, and readable in the file when something needs explaining.
  const batch = seq;
  return commands.map((cmd) => {
    appendFileSync(IN, `${JSON.stringify({ seq, batch, cmd })}\n`);
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
