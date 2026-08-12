/* ============================================================
   ocr.js — 스크린샷에서 금액 숫자를 뽑아냅니다.
   tesseract.js 를 처음 사용할 때만 내려받습니다 (약 10MB, 이후 캐시).
   ============================================================ */
(function (global) {
  'use strict';

  var BASE = 'vendor/tesseract/';
  var worker = null, loading = null;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (global.Tesseract) return res();
      var s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = function () { rej(new Error('OCR 엔진을 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
  }

  function getWorker(onProgress) {
    if (worker) return Promise.resolve(worker);
    if (loading) return loading;
    loading = loadScript(BASE + 'tesseract.min.js').then(function () {
      return global.Tesseract.createWorker('eng', 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE + 'tesseract-core-simd-lstm.wasm.js',
        langPath: 'vendor/tesseract',
        gzip: true,
        logger: function (m) {
          if (!onProgress) return;
          if (m.status === 'loading tesseract core') onProgress('엔진 준비 중', m.progress);
          else if (m.status === 'loading language traineddata') onProgress('글자 인식 데이터 준비 중', m.progress);
          else if (m.status === 'recognizing text') onProgress('숫자를 읽는 중', m.progress);
        }
      });
    }).then(function (w) {
      return w.setParameters({
        tessedit_char_whitelist: '0123456789,',
        tessedit_pageseg_mode: '3'
      }).then(function () { worker = w; return w; });
    })['catch'](function (e) { loading = null; throw e; });
    return loading;
  }

  /** 이미지를 흑백·고대비로 변환. invert=true 면 반전(흰 글씨/진한 배경 대응) */
  function preprocess(img, invert) {
    var MAXW = 1600;
    var s = Math.min(1, MAXW / img.width);
    var w = Math.max(1, Math.round(img.width * s));
    var h = Math.max(1, Math.round(img.height * s));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h), a = d.data;
    for (var i = 0; i < a.length; i += 4) {
      var g = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
      if (invert) g = 255 - g;
      g = g < 128 ? Math.max(0, g * 0.4) : Math.min(255, 128 + (g - 128) * 2.2);
      a[i] = a[i + 1] = a[i + 2] = g;
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('이미지를 열지 못했습니다')); };
      img.src = src;
    });
  }

  /**
   * 이미지에서 "1,234,567" 형태의 금액 후보를 뽑습니다.
   * @returns Promise<number[]> 원 단위 숫자, 큰 값부터
   */
  function extractNumbers(src, onProgress) {
    return loadImage(src).then(function (img) {
      return getWorker(onProgress).then(function (w) {
        // 일반본 + 반전본을 모두 읽어 흰 글씨 헤더까지 놓치지 않는다
        return w.recognize(preprocess(img, false)).then(function (r1) {
          return w.recognize(preprocess(img, true)).then(function (r2) {
            return parseNumbers(r1.data.text + '\n' + r2.data.text);
          });
        });
      });
    });
  }

  /** 천 단위 콤마가 있는 숫자만 신뢰 — 화면의 잡음 숫자를 걸러낸다 */
  function parseNumbers(text) {
    var found = String(text || '').match(/\d{1,3}(?:,\d{3})+/g) || [];
    var seen = {}, out = [];
    found.forEach(function (s) {
      var n = parseInt(s.replace(/,/g, ''), 10);
      if (!isFinite(n) || n < 1000) return;
      if (seen[n]) return;
      seen[n] = 1;
      out.push(n);
    });
    return out.sort(function (a, b) { return b - a; });
  }

  /** 붙여넣은 텍스트에서도 같은 규칙으로 뽑기 */
  function fromText(t) { return parseNumbers(t); }

  function dispose() {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null; loading = null;
  }

  global.OCR = {
    extractNumbers: extractNumbers,
    fromText: fromText,
    dispose: dispose,
    isReady: function () { return !!worker; }
  };
})(window);
