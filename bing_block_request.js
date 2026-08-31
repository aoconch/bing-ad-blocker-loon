// ============================================================
// Bing 去广告 - 请求拦截脚本 (Loon http-request)  v2
// 作用：在「请求发出前」直接拦截广告 / RTB 竞价 / 推广 / 追踪。
// v2：额外按 URL 路径拦截 assets.msn.*/bundles 里的 ads-utils 等广告脚本
//     （HAR #290：Booking.com Ad 由客户端广告 JS + enableIntraArDefAd 渲染）。
// ============================================================

(function () {
  const url = ($request && $request.url) || '';
  let host = '';
  const m = url.match(/^https?:\/\/([^\/?#]+)/i);
  if (m) host = m[1].toLowerCase();

  const BLOCK_SUFFIXES = [
    'srtb.msn.com', 'srtb.msn.cn',
    'msads.net', 'ads.msn.com', 'bingads.microsoft.com', 'ads1.msads.net', 'ads2.msads.net',
    // prod.rewardsplatform.microsoft.com 故意不拦 —— 保留 Bing Rewards
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
    'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'criteo.com', 'criteo.net',
    'moatads.com', 'spotx.tv', 'openx.net', 'scorecardresearch.com', 'taboola.com',
    'outbrain.com', 'adform.net', 'adroll.com', 'advertising.com', 'adtechus.com',
    'adsrvr.org', 'bounceexchange.com', 'rfihub.com', 'crwdcntrl.net', 'adsystem.com', 'adservice.com',
    'analytics.adjust.io', 'analytics.adjust.com',
    'self.events.data.microsoft.com', 'gateway.bingviz.microsoftapp.net',
    'firebase-settings.crashlytics.com', 'firebaselogging-pa.googleapis.com',
    'yidianzixun.com', 'go2yd.com', 'doris.yidianzixun.com',
    // Booking.com 等广告主落地/素材域（阻断创意加载）
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

  // 路径级：MSN 广告工具脚本 / 广告 webpack chunk（即使挂在 assets.msn.cn 合法域下）
  if (!blocked && /\.msn\.(com|cn)$/i.test(host)) {
    if (/ads-utils|libs_ads|\/ads\/|DisplayAds|nativead|ad-plugin|xandr/i.test(url)) {
      blocked = true;
      blockReason = 'path:ads-js';
    }
  }

  const isDebug = /[?&]__debug=1/.test(url) || /[?&]__adblock=1/.test(url);

  if (!blocked) {
    $done({});
    return;
  }

  if (isDebug) {
    console.log('[Bing去广告-请求] BLOCK ' + blockReason + ' host=' + host + ' url=' + url.slice(0, 140));
  } else {
    console.log('[Bing去广告-请求] block=' + host + ' (' + blockReason + ')');
  }

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
