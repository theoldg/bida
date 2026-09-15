import type { ExtraKind, ScanProblem, SplitSpec } from "@bida/core";
import type { EntryKind } from "./entry-kind";

/**
 * Every word the app says to a person, in one place.
 *
 * Two reasons it is one file rather than a string beside each screen. The
 * obvious one is translation: a second language is a second copy of this
 * object and nothing else (ADR-0033). The one that pays off today is tone —
 * the app's voice is only legible when the sentences sit next to each other,
 * and half of these were a paragraph long until they did.
 *
 * **Rules.**
 * - Screens read `copy`; they never hold a literal a person can read.
 *   `scripts/rules-check.mjs` fails a build that puts one back.
 * - A string that needs a value is a function here, not a template at the call
 *   site — word order is the first thing a translation changes.
 * - Plurals go through `plural()` with a `{ one, many }` noun, never `${n}s`.
 * - Say it once, short. What the screen already shows is not text.
 *   ([standing-instructions](../../../docs/standing-instructions.md#interface)).
 */

export interface Noun {
  one: string;
  many: string;
}

/**
 * Said one way for an expense and the other for an income — money going out
 * is *paid*, money coming in is *received*, and a screen that mixes the two
 * describes the entry the person is not looking at. A transfer has no payer
 * side of its own, so it is not asked for here.
 */
export type Voice = "expense" | "income";
export type Voiced<T> = Record<Voice, T>;

/**
 * How each of the bill's own charges is named inside a sentence, as against
 * the row labels in `copy.items.extra` — mid-sentence, lower case, and bare:
 * the caption they go in has one line to fit three of them and the verb.
 */
const extraSubject: Record<ExtraKind, string> = {
  discount: "discount", tax: "tax", tip: "tip",
};

