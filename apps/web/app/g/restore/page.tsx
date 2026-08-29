"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  buildRestorePatch, entityHistory,
  type CurrencyCode, type EntityKind, type Member,
} from "@hajsik/core";
import { Eyebrow, KV } from "../../../components/bits";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { restoreRevision } from "../../../lib/db/commands";
import { db } from "../../../lib/db/dexie";
import { opsForGroup } from "../../../lib/db/fold";
import { stamp } from "../../../lib/format";
import { describe, fieldLabel, fieldValue } from "../../../lib/history-copy";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

/**
 * "Put it back to this" — the confirmation for a restore.
 *
 * It used to be a `confirm()` on the history screen, behind a "Restore this
 * version" link under every entry. That was both too loud in the timeline and
 * too quiet at the moment it mattered: a one-line browser dialog, naming
 * nothing it was about to change. This screen names all of it, and the
 * timeline gets a rewind icon at the edge instead.
 *
 * A restore is an ordinary op carrying the old field values (ADR-0002), so
 * nothing is erased — which is what the footnote here says, in those words.
 */
/**
 * A restore patch is field-level and mechanical: putting an amount back carries
 * `amountMinor`, `rateToBase` and `baseAmountMinor`, three rows that say the
 * same thing twice. This renders one row per *thing a person changed*, in the
 * patch's own order, and drops the bookkeeping that rides along with it.
 */
function displayFields(
  patch: Record<string, unknown>,
  ctx: { memberById: Map<string, Member>; currency: CurrencyCode },
): { field: string; label: string; value: string }[] {
  const mechanics = new Set(["amountMinor", "rateToBase"]);
  const rows: { field: string; label: string; value: string }[] = [];
  const seen = new Set<string>();

  for (const [field, value] of Object.entries(patch)) {
    if ("baseAmountMinor" in patch && mechanics.has(field)) continue;
    const label = fieldLabel(field);
    if (seen.has(label)) continue;
    seen.add(label);
    rows.push({ field, label, value: fieldValue(field, value, ctx) });
  }
  return rows;
}

export default function RestorePage() {
  return <QueryBoundary><RestoreScreen /></QueryBoundary>;
}

function RestoreScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entityId = params.get("e") ?? undefined;
  const atHlc = params.get("at") ?? undefined;
  const entity = (params.get("kind") ?? "expense") as EntityKind;
  const data = useGroupData(groupId);
  const [busy, setBusy] = useState(false);

  const ops = useLiveQuery(async () => (groupId ? opsForGroup(groupId) : []), [groupId]) ?? [];

  // Names for people who have since been removed: a revision from March is
  // allowed to be about somebody who left in April.
  const allMembers = useLiveQuery(
    async () => (groupId ? db().members.where("groupId").equals(groupId).toArray() : []),
    [groupId],
  ) ?? [];
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  // Read straight from the table rather than `data.expenses`: a restore is
  // exactly what you reach for on a deleted expense, which the alive-only list
  // has already dropped.
  const subject = useLiveQuery(
    async () => (entity === "expense" && entityId ? db().expenses.get(entityId) : undefined),
    [entity, entityId],
  );

  const back = groupId
    ? route.history(groupId, entity === "expense" ? entityId : undefined)
    : route.groups();

  if (!groupId || !entityId || !atHlc || !data.group) {
    return <Screen><Body><TopBar title=" " back={back} /></Body></Screen>;
  }
  const currency = data.group.baseCurrency;

  const revision = entityHistory(ops, entityId).find((r) => r.op.hlc === atHlc);
  const patch = buildRestorePatch(ops, entityId, atHlc);
  const fields = displayFields(patch, { memberById, currency });
  const who = (revision && memberById.get(revision.op.actor)?.name) || "Someone";

  async function restore() {
    if (!groupId || !entityId || !atHlc || busy) return;
    setBusy(true);
    try {
      await restoreRevision(groupId, data.me ?? revision?.op.actor ?? entityId, entity, entityId, atHlc);
      router.replace(back);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title="Restore this version"
          sub={subject?.description || (revision ? stamp(revision.op.createdAt) : undefined)}
          back={back} />

        <Scroll>
          {!revision ? (
            <Empty title="That version isn't here">
              It may have arrived from another phone and been rewritten since.
            </Empty>
          ) : fields.length === 0 ? (
            <div className="pad">
              <Empty title="Already how it looks">
                Nothing has changed since this version, so there is nothing to put back.
              </Empty>
            </div>
          ) : (
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <section>
                <Eyebrow style={{ marginBottom: 9 }}>Going back to</Eyebrow>
                <div className="card">
                  <div className="what">{describe(revision, who, memberById, currency).what}</div>
                  <div className="when" style={{ marginTop: 4 }}>{stamp(revision.op.createdAt)}</div>
                </div>
              </section>

              <section>
                <Eyebrow style={{ marginBottom: 9 }}>What changes</Eyebrow>
                <div className="card">
                  {fields.map((f) => <KV key={f.field} k={f.label} v={f.value} />)}
                </div>
                <p className="hint">
                  Everything else stays as it is now.
                </p>
              </section>
            </div>
          )}
        </Scroll>
      </Body>

      <div style={{ borderTop: "1px solid var(--rule)", flex: "none", padding: "11px 16px" }}>
        <button className="btn btn-p" onClick={restore} disabled={busy || !revision || fields.length === 0}>
          <Icon name="rewind" size={15} /> Restore this version
        </button>
        <p className="hint" style={{ textAlign: "center" }}>
          This adds a new entry to the history rather than erasing what happened since.
        </p>
      </div>
    </Screen>
  );
}
