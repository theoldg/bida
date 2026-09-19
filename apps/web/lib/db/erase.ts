import { foldOps, type GroupState, type Op } from "@bida/core";
import type { JoinLink } from "../group-link";
import { eraseGroupLocally } from "./commands/groups";
import { deleteGroupOnServer, pullWholeGroup, SyncHttpError } from "./sync";

/**
 * Deleting a group for good: what `/delete-my-data` reads, and what it then
 * destroys. The only code in the app that removes anything rather than
 * appending an op saying it was removed (ADR-0002), which is the point of it —
 * "delete my data" cannot be answered by writing one more row.
 *
 * Two halves, and the screen does both: the server's copy
 * (`deleteGroupOnServer`, which takes every op with it and leaves a tombstone
 * so no phone can push the group back) and this phone's
 * (`eraseGroupLocally`). Any *other* phone still holding the link keeps what
 * is in its own IndexedDB until somebody deletes it there, and stops syncing
 * the moment it next tries. The screen says so; nothing here can reach it.
 */

/**
 * What the server holds for a link, opened on this phone so a person can check
 * they are deleting the group they meant.
 *
 * Deleting on an id alone would be a promise nobody could verify, and group ids
 * are unreadable by design. So the ops are pulled and folded — the same fold
 * every screen uses — and the screen shows the group's name, when it started,
 * and how much is in it.
 */
export interface GroupPreview {
  name: string;
  members: string[];
  entries: number;
  edits: number;
  /** The group's own creation stamp, or undefined if the ops never said. */
  createdAt?: number;
}

/** Why a link cannot be previewed. Each one is a different sentence on screen. */
export type PreviewProblem = "missing" | "deleted" | "refused" | "offline" | "unreadable";

type PreviewResult =
  | { ok: true; preview: GroupPreview }
  | { ok: false; problem: PreviewProblem };

export async function previewGroup(link: JoinLink): Promise<PreviewResult> {
  let ops: Op[];
  try {
    ops = await pullWholeGroup(link.groupId, link.secret);
  } catch (err) {
    if (err instanceof SyncHttpError) {
      if (err.status === 404) return { ok: false, problem: "missing" };
      if (err.status === 410) return { ok: false, problem: "deleted" };
      if (err.status === 403) return { ok: false, problem: "refused" };
      return { ok: false, problem: "offline" };
    }
    // `openOp` throwing here is a link whose secret opens nothing: the token
    // derived beside it was accepted, so this is a group sealed under some
    // other key, not a wrong link. Either way there is nothing to show.
    return { ok: false, problem: err instanceof TypeError ? "offline" : "unreadable" };
  }

  // The whole log of one group, folded the way every screen folds it. An
  // entity the group deleted is not in what is being deleted now, so the
  // counts are of what is still there to lose.
  const state: GroupState = foldOps(ops);
  const group = state.group;
  if (!group) return { ok: false, problem: "missing" };
  const living = <T extends { deletedAt?: number | null }>(rows: Record<string, T>): T[] =>
    Object.values(rows).filter((row) => !row.deletedAt);

  return {
    ok: true,
    preview: {
      name: group.name,
      members: living(state.members).map((m) => m.name),
      entries: living(state.expenses).length + living(state.settlements).length,
      edits: ops.length,
      createdAt: group.createdAt,
    },
  };
}

/** Both halves, in the order that cannot leave the app holding a dead group. */
export async function deleteGroupEverywhere(link: JoinLink): Promise<void> {
  await deleteGroupOnServer(link.groupId, link.secret);
  await eraseGroupLocally(link.groupId);
}
