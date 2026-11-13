import test from 'node:test';
import assert from 'node:assert/strict';
import {freeformSpinePoint} from '../src/engine/freeform-fish.js';
import {PondSimulation} from '../src/engine/simulation.js';

test('wide and slender freehand silhouettes keep their rest proportions and bend toward the tail', () => {
  const fish = {length:100, width:.12, phase:0, bodyBend:0, swimAmplitude:0};
  for (const [width, height] of [[400, 28], [30, 250], [200, 200]]) {
    const fraction = width / Math.hypot(width, height);
    fish.swimAmplitude = 0;
    for (const u of [0, .25, .5, .75, 1]) {
      const p = freeformSpinePoint(fish, u, fraction);
      assert.ok(Math.abs(p.x - (u - .5) * 100 * fraction) < .001);
      assert.ok(Math.abs(p.y) < .001);
    }
    fish.swimAmplitude = .09;
    let tail = 0, shoulder = 0;
    for (let phase = 0; phase < Math.PI * 2; phase += .12) {
      fish.phase = phase;
      tail = Math.max(tail, Math.abs(freeformSpinePoint(fish, 0, fraction).y));
      shoulder = Math.max(shoulder, Math.abs(freeformSpinePoint(fish, .8, fraction).y));
      assert.ok(Math.abs(freeformSpinePoint(fish, 1, fraction).y) < .001);
    }
    assert.ok(tail > 5 * fraction && tail > shoulder * 8);
  }
});

test('food reaches an off-centre painted mouth after the fish turns', () => {
  const sim = new PondSimulation(1250, 780, {fishCount:0});
  sim.setCustomFish([{id:'crescent', appearance:'freeform-v1'}]);
  const fish = sim.fish[0];
  Object.assign(fish, {x:630, y:440, heading:Math.PI / 2, length:100, drawnMouth:{x:.22,y:.32}});
  sim.food.push({x:598, y:462, age:0, life:15, phase:0});
  sim.update(.001);
  assert.equal(sim.food.length, 0);
});
