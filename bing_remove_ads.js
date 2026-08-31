// ============================================================
// Bing 去广告脚本 (Loon http-response)  v11
// 适用：Microsoft Bing App / Bing 页面
// 架构：本插件「纯 JS、零 Rule」—— 网络层广告域名由 bing_block_request.js
//       (http-request) 拦截；本脚本只负责「剔除混在合法响应里的内联广告」：
//       Bing 首页信息流 / 搜索结果页 / 文章详情页里嵌的广告 JSON 对象与 HTML 容器。
// 功能：
//   1. HTML 搜索结果页：移除广告容器（class 含 b_ad / ads / ad-slide 等）
//   2. HTML "Ad" 角标：找到带 adLabel/ad-label 角标、或正文仅为 Ad/广告 的外层 card 整张删除
//   3. JSON 搜索 / 信息流 API：递归移除被标记为广告的对象与广告专用数组
//   4. 文章详情页 viewsfullpage：删除 river / riverdb / inarticle / interstitialgallery 等广告区
//   5. AppConfig：清空 intraArticleNativeAd / interstitialNativeAds 等广告位配置
//      （否则客户端仍会画 Ad 占位框，即便 srtb 竞价已被拦截）
//   6. Rewards：独立保守剥离——只清 promotions / *_Partner，绝不触碰 balance/catalog/orders
//   7. 调试模式：URL 带 ?__debug=1 时，在 Loon 日志打印完整响应结构
// 说明：本脚本对静态资源(图片/JS/CSS)直接放行，只处理 HTML / JSON。
// 自证明：所有处理的响应都会带 X-Loon-AdBlock 响应头，便于抓包验证。
// v11 变更（2026-08-31 HAR #289 校准）：
//   - 根因：feed 里 nativead/river 已删，但 AppConfig 仍下发文内/插页广告位，
//     客户端照样渲染 "Ad" 区域（srtb 被拦后变成空广告框）。
//   - 新增 stripAppConfigAds：针对性清空广告位配置键，不再对 config 跑激进 isAdObject。
//   - 新增 stripRewardsAds：奖励接口走保守路径，保证积分/兑换/订单可用。
//   - 额外删除 region: inarticle / interstitialgallery / rectangle / sliver。
// v10 变更：国区 assets.msn.cn + MSN/Feed + Ad 角标识别。
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

  // 文章 / 信息流接口（assets.msn.com / 国区 assets.msn.cn；含 MSN/Feed 首页流）
  const isNewsFeed =
    /assets\.msn\.(com|cn)\/service\/news\/feed\//i.test(url) ||
    /assets\.msn\.(com|cn)\/service\/MSN\/Feed/i.test(url);

  // 文章详情页（pageId=sapphireviews = 国区 Bing 文章页）
  const isArticleDetail =
    /assets\.msn\.(com|cn)\/service\/news\/feed\/pages\/viewsfullpage/i.test(url);

  // 搜索结果页（bing.com / cn.bing.com 的 search / sapphire 接口）
  const isSearch = /bing\.com/i.test(url) && /(search|sapphire|api\/v1|results|query)/i.test(url);

  // Bing 奖励平台：必须走保守剥离，保留积分/任务/兑换
  const isRewards = /rewardsplatform\.microsoft\.com/i.test(url);

  // AppConfig（决定客户端是否创建文内 Ad 占位）
  const isAppConfig =
    /\/resolver\/api\/resolve\//i.test(url) ||
    /expType=AppConfig/i.test(url);

  let removed = 0;
  let mode = '';
  try {
    if (isHTML) {
      body = stripHtmlAds(body);
      mode = 'html';
    } else if (isRewards) {
      const r = stripRewardsAds(body);
      body = r.body;
      removed = r.removed;
      mode = 'rewards';
    } else if (isAppConfig) {
      const r = stripAppConfigAds(body);
      body = r.body;
      removed = r.removed;
      mode = 'config';
    } else {
      const r = stripJsonAds(body, isNewsFeed, isSearch);
      body = r.body;
      removed = r.removed;
      mode = 'json';
    }
  } catch (e) {
    console.log('[Bing去广告] 解析异常: ' + (e && e.message ? e.message : e));
  }

  if (isDebug) {
    console.log('[Bing去广告][DEBUG] url=' + url);
    console.log('[Bing去广告][DEBUG] content-type=' + ct);
    console.log('[Bing去广告][DEBUG] mode=' + mode);
    console.log('[Bing去广告][DEBUG] body(前2000)=' + String(body).slice(0, 2000));
  }

  // 自证明响应头
  const outHeaders = {};
  for (const k in respHeaders) outHeaders[k] = respHeaders[k];
  outHeaders['X-Loon-AdBlock'] = 'removed=' + (typeof removed !== 'undefined' ? removed : 0) +
    ';v=11' +
    (mode ? ';mode=' + mode : '') +
    (isNewsFeed ? ';feed=1' : '') +
    (isArticleDetail ? ';articleDetail=1' : '') +
    (isSearch ? ';search=1' : '') +
    (isRewards ? ';rewards=1' : '') +
    (isAppConfig ? ';config=1' : '') +
    (isHTML ? ';html=1' : '');

  try {
    const m = url.match(/^https?:\/\/([^\/]+)/i);
    const host = m ? m[1] : '?';
    console.log('[Bing去广告] v11 OK host=' + host + ' mode=' + mode + ' removed=' +
      (typeof removed !== 'undefined' ? removed : 0) +
      (isRewards ? ' [奖励保守]' : '') + ' url=' + url.slice(0, 100));
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
// Rewards：保守剥离（保证 Bing Rewards 可用）
// 只做两件事：
//   1) 清空 promotions 数组（品牌推广横幅）
//   2) 删除 name 匹配 *_Partner / limitedTimeOffer / AppInstall_*Partner 的条目
// 明确不碰：balance / counters / catalog / orders / profile / goal_item / activities
// ------------------------------------------------------------
function stripRewardsAds(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { body: text, removed: 0 };
  }

  let removed = 0;

  function isPartnerPromo(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const name = typeof o.name === 'string' ? o.name : '';
    // 真机抓包：Bing_Sapphire_AppInstall_*_Partner / *limitedTimeOffer*
    if (/_partner$|partner_|limitedtimeoffer|appinstall/i.test(name)) return true;
    // 带 brandId 的限时推广横幅对象（非兑换订单；订单在 orders[] 且通常无此类 name）
    if (o.limitedTimeOffer || o.limitedTimeOfferBanner || o.bannerImpressionOffer) return true;
    return false;
  }

  function clean(node) {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (isPartnerPromo(item)) {
          node.splice(i, 1);
          removed++;
        } else {
          clean(item);
        }
      }
    } else if (node && typeof node === 'object') {
      // 整组清空 promotions
      if (Array.isArray(node.promotions)) {
        removed += node.promotions.length;
        node.promotions = [];
      }
      for (const k in node) {
        // 绝不删除 balance / catalog / orders 等关键字段本身
        if (/^(balance|counters|catalog|orders|profile|goal_item|activities|globalCounters)$/i.test(k)) {
          // 仍递归清理其内部可能嵌套的 partner 推广，但不删除字段
          clean(node[k]);
          continue;
        }
        const v = node[k];
        if (v && typeof v === 'object') {
          if (!Array.isArray(v) && isPartnerPromo(v)) {
            delete node[k];
            removed++;
          } else {
            clean(v);
          }
        }
      }
    }
  }

  clean(data);
  console.log('[Bing去广告][奖励] 已移除推广条目数=' + removed + '（积分/兑换数据保留）');
  return { body: JSON.stringify(data), removed: removed };
}

