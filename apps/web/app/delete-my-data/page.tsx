"use client";

import { useState } from "react";
import { Body, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { copy } from "@/lib/copy";
import { deleteGroupEverywhere, previewGroup, type GroupPreview, type PreviewProblem }
  from "@/lib/db/erase";
import { stamp } from "@/lib/format";
import { readPastedLink, route, type JoinLink } from "@/lib/group-link";
import { readClipboardText } from "@/lib/paste";

/**
 * `/delete-my-data` — the hosted service's way to ask for a group to be
 * deleted, and the only screen that destroys anything
 * (docs/import-export.md#deleting-a-group).
 *
 * **Not in the app's navigation.** Reached from `/about`'s privacy section,
 * with a typeable address; nothing in a group leads here.
 *
 * **It asks for the invite link, not a group.** The link is the whole of
 * authority (ADR-0003), so it works from a phone that was never in the group;
 * the link then opens the group so the button is pressed over the real thing,
 * named, counted and dated.
 *
 * **Three deliberate frictions** — finding the link, typing the name, a final
 * dialog — because the act is irreversible, unbacked, and taken by one person
 * for everybody.
 */
export default function DeleteMyDataPage() {
  const c = copy.deleteData;
  const [typed, setTyped] = useState("");
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState<PreviewProblem | "bad" | { host: string }>();
  const [found, setFound] = useState<{ link: JoinLink; preview: GroupPreview }>();
  const [name, setName] = useState("");
  const [sure, setSure] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deleted, setDeleted] = useState<string>();

  async function paste() {
    // `undefined` is a refused read: the person dismissing iOS's paste prompt,
    // which is a no and not an error (components/paste-link.tsx).
    const text = await readClipboardText();
    if (text === undefined) return;
    setTyped(text.trim());
    setProblem(undefined);
  }

  async function look() {
    if (looking) return;
    setProblem(undefined);
    setFound(undefined);
    const pasted = readPastedLink(typed.trim(), window.location.origin);
    // A link for another deployment is the one refusal that is not this
    // person's mistake: their group is real, it is simply somewhere else, and
    // deleting it has to be asked of the server holding it.
    if (pasted.kind === "elsewhere") return setProblem({ host: pasted.host });
    if (pasted.kind !== "join") return setProblem("bad");
    setLooking(true);
    const answer = await previewGroup(pasted.link);
    setLooking(false);
    if (!answer.ok) return setProblem(answer.problem);
    setName("");
    setFound({ link: pasted.link, preview: answer.preview });
  }

  async function destroy() {
    if (!found) return;
    setFailed(false);
    try {
      await deleteGroupEverywhere(found.link);
    } catch {
      setSure(false);
      return setFailed(true);
    }
    setSure(false);
    setDeleted(found.preview.name);
    setFound(undefined);
    setTyped("");
  }

  if (deleted) {
    return (
      <Screen><Body>
        <TopBar title={c.title} back={route.about()} />
        <Scroll>
          <div className="pad about">
            <section className="aboutsect">
              <h4>{c.done.title}</h4>
              <p>{c.done.body(deleted)}</p>
              <p>{c.done.rest}</p>
              <div className="aboutlinks">
                <a className="aboutlink" href={route.groups()}>
                  <Icon name="back" size={14} />{c.done.back}
                </a>
              </div>
            </section>
          </div>
        </Scroll>
      </Body></Screen>
    );
  }

  return (
    <Screen><Body>
      <TopBar title={c.title} back={route.about()} />
      <Scroll>
        <div className="pad about">
          {/* The warnings lead, above the field, and stay up while the link is
              being found: they are the screen, and the field is what it ends
              with. */}
          <section className="aboutsect">
            <p><strong>{c.lede}</strong></p>
            <ul className="warnlist">
              {c.warnings.map((line) => (
                <li key={line}><Icon name="info" size={14} />{line}</li>
              ))}
            </ul>
            <p>{c.backup}</p>
          </section>

          {found ? (
            <Found found={found} name={name} setName={setName}
              onAsk={() => setSure(true)} onOther={() => { setFound(undefined); setTyped(""); }} />
          ) : (
            <section className="aboutsect">
              <h4>{c.ask.title}</h4>
              <p>{c.ask.body}</p>
              <form className="row addrow editing" onSubmit={(e) => { e.preventDefault(); void look(); }}>
                <input className="addname" value={typed} aria-label={c.ask.title}
                  placeholder={c.ask.placeholder}
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  autoComplete="off" enterKeyHint="go"
                  onChange={(e) => { setTyped(e.target.value); setProblem(undefined); }} />
                <button type="button" className="iconbtn" aria-label={c.ask.paste}
                  onClick={() => void paste()}>
                  <Icon name="link" size={15} />
                </button>
              </form>
              <div className="drow">
                <button className="btn btn-s" disabled={!typed.trim() || looking}
                  onClick={() => void look()}>
                  {looking ? <span className="spinner" /> : null}{c.ask.act}
                </button>
              </div>
              {problem ? (
                <p className="failure">
                  {typeof problem === "object" ? c.problems.elsewhere(problem.host)
                    : c.problems[problem]}
                </p>
              ) : null}
              {failed ? <p className="failure">{c.failed}</p> : null}
            </section>
          )}
        </div>
      </Scroll>

      {sure && found ? (
        <ConfirmDialog title={c.sure.title(found.preview.name)} confirm={c.sure.act} danger
          onConfirm={() => destroy()} onClose={() => setSure(false)}>
          <p>{c.sure.body}</p>
        </ConfirmDialog>
      ) : null}
    </Body></Screen>
  );
}

