// Doc: docs/frontend.md#every-word-in-libcopyts
import type {
  ExtraKind, ImportRefusalCode, ImportSource, ScanProblem, SplitSpec,
} from "@bida/core";
import type { EntryKind } from "./entry-kind";
import type { KeyHost } from "./db/dexie";
import type { LineKind } from "./scan/manual";
import { chosenLang } from "./lang";
import { pl } from "./copy-pl";

/**
 * Every word the app says to a person, in one place — for translation (ADR-0033)
 * and tone. Screens hold no readable literal (`rules-check`); a string needing a
 * value is a function, since translations reorder words; plurals go through
 * `plural()`. A second language is `copy-pl.ts`, the same shape (`Copy`).
 */

/** `few` is Polish's 2–4, 22–24…; a language without one leaves it out for `many`. */
export interface Noun {
  one: string;
  few?: string;
  many: string;
}

interface RefusalFact {
  line?: number;
  detail?: string;
}

export type Voice = "expense" | "income";
type Voiced<T> = Record<Voice, T>;

const extraSubject: Record<ExtraKind, string> = {
  discount: "discounts", charge: "charges", tip: "tip",
};

const upper = (browser: string | undefined) => browser ?? "This browser";
const lower = (browser: string | undefined) => browser ?? "this browser";