// ------------------------------------------------------------
// AppConfig：清空广告位配置，阻止客户端创建 "Ad" 占位区域
// 2026-08-31 HAR：srtb 已被拦，但 config 仍下发：
//   slots.intraArticleNativeAd / interstitialNativeAds / nativeAdLoadingRules
// 客户端据此画出带 Ad 角标的空框。
// ------------------------------------------------------------
function stripAppConfigAds(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { body: text, removed: 0 };
  }

  let removed = 0;

  // 这些键对应广告位 / 原生广告加载规则，整组清空或置 null
  const CLEAR_ARRAY_KEYS = /^(interstitialNativeAds|nativeAdLoadingRules|riverVideoAdsProperties)$/i;
  const NULL_OBJECT_KEYS = /^(intraArticleNativeAd|bannerAd|nativeAd|nativeAdConfig|nativeAdWC|nativeAdConfigs|adServiceConfig|displayAds|displayAd)$/i;

  function isNativeAdRef(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const exp = String(
      obj.experienceType ||
      (obj.configRef && obj.configRef.experienceType) ||
      ''
    );
    return /ViewsNativeAd|NativeAdWC|NativeAd|BannerAd|DisplayAds/i.test(exp);
  }

  function clean(node) {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (isNativeAdRef(item)) {
          node.splice(i, 1);
          removed++;
          continue;
        }
        clean(item);
      }
    } else if (node && typeof node === 'object') {
      // configs 顶层：直接干掉 ViewsNativeAd / NativeAdWC / DisplayAdsWC 整棵配置树
      if (node.configs && typeof node.configs === 'object') {
        for (const ck in node.configs) {
          if (/ViewsNativeAd|NativeAdWC|DisplayAdsWC/i.test(ck)) {
            delete node.configs[ck];
            removed++;
          }
        }
      }

      for (const k in node) {
        if (CLEAR_ARRAY_KEYS.test(k) && Array.isArray(node[k])) {
          if (node[k].length) {
            removed += node[k].length;
            node[k] = [];
          }
          continue;
        }
        if (NULL_OBJECT_KEYS.test(k) && node[k] != null) {
          node[k] = null;
          removed++;
          continue;
        }
        // slots / childExperienceReferencesWC 内的广告位引用
        if ((k === 'slots' || k === 'childExperienceReferencesWC' || k === 'nativeAdConfigs') &&
            node[k] && typeof node[k] === 'object') {
          const bag = node[k];
          for (const sk in bag) {
            if (NULL_OBJECT_KEYS.test(sk) || /nativead|bannerad|displayad/i.test(sk)) {
              if (bag[sk] != null) {
                bag[sk] = null;
                removed++;
              }
            } else if (isNativeAdRef(bag[sk])) {
              bag[sk] = null;
              removed++;
            }
          }
        }
        if (isNativeAdRef(node[k])) {
          node[k] = null;
          removed++;
          continue;
        }
        clean(node[k]);
      }
    }
  }

  clean(data);
  console.log('[Bing去广告][Config] 已清空广告位数=' + removed);
  return { body: JSON.stringify(data), removed: removed };
}

