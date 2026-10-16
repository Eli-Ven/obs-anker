import test from "node:test";
import assert from "node:assert/strict";
import {
  rankVariants,
  recordUse,
  resetBoost,
  type CharacterUsage,
} from "../src/variant-ranking";

const now = 1_800_000_000_000;
const week = 7 * 24 * 60 * 60 * 1000;
const rows = ["A", "B", "C", "D", "E", "F", "G", "H"];

test("successful uses accumulate count and decaying heat without mutating snapshots", () => {
  const first = recordUse(undefined, now);
  const next = recordUse(first, now + week);
  assert.deepEqual(first, { count: 1, heat: 1, updatedAt: now });
  assert.deepEqual(next, { count: 2, heat: 1.5, updatedAt: now + week });
});

test("unused variants retain manual order and recent use promotes at most three positions", () => {
  const usage: CharacterUsage = {};
  assert.deepEqual(
    rankVariants(rows, (row) => usage[row], now),
    rows,
  );
  usage.F = recordUse(undefined, now);
  assert.deepEqual(
    rankVariants(rows, (row) => usage[row], now),
    ["A", "B", "C", "D", "F", "E", "G", "H"],
  );
  usage.F = { count: 1000, heat: 1000, updatedAt: now };
  assert.deepEqual(
    rankVariants(rows, (row) => usage[row], now),
    ["A", "B", "F", "C", "D", "E", "G", "H"],
  );
  assert.deepEqual(rows, ["A", "B", "C", "D", "E", "F", "G", "H"]);
});

test("mixed popularity never promotes any item beyond the manual-order bound", () => {
  for (let sample = 0; sample < 100; sample++) {
    const usage: CharacterUsage = Object.fromEntries(
      rows.map((row, i) => [
        row,
        {
          count: 100,
          heat: ((sample + 1) * (i + 3) * 17) % 20,
          updatedAt: now,
        },
      ]),
    );
    const result = rankVariants(rows, (row) => usage[row], now);
    result.forEach((row, i) => assert.ok(rows.indexOf(row) - i <= 3));
  }
});

test("old heat fades while lifetime counts and equal-heat manual ties remain", () => {
  const usage: CharacterUsage = Object.fromEntries(
    rows.map((row) => [
      row,
      {
        count: 50,
        heat: 7,
        updatedAt: now,
      },
    ]),
  );
  assert.deepEqual(
    rankVariants(rows, (row) => usage[row], now),
    rows,
  );
  delete usage.A;
  assert.notDeepEqual(
    rankVariants(rows, (row) => usage[row], now),
    rows,
  );
  assert.deepEqual(
    rankVariants(rows, (row) => usage[row], now + 8 * week),
    rows,
  );
  assert.equal(usage.F.count, 50);
});

test("manual reorder clears only that group's boost and preserves counts and other groups", () => {
  const usage: CharacterUsage = {
    F: { count: 9, heat: 7, updatedAt: now },
    H: { count: 2, heat: 2, updatedAt: now },
  };
  const snapshot = { ...usage };
  resetBoost(usage, ["F", "A"]);
  assert.equal(usage.F.count, 9);
  assert.equal(usage.F.heat, 0);
  assert.equal(usage.H.heat, 2);
  assert.equal(usage.A, undefined);
  assert.equal(snapshot.F.heat, 7);
  usage.F = recordUse(usage.F, now + 1);
  assert.equal(usage.F.count, 10);
  assert.equal(usage.F.heat, 1);
});
