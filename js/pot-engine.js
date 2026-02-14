// js/pot-engine.js
// Build main/side pots from final committed snapshot only.

function toInt(v){
  const n = Number(v);
  if(!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

export function buildPotsFromCommitted(players){
  const normalized = (Array.isArray(players) ? players : [])
    .map((p) => ({
      player_uid: String(p?.player_uid || ""),
      committed: toInt(p?.committed),
      folded: !!p?.folded
    }))
    .filter((p) => p.player_uid && p.committed > 0);

  if(!normalized.length){
    return { pots: [], total: 0 };
  }

  const levels = [...new Set(normalized.map((p) => p.committed))].sort((a, b) => a - b);
  const rawPots = [];
  const refundsByUid = {};
  let prev = 0;
  let total = 0;
  let totalRefund = 0;

  for(const level of levels){
    const contesting = normalized.filter((p) => p.committed >= level);
    const delta = level - prev;
    const amount = toInt(delta * contesting.length);
    prev = level;
    if(amount <= 0) continue;

    // Uncontested top excess: return to the only contributor, do not form a side pot.
    if(contesting.length === 1){
      const uid = contesting[0].player_uid;
      refundsByUid[uid] = toInt((refundsByUid[uid] || 0) + amount);
      totalRefund += amount;
      continue;
    }

    const eligible = contesting
      .filter((p) => !p.folded)
      .map((p) => p.player_uid);
    if(!eligible.length) continue;

    rawPots.push({ amount, eligible });
    total += amount;
  }

  // Merge adjacent layers that have exactly the same eligible set.
  // This avoids artificial tiny "main pot" chunks from folded blind-only tiers.
  const pots = [];
  for(const p of rawPots){
    const last = pots[pots.length - 1];
    const sameEligible = !!last
      && last.eligible.length === p.eligible.length
      && last.eligible.every((uid, idx) => uid === p.eligible[idx]);
    if(sameEligible){
      last.amount = toInt(last.amount + p.amount);
      continue;
    }
    pots.push({ amount: toInt(p.amount), eligible: [...p.eligible] });
  }

  for(let i=0; i<pots.length; i++){
    pots[i].id = (i === 0) ? "main" : `side${i}`;
  }

  return {
    pots,
    total: toInt(total),
    refundsByUid,
    refunded: toInt(totalRefund)
  };
}

export function runPotEngineSelfTests(){
  const tests = [];

  function expectEqual(actual, expected, name){
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if(a !== e){
      throw new Error(`${name} failed\nexpected: ${e}\nactual:   ${a}`);
    }
    tests.push(name);
  }

  // A) A=100 all-in, B=300 call, C=300 call
  expectEqual(
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
      total: 700
    },
    "case-A"
  );

  // B) A=50, B=120, C=300, D=300
  expectEqual(
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
      total: 770
    },
    "case-B"
  );

  // C) Folded player still contributes amount but is not eligible
  expectEqual(
    buildPotsFromCommitted([
      { player_uid: "A", committed: 100, folded: true },
      { player_uid: "B", committed: 300, folded: false },
      { player_uid: "C", committed: 300, folded: false }
    ]),
    {
      pots: [
        { id: "main", amount: 300, eligible: ["B", "C"] },
        { id: "side1", amount: 400, eligible: ["B", "C"] }
      ],
      total: 700
    },
    "case-C-fold"
  );

  // D) Last caller matches all-in exactly (no double count)
  expectEqual(
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
      total: 480
    },
    "case-D-last-caller"
  );

  // E) Multi all-in tiers
  expectEqual(
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
    },
    "case-E-multi-tier"
  );

  // F) 3-way all-in tiers with top excess refund
  expectEqual(
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
    },
    "case-F-top-excess-refund"
  );

  return { ok: true, count: tests.length, tests };
}
