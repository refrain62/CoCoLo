import assert from 'node:assert/strict';
import test from 'node:test';
import { percentile, summarizePerformance } from './measure-lp.ts';

test('LP計測のp75はnearest-rankで算出する', () => {
  assert.equal(percentile([10, 30, 20, 40], 0.75), 30);
});

test('LP計測はLCPとINPを別々に集計する', () => {
  assert.deepEqual(
    summarizePerformance([
      { iteration: 1, lcpMs: 100, inpMs: 20, interactionCount: 2 },
      { iteration: 2, lcpMs: 200, inpMs: 40, interactionCount: 2 },
      { iteration: 3, lcpMs: 300, inpMs: 60, interactionCount: 2 },
      { iteration: 4, lcpMs: 400, inpMs: 80, interactionCount: 2 },
    ]),
    { lcpP75Ms: 300, inpP75Ms: 60 },
  );
});
