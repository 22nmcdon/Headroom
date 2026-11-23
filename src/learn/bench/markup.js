// Text that came from somewhere, made safe to put in markup.
//
// Shared by the pages drawn as strings - Home and Progress - because the
// bundle puts every module in one scope, and two copies of the same helper
// are two declarations of one name.

export const esc = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
