"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Eyebrow, keepsFocus } from "@/components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { AddName } from "@/components/name-adder";
import { ScanPair, useReceiptScan } from "@/components/receipt-scan";
import { ScanDiagram } from "@/components/scan-diagram";
import { copy } from "@/lib/copy";
import { db } from "@/lib/db/dexie";
import { blankDraft, clearDraft, getDraft, seedDraft, useDraft } from "@/lib/draft";
import { route } from "@/lib/group-link";
import { useDevice } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import { useRefusal } from "@/lib/refusal";
import {
  addQuickPerson, clearQuickPeople, registerScanCredential, removeQuickPerson,
  useQuickPeople, useScanCredential,
} from "@/lib/quick";

/**
 * A bill split with people who are not a group (ADR-0035): who is splitting,
 * and the camera.
 *
 * Both halves of one act — the inputs — so they share a screen: naming people
 * before the photo is also what makes the grid ready the moment the model
 * answers. It opens on the same drawing `/g/scan` opens on, for the same
 * reason — what a scan becomes lands on another screen — except that here the
 * drawing splits its bill between the people on this list, so it fills in as
 * they are named.
 *
 * Nothing here is written anywhere. The names live beside the draft, in
 * memory, and leaving throws both away.
 */
export default function QuickPage() {
  const router = useRouter();
  const cred = useScanCredential();
  const people = useQuickPeople();
  const draft = useDraft(cred?.id);
  const device = useDevice();
  const [asking, setAsking] = useState(false);
  const [noLines, setNoLines] = useState(false);
  // The name still in the add row. Nothing acts on it — only its own plus
  // files it — but it is something typed, so leaving with it on screen is
  // leaving with work unsaved (components/name-adder.tsx).
  const [typing, setTyping] = useState<string | null>(null);
  /**
   * A scan refused, for either of two reasons: a name still unfiled in the
   * add row, or fewer than two people on the list to divide a bill between.
   * The photograph is the end of this screen — the grid it opens is the
   * people on the list and nobody else — so a scan taken over either one is
   * the one way to end up with a bill nobody can actually split. The add
   * row's plus is the fix for both, so the plus is what blooms, and the pair
   * is spent for the length of the flash: exactly the entry form's refusal
   * (lib/refusal.ts).
   */
  const refusal = useRefusal();

  /**
   * What the bill is counted in, until a scan says otherwise.
   *
   * Nothing here converts and no symbol is ever printed (ADR-0035), so this
   * is only the minor-unit exponent: two decimals for most of the world, none
   * for a yen. The phone's last group is the best guess available, since it is
   * usually the currency the phone is standing in.
   */
  const [currency, setCurrency] = useState<string>();
  useEffect(() => {
    if (device === undefined) return;
    const last = device.lastOpenedGroupId;
    if (!last) { setCurrency("EUR"); return; }
    let live = true;
    void db().groups.get(last).then((group) => {
      if (live) setCurrency(group?.baseCurrency ?? "EUR");
    });
    return () => { live = false; };
  }, [device]);

  // One blank bill per visit, under the credential's id — which is what the
  // scan hook keys everything by, so a quick split needs no group id anywhere
  // (lib/quick.ts). Seeded once: a scan fills this same draft, and re-seeding
  // when somebody is added would throw the bill away.
  useEffect(() => {
    if (!cred || !currency || getDraft(cred.id)) return;
    seedDraft(cred.id, blankDraft("expense", "", currency, []), "quick");
  }, [cred, currency]);

  const scan = useReceiptScan(cred?.id, cred && {
    ...cred, prepare: () => registerScanCredential(cred),
  }, () => {
    if (!cred) return;
    // A bill with no lines on it cannot be divided by what people had, and
    // this flow has nothing else to be — so it says so here rather than
    // sending anyone on to an empty grid.
    if ((getDraft(cred.id)?.receiptItems?.length ?? 0) === 0) { setNoLines(true); return; }
    setNoLines(false);
    router.push(route.quickItems());
  });

  const typed = people.length > 0 || typing !== null || (draft?.receiptItems?.length ?? 0) > 0;

  /**
   * Discard was answered, so this screen has stopped guarding the way out.
   * `typed` reads state the clearing below doesn't reach until the next render,
   * and a guard still saying no answers the going itself — see the same ref on
   * `/new` for the whole of why.
   */
  const leaving = useRef(false);

  function leave() {
    leaving.current = true;
    if (cred) clearDraft(cred.id);
    clearQuickPeople();
    goUp(route.groups(), (to) => router.replace(to));
  }

  /** May we leave? Not with a split on the screen — ask, and stay put. */
  function mayLeave() {
    if (leaving.current) return true;
    if (typed) { setAsking(true); return false; }
    return true;
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.quick.title} back={{ ask: mayLeave, up: route.groups() }} />
        {scan.inputs}
        <Scroll>
          {/* What this screen leads to, drawn rather than described — the same
              picture `/g/scan` opens on (components/scan-diagram.tsx), with
              its own line over it, since what a quick split comes back as is
              not the expense form `copy.scan.lede` promises. It is divided
              between the people below it, so adding somebody is visible in it.
              Line and picture are one block, and the air around that block is
              what keeps the eyebrow under it reading as the next step rather
              than as its caption. */}
          <div className="pad quickshow">
            <p className="scanlede">{copy.quick.lede}</p>
            <ScanDiagram names={people.map((p) => p.name)} seed={cred?.id ?? ""} />
          </div>

          <Eyebrow style={{ padding: "6px 16px 0" }}>{copy.quick.who}</Eyebrow>
          <div className="rows">
            {people.map((person) => (
              <div key={person.id} className="row">
                <div className="rmain"><div className="rtitle">{person.name}</div></div>
                <button className="iconbtn" aria-label={copy.members.removeLabel(person.name)}
                  onClick={() => removeQuickPerson(person.id)} {...keepsFocus}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder}
              taken={people.map((p) => p.name)}
              onAdd={(name) => { if (cred) addQuickPerson(cred.id, name); }}
              onDraft={setTyping}
              flash={refusal.flash} onFlashEnd={refusal.onFlashEnd} />
          </div>

          {/* The act the screen ends on, under the people it needs first. */}
          <div className="pad" style={{ paddingTop: 18, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            {/* Always tappable, like the entry form's Save: a press that
                can't go through refuses instead of doing nothing, whether the
                add row has a name still unfiled or the list has fewer than
                two people on it — either way the fix is the plus beside
                "Add someone", so that's what blooms. */}
            <ScanPair scan={scan} register="lg"
              disabled={refusal.live}
              refuse={() => {
                if (typing !== null || people.length < 2) { refusal.refuse(); return true; }
                return false;
              }} />

            {/* No "try again" beside either message: the control above is
                still enabled, and it is the retry. */}
            {scan.refusal ? <Failure>{scan.refusal}</Failure> : null}
            {noLines && scan.live?.state !== "scanning"
              ? <Failure>{copy.quick.noLines}</Failure> : null}

            {/* The same disclosure the group's scan screen carries: the photo
                goes to Google's model, which may train on it. */}
            <p className="scanterms">{copy.scan.terms}</p>
          </div>
        </Scroll>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.quick.discardTitle} confirm={copy.act.discard}
          danger={true} onConfirm={leave} onClose={() => setAsking(false)}>
          <p>{copy.quick.discardBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
