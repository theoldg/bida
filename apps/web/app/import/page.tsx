"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImportError, plannedCount, readCsvGroup, type ImportPlan } from "@bida/core";
import { keepsFocus } from "@/components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "@/components/chrome";
import { WhoPicker } from "@/components/who-picker";
import { copy } from "@/lib/copy";
import { currencyLabel } from "@/lib/currencies";
import { importGroup } from "@/lib/db/commands";
import { dayStart, errorText, plural } from "@/lib/format";
import { route } from "@/lib/group-link";
import { groupNameFrom, looksLikeCsv, parseCsv, tooBig } from "@/lib/import/csv";
import { useRefusal } from "@/lib/refusal";

/**
 * Somebody else's spreadsheet as a group of ours. Reached from the groups
 * list's kebab and from nowhere else: what it makes is a group, so it belongs
 * where groups are made, and a screen whose one act is already "new group"
 * does not need a second pitch printed on it.
 *
 * **Three steps, and the file is read on the first.** Pick or paste, then look
 * at what was found, then say which of those people you are. Reading is free
 * and writes nothing — `core/import.ts` hands back a plan — so the count of
 * entries, the currency and the rows that will be left out are all on screen
 * before a single op exists. A button that makes the group and then says how it
 * went answers the only question anybody has here in the wrong order: is this
 * going to get my trip right.
 *
 * **Refused whole, or not at all.** A file with one unreadable line is not
 * imported minus that line: a ledger missing an entry balances to something
 * nobody can account for, and the checksum at the foot of the file is what
 * makes the rest trustworthy. So a refusal names the line and what to change,
 * and the file stays where it is (`copy.importData.refused`).
 *
 * **The who question has no add row.** Everywhere else in the app that picker
 * lets you file a name it doesn't have; here the list is the file's columns,
 * and a name with no column has no balance to be.
 */
