// js/table.js
// Logic bàn + hand + seats + realtime + QR + UI render
// Nhận ctx từ app.js để dùng sbClient, Sound, requireDealer, requireTable

export function createTableModule(ctx){
  const S = ctx.state;
  const sb = ctx.sbClient;
  const Sound = ctx.Sound;

  // ===== DOM (lazy init) =====
  let tableEl, potLabel, potCenter, actingTitle, streetLabel, blindLabel, toCallLabel, draftLabel;
  let betBtn, callBtn, foldBtn, allinBtn, backBtn, nextBtn;
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
    callBtn = document.getElementById("callBtn");
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
  // - Bet = nhập bằng nút +..., bấm Bet để commit và auto qua người
  // - Bỏ Next (ẩn)
  // - Kết thúc vòng: gom bet-float (contributed) vào pot, reset contributed=0
  // - Chuyển street: actingSeat về đúng người đầu vòng (gần dealer token)
  // - Chỉ được chọn winner khi Showdown (sau River)
  // - Tap winner lần nữa => bỏ chọn
  // - Slider chỉ chạy khi Showdown + đã chọn winner
  // =========================================================

  function resetHandState(){
    for(let i=1;i<=S.SEAT_COUNT;i++){
      // contributed = bet của street hiện tại (bet-float)
      // hasActed = đã action trong betting round hiện tại chưa
      S.handState[i] = { inHand: true, contributed: 0, hasActed: false };
    }
    S.handHistory = [];
    S.handActive = false;
    S.actingSeat = null;
    S.handStreet = "Preflop";
    S.betDraft = 0;
    S.winnerSeat = null;
    S.betTarget = 0;

    // ✅ pot đã gom xong (giữ qua street)
    S.handPot = 0;

    if(streetLabel) streetLabel.textContent = S.handStreet;
  }

  // ✅ Pot hiển thị = pot đã gom xong (không cộng bet-float đang nằm ngoài pot)
  function getPotTotal(){
    return Number(S.handPot || 0);
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
      if(!isSeatOccupied(s)) continue;
      if(S.handState[s]?.inHand === false) continue;
      return s;
    }
    return null;
  }

  // ✅ Người đầu vòng theo street
  function firstToActForStreet(street){
    if(street === "Preflop"){
      return computeUTGSeat();
    }
    // Flop/Turn/River: người gần dealer token nhất (SB) còn inHand
    const sbSeat = getSBSeat();
    if(!sbSeat) return computeUTGSeat();
    if(S.handState[sbSeat]?.inHand !== false) return sbSeat;
    return findNextActingSeat(sbSeat) || computeUTGSeat();
  }

  function applyBlindToSeat(seatNum, amount){
    const uid = S.seatState?.[seatNum]?.player_uid;
    if(!uid) return;

    S.stackByUid[uid] = Number(S.stackByUid[uid] ?? 0) - Number(amount);
    S.handState[seatNum].contributed = Number(S.handState[seatNum].contributed || 0) + Number(amount);
    S.handState[seatNum].hasActed = true; // blinds được coi như đã "đặt"
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

  function pushHistory(){
    S.handHistory.push({
      actingSeat: S.actingSeat,
      handStreet: S.handStreet,
      betDraft: S.betDraft,
      winnerSeat: S.winnerSeat,
      betTarget: S.betTarget,
      handPot: S.handPot,
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
    S.betTarget = snap.betTarget;
    S.dealerPosSeat = snap.dealerPosSeat;
    S.handPot = Number(snap.handPot || 0);

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

  // ✅ Commit draft (bet/raise/call) ngay lập tức
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
    S.handState[S.actingSeat].hasActed = true;

    recomputeBetTarget();

    // nếu đây là raise/bet làm betTarget tăng => reset hasActed cho những người khác
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

    const alive = getActiveInHandSeats();
    if(!alive.length) return true;

    // ai còn thiếu call => chưa xong
    for(const seat of alive){
      if(Number(S.handState[seat]?.contributed || 0) !== Number(S.betTarget || 0)) return false;
    }

    // nếu chưa ai bet (betTarget=0): tất cả phải hasActed mới xong
    if(Number(S.betTarget || 0) === 0){
      for(const seat of alive){
        if(!S.handState[seat]?.hasActed) return false;
      }
      return true;
    }

    // có bet: vì khi raise sẽ reset hasActed người khác, nên cần tất cả hasActed
    for(const seat of alive){
      if(!S.handState[seat]?.hasActed) return false;
    }
    return true;
  }

  function collectStreetBetsIntoPot(){
    let sum = 0;
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const c = Number(S.handState[i]?.contributed || 0);
      if(c > 0) sum += c;
      if(S.handState[i]) S.handState[i].contributed = 0; // ✅ bet-float về 0 cho vòng mới
      if(S.handState[i]) S.handState[i].hasActed = false;
    }
    S.handPot = Number(S.handPot || 0) + sum;
    S.betTarget = 0;
    S.betDraft = 0;
  }

  function advanceStreetIfNeeded(){
    if(!isBettingRoundComplete()) return false;

    // nếu chỉ còn 1 người => showdown luôn (dealer sẽ chọn winner ở cuối)
    if(onlyOneLeftInHand()){
      collectStreetBetsIntoPot();
      S.handStreet = "Showdown";
      S.actingSeat = null;
      updateUI();
      return true;
    }

    // ✅ gom bet street hiện tại vào pot, reset bet floats
    collectStreetBetsIntoPot();

    if(S.handStreet === "Preflop") S.handStreet = "Flop";
    else if(S.handStreet === "Flop") S.handStreet = "Turn";
    else if(S.handStreet === "Turn") S.handStreet = "River";
    else if(S.handStreet === "River") S.handStreet = "Showdown";

    // set acting seat đầu vòng mới
    S.actingSeat = (S.handStreet === "Showdown") ? null : firstToActForStreet(S.handStreet);

    updateUI();
    return true;
  }

  function advanceAfterAction(){
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

    // set inHand false cho ghế trống
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(!isSeatOccupied(i)) S.handState[i].inHand = false;
    }

    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    const sbSeat = occ[0] ?? null;
    const bbSeat = occ[1] ?? null;

    if(sbSeat) applyBlindToSeat(sbSeat, S.SB);
    if(bbSeat) applyBlindToSeat(bbSeat, S.BB);

    recomputeBetTarget();

    // Preflop first action = UTG
    S.actingSeat = computeUTGSeat();

    // reset winner lock
    S.winnerSeat = null;

    updateUI();
    renderSeats();
  }

  // ===== advance dealer + payout winner =====
  async function advanceDealerButtonAndNewHand(){
    if(!ctx.requireDealer()) return;

    // chỉ cho payout khi showdown + đã chọn winner
    if(S.handActive && S.handStreet === "Showdown" && S.winnerSeat && isSeatOccupied(S.winnerSeat)){
      const pot = getPotTotal(); // = handPot đã gom xong
      if(pot > 0){
        const uidW = S.seatState?.[S.winnerSeat]?.player_uid;
        if(uidW){
          S.stackByUid[uidW] = Number(S.stackByUid[uidW] ?? 0) + pot;
        }
      }
    }

    // ✅ clear winner khi slide xong
    S.winnerSeat = null;
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
      if(S.winnerSeat === i) s.el.classList.add('winner');

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
    if(potCenter) potCenter.innerHTML = `$${pot}<small>POT</small>`;

    const toCall = (S.handActive && S.actingSeat) ? getToCallForSeat(S.actingSeat) : 0;
    if(toCallLabel) toCallLabel.textContent = String(toCall);
    if(draftLabel) draftLabel.textContent = String(S.betDraft);

    // ✅ Call/Check label rule
    if(callBtn){
      if(!S.handActive || !S.actingSeat){
        callBtn.textContent = "Call";
      }else{
        if(Number(S.betTarget || 0) === 0) callBtn.textContent = "Check";
        else callBtn.textContent = toCall > 0 ? `Call ${toCall}` : "Call";
      }
    }

    if(actingTitle){
      if(S.handActive && S.actingSeat){
        const uid = S.seatState?.[S.actingSeat]?.player_uid;
        actingTitle.textContent = uid
          ? `Acting: Seat ${S.actingSeat} • $${S.stackByUid[uid] ?? 0}`
          : `Acting: Seat ${S.actingSeat}`;
      }else{
        actingTitle.textContent = "No seat selected";
      }
    }

    // ✅ disable rules: không cho action khi Showdown
    const inActionPhase = (S.handActive && S.actingSeat && S.handStreet !== "Showdown");
    const disabled = (!S.DEALER_UID || !inActionPhase || S.isSubmitting);

    [betBtn, callBtn, foldBtn, allinBtn].forEach(b => {
      if(!b) return;
      b.disabled = disabled;
      b.style.opacity = b.disabled ? 0.55 : 1;
    });

    // ✅ hide next (removed)
    if(nextBtn){
      nextBtn.style.display = "none";
      nextBtn.disabled = true;
    }

    if(backBtn){
      backBtn.disabled = (!S.DEALER_UID || S.handHistory.length === 0);
      backBtn.style.opacity = backBtn.disabled ? 0.55 : 1;
    }

    // ✅ slider lock: chỉ mở khi Showdown + đã chọn winner
    if(track){
      const locked = !(S.handStreet === "Showdown" && !!S.winnerSeat);
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

    // ✅ BET: commit draft (không prompt), auto qua người
    betBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(!S.handActive || !S.actingSeat) return;
      if(S.handStreet === "Showdown") return;

      if(S.betDraft <= 0){
        Sound.error();
        return;
      }

      pushHistory();

      const ok = commitDraftNow();
      if(!ok){
        Sound.error();
        return;
      }

      Sound.success();
      advanceAfterAction();
    });

    // ✅ CALL/ CHECK: action ngay lập tức (không chỉ set draft)
    callBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(!S.handActive || !S.actingSeat) return;
      if(S.handStreet === "Showdown") return;

      pushHistory();

      const toCall = getToCallForSeat(S.actingSeat);
      const uid = S.seatState?.[S.actingSeat]?.player_uid;
      if(!uid) return;

      if(Number(S.betTarget || 0) === 0){
        // CHECK
        S.betDraft = 0;
        S.handState[S.actingSeat].hasActed = true;
        Sound.reject();
        advanceAfterAction();
        return;
      }

      if(toCall <= 0){
        // đã bằng betTarget nhưng betTarget>0: coi như "call 0" (rare), vẫn mark acted
        S.betDraft = 0;
        S.handState[S.actingSeat].hasActed = true;
        Sound.tick();
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
      commitDraftNow();
      Sound.tick();
      advanceAfterAction();
    });

    // ✅ ALL-IN: commit ngay
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
      S.betDraft = 0;

      // nếu còn 1 người => showdown
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

      // ✅ chỉ cho kéo khi Showdown + đã chọn winner
      const ok = (S.handActive && S.handStreet === "Showdown" && !!S.winnerSeat);
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

      // ✅ Click: choose winner (ONLY at Showdown) + toggle unselect
      seat.addEventListener("click", () => {
        if(S.didHold) return;
        if(!ctx.requireDealer()) return;
        if(!S.seatState[i].player_uid) return;

        // chỉ cho chọn winner khi showdown
        if(!(S.handActive && S.handStreet === "Showdown")){
          Sound.reject();
          return;
        }

        if(S.winnerSeat === i){
          S.winnerSeat = null; // ✅ tap lại để bỏ chọn
          Sound.tick();
        }else{
          S.winnerSeat = i;
          Sound.success();
        }
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
      alert('❌ Gán PLAYER_UID thất bại');
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
      alert('❌ Reject thất bại');
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
      // Html5Qrcode là global do CDN
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
            return alert('QR không hợp lệ');
          }

          const exists = await isValidPlayerUID(player_uid);
          if (!exists){
            Sound.error();
            return alert('❌ UID không tồn tại trong hệ thống');
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
