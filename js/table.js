// js/table.js
// Table + hand + seats + realtime + QR + UI render
// Receives ctx from app.js: sbClient, Sound, requireDealer, requireTable
import { buildPotsFromCommitted } from "./pot-engine.js";

export function createTableModule(ctx){
  const S = ctx.state;
  const sb = ctx.sbClient;
  const Sound = ctx.Sound;

  // ===== DOM (lazy init) =====
  let tableEl, potLabel, potCenter, actingTitle, streetLabel, blindLabel, toCallLabel, draftLabel;
  let betBtn, foldBtn, allinBtn, backBtn, nextBtn;
  let q25, q100, q500;
  let thumb, track;

  function cacheDom(){
    tableEl = document.getElementById('table');

    potLabel = document.getElementById("potLabel");
    potCenter = document.getElementById("potCenter");
    actingTitle = document.getElementById("actingTitle");
    streetLabel = document.getElementById("streetLabel");
    blindLabel = document.getElementById("blindLabel");
    toCallLabel = document.getElementById("toCallLabel");
    draftLabel = document.getElementById("draftLabel");

    betBtn = document.getElementById("betBtn");
    foldBtn = document.getElementById("foldBtn");
    allinBtn = document.getElementById("allinBtn");
    backBtn = document.getElementById("backBtn");
    nextBtn = document.getElementById("nextBtn"); // will be hidden (deprecated)

    q25 = document.getElementById("q25");
    q100 = document.getElementById("q100");
    q500 = document.getElementById("q500");

    thumb = document.getElementById('slideThumb');
    track = document.getElementById('newHandTrack');
  }

  // ===== Seat geometry =====
  function seatAngleFor(i){
    return (Math.PI*2/S.SEAT_COUNT)*(i - S.TOP_SEAT) - Math.PI/2;
  }
  function isSeatOccupied(seatNum){
    return !!S.seatState?.[seatNum]?.player_uid;
  }
  function findNextOccupiedSeat(fromSeat){
    for(let step=1; step<=S.SEAT_COUNT; step++){
      const s = ((fromSeat - 1 + step) % S.SEAT_COUNT) + 1;
      if(isSeatOccupied(s)) return s;
    }
    return null;
  }
  function getOccupiedSeatsClockwiseFrom(startSeat){
    const out = [];
    for(let step=1; step<=S.SEAT_COUNT; step++){
      const s = ((startSeat - 1 + step) % S.SEAT_COUNT) + 1;
      if(isSeatOccupied(s)) out.push(s);
    }
    return out;
  }

  // ===== Dealer token =====
  function positionDealerToken(){
    const dealerTokenEl = document.getElementById("dealerToken");
    if(!dealerTokenEl || !tableEl) return;

    const rect = tableEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const DEALER_SIZE = 18;
    const ORBIT_GAP = 18;

    const rX = cx - (DEALER_SIZE/2) - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;
    const rY = cy - (DEALER_SIZE/2) - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;

    const a = seatAngleFor(S.dealerPosSeat);
    const x = cx + Math.cos(a) * rX;
    const y = cy + Math.sin(a) * rY;

    dealerTokenEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  // ===== Bet float position =====
  function positionBetFloat(seatNum){
    const bf = S.betFloats[seatNum]?.el;
    if(!bf || !tableEl) return;

    const rect = tableEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const ORBIT_GAP = 42;
    const rX = cx - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;
    const rY = cy - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;

    const a = seatAngleFor(seatNum);
    const x = cx + Math.cos(a) * rX;
    const y = cy + Math.sin(a) * rY;

    bf.style.left = x + "px";
    bf.style.top  = y + "px";
  }

  // ===== Stakes from DB =====
  async function refreshStakesForOccupiedSeats(){
    if(!S.TABLE_UID) return;

    const uids = [];
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const uid = S.seatState?.[i]?.player_uid;
      if(uid) uids.push(uid);
    }

    if(!uids.length){
      renderSeats();
      return;
    }

    const need = uids.filter(uid => S.baseStakeByUid[uid] === undefined);
    if(need.length){
      const { data, error } = await sb
        .from("players")
        .select("player_uid, stake_tour")
        .in("player_uid", need);

      if(error){
        console.error("refreshStakes error:", error);
        return;
      }
      (data || []).forEach(r => {
        S.baseStakeByUid[r.player_uid] = Number(r.stake_tour ?? 0);
      });
    }

    // init stacks if missing
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const uid = S.seatState?.[i]?.player_uid;
      if(!uid) continue;
      if(S.stackByUid[uid] === undefined){
        S.stackByUid[uid] = Number(S.baseStakeByUid[uid] ?? 0);
      }
    }

    renderSeats();
    updateUI();
  }

  // =========================================================
  // HAND ENGINE (UPDATED)
  // - Bet = nháº­p báº±ng nÃºt +..., báº¥m Bet Ä‘á»ƒ commit vÃ  auto qua ngÆ°á»i
  // - Bá» Next (áº©n)
  // - Káº¿t thÃºc vÃ²ng: gom bet-float (contributed) vÃ o pot, reset contributed=0
  // - Chuyá»ƒn street: actingSeat vá» Ä‘Ãºng ngÆ°á»i Ä‘áº§u vÃ²ng (gáº§n dealer token)
  // - Chá»‰ Ä‘Æ°á»£c chá»n winner khi Showdown (sau River)
  // - Tap winner láº§n ná»¯a => bá» chá»n
  // - Slider chá»‰ cháº¡y khi Showdown + Ä‘Ã£ chá»n winner
  // =========================================================

  function resetHandState(){
    S.totalContribBySeat = {};
    for(let i=1;i<=S.SEAT_COUNT;i++){
      // contributed = bet cá»§a street hiá»‡n táº¡i (bet-float)
      // hasActed = Ä‘Ã£ action trong betting round hiá»‡n táº¡i chÆ°a
      S.handState[i] = { inHand: true, contributed: 0, hasActed: false };
      S.totalContribBySeat[i] = 0;
    }
    S.handHistory = [];
    S.handActive = false;
    S.actingSeat = null;
    S.handStreet = "Preflop";
    S.betDraft = 0;
    S.winnerSeat = null;
    S.potBreakdown = [];
    S.potWinners = [];
    S.pendingRefundsBySeat = {};
    S.refundsApplied = false;
    S.autoSettled = false;
    S.bbSeat = null;
    S.bbOptionPending = false;
    S.betTarget = 0;

    // âœ… pot Ä‘Ã£ gom xong (giá»¯ qua street)
    S.handPot = 0;

    if(streetLabel) streetLabel.textContent = S.handStreet;
  }

  // âœ… Pot hiá»ƒn thá»‹ = pot Ä‘Ã£ gom xong (khÃ´ng cá»™ng bet-float Ä‘ang náº±m ngoÃ i pot)
  function getPotTotal(){
    return Number(S.handPot || 0);
  }

  function getWinnerColorForSeat(seatNum){
    const palette = [
      "#22d3ee", "#f59e0b", "#34d399", "#fb7185",
      "#60a5fa", "#f97316", "#a78bfa", "#facc15"
    ];
    const idx = Math.max(0, Number(seatNum || 1) - 1) % palette.length;
    return palette[idx];
  }

  function renderCenterPot(){
    if(!potCenter) return;
    const total = getPotTotal();

    if(S.handStreet === "Showdown"){
      ensureShowdownPots();
      const pots = S.potBreakdown || [];
      if(pots.length){
        const rows = pots.map((pot, i) => {
          const label = (i === 0) ? "Main pot" : `Side pot ${i}`;
          const amount = Number(pot?.amount || 0);
          const winnerSeat = Number(S.potWinners?.[i] || 0);
          const wonClass = winnerSeat > 0 ? " won" : "";
          const style = winnerSeat > 0 ? ` style=\"--winner-color:${getWinnerColorForSeat(winnerSeat)}\"` : "";
          return (
            `<div class="pot-line${wonClass}"${style}>` +
              `<span class="pot-label">${label}</span>` +
              `<span class="pot-amount">$${amount}</span>` +
            `</div>`
          );
        }).join("");
        potCenter.innerHTML = `<div class="pot-center-list">${rows}</div>`;
        return;
      }
    }

    potCenter.innerHTML = `<div class="pot-total">$${total}</div><small>POT</small>`;
  }

  function getSeatStack(seatNum){
    const uid = S.seatState?.[seatNum]?.player_uid;
    if(!uid) return 0;
    return Math.max(0, Number(S.stackByUid[uid] ?? 0));
  }

  function addContribution(seatNum, amount){
    if(!amount || amount <= 0) return;
    if(!S.totalContribBySeat) S.totalContribBySeat = {};
    S.totalContribBySeat[seatNum] = Number(S.totalContribBySeat[seatNum] || 0) + Number(amount);
  }

  function computePotBreakdown(){
    const players = [];
    const uidToSeat = {};
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const total = Number(S.totalContribBySeat?.[i] || 0);
      if(total <= 0) continue;
      const uid = S.seatState?.[i]?.player_uid;
      if(!uid) continue;
      uidToSeat[uid] = i;
      players.push({
        player_uid: uid,
        committed: total,
        folded: S.handState[i]?.inHand === false
      });
    }

    const out = buildPotsFromCommitted(players);
    const pots = (out.pots || []).map((pot) => ({
      id: pot.id,
      amount: Number(pot.amount || 0),
      eligible: Array.isArray(pot.eligible) ? pot.eligible : [],
      eligibleSeats: (pot.eligible || [])
        .map((uid) => Number(uidToSeat[uid] || 0))
        .filter((seat) => seat > 0)
    }));
    const refunds = {};
    const refundsByUid = out.refundsByUid || {};
    Object.keys(refundsByUid).forEach((uid) => {
      const seat = Number(uidToSeat[uid] || 0);
      const amt = Number(refundsByUid[uid] || 0);
      if(seat > 0 && amt > 0) refunds[seat] = amt;
    });

    if(!pots.length && Number(S.handPot || 0) > 0){
      const eligibleSeats = getActiveInHandSeats();
      if(eligibleSeats.length){
        pots.push({
          id: "main",
          amount: Number(S.handPot || 0),
          eligible: eligibleSeats
            .map((seat) => S.seatState?.[seat]?.player_uid)
            .filter(Boolean),
          eligibleSeats
        });
      }
    }

    return { pots, refunds };
  }

  function applyPendingRefunds(){
    if(S.refundsApplied) return;
    const refunds = S.pendingRefundsBySeat || {};
    let totalRefund = 0;

    for(let i=1;i<=S.SEAT_COUNT;i++){
      const amt = Number(refunds[i] || 0);
      if(amt <= 0) continue;
      const uid = S.seatState?.[i]?.player_uid;
      if(!uid) continue;
      S.stackByUid[uid] = Number(S.stackByUid[uid] ?? 0) + amt;
      totalRefund += amt;
    }

    if(totalRefund > 0){
      S.handPot = Math.max(0, Number(S.handPot || 0) - totalRefund);
    }
    S.refundsApplied = true;
  }

  function ensureShowdownPots(){
    if(S.handStreet !== "Showdown") return;
    if(!Array.isArray(S.potBreakdown) || !S.potBreakdown.length){
      const out = computePotBreakdown();
      S.potBreakdown = out.pots || [];
      S.pendingRefundsBySeat = out.refunds || {};
    }
    applyPendingRefunds();
    if(!Array.isArray(S.potWinners)) S.potWinners = [];
    if(S.potWinners.length > S.potBreakdown.length){
      S.potWinners = S.potWinners.slice(0, S.potBreakdown.length);
    }
    S.winnerSeat = S.potWinners[0] ?? null;
  }

  function isAllInRunout(){
    const alive = getActiveInHandSeats();
    if(alive.length <= 1) return false;
    const seatsWithChips = alive.filter(seat => getSeatStack(seat) > 0).length;
    // Run out directly only when nobody can still act (all remaining players are all-in).
    return seatsWithChips === 0;
  }

  function moveToShowdown(){
    collectStreetBetsIntoPot();
    S.handStreet = "Showdown";
    S.actingSeat = null;
    S.betDraft = 0;
    S.autoSettled = false;
    ensureShowdownPots();
  }

  function settleSingleSurvivorNow(){
    collectStreetBetsIntoPot();
    const winnerSeat = getActiveInHandSeats()[0] ?? null;
    const pot = Number(S.handPot || 0);

    if(winnerSeat && pot > 0){
      const uidW = S.seatState?.[winnerSeat]?.player_uid;
      if(uidW){
        S.stackByUid[uidW] = Number(S.stackByUid[uidW] ?? 0) + pot;
      }
    }

    S.handPot = 0;
    S.handStreet = "Showdown";
    S.actingSeat = null;
    S.betDraft = 0;
    S.potBreakdown = winnerSeat ? [{ amount: pot, eligibleSeats: [winnerSeat] }] : [];
    S.potWinners = winnerSeat ? [winnerSeat] : [];
    S.winnerSeat = winnerSeat;
    S.pendingRefundsBySeat = {};
    S.refundsApplied = true;
    S.autoSettled = true;
    S.bbOptionPending = false;
  }

  function isShowdownReadyForPayout(){
    if(S.handStreet !== "Showdown") return false;
    ensureShowdownPots();
    return S.potBreakdown.length > 0 && S.potWinners.length === S.potBreakdown.length;
  }

  function getActiveInHandSeats(){
    const out = [];
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(!isSeatOccupied(i)) continue;
      if(S.handState[i]?.inHand === false) continue;
      out.push(i);
    }
    return out;
  }

  function isActionableSeat(seatNum){
    if(!isSeatOccupied(seatNum)) return false;
    if(S.handState[seatNum]?.inHand === false) return false;
    return getSeatStack(seatNum) > 0;
  }

  function getActionableInHandSeats(){
    const out = [];
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(isActionableSeat(i)) out.push(i);
    }
    return out;
  }

  function getSBSeat(){
    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    return occ[0] ?? null;
  }
  function getBBSeat(){
    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    return occ[1] ?? null;
  }
  function computeUTGSeat(){
    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    if(occ.length < 3) return occ[0] ?? null;
    return occ[2];
  }

  function findNextActingSeat(fromSeat){
    if(!S.handActive) return null;
    for(let step=1; step<=S.SEAT_COUNT; step++){
      const s = ((fromSeat - 1 + step) % S.SEAT_COUNT) + 1;
      if(!isActionableSeat(s)) continue;
      return s;
    }
    return null;
  }

  // âœ… NgÆ°á»i Ä‘áº§u vÃ²ng theo street
  function firstToActForStreet(street){
    if(street === "Preflop"){
      const utg = computeUTGSeat();
      if(utg && isActionableSeat(utg)) return utg;
      return findNextActingSeat(utg || S.dealerPosSeat);
    }
    // Flop/Turn/River: ngÆ°á»i gáº§n dealer token nháº¥t (SB) cÃ²n inHand
    const sbSeat = getSBSeat();
    if(!sbSeat) return firstToActForStreet("Preflop");
    if(isActionableSeat(sbSeat)) return sbSeat;
    return findNextActingSeat(sbSeat) || firstToActForStreet("Preflop");
  }

  function applyBlindToSeat(seatNum, amount){
    const uid = S.seatState?.[seatNum]?.player_uid;
    if(!uid) return;

    const paid = Math.min(Number(amount), Number(S.stackByUid[uid] ?? 0));
    S.stackByUid[uid] = Number(S.stackByUid[uid] ?? 0) - paid;
    S.handState[seatNum].contributed = Number(S.handState[seatNum].contributed || 0) + paid;
    addContribution(seatNum, paid);
    S.handState[seatNum].hasActed = true; // blinds Ä‘Æ°á»£c coi nhÆ° Ä‘Ã£ "Ä‘áº·t"
  }

  function recomputeBetTarget(){
    let m = 0;
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(!isSeatOccupied(i)) continue;
      if(S.handState[i]?.inHand === false) continue;
      m = Math.max(m, Number(S.handState[i]?.contributed || 0));
    }
    S.betTarget = m;
  }

  function getToCallForSeat(seatNum){
    const cur = Number(S.handState?.[seatNum]?.contributed || 0);
    return Math.max(0, Number(S.betTarget || 0) - cur);
  }

  function getBetButtonLabel(){
    if(!S.handActive || !S.actingSeat) return "Bet";
    if(S.handStreet === "Showdown") return "Bet";

    const seat = S.actingSeat;
    const cur = Number(S.handState?.[seat]?.contributed || 0);
    const draft = Math.max(0, Number(S.betDraft || 0));
    const target = Number(S.betTarget || 0);
    const toCall = Math.max(0, target - cur);
    const nextTotal = cur + draft;
    const isBBOptionSpot = (
      S.handStreet === "Preflop" &&
      Number(S.bbSeat || 0) === Number(seat) &&
      !!S.bbOptionPending &&
      Number(target || 0) === Number(S.BB || 0) &&
      toCall === 0
    );

    if(isBBOptionSpot){
      if(draft > 0) return `Raise ${draft}`;
      return "Check";
    }

    if(toCall > 0){
      if(draft > toCall) return `Raise ${draft}`;
      return `Call ${toCall}`;
    }

    if(draft > 0){
      return `Bet ${draft}`;
    }
    return "Check";
  }

  function clearBBOptionIfActed(seatNum){
    if(S.handStreet !== "Preflop") return;
    if(!S.bbOptionPending) return;
    if(Number(S.bbSeat || 0) !== Number(seatNum || 0)) return;
    S.bbOptionPending = false;
  }

  function pushHistory(){
    S.handHistory.push({
      actingSeat: S.actingSeat,
      handStreet: S.handStreet,
      betDraft: S.betDraft,
      winnerSeat: S.winnerSeat,
      potWinners: JSON.parse(JSON.stringify(S.potWinners || [])),
      potBreakdown: JSON.parse(JSON.stringify(S.potBreakdown || [])),
      pendingRefundsBySeat: JSON.parse(JSON.stringify(S.pendingRefundsBySeat || {})),
      refundsApplied: !!S.refundsApplied,
      autoSettled: !!S.autoSettled,
      bbSeat: S.bbSeat,
      bbOptionPending: !!S.bbOptionPending,
      betTarget: S.betTarget,
      handPot: S.handPot,
      totalContribBySeat: JSON.parse(JSON.stringify(S.totalContribBySeat || {})),
      stackByUid: JSON.parse(JSON.stringify(S.stackByUid)),
      handState: JSON.parse(JSON.stringify(S.handState)),
      dealerPosSeat: S.dealerPosSeat
    });
  }

  function popHistory(){
    const snap = S.handHistory.pop();
    if(!snap) return false;

    S.actingSeat = snap.actingSeat;
    S.handStreet = snap.handStreet;
    S.betDraft = snap.betDraft;
    S.winnerSeat = snap.winnerSeat;
    S.potWinners = snap.potWinners || [];
    S.potBreakdown = snap.potBreakdown || [];
    S.pendingRefundsBySeat = snap.pendingRefundsBySeat || {};
    S.refundsApplied = !!snap.refundsApplied;
    S.autoSettled = !!snap.autoSettled;
    S.bbSeat = snap.bbSeat ?? null;
    S.bbOptionPending = !!snap.bbOptionPending;
    S.betTarget = snap.betTarget;
    S.dealerPosSeat = snap.dealerPosSeat;
    S.handPot = Number(snap.handPot || 0);
    S.totalContribBySeat = snap.totalContribBySeat || {};

    Object.keys(S.stackByUid).forEach(k => delete S.stackByUid[k]);
    Object.keys(snap.stackByUid).forEach(k => S.stackByUid[k] = snap.stackByUid[k]);

    for(let i=1;i<=S.SEAT_COUNT;i++){
      S.handState[i] = snap.handState[i] || { inHand:true, contributed:0, hasActed:false };
    }
    S.handActive = true;

    positionDealerToken();
    return true;
  }

  // ===== Draft helpers =====
  function addToDraft(x){
    if(!ctx.requireDealer()) return;
    if(!S.handActive || !S.actingSeat) return;

    const uid = S.seatState?.[S.actingSeat]?.player_uid;
    if(!uid) return;

    const stack = Number(S.stackByUid[uid] ?? 0);
    const next = S.betDraft + Number(x);

    if(next > stack){
      Sound.error();
      alert("Not enough stack");
      return;
    }

    // Track each draft increment so Back can undo draft edits too.
    pushHistory();
    S.betDraft = next;
    Sound.tick();
    updateUI();
  }

  function resetOthersActedAfterRaise(actorSeat){
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(!isSeatOccupied(i)) continue;
      if(S.handState[i]?.inHand === false) continue;
      S.handState[i].hasActed = (i === actorSeat);
    }
  }

  // âœ… Commit draft (bet/raise/call) ngay láº­p tá»©c
  function commitDraftNow(){
    if(!S.handActive || !S.actingSeat) return false;
    if(S.betDraft <= 0) return false;

    const uid = S.seatState?.[S.actingSeat]?.player_uid;
    if(!uid) return false;

    const stack = Number(S.stackByUid[uid] ?? 0);
    const amt = Math.min(S.betDraft, stack);
    if(amt <= 0) return false;

    const beforeTarget = Number(S.betTarget || 0);

    S.stackByUid[uid] = stack - amt;
    S.handState[S.actingSeat].contributed = Number(S.handState[S.actingSeat].contributed || 0) + amt;
    addContribution(S.actingSeat, amt);
    S.handState[S.actingSeat].hasActed = true;

    recomputeBetTarget();

    // náº¿u Ä‘Ã¢y lÃ  raise/bet lÃ m betTarget tÄƒng => reset hasActed cho nhá»¯ng ngÆ°á»i khÃ¡c
    if(Number(S.betTarget || 0) > beforeTarget){
      resetOthersActedAfterRaise(S.actingSeat);
    }

    S.betDraft = 0;
    return true;
  }

  function onlyOneLeftInHand(){
    const alive = getActiveInHandSeats();
    return alive.length <= 1;
  }

  function isBettingRoundComplete(){
    if(!S.handActive) return false;
    if(onlyOneLeftInHand()) return true;

    const actionable = getActionableInHandSeats();
    if(!actionable.length) return true;

    // ai cÃ²n thiáº¿u call => chÆ°a xong
    for(const seat of actionable){
      if(Number(S.handState[seat]?.contributed || 0) !== Number(S.betTarget || 0)) return false;
    }

    // náº¿u chÆ°a ai bet (betTarget=0): táº¥t cáº£ pháº£i hasActed má»›i xong
    if(Number(S.betTarget || 0) === 0){
      for(const seat of actionable){
        if(!S.handState[seat]?.hasActed) return false;
      }
      return true;
    }

    // cÃ³ bet: vÃ¬ khi raise sáº½ reset hasActed ngÆ°á»i khÃ¡c, nÃªn cáº§n táº¥t cáº£ hasActed
    for(const seat of actionable){
      if(!S.handState[seat]?.hasActed) return false;
    }

    // Preflop: if pot is still unopened (only BB level), BB must have last option to act.
    if(
      S.handStreet === "Preflop" &&
      S.bbOptionPending &&
      Number(S.betTarget || 0) === Number(S.BB || 0)
    ){
      const bb = Number(S.bbSeat || 0);
      if(bb && isActionableSeat(bb)){
        return false;
      }
    }
    return true;
  }

  function collectStreetBetsIntoPot(){
    let sum = 0;
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const c = Number(S.handState[i]?.contributed || 0);
      if(c > 0) sum += c;
      if(S.handState[i]) S.handState[i].contributed = 0; // âœ… bet-float vá» 0 cho vÃ²ng má»›i
      if(S.handState[i]) S.handState[i].hasActed = false;
    }
    S.handPot = Number(S.handPot || 0) + sum;
    S.betTarget = 0;
    S.betDraft = 0;
  }

  function advanceStreetIfNeeded(){
    if(!isBettingRoundComplete()) return false;

    // náº¿u chá»‰ cÃ²n 1 ngÆ°á»i => showdown luÃ´n (dealer sáº½ chá»n winner á»Ÿ cuá»‘i)
    if(onlyOneLeftInHand()){
      settleSingleSurvivorNow();
      updateUI();
      return true;
    }

    if(isAllInRunout()){
      moveToShowdown();
      updateUI();
      return true;
    }

    // âœ… gom bet street hiá»‡n táº¡i vÃ o pot, reset bet floats
    collectStreetBetsIntoPot();

    if(S.handStreet === "Preflop") S.handStreet = "Flop";
    else if(S.handStreet === "Flop") S.handStreet = "Turn";
    else if(S.handStreet === "Turn") S.handStreet = "River";
    else if(S.handStreet === "River") S.handStreet = "Showdown";

    // set acting seat Ä‘áº§u vÃ²ng má»›i
    S.actingSeat = (S.handStreet === "Showdown") ? null : firstToActForStreet(S.handStreet);
    if(S.handStreet !== "Showdown" && !S.actingSeat && isAllInRunout()){
      moveToShowdown();
    }
    if(S.handStreet === "Showdown") ensureShowdownPots();

    updateUI();
    return true;
  }

  function advanceAfterAction(){
    if(isAllInRunout()){
      moveToShowdown();
      updateUI();
      return;
    }

    // xong vòng => chuyển street
    if(advanceStreetIfNeeded()) return;

    // còn vòng => next acting
    S.actingSeat = findNextActingSeat(S.actingSeat);
    updateUI();
  }

  function startNewHandLocal(){
    resetHandState();
    S.handActive = true;

    // init stacks if missing
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const uid = S.seatState?.[i]?.player_uid;
      if(!uid) continue;
      if(S.stackByUid[uid] === undefined){
        S.stackByUid[uid] = Number(S.baseStakeByUid[uid] ?? 0);
      }
    }

    // set inHand false cho gháº¿ trá»‘ng
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(!isSeatOccupied(i)) S.handState[i].inHand = false;
    }

    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    const sbSeat = occ[0] ?? null;
    const bbSeat = occ[1] ?? null;

    if(sbSeat) applyBlindToSeat(sbSeat, S.SB);
    if(bbSeat) applyBlindToSeat(bbSeat, S.BB);

    S.bbSeat = bbSeat ?? null;
    S.bbOptionPending = !!bbSeat
      && Number(S.handState?.[bbSeat]?.contributed || 0) >= Number(S.BB || 0)
      && getSeatStack(bbSeat) > 0;

    recomputeBetTarget();

    // Preflop first action = UTG (skip all-in/zero-stack seats)
    S.actingSeat = firstToActForStreet("Preflop");

    // reset winner lock
    S.winnerSeat = null;
    S.potBreakdown = [];
    S.potWinners = [];

    updateUI();
    renderSeats();
  }

  // ===== advance dealer + payout winner =====
  async function advanceDealerButtonAndNewHand(){
    if(!ctx.requireDealer()) return;

    // chá»‰ cho payout khi showdown + Ä‘Ã£ chá»n winner
    if(S.handActive && S.handStreet === "Showdown" && !S.autoSettled && isShowdownReadyForPayout()){
      ensureShowdownPots();
      for(let idx=0; idx<S.potBreakdown.length; idx++){
        const pot = Number(S.potBreakdown[idx]?.amount || 0);
        const winSeat = Number(S.potWinners[idx] || 0);
        if(pot <= 0 || !winSeat || !isSeatOccupied(winSeat)) continue;

        const uidW = S.seatState?.[winSeat]?.player_uid;
        if(uidW){
          S.stackByUid[uidW] = Number(S.stackByUid[uidW] ?? 0) + pot;
        }
      }
    }

    S.winnerSeat = null;
    S.potBreakdown = [];
    S.potWinners = [];
    S.pendingRefundsBySeat = {};
    S.refundsApplied = false;
    S.autoSettled = false;
    S.betDraft = 0;

    const nextDealer = findNextOccupiedSeat(S.dealerPosSeat) ?? S.dealerPosSeat;
    S.dealerPosSeat = nextDealer;
    positionDealerToken();

    try{
      await sb.rpc('advance_table_state', {
        p_table_uid: S.TABLE_UID,
        p_dealer_uid: S.DEALER_UID,
        p_next_seat: nextDealer
      });
    }catch(e){
      console.error("advance_table_state error:", e);
    }

    startNewHandLocal();
  }

  // ===== UI render =====
  function renderSeats(){
    if(!tableEl) return;

    const rect = tableEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rX = cx - S.SEAT_SIZE/2 - S.TABLE_BORDER - S.SAFE_PADDING + 50;
    const rY = cy - S.SEAT_SIZE/2 - S.TABLE_BORDER - S.SAFE_PADDING + 50;

    for(let i=1;i<=S.SEAT_COUNT;i++){
      const s = S.seats[i];
      if(!s?.el) continue;

      const angle = (Math.PI*2/S.SEAT_COUNT)*(i-S.TOP_SEAT) - Math.PI/2;

      s.el.style.left = (cx + Math.cos(angle)*rX) + 'px';
      s.el.style.top  = (cy + Math.sin(angle)*rY) + 'px';
      s.el.style.transform = 'translate(-50%,-50%)';

      s.el.classList.remove('occupied','acting','winner','folded');
      s.el.style.removeProperty("--winner-color");

      const uid = S.seatState[i]?.player_uid;
      const hs = S.handState[i];

      if(uid){
        s.el.classList.add('occupied');
        const stack = Number(S.stackByUid[uid] ?? 0);
        s.stakeEl.textContent = isFinite(stack) ? String(stack) : "-";
      }else{
        s.stakeEl.textContent = "-";
      }

      if(S.handActive && hs?.inHand === false) s.el.classList.add('folded');
      if(S.handActive && S.actingSeat === i) s.el.classList.add('acting');
      if((S.potWinners || []).includes(i) || S.winnerSeat === i){
        s.el.classList.add('winner');
        s.el.style.setProperty("--winner-color", getWinnerColorForSeat(i));
      }

      const bf = S.betFloats[i]?.el;
      if(bf){
        let show = false;
        let text = "";
        let draft = false;

        const contributed = Number(S.handState[i]?.contributed || 0);
        if(contributed > 0){
          show = true;
          text = String(contributed);
        }
        if(S.handActive && S.actingSeat === i && S.betDraft > 0){
          show = true;
          text = String((Number(S.handState[i]?.contributed || 0) + S.betDraft));
          draft = true;
        }

        bf.textContent = text;
        bf.classList.toggle("show", show);
        bf.classList.toggle("draft", draft);
        positionBetFloat(i);
      }
    }

    positionDealerToken();
  }

  function updateUI(){
    if(blindLabel) blindLabel.textContent = `${S.SB} / ${S.BB}`;
    if(streetLabel) streetLabel.textContent = S.handStreet;

    const pot = getPotTotal();
    if(potLabel) potLabel.textContent = String(pot);
    renderCenterPot();

    const toCall = (S.handActive && S.actingSeat) ? getToCallForSeat(S.actingSeat) : 0;
    if(toCallLabel) toCallLabel.textContent = String(toCall);
    if(draftLabel) draftLabel.textContent = String(S.betDraft);

    if(betBtn){
      betBtn.textContent = getBetButtonLabel();
    }

    if(actingTitle){
      if(S.handStreet === "Showdown"){
        ensureShowdownPots();
        const total = Number(S.potBreakdown?.length || 0);
        const done = Number(S.potWinners?.length || 0);
        if(total <= 0){
          actingTitle.textContent = "Showdown";
        }else if(done < total){
          const label = (done === 0) ? "Main pot" : `Side pot ${done}`;
          actingTitle.textContent = `Pick winner: ${label} (${done + 1}/${total})`;
        }else{
          actingTitle.textContent = `Winners ready (${done}/${total})`;
        }
      }else if(S.handActive && S.actingSeat){
        const uid = S.seatState?.[S.actingSeat]?.player_uid;
        actingTitle.textContent = uid
          ? `Acting: Seat ${S.actingSeat} • $${S.stackByUid[uid] ?? 0}`
          : `Acting: Seat ${S.actingSeat}`;
      }else{
        actingTitle.textContent = "No seat selected";
      }
    }

    const inActionPhase = (S.handActive && S.actingSeat && S.handStreet !== "Showdown");
    const disabled = (!S.DEALER_UID || !inActionPhase || S.isSubmitting);

    [betBtn, foldBtn, allinBtn].forEach(b => {
      if(!b) return;
      b.disabled = disabled;
      b.style.opacity = b.disabled ? 0.55 : 1;
    });

    // âœ… hide next (removed)
    if(nextBtn){
      nextBtn.style.display = "none";
      nextBtn.disabled = true;
    }

    if(backBtn){
      backBtn.disabled = (!S.DEALER_UID || S.handHistory.length === 0);
      backBtn.style.opacity = backBtn.disabled ? 0.55 : 1;
    }

    // âœ… slider lock: chá»‰ má»Ÿ khi Showdown + Ä‘Ã£ chá»n winner
    if(track){
      const locked = !isShowdownReadyForPayout();
      track.classList.toggle("is-locked", locked);
    }

    renderSeats();
    window.__tourEngine?.init?.(); // harmless
  }

  // ===== Buttons wiring =====
  function bindButtonsOnce(){
    if(S.__buttonsBound) return;
    S.__buttonsBound = true;

    q25?.addEventListener("click", () => addToDraft(25));
    q100?.addEventListener("click", () => addToDraft(100));
    q500?.addEventListener("click", () => addToDraft(500));

    // Single primary action button: Bet / Call / Raise
    betBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(!S.handActive || !S.actingSeat) return;
      if(S.handStreet === "Showdown") return;

      pushHistory();

      const actor = S.actingSeat;
      const toCall = getToCallForSeat(actor);
      const uid = S.seatState?.[actor]?.player_uid;
      if(!uid) return;

      // Unopened pot: bet with draft, otherwise check.
      if(toCall <= 0){
        if(Number(S.betDraft || 0) > 0){
          const ok = commitDraftNow();
          if(!ok){
            Sound.error();
            return;
          }
          clearBBOptionIfActed(actor);
          Sound.success();
          advanceAfterAction();
          return;
        }

        S.betDraft = 0;
        S.handState[actor].hasActed = true;
        clearBBOptionIfActed(actor);
        Sound.tick();
        advanceAfterAction();
        return;
      }

      // Facing a bet: draft > toCall => raise, otherwise call.
      if(Number(S.betDraft || 0) > toCall){
        const ok = commitDraftNow();
        if(!ok){
          Sound.error();
          return;
        }
        clearBBOptionIfActed(actor);
        Sound.success();
        advanceAfterAction();
        return;
      }

      const stack = Number(S.stackByUid[uid] ?? 0);
      const pay = Math.min(toCall, stack);
      if(pay <= 0){
        Sound.error();
        return;
      }

      S.betDraft = pay;
      const ok = commitDraftNow();
      if(!ok){
        Sound.error();
        return;
      }
      clearBBOptionIfActed(actor);
      Sound.tick();
      advanceAfterAction();
    });

    // âœ… ALL-IN: commit ngay
    allinBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(!S.handActive || !S.actingSeat) return;
      if(S.handStreet === "Showdown") return;

      const uid = S.seatState?.[S.actingSeat]?.player_uid;
      if(!uid) return;

      pushHistory();

      const stack = Math.max(0, Number(S.stackByUid[uid] ?? 0));
      if(stack <= 0){
        Sound.error();
        return;
      }

      S.betDraft = stack;
      commitDraftNow();
      clearBBOptionIfActed(S.actingSeat);
      Sound.success();
      advanceAfterAction();
    });

    foldBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(!S.handActive || !S.actingSeat) return;
      if(S.handStreet === "Showdown") return;

      pushHistory();

      S.handState[S.actingSeat].inHand = false;
      S.handState[S.actingSeat].hasActed = true;
      clearBBOptionIfActed(S.actingSeat);
      S.betDraft = 0;

      // náº¿u cÃ²n 1 ngÆ°á»i => showdown
      if(advanceStreetIfNeeded()){
        Sound.reject();
        return;
      }

      S.actingSeat = findNextActingSeat(S.actingSeat);
      Sound.reject();
      updateUI();
    });

    backBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(!S.handHistory.length) return;

      if(popHistory()){
        Sound.tick();
        updateUI();
      }
    });

    bindSliderOnce();
  }

  // ===== Slider to New Hand =====
  function bindSliderOnce(){
    if(S.__sliderBound) return;
    S.__sliderBound = true;

    if(!thumb || !track) return;

    let isDragging = false, startX = 0, currentX = 0;
    const maxX = () => track.offsetWidth - thumb.offsetWidth - 4;

    thumb.addEventListener('pointerdown', e => {
      if (!ctx.requireDealer()) return;

      // âœ… chá»‰ cho kÃ©o khi Showdown + Ä‘Ã£ chá»n winner
      const ok = (S.handActive && isShowdownReadyForPayout());
      if(!ok){
        Sound.error();
        return;
      }

      isDragging = true;
      startX = e.clientX - thumb.offsetLeft;
      thumb.setPointerCapture(e.pointerId);
    });

    document.addEventListener('pointermove', e => {
      if (!isDragging) return;
      currentX = e.clientX - startX;
      currentX = Math.max(4, Math.min(currentX, maxX()));
      thumb.style.left = currentX + 'px';
    });

    document.addEventListener('pointerup', async () => {
      if (!isDragging) return;
      isDragging = false;

      if(!S.DEALER_UID){
        resetSlider();
        return;
      }

      if (currentX > maxX() * 0.85) {
        Sound.success();
        thumb.style.left = maxX() + 'px';
        await advanceDealerButtonAndNewHand();
        resetSlider();
      } else {
        resetSlider();
      }
    });

    document.addEventListener('pointercancel', () => {
      isDragging = false;
      resetSlider();
    });

    function resetSlider(){
      currentX = 0;
      thumb.style.left = '4px';
    }
  }

  // ===== table_state realtime dealer seat =====
  async function fetchDealerSeat(){
    if(!S.TABLE_UID) return;

    const { data, error } = await sb
      .from('table_state')
      .select('dealer_seat')
      .eq('table_uid', S.TABLE_UID)
      .single();

    if(!error && data?.dealer_seat){
      const v = Number(data.dealer_seat);
      if(v >= 1 && v <= S.SEAT_COUNT) S.dealerPosSeat = v;
    }else{
      S.dealerPosSeat = 1;
    }

    if(!isSeatOccupied(S.dealerPosSeat)){
      const first = findNextOccupiedSeat(S.dealerPosSeat) || findNextOccupiedSeat(0) || 1;
      S.dealerPosSeat = first;
    }

    positionDealerToken();
  }

  async function initTableStateRealtime(){
    if(!S.TABLE_UID) return;

    if(S.tableStateChannel){
      try{ await S.tableStateChannel.unsubscribe(); }catch(e){}
      S.tableStateChannel = null;
    }

    S.tableStateChannel = sb.channel('table_state-' + S.TABLE_UID)
      .on('postgres_changes',
        { event:'*', schema:'public', table:'table_state', filter:`table_uid=eq.${S.TABLE_UID}` },
        () => {
          fetchDealerSeat().then(() => {
            if(S.handActive && !S.actingSeat && S.handStreet !== "Showdown"){
              S.actingSeat = firstToActForStreet(S.handStreet);
            }
            renderSeats();
            updateUI();
          });
        }
      )
      .subscribe();
  }

  // ===== Seats creation =====
  function initPanelOnce(){
    if(S.panelInited) return;
    S.panelInited = true;

    if(!tableEl) cacheDom();

    for(let i=1;i<=S.SEAT_COUNT;i++){
      S.seatState[i] = { player_uid: null };

      const seat = document.createElement("div");
      seat.className = "seat";

      const seatNo = document.createElement("div");
      seatNo.className = "seatNo";
      seatNo.textContent = "Seat " + i;

      const stake = document.createElement("div");
      stake.className = "stake";
      stake.textContent = "-";

      seat.appendChild(seatNo);
      seat.appendChild(stake);

      // Hold: assign/reject QR
      seat.addEventListener('pointerdown', () => {
        if (!ctx.requireDealer()) return;

        S.didHold = false;
        clearTimeout(S.holdTimer);

        S.holdTimer = setTimeout(() => {
          S.didHold = true;
          if (S.seatState[i].player_uid) {
            if (confirm(`Reject PLAYER_UID ${S.seatState[i].player_uid.slice(0,6)} ?`)) {
              Sound.reject();
              ejectUID(i);
            }
          } else {
            scanQRAndAssign(i);
          }
        }, S.HOLD_TIME);
      });

      seat.addEventListener('pointerup', () => clearTimeout(S.holdTimer));
      seat.addEventListener('pointerleave', () => clearTimeout(S.holdTimer));
      seat.addEventListener('pointercancel', () => clearTimeout(S.holdTimer));

      // âœ… Click: choose winner (ONLY at Showdown) + toggle unselect
      seat.addEventListener("click", () => {
        if(S.didHold) return;
        if(!ctx.requireDealer()) return;
        if(!S.seatState[i].player_uid) return;

        // chá»‰ cho chá»n winner khi showdown
        if(!(S.handActive && S.handStreet === "Showdown")){
          Sound.reject();
          return;
        }

        ensureShowdownPots();
        if(!S.potBreakdown.length){
          Sound.error();
          return;
        }

        const lastSeat = S.potWinners?.[S.potWinners.length - 1];
        if(lastSeat === i){
          // Undo one tap group: remove trailing pots won by the same seat.
          while(S.potWinners.length && S.potWinners[S.potWinners.length - 1] === i){
            S.potWinners.pop();
          }
          S.winnerSeat = S.potWinners[0] ?? null;
          Sound.tick();
          updateUI();
          return;
        }

        if(S.potWinners.length >= S.potBreakdown.length){
          Sound.error();
          return;
        }

        const potIndex = S.potWinners.length;
        const eligible = S.potBreakdown[potIndex]?.eligibleSeats || [];
        const canPick = eligible.includes(i);
        if(!canPick){
          Sound.error();
          return;
        }

        // Pick current pending pot, then auto-fill next pending pots
        // that this seat is also eligible to win.
        S.potWinners.push(i);
        while(S.potWinners.length < S.potBreakdown.length){
          const nextPotIndex = S.potWinners.length;
          const nextEligible = S.potBreakdown[nextPotIndex]?.eligibleSeats || [];
          if(!nextEligible.includes(i)) break;
          S.potWinners.push(i);
        }
        S.winnerSeat = S.potWinners[0] ?? null;
        Sound.success();
        updateUI();
      });

      S.seats[i] = { el: seat, seatNoEl: seatNo, stakeEl: stake };
      tableEl.appendChild(seat);

      const bf = document.createElement("div");
      bf.className = "bet-float";
      bf.textContent = "";
      S.betFloats[i] = { el: bf };
      tableEl.appendChild(bf);
    }

    resetHandState();
    renderSeats();

    window.addEventListener("resize", () => renderSeats());
    bindButtonsOnce();
  }

  // ===== DB seats load + realtime =====
  async function loadSeats(){
    if(!S.TABLE_UID) return;

    for(let i=1;i<=S.SEAT_COUNT;i++){
      S.seatState[i] = { player_uid: null };
    }

    const { data } = await sb.from('seats').select('*').eq('table_uid', S.TABLE_UID);
    (data||[]).forEach(r => { S.seatState[String(r.seat_number)].player_uid = r.player_uid; });

    renderSeats();
  }

  async function initRealtime(){
    if(!S.TABLE_UID) return;

    if(S.seatChannel){
      try{ await S.seatChannel.unsubscribe(); }catch(e){}
      S.seatChannel = null;
    }

    S.seatChannel = sb.channel('seats-' + S.TABLE_UID)
      .on('postgres_changes',
        { event:'*', schema:'public', table:'seats', filter:`table_uid=eq.${S.TABLE_UID}` },
        p => {
          S.seatState[p.new.seat_number].player_uid = p.new.player_uid;

          clearTimeout(S.stakeRefreshTimer);
          S.stakeRefreshTimer = setTimeout(() => {
            refreshStakesForOccupiedSeats().then(() => {
              if(S.handActive && S.handStreet !== "Showdown"){
                if(S.actingSeat && !isSeatOccupied(S.actingSeat)) S.actingSeat = firstToActForStreet(S.handStreet);
                recomputeBetTarget();
              }
              updateUI();
            });
          }, 120);

          renderSeats();
        }
      )
      .subscribe();
  }

  // ===== QR / assign =====
  async function isValidPlayerUID(player_uid){
    const { data, error } = await sb.from('players').select('player_uid').eq('player_uid', player_uid).single();
    return !(error || !data);
  }

  async function assignUID(seat, player_uid){
    S.seatState[seat].player_uid = player_uid;
    renderSeats();

    const { data, error } = await sb
      .from('seats')
      .update({ player_uid })
      .eq('table_uid', S.TABLE_UID)
      .eq('seat_number', seat)
      .select();

    if (error || !data?.length){
      S.seatState[seat].player_uid = null;
      renderSeats();
      Sound.error();
      alert('Assign PLAYER_UID failed');
      return;
    }

    await refreshStakesForOccupiedSeats();

    if(S.handActive && S.DEALER_UID){
      startNewHandLocal();
    }else{
      updateUI();
    }
  }

  async function ejectUID(seat){
    const old = S.seatState[seat].player_uid;
    S.seatState[seat].player_uid = null;
    renderSeats();

    const { data, error } = await sb
      .from('seats')
      .update({ player_uid: null })
      .eq('table_uid', S.TABLE_UID)
      .eq('seat_number', String(seat))
      .select();

    if (error || !data?.length){
      S.seatState[seat].player_uid = old;
      renderSeats();
      Sound.error();
      alert('Reject failed');
      return;
    }

    await refreshStakesForOccupiedSeats();

    if(S.handActive && S.handStreet !== "Showdown"){
      if(S.actingSeat === seat) S.actingSeat = findNextActingSeat(seat) || firstToActForStreet(S.handStreet);
      recomputeBetTarget();
    }
    updateUI();
  }

  async function safeStopQR(){
    if (S.qrScanner){
      try{
        if (S.qrScanner.isScanning) await S.qrScanner.stop();
        await S.qrScanner.clear();
      }catch(e){}
      S.qrScanner = null;
    }
  }

  async function scanQRAndAssign(seatIndex){
    const modal = document.getElementById('qrModal');
    const closeBtn = document.getElementById('closeQR');

    modal.style.display = 'flex';
    await safeStopQR();

    setTimeout(async () => {
      // Html5Qrcode is global from CDN
      S.qrScanner = new window.Html5Qrcode('qr-reader');
      S.qrScanner.start(
        { facingMode:'environment' },
        { fps:10, qrbox:220, aspectRatio:1 },
        async text => {
          await safeStopQR();
          modal.style.display = 'none';

          const player_uid = text?.trim().replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
          if (!player_uid){
            Sound.error();
            return alert('Invalid QR code');
          }

          const exists = await isValidPlayerUID(player_uid);
          if (!exists){
            Sound.error();
            return alert('UID does not exist in system');
          }

          assignUID(seatIndex, player_uid);
        }
      );
    }, 150);

    closeBtn.onclick = async () => {
      await safeStopQR();
      modal.style.display = 'none';
    };
  }

  // ===== Table session start =====
  async function startTableSession(){
    initPanelOnce();

    await loadSeats();
    await refreshStakesForOccupiedSeats();

    await fetchDealerSeat();
    await initRealtime();
    await initTableStateRealtime();

    if(S.DEALER_UID){
      startNewHandLocal();
    }else{
      updateUI();
    }
  }

  // ===== public API =====
  function init(){
    cacheDom();
    initPanelOnce();
    updateUI();
  }

  return {
    init,
    // used by app.js
    startTableSession,
    initPanelOnce,
    resetHandState,
    updateUI,
    renderSeats,
    refreshStakesForOccupiedSeats,
    fetchDealerSeat,
    initRealtime,
    initTableStateRealtime,
    startNewHandLocal,
    recomputeBetTarget,
    computeUTGSeat,
    findNextActingSeat,
    findNextOccupiedSeat,
    isSeatOccupied,
  };
}
