// ============================================================
// Bing 去广告 - 请求拦截脚本 (Loon http-request)  v3
// 作用：仅在「广告相关 URL」上拦截（由 .plugin 的 URL Guard 限定）。
// v3：.plugin 不再用 /^https?:\/\// 全量匹配——HAR #292 显示全量匹配会
//     Script evaluate timeout，导致 login / bingapiauth / odc 认证失败，
//     Rewards 无法使用。本脚本假定已只在广告域上被调用。
// ============================================================

(function () {
  const url = ($request && $request.url) || '';
  let host = '';
  const m = url.match(/^https?:\/\/([^\/?#]+)/i);
  if (m) host = m[1].toLowerCase();

  // 保险：登录 / Rewards / Office 联邦认证域一律放行（即使误触发也不拦）
  if (/(^|\.)(login\.microsoftonline\.com|odc\.officeapps\.live\.com|rewardsplatform\.microsoft\.com|rewards\.bing\.com|bingapiauth\.sapphire\.microsoftapp\.net|login\.live\.com|account\.microsoft\.com)$/i.test(host)) {
    $done({});
    return;
  }

  const BLOCK_SUFFIXES = [
    'srtb.msn.com', 'srtb.msn.cn',
    'msads.net', 'ads.msn.com', 'bingads.microsoft.com', 'ads1.msads.net', 'ads2.msads.net',
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
    'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'criteo.com', 'criteo.net',
    'moatads.com', 'spotx.tv', 'openx.net', 'scorecardresearch.com', 'taboola.com',
    'outbrain.com', 'adform.net', 'adroll.com', 'advertising.com', 'adtechus.com',
    'adsrvr.org', 'bounceexchange.com', 'rfihub.com', 'crwdcntrl.net', 'adsystem.com', 'adservice.com',
    'analytics.adjust.io', 'analytics.adjust.com',
    'self.events.data.microsoft.com', 'gateway.bingviz.microsoftapp.net',
    'firebase-settings.crashlytics.com', 'firebaselogging-pa.googleapis.com',
    'yidianzixun.com', 'go2yd.com', 'doris.yidianzixun.com',
    'booking.com', 'bstatic.com', 'ctrip.com', 'trip.com',
  ];

  let blocked = false;
  let blockReason = '';
  for (let i = 0; i < BLOCK_SUFFIXES.length; i++) {
    const s = BLOCK_SUFFIXES[i];
    if (host === s || host.endsWith('.' + s)) {
      blocked = true;
      blockReason = 'host:' + s;
      break;
    }
  }

  if (!blocked && /\.msn\.(com|cn)$/i.test(host)) {
    if (/ads-utils|libs_ads|DisplayAds|nativead|ad-plugin|xandr/i.test(url)) {
      blocked = true;
      blockReason = 'path:ads-js';
    }
  }

  if (!blocked) {
    $done({});
    return;
  }

  console.log('[Bing去广告-请求] block=' + host + ' (' + blockReason + ')');

  const isJs = /\.js(\?|$)/i.test(url);
  $done({
    response: {
      status: 200,
      headers: {
        'Content-Type': isJs ? 'application/javascript' : 'application/json',
        'Content-Length': isJs ? '0' : '2',
        'X-Loon-AdBlock-Req': 'blocked=1;reason=' + blockReason,
      },
      body: isJs ? '' : '{}',
    },
  });
})();
