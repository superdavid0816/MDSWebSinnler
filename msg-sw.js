// 2026-09-30第185筆：Service Worker 入口
// 載入 Angular Service Worker（快取、推送通知、點通知開頁面照舊），另外在收到推送時設定 App 圖示上的紅色數字（未讀數）。
// 推送內容的 appBadge 由後端依收件人算好；0 表示清除。
// iPhone（iOS 16.4以上、加到主畫面）、Android／電腦上已安裝的 App 支援；不支援的瀏覽器略過。
importScripts('./ngsw-worker.js');

self.addEventListener('push', function (event) {
  var n = null;
  try {
    var data = event.data ? event.data.json() : null;
    if (data && typeof data.appBadge === 'number') {
      n = data.appBadge;
    }
  } catch (e) {
    n = null;
  }
  var nav = self.navigator;
  if (n === null || !nav || !('setAppBadge' in nav)) {
    return;
  }
  event.waitUntil((n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(function () { }));
});
