// ============================================================
// Bing 去广告脚本 (Loon http-response)  v7
// 适用：Microsoft Bing App / Bing 页面
// 功能：
//   1. HTML 搜索结果页：移除广告容器（class 含 b_ad / ads / ad-slide 等）
//   2. HTML "Ad" 角标：找到带 adLabel/ad-label 角标的外层 card 整张删除（v7 关键修复）
//   3. JSON 搜索 / 信息流 API：递归移除被标记为广告的对象与广告专用数组
//   4. 文章详情页 viewsfullpage（region:"river"+dataTemplate:"partnerappviews-*"）：
//      自动清理 cards 数组中 type:"nativead" 占位项（Bing 国区常见的交错广告位）
//   5. 搜索结果推广卡（Booking.com / 携程 等 "Ad" 标签）：识别 isAd / adType /
//      Algo:"Ads" / moduleType 含 ad|promo / source 为广告网络 等标记并剔除
//   6. 调试模式：URL 带 ?__debug=1 或请求头 X-Bing-Debug: 1 时，
//      在 Loon 日志打印完整响应结构，便于定位新的广告字段
// 说明：本脚本对静态资源(图片/JS/CSS)直接放行，只处理 HTML / JSON。
// 自证明：所有处理的响应都会带 X-Loon-AdBlock 响应头，便于抓包验证。
// v7.1 变更：加 UA 白名单，只在 Bing iOS App 下执行脚本，避免影响 Edge 浏览器访问 bing.com 导致闪退。
// v7 变更：
//   - 修复搜索页"为你精选更多内容"区里 Booking.com Ad 卡片（带 "Ad" 角标）漏删
//     原 v6 逻辑只删了 adLabel <span> 自身，外层 b_card 未删。v7 通过标签栈回溯
//     找到包含角标的最外层块级元素（div/section/li/article）整张删除。
// v6 变更：
//   - 强化搜索结果推广卡识别（Algo:"Ads" / moduleType / cardType / source 广告网络）
//   - 新增 HTML 搜索广告容器（b_pag / promo-card / sponsored-card / ad-slot 等）
//   - 每条命中响应打一行 Loon 日志（含 host，便于确认哪个接口还有广告）
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

  // v7.1 修复：只在 Bing iOS App 的 User-Agent 下执行脚本，避免
  // 影响 Edge 浏览器访问 bing.com 导致页面崩溃（原规则太宽，把所有 bing.com
  // 响应都塞进脚本，改了正常浏览器的页面结构）。
  const ua = (reqHeaders['User-Agent'] || '').toLowerCase();
  if (!/\bbingapp\b|\bing\b.*ios|\bing.*mobile/i.test(ua)) {
    $done({});
    return;
  }

  const isHTML = /text\/html/i.test(ct);

  // 文章 / 信息流接口（assets.msn.com 的 news feed）：需额外剔除 recoDoc 推广卡
  const isNewsFeed = /assets\.msn\.com\/service\/news\/feed\//i.test(url);

  // 文章详情页（pageId=sapphireviews = 国区 Bing 文章页）—— cards 列表里 nativead 与 article 交错
  const isArticleDetail = /assets\.msn\.com\/service\/news\/feed\/pages\/viewsfullpage/i.test(url);

  // 搜索结果页（bing.com / cn.bing.com 的 search / sapphire 接口）
  const isSearch = /bing\.com/i.test(url) && /(search|sapphire|api\/v1|results|query)/i.test(url);

  let removed = 0;
  try {
    if (isHTML) {
      body = stripHtmlAds(body);
    } else {
      const r = stripJsonAds(body, isNewsFeed, isSearch);
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
  const outHeaders = {};
  for (const k in respHeaders) outHeaders[k] = respHeaders[k];
  outHeaders['X-Loon-AdBlock'] = 'removed=' + (typeof removed !== 'undefined' ? removed : 0) +
    ';v=7.1' +
    (isNewsFeed ? ';feed=1' : '') +
    (isArticleDetail ? ';articleDetail=1' : '') +
    (isSearch ? ';search=1' : '') +
    (isHTML ? ';html=1' : '');

  // v6: 每条命中响应都打一行 Loon 日志（含 host），便于确认脚本真在跑、哪个接口还有广告
  try {
    const m = url.match(/^https?:\/\/([^\/]+)/i);
    const host = m ? m[1] : '?';
    console.log('[Bing去广告] v7.1 OK host=' + host + ' removed=' +
      (typeof removed !== 'undefined' ? removed : 0) + ' url=' + url.slice(0, 100));
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
// v7 关键改进：发现 "Ad" 角标时，沿标签栈往上找外层 card 容器整张删除，
// 避免 v6 那样只删了角标 <span> 自身、留下外层 b_card 的 bug。
// ------------------------------------------------------------
function stripHtmlAds(html) {
  if (typeof html !== 'string') return html;

  let out = html;

  // —— Pass 1：能整张识别的广告容器 ——
  const wholePatterns = [
    /<li[^>]*class="[^"]*\bb_ad\b[^"]*"[\s\S]*?<\/li>/gi,
    /<div[^>]*class="[^"]*\b(b_ad|ads|ad_block|ad-slide|adUnit|ads-feed|ads-container|ad-slot|promo-card|sponsored-card|tile--ad|b_pag)\b[^"]*"[\s\S]*?<\/div>/gi,
    /<section[^>]*class="[^"]*\b(ad|ads|promoted)\b[^"]*"[\s\S]*?<\/section>/gi,
    /<[^>]*data-aad[^>]*>[\s\S]*?<\/(?:div|li|section)>/gi,
  ];
  wholePatterns.forEach(function (p) {
    out = out.replace(p, '');
  });

  // —— Pass 2：发现 "Ad" 角标 → 整张外层 card 删除 ——
  // 角标 class 名单（含 Bing 各 UI 变体：搜索结果 / 搜索为你推荐 / 资讯流）
  const badgeClassRe = /<(\w+)([^>]*\bclass="[^"]*\b(adLabel|ad-label|ad-label-text|ad_badge|adBadge|ad-badge|adMarker|ad-marker|b_adlabel|b_adLabel)\b[^"]*"[^>]*)>/gi;
  // 用一个统一的 open/close 正则同时识别开闭标签，遍历到 badge 位置时建立未闭合栈
  const tagRe = /<(\/?)(div|li|section|article)\b[^>]*>/gi;
  // card-like 容器识别（向栈上找最近的这一类整张删）
  const cardClassRe = /\b(b_card|b_algo|b_entity|b_results|b_algoheader|b_answer)\b/;

  // 找出所有角标位置
  const badges = [];
  let bm;
  while ((bm = badgeClassRe.exec(out)) !== null) {
    badges.push(bm.index);
  }
  // 从后往前处理，避免下标偏移
  for (let bi = badges.length - 1; bi >= 0; bi--) {
    const badgePos = badges[bi];
    // 1) 在 badge 之前建立"未闭合"块级元素栈
    tagRe.lastIndex = 0;
    const stack = [];
    let pm;
    while ((pm = tagRe.exec(out)) !== null) {
      if (pm.index >= badgePos) break;
      const isClose = pm[1] === '/';
      const tagName = pm[2];
      if (isClose) {
        if (stack.length > 0 && stack[stack.length - 1].tag === tagName) {
          stack.pop();
        }
      } else {
        stack.push({ pos: pm.index, len: pm[0].length, tag: tagName });
      }
    }
    if (stack.length === 0) continue;
    // 2) 沿栈向上找最近的 card-like 容器
    //    优先级：class 含 b_card/b_algo/b_entity/b_results/b_algoheader/b_answer
    //            > article/section
    //            > 兜底：最内层未闭合 div/li
    let target = null;
    for (let si = stack.length - 1; si >= 0; si--) {
      const cand = stack[si];
      if (cand.tag === 'article' || cand.tag === 'section') {
        target = cand; break;
      }
      const tagSnippet = out.substr(cand.pos, cand.len);
      if (cardClassRe.test(tagSnippet)) {
        target = cand; break;
      }
    }
    if (!target) target = stack[stack.length - 1];
    // 3) 从 target 之后找匹配的同名闭合（按嵌套深度计数）
    const startFrom = target.pos + target.len;
    let depth = 1;
    let endPos = -1;
    tagRe.lastIndex = 0;
    while ((pm = tagRe.exec(out)) !== null) {
      if (pm.index < startFrom) continue;
      const isClose = pm[1] === '/';
      const tagName = pm[2];
      if (tagName !== target.tag) continue;
      if (isClose) {
        depth--;
        if (depth === 0) {
          endPos = pm.index + pm[0].length;
          break;
        }
      } else {
        depth++;
      }
    }
    if (endPos === -1) continue;
    out = out.slice(0, target.pos) + out.slice(endPos);
  }

  // —— Pass 3：兜底，隐藏残留广告容器避免空白占位 ——
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
function stripJsonAds(text, isNewsFeed, isSearch) {
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
    // v6 新增：搜索结果推广卡常见标记
    'adUnit', 'adTile', 'isPaid', 'paidPlacement', 'promotedContent',
    'sponsoredResults', 'marketingContent', 'commercialContent', 'isCommercial',
    'adInfo', 'adData', 'adAttributes', 'Algo', 'moduleType', 'cardType',
    'template', 'source', 'placement', 'dataSource', 'provider',
  ];

  // 已知广告专用数组字段（整组清空）
  const adArrays = /^(ads|advertisements|promotions|promotedList|sponsoredResults|adResults|adItems|nativeAds|adTiles)$/i;

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

    // 1b) v6：Algo / moduleType / cardType / template 等“广告位”标记
    const posMarkers = ['Algo', 'moduleType', 'cardType', 'template', 'placement', 'dataSource'];
    for (let i = 0; i < posMarkers.length; i++) {
      const v = o[posMarkers[i]];
      if (typeof v === 'string' && /(^|\b)(ad|ads|promo|sponsor|advert|commercial|marketing)(\b|$)/i.test(v)) {
        return true;
      }
    }

    // 1c) v6：source / provider 为广告网络域名（Booking、携程、Taboola、Outbrain 等第三方推广）
    if (typeof o.source === 'string' || typeof o.provider === 'string' || typeof o.dataSource === 'string') {
      const s = (o.source || o.provider || o.dataSource || '').toLowerCase();
      if (/booking|ctrip|trip\.com|taboola|outbrain|criteo|pubmatic|doubleclick|adsystem|adnxs|advertiser|yidianzixun|go2yd|appinstall/i.test(s)) {
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
