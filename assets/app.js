/* ============================================================
   자산 목표 — app.js
   목표 나이·목표 금액과 내 자산을 비교하고, 매주 기록합니다.
   데이터는 이 기기에만 저장됩니다 (IndexedDB + localStorage 이중 보관).
   금액 단위: 만원
   ============================================================ */
(function () {
  'use strict';

  var VERSION = '2.0.0';
  var LS_KEY = 'assetgoal.state.v2';
  var OLD_KEY = 'assetsim.state.v1';
  var THIS_YEAR = new Date().getFullYear();

  /* ═══════════ 유틸 ═══════════ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function id() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function cvar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 만원 → "N억 N,NNN만" */
  function won(man, opt) {
    opt = opt || {};
    var v = Math.round(num(man)), sign = v < 0 ? '-' : '';
    v = Math.abs(v);
    var eok = Math.floor(v / 10000), rest = v % 10000;
    if (eok > 0) {
      if (opt.short) return sign + (v / 10000).toFixed(v >= 1000000 ? 0 : 1).replace(/\.0$/, '') + '억';
      return sign + eok.toLocaleString() + '억' + (rest ? ' ' + rest.toLocaleString() + '만' : '');
    }
    return sign + v.toLocaleString() + '만';
  }
  function wonAxis(man) {
    var v = num(man) / 10000;
    if (Math.abs(v) >= 10) return Math.round(v) + '억';
    if (Math.abs(v) >= 1) return v.toFixed(1).replace(/\.0$/, '') + '억';
    if (Math.abs(man) < 1) return '0';
    return Math.round(man).toLocaleString() + '만';
  }
  function comma(v) { var n = num(v); return n ? n.toLocaleString() : (v === 0 ? '0' : ''); }
  function signed(v) { return (v >= 0 ? '+' : '') + won(v); }

  function todayISO(d) {
    d = d || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function parseISO(s) { var d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; }
  function isoToFrac(iso) {
    var d = parseISO(iso);
    if (!d) return THIS_YEAR;
    var y = d.getFullYear();
    return y + (d - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1));
  }
  /** 월요일 시작 주의 키 'YYYY-Www' */
  function weekKey(iso) {
    var d = parseISO(iso) || new Date();
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 4 - (t.getDay() || 7));           // 목요일 기준(ISO)
    var y0 = new Date(t.getFullYear(), 0, 1);
    var w = Math.ceil((((t - y0) / 86400000) + 1) / 7);
    return t.getFullYear() + '-W' + String(w).padStart(2, '0');
  }
  function weekLabel(iso) {
    var d = parseISO(iso);
    if (!d) return '';
    return (d.getMonth() + 1) + '월 ' + Math.ceil(d.getDate() / 7) + '주차';
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2400);
  }

  /* ═══════════ 저장소 (IndexedDB + localStorage) ═══════════ */
  var DB = null;
  function openDB() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      if (!global_indexedDB()) return rej(new Error('no idb'));
      var r = indexedDB.open('assetgoal', 1);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots');
      };
      r.onsuccess = function () { DB = r.result; res(DB); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function global_indexedDB() { try { return window.indexedDB; } catch (e) { return null; } }

  function idb(store, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(store, mode);
        var req = fn(tx.objectStore(store));
        tx.oncomplete = function () { res(req && req.result); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(store, key) { return idb(store, 'readonly', function (s) { return s.get(key); }); }
  function idbPut(store, key, val) { return idb(store, 'readwrite', function (s) { return s.put(val, key); }); }
  function idbDel(store, key) { return idb(store, 'readwrite', function (s) { return s.delete(key); }); }

  /* ═══════════ 상태 ═══════════ */
  function defaultState() {
    return {
      v: 2,
      settings: { birthYear: '', theme: 'auto', chartRange: 'goal' },
      goal: { age: 55, amount: 300000 },
      items: [
        { id: id(), kind: 'asset', name: '아파트', amount: 0 },
        { id: id(), kind: 'asset', name: '주식 계좌', amount: 0 },
        { id: id(), kind: 'asset', name: '연금', amount: 0 },
        { id: id(), kind: 'debt', name: '주택담보대출', amount: 0 }
      ],
      records: []
    };
  }

  var state = defaultState();

  function normalize(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    var out = { v: 2 };
    out.settings = Object.assign({}, d.settings, s.settings || {});
    out.goal = Object.assign({}, d.goal, s.goal || {});
    out.items = Array.isArray(s.items) ? s.items : [];
    out.records = Array.isArray(s.records) ? s.records : [];
    out.items.forEach(function (it) {
      if (!it.id) it.id = id();
      if (it.kind !== 'debt') it.kind = 'asset';
      it.amount = num(it.amount);
      it.name = String(it.name || '');
    });
    out.records.forEach(function (r) {
      if (!r.id) r.id = id();
      r.date = String(r.date || todayISO()).slice(0, 10);
      r.assets = num(r.assets); r.debts = num(r.debts);
      r.net = isFinite(num(r.net)) && r.net !== undefined ? num(r.net) : r.assets - r.debts;
      r.note = String(r.note || '');
      r.shots = Array.isArray(r.shots) ? r.shots : [];
    });
    out.records.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }

  /** 구버전(v1) 데이터를 옮겨 담습니다 */
  function migrateV1(old) {
    var items = [], records = [];
    (old.assets || []).forEach(function (a) {
      items.push({ id: id(), kind: 'asset', name: a.name || '자산', amount: num(a.amount) });
    });
    (old.debts || []).forEach(function (d) {
      items.push({ id: id(), kind: 'debt', name: d.name || '대출', amount: num(d.balance) });
    });
    (old.history || []).forEach(function (h) {
      records.push({ id: id(), date: h.date, assets: num(h.assets), debts: num(h.debts),
                     net: num(h.net), note: h.note || '', shots: [] });
    });
    var by = num((old.settings || {}).birthYear);
    var gy = num((old.goal || {}).year);
    return normalize({
      v: 2,
      settings: { birthYear: by || '', theme: (old.settings || {}).theme || 'auto' },
      goal: { age: (by && gy) ? gy - by : 55, amount: num((old.goal || {}).net) || 300000 },
      items: items, records: records
    });
  }

  function load() {
    var lsRaw = null, lsObj = null;
    try { lsRaw = localStorage.getItem(LS_KEY); } catch (e) {}
    if (lsRaw) { try { lsObj = JSON.parse(lsRaw); } catch (e) {} }

    return idbGet('kv', 'state')['catch'](function () { return null; }).then(function (idbObj) {
      var a = lsObj && lsObj.data ? lsObj : null;
      var b = idbObj && idbObj.data ? idbObj : null;
      var pick = null;
      if (a && b) pick = (num(b.ts) >= num(a.ts)) ? b : a;
      else pick = b || a;
      if (pick) return normalize(pick.data);

      // v2 데이터가 없으면 구버전에서 옮겨온다
      var oldRaw = null;
      try { oldRaw = localStorage.getItem(OLD_KEY); } catch (e) {}
      if (oldRaw) {
        try {
          var migrated = migrateV1(JSON.parse(oldRaw));
          toast('이전 버전 데이터를 옮겨왔습니다');
          return migrated;
        } catch (e) {}
      }
      return defaultState();
    });
  }

  var saveTimer, lastSaved = 0;
  function save(now) {
    clearTimeout(saveTimer);
    var run = function () {
      var payload = { ts: Date.now(), v: VERSION, data: state };
      try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}
      idbPut('kv', 'state', payload)['catch'](function () {});
      lastSaved = payload.ts;
      var el = $('#saveState');
      if (el) el.textContent = '마지막 저장 ' + new Date().toLocaleString('ko-KR');
    };
    if (now) run(); else saveTimer = setTimeout(run, 300);
  }

  /** 브라우저에 "이 데이터는 지우지 말아 달라"고 요청 */
  function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(null);
    return navigator.storage.persisted().then(function (p) {
      return p ? true : navigator.storage.persist();
    })['catch'](function () { return null; });
  }

  /* ═══════════ 계산 ═══════════ */
  function totals() {
    var a = 0, d = 0;
    state.items.forEach(function (it) {
      if (it.kind === 'debt') d += num(it.amount); else a += num(it.amount);
    });
    return { assets: a, debts: d, net: a - d };
  }

  function birthYear() { return num(state.settings.birthYear); }
  function goalAge() { return num(state.goal.age); }
  function goalAmount() { return num(state.goal.amount); }
  function goalYear() {
    var by = birthYear();
    return (by && goalAge()) ? by + goalAge() : THIS_YEAR + 10;
  }
  function currentAge() {
    var by = birthYear();
    return by ? THIS_YEAR - by : null;
  }
  function yearsLeft() { return Math.max(0, goalYear() - THIS_YEAR); }

  function sortedRecords() {
    return state.records.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function latestRecord() {
    var r = sortedRecords();
    return r.length ? r[r.length - 1] : null;
  }
  function hasThisWeek() {
    var wk = weekKey(todayISO());
    return state.records.some(function (r) { return weekKey(r.date) === wk; });
  }

  /** 목표 경로: 시작점(첫 기록 또는 오늘) → 목표 시점 (직선) */
  function goalPath() {
    var recs = sortedRecords();
    var t = totals();
    var startX = recs.length ? isoToFrac(recs[0].date) : THIS_YEAR + monthFrac();
    var startY = recs.length ? recs[0].net : t.net;
    var endX = goalYear();
    var endY = goalAmount();
    if (endX <= startX) endX = startX + 0.5;
    return {
      from: [startX, startY], to: [endX, endY],
      at: function (x) {
        var k = (x - startX) / (endX - startX);
        return startY + (endY - startY) * clamp(k, 0, 1);
      }
    };
  }
  function monthFrac() { var d = new Date(); return (d.getMonth() + d.getDate() / 30) / 12; }

  /** 최근 기록들로 주당 평균 증감 계산 */
  function recentPace() {
    var recs = sortedRecords();
    if (recs.length < 2) return null;
    var use = recs.slice(-12);                      // 최근 12개 기록
    var a = use[0], b = use[use.length - 1];
    var weeks = (parseISO(b.date) - parseISO(a.date)) / (7 * 86400000);
    if (!(weeks > 0.5)) return null;
    return { perWeek: (b.net - a.net) / weeks, from: a.date, to: b.date, n: use.length };
  }

  /* ═══════════ 렌더 ═══════════ */
  function renderHome() {
    var t = totals();
    $('#heroNet').textContent = won(t.net);
    $('#heroAssets').textContent = won(t.assets, { short: true });
    $('#heroDebts').textContent = won(t.debts, { short: true });

    var ga = goalAmount(), gy = goalYear(), age = goalAge(), by = birthYear();
    $('#goalLine').innerHTML = by
      ? '<b>' + age + '세</b>(' + gy + '년)까지 <b>' + won(ga, { short: true }) + '</b>'
      : '<b>' + gy + '년</b>까지 <b>' + won(ga, { short: true }) + '</b> <span class="need">· 출생연도를 입력하세요</span>';

    var pct = ga > 0 ? clamp(t.net / ga * 100, 0, 100) : 0;
    $('#goalPct').textContent = ga > 0 ? pct.toFixed(1) + '%' : '—';
    $('#goalFill').style.width = pct + '%';
    var left = ga - t.net;
    $('#goalLeft').textContent = ga > 0
      ? (left > 0 ? won(left, { short: true }) + ' 남음' : '목표 달성!')
      : '';

    renderStats(t);
    renderGoalChart();
    renderWeekBanner();
  }

  function renderStats(t) {
    var ga = goalAmount(), yl = yearsLeft(), left = Math.max(0, ga - t.net);
    var pace = recentPace();
    var stats = [];

    stats.push({ k: '목표까지', v: won(left, { short: true }), s: yl > 0 ? yl + '년 남음' : '기한 도달' });

    var perYear = yl > 0 ? left / yl : 0;
    stats.push({
      k: '연간 필요 증가액', v: yl > 0 ? won(perYear, { short: true }) : '—',
      s: yl > 0 ? '월 ' + won(perYear / 12, { short: true }) : '목표 연도를 늘려보세요'
    });

    if (pace) {
      var perYearNow = pace.perWeek * 52;
      stats.push({
        k: '최근 증가 속도', v: (perYearNow >= 0 ? '+' : '') + won(perYearNow, { short: true }) + '/년',
        s: '주당 ' + signed(pace.perWeek), tone: perYearNow >= perYear ? 'up' : 'down'
      });
      var reach = null;
      if (pace.perWeek > 0 && left > 0) {
        var weeks = left / pace.perWeek;
        reach = THIS_YEAR + monthFrac() + weeks / 52;
      }
      stats.push({
        k: '이 속도면 도달', v: left <= 0 ? '달성' : (reach && reach - THIS_YEAR < 60 ? Math.round(reach) + '년' : '미도달'),
        s: reach && by2(reach) ? '약 ' + by2(reach) + '세' : (left <= 0 ? '' : '속도를 높여야 합니다'),
        tone: (reach && reach <= goalYear()) || left <= 0 ? 'up' : 'down'
      });
    } else {
      stats.push({ k: '최근 증가 속도', v: '—', s: '기록 2개부터 계산됩니다' });
      stats.push({ k: '이 속도면 도달', v: '—', s: '매주 기록해 보세요' });
    }

    $('#statGrid').innerHTML = stats.map(function (x) {
      return '<div class="stat"><div class="k">' + esc(x.k) + '</div>' +
        '<div class="v' + (x.tone ? ' ' + x.tone : '') + '">' + esc(x.v) + '</div>' +
        '<div class="s">' + esc(x.s || '') + '</div></div>';
    }).join('');
  }
  function by2(yearFloat) { var b = birthYear(); return b ? Math.round(yearFloat - b) : null; }

  function renderGoalChart() {
    var recs = sortedRecords();
    var path = goalPath();
    var t = totals();
    var cGoal = cvar('--warn'), cAct = cvar('--accent');

    var actual = recs.map(function (r) { return [isoToFrac(r.date), r.net]; });
    // 기록이 없거나 오래됐으면 현재 자산을 마지막 점으로 덧붙인다
    var nowX = THIS_YEAR + monthFrac();
    if (!actual.length) actual.push([nowX, t.net]);
    else if (nowX > actual[actual.length - 1][0] + 0.02) actual.push([nowX, t.net]);

    var goalLine = [path.from, path.to];
    if (state.settings.chartRange === 'year') {
      // 최근 1년만 확대 — 주간 변화를 눈으로 보기 위한 모드
      var lo = nowX - 1, hi = Math.max(nowX + 0.08, actual[actual.length - 1][0] + 0.08);
      actual = actual.filter(function (p) { return p[0] >= lo; });
      if (!actual.length) actual = [[nowX, t.net]];
      goalLine = [[Math.max(lo, path.from[0]), path.at(Math.max(lo, path.from[0]))], [hi, path.at(hi)]];
    }

    var series = [
      { name: '목표 경로', color: cGoal, data: goalLine, dashed: true, width: 2 },
      { name: '내 자산', color: cAct, data: actual, width: 2.6, area: true, dots: actual.length <= 40 }
    ];
    $('#legendMain').innerHTML = series.map(function (x) {
      return '<i class="' + (x.dashed ? 'dash' : '') + '" style="--dot:' + x.color + '">' + x.name + '</i>';
    }).join('');

    var def = recs.length
      ? '<span class="ro-year">최근 ' + recs[recs.length - 1].date + '</span>' +
        '<span class="ro-item">순자산 <b>' + won(recs[recs.length - 1].net) + '</b></span>'
      : '<span class="ro-item" style="color:var(--text-3)">기록을 남기면 실제 추이가 그려집니다</span>';

    var yearMode = state.settings.chartRange === 'year';
    Chart.line($('#chartMain'), {
      series: series, includeZero: !yearMode, yFormat: wonAxis,
      xFormat: yearMode
        ? function (v) { var m = Math.round((v % 1) * 12); return (m === 0 ? Math.floor(v) + '년' : (m + 1) + '월'); }
        : function (v) { return Math.round(v) + ''; },
      onHover: function (x, rows) {
        var box = $('#readoutMain');
        if (!rows) { box.innerHTML = def; return; }
        box.innerHTML = '<span class="ro-year">' + Math.round(x) + '년</span>' +
          rows.map(function (r) {
            return '<span class="ro-item" style="color:' + r.color + '">' + esc(r.name) + ' <b>' + won(r.value) + '</b></span>';
          }).join('');
      }
    });
  }

  function renderWeekBanner() {
    var done = hasThisWeek();
    var html = done
      ? '<div class="week done"><span class="wk-ico">✓</span><div><b>이번 주 기록 완료</b>' +
        '<span>' + esc(weekLabel(todayISO())) + '</span></div></div>'
      : '<div class="week todo"><div><b>이번 주 기록이 없습니다</b><span>' + esc(weekLabel(todayISO())) + '</span></div>' +
        '<button class="btn-primary btn-sm" data-act="rec">기록하기</button></div>';
    [$('#weekBanner'), $('#weekBanner2')].forEach(function (el) {
      if (!el) return;
      el.innerHTML = html;
      var b = $('[data-act=rec]', el);
      if (b) b.addEventListener('click', function () { openRecordSheet(); });
    });
  }

  /* ── 자산 탭 ── */
  function itemRow(it) {
    var node = document.createElement('div');
    node.className = 'row';
    node.innerHTML =
      '<span class="row-swatch' + (it.kind === 'debt' ? ' debt' : '') + '"></span>' +
      '<input class="row-name" value="" placeholder="' + (it.kind === 'debt' ? '대출 이름' : '자산 이름') + '">' +
      '<div class="row-amt"><input inputmode="numeric" class="row-val" value=""><span>만원</span></div>' +
      '<button class="row-cam" aria-label="캡처로 입력">' +
        '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg></button>' +
      '<button class="row-del" aria-label="삭제"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button>';

    var nameIn = $('.row-name', node), valIn = $('.row-val', node);
    nameIn.value = it.name;
    valIn.value = comma(it.amount);

    nameIn.addEventListener('input', function () { it.name = nameIn.value; save(); });
    valIn.addEventListener('input', function () { it.amount = num(valIn.value); update(); });
    valIn.addEventListener('focus', function () { valIn.value = it.amount || ''; });
    valIn.addEventListener('blur', function () { valIn.value = comma(it.amount); });

    $('.row-cam', node).addEventListener('click', function () {
      openCapture({
        title: (it.name || '항목') + ' 금액 읽기',
        multi: false,
        onDone: function (sum) {
          it.amount = Math.round(sum / 10000);          // 원 → 만원
          valIn.value = comma(it.amount);
          update();
          toast(esc(it.name || '항목') + ' → ' + won(it.amount));
        }
      });
    });
    $('.row-del', node).addEventListener('click', function () {
      if (!confirm('“' + (it.name || '이 항목') + '”을(를) 삭제할까요?')) return;
      state.items = state.items.filter(function (x) { return x.id !== it.id; });
      renderItems(); update();
    });
    return node;
  }

  function renderItems() {
    var a = $('#assetList'), d = $('#debtList');
    a.innerHTML = ''; d.innerHTML = '';
    var assets = state.items.filter(function (i) { return i.kind !== 'debt'; });
    var debts = state.items.filter(function (i) { return i.kind === 'debt'; });
    if (!assets.length) a.innerHTML = '<div class="empty">자산 항목을 추가하세요</div>';
    if (!debts.length) d.innerHTML = '<div class="empty">없으면 비워 두세요</div>';
    assets.forEach(function (it) { a.appendChild(itemRow(it)); });
    debts.forEach(function (it) { d.appendChild(itemRow(it)); });
  }

  function renderSums() {
    var t = totals();
    $('#sumAssets').textContent = won(t.assets);
    $('#sumDebts').textContent = won(t.debts);
    $('#sumNet').textContent = won(t.net);
  }

  /* ── 기록 탭 ── */
  function renderRecords() {
    var recs = sortedRecords().slice().reverse();
    $('#recCount').textContent = recs.length ? recs.length + '회' : '';
    var box = $('#recordList');
    if (!recs.length) {
      box.innerHTML = '<div class="empty">아직 기록이 없습니다.<br>매주 한 번씩 남겨 보세요.</div>';
      return;
    }
    box.innerHTML = '';
    recs.forEach(function (r, i) {
      var prev = recs[i + 1];
      var diff = prev ? r.net - prev.net : null;
      var node = document.createElement('div');
      node.className = 'rec';
      node.innerHTML =
        '<div class="rec-main">' +
          '<div class="rec-top"><b>' + won(r.net) + '</b>' +
            (diff == null ? '' : '<span class="rec-diff" style="color:' +
              (diff >= 0 ? cvar('--up') : cvar('--down')) + '">' + signed(diff) + '</span>') + '</div>' +
          '<div class="rec-sub">' + esc(r.date) + ' · ' + esc(weekLabel(r.date)) +
            ' · 자산 ' + won(r.assets, { short: true }) + ' · 부채 ' + won(r.debts, { short: true }) +
            (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
          (r.shots && r.shots.length ? '<div class="rec-shots" data-shots="' + esc(r.shots.join(',')) + '"></div>' : '') +
        '</div>' +
        '<button class="rec-del" aria-label="삭제"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg></button>';

      $('.rec-del', node).addEventListener('click', function () {
        if (!confirm(r.date + ' 기록을 삭제할까요?')) return;
        (r.shots || []).forEach(function (sid) { idbDel('shots', sid)['catch'](function () {}); });
        state.records = state.records.filter(function (x) { return x.id !== r.id; });
        save(true); renderRecords(); renderHome();
      });

      var sh = $('.rec-shots', node);
      if (sh) {
        r.shots.forEach(function (sid) {
          idbGet('shots', sid).then(function (v) {
            if (!v) return;
            var im = document.createElement('img');
            im.src = v; im.className = 'thumb';
            im.addEventListener('click', function () { openImage(v); });
            sh.appendChild(im);
          })['catch'](function () {});
        });
      }
      box.appendChild(node);
    });
  }

  /* ═══════════ 시트 ═══════════ */
  function openSheet(title, bodyHtml, actions) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = bodyHtml;
    var act = $('#sheetActions');
    act.innerHTML = '';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = a.cls || 'btn-secondary';
      b.textContent = a.label;
      b.addEventListener('click', a.on);
      act.appendChild(b);
    });
    $('#sheetBackdrop').classList.add('is-on');
    $('#sheet').scrollTop = 0;
  }
  function closeSheet() { $('#sheetBackdrop').classList.remove('is-on'); }

  function openImage(src) {
    openSheet('첨부 이미지', '<img src="' + src + '" class="shot-full">',
      [{ label: '닫기', cls: 'btn-secondary', on: closeSheet }]);
  }

  /* ── 목표 수정 ── */
  function openGoalSheet() {
    openSheet('목표 설정',
      '<div class="field"><label>출생연도</label><input inputmode="numeric" id="gBirth" placeholder="1990"></div>' +
      '<div class="field"><label>목표 나이</label>' +
        '<div class="suffix-wrap"><input inputmode="numeric" id="gAge"><span class="suffix">세</span></div></div>' +
      '<div class="field"><label>목표 순자산</label>' +
        '<div class="suffix-wrap"><input inputmode="numeric" id="gAmt"><span class="suffix">만원</span></div></div>' +
      '<p class="hint" id="gPreview"></p>',
      [
        { label: '취소', cls: 'btn-secondary', on: closeSheet },
        { label: '저장', cls: 'btn-primary', on: function () {
            state.settings.birthYear = $('#gBirth').value.replace(/\D/g, '').slice(0, 4);
            state.goal.age = clamp(num($('#gAge').value), 1, 120);
            state.goal.amount = Math.max(0, num($('#gAmt').value));
            closeSheet(); update(); toast('목표를 저장했습니다');
          } }
      ]);
    $('#gBirth').value = state.settings.birthYear || '';
    $('#gAge').value = goalAge() || '';
    $('#gAmt').value = comma(goalAmount());
    var pv = function () {
      var by = num($('#gBirth').value), ag = num($('#gAge').value), am = num($('#gAmt').value);
      $('#gPreview').innerHTML = (by && ag)
        ? '<b>' + (by + ag) + '년</b>(' + (by + ag - THIS_YEAR) + '년 뒤)까지 <b>' + won(am) + '</b>'
        : '출생연도와 목표 나이를 입력하면 목표 연도가 계산됩니다';
    };
    ['#gBirth', '#gAge', '#gAmt'].forEach(function (s) { $(s).addEventListener('input', pv); });
    pv();
  }

  /* ── 기록 추가 ──
     캡처 시트가 같은 시트 요소를 재사용하므로, 입력값은 DOM 이 아니라
     recDraft 에 보관했다가 돌아올 때 다시 그립니다. */
  var recDraft = null;

  function syncDraft() {
    if (!$('#rDate')) return;
    recDraft.date = $('#rDate').value || todayISO();
    recDraft.assets = num($('#rAssets').value);
    recDraft.debts = num($('#rDebts').value);
    recDraft.note = $('#rNote').value;
  }

  function openRecordSheet(fresh) {
    var t = totals();
    if (fresh !== false || !recDraft) {
      recDraft = { date: todayISO(), assets: Math.round(t.assets), debts: Math.round(t.debts), note: '', shots: [] };
    }
    openSheet('이번 주 기록',
      '<div class="field"><label>날짜</label><input type="date" id="rDate"></div>' +
      '<div class="field"><label>총자산</label>' +
        '<div class="suffix-wrap"><input inputmode="numeric" id="rAssets"><span class="suffix">만원</span></div></div>' +
      '<div class="field"><label>총부채</label>' +
        '<div class="suffix-wrap"><input inputmode="numeric" id="rDebts"><span class="suffix">만원</span></div></div>' +
      '<div class="field"><label>순자산</label><input id="rNet" readonly></div>' +
      '<button class="btn-secondary btn-wide" id="rCapture">📷 캡처에서 금액 읽기</button>' +
      '<div class="shot-strip" id="rShots"></div>' +
      '<div class="field"><label>메모 (선택)</label><input id="rNote" placeholder="예: 상여금 입금"></div>',
      [
        { label: '취소', cls: 'btn-secondary', on: function () { recDraft = null; closeSheet(); } },
        { label: '저장', cls: 'btn-primary', on: saveRecord }
      ]);

    $('#rDate').value = recDraft.date;
    $('#rAssets').value = comma(recDraft.assets);
    $('#rDebts').value = comma(recDraft.debts);
    $('#rNote').value = recDraft.note || '';
    var sync = function () {
      $('#rNet').value = won(num($('#rAssets').value) - num($('#rDebts').value));
    };
    $('#rAssets').addEventListener('input', sync);
    $('#rDebts').addEventListener('input', sync);
    sync();
    renderShotStrip();

    $('#rCapture').addEventListener('click', function () {
      syncDraft();
      openCapture({
        title: '캡처에서 총자산 읽기', multi: true, keepImages: true,
        onCancel: function () { openRecordSheet(false); },
        onDone: function (sumWon, shots) {
          recDraft.assets = Math.round(sumWon / 10000);
          recDraft.shots = recDraft.shots.concat(shots || []);
          openRecordSheet(false);
          toast('총자산에 반영했습니다');
        }
      });
    });
  }

  function renderShotStrip() {
    var box = $('#rShots');
    if (!box || !recDraft) return;
    box.innerHTML = '';
    recDraft.shots.forEach(function (src) {
      var im = document.createElement('img');
      im.src = src; im.className = 'thumb';
      box.appendChild(im);
    });
  }

  function saveRecord() {
    syncDraft();
    var date = recDraft.date || todayISO();
    var a = num(recDraft.assets), d = num(recDraft.debts);
    var note = String(recDraft.note || '').trim();
    var shots = recDraft.shots.slice();

    var ids = [];
    var puts = shots.map(function (src) {
      var sid = id();
      ids.push(sid);
      return idbPut('shots', sid, src)['catch'](function () { return null; });
    });

    Promise.all(puts).then(function () {
      state.records = state.records.filter(function (r) { return r.date !== date; });
      state.records.push({ id: id(), date: date, assets: a, debts: d, net: a - d, note: note, shots: ids });
      state.records.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
      recDraft = null;
      save(true);
      closeSheet();
      renderRecords(); renderHome();
      toast(date + ' 기록을 저장했습니다');
    });
  }

  /* ── 캡처(OCR) ── */
  function openCapture(opts) {
    var picked = {};          // 원 단위 숫자 → true
    var images = [];

    openSheet(opts.title || '캡처에서 금액 읽기',
      '<p class="hint" style="margin-top:0">증권사·은행 앱 화면을 캡처해 불러오면 금액 후보를 찾아 줍니다. ' +
      '맞는 숫자를 눌러 선택하세요.' + (opts.multi ? ' 여러 장을 더해 합계로 넣을 수 있습니다.' : '') + '</p>' +
      '<button class="btn-primary btn-wide" id="cPick">사진 선택</button>' +
      '<div class="ocr-status" id="cStatus"></div>' +
      '<div id="cGroups"></div>' +
      '<div class="ocr-sum" id="cSum"></div>',
      [
        { label: '취소', cls: 'btn-secondary', on: function () {
            if (opts.onCancel) opts.onCancel(); else closeSheet();
          } },
        { label: '적용', cls: 'btn-primary', on: function () {
            var sum = Object.keys(picked).reduce(function (s, k) { return s + (picked[k] ? +k : 0); }, 0);
            if (!sum) { toast('숫자를 하나 이상 선택하세요'); return; }
            if (!opts.onCancel) closeSheet();
            opts.onDone(sum, opts.keepImages ? images : []);
          } }
      ]);

    var fileInput = $('#fileImg');
    fileInput.value = '';
    $('#cPick').addEventListener('click', function () {
      if (!opts.multi) fileInput.removeAttribute('multiple'); else fileInput.setAttribute('multiple', '');
      fileInput.click();
    });

    function status(msg, pct) {
      var el = $('#cStatus');
      if (!el) return;
      el.innerHTML = msg
        ? '<div class="ocr-bar"><i style="width:' + Math.round((pct || 0) * 100) + '%"></i></div><span>' + esc(msg) + '</span>'
        : '';
    }

    function refreshSum() {
      var keys = Object.keys(picked).filter(function (k) { return picked[k]; });
      var sum = keys.reduce(function (s, k) { return s + (+k); }, 0);
      $('#cSum').innerHTML = keys.length
        ? '선택 ' + keys.length + '개 · 합계 <b>' + won(Math.round(sum / 10000)) + '</b>'
        : '<span style="color:var(--text-3)">숫자를 눌러 선택하세요</span>';
    }

    function addGroup(src, nums) {
      var g = document.createElement('div');
      g.className = 'ocr-group';
      g.innerHTML = '<img src="' + src + '" class="thumb lg">' +
        '<div class="chips">' + (nums.length
          ? nums.map(function (n) {
              return '<button class="num-chip" data-n="' + n + '">' + n.toLocaleString() + '</button>';
            }).join('')
          : '<span class="none">숫자를 찾지 못했습니다</span>') + '</div>';
      $$('.num-chip', g).forEach(function (b) {
        b.addEventListener('click', function () {
          var n = b.dataset.n;
          if (!opts.multi) {                       // 단일 선택 모드
            picked = {};
            $$('.num-chip').forEach(function (x) { x.classList.remove('on'); });
          }
          picked[n] = !picked[n];
          b.classList.toggle('on', !!picked[n]);
          refreshSum();
        });
      });
      $('#cGroups').appendChild(g);
    }

    function handleFiles(files) {
      var list = Array.prototype.slice.call(files);
      if (!list.length) return;
      status('이미지를 여는 중', 0.05);
      var chain = Promise.resolve();
      list.forEach(function (f) {
        chain = chain.then(function () {
          return shrink(f).then(function (src) {
            images.push(src);
            return OCR.extractNumbers(src, status).then(function (nums) {
              addGroup(src, nums);
              // 가장 큰 값은 대개 총액이라 미리 선택해 둔다
              if (nums.length) {
                var first = $$('.num-chip', $('#cGroups').lastChild)[0];
                if (first && (opts.multi || !Object.keys(picked).length)) {
                  first.click();
                }
              }
            })['catch'](function (e) {
              addGroup(src, []);
              toast(e.message || '숫자를 읽지 못했습니다');
            });
          });
        });
      });
      chain.then(function () { status(''); refreshSum(); });
    }

    fileInput.onchange = function () { handleFiles(this.files); this.value = ''; };
    refreshSum();
  }

  /** 이미지를 적당한 크기의 JPEG data URL 로 줄인다 (저장 용량 절약) */
  function shrink(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var MAX = 1400;
          var s = Math.min(1, MAX / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = function () { rej(new Error('이미지를 열지 못했습니다')); };
        img.src = fr.result;
      };
      fr.onerror = function () { rej(new Error('파일을 읽지 못했습니다')); };
      fr.readAsDataURL(file);
    });
  }

  /* ── 설정 ── */
  function openSettings() {
    openSheet('설정',
      '<div class="field"><label>화면 테마</label><select id="sTheme">' +
        '<option value="auto">시스템 설정</option><option value="dark">다크</option><option value="light">라이트</option>' +
      '</select></div>' +
      '<div class="set-block">' +
        '<div class="set-title">데이터 백업</div>' +
        '<p class="hint">데이터는 이 아이폰에만 저장됩니다. 가끔 파일로 내보내 두면 안전합니다.</p>' +
        '<div class="btn-row"><button class="btn-secondary" id="sExport">내보내기</button>' +
        '<button class="btn-secondary" id="sImport">가져오기</button></div>' +
        '<div class="save-state" id="saveState"></div>' +
        '<div class="save-state" id="persistState"></div>' +
      '</div>' +
      '<div class="set-block">' +
        '<div class="set-title">앱 업데이트</div>' +
        '<div class="ver-row"><span>설치된 버전</span><b>v' + VERSION + '</b></div>' +
        '<button class="btn-secondary btn-wide" id="sUpdate" style="margin-top:11px">최신 버전 강제로 받아오기</button>' +
      '</div>' +
      '<div class="set-block">' +
        '<div class="set-title">초기화</div>' +
        '<p class="hint">모든 항목과 기록이 삭제됩니다.</p>' +
        '<button class="btn-danger btn-wide" id="sReset" style="margin-top:11px">전체 초기화</button>' +
      '</div>' +
      '<p class="footnote">이 앱의 숫자는 입력값에 따른 단순 비교이며 투자 권유가 아닙니다.</p>',
      [{ label: '닫기', cls: 'btn-secondary', on: closeSheet }]);

    var th = $('#sTheme');
    th.value = state.settings.theme || 'auto';
    th.addEventListener('change', function () {
      state.settings.theme = th.value; applyTheme(); save(true);
      requestAnimationFrame(function () { renderHome(); });
    });

    $('#sExport').addEventListener('click', exportData);
    $('#sImport').addEventListener('click', function () { $('#fileJson').click(); });
    $('#sUpdate').addEventListener('click', forceUpdate);
    $('#sReset').addEventListener('click', function () {
      if (!confirm('모든 항목과 기록이 삭제됩니다. 계속할까요?')) return;
      if (!confirm('되돌릴 수 없습니다. 백업은 하셨나요?')) return;
      state = defaultState();
      save(true); closeSheet(); renderAll();
      toast('초기화했습니다');
    });

    if (lastSaved) $('#saveState').textContent = '마지막 저장 ' + new Date(lastSaved).toLocaleString('ko-KR');
    requestPersist().then(function (p) {
      var el = $('#persistState');
      if (!el) return;
      el.textContent = p === true ? '영구 저장 허용됨 — 데이터가 자동으로 지워지지 않습니다'
        : p === false ? '영구 저장 미허용 — 홈 화면에 추가하면 더 안전합니다' : '';
    });
  }

  function applyTheme() {
    var t = state.settings.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) requestAnimationFrame(function () { meta.setAttribute('content', cvar('--bg') || '#0A0D14'); });
  }

  /* ── 백업 ── */
  function exportData() {
    var payload = JSON.stringify({ app: '자산 목표', version: VERSION, exportedAt: new Date().toISOString(), data: state }, null, 2);
    var fname = '자산목표_' + todayISO() + '.json';
    var blob = new Blob([payload], { type: 'application/json' });
    if (navigator.canShare && window.File) {
      try {
        var f = new File([blob], fname, { type: 'application/json' });
        if (navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: fname })
            .then(function () { toast('백업 파일을 내보냈습니다'); })['catch'](function () {});
          return;
        }
      } catch (e) {}
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
        var p = JSON.parse(fr.result);
        var incoming = p && p.data ? p.data : p;
        if (!incoming) throw new Error('형식 오류');
        if (incoming.items || incoming.records) incoming = normalize(incoming);
        else if (incoming.assets || incoming.history) incoming = migrateV1(incoming);
        else throw new Error('형식 오류');
        if (!confirm('현재 데이터를 백업 파일 내용으로 덮어씁니다. 계속할까요?')) return;
        state = incoming;
        save(true); applyTheme(); closeSheet(); renderAll();
        toast('데이터를 복원했습니다');
      } catch (e) {
        toast('가져오기 실패 — 올바른 백업 파일이 아닙니다');
      }
    };
    fr.readAsText(file);
  }

  /* ═══════════ 업데이트 ═══════════ */
  function initUpdater() {
    if (!('serviceWorker' in navigator) || location.protocol.indexOf('http') !== 0) return;
    var had = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!had || reloading) return;
      reloading = true; location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        reg.update();
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('새 버전을 받았습니다 — 새로고침합니다');
              sw.postMessage('skipWaiting');
            }
          });
        });
      })['catch'](function () {});
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); })['catch'](function () {});
    });
  }

  function forceUpdate() {
    toast('최신 버전을 받아오는 중…');
    save(true);
    var jobs = [];
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
      }));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      }));
    }
    Promise.all(jobs)['catch'](function () {}).then(function () {
      var base = location.href.split('?')[0].split('#')[0];
      location.replace(base + '?u=' + Date.now());
    });
  }

  /* ═══════════ 오케스트레이션 ═══════════ */
  var raf;
  function update() {
    save();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { renderHome(); renderSums(); });
  }
  function renderAll() {
    applyTheme();
    renderItems();
    renderSums();
    renderHome();
    renderRecords();
  }

  function initTabs() {
    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        $$('.tab-panel').forEach(function (p) {
          p.classList.toggle('is-active', p.id === 'panel-' + btn.dataset.tab);
        });
        window.scrollTo(0, 0);
        requestAnimationFrame(function () { Chart.redraw(); });
      });
    });
  }

  function init() {
    initTabs();
    initUpdater();
    requestPersist();

    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnEditGoal').addEventListener('click', openGoalSheet);

    $$('#segRange button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.settings.chartRange = b.dataset.v;
        $$('#segRange button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        save(); renderGoalChart();
      });
    });
    $('#sheetBackdrop').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });

    $('#btnAddAsset').addEventListener('click', function () {
      state.items.push({ id: id(), kind: 'asset', name: '', amount: 0 });
      renderItems(); update();
      var last = $('#assetList').lastElementChild;
      if (last) { $('.row-name', last).focus(); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
    $('#btnAddDebt').addEventListener('click', function () {
      state.items.push({ id: id(), kind: 'debt', name: '', amount: 0 });
      renderItems(); update();
      var last = $('#debtList').lastElementChild;
      if (last) { $('.row-name', last).focus(); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });

    $('#btnCaptureAll').addEventListener('click', function () {
      openCapture({
        title: '캡처로 자산 합계 입력', multi: true,
        onDone: function (sumWon) {
          var man = Math.round(sumWon / 10000);
          var assets = state.items.filter(function (i) { return i.kind !== 'debt'; });
          var target = assets[0];
          if (!target) {
            target = { id: id(), kind: 'asset', name: '캡처 합계', amount: 0 };
            state.items.unshift(target);
          }
          if (assets.length > 1) {
            if (!confirm('자산 항목이 여러 개입니다.\n“' + (target.name || '첫 항목') + '”에 ' + won(man) + '을 넣을까요?\n' +
                         '취소하면 새 항목으로 추가합니다.')) {
              target = { id: id(), kind: 'asset', name: '캡처 합계 ' + todayISO(), amount: 0 };
              state.items.push(target);
            }
          }
          target.amount = man;
          renderItems(); update();
          toast(won(man) + ' 반영했습니다');
        }
      });
    });

    $('#fileJson').addEventListener('change', function () {
      if (this.files && this.files[0]) importData(this.files[0]);
      this.value = '';
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if ((state.settings.theme || 'auto') === 'auto') { applyTheme(); renderAll(); }
    });

    // 앱을 다시 열 때 다른 탭/창에서 바뀐 내용을 반영
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') save();
    });

    load().then(function (s) {
      state = s;
      save(true);
      renderAll();
    })['catch'](function () {
      state = defaultState();
      renderAll();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
