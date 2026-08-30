"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { minorToDecimalString, parseMinor } from "@hajsik/core";
import { AmountInput } from "../../../components/amount-input";
import { Avatar } from "../../../components/bits";
import { Body, Failure, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { recordSettlement } from "../../../lib/db/commands";
import { bare, dateInputValue, errorText, withDate } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

export default function SettlePage() {
  return <QueryBoundary><SettleScreen /></QueryBoundary>;
}

function SettleScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const suggested = Number(params.get("amount") ?? "0");

  const data = useGroupData(groupId);
  const [amountText, setAmountText] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [occurredAt, setOccurredAt] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    if (seeded || !data.group || !Number.isFinite(suggested) || suggested <= 0) return;
    setAmountText(minorToDecimalString(suggested, data.group.baseCurrency));
    setSeeded(true);
  }, [seeded, data.group, suggested]);

  if (!groupId || !data.group || !from || !to) {
    return <Screen><Body><TopBar title="Record payment" back={true} /></Body></Screen>;
  }
  const group = data.group;
  const fromM = data.memberById.get(from);
  const toM = data.memberById.get(to);

  let amountMinor = 0;
  try { amountMinor = amountText ? parseMinor(amountText, group.baseCurrency) : 0; } catch { /* mid-type */ }
  const ready = amountMinor > 0 && !busy;

  async function save() {
    if (!ready || !groupId || !from || !to) return;
    setBusy(true);
    setFailed(undefined);
    try {
      await recordSettlement(groupId, data.me ?? from, {
        fromMember: from,
        toMember: to,
        amountMinor,
        currency: group.baseCurrency,
        rateToBase: "1",
        occurredAt,
        note: note.trim() || null,
      });
      router.replace(route.group(groupId, "balances"));
    } catch (err) {
      setBusy(false);
      setFailed(errorText(err));
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title="Record payment" back={route.group(groupId, "balances")}
          right={<button className="action" onClick={save} disabled={!ready}>Save</button>} />
        <Scroll>
          <div className="pad" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "18px 16px 6px" }}>
            <div style={{ textAlign: "center" }}>
              <Avatar member={fromM} size={40} />
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 5 }}>{fromM?.name}</div>
            </div>
            <Icon name="arrow" size={20} style={{ color: "var(--muted)" }} />
            <div style={{ textAlign: "center" }}>
              <Avatar member={toM} size={40} />
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 5 }}>{toM?.name}</div>
            </div>
          </div>

          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="field">
              <label htmlFor="s-amt">Amount ({group.baseCurrency})</label>
              <AmountInput id="s-amt" frame="none" currency={group.baseCurrency}
                value={amountText}
                placeholder={bare(0, group.baseCurrency)}
                onChange={setAmountText} />
            </div>
            <div className="field">
              <label htmlFor="s-date">Date</label>
              <input id="s-date" type="date" value={dateInputValue(occurredAt)}
                onChange={(e) => setOccurredAt(withDate(occurredAt, e.target.value))} />
            </div>
            <div className="field">
              <input id="s-note" aria-label="Note (optional)" value={note} placeholder="Note (optional)"
                onChange={(e) => setNote(e.target.value)} />
            </div>
            {failed ? <Failure>Couldn&rsquo;t record the payment — {failed}</Failure> : null}
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
