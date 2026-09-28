"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Body, Failure, Screen, Scroll, TopBar } from "./chrome";
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
export function CreateAs({ title, names, picked: first, onAdd, onBack, create, failedText }: {
  title: string;
  /** The names the group will be written with. */
  names: readonly string[];
  /** Preselected, for a list of one read out of a file. */
  picked?: string;
  /** Files a name typed here into that list. */
  onAdd: (name: string) => void;
  onBack: () => void;
  /** Writes the group with `me` as its actor, and says its id. */
  create: (me: string) => Promise<string>;
  failedText: (why: string) => string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(first);
  const [failed, setFailed] = useState<string>();

  async function save(me: string) {
    setFailed(undefined);
    try {
      router.replace(route.group(await create(me)));
    } catch (err) {
      setFailed(errorText(err));
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title={title} back={{ ask: () => { onBack(); return false; } }} />
        <Scroll>
          <h2 className="question">{copy.claim.title}</h2>
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
            onContinue={save} />
          {failed ? <div className="pad"><Failure>{failedText(failed)}</Failure></div> : null}
        </Scroll>
      </Body>
    </Screen>
  );
}
