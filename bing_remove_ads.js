// ============================================================
// Bing 去广告脚本 (Loon http-response)  v5
// 适用：Microsoft Bing App / Bing 页面
// 功能：
//   1. HTML 搜索结果页：移除广告容器（class 含 b_ad / ads / ad-slide 等）
//   2. JSON 搜索 / 信息流 API：递归移除被标记为广告的对象与广告专用数组
//   3. 文章详情页 viewsfullpage（region:"river"+dataTemplate:"partnerappviews-*"）：
//      自动清理 cards 数组中 type:"nativead" 占位项（Bing 国区常见的交错广告位）
//   4. 调试模式：URL 带 ?__debug=1 或请求头 X-Bing-Debug: 1 时，
//      在 Loon 日志打印完整响应结构，便于定位新的广告字段
// 说明：本脚本对静态资源(图片/JS/CSS)直接放行，只处理 HTML / JSON。
// 自证明：所有处理的响应都会带 X-Loon-AdBlock 响应头，便于抓包验证。
// v5 变更：每条命中响应打一行 Loon 日志（看脚本是否真在跑的最直接方法）。
// ============================================================

(function () {
  const url = $request.url || '';
  const reqHeaders = $request.headers || {};

  const isDebug =
    /[?&]__debug=1/.test(url) ||
    /^\s*1\s*$/.test(getHeader(reqHeaders, 'x-bing-debug') || '');

  const respHeaders = ($response && $response.headers) || {};
  const ct = getHeader(respHeaders, 'content-type') || '';
  let body = ($response && $response.body) || '';

  // 仅处理 HTML / JSON；其余（图片、脚本、字体等）直接放行
  if (!/text\/html|application\/json|text\/json|\bjson\b/i.test(ct)) {
    $done({});
    return;
  }

  const isHTML = /text\/html/i.test(ct);

  // 文章 / 信息流接口（assets.msn.com 的 news feed）：需额外剔除 recoDoc 推广卡
  const isNewsFeed = /assets\.msn\.com\/service\/news\/feed\//i.test(url);

  // 文章详情页（pageId=sapphireviews = 国区 Bing 文章页）—— cards 列表里 nativead 与 article 交错
  const isArticleDetail = /assets\.msn\.com\/service\/news\/feed\/pages\/viewsfullpage/i.test(url);

  let removed = 0;
  try {
    if (isHTML) {
      body = stripHtmlAds(body);
    } else {
      const r = stripJsonAds(body, isNewsFeed);
      body = r.body;
      removed = r.removed;
    }
  } catch (e) {
    console.log('[Bing去广告] 解析异常: ' + (e && e.message ? e.message : e));
  }

  if (isDebug) {
    console.log('[Bing去广告][DEBUG] url=' + url);
    console.log('[Bing去广告][DEBUG] content-type=' + ct);
    console.log('[Bing去广告][DEBUG] body(前2000)=' + String(body).slice(0, 2000));
  }

  // 自证明响应头：只要本脚本真的跑过这条响应，就会带上 X-Loon-AdBlock。
  // 下次抓包只要看到这个头，就能确认插件已生效；removed=0 说明本响应无广告。
  // （仅对我们会处理的 html/json 响应打标，静态资源已在上方直接放行、不会到这）
  const outHeaders = {};
  for (const k in respHeaders) outHeaders[k] = respHeaders[k];
  outHeaders['X-Loon-AdBlock'] = 'removed=' + (typeof removed !== 'undefined' ? removed : 0) +
    ';v=5' +
    (isNewsFeed ? ';feed=1' : '') +
    (isArticleDetail ? ';articleDetail=1' : '') +
    (isHTML ? ';html=1' : '');

  // v5: 每条命中响应都打一行 Loon 日志，便于确认脚本真在跑
  try {
    console.log('[Bing去广告] v5 OK url=' + url.slice(0, 120) + ' ct=' + ct.slice(0, 30) +
      ' removed=' + (typeof removed !== 'undefined' ? removed : 0));
  } catch (e) {}

  $done({ headers: outHeaders, body: body });
})();

// ------------------------------------------------------------
// 工具：不区分大小写读取 header
// ------------------------------------------------------------
function getHeader(headers, name) {
  if (!headers) return undefined;
  const lname = String(name).toLowerCase();
  for (const k in headers) {
    if (k.toLowerCase() === lname) return headers[k];
  }
  return undefined;
}

// ------------------------------------------------------------
// HTML：移除 Bing 广告容器
// ------------------------------------------------------------
function stripHtmlAds(html) {
  if (typeof html !== 'string') return html;

  const patterns = [
    // 搜索推广结果（Bing 经典标记 b_ad）
    /<li[^>]*class="[^"]*\bb_ad\b[^"]*"[\s\S]*?<\/li>/gi,
    // 通用广告容器
    /<div[^>]*class="[^"]*\b(b_ad|ads|ad_block|ad-slide|adUnit|ads-feed|ads-container)\b[^"]*"[\s\S]*?<\/div>/gi,
    // 推广 section
    /<section[^>]*class="[^"]*\b(ad|ads|promoted)\b[^"]*"[\s\S]*?<\/section>/gi,
    // 带 aad 标记的容器
    /<[^>]*data-aad[^>]*>[\s\S]*?<\/(?:div|li|section)>/gi,
  ];

  let out = html;
  patterns.forEach(function (p) {
    out = out.replace(p, '');
  });

  // 兜底：隐藏残留广告容器（避免空白占位）
  out = out.replace(
    /(<div[^>]*\bid="[^"]*\b(ad|ads)\b[^"]*"[^>]*>)/gi,
    '$1 style="display:none!important;"'
  );

  return out;
}