// ------------------------------------------------------------
// HTML：移除 Bing 广告容器
// v7 关键改进：发现 "Ad" 角标时，沿标签栈往上找外层 card 容器整张删除，
// 避免 v6 那样只删了角标 <span> 自身、留下外层 b_card 的 bug。
// v10：除 class 角标外，正文仅为 Ad/广告/Sponsored 的小标签也按角标处理。
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
  // 正文仅为 Ad / 广告 / Sponsored / 赞助 的小标签（UI 可见角标）
  const badgeTextRe = /<(span|div|p|em|i|label|small|b|strong)\b[^>]*>\s*(?:Ad|AD|广告|推广|Sponsored|SPONSORED|赞助)\s*<\/\1>/gi;
  // 用一个统一的 open/close 正则同时识别开闭标签，遍历到 badge 位置时建立未闭合栈
  const tagRe = /<(\/?)(div|li|section|article)\b[^>]*>/gi;
  // card-like 容器识别（向栈上找最近的这一类整张删）
  const cardClassRe = /\b(b_card|b_algo|b_entity|b_results|b_algoheader|b_answer|card|tile|nativead)\b/i;

  // 找出所有角标位置（class 角标 + 文本角标）
  const badges = [];
  let bm;
  while ((bm = badgeClassRe.exec(out)) !== null) {
    badges.push(bm.index);
  }
  while ((bm = badgeTextRe.exec(out)) !== null) {
    badges.push(bm.index);
  }
  badges.sort(function (a, b) { return a - b; });
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
    //    优先级：class 含 b_card/b_algo/... > article/section > 兜底最内层
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
//   isNewsFeed=true 时，额外剔除文章/信息流里的 recoDoc 第三方推广卡
//   （webcontent=第三方一点资讯植入；跳转到非 MSN/Bing/Microsoft 域名的推荐卡）
//   注意：整个 region:"river"（"为你精选更多内容"）区块会在 clean() 之前整段删除。
// ------------------------------------------------------------
function stripJsonAds(text, isNewsFeed, isSearch) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return text;
  }

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

  // 删除整个 "river" 区块（对应 UI "为你精选更多内容"）
  // 该区块在 config 里的标题键是 riverHeading，响应里 section.region === "river"
  function removeSectionsByRegion(node, region) {
    let r = 0;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (item && typeof item === 'object' && !Array.isArray(item) &&
            String(item.region || '').toLowerCase() === region) {
          node.splice(i, 1);
          r++;
        } else {
          r += removeSectionsByRegion(item, region);
        }
      }
    } else if (node && typeof node === 'object') {
      for (const k in node) {
        r += removeSectionsByRegion(node[k], region);
      }
    }
    return r;
  }

  // 先整段删除广告相关 region，再递归清理剩余广告对象
  // river/riverdb = "为你精选更多内容"；inarticle/interstitialgallery/rectangle/sliver = 文内/插页广告位
  const AD_REGIONS = ['river', 'riverdb', 'inarticle', 'interstitialgallery', 'rectangle', 'sliver'];
  for (let i = 0; i < AD_REGIONS.length; i++) {
    removed += removeSectionsByRegion(data, AD_REGIONS[i]);
  }

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

    // 1.25) 可见角标字段：label / adLabel / badge 等值为 Ad / 广告 / Sponsored
    //       （UI 上显示 "Ad" 角标的卡片，即便缺少 type:nativead）
    const LABEL_KEYS = [
      'label', 'adLabel', 'adlabel', 'adLabelText', 'badge', 'adBadge',
      'sponsorLabel', 'sponsoredLabel', 'displayLabel', 'tag', 'tagText',
    ];
    for (let i = 0; i < LABEL_KEYS.length; i++) {
      const lv = o[LABEL_KEYS[i]];
      if (typeof lv === 'string' && /^(ad|广告|推广|sponsored|赞助)$/i.test(lv.trim())) {
        return true;
      }
    }

    // 1.5) 强广告键：只要字段「作为对象键」存在即判定为广告对象。
    //      注意：这些值通常是对象 / 曝光串，不能用值是否匹配 ad|promo|sponsor 判断，
    //      故以「键存在」为准。但仅当它们是真正的 JSON 键时生效——
    //      （例：wpoNativeAdServed 常出现在 URL 查询参数里，那不是键，本规则不会误伤。）
    //      - bannerImpressionOffer / ImpressionId：广告曝光标记
    //      - adRef / clickUrl / clickThroughUrl / landingUrl：广告点击 / 归因 / 落地
    //      - sponsoredBy / advertiser / advertiserId：赞助商 / 广告主
    const STRONG_AD_KEYS = [
      'bannerImpressionOffer',
      'ImpressionId', 'impressionId', 'adRef',
      'clickUrl', 'clickThroughUrl', 'landingUrl',
      'sponsoredBy', 'advertiser', 'advertiserId',
    ];
    for (let i = 0; i < STRONG_AD_KEYS.length; i++) {
      if (STRONG_AD_KEYS[i] in o) return true;
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

    // 2) 带 recoDocMetadata 且跳转到第三方域名
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
      // 递归；同时删除「本身就是广告对象」的子对象
      // （广告对象有时不挂在数组里，而是作为某个字段的值，原式只判数组元素会漏）
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object') {
          if (!Array.isArray(v) && isAdObject(v)) {
            delete node[k];
            removed++;
          } else {
            clean(v);
          }
        }
      }
    }
  }

  clean(data);
  console.log('[Bing去广告] 已移除广告条目数=' + removed);
  return { body: JSON.stringify(data), removed: removed };
}
