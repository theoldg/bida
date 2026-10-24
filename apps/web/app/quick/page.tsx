"use client";
// Doc: docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { AddName, type AddNameHandle } from "@/components/name-adder";
import { ScanPair, useReceiptScan } from "@/components/receipt-scan";
import { ScanDiagram } from "@/components/scan-diagram";
import { copy } from "@/lib/copy";
import { plural } from "@/lib/format";
import { printedCount } from "@/lib/scan/items";
import { db } from "@/lib/db/dexie";
import { billAssigned, blankDraft, getDraft, seedDraft, useDraft } from "@/lib/draft";
import { route } from "@/lib/group-link";
import { useDevice } from "@/lib/hooks";
import { goUp } from "@/lib/nav";
import { useRefusal } from "@/lib/refusal";
import { addQuickPerson, removeQuickPerson, useQuickPeople } from "@/lib/quick";
import { registerScanCredential, useScanCredential } from "@/lib/scan/credential";
import { usePrefetch } from "@/lib/prefetch";

/**
 * A bill split with people who are not a group (ADR-0035): who is splitting,
 * and the camera, in either order — names can be typed while the model reads.
 * Only the grid needs two people. A scan never leaves this screen: the way on
 * is the grid's button, so nobody is taken off a name half typed. Opens on
 * `/g/scan`'s drawing, split between the people named here so it fills in as
 * they are added.
 *
 * Nothing here is written anywhere; names and draft live in memory, and
 * leaving throws both away.
 */
export default function QuickPage() {
  const router = useRouter();
  usePrefetch([route.quickItems(), route.quickBill()]);
  const cred = useScanCredential();
  const people = useQuickPeople();
  const draft = useDraft(cred?.id);
  const device = useDevice();
  const [asking, setAsking] = useState(false);
  const [noLines, setNoLines] = useState(false);
  // The name still in the add row: something typed, so leaving with it on
  // screen is leaving with work unsaved. The way to the grid files it first
  // (components/name-adder.tsx).
  const [typing, setTyping] = useState<string | null>(null);
  const adder = useRef<AddNameHandle | null>(null);
  /**
   * The grid refused: fewer than two people, or a name the list already holds
   * left in the row. It holds only the listed people, so a bill nobody can
   * split. The add row fixes both, so it blooms (lib/refusal.ts).
   */
  const refusal = useRefusal();

  /**
   * What the bill is counted in until a scan says otherwise. Nothing converts
   * and no symbol is printed (ADR-0035), so this is only the minor-unit
   * exponent; the phone's last group is the best guess.
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

  // One blank bill per visit, under the credential's id, which the scan hook
  // keys by — so no group id is needed (lib/quick.ts). Seeded once: a scan
  // fills this draft, and re-seeding on an added name would throw it away.
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
    // offering an empty grid.
    setNoLines((getDraft(cred.id)?.receiptItems?.length ?? 0) === 0);
  }, route.quickBill());

  // A bill already read, by a scan just now or before a Back from the grid:
  // the way forward is the grid, not another photo.
  const bill = draft?.receiptItems ?? [];
  const ticked = !!draft && billAssigned(draft);
  const reading = scan.live?.state === "scanning";
  const typed = people.length > 0 || typing !== null || bill.length > 0 || reading;

  /** The grid holds only the listed people, so one alone can't split. */
  async function toGrid() {
    const settled = await adder.current?.settle() ?? "empty";
    if (settled === "refused" || people.length + (settled === "filed" ? 1 : 0) < 2) refusal.refuse();
    else router.push(route.quickItems());
  }

  /**
   * Discard was answered, so this screen has stopped guarding the way out —
   * see the same ref on `/new` for why.
   */
  const leaving = useRef(false);

  // Throwing the split away is the layout's, on the way out (quick/layout.tsx).
  function leave() {
    leaving.current = true;
    goUp(route.groups(), (to) => router.replace(to));
  }

  /** May we leave? Not with a split on the screen, or one being read — ask, and stay put. */
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
          {/* The same picture `/g/scan` opens on (components/scan-diagram.tsx), with
              its own line, since a quick split doesn't end in the expense form. The
              space around this block keeps the eyebrow below from reading as its
              caption. */}
          <div className="pad quickshow">
            <p className="scanlede">{copy.quick.lede}</p>
            <ScanDiagram names={people.map((p) => p.name)} seed={cred?.id ?? ""} />
          </div>

          <Eyebrow style={{ padding: "6px var(--gutter) 0" }}>{copy.quick.who}</Eyebrow>
          <div className="rows">
            {people.map((person) => (
              <div key={person.id} className="row">
                <div className="rmain"><div className="rtitle">{person.name}</div></div>
                <button className="rmark rdrop" aria-label={copy.members.removeLabel(person.name)}
                  onClick={() => removeQuickPerson(person.id)}>
                  <Icon name="cross" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder} handle={adder}
              taken={people.map((p) => p.name)}
              onAdd={(name) => { if (cred) addQuickPerson(cred.id, name); }}
              onDraft={setTyping}
              flash={refusal.flash} onFlashEnd={refusal.onFlashEnd} />
          </div>
        </Scroll>
        {/* The act the screen ends on, under the people it needs first —
            docked (`.whodock`), so a long table of them scrolls above it. */}
        <div className="pad whodock" style={{ paddingTop: 18 }}>
          {bill.length > 0 ? (
            // A bill read: the way on first, what replaces it under it, as on
            // the Items tab. A rescan asks nothing — its ticks were made
            // against the old bill.
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Held while a rescan reads: the grid would be of the bill about
                  to be replaced, and the "Reading…" below says why. */}
              <button type="button" className="btn btn-p btn-lg gridway"
                disabled={refusal.live || reading} onClick={() => void toGrid()}>
                <Icon name="users" size={16} />
                <span className="wayname">{ticked ? copy.scan.editWhoHadWhat : copy.scan.assignWhoHadWhat}</span>
                <span className="waycount"><span>{plural(printedCount(bill), copy.noun.item)}</span></span>
                <Icon name="chev" size={14} />
              </button>
              <div>
                <ScanPair scan={scan} register="s" overBill={true} />
                {scan.refusal ? <Failure>{scan.refusal} {copy.quick.keptOld}</Failure> : null}
              </div>
            </div>
          ) : (
            <>
              {/* Needs nobody named: only the grid does. */}
              <ScanPair scan={scan} register="lg" />

              {/* No "try again" beside either message: the control above is
                  still enabled, and it is the retry. */}
              {scan.refusal ? <Failure>{scan.refusal}</Failure> : null}
              {noLines && scan.live?.state !== "scanning"
                ? <Failure>{copy.quick.noLines}</Failure> : null}

              {/* The same disclosure the group's scan screen carries: the photo
                  goes to Google's model, which may train on it. */}
              <p className="scanterms">{copy.scan.terms}</p>
            </>
          )}
        </div>
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
