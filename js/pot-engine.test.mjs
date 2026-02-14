import assert from "node:assert/strict";
import { buildPotsFromCommitted } from "./pot-engine.js";

function run(){
  // 1) A: 100 / 300 / 300
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 100, folded: false },
      { player_uid: "B", committed: 300, folded: false },
      { player_uid: "C", committed: 300, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 300, eligible: ["A", "B", "C"] },
        { id: "side1", amount: 400, eligible: ["B", "C"] }
      ],
      total: 700,
      refundsByUid: {},
      refunded: 0
    }
  );

  // 2) B: 50 / 120 / 300 / 300
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 50, folded: false },
      { player_uid: "B", committed: 120, folded: false },
      { player_uid: "C", committed: 300, folded: false },
      { player_uid: "D", committed: 300, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 200, eligible: ["A", "B", "C", "D"] },
        { id: "side1", amount: 210, eligible: ["B", "C", "D"] },
        { id: "side2", amount: 360, eligible: ["C", "D"] }
      ],
      total: 770,
      refundsByUid: {},
      refunded: 0
    }
  );

  // 3) Folded player contributes amount but not eligible
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 100, folded: true },
      { player_uid: "B", committed: 300, folded: false },
      { player_uid: "C", committed: 300, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 700, eligible: ["B", "C"] }
      ],
      total: 700,
      refundsByUid: {},
      refunded: 0
    }
  );

  // 4) Last caller exact-call all-in path (regression guard)
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 80, folded: false },
      { player_uid: "B", committed: 200, folded: false },
      { player_uid: "C", committed: 200, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 240, eligible: ["A", "B", "C"] },
        { id: "side1", amount: 240, eligible: ["B", "C"] }
      ],
      total: 480,
      refundsByUid: {},
      refunded: 0
    }
  );

  // 5) Multiple side tiers
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 25, folded: false },
      { player_uid: "B", committed: 75, folded: false },
      { player_uid: "C", committed: 175, folded: false },
      { player_uid: "D", committed: 400, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 100, eligible: ["A", "B", "C", "D"] },
        { id: "side1", amount: 150, eligible: ["B", "C", "D"] },
        { id: "side2", amount: 200, eligible: ["C", "D"] }
      ],
      total: 450,
      refundsByUid: { D: 225 },
      refunded: 225
    }
  );

  // 6) Three-way all-in with top excess refund
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 100, folded: false },
      { player_uid: "B", committed: 200, folded: false },
      { player_uid: "C", committed: 300, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 300, eligible: ["A", "B", "C"] },
        { id: "side1", amount: 200, eligible: ["B", "C"] }
      ],
      total: 500,
      refundsByUid: { C: 100 },
      refunded: 100
    }
  );

  // 7) Folded blind-only tier should be merged into main, not shown as tiny separate main pot
  assert.deepEqual(
    buildPotsFromCommitted([
      { player_uid: "SB", committed: 25, folded: true },
      { player_uid: "P1", committed: 9500, folded: false },
      { player_uid: "P2", committed: 9500, folded: false },
      { player_uid: "P3", committed: 9500, folded: false },
      { player_uid: "P4", committed: 10000, folded: false },
      { player_uid: "P5", committed: 11000, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 47525, eligible: ["P1", "P2", "P3", "P4", "P5"] },
        { id: "side1", amount: 1000, eligible: ["P4", "P5"] }
      ],
      total: 48525,
      refundsByUid: { P5: 1000 },
      refunded: 1000
    }
  );

  console.log("pot-engine tests passed: 7/7");
}

run();