const en = {
  app: {
    name: "bida",
    description: "Split things. Mostly bills.",
    /** The group's name can't be had here (docs/pwa.md). */
    invite: "Join the group",
    /** A quick split's link: what it opens can't be had here either. */
    split: "Bill split details",
    banner: "bida, split things, mostly bills: a receipt split between Ana and Ben",
  },

  /** One verb each — never "OK". */
  act: {
    add: "Add",
    back: "Back",
    cancel: "Cancel",
    record: "Record",
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

  db: {
    stalled: "Still reading this phone’s data…",
    blocked: "Another copy of bida is open. Close it to carry on here.",
    broken: {
      title: "Can’t read this phone’s data",
      body: "Nothing is lost: it is still on this phone. Reloading usually clears this.",
    },
  },

  diag: {
    title: "Diagnostics",
    // For whoever long-pressed the wordmark by accident: a screen of numbers
    // reads as surveillance until it says whose it is and where it goes.
    what: {
      ask: "What is this page?",
      lead: "This is a hidden screen I use to fix bugs in the app. The report below stays"
        + " on your phone, nothing sends it anywhere. If something breaks, tap ",
      tail: " and send it to me. Also, congratulations, you’ve found Staś mode!",
    },
    reading: "Reading…",
    copyAll: "Copy the report",
    copied: "Copied",
    stas: "Staś mode",
    stasNote: "Send a bad photo, get insulted.",
    on: "On",
    off: "Off",
    lang: "Language",
    cropLink: "Test the scan crop",
    crop: {
      title: "Scan crop",
      lede: "Pick photos of bills to see what a scan would send. Nothing leaves the phone.",
      pick: "Pick photos",
      loading: "Loading the crop model…",
      loaded: (ms: number) => `Crop model ready in ${ms} ms`,
      failed: "The crop model didn’t load. Scans will send the whole photo.",
      working: "Working…",
      whole: "whole photo",
      close: "Close",
    },
  },

  export: {
    title: "Export data",
    body: "This browser can’t save a file. Copy the text below into a"
      + " spreadsheet, or into Splitwise or Tricount.",
    bodyPlain: "Copy the text below into a spreadsheet, or into Splitwise or Tricount.",
    copyAll: "Copy the spreadsheet",
    copied: "Copied",
    building: "Reading…",
    nothing: "Nothing to export yet.",
  },

  /**
   * The refusals are the most-read words here: a file is refused whole, so each
   * names the line and the fix.
   */
  importData: {
    title: "Import a group",
    lede: "Create a new bida group using a file exported from Splitwise (or from bida).",
    pick: "Choose a file",

    orTricount: "Or paste a Tricount link:",
    tricountPlaceholder: "https://tricount.com/…",
    fetch: "Fetch it",
    fetching: "Fetching…",
    /** The one thing that leaves the phone readable. */
    fineprint: "Sent through bida’s server, unencrypted. Not stored.",
    notTricount: "That isn’t a Tricount link. In Tricount, open the tricount, then Share, then copy the link.",
    tricountOffline: "This phone can’t reach the internet, and a Tricount link has to be fetched.",
    tricountDown: "Tricount isn’t answering. Tricount has no official way to export a group, so bida reads it the way Tricount’s own app does, and that can stop working without warning. Try again in a while.",
    notFile: "That isn’t a spreadsheet file. In Splitwise, open the group, then Export as spreadsheet.",
    tooBig: "That file is far too big to be a group’s ledger.",

    found: "What’s in the file",
    currency: "Currency",
    alsoIn: "Also in",
    priced: "Those are converted at the rate on each entry’s day, looked up when the group is created.",
    people: "People",
    entries: "Entries",
    /** Named, since they're the only thing lost. */
    dropped: (rows: string) => `${rows} left out, carrying no money`,
    named: (group: string) => `Import ${group}`,
    act: "Create the group",
    failed: (why: string) => `Couldn’t import that file: ${why}`,
    writing: (percent: number) => `Importing… ${percent}%`,
    noRates: (codes: string) => `bida couldn’t look up any ${codes} rates. Try again in a while`,
    noRatesOffline: "this phone can’t reach the internet to look up the rates",

    refused: {
      empty: () => "There is nothing in that file.",
      header: () => "That file doesn’t start with a Splitwise export’s columns: Date, Description, Category, Cost, Currency, and then one column per person.",
      "no-members": () => "There are no people in it, so there are no balances to import.",
      "duplicate-member": (f) => `Two people in it are both called “${f.detail}”, so there is no telling which balance is whose. Rename one of them where it came from.`,
      "blank-member": () => "One of the people in it has no name at all. Name them where it came from.",
      "bad-member-name": (f) => `Somebody in it is called “${f.detail}”, which bida can’t use as a name. Rename them where it came from.`,
      "extra-cells": (f) => `Line ${f.line} has more cells than the file has columns (${f.detail}).`,
      "mixed-currency": (f) => `That tricount states its amounts in ${f.detail}, which bida doesn’t know how to read.`,
      "unknown-currency": (f) => (f.detail
        ? `“${f.detail}” isn’t a currency bida knows.`
        : "No row in that file says which currency it is in."),
      "no-foot": (f) => (f.detail
        ? `That file has no “Total balance” row for ${f.detail}, so there is nothing to check those rows against.`
        : "That file has no “Total balance” row, so there is nothing to check the import against."),
      "duplicate-foot": (f) => `Line ${f.line} is a second “Total balance” row for ${f.detail}, so there is no telling which one to check against.`,
      "blank-currency": (f) => `Line ${f.line} doesn’t say which currency it is in, and the file has more than one.`,
      "bad-date": (f) => `Line ${f.line} has “${f.detail}” where a date should be. bida reads dates written as YYYY-MM-DD.`,
      "bad-amount": (f) => `Line ${f.line} has “${f.detail}” where an amount should be.`,
      "too-precise": (f) => `Line ${f.line} has an amount finer than its currency goes (${f.detail}).`,
      "row-not-zero": (f) => `Line ${f.line} doesn’t add up: the people’s columns should come to zero, and they come to ${f.detail}.`,
      overpaid: (f) => `Line ${f.line} says more was paid than the thing cost (${f.detail}).`,
      "no-entries": () => "There is nothing to import: nothing in it carries any money.",
      checksum: (f) => `The balances bida read don’t match the ones it was given (${f.detail}). Nothing was imported.`,

      "not-tricount": () => "That link doesn’t open a Tricount. Check that it is the link Tricount’s own Share gives you, and that the tricount still exists.",
      "tricount-amount": (f) => `One entry (${f.detail}) has an amount bida can’t read.`,
      "tricount-date": (f) => `One entry (${f.detail}) has no date bida can read, and filing a whole trip under today isn’t a guess worth making.`,
      "tricount-split": (f) => `One entry (${f.detail}) doesn’t add up: the shares should come to what it cost.`,
    } as Record<ImportRefusalCode, (fact: RefusalFact) => string>,
  },

  /** Each in its own language, so either can be found from the other. */
  languages: { en: "English", pl: "Polski" },

  unknown: "?",
  none: "—",
  someone: "Someone",
  someoneLower: "someone",

  noun: {
    change: { one: "change", many: "changes" } as Noun,
    entry: { one: "entry", many: "entries" } as Noun,
    item: { one: "item", many: "items" } as Noun,
    part: { one: "part", many: "parts" } as Noun,
    person: { one: "person", many: "people" } as Noun,
    photo: { one: "photo", many: "photos" } as Noun,
    revision: { one: "revision", many: "revisions" } as Noun,
    newChange: { one: "new change", many: "new changes" } as Noun,
    row: { one: "row", many: "rows" } as Noun,
  },

  time: {
    today: "Today",
    yesterday: "Yesterday",
    justNow: "just now",
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo: (n: number) => `${n}h ago`,
    daysAgo: (n: number) => `${n}d ago`,
    agoYesterday: "yesterday",
    /** Ours, not the phone's locale. */
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    months: ["January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December"],
    /** As said inside a date: Polish has "4 kwietnia" but "kwiecień 2026". */
    monthsOf: ["January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December"],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    day: (weekday: string, day: number, month: string) => `${weekday} ${day} ${month}`,
    dayInYear: (day: number, month: string, year: number) => `${day} ${month} ${year}`,
    monthInYear: (month: string, year: number) => `${month} ${year}`,
  },

  // ------------------------------------------------------------- groups list

  groups: {
    empty: {
      title: "No groups yet",
      body: "A trip, a flat, a dinner: anything several people pay for.",
    },
    /** Not "No groups yet", which would read as losing them. */
    arriving: {
      title: "Getting your groups",
      body: "Finishes by itself once they sync.",
    },
    newGroup: "New group",
    quickSplit: "Quick split",
    pasteLink: "Paste link",
    elsewhere: {
      title: "Link for another server",
      body: (host: string) => `That group lives on ${host}, so this app can’t open it. Open the link there, or ask for one made on this app.`,
    },
    about: "About bida",
    settings: "Settings",
    menu: "Menu",
    whoAreYou: "who are you?",
    copied: "copied",
    youOwe: "you owe",
    youreOwed: "you’re owed",
    settled: "settled",
  },

  notify: {
    /** Worded as a choice, not a pitch: either answer clears the card. */
    offer: {
      title: "Notifications?",
      body: "Only sent for entries that affect you. Answer yes or no to hide this card.",
      act: "Choose",
    },

    added: (who: string, what: string, amount: string) => `${who} added ${what} · ${amount}`,
    deleted: (who: string, what: string, amount: string) => `${who} deleted ${what} · ${amount}`,
    restored: (who: string, what: string, amount: string) => `${who} restored ${what} · ${amount}`,
    edited: (who: string, what: string) => `${who} edited ${what}`,
    changedAmount: (who: string, what: string, was: string, now: string) =>
      `${who} changed the amount of ${what}: ${was} → ${now}`,
    changedSplit: (who: string, what: string) => `${who} changed how ${what} is split`,
    changedPayers: (who: string, what: string) => `${who} changed who paid for ${what}`,
    toIncome: (who: string, what: string) => `${who} turned ${what} into an income`,
    toExpense: (who: string, what: string) => `${who} turned ${what} into an expense`,
    addedMany: (who: string, entries: string) => `${who} added ${entries}`,
    changedMany: (who: string, entries: string) => `${who} changed ${entries}`,
    quoted: (description: string) => `“${description}”`,
    untitled: "an entry",

    paidYou: (who: string, amount: string) => `${who} paid you ${amount}`,
    recordedPaidYou: (who: string, from: string, amount: string) =>
      `${who} recorded that ${from} paid you ${amount}`,
    recordedYouPaid: (who: string, to: string, amount: string) =>
      `${who} recorded that you paid ${to} ${amount}`,
    recordedPaid: (who: string, from: string, to: string, amount: string) =>
      `${who} recorded that ${from} paid ${to} ${amount}`,
    transfer: (from: string, to: string) => `${from} → ${to}`,
    you: "you",
    them: "them",

    share: (share: string) => `Your share ${share}`,
    shareMoved: (was: string, now: string) => `Your share ${was} → ${now}`,
    shareWas: (share: string) => `Your share was ${share}`,
    paid: (paid: string) => `You paid ${paid}`,
    received: (paid: string) => `You received ${paid}`,
    paidAndShare: (paid: string, share: string) => `You paid ${paid} · your share ${share}`,
    receivedAndShare: (paid: string, share: string) => `You received ${paid} · your share ${share}`,
    none: "none",
  },

  install: {
    title: "Keep bida on your home screen",
    body: "Own icon, no browser bar, works offline.",
    act: "Add bida to home screen",
    /**
     * A warning, as Safari really does clear groups, but titled with the gain,
     * since it stands until installed.
     */
    banner: {
      title: "Keep your groups on this phone",
      body: (browser: string | undefined) => `${upper(browser)} may forget them.`,
    },
    page: {
      title: "Add to home screen",
      why: (browser: string | undefined) =>
        `${upper(browser)} may forget your groups if you don’t open bida for a week. Don’t worry, the invite link always brings them back.`,
      keep: "However, if you’d like to keep all your data permanently,",
      keepBold: "add bida to your home screen.",
      clipAlt: "In Safari: the menu, Share, View More, Add to Home Screen, then Add.",
      /**
       * The clip can't be read at a glance, searched, or heard by a screen
       * reader. Each beside its icon (`STEP_ICONS`, install/page.tsx).
       */
      steps: ["Tap the Share button", "Select Add to home screen"],
      after: {
        ask: "Still seeing this after adding bida?",
        answer: (browser: string | undefined) =>
          `That’s normal, ${lower(browser)} can’t tell. Also, from now on, the group lists here and there are separate. Apple’s rules, not ours.`,
      },
    },
  },

  embedded: {
    title: (app: string | undefined) => `One-off visit in ${app ? `${app}’s` : "this app’s"} browser.`,
    detail: "We recommend opening in your main browser.",
    /** Android's: the button hands the page to the default browser. */
    open: "Open in browser",
    /** iOS's: no page can open Safari, so say which button does (its `⋯` is drawn as one), and hand over the link. */
    how: "Tap ⋯, then “Open in browser”.",
    /** Android's, under its button, for a host that drops the `intent:`. */
    howElse: "Nothing? Tap ⋯, then “Open in browser”.",
    orCopy: "Or copy and paste the link:",
  },

  update: {
    title: "A new version is ready",
    act: "Reload",
  },

  // ----------------------------------------------------------------- about

  /**
   * The privacy section is a claim about the code (ADR-0036): change it in the
   * same commit if that stops being true.
   */
  settings: {
    title: "Settings",
    theme: { title: "Theme", light: "Light", dark: "Dark" },
    version: { title: "Version" },
    notify: {
      title: "Notifications",
      level: { off: "Off", own: "Just me", all: "All" },
      means: {
        off: "No notifications at all.",
        own: "Only entries that involve you.",
        all: "Every edit in your groups.",
      },
      blocked: "Turned off in your phone’s settings. Allow notifications for bida there to choose here.",
    },
  },

  advanced: {
    title: "Advanced",
    key: {
      title: "Bring your own key",
      lede: "Scans normally go through bida’s server, unencrypted and rate limited. You can use your own Gemini or Vertex AI API key to avoid the rate limits and send your requests straight to Google.",
      where: "Get one free at Google AI Studio.",
      whereUrl: "https://aistudio.google.com/apikey",
      /** Google's terms, not ours — re-check before editing. */
      freeTier: "As of September 2026, the free plan allows 500 requests to Gemini 3.1 Flash Lite per day. Data may be used for model training.",
      site: { lede: "Check their ", link: "website", tail: "." },
      placeholder: "Paste a Gemini or Vertex AI key",
      use: "Use this key",
      checking: "Checking…",
      remove: "Remove key",
      /** Says which host answered: the other one would bill elsewhere. */
      accepted: {
        "ai-studio": "This phone scans with your Gemini key.",
        vertex: "This phone scans with your Vertex AI key.",
      } satisfies Record<KeyHost, string>,
      refused: "Google wouldn’t accept that key.",
      blocked: "This browser couldn’t reach Google. Something is blocking googleapis.com.",
    },
  },

  about: {
    title: "About bida",
    version: "v",
    noAccounts: {
      title: "No account",
      body: "A group is a secret link. Whoever has it can edit, and every edit is recorded in the group’s history.",
    },
    offline: {
      title: "Works offline",
      body: "Add bida to your home screen and it keeps working with no signal at all. Expenses you write offline sync when you’re back online.",
      bodyInstalled: "Because bida is added to your home screen, it keeps working with no signal at all. Expenses you write offline sync when you’re back online.",
    },
    privacy: {
      title: "Privacy",
      e2eTitle: "Nearly everything is encrypted end to end.",
      body: "That includes notifications, if you turn them on. When you save an expense, the server (and I, the developer) can see something like this:",
      sealed: [
        { k: "group", v: "c9f0f8…" },
        { k: "edit", v: "8f14e4…" },
        { k: "number", v: "42" },
        { k: "contents", v: "AQz8k…w==" },
      ],
      key: "The key that decodes the contents is part of the secret link, and it never reaches the server. I can see how many groups there are, how many edits each one has had, and how many quick splits were sent as links. That’s it.",
      scanTitle: "Receipt scanning leaves your phone.",
      scan: "Receipt photos are sent to Google’s Vertex AI to be read. Google doesn’t use them to train its models. For a day afterwards, the server remembers that this group scanned something, and a salted hash of your IP address: never the photo, never the raw address, only enough to keep the rate limits fair.",
      ownKeyPointer: "If you want to send your own requests to Google directly, see",
      importTitle: "Importing a Tricount leaves your phone.",
      import: "Your browser can’t fetch a tricount, so bida’s server does it for you. It’s not encrypted, but nothing is stored.",
    },
    /**
     * MIT covers the code, not bida.bid. After Privacy on purpose: before it,
     * losing a link would read as an excuse.
     */
    guarantees: {
      title: "No guarantees",
      lede: "Please back up anything important and use at your own risk.",
      warnings: [
        "The server runs on its own, for free, so your data is not going anywhere… unless Cloudflare changes their free-plan policy.",
        "If you manage to remove a group from every device and then lose the invite link, there’s no way to bring it back.",
      ],
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
   * The only screen that destroys anything, written to be read slowly. Typing the
   * name is required because reading is optional.
   */
  deleteData: {
    title: "Delete a group",
    fromAbout: {
      title: "Delete your data",
      body: (address: string) => `You can request data deletion by visiting ${address}.`,
    },
    lede: "This permanently erases a whole group from the server.",
    warnings: [
      "It deletes the group for everybody. Nobody else is asked.",
      "Every member device will also destroy their copy next time they open bida.",
      "It cannot be undone.",
    ],
    backup: "Make sure this is what you want, and consider backing up via the “export data” button.",
    ask: {
      title: "Which group?",
      body: "Paste the group’s invite link, or a quick split’s link:",
      placeholder: "https://bida.bid/join#…",
      paste: "Paste link",
      act: "Find this group",
    },
    problems: {
      bad: "That is not an invite link. Open the group on a phone that has it, choose Copy invite link, and paste that.",
      elsewhere: (host: string) => `That link belongs to ${host}, not to this server. Open it there.`,
      missing: "This server has never heard of that group. Nothing of it is here to delete.",
      deleted: "That group has already been deleted.",
      refused: "The server refused that link: its password does not match the group.",
      unreadable: "That link opened nothing this app can read.",
      offline: "Couldn’t reach the server. Check your connection and try again.",
      noSplit: "There’s no split at that link. Nothing of it is here to delete.",
    },
    found: {
      title: "This is what will be deleted",
      rows: { people: "People", entries: "Entries", edits: "Edits", started: "Started" },
      confirm: (name: string) => `Type ${name} below to confirm.`,
      placeholder: "Group name",
      mismatch: "That is not this group’s name.",
      act: "Delete this group",
      other: "Delete a different group",
    },
    sure: {
      title: (name: string) => `Delete ${name}?`,
      body: "This is the point of no return. The server’s copy goes now, for everyone in the group, and cannot be restored.",
      act: "Delete for everyone",
    },
    failed: "The deletion didn’t go through, and nothing was deleted. Try again.",
    /** A quick split's link pasted instead (ADR-0035): one row, nobody's group. */
    split: {
      rows: { people: "People", total: "Total" },
      act: "Delete this split",
      other: "Delete something else",
      sure: {
        title: (name: string) => `Delete ${name}?`,
        body: "The server’s copy goes now, and the link stops opening it.",
        act: "Delete",
      },
      done: (name: string) => `${name} is gone from the server.`,
    },
    done: {
      title: "Deleted",
      body: (name: string) => `${name} is gone from the server, and off this phone.`,
      rest: "Every other phone that has this group will destroy its own copy the next time it opens bida.",
      back: "Back to my groups",
    },
  },

  // ------------------------------------------------------------- tip jar

  tip: {
    title: "Support bida",
    fab: "Support bida",
    lede: "Enjoying bida? Consider donating a few bucks.",
    why: "Scanning is the only part of bida that costs money to run. I pay for it.",
    /**
     * The same figure as `SCAN_LIMITS`' day cap (core/scan.ts); if the price
     * moves, both move.
     */
    rate: "$5 ≈ 4,000 receipt scans",
    each: (share: string) => `You can split it! In this group, that’s ${share} each.`,
    eachSolo: (share: string) => `You can split it! In this group, that’s ${share} each. `
      + "Okay, that doesn’t really land when it’s just you here, but you get the point.",
    yacht: "If there’s any money left over, I’ll buy a yacht.",
    donate: {
      cta: "Donate",
      url: "https://buymeacoffee.com/theoldg",
    },
    split: {
      cta: "Add as a group expense",
      entryTitle: "We liked bida",
    },
  },

  // ------------------------------------------------------------- new group

  newGroup: {
    title: "New group",
    named: (group: string) => `Create ${group}`,
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
    linkUsed: "Link used",
    /**
     * Usually the address bar copied off a group screen; "bad link" would send
     * the same address back.
     */
    keyless: {
      empty: "This link is missing its password",
      body: "A group’s address in the browser bar leaves out the part that unlocks it. Ask someone in the group to send the invite link from the app’s menu instead.",
      groupName: "Your group",
    },
    joining: {
      title: "Joining…",
      fetching: (percent: number) => `Downloading… ${percent}%`,
      body: "Taking a while. Either this phone is offline, or whoever sent the link hasn’t been online since making the group. It carries on by itself.",
    },
    deleted: {
      title: "This group was deleted",
      body: "Somebody in the group deleted it from the server, for everyone. Nothing of it is left.",
    },
  },

  /** Not "Nothing to paste": iOS can withhold a pasteboard that has the link. */
  paste: {
    title: "Invite link",
    placeholder: "Paste it here",
    open: "Open",
  },

  demo: {
    opening: "Opening the demo",
    title: "Demo group: not synced",
    clear: "Clear the demo",
    clearTitle: "Clear the demo?",
    /**
     * Not "brings it back": the seed restores the story as shipped. The caller
     * passes the host, which a static export can't know.
     */
    clearBody: (address: string) =>
      `This wipes the demo off the phone, along with anything you did in it. Visit ${address} to create a fresh one.`,
    noLink: {
      title: "No invite link",
      body: "The demo is only ever on the phone it was opened on, so there is nothing to invite anybody to. Make a group of your own to share one.",
    },
  },

  claim: {
    title: "Which one are you?",
    join: (group: string) => `Join ${group}`,
    addPlaceholder: "Add your name",
    continueAs: (name: string) => `Continue as ${name}`,
    pickFirst: "Pick your name",
    inApp: {
      title: "Have the app?",
      body: (browser: string | undefined) => `Links always open in ${lower(browser)}. Paste this there instead.`,
      copyLink: "Copy",
      copied: "Copied",
      hold: "Hold to copy",
    },
  },

  // ------------------------------------------------------------- the group

  group: {
    noGroup: "No group",
    offlineIdle: "Offline: you may not have everyone’s latest.",
    offlinePending: (waiting: string) => `Offline: ${waiting} waiting.`,
    // There is no secret rotation, so a "fresh" link is identical; reopening the
    // invite link clears this (`saveGroupKey` unsets the failure).
    rejected: "This phone’s link doesn’t open this group. Open the invite link again.",
    unreachableIdle: "Can’t reach the server: you may not have everyone’s latest.",
    unreachablePending: (waiting: string) => `Can’t reach the server: ${waiting} stuck on this phone.`,

    hasLeft: "removed",
    youTag: "(you)",

    balances: "Balances",
    history: "History",
    historyNew: "History, new changes",
    people: "People",
    copyLink: "Copy invite link",
    export: "Export data",
    menu: "Group menu",
    linkTitle: "The invite link",
    linkBody: "Copying didn’t work: hold the link to copy it.",
    addEntry: "Add an entry",

    empty: { title: "Nothing here yet", body: "Tap + to add the first thing." },
    search: {
      field: "Search",
      clear: "Clear search",
      /** The group menu's row, which brings the bar out wherever the list is. */
      menu: "Search",
      by: {
        title: "by title", payer: "by payer", participant: "by participant",
        currency: "by currency", kind: "by kind", amount: "by amount",
      },
      none: { title: "Nothing found", body: (query: string) => `No entry matches “${query}”.` },
    },
    untitled: "Untitled",
    notYours: "not yours",
    groupHistory: "Group history",
    you: {
      owe: "You owe",
      owed: "You’re owed",
      square: "You’re square",
    },
    morePayers: (n: number) => `+${n}`,
    sharedBy: (people: string) => `shared by ${people}`,
    metaLine: (a: string, b: string) => `${a} · ${b}`,
    transfer: "Transfer",
    incomeTag: "income",
    paidTo: (from: string, to: string) => `${from} → ${to}`,

    unsplittable: (n: number) => (n === 1 ? "1 expense couldn’t be split" : `${n} expenses couldn’t be split`),
    unsplittableWhy: (reason: string) => `${reason}: left out of the balances.`,
    suggestedReimbursements: "Suggested reimbursements",
    allSquare: "Everyone’s square",
    recordTitle: "Record this reimbursement?",
    notWho: {
      ask: "How are these worked out?",
      lead: "They use as few payments as possible (",
      term: "debt simplification",
      owe: "). If you owe Luke 10 and Luke owes Leia 10, "
        + "paying Leia directly settles both. Your total is the same.",
      owed: "). If Luke owes Leia 10 and Leia owes you 10, "
        + "Luke paying you directly settles both. Your total is the same.",
    },
  },

  // ------------------------------------------------------------- people

  members: {
    title: "People",
    addPlaceholder: "Add someone",
    taken: (name: string) => `${name} is already here.`,
    removeLabel: (name: string) => `Remove ${name}`,
    whoChange: "Change who you are",
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: "They aren’t involved in any entry.",
    blockedTitle: (name: string) => `Can’t remove ${name}`,
    blockedBody: (n: number) => (n === 1 ? "Named on 1 entry." : `Named on ${n} entries.`),
    lastBody: "Add somebody else first.",
    forget: "Forget group",
    forgetTitle: "Forget this group?",
    forgetBody: "The invite link brings it back.",
  },

  // ------------------------------------------------------------- quick split

  quick: {
    title: "Quick split",
    lede: "Take a photo of the bill, then tap who had what.",
    who: "Who’s splitting",
    noLines: "That receipt has no lines on it. There’s nothing to assign.",
    keptOld: "The bill you had is still here.",
    discardTitle: "Discard this split?",
    /** Its own: Polish ends a split with "Zakończ", not the form's "Gotowe". */
    done: "Done",
    doneTitle: "Finished with this split?",
    discardBody: "Nothing about it is kept.",
    split: "The split",
    /** The copy icon is the verb, and `verb` is it to a reader. */
    copy: { verb: "Copy", label: "Totals and link" },
    copied: "Copied",
    fallbackTitle: "The split",
    fallbackBody: "Copying didn’t work: hold the text to copy it.",
    /** What is copied: who owes what, then the link to the lines behind it. */
    message: {
      line: (label: string, amount: string) => `${label}: ${amount}`,
      untitled: "Bill split",
      link: (url: string) => `Who had what: ${url}`,
    },
    notShared: {
      title: "Not sent",
      offline: "This phone is offline. Try again once you’re back.",
      unsent: "The split didn’t reach bida, so the copied link won’t open yet. Try again.",
    },
    /** `/split`, where the link lands. Its bar is `split`, over the bill's name. */
    landing: {
      none: "There’s no split at this link. A chat may have cut it short: ask for it again.",
      offline: "Couldn’t reach bida. Check your connection and try again.",
      unreadable: "That link opened nothing this version of bida can read.",
    },
  },

  // ------------------------------------------------------------- one entry

  entry: {
    gone: { title: "Gone", body: "There is no such entry in this group." },
    arriving: "Fetching the latest…",
    history: "History",
    createdBy: (who: string) => `Created by ${who}`,
    importedBy: (who: string, from?: string) =>
      (from ? `Imported from ${from} by ${who}` : `Imported by ${who}`),
    imported: (from?: string) => (from ? `Imported from ${from}` : "Imported"),
    edited: (n: number) => (n === 1 ? "Edited once" : `Edited ${n} times`),
    editedBy: (n: number, who: string) => (n === 1 ? `by ${who}` : `last by ${who}`),
    byLead: { expense: "paid by", income: "received by" } as Voiced<string>,
    /** A split of one, said as the payer is: "evenly" between one is no split. */
    forLead: "for",
    you: "you",
    yourBalance: "Your balance",
    sumWords: { expense: ["you paid", "your share"], income: ["your share", "you received"] } as
      Record<"expense" | "income", readonly [string, string]>,
    splitMode: (label: string, mode: string) => `${label} ${mode}`,
    deleteTitle: (kind: string) => `Delete this ${kind}?`,
    deleteBody: "It can be restored from the history.",
    deletedTitle: (kind: string) => `Deleted ${kind.toLowerCase()}`,
    deleted: (who: string | undefined) => (who ? `Deleted by ${who}` : "Deleted"),
    restore: "Restore",
    restoreBrings: (things: string[]) => {
      const list = things.length < 2 ? things.join("")
        : `${things.slice(0, -1).join(", ")} and ${things[things.length - 1]}`;
      return `${list[0]?.toUpperCase() ?? ""}${list.slice(1)} ${things.length === 1 ? "comes" : "come"} back too.`;
    },
    from: "From",
    to: "To",
  },

  entryKind: {
    label: { expense: "Expense", income: "Income", transfer: "Transfer" } as Record<EntryKind, string>,
    payer: { expense: "Paid by", income: "Paid to", transfer: "From" } as Record<EntryKind, string>,
    /** One word for both: they answer "split how", and readers switch often. */
    split: { expense: "Split", income: "Split", transfer: "To" } as Record<EntryKind, string>,
    /**
     * "Transfer" versus "expense" is the pair picked wrong, so each says where
     * the money goes.
     */
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
    editKind: (kind: string) => `Edit ${kind}`,
    kindTitle: "What kind of entry",
    amount: (currency: string) => `Amount in ${currency}`,
    currency: "Currency",
    fromReceipt: "from receipt",
    rateLabel: (from: string, to: string) => `Rate, ${from} to ${to}`,
    what: "What",
    whatPlaceholder: "Title",
    note: "Note (optional)",
    /** The note on a transfer settle-up's Record writes (`balances/page.tsx`); the form never seeds it. */
    reimbursement: "Reimbursement",
    when: "When",
    multiPayer: "Multiple people",
    multiPayerNeedsAmount: "set the amount first",
    discardTitle: (kind: string) => `Discard this ${kind}?`,
    discardTitleEdits: "Discard edits?",
    discardBody: "Changes will be lost.",
    saveFailed: (why: string) => `Couldn’t save: ${why}`,
    noRate: (code: string) => `Set the ${code} rate`,
    rateLooking: (code: string) => `Looking up the ${code} rate…`,
    noAmount: "Set the amount",
    noTitle: "Set the title",
    noScan: "Scan the bill, or split it another way",
    /** A figure that doesn't add up, named by the field holding it. */
    offBy: (field: string, problem: string) => `${field}: ${problem}`,
    noItemsGiven: "Assign bill items",
    goneMember: (name: string) => `${name} is no longer in the group. Pick somebody else.`,
    nobodyTitle: "Nobody in this group yet",
    nobodyBody: "Add the people sharing this first.",
    sentBy: "Who sent it",
    receivedBy: "Who received it",
    swapSides: "Swap the two sides",
    sameSide: "Pick two different people.",
    otherSide: "the other side: picking swaps them",
  },

  /**
   * Every sentence is `Voiced`, or an income would say "Ana didn't pay" under
   * "Who received it".
   */
  payers: {
    title: {
      expense: "Who paid",
      income: "Who received it",
    } as Voiced<string>,
    contribution: {
      expense: (name: string) => `${name}’s contribution`,
      income: (name: string) => `How much ${name} received`,
    } as Voiced<(name: string) => string>,
    clear: (name: string) => `Clear ${name}’s amount`,
    giveRest: (name: string) => `Give ${name} the rest`,
    edit: (name: string) => `Type ${name}’s amount`,
    accountedFor: (allocated: string, total: string) => `${allocated} of ${total} accounted for`,
    nobody: {
      expense: "Nobody has put money in yet",
      income: "Nobody has received any of it yet",
    } as Voiced<string>,
    under: (amount: string) => `${amount} still unaccounted for`,
    over: (amount: string) => `${amount} more than the entry`,
    discardTitle: "Discard these payers?",
    discardBody: "The entry goes back to whoever it named before.",
  },

  // ------------------------------------------------------------- the split

  split: {
    /**
     * "By items", not "From receipt": these name how money divides, not how it
     * was typed.
     */
    mode: {
      equal: "Evenly",
      shares: "As parts",
      exact: "As amounts",
      receipt: "By items",
    } as Record<SplitSpec["mode"], string>,
    /** The mode inside a sentence: "Split evenly", and the history's "split it as parts". */
    how: {
      equal: "evenly",
      shares: "as parts",
      exact: "as amounts",
      receipt: "by items",
    } as Record<SplitSpec["mode"], string>,
    receipt: "Items",
    include: (name: string) => `Include ${name}`,
    leaveOut: (name: string) => `Leave ${name} out`,
    fewerParts: (name: string) => `Fewer parts for ${name}`,
    moreParts: (name: string) => `More parts for ${name}`,
    partsFor: (name: string) => `${name}’s parts`,
    amountFor: (name: string) => `${name}’s amount`,
    clearOut: (name: string) => `Clear ${name}’s amount and leave them out`,
    joinRest: (name: string) => `Have ${name} share what’s left`,
    notInvolved: "not involved",
    sharingRest: "sharing the rest",
    fixedAmount: "fixed amount",
    everyone: {
      count: (n: number, total: number) => `${n} of ${total} in the split`,
      in: "Include everyone",
      out: "Leave everyone out",
    },
    /** Wording checked by lib/format.test.ts. */
    nobody: "Nobody is included yet",
    under: (amount: string) => `${amount} left to split`,
    over: (amount: string) => `${amount} too much`,
    nothingLeft: (who: string) => `Nothing left for ${who}`,
    people: (n: number) => `${n} people`,
  },

  // ------------------------------------------------------------- receipts

  scan: {
    title: "Scan a receipt",
    diagram: {
      alt: "Photograph the bill and the expense fills itself in: what it cost, what it’s called, and when.",
      /**
       * The lines add up to `amount` — `lib/scan/diagram.test.ts` checks the sum.
       */
      lines: [
        ["Bantha steak", "18.00"],
        ["Nerf nuggets", "14.50"],
        ["Jawa juice", "9.40"],
        ["Blue milk", "6.30"],
      ],
      total: "Total",
      title: "Cantina",
      amount: "48.20",
      date: "4 May",
      people: ["Chewie", "Obi-Wan", "Leia"],
    },
    lede: "Take a photo to fill in the expense. Split it evenly, or line by line.",
    snap: "Scan",
    upload: "Upload",
    /** The doors once a bill is held, which replace it — and "Edit" rather than type one. */
    rescan: "Rescan",
    reupload: "Reupload",
    reading: "Reading…",
    camera: "Take a photo of a receipt",
    library: "Upload a receipt photo",
    byHand: {
      open: "Type",
      edit: "Edit",
      title: "Bill items",
      nameOf: (n: number) => `Line ${n}`,
      remove: (what: string) => `Remove ${what}`,
      kind: { item: "Item", discount: "Discount", charge: "Charge" } satisfies Record<LineKind, string>,
      kindNote: {
        item: "Split by who had it",
        discount: "Taken off everyone, in proportion",
        charge: "Service or tax on top, added in proportion",
      } satisfies Record<LineKind, string>,
      kindTitle: "What is this line?",
      kindOf: (n: number, kind: string) => `Line ${n}: ${kind}. Change`,
      tip: "Tip:",
      countOf: (n: number) => `How many of item ${n}`,
      fewer: (n: number) => `One fewer of item ${n}`,
      more: (n: number) => `One more of item ${n}`,
      each: "each",
      total: "total",
      sum: "Total:",
      eachOf: (n: number) => `Price of one of item ${n}`,
      priceOf: (n: number) => `Price of line ${n}`,
      add: "Add an item",
      none: "Add an item first.",
      blank: "A line is empty.",
      noName: "A line has no name.",
      noPrice: (name: string) => `${name} has no price.`,
      overOff: "The discounts leave nothing to pay.",
      discardTitle: "Discard these changes?",
      discardBody: "The bill stays as it was.",
    },
    assignWhoHadWhat: "Assign who-had-what",
    editWhoHadWhat: "Edit who-had-what",
    /**
     * True of both paths: only a brought free-tier key trains on the image, and
     * `/about` draws the difference. Images, not the bill: one typed in goes
     * nowhere.
     */
    terms: "Images are scanned by Google",
    failed: "Couldn’t read that receipt.",
    keptOld: "The old one is still assigned.",
    problem: {
      "no-total": "I can’t make out the total on that one.",
      "unreadable-line": "I can’t read every line on that one.",
      mismatch: "The lines don’t add up to the total. Try a flatter, square-on photo.",
    } satisfies Record<ScanProblem, string>,
    offline: "You’re offline: scanning needs a connection.",
    busy: "Gemini’s busy. Try again in a minute.",
    /** Waiting doesn't help a spent budget; typing the items in costs none of it. */
    limit: {
      you: "That’s your readings for now: reading a bill is capped. Fill the form in by hand, or come back later.",
      global: "The shared reading budget is spent. Fill the form in by hand, or try later.",
    },
    /**
     * `browser` is this phone's network (try another); `server` is the
     * deployment's key (retrying can't help).
     */
    unverified: {
      browser: "Couldn’t check this browser: scanning needs challenges.cloudflare.com.",
      server: "This browser check was refused: scanning is misconfigured here. Fill the form in by hand.",
    },
    key: {
      refused: "Google refused your key. Check it in Settings, under Advanced.",
      spent: "Your key is out of quota for now. Try later, or remove it in Settings, under Advanced, to use the shared one.",
    },
  },

  items: {
    title: "Who had what",
    none: { title: "No line items on that scan", body: "Split it from the form instead." },
    whoWasThere: "Who was there",
    wasThere: (name: string) => `${name} was there`,
    wasntThere: (name: string) => `${name} wasn’t there`,
    /** What a line is called where the bill named it nothing: an unnamed charge is a tax from before charges had names. */
    extra: { tip: "Tip", charge: "Tax", discount: "Discounts" } satisfies Record<ExtraKind, string>,
    tipPercent: (percent: number) => `${percent}%`,
    tipLabel: (currency: string | null) => (currency ? `Tip, in ${currency}` : "Tip"),
    translate: { on: "Show the bill in English", off: "Show the bill as printed" },
    shown: { english: "In English", printed: "As printed" },
    /** Short: "1 of 2" wrapped on the narrowest line on screen. */
    portion: (index: number, of: number) => `${index}/${of}`,
    showPortions: (n: number) => `Show the ${n} portions one by one`,
    openItem: (label: string, n: number) => `Show the ${n} ${label} portions one by one`,
    mergeBack: "Show as one line",
    splitDiscounts: (n: number) => `Show the ${n} discounts one by one`,
    mergeDiscounts: (n: number) => `Show the ${n} discounts as one figure`,
    mergeItem: (label: string, n: number) => `Show the ${n} ${label} portions as one line`,
    had: (name: string, label: string) => `${name} had ${label}`,
    hadAll: (name: string, label: string, n: number) => `${name} had all ${n} ${label}`,
    sharedAll: (name: string, label: string, n: number) => `${name} shared the ${n} ${label}`,
    hadSome: (name: string, label: string, n: number) =>
      `${name} had some of the ${n} ${label}. Open the line to see which`,
    hadPortion: (name: string, label: string, index: number, of: number) =>
      `${name} had ${label}, portion ${index} of ${of}`,
    everyone: (label: string) => `${label}: everyone, or no one`,
    share: (name: string) => `${name}’s share`,
    needsSomeone: "Every item needs at least one person.",
    extraNote: (kinds: ExtraKind[]) => {
      const names = kinds.map((k) => extraSubject[k]);
      const subject = names.length < 2
        ? names.join("")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      const verb = names.length === 1 && kinds[0] === "tip" ? "is" : "are";
      return `${subject[0]?.toUpperCase() ?? ""}${subject.slice(1)} ${verb} applied proportionally.`;
    },
    discardTitle: "Discard this grid?",
    discardBody: "The bill goes back to the lines the scan read.",
  },

  // ------------------------------------------------------------- history

  history: {
    title: "History",
    entryTitle: "Entry history",
    entry: "Entry",
    empty: "Nothing here yet",
    subject: (name: string, revisions: string) => `${name} · ${revisions}`,
    deleted: (label: string) => `${label} · deleted`,
    untitled: "Untitled entry",
    more: (rest: string) => `Show ${rest} more`,
    newLine: "↑ New",

    field: {
      kind: "Kind",
      involved: "Who’s involved",
      split: "Split",
      splitMode: "Split mode",
      splitAs: (mode: string) => `Split ${mode}`,
      receipt: "Receipt",
      billText: "Bill text",
      whoHadWhat: "Who had what",
      billLanguage: "Bill shown",
      amount: "Amount",
      currency: "Currency",
      rate: "Rate",
      putIn: "How much each",
      description: "Description",
      date: "Date",
      category: "Category",
      photos: "Photos",
      sides: "Between",
      note: "Note",
    },

    createdEntry: (who: string, noun: string) => `${who} created this ${noun}`,
    importedEntry: (who: string, noun: string, from?: string) =>
      `${who} imported this ${noun}${from ? ` from ${from}` : ""}`,
    deletedEntry: (who: string, noun: string) => `${who} deleted this ${noun}`,
    restoredEntry: (who: string, noun: string) => `${who} restored this ${noun}`,
    editedEntry: (who: string, noun: string) => `${who} edited this ${noun}`,
    toIncome: (who: string) => `${who} turned this into an income`,
    toExpense: (who: string) => `${who} turned this back into an expense`,
    changedInvolved: (who: string) => `${who} changed who’s involved`,
    changedShares: (who: string) => `${who} changed how it’s split`,
    splitAs: (who: string, mode: string) => `${who} split it ${mode}`,
    shareOf: (name: string, value: string) => `${name} ${value}`,
    everyone: "Everyone",
    everyoneBut: (names: string) => `Everyone but ${names}`,
    everyoneIn: "everyone",
    everyoneButIn: (names: string) => `everyone but ${names}`,
    everyoneElse: "Everyone else",
    quantity: (n: number, amount: string) => `${n}× ${amount}`,
    onLine: (line: string, what: string) => `${line}: ${what}`,
    handedOver: (was: string, now: string) => `${was} → ${now}`,
    joinedLine: (came: string, stayed: string) => `${came} joined ${stayed}`,
    leftLine: (gone: string) => `${gone} dropped out`,
    nobody: "nobody",
    atTheTable: "At the table",
    forPeople: (amount: string, names: string) => `${amount} · for ${names}`,
    rewroteSplit: (who: string) => `${who} changed how the split is written`,
    addedReceipt: (who: string) => `${who} added a receipt`,
    changedReceipt: (who: string) => `${who} changed the receipt`,
    removedReceipt: (who: string) => `${who} removed the receipt`,
    retypedBill: (who: string) => `${who} retyped the bill`,
    changedWhoHadWhat: (who: string) => `${who} changed who had what`,
    readBill: (who: string, english: boolean) =>
      english ? `${who} showed the bill in English` : `${who} showed the bill as printed`,
    changedAmount: (who: string) => `${who} changed the amount`,
    changedCurrency: (who: string) => `${who} changed the currency`,
    changedRate: (who: string) => `${who} changed the rate`,
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
    became: (was: string, now: string) => `${was} became ${now}`,
    recordedTransfer: (who: string) => `${who} recorded a transfer`,
    importedTransfer: (who: string, from?: string) =>
      `${who} imported a transfer${from ? ` from ${from}` : ""}`,
    deletedTransfer: (who: string) => `${who} deleted a transfer`,
    restoredTransfer: (who: string) => `${who} restored a transfer`,
    editedTransfer: (who: string) => `${who} edited a transfer`,
    changedSides: (who: string) => `${who} changed who it was between`,
    changedNote: (who: string) => `${who} changed the note`,
    joined: (them: string) => `${them} joined the group`,
    added: (who: string, them: string) => `${who} added ${them}`,
    removed: (who: string, them: string) => `${who} removed ${them}`,
    readded: (them: string) => `${them} was removed, but an entry still names them: added back`,
    restoredRate: (code: string) =>
      `The ${code} rate was cleared, but entries still use it: put back`,
    rateMovedOnto: (code: string) => `The group’s ${code} rate was written onto this entry, as each now keeps its own`,
    renamedSelf: (who: string) => `${who} changed their name`,
    renamed: (who: string, was: string) => `${who} renamed ${was}`,
    updatedMember: (who: string, them: string) => `${who} updated ${them}`,
    updatedSelf: (who: string) => `${who} updated their own details`,
    createdGroup: (who: string) => `${who} created the group`,
    importedGroup: (who: string, from: string) => `${who} imported the group from ${from}`,
    importSource: { tricount: "Tricount", file: "a file" } as Record<ImportSource, string>,
    renamedGroup: (who: string) => `${who} renamed the group`,
    archivedGroup: (who: string) => `${who} archived the group`,
    restoredGroup: (who: string) => `${who} restored the group`,
    updatedGroup: (who: string) => `${who} updated the group`,
    setRate: (who: string, code: string) => `${who} set the ${code} rate`,
    changedRateFor: (who: string, code: string) => `${who} changed the ${code} rate`,
    removedRate: (who: string, code: string) => `${who} removed the ${code} rate`,
    ratePair: (code: string, rate: string, base: string) => `1 ${code} = ${rate} ${base}`,
  },

  currency: {
    title: "Currency",
    other: "Other…",
    otherNote: "any three-letter code",
    otherPlaceholder: "UZS",
    isBase: "the group settles in this",
  },

  // ------------------------------------------------------ exchange rates

  rates: {
    editTitle: (code: string) => `${code} rate`,
    oneOf: (code: string) => `1 ${code} =`,
    from: {
      fetched: (date: string) => `looked up: the rate on ${date}`,
      fetchedUndated: "looked up",
      typed: "yours",
      copied: "couldn’t look it up: the group’s last rate",
      imported: "the rate it was imported with",
      group: "the group’s rate when this was written",
      loading: "looking it up…",
      offline: "offline: type it",
      unavailable: "couldn’t look it up: type it",
    },
    refetch: "Look it up",
    failed: (why: string) => `Couldn’t save the rate: ${why}`,
    at: "@",
    openFor: (code: string) => `Set the ${code} rate`,
  },
} as const;

/** The shape every language fills: `en`'s, with its words widened to `string`. */
type Widen<T> = T extends string ? string
  : T extends number ? number
    : T extends (...args: infer A) => infer R ? (...args: A) => Widen<R>
      : { readonly [K in keyof T]: Widen<T[K]> };
export type Copy = Widen<typeof en>;

export const lang = chosenLang();
export const copy: Copy = lang === "pl" ? pl : en;