/**
 * The group as the server holds it: the name to type, counts of what is in
 * it, and when it started — enough to recognise it and feel its size.
 */
function Found({ found, name, setName, onAsk, onOther }: {
  found: { link: JoinLink; preview: GroupPreview };
  name: string;
  setName: (value: string) => void;
  onAsk: () => void;
  onOther: () => void;
}) {
  const c = copy.deleteData.found;
  const { preview } = found;
  // Trimmed and case-insensitive: this is a confirmation that the right group
  // is on screen, not a spelling test.
  const matches = name.trim().toLocaleLowerCase() === preview.name.trim().toLocaleLowerCase();
  return (
    <section className="aboutsect">
      <h4>{c.title}</h4>
      {/* The name first, as the line somebody recognises and is about to type.
          The figures are labelled: no working things out at this moment. */}
      <p><strong>{preview.name}</strong></p>
      <div className="card">
        {/* Counted, not listed: what this screen is for is recognising the
            group and feeling its size, and a flatshare of twelve wrapped the
            row into four lines of names. */}
        <div className="kv"><span className="k">{c.rows.people}</span>
          <span className="v">{preview.members.length}</span></div>
        <div className="kv"><span className="k">{c.rows.entries}</span>
          <span className="v">{preview.entries}</span></div>
        <div className="kv"><span className="k">{c.rows.edits}</span>
          <span className="v">{preview.edits}</span></div>
        {preview.createdAt ? (
          <div className="kv"><span className="k">{c.rows.started}</span>
            <span className="v">{stamp(preview.createdAt)}</span></div>
        ) : null}
      </div>

      <p>{c.confirm(preview.name)}</p>
      <form className="row addrow editing" onSubmit={(e) => { e.preventDefault(); if (matches) onAsk(); }}>
        <input className="addname" value={name} aria-label={c.placeholder}
          placeholder={c.placeholder} autoCapitalize="none" autoCorrect="off"
          spellCheck={false} autoComplete="off" enterKeyHint="done"
          onChange={(e) => setName(e.target.value)} />
      </form>
      {name.trim() && !matches ? <p className="failure">{c.mismatch}</p> : null}

      <div className="drow">
        <button className="btn btn-s" onClick={onOther}>{c.other}</button>
        <button className="btn btn-d" disabled={!matches} onClick={onAsk}>{c.act}</button>
      </div>
    </section>
  );
}
