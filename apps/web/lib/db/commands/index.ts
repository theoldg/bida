// Doc: docs/frontend.md#state
/**
 * Every write in the app, each appending ops rather than editing rows:
 *
 * - `append.ts` — the one write: the op, the clock and the transaction they share
 * - `patch.ts` — what a patch may carry, which is the merge rule (ADR-0002)
 * - `groups.ts` — a group, who this phone is in it, and who else is
 * - `rates.ts` — an entry's own rate, and what it makes the entry worth (ADR-0005)
 * - `entries.ts` — expenses, incomes and transfers
 * - `import.ts` — a Splitwise CSV as a new group, in one batch
 * - `demo.ts` — the one group that is never given a key, and so never syncs
 */

export {
  createGroup, saveGroupKey, heldInvites, forgetGroup, claimIdentity, publishExistingClaims,
  addMember, renameMember, removeMember, healGroup, markEditsSeen, type NewGroupInput,
} from "./groups";
export { importGroup, type ImportGroupInput } from "./import";
export { openDemo, clearDemo, wantsDemo } from "./demo";
export {
  addExpense, editExpense, deleteExpense, type ExpenseInput,
  recordSettlement, editSettlement, deleteSettlement, type SettlementInput,
  restoreEntry,
} from "./entries";
