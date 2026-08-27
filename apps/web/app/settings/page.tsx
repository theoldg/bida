"use client";

import { Body, BottomNav, Screen, Scroll, TopBar } from "../../components/chrome";
import { setPersonalMode, updateDevice } from "../../lib/db/device";
import { applyTheme, type Theme } from "../../components/theme";
import { route } from "../../lib/group-link";
import { useDevice } from "../../lib/hooks";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsPage() {
  const device = useDevice();

  async function setTheme(theme: Theme) {
    applyTheme(theme);
    await updateDevice({ theme });
  }

  return (
    <Screen>
      <Body>
        <TopBar title="You" back={route.groups()} />

        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Appearance</div>
              <div className="seg">
                {THEMES.map((t) => (
                  <button key={t.value} className={device?.theme === t.value ? "on" : ""}
                    onClick={() => setTheme(t.value)}>{t.label}</button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Personal mode</div>
              <div className="seg">
                <button className={!device?.personalMode ? "on" : ""}
                  onClick={() => setPersonalMode(false)}>Off</button>
                <button className={device?.personalMode ? "on" : ""}
                  onClick={() => setPersonalMode(true)}>On</button>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, margin: "8px 2px 0" }}>
                Highlights your own share in each group's expense list, and fades the ones
                you're not part of. Set once here, for every group on this phone.
              </p>
            </div>

            <p style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5, margin: "4px 2px 0" }}>
              Hajsik keeps no account of its own — this device and its groups' invite
              links are the whole of it. There's nothing else to sign in or out of here.
            </p>
          </div>
        </Scroll>
      </Body>

      <BottomNav items={[
        { label: "Groups", icon: "list", href: route.groups() },
        { label: "You", icon: "users", href: route.settings(), on: true },
      ]} />
    </Screen>
  );
}
