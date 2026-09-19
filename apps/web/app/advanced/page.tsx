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
 * Settings nobody needs by default, and the first of them: a Gemini key of
 * your own.
 *
 * **One row, which locks.** Pasting a key and holding one are the same screen
 * with the same field in the same place — before, it is typed into; after, it
 * is disabled, showing the key masked, with a bin where the plus was. The
 * first version swapped the whole section for a different one on success,
 * which threw the screen into a shape nobody had asked for at the moment they
 * were reading it. Nothing moves now but the button and the line under it.
 *
 * The row is the app's add-a-name row (`components/name-adder.tsx`) and not a
 * field with a Save under it: a plus on the right of what you typed is how
 * this app files a thing, and there is only one act here to spend a button on.
 *
 * **A key is never stored unchecked.** The plus asks Google once
 * (`checkGeminiKey`), which settles two questions at once: whether the key is
 * good, and whether this browser can reach Google at all. The second has no
 * other moment to be found in — a scan on a brought key is a call this browser
 * makes itself, so a blocker or a shield defeats the feature however good the
 * key is, and that is better said here, with the key in hand, than over a
 * receipt. There is no fallback through our Worker on purpose: the promise is
 * that the key does not leave the phone
 * (docs/receipt-scanning.md#a-key-of-your-own).
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
              <div className="aboutlinks">
                <a className="aboutlink" href={key.whereUrl} target="_blank" rel="noreferrer noopener">
                  <Icon name="link" size={14} />{key.where}
                </a>
              </div>

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
