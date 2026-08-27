"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Avatar, Eyebrow } from "../../../components/bits";
import {
  Body, BottomNav, Empty, QueryBoundary, Screen, Scroll, TopBar,
} from "../../../components/chrome";
import { Icon, type IconName } from "../../../components/icons";
import { applyTheme, type Theme } from "../../../components/theme";
import { renameGroup } from "../../../lib/db/commands";
import { setMe, setPersonalMode, updateDevice } from "../../../lib/db/device";
import { stamp } from "../../../lib/format";
import { formatJoinLink, route } from "../../../lib/group-link";
import { useDevice, useGroupData, useGroupSecret, useIdentityLog } from "../../../lib/hooks";

/**
 * Everything about *this group on this phone*, in one place: who you are here,
 * how the app looks, and the way out to People, History and the invite link.
 *
 * Theme and personal mode are device-wide, not per-group — they are properties
 * of the phone, not of the trip. This screen only surfaces them where people
 * actually notice they want them, rather than making them walk back out to
 * /settings. Changing one here changes it everywhere, and the copy says so.
 */

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function GroupOptionsPage() {
  return <QueryBoundary><GroupOptionsScreen /></QueryBoundary>;
}

function GroupOptionsScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const device = useDevice();
  const secret = useGroupSecret(groupId);
  const identity = useIdentityLog(groupId);

  if (!groupId || !data.group) {
    return <Screen><Body><TopBar title="Group" back={true} /></Body></Screen>;
  }
  const group = data.group;

  async function claim(memberId: string) {
    if (!groupId) return;
    await setMe(groupId, memberId);
  }

  async function setTheme(theme: Theme) {
    applyTheme(theme);
    await updateDevice({ theme });
  }

  async function invite() {
    if (!groupId || !secret) return;
    const link = formatJoinLink({ groupId, secret });
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${group.name} on Hajsik`, url: link }); }
      catch { /* the share sheet was dismissed */ }
      return;
    }
    await navigator.clipboard.writeText(link);
    alert("Invite link copied");
  }

  async function rename() {
    if (!groupId) return;
    const name = prompt("Group name", group.name)?.trim();
    if (!name || name === group.name) return;
    await renameGroup(groupId, data.me ?? group.id, name);
  }

  const nameOf = (id: string | null) =>
    id === null ? null : data.memberById.get(id)?.name ?? "someone who has since left";

  return (
    <Screen>
      <Body>
        <TopBar title="Group options" sub={group.name} back={route.group(groupId)} />

        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            <section>
              <Eyebrow style={{ marginBottom: 9 }}>Who you are here</Eyebrow>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                {data.members.map((m) => (
                  <button key={m.id} className="row" onClick={() => claim(m.id)}
                    style={{ background: "transparent" }}>
                    <Avatar member={m} size={28} />
                    <div className="rmain">
                      <div className="rtitle">{m.name}</div>
                    </div>
                    {m.id === data.me
                      ? <Icon name="check" size={16} style={{ color: "var(--brand)" }} />
                      : null}
                  </button>
                ))}
              </div>
              <p className="hint">
                {data.me
                  ? "Only this phone knows. Switching doesn't touch anybody else's ledger."
                  : "Nobody is claimed on this phone yet — tap your name so the app knows who you are."}
              </p>
            </section>

            <section>
              <Eyebrow style={{ marginBottom: 9 }}>Personal mode</Eyebrow>
              <div className="seg">
                <button className={!device?.personalMode ? "on" : ""}
                  onClick={() => setPersonalMode(false)}>Off</button>
                <button className={device?.personalMode ? "on" : ""}
                  onClick={() => setPersonalMode(true)}>On</button>
              </div>
              <p className="hint">
                Highlights your own share and fades the expenses you're not part of.
                Set for this phone, in every group.
              </p>
            </section>

            <section>
              <Eyebrow style={{ marginBottom: 9 }}>Colour theme</Eyebrow>
              <div className="seg">
                {THEMES.map((t) => (
                  <button key={t.value} className={device?.theme === t.value ? "on" : ""}
                    onClick={() => setTheme(t.value)}>{t.label}</button>
                ))}
              </div>
              <p className="hint">Also for this phone, in every group.</p>
            </section>

            <section>
              <Eyebrow style={{ marginBottom: 9 }}>This group</Eyebrow>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <Row href={route.members(groupId)} icon="users" label="People"
                  meta={`${data.members.length}`} />
                <Row href={route.history(groupId)} icon="clock" label="History"
                  meta="Every change, in order" />
                {secret ? <Row onClick={invite} icon="link" label="Invite link"
                  meta="Share this group" /> : null}
                <Row onClick={rename} icon="edit" label="Rename group" meta={group.name} />
              </div>
            </section>

            <section>
              <Eyebrow style={{ marginBottom: 9 }}>Identity on this phone</Eyebrow>
              {identity.length === 0 ? (
                <Empty title="No claim yet">
                  Once you pick who you are above, every switch is listed here.
                </Empty>
              ) : (
                <div className="tl">
                  {identity.slice().reverse().map((entry, i) => (
                    <div key={entry.id ?? entry.at} className={`tle${i === 0 ? " now" : ""}`}>
                      <div className="when">{stamp(entry.at)}</div>
                      <div className="what">
                        {entry.fromMember === null
                          ? <>Claimed <b>{nameOf(entry.toMember)}</b> on this phone</>
                          : <>Switched from <b>{nameOf(entry.fromMember)}</b> to <b>{nameOf(entry.toMember)}</b></>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="hint">
                Device-local, like the choice itself: switching who you are is a fact about
                this phone, so it never goes up to the group's log.
              </p>
            </section>
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>

      <BottomNav items={[
        { label: "Expenses", icon: "list", href: route.group(groupId) },
        { label: "Balances", icon: "scale", href: route.group(groupId, "balances") },
        { label: "Settle", icon: "swap", href: route.group(groupId, "settle") },
        { label: "Group", icon: "cog", href: route.options(groupId), on: true },
      ]} />
    </Screen>
  );
}

function Row({ href, onClick, icon, label, meta }: {
  href?: string; onClick?: () => void; icon: IconName; label: string; meta?: string;
}) {
  const inner = (
    <>
      <Icon name={icon} size={16} style={{ color: "var(--muted)", flex: "none" }} />
      <div className="rmain">
        <div className="rtitle" style={{ fontWeight: 500 }}>{label}</div>
      </div>
      {meta ? <span className="rmeta" style={{ maxWidth: 150 }}>{meta}</span> : null}
      <Icon name="chev" size={13} style={{ color: "var(--muted)", flex: "none" }} />
    </>
  );
  return href
    ? <Link href={href} className="row">{inner}</Link>
    : <button className="row" onClick={onClick} style={{ background: "transparent" }}>{inner}</button>;
}
