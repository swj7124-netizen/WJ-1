/* 자산 시뮬레이터 — 서비스워커
   오프라인에서도 앱이 열리도록 정적 파일을 캐시합니다.
   사용자 데이터는 캐시가 아니라 localStorage 에 있으므로 캐시를 비워도 안전합니다.

   ※ CACHE 이름은 배포할 때마다 올려야 이전 캐시가 정리됩니다. */

var VERSION = '2.0.0';
var CACHE = 'assetsim-' + VERSION;
var ASSETS = [
  './',
  './index.html',
  './assets/styles.css?v=' + VERSION,
  './assets/chart.js?v=' + VERSION,
  './assets/ocr.js?v=' + VERSION,
  './assets/app.js?v=' + VERSION,
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // 설치 시점에도 HTTP 캐시를 우회해 항상 새 파일을 받는다
      .then(function (c) {
        return Promise.all(ASSETS.map(function (url) {
          return fetch(url, { cache: 'reload' })
            .then(function (res) { return res.ok ? c.put(url, res) : null; })
            .catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 페이지에서 보낸 즉시 적용 요청 */
self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

/**
 * 네트워크 우선 → 실패 시 캐시.
 * 중요: fetch 에 cache:'no-store' 를 주지 않으면 브라우저 HTTP 캐시가
 * 네트워크에 가지 않고 옛 파일을 그대로 돌려주어 배포가 반영되지 않습니다.
 */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // vendor/ 아래는 버전이 바뀌지 않는 대용량 파일이라 캐시 우선 (OCR 엔진 재다운로드 방지)
  if (url.pathname.indexOf('/vendor/') >= 0) {
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (res) {
          if (res && res.ok) {
            var c2 = res.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, c2); });
          }
          return res;
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('./index.html') || caches.match('./');
        });
      })
  );
});
