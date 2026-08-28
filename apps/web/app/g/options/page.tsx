"use client";

import { useSearchParams } from "next/navigation";
import { Eyebrow } from "../../../components/bits";
import {
  Body, BottomNav, QueryBoundary, Screen, Scroll, TopBar,
} from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { applyTheme, type Theme } from "../../../components/theme";
import { setPersonalMode, updateDevice } from "../../../lib/db/device";
import { route } from "../../../lib/group-link";
import { useDevice, useGroupData, useInviteLink } from "../../../lib/hooks";

/**
 * What is left of a settings screen once everything with a better home has
 * gone there: the invite link, and the two switches that belong to the phone.
 *
 * People and History are icons in `/g`'s top bar, one tap from the ledger
 * rather than two through here. Who you are is claimed on People, next to the
 * names. Renaming a group is gone entirely — you name it once. Theme and
 * personal mode are device-wide, not per-group, and stay here only because
 * this is where people notice they want them; changing one changes it for
 * every group on this phone, and the copy says so.
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
  const invite = useInviteLink(groupId);

  if (!groupId || !data.group) {
    return <Screen><Body><TopBar title="Group" back={true} /></Body></Screen>;
  }
  const group = data.group;

  async function setTheme(theme: Theme) {
    applyTheme(theme);
    await updateDevice({ theme });
  }

  return (
    <Screen>
      <Body>
        <TopBar title={group.name} back={route.group(groupId)} />

        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {invite.copy ? (
              <button className="btn btn-p" onClick={invite.copy}>
                <Icon name={invite.copied ? "check" : "link"} size={17} />
                {invite.copied ? "Copied" : "Copy invite link"}
              </button>
            ) : null}

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
                This phone, every group.
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
            </section>
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>

      <BottomNav items={[
        { label: "Expenses", icon: "list", href: route.group(groupId) },
        { label: "Balances", icon: "scale", href: route.group(groupId, "balances") },
        { label: "Group", icon: "cog", href: route.options(groupId), on: true },
      ]} />
    </Screen>
  );
}
