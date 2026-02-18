// js/table.js
// Table + hand + seats + realtime + QR + UI render
// Receives ctx from app.js: sbClient, Sound, requireDealer, requireTable
import { buildPotsFromCommitted } from "./pot-engine.js";

export function createTableModule(ctx){
  const S = ctx.state;
  const sb = ctx.sbClient;
  const Sound = ctx.Sound;
  const QUICK_ASSIGN_OPTIONS = [100000, 50000, 10000, 5000, 1000, 500, 100];

  // ===== DOM (lazy init) =====
  let tableEl, potLabel, potCenter, actingTitle, streetLabel, blindLabel, toCallLabel, draftLabel, levelLabel;
  let betBtn, foldBtn, allinBtn, backBtn, nextBtn;
  let q25, q100, q500;
  let thumb, track;
  let blindUpBtn, blindDownBtn, dealerBackBtn, dealerNextBtn, structureUidSelect;
  let stakeLockBtn, updateStakeBtn;

  function cacheDom(){
    tableEl = document.getElementById('table');

    potLabel = document.getElementById("potLabel");
    potCenter = document.getElementById("potCenter");
    actingTitle = document.getElementById("actingTitle");
    streetLabel = document.getElementById("streetLabel");
    blindLabel = document.getElementById("blindLabel");
    levelLabel = document.getElementById("levelLabel");
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
    blindUpBtn = document.getElementById("blindUpBtn");
    blindDownBtn = document.getElementById("blindDownBtn");
    dealerBackBtn = document.getElementById("dealerBackBtn");
    dealerNextBtn = document.getElementById("dealerNextBtn");
    structureUidSelect = document.getElementById("structureUidSelect");
    stakeLockBtn = document.getElementById("stakeLockBtn");
    updateStakeBtn = document.getElementById("updateStakeBtn");
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

  function orderSeatsClockwiseFromButton(seats){
    const uniq = [...new Set((Array.isArray(seats) ? seats : []).map((s) => Number(s)).filter((s) => s > 0))];
    if(!uniq.length) return [];
    const bySeat = new Set(uniq);
    const out = [];
    for(let step=0; step<S.SEAT_COUNT; step++){
      const s = ((Number(S.dealerPosSeat || 1) - 1 + step) % S.SEAT_COUNT) + 1;
      if(bySeat.has(s)) out.push(s);
    }
    return out;
  }

  function distributePotToWinners(pot, winners){
    const out = {};
    const amount = Number(pot || 0);
    const picked = (Array.isArray(winners) ? winners : [])
      .map((seat) => Number(seat))
      .filter((seat, pos, arr) => seat > 0 && arr.indexOf(seat) === pos && isSeatOccupied(seat));
    if(amount <= 0 || !picked.length) return out;

    const orderedWinners = orderSeatsClockwiseFromButton(picked);
    const chipUnit = Math.max(1, toPosInt(S.handSB, toPosInt(S.SB, 1)));
    const share = Math.floor((amount / orderedWinners.length) / chipUnit) * chipUnit;
    let rem = amount - share * orderedWinners.length;

    for(const seat of orderedWinners){
      out[seat] = Number(out[seat] || 0) + share;
    }

    let oddUnits = Math.floor(rem / chipUnit);
    let oddIdx = 0;
    while(oddUnits > 0 && orderedWinners.length){
      const seat = orderedWinners[oddIdx % orderedWinners.length];
      out[seat] = Number(out[seat] || 0) + chipUnit;
      oddUnits -= 1;
      oddIdx += 1;
    }

    const subUnitOdd = rem % chipUnit;
    if(subUnitOdd > 0 && orderedWinners.length){
      const firstSeat = orderedWinners[0];
      out[firstSeat] = Number(out[firstSeat] || 0) + subUnitOdd;
    }
    return out;
  }

  function getShowdownPayoutPreviewBySeat(){
    const out = {};
    if(!(S.handActive && S.handStreet === "Showdown")) return out;
    ensureShowdownPots();

    for(let idx=0; idx<Number(S.potBreakdown?.length || 0); idx++){
      const pot = Number(S.potBreakdown[idx]?.amount || 0);
      const winners = Array.isArray(S.potWinnerGroups?.[idx]) ? S.potWinnerGroups[idx] : [];
      const distributed = distributePotToWinners(pot, winners);
      Object.keys(distributed).forEach((seatKey) => {
        const seat = Number(seatKey || 0);
        if(seat <= 0) return;
        out[seat] = Number(out[seat] || 0) + Number(distributed[seatKey] || 0);
      });
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

    // Match dealer token orbit radius.
    const DEALER_SIZE = 18;
    const DEALER_RADIUS = DEALER_SIZE / 2;
    const ORBIT_GAP = 18;
    const rX = cx - (DEALER_SIZE/2) - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;
    const rY = cy - (DEALER_SIZE/2) - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;

    const a = seatAngleFor(seatNum);
    const x = cx + Math.cos(a) * rX - Math.cos(a) * DEALER_RADIUS;
    const y = cy + Math.sin(a) * rY - Math.sin(a) * DEALER_RADIUS;

    bf.style.left = x + "px";
    bf.style.top  = y + "px";
  }

  function positionBBAFloat(seatNum){
    const bf = S.bbaFloats?.[seatNum]?.el;
    if(!bf || !tableEl) return;

    const rect = tableEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Keep BBA closer to table center than normal bet-float.
    const DEALER_SIZE = 18;
    const DEALER_RADIUS = DEALER_SIZE / 2;
    const ORBIT_GAP = 70;
    const rX = cx - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;
    const rY = cy - S.TABLE_BORDER - S.SAFE_PADDING - ORBIT_GAP;

    const a = seatAngleFor(seatNum);
    const x = cx + Math.cos(a) * rX - Math.cos(a) * DEALER_RADIUS;
    const y = cy + Math.sin(a) * rY - Math.sin(a) * DEALER_RADIUS;

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

    const tid = getTournamentIdSafe();
    await initLeaderboardRealtime();
    if(!tid){
      renderSeats();
      updateUI();
      return;
    }

    const need = uids.filter(uid => S.baseStakeByUid[uid] === undefined);
    if(need.length){
      let query = sb
        .from("leaderboard")
        .select("player_uid, player_chips")
        .in("player_uid", need);
      query = query.eq("tournament_id", tid);
      const { data, error } = await query;

      if(error){
        console.error("refreshStakes error:", error);
        return;
      }
      (data || []).forEach(r => {
        S.baseStakeByUid[r.player_uid] = Number(r.player_chips ?? 0);
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

  function toPosInt(v, fallback = 0){
    const n = Number(v);
    if(!Number.isFinite(n) || n < 0) return Number(fallback || 0);
    return Math.trunc(n);
  }

  function formatChip(v){
    const n = Math.trunc(Number(v) || 0);
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    return sign + String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function getOccupiedSeats(){
    const out = [];
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(S.seatState?.[i]?.player_uid) out.push(i);
    }
    return out;
  }

  function getTournamentIdSafe(){
    const raw = S.TOURNAMENT_ID;
    if(raw === null || raw === undefined) return "";
    return String(raw).trim();
  }

  async function persistPlayerStackViaPlayers(playerUid, normalizedStake){
    const knownField = String(S.__playersStakeField || "");
    const candidateFields = knownField
      ? [knownField]
      : ["stake_tour", "player_chips", "chips", "chip", "stack", "stake"];

    for(const field of candidateFields){
      const resPlayers = await sb
        .from("players")
        .update({ [field]: normalizedStake })
        .eq("player_uid", playerUid);
      if(!resPlayers?.error){
        S.__playersStakeField = field;
        S.__stackPersistSource = `players.${field}`;
        return true;
      }
    }
    return false;
  }

  async function persistPlayerStack(playerUid, stake){
    const normalizedStake = toPosInt(stake, 0);
    const tid = getTournamentIdSafe();
    const errors = [];

    if(!S.__disableLeaderboardWrite){
      if(!tid){
        S.__disableLeaderboardWrite = true;
      }else{
        const resUpsert = await sb
          .from("leaderboard")
          .upsert(
            { player_uid: playerUid, tournament_id: tid, player_chips: normalizedStake },
            { onConflict: "player_uid,tournament_id" }
          );
        if(!resUpsert?.error){
          S.__stackPersistSource = "leaderboard.upsert(player_uid,tournament_id)";
          return true;
        }
        errors.push({
          source: "leaderboard.upsert(player_uid,tournament_id)",
          error: resUpsert?.error || null
        });
        S.__disableLeaderboardWrite = true;
      }
    }

    const okPlayers = await persistPlayerStackViaPlayers(playerUid, normalizedStake);
    if(okPlayers){
      return true;
    }
    errors.push({ source: "players.*", error: { message: "No writable chip column found in players" } });

    const formattedErrors = errors.map((e) => {
      const er = e?.error || {};
      return {
        source: e.source,
        code: er.code || null,
        message: er.message || null,
        details: er.details || null,
        hint: er.hint || null,
      };
    });

    console.error("persistPlayerStack failed", {
      player_uid: playerUid,
      tournament_id: tid,
      attempted_value: normalizedStake,
      errors: formattedErrors
    });
    return false;
  }

  async function persistDealerSeat(nextSeat){
    if(!S.TABLE_UID || !S.DEALER_UID) return true;
    const seatNum = toPosInt(nextSeat, 1);

    const { error: clearErr } = await sb
      .from("seats")
      .update({ button_position: false })
      .eq("table_uid", S.TABLE_UID)
      .neq("seat_number", seatNum);
    if(clearErr){
      console.error("persistDealerSeat clear button_position error:", clearErr);
      return false;
    }

    const { error: setErr } = await sb
      .from("seats")
      .update({ button_position: true })
      .eq("table_uid", S.TABLE_UID)
      .eq("seat_number", seatNum);
    if(setErr){
      console.error("persistDealerSeat set button_position error:", setErr);
      return false;
    }

    return true;
  }

  function setButtonSeatLocal(seatNum){
    const target = Number(seatNum || 0);
    for(let i=1; i<=S.SEAT_COUNT; i++){
      if(!S.seatState[i]) S.seatState[i] = { player_uid: null, button_position: false };
      S.seatState[i].button_position = (i === target);
    }
  }

  function queueChipSyncAfterDealerUpdate(){
    if(!S.DEALER_UID) return;
    if(!S.handActive) return;
    clearTimeout(S.__dealerChipSyncTimer);
    S.__dealerChipSyncTimer = setTimeout(async () => {
      if(S.__dealerChipSyncInFlight) return;
      S.__dealerChipSyncInFlight = true;
      try{
        await syncStacksToPlayers(true);
      }finally{
        S.__dealerChipSyncInFlight = false;
      }
    }, 120);
  }

  function applyDealerSeatAndSyncBlind(nextSeat){
    const seatNum = Number(nextSeat || 0);
    if(!(seatNum >= 1 && seatNum <= S.SEAT_COUNT)) return;

    const prevSeat = Number(S.dealerPosSeat || 0);
    setButtonSeatLocal(seatNum);
    S.dealerPosSeat = seatNum;
    positionDealerToken();

    if(prevSeat === seatNum){
      updateUI();
      return;
    }

    if(S.handActive && S.DEALER_UID){
      restartHandForBlindChange();
      queueChipSyncAfterDealerUpdate();
      return;
    }
    updateUI();
  }

  function applyLeaderboardChipRow(row){
    if(!row) return false;
    const uid = String(row.player_uid || "").trim();
    if(!uid) return false;
    const hasSeat = getOccupiedSeats().some((seat) => S.seatState?.[seat]?.player_uid === uid);
    if(!hasSeat) return false;

    const chips = toPosInt(row.player_chips, 0);
    S.baseStakeByUid[uid] = chips;
    S.stackByUid[uid] = chips;
    return true;
  }

  async function stopLeaderboardRealtime(){
    if(S.leaderboardChannel){
      try{ await S.leaderboardChannel.unsubscribe(); }catch(e){}
      S.leaderboardChannel = null;
    }
  }

  async function initLeaderboardRealtime(){
    const tid = getTournamentIdSafe();
    if(!S.TABLE_UID || !tid){
      S.__leaderboardRealtimeTid = "";
      await stopLeaderboardRealtime();
      return;
    }

    if(S.leaderboardChannel && S.__leaderboardRealtimeTid === tid){
      return;
    }

    await stopLeaderboardRealtime();
    S.__leaderboardRealtimeTid = tid;

    S.leaderboardChannel = sb.channel('leaderboard-' + S.TABLE_UID + '-' + tid)
      .on('postgres_changes',
        { event:'*', schema:'public', table:'leaderboard', filter:`tournament_id=eq.${tid}` },
        (payload) => {
          const row = payload?.new || payload?.old || null;
          if(!applyLeaderboardChipRow(row)) return;
          updateUI();
        }
      )
      .subscribe();
  }

  function normalizeStructureRow(row){
    return {
      structure_uid: String(row?.structure_uid || "").trim(),
      structure_level: String(row?.structure_level ?? "").trim(),
      sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row.sort_order) : 0,
      is_break: !!row?.is_break,
      break_note: String(row?.break_note || "").trim(),
      small_blind: toPosInt(row?.small_blind, 0),
      big_blind: toPosInt(row?.big_blind, 0),
      bba: toPosInt(row?.bba, 0),
    };
  }

  function applyStructureByIndex(structureUid, idx, { persist = true } = {}){
    const uid = String(structureUid || "");
    const rows = S.structureRowsByUid?.[uid] || [];
    if(!rows.length) return false;

    const safeIdx = Math.max(0, Math.min(Number(idx || 0), rows.length - 1));
    const row = rows[safeIdx];
    S.structureUid = uid;
    S.structureIndexByUid[uid] = safeIdx;
    S.structureLevel = String(row.structure_level || "");
    S.SB = toPosInt(row.small_blind, 0);
    S.BB = toPosInt(row.big_blind, 0);
    S.BBA = toPosInt(row.bba, 0);

    if(structureUidSelect){
      structureUidSelect.value = uid;
    }

    if(persist){
      localStorage.setItem("structure_uid", S.structureUid);
      localStorage.setItem("structure_level", S.structureLevel);
    }
    updateUI();
    return true;
  }

  function renderStructureUidOptions(){
    if(!structureUidSelect) return;
    const uids = Object.keys(S.structureRowsByUid || {}).sort((a, b) => a.localeCompare(b));
    if(!uids.length){
      structureUidSelect.innerHTML = `<option value="">No structure</option>`;
      return;
    }
    structureUidSelect.innerHTML =
      `<option value="">Structure UID</option>` +
      uids.map((uid) => `<option value="${uid}">${uid}</option>`).join("");
  }

  function pickInitialStructureSelection(){
    const savedUid = String(localStorage.getItem("structure_uid") || "");
    const savedLevel = String(localStorage.getItem("structure_level") || "");

    const availableUids = Object.keys(S.structureRowsByUid || {});
    if(!availableUids.length) return false;

    const uid = S.structureRowsByUid[savedUid] ? savedUid : availableUids.sort((a, b) => a.localeCompare(b))[0];
    const rows = S.structureRowsByUid[uid] || [];
    let idx = 0;
    if(savedLevel){
      const found = rows.findIndex((r) => String(r.structure_level) === savedLevel);
      if(found >= 0) idx = found;
    }
    return applyStructureByIndex(uid, idx, { persist: true });
  }

  async function loadStructuresFromDb(){
    const { data, error } = await sb
      .from("structures")
      .select("structure_uid, structure_level, sort_order, is_break, break_note, small_blind, big_blind, bba")
      .order("structure_uid", { ascending: true })
      .order("sort_order", { ascending: true });

    if(error){
      console.error("loadStructuresFromDb error:", error);
      return false;
    }

    const byUid = {};
    for(const raw of (data || [])){
      const row = normalizeStructureRow(raw);
      if(!row.structure_uid) continue;
      if(!byUid[row.structure_uid]) byUid[row.structure_uid] = [];
      byUid[row.structure_uid].push(row);
    }

    Object.keys(byUid).forEach((uid) => {
      byUid[uid].sort((a, b) => {
        const ao = Number(a.sort_order);
        const bo = Number(b.sort_order);
        if(Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
        return String(a.structure_level).localeCompare(String(b.structure_level), undefined, { numeric: true });
      });
    });

    S.structureRowsByUid = byUid;
    renderStructureUidOptions();
    pickInitialStructureSelection();
    return true;
  }

  async function initStructuresOnce(){
    if(S.__structuresLoaded || S.__structuresLoading) return;
    S.__structuresLoading = true;
    const ok = await loadStructuresFromDb();
    S.__structuresLoading = false;
    if(ok) S.__structuresLoaded = true;
  }

  function bindStructureControlsOnce(){
    if(S.__structureControlsBound) return;
    S.__structureControlsBound = true;

    structureUidSelect?.addEventListener("change", () => {
      if(!ctx.requireDealer()) return;
      const uid = String(structureUidSelect.value || "");
      if(!uid){
        Sound.error();
        return;
      }
      applyStructureByIndex(uid, 0, { persist: true });
      if(S.handActive && S.DEALER_UID){
        restartHandForBlindChange();
      }
      Sound.tick();
    });

    blindUpBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      const uid = String(S.structureUid || "");
      const rows = S.structureRowsByUid?.[uid] || [];
      if(!uid || !rows.length){
        Sound.error();
        return;
      }

      const cur = Number(S.structureIndexByUid?.[uid] || 0);
      const next = cur + 1;
      if(next >= rows.length){
        Sound.reject();
        return;
      }

      applyStructureByIndex(uid, next, { persist: true });
      if(S.handActive && S.DEALER_UID){
        restartHandForBlindChange();
      }
      Sound.success();
    });

    blindDownBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      const uid = String(S.structureUid || "");
      const rows = S.structureRowsByUid?.[uid] || [];
      if(!uid || !rows.length){
        Sound.error();
        return;
      }

      const cur = Number(S.structureIndexByUid?.[uid] || 0);
      const next = cur - 1;
      if(next < 0){
        Sound.reject();
        return;
      }

      applyStructureByIndex(uid, next, { persist: true });
      if(S.handActive && S.DEALER_UID){
        restartHandForBlindChange();
      }
      Sound.success();
    });

    dealerBackBtn?.addEventListener("click", async () => {
      if(!ctx.requireDealer()) return;
      await nudgeDealerSeat(-1);
      Sound.tick();
    });

    dealerNextBtn?.addEventListener("click", async () => {
      if(!ctx.requireDealer()) return;
      await nudgeDealerSeat(1);
      Sound.tick();
    });
  }

  async function nudgeDealerSeat(step){
    const dir = (Number(step) >= 0) ? 1 : -1;
    const cur = Number(S.dealerPosSeat || 1);
    const next = ((cur - 1 + dir + S.SEAT_COUNT) % S.SEAT_COUNT) + 1;
    S.dealerPosSeat = next;
    if(S.handActive){
      restartHandForBlindChange();
    }else{
      positionDealerToken();
      updateUI();
    }

    await persistDealerSeat(next);
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
    S.potWinnerGroups = [];
    S.potSelectIndex = -1;
    S.potTapModeBySeat = {};
    S.pendingRefundsBySeat = {};
    S.refundsApplied = false;
    S.autoSettled = false;
    S.bbSeat = null;
    S.bbaPostedBySeat = {};
    S.postedSBAmount = 0;
    S.postedBBAmount = 0;
    S.postedBBAAmount = 0;
    S.handSB = toPosInt(S.SB, 0);
    S.handBB = toPosInt(S.BB, 0);
    S.handBBA = toPosInt(S.BBA, 0);
    S.bbOptionPending = false;
    S.betTarget = 0;
    S.stakeEditMode = false;
    S.stakeEditSeat = null;

    // âœ… pot Ä‘Ã£ gom xong (giá»¯ qua street)
    S.handPot = 0;

    if(streetLabel) streetLabel.textContent = S.handStreet;
  }

  // âœ… Pot hiá»ƒn thá»‹ = pot Ä‘Ã£ gom xong (khÃ´ng cá»™ng bet-float Ä‘ang náº±m ngoÃ i pot)
  function getPotTotal(){
    const base = Number(S.handPot || 0);
    if(S.handActive && S.handStreet === "Preflop"){
      return base + Number(S.postedSBAmount || 0) + Number(S.postedBBAmount || 0);
    }
    return base;
  }

  function getWinnerColorForPot(potIndex){
    const palette = [
      "#f59e0b", "#22d3ee", "#34d399", "#fb7185",
      "#60a5fa", "#f97316", "#a78bfa", "#facc15"
    ];
    const idx = Math.max(0, Number(potIndex || 0)) % palette.length;
    return palette[idx];
  }

  function getWinnerColorForSeat(seatNum){
    const seat = Number(seatNum || 0);
    if(seat <= 0) return getWinnerColorForPot(0);
    if(S.handStreet === "Showdown"){
      const potLen = Number(S.potBreakdown?.length || 0);
      for(let p=0; p<potLen; p++){
        const g = Array.isArray(S.potWinnerGroups?.[p]) ? S.potWinnerGroups[p] : [];
        if(g.includes(seat)) return getWinnerColorForPot(p);
      }
      for(let p=0; p<potLen; p++){
        if(Number(S.potWinners?.[p] || 0) === seat) return getWinnerColorForPot(p);
      }
    }
    return getWinnerColorForPot(0);
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
          const winners = Array.isArray(S.potWinnerGroups?.[i]) ? S.potWinnerGroups[i] : [];
          const wonClass = winners.length > 0 ? " won" : "";
          const selectedClass = Number(S.potSelectIndex) === i ? " selected" : "";
          const splitText = winners.length > 1 ? ` <small>(Split ${winners.length})</small>` : "";
          const style = winners.length > 0 ? ` style=\"--winner-color:${getWinnerColorForPot(i)}\"` : "";
          return (
            `<div class="pot-line${wonClass}${selectedClass}" data-pot-index="${i}"${style}>` +
              `<span class="pot-label">${label}${splitText}</span>` +
              `<span class="pot-amount">${formatChip(amount)}</span>` +
            `</div>`
          );
        }).join("");
        potCenter.innerHTML = `<div class="pot-center-list">${rows}</div>`;
        return;
      }
    }

    potCenter.innerHTML = `<div class="pot-total">${formatChip(total)}</div><small>${S.handStreet}</small>`;
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
    if(!Array.isArray(S.potWinnerGroups)) S.potWinnerGroups = [];
    if(S.potWinnerGroups.length > S.potBreakdown.length){
      S.potWinnerGroups = S.potWinnerGroups.slice(0, S.potBreakdown.length);
    }
    for(let i=0; i<S.potBreakdown.length; i++){
      const group = Array.isArray(S.potWinnerGroups[i]) ? S.potWinnerGroups[i].filter((seat) => Number(seat) > 0) : [];
      if(group.length){
        S.potWinnerGroups[i] = group.map((seat) => Number(seat));
        S.potWinners[i] = Number(group[0] || 0);
        continue;
      }
      const legacy = Number(S.potWinners[i] || 0);
      S.potWinnerGroups[i] = legacy > 0 ? [legacy] : [];
    }
    if(!Number.isFinite(Number(S.potSelectIndex))){
      S.potSelectIndex = -1;
    }
    const maxPotIdx = Math.max(0, S.potBreakdown.length - 1);
    if(S.potBreakdown.length === 1){
      S.potSelectIndex = 0;
    }else if(Number(S.potSelectIndex) >= 0){
      S.potSelectIndex = Math.max(0, Math.min(Number(S.potSelectIndex), maxPotIdx));
    }else{
      S.potSelectIndex = -1;
    }
    S.winnerSeat = S.potWinners[0] ?? null;
  }

  function syncPotWinnersFromGroups(){
    if(!Array.isArray(S.potWinnerGroups)) S.potWinnerGroups = [];
    S.potWinners = S.potWinnerGroups.map((group) => Number((Array.isArray(group) ? group[0] : 0) || 0));
    S.winnerSeat = S.potWinners[0] || null;
  }

  function getFirstIncompletePotIndex(){
    const len = Number(S.potBreakdown?.length || 0);
    for(let i=0; i<len; i++){
      const g = Array.isArray(S.potWinnerGroups?.[i]) ? S.potWinnerGroups[i] : [];
      if(!g.length) return i;
    }
    return Math.max(0, len - 1);
  }

  function isAllInRunout(){
    const alive = getActiveInHandSeats();
    if(alive.length <= 1) return false;
    const seatsWithChips = alive.filter(seat => getSeatStack(seat) > 0).length;
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
    S.potWinnerGroups = winnerSeat ? [[winnerSeat]] : [];
    S.potSelectIndex = -1;
    S.winnerSeat = winnerSeat;
    S.pendingRefundsBySeat = {};
    S.refundsApplied = true;
    S.autoSettled = true;
    S.bbOptionPending = false;
  }

  function isShowdownReadyForPayout(){
    if(S.handStreet !== "Showdown") return false;
    ensureShowdownPots();
    if(!S.potBreakdown.length) return false;
    return S.potBreakdown.every((_, idx) => Array.isArray(S.potWinnerGroups?.[idx]) && S.potWinnerGroups[idx].length > 0);
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
    if(occ.length === 2 && isSeatOccupied(S.dealerPosSeat)){
      return Number(S.dealerPosSeat || 0) || null;
    }
    return occ[0] ?? null;
  }

  function getBBSeat(){
    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    if(occ.length === 2 && isSeatOccupied(S.dealerPosSeat)){
      return occ[0] ?? null;
    }
    return occ[1] ?? null;
  }

  function computeUTGSeat(){
    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    if(occ.length === 2){
      const sbSeat = getSBSeat();
      return sbSeat ?? null;
    }
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

  function firstToActForStreet(street){
    if(street === "Preflop"){
      const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
      if(occ.length === 2){
        const sbSeat = getSBSeat();
        if(sbSeat && isActionableSeat(sbSeat)) return sbSeat;
        if(sbSeat) return findNextActingSeat(sbSeat);
      }
      const utg = computeUTGSeat();
      if(utg && isActionableSeat(utg)) return utg;
      return findNextActingSeat(utg || S.dealerPosSeat);
    }
    const occ = getOccupiedSeatsClockwiseFrom(S.dealerPosSeat);
    if(occ.length === 2){
      const bbSeat = getBBSeat();
      if(bbSeat && isActionableSeat(bbSeat)) return bbSeat;
      if(bbSeat) return findNextActingSeat(bbSeat) || firstToActForStreet("Preflop");
    }
    const sbSeat = getSBSeat();
    if(!sbSeat) return firstToActForStreet("Preflop");
    if(isActionableSeat(sbSeat)) return sbSeat;
    return findNextActingSeat(sbSeat) || firstToActForStreet("Preflop");
  }

  function applyBlindToSeat(seatNum, amount){
    const uid = S.seatState?.[seatNum]?.player_uid;
    if(!uid) return 0;

    const paid = Math.min(Number(amount), Number(S.stackByUid[uid] ?? 0));
    S.stackByUid[uid] = Number(S.stackByUid[uid] ?? 0) - paid;
    S.handState[seatNum].contributed = Number(S.handState[seatNum].contributed || 0) + paid;
    addContribution(seatNum, paid);
    S.handState[seatNum].hasActed = true;
    return paid;
  }

  function applyBBAToSeat(seatNum, amount){
    const uid = S.seatState?.[seatNum]?.player_uid;
    if(!uid) return 0;

    const paid = Math.min(Number(amount), Number(S.stackByUid[uid] ?? 0));
    if(paid <= 0) return 0;

    S.stackByUid[uid] = Number(S.stackByUid[uid] ?? 0) - paid;
    S.handPot = Number(S.handPot || 0) + paid;
    addContribution(seatNum, paid);
    S.bbaPostedBySeat[seatNum] = Number(S.bbaPostedBySeat?.[seatNum] || 0) + paid;
    return paid;
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
    const uid = S.seatState?.[seat]?.player_uid;
    const stack = Number(S.stackByUid[uid] ?? 0);
    const isBBOptionSpot = (
      S.handStreet === "Preflop" &&
      Number(S.bbSeat || 0) === Number(seat) &&
      !!S.bbOptionPending &&
      Number(target || 0) === Number(S.handBB || 0) &&
      toCall === 0
    );

    if(isBBOptionSpot){
      if(draft > 0) return `Raise ${draft}`;
      return "Check";
    }

    if(toCall > 0){
      if(stack > 0 && draft >= stack){
        if(stack > toCall) return `Raise ${formatChip(stack)}`;
        return `Call ${formatChip(stack)}`;
      }
      if(draft > toCall) return `Raise ${formatChip(draft)}`;
      return `Call ${formatChip(toCall)}`;
    }

    if(draft > 0){
      return `Bet ${formatChip(draft)}`;
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
      potWinnerGroups: JSON.parse(JSON.stringify(S.potWinnerGroups || [])),
      potSelectIndex: Number.isFinite(Number(S.potSelectIndex)) ? Number(S.potSelectIndex) : -1,
      potTapModeBySeat: JSON.parse(JSON.stringify(S.potTapModeBySeat || {})),
      potBreakdown: JSON.parse(JSON.stringify(S.potBreakdown || [])),
      pendingRefundsBySeat: JSON.parse(JSON.stringify(S.pendingRefundsBySeat || {})),
      refundsApplied: !!S.refundsApplied,
      autoSettled: !!S.autoSettled,
      bbSeat: S.bbSeat,
      bbOptionPending: !!S.bbOptionPending,
      handSB: S.handSB,
      handBB: S.handBB,
      handBBA: S.handBBA,
      postedSBAmount: S.postedSBAmount,
      postedBBAmount: S.postedBBAmount,
      postedBBAAmount: S.postedBBAAmount,
      handStartStackByUid: JSON.parse(JSON.stringify(S.handStartStackByUid || {})),
      betTarget: S.betTarget,
      handPot: S.handPot,
      totalContribBySeat: JSON.parse(JSON.stringify(S.totalContribBySeat || {})),
      bbaPostedBySeat: JSON.parse(JSON.stringify(S.bbaPostedBySeat || {})),
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
    S.potWinnerGroups = snap.potWinnerGroups || [];
    S.potSelectIndex = Number.isFinite(Number(snap?.potSelectIndex)) ? Number(snap.potSelectIndex) : -1;
    S.potTapModeBySeat = snap.potTapModeBySeat || {};
    S.potBreakdown = snap.potBreakdown || [];
    S.pendingRefundsBySeat = snap.pendingRefundsBySeat || {};
    S.refundsApplied = !!snap.refundsApplied;
    S.autoSettled = !!snap.autoSettled;
    S.bbSeat = snap.bbSeat ?? null;
    S.bbOptionPending = !!snap.bbOptionPending;
    S.handSB = toPosInt(snap.handSB, S.SB);
    S.handBB = toPosInt(snap.handBB, S.BB);
    S.handBBA = toPosInt(snap.handBBA, S.BBA);
    S.postedSBAmount = toPosInt(snap.postedSBAmount, 0);
    S.postedBBAmount = toPosInt(snap.postedBBAmount, 0);
    S.postedBBAAmount = toPosInt(snap.postedBBAAmount, 0);
    S.handStartStackByUid = snap.handStartStackByUid || {};
    S.betTarget = snap.betTarget;
    S.dealerPosSeat = snap.dealerPosSeat;
    S.handPot = Number(snap.handPot || 0);
    S.totalContribBySeat = snap.totalContribBySeat || {};
    S.bbaPostedBySeat = snap.bbaPostedBySeat || {};

    Object.keys(S.stackByUid).forEach(k => delete S.stackByUid[k]);
    Object.keys(snap.stackByUid).forEach(k => S.stackByUid[k] = snap.stackByUid[k]);

    for(let i=1;i<=S.SEAT_COUNT;i++){
      S.handState[i] = snap.handState[i] || { inHand:true, contributed:0, hasActed:false };
    }
    S.handActive = true;

    positionDealerToken();
    return true;
  }

  function addToDraft(x){
    if(!ctx.requireDealer()) return;
    if(S.stakeEditMode){
      addStakeEditChip(x);
      return;
    }
    if(!S.handActive || !S.actingSeat) return;

    const uid = S.seatState?.[S.actingSeat]?.player_uid;
    if(!uid) return;

    const stack = Number(S.stackByUid[uid] ?? 0);
    const next = Math.min(stack, S.betDraft + Number(x));

    pushHistory();
    S.betDraft = next;
    Sound.tick();
    updateUI();
  }

  function normalizeQuickAddValues(values){
    const fallback = [100, 500, 1000];
    if(!Array.isArray(values) || values.length < 3) return fallback;
    return values.slice(0, 3).map((v, idx) => {
      const n = Number(v);
      if(!Number.isFinite(n) || n <= 0) return fallback[idx];
      return Math.trunc(n);
    });
  }

  function loadQuickAddValues(){
    try{
      const raw = localStorage.getItem("quick_add_values");
      if(!raw){
        S.quickAddValues = normalizeQuickAddValues(S.quickAddValues);
        return;
      }
      const parsed = JSON.parse(raw);
      S.quickAddValues = normalizeQuickAddValues(parsed);
    }catch(e){
      S.quickAddValues = normalizeQuickAddValues(S.quickAddValues);
    }
  }

  function saveQuickAddValues(){
    try{
      localStorage.setItem("quick_add_values", JSON.stringify(normalizeQuickAddValues(S.quickAddValues)));
    }catch(e){}
  }

  function applyQuickAddButtonLabels(){
    S.quickAddValues = normalizeQuickAddValues(S.quickAddValues);
    if(q25) q25.textContent = `+${formatChip(S.quickAddValues[0])}`;
    if(q100) q100.textContent = `+${formatChip(S.quickAddValues[1])}`;
    if(q500) q500.textContent = `+${formatChip(S.quickAddValues[2])}`;
  }

  function ensureQuickAssignMenu(){
    if(S.quickAssignMenuEl) return S.quickAssignMenuEl;
    const el = document.createElement("div");
    el.className = "quick-assign-menu";
    document.body.appendChild(el);
    S.quickAssignMenuEl = el;
    return el;
  }

  function closeQuickAssignMenu(){
    const menu = S.quickAssignMenuEl;
    if(!menu) return;
    menu.style.display = "none";
    menu.innerHTML = "";
    if(S.__quickAssignOutsideHandler){
      document.removeEventListener("pointerdown", S.__quickAssignOutsideHandler, true);
      S.__quickAssignOutsideHandler = null;
    }
    if(S.__quickAssignResizeHandler){
      window.removeEventListener("resize", S.__quickAssignResizeHandler);
      S.__quickAssignResizeHandler = null;
    }
    S.__quickAssignTargetBtn = null;
  }

  function openQuickAssignMenu(targetBtn, quickIndex){
    const menu = ensureQuickAssignMenu();
    const rect = targetBtn.getBoundingClientRect();

    menu.innerHTML = QUICK_ASSIGN_OPTIONS
      .map((v) => `<button type="button" class="quick-assign-item" data-v="${v}">+${formatChip(v)}</button>`)
      .join("");
    menu.style.display = "block";

    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
    const top = Math.max(8, rect.top - menuRect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.querySelectorAll(".quick-assign-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        const v = Number(e.currentTarget?.dataset?.v || 0);
        if(v <= 0) return;
        S.quickAddValues = normalizeQuickAddValues(S.quickAddValues);
        S.quickAddValues[quickIndex] = v;
        saveQuickAddValues();
        applyQuickAddButtonLabels();
        Sound.tick();
        closeQuickAssignMenu();
      });
    });

    S.__quickAssignTargetBtn = targetBtn;
    S.__quickAssignOutsideHandler = (ev) => {
      const t = ev.target;
      if(menu.contains(t) || t === S.__quickAssignTargetBtn) return;
      closeQuickAssignMenu();
    };
    document.addEventListener("pointerdown", S.__quickAssignOutsideHandler, true);

    S.__quickAssignResizeHandler = () => closeQuickAssignMenu();
    window.addEventListener("resize", S.__quickAssignResizeHandler);
  }

  function bindQuickAddButton(btn, quickIndex){
    if(!btn) return;
    let holdTimer = null;
    let holdTriggered = false;

    btn.addEventListener("pointerdown", (e) => {
      if(e.button !== undefined && e.button !== 0) return;
      holdTriggered = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdTriggered = true;
        openQuickAssignMenu(btn, quickIndex);
      }, S.HOLD_TIME);
    });

    const onPointerEnd = () => {
      if(holdTimer){
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if(holdTriggered){
        holdTriggered = false;
        return;
      }
      S.quickAddValues = normalizeQuickAddValues(S.quickAddValues);
      const val = Number(S.quickAddValues[quickIndex] || 0);
      if(val > 0) addToDraft(val);
    };

    btn.addEventListener("pointerup", onPointerEnd);
    btn.addEventListener("pointercancel", () => {
      if(holdTimer){
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      holdTriggered = false;
    });
    btn.addEventListener("pointerleave", () => {
      if(holdTimer){
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    });
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
    const beforeStacks = JSON.parse(JSON.stringify(S.stackByUid || {}));

    const stack = Number(S.stackByUid[uid] ?? 0);
    const amt = Math.min(S.betDraft, stack);
    if(amt <= 0) return false;

    const beforeTarget = Number(S.betTarget || 0);

    S.stackByUid[uid] = stack - amt;
    // Safety: this action may only change actor stack, never other seats.
    Object.keys(beforeStacks).forEach((k) => {
      if(k === uid) return;
      S.stackByUid[k] = Number(beforeStacks[k] ?? S.stackByUid[k] ?? 0);
    });
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
      Number(S.betTarget || 0) === Number(S.handBB || 0)
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

    // Snapshot stacks before posting any blind for this hand.
    S.handStartStackByUid = JSON.parse(JSON.stringify(S.stackByUid || {}));

    // set inHand false cho gháº¿ trá»‘ng
    for(let i=1;i<=S.SEAT_COUNT;i++){
      if(!isSeatOccupied(i)) S.handState[i].inHand = false;
    }

    const sbSeat = getSBSeat();
    const bbSeat = getBBSeat();

    S.handSB = toPosInt(S.SB, 0);
    S.handBB = toPosInt(S.BB, 0);
    S.handBBA = toPosInt(S.BBA, 0);

    S.postedSBAmount = sbSeat ? Number(applyBlindToSeat(sbSeat, S.handSB) || 0) : 0;
    S.postedBBAmount = bbSeat ? Number(applyBlindToSeat(bbSeat, S.handBB) || 0) : 0;
    S.postedBBAAmount = bbSeat ? Number(applyBBAToSeat(bbSeat, S.handBBA) || 0) : 0;

    // Safety guard: only SB/BB seats may lose chips from blind posting.
    // Any non-blind occupied seat is restored to hand-start snapshot.
    const blindSeats = new Set([Number(sbSeat || 0), Number(bbSeat || 0)]);
    for(let seat=1; seat<=S.SEAT_COUNT; seat++){
      const uid = S.seatState?.[seat]?.player_uid;
      if(!uid) continue;
      if(blindSeats.has(Number(seat))) continue;
      if(S.handStartStackByUid?.[uid] === undefined) continue;
      S.stackByUid[uid] = Number(S.handStartStackByUid[uid] ?? S.stackByUid[uid] ?? 0);
    }

    S.bbSeat = bbSeat ?? null;
    S.bbOptionPending = !!bbSeat
      && Number(S.handState?.[bbSeat]?.contributed || 0) >= Number(S.handBB || 0)
      && getSeatStack(bbSeat) > 0;

    recomputeBetTarget();

    // Preflop first action = UTG (skip all-in/zero-stack seats)
    S.actingSeat = firstToActForStreet("Preflop");

    // reset winner lock
    S.winnerSeat = null;
    S.potBreakdown = [];
    S.potWinners = [];
    S.potWinnerGroups = [];
    S.potSelectIndex = -1;
    S.potTapModeBySeat = {};

    updateUI();
    renderSeats();
  }

  function restartHandForBlindChange(){
    const snap = S.handStartStackByUid || {};
    const hasSnap = Object.keys(snap).length > 0;

    if(hasSnap){
      Object.keys(S.stackByUid).forEach((k) => delete S.stackByUid[k]);
      Object.keys(snap).forEach((k) => {
        S.stackByUid[k] = Number(snap[k] ?? 0);
      });
    }else{
      // Fallback: return all committed amounts from current hand if no snapshot exists.
      for(let seat=1; seat<=S.SEAT_COUNT; seat++){
        const uid = S.seatState?.[seat]?.player_uid;
        if(!uid) continue;
        const committed = Number(S.totalContribBySeat?.[seat] || 0);
        if(committed > 0){
          S.stackByUid[uid] = Number(S.stackByUid[uid] ?? 0) + committed;
        }
      }
    }

    startNewHandLocal();
  }

  function enterStakeEditMode(){
    if(!ctx.requireDealer()) return false;
    if(!S.stakeEditLockOpen){
      Sound.error();
      return false;
    }

    const snapshot = S.handStartStackByUid || {};
    const hasSnapshot = Object.keys(snapshot).length > 0;
    if(hasSnapshot){
      Object.keys(S.stackByUid).forEach((k) => delete S.stackByUid[k]);
      Object.keys(snapshot).forEach((k) => {
        S.stackByUid[k] = Number(snapshot[k] ?? 0);
      });
    }

    resetHandState();
    S.handActive = false;
    S.actingSeat = null;
    S.betDraft = 0;
    S.stakeEditMode = true;
    S.stakeEditSeat = null;
    S.stakeEditHistory = [];
    S.stakeEditTapStateBySeat = {};

    Sound.tick();
    updateUI();
    return true;
  }

  function getStakeEditSmallBlindUnit(){
    const uid = String(S.structureUid || "");
    const rows = S.structureRowsByUid?.[uid] || [];
    const curIdx = Number(S.structureIndexByUid?.[uid] || 0);
    const safeIdx = Math.max(0, Math.min(curIdx, Math.max(0, rows.length - 1)));
    const curRow = rows[safeIdx] || null;

    let sb = toPosInt(curRow?.small_blind, toPosInt(S.SB, 1));
    if(curRow?.is_break){
      let nextSb = 0;
      for(let i=safeIdx + 1; i<rows.length; i++){
        const r = rows[i];
        if(!r || r.is_break) continue;
        nextSb = toPosInt(r.small_blind, 0);
        if(nextSb > 0) break;
      }
      if(nextSb > 0) sb = nextSb;
    }

    const fixedUnits = [500, 1000, 5000, 10000, 50000, 100000];
    let unit = 500;
    for(const v of fixedUnits){
      if(v <= sb) unit = v;
      else break;
    }
    return Math.max(500, unit);
  }

  function applyStakeEditSeatTap(seatNum, { forceZero = false } = {}){
    if(!S.stakeEditMode) return false;

    const seat = Number(seatNum || 0);
    if(!(seat >= 1 && seat <= S.SEAT_COUNT)){
      Sound.error();
      return false;
    }

    const uid = S.seatState?.[seat]?.player_uid;
    if(!uid){
      Sound.error();
      return false;
    }

    S.stakeEditSeat = seat;
    const cur = Math.max(0, Math.trunc(Number(S.stackByUid[uid] ?? 0)));
    const unit = getStakeEditSmallBlindUnit();

    if(!S.stakeEditTapStateBySeat || typeof S.stakeEditTapStateBySeat !== "object"){
      S.stakeEditTapStateBySeat = {};
    }
    const seatKey = String(seat);
    const seatTapState = S.stakeEditTapStateBySeat[seatKey] || { aligned: false };

    let next = cur;
    if(forceZero){
      next = 0;
      seatTapState.aligned = true;
    }else if(!seatTapState.aligned){
      const floored = Math.floor(cur / unit) * unit;
      next = (cur > 0 && cur === floored) ? Math.max(0, cur - unit) : floored;
      seatTapState.aligned = true;
    }else{
      next = Math.max(0, cur - unit);
    }
    S.stakeEditTapStateBySeat[seatKey] = seatTapState;

    if(next !== cur){
      if(!Array.isArray(S.stakeEditHistory)) S.stakeEditHistory = [];
      S.stakeEditHistory.push({ uid, prev: cur, seat });
      S.stackByUid[uid] = next;
    }

    Sound.tick();
    updateUI();
    return true;
  }

  function addStakeEditChip(amount){
    if(!S.stakeEditMode) return false;
    const seat = Number(S.stakeEditSeat || 0);
    if(!seat){
      Sound.error();
      return false;
    }

    const uid = S.seatState?.[seat]?.player_uid;
    if(!uid){
      Sound.error();
      return false;
    }

    const cur = Number(S.stackByUid[uid] ?? 0);
    if(!Array.isArray(S.stakeEditHistory)) S.stakeEditHistory = [];
    S.stakeEditHistory.push({ uid, prev: cur, seat });
    const next = Math.max(0, Math.trunc(cur + Number(amount || 0)));
    S.stackByUid[uid] = next;
    Sound.tick();
    updateUI();
    return true;
  }

  function undoStakeEditStep(){
    if(!S.stakeEditMode) return false;
    if(!Array.isArray(S.stakeEditHistory) || S.stakeEditHistory.length === 0) return false;
    const step = S.stakeEditHistory.pop();
    if(!step?.uid) return false;
    S.stackByUid[step.uid] = Math.max(0, Math.trunc(Number(step.prev ?? 0)));
    if(Number(step.seat || 0) > 0) S.stakeEditSeat = Number(step.seat);
    return true;
  }

  async function syncStakeEditMode(){
    if(!S.stakeEditMode){
      enterStakeEditMode();
      return;
    }

    const updates = [];

    for(const seat of getOccupiedSeats()){
      const uid = S.seatState?.[seat]?.player_uid;
      if(!uid) continue;

      const stake = toPosInt(S.stackByUid?.[uid], 0);
      updates.push({ player_uid: uid, player_chips: stake });
    }
    if(updates.length){
      const probe = updates[0];
      const okProbe = await persistPlayerStack(probe.player_uid, probe.player_chips);
      if(!okProbe){
        const msg = `Update Stake failed for ${probe.player_uid}. Check console: persistPlayerStack failed`;
        console.error("syncStakeEditMode error: failed to persist player stack", {
          row: probe,
          source: S.__stackPersistSource || null
        });
        Sound.error();
        alert(msg);
        return;
      }
    }

    const results = await Promise.all(
      updates.slice(1).map(async (row) => ({
        row,
        ok: await persistPlayerStack(row.player_uid, row.player_chips)
      }))
    );
    const failed = results.find((r) => !r.ok);
    if(failed){
      const msg = `Update Stake failed for ${failed.row.player_uid}. Check console: persistPlayerStack failed`;
      console.error("syncStakeEditMode error: failed to persist player stack", {
        row: failed.row,
        source: S.__stackPersistSource || null
      });
      Sound.error();
      alert(msg);
      return;
    }

    updates.forEach((row) => {
      S.baseStakeByUid[row.player_uid] = Number(row.player_chips || 0);
      S.stackByUid[row.player_uid] = Number(row.player_chips || 0);
    });

    S.stakeEditMode = false;
    S.stakeEditSeat = null;
    S.stakeEditTapStateBySeat = {};
    S.stakeEditLockOpen = false;
    S.stakeEditHistory = [];

    if(S.DEALER_UID){
      startNewHandLocal();
    }else{
      updateUI();
    }
    Sound.success();
  }

  // ===== advance dealer + payout winner =====
  async function advanceDealerButtonAndNewHand(){
    if(!ctx.requireDealer()) return;

    // chá»‰ cho payout khi showdown + Ä‘Ã£ chá»n winner
    if(S.handActive && S.handStreet === "Showdown" && !S.autoSettled && isShowdownReadyForPayout()){
      ensureShowdownPots();
      for(let idx=0; idx<S.potBreakdown.length; idx++){
        const pot = Number(S.potBreakdown[idx]?.amount || 0);
        const winners = Array.isArray(S.potWinnerGroups?.[idx]) ? S.potWinnerGroups[idx] : [];
        const distributed = distributePotToWinners(pot, winners);
        Object.keys(distributed).forEach((seatKey) => {
          const winSeat = Number(seatKey || 0);
          if(!winSeat || !isSeatOccupied(winSeat)) return;
          const uidW = S.seatState?.[winSeat]?.player_uid;
          if(!uidW) return;
          S.stackByUid[uidW] = Number(S.stackByUid[uidW] ?? 0) + Number(distributed[seatKey] || 0);
        });
      }
    }

    const synced = await syncStacksToPlayers();
    if(!synced){
      Sound.error();
      alert("Sync chips failed. Please slide again.");
      updateUI();
      return;
    }

    S.winnerSeat = null;
    S.potBreakdown = [];
    S.potWinners = [];
    S.potWinnerGroups = [];
    S.potSelectIndex = -1;
    S.potTapModeBySeat = {};
    S.pendingRefundsBySeat = {};
    S.refundsApplied = false;
    S.autoSettled = false;
    S.betDraft = 0;

    const nextDealer = findNextOccupiedSeat(S.dealerPosSeat) ?? S.dealerPosSeat;
    S.dealerPosSeat = nextDealer;
    positionDealerToken();

    await persistDealerSeat(nextDealer);

    startNewHandLocal();
  }

  async function syncStacksToPlayers(silent = false){
    const updates = [];
    for(let i=1;i<=S.SEAT_COUNT;i++){
      const uid = S.seatState?.[i]?.player_uid;
      if(!uid) continue;
      const stake = toPosInt(S.stackByUid?.[uid], 0);
      updates.push({ player_uid: uid, player_chips: stake });
    }

    if(!updates.length) return true;
    {
      const probe = updates[0];
      const okProbe = await persistPlayerStack(probe.player_uid, probe.player_chips);
      if(!okProbe){
        console.error("syncStacksToPlayers error: failed to persist player stack", {
          row: probe,
          source: S.__stackPersistSource || null
        });
        if(!silent){
          alert(`Sync chips failed for ${probe.player_uid}. Check console: persistPlayerStack failed`);
        }
        return false;
      }
    }

    const results = await Promise.all(
      updates.slice(1).map(async (row) => ({
        row,
        ok: await persistPlayerStack(row.player_uid, row.player_chips)
      }))
    );
    const failed = results.find((r) => !r.ok);
    if(failed){
      console.error("syncStacksToPlayers error: failed to persist player stack", {
        row: failed.row,
        source: S.__stackPersistSource || null
      });
      if(!silent){
        alert(`Sync chips failed for ${failed.row.player_uid}. Check console: persistPlayerStack failed`);
      }
      return false;
    }

    updates.forEach((row) => {
      S.baseStakeByUid[row.player_uid] = Number(row.player_chips || 0);
    });
    return true;
  }

  // ===== UI render =====
  function renderSeats(){
    if(!tableEl) return;

    const rect = tableEl.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rX = cx - S.SEAT_SIZE/2 - S.TABLE_BORDER - S.SAFE_PADDING + 50;
    const rY = cy - S.SEAT_SIZE/2 - S.TABLE_BORDER - S.SAFE_PADDING + 50;

    const showdownPayoutPreview = getShowdownPayoutPreviewBySeat();

    for(let i=1;i<=S.SEAT_COUNT;i++){
      const s = S.seats[i];
      if(!s?.el) continue;

      const angle = (Math.PI*2/S.SEAT_COUNT)*(i-S.TOP_SEAT) - Math.PI/2;

      s.el.style.left = (cx + Math.cos(angle)*rX) + 'px';
      s.el.style.top  = (cy + Math.sin(angle)*rY) + 'px';
      s.el.style.transform = 'translate(-50%,-50%)';

      s.el.classList.remove('occupied','acting','winner','folded','acting-phase-1','acting-phase-2','stake-edit-target');
      s.el.style.removeProperty("--winner-color");

      const uid = S.seatState[i]?.player_uid;
      const hs = S.handState[i];

      if(uid){
        s.el.classList.add('occupied');
        const stack = Number(S.stackByUid[uid] ?? 0);
        s.stakeEl.textContent = isFinite(stack) ? formatChip(stack) : "-";
      }else{
        s.stakeEl.textContent = "-";
      }

      if(S.stakeEditMode && Number(S.stakeEditSeat || 0) === i){
        s.el.classList.add('stake-edit-target');
      }

      if(S.handActive && hs?.inHand === false) s.el.classList.add('folded');
      if(S.handActive && S.actingSeat === i){
        s.el.classList.add('acting');
        s.el.classList.add(Number(S.__actRingPhase || 1) === 2 ? 'acting-phase-2' : 'acting-phase-1');
      }
      const wonFromSplit = (S.potWinnerGroups || []).some((group) => Array.isArray(group) && group.includes(i));
      if(wonFromSplit || (S.potWinners || []).includes(i) || S.winnerSeat === i){
        s.el.classList.add('winner');
        s.el.style.setProperty("--winner-color", getWinnerColorForSeat(i));
      }

      const bf = S.betFloats[i]?.el;
      if(bf){
        let show = false;
        let text = "";
        let draft = false;
        let payout = false;

        const contributed = Number(S.handState[i]?.contributed || 0);
        if(contributed > 0){
          show = true;
          text = formatChip(contributed);
        }
        if(S.handActive && S.actingSeat === i && S.betDraft > 0){
          show = true;
          text = formatChip((Number(S.handState[i]?.contributed || 0) + S.betDraft));
          draft = true;
        }
        if(!show && S.handActive && S.handStreet === "Showdown"){
          const gain = Number(showdownPayoutPreview?.[i] || 0);
          if(gain > 0){
            show = true;
            text = `+${formatChip(gain)}`;
            payout = true;
          }
        }

        bf.textContent = text;
        bf.classList.toggle("show", show);
        bf.classList.toggle("draft", draft);
        bf.classList.toggle("payout", payout);
        positionBetFloat(i);
      }

      const bbaf = S.bbaFloats?.[i]?.el;
      if(bbaf){
        const bba = Number(S.bbaPostedBySeat?.[i] || 0);
        const showBBA = S.handActive
          && S.handStreet === "Preflop"
          && Number(S.bbSeat || 0) === i
          && bba > 0;
        bbaf.textContent = showBBA ? `(${formatChip(bba)})` : "";
        bbaf.classList.toggle("show", showBBA);
        positionBBAFloat(i);
      }
    }

    positionDealerToken();
  }

  function updateUI(){
    if(S.__lastActingSeat !== S.actingSeat || S.__lastActionStreet !== S.handStreet){
      S.__actRingPhase = (Number(S.__actRingPhase || 0) % 2) + 1; // 1 <-> 2 to restart CSS animation
      S.__lastActingSeat = S.actingSeat;
      S.__lastActionStreet = S.handStreet;
    }

    if(blindLabel) blindLabel.textContent = `${formatChip(S.SB)} / ${formatChip(S.BB)}(${formatChip(S.BBA)})`;
    if(levelLabel) levelLabel.textContent = S.structureLevel || "-";
    if(streetLabel) streetLabel.textContent = S.handStreet;

    const pot = getPotTotal();
    if(potLabel) potLabel.textContent = formatChip(pot);
    renderCenterPot();

    const toCall = (S.handActive && S.actingSeat) ? getToCallForSeat(S.actingSeat) : 0;
    if(toCallLabel) toCallLabel.textContent = formatChip(toCall);
    if(draftLabel) draftLabel.textContent = formatChip(S.betDraft);

    if(betBtn){
      betBtn.textContent = getBetButtonLabel();
    }

    if(actingTitle){
      if(S.stakeEditMode){
        actingTitle.textContent = S.stakeEditSeat ? `Edit Seat ${S.stakeEditSeat}` : "";
      }else{
        actingTitle.textContent = "";
      }
    }

    const inActionPhase = (S.handActive && S.actingSeat && S.handStreet !== "Showdown");
    const disabled = (!S.DEALER_UID || !inActionPhase || S.isSubmitting || S.stakeEditMode);

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
      const canUndoStakeEdit = S.stakeEditMode && Array.isArray(S.stakeEditHistory) && S.stakeEditHistory.length > 0;
      const canUndoHand = !S.stakeEditMode && S.handHistory.length > 0;
      backBtn.disabled = (!S.DEALER_UID || (!canUndoStakeEdit && !canUndoHand));
      backBtn.style.opacity = backBtn.disabled ? 0.55 : 1;
    }

    if(blindUpBtn){
      const uid = String(S.structureUid || "");
      const rows = S.structureRowsByUid?.[uid] || [];
      const idx = Number(S.structureIndexByUid?.[uid] || 0);
      const canBlindUp = !!S.DEALER_UID && !!S.stakeEditLockOpen && !S.stakeEditMode && rows.length > 0 && idx < (rows.length - 1);
      blindUpBtn.disabled = !canBlindUp;
      blindUpBtn.style.opacity = canBlindUp ? 1 : 0.55;
    }

    if(blindDownBtn){
      const uid = String(S.structureUid || "");
      const rows = S.structureRowsByUid?.[uid] || [];
      const idx = Number(S.structureIndexByUid?.[uid] || 0);
      const canBlindDown = !!S.DEALER_UID && !!S.stakeEditLockOpen && !S.stakeEditMode && rows.length > 0 && idx > 0;
      blindDownBtn.disabled = !canBlindDown;
      blindDownBtn.style.opacity = canBlindDown ? 1 : 0.55;
    }
    if(structureUidSelect){
      const canPickStructure = !!S.DEALER_UID && !!S.stakeEditLockOpen && !S.stakeEditMode;
      structureUidSelect.disabled = !canPickStructure;
      structureUidSelect.style.opacity = canPickStructure ? 1 : 0.55;
    }

    [dealerBackBtn, dealerNextBtn].forEach((btn) => {
      if(!btn) return;
      const canMoveDealer = !!S.DEALER_UID && !!S.stakeEditLockOpen && !S.stakeEditMode;
      btn.disabled = !canMoveDealer;
      btn.style.opacity = canMoveDealer ? 1 : 0.55;
    });

    if(stakeLockBtn){
      const locked = !S.stakeEditLockOpen;
      stakeLockBtn.textContent = locked ? "\uD83D\uDD12" : "\uD83D\uDD13";
      stakeLockBtn.disabled = !S.DEALER_UID || S.stakeEditMode;
      stakeLockBtn.style.opacity = stakeLockBtn.disabled ? 0.55 : 1;
    }
    if(updateStakeBtn){
      updateStakeBtn.textContent = S.stakeEditMode ? "Sync" : "Edit Stack";
      const canUpdateStake = !!S.DEALER_UID && !!S.stakeEditLockOpen;
      updateStakeBtn.disabled = !canUpdateStake;
      updateStakeBtn.style.opacity = canUpdateStake ? 1 : 0.55;
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

    loadQuickAddValues();
    applyQuickAddButtonLabels();
    bindQuickAddButton(q25, 0);
    bindQuickAddButton(q100, 1);
    bindQuickAddButton(q500, 2);

    stakeLockBtn?.addEventListener("click", () => {
      if(!ctx.requireDealer()) return;
      if(S.stakeEditMode){
        Sound.reject();
        return;
      }
      S.stakeEditLockOpen = !S.stakeEditLockOpen;
      Sound.tick();
      updateUI();
    });

    updateStakeBtn?.addEventListener("click", async () => {
      if(!ctx.requireDealer()) return;
      await syncStakeEditMode();
      updateUI();
    });

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
      if(S.stakeEditMode){
        if(undoStakeEditStep()){
          Sound.tick();
          updateUI();
        }
        return;
      }
      if(!S.handHistory.length) return;

      if(popHistory()){
        Sound.tick();
        updateUI();
      }
    });

    bindSliderOnce();

    potCenter?.addEventListener("click", (e) => {
      if(!ctx.requireDealer()) return;
      if(!(S.handActive && S.handStreet === "Showdown")) return;

      ensureShowdownPots();
      const potLen = Number(S.potBreakdown?.length || 0);
      if(!potLen){
        Sound.error();
        return;
      }

      const potRow = e.target?.closest?.(".pot-line[data-pot-index]");
      if(!potRow) return;

      const target = Number(potRow.dataset.potIndex || 0);
      if(!(target >= 0 && target < potLen)){
        Sound.error();
        return;
      }

      S.potSelectIndex = target;
      Sound.tick();
      updateUI();
    });
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
      .from('seats')
      .select('seat_number, button_position')
      .eq('table_uid', S.TABLE_UID);
    if(error){
      console.error("fetchDealerSeat from seats error:", error);
      return;
    }

    const rows = data || [];
    for(const r of rows){
      const seatNum = Number(r?.seat_number || 0);
      if(seatNum >= 1 && seatNum <= S.SEAT_COUNT){
        if(!S.seatState[seatNum]) S.seatState[seatNum] = { player_uid: null, button_position: false };
        S.seatState[seatNum].button_position = !!r?.button_position;
      }
    }
    const btnRow = rows.find((r) => !!r?.button_position);
    if(btnRow){
      applyDealerSeatAndSyncBlind(Number(btnRow.seat_number));
      return;
    }
    positionDealerToken();
    updateUI();
  }

  async function initTableStateRealtime(){
    if(S.tableStateChannel){
      try{ await S.tableStateChannel.unsubscribe(); }catch(e){}
      S.tableStateChannel = null;
    }
  }

  // ===== Seats creation =====
  function initPanelOnce(){
    if(S.panelInited) return;
    S.panelInited = true;

    if(!tableEl) cacheDom();
    if(typeof S.stakeEditLockOpen !== "boolean") S.stakeEditLockOpen = false;
    if(typeof S.stakeEditMode !== "boolean") S.stakeEditMode = false;
    if(S.stakeEditSeat === undefined) S.stakeEditSeat = null;

    for(let i=1;i<=S.SEAT_COUNT;i++){
      S.seatState[i] = { player_uid: null, button_position: false };

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

        if (S.stakeEditMode) {
          S.holdTimer = setTimeout(() => {
            S.didHold = true;
            applyStakeEditSeatTap(i, { forceZero: true });
          }, S.HOLD_TIME);
          return;
        }

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
        if(S.stakeEditMode){
          if(Number(S.stakeEditSeat || 0) !== Number(i)){
            S.stakeEditSeat = i;
            Sound.tick();
            updateUI();
            return;
          }
          applyStakeEditSeatTap(i);
          return;
        }

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

        if(!Array.isArray(S.potWinnerGroups)) S.potWinnerGroups = [];
        const potLen = Number(S.potBreakdown?.length || 0);
        if(!potLen){
          Sound.error();
          return;
        }

        const potIndex = Number(S.potSelectIndex);
        if(!(potIndex >= 0 && potIndex < potLen)){
          Sound.error();
          return;
        }
        const eligible = Array.isArray(S.potBreakdown?.[potIndex]?.eligibleSeats) ? S.potBreakdown[potIndex].eligibleSeats : [];
        let canPick = eligible.includes(i);
        if(!canPick && potLen === 1){
          const alive = getActiveInHandSeats();
          const isHeadsUpSinglePot = alive.length === 2;
          if(isHeadsUpSinglePot && alive.includes(i)){
            canPick = true;
          }
        }
        if(!canPick){
          Sound.error();
          return;
        }

        if(!Array.isArray(S.potWinnerGroups[potIndex])) S.potWinnerGroups[potIndex] = [];
        const group = S.potWinnerGroups[potIndex];
        const idx = group.indexOf(i);
        if(idx >= 0){
          group.splice(idx, 1);
          syncPotWinnersFromGroups();
          Sound.tick();
          updateUI();
          return;
        }

        group.push(i);
        syncPotWinnersFromGroups();
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

      if(!S.bbaFloats) S.bbaFloats = {};
      const bbaf = document.createElement("div");
      bbaf.className = "bba-float";
      bbaf.textContent = "";
      S.bbaFloats[i] = { el: bbaf };
      tableEl.appendChild(bbaf);
    }

    resetHandState();
    renderSeats();

    window.addEventListener("resize", () => renderSeats());
    bindButtonsOnce();
    bindStructureControlsOnce();
  }

  // ===== DB seats load + realtime =====
  async function loadSeats(){
    if(!S.TABLE_UID) return;

    for(let i=1;i<=S.SEAT_COUNT;i++){
      S.seatState[i] = { player_uid: null, button_position: false };
    }

    const { data } = await sb.from('seats').select('*').eq('table_uid', S.TABLE_UID);
    (data||[]).forEach(r => {
      const seatNum = Number(r?.seat_number || 0);
      if(!(seatNum >= 1 && seatNum <= S.SEAT_COUNT)) return;
      S.seatState[seatNum].player_uid = r.player_uid;
      S.seatState[seatNum].button_position = !!r?.button_position;
      if(!!r?.button_position) applyDealerSeatAndSyncBlind(seatNum);
    });

    renderSeats();
    positionDealerToken();
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
          const row = p?.new || p?.old || {};
          const seatNum = Number(row?.seat_number || 0);
          if(!(seatNum >= 1 && seatNum <= S.SEAT_COUNT)) return;
          if(!S.seatState[seatNum]) S.seatState[seatNum] = { player_uid: null, button_position: false };
          S.seatState[seatNum].player_uid = row?.player_uid ?? null;
          S.seatState[seatNum].button_position = !!row?.button_position;
          if(!!row?.button_position){
            applyDealerSeatAndSyncBlind(seatNum);
          }

          clearTimeout(S.stakeRefreshTimer);
          S.stakeRefreshTimer = setTimeout(() => {
            refreshStakesForOccupiedSeats().then(() => {
              initLeaderboardRealtime();
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

    if(S.handActive && S.handStreet === "Preflop"){
      restartHandForBlindChange();
      updateUI();
      return;
    }

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
    S.stakeEditMode = false;
    S.stakeEditSeat = null;
    S.stakeEditLockOpen = false;
    S.stakeEditHistory = [];
    await initStructuresOnce();

    await loadSeats();
    await refreshStakesForOccupiedSeats();
    await initLeaderboardRealtime();

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
    initStructuresOnce().then(() => updateUI());
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
