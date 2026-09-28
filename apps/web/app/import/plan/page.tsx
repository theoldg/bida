"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { plannedCount } from "@bida/core";
import { Blank, Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { CreateAs } from "@/components/create-as";
import { copy } from "@/lib/copy";
import { currencyLabel } from "@/lib/currencies";
import { importGroup } from "@/lib/db/commands";
import { plural } from "@/lib/format";
import { route } from "@/lib/group-link";
import { setPendingImport, usePendingImport } from "@/lib/import/pending";
import { useRefusal } from "@/lib/refusal";

/**
 * What `/import` read, before anything is written: the counts to check
 * against the source, the group's name, then which person you are.
 *
 * **Its own route**, so back is an ordinary back to the picker, the arrow and
 * the phone's button alike ([ADR-0007](../../../../../docs/decisions/0007-a-screen-is-a-route.md)).
 * The who question stays a step of this screen, as it is of `/new`.
 *
 * **The who question is the join screen's**, add row included: a name the
 * source doesn't hold joins the group owing nothing.
 */
export default function ImportPlanPage() {
  const router = useRouter();
  const pending = usePendingImport();
  const [asking, setAsking] = useState(false);
  /** The name field, which is the one thing on this screen a person types. */
  const nameFlash = useRefusal();

  const words = copy.importData;

  // Nothing read means a reload or a bookmark, and a plan lives in memory only.
  useEffect(() => {
    if (!pending) router.replace(route.import());
  }, [pending, router]);

  if (!pending) return <Blank title={words.title} back={route.import()} />;
  const { plan, name } = pending;

  /** The group's name is the one thing the file cannot tell us, so it is asked. */
  function next() {
    if (name.trim().length === 0) {
      nameFlash.refuse();
      return;
    }
    setAsking(true);
  }

  if (asking) {
    return (
      <CreateAs title={words.named(name.trim())} names={plan.members}
        // Asked even with one person: the answer is the actor on every op.
        picked={plan.members.length === 1 ? plan.members[0] : undefined}
        // Onto the plan, so the group is written with them as a member.
        onAdd={(who) => setPendingImport({ name, plan: { ...plan, members: [...plan.members, who] } })}
        onBack={() => setAsking(false)}
        create={async (me) => (await importGroup(plan, { name: name.trim(), myName: me })).groupId}
        failedText={words.failed} />
    );
  }

  return (
    <Screen>
      <Body>
        <TopBar title={words.title} back={route.import()} />
        <Scroll>
          <div className="pad about">
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
                  onChange={(e) => setPendingImport({ plan, name: e.target.value })} />
              </div>

              <div style={{ paddingTop: 16 }}>
                <button type="button" className="btn btn-p btn-lg" onClick={next}
                  disabled={nameFlash.live || plannedCount(plan) === 0}>
                  {words.act}
                </button>
              </div>
            </section>
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
