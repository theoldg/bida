"use client";
// Doc: docs/who-had-what.md#a-split-by-days

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import {
  stayAt, stayDates, stayEnd, stayers, stayHeads, type Expense,
} from "@bida/core";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, TopBar } from "@/components/chrome";
import { NO_AUTOFILL } from "@/lib/autofill";
import { copy } from "@/lib/copy";
import { bare, distinctInitials, stayDay } from "@/lib/format";
import { expenseDraft, seedDraft } from "@/lib/draft";
import { parseEntrySource, route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";

/**
 * A saved stay, read back: the calendar as `/g/entry/days` draws it, with
 * nothing to press. The sums behind each share are the entry screen's; Edit
 * opens the calendar that changes it, its draft seeded here as the form would.
 */
export default function StayPage() {
  return <QueryBoundary><StayScreen /></QueryBoundary>;
}

function StayScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const via = parseEntrySource(params.get("via"));
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);

  if (!groupId || !entryId) return <BadLink />;
  const back = route.entry(groupId, entryId, via);
  if (data.loading || unclaimed) return <Blank title={copy.stay.calendar} back={back} />;
  if (!data.group) return <BadLink />;
  const expense: Expense | undefined = data.withTombstones.expenses[entryId];
  if (!expense || expense.split.mode !== "days") {
    return (
      <Screen><Body>
        <TopBar title={copy.entry.gone.title} back={back} />
        <Empty title={copy.entry.gone.body} />
      </Body></Screen>
    );
  }

  const spec = expense.split;
  const base = data.group.baseCurrency;
  const total = expense.baseAmountMinor;
  const ids = new Set(stayers(spec));
  // The roster in the grid's order, and anyone removed since who stayed.
  const people = [...data.members, ...[...data.memberById.values()]
    .filter((m) => ids.has(m.id) && !data.members.some((x) => x.id === m.id))];
  const labels = distinctInitials(people);
  const columns = people.filter((m) => ids.has(m.id));
  const dates = stayDates(spec);
  const heads = stayHeads(spec);
  const nights = spec.unit === "night";
  const end = stayEnd(spec);

  return (
    <Screen>
      <Body>
        <TopBar title={copy.stay.calendar} sub={expense.description.trim() || undefined} back={back} />

        <div className="itemscroll">
          {/* The editing grid's head, its own controls held inert: Edit opens onto the same picture. */}
          <div className="itemhead itemwide" inert>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{copy.stay.whoStayed}</div>
            <div className="whostrip">
              {people.map((m) => (
                <button key={m.id} type="button" className="itemchip" aria-pressed={ids.has(m.id)}
                  style={{ opacity: ids.has(m.id) ? 1 : .4 }}>
                  <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{labels.get(m.id)}</span>
                  {m.name}
                </button>
              ))}
            </div>
            <div className="eyebrow stayeyebrow">{copy.stay.dates}</div>
            <div className="stayrange">
              <label className="stayfield">
                <input type="date" readOnly autoComplete={NO_AUTOFILL} value={spec.from} aria-label={copy.stay.from[spec.unit]} />
              </label>
              <span className="stayarrow" aria-hidden="true">→</span>
              <label className="stayfield">
                <input type="date" readOnly autoComplete={NO_AUTOFILL} value={end} aria-label={copy.stay.toLabel[spec.unit]} />
              </label>
            </div>
          </div>

          <table className={`itemtable staytable stayread${nights ? " bynight" : ""}`}
            style={{ "--cols": columns.length } as CSSProperties}>
            <colgroup>
              <col className="collabel" />
              {columns.map((m) => <col key={m.id} className="colwho" />)}
            </colgroup>
            <thead>
              <tr>
                <th className="stayrowhead">{copy.stay.row[spec.unit]}</th>
                {columns.map((m) => (
                  <th key={m.id}>
                    <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{labels.get(m.id)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const h = heads[i] ?? 0;
                const each = h > 0 ? Math.round(total / (spec.count * h)) : 0;
                return (
                  <tr key={date}>
                    <td className="itemlabel">
                      <span className="itemname">{stayDay(date)}</span>
                      <span className="itemamount">{h > 0 ? copy.stay.each(h, bare(each, base)) : copy.stay.nobody}</span>
                    </td>
                    {columns.map((m) => {
                      const there = stayAt(spec, m.id, i);
                      const first = there && !stayAt(spec, m.id, i - 1);
                      const last = there && !stayAt(spec, m.id, i + 1);
                      return (
                        <td key={m.id} className="itemwho">
                          <span className={`itemcell staycell${there ? " in" : ""}${first ? " first" : ""}${last ? " last" : ""}`}>
                            {there ? <span className="staybar" /> : <span className="dot" />}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {nights && dates.length > 0 ? (
                <tr className="staydeparture">
                  <td className="itemlabel">
                    <span className="itemname">{stayDay(end)}</span>
                    <span className="itemamount">{copy.stay.departure}</span>
                  </td>
                  {columns.map((m) => <td key={m.id} className="itemwho" />)}
                </tr>
              ) : null}
            </tbody>
          </table>

        </div>

        {expense.deletedAt ? null : (
          <div className="pad whodock" style={{ paddingTop: 18 }}>
            {/* Straight into the calendar, seeded before the tap navigates: through
                the form, the form flashed by and Back stopped on it. Always from
                the saved entry, since this screen draws that and nothing else. */}
            <Link href={route.days(groupId, via, true)} className="btn btn-s" onClick={() => {
              const me = data.me ?? data.members[0]?.id;
              if (me) seedDraft(groupId, expenseDraft(expense, me, data.members.map((m) => m.id)), entryId);
            }}>{copy.act.edit}</Link>
          </div>
        )}
      </Body>
    </Screen>
  );
}
