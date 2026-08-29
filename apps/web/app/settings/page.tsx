"use client";

import { Eyebrow } from "../../components/bits";
import { Body, BottomNav, Screen, Scroll, TopBar } from "../../components/chrome";
import { InstallSettings } from "../../components/install";
import { applyTheme, type Theme } from "../../components/theme";
import { setPersonalMode, updateDevice } from "../../lib/db/device";
import { route } from "../../lib/group-link";
import { useDevice } from "../../lib/hooks";

/**
 * Everything that belongs to the phone rather than to a group, in the one place
 * that is also about the phone: beside the list of groups, not inside one.
 *
 * There used to be a second copy of this inside every group (`/g/options`),
 * reached by a third tab called "Group". It confused a device-wide switch for a
 * group setting — turning personal mode on "for this trip" turned it on for
 * every trip — and it spent a third of the bottom bar on something you touch
 * twice a year. *(Owner, 2026-08-28: "rename 'group' to 'settings', move it out
 * of the group view and back to the landing page/group list".)*
 */

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsPage() {
  const device = useDevice();
  const personal = device?.personalMode ?? true;

  async function setTheme(theme: Theme) {
    applyTheme(theme);
    await updateDevice({ theme });
  }

  return (
    <Screen>
      <Body>
        <TopBar title="Settings" back={route.groups()} />

        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section>
              <Eyebrow style={{ marginBottom: 9 }}>Personal mode</Eyebrow>
              <div className="seg">
                <button className={!personal ? "on" : ""}
                  onClick={() => setPersonalMode(false)}>Off</button>
                <button className={personal ? "on" : ""}
                  onClick={() => setPersonalMode(true)}>On</button>
              </div>
              <p className="hint">
                Shows what each expense did to your balance, and fades the ones
                you're not part of. This phone, every group.
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

            <InstallSettings />
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>

      <BottomNav items={[
        { label: "Groups", icon: "list", href: route.groups() },
        { label: "Settings", icon: "cog", href: route.settings(), on: true },
      ]} />
    </Screen>
  );
}
