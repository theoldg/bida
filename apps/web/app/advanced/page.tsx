"use client";

import { useState } from "react";
import { keepsFocus } from "@/components/bits";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { setGeminiKey } from "@/lib/db/device";
import { route } from "@/lib/group-link";
import { useDevice } from "@/lib/hooks";
import { checkGeminiKey, maskKey, type KeyRefusal } from "@/lib/scan/key";

/**
 * Settings nobody needs by default, starting with a Gemini key of your own.
 *
 * **One row, which locks** — the add-a-name row (`components/name-adder.tsx`).
 * Before, you type into it; after, it is disabled and masked with a bin where
 * the plus was. **Nothing moves but the button and the line under it.**
 *
 * **A key is never stored unchecked.** The plus asks Google once
 * (`checkGeminiKey`): is the key good, and can this browser reach Google at
 * all — a brought-key scan is called from the browser, so a blocker defeats
 * it. **No fallback through our Worker**: the promise is that the key never
 * leaves the phone (docs/receipt-scanning.md#a-key-of-your-own).
 */
export default function AdvancedPage() {
  const device = useDevice();
  const saved = device?.geminiKey;
  const { key } = copy.advanced;

  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState<KeyRefusal>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const candidate = typed.trim();
    if (!candidate || checking) return;
    setChecking(true);
    setRefused(undefined);
    const answer = await checkGeminiKey(candidate);
    setChecking(false);
    // Only a key Google has answered for is written. A refusal leaves what was
    // typed where it is: it may be one character short of right.
    if (!answer.ok) return setRefused(answer.why);
    await setGeminiKey(candidate);
    setTyped("");
  }

  async function forget() {
    await setGeminiKey(undefined);
    setRefused(undefined);
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.advanced.title} back={route.groups()} />
        <Scroll>
          <div className="pad about advanced">
            {/* One section, and the screen is not padded out to look like
                more: an empty settings list is honest about being one thing. */}
            <section className="aboutsect">
              <h4>{key.title}</h4>
              <p>{key.lede}</p>
              <FreeKeyFold />

              {/* Always a box, typed into or locked: what is in this row is
                  either not a key yet or not editable, and neither is the
                  plain line the committed rows elsewhere in the app are. */}
              <form className={`row addrow editing keyrow${saved ? " locked" : ""}`}
                onSubmit={(e) => void save(e)}>
                <input className="addname keyinput"
                  value={saved ? maskKey(saved) : typed}
                  // Locked rather than replaced by text: the field staying put,
                  // greyed and uneditable, is what says the key went in.
                  disabled={!!saved} readOnly={!!saved}
                  aria-label={key.title} placeholder={key.placeholder}
                  onChange={(e) => { setTyped(e.target.value); setRefused(undefined); }}
                  // A credential, not prose: none of the phone's helpfulness
                  // applies, and a capitalised or autocorrected key is one that
                  // will be refused for reasons nobody can see.
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  autoComplete="off" enterKeyHint="done" />
                {saved ? (
                  <button type="button" className="iconbtn" aria-label={key.remove}
                    onClick={() => void forget()}>
                    <Icon name="trash" size={15} />
                  </button>
                ) : (
                  // Keeps the field's focus, like the add-a-name plus: a
                  // keyboard that shuts on the press and reopens after it is a
                  // flinch under the thumb (components/bits.tsx).
                  <button type="submit" className="iconbtn" aria-label={key.use}
                    disabled={checking} {...keepsFocus}>
                    <Icon name={checking ? "clock" : "plus"} size={15} />
                  </button>
                )}
              </form>

              {/* One line under the row, whatever it has to say: that the key
                  went in, that Google said no, or that this browser cannot
                  reach Google at all. */}
              {saved ? <p className="keynote">{key.accepted}</p> : null}
              {checking ? <p className="keynote">{key.checking}</p> : null}
              {refused ? <p className="failure keynote">{key[refused]}</p> : null}
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/**
 * Where to get a key, folded shut: most readers don't need it. Set apart from
 * the paragraph above so the fold reads as the next thing, not its last line.
 */
function FreeKeyFold() {
  const [open, setOpen] = useState(false);
  const { key } = copy.advanced;
  return (
    <div className="installfold">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chev" size={10} className={`kvchev${open ? " on" : ""}`} />
        {key.where}
      </button>
      {open ? (
        // One paragraph with the link in its last sentence; a separate link row
        // would repeat the fold's own button.
        <p>
          {key.freeTier}{" "}
          {key.site.lede}
          <a href={key.whereUrl} target="_blank" rel="noreferrer noopener">{key.site.link}</a>
          {key.site.tail}
        </p>
      ) : null}
    </div>
  );
}
