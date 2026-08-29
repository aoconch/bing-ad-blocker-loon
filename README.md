# Bing AD Blocker for Loon

屏蔽 **Microsoft Bing App** 中的广告与推广内容。基于 **2026-08-18 iPhone 16 Pro 真机抓包** 校准，去广告规则对准真实流量，而非猜测。

**v8 起改为「纯 JS、零 Rule」**：不再依赖 Loon 的 `[Rule]` 域名拦截，所有去广告逻辑都在两个 JS 脚本里完成。

## 原理（两个脚本各司其职）

| 阶段 | 脚本 | 干的事 | 替代了什么 |
|------|------|--------|-----------|
| 请求前 | `bing_block_request.js` (http-request) | 按域名后缀拦截广告 / RTB 竞价 / 推广 / 追踪请求，返回空响应 | 原 `[Rule]` 全部 `DOMAIN-SUFFIX,REJECT` |
| 响应后 | `bing_remove_ads.js` (http-response) | 递归剔除混在合法响应里的内联广告（首页信息流 `nativead` 卡、搜索结果推广、文章植入） | 原脚本的 `[Script]` 内联剥离 |

为什么还要脚本剥离内联广告：像首页信息流、搜索结果页的广告是 **Bing 自己的接口返回的数据**（嵌在 `assets.msn.com` / `bing.com` 的 JSON 或 HTML 里），光拦截域名拦不到——必须解析响应、把广告对象/容器删掉。而独立的广告网络请求（RTB、doubleclick、追踪 SDK）则由请求脚本直接掐断。

## 文件

- `Bing-AD-Blocker.plugin` — Loon 插件（`[Mitm]` + `[Script]`，**无 `[Rule]`**）
- `bing_block_request.js` — 请求拦截脚本：域名后缀表 + 返回空响应
- `bing_remove_ads.js` — 响应剥离脚本：递归移除 `nativead` 原生广告卡与广告字段

## 安装（Loon 一键导入）

**推荐：commit 固定地址（不走 CDN 缓存，永远拿到确切版本）**

```
https://cdn.jsdelivr.net/gh/aoconch/bing-ad-blocker-loon@87d7b85/Bing-AD-Blocker.plugin
```

把 `<COMMIT>` 换成最新 commit 短哈希（见仓库 Commits 页）即可。

Loon 操作：配置 → 插件 → `+` → 通过 URL 添加 → 粘贴上面地址 → 启用。
若之前装过旧版，先左滑删除旧插件再添加（Loon 插件缓存按 URL 区分，新 URL = 重新拉取）。

之后每次插件更新，把 URL 中的 `@87d7b85` 换成最新 commit 短哈希即可强制刷新。

备用地址（raw.githubusercontent，需要代理可直连 GitHub）：
`https://raw.githubusercontent.com/aoconch/bing-ad-blocker-loon/main/Bing-AD-Blocker.plugin`

> ⚠️ 不要用 `@main` 的 jsDelivr 地址：jsDelivr 对 `@main` 有约 45 分钟的更新节流，且 purge 也会被限流，会出现"仓库已更新但手机还跑旧脚本"的假象。

安装后：Loon → 工具 → MitM 开启（主机名已含 `assets.msn.com` 及各大广告/追踪域）→ 安装并信任证书 → 打开 Bing App。

## 手动部署到自己的仓库

1. 把本仓库推到 GitHub（任意公开仓库）。
2. 编辑 `Bing-AD-Blocker.plugin`，把两处 `script("https://raw.githubusercontent.com/aoconch/bing-ad-blocker-loon/main/...")` 换成你自己的脚本地址（建议同样用 raw.githubusercontent）。
3. Loon 通过 URL 添加：`https://cdn.jsdelivr.net/gh/<你>/<仓库>@87d7b85/Bing-AD-Blocker.plugin`
4. 同上开启 MitM 并信任证书。

> 想保留 Bing 奖励、不拦截 `prod.rewardsplatform.microsoft.com`？编辑 `bing_block_request.js`，把那一行从 `BLOCK_SUFFIXES` 里删掉/注释即可——广告仍会被 `bing_remove_ads.js` 的内联剥离处理。

## 怎么确认插件真的生效了

- **请求拦截**：被拦的广告/追踪请求，抓包会看到来自 Loon 的 `200` 空响应，且带响应头 `X-Loon-AdBlock-Req: blocked=1`；Loon 日志出现 `[Bing去广告-请求] block=<host>`。
- **内联剥离**：脚本会给每条被处理的响应打上响应头 **`X-Loon-AdBlock: removed=N`**（N=本响应移除的广告条目数）。
  - 下次抓包 / 看 Loon 日志，只要出现这个头，就说明插件脚本确实跑起来了；
  - `removed=0` 表示这条响应本就没有广告。
  - 如果**完全看不到** `X-Loon-AdBlock` 头，说明插件没加载（检查导入 URL 是否正确、是否被墙、是否启用）。

## 调试

在 Bing App 请求 URL 后加 `?__debug=1`（或 `?__adblock=1`），Loon 日志会打印拦截/剥离细节，便于发现新的广告字段。

## 故障排查

### 症状：插件显示"已加载"但仍然有广告

99% 是 **Loon 缓存了旧 plugin** 或 **CDN 缓存了旧脚本**。表现：`X-Loon-AdBlock` 头里是 `v=4`/`v=5`/`v=6`/`v=7` 而不是 `v=8`。

#### A. 强制刷新插件（推荐）

Loon 的插件缓存与 URL 一一对应。换一个新的 URL（新的 commit 哈希）即可让 Loon 当作新插件重拉——最简单的办法就是用 commit 固定地址（见上文"安装"），每次更新换哈希。

#### B. 自查 v8 标志

新版响应头应包含 `X-Loon-AdBlock: ...;v=8`；
新版 Loon 日志应包含 `[Bing去广告] v8 OK url=... removed=N` 与 `[Bing去广告-请求] block=<host>`。

如果响应头是 `v=4`/`v=5`/`v=6`/`v=7` 或无版本号 → 插件是旧版，重新做 A。

#### C. 确认脚本在跑但版本不对

Loon 日志出现 `Finished execute http-response script:Bing去广告` / `http-request script:Bing去广告` 说明脚本在执行；此时若还有广告，看日志里打印的版本号即可判断是缓存问题还是规则漏判。
