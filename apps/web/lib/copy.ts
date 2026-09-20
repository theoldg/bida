import type {
  ExtraKind, ImportRefusalCode, ScanMedium, ScanProblem, SplitSpec,
} from "@bida/core";
import type { EntryKind } from "./entry-kind";

/**
 * Every word the app says to a person, in one place.
 *
 * Two reasons it is one file rather than a string beside each screen:
 * translation — a second language is a second copy of this object and nothing
 * else (ADR-0033) — and tone, which is only legible when the sentences sit next
 * to each other.
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
 * What a refused import interpolates: the line a spreadsheet would show, and
 * the one fact that code carries (`ImportError` in core/import.ts).
 */
interface RefusalFact {
  line?: number;
  detail?: string;
}

/**
 * Said one way for an expense and the other for an income — money going out
 * is *paid*, money coming in is *received*, and a screen that mixes the two
 * describes the entry the person is not looking at. A transfer has no payer
 * side of its own, so it is not asked for here.
 */
export type Voice = "expense" | "income";
type Voiced<T> = Record<Voice, T>;

/**
 * How each of the bill's own charges is named inside a sentence, as against
 * the row labels in `copy.items.extra` — mid-sentence, lower case, and bare:
 * the caption they go in has one line to fit three of them and the verb.
 */
const extraSubject: Record<ExtraKind, string> = {
  discount: "discount", tax: "tax", tip: "tip",
};

