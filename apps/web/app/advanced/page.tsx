"use client";

import { useState } from "react";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { copy } from "../../lib/copy";
import { setGeminiKey } from "../../lib/db/device";
import { route } from "../../lib/group-link";
import { useDevice } from "../../lib/hooks";
import { readClipboardText } from "../../lib/paste";
import { checkGeminiKey, maskKey, type KeyRefusal } from "../../lib/scan/key";

/**
 * Settings nobody needs by default, and the first of them: a Gemini key of
 * your own.
 *
 * Set in prose, like `/about`, and for the same reason — what is being asked
 * for here is trust, and trust is paragraphs, not a row of switches. The
 * screen says the three things a person has to weigh before pasting a
 * credential into somebody else's app: what changes (the phone calls Google
 * itself, so no cap and nothing counted here), what it costs (Google bills the
 * key), and where it lands (this phone, in the clear).
 *
 * **A key is never stored unchecked.** Saving asks Google once (`checkGeminiKey`),
 * which settles two questions at once: whether the key is good, and whether
 * this browser can reach Google at all. The second is the one that has no
 * other moment to be found in — a scan on a brought key is a call this browser
 * makes itself, so a content blocker or a shield defeats the feature entirely,
 * and that is far better said here, with the key in hand, than over a receipt
 * three days later. There is no fallback through our Worker on purpose: the
 * promise this screen makes is that the key does not leave the phone
 * (docs/receipt-scanning.md#a-key-of-your-own).
 */
export default function AdvancedPage() {
  const device = useDevice();
  const saved = device?.geminiKey;

  return (
    <Screen>
      <Body>
        <TopBar title={copy.advanced.title} back={route.groups()} />
        <Scroll>
          <div className="pad about">
            {/* One section, and the screen is not padded out to look like
                more: an empty settings list is honest about being one thing. */}
            <section className="aboutsect">
              <h4>{copy.advanced.key.title}</h4>
              {saved ? <SavedKey value={saved} /> : <KeyForm />}
            </section>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}

/** The key in use: which one, what it does, and the one way back. */
function SavedKey({ value }: { value: string }) {
  const { key } = copy.advanced;
  return (
    <>
      {/* Masked, and the mask is the heading: enough to tell which key is
          pasted, never enough to read one off a shoulder or a screenshot. */}
      <div className="keyshown"><Icon name="cog" size={14} />{maskKey(value)}</div>
      <p>{key.inUse}</p>
      <p className="hint">{key.stored}</p>
      <div className="keyact">
        <button type="button" className="btn btn-d" onClick={() => void setGeminiKey(undefined)}>
          {key.remove}
        </button>
      </div>
    </>
  );
}

/** Pasting one: the field, the check, and what Google or the browser said. */
function KeyForm() {
  const { key } = copy.advanced;
  const [typed, setTyped] = useState("");
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState<KeyRefusal>();

  async function paste() {
    // `undefined` is a refused read — the person dismissing iOS's paste
    // prompt: a no, not an error, and nothing to show for it (lib/paste.ts).
    const text = await readClipboardText();
    if (text === undefined) return;
    setTyped(text.trim());
    setRefused(undefined);
  }

  async function save() {
    const candidate = typed.trim();
    if (!candidate || checking) return;
    setChecking(true);
    setRefused(undefined);
    const answer = await checkGeminiKey(candidate);
    setChecking(false);
    // Only a key Google has answered for is written. A refusal leaves what was
    // typed on screen: it may be one character short of right.
    if (!answer.ok) return setRefused(answer.why);
    await setGeminiKey(candidate);
  }

  return (
    <>
      <p>{key.lede}</p>
      <div className="aboutlinks">
        <a className="aboutlink" href={key.whereUrl} target="_blank" rel="noreferrer noopener">
          <Icon name="link" size={14} />{key.where}
        </a>
      </div>

      <div className="keyfield field">
        <input
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setRefused(undefined); }}
          placeholder={key.placeholder}
          // A credential, not prose: none of the phone's helpfulness applies,
          // and a capitalised or autocorrected key is a key that will be
          // refused for reasons nobody can see.
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          autoComplete="off" inputMode="text" enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
        <button type="button" className="btn btn-s keypaste" onClick={() => void paste()}>
          {key.paste}
        </button>
      </div>

      {/* The refusal sits under the field it is about, and names which of the
          two it is: the key, or this browser's route to Google. */}
      {refused ? <p className="keyno">{key[refused]}</p> : null}

      <div className="keyact">
        <button type="button" className="btn btn-p" disabled={!typed.trim() || checking}
          onClick={() => void save()}>
          {checking ? key.checking : key.save}
        </button>
      </div>
      <p className="hint">{key.stored}</p>
    </>
  );
}
