// ============================================================
// Bing 去广告脚本 (Loon http-response)  v11
// 运行环境：仅 Loon —— 通过 http-response 改写响应体，不使用域名 REJECT
// 适用：Microsoft Bing App（主）及经 Loon MITM 的 Bing / MSN 页面
//
// 两条过滤路径（均在 Loon 脚本内完成，无需浏览器油猴）：
//   A) JSON 响应（Bing App 信息流 / 文章页 / 搜索 API）
//      在 App 渲染前删除 nativead、morefromprovider、推广文章，修正广告布局模板
//   B) HTML 响应（搜索页、内嵌 WebView）
//      ① stripHtmlAds：从响应 HTML 中删除广告 DOM
//      ② injectHtmlAdGuard：在响应 <head> 写入 CSS + 脚本，兜底动态广告位
//
// 自证明：X-Loon-AdBlock: removed=N;v=10
// 调试：URL ?__debug=1 或请求头 X-Bing-Debug: 1
// v11 变更：
//   - 消除过滤后的空白广告位：JSON 剔除 ghost 空卡片、强制 river 区非广告模板
//   - HTML 删除空广告占位 DOM；注入脚本扫描并折叠无内容的大块空白卡片/灰色广告槽
// v10 变更：
//   - 插件移除全部 [Rule] 域名 REJECT，改为 Loon 纯 JS 过滤
//   - HTML 响应注入 CSS/JS 兜底（由 Loon 写入响应体，非浏览器扩展）
// v9 变更：
//   - 移除全部 morefromprovider 推广块（不限 provider，含虎扑等外链"更多内容"区）
//   - 剔除含 nativead 的 partnerappviews-*-card 模板，改为 backup-cards，
//     避免客户端按 six-card 布局继续渲染 3 个空广告位（精选内容列表漏删根因）
//   - 剔除 region=Rail 空壳区块；移除 isLocalContent=false 且 provider 为一点资讯的植入文章
// v8 变更：
//   - 移除 morefromprovider 第三方推广块（一点资讯等 provider 的"更多内容"植入区）
//   - 移除 subCards / 文章卡片中直连 yidianzixun.com / go2yd.com 的第三方推广链
//   - 递归清零 nextPageUrl 等 URL 字段里的 wpoNativeAdServed / wpoCmsAdServed，
//     避免客户端翻页后继续预留/拉取原生广告位
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

  const isHTML = /text\/html/i.test(ct);

  // MSN 页面（经 Loon MITM 的 HTML / JSON）
  const isMsnWeb = /msn\.(com|cn)/i.test(url);

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
      body = injectHtmlAdGuard(body);
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
    ';v=11' +
    (isNewsFeed ? ';feed=1' : '') +
    (isArticleDetail ? ';articleDetail=1' : '') +
    (isSearch ? ';search=1' : '') +
    (isMsnWeb ? ';msn=1' : '') +
    (isHTML ? ';html=1' : '');

  // v6: 每条命中响应都打一行 Loon 日志（含 host），便于确认脚本真在跑、哪个接口还有广告
  try {
    const m = url.match(/^https?:\/\/([^\/]+)/i);
    const host = m ? m[1] : '?';
    console.log('[Bing去广告] v11 OK host=' + host + ' removed=' +
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
    '$1 style="display:none!important;height:0!important;"'
  );

  // —— Pass 4：删除空的广告占位容器（v11：避免滤完后留空白块）——
  const emptyAdPatterns = [
    /<div[^>]*class="[^"]*\b(ad-slot|ad-container|ad-placeholder|native-ad|nativead|ad-slot-empty|wpo-native|promo-slot)\b[^"]*"[^>]*>\s*<\/div>/gi,
    /<div[^>]*\bdata-(ad|aad|native-ad|ad-slot)\b[^>]*>\s*<\/div>/gi,
    /<div[^>]*class="[^"]*\b(b_ad|adUnit|ads-container|ad-slide)\b[^"]*"[^>]*>\s*(?:&nbsp;|\s|-)*<\/div>/gi,
    /<iframe[^>]*\b(ad|ads|sponsor|doubleclick|msads)\b[^>]*>\s*<\/iframe>/gi,
    /<ins[^>]*class="[^"]*\badsbygoogle\b[^"]*"[^>]*>\s*<\/ins>/gi,
  ];
  emptyAdPatterns.forEach(function (p) {
    out = out.replace(p, '');
  });

  return out;
}

