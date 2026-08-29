"use client";

import Link from "next/link";
import { Avatar, signClass } from "../components/bits";
import { BottomNav, Body, Empty, Screen, Scroll, TopBar } from "../components/chrome";
import { Icon } from "../components/icons";
import { ago, money, plural } from "../lib/format";
import { route } from "../lib/group-link";
import { useGroupSummaries } from "../lib/hooks";

export default function GroupsPage() {
  const summaries = useGroupSummaries();
  // Archived means deleted (the last member left, or later, an explicit
  // archive) — the group log is untouched, but it has no reason to show up
  // here any more.
  const groups = summaries?.filter((g) => !g.group.archivedAt);

  return (
    <Screen>
      <Body>
        <TopBar title="Your groups" />

        <Scroll>
          {groups && groups.length === 0 ? (
            <Empty title="No groups yet">
              A group is a trip, a flat, a dinner — anything several people pay for.
            </Empty>
          ) : null}

          <div className="rows">
            {groups?.map(({ group, memberCount, expenseCount, netMinor, lastActivity }) => (
              <Link key={group.id} href={route.group(group.id)} className="row">
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
        { label: "Settings", icon: "cog", href: route.settings() },
      ]} />
    </Screen>
  );
}
