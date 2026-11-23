// Undo and redo, over whatever a face says its state is.
//
// Every face already answers `state()` and takes `setState()` - the round
// uses them to put settings on and read them off - so undo is a list of
// those snapshots and nothing in any face had to change for it. The shell
// records one when a change has settled rather than on every step of a drag,
// which is what a person means by "one change".
//
// Pure: no DOM, no faces. Snapshots are copied in and copied out, so nobody
// holding one can move the history by mutating it.

const copy = (value) => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** How many steps back undo goes. Past this the oldest falls off. */
export const HISTORY_LIMIT = 50;

export function makeHistory(limit = HISTORY_LIMIT) {
  let past = [];
  let future = [];
  let present = null;

  return {
    /** Start again from `state`, with nothing to undo or redo. */
    reset(state) {
      past = [];
      future = [];
      present = state === undefined ? null : copy(state);
    },

    /**
     * Note that the state is now `state`. A state that is the same as the
     * last one is not a step - pressing a button that changes nothing should
     * not need undoing - and a new step clears anything that could be redone.
     */
    record(state) {
      if (present !== null && same(state, present)) return false;
      if (present !== null) {
        past.push(present);
        if (past.length > limit) past.shift();
      }
      present = copy(state);
      future = [];
      return true;
    },

    /** One step back: the state to put on, or null when there is none. */
    undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      return copy(present);
    },

    /** One step forward again. */
    redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      return copy(present);
    },

    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
