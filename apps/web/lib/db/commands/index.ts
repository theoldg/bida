/**
 * Every write in the app goes through this directory, and every function in it
 * appends ops rather than editing rows. Components never touch Dexie directly.
 *
 * If you find yourself wanting to `db().expenses.put(...)` somewhere in a
 * component, what you actually want is a new function in here.
 *
 * - `append.ts` — the one write: the op, the clock and the transaction they share
 * - `patch.ts` — what a patch may carry, which is the merge rule (ADR-0002)
 * - `groups.ts` — a group, who this phone is in it, and who else is
 * - `rates.ts` — the registry, and what it makes an entry worth (ADR-0005)
 * - `entries.ts` — expenses, incomes and transfers
 */

export {
  createGroup, saveGroupKey, forgetGroup, claimIdentity, publishExistingClaims,
  addMember, renameMember, removeMember, healGroup, type NewGroupInput,
} from "./groups";
export { setRate, clearRate } from "./rates";
export {
  addExpense, editExpense, deleteExpense, type ExpenseInput,
  recordSettlement, editSettlement, deleteSettlement, type SettlementInput,
} from "./entries";
