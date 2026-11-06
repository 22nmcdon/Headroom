// Text, made safe to put inside markup.
//
// The grid is drawn as template strings into `innerHTML`, and some of what
// goes into them is not this app's: a track or scene name, a chord line, a
// take id - any of which can arrive from a sketch file somebody was sent -
// and an input's label, which is whatever the browser says. Every one of
// those goes through this, in text and in attributes alike.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Anything, as text that markup will show rather than run. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