// ------------------------------------------------------------
// HTML 注入：Loon 改写响应体时在 <head> 写入 CSS + 脚本，兜底 WebView 动态广告
// ------------------------------------------------------------
function injectHtmlAdGuard(html) {
  if (typeof html !== 'string' || !html) return html;
  if (/data-loon-bing-adblock/i.test(html)) return html;

  var css =
    '.b_ad,.b_adlabel,.adLabel,.ad-label,.ad-label-text,.ad_badge,.adBadge,.ad-badge,' +
    '.adMarker,.ad-marker,.b_pag,.promo-card,.sponsored-card,.tile--ad,' +
    '.ad-slot,.adUnit,.ads-feed,.ads-container,.ad-slide,[data-aad],' +
    '[class*="ad-slot"],[class*="sponsored"],[class*="promo-card"],' +
    '[class*="native-ad"],[class*="nativead"],[class*="ad-placeholder"],' +
    '[data-ad-slot],[data-native-ad],[data-ad],[data-aad],' +
    '.loon-bing-empty-slot' +
    '{display:none!important;height:0!important;max-height:0!important;' +
    'min-height:0!important;overflow:hidden!important;margin:0!important;' +
    'padding:0!important;border:none!important;visibility:hidden!important;' +
    'pointer-events:none!important}';

  // 删除/折叠空白广告位：无图无链的大块空 card、文章内灰色广告槽
  var js =
    '(function(){' +
    'if(window.__bingAdBlocker)return;window.__bingAdBlocker=1;' +
    'var BADGE=/\\b(adLabel|ad-label|ad-label-text|ad_badge|adBadge|ad-badge|adMarker|ad-marker|b_adlabel|b_adLabel)\\b/i;' +
    'var CARD=/\\b(b_card|b_algo|b_entity|b_results|b_algoheader|b_answer)\\b/;' +
    'var ADCLASS=/\\b(ad|ads|native|slot|promo|sponsor|wpo|placeholder|river-card|feed-ad)\\b/i;' +
    'var SEL=[".b_ad",".b_adlabel",".adLabel",".ad-label",".ad-badge",".adBadge",' +
    '"[class*=\\"ad-slot\\"]","[class*=\\"sponsored\\"]","[class*=\\"promo-card\\"]",' +
    '"[class*=\\"native-ad\\"]","[class*=\\"nativead\\"]","[data-aad]","[data-ad-slot]"];' +
    'function rm(el){if(!el||!el.parentNode)return;el.classList.add("loon-bing-empty-slot");' +
    'el.style.cssText="display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important";' +
    'try{el.remove()}catch(e){}}' +
    'function txt(el){return((el.innerText||el.textContent||"")+"").replace(/[\\s\\-\\–\\—]/g,"");}' +
    'function hasContent(el){if(!el)return true;' +
    'if(el.querySelector("img[src],video,iframe[src],picture,source,a[href]"))return true;' +
    'return txt(el).length>10;}' +
    'function hideCardFromBadge(node){' +
    'var el=node;var card=null;for(var i=0;i<8&&el;i++){if(el.matches&&(el.matches("li,article,section,.b_card,.b_algo,.b_entity,.b_results")||CARD.test(el.className||"")))card=el;el=el.parentElement;}' +
    'rm(card||node);}' +
    'function isEmptySlot(el){' +
    'if(!el||!el.getBoundingClientRect)return false;' +
    'var r=el.getBoundingClientRect();if(r.height<28||r.width<60)return false;' +
    'if(hasContent(el))return false;' +
    'var cn=(el.className||"")+" "+(el.id||"")+" "+(el.getAttribute("data-type")||"");' +
    'if(ADCLASS.test(cn))return true;' +
    'if(r.height>=40&&txt(el).length<=2)return true;' +
    'try{var bg=window.getComputedStyle(el).backgroundColor||"";' +
    'if(r.height>=70&&txt(el).length<=5&&/rgb\\(|#/.test(bg)&&!/rgb\\(\\s*255/.test(bg))return true;}catch(e){}' +
    'return false;}' +
    'function sweepEmpty(){' +
    'try{document.querySelectorAll("div,li,article,section,aside,a").forEach(function(el){' +
    'if(isEmptySlot(el))rm(el);});}catch(e){}}' +
    'function sweep(){' +
    'SEL.forEach(function(s){try{document.querySelectorAll(s).forEach(function(el){' +
    'var p=el.closest(".b_card,.b_algo,.b_entity,.b_results,li,article,section")||el;rm(p);});}catch(e){}});' +
    'try{document.querySelectorAll("[class]").forEach(function(el){' +
    'if(BADGE.test(el.className))hideCardFromBadge(el);});}catch(e){}' +
    'sweepEmpty();' +
    '}' +
    'sweep();' +
    'new MutationObserver(sweep).observe(document.documentElement,{childList:true,subtree:true,attributes:true});' +
    '})();';

  var payload =
    '<style data-loon-bing-adblock="1">' + css + '</style>' +
    '<script data-loon-bing-adblock="1">' + js + '</script>';

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head[\s>]/i, function (m) { return m + payload; });
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html[\s>]/i, function (m) { return m + payload; });
  }
  return payload + html;
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

  // 已知第三方推广 provider（来自 2026-08-18 真机抓包）
  const THIRD_PARTY_PROVIDERS = /^(一点资讯|yidian|yidianzixun|go2yd|taboola|outbrain)$/i;
  const THIRD_PARTY_PROVIDER_IDS = /^(BB1nuSr4)$/i;
  const EXTERNAL_PROMO_HOST = /(^|\.)(yidianzixun|go2yd|doris\.yidianzixun|hupu)\.com$/i;
  const AD_LAYOUT_TEMPLATE = /partnerappviews-(?:six|four|two)-card|(?:six|four|two)-card-one-col/i;
  const SAFE_LAYOUT_TEMPLATE = 'backup-cards';

  function isGhostCard(o) {
    if (!o || typeof o !== 'object') return false;
    var t = (o.type || '').toLowerCase();
    if (t === 'nativead' || t === 'ad' || t === 'webcontent') return true;
    var keys = Object.keys(o);
    if (!o.title && !o.url && !o.id && !o.abstract) {
      if (keys.length <= 3) return true;
      if (keys.length <= 4 && o.isLocalContent === false) return true;
    }
    return false;
  }

  function pruneGhostCards(node) {
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (isGhostCard(node[i])) {
          node.splice(i, 1);
          removed++;
        } else {
          pruneGhostCards(node[i]);
        }
      }
    } else if (node && typeof node === 'object') {
      for (var k in node) {
        if (node[k] && typeof node[k] === 'object') pruneGhostCards(node[k]);
      }
    }
  }

  function sanitizeRiverLayouts(node) {
    if (!node || !Array.isArray(node.sections)) return;
    node.sections.forEach(function (sec) {
      if (!/^river$/i.test(sec.region || '')) return;
      (sec.subSections || []).forEach(function (sub) {
        var tpl = (sub.dataTemplate || '') + (sub.layoutTemplate || '');
        if (/partnerappviews|card-one-col|native/i.test(tpl)) {
          sub.dataTemplate = SAFE_LAYOUT_TEMPLATE;
          sub.layoutTemplate = SAFE_LAYOUT_TEMPLATE;
        }
      });
    });
  }

  function providerName(o) {
    if (!o || !o.provider) return '';
    if (typeof o.provider === 'string') return o.provider;
    if (typeof o.provider === 'object') return o.provider.name || o.provider.id || '';
    return '';
  }

  function providerId(o) {
    if (!o || !o.provider || typeof o.provider !== 'object') return '';
    return o.provider.id || '';
  }

  function firstExternalPromoHost(o) {
    const urls = [o.url, o.targetUrl, o.clickUrl, o.promotionalUrl];
    if (o.provider && typeof o.provider === 'object') {
      urls.push(o.provider.promotionalUrl, o.provider.url);
    }
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      if (typeof u !== 'string') continue;
      const m = u.match(/^https?:\/\/([^/]+)/i);
      if (m && EXTERNAL_PROMO_HOST.test(m[1].toLowerCase())) return m[1].toLowerCase();
    }
    return '';
  }

  function isThirdPartyProvider(o) {
    const name = providerName(o);
    const id = providerId(o);
    return (name && THIRD_PARTY_PROVIDERS.test(name)) ||
      (id && THIRD_PARTY_PROVIDER_IDS.test(id));
  }

  function isSyndicatedPromoArticle(o) {
    if (!o || typeof o !== 'object') return false;
    if ((o.type || '').toLowerCase() !== 'article') return false;
    if (o.isLocalContent !== false) return false;
    return isThirdPartyProvider(o);
  }

  function sanitizeAdTemplates(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = sanitizeAdTemplates(node[i]);
      return node;
    }
    for (const k in node) {
      const v = node[k];
      if ((k === 'dataTemplate' || k === 'layoutTemplate' || k === 'template') &&
          typeof v === 'string' && AD_LAYOUT_TEMPLATE.test(v)) {
        node[k] = SAFE_LAYOUT_TEMPLATE;
      } else if (v && typeof v === 'object') {
        node[k] = sanitizeAdTemplates(v);
      }
    }
    return node;
  }

  function pruneEmptyFeedSections(node) {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node.sections)) return;
    for (let i = node.sections.length - 1; i >= 0; i--) {
      const sec = node.sections[i];
      if (!sec || !Array.isArray(sec.subSections)) continue;
      for (let j = sec.subSections.length - 1; j >= 0; j--) {
        const sub = sec.subSections[j];
        const cards = sub && sub.cards;
        if (Array.isArray(cards) && cards.length === 0) {
          sec.subSections.splice(j, 1);
        }
      }
      const isEmpty = sec.subSections.length === 0;
      const isRail = /^rail$/i.test(sec.region || '');
      if (isEmpty || (isRail && sec.subSections.every(function (sub) {
        return !sub.cards || sub.cards.length === 0;
      }))) {
        node.sections.splice(i, 1);
      }
    }
  }

  function sanitizeAdUrls(node) {
    if (typeof node === 'string') {
      if (!/wpoNativeAdServed=|wpoCmsAdServed=|cardsServed=/i.test(node)) return node;
      return node
        .replace(/([?&])wpoNativeAdServed=\d+/gi, '$1wpoNativeAdServed=0')
        .replace(/([?&])wpoCmsAdServed=\d+/gi, '$1wpoCmsAdServed=0')
        .replace(/([?&])cardsServed=\d+/gi, '$1cardsServed=0');
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = sanitizeAdUrls(node[i]);
      return node;
    }
    if (node && typeof node === 'object') {
      for (const k in node) node[k] = sanitizeAdUrls(node[k]);
    }
    return node;
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

    // 1b) v9：全部 morefromprovider 推广块（虎扑/一点等外链"更多内容"）
    if (t === 'morefromprovider') return true;

    // 1c) v8 遗留：第三方 provider 的 morefromprovider（已由 1b 覆盖，保留注释）
    // if (t === 'morefromprovider' && isThirdPartyProvider(o)) return true;

    // 1d) v9：一点资讯等第三方 syndicated 植入文章（isLocalContent=false）
    if (isSyndicatedPromoArticle(o)) return true;

    // 1e) v8：卡片 URL 直连第三方推广域（如 doris.yidianzixun.com）
    if (firstExternalPromoHost(o)) return true;

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
  pruneGhostCards(data);
  sanitizeAdTemplates(data);
  sanitizeRiverLayouts(data);
  sanitizeAdUrls(data);
  pruneEmptyFeedSections(data);
  console.log('[Bing去广告] 已移除广告条目数=' + removed);
  return { body: JSON.stringify(data), removed: removed };
}
