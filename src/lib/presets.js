// Presets somebody saved, per tool, in this browser.
//
// The built-in ones are the tools' own (src/tools/presets.js); these are
// yours. Kept beside the progress in localStorage, which is the only memory
// this app has, and named the way somebody names a preset - a second save
// under a name already taken replaces it, which is how every plugin host does
// it and saves a "delete, then save" for the common case of refining one.

const PRESET_KEY = 'headroom.presets.v1';

/** What is being listened to rather than what is set: kept across a recall. */
export const MONITORING = ['listen', 'hear'];

function readPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writePresets(all) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; /* private window, or full: a preset is a nicety */
  }
}

/** Your presets for a tool, oldest first. */
export function userPresets(tool) {
  const list = readPresets()[tool];
  return Array.isArray(list)
    ? list.filter((entry) => typeof entry?.name === 'string' && entry.state !== undefined)
    : [];
}

/** Save `state` under `name` for a tool; an existing name is replaced. */
export function savePreset(tool, name, state) {
  const clean = String(name ?? '').trim().slice(0, 60);
  if (!clean) return false;
  const all = readPresets();
  const list = userPresets(tool);
  const entry = { name: clean, state: JSON.parse(JSON.stringify(state)) };
  // Replaced where it stands, so refining a preset does not move it.
  const at = list.findIndex((one) => one.name === clean);
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  all[tool] = list;
  return writePresets(all);
}

export function deletePreset(tool, name) {
  const all = readPresets();
  all[tool] = userPresets(tool).filter((entry) => entry.name !== name);
  return writePresets(all);
}

/**
 * The state to put on when a preset is recalled: the preset's settings, with
 * whatever is being listened to left as it is. A preset that is a list - the
 * EQ's bands - has no monitoring in it, and goes on as it is.
 */
export function recall(preset, current) {
  const next = JSON.parse(JSON.stringify(preset));
  if (Array.isArray(next) || !current || typeof current !== 'object') return next;
  for (const key of MONITORING) {
    if (key in current) next[key] = current[key];
    else delete next[key];
  }
  return next;
}
