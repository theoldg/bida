"use client";

import { useState } from "react";
import { Body, Screen, Scroll, TopBar } from "../../components/chrome";
import { Icon } from "../../components/icons";
import { usePasteLink } from "../../components/paste-link";
import { copy } from "../../lib/copy";
import { route } from "../../lib/group-link";

/**
 * Paste link, with nothing on the clipboard. It used to land on "Bad link",
 * which blamed a link nobody had given. Set like that screen, badge and all,
 * but with the button to paste again: the fix is to go and copy the invite,
 * and coming back to the app lands right here.
 *
 * Pasting nothing a second time says so under the button, since the screen
 * would otherwise not move at all.
 */
export default function PastePage() {
  const { paste: page } = copy;
  const [again, setAgain] = useState(false);
  const { paste, dialog } = usePasteLink(() => setAgain(true));

  return (
    <Screen><Body>
      <TopBar title={page.title} back={route.groups()} />
      <Scroll>
        <div className="pad keyless">
          <div className="keyless-badge"><Icon name="link" size={20} /></div>
          <h2>{page.empty}</h2>
          <p>{page.body}</p>
          <button type="button" className="btn btn-p pasteagain"
            onClick={() => { setAgain(false); void paste(); }}>
            {copy.groups.pasteLink}
          </button>
          {again ? <p role="status">{page.still}</p> : null}
        </div>
      </Scroll>
      {dialog}
    </Body></Screen>
  );
}
