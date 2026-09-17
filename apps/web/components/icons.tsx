/**
 * One sprite, mounted once in the layout, referenced by <use> everywhere else.
 * This is why there is no icon library in package.json: the whole set is a
 * couple of dozen paths, drawn once and used everywhere.
 */
export type IconName =
  | "chev" | "back" | "plus" | "cam" | "off" | "check" | "clock"
  | "users" | "list" | "scale" | "arrow" | "sync" | "trash" | "edit" | "link"
  | "image" | "split" | "merge" | "share" | "sun" | "moon" | "fx" | "more" | "info"
  | "mail" | "dollar" | "sliders";

const S = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-chev" viewBox="0 0 24 24" {...S} strokeWidth="2.2"><path d="M9 6l6 6-6 6" /></symbol>
        <symbol id="i-back" viewBox="0 0 24 24" {...S} strokeWidth="2.2"><path d="M15 6l-6 6 6 6" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24" {...S} strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="i-cam" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <path d="M3 8.5A2 2 0 015 6.5h2l1.4-2h7.2L17 6.5h2a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <circle cx="12" cy="13" r="3.4" />
        </symbol>
        <symbol id="i-off" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M2 3l20 18M5 12.5a11 11 0 014.2-2.6M19 12.5a11 11 0 00-4.6-2.7M8.5 16a6 6 0 016.2-.5" />
          <circle cx="12" cy="19.5" r=".9" fill="currentColor" stroke="none" />
        </symbol>
        {/* Settings, as two rails with a knob each. A cog was drawn here first
            and a cog is a dozen teeth around a hole: at 15px in a menu row it
            closed up into a blob. Two lines and two circles survive the size. */}
        <symbol id="i-sliders" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M3.5 8.5h10.3M18.2 8.5h2.3M3.5 15.5h4.3M12.2 15.5h8.3" />
          <circle cx="16" cy="8.5" r="2.2" />
          <circle cx="10" cy="15.5" r="2.2" />
        </symbol>
        <symbol id="i-check" viewBox="0 0 24 24" {...S} strokeWidth="2.4"><path d="M4 12.5l5.5 5.5L20 7" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
        </symbol>
        <symbol id="i-info" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><path d="M12 8h.01" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <circle cx="9" cy="8" r="3.4" />
          <path d="M2.5 19.5a6.5 6.5 0 0113 0M16 5.2a3.4 3.4 0 010 5.6M18 14.4a6.5 6.5 0 013.5 5.1" />
        </symbol>
        <symbol id="i-list" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M8 7h12M8 12h12M8 17h12M3.6 7h.01M3.6 12h.01M3.6 17h.01" />
        </symbol>
        <symbol id="i-scale" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <path d="M12 4v16M6 8h12M4 15l2.6-6L9.2 15zM14.8 15l2.6-6 2.6 6" />
          <path d="M4 15a2.6 2.6 0 005.2 0M14.8 15a2.6 2.6 0 005.2 0" />
        </symbol>
        {/* One-sided on purpose. The two-headed "swap" arrow it replaced read as
            "these two are square with each other", which is the opposite of
            what a settle-up row says: money goes this way, once. */}
        <symbol id="i-arrow" viewBox="0 0 24 24" {...S} strokeWidth="2">
          <path d="M4 12h14M12.5 6l6 6-6 6" />
        </symbol>
        <symbol id="i-sync" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M20 11a8 8 0 00-14-4.5M4 13a8 8 0 0014 4.5" /><path d="M6 3v3.8h3.8M18 21v-3.8h-3.8" />
        </symbol>
        <symbol id="i-trash" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2A1.8 1.8 0 009.2 21h5.6a1.8 1.8 0 001.8-1.8L17.5 7" />
        </symbol>
        <symbol id="i-edit" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <path d="M15.5 4.5l4 4L7 21l-4.5.5.5-4.5z" /><path d="M13.5 6.5l4 4" />
        </symbol>
        {/* A dollar sign, for the one screen that asks for money
            (app/g/tip/page.tsx). Not a cup and not a heart: both say "pay the
            person", and the ask is narrower — it is a bill being paid, which
            is the whole claim that screen makes. The currency it draws is not
            the group's, and needn't be: this is the glyph for money itself,
            the way a "+" is the glyph for another row. */}
        <symbol id="i-dollar" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M12 2.8v18.4" />
          <path d="M16.2 7.1a3.9 3.9 0 00-3.7-2.3h-1.2a3.6 3.6 0 000 7.2h1.4a3.6 3.6 0 010 7.2h-1.4a3.9 3.9 0 01-3.7-2.4" />
        </symbol>
        {/* An envelope, for the one address in the app (app/about/page.tsx). */}
        <symbol id="i-mail" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <rect x="3" y="5.5" width="18" height="13" rx="1.5" /><path d="M3.6 6.8l8.4 6 8.4-6" />
        </symbol>
        <symbol id="i-link" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M9.5 14.5l5-5M8 12.2l-2 2a3.5 3.5 0 004.9 4.9l2.4-2.4M16 11.8l2-2a3.5 3.5 0 00-4.9-4.9l-2.4 2.4" />
        </symbol>
        {/* One row becoming two, and back: a rule with arrows pushing apart /
            pulling together. Legible at 12px, which a forking-branch glyph
            isn't. */}
        <symbol id="i-split" viewBox="0 0 24 24" {...S} strokeWidth="2">
          <path d="M3.5 12h17" />
          <path d="M12 8.6V2.8M9.3 5.4L12 2.7l2.7 2.7" />
          <path d="M12 15.4v5.8M9.3 18.6L12 21.3l2.7-2.7" />
        </symbol>
        <symbol id="i-merge" viewBox="0 0 24 24" {...S} strokeWidth="2">
          <path d="M3.5 12h17" />
          <path d="M12 2.7v5.9M9.3 6L12 8.7l2.7-2.7" />
          <path d="M12 21.3v-5.9M9.3 18L12 15.3l2.7 2.7" />
        </symbol>
        <symbol id="i-share" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <path d="M12 3.5v11" /><path d="M8.5 7l3.5-3.5L15.5 7" />
          <path d="M6.5 11H5.5a1.5 1.5 0 00-1.5 1.5v6.5A1.5 1.5 0 005.5 20.5h13a1.5 1.5 0 001.5-1.5v-6.5a1.5 1.5 0 00-1.5-1.5h-1" />
        </symbol>
        <symbol id="i-image" viewBox="0 0 24 24" {...S} strokeWidth="1.8">
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.6" />
          <path d="M3 16.5l5.5-5 4 4 3-3 5.5 5.5" />
        </symbol>
        {/* The theme switch says what you'd get, not what you have: the sun
            when a tap would turn the lights on. */}
        <symbol id="i-sun" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" />
        </symbol>
        <symbol id="i-moon" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M20.5 14.6A8.8 8.8 0 019.4 3.5a8.8 8.8 0 1011.1 11.1z" />
        </symbol>
        {/* Exchange rates: two arrows passing, one each way, because that is
            what a rate is — this much of yours for that much of theirs. Not a
            currency glyph: £ $ € are each somebody's money, and the group's
            base is whichever one it picked. */}
        <symbol id="i-fx" viewBox="0 0 24 24" {...S} strokeWidth="1.9">
          <path d="M3.5 8.5h15M14.5 4.5l4 4-4 4" />
          <path d="M20.5 15.5h-15M9.5 11.5l-4 4 4 4" />
        </symbol>
        {/* The group's own actions, which outgrew the top bar: four icons in a
            row read as four unrelated guesses, one dot column reads as "there
            is a menu here". */}
        <symbol id="i-more" viewBox="0 0 24 24" {...S} strokeWidth="0" fill="currentColor">
          <circle cx="12" cy="5.2" r="1.85" /><circle cx="12" cy="12" r="1.85" />
          <circle cx="12" cy="18.8" r="1.85" />
        </symbol>
      </defs>
    </svg>
  );
}

export function Icon({ name, size = 16, className, style }: {
  name: IconName; size?: number; className?: string; style?: React.CSSProperties;
}) {
  return (
    <svg width={size} height={size} className={className} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