// ------------------------------------------------------------
// JSON：递归移除广告对象与广告数组
//   isNewsFeed=true 时，额外剔除文章/信息流里的 recoDoc 推广卡
//   （webcontent=第三方一点资讯植入；slideshow(placement:River)=微软推荐位）
// ------------------------------------------------------------
function stripJsonAds(text, isNewsFeed) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return text;
  }

  // 是否剔除 slideshow(River) 推荐位卡片（默认开；若只想删第三方植入、保留编辑相关推荐，改为 false）
  const BLOCK_SLIDESHOW_RIVER = true;

  // 常见广告标记字段（命中其一即视为广告对象）
  // 下列字段均来自真实设备抓包：
  //   nativead / wpoNativeAdServed / brandId / impressionId / clickUrl /
  //   sponsoredBy / advertiser / campaignId / creativeId / adRef ...
  const adKeys = [
    'isAd', 'adType', 'AdType', 'isAdvertisement', 'promoted',
    'ImpressionId', 'impressionId', 'adIndex', 'isSponsored',
    'sponsored', 'isPromoted', 'adContent', 'advertisement', 'isAdItem',
    'nativeAd', 'nativead', 'isNativeAd', 'sponsoredBy', 'advertiser',
    'advertiserId', 'sponsorId', 'adId', 'campaignId', 'creativeId',
    'clickUrl', 'clickThroughUrl', 'landingUrl', 'adRef', 'adsServed',
    'wpoNativeAdServed', 'bannerImpressionOffer', 'limitedTimeOffer',
    'limitedTimeOfferBanner', 'brandId', 'offerId', 'rewardName',
  ];

  // 已知广告专用数组字段（整组清空）
  const adArrays = /^(ads|advertisements|promotions|promotedList|sponsoredResults|adResults|adItems|nativeAds)$/i;

  let removed = 0;

  function isAdObject(o) {
    if (!o || typeof o !== 'object') return false;

    // 1) 明确 type 标记（来自真实抓包：首页信息流原生广告卡 {"type":"nativead",...}）
    if (o.type && typeof o.type === 'string') {
      const t = o.type.toLowerCase();
      if (t === 'nativead' || t === 'ad' || t === 'sponsored' ||
          t === 'promoted' || /nativead|sponsor|promoted/.test(t)) {
        return true;
      }
    }

    // 2) 广告字段命中
    for (let i = 0; i < adKeys.length; i++) {
      const k = adKeys[i];
      if (k in o) {
        const v = o[k];
        if (v === true) return true;
        if (typeof v === 'string' && /ad|promo|sponsor/i.test(v)) return true;
      }
    }

    // 3) 标题前缀标记
    if (typeof o.title === 'string' && /^(广告|推广|sponsored|advertisement|ad[:\s])/i.test(o.title)) {
      return true;
    }

    // 4) 带推广 / 赞助字段
    if (o.promoter || o.sponsoredBy || o.advertiser || o.advertiserId || o.sponsorId) return true;

    // 5) rewards 平台里的合作/品牌推广条目（如 Bing_Sapphire_AppInstall_*_Partner）
    if (typeof o.name === 'string' && /_partner$|partner_|limitedtimeoffer|brand/i.test(o.name) &&
        (o.brandId || o.rewardName || o.config)) {
      return true;
    }

    return false;
  }

  // 文章/信息流里的 recoDoc 推广卡（非原生广告，但属于植入推荐）
  function isPromoModule(o) {
    if (!o || typeof o !== 'object') return false;
    const t = (o.type || '').toLowerCase();

    // 1) 第三方注入内容（一点资讯 / yidianzixun 等）—— 明确推广
    if (t === 'webcontent') return true;

    // 2) 推荐/广告位轮播（River 为微软推荐位）
    if (t === 'slideshow' && BLOCK_SLIDESHOW_RIVER && /river/i.test(o.placement || '')) return true;

    // 3) 带 recoDocMetadata 且跳转到第三方域名
    //    注意：Bing 国区文章链接是 www.msn.cn（.cn 后缀），与 msn.com 同为微软一手域名，
    //    白名单必须同时覆盖 .com / .cn，否则会把所有正常文章误删。
    if (o.recoDocMetadata) {
      const u = o.url || o.targetUrl || o.clickUrl || '';
      const m = u.match(/^https?:\/\/([^/]+)/i);
      if (m) {
        const h = m[1].toLowerCase();
        if (h && !/(^|\.)(msn|bing|microsoft)\.(com|cn)$/.test(h)) return true;
      }
    }
    return false;
  }

  function clean(node) {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (isAdObject(item) || (isNewsFeed && isPromoModule(item))) {
          node.splice(i, 1);
          removed++;
          continue;
        }
        clean(item);
      }
    } else if (node && typeof node === 'object') {
      for (const k in node) {
        if (adArrays.test(k) && Array.isArray(node[k])) {
          removed += node[k].length;
          node[k] = [];
        }
      }
      for (const k in node) {
        if (node[k] && typeof node[k] === 'object') clean(node[k]);
      }
    }
  }

  clean(data);
  console.log('[Bing去广告] 已移除广告条目数=' + removed);
  return { body: JSON.stringify(data), removed: removed };
}
