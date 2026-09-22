import { foldOps, type GroupState, type Op } from "@bida/core";
import type { JoinLink } from "../group-link";
import { eraseGroupLocally } from "./commands/groups";
import { deleteGroupOnServer, pullWholeGroup, SyncHttpError } from "./sync";

/**
 * Deleting a group for good: what `/delete-my-data` reads, then destroys. The
 * only code that removes rather than appends a removal op (ADR-0002) — "delete
 * my data" can't be answered with one more row.
 *
 * Two halves, both run by the screen: the server's copy (`deleteGroupOnServer`,
 * which leaves a tombstone so no phone can push it back) and this phone's
 * (`eraseGroupLocally`). Other phones keep their IndexedDB copy and stop
 * syncing on their next try; nothing here can reach them.
 */

/**
 * What the server holds for a link, so a person can check they are deleting
 * the group they meant — ids are unreadable by design. The ops are pulled and
 * folded as every screen folds them, to show name, start and size.
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
    // `openOp` throwing here: the derived token was accepted, so the group is
    // sealed under some other key. Either way there is nothing to show.
    return { ok: false, problem: err instanceof TypeError ? "offline" : "unreadable" };
  }

  // Folded as every screen folds, so deleted entities aren't counted — the
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
