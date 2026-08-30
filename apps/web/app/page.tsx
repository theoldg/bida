"use client";

import Link from "next/link";
import { Avatar, GhostRow, signClass } from "../components/bits";
import { Body, Empty, Screen, Scroll, SkeletonRows, TopBar } from "../components/chrome";
import { Wordmark } from "../components/icons";
import { InstallNudge } from "../components/install";
import { ThemeToggle } from "../components/theme-toggle";
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
        {/* The app says its own name once, on the screen you land on — and
            carries the one switch that belongs to the phone rather than to any
            group (ADR-0026). The name is the whole bar: a sub-line under it
            described the screen you could already see. */}
        <TopBar title={<span className="brand"><Wordmark size={26} /> Hajsik</span>}
          right={<ThemeToggle />} />

        <Scroll>
          {/* undefined is "Dexie hasn't answered yet", not "no groups" — the
              two used to look the same, and the blank was the one you saw. */}
          {groups === undefined ? <SkeletonRows count={4} /> : null}

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

            <GhostRow icon="plus" label="New group" href={route.newGroup()} />
          </div>

          {/* Once there is something to come back to, and never before it. */}
          {groups && groups.length > 0 ? <InstallNudge /> : null}
        </Scroll>
      </Body>
    </Screen>
  );
}
