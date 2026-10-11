"use client";

import Link from "next/link";
import { useState } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { setDark, useDark } from "@/components/dark-mode";
import { Icon, type IconName } from "@/components/icons";
import { useInstallOffer, usePushState } from "@/components/install";
import { copy } from "@/lib/copy";
import { type NotifyLevel } from "@/lib/db/dexie";
import { route } from "@/lib/group-link";
import { useDevice } from "@/lib/hooks";
import { notifyLevel, setNotifyLevel } from "@/lib/push";

/**
 * The phone's settings, the same screen from the groups list and from inside
 * a group, so back goes wherever it was opened from: how it looks, what it
 * is told, and a way on to **Advanced** (`/advanced`) for what nobody needs
 * by default.
 */
export default function SettingsPage() {
  return (
    <Screen>
      <Body>
        <TopBar title={copy.settings.title} back />
        <Scroll>
          <div className="pad about settings">
            <Theme />
            <Notifications />
            {/* What nobody needs by default is a screen of its own, one press away. */}
            <Link href={route.advanced()} className="setlink">
              {copy.advanced.title}
              <Icon name="chev" size={15} />
            </Link>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * One setting: an eyebrow over a segmented control as wide as its words, and
 * under it, when there is one, a line saying what the chosen answer means.
 * Theme and notifications are both this, so they read alike.
 */
function Choice<T extends string>({ title, options, chosen, onChoose, disabled, note }: {
  title: string;
  options: readonly { value: T; label: string; icon?: IconName }[];
  chosen: T;
  onChoose: (value: T) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <section className="aboutsect">
      <h4>{title}</h4>
      <div className="seg" role="group" aria-label={title}>
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === chosen ? "on" : ""}
            aria-pressed={o.value === chosen} disabled={disabled}
            onClick={() => { if (o.value !== chosen) onChoose(o.value); }}>
            {o.icon ? <Icon name={o.icon} size={13} /> : null}
            {o.label}
          </button>
        ))}
      </div>
      {note ? <p className="keynote">{note}</p> : null}
    </section>
  );
}

/** Two ways: the phone's own look until one is pressed (`setDark`). */
function Theme() {
  const dark = useDark();
  const { theme } = copy.settings;
  return (
    <Choice title={theme.title} chosen={dark ? "dark" : "light"}
      options={[
        { value: "light", label: theme.light, icon: "sun" },
        { value: "dark", label: theme.dark, icon: "moon" },
      ]}
      onChoose={(v) => setDark(v === "dark")} />
  );
}

const LEVELS: readonly NotifyLevel[] = ["off", "own", "all"];

/**
 * Off, just me, or all (`NotifyScope`). **Only in the installed app**, which
 * is the only place iOS delivers a push and where the offer card asks first.
 * Choosing one without permission is the tap that asks for it.
 *
 * **The tapped answer is drawn chosen at once**, and held until the device
 * says so: nothing is disabled meanwhile, since a control dimming while it
 * saves reads as every other option flickering. A tap while one is in flight
 * is ignored; a refused prompt puts the old answer back.
 */
function Notifications() {
  const installed = useInstallOffer() === "installed";
  const state = usePushState();
  const device = useDevice();
  const [pending, setPending] = useState<NotifyLevel | null>(null);
  if (!installed || state === "unsupported" || !device) return null;
  const { notify } = copy.settings;
  const level = pending ?? notifyLevel(state, device.notify);
  const blocked = state === "denied" && pending === null;
  const choose = (next: NotifyLevel) => {
    if (pending !== null) return;
    setPending(next);
    void setNotifyLevel(next).finally(() => setPending(null));
  };
  return (
    <Choice title={notify.title} chosen={level} disabled={blocked}
      options={LEVELS.map((l) => ({ value: l, label: notify.level[l] }))}
      onChoose={choose} note={blocked ? notify.blocked : notify.means[level]} />
  );
}
