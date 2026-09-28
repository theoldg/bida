"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImportError, readCsvGroup, readTricount, type ImportPlan } from "@bida/core";
import { Body, Failure, Screen, Scroll, TopBar } from "@/components/chrome";
import { copy } from "@/lib/copy";
import { dayStart, errorText } from "@/lib/format";
import { route } from "@/lib/group-link";
import { groupNameFrom, looksLikeCsv, parseCsv, tooBig } from "@/lib/import/csv";
import { keepLink, setPendingImport, typedLink } from "@/lib/import/pending";
import {
  fetchTricount, TricountDownError, TricountOfflineError, tricountKey,
} from "@/lib/import/tricount";

/**
 * Somebody else's ledger as a group of ours. Reached only from the groups
 * list's kebab, since what it makes is a group.
 *
 * **Three steps, and the source is read on the first**: pick or fetch here,
 * then `/import/plan` shows what was found and asks which person you are.
 * Reading writes nothing, so the entry count, currency and skipped rows are on
 * screen before any op exists.
 *
 * **Two sources, one readout.** A file or a Tricount link both become an
 * `ImportPlan`, and past that the app can't tell which it was
 * (docs/data-model.md#reading-a-tricount-back).
 *
 * **Refused whole, or not at all.** A ledger missing one entry balances to
 * something nobody can account for, so a refusal names what to change
 * (`copy.importData.refused`).
 */
export default function ImportPage() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(typedLink);
  const [fetching, setFetching] = useState(false);
  const [why, setWhy] = useState<string>();

  const words = copy.importData;

  /** A plan read, however: onto its own screen. `suggestion` is used when the source has no name of its own. */
  function adopt(found: ImportPlan, suggestion: string) {
    setWhy(undefined);
    // A tricount states its own title; a spreadsheet's is a guess off the
    // filename. Both land in the same editable field.
    setPendingImport({ plan: found, name: found.title?.trim() || suggestion });
    router.push(route.importPlan());
  }

  /** A refusal on screen, and no plan. */
  function refuse(err: unknown) {
    // Every refusal either reader raises carries a code, and the sentence for
    // it lives in copy.ts (ADR-0033). Anything else is a real fault.
    setWhy(err instanceof ImportError
      ? words.refused[err.code]({ line: err.line, detail: err.detail })
      : errorText(err));
  }

  /** Text in, a plan or a sentence out. Nothing is written either way. */
  function read(text: string, suggestion: string) {
    try {
      adopt(readCsvGroup(parseCsv(text), { dayToTimestamp: dayStart }), suggestion);
    } catch (err) {
      refuse(err);
    }
  }

  /**
   * A link in, the same plan out. The network is the one step a file doesn't
   * have, so it gets two messages: this phone is offline, or tricount isn't
   * answering — neither means the link is wrong.
   */
  async function fetchLink() {
    const key = tricountKey(link);
    if (!key) return setWhy(words.notTricount);
    setFetching(true);
    try {
      adopt(readTricount(await fetchTricount(key), { dayToTimestamp: dayStart }), "");
    } catch (err) {
      if (err instanceof TricountOfflineError) setWhy(words.tricountOffline);
      else if (err instanceof TricountDownError) setWhy(words.tricountDown);
      else refuse(err);
    } finally {
      setFetching(false);
    }
  }

  async function chosen(picked: FileList | null) {
    const one = picked?.[0];
    if (!one) return;
    if (!looksLikeCsv(one)) return setWhy(words.notFile);
    // Asked of the size and not of the read: a mis-picked video would
    // otherwise be decoded into a string first, on the phone, to be refused.
    if (tooBig(one.size)) return setWhy(words.tooBig);
    read(await one.text(), groupNameFrom(one.name));
  }

  return (
    <Screen>
      <Body>
        <TopBar title={words.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            <section className="aboutsect">
              {/* The OS picker behind a button of ours — a bare file input can't be
                  styled. */}
              <input ref={file} type="file" accept=".csv,text/csv,text/plain"
                style={{ display: "none" }}
                onChange={(e) => {
                  void chosen(e.target.files);
                  // So picking the same file twice reads it twice, which is
                  // what a person who has just edited it expects.
                  e.target.value = "";
                }} />

              <p>{words.lede}</p>

              <div style={{ paddingTop: 12 }}>
                <button type="button" className="btn btn-p" onClick={() => file.current?.click()}>
                  {words.pick}
                </button>
              </div>

              {/* Tricount has no export button, so the link is the only way in from it.
                  The link is full authority over that tricount, so it goes through our
                  Worker in a POST body, never a URL (apps/api/src/tricount.ts). */}
              <p className="hint" style={{ marginTop: 14 }}>{words.orTricount}</p>
              <input className="linkbox selectable" type="url" value={link}
                aria-label={words.orTricount} placeholder={words.tricountPlaceholder}
                inputMode="url" enterKeyHint="go"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => { setLink(e.target.value); keepLink(e.target.value); }} />
              <button type="button" className="btn btn-s" style={{ marginTop: 8 }}
                disabled={fetching || link.trim().length === 0}
                onClick={() => void fetchLink()}>
                {fetching ? words.fetching : words.fetch}
              </button>
              {/* Under the button and not above the field: it is about
                  what the press does, and a person who never presses it
                  never had a link to give away. */}
              <p className="fineprint">{words.fineprint}</p>

              {why ? <Failure>{why}</Failure> : null}
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
