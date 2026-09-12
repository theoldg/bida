"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eyebrow } from "../../components/bits";
import { Body, Failure, Screen, Scroll, TopBar } from "../../components/chrome";
import { ConfirmDialog } from "../../components/dialog";
import { Icon } from "../../components/icons";
import { AddName } from "../../components/name-adder";
import { ScanPair, useReceiptScan } from "../../components/receipt-scan";
import { copy } from "../../lib/copy";
import { db } from "../../lib/db/dexie";
import { blankDraft, clearDraft, getDraft, seedDraft, useDraft } from "../../lib/draft";
import { route } from "../../lib/group-link";
import { useDevice } from "../../lib/hooks";
import { goUp } from "../../lib/nav";
import {
  addQuickPerson, clearQuickPeople, registerScanCredential, removeQuickPerson,
  useQuickPeople, useScanCredential,
} from "../../lib/quick";

/**
 * A bill split with people who are not a group (ADR-0035): who is splitting,
 * and the camera.
 *
 * Both halves of one act — the inputs — so they share a screen: naming people
 * before the photo is also what makes the grid ready the moment the model
 * answers. There is no drawing of what a scan becomes, as there is on
 * `/g/scan`: that screen needs one because it is otherwise empty, and this one
 * already has your friends' names on it.
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

  const scan = useReceiptScan(cred?.id, cred?.secret, () => {
    if (!cred) return;
    // A bill with no lines on it cannot be divided by what people had, and
    // this flow has nothing else to be — so it says so here rather than
    // sending anyone on to an empty grid.
    if ((getDraft(cred.id)?.receiptItems?.length ?? 0) === 0) { setNoLines(true); return; }
    setNoLines(false);
    router.push(route.quickItems());
  }, () => (cred ? registerScanCredential(cred) : Promise.resolve()));

  const typed = people.length > 0 || typing !== null || (draft?.receiptItems?.length ?? 0) > 0;

  function leave() {
    if (cred) clearDraft(cred.id);
    clearQuickPeople();
    goUp(route.groups(), (to) => router.replace(to));
  }

  /** May we leave? Not with a split on the screen — ask, and stay put. */
  function mayLeave() {
    if (typed) { setAsking(true); return false; }
    return true;
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.quick.title} back={{ ask: mayLeave, up: route.groups() }} />
        {scan.inputs}
        <Scroll>
          <Eyebrow style={{ padding: "6px 16px 0" }}>{copy.quick.who}</Eyebrow>
          <div className="rows">
            {people.map((person) => (
              <div key={person.id} className="row">
                <div className="rmain"><div className="rtitle">{person.name}</div></div>
                <button className="iconbtn" aria-label={copy.members.removeLabel(person.name)}
                  onClick={() => removeQuickPerson(person.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <AddName placeholder={copy.members.addPlaceholder}
              taken={people.map((p) => p.name)}
              onAdd={(name) => { if (cred) addQuickPerson(cred.id, name); }}
              onDraft={setTyping} />
          </div>

          {/* The act the screen ends on, under the people it needs first. */}
          <div className="pad" style={{ paddingTop: 18, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            {/* Held shut until there is somebody to divide by, with the one
                line the screen cannot otherwise say. A bill photographed for
                one person is not a split. */}
            <ScanPair scan={scan} register="lg" disabled={people.length < 2} />
            {people.length < 2 ? <p className="hint">{copy.quick.needTwo}</p> : null}

            {/* No "try again" beside either message: the control above is
                still enabled, and it is the retry. */}
            {scan.live?.state === "error"
              ? <Failure>{scan.live.error ?? copy.scan.failed}</Failure> : null}
            {noLines && scan.live?.state !== "scanning"
              ? <Failure>{copy.quick.noLines}</Failure> : null}

            {/* The same disclosure the group's scan screen carries: the photo
                goes to a free-tier model that may train on it. */}
            <p className="scanterms">{copy.scan.freeTier}</p>
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
