// 2026-09-30第185筆：Service Worker 入口
// 載入 Angular Service Worker（快取、推送通知、點通知開頁面照舊），另外在收到推送時設定 App 圖示上的紅色數字（未讀數）。
// 推送內容的 appBadge 由後端依收件人算好；0 表示清除。
// iPhone（iOS 16.4以上、加到主畫面）、Android／電腦上已安裝的 App 支援；不支援的瀏覽器略過。
var MSG_URL_RE = /^\/(mgnh|users)\/messages(\?t=\d+)?$/;
var MSG_NAV_CACHE = 'msg-pending-nav';

// 2026-10-02第211筆：蘋果裝置改用Declarative Web Push（後端送 web_push:8030＋navigate）。
// 這個監聽必須在載入ngsw之前註冊：收到宣告式推送時停止其他監聽（ngsw），不再自己顯示通知，
// iOS 18.4以上就會用宣告式通知，點了由iOS開啟navigate網址（iPhone點通知不送出點擊事件的問題由iOS自己處理）。
// 不支援宣告式推送的舊版iOS（推送事件沒有event.notification）：由這裡照原本格式顯示通知。
self.addEventListener('push', function (event) {
  var data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch (e) {
    data = null;
  }
  if (!data || data.web_push !== 8030) {
    return; // 一般推送（Chrome、Android）：照原本由ngsw顯示
  }
  event.stopImmediatePropagation();
  var n = data.notification || {};
  var url = data.msgUrl || '';
  var proposed = !!event.notification;
  var jobs = [msgDiag('收到宣告式推送', url + (proposed ? ' 由iOS顯示通知' : ' 不支援宣告式，自己顯示') + ' 未讀=' + data.appBadge)];
  if (!proposed) {
    jobs.push(self.registration.showNotification(n.title || '芯樂生活', {
      body: n.body || '',
      icon: '/assets/icons/icon-192x192.png',
      tag: n.tag || '',
      renotify: true,
      data: { onActionClick: { 'default': { operation: 'navigateLastFocusedOrOpen', url: url } } }
    }));
  }
  if (MSG_URL_RE.test(url)) {
    // 第209筆的補救（App在背景時iOS可能不依navigate換頁）：記下最後推送；推送當下App正開在畫面上不記
    jobs.push(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // ngsw收不到這則推送，改由這裡通知開著的App更新未讀數（與ngsw相同的PUSH訊息）
      list.forEach(function (c) { c.postMessage({ type: 'PUSH', data: data }); });
      if (list.some(function (c) { return c.visibilityState === 'visible'; })) {
        return msgDiag('App正開在畫面上，不記最後推送', url);
      }
      return caches.open(MSG_NAV_CACHE).then(function (c) {
        return c.put('/__msg-last-push', new Response(JSON.stringify({ url: url, tag: n.tag || '', at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
      });
    }).catch(function () { }));
  }
  var nav = self.navigator;
  if (typeof data.appBadge === 'number' && nav && ('setAppBadge' in nav)) {
    jobs.push((data.appBadge > 0 ? nav.setAppBadge(data.appBadge) : nav.clearAppBadge()).catch(function () { }));
  }
  event.waitUntil(Promise.all(jobs));
});

importScripts('./ngsw-worker.js');

// 2026-10-01第208筆：手機上的記錄（iOS 26點通知不轉跳，查實際發生什麼）。記在Cache Storage，「我的訊息」連點標題5下可看。
var MSG_DIAG_CACHE = 'msg-diag';
var diagChain = Promise.resolve();
function msgDiag(e, d) {
  diagChain = diagChain.then(function () {
    return caches.open(MSG_DIAG_CACHE).then(function (c) {
      return c.match('/__msg-diag').then(function (r) { return r ? r.json() : []; }).catch(function () { return []; }).then(function (list) {
        list.push({ at: Date.now(), who: 'sw', e: e, d: d === undefined ? '' : String(d).slice(0, 200) });
        return c.put('/__msg-diag', new Response(JSON.stringify(list.slice(-60)), { headers: { 'Content-Type': 'application/json' } }));
      });
    });
  }).catch(function () { });
  return diagChain;
}

// 2026-10-01第208筆：記錄ngsw點通知時換頁（navigate）、開新視窗（openWindow）的結果，行為不變
(function () {
  try {
    var origNav = self.WindowClient && WindowClient.prototype.navigate;
    if (origNav) {
      WindowClient.prototype.navigate = function (url) {
        var p = origNav.apply(this, arguments);
        Promise.resolve(p).then(function (c) { msgDiag('navigate結果', c ? '成功 ' + c.url : '回傳null'); }, function (err) { msgDiag('navigate失敗', err && err.message); });
        return p;
      };
    }
    var origOpen = self.Clients && Clients.prototype.openWindow;
    if (origOpen) {
      Clients.prototype.openWindow = function (url) {
        var p = origOpen.apply(this, arguments);
        Promise.resolve(p).then(function (c) { msgDiag('openWindow結果', c ? '成功 ' + c.url : '回傳null'); }, function (err) { msgDiag('openWindow失敗', err && err.message); });
        return p;
      };
    }
  } catch (e) { }
})();

self.addEventListener('push', function (event) {
  var n = null;
  var url = '', tag = '';
  try {
    var data = event.data ? event.data.json() : null;
    if (data && typeof data.appBadge === 'number') {
      n = data.appBadge;
    }
    url = data.notification.data.onActionClick['default'].url || '';
    tag = data.notification.tag || '';
  } catch (e) { }
  var jobs = [msgDiag('收到推送', url + ' tag=' + tag + ' 未讀=' + n)];
  // 2026-10-01第208筆：記下最後一則推送的對話網址；iOS 26點通知時沒有送出點擊事件，App打開時用這筆記錄換頁（msg.service.ts）
  // 2026-10-02第209筆：收到推送當下App正開在畫面上（使用者已看到）就不記，避免之後切回App時又跳頁
  if (MSG_URL_RE.test(url)) {
    jobs.push(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var shown = list.some(function (c) { return c.visibilityState === 'visible'; });
      if (shown) {
        return msgDiag('App正開在畫面上，不記最後推送', url);
      }
      return caches.open(MSG_NAV_CACHE).then(function (c) {
        return c.put('/__msg-last-push', new Response(JSON.stringify({ url: url, tag: tag, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
      });
    }).catch(function () { }));
  }
  var nav = self.navigator;
  if (n !== null && nav && ('setAppBadge' in nav)) {
    jobs.push((n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(function () { }));
  }
  event.waitUntil(Promise.all(jobs));
});

// 2026-10-01第204筆：iPhone點通知常只把App叫到前面或從首頁開啟，忽略通知裡的網址（ngsw的navigate／openWindow）。
// 這裡把要開的網址記在Cache Storage，App啟動或回到前景時由msg.service.ts讀出並換頁（只接受站內訊息頁）。
self.addEventListener('notificationclick', function (event) {
  var url = '';
  try {
    url = event.notification.data.onActionClick['default'].url || '';
  } catch (e) {
    url = '';
  }
  if (!MSG_URL_RE.test(url)) {
    event.waitUntil(msgDiag('點通知（網址不符）', url));
    return;
  }
  var body = JSON.stringify({ url: url, at: Date.now() });
  event.waitUntil(msgDiag('點通知', url).then(function () {
    return caches.open(MSG_NAV_CACHE);
  }).then(function (c) {
    return c.put('/__msg-pending-nav', new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  }).catch(function () { }).then(function () {
    // 2026-10-01第205筆：記下後也直接通知開著的App換頁（iPhone的ngsw換頁失敗時不會送出點通知事件；App回到前景時網址可能還沒記好）
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      msgDiag('通知開著的App', list.length + '個視窗 ' + list.map(function (c) { return c.url.replace(self.registration.scope, '/') + (c.focused ? '(前景)' : ''); }).join(' '));
      list.forEach(function (c) { c.postMessage({ type: 'MSG_NAV', url: url }); });
    });
  }).catch(function () { }));
});
