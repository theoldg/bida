"use client";

import Link from "next/link";
import { Avatar, signClass } from "../components/bits";
import { BottomNav, Body, Empty, Screen, Scroll, TopBar } from "../components/chrome";
import { Icon } from "../components/icons";
import { ago, money, plural } from "../lib/format";
import { route } from "../lib/group-link";
import { useGroupSummaries } from "../lib/hooks";

export default function GroupsPage() {
  const groups = useGroupSummaries();
  const active = groups?.filter((g) => !g.group.archivedAt) ?? [];

  // Money in two currencies does not add up, and pretending otherwise is
  // exactly the kind of quiet lie this app exists to avoid. Total the base
  // currency most of your groups use, and say so when others are left out.
  const byCurrency = new Map<string, number>();
  for (const g of active) {
    if (g.netMinor === undefined) continue;
    const c = g.group.baseCurrency;
    byCurrency.set(c, (byCurrency.get(c) ?? 0) + g.netMinor);
  }
  const ranked = [...byCurrency.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const headline = ranked[0];
  const otherCurrencies = ranked.length - 1;

  return (
    <Screen>
      <Body>
        <TopBar
          title="Your groups"
          sub={groups ? `${active.length} active` : " "}
          right={<Link className="iconbtn" href={route.settings()} aria-label="Settings">
            <Icon name="dots" size={16} />
          </Link>}
        />

        {headline ? (
          <div className="pad" style={{ paddingTop: 0, paddingBottom: 10 }}>
            <div className="card" style={{
              background: headline[1] < 0 ? "var(--debit-bg)" : "var(--credit-bg)",
              borderColor: "transparent",
            }}>
              <div style={{
                fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase",
                fontFamily: "var(--f-mono)",
                color: headline[1] < 0 ? "var(--debit)" : "var(--credit)",
              }}>Across everything</div>
              <div className={`bignum ${signClass(headline[1])}`} style={{ fontSize: 31, marginTop: 2 }}>
                {money(headline[1], headline[0], true)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 1 }}>
                {headline[1] < 0 ? "You owe more than you're owed"
                  : headline[1] > 0 ? "You're owed more than you owe"
                  : "Everything squares up"}
                {otherCurrencies > 0 ? ` · ${plural(otherCurrencies, "other currency", "other currencies")} not counted` : ""}
              </div>
            </div>
          </div>
        ) : null}

        <Scroll>
          {groups && groups.length === 0 ? (
            <Empty title="No groups yet">
              A group is a trip, a flat, a dinner — anything several people pay for.
            </Empty>
          ) : null}

          <div className="rows">
            {groups?.map(({ group, memberCount, expenseCount, netMinor, lastActivity }) => (
              <Link key={group.id} href={route.group(group.id)} className="row"
                style={group.archivedAt ? { opacity: .5 } : undefined}>
                <Avatar name={group.name} />
                <div className="rmain">
                  <div className="rtitle">{group.name}</div>
                  <div className="rmeta">
                    {plural(memberCount, "person", "people")} · {plural(expenseCount, "expense")} · {ago(lastActivity)}
                  </div>
                </div>
                <div className="ramt">
                  {netMinor === undefined ? (
                    <>
                      <div className="big" style={{ color: "var(--muted)" }}>—</div>
                      <div className="sm">who are you?</div>
                    </>
                  ) : (
                    <>
                      <div className={`big ${signClass(netMinor)}`}
                        style={netMinor === 0 ? { color: "var(--muted)" } : undefined}>
                        {money(netMinor, group.baseCurrency, netMinor !== 0)}
                      </div>
                      <div className="sm">
                        {netMinor < 0 ? "you owe" : netMinor > 0 ? "you're owed" : "settled"}
                      </div>
                    </>
                  )}
                </div>
              </Link>
            ))}

            <Link href={route.newGroup()} className="row" style={{ paddingTop: 16 }}>
              <span className="avatar" style={{
                background: "transparent", borderStyle: "dashed", color: "var(--muted)",
              }}><Icon name="plus" size={15} /></span>
              <div className="rmain">
                <div className="rtitle" style={{ color: "var(--muted)", fontWeight: 500 }}>New group</div>
              </div>
            </Link>
          </div>
        </Scroll>
      </Body>

      <BottomNav items={[
        { label: "Groups", icon: "list", href: route.groups(), on: true },
        { label: "You", icon: "users", href: route.settings() },
      ]} />
    </Screen>
  );
}
