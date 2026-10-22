// Doc: docs/design-system.md#rules-that-are-not-negotiable

/**
 * Every field's `autoComplete`. Chrome takes "off" to mean no history, and
 * still offers saved names and addresses; a token it doesn't know stops both.
 */
export const NO_AUTOFILL = "bida-no-autofill";
