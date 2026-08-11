/* ============================================================
   자산 시뮬레이터 — app.js
   모든 데이터는 기기 localStorage 에만 저장됩니다. (서버 전송 없음)
   금액 단위: 만원
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'assetsim.state.v1';
  var VERSION = '1.0.0';
  var THIS_YEAR = new Date().getFullYear();

  /* ─────────────── 계좌 구분 ───────────────
     색상과 자산 구성 그래프의 묶음 단위. 수익률과는 무관합니다. */
  var ACCOUNTS = {
    realestate: { label: '부동산',           color: '--c-realestate' },
    us:         { label: '미국주식',          color: '--c-us' },
    kr:         { label: '한국주식',          color: '--c-kr' },
    isa:        { label: 'ISA',              color: '--c-isa' },
    pension:    { label: '연금 (퇴직연금·IRP)', color: '--c-pension' },
    crypto:     { label: '암호화폐',          color: '--c-crypto' },
    gold:       { label: '금 · 원자재',       color: '--c-gold' },
    cash:       { label: '현금 · 예수금',      color: '--c-cash' },
    etc:        { label: '기타 자산',         color: '--c-etc' }
  };
  var ACCT_ORDER = ['realestate', 'us', 'kr', 'isa', 'pension', 'crypto', 'gold', 'cash', 'etc'];

  /* ─────────────── 종목 · 상품별 통상 수익률 ───────────────
     rate = 통상 장기 수익률 범위(lo~hi)의 중간값. 사용자가 직접 수정하지 않습니다.
     sens = 시나리오 조정폭 민감도(변동성 대리지표).
     mix  = 다른 종목의 가중 조합. rate/sens 를 구성종목에서 자동 계산합니다. */
  var INSTRUMENTS = {
    /* 부동산 */
    apt_seoul: { g: '부동산', label: '서울 아파트', lo: 3.0, hi: 6.0, sens: 0.7,
                 note: 'KB 서울 아파트 매매가격지수 장기 추세' },
    apt_metro: { g: '부동산', label: '수도권 아파트', lo: 2.5, hi: 4.5, sens: 0.65 },
    apt_other: { g: '부동산', label: '지방 · 전국 아파트', lo: 2.0, hi: 3.0, sens: 0.6 },

    /* 미국주식 (1배) */
    qqq:    { g: '미국주식', label: '나스닥100 1배 (QQQ)', lo: 10.0, hi: 13.0, sens: 1.2 },
    spy:    { g: '미국주식', label: 'S&P500 1배 (SPY · VOO)', lo: 8.0, hi: 11.0, sens: 1.0 },
    dgro:   { g: '미국주식', label: 'DGRO 배당성장', lo: 8.0, hi: 10.0, sens: 0.9 },
    soxx:   { g: '미국주식', label: '미국 반도체 1배 (SOXX)', lo: 11.0, hi: 17.0, sens: 1.7 },
    us_etc: { g: '미국주식', label: '기타 미국주식 · ETF', lo: 8.0, hi: 11.0, sens: 1.1 },

    /* 미국 레버리지 — 변동성 손실(decay)과 조달비용을 반영한 값 */
    qld:  { g: '미국 레버리지', label: '나스닥100 2배 (QLD)', lo: 5.0, hi: 20.0, sens: 3.0, lev: 2,
            note: '기초지수 2배가 아닙니다. 변동성 손실·조달비용 반영' },
    upro: { g: '미국 레버리지', label: 'S&P500 3배 (UPRO · SPXL)', lo: 3.0, hi: 20.0, sens: 3.6, lev: 3,
            note: '변동성 손실이 가장 큰 구간. 급락장 회복이 매우 느림' },
    usdx: { g: '미국 레버리지', label: 'USD 미국 반도체 2배', lo: -2.0, hi: 18.0, sens: 3.4, lev: 2,
            note: '반도체 변동성이 커 1배보다 기대값이 낮아질 수 있음' },
    soxl: { g: '미국 레버리지', label: 'SOXL 미국 반도체 3배', lo: -20.0, hi: 8.0, sens: 4.5, lev: 3,
            note: '장기 보유 시 기대값이 음(−)에 가깝습니다. 변동성 손실이 수익을 잠식' },

    /* 국내상장 해외ETF */
    kodex_ndx:    { g: '국내상장 해외ETF', label: 'KODEX 미국나스닥100', lo: 10.0, hi: 13.0, sens: 1.2 },
    tiger_ndx2:   { g: '국내상장 해외ETF', label: 'TIGER 미국나스닥100레버리지(합성)',
                    lo: 5.0, hi: 20.0, sens: 3.0, lev: 2 },
    tiger_ndx_cc: { g: '국내상장 해외ETF', label: 'TIGER 미국나스닥100타겟데일리커버드콜',
                    lo: 6.0, hi: 10.0, sens: 0.95,
                    note: '분배율은 높지만 상승 상단이 잘려 총수익은 지수보다 낮음' },
    ace_ndx_b50:  { g: '국내상장 해외ETF', label: 'ACE 미국나스닥100미국채혼합50액티브',
                    mix: [['qqq', 0.5], ['agg', 0.5]] },

    /* 암호화폐 */
    btc:      { g: '암호화폐', label: '비트코인 (BTC)', lo: -10.0, hi: 30.0, sens: 3.2,
                note: '실패~지속 채택 시나리오의 중간값. 과거 −80% 급락이 네 차례' },
    eth:      { g: '암호화폐', label: '이더리움 (ETH)', lo: -15.0, hi: 30.0, sens: 3.8,
                note: '경쟁 체인 리스크로 BTC보다 하방이 넓음' },
    altcoin:  { g: '암호화폐', label: '기타 알트코인', lo: -30.0, hi: 25.0, sens: 4.5,
                note: '대부분의 알트코인은 장기적으로 가치를 잃습니다' },
    coincash: { g: '암호화폐', label: '거래소 예치금 (KRW)', lo: 1.6, hi: 2.6, sens: 0.1 },

    /* 금 · 원자재 */
    gold: { g: '금 · 원자재', label: '금 현물 (99.99)', lo: 3.0, hi: 6.0, sens: 0.7,
            note: '장기 실질수익률은 0에 가깝고 명목으로는 물가 수준' },

    /* 현금성 · 채권 */
    sgov:      { g: '현금성 · 채권', label: 'SGOV 초단기 미국국채', lo: 3.0, hi: 4.0, sens: 0.15 },
    agg:       { g: '현금성 · 채권', label: '미국 종합채권 (AGG)', lo: 3.5, hi: 5.5, sens: 0.4 },
    krcash:    { g: '현금성 · 채권', label: '예금 · 파킹통장', lo: 2.5, hi: 3.5, sens: 0.15 },
    usdcash:   { g: '현금성 · 채권', label: '외화예수금 (달러)', lo: 0.0, hi: 2.0, sens: 0.3,
                 note: '이자가 붙지 않아 원화 기준으로는 환율 변동만 반영' },
    krdeposit: { g: '현금성 · 채권', label: '증권사 예수금 (원화)', lo: 0.0, hi: 1.0, sens: 0.1 },

    /* 한국주식 */
    kospi:  { g: '한국주식', label: '코스피 지수', lo: 4.0, hi: 6.0, sens: 1.2 },
    kr_etc: { g: '한국주식', label: '기타 한국주식', lo: 4.0, hi: 6.0, sens: 1.4 },

    /* 혼합 포트폴리오 */
    qqq_agg_5050: { g: '혼합 포트폴리오', label: '나스닥1배 · 채권 5:5',
                    mix: [['qqq', 0.5], ['agg', 0.5]] },
    pen_blend:    { g: '혼합 포트폴리오', label: '나스닥1배 70% + (나스닥1배·채권 5:5) 30%',
                    mix: [['qqq', 0.7], ['qqq_agg_5050', 0.3]] }
  };

  /** 종목의 적용 수익률·민감도를 확정 (혼합상품은 구성종목 가중평균) */
  function resolve(sym) {
    var it = INSTRUMENTS[sym];
    if (!it) return { rate: 0, sens: 1, lo: 0, hi: 0, label: '알 수 없음' };
    if (it._r == null) {
      if (it.mix) {
        var r = 0, s = 0, lo = 0, hi = 0;
        it.mix.forEach(function (m) {
          var c = resolve(m[0]);
          r += c.rate * m[1]; s += c.sens * m[1]; lo += c.lo * m[1]; hi += c.hi * m[1];
        });
        it._r = Math.round(r * 10) / 10; it._s = Math.round(s * 100) / 100;
        it._lo = Math.round(lo * 10) / 10; it._hi = Math.round(hi * 10) / 10;
      } else {
        it._r = Math.round((it.lo + it.hi) / 2 * 10) / 10;   // 통상 범위의 중간값
        it._s = it.sens; it._lo = it.lo; it._hi = it.hi;
      }
    }
    return { rate: it._r, sens: it._s, lo: it._lo, hi: it._hi,
             label: it.label, g: it.g, lev: it.lev, note: it.note };
  }

  /* 계좌 구분을 처음 고를 때 붙는 기본 종목 */
  var ACCT_DEFAULT_SYM = {
    realestate: 'apt_seoul', us: 'qqq', kr: 'kospi', isa: 'qld',
    pension: 'pen_blend', crypto: 'btc', gold: 'gold', cash: 'krdeposit', etc: 'us_etc'
  };

  /* ─────────────── 적립 계획 ─────────────── */
  var FREQ = { d: { label: '매 영업일', per: 252 }, w: { label: '매주', per: 52 }, m: { label: '매월', per: 12 } };

  /** 'YYYY-MM' → 월 인덱스 */
  function ymIndex(s) {
    var m = /^(\d{4})-(\d{1,2})/.exec(String(s || ''));
    if (!m) return null;
    var mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return (+m[1]) * 12 + (mo - 1);
  }

  /** 특정 연도에 이 계획으로 실제 납입되는 금액 (기간 겹침만큼 안분) */
  function planYearAmount(p, year) {
    var amt = num(p && p.amount);
    if (!amt) return 0;
    var f = FREQ[p.freq] || FREQ.m;
    var ys = year * 12, ye = ys + 12;
    var ps = ymIndex(p.from); if (ps == null) ps = -Infinity;
    var pe = ymIndex(p.to);   pe = (pe == null) ? Infinity : pe + 1;   // 종료월 포함
    var months = Math.max(0, Math.min(ye, pe) - Math.max(ys, ps));
    return amt * f.per * (months / 12);
  }

  /** 한 자산의 해당 연도 총 적립액 */
  function annualContrib(plans, year) {
    if (!plans || !plans.length) return 0;
    return plans.reduce(function (s, p) { return s + planYearAmount(p, year); }, 0);
  }

  var DEBT_TYPES = {
    annuity:        '원리금균등상환',
    equalPrincipal: '원금균등상환',
    bullet:         '만기일시상환 (이자만)'
  };

  /* ═══════════════ 유틸 ═══════════════ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function id() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function cvar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /** 만원 단위 숫자를 "N억 N,NNN만" 형태로 */
  function won(man, opt) {
    opt = opt || {};
    var v = Math.round(num(man));
    var sign = v < 0 ? '-' : '';
    v = Math.abs(v);
    var eok = Math.floor(v / 10000), rest = v % 10000;
    if (eok > 0) {
      if (opt.short) return sign + (v / 10000).toFixed(v >= 1000000 ? 0 : 1).replace(/\.0$/, '') + '억';
      return sign + eok.toLocaleString() + '억' + (rest ? ' ' + rest.toLocaleString() + '만' : '');
    }
    return sign + v.toLocaleString() + '만';
  }
  /** 축 라벨용 (억 단위) */
  function wonAxis(man) {
    var v = num(man) / 10000;
    if (Math.abs(v) >= 100) return Math.round(v) + '억';
    if (Math.abs(v) >= 10) return v.toFixed(0) + '억';
    if (Math.abs(v) >= 1) return v.toFixed(1).replace(/\.0$/, '') + '억';
    if (Math.abs(man) < 1) return '0';
    return Math.round(man).toLocaleString() + '만';
  }
  function comma(v) { var n = num(v); return n ? n.toLocaleString() : (v === 0 || v === '0' ? '0' : ''); }
  function signed(v) { return (v >= 0 ? '+' : '') + won(v); }
  function todayISO() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function isoToFrac(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return THIS_YEAR;
    var y = d.getFullYear();
    var start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
    return y + (d - start) / (end - start);
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2200);
  }

  /* ═══════════════ 상태 ═══════════════ */
  function defaultState() {
    return {
      v: 1,
      settings: {
        years: 30, inflation: 2.3, contribGrowth: 0,
        cons: -2.5, opti: 2.5,
        birthYear: '', theme: 'auto', terms: 'nominal'
      },
      assets: [
        { id: id(), acct: 'realestate', sym: 'apt_seoul', name: '우리집 아파트 (서울)', amount: 80000, plans: [], on: true },

        /* 해외주식 계좌 */
        { id: id(), acct: 'us', sym: 'qld',  name: 'QLD',  amount: 8059, plans: [], on: true },
        { id: id(), acct: 'us', sym: 'sgov', name: 'SGOV', amount: 3134, plans: [], on: true },
        { id: id(), acct: 'us', sym: 'usdx', name: 'USD (반도체 2배)', amount: 1862, plans: [], on: true },
        { id: id(), acct: 'us', sym: 'dgro', name: 'DGRO', amount: 1858, plans: [], on: true },
        { id: id(), acct: 'us', sym: 'upro', name: 'UPRO', amount: 1823, plans: [], on: true },
        { id: id(), acct: 'cash', sym: 'usdcash', name: '달러 예수금 (해외주식)', amount: 230, plans: [], on: true },

        /* 종합계좌 */
        { id: id(), acct: 'us', sym: 'soxl', name: 'SOXL (반도체 3배)', amount: 594, plans: [], on: true },
        { id: id(), acct: 'cash', sym: 'usdcash', name: '달러 예수금 (종합)', amount: 97, plans: [], on: true },

        /* ISA */
        { id: id(), acct: 'isa', sym: 'tiger_ndx_cc', name: 'TIGER 나스닥100 데일리커버드콜', amount: 1425, plans: [], on: true },
        { id: id(), acct: 'isa', sym: 'tiger_ndx2',   name: 'TIGER 나스닥100 레버리지',      amount: 726, plans: [], on: true },
        { id: id(), acct: 'isa', sym: 'krdeposit',    name: 'ISA 예수금',                   amount: 79, plans: [], on: true },

        /* 퇴직연금 DC */
        { id: id(), acct: 'pension', sym: 'kodex_ndx',   name: 'KODEX 미국나스닥100',   amount: 3502, plans: [], on: true },
        { id: id(), acct: 'pension', sym: 'ace_ndx_b50', name: 'ACE 나스닥100 미국채혼합50', amount: 1481, plans: [], on: true },
        { id: id(), acct: 'pension', sym: 'krdeposit',   name: '연금 현금성자산',        amount: 2, plans: [], on: true },

        /* 암호화폐 */
        { id: id(), acct: 'crypto', sym: 'btc', name: '비트코인 (0.09 BTC)', amount: 815, plans: [], on: true },
        { id: id(), acct: 'crypto', sym: 'eth', name: '이더리움 (1 ETH)',    amount: 266, plans: [], on: true },

        /* 금현물 */
        { id: id(), acct: 'gold', sym: 'gold', name: '금 현물 1kg', amount: 160, plans: [], on: true }
      ],
      debts: [
        { id: id(), name: '주택담보대출', balance: 30000, rate: 3.8, years: 25, grace: 0, type: 'annuity', extra: 0, on: true }
      ],
      goal: { year: THIS_YEAR + 15, net: 200000 },
      history: []
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      return migrate(s);
    } catch (e) {
      console.warn('저장 데이터를 읽지 못했습니다.', e);
      return defaultState();
    }
  }

  function migrate(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    s.settings = Object.assign({}, d.settings, s.settings || {});
    s.goal = Object.assign({}, d.goal, s.goal || {});
    s.assets = Array.isArray(s.assets) ? s.assets : d.assets;
    s.debts = Array.isArray(s.debts) ? s.debts : d.debts;
    s.history = Array.isArray(s.history) ? s.history : [];
    s.assets.forEach(function (a) {
      if (!a.id) a.id = id();
      if (!a.acct) a.acct = ACCOUNTS[a.cat] ? a.cat : 'etc';   // 구버전(cat) 호환
      if (!ACCOUNTS[a.acct]) a.acct = 'etc';
      if (!INSTRUMENTS[a.sym]) a.sym = ACCT_DEFAULT_SYM[a.acct];
      delete a.cat; delete a.rate;                              // 수익률은 종목에서 결정
      if (!Array.isArray(a.plans)) {                            // 구버전(monthly) → 적립 계획
        a.plans = num(a.monthly) > 0
          ? [{ id: id(), freq: 'm', amount: num(a.monthly), from: '', to: '' }] : [];
      }
      a.plans.forEach(function (p) {
        if (!p.id) p.id = id();
        if (!FREQ[p.freq]) p.freq = 'm';
        p.amount = num(p.amount);
        p.from = String(p.from || ''); p.to = String(p.to || '');
      });
      delete a.monthly;
      if (a.on === undefined) a.on = true;
    });
    s.debts.forEach(function (x) {
      if (!x.id) x.id = id();
      if (!DEBT_TYPES[x.type]) x.type = 'annuity';
      if (x.on === undefined) x.on = true;
    });
    s.v = 1;
    return s;
  }

  var saveTimer;
  function save(now) {
    clearTimeout(saveTimer);
    var doIt = function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        var el = $('#saveState');
        if (el) el.textContent = '마지막 저장 ' + new Date().toLocaleString('ko-KR');
      } catch (e) {
        toast('저장 실패 — 저장 공간을 확인해 주세요');
      }
    };
    if (now) doIt(); else saveTimer = setTimeout(doIt, 350);
  }

  /* ═══════════════ 시뮬레이션 엔진 ═══════════════ */

  /** 대출 1년치 상환 진행 (월 단위 상각) */
  function stepDebtYear(d) {
    var i = num(d.rate) / 100 / 12;
    var totalM = Math.max(0, Math.round(num(d.years) * 12));
    var graceM = clamp(Math.round(num(d.grace) * 12), 0, totalM);
    var interest = 0, principal = 0;

    for (var m = 0; m < 12; m++) {
      if (d.bal <= 0.005) { d.bal = 0; break; }
      var int = d.bal * i;
      var remaining = totalM - d.elapsed;
      var pr;

      if (remaining <= 0) {
        pr = d.bal;                                   // 만기 도래 → 잔액 일시상환
      } else if (d.elapsed < graceM || d.type === 'bullet') {
        pr = 0;                                       // 거치기간 / 만기일시 → 이자만
      } else if (d.type === 'equalPrincipal') {
        pr = d.base / Math.max(1, totalM - graceM);   // 원금균등
      } else {
        pr = (i > 0 ? d.bal * i / (1 - Math.pow(1 + i, -remaining)) : d.bal / remaining) - int;
      }
      pr += num(d.extra);
      pr = clamp(pr, 0, d.bal);

      d.bal -= pr;
      interest += int;
      principal += pr;
      d.elapsed++;
    }
    return { interest: interest, principal: principal };
  }

  /**
   * offsetPP: 시나리오 조정폭(%p). 자산군 민감도(sens)가 곱해집니다.
   * 반환: [{year, assets, debt, net, byAcct, interest, principal}]
   */
  function project(offsetPP) {
    var S = state.settings;
    var N = clamp(Math.round(num(S.years)) || 30, 1, 60);
    var g = num(S.contribGrowth) / 100;

    var assets = state.assets.filter(function (a) { return a.on; })
      .map(function (a) {
        var m = resolve(a.sym);
        return { acct: a.acct, val: num(a.amount), rate: m.rate, sens: m.sens, plans: a.plans || [] };
      });
    var debts = state.debts.filter(function (d) { return d.on; })
      .map(function (d) {
        return { type: d.type, rate: num(d.rate), years: num(d.years), grace: num(d.grace),
                 extra: num(d.extra), bal: num(d.balance), base: num(d.balance), elapsed: 0 };
      });

    var rows = [];
    function snap(y, interest, principal) {
      var byAcct = {}, tot = 0;
      assets.forEach(function (a) { byAcct[a.acct] = (byAcct[a.acct] || 0) + a.val; tot += a.val; });
      var debt = debts.reduce(function (s, d) { return s + d.bal; }, 0);
      rows.push({ year: y, assets: tot, debt: debt, net: tot - debt, byAcct: byAcct,
                  interest: interest || 0, principal: principal || 0 });
    }

    snap(THIS_YEAR, 0, 0);

    for (var k = 1; k <= N; k++) {
      var year = THIS_YEAR + k;
      assets.forEach(function (a) {
        var r = Math.max(-0.95, (a.rate + offsetPP * a.sens) / 100);
        var contrib = annualContrib(a.plans, year) * Math.pow(1 + g, k - 1);
        // 연중 균등 납입 근사: 평균 반년치 수익 반영
        a.val = a.val * (1 + r) + contrib * Math.pow(1 + r, 0.5);
      });
      var ti = 0, tp = 0;
      debts.forEach(function (d) { var r = stepDebtYear(d); ti += r.interest; tp += r.principal; });
      snap(THIS_YEAR + k, ti, tp);
    }
    return rows;
  }

  /** 실질(현재가치) 환산 */
  function toReal(rows) {
    var inf = num(state.settings.inflation) / 100;
    return rows.map(function (r) {
      var f = Math.pow(1 + inf, r.year - THIS_YEAR);
      var byAcct = {};
      for (var k in r.byAcct) byAcct[k] = r.byAcct[k] / f;
      return { year: r.year, assets: r.assets / f, debt: r.debt / f, net: r.net / f,
               byAcct: byAcct, interest: r.interest / f, principal: r.principal / f };
    });
  }

  var cache = null;
  function sim() {
    if (cache) return cache;
    var S = state.settings;
    var base = project(0);
    var cons = project(num(S.cons));
    var opti = project(num(S.opti));
    if (S.terms === 'real') { base = toReal(base); cons = toReal(cons); opti = toReal(opti); }
    cache = { base: base, cons: cons, opti: opti };
    return cache;
  }
  function invalidate() { cache = null; }

  /** 목표 곡선: 기준 시점의 순자산 → 목표 순자산 (CAGR 보간) */
  function goalCurve(fromNet, fromX, toYear, target) {
    var span = Math.max(0.25, toYear - fromX);
    var useCagr = fromNet > 0 && target > 0;
    var g = useCagr ? Math.pow(target / fromNet, 1 / span) - 1 : 0;
    var at = function (x) {
      var t = x - fromX;
      return useCagr ? fromNet * Math.pow(1 + g, t) : fromNet + (target - fromNet) * (t / span);
    };
    var pts = [[fromX, fromNet]];
    for (var y = Math.ceil(fromX); y <= toYear; y++) if (y > fromX) pts.push([y, at(y)]);
    if (pts[pts.length - 1][0] < toYear) pts.push([toYear, target]);
    return { points: pts, cagr: useCagr ? g : null, at: at };
  }

  /** [ [x,y], ... ] 위에서의 선형 보간 */
  function interp(pairs, x) {
    if (!pairs.length) return null;
    if (x <= pairs[0][0]) return pairs[0][1];
    if (x >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
    for (var i = 1; i < pairs.length; i++) {
      if (pairs[i][0] >= x) {
        var t = (x - pairs[i - 1][0]) / (pairs[i][0] - pairs[i - 1][0]);
        return pairs[i - 1][1] + (pairs[i][1] - pairs[i - 1][1]) * t;
      }
    }
    return null;
  }

  /* ═══════════════ 렌더 : 자산 / 부채 ═══════════════ */

  function totals() {
    var a = 0, d = 0, byAcct = {};
    state.assets.forEach(function (x) {
      if (!x.on) return;
      a += num(x.amount);
      byAcct[x.acct] = (byAcct[x.acct] || 0) + num(x.amount);
    });
    state.debts.forEach(function (x) { if (x.on) d += num(x.balance); });
    return { assets: a, debts: d, net: a - d, byAcct: byAcct };
  }

  /** 종목 선택 <select> 의 optgroup 마크업 */
  function symOptions() {
    var groups = [], byGroup = {};
    Object.keys(INSTRUMENTS).forEach(function (k) {
      var g = INSTRUMENTS[k].g;
      if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
      byGroup[g].push(k);
    });
    return groups.map(function (g) {
      return '<optgroup label="' + g + '">' + byGroup[g].map(function (k) {
        return '<option value="' + k + '">' + INSTRUMENTS[k].label + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }

  function assetCard(a) {
    var c = ACCOUNTS[a.acct] || ACCOUNTS.etc;
    var node = document.createElement('div');
    node.className = 'item' + (a.on ? '' : ' is-off');
    node.dataset.id = a.id;
    node.innerHTML =
      '<div class="item-head">' +
        '<span class="item-swatch" style="background:' + cvar(c.color) + '"></span>' +
        '<span class="item-title">' +
          '<input class="item-name" data-f="name" value="" placeholder="항목 이름">' +
          '<span class="item-meta"></span>' +
        '</span>' +
        '<span class="item-amt"></span>' +
        '<button class="item-toggle" aria-label="상세"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '</div>' +
      '<div class="item-body">' +
        '<div class="grid-2">' +
          '<div class="field full"><label>보유 종목 · 상품</label>' +
            '<select data-f="sym">' + symOptions() + '</select></div>' +
          '<div class="field full"><label>계좌 구분</label>' +
            '<select data-f="acct">' + ACCT_ORDER.map(function (k) {
              return '<option value="' + k + '">' + ACCOUNTS[k].label + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field full"><label>현재 평가금액</label>' +
            '<div class="suffix-wrap"><input type="text" inputmode="numeric" data-f="amount"><span class="suffix">만원</span></div></div>' +
        '</div>' +
        '<div class="rate-note" data-rate></div>' +
        '<div class="plans">' +
          '<div class="plans-head"><span>적립 계획</span>' +
            '<button class="btn-ghost" data-act="addplan">+ 추가</button></div>' +
          '<div class="plan-list" data-plans></div>' +
          '<div class="plan-total" data-plantotal></div>' +
        '</div>' +
        '<div class="item-actions">' +
          '<button class="btn-mini" data-act="toggle"></button>' +
          '<button class="btn-mini danger" data-act="del">삭제</button>' +
        '</div>' +
      '</div>';

    $('[data-f=name]', node).value = a.name || '';
    $('[data-f=sym]', node).value = a.sym;
    $('[data-f=acct]', node).value = a.acct;
    $('[data-f=amount]', node).value = comma(a.amount);
    $('[data-act=toggle]', node).textContent = a.on ? '계산에서 제외' : '계산에 포함';
    renderPlans(node, a);

    $('[data-act=addplan]', node).addEventListener('click', function () {
      a.plans = a.plans || [];
      a.plans.push({ id: id(), freq: 'm', amount: 0, from: ymNow(), to: '' });
      renderPlans(node, a); refreshCard(node, a); softUpdate();
    });

    // 헤더 열기/닫기
    $('.item-toggle', node).addEventListener('click', function () { node.classList.toggle('is-open'); });

    // 필드 변경
    $$('[data-f]', node).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var f = inp.dataset.f;
        if (f === 'acct') {
          a.acct = inp.value;
          $('.item-swatch', node).style.background = cvar((ACCOUNTS[a.acct] || ACCOUNTS.etc).color);
        } else if (f === 'sym') {
          a.sym = inp.value;
        } else if (f === 'name') {
          a.name = inp.value;
        } else {
          a[f] = num(inp.value);
        }
        refreshCard(node, a);
        softUpdate();
      });
      if (inp.dataset.f === 'amount') {
        inp.addEventListener('blur', function () { inp.value = comma(a.amount); });
        inp.addEventListener('focus', function () { inp.value = a.amount || ''; });
      }
    });

    $('[data-act=toggle]', node).addEventListener('click', function () {
      a.on = !a.on;
      node.classList.toggle('is-off', !a.on);
      this.textContent = a.on ? '계산에서 제외' : '계산에 포함';
      softUpdate();
    });
    $('[data-act=del]', node).addEventListener('click', function () {
      if (!confirm('“' + (a.name || '이 항목') + '”을(를) 삭제할까요?')) return;
      state.assets = state.assets.filter(function (x) { return x.id !== a.id; });
      renderAssets(); softUpdate();
    });

    refreshCard(node, a);
    return node;
  }

  /** 이번 달 'YYYY-MM' */
  function ymNow() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function ymLabel(s) {
    var m = /^(\d{4})-(\d{1,2})/.exec(String(s || ''));
    return m ? m[1] + '.' + String(+m[2]).padStart(2, '0') : null;
  }

  /** 적립 계획 목록 그리기 */
  function renderPlans(node, a) {
    var box = $('[data-plans]', node);
    if (!box) return;
    a.plans = a.plans || [];
    box.innerHTML = '';

    if (!a.plans.length) {
      box.innerHTML = '<div class="plan-empty">적립 없음 — 매수 계획이 있으면 추가하세요</div>';
      updatePlanTotal(node, a);
      return;
    }

    a.plans.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'plan';
      row.innerHTML =
        '<div class="plan-r1">' +
          '<select data-p="freq">' + Object.keys(FREQ).map(function (k) {
            return '<option value="' + k + '">' + FREQ[k].label + '</option>';
          }).join('') + '</select>' +
          '<div class="suffix-wrap"><input type="text" inputmode="numeric" data-p="amount"><span class="suffix">만원</span></div>' +
          '<button class="plan-del" aria-label="삭제"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button>' +
        '</div>' +
        '<div class="plan-r2">' +
          '<input type="month" data-p="from">' +
          '<span class="tilde">~</span>' +
          '<input type="month" data-p="to">' +
        '</div>' +
        '<div class="plan-sum" data-sum></div>';

      $('[data-p=freq]', row).value = p.freq;
      $('[data-p=amount]', row).value = comma(p.amount);
      $('[data-p=from]', row).value = p.from || '';
      $('[data-p=to]', row).value = p.to || '';

      $$('[data-p]', row).forEach(function (inp) {
        inp.addEventListener('input', function () {
          var f = inp.dataset.p;
          p[f] = (f === 'amount') ? num(inp.value) : inp.value;
          planSum(row, p);
          updatePlanTotal(node, a);
          refreshCard(node, a);
          softUpdate();
        });
      });
      var amtIn = $('[data-p=amount]', row);
      amtIn.addEventListener('blur', function () { amtIn.value = comma(p.amount); });
      amtIn.addEventListener('focus', function () { amtIn.value = p.amount || ''; });

      $('.plan-del', row).addEventListener('click', function () {
        a.plans = a.plans.filter(function (x) { return x.id !== p.id; });
        renderPlans(node, a); refreshCard(node, a); softUpdate();
      });

      planSum(row, p);
      box.appendChild(row);
    });
    updatePlanTotal(node, a);
  }

  function planSum(row, p) {
    var el = $('[data-sum]', row);
    if (!el) return;
    var f = FREQ[p.freq] || FREQ.m;
    var yearly = num(p.amount) * f.per;
    var from = ymLabel(p.from), to = ymLabel(p.to);
    el.innerHTML = yearly
      ? '연 <b>' + comma(Math.round(yearly)) + '만원</b> · ' +
        (from || '지금부터') + ' ~ ' + (to || '계속')
      : '<span class="warn-t">금액을 입력하세요</span>';
  }

  function updatePlanTotal(node, a) {
    var el = $('[data-plantotal]', node);
    if (!el) return;
    var next = annualContrib(a.plans, THIS_YEAR + 1);
    var open = (a.plans || []).some(function (p) { return num(p.amount) > 0 && !ymIndex(p.to); });
    var future = [];
    for (var y = THIS_YEAR; y <= THIS_YEAR + 60; y++) {
      if (annualContrib(a.plans, y) > 0) future.push(y);
    }
    if (!future.length) { el.textContent = ''; return; }
    el.innerHTML = '내년(' + (THIS_YEAR + 1) + ') 적립액 <b>' + comma(Math.round(next)) + '만원</b>' +
      ' · 적립 기간 ' + future[0] + '년 ~ ' + (open ? '계속' : future[future.length - 1] + '년');
  }

  function refreshCard(node, a) {
    var m = resolve(a.sym);
    var yc = annualContrib(a.plans, THIS_YEAR + 1);
    $('.item-amt', node).textContent = won(a.amount);
    $('.item-meta', node).textContent =
      m.label + ' · 연 ' + m.rate.toFixed(1) + '%' +
      (yc ? ' · 적립 연 ' + comma(Math.round(yc)) + '만' : '');

    var rn = $('[data-rate]', node);
    if (rn) {
      rn.innerHTML =
        '<div class="rate-main">' +
          '<span>적용 수익률</span>' +
          '<b>연 ' + m.rate.toFixed(1) + '%</b>' +
        '</div>' +
        '<div class="rate-range">통상 범위 ' + m.lo.toFixed(1) + ' ~ ' + m.hi.toFixed(1) + '% 의 중간값' +
          (m.lev ? ' · <span class="lev">' + m.lev + '배 레버리지</span>' : '') + '</div>' +
        (m.note ? '<div class="rate-desc">' + m.note + '</div>' : '');
    }
  }

  function debtCard(d) {
    var node = document.createElement('div');
    node.className = 'item' + (d.on ? '' : ' is-off');
    node.innerHTML =
      '<div class="item-head">' +
        '<span class="item-swatch" style="background:' + cvar('--c-debt') + '"></span>' +
        '<span class="item-title">' +
          '<input class="item-name" data-f="name" placeholder="대출 이름">' +
          '<span class="item-meta"></span>' +
        '</span>' +
        '<span class="item-amt neg"></span>' +
        '<button class="item-toggle" aria-label="상세"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '</div>' +
      '<div class="item-body">' +
        '<div class="grid-2">' +
          '<div class="field full"><label>상환 방식</label>' +
            '<select data-f="type">' + Object.keys(DEBT_TYPES).map(function (k) {
              return '<option value="' + k + '">' + DEBT_TYPES[k] + '</option>';
            }).join('') + '</select></div>' +
          '<div class="field"><label>현재 대출잔액</label>' +
            '<div class="suffix-wrap"><input type="text" inputmode="numeric" data-f="balance"><span class="suffix">만원</span></div></div>' +
          '<div class="field"><label>연 이자율</label>' +
            '<div class="suffix-wrap"><input type="text" inputmode="decimal" data-f="rate"><span class="suffix">%</span></div></div>' +
          '<div class="field"><label>남은 상환기간</label>' +
            '<div class="suffix-wrap"><input type="text" inputmode="decimal" data-f="years"><span class="suffix">년</span></div></div>' +
          '<div class="field"><label>남은 거치기간</label>' +
            '<div class="suffix-wrap"><input type="text" inputmode="decimal" data-f="grace"><span class="suffix">년</span></div></div>' +
          '<div class="field full"><label>매월 추가 상환액 (선택)</label>' +
            '<div class="suffix-wrap"><input type="text" inputmode="numeric" data-f="extra"><span class="suffix">만원</span></div></div>' +
        '</div>' +
        '<p class="hint" data-pay></p>' +
        '<div class="item-actions">' +
          '<button class="btn-mini" data-act="toggle"></button>' +
          '<button class="btn-mini danger" data-act="del">삭제</button>' +
        '</div>' +
      '</div>';

    $('[data-f=name]', node).value = d.name || '';
    $('[data-f=type]', node).value = d.type;
    $('[data-f=balance]', node).value = comma(d.balance);
    $('[data-f=rate]', node).value = d.rate;
    $('[data-f=years]', node).value = d.years;
    $('[data-f=grace]', node).value = d.grace;
    $('[data-f=extra]', node).value = comma(d.extra);
    $('[data-act=toggle]', node).textContent = d.on ? '계산에서 제외' : '계산에 포함';

    $('.item-toggle', node).addEventListener('click', function () { node.classList.toggle('is-open'); });

    $$('[data-f]', node).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var f = inp.dataset.f;
        if (f === 'name' || f === 'type') d[f] = inp.value; else d[f] = num(inp.value);
        refreshDebt(node, d); softUpdate();
      });
      if (['balance', 'extra'].indexOf(inp.dataset.f) >= 0) {
        inp.addEventListener('blur', function () { inp.value = comma(d[inp.dataset.f]); });
        inp.addEventListener('focus', function () { inp.value = d[inp.dataset.f] || ''; });
      }
    });

    $('[data-act=toggle]', node).addEventListener('click', function () {
      d.on = !d.on;
      node.classList.toggle('is-off', !d.on);
      this.textContent = d.on ? '계산에서 제외' : '계산에 포함';
      softUpdate();
    });
    $('[data-act=del]', node).addEventListener('click', function () {
      if (!confirm('“' + (d.name || '이 대출') + '”을(를) 삭제할까요?')) return;
      state.debts = state.debts.filter(function (x) { return x.id !== d.id; });
      renderDebts(); softUpdate();
    });

    refreshDebt(node, d);
    return node;
  }

  /** 첫 달 납입액 추정 (표시용) */
  function firstPayment(d) {
    var i = num(d.rate) / 100 / 12;
    var n = Math.max(1, Math.round(num(d.years) * 12));
    var graceM = Math.round(num(d.grace) * 12);
    var bal = num(d.balance);
    var int = bal * i;
    if (graceM > 0 || d.type === 'bullet') return { total: int + num(d.extra), int: int, pr: num(d.extra) };
    if (d.type === 'equalPrincipal') { var pr = bal / n; return { total: int + pr + num(d.extra), int: int, pr: pr + num(d.extra) }; }
    var pmt = i > 0 ? bal * i / (1 - Math.pow(1 + i, -n)) : bal / n;
    return { total: pmt + num(d.extra), int: int, pr: pmt - int + num(d.extra) };
  }

  function refreshDebt(node, d) {
    $('.item-amt', node).textContent = '-' + won(d.balance);
    $('.item-meta', node).textContent =
      DEBT_TYPES[d.type] + ' · 연 ' + num(d.rate).toFixed(2) + '% · ' + num(d.years) + '년';
    var p = firstPayment(d);
    var pay = $('[data-pay]', node);
    if (pay) {
      pay.innerHTML = '첫 달 상환액 약 <b>' + Math.round(p.total).toLocaleString() + '만원</b> ' +
        '(이자 ' + Math.round(p.int).toLocaleString() + '만 · 원금 ' + Math.round(p.pr).toLocaleString() + '만)';
    }
  }

  function renderAssets() {
    var box = $('#assetList');
    box.innerHTML = '';
    if (!state.assets.length) {
      box.innerHTML = '<div class="empty">보유 자산을 추가해 주세요.</div>';
      return;
    }
    state.assets.forEach(function (a) { box.appendChild(assetCard(a)); });
  }

  function renderDebts() {
    var box = $('#debtList');
    box.innerHTML = '';
    if (!state.debts.length) {
      box.innerHTML = '<div class="empty">대출이 없다면 비워 두세요.</div>';
      return;
    }
    state.debts.forEach(function (d) { box.appendChild(debtCard(d)); });
  }

  function renderAlloc() {
    var t = totals();
    var bar = $('#allocBar'), leg = $('#allocLegend');
    bar.innerHTML = ''; leg.innerHTML = '';
    if (t.assets <= 0) { bar.innerHTML = '<span style="width:100%;background:var(--surface-3)"></span>'; return; }
    ACCT_ORDER.forEach(function (k) {
      var v = t.byAcct[k] || 0;
      if (v <= 0) return;
      var pct = v / t.assets * 100;
      var s = document.createElement('span');
      s.style.width = pct + '%';
      s.style.background = cvar(ACCOUNTS[k].color);
      bar.appendChild(s);
      var i = document.createElement('i');
      i.style.setProperty('--dot', cvar(ACCOUNTS[k].color));
      i.textContent = ACCOUNTS[k].label.split(' (')[0].split(' · ')[0] + ' ' + pct.toFixed(0) + '%';
      leg.appendChild(i);
    });
  }

  /** 데이터 탭 · 종목별 적용 수익률 표 */
  function renderRateRef() {
    var box = $('#rateRef');
    if (!box) return;
    var groups = [], byGroup = {};
    Object.keys(INSTRUMENTS).forEach(function (k) {
      var g = INSTRUMENTS[k].g;
      if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
      byGroup[g].push(k);
    });
    var used = {};
    state.assets.forEach(function (a) { if (a.on) used[a.sym] = true; });

    box.innerHTML = groups.map(function (g) {
      return '<div class="rr-group">' + g + '</div>' +
        byGroup[g].map(function (k) {
          var m = resolve(k);
          return '<div class="rr' + (used[k] ? ' is-used' : '') + '">' +
            '<span class="rr-name">' + m.label + (used[k] ? ' <em>보유</em>' : '') + '</span>' +
            '<span class="rr-rate">' + m.rate.toFixed(1) + '%</span>' +
            '<span class="rr-range">' + m.lo.toFixed(1) + '~' + m.hi.toFixed(1) + '</span>' +
          '</div>';
        }).join('');
    }).join('');
  }

  /* ═══════════════ 렌더 : 헤더 ═══════════════ */
  function renderHero() {
    var t = totals();
    $('#heroNet').textContent = won(t.net);
    $('#heroAssets').textContent = won(t.assets, { short: true });
    $('#heroDebts').textContent = won(t.debts, { short: true });

    var s = sim();
    var last = s.base[s.base.length - 1];
    var yrs = last.year - THIS_YEAR;
    $('#heroProj').innerHTML =
      yrs + '년 후 (' + last.year + ') 예상 순자산 <b>' + won(last.net) + '</b>' +
      (state.settings.terms === 'real' ? ' <span style="color:var(--text-3)">· 현재가치 기준</span>' : '');
  }

  /* ═══════════════ 렌더 : 시뮬레이션 탭 ═══════════════ */
  function renderSim() {
    var s = sim();
    var S = state.settings;

    var cBase = cvar('--accent'), cCons = cvar('--c-cash'), cOpti = cvar('--up'), cDebt = cvar('--c-debt');

    var series = [
      { name: '낙관 (+' + num(S.opti) + '%p)', color: cOpti, data: s.opti.map(function (r) { return [r.year, r.net]; }), dashed: true, width: 1.8 },
      { name: '기본 전망', color: cBase, data: s.base.map(function (r) { return [r.year, r.net]; }), area: true, width: 2.6 },
      { name: '보수 (' + num(S.cons) + '%p)', color: cCons, data: s.cons.map(function (r) { return [r.year, r.net]; }), dashed: true, width: 1.8 },
      { name: '부채 잔액', color: cDebt, data: s.base.map(function (r) { return [r.year, r.debt]; }), width: 1.6, faded: true }
    ];

    $('#legendMain').innerHTML = series.map(function (x) {
      return '<i class="' + (x.dashed ? 'dash' : '') + '" style="--dot:' + x.color + '">' + x.name + '</i>';
    }).join('');

    var lastBase = s.base[s.base.length - 1];
    var defaultReadout =
      '<span class="ro-year">' + lastBase.year + '년</span>' +
      '<span class="ro-item">순자산 <b>' + won(lastBase.net) + '</b></span>' +
      '<span class="ro-item">총자산 <b>' + won(lastBase.assets) + '</b></span>' +
      '<span class="ro-item">부채 <b>' + won(lastBase.debt) + '</b></span>';

    Chart.line($('#chartMain'), {
      series: series, includeZero: true, yFormat: wonAxis,
      xFormat: function (v) { return Math.round(v) + ''; },
      onHover: function (x, rows) {
        var box = $('#readoutMain');
        if (!rows) { box.innerHTML = defaultReadout; return; }
        box.innerHTML = '<span class="ro-year">' + Math.round(x) + '년</span>' +
          rows.map(function (r) {
            return '<span class="ro-item" style="color:' + r.color + '">' + r.name + ' <b>' + won(r.value) + '</b></span>';
          }).join('');
      }
    });

    /* 통계 카드 */
    var t0 = s.base[0], N = lastBase.year - THIS_YEAR;
    var cagr = (t0.net > 0 && lastBase.net > 0) ? (Math.pow(lastBase.net / t0.net, 1 / N) - 1) * 100 : null;

    var payoff = null;
    for (var i = 1; i < s.base.length; i++) {
      if (s.base[i].debt <= 0.5 && s.base[i - 1].debt > 0.5) { payoff = s.base[i].year; break; }
    }
    if (s.base[0].debt <= 0.5) payoff = 0;

    var goalHit = null, gt = num(state.goal.net);
    if (gt > 0) for (var j = 0; j < s.base.length; j++) if (s.base[j].net >= gt) { goalHit = s.base[j].year; break; }

    var totalInterest = s.base.reduce(function (a, r) { return a + r.interest; }, 0);

    /* 누적 적립 원금과 투자수익 분리 */
    var g = num(S.contribGrowth) / 100, infl = num(S.inflation) / 100;
    var totalContrib = 0, nextContrib = 0;
    for (var y = THIS_YEAR + 1; y <= lastBase.year; y++) {
      var c = 0;
      state.assets.forEach(function (a) { if (a.on) c += annualContrib(a.plans, y); });
      c *= Math.pow(1 + g, y - THIS_YEAR - 1);
      if (S.terms === 'real') c /= Math.pow(1 + infl, y - THIS_YEAR);
      totalContrib += c;
      if (y === THIS_YEAR + 1) nextContrib = c;
    }
    var gain = lastBase.assets - s.base[0].assets - totalContrib;

    var stats = [
      { k: N + '년 후 순자산 (기본)', v: won(lastBase.net, { short: true }), s: lastBase.year + '년', accent: true },
      { k: '보수 / 낙관', v: won(s.cons[s.cons.length - 1].net, { short: true }) + ' / ' + won(s.opti[s.opti.length - 1].net, { short: true }), s: '시나리오 범위' },
      { k: '순자산 연평균 성장률', v: cagr == null ? '—' : cagr.toFixed(1) + '%', s: 'CAGR · ' + N + '년' },
      { k: '대출 완제 시점', v: payoff === 0 ? '없음' : (payoff ? payoff + '년' : N + '년 내 미완제'), s: payoff > 0 ? (payoff - THIS_YEAR) + '년 후' : '—' },
      { k: '누적 이자 부담', v: won(totalInterest, { short: true }), s: N + '년 합계' },
      { k: '목표 도달 예상', v: goalHit ? goalHit + '년' : '기간 내 미도달', s: goalHit ? '목표 ' + won(gt, { short: true }) : '가정 조정 필요' },
      { k: '누적 적립 원금', v: won(totalContrib, { short: true }), s: nextContrib ? '내년 ' + won(nextContrib, { short: true }) : '적립 없음' },
      { k: '투자 수익 (원금 제외)', v: won(gain, { short: true }), s: totalContrib > 0 ? '적립원금 대비 ' + (gain / totalContrib).toFixed(1) + '배' : N + '년 누적' }
    ];
    $('#statGrid').innerHTML = stats.map(function (x) {
      return '<div class="stat' + (x.accent ? ' accent' : '') + '"><div class="k">' + x.k + '</div>' +
        '<div class="v">' + x.v + '</div><div class="s">' + x.s + '</div></div>';
    }).join('');

    /* 구성 스택 */
    var used = ACCT_ORDER.filter(function (k) {
      return s.base.some(function (r) { return (r.byAcct[k] || 0) > 0; });
    });
    Chart.stack($('#chartStack'), {
      x: s.base.map(function (r) { return r.year; }),
      series: used.map(function (k) {
        return { name: ACCOUNTS[k].label, color: cvar(ACCOUNTS[k].color), values: s.base.map(function (r) { return r.byAcct[k] || 0; }) };
      }),
      yFormat: wonAxis, xFormat: function (v) { return Math.round(v) + ''; }
    });
    $('#legendStack').innerHTML = used.map(function (k) {
      return '<i style="--dot:' + cvar(ACCOUNTS[k].color) + '">' + ACCOUNTS[k].label + '</i>';
    }).join('');

    /* 표 */
    var by = num(state.settings.birthYear);
    var tb = $('#simTable tbody');
    tb.innerHTML = s.base.map(function (r, idx) {
      var prev = idx ? s.base[idx - 1].net : null;
      var diff = prev == null ? null : r.net - prev;
      var age = by ? (r.year - by) + '세' : '—';
      return '<tr class="' + ((r.year - THIS_YEAR) % 5 === 0 && idx ? 'milestone' : '') + '">' +
        '<td>' + r.year + '</td><td>' + age + '</td>' +
        '<td>' + won(r.assets, { short: true }) + '</td>' +
        '<td>' + (r.debt > 0.5 ? won(r.debt, { short: true }) : '—') + '</td>' +
        '<td class="net">' + won(r.net, { short: true }) + '</td>' +
        '<td>' + (diff == null ? '—' : '<span class="' + (diff >= 0 ? 'up' : 'down') + '">' +
          (diff >= 0 ? '+' : '') + won(diff, { short: true }) + '</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ═══════════════ 렌더 : 기록 탭 ═══════════════ */
  function renderHistory() {
    var s = sim();
    var hist = state.history.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var t = totals();
    var goalYear = clamp(Math.round(num(state.goal.year)) || THIS_YEAR + 10, THIS_YEAR + 1, THIS_YEAR + 60);
    var goalNet = num(state.goal.net);

    var startNet = hist.length ? hist[0].net : t.net;
    var startX = hist.length ? isoToFrac(hist[0].date) : THIS_YEAR;
    var curve = goalCurve(startNet, startX, goalYear, goalNet);

    var cGoal = cvar('--warn'), cBase = cvar('--accent'), cAct = cvar('--up');

    var baseIn = s.base.filter(function (r) { return r.year <= goalYear; })
      .map(function (r) { return [r.year, r.net]; });

    var series = [
      { name: '목표 경로', color: cGoal, data: curve.points, dashed: true, width: 2 },
      { name: '통상 전망', color: cBase, data: baseIn, width: 2, area: true },
      { name: '실제 기록', color: cAct, data: hist.map(function (h) { return [isoToFrac(h.date), h.net]; }), width: 2.4, dots: true }
    ].filter(function (x) { return x.data.length; });

    $('#legendHist').innerHTML = series.map(function (x) {
      return '<i class="' + (x.dashed ? 'dash' : '') + '" style="--dot:' + x.color + '">' + x.name + '</i>';
    }).join('');

    var latest = hist.length ? hist[hist.length - 1] : null;
    var defRead = latest
      ? '<span class="ro-year">최근 기록 ' + latest.date + '</span><span class="ro-item">순자산 <b>' + won(latest.net) + '</b></span>'
      : '<span class="ro-item" style="color:var(--text-3)">기록을 추가하면 실제 추이가 함께 그려집니다.</span>';

    Chart.line($('#chartHist'), {
      series: series, includeZero: true, yFormat: wonAxis,
      xFormat: function (v) { return Math.round(v) + ''; },
      onHover: function (x, rows) {
        var box = $('#readoutHist');
        if (!rows) { box.innerHTML = defRead; return; }
        box.innerHTML = '<span class="ro-year">' + Math.round(x) + '년</span>' +
          rows.map(function (r) {
            return '<span class="ro-item" style="color:' + r.color + '">' + r.name + ' <b>' + won(r.value) + '</b></span>';
          }).join('');
      }
    });

    /* 달성률 */
    var cur = latest ? latest.net : t.net;
    var pct = goalNet > 0 ? clamp(cur / goalNet * 100, 0, 100) : 0;
    $('#goalPct').textContent = goalNet > 0 ? pct.toFixed(1) + '%' : '—';
    $('#goalFill').style.width = pct + '%';

    var nowX = latest ? isoToFrac(latest.date) : THIS_YEAR + (new Date().getMonth() / 12);

    /* 연평균 성장률 3종 비교: 실제 / 목표 / 통상 */
    var span = nowX - startX;
    var actualCagr = (hist.length >= 2 && span >= 0.25 && startNet > 0 && cur > 0)
      ? Math.pow(cur / startNet, 1 / span) - 1 : null;
    var hz = Math.max(1, goalYear - THIS_YEAR);
    var b0 = s.base[0].net, bN = interp(s.base.map(function (r) { return [r.year, r.net]; }), goalYear);
    var normalCagr = (b0 > 0 && bN > 0) ? Math.pow(bN / b0, 1 / hz) - 1 : null;

    var pctFmt = function (g) { return g == null ? '—' : (g * 100).toFixed(1) + '%'; };
    var cmpColor = (actualCagr != null && curve.cagr != null)
      ? (actualCagr >= curve.cagr ? cvar('--up') : cvar('--down')) : cvar('--text');
    $('#goalCagr').innerHTML =
      '<div class="cg"><span>실제 연환산</span><b style="color:' + cmpColor + '">' + pctFmt(actualCagr) + '</b></div>' +
      '<div class="cg"><span>목표 필요</span><b>' + pctFmt(curve.cagr) + '</b></div>' +
      '<div class="cg"><span>통상 전망</span><b>' + pctFmt(normalCagr) + '</b></div>';

    var note = [];
    if (hist.length >= 2) {
      var onPace = interp(curve.points, nowX);
      if (onPace != null) {
        var gap = cur - onPace;
        note.push('목표 페이스 대비 <b style="color:' + (gap >= 0 ? cvar('--up') : cvar('--down')) + '">' + signed(gap) + '</b>');
      }
      if (actualCagr != null && normalCagr != null) {
        var d = (actualCagr - normalCagr) * 100;
        note.push('통상 상승률 대비 연 <b style="color:' + (d >= 0 ? cvar('--up') : cvar('--down')) + '">' +
          (d >= 0 ? '+' : '') + d.toFixed(1) + '%p</b>');
      }
    } else {
      note.push('기록이 2개 이상 쌓이면 실제 성장률과 목표·통상 전망을 비교합니다');
    }
    $('#goalNote').innerHTML = note.join(' · ');

    /* 기록 목록 */
    var box = $('#historyList');
    if (!hist.length) {
      box.innerHTML = '<div class="empty">아직 기록이 없습니다.<br>“+ 오늘 기록”으로 현재 자산을 남겨 보세요.</div>';
      return;
    }
    box.innerHTML = '';
    hist.slice().reverse().forEach(function (h, idx, arr) {
      var prev = arr[idx + 1];
      var diff = prev ? h.net - prev.net : null;
      var node = document.createElement('div');
      node.className = 'hist';
      node.innerHTML =
        '<span class="hist-date">' + h.date + '</span>' +
        '<span class="hist-main">' +
          '<span class="hist-net">' + won(h.net) + '</span>' +
          '<span class="hist-note">자산 ' + won(h.assets, { short: true }) + ' · 부채 ' + won(h.debts, { short: true }) +
            (h.note ? ' · ' + h.note : '') + '</span>' +
        '</span>' +
        (diff == null ? '' : '<span class="hist-delta" style="color:' + (diff >= 0 ? cvar('--up') : cvar('--down')) + '">' + signed(diff) + '</span>') +
        '<button class="hist-del" aria-label="삭제"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button>';
      $('.hist-del', node).addEventListener('click', function () {
        if (!confirm(h.date + ' 기록을 삭제할까요?')) return;
        state.history = state.history.filter(function (x) { return x.id !== h.id; });
        save(); renderHistory();
      });
      box.appendChild(node);
    });
  }

  /* ═══════════════ 갱신 오케스트레이션 ═══════════════ */
  var pending;
  function softUpdate() {
    invalidate();
    save();
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(function () {
      renderHero();
      renderAlloc();
      renderRateRef();
      renderSim();
      renderHistory();
    });
  }

  /* ═══════════════ 설정 바인딩 ═══════════════ */
  function bindSettings() {
    var S = state.settings;

    var yrs = $('#setYears');
    yrs.value = S.years;
    $('#setYearsOut').textContent = S.years + '년';
    yrs.addEventListener('input', function () {
      S.years = num(yrs.value);
      $('#setYearsOut').textContent = S.years + '년';
      softUpdate();
    });

    [['#setInflation', 'inflation'], ['#setContribGrowth', 'contribGrowth'],
     ['#setCons', 'cons'], ['#setOpti', 'opti']].forEach(function (p) {
      var el = $(p[0]);
      el.value = S[p[1]];
      el.addEventListener('input', function () { S[p[1]] = num(el.value); softUpdate(); });
    });

    $('#setBirthYear').value = S.birthYear || '';
    $('#setBirthYear').addEventListener('input', function () {
      S.birthYear = this.value.replace(/\D/g, '').slice(0, 4);
      this.value = S.birthYear;
      softUpdate();
    });

    var theme = $('#setTheme');
    theme.value = S.theme || 'auto';
    theme.addEventListener('change', function () {
      S.theme = theme.value; applyTheme(); save();
      requestAnimationFrame(function () { renderAssets(); renderDebts(); softUpdate(); });
    });

    $$('#segTerms button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.v === S.terms);
      b.addEventListener('click', function () {
        S.terms = b.dataset.v;
        $$('#segTerms button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        softUpdate();
      });
    });

    $('#goalYear').value = state.goal.year;
    $('#goalYear').addEventListener('input', function () {
      state.goal.year = num(this.value.replace(/\D/g, '')); softUpdate();
    });
    var gn = $('#goalNet');
    gn.value = comma(state.goal.net);
    gn.addEventListener('input', function () { state.goal.net = num(this.value); softUpdate(); });
    gn.addEventListener('blur', function () { this.value = comma(state.goal.net); });
    gn.addEventListener('focus', function () { this.value = state.goal.net || ''; });
  }

  function applyTheme() {
    var t = state.settings.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) {
      requestAnimationFrame(function () { meta.setAttribute('content', cvar('--bg') || '#0A0D14'); });
    }
  }

  /* ═══════════════ 스냅샷 시트 ═══════════════ */
  function openSnapshot() {
    var t = totals();
    var body = $('#sheetBody');
    body.innerHTML =
      '<div class="field"><label>기록 날짜</label><input type="date" id="snapDate"></div>' +
      '<div class="field"><label>총자산 (만원)</label>' +
        '<div class="suffix-wrap"><input type="text" inputmode="numeric" id="snapAssets"><span class="suffix">만원</span></div></div>' +
      '<div class="field"><label>총부채 (만원)</label>' +
        '<div class="suffix-wrap"><input type="text" inputmode="numeric" id="snapDebts"><span class="suffix">만원</span></div></div>' +
      '<div class="field"><label>순자산</label><input type="text" id="snapNet" readonly></div>' +
      '<div class="field"><label>메모 (선택)</label><input type="text" id="snapNote" placeholder="예: 상여금 입금, 아파트 시세 재평가"></div>';

    $('#snapDate').value = todayISO();
    $('#snapAssets').value = comma(Math.round(t.assets));
    $('#snapDebts').value = comma(Math.round(t.debts));

    function sync() {
      $('#snapNet').value = won(num($('#snapAssets').value) - num($('#snapDebts').value));
    }
    $('#snapAssets').addEventListener('input', sync);
    $('#snapDebts').addEventListener('input', sync);
    sync();

    $('#sheetBackdrop').classList.add('is-on');
  }

  function closeSheet() { $('#sheetBackdrop').classList.remove('is-on'); }

  function saveSnapshot() {
    var date = $('#snapDate').value || todayISO();
    var a = num($('#snapAssets').value), d = num($('#snapDebts').value);
    var t = totals();
    var entry = {
      id: id(), date: date, assets: a, debts: d, net: a - d,
      note: $('#snapNote').value.trim(), byAcct: t.byAcct
    };
    state.history = state.history.filter(function (h) { return h.date !== date; });
    state.history.push(entry);
    state.history.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    save(true);
    closeSheet();
    renderHistory();
    toast(date + ' 기록을 저장했습니다');
  }

  /* ═══════════════ 백업 / 복원 ═══════════════ */
  function exportData() {
    var payload = JSON.stringify({
      app: '자산 시뮬레이터', version: VERSION,
      exportedAt: new Date().toISOString(), data: state
    }, null, 2);
    var fname = '자산시뮬레이터_' + todayISO() + '.json';
    var blob = new Blob([payload], { type: 'application/json' });

    // iOS: 공유 시트 → “파일에 저장” 이 가장 자연스러움
    if (navigator.canShare && window.File) {
      try {
        var file = new File([blob], fname, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: fname })
            .then(function () { toast('백업 파일을 내보냈습니다'); })
            .catch(function () { /* 사용자가 취소 */ });
          return;
        }
      } catch (e) { /* fallthrough */ }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('백업 파일을 저장했습니다');
  }

  function importData(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var parsed = JSON.parse(fr.result);
        var incoming = parsed && parsed.data ? parsed.data : parsed;
        if (!incoming || (!incoming.assets && !incoming.history)) throw new Error('형식 불일치');
        if (!confirm('현재 데이터를 백업 파일 내용으로 덮어씁니다. 계속할까요?')) return;
        state = migrate(incoming);
        save(true);
        applyTheme();
        bootRender();
        toast('데이터를 복원했습니다');
      } catch (e) {
        toast('가져오기 실패 — 올바른 백업 파일이 아닙니다');
      }
    };
    fr.readAsText(file);
  }

  /* ═══════════════ 탭 ═══════════════ */
  function initTabs() {
    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        $$('.tab-panel').forEach(function (p) {
          p.classList.toggle('is-active', p.id === 'panel-' + btn.dataset.tab);
        });
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
        requestAnimationFrame(function () { Chart.redraw(); });
      });
    });
  }

  /* ═══════════════ 부트 ═══════════════ */
  function bootRender() {
    invalidate();
    renderAssets();
    renderDebts();
    renderAlloc();
    renderRateRef();
    renderHero();
    renderSim();
    renderHistory();
    bindSettings();
  }

  function init() {
    applyTheme();
    initTabs();
    bootRender();

    $('#btnAddAsset').addEventListener('click', function () {
      state.assets.push({ id: id(), acct: 'us', sym: 'qqq', name: '새 자산', amount: 0, plans: [], on: true });
      renderAssets(); softUpdate();
      var last = $('#assetList').lastElementChild;
      if (last) { last.classList.add('is-open'); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });

    $('#btnAddDebt').addEventListener('click', function () {
      state.debts.push({ id: id(), name: '새 대출', balance: 0, rate: 4.0, years: 20, grace: 0, type: 'annuity', extra: 0, on: true });
      renderDebts(); softUpdate();
      var last = $('#debtList').lastElementChild;
      if (last) { last.classList.add('is-open'); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });

    $('#btnSnapshot').addEventListener('click', openSnapshot);
    $('#btnSnapshotTop').addEventListener('click', openSnapshot);
    $('#sheetCancel').addEventListener('click', closeSheet);
    $('#sheetSave').addEventListener('click', saveSnapshot);
    $('#sheetBackdrop').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });

    $('#btnExport').addEventListener('click', exportData);
    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) importData(this.files[0]);
      this.value = '';
    });

    $('#btnReset').addEventListener('click', function () {
      if (!confirm('모든 자산·부채·기록이 삭제됩니다. 정말 초기화할까요?')) return;
      if (!confirm('되돌릴 수 없습니다. 백업은 하셨나요?')) return;
      state = defaultState();
      save(true); applyTheme(); bootRender();
      toast('초기화했습니다');
    });

    $('#verLine').textContent = 'v' + VERSION + ' · 데이터는 이 기기에만 저장됩니다';
    var el = $('#saveState');
    if (el && localStorage.getItem(KEY)) el.textContent = '기기에 자동 저장 중';

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if ((state.settings.theme || 'auto') === 'auto') {
        applyTheme();
        renderAssets(); renderDebts(); softUpdate();
      }
    });

    // 서비스워커 (오프라인)
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 무시 */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
