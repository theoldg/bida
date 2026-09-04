import type { ScanProblem, SplitSpec } from "@hajsik/core";
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

export const copy = {
  app: {
    name: "Hajsik",
    description: "Shared expenses, split fairly. Works offline.",
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
    rename: "Rename",
    save: "Save",
    useIt: "Use it",
    close: "Close",
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
      body: "A trip, a flat, a dinner — anything several people pay for.",
    },
    newGroup: "New group",
    whoAreYou: "who are you?",
    youOwe: "you owe",
    youreOwed: "you’re owed",
    settled: "settled",
    theme: { toLight: "Switch to light mode", toDark: "Switch to dark mode" },
  },

  install: {
    title: "Keep Hajsik on your home screen",
    body: "Own icon, no browser bar, works offline.",
    add: "Add to home screen",
    notNow: "Not now",
    /** iOS has no install API, so name the button that does it. */
    manual: { tap: "Tap", then: "in the browser bar, then", label: "Add to Home Screen" },
  },

  // ------------------------------------------------------------- new group

  newGroup: {
    title: "New group",
    name: "Name",
    namePlaceholder: "Group name",
    you: "You are",
    yourNamePlaceholder: "Your name",
    currency: "Currency",
    currencyHint: "Balances settle in this currency. Entries can be in any other.",
    people: "Who else",
    failed: (why: string) => `Couldn’t create the group — ${why}`,
    discardTitle: "Discard this group?",
    discardBody: "Nothing has been created yet.",
  },

  // ------------------------------------------------------------- join

  join: {
    title: "Join a group",
    badLink: {
      title: "That link doesn’t look right",
      body: "Ask whoever shared it to send the invite link again.",
    },
    joining: {
      title: "Joining…",
      body: "This finishes by itself once the other phone syncs.",
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
      body: "Open the invite link again, or pick another group.",
    },
    /**
     * For a link that names nothing this phone has — a deep link into a group
     * that was never joined or has been forgotten. `notFound` above is the
     * gentler case: you are on the group screen, one id short.
     */
    badLink: {
      title: "Bad link",
      empty: "This link doesn’t open anything",
      body: "A group only opens on a phone that has its invite link. Ask someone in the group to send you theirs, or pick another group.",
    },
    /** Three ways to be out of step, in the order of how badly you need to know. */
    offlineIdle: "Offline — you may not have everyone’s latest.",
    offlinePending: (waiting: string) => `Offline — ${waiting} waiting.`,
    // Not "ask for a fresh one": there is no secret rotation, so a fresh link
    // is byte-identical. Opening the invite link again is what actually clears
    // this — `saveGroupKey` unsets the failure.
    rejected: "This phone’s link doesn’t open this group. Open the invite link again.",
    unreachableIdle: "Can’t reach the server — you may not have everyone’s latest.",
    unreachablePending: (waiting: string) => `Can’t reach the server — ${waiting} stuck on this phone.`,

    /** Marks a balance row for somebody who is no longer in the group. */
    hasLeft: "left the group",

    tabs: { ledger: "Ledger", balances: "Balances" },
    history: "History",
    people: "People",
    copyLink: "Copy invite link",
    /** The clipboard can refuse — an insecure context, a denied permission —
        and the link is shown nowhere else, so it is shown here. */
    linkTitle: "The invite link",
    linkBody: "Copying didn’t work on this phone. Hold the link to copy it.",
    addEntry: "Add an entry",

    empty: { title: "Nothing here yet", body: "Tap + to add the first thing." },
    untitled: "Untitled",
    notYours: "not yours",
    you: {
      owe: "You owe",
      owed: "You’re owed",
      square: "You’re square",
      paidAndShare: (paid: string, share: string) => `paid ${paid} · share ${share}`,
      tookAndCut: (took: string, cut: string) => `took in ${took} · cut ${cut}`,
    },
    /** "Marie paid" · "Marie + 1 other received". */
    payers: (who: string, others: string | null, verb: string) =>
      (others ? `${who} + ${others} ${verb}` : `${who} ${verb}`),
    sharedWays: (n: string) => `shared ${n}`,
    splitWays: (n: string) => `split ${n}`,
    splitAs: (people: number, mode: string) => `${people} people, ${mode}`,
    transfer: "Transfer",
    transferNote: (note: string) => `Transfer · ${note}`,
    paidTo: (from: string, to: string) => `${from} paid ${to}`,

    unsplittable: (n: string) => `${n} couldn’t be split`,
    unsplittableWhy: (reason: string) => `${reason}. They’re left out of the balances above.`,
    settleUp: "Settle up",
    allSquare: "Everyone’s square",
    spentTogether: "Spent together",
    takenIn: "Taken in",
  },

  // ------------------------------------------------------------- people

  members: {
    title: "People",
    claimPrompt: "Tap your name.",
    addPlaceholder: "Add someone",
    /** Two people with one name are two people nothing on screen tells apart. */
    taken: (name: string) => `${name} is already here.`,
    rename: (name: string) => `Rename ${name}`,
    removeLabel: (name: string) => `Remove ${name}`,
    newName: "New name",
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody: "Their past entries stay as they are — nothing is redistributed.",
    blockedTitle: (name: string) => `Can’t remove ${name}`,
    /** "these entries", not "these expenses": a transfer blocks removal too. */
    blockedBody: (name: string) => `${name} is named on these entries.`,
    lastBody: "A group has to have somebody in it. Add the next person first.",
    forget: "Forget group",
    forgetBody: "The invite link brings it back.",
  },

  // ------------------------------------------------------------- one entry

  entry: {
    gone: { title: "Gone", body: "This entry isn’t here any more", why: "It may have been deleted." },
    history: "History",
    editedTimes: (n: number) => `edited ×${n}`,
    rate: (rate: string) => `@ ${rate}`,
    fromReceipt: "from receipt",
    notInvolved: "not involved",
    payerCount: (label: string, people: string) => `${label} · ${people}`,
    /** "Split · evenly" · "Shared with · from receipt". */
    splitMode: (label: string, mode: string) => `${label} · ${mode}`,
    deleteTitle: (kind: string) => `Delete this ${kind}?`,
    deleteBody: "Balances update straight away. The history keeps a record.",
    from: "From",
    to: "To",
  },

  /** The three kinds, and every word the app uses about them (ADR-0010). */
  entryKind: {
    label: { expense: "Expense", income: "Income", transfer: "Transfer" } as Record<EntryKind, string>,
    /** The verb in "Marie paid". */
    verb: { expense: "paid", income: "received", transfer: "sent" } as Record<EntryKind, string>,
    /** Over the payer picker: who put it in, or who took it in. */
    payer: { expense: "Paid by", income: "Received by", transfer: "From" } as Record<EntryKind, string>,
    /** Over the split: who it was spent on, or who it belongs to. */
    split: { expense: "Split", income: "Shared with", transfer: "To" } as Record<EntryKind, string>,
  },

  // ------------------------------------------------------------- entry form

  form: {
    newTitle: "New",
    editTitle: "Edit",
    kindTablist: "What kind of entry",
    editKind: (kind: string) => `Edit ${kind}`,
    amount: (currency: string) => `Amount in ${currency}`,
    currency: "Currency",
    fromReceipt: "read from receipt",
    rateLabel: (from: string, to: string) => `Rate, ${from} to ${to}`,
    what: "What",
    whatPlaceholder: "Title",
    note: "Note (optional)",
    when: "When",
    andSomeone: "+ someone",
    coPayers: "Several people put money in",
    discardTitle: (kind: string) => `Discard this ${kind}?`,
    discardBody: "This isn’t saved anywhere.",
    saveFailed: (why: string) => `Couldn’t save — ${why}`,
    goneMember: (name: string) => `${name} has left the group — pick somebody else.`,
    nobodyTitle: "Nobody in this group yet",
    nobodyBody: "Add the people sharing this before you write down what it cost.",
    sentBy: "Who sent it",
    receivedBy: "Who received it",
    swapSides: "Swap the two sides",
    sameSide: "Money has to go from one person to a different one.",
    otherSide: "the other side — picking swaps them",
    you: "you",
  },

  payers: {
    whoPaid: "Who paid",
    whoReceived: "Who received it",
    putIn: "put money in",
    didnt: "didn’t pay",
    alsoPaid: (name: string) => `${name} put money in too`,
    leaveOut: (name: string) => `Leave ${name} out`,
    onlyPayer: (name: string) => `${name} is the only payer — add somebody else first`,
    contribution: (name: string) => `${name}’s contribution`,
    giveRest: (name: string) => `Give ${name} the rest`,
    rest: "rest",
    accountedFor: (allocated: string, total: string) => `${allocated} of ${total} accounted for`,
    nobody: "Nobody has put money in yet",
    under: "still unaccounted for",
    over: "more than the entry",
    onePayer: "Back to one payer",
    discardTitle: "Discard these payers?",
    discardBody: "The entry goes back to whoever it named before.",
  },

  // ------------------------------------------------------------- the split

  split: {
    mode: {
      equal: "Evenly",
      shares: "As parts",
      exact: "As amounts",
      percent: "By percent",
    } as Record<SplitSpec["mode"], string>,
    receipt: "Receipt",
    include: (name: string) => `Include ${name}`,
    leaveOut: (name: string) => `Leave ${name} out`,
    fewerParts: (name: string) => `Fewer parts for ${name}`,
    moreParts: (name: string) => `More parts for ${name}`,
    amountFor: (name: string) => `${name}’s amount`,
    giveRest: (name: string) => `Give ${name} the rest`,
    rest: "rest",
    notInvolved: "not involved",
    /** The footer's three verdicts. Wording checked by lib/format.test.ts. */
    nobody: "Nobody is included yet",
    noTotal: "Enter an amount to split",
    allocated: (allocated: string, total: string) => `${allocated} of ${total} allocated`,
    under: "left to split",
    over: "too much",
  },

  // ------------------------------------------------------------- receipts

  scan: {
    scan: "Scan a receipt",
    rescan: "Rescan",
    upload: "Upload",
    reading: "Reading…",
    camera: "Take a photo of a receipt",
    library: "Upload a receipt photo",
    editWhoHadWhat: "Edit who-had-what",
    /** A consequence the screen can't show. It stays. */
    freeTier: "Google’s free tier — the photo may train their models.",
    failed: "Couldn’t read that receipt.",
    keptOld: "The old one is still assigned.",
    /**
     * The app's own four refusals, one per way a reading can fail to add up
     * (`checkScan`). Each says which it is, because each asks for something
     * different back: another photo, a straighter one, or the form instead.
     */
    problem: {
      "no-total": "I can’t make out the total on that one.",
      "unreadable-line": "I can’t read every line on that one.",
      "credit-line": "There’s a credit on that receipt — I can’t split those yet.",
      mismatch: "The lines on that one don’t add up to the total — a flatter, square-on photo usually fixes it.",
    } satisfies Record<ScanProblem, string>,
    offline: "You’re offline — scanning needs a connection.",
    busy: "Gemini’s busy — try again in a minute.",
  },

  items: {
    title: "Who had what",
    none: { title: "No line items on that scan", body: "Split it from the form instead." },
    whoWasThere: "Who was there",
    wasThere: (name: string) => `${name} was there`,
    wasntThere: (name: string) => `${name} wasn’t there`,
    tip: "Tip + service",
    tipPercent: (percent: number) => `${percent}%`,
    tipLabel: (currency: string) => `Tip and service, in ${currency}`,
    /** The one affordance a person misses: the tip is a field, not a printed line. */
    tipHint: "tap to edit",
    portion: (index: number, of: number) => `${index} of ${of}`,
    splitInto: (n: number) => `Split into ${n} lines`,
    splitItem: (label: string, n: number) => `Split ${label} into ${n} lines`,
    mergeBack: "Merge back into one line",
    mergeItem: (label: string, n: number) => `Merge the ${n} ${label} lines back into one`,
    had: (name: string, label: string) => `${name} had ${label}`,
    hadPortion: (name: string, label: string, index: number, of: number) =>
      `${name} had ${label}, portion ${index} of ${of}`,
    share: (name: string) => `${name}’s share`,
    needsSomeone: "Every item needs at least one person.",
    discardTitle: "Discard this grid?",
    discardBody: "The bill goes back to the lines the scan read.",
    unfoldHint: { before: "Tap a", after: "to split a line into portions." },
  },

  // ------------------------------------------------------------- history

  history: {
    title: "History",
    entry: "Entry",
    empty: "Nothing here yet",
    wholeGroup: "The whole group’s history",
    subject: (name: string, revisions: string) => `${name} · ${revisions}`,
    deleted: (label: string) => `${label} · deleted`,
    untitled: "Untitled entry",
    more: (rest: string) => `Show ${rest} more`,

    /** One sentence per revision. `who` is the actor's own name. */
    createdEntry: (who: string, noun: string) => `${who} created this ${noun}`,
    deletedEntry: (who: string, noun: string) => `${who} deleted this ${noun}`,
    editedEntry: (who: string, noun: string) => `${who} edited this ${noun}`,
    toIncome: (who: string) => `${who} turned this into an income`,
    toExpense: (who: string) => `${who} turned this back into an expense`,
    changedInvolved: (who: string) => `${who} changed who’s involved`,
    changedAmount: (who: string) => `${who} changed the amount`,
    changedCurrency: (who: string) => `${who} changed the currency`,
    changedRate: (who: string) => `${who} changed the rate`,
    changedPayer: (who: string) => `${who} changed who paid`,
    changedDescription: (who: string) => `${who} changed the description`,
    changedDate: (who: string) => `${who} changed the date`,
    changedCategory: (who: string) => `${who} changed the category`,
    changedPhotos: (who: string, added: boolean, photos: string) =>
      `${who} ${added ? "added" : "removed"} ${photos}`,
    newDevice: (who: string) => `${who} started editing from a new device`,
    handedOver: (who: string, to: string) => `${who} handed a device over to ${to}`,
    recordedTransfer: (who: string) => `${who} recorded a transfer`,
    deletedTransfer: (who: string) => `${who} deleted a transfer`,
    editedTransfer: (who: string) => `${who} edited a transfer`,
    changedSides: (who: string) => `${who} changed who it was between`,
    changedNote: (who: string) => `${who} changed the note`,
    joined: (them: string) => `${them} joined the group`,
    added: (who: string, them: string) => `${who} added ${them}`,
    left: (them: string) => `${them} left the group`,
    removed: (who: string, them: string) => `${who} removed ${them}`,
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
    otherHint: "A three-letter ISO code.",
    isBase: "the group settles in this",
    hasRate: (rate: string) => `1 = ${rate}`,
    noRate: "no rate yet",
  },

  // ------------------------------------------------------ exchange rates

  rates: {
    /** The icon in the top row, between History and People. */
    title: "Rates",
    subtitle: (base: string) => `What the group counts in ${base}`,
    empty: "Everything is in one currency",
    emptyBody: "Add a rate here, or just write an entry in another currency — this asks then.",
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
      offline: "offline — type it and correct it later",
      unavailable: "couldn’t look it up — type it",
    },
    refetch: "Look it up",
    /** The one thing this dialog does that a person should know before doing it. */
    movesEntries: (entries: string, code: string) =>
      `This re-values ${entries} already written in ${code}.`,
    remove: "Remove",
    removeTitle: (code: string) => `Remove the ${code} rate?`,
    removeBody: (entries: string) =>
      `${entries} go back to the rate each was saved with. Nothing is deleted.`,
    removeBodyEmpty: "Nothing is written in it, so nothing changes.",
    /** Save is held until there is a number to save. */
    invalid: "That isn’t a rate.",
    failed: (why: string) => `Couldn’t save the rate — ${why}`,
    /** The form's rate row, which now points at the group's number. */
    groupRate: "group rate",
    /** That row is a button, and what it opens is not what the fields inside it are. */
    openFor: (code: string) => `Set the ${code} rate`,
    needed: (code: string) => `Set what a ${code} is worth before saving this.`,
  },
} as const;
