// Doc: docs/design-system.md
/**
 * One sprite, mounted once in the layout (icon-sprite.tsx), referenced by <use>
 * everywhere else — a couple of dozen paths, which is why there is no icon
 * library in package.json.
 */
import type { AmountTap } from "../lib/tap-amount";

export type IconName =
  | "chev" | "updown" | "back" | "plus" | "minus" | "cross" | "cam" | "off" | "check" | "clock"
  | "users" | "arrow" | "sync" | "trash" | "edit" | "link"
  | "image" | "split" | "merge" | "share" | "import" | "sun" | "moon" | "more" | "info"
  | "mail" | "copy" | "dollar" | "sliders" | "translate" | "search" | "bell" | "bell-off" | "bells";

export function Icon({ name, size = 16, className, style }: {
  name: IconName; size?: number; className?: string; style?: React.CSSProperties;
}) {
  return (
    <svg width={size} height={size} className={className} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * An icon that flips on its X axis to a check while `on` holds — the groups
 * list's flip (`.flipfig`) as one glyph, so copying confirms
 * itself the same way everywhere. Both faces are always drawn: the flip back
 * is a transition on a class going away.
 */
export function FlipCheck({ name, size = 16, on }: {
  name: IconName; size?: number; on: boolean;
}) {
  return (
    <span className={`flipcheck${on ? " on" : ""}`} style={{ width: size, height: size }}>
      <Icon name={name} size={size} className="flipface" />
      <Icon name="check" size={size} className="checkface" />
    </span>
  );
}

/**
 * The same flip across a whole button label, for actions named in words.
 * Both faces are always drawn; the one facing away is hidden from readers,
 * so the button is named by the visible face. Where an icon is the verb,
 * `iconSays` is that word to a reader, ahead of the label.
 */
export function FlipLabel({ label, done, on, icon, iconSays }: {
  label: string; done: string; on: boolean; icon?: IconName; iconSays?: string;
}) {
  return (
    <span className={`flipcheck line${on ? " on" : ""}`}>
      <span className="flipface" aria-hidden={on}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {iconSays ? <span className="vh">{iconSays} </span> : null}
        {label}
      </span>
      <span className="checkface" aria-hidden={!on}>
        <Icon name="check" size={16} />
        {done}
      </span>
    </span>
  );
}

/**
 * What a tap on a name in a column of amounts would do (`tapAmount`): a plus
 * where it fills the rest, a cross where it clears. Nothing where it would only
 * open the field — that is what the field already looks like. The slot keeps
 * its width either way so the figures stay in one column.
 */
export function TapMark({ tap }: { tap: AmountTap }) {
  return (
    <span style={{ width: 16, flex: "none", display: "flex", justifyContent: "center", color: "var(--muted)" }}>
      {tap === "edit" ? null
        : tap.set > 0 ? <Icon name="plus" size={14} /> : <Icon name="cross" size={12} />}
    </span>
  );
}