/** The iOS browser by name when `iosBrowser` can tell, at a sentence's start or inside it. */
const upper = (browser: string | undefined) => browser ?? "This browser";
const lower = (browser: string | undefined) => browser ?? "this browser";

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
   * When reading this phone's own database goes wrong. Rare, and without these
   * it is silent: the screen simply stays on its skeleton rows.
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
    /** The one switch on this screen — see lib/scan/stas.ts. The line under it
     *  is the warning: what it changes is the tone of a refusal, and the
     *  refusals get personal. */
    stas: "Staś mode",
    stasNote: "Send a bad photo, get insulted.",
    on: "On",
    off: "Off",
  },

  /**
   * The group as a spreadsheet. The subtitle names the two apps somebody is
   * actually leaving for, because "CSV" answers a question nobody asked and
   * those two words are what tell you whether this button is the one you want.
   */
  export: {
    title: "Export data",
    /**
     * Why you are looking at text instead of holding a file — but only where
     * that is true. This is an ordinary route, so it can be opened by a
     * browser that would have taken the file happily, and telling that person
     * their browser can't save one is just wrong (`fileHandoff`).
     */
    body: "This browser can’t save a file. Copy the text below into a"
      + " spreadsheet, or into Splitwise or Tricount.",
    /** The same screen, reached by a browser that could have saved it. */
    bodyPlain: "Copy the text below into a spreadsheet, or into Splitwise or Tricount.",
    copyAll: "Copy the spreadsheet",
    copied: "Copied",
    building: "Reading…",
    /** A group with no entries yet: a file of nothing but column headings. */
    nothing: "Nothing to export yet.",
  },

  /**
   * The other direction (`app/import/page.tsx`): somebody else's spreadsheet
   * as a group of ours.
   *
   * Written for a person who is leaving Splitwise, which is the only reason
   * this screen is ever opened — so it names that app, says what it will make,
   * and says up front that nothing already on the phone changes. The rest of
   * the screen is a readout of the file before a single op is written, because
   * the one question a person has here is "is it going to get my trip right",
   * and the only honest answer is to show them the count.
   *
   * **The refusals are the most-read words in this block.** A file that is
   * refused is refused whole, which is only bearable if the sentence says
   * which line and what to change — so every one of them names the fix, in the
   * file, where the fix has to happen. `ImportRefusalCode` in
   * `core/import.ts` is the list; `detail` is the fact each sentence needs.
   */
  importData: {
    title: "Import a group",
    /** What this makes, and what it's made from. */
    lede: "Create a new bida group using a file exported from Splitwise (or from bida).",
    pick: "Choose a file",
    /** The second way in, for a phone whose browser has no file picker worth
        using and for a file that arrived in a chat: the text itself. */
    orPaste: "Or paste the file’s text:",
    pastePlaceholder: "Date,Description,Category,Cost,Currency,…",
    read: "Read it",
    reading: "Reading…",
    /** Picked something that is plainly not a ledger (`looksLikeCsv`). */
    notFile: "That isn’t a spreadsheet file. In Splitwise, open the group, then Export as spreadsheet.",
    tooBig: "That file is far too big to be a group’s ledger.",

    /** The plan, before anything is written. */
    found: "What’s in the file",
    currency: "Currency",
    people: "People",
    entries: "Entries",
    transfers: "Transfers",
    /**
     * Rows that say a thing cost money and nothing about who — which is what
     * bida's own export writes for an expense it could not apportion. Named
     * rather than silently skipped: they are the one thing the import loses,
     * and a count that doesn't match the spreadsheet is worth a sentence.
     */
    dropped: (rows: string) => `${rows} left out, carrying no money`,
    /** Over the picker at the end — the same question joining a group asks. */
    who: "Which one are you?",
    act: "Create the group",
    failed: (why: string) => `Couldn’t import that file: ${why}`,

    /**
     * One sentence per `ImportRefusalCode`. `line` is 1-based, the way a
     * spreadsheet counts, and `detail` is whatever that code carries.
     */
    refused: {
      empty: () => "There is nothing in that file.",
      header: () => "That file doesn’t start with a Splitwise export’s columns: Date, Description, Category, Cost, Currency, and then one column per person.",
      "no-members": () => "That file has no columns for people, so there are no balances in it.",
      "duplicate-member": (f) => `Two columns are both called “${f.detail}”, so there is no telling which balance is whose. Rename one in the file.`,
      "blank-member": () => "One of the people columns has no name at the top of it. Name it in the file.",
      "bad-member-name": (f) => `A column is called “${f.detail}”, which bida can’t use as a name. Rename it in the file.`,
      "extra-cells": (f) => `Line ${f.line} has more cells than the file has columns (${f.detail}).`,
      "mixed-currency": (f) => `That file mixes ${f.detail}. bida can import one currency at a time, so split it or convert it first.`,
      "unknown-currency": (f) => (f.detail
        ? `“${f.detail}” isn’t a currency bida knows.`
        : "No row in that file says which currency it is in."),
      "no-foot": () => "That file has no “Total balance” row, so there is nothing to check the import against.",
      "bad-date": (f) => `Line ${f.line} has “${f.detail}” where a date should be. bida reads dates written as YYYY-MM-DD.`,
      "bad-amount": (f) => `Line ${f.line} has “${f.detail}” where an amount should be.`,
      "too-precise": (f) => `Line ${f.line} has an amount finer than its currency goes (${f.detail}).`,
      "row-not-zero": (f) => `Line ${f.line} doesn’t add up: the people’s columns should come to zero, and they come to ${f.detail}.`,
      overpaid: (f) => `Line ${f.line} says more was paid than the thing cost (${f.detail}).`,
      "no-entries": () => "There is nothing to import: no row in that file carries any money.",
      /**
       * The check that makes the whole feature trustworthy, so the sentence
       * says the file was left alone rather than apologising: bida read the
       * rows, added them up, and got something other than the file's own
       * total.
       */
      checksum: (f) => `The balances bida read don’t match the file’s own “Total balance” row (${f.detail}). Nothing was imported.`,
    } as Record<ImportRefusalCode, (fact: RefusalFact) => string>,
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
    /** A line of somebody else's spreadsheet — only the import counts these. */
    row: { one: "row", many: "rows" } as Noun,
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
    /**
     * Keys this phone holds whose groups have not arrived from the server yet
     * — a freshly installed icon carrying its invites, most of all. Not the
     * empty state: "No groups yet" on the first launch of an icon someone just
     * added to keep their groups is the app saying it lost them.
     */
    arriving: {
      title: "Getting your groups",
      body: "Finishes by itself once they sync.",
    },
    newGroup: "New group",
    /** The kebab's row, above About. What it makes is a group, which is why it
        is on this screen and not in a group's own menu, and the menu is the
        whole of it: a screen whose one act is "new group" does not need a
        second pitch on it. */
    importGroup: "Import a group",
    quickSplit: "Quick split",
    /** Only on an iOS home-screen app, which can't be handed a tapped link. */
    pasteLink: "Paste link",
    /** A good link for a group on another deployment, which this one can't open. */
    elsewhere: {
      title: "Link for another server",
      body: (host: string) => `That group lives on ${host}, so this app can’t open it. Open the link there, or ask for one made on this app.`,
    },
    about: "About bida",
    /** Last in the kebab, and named for what is behind it rather than for who
        it is for: a screen of settings most people never need, holding one
        thing today. */
    advanced: "Advanced",
    /** The kebab in the bar: the phone's own switches and the two screens the
        app spends on itself. */
    menu: "Menu",
    whoAreYou: "who are you?",
    /** In place of the figure for a moment, under the check that says the
        row's link is on the clipboard — lower case, like the words it stands in for. */
    copied: "copied",
    youOwe: "you owe",
    youreOwed: "you’re owed",
    settled: "settled",
    theme: { toLight: "Light mode", toDark: "Dark mode" },
  },

  install: {
    /**
     * Chrome's card: an **offer**, because on Android the tab and the installed
     * app are one storage and installing loses you nothing by being declined.
     * Its own button says just "Add" (`act.add`) — it opens the OS sheet where
     * it stands, so the card above it is the sentence.
     */
    title: "Keep bida on your home screen",
    body: "Own icon, no browser bar, works offline.",
    /**
     * The long form, for the two buttons that leave the screen they are on:
     * `/install` on iOS, and `/about`'s, which has no card over it to lean on.
     */
    act: "Add bida to home screen",
    /**
     * The iOS tab's card, once it holds a group (docs/ios.md). The same shape
     * and the same places as Chrome's, and a **warning** rather than an offer —
     * this browser really does clear the groups it is holding. Still a title
     * that says what you get rather than what goes wrong: it stands until the
     * phone installs, and a standing alarm reads as nagging.
     */
    banner: {
      title: "Keep your groups on this phone",
      body: (browser: string | undefined) => `${upper(browser)} may forget them.`,
    },
    /** `/install`: why, the folded after-note, then the recording. */
    page: {
      title: "Add to home screen",
      why: (browser: string | undefined) =>
        `${upper(browser)} may forget your groups if you don’t open bida for a week. Don’t worry, the invite link always brings them back.`,
      keep: "However, if you’d like to keep all your data permanently,",
      keepBold: "add bida to your home screen.",
      clipAlt: "In Safari: the menu, Share, View More, Add to Home Screen, then Add.",
      /**
       * The same walk the recording shows, in words above it. The clip settles
       * which button is meant faster than prose can, but it cannot be read in
       * a glance, cannot be searched, and says nothing at all to a screen
       * reader — so the steps lead and the clip confirms them.
       *
       * Two, naming the two buttons and nothing else: the taps between them —
       * scrolling the sheet, the Add that ends it — are what the clip is for,
       * and a step per tap turned two buttons to find into a procedure.
       */
      steps: [
        { icon: "share", text: "Tap the Share button" },
        { icon: "plus", text: "Select Add to home screen" },
      ],
      /**
       * Under the recording, for whoever installed and still meets the banner:
       * a tab cannot see the home-screen app, and the two keep their storage
       * apart (docs/ios.md). The owner's wording.
       */
      after: {
        ask: "Still seeing this after adding bida?",
        answer: (browser: string | undefined) =>
          `That’s normal, ${lower(browser)} can’t tell. Also, from now on, the group lists here and there are separate. Apple’s rules, not ours.`,
      },
    },
  },

  /**
   * The way out of an in-app browser, which is the whole app in one
   * (`components/embedded.tsx`). Two sentences and a link: what this place is,
   * and the two ways out of it — the app's own menu, or the link in a browser.
   *
   * It names the app where its webview says so, because "use the menu at the
   * top" is a different menu in each, and a person who is told which app they
   * are in stops looking for a bida setting they did the wrong thing to.
   */
  embedded: {
    title: "Open bida in your browser",
    why: (app: string | undefined) =>
      `${app ?? "This app"} opens links in a browser of its own. Nothing you do here is kept.`,
    /**
     * Written twice rather than assembled, because both halves differ: the
     * menu is an ellipsis on iOS and a kebab on Android, and the item under it
     * names Safari on one and says "external browser" on the other. Naming the
     * button is the whole value of the line. Where it sits is left out:
     * Instagram puts it at the top and Facebook at the bottom.
     */
    how: {
      ios: "Tap the ⋯ menu, then “Open in Safari”.",
      android: "Tap the ⋮ menu, then “Open in external browser”.",
    },
    /** Wordings drift between versions of these apps, so the link is the floor. */
    orPaste: "Can’t find it? Copy this link and paste it into your browser.",
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
  /**
   * The screen for things most people never open, and the first of them.
   *
   * Short on purpose: three paragraphs about the budget, the billing and where
   * the key is stored read as a disclaimer rather than an offer. Two facts
   * decide it — the phone calls Google itself, and Google bills the key.
   */
  advanced: {
    title: "Advanced",
    key: {
      title: "Bring your own key",
      lede: "Scans normally go through bida’s server, unencrypted and rate limited. You can use your own Gemini API key to avoid the rate limits and send your requests straight to Google.",
      where: "Get one free at Google AI Studio.",
      whereUrl: "https://aistudio.google.com/apikey",
      /** The free tier's own terms, not ours — worth re-checking before
          editing (docs/receipt-scanning.md#trust-and-what-were-accepting). */
      freeTier: "As of September 2026, the free plan allows 500 requests to Gemini 3.1 Flash Lite per day. Data may be used for model training.",
      placeholder: "Paste a Gemini API key",
      /** The plus files the key, the way the plus on a name files a name. */
      use: "Use this key",
      /** Between the press and Google's answer. */
      checking: "Checking…",
      remove: "Remove key",
      /** Under the locked field: the one line that says the paste worked. */
      accepted: "This phone scans with your key.",
      /**
       * The two refusals, which ask for different things. `refused` is the
       * key; `blocked` is this browser, and it is the one worth catching at
       * the moment of pasting, since a scan on a brought key is a call this
       * browser makes itself.
       */
      refused: "Google wouldn’t accept that key.",
      blocked: "This browser couldn’t reach Google. Something is blocking generativelanguage.googleapis.com.",
    },
  },

  about: {
    title: "About bida",
    /** The prefix on the number in the bar's corner, which is the build's and
     *  not copy's (lib/version.ts). It sticks to the digits — `v0.1.3` — so it
     *  is a mark rather than a label, and the corner stays quiet. */
    version: "v",
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
      scanTitle: "Receipt scanning leaves your phone.",
      scan: "Receipt photos are sent to Google’s Vertex AI to be read. Google doesn’t use them to train its models. For a day afterwards, the server remembers that this group scanned something, and a salted hash of your IP address: never the photo, never the raw address, only enough to keep the rate limits fair.",
      /** Points at `/advanced` rather than repeating it — what's true of a
          brought key (no cap, but a free-tier one trains on what it reads)
          is said once, there, and not again here. Ends right before the link
          itself, set inline mid-sentence (`app/about/page.tsx`). */
      ownKeyPointer: "If you want to send your own requests to Google directly, see",
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
    /**
     * The hosted service's one disclaimer, and the counterweight to the four
     * claims above it: they are all promises, and this is the sentence saying
     * who is behind them. MIT covers the code, not bida.bid, whose users are
     * strangers rather than friends who would ask (hosting.md).
     *
     * It reads after Privacy on purpose. Losing an invite link with nobody
     * left holding a copy is a consequence of the sealed row a paragraph
     * above, not an excuse — read before it, it would sound like one.
     */
    guarantees: {
      title: "No guarantees",
      lede: "Please back up anything important and use at your own risk.",
      /** The first and last of the three ways this can go wrong. The middle
          one links out mid-sentence, so it is `scanBreaks` below and not a
          fourth string here — see `app/about/page.tsx`. */
      warnings: [
        "The server runs on its own, for free, so your data is not going anywhere… unless Cloudflare changes their free-plan policy.",
        "If you manage to remove a group from every device and then lose the invite link, there’s no way to bring it back.",
      ],
      /** Split around the words that link to `/tip`, so the link lands on
          "tip jar" itself and not a row underneath it. Rendered between the
          two `warnings` above. */
      scanBreaks: { lede: "Receipt scanning will break if I stop paying for it. The ", link: "tip jar", tail: " helps!" },
    },
    feedback: {
      title: "Feedback",
      body: "I made this alone. Tell me what you think! Bug reports, feature requests, words of encouragement, words of discouragement.",
      email: "teodor.lamort@gmail.com",
      emailLabel: "Email",
      source: "GitHub",
      sourceUrl: "https://github.com/theoldg/bida",
    },
  },

  // --------------------------------------------------- deleting a group

  /**
   * `/delete-my-data`: the hosted service's answer to "take my data off your
   * server", and the only screen in the app that destroys anything
   * (docs/frontend.md#deleting-a-group).
   *
   * It is written to be read slowly, which is the opposite of everything else
   * here. Two reasons: the act is irreversible and there is no backup to
   * restore from, and it is not personal, so somebody deleting "their" data is
   * deleting a trip four other people are still using. Every warning below
   * says one of those two things, and the screen makes you type the group's
   * name because reading them is optional and typing is not.
   */
  deleteData: {
    title: "Delete a group",
    /**
     * On `/about`, its own short section, and the only mention of this screen
     * anywhere in the app. The address is spelled out rather than linked: a
     * link is one tap from a group four other people are still using, and
     * typing it yourself is the first of this screen's frictions.
     */
    fromAbout: {
      title: "Delete your data",
      body: (address: string) => `You can request data deletion by visiting ${address}.`,
    },
    lede: "This permanently erases a whole group from the server.",
    /** The three things people get wrong about what this button is for. */
    warnings: [
      "It deletes the group for everybody. Nobody else is asked.",
      "Every member device will also destroy their copy next time they open bida.",
      "It cannot be undone.",
    ],
    /** The one thing worth doing before the field below. */
    backup: "Make sure this is what you want, and consider backing up via the “export data” button.",
    ask: {
      title: "Which group?",
      body: "Paste the group’s invite link:",
      placeholder: "https://bida.bid/join#…",
      paste: "Paste link",
      act: "Find this group",
    },
    /** One sentence per way the link can fail to name a group to delete. */
    problems: {
      bad: "That is not an invite link. Open the group on a phone that has it, choose Copy invite link, and paste that.",
      elsewhere: (host: string) => `That link belongs to ${host}, not to this server. Open it there.`,
      missing: "This server has never heard of that group. Nothing of it is here to delete.",
      deleted: "That group has already been deleted.",
      refused: "The server refused that link: its password does not match the group.",
      unreadable: "That link opened nothing this app can read.",
      offline: "Couldn’t reach the server. Check your connection and try again.",
    },
    /** The group, opened and folded, so the person can see what they are about
     *  to lose before they are allowed to lose it. */
    found: {
      title: "This is what will be deleted",
      /** Labels, so the card reads as a description of a group rather than as
       *  three figures somebody has to interpret. */
      rows: { people: "People", entries: "Entries", edits: "Edits", started: "Started" },
      /** The friction. A button alone is one tap from a group that was somebody’s trip. */
      confirm: (name: string) => `Type ${name} below to confirm.`,
      placeholder: "Group name",
      mismatch: "That is not this group’s name.",
      act: "Delete this group",
      other: "Delete a different group",
    },
    /** The last stop, with the group named in the title so the dialog cannot
     *  be answered without reading which group it is about. */
    sure: {
      title: (name: string) => `Delete ${name}?`,
      body: "This is the point of no return. The server’s copy goes now, for everyone in the group, and cannot be restored.",
      act: "Delete for everyone",
    },
    failed: "The deletion didn’t go through, and nothing was deleted. Try again.",
    done: {
      title: "Deleted",
      body: (name: string) => `${name} is gone from the server, and off this phone.`,
      /** Said last because it is the one thing the button could not do. */
      rest: "Every other phone that has this group will destroy its own copy the next time it opens bida.",
      back: "Back to my groups",
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
    rate: "$5 ≈ 4,000 receipt scans",
    /**
     * The same $5, cut the way this group cuts everything else — and the
     * offer, said before the button that takes it. Splitting is the thing
     * this app is for, so the ask gets to be a thing five people share rather
     * than a thing one person pays.
     */
    each: (share: string) => `You can split it! In this group, that’s ${share} each.`,
    /** The same line, for the one group that can't actually split anything —
        a solo group still gets the whole ask, so the joke owns that instead
        of pretending the math works. */
    eachSolo: (share: string) => `You can split it! In this group, that’s ${share} each. `
      + "Okay, that doesn’t really land when it’s just you here, but you get the point.",
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
    /** Over the link a failed screen prints (`FailedLink`). */
    linkUsed: "Link used",
    /**
     * A link to a group with no password in it — nearly always the address
     * bar copied off a group screen, which names the group and nothing more
     * (group-link.ts). Said wherever that lands: `/join` with a group id and no
     * secret, and any `/g` screen for a group this phone doesn't hold — "bad
     * link" there would send the same address straight back.
     */
    keyless: {
      empty: "This link is missing its password",
      body: "A group’s address in the browser bar leaves out the part that unlocks it. Ask someone in the group to send the invite link from the app’s menu instead.",
      /** The drawn top bar's title — any group, not one of yours. */
      groupName: "Your group",
    },
    joining: {
      title: "Joining…",
      body: "Finishes by itself once the other phone syncs.",
    },
    /**
     * The group is not there any more: somebody deleted it for everybody
     * (app/delete-my-data/page.tsx). Said on `/join`, where an old invite link
     * would otherwise sit on "Joining…" forever, and on `/g`, where a phone
     * that was in the group finds its copy gone. One sentence for both: the
     * news is the same and neither has anything to do next.
     */
    deleted: {
      title: "This group was deleted",
      body: "Somebody in the group deleted it from the server, for everyone. Nothing of it is left.",
    },
  },

  /**
   * Paste link read nothing, so the box asks for the link by hand
   * (components/paste-link.tsx). The title is the whole of it: a field and the
   * word Paste say what to do, and "Nothing to paste" would often be a lie —
   * iOS can withhold the pasteboard from a read with the link on it.
   */
  paste: {
    title: "Paste the link here",
    placeholder: "Invite link",
    open: "Open",
  },

  /**
   * The demo group (app/demo/page.tsx). Reached only by its address, and the
   * group itself is the demonstration — so the words say the one thing looking
   * around cannot show you, which is that nothing here leaves the phone.
   */
  demo: {
    opening: "Opening the demo",
    /** The card at the head of its ledger. It stays put; it is not a toast. */
    title: "Demo group: not synced",
    /** In the group menu, where Forget group sits for every other group. */
    clear: "Clear the demo",
    /** Not "brings it back": the seed is deterministic, so what the address
     *  lays down is the story as shipped, not the one you played with. It is
     *  written out rather than linked, and the caller passes the host, because
     *  nothing in the app links to `/demo` and a static export cannot know
     *  which server it is being read from (`useHost`). */
    clearBody: (address: string) =>
      `This wipes the demo off the phone, along with anything you did in it. Visit ${address} to create a fresh one.`,
    /** The one genuinely broken thing: no key, so no invite link to hand over. */
    noLink: {
      title: "No invite link",
      body: "The demo is only ever on the phone it was opened on, so there is nothing to invite anybody to. Make a group of your own to share one.",
    },
  },

  claim: {
    title: "Which one are you?",
    /** `/g/claim`'s bar names the group; the question is the body's title. */
    join: (group: string) => `Join ${group}`,
    addPlaceholder: "Add your name",
    continueAs: (name: string) => `Continue as ${name}`,
    pickFirst: "Pick your name",
    /** Under the list, in an iOS tab: a tapped link always opens the browser,
     *  so someone with bida on the home screen has to hand it the link. */
    inApp: {
      title: "Have the app?",
      body: (browser: string | undefined) => `Links always open in ${lower(browser)}. Paste this there instead.`,
      copyLink: "Copy",
      copied: "Copied",
      /** No clipboard to write to at all, which some in-app browsers are
          (lib/clipboard.ts): the link is still there to be taken by hand. */
      hold: "Hold to copy",
    },
  },

  // ------------------------------------------------------------- the group

  group: {
    noGroup: "No group",
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
    /** In the menu, above Forget group: the way out with your numbers. */
    export: "Export data",
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
    whoTitle: "Which one are you?",
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
    payerCount: (label: string, people: string) => `${label} · ${people}`,
    /** "Split · evenly" · "Split · by items" · "To · as parts". */
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
    /** Over the split. Same word for an expense and an income — both answer
        "split how", not "spent on" vs "belongs to", and a reader flips
        between the two often enough that the label shouldn't. */
    split: { expense: "Split", income: "Split", transfer: "To" } as Record<EntryKind, string>,
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
    /**
     * The third way a bill gets in, offered on the Items tab alone: the same
     * reading, of words instead of a photograph. It stands apart from the pair
     * above rather than inside it, because those two are one act with two doors
     * — a camera now or a camera earlier — and this is the answer to not having
     * used one (docs/receipt-scanning.md#typing-a-bill-in).
     *
     * The label is the invitation and not the noun: "Bill text" would name a
     * field nobody asked for, and what the tap actually offers is doing it the
     * other way.
     */
    typeIn: {
      /**
       * Two labels for one door, the way the camera's has two (`snap`,
       * `rescan`): three doors share the width of a phone, and "Type it in" in
       * a third of 360 pixels leaves nothing for the glyph beside it. The chip
       * register is sized by its own content and standing among a bill's
       * figures, so there it says the whole thing.
       */
      open: "Type",
      openLong: "Type it in",
      title: "Type the bill in",
      /**
       * What to put in the box: the things bought, because that is what the
       * Items tab is for — a total alone leaves nothing to assign.
       *
       * It asks for nothing else, and in particular for no shape. The reading
       * wants neither one line each nor a total: prices each or per line both
       * work, and a bill with no total is the ordinary case rather than a
       * refused one. Every clause that named a format was a clause teaching
       * people to tidy a bill up for the app, so the sentence keeps none.
       */
      lede: "The items and prices, in any format.",
      placeholder: "3 chicken skewers at 13\nand 10 beef at 15\nlarge cola 10\ntip 10",
      field: "The bill, as text",
      confirm: "Read it",
      /** Only near the cap: a counter nobody is close to is fat. */
      left: (n: number) => `${n} characters left`,
      full: "That’s the longest bill this will read. Trim it, or photograph it instead.",
    },
    /** The same screen, named for the step left: nobody assigned yet, or a change to one. */
    assignWhoHadWhat: "Assign who had what",
    editWhoHadWhat: "Edit who-had-what",
    /** A consequence the screen can't show. It stays. Says only what is true
        of both paths: this line cannot tell whether the reader brought a key,
        and ours is read by a Vertex that does not train on it while a free
        brought one is not. The difference is `/about`'s to draw. */
    /** Under the control, so it names what the control sends — a photograph of
        the bill or the text of it, whichever door was used. */
    terms: "The bill is sent to Google",
    failed: "Couldn’t read that receipt.",
    keptOld: "The old one is still assigned.",
    /**
     * The app's own three refusals, one per way a reading can fail to add up
     * (`checkScan`). Each says which it is, because each asks for something
     * different back: another photo, a straighter one, or the form instead.
     *
     * Twice over, because two of the three name the fix and the fix depends on
     * how the bill arrived — "try a flatter, square-on photo" is no help at all
     * to somebody who typed it. The verdict is the same either way; only the
     * ask moves.
     */
    problem: {
      photo: {
        "no-total": "I can’t make out the total on that one.",
        "unreadable-line": "I can’t read every line on that one.",
        mismatch: "The lines don’t add up to the total. Try a flatter, square-on photo.",
      },
      text: {
        // Not "I can't find the total": a typed bill needn't have one. This
        // fires where there is nothing to price at all, or where a total is
        // there and won't parse.
        "no-total": "I can’t work out what that comes to.",
        "unreadable-line": "I can’t read an amount for every line in that.",
        // And this one's advice is now true — leaving the total out really does
        // leave the lines to speak for themselves (`checkScan`).
        mismatch: "The lines don’t add up to the total. Check the figures, or leave the total out.",
      },
    } satisfies Record<ScanMedium, Record<ScanProblem, string>>,
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
     * "Type this one in", meaning *into the form, by hand*.
     * There is a button of that name on this very tab now, and pressing it
     * spends the budget that has just refused — so they say the field instead.
     */
    limit: {
      you: "That’s your readings for now: reading a bill is capped. Fill the form in by hand, or come back later.",
      global: "The shared reading budget is spent. Fill the form in by hand, or try later.",
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
      server: "This browser check was refused: scanning is misconfigured here. Fill the form in by hand.",
    },
    /**
     * The two ways a key somebody brought themselves stops working. Neither is
     * about the photograph, and neither is fixed by trying again — so both name
     * the screen the key lives on, which is the only place anything can be done
     * about it.
     */
    key: {
      refused: "Google refused your key. Check it under Advanced.",
      spent: "Your key is out of quota for now. Try later, or remove it under Advanced to use the shared one.",
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
    /** `null` where the screen prints no currency at all — a quick split (ADR-0035). */
    tipLabel: (currency: string | null) =>
      currency ? `Tip and service, in ${currency}` : "Tip and service",
    /** The one affordance a person misses: the tip is a field, not a printed line. */
    tipHint: "tap to edit",
    /**
     * Which portion of a split line this row is, on the amount line beside the
     * figure. Written short because that line is the narrowest thing on the
     * screen — the name column is fixed, and on the first portion of an open
     * run it shares its width with the ×N — and "4.50 · 1 of 2" wrapped there,
     * leaving one portion of a pair taller than the other. `hadPortion` below
     * is what a screen reader gets, and it still says it in full.
     */
    portion: (index: number, of: number) => `${index}/${of}`,
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
      `${name} had some of the ${n} ${label}. Open the line to see which`,
    hadPortion: (name: string, label: string, index: number, of: number) =>
      `${name} had ${label}, portion ${index} of ${of}`,
    /** The line itself, which is the everybody/nobody switch for its row. */
    everyone: (label: string) => `${label}: everyone, or no one`,
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
