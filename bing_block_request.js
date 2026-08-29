// ============================================================
// Bing 去广告 - 请求拦截脚本 (Loon http-request)  v1
// 作用：在「请求发出前」直接拦截广告 / RTB 竞价 / 推广 / 追踪域名。
//       这是原 [Rule] 大量 DOMAIN-SUFFIX,REJECT 规则的纯 JS 替代方案——
//       不再依赖 Loon 规则引擎，所有拦截逻辑都在脚本里。
// 触发：由 .plugin 的 `request if ${url} ~= /^https?:\/\//i` 在请求头阶段调用。
// 拦截方式：返回空 200 响应（$done({response})），请求根本不会到达真实服务器，
//           等价于 REJECT，但避免了脚本引擎之外的规则匹配，逻辑集中在 JS。
// 注意：本脚本只按「域名后缀」做判断，命中列表才拦截，其余请求一律 $done({}) 放行，
//       不会误伤 Bing / MSN 的正常接口。
// ============================================================

(function () {
  const url = ($request && $request.url) || '';
  let host = '';
  const m = url.match(/^https?:\/\/([^\/?#]+)/i);
  if (m) host = m[1].toLowerCase();

  // —— 广告 / 竞价 / 追踪域名后缀表（由原 [Rule] REJECT 规则迁移而来，真机抓包实测）——
  // 只要 host 等于某后缀、或以「.后缀」结尾，即判定为广告/追踪请求。
  const BLOCK_SUFFIXES = [
    // ① RTB 实时竞价（关掉它就没有广告可投）
    'srtb.msn.com', 'srtb.msn.cn',
    // ② Microsoft 自有广告域
    'msads.net', 'ads.msn.com', 'bingads.microsoft.com', 'ads1.msads.net', 'ads2.msads.net',
    // ③ 推广 / 奖励平台（含 promotions / limitedTimeOffer / brandId 卡片）
    'prod.rewardsplatform.microsoft.com',
    // ④ 第三方广告 / 追踪联盟（覆盖大多数通用广告）
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
    'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'criteo.com', 'criteo.net',
    'moatads.com', 'spotx.tv', 'openx.net', 'scorecardresearch.com', 'taboola.com',
    'outbrain.com', 'adform.net', 'adroll.com', 'advertising.com', 'adtechus.com',
    'adsrvr.org', 'bounceexchange.com', 'rfihub.com', 'crwdcntrl.net', 'adsystem.com', 'adservice.com',
    // ⑤ 行为 / 归因追踪（不影响广告显示，仅停止数据上报）
    'analytics.adjust.io', 'analytics.adjust.com',
    'self.events.data.microsoft.com', 'gateway.bingviz.microsoftapp.net',
    'firebase-settings.crashlytics.com', 'firebaselogging-pa.googleapis.com',
    // ⑥ 文章信息流里的第三方植入内容（一点资讯 / Yidian 等）
    'yidianzixun.com', 'go2yd.com', 'doris.yidianzixun.com',
  ];

  let blocked = false;
  for (let i = 0; i < BLOCK_SUFFIXES.length; i++) {
    const s = BLOCK_SUFFIXES[i];
    if (host === s || host.endsWith('.' + s)) { blocked = true; break; }
  }

  const isDebug = /[?&]__debug=1/.test(url) || /[?&]__adblock=1/.test(url);

  if (!blocked) {
    // 白名单：直接放行，原样发送
    $done({});
    return;
  }

  if (isDebug) {
    console.log('[Bing去广告-请求] BLOCK host=' + host + ' url=' + url.slice(0, 140));
  } else {
    console.log('[Bing去广告-请求] block=' + host);
  }

  // 返回空响应：请求被「掐断」在本地，不向广告服务器发任何数据包。
  // 同时带一个自证明响应头，便于抓包确认该请求确实被 JS 拦截。
  $done({
    response: {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '2',
        'X-Loon-AdBlock-Req': 'blocked=1',
      },
      body: '{}',
    },
  });
})();
