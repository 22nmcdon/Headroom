import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { userPresets, savePreset, deletePreset, recall } = await import('../src/lib/presets.js');
const { PRESETS } = await import('../src/tools/presets.js');
const { TOOLS } = await import('../src/learn/bench/registry.js');

test.beforeEach(() => store.clear());

test('a saved preset comes back, and a name saved twice is replaced', () => {
  savePreset('compression', 'Mine', { threshold: -20 });
  savePreset('compression', 'Mine', { threshold: -30 });
  savePreset('compression', 'Other', { threshold: -10 });
  assert.deepEqual(userPresets('compression').map((p) => [p.name, p.state.threshold]),
    [['Mine', -30], ['Other', -10]], 'replaced where it stood');
  assert.deepEqual(userPresets('reverb'), [], 'kept per tool');
});

test('a preset can be deleted, and a nameless one is not saved', () => {
  savePreset('eq', 'Bright', []);
  assert.equal(savePreset('eq', '   ', []), false);
  deletePreset('eq', 'Bright');
  assert.deepEqual(userPresets('eq'), []);
});

test('a saved state is a copy, not the object the face is still moving', () => {
  const state = { threshold: -20 };
  savePreset('compression', 'Copy', state);
  state.threshold = 0;
  assert.equal(userPresets('compression')[0].state.threshold, -20);
});

test('recalling keeps what is being listened to', () => {
  const next = recall({ trim: 3, listen: 'mine', drive: 2 }, { trim: 0, listen: 'theirs' });
  assert.deepEqual(next, { trim: 3, listen: 'theirs', drive: 2 });
  assert.deepEqual(recall([{ id: 'p1' }], { anything: 1 }), [{ id: 'p1' }], 'a list goes on as it is');
});

test('a corrupt store reads as nothing', () => {
  store.set('headroom.presets.v1', '{not json');
  assert.deepEqual(userPresets('eq'), []);
});

test('every tool has built-in presets, each a whole state of the right shape', () => {
  for (const id of Object.keys(TOOLS)) {
    const list = PRESETS[id];
    assert.ok(list?.length, `${id} has no presets`);
    const names = list.map((p) => p.name);
    assert.equal(new Set(names).size, names.length, `${id} has two presets with one name`);
    const first = list[0].state;
    for (const preset of list) {
      assert.equal(Array.isArray(preset.state), Array.isArray(first), `${id}/${preset.name}`);
      if (!Array.isArray(first)) {
        assert.deepEqual(Object.keys(preset.state).sort(), Object.keys(first).sort(),
          `${id}/${preset.name} adds or leaves out a setting`);
      }
    }
  }
});
