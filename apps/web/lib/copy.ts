import type {
  ExtraKind, ImportRefusalCode, ScanMedium, ScanProblem, SplitSpec,
} from "@bida/core";
import type { EntryKind } from "./entry-kind";

/**
 * Every word the app says to a person, in one place — for translation (a
 * second language is a second copy of this object, ADR-0033) and for tone.
 *
 * - Screens never hold a readable literal; `scripts/rules-check.mjs` enforces it.
 * - A string needing a value is a function here: translations reorder words.
 * - Plurals go through `plural()` with a `{ one, many }` noun, never `${n}s`.
 * - Say it once, short ([standing-instructions](../../../docs/standing-instructions.md#interface)).
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

/** Money out is *paid*, money in is *received*. A transfer has no payer side. */
export type Voice = "expense" | "income";
type Voiced<T> = Record<Voice, T>;

/** The bill's charges mid-sentence, lower case — one caption line fits three and a verb. */
const extraSubject: Record<ExtraKind, string> = {
  discount: "discount", tax: "tax", tip: "tip",
};

/** The iOS browser by name when `iosBrowser` can tell, at a sentence's start or inside it. */
const upper = (browser: string | undefined) => browser ?? "This browser";
const lower = (browser: string | undefined) => browser ?? "this browser";

export const copy = {
  app: {
    name: "bida",
    /** The page description: the line under "bida" in a pasted-link preview. Never shown in-app. */
    description: "No-nonsense expense splitter.",
  },

  /** Buttons. One verb each — a button never says "OK". */
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

  /** Reading this phone's database failed; without these the screen just stays on skeletons. lib/db/live.ts. */
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

  /** `/diag` (long-press the wordmark on the groups list). Untranslated preformatted text. */
  diag: {
    title: "Diagnostics",
    reading: "Reading…",
    copyAll: "Copy the report",
    copied: "Copied",
    /** The switch in lib/scan/stas.ts; the line under it warns the refusals get personal. */
    stas: "Staś mode",
    stasNote: "Send a bad photo, get insulted.",
    on: "On",
    off: "Off",
  },

  /** Names Splitwise and Tricount, since "CSV" doesn't tell you it's the right button. */
  export: {
    title: "Export data",
    /** Only where the browser really can't save a file (`fileHandoff`). */
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
   * `app/import/page.tsx`: a Splitwise export (or ours) as a new group. Nothing
   * existing changes, and the file is read out before any op is written.
   *
   * **The refusals are the most-read words here**: a file is refused whole, so
   * each names the line and the fix. `ImportRefusalCode` in `core/import.ts` is
   * the list; `detail` is the fact each needs.
   */
  importData: {
    title: "Import a group",
    /** What this makes, and what it's made from. */
    lede: "Create a new bida group using a file exported from Splitwise (or from bida).",
    pick: "Choose a file",
    /** Back to the two ways in, once a plan is on screen and is not the one wanted. */
    again: "Start again",

    /** Fetched from its link, so it asks nothing of the other app. */
    orTricount: "Or paste a Tricount link:",
    tricountPlaceholder: "https://tricount.com/…",
    fetch: "Fetch it",
    fetching: "Fetching…",
    /**
     * Under the button: the link goes through our Worker (the browser can't call
     * bunq), the one thing that leaves the phone readable (`apps/api/src/index.ts`).
     */
    fineprint: "Sent through bida’s server, unencrypted. Not stored.",
    /** Pasted something with no tricount key in it, before anything is sent. */
    notTricount: "That isn’t a Tricount link. In Tricount, open the tricount, then Share, then copy the link.",
    /** The phone is off the network — its own failure, not the link's. */
    tricountOffline: "This phone can’t reach the internet, and a Tricount link has to be fetched.",
    /** Tricount is not answering us. Nothing about the link is wrong. */
    tricountDown: "Tricount isn’t answering. Tricount has no official way to export a group, so bida reads it the way Tricount’s own app does, and that can stop working without warning. Exporting from Tricount to a file and choosing it above still works.",
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
     * All-zero rows (what bida's export writes for an unapportionable expense).
     * Named, since they're the only thing lost and the count would differ.
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
      "no-members": () => "There are no people in it, so there are no balances to import.",
      "duplicate-member": (f) => `Two people in it are both called “${f.detail}”, so there is no telling which balance is whose. Rename one of them where it came from.`,
      "blank-member": () => "One of the people in it has no name at all. Name them where it came from.",
      "bad-member-name": (f) => `Somebody in it is called “${f.detail}”, which bida can’t use as a name. Rename them where it came from.`,
      "extra-cells": (f) => `Line ${f.line} has more cells than the file has columns (${f.detail}).`,
      "mixed-currency": (f) => `That mixes ${f.detail}. bida can import one currency at a time, so split it or convert it first.`,
      "unknown-currency": (f) => (f.detail
        ? `“${f.detail}” isn’t a currency bida knows.`
        : "No row in that file says which currency it is in."),
      "no-foot": () => "That file has no “Total balance” row, so there is nothing to check the import against.",
      "bad-date": (f) => `Line ${f.line} has “${f.detail}” where a date should be. bida reads dates written as YYYY-MM-DD.`,
      "bad-amount": (f) => `Line ${f.line} has “${f.detail}” where an amount should be.`,
      "too-precise": (f) => `Line ${f.line} has an amount finer than its currency goes (${f.detail}).`,
      "row-not-zero": (f) => `Line ${f.line} doesn’t add up: the people’s columns should come to zero, and they come to ${f.detail}.`,
      overpaid: (f) => `Line ${f.line} says more was paid than the thing cost (${f.detail}).`,
      "no-entries": () => "There is nothing to import: nothing in it carries any money.",
      /** Says the file was left alone: bida's sums didn't match the file's own total. */
      checksum: (f) => `The balances bida read don’t match the ones it was given (${f.detail}). Nothing was imported.`,

      /** Name the entry, not a line. The first is nobody's fault: Tricount's API is unofficial. */
      "not-tricount": () => "That link doesn’t open a Tricount. Check that it is the link Tricount’s own Share gives you, and that the tricount still exists.",
      "tricount-amount": (f) => `One entry (${f.detail}) has an amount bida can’t read.`,
      "tricount-date": (f) => `One entry (${f.detail}) has no date bida can read, and filing a whole trip under today isn’t a guess worth making.`,
      "tricount-split": (f) => `One entry (${f.detail}) doesn’t add up: the shares should come to what it cost.`,
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
    newChange: { one: "new change", many: "new changes" } as Noun,
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
     * Keys held whose groups haven't arrived yet — a new home-screen icon carrying
     * its invites. Not "No groups yet", which would read as losing them.
     */
    arriving: {
      title: "Getting your groups",
      body: "Finishes by itself once they sync.",
    },
    newGroup: "New group",
    /** Kebab row above About; on this screen because what it makes is a group. */
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
    /** Last in the kebab, named for what's behind it. */
    advanced: "Advanced",
    /** The bar's kebab: the phone's switches and the app's own screens. */
    menu: "Menu",
    whoAreYou: "who are you?",
    /** Replaces the figure for a moment after copying a row's link; lower case like it. */
    copied: "copied",
    youOwe: "you owe",
    youreOwed: "you’re owed",
    settled: "settled",
    theme: { toLight: "Light mode", toDark: "Dark mode" },
  },

  notify: {
    /**
     * The installed app's card, in the install offer's place (components/install.tsx).
     * Its tap is the one iOS lets ask for permission. Worded as a choice, not a
     * pitch: either answer clears the card, so the tap is also how it goes away.
     */
    offer: {
      title: "Notifications?",
      body: "Only sent for entries that affect you. Answer yes or no to hide this card.",
      act: "Choose",
    },

    /**
     * What another phone shows (lib/notify-copy.ts): the group's name over
     * these. `what` arrives quoted already; `who` is a member's name.
     */
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
    /** Several entries in one push: the share line under it is their sum. */
    addedMany: (who: string, entries: string) => `${who} added ${entries}`,
    changedMany: (who: string, entries: string) => `${who} changed ${entries}`,
    quoted: (description: string) => `“${description}”`,
    untitled: "an entry",

    /** A transfer, from where the reader stands. */
    paidYou: (who: string, amount: string) => `${who} paid you ${amount}`,
    recordedPaidYou: (who: string, from: string, amount: string) =>
      `${who} recorded that ${from} paid you ${amount}`,
    recordedYouPaid: (who: string, to: string, amount: string) =>
      `${who} recorded that you paid ${to} ${amount}`,
    recordedPaid: (who: string, from: string, to: string, amount: string) =>
      `${who} recorded that ${from} paid ${to} ${amount}`,
    /** A transfer's name in the sentences above: "Bo → you". */
    transfer: (from: string, to: string) => `${from} → ${to}`,
    you: "you",
    them: "them",

    /** The second line: the reader's side of it. */
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
    /**
     * Chrome's card: an **offer** — on Android the tab and the app share storage.
     * Its button is just "Add" (`act.add`); the card is the sentence.
     */
    title: "Keep bida on your home screen",
    body: "Own icon, no browser bar, works offline.",
    /** The long form, for `/install` on iOS and `/about`, which have no card above. */
    act: "Add bida to home screen",
    /**
     * The iOS tab's card once it holds a group (docs/ios.md): a **warning**, as
     * Safari really does clear groups — but titled with the gain, since it stands
     * until installed and a standing alarm nags.
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
       * The walk the recording shows, in words above it: the clip can't be read at
       * a glance, searched, or heard by a screen reader. Two steps, naming the two
       * buttons; the taps between are what the clip is for.
       */
      steps: [
        { icon: "share", text: "Tap the Share button" },
        { icon: "plus", text: "Select Add to home screen" },
      ],
      /**
       * For whoever installed and still sees the banner: a tab can't see the
       * home-screen app, and they don't share storage (docs/ios.md).
       */
      after: {
        ask: "Still seeing this after adding bida?",
        answer: (browser: string | undefined) =>
          `That’s normal, ${lower(browser)} can’t tell. Also, from now on, the group lists here and there are separate. Apple’s rules, not ours.`,
      },
    },
  },

  /**
   * The in-app-browser screen (`components/embedded.tsx`): what this is, and the
   * ways out. Names the host app where known, since "the menu" differs per app.
   */
  embedded: {
    title: "Open bida in your browser",
    why: (app: string | undefined) =>
      `${app ?? "This app"} opens links in a browser of its own. Nothing you do here is kept.`,
    /**
     * Written twice: the menu is an ellipsis on iOS and a kebab on Android, and
     * the item names Safari or "external browser". Position is omitted —
     * Instagram and Facebook differ.
     */
    how: {
      ios: "Tap the ⋯ menu, then “Open in Safari”.",
      android: "Tap the ⋮ menu, then “Open in external browser”.",
    },
    /** App wordings drift between versions, so the link is the fallback. */
    orPaste: "Can’t find it? Copy this link and paste it into your browser.",
  },

  /** The waiting service worker (lib/update.ts). */
  update: {
    title: "A new version is ready",
    act: "Reload",
  },

  // ----------------------------------------------------------------- about

  /**
   * The app's one screen about itself (app/about/page.tsx): who can edit, does
   * it work offline, who can read it. The privacy section is a claim about the
   * code — bodies are sealed under a key the server never sees (ADR-0036),
   * which is why the sample is a real `SealedOp`. Change it in the same commit
   * if that stops being true.
   */
  /**
   * The screen for rarely needed settings, starting with bringing your own key.
   * Short: the phone calls Google itself, and Google bills the key.
   */
  advanced: {
    title: "Advanced",
    key: {
      title: "Bring your own key",
      lede: "Scans normally go through bida’s server, unencrypted and rate limited. You can use your own Gemini API key to avoid the rate limits and send your requests straight to Google.",
      where: "Get one free at Google AI Studio.",
      whereUrl: "https://aistudio.google.com/apikey",
      /** Google's terms, not ours — re-check before editing (docs/receipt-scanning.md#trust-and-what-were-accepting). */
      freeTier: "As of September 2026, the free plan allows 500 requests to Gemini 3.1 Flash Lite per day. Data may be used for model training.",
      /** Split around the inline link. */
      site: { lede: "Check their ", link: "website", tail: "." },
      placeholder: "Paste a Gemini API key",
      /** The plus files the key, the way the plus on a name files a name. */
      use: "Use this key",
      /** Between the press and Google's answer. */
      checking: "Checking…",
      remove: "Remove key",
      /** Under the locked field: the one line that says the paste worked. */
      accepted: "This phone scans with your key.",
      /**
       * `refused` is the key's fault; `blocked` is this browser's, worth catching
       * on paste since a brought-key scan is a call the browser makes itself.
       */
      refused: "Google wouldn’t accept that key.",
      blocked: "This browser couldn’t reach Google. Something is blocking generativelanguage.googleapis.com.",
    },
  },

  about: {
    title: "About bida",
    /** Prefix on the build number (lib/version.ts): `v0.1.3`. */
    version: "v",
    noAccounts: {
      title: "No account",
      body: "A group is a secret link. Whoever has it can edit, and every edit is recorded in the group’s history.",
    },
    offline: {
      title: "Works offline",
      body: "Add bida to your home screen and it keeps working with no signal at all. Expenses you write offline sync when you’re back online.",
      /** When already installed, so it states the fact instead of the offer. */
      bodyInstalled: "Because bida is added to your home screen, it keeps working with no signal at all. Expenses you write offline sync when you’re back online.",
    },
    privacy: {
      title: "Privacy",
      /** Leads the section: the rule first, then its two exceptions. */
      e2eTitle: "Nearly everything is encrypted end to end.",
      body: "That includes notifications, if you turn them on. When you save an expense, the server (and I, the developer) can see something like this:",
      /** One D1 row: a `SealedOp` (core/seal.ts). Plain-English labels; the point is there are only four fields. */
      sealed: [
        { k: "group", v: "c9f0f8…" },
        { k: "edit", v: "8f14e4…" },
        { k: "number", v: "42" },
        { k: "contents", v: "AQz8k…w==" },
      ],
      /** One paragraph: the key, then what that leaves visible. */
      key: "The key that decodes the contents is part of the secret link, and it never reaches the server. I can see how many groups there are, and how many edits each one has had. That’s it.",
      scanTitle: "Receipt scanning leaves your phone.",
      scan: "Receipt photos are sent to Google’s Vertex AI to be read. Google doesn’t use them to train its models. For a day afterwards, the server remembers that this group scanned something, and a salted hash of your IP address: never the photo, never the raw address, only enough to keep the rate limits fair.",
      /** Points at `/advanced` instead of repeating it; ends before the inline link (`app/about/page.tsx`). */
      ownKeyPointer: "If you want to send your own requests to Google directly, see",
      /**
       * The second of the two things that leave the phone readable. Also said under
       * the import button (`importData.fineprint`); repeated where people come to ask.
       */
      importTitle: "Importing a Tricount leaves your phone.",
      import: "Your browser can’t fetch a tricount, so bida’s server does it for you. It’s not encrypted, but nothing is stored.",
    },
    /**
     * The hosted service's one disclaimer: MIT covers the code, not bida.bid, whose
     * users are strangers (hosting.md). After Privacy on purpose — losing a link is
     * a consequence of the sealing above, and before it would read as an excuse.
     */
    guarantees: {
      title: "No guarantees",
      lede: "Please back up anything important and use at your own risk.",
      /** The first and last warnings; the middle links out mid-sentence, so it's `scanBreaks` (`app/about/page.tsx`). */
      warnings: [
        "The server runs on its own, for free, so your data is not going anywhere… unless Cloudflare changes their free-plan policy.",
        "If you manage to remove a group from every device and then lose the invite link, there’s no way to bring it back.",
      ],
      /** Split around the words linking to `/tip`; rendered between the two `warnings`. */
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
   * `/delete-my-data` (docs/frontend.md#deleting-a-group), the only screen that
   * destroys anything. Written to be read slowly: it's irreversible with no
   * backup, and the group is shared, so "your" data is others' trip too. Typing
   * the name is required because reading is optional.
   */
  deleteData: {
    title: "Delete a group",
    /** Its section on `/about`, the only mention. The address is spelled out, not linked: typing it is the first friction. */
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
    /** The folded group, shown before it can be deleted. */
    found: {
      title: "This is what will be deleted",
      /** Labels, so the card reads as a group rather than bare figures. */
      rows: { people: "People", entries: "Entries", edits: "Edits", started: "Started" },
      /** The friction: a button alone is one tap from somebody's trip. */
      confirm: (name: string) => `Type ${name} below to confirm.`,
      placeholder: "Group name",
      mismatch: "That is not this group’s name.",
      act: "Delete this group",
      other: "Delete a different group",
    },
    /** The group named in the title, so the dialog can't be answered unread. */
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
   * The only screen asking for money, from the foot of the balances. It asks
   * for the one thing not free to run, with the figure `SCAN_LIMITS` is set from
   * (core/scan.ts, docs/receipt-scanning.md#what-the-scan-costs).
   */
  tip: {
    title: "Support bida",
    /** The balances' FAB — the only one with a word in it. */
    fab: "Support bida",
    lede: "Enjoying bida? Consider donating a few bucks.",
    /** Why there is an ask at all, in one line, above the figure it explains. */
    why: "Scanning is the only part of bida that costs money to run. I pay for it.",
    /** The same figure as `SCAN_LIMITS`' day cap (core/scan.ts); if the price moves, both move. */
    rate: "$5 ≈ 4,000 receipt scans",
    /** The $5 split the way this group splits things. */
    each: (share: string) => `You can split it! In this group, that’s ${share} each.`,
    /** For a solo group, where the joke owns that the math doesn't work. */
    eachSolo: (share: string) => `You can split it! In this group, that’s ${share} each. `
      + "Okay, that doesn’t really land when it’s just you here, but you get the point.",
    /** The joke that stops four earnest lines reading as a pitch. */
    yacht: "If there’s any money left over, I’ll buy a yacht.",
    donate: {
      cta: "Donate",
      url: "https://buymeacoffee.com/theoldg",
    },
    /**
     * A donation split is an ordinary expense (ADR-0010). It opens the form rather
     * than writing itself: it lands in everyone's ledger, and only you know the amount.
     */
    split: {
      cta: "Add as a group expense",
      /** The expense's title in the ledger, forever. "We": once saved it's the group's row. */
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
     * A group link with no secret — usually the address bar copied off a group
     * screen (group-link.ts). Shown on `/join` with no secret and on `/g` for a
     * group this phone doesn't hold; "bad link" would send the same address back.
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
     * The group was deleted for everybody (app/delete-my-data/page.tsx). Shown on
     * `/join`, which would otherwise sit on "Joining…", and on `/g`.
     */
    deleted: {
      title: "This group was deleted",
      body: "Somebody in the group deleted it from the server, for everyone. Nothing of it is left.",
    },
  },

  /**
   * Paste link read nothing, so the box asks by hand (components/paste-link.tsx).
   * Not "Nothing to paste": iOS can withhold a pasteboard that has the link.
   */
  paste: {
    title: "Paste the link here",
    placeholder: "Invite link",
    open: "Open",
  },

  /** The demo (app/demo/page.tsx): the words say the one thing looking can't — nothing leaves the phone. */
  demo: {
    opening: "Opening the demo",
    /** The card at the head of its ledger; it stays, not a toast. */
    title: "Demo group: not synced",
    /** In the group menu, where Forget group sits for every other group. */
    clear: "Clear the demo",
    /**
     * Not "brings it back": the seed is deterministic, so it restores the story as
     * shipped. The address is written out because nothing links to `/demo`, and
     * the caller passes the host since a static export can't know it (`useHost`).
     */
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
    /** In an iOS tab, a tapped link opens the browser, so a home-screen user must paste it. */
    inApp: {
      title: "Have the app?",
      body: (browser: string | undefined) => `Links always open in ${lower(browser)}. Paste this there instead.`,
      copyLink: "Copy",
      copied: "Copied",
      /** No clipboard at all (some in-app browsers, lib/clipboard.ts). */
      hold: "Hold to copy",
    },
  },

  // ------------------------------------------------------------- the group

  group: {
    noGroup: "No group",
    /** Three ways to be out of step, in the order of how badly you need to know. */
    offlineIdle: "Offline: you may not have everyone’s latest.",
    offlinePending: (waiting: string) => `Offline: ${waiting} waiting.`,
    // There is no secret rotation, so a "fresh" link is identical; reopening the
    // invite link clears this (`saveGroupKey` unsets the failure).
    rejected: "This phone’s link doesn’t open this group. Open the invite link again.",
    unreachableIdle: "Can’t reach the server: you may not have everyone’s latest.",
    unreachablePending: (waiting: string) => `Can’t reach the server: ${waiting} stuck on this phone.`,

    /** Marks a balance row for somebody who is no longer in the group. */
    hasLeft: "removed",

    /** The balances screen's title, over the group's name. */
    balances: "Balances",
    history: "History",
    people: "People",
    copyLink: "Copy invite link",
    /** In the menu, above Forget group: the way out with your numbers. */
    export: "Export data",
    /** The top bar's one button: everything the group can be asked for. */
    menu: "Group menu",
    /** The clipboard can refuse, and the link is shown nowhere else. */
    linkTitle: "The invite link",
    linkBody: "Copying didn’t work: hold the link to copy it.",
    addEntry: "Add an entry",

    empty: { title: "Nothing here yet", body: "Tap + to add the first thing." },
    untitled: "Untitled",
    notYours: "not yours",
    /** The foot of the new-changes fold, always: History has the rest. */
    groupHistory: "Group history",
    you: {
      owe: "You owe",
      owed: "You’re owed",
      square: "You’re square",
    },
    /** "Marie paid" · "Marie + 1 other received". */
    payers: (who: string, others: string | null, verb: string) =>
      (others ? `${who} + ${others} ${verb}` : `${who} ${verb}`),
    /** For a row with no room for "+ 1 other" (the ladder in `lib/row-meta.ts`); dropping co-payers would be untrue. */
    payersTight: (who: string, others: number, verb: string) => `${who} +${others} ${verb}`,
    sharedWays: (n: string) => `shared ${n}`,
    splitWays: (n: string) => `split ${n}`,
    splitAs: (people: string, mode: string) => `${people}, ${mode}`,
    /** Two facts on one line: "Marie paid · split 3 ways". */
    metaLine: (a: string, b: string) => `${a} · ${b}`,
    transfer: "Transfer",
    paidTo: (from: string, to: string) => `${from} paid ${to}`,

    unsplittable: (n: string) => `${n} couldn’t be split`,
    unsplittableWhy: (reason: string) => `${reason}: left out of the balances.`,
    settleUp: "Settle up",
    allSquare: "Everyone’s square",
    /** The card a suggested payment opens: it states, it doesn’t ask. */
    recordTitle: "Record this reimbursement",
  },

  // ------------------------------------------------------------- people

  members: {
    title: "People",
    addPlaceholder: "Add someone",
    /** The name is the member's key, so a duplicate would be one row both write to. */
    taken: (name: string) => `${name} is already here.`,
    removeLabel: (name: string) => `Remove ${name}`,
    /** A dialog, since the row also removes and invites; the check mark already shows *which*. */
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

  /** A bill split with people who aren't a group (ADR-0035). It ends by handing you text. */
  quick: {
    title: "Quick split",
    /**
     * Under the drawing: the tap between photo and figures, and that nothing is
     * kept. Not `copy.scan.lede`, which promises an expense form (ADR-0035).
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
     * Plain lines with an em dash: chat apps aren't monospaced, so space-aligned
     * tables arrive mangled. Figures are bare — nothing converts (ADR-0035).
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
    /** Waiting on the sync that may bring it — a notification's tap outruns it. */
    arriving: "Fetching the latest…",
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
    /** Only expense and income: a transfer's row is `group.paidTo` ("Alice paid Bob"). */
    verb: { expense: "paid", income: "received" } as Voiced<string>,
    /** Over the payer picker: who put it in, or who took it in. */
    payer: { expense: "Paid by", income: "Received by", transfer: "From" } as Record<EntryKind, string>,
    /** One word for expense and income: both answer "split how", and readers switch often. */
    split: { expense: "Split", income: "Split", transfer: "To" } as Record<EntryKind, string>,
    /** "Transfer" versus "expense" is the pair picked wrong, so each says where the money goes. */
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
    /** The title when the kind can't change: editing a transfer. */
    editKind: (kind: string) => `Edit ${kind}`,
    /** The kind chip's label, and the title of the dialog it opens. */
    kindTitle: "What kind of entry",
    amount: (currency: string) => `Amount in ${currency}`,
    currency: "Currency",
    fromReceipt: "read from receipt",
    rateLabel: (from: string, to: string) => `Rate, ${from} to ${to}`,
    what: "What",
    whatPlaceholder: "Title",
    note: "Note (optional)",
    /**
     * Seeded only when settle-up prefills a transfer (`edit/page.tsx`), never by
     * a blank "+" or a kind switch, and cleared if it stops being a transfer (`changeKind`).
     */
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
   * Who put the money in — or took it in, on an income. Every sentence is
   * `Voiced`, or an income would say "Ana didn't pay" under "Who received it".
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
    /**
     * Each mode's name wherever a split is named. A receipt is one (ADR-0016).
     * "By items", not "From receipt": these name how money divides, not how it
     * was typed; the photo has its own badge (`form.fromReceipt`).
     */
    mode: {
      equal: "Evenly",
      shares: "As parts",
      exact: "As amounts",
      percent: "By percent",
      receipt: "By items",
    } as Record<SplitSpec["mode"], string>,
    /** The tab label, without the preposition — a quarter width has no room. */
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
     * The screen's drawing: a bill and the expense it becomes. These are its
     * contents, not a caption; `alt` describes it for whoever can't see it.
     */
    diagram: {
      alt: "Photograph the bill and the expense fills itself in: what it cost, what it’s called, and when.",
      /** The lines add up to `amount`, the form's figure — `copy.test.ts` checks the sum. */
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
      /** Fills the drawing's three people when the group has fewer. */
      people: ["Ana", "Ben", "Cleo"],
    },
    /** Under the drawing: the form comes back filled, and the lines are a way to split. */
    lede: "Take a photo to fill in the expense. Split it evenly, or line by line.",
    /** The two halves of `ScanPair`: two doors to one act. What's scanned is said by the screen. */
    snap: "Scan",
    rescan: "Rescan",
    upload: "Upload",
    reading: "Reading…",
    camera: "Take a photo of a receipt",
    library: "Upload a receipt photo",
    /**
     * The third way in, on the Items tab only: words instead of a photo
     * (docs/receipt-scanning.md#typing-a-bill-in). Apart from the pair, which is
     * one act with two doors. An invitation, not a noun like "Bill text".
     */
    typeIn: {
      /** Short, as three doors share a phone's width; the chip register fits the whole phrase. */
      open: "Type",
      openLong: "Type it in",
      title: "Type the bill in",
      /**
       * Asks for items (the Items tab needs lines) and no format: per-unit or
       * per-line prices and no total all work. Naming a format teaches people to
       * tidy bills for the app.
       */
      lede: "The items and prices, in any format.",
      placeholder: "3 chicken skewers at 13\nand 10 beef at 15\nlarge cola 10\ntip 10",
      field: "The bill, as text",
      confirm: "Read it",
      /** Only near the cap. */
      left: (n: number) => `${n} characters left`,
      full: "That’s the longest bill this will read. Trim it, or photograph it instead.",
    },
    /** The same screen, named for the step left: nobody assigned yet, or a change to one. */
    assignWhoHadWhat: "Assign who had what",
    editWhoHadWhat: "Edit who-had-what",
    /**
     * True of both paths: this line can't tell whether a key was brought, and
     * only a brought free-tier key trains on the bill. `/about` draws the difference.
     */
    /** Names what the control sends: a photo or the text. */
    terms: "The bill is sent to Google",
    failed: "Couldn’t read that receipt.",
    keptOld: "The old one is still assigned.",
    /**
     * One refusal per way `checkScan` fails, each asking for something different
     * back. Two sets, because the fix depends on the medium: "a flatter photo" is
     * no help to somebody who typed it.
     */
    problem: {
      photo: {
        "no-total": "I can’t make out the total on that one.",
        "unreadable-line": "I can’t read every line on that one.",
        mismatch: "The lines don’t add up to the total. Try a flatter, square-on photo.",
      },
      text: {
        // Not "can't find the total": a typed bill needn't have one. Fires when there
        // is nothing to price, or a total that won't parse.
        "no-total": "I can’t work out what that comes to.",
        "unreadable-line": "I can’t read an amount for every line in that.",
        // True advice: leaving the total out lets the lines stand (`checkScan`).
        mismatch: "The lines don’t add up to the total. Check the figures, or leave the total out.",
      },
    } satisfies Record<ScanMedium, Record<ScanProblem, string>>,
    offline: "You’re offline: scanning needs a connection.",
    busy: "Gemini’s busy. Try again in a minute.",
    /**
     * Our cap, unlike `busy`: waiting doesn't help a spent budget. The only place
     * the cap is mentioned. "Type this one in" means into the form by hand — the
     * Type button would spend the same refused budget.
     */
    limit: {
      you: "That’s your readings for now: reading a bill is capped. Fill the form in by hand, or come back later.",
      global: "The shared reading budget is spent. Fill the form in by hand, or try later.",
    },
    /**
     * Fail-closed and named. `browser` is this phone's network (try another);
     * `server` is the deployment's key (retrying can't help).
     */
    unverified: {
      browser: "Couldn’t check this browser: scanning needs challenges.cloudflare.com.",
      server: "This browser check was refused: scanning is misconfigured here. Fill the form in by hand.",
    },
    /** A brought key stops working; neither is fixed by retrying, so both name the screen the key lives on. */
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
    /** Charges nobody ordered (`BillExtras`). "Discounts" plural: every deduction pooled. */
    extra: { tip: "Tip + service", tax: "Tax", discount: "Discounts" } satisfies Record<ExtraKind, string>,
    tipPercent: (percent: number) => `${percent}%`,
    /** `null` where the screen prints no currency at all — a quick split (ADR-0035). */
    tipLabel: (currency: string | null) =>
      currency ? `Tip and service, in ${currency}` : "Tip and service",
    /** Named for what a press does, like the theme switch. "As printed": the words on the paper. */
    translate: { on: "Show the bill in English", off: "Show the bill as printed" },
    /**
     * Which portion of a split line this is. Short: that line is the narrowest on
     * screen, and "1 of 2" wrapped, making portions uneven. `hadPortion` is the
     * screen-reader version.
     */
    portion: (index: number, of: number) => `${index}/${of}`,
    /**
     * ×N toggles the portions view. Only the first press splits the line (rows
     * must exist to assign), so folding is never called merging.
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
     * Why the rows under the items have no cells: said once, beneath them. Names
     * only the kinds this bill has, in print order.
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

    /** A field name on a secondary line of one revision; the sentence above said who. */
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
    restoredEntry: (who: string, noun: string) => `${who} restored this ${noun}`,
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
    /** Only worth a line because the entry screen prints the mode. */
    rewroteSplit: (who: string) => `${who} changed how the split is written`,
    addedReceipt: (who: string) => `${who} added a receipt`,
    changedReceipt: (who: string) => `${who} changed the receipt`,
    removedReceipt: (who: string) => `${who} removed the receipt`,
    changedWhoHadWhat: (who: string) => `${who} changed who had what`,
    changedAmount: (who: string) => `${who} changed the amount`,
    changedCurrency: (who: string) => `${who} changed the currency`,
    changedRate: (who: string) => `${who} changed the rate`,
    /** Who paid in, then how much — the other way round on an income (`entryKind.payer`). */
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
    /** A phone changing hands reads as a change of person. */
    became: (was: string, now: string) => `${was} became ${now}`,
    recordedTransfer: (who: string) => `${who} recorded a transfer`,
    deletedTransfer: (who: string) => `${who} deleted a transfer`,
    restoredTransfer: (who: string) => `${who} restored a transfer`,
    editedTransfer: (who: string) => `${who} edited a transfer`,
    changedSides: (who: string) => `${who} changed who it was between`,
    changedNote: (who: string) => `${who} changed the note`,
    joined: (them: string) => `${them} joined the group`,
    added: (who: string, them: string) => `${who} added ${them}`,
    removed: (who: string, them: string) => `${who} removed ${them}`,
    /** A healer's repair: names the cause, not an actor. */
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
    /** The badge by the form's converted figure: the way to the rate, not the rate. */
    setRate: () => `set rate`,
    /** The row is a button that opens something other than its fields. */
    openFor: (code: string) => `Set the ${code} rate`,
  },
} as const;
