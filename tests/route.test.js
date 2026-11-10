import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRoute, routeFor, sameRoute } from '../src/route.js';
import { TOOLS } from '../src/learn/bench/registry.js';

const TIERS = { easy: {}, medium: {}, hard: {} };
const FAKE = { eq: { tiers: TIERS }, reverb: { tiers: TIERS } };

test('a full tool route reads back into the fields the shell keeps', () => {
  assert.deepEqual(parseRoute('#/tools/reverb/drill/medium', FAKE),
    { view: 'tools', mode: 'reverb', kind: 'drill', tier: 'medium' });
});

test('the other pages are one word', () => {
  for (const view of ['home', 'mix', 'sketch', 'analysis']) {
    assert.deepEqual(parseRoute(`#/${view}`, FAKE), { view });
  }
});

test('a route is read as far as it makes sense', () => {
  assert.deepEqual(parseRoute('#/tools', FAKE), { view: 'tools' });
  assert.deepEqual(parseRoute('#/tools/eq', FAKE), { view: 'tools', mode: 'eq' });
  assert.deepEqual(parseRoute('#/tools/eq/sideways/hard', FAKE), { view: 'tools', mode: 'eq' },
    'an unknown kind stops the reading there');
  assert.deepEqual(parseRoute('#/tools/eq/work/impossible', FAKE),
    { view: 'tools', mode: 'eq', kind: 'work' }, 'an unknown tier is left out');
  assert.deepEqual(parseRoute('#tools/eq/work/easy/', FAKE),
    { view: 'tools', mode: 'eq', kind: 'work', tier: 'easy' }, 'slashes are forgiven');
});

test('something that names nothing is not a route', () => {
  for (const hash of ['', '#', '#/', '#/progress', '#/learn', '#/tools/theremin/work/easy',
    '#/tools/constructor', '#/tools/__proto__', null, undefined]) {
    assert.equal(parseRoute(hash, FAKE), null, `${hash} was read as a route`);
  }
});

test('where the shell is, written out and read back, is where it was', () => {
  for (const id of Object.keys(TOOLS)) {
    for (const tier of Object.keys(TOOLS[id].tiers)) {
      for (const kind of ['work', 'drill']) {
        const at = { view: 'tools', mode: id, kind, tier };
        assert.deepEqual(parseRoute(routeFor(at), TOOLS), at, `${id}/${kind}/${tier}`);
      }
    }
  }
  assert.equal(routeFor({ view: 'mix', mode: 'eq', kind: 'work', tier: 'easy' }), '#/mix',
    'a page that is not a tool does not carry the tool along');
});

test('a partial route is the same place when what it names agrees', () => {
  const at = { view: 'tools', mode: 'eq', kind: 'work', tier: 'easy' };
  assert.ok(sameRoute({ view: 'tools', mode: 'eq' }, at));
  assert.ok(!sameRoute({ view: 'tools', mode: 'reverb' }, at));
  assert.ok(!sameRoute({ view: 'mix' }, at));
});
