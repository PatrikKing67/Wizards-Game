import test from 'node:test';
import assert from 'node:assert/strict';
import { latestState } from '../public/state.js';

test('a delayed action response cannot undo a newer live turn or blind-card state', () => {
  const event = { code: 'ABC234', revision: 10, turn: 2, hand: [], canPlayBlind: false };
  const delayedResponse = { code: 'ABC234', revision: 9, turn: 1, hand: [{ hidden: true }], canPlayBlind: true };
  assert.equal(latestState(event, delayedResponse), event);
  assert.equal(latestState(delayedResponse, event), event);
  assert.equal(latestState(null, event), event);
  const anotherRoom = { code: 'DEF567', revision: 1 };
  assert.equal(latestState(event, anotherRoom), anotherRoom);
});
