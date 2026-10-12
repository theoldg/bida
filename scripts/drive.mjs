/**
 * The app as text, a daemon answering each command with the screen in words —
 * docs/drive.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, ensureBuild, serveWorker, launch, newPhone } from "./lib/harness.mjs";
import { PHOTO, receiptList, stubScan } from "./lib/receipts.mjs";

// `DRIVE_DIR` lets a second session run beside yours.
const DIR = process.env.DRIVE_DIR ?? join(ROOT, ".drive");
const IN = join(DIR, "in.jsonl");
const RESP = join(DIR, "resp");
const READY = join(DIR, "ready.json");

/* ---- reading the screen ------------------------------------------------- */

const READ = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = [];        // { text, where } in document order
  let n = 0, line = "", lineWhere = "on", alerts = 0;

  // Stale numbers let \`click 1\` match an element under a scrim and time out.
  for (const el of document.querySelectorAll("[data-drive]")) {
    el.removeAttribute("data-drive");
    el.removeAttribute("data-drive-at");
    el.removeAttribute("data-drive-name");
  }

  const modal = [...document.querySelectorAll("dialog[open]")].filter((d) => d.matches(":modal")).pop() ?? null;

  const veil = (() => {
    if (modal) return null;
    for (let el = document.elementFromPoint(vw / 2, vh / 2); el; el = el.parentElement) {
      if (getComputedStyle(el).position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.9 && r.height >= vh * 0.9) return el;
    }
    return null;
  })();

  const overlay = veil
    ? [...document.querySelectorAll('[role="menu"],[role="dialog"],[role="listbox"]')]
        .filter((el) => el !== veil && getComputedStyle(el).position === "fixed").pop() ?? null
    : null;

  const sheet = modal ?? overlay ?? veil;

  let behind = 0;

  const BLOCKISH = new Set(["block", "flow-root", "list-item", "table", "table-row", "table-caption", "flex", "grid"]);
  const CONTROL = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const SETS = { tablist: "tabs", radiogroup: "options", listbox: "list", menu: "menu", tabs: "tabs" };

  const isControl = (el) => CONTROL.has(el.tagName) || el.getAttribute("role") === "button";

  const breaks = (el, style, parentStyle) =>
    el.tagName === "BR" || BLOCKISH.has(style.display) ||
    (parentStyle && ["flex", "grid", "inline-flex", "inline-grid"].includes(parentStyle.display));

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

  let reachAt = null;

  /**
   * A scrim takes the whole screen, fold and all, so the sheet is asked before
   * the fold.
   */
  const reach = (el) => {
    reachAt = null;
    if (modal && !modal.contains(el)) return "behind";
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return "behind";
    const away = r.bottom <= 0 ? "above" : r.top >= vh ? "below" : null;
    if (away) return sheet && !sheet.contains(el) ? "behind" : away;
    const inset = Math.min(8, r.width / 2, r.height / 2);
    for (const [dx, dy] of [
      [r.width / 2, r.height / 2],
      [inset, r.height / 2], [r.width - inset, r.height / 2],
      [r.width / 2, inset], [r.width / 2, r.height - inset],
    ]) {
      const x = Math.min(Math.max(r.left + dx, 1), vw - 1);
      const y = Math.min(Math.max(r.top + dy, 1), vh - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
      if (dx !== r.width / 2 || dy !== r.height / 2) reachAt = { x: dx, y: dy };
      return "on";
    }
    return veil ? "behind" : "covered";
  };

  const clipped = (el, style) =>
    (style.overflow === "hidden" || style.overflow === "clip") && el.scrollWidth > el.clientWidth + 1;

  const flush = () => {
    const t = line.replace(/[^\\S\\n]+/g, " ").replace(/ ?\\n ?/g, "\\n").trim();
    if (t) out.push({ text: alerts ? \`  ‼ \${t}\` : t, where: lineWhere });
    line = "";
  };

  const pseudo = (el, which) => {
    const c = getComputedStyle(el, which).content;
    if (!c || c === "none" || c === "normal" || c.startsWith("url") || c.includes("counter")) return "";
    const text = c.replace(/^["']|["']$/g, "");
    return /[\\uE000-\\uF8FF]/.test(text) ? "" : text;
  };

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

  const look = (el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.color, s.fontWeight, s.borderBottomColor, s.boxShadow, s.opacity].join("|");
  };

  const alternatives = (els) => {
    const words = (el) => (el.innerText ?? "").trim().length > 0;
    return new Set(els.map((e) => e.tagName)).size === 1
      && new Set(els.map(look)).size === 2
      && new Set(els.map(words)).size === 1;
  };

  const oddOne = (els) => {
    if (els.length < 3) return -1;
    const looks = els.map(look);
    const tally = new Map();
    for (const l of looks) tally.set(l, (tally.get(l) ?? 0) + 1);
    if (tally.size !== 2) return -1;
    const rare = [...tally].find(([, count]) => count === 1);
    return rare ? looks.indexOf(rare[0]) : -1;
  };

  const emit = (el, inSet = false) => {
    const where = reach(el);
    const at = reachAt;
    if (where === "behind" || where === "covered") { behind++; return null; }
    el.setAttribute("data-drive", String(++n));
    if (at) el.setAttribute("data-drive-at", \`\${at.x},\${at.y}\`);
    const isField = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    const name = isField ? null : labelOf(el);
    el.setAttribute("data-drive-name", isField
      ? el.getAttribute("aria-label") || el.placeholder || el.name || ""
      : name.text);
    const what = isField
      ? field(el)
      : \`\${el.tagName === "A" ? "link" : el.tagName.toLowerCase()} \${name.text ? \`"\${name.text}"\` : "(NO ACCESSIBLE NAME)"}\`;
    const flags = [
      name?.spoken && name.text ? "icon only" : "",
      !inSet && chosenSays(el) === true ? "chosen" : "",
      el.disabled ? "disabled" : "",
      el === document.activeElement ? "focused" : "",
    ].filter(Boolean);
    return { where, text: \`[\${n}] \${what}\${flags.length ? \` (\${flags.join(", ")})\` : ""}\` };
  };

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
    lineWhere = reach(el);
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

  const lines = [];
  let last = null;
  const LABEL = { above: "↑ scrolled past, above the screen", below: "↓ below the fold — a scroll away" };
  for (const item of out) {
    if (item.where === "behind") continue;
    if (item.where !== last && LABEL[item.where]) lines.push(\`── \${LABEL[item.where]} ──\`);
    else if (item.where === "on" && LABEL[last]) lines.push("── back on screen ──");
    last = item.where;
    lines.push(item.text);
  }
  const active = document.activeElement;
  if (!active || active === document.body) lines.push("── nothing has keyboard focus ──");
  else if (!active.hasAttribute("data-drive"))
    lines.push(\`── keyboard focus is on <\${active.tagName.toLowerCase()}>, not a numbered control ──\`);

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

  const phone = async (who) => {
    if (!phones.has(who)) {
      const ctx = await newPhone(browser, { permissions: ["clipboard-read", "clipboard-write"] });
      const page = await ctx.newPage();
      const noise = [];
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
    const [head, ...rest] = line.trim().match(/"[^"]*"|\S+/g) ?? [];
    let verb = head, args = rest;
    if (verb === "as") { current = args[0]; [verb, ...args] = args.slice(1); }
    const who = current;
    const { page, ctx, noise } = await phone(who);
    const arg = args.join(" ");

    const named = async (label) => {
      const hits = await page.evaluate((want) => {
        const norm = (s) => (s ?? "").trim().toLowerCase();
        const all = [...document.querySelectorAll("[data-drive]")];
        const exact = all.filter((el) => norm(el.dataset.driveName) === norm(want));
        const lead = exact.length ? exact
          : all.filter((el) => norm(el.dataset.driveName?.split(" | ")[0]) === norm(want));
        return lead.map((el) => el.dataset.drive);
      }, label);
      if (hits.length === 0) throw new Error(`nothing on this screen is called "${label}" — read it again`);
      if (hits.length > 1) throw new Error(`"${label}" names ${hits.length} controls (${hits.join(", ")}) — use the number`);
      return hits[0];
    };

    /** A wrong press is worse than a failed one. */
    const target = async (ref) => {
      const n = ref?.startsWith('"') ? await named(ref.slice(1, -1)) : ref;
      const sel = `[data-drive="${Number(n)}"]`;
      const found = await page.locator(sel).count();
      if (found === 0) throw new Error(`nothing is numbered ${n} on this screen — read it again`);
      if (found > 1) throw new Error(`${n} names ${found} controls — the screen was read wrong`);
      return sel;
    };

    /** Commands split on whitespace, so a newline is written `\n`. */
    const typed = (parts) => parts.join(" ").replace(/\\n/g, "\n");

    const aim = async (sel) => {
      const at = await page.getAttribute(sel, "data-drive-at");
      if (!at) return {};
      const [x, y] = at.split(",").map(Number);
      return { position: { x, y } };
    };

    switch (verb) {
      case undefined: case "screen": break;
      case "goto": await page.goto(arg.startsWith("http") ? arg : base + (arg.startsWith("/") ? arg : `/${arg}`), { waitUntil: "domcontentloaded" }); break;
      case "click": {
        const sel = await target(args[0]);
        await page.click(sel, { timeout: 5000, strict: true, ...(await aim(sel)) });
        break;
      }
      case "fill": await page.fill(await target(args[0]), typed(args.slice(1)), { strict: true }); break;
      // Keyed one at a time: the amount field regroups per keystroke, which
      // `fill` never exercises.
      case "type": await page.locator(await target(args[0])).pressSequentially(typed(args.slice(1)), { delay: 20, timeout: 5000 }); break;
      case "select": await page.selectOption(await target(args[0]), { label: args.slice(1).join(" ") }, { strict: true }); break;
      case "press": for (let i = Math.max(1, Number(args[1] ?? 1)); i > 0; i--) await page.keyboard.press(args[0]); break;
      case "hold": {
        const sel = await target(args[0]);
        await page.click(sel, { button: "right", strict: true, ...(await aim(sel)) });
        break;
      }
      case "back": await page.goBack(); break;
      case "forward": await page.goForward(); break;
      case "reload": await page.reload(); break;
      case "wait": await page.waitForTimeout(Number(args[0] ?? 500)); break;
      case "offline": await ctx.setOffline(args[0] !== "off"); break;
      case "theme": await page.emulateMedia({ colorScheme: args[0] === "dark" ? "dark" : "light" }); break;
      case "forget": await ctx.close(); phones.delete(who); return { who, url: "(phone thrown away)", title: "", lines: [], noise: [] };
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
          "the stub answers a typed bill too: press \"Type\" (\"As text\" over a bill), fill the box and press \"Read it\"",
        ]);
      }
      case "file": {
        const say = (lines) => ({ who, url: page.url().replace(base, ""), title: "", lines, noise: noise.splice(0) });
        if (phones.get(who).chooser) return say(["a receipt is armed on this phone: `receipt off` first"]);
        const path = args.join(" ");
        const full = path.startsWith("/") ? path : join(ROOT, path);
        if (!existsSync(full)) throw new Error(`no such file: ${path}`);
        page.once("filechooser", (chooser) => chooser.setFiles(full).catch(() => {}));
        return say([`the next file chooser this phone opens is answered with ${path}`]);
      }
      case "shot": {
        mkdirSync(join(DIR, "shots"), { recursive: true });
        const file = join(DIR, "shots", `${(args[0] ?? `shot-${Date.now()}`).replace(/[^\w-]/g, "_")}.png`);
        await page.screenshot({ path: file });
        return { who, url: page.url().replace(base, ""), title: "", lines: [`saved ${file.replace(ROOT + "/", "")}`], noise: noise.splice(0) };
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

    await page.waitForTimeout(verb === "goto" || verb === "reload" ? 700 : 350);
    const seen = await page.evaluate(READ);
    return { ...seen, who, url: seen.url.replace(base, ""), noise: noise.splice(0) };
  };

  let done = 0;
  // A batch stops at its first failure: later commands were written against a
  // screen that never arrived.
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
  const batch = seq;
  return commands.map((cmd) => {
    appendFileSync(IN, `${JSON.stringify({ seq, batch, cmd })}\n`);
    return { seq: seq++, cmd };
  });
}

async function collect(wanted, all = false) {
  const bodies = [];
  for (const { seq, cmd } of wanted) {
    const file = join(RESP, `${seq}.txt`);
    const deadline = Date.now() + 60_000;
    while (!existsSync(file)) {
      if (Date.now() > deadline) { console.error(`timed out waiting for: ${cmd}`); process.exit(1); }
      await new Promise((ok) => setTimeout(ok, 80));
    }
    bodies.push(readFileSync(file, "utf8"));
  }
  const isScreen = (body) => body.startsWith("=") && body.split("\n").length > 8;
  const last = bodies.findLastIndex(isScreen);
  bodies.forEach((body, i) => {
    console.log(`\n$ ${wanted[i].cmd}`);
    if (all || i === last || !isScreen(body)) { process.stdout.write(body); return; }
    const lines = body.split("\n");
    console.log(`  → ${lines[1]}`);
    for (const warning of lines.filter((l) => l.startsWith("  !! "))) console.log(warning);
  });
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "start") await start();
else if (mode === "do" && rest[0] === "--all") await collect(send(rest.slice(1)), true);
else if (mode === "do") await collect(send(rest));
else if (mode === "stop") await collect(send(["stop"]));
else { console.error("usage: drive.mjs start | do <command>… | stop"); process.exit(1); }
