"use client";
// Doc: docs/frontend.md#names

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Body, Failure, Screen, TopBar } from "./chrome";
import { WhoPicker } from "./who-picker";
import { copy } from "../lib/copy";
import { errorText } from "../lib/format";
import { route } from "../lib/group-link";

/**
 * The last step of making a group, `/new`'s and `/import`'s alike: the join
 * screen's question, add row included, then the write. The answer is the
 * actor on every op that creates the group, so it is asked even of a group of
 * one — the step is learnable because it is never skipped.
 *
 * **A failure stays on this step**, under the button that retries it.
 */
export function CreateAs({ title, names, picked: first, onAdd, onBack, create, failedText, writing }: {
  title: string;
  /** The names the group will be written with. */
  names: readonly string[];
  /** Preselected, for a list of one read out of a file. */
  picked?: string;
  /** Files a name typed here into that list. */
  onAdd: (name: string) => void;
  onBack: () => void;
  /**
   * Writes the group with `me` as its actor, and says its id. A write long
   * enough to watch says how far it has got, which turns the button into a bar.
   */
  create: (me: string, progress: (done: number, total: number) => void) => Promise<string>;
  failedText: (why: string) => string;
  /** What the bar says, at a percentage. */
  writing?: (percent: number) => string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(first);
  const [failed, setFailed] = useState<string>();
  const [percent, setPercent] = useState<number>();

  async function save(me: string) {
    setFailed(undefined);
    // A render per whole percent, not per entry: an import reports thousands.
    let shown = -1;
    const progress = (done: number, total: number) => {
      const now = total > 0 ? Math.floor((100 * done) / total) : 0;
      if (now !== shown) setPercent(shown = now);
    };
    try {
      router.replace(route.group(await create(me, progress)));
    } catch (err) {
      setPercent(undefined);
      setFailed(errorText(err));
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title={title} back={{ ask: () => { onBack(); return false; } }} />
        <WhoPicker
          people={names.map((who) => ({ id: who, name: who }))}
          picked={picked}
          addPlaceholder={copy.claim.addPlaceholder}
          onPick={setPicked}
          // A name already on the list cannot be filed here either — it is a
          // row a tap above, and tapping it says the same thing.
          onAdd={(who) => {
            onAdd(who);
            return { id: who, name: who };
          }}
          onContinue={save}
          progress={percent === undefined || !writing ? undefined : { percent, label: writing(percent) }}
          after={failed ? <div className="pad"><Failure>{failedText(failed)}</Failure></div> : null} />
      </Body>
    </Screen>
  );
}