export const copy = {
  app: {
    name: "bida",
    /** Not shown in the app at all: this is the page description, so it is
        the line under the wordmark when somebody pastes a link into a chat
        — where the title is only "bida" and means nothing yet. */
    description: "No-nonsense expense splitter.",
  },

  /** Buttons. One verb each — a button never says "OK". */
  act: {
    add: "Add",
    back: "Back",
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    discard: "Discard",
    done: "Done",
    edit: "Edit",
    remove: "Remove",
    save: "Save",
    useIt: "Use it",
    close: "Close",
    retry: "Try again",
    reload: "Reload",
  },

  /**
   * When reading this phone's own database goes wrong. Rare, and until these
   * existed it was silent: the screen simply stayed on its skeleton rows.
   * See lib/db/live.ts.
   */
  db: {
    /** A read that has stopped answering — the app is asking again. */
    stalled: "Still reading this phone’s data…",
    /** Another copy of the app is holding the database open on an old version. */
    blocked: "Another copy of bida is open. Close it to carry on here.",
    /** The read didn’t just stall, it failed — the screen can’t draw. */
    broken: {
      title: "Can’t read this phone’s data",
      body: "Nothing is lost: it is still on this phone. Reloading usually clears this.",
    },
  },

  /**
   * `/diag`, which is not linked from anywhere — long-press the wordmark on
   * the groups list. Four words, because the screen itself is one block of
   * preformatted text and nothing there is translated.
   */
  diag: {
    title: "Diagnostics",
    reading: "Reading…",
    copyAll: "Copy the report",
    copied: "Copied",
  },

  /** Stand-ins for a value the app hasn't got: a name, a figure, a field. */
  unknown: "?",
  none: "—",
  someone: "Someone",
  someoneLower: "someone",

  noun: {
    change: { one: "change", many: "changes" } as Noun,
    entry: { one: "entry", many: "entries" } as Noun,
    expense: { one: "expense", many: "expenses" } as Noun,
    item: { one: "item", many: "items" } as Noun,
    other: { one: "other", many: "others" } as Noun,
    part: { one: "part", many: "parts" } as Noun,
    person: { one: "person", many: "people" } as Noun,
    photo: { one: "photo", many: "photos" } as Noun,
    revision: { one: "revision", many: "revisions" } as Noun,
    way: { one: "way", many: "ways" } as Noun,
  },

  time: {
    today: "Today",
    yesterday: "Yesterday",
    justNow: "just now",
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo: (n: number) => `${n}h ago`,
    daysAgo: (n: number) => `${n}d ago`,
    agoYesterday: "yesterday",
  },

  // ------------------------------------------------------------- groups list

  groups: {
    empty: {
      title: "No groups yet",
      body: "A trip, a flat, a dinner: anything several people pay for.",
    },
    newGroup: "New group",
    quickSplit: "Quick split",
    paste: "Paste",
    about: "About bida",
    whoAreYou: "who are you?",
    youOwe: "you owe",
    youreOwed: "you’re owed",
    settled: "settled",
    theme: { toLight: "Switch to light mode", toDark: "Switch to dark mode" },
  },

  install: {
    title: "Keep bida on your home screen",
    body: "Own icon, no browser bar, works offline.",
    /**
     * iOS has no install API, so name the button that does it — in one line,
     * which is what "in the browser bar" cost and the share glyph says anyway.
     */
    manual: {
      tap: "Tap", then: "then", label: "Add to home screen",
      /**
       * What declining costs, which on iOS is the whole reason to ask: WebKit
       * refuses `persist()` outside a home-screen app, so seven unopened days
       * evict the group secrets and there is no account to get them back with
       * (docs/architecture.md). "Forgotten" is the same word the app uses for
       * doing it on purpose.
       *
       * "This browser" rather than Safari: every iOS browser is WebKit and
       * evicts on the same timer, and `looksIos` matches all of them — naming
       * Safari to someone reading this in Chrome aims the warning past them.
       */
      warn: "Otherwise this browser forgets your groups after a week unused.",
    },
  },

  /** The waiting service worker (lib/update.ts). */
  update: {
    title: "A new version is ready",
    act: "Reload",
  },

  // ----------------------------------------------------------------- about

  /**
   * The one screen the app spends on itself (app/about/page.tsx). It answers
   * the three questions someone asks of an app with no sign-up: who can edit
   * this, does it work on a train, and who can read what I typed.
   *
   * The privacy section is a claim about the code, not a promise: op bodies are
   * sealed on the phone under a key the server never sees
   * ([ADR-0036](../../../docs/decisions/0036-the-server-cannot-read-a-group.md)),
   * which is why the sample below is a real `SealedOp` and not a drawing. If
   * either ever stops being true, this changes in the same commit.
   */
  about: {
    title: "About bida",
    noAccounts: {
      title: "No account",
      body: "A group is a secret link. Whoever has it can edit, and every edit is recorded in the group’s history.",
    },
    offline: {
      title: "Works offline",
      body: "Add bida to your home screen and it keeps working with no signal at all. Expenses you write offline sync when you’re back online.",
      /** Once it already is: the claim's premise is already true, so the
       * sentence says that instead of repeating the offer under it. */
      bodyInstalled: "Because bida is added to your home screen, it keeps working with no signal at all. Expenses you write offline sync when you’re back online.",
    },
    privacy: {
      title: "Privacy",
      scanTitle: "Receipt scanning is not private.",
      scan: "Receipt photos are sent to the Google Gemini API, where they may be read by humans or used to train models. For a day afterwards, the server remembers that this group scanned something: not the photo, just the count the cap needs.",
      e2eTitle: "The rest is encrypted end-to-end.",
      body: "When you save an expense, the server (and I, the developer) can see something like this:",
      /**
       * One row of D1: a `SealedOp` (core/seal.ts). The labels are plain
       * English because the reader is not a developer, and the values are the
       * real four fields because the whole point is that there are only four.
       */
      sealed: [
        { k: "group", v: "c9f0f8…" },
        { k: "edit", v: "8f14e4…" },
        { k: "number", v: "42" },
        { k: "contents", v: "AQz8k…w==" },
      ],
      key: "The key that decodes the contents is part of the secret link, and it never reaches the server.",
      shape: "I can see how many groups there are, and how many edits each one has had. That’s it.",
    },
    feedback: {
      title: "Feedback",
      body: "I made this alone. Tell me what you think! Bug reports, feature requests, words of encouragement, words of discouragement.",
      email: "teodor.lamort@gmail.com",
      source: "Source on GitHub",
      sourceUrl: "https://github.com/theoldg/money",
    },
  },

  // ------------------------------------------------------------- tip jar

  /**
   * The one screen in the app that asks for money, reached from the foot of
   * the balances tab.
   *
   * The ask is deliberately narrow: not "love this app", but the one thing in
   * it that is not free to run. A number the reader can check beats a plea
   * they cannot — and it is the same number the ceiling in `SCAN_LIMITS` is
   * set from (core/scan.ts, docs/receipt-scanning.md#what-the-scan-costs).
   */
  tip: {
    title: "Support bida",
    /** The balances tab's FAB, which says the whole thing: it is the only
     *  floating button in the app with a word in it, and half an ask is
     *  worse than none. */
    fab: "Support bida",
    lede: "Enjoying bida? Consider donating a few bucks.",
    /** Why there is an ask at all, in one line, above the figure it explains. */
    why: "Scanning is the only part of bida that costs money to run. I pay for it.",
    /**
     * The claim, as a figure and the thing it buys. The figure is the same one
     * the day cap is set from (`SCAN_LIMITS`, core/scan.ts) — if the price
     * moves, both move.
     */
    rate: "$5 ≈ 10,000 receipt scans",
    /**
     * The same $5, cut the way this group cuts everything else — and the
     * offer, said before the button that takes it. Splitting is the thing
     * this app is for, so the ask gets to be a thing five people share rather
     * than a thing one person pays.
     */
    each: (share: string) => `You can split it! In this group, that’s ${share} each.`,
    /**
     * The joke that lets the screen stop asking. Everything above it is a
     * number and a claim about a number; one line that is obviously neither
     * is what keeps four earnest sentences from reading as a pitch.
     */
    yacht: "If there’s any money left over, I’ll buy a yacht.",
    donate: {
      cta: "Donate",
      url: "https://buymeacoffee.com/theoldg",
    },
    /**
     * A donation split is an ordinary expense — one person paid, everyone
     * shares ([ADR-0010](../../../docs/decisions/0010-what-an-entry-is.md)),
     * so this needs no new kind of entry and no new op. It opens the form
     * rather than writing itself: it is a row in everyone else's ledger, and
     * how much you gave is a thing only you know.
     */
    split: {
      cta: "Add as a group expense",
      /**
       * What the prefilled expense calls itself, in the ledger, forever. It
       * is written in the first person plural because by the time it is saved
       * it is the group's row and not the giver's — and it is a sentence
       * somebody will read months later next to a restaurant and a taxi.
       */
      entryTitle: "We liked bida",
    },
  },

  // ------------------------------------------------------------- new group

  newGroup: {
    title: "New group",
    name: "Name",
    namePlaceholder: "Group name",
    currency: "Currency",
    people: "Members",
    failed: (why: string) => `Couldn’t create the group: ${why}`,
    discardTitle: "Discard this group?",
    discardBody: "Nothing has been created yet.",
  },

  // ------------------------------------------------------------- join

  join: {
    title: "Join a group",
    badLink: {
      title: "Bad link",
      body: "Ask whoever shared it to send it again.",
    },
    joining: {
      title: "Joining…",
      body: "Finishes by itself once the other phone syncs.",
    },
  },

  claim: {
    title: "Which one is you?",
    addPlaceholder: "Add your name",
    continueAs: (name: string) => `Continue as ${name}`,
    pickFirst: "Pick your name",
  },

  // ------------------------------------------------------------- the group

  group: {
    noGroup: "No group",
    notFound: {
      title: "Not found",
      empty: "That group isn’t on this phone",
      body: "Open the invite link again.",
    },
    /**
     * For a link that names nothing this phone has — a deep link into a group
     * that was never joined or has been forgotten. `notFound` above is the
     * gentler case: you are on the group screen, one id short.
     */
    badLink: {
      title: "Bad link",
      empty: "This link doesn’t open anything",
      body: "Ask someone in the group to send you the invite link.",
    },
    /** Three ways to be out of step, in the order of how badly you need to know. */
    offlineIdle: "Offline: you may not have everyone’s latest.",
    offlinePending: (waiting: string) => `Offline: ${waiting} waiting.`,
    // Not "ask for a fresh one": there is no secret rotation, so a fresh link
    // is byte-identical. Opening the invite link again is what actually clears
    // this — `saveGroupKey` unsets the failure.
    rejected: "This phone’s link doesn’t open this group. Open the invite link again.",
    unreachableIdle: "Can’t reach the server: you may not have everyone’s latest.",
    unreachablePending: (waiting: string) => `Can’t reach the server: ${waiting} stuck on this phone.`,

    /** Marks a balance row for somebody who is no longer in the group. */
    hasLeft: "removed",

    tabs: { ledger: "Ledger", balances: "Balances" },
    history: "History",
    people: "People",
    copyLink: "Copy invite link",
    /** The top bar's one button: everything the group can be asked for. */
    menu: "Group menu",
    /** The clipboard can refuse — an insecure context, a denied permission —
        and the link is shown nowhere else, so it is shown here. */
    linkTitle: "The invite link",
    linkBody: "Copying didn’t work: hold the link to copy it.",
    addEntry: "Add an entry",

    empty: { title: "Nothing here yet", body: "Tap + to add the first thing." },
    untitled: "Untitled",
    notYours: "not yours",
    you: {
      owe: "You owe",
      owed: "You’re owed",
      square: "You’re square",
    },
    /** "Marie paid" · "Marie + 1 other received". */
    payers: (who: string, others: string | null, verb: string) =>
      (others ? `${who} + ${others} ${verb}` : `${who} ${verb}`),
    /**
     * The same fact for a row with no room for "+ 1 other". Dropping the
     * co-payers instead would make the line say something untrue, so this is
     * how the ladder in `lib/row-meta.ts` shortens them.
     */
    payersTight: (who: string, others: number, verb: string) => `${who} +${others} ${verb}`,
    sharedWays: (n: string) => `shared ${n}`,
    splitWays: (n: string) => `split ${n}`,
    splitAs: (people: string, mode: string) => `${people}, ${mode}`,
    /** Two facts on one line: "Marie paid · split 3 ways". */
    metaLine: (a: string, b: string) => `${a} · ${b}`,
    transfer: "Transfer",
    transferNote: (note: string) => `Transfer · ${note}`,
    paidTo: (from: string, to: string) => `${from} paid ${to}`,

    unsplittable: (n: string) => `${n} couldn’t be split`,
    unsplittableWhy: (reason: string) => `${reason}: left out of the balances.`,
    settleUp: "Settle up",
    allSquare: "Everyone’s square",
  },

  // ------------------------------------------------------------- people

  members: {
    title: "People",
    addPlaceholder: "Add someone",
    /**
     * Two people with one name are two people nothing on screen tells apart —
     * and, since the name is the member's key, one row they would both write
     * to. The name is right there on the list above the field, so saying so is
     * the whole message: what to do about it is the typist's business.
     */
    taken: (name: string) => `${name} is already here.`,
    removeLabel: (name: string) => `Remove ${name}`,
    /** Which of these names this phone signs with — a decision, so a dialog
        rather than a tap on a row that also removes and invites. The list's
        check mark already answers *which*; this only has to offer the change. */
    whoChange: "Change who you are",
    whoTitle: "Which one is you?",
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: "They aren’t involved in any entry.",
    blockedTitle: (name: string) => `Can’t remove ${name}`,
    /** "entries", not "expenses": a transfer blocks removal too. */
    blockedBody: (entries: string) => `Named on ${entries}.`,
    lastBody: "Add somebody else first.",
    forget: "Forget group",
    forgetBody: "The invite link brings it back.",
  },

  // ------------------------------------------------------------- quick split

  /**
   * A bill split with people who are not a group (ADR-0035). It ends by
   * handing you text, so half of this is words that leave the app.
   */
  quick: {
    title: "Quick split",
    /**
     * Under the screen's drawing, the two things it can't show: the tap
     * between the photo and the figures, and that this flow keeps nothing.
     * Not `copy.scan.lede` — that one promises an expense form, which is what
     * a group's scan comes back as and what a quick split never becomes
     * (ADR-0035).
     */
    lede: "Take a photo of the bill, then tap who had what. It ends in text to paste, and nothing is kept.",
    who: "Who’s splitting",
    /** The one bill this flow can do nothing with: a total and no lines. */
    noLines: "That receipt has no lines on it. There’s nothing to assign.",
    discardTitle: "Discard this split?",
    /** Done is the way out of the answer, and the answer is not kept either. */
    doneTitle: "Finished with this split?",
    discardBody: "Nothing about it is kept.",
    split: "The split",
    copy: "Copy the split",
    copied: "Copied",
    /** The clipboard refused; the text has to be read off the screen instead. */
    fallbackTitle: "Copy it from here",
    fallbackBody: "This phone wouldn’t take it to the clipboard.",
    /**
     * The text itself. Plain lines with an em dash, because it is read in a
     * chat app: nothing there is monospaced, so a table drawn with spaces
     * arrives as a mess. Figures are bare — nothing in a quick split converts
     * (ADR-0035).
     */
    summary: {
      line: (label: string, amount: string) => `${label}: ${amount}`,
      item: (label: string, amount: string) => `  ${label}: ${amount}`,
      count: (label: string, count: string) => `${label} ×${count}`,
      /** Stands in as the heading when the scan read no merchant name. */
      total: "Total",
    },
  },

  // ------------------------------------------------------------- one entry

  entry: {
    gone: { title: "Gone", body: "This entry may have been deleted." },
    history: "History",
    editedTimes: (n: number) => `edited ×${n}`,
    rate: (rate: string) => `@ ${rate}`,
    notInvolved: "not involved",
    payerCount: (label: string, people: string) => `${label} · ${people}`,
    /** "Split · evenly" · "Shared with · by items". */
    splitMode: (label: string, mode: string) => `${label} · ${mode}`,
    deleteTitle: (kind: string) => `Delete this ${kind}?`,
    deleteBody: "The history keeps a record.",
    from: "From",
    to: "To",
  },

  /** The three kinds, and every word the app uses about them (ADR-0010). */
  entryKind: {
    label: { expense: "Expense", income: "Income", transfer: "Transfer" } as Record<EntryKind, string>,
    /** The verb in "Marie paid". Only the two kinds that have a payer side: a
        transfer's row is titled `group.paidTo` ("Alice paid Bob") and never
        reaches this. */
    verb: { expense: "paid", income: "received" } as Voiced<string>,
    /** Over the payer picker: who put it in, or who took it in. */
    payer: { expense: "Paid by", income: "Received by", transfer: "From" } as Record<EntryKind, string>,
    /** Over the split: who it was spent on, or who it belongs to. */
    split: { expense: "Split", income: "Shared with", transfer: "To" } as Record<EntryKind, string>,
    /** Under each kind in the form's picker. Three words nobody has to already
        know the app to tell apart — "transfer" against "expense" is the pair
        that actually gets picked wrong, so each says where the money goes. */
    blurb: {
      expense: "Money the group spent",
      income: "Money the group took in",
      transfer: "Money moved between two people",
    } as Record<EntryKind, string>,
  },

  // ------------------------------------------------------------- entry form

  form: {
    newTitle: "New",
    editTitle: "Edit",
    /** The kind chip's label, and the title of the dialog it opens. */
    kindTitle: "What kind of entry",
    editKind: (kind: string) => `Edit ${kind}`,
    amount: (currency: string) => `Amount in ${currency}`,
    currency: "Currency",
    fromReceipt: "read from receipt",
    rateLabel: (from: string, to: string) => `Rate, ${from} to ${to}`,
    what: "What",
    whatPlaceholder: "Title",
    note: "Note (optional)",
    /** What a transfer prefilled from settle up is nine times out of ten:
        paying somebody back. Seeded only by that prefill (`edit/page.tsx`),
        never by a blank "+" or a mid-edit kind switch, and cleared if the
        entry turns out not to be a transfer after all (`changeKind`). */
    reimbursement: "Reimbursement",
    when: "When",
    multiPayer: {
      expense: "Multi-payer",
      income: "Multi-recipient",
    } as Voiced<string>,
    discardTitle: (kind: string) => `Discard this ${kind}?`,
    discardTitleEdits: "Discard edits?",
    discardBody: "Changes will be lost.",
    saveFailed: (why: string) => `Couldn’t save: ${why}`,
    goneMember: (name: string) => `${name} is no longer in the group. Pick somebody else.`,
    nobodyTitle: "Nobody in this group yet",
    nobodyBody: "Add the people sharing this first.",
    sentBy: "Who sent it",
    receivedBy: "Who received it",
    swapSides: "Swap the two sides",
    sameSide: "Pick two different people.",
    otherSide: "the other side: picking swaps them",
    you: "you",
  },

  /**
   * The screen that says who put the money in — or, on an income, who took it
   * in. Every sentence about a person on it is `Voiced`: the title alone used
   * to switch, so an income asked "Who received it" and then said "Ana didn't
   * pay" under her name.
   */
  payers: {
    title: {
      expense: "Who paid",
      income: "Who received it",
    } as Voiced<string>,
    didnt: {
      expense: "didn’t pay",
      income: "didn’t receive any",
    } as Voiced<string>,
    contribution: {
      expense: (name: string) => `${name}’s contribution`,
      income: (name: string) => `How much ${name} received`,
    } as Voiced<(name: string) => string>,
    giveRest: (name: string) => `Give ${name} the rest`,
    rest: "rest",
    accountedFor: (allocated: string, total: string) => `${allocated} of ${total} accounted for`,
    nobody: {
      expense: "Nobody has put money in yet",
      income: "Nobody has received any of it yet",
    } as Voiced<string>,
    under: "still unaccounted for",
    over: "more than the entry",
    discardTitle: "Discard these payers?",
    discardBody: "The entry goes back to whoever it named before.",
  },

  // ------------------------------------------------------------- the split

  split: {
    /** What each mode is called wherever a split is named — the ledger row,
        the entry, the history. A receipt is one of them (ADR-0016): no screen
        has a second rule for spotting one. It is named "By items" and not
        "From receipt" because a receipt is how the items got typed in — an
        input modality — and these five words name how the money divides. The
        photograph has its own badge under the amount (`form.fromReceipt`). */
    mode: {
      equal: "Evenly",
      shares: "As parts",
      exact: "As amounts",
      percent: "By percent",
      receipt: "By items",
    } as Record<SplitSpec["mode"], string>,
    /** The tab's own label — the mode's name without the preposition, which a
        quarter of the width has no room for. */
    receipt: "Items",
    include: (name: string) => `Include ${name}`,
    leaveOut: (name: string) => `Leave ${name} out`,
    fewerParts: (name: string) => `Fewer parts for ${name}`,
    moreParts: (name: string) => `More parts for ${name}`,
    amountFor: (name: string) => `${name}’s amount`,
    giveRest: (name: string) => `Give ${name} the rest`,
    rest: "rest",
    notInvolved: "not involved",
    /** The footer's verdicts. Wording checked by lib/format.test.ts. */
    nobody: "Nobody is included yet",
    allocated: (allocated: string, total: string) => `${allocated} of ${total} allocated`,
    under: "left to split",
    over: "too much",
  },

  // ------------------------------------------------------------- receipts

  scan: {
    scan: "Scan a receipt",
    /** The scan-first screen: its title and what it promises. */
    title: "Scan a receipt",
    /**
     * The screen's one picture, drawn rather than written: a bill, and the
     * expense it comes back as. These words are the *contents* of that
     * picture — a plausible dinner and the three fields a scan fills — not a
     * caption. `alt` is the sentence they replaced, kept for whoever can't
     * see the drawing.
     */
    diagram: {
      alt: "Photograph the bill and the expense fills itself in: what it cost, what it’s called, and when.",
      /**
       * The bill on the left. Its lines add up to `amount`, which is also the
       * number the form on the right comes back with — the drawing's whole
       * claim, so `copy.test.ts` adds them up rather than trusting the eye.
       */
      lines: [
        ["Tagine", "18.00"],
        ["Couscous", "14.50"],
        ["Salad", "9.40"],
        ["Mint tea", "6.30"],
      ],
      total: "Total",
      title: "Dinner",
      amount: "48.20",
      date: "12 Sep",
      /**
       * Stand-ins for the drawing's right-hand side, which splits the bill
       * between three of the group's own members — a group with fewer than
       * three borrows from here, in order, to fill the picture out.
       */
      people: ["Ana", "Ben", "Cleo"],
    },
    /**
     * Under the drawing, the two things the drawing can only imply: that the
     * whole form comes back filled, and that the lines on the bill are a way
     * to split it. It sits with the picture, not with the control — the gap
     * below it is what keeps the two apart.
     */
    lede: "Take a photo to fill in the expense. Split it evenly, or line by line.",
    /**
     * The two halves of the one control that scans (`ScanPair`), naming the
     * two doors into the same act and not the act itself: what is being
     * scanned is said by the screen — the top bar on `/g/scan`, and on the
     * form the line under this control — so the halves that used to repeat it
     * don't.
     */
    snap: "Scan",
    rescan: "Rescan",
    upload: "Upload",
    reading: "Reading…",
    camera: "Take a photo of a receipt",
    library: "Upload a receipt photo",
    /** The same screen, named for the step left: nobody assigned yet, or a change to one. */
    assignWhoHadWhat: "Assign who had what",
    editWhoHadWhat: "Edit who-had-what",
    /** A consequence the screen can't show. It stays. Names the API rather
        than its tier: the tip jar says scanning is the one thing here that
        costs money to run, and "free" contradicts it. */
    terms: "Google Gemini API: photo may train their models.",
    failed: "Couldn’t read that receipt.",
    keptOld: "The old one is still assigned.",
    /**
     * The app's own three refusals, one per way a reading can fail to add up
     * (`checkScan`). Each says which it is, because each asks for something
     * different back: another photo, a straighter one, or the form instead.
     */
    problem: {
      "no-total": "I can’t make out the total on that one.",
      "unreadable-line": "I can’t read every line on that one.",
      mismatch: "The lines don’t add up to the total. Try a flatter, square-on photo.",
    } satisfies Record<ScanProblem, string>,
    offline: "You’re offline: scanning needs a connection.",
    busy: "Gemini’s busy. Try again in a minute.",
    /**
     * Our own cap, which is a different thing from `busy` above: waiting a
     * minute fixes Gemini being overloaded and does nothing at all about a
     * spent budget. Two sentences and not three, because "you" and "this
     * address" are one fact to the person reading it — what genuinely differs
     * is a budget somebody else spent.
     *
     * They are the only place the cap is ever mentioned: a counter nobody is
     * near is fat, and the refusal says the whole of it when it matters.
     */
    limit: {
      you: "That’s your scans for now: scanning is capped. Type this one in, or come back later.",
      global: "The shared scan budget is spent. Type this one in, or try later.",
    },
    /**
     * Fail-closed, and named: a blocked script is not a bad photograph. Two
     * sentences because the two failures ask different people to act —
     * `browser` is this phone's network, where retrying on another one is the
     * fix, and `server` is the deployment's own key, where retrying is the one
     * thing that cannot help.
     */
    unverified: {
      browser: "Couldn’t check this browser: scanning needs challenges.cloudflare.com.",
      server: "This browser check was refused: scanning is misconfigured here. Type this one in.",
    },
  },

  items: {
    title: "Who had what",
    none: { title: "No line items on that scan", body: "Split it from the form instead." },
    whoWasThere: "Who was there",
    wasThere: (name: string) => `${name} was there`,
    wasntThere: (name: string) => `${name} wasn’t there`,
    /**
     * The three lines nobody ordered (`BillExtras`). "Discounts", plural,
     * because the row is everything the bill took off, pooled — one loyalty
     * card and one two-for-one read as one figure here.
     */
    extra: { tip: "Tip + service", tax: "Tax", discount: "Discounts" } satisfies Record<ExtraKind, string>,
    tipPercent: (percent: number) => `${percent}%`,
    tipLabel: (currency: string) => `Tip and service, in ${currency}`,
    /** The one affordance a person misses: the tip is a field, not a printed line. */
    tipHint: "tap to edit",
    portion: (index: number, of: number) => `${index} of ${of}`,
    /**
     * ×N says one thing on this screen: show the portions, or show them as the
     * line they came from. Only the very first press also *splits* the bill —
     * there have to be rows before there is anything to assign — and after
     * that the same button only opens and closes a view, which is why folding
     * is never described as merging anything back.
     */
    splitInto: (n: number) => `Split into ${n} lines`,
    splitItem: (label: string, n: number) => `Split ${label} into ${n} lines`,
    showPortions: (n: number) => `Show the ${n} portions one by one`,
    openItem: (label: string, n: number) => `Show the ${n} ${label} portions one by one`,
    mergeBack: "Show as one line",
    splitDiscounts: (n: number) => `Show the ${n} discounts one by one`,
    mergeDiscounts: (n: number) => `Show the ${n} discounts as one figure`,
    mergeItem: (label: string, n: number) => `Show the ${n} ${label} portions as one line`,
    had: (name: string, label: string) => `${name} had ${label}`,
    hadAll: (name: string, label: string, n: number) => `${name} had all ${n} ${label}`,
    /** A cell that cannot be tapped like the others: the tap opens the line. */
    hadSome: (name: string, label: string, n: number) =>
      `${name} had some of the ${n} ${label} — open the line to see which`,
    hadPortion: (name: string, label: string, index: number, of: number) =>
      `${name} had ${label}, portion ${index} of ${of}`,
    share: (name: string) => `${name}’s share`,
    needsSomeone: "Every item needs at least one person.",
    /**
     * Why the rows under the items have no cells to tap. Said once, beneath
     * them rather than in the footer: it explains rows, so it belongs with
     * them, and the footer's other two lines are things still to be done.
     * Named for what this bill actually has — a receipt with no tax should
     * not explain one — so the kinds arrive in the order the rows print.
     */
    extraNote: (kinds: ExtraKind[]) => {
      const names = kinds.map((k) => extraSubject[k]);
      const subject = names.length < 2
        ? names.join("")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      const verb = names.length === 1 ? "is" : "are";
      return `${subject[0]?.toUpperCase() ?? ""}${subject.slice(1)} ${verb} applied proportionally.`;
    },
    discardTitle: "Discard this grid?",
    discardBody: "The bill goes back to the lines the scan read.",
    unfoldHint: { before: "Tap a", after: "to split a line." },
  },

  // ------------------------------------------------------------- history

  history: {
    title: "History",
    entry: "Entry",
    empty: "Nothing here yet",
    wholeGroup: "The whole group",
    subject: (name: string, revisions: string) => `${name} · ${revisions}`,
    deleted: (label: string) => `${label} · deleted`,
    untitled: "Untitled entry",
    more: (rest: string) => `Show ${rest} more`,

    /**
     * The name of a field on a secondary line — the rest of what one revision
     * changed, under the sentence for the first of them. Short, because the
     * sentence above has already said who and what kind of edit it was.
     */
    field: {
      kind: "Kind",
      involved: "Who’s involved",
      split: "Split",
      splitMode: "Split mode",
      receipt: "Receipt",
      whoHadWhat: "Who had what",
      amount: "Amount",
      currency: "Currency",
      rate: "Rate",
      payer: "Who paid",
      receiver: "Who received it",
      putIn: "How much each",
      description: "Description",
      date: "Date",
      category: "Category",
      photos: "Photos",
      sides: "Between",
      note: "Note",
    },

    /** One sentence per revision. `who` is the actor's own name. */
    createdEntry: (who: string, noun: string) => `${who} created this ${noun}`,
    deletedEntry: (who: string, noun: string) => `${who} deleted this ${noun}`,
    editedEntry: (who: string, noun: string) => `${who} edited this ${noun}`,
    toIncome: (who: string) => `${who} turned this into an income`,
    toExpense: (who: string) => `${who} turned this back into an expense`,
    changedInvolved: (who: string) => `${who} changed who’s involved`,
    /** The same people, a different share each. */
    changedShares: (who: string) => `${who} changed how it’s split`,
    /** One name and what it is down for, on a diff line: "Ana ×2", "Bo €8.00". */
    shareOf: (name: string, value: string) => `${name} ${value}`,
    parts: (n: number) => `×${n}`,
    percent: (n: number) => `${n}%`,
    /** Same people, same shares, a spec written another way — which is only
        worth a line because the entry screen prints the mode. */
    rewroteSplit: (who: string) => `${who} changed how the split is written`,
    addedReceipt: (who: string) => `${who} added a receipt`,
    changedReceipt: (who: string) => `${who} changed the receipt`,
    removedReceipt: (who: string) => `${who} removed the receipt`,
    changedWhoHadWhat: (who: string) => `${who} changed who had what`,
    changedAmount: (who: string) => `${who} changed the amount`,
    changedCurrency: (who: string) => `${who} changed the currency`,
    changedRate: (who: string) => `${who} changed the rate`,
    /**
     * The payer side asks the split's two questions over again — who put money
     * in, then how much each of them did — and an income asks both the other
     * way round, the way the entry form does (`entryKind.payer`).
     */
    payerWho: {
      expense: (who: string) => `${who} changed who paid`,
      income: (who: string) => `${who} changed who received it`,
    } as Voiced<(who: string) => string>,
    payerHow: {
      expense: (who: string) => `${who} changed how much each put in`,
      income: (who: string) => `${who} changed how much each received`,
    } as Voiced<(who: string) => string>,
    changedDescription: (who: string) => `${who} changed the description`,
    changedDate: (who: string) => `${who} changed the date`,
    changedCategory: (who: string) => `${who} changed the category`,
    changedPhotos: (who: string, added: boolean, photos: string) =>
      `${who} ${added ? "added" : "removed"} ${photos}`,
    newDevice: (who: string) => `${who} started editing from a new device`,
    /** A phone changing hands is only ever read as a change of person:
        "Teo became Seppi", not a sentence about the device it happened on. */
    became: (was: string, now: string) => `${was} became ${now}`,
    recordedTransfer: (who: string) => `${who} recorded a transfer`,
    deletedTransfer: (who: string) => `${who} deleted a transfer`,
    editedTransfer: (who: string) => `${who} edited a transfer`,
    changedSides: (who: string) => `${who} changed who it was between`,
    changedNote: (who: string) => `${who} changed the note`,
    joined: (them: string) => `${them} joined the group`,
    added: (who: string, them: string) => `${who} added ${them}`,
    removed: (who: string, them: string) => `${who} removed ${them}`,
    /** Nobody asked for this one, so it names the cause rather than the actor:
        a removal the group had already contradicted, undone. */
    readded: (them: string) => `${them} was removed, but an entry still names them: added back`,
    /** The rate half of the same repair. Names the cause, not the actor. */
    restoredRate: (code: string) =>
      `The ${code} rate was cleared, but entries still use it: put back`,
    renamedSelf: (who: string) => `${who} changed their name`,
    renamed: (who: string, was: string) => `${who} renamed ${was}`,
    updatedMember: (who: string, them: string) => `${who} updated ${them}`,
    updatedSelf: (who: string) => `${who} updated their own details`,
    createdGroup: (who: string) => `${who} created the group`,
    renamedGroup: (who: string) => `${who} renamed the group`,
    archivedGroup: (who: string) => `${who} archived the group`,
    restoredGroup: (who: string) => `${who} restored the group`,
    updatedGroup: (who: string) => `${who} updated the group`,
    setRate: (who: string, code: string) => `${who} set the ${code} rate`,
    changedRateFor: (who: string, code: string) => `${who} changed the ${code} rate`,
    removedRate: (who: string, code: string) => `${who} removed the ${code} rate`,
    /** A rate's diff reads as the sentence the dialog shows: 1 MAD = 0.0921 EUR. */
    ratePair: (code: string, rate: string, base: string) => `1 ${code} = ${rate} ${base}`,
  },

  currency: {
    title: "Currency",
    other: "Other…",
    otherNote: "any three-letter code",
    otherPlaceholder: "UZS",
    isBase: "the group settles in this",
    hasRate: (rate: string) => `1 = ${rate}`,
    noRate: "no rate yet",
  },

  // ------------------------------------------------------ exchange rates

  rates: {
    /** The icon in the top row, between History and People. */
    title: "Rates",
    empty: "Everything is in one currency",
    emptyBody: "Add one here, or write an entry in another currency.",
    add: "Add a currency",
    /** Under a row: how much of the ledger moves when this rate does. */
    usedBy: (entries: string) => `${entries} at this rate`,
    usedByNone: "nothing written in it yet",
    /** A currency entries exist in that the registry has no opinion about. */
    unset: "each entry at its own rate",

    /** The dialog. Both directions of the same number, and they move together. */
    editTitle: (code: string) => `${code} rate`,
    /** "1 PLN =" — the label before each of the two fields. */
    oneOf: (code: string) => `1 ${code} =`,
    /** Where the number on screen came from, said under the fields. */
    from: {
      fetched: (date: string) => `today’s rate, ${date}`,
      fetchedUndated: "today’s rate",
      typed: "yours",
      typedOn: (date: string) => `yours, ${date}`,
      loading: "looking it up…",
      offline: "offline: type it",
      unavailable: "couldn’t look it up: type it",
    },
    refetch: "Look it up",
    /** The one thing this dialog does that a person should know before doing it. */
    movesEntries: (entries: string, code: string) => `Re-values ${entries} in ${code}.`,
    removeTitle: (code: string) => `Remove the ${code} rate?`,
    removeBodyEmpty: "Nothing is written in it, so nothing changes.",
    /** Removing a rate is refused on the same terms as removing a person. */
    blockedTitle: (code: string) => `Can’t remove the ${code} rate`,
    blockedBody: (entries: string) => `Used by ${entries}.`,
    /** Save is held until there is a number to save. */
    invalid: "That isn’t a rate.",
    failed: (why: string) => `Couldn’t save the rate: ${why}`,
    /** The badge beside the entry form's converted figure. The rate itself is
        not printed there — this is the way to the number, not the number. */
    setRate: () => `set rate`,
    /** That row is a button, and what it opens is not what the fields inside it are. */
    openFor: (code: string) => `Set the ${code} rate`,
  },
} as const;