export default function ImportPage() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [plan, setPlan] = useState<ImportPlan>();
  const [name, setName] = useState("");
  const [why, setWhy] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  /** The name field, which is the one thing on this screen a person types. */
  const nameFlash = useRefusal();

  const words = copy.importData;

  /** Text in, a plan or a sentence out. Nothing is written either way. */
  function read(text: string, suggestion: string) {
    setFailed(undefined);
    try {
      const found = readCsvGroup(parseCsv(text), { dayToTimestamp: dayStart });
      setWhy(undefined);
      setPlan(found);
      setName(suggestion);
      // A file with one person in it answers its own question, so the picker
      // at the end is a formality; it is still asked, because the answer is
      // the actor on every op and a screen that sometimes skips a step is a
      // screen you cannot learn (app/new/page.tsx says the same).
      setPicked(found.members.length === 1 ? found.members[0] : undefined);
    } catch (err) {
      setPlan(undefined);
      // Every refusal this module raises carries a code, and the sentence for
      // it lives in copy.ts (ADR-0033). Anything else is a real fault.
      setWhy(err instanceof ImportError
        ? words.refused[err.code]({ line: err.line, detail: err.detail })
        : errorText(err));
    }
  }

  async function chosen(picked: FileList | null) {
    const one = picked?.[0];
    if (!one) return;
    setPlan(undefined);
    if (!looksLikeCsv(one)) return setWhy(words.notFile);
    // Asked of the size and not of the read: a mis-picked video would
    // otherwise be decoded into a string first, on the phone, to be refused.
    if (tooBig(one.size)) return setWhy(words.tooBig);
    read(await one.text(), groupNameFrom(one.name));
  }

  async function save(me: string) {
    if (!plan) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const { groupId } = await importGroup(plan, { name: name.trim(), myName: me });
      router.replace(route.group(groupId));
    } catch (err) {
      setBusy(false);
      setAsking(false);
      setFailed(errorText(err));
    }
  }

  /** The group's name is the one thing the file cannot tell us, so it is asked. */
  function next() {
    if (name.trim().length === 0) {
      nameFlash.refuse();
      return;
    }
    setAsking(true);
  }

  if (asking && plan) {
    return (
      <Screen>
        <Body>
          <TopBar title={words.who} sub={name.trim()}
            back={{ ask: () => { setAsking(false); return false; } }} />
          <Scroll>
            <WhoPicker
              people={plan.members.map((who) => ({ id: who, name: who }))}
              picked={picked}
              onPick={setPicked}
              onContinue={(who) => save(who)} />
            {failed ? <div className="pad"><Failure>{words.failed(failed)}</Failure></div> : null}
          </Scroll>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Body>
        <TopBar title={words.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            <section className="aboutsect">
              {/* The picker itself is the OS's, opened by a button of ours: a
                  bare file input cannot be styled and reads as a form somebody
                  forgot to finish. Always mounted, because it is how a second
                  file is chosen once the first one has been read. */}
              <input ref={file} type="file" accept=".csv,text/csv,text/plain"
                style={{ display: "none" }}
                onChange={(e) => {
                  void chosen(e.target.files);
                  // So picking the same file twice reads it twice, which is
                  // what a person who has just edited it expects.
                  e.target.value = "";
                }} />

              {/* Once there is a plan on screen it is the screen, and the two
                  ways in are one button to replace the file: a pasted ledger
                  left sitting above its own readout is noise between a person
                  and the only thing they came here to check. */}
              {plan ? (
                <button type="button" className="btn btn-s" onClick={() => file.current?.click()}
                  {...keepsFocus}>
                  {words.pick}
                </button>
              ) : (
                <>
                  <p>{words.lede}</p>
                  <p>{words.safe}</p>

                  <div style={{ paddingTop: 12 }}>
                    <button type="button" className="btn btn-p" onClick={() => file.current?.click()}
                      {...keepsFocus}>
                      {words.pick}
                    </button>
                  </div>

                  {/* The second way in, and not a lesser one: a file that
                      arrived in a chat is text somebody can select, and an iOS
                      browser with no Files access is a phone where the button
                      above leads nowhere at all. */}
                  <p className="hint" style={{ marginTop: 14 }}>{words.orPaste}</p>
                  <textarea className="csvbox selectable" rows={4} value={pasted}
                    aria-label={words.orPaste} placeholder={words.pastePlaceholder}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onChange={(e) => setPasted(e.target.value)} />
                  <button type="button" className="btn btn-s" style={{ marginTop: 8 }}
                    disabled={pasted.trim().length === 0}
                    onClick={() => read(pasted, "")} {...keepsFocus}>
                    {words.read}
                  </button>
                </>
              )}

              {why ? <Failure>{why}</Failure> : null}
            </section>

            {plan ? (
              <section className="aboutsect">
                <h4>{words.found}</h4>
                {/* A readout, so it is rows and not a paragraph: these are
                    four numbers to be checked against a spreadsheet, and a
                    sentence makes them be read rather than compared. */}
                <div className="rows">
                  {/* A count, not the names: the row is labelled, the names
                      are on the next screen, and a group of twelve wrapped
                      into four lines of comma-separated text. */}
                  <Fact label={words.people} value={String(plan.members.length)} />
                  <Fact label={words.currency} value={currencyLabel(plan.currency)} />
                  <Fact label={words.entries} value={String(plan.entries.length)} />
                  {plan.transfers.length > 0
                    ? <Fact label={words.transfers} value={String(plan.transfers.length)} />
                    : null}
                </div>
                {plan.dropped.length > 0
                  ? <p className="keynote">{words.dropped(plural(plan.dropped.length, copy.noun.row))}</p>
                  : null}

                <div className={`field${nameFlash.flash}`} style={{ marginTop: 14 }}
                  onAnimationEnd={nameFlash.onFlashEnd}>
                  <label htmlFor="i-name">{copy.newGroup.name}</label>
                  {/* Prefilled off the filename, because Splitwise names the
                      export after the group, and editable because a file a
                      mail client renamed says nothing about the trip. */}
                  <input id="i-name" value={name} maxLength={40}
                    enterKeyHint="done"
                    placeholder={copy.newGroup.namePlaceholder}
                    onChange={(e) => setName(e.target.value)} />
                </div>

                <div style={{ paddingTop: 16 }}>
                  <button type="button" className="btn btn-p btn-lg" onClick={next}
                    disabled={busy || nameFlash.live || plannedCount(plan) === 0} {...keepsFocus}>
                    {words.act}
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/** One line of the readout: what it is on the left, what the file says on the right. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <div className="rmain"><div className="rtitle">{label}</div></div>
      <div className="ramt"><div className="sm">{value}</div></div>
    </div>
  );
}
