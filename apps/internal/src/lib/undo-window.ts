// How long a reviewer can take back an apply/reject before it actually writes.
// Generous because it cannot be extended once it starts, and someone who has to
// hear the row change and then find the button needs more than a few seconds.
//
// Kept in a file that imports nothing so tests can read the real value without
// pulling in the screen it belongs to.
export const UNDO_WINDOW_MS = 20000
