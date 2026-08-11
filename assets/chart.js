/* ============================================================
   chart.js — 의존성 없는 SVG 차트 (라인 / 스택 영역)
   터치 스크러빙 지원. 오프라인 동작을 위해 외부 라이브러리 미사용.
   ============================================================ */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var registry = [];   // {svg, kind, opts}
  var uid = 0;

  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* 보기 좋은 눈금 간격 */
  function niceStep(span, count) {
    if (!isFinite(span) || span <= 0) return 1;
    var raw = span / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * mag;
  }

  function domain(values, opts) {
    var min = Infinity, max = -Infinity;
    values.forEach(function (v) {
      if (v == null || !isFinite(v)) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (min === Infinity) { min = 0; max = 1; }
    if (opts && opts.includeZero) { if (min > 0) min = 0; if (max < 0) max = 0; }
    if (min === max) { max = min + Math.abs(min || 1) * 0.1 + 1; }

    var pad = (max - min) * 0.10;
    // 0 이 실제 하한이면 축을 0 아래로 늘리지 않는다 (음수 눈금이 생기는 것을 방지)
    var lo = min >= 0 ? 0 : min - pad;
    var hi = max <= 0 ? 0 : max + pad;
    var step = niceStep(hi - lo, 4);
    hi = Math.ceil(hi / step) * step;
    lo = lo === 0 ? 0 : Math.floor(lo / step) * step;
    if (hi === lo) hi = lo + step;
    return { min: lo, max: hi, step: step };
  }

  function path(pts, close, y0) {
    if (!pts.length) return '';
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length; i++) d += 'L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
    if (close) {
      d += 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + y0.toFixed(1);
      d += 'L' + pts[0][0].toFixed(1) + ' ' + y0.toFixed(1) + 'Z';
    }
    return d;
  }

  /* ─────────────────────────────────────────────
     라인 차트
     opts = {
       series: [{ name, color, data:[[x,y],...], dashed, area, dots, width }],
       points: [{ x, y, color, label }],
       height, yFormat(v), xFormat(v), includeZero, onHover(x, rows)
     }
     ───────────────────────────────────────────── */
  function line(svg, opts) {
    register(svg, 'line', opts);
    renderLine(svg, opts);
  }

  function renderLine(svg, o) {
    clear(svg);
    var W = Math.max(260, svg.clientWidth || svg.parentNode.clientWidth || 320);
    var H = o.height || 232;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('height', H);

    var series = (o.series || []).filter(function (s) { return s.data && s.data.length; });
    var pts = o.points || [];
    if (!series.length && !pts.length) return;

    var PL = 46, PR = 14, PT = 14, PB = 26;
    var iw = W - PL - PR, ih = H - PT - PB;

    var allY = [], allX = [];
    series.forEach(function (s) {
      s.data.forEach(function (p) { allX.push(p[0]); allY.push(p[1]); });
    });
    pts.forEach(function (p) { allX.push(p.x); allY.push(p.y); });

    var yd = domain(allY, { includeZero: o.includeZero });
    var xMin = Math.min.apply(null, allX), xMax = Math.max.apply(null, allX);
    if (xMin === xMax) { xMax = xMin + 1; }

    var X = function (v) { return PL + (v - xMin) / (xMax - xMin) * iw; };
    var Y = function (v) { return PT + (1 - (v - yd.min) / (yd.max - yd.min)) * ih; };

    var cLine = css('--line') || 'rgba(255,255,255,.08)';
    var cT3 = css('--text-3') || '#67718A';
    var cT2 = css('--text-2') || '#9BA6BC';

    var defs = el('defs');
    svg.appendChild(defs);

    /* ── y축 그리드 ── */
    for (var v = yd.min; v <= yd.max + 1e-9; v += yd.step) {
      var y = Y(v);
      svg.appendChild(el('line', {
        x1: PL, y1: y, x2: W - PR, y2: y,
        stroke: cLine, 'stroke-width': 1,
        'stroke-dasharray': Math.abs(v) < 1e-9 ? '' : '3 4'
      }));
      var t = el('text', { x: PL - 8, y: y + 3.5, fill: cT3, 'font-size': 10, 'text-anchor': 'end' });
      t.textContent = o.yFormat ? o.yFormat(v) : String(Math.round(v));
      svg.appendChild(t);
    }

    /* ── x축 눈금 ── */
    var tickN = W < 340 ? 4 : 5;
    for (var i = 0; i <= tickN; i++) {
      var xv = xMin + (xMax - xMin) * i / tickN;
      var tx = el('text', {
        x: X(xv), y: H - 8, fill: cT3, 'font-size': 10,
        'text-anchor': i === 0 ? 'start' : i === tickN ? 'end' : 'middle'
      });
      tx.textContent = o.xFormat ? o.xFormat(xv) : String(Math.round(xv));
      svg.appendChild(tx);
    }

    /* ── 시리즈 ── */
    series.forEach(function (s) {
      var p = s.data.map(function (d) { return [X(d[0]), Y(d[1])]; });

      if (s.area) {
        var gid = 'g' + (++uid);
        var lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': .28 }));
        lg.appendChild(el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0 }));
        defs.appendChild(lg);
        svg.appendChild(el('path', { d: path(p, true, PT + ih), fill: 'url(#' + gid + ')' }));
      }

      svg.appendChild(el('path', {
        d: path(p), fill: 'none', stroke: s.color,
        'stroke-width': s.width || 2.2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': s.dashed ? '5 5' : null,
        opacity: s.faded ? .55 : 1
      }));

      if (s.dots) {
        p.forEach(function (q) {
          svg.appendChild(el('circle', { cx: q[0], cy: q[1], r: 3.4, fill: s.color, stroke: css('--surface'), 'stroke-width': 1.6 }));
        });
      }
    });

    /* ── 산점(실제 기록) ── */
    pts.forEach(function (pt) {
      svg.appendChild(el('circle', {
        cx: X(pt.x), cy: Y(pt.y), r: 4.6,
        fill: pt.color, stroke: css('--surface'), 'stroke-width': 2
      }));
    });

    /* ── 스크러빙 ── */
    var xs = [];
    series.forEach(function (s) { s.data.forEach(function (d) { xs.push(d[0]); }); });
    xs = xs.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });

    var cross = el('g', { opacity: 0 });
    var vline = el('line', { y1: PT, y2: PT + ih, stroke: cT2, 'stroke-width': 1, 'stroke-dasharray': '3 3' });
    cross.appendChild(vline);
    var knobs = series.map(function (s) {
      var c = el('circle', { r: 4.5, fill: s.color, stroke: css('--surface'), 'stroke-width': 2 });
      cross.appendChild(c); return c;
    });
    svg.appendChild(cross);

    var hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
    svg.appendChild(hit);

    function valueAt(s, x) {
      var d = s.data, i;
      for (i = 0; i < d.length; i++) if (d[i][0] === x) return d[i][1];
      if (!d.length || x < d[0][0] || x > d[d.length - 1][0]) return null;
      for (i = 1; i < d.length; i++) {
        if (d[i][0] >= x) {
          var t = (x - d[i - 1][0]) / (d[i][0] - d[i - 1][0]);
          return d[i - 1][1] + (d[i][1] - d[i - 1][1]) * t;
        }
      }
      return null;
    }

    function move(ev) {
      if (!xs.length) return;
      var r = svg.getBoundingClientRect();
      var px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      var xv = xMin + (px - PL) / iw * (xMax - xMin);
      var best = xs[0];
      xs.forEach(function (c) { if (Math.abs(c - xv) < Math.abs(best - xv)) best = c; });

      cross.setAttribute('opacity', 1);
      vline.setAttribute('x1', X(best)); vline.setAttribute('x2', X(best));
      var rows = [];
      series.forEach(function (s, i) {
        var val = valueAt(s, best);
        if (val == null) { knobs[i].setAttribute('opacity', 0); return; }
        knobs[i].setAttribute('opacity', 1);
        knobs[i].setAttribute('cx', X(best));
        knobs[i].setAttribute('cy', Y(val));
        rows.push({ name: s.name, color: s.color, value: val });
      });
      if (o.onHover) o.onHover(best, rows);
      if (ev.cancelable) ev.preventDefault();
    }
    function leave() {
      cross.setAttribute('opacity', 0);
      if (o.onHover) o.onHover(null, null);
    }

    hit.addEventListener('touchstart', move, { passive: false });
    hit.addEventListener('touchmove', move, { passive: false });
    hit.addEventListener('touchend', leave);
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', leave);

    if (o.onHover) o.onHover(null, null);
  }

  /* ─────────────────────────────────────────────
     스택 영역 차트
     opts = { x:[...], series:[{name,color,values:[]}], yFormat, xFormat, height }
     ───────────────────────────────────────────── */
  function stack(svg, opts) {
    register(svg, 'stack', opts);
    renderStack(svg, opts);
  }

  function renderStack(svg, o) {
    clear(svg);
    var W = Math.max(260, svg.clientWidth || svg.parentNode.clientWidth || 320);
    var H = o.height || 200;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('height', H);

    var xs = o.x || [], series = o.series || [];
    if (!xs.length || !series.length) return;

    var PL = 46, PR = 14, PT = 12, PB = 24;
    var iw = W - PL - PR, ih = H - PT - PB;

    var totals = xs.map(function (_, i) {
      return series.reduce(function (a, s) { return a + Math.max(0, s.values[i] || 0); }, 0);
    });
    var yd = domain(totals.concat([0]), { includeZero: true });
    var xMin = xs[0], xMax = xs[xs.length - 1];
    if (xMin === xMax) xMax = xMin + 1;

    var X = function (v) { return PL + (v - xMin) / (xMax - xMin) * iw; };
    var Y = function (v) { return PT + (1 - (v - yd.min) / (yd.max - yd.min)) * ih; };

    var cLine = css('--line'), cT3 = css('--text-3');

    for (var v = yd.min; v <= yd.max + 1e-9; v += yd.step) {
      var y = Y(v);
      svg.appendChild(el('line', { x1: PL, y1: y, x2: W - PR, y2: y, stroke: cLine, 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
      var t = el('text', { x: PL - 8, y: y + 3.5, fill: cT3, 'font-size': 10, 'text-anchor': 'end' });
      t.textContent = o.yFormat ? o.yFormat(v) : String(Math.round(v));
      svg.appendChild(t);
    }

    var base = xs.map(function () { return 0; });
    series.forEach(function (s) {
      var top = xs.map(function (_, i) { return base[i] + Math.max(0, s.values[i] || 0); });
      var up = xs.map(function (xv, i) { return [X(xv), Y(top[i])]; });
      var down = xs.map(function (xv, i) { return [X(xv), Y(base[i])]; }).reverse();
      var d = path(up) + 'L' + down.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z';
      svg.appendChild(el('path', { d: d, fill: s.color, opacity: .82 }));
      base = top;
    });

    var tickN = W < 340 ? 4 : 5;
    for (var i = 0; i <= tickN; i++) {
      var xv2 = xMin + (xMax - xMin) * i / tickN;
      var tx = el('text', {
        x: X(xv2), y: H - 7, fill: cT3, 'font-size': 10,
        'text-anchor': i === 0 ? 'start' : i === tickN ? 'end' : 'middle'
      });
      tx.textContent = o.xFormat ? o.xFormat(xv2) : String(Math.round(xv2));
      svg.appendChild(tx);
    }
  }

  /* ── 재렌더 관리 ── */
  function register(svg, kind, opts) {
    var found = registry.filter(function (r) { return r.svg === svg; })[0];
    if (found) { found.kind = kind; found.opts = opts; }
    else registry.push({ svg: svg, kind: kind, opts: opts });
  }
  function redrawAll() {
    registry.forEach(function (r) {
      if (!document.body.contains(r.svg) || !r.svg.clientWidth) return;
      (r.kind === 'stack' ? renderStack : renderLine)(r.svg, r.opts);
    });
  }
  var raf;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(redrawAll); }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', function () { setTimeout(schedule, 240); });

  global.Chart = { line: line, stack: stack, redraw: schedule };
})(window);
