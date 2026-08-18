# Bing AD Blocker for Loon

屏蔽 **Microsoft Bing App** 中的广告与推广内容。基于 **2026-08-18 iPhone 16 Pro 真机抓包** 校准，去广告规则对准真实流量，而非猜测。

## 真机定位到的广告来源

| 广告来源 | 真实域名 / 接口 | 处理方式 |
|---------|----------------|---------|
| 首页信息流原生广告卡 | `assets.msn.com` `/service/news/feed/pages/*` 的 `{"type":"nativead",...}` | MITM 脚本剔除 |
| RTB 实时竞价 | `srtb.msn.com` / `srtb.msn.cn` `/auction` | `[Rule]` REJECT |
| 奖励/促销推广卡 | `prod.rewardsplatform.microsoft.com/dapi/me` | `[Rule]` REJECT（可注释保留奖励）|
| 追踪/归因 | adjust、`self.events.data.microsoft.com`、`gateway.bingviz.microsoftapp.net`、Firebase | `[Rule]` REJECT |

## 文件

- `Bing-AD-Blocker.plugin` — Loon 插件（含 `[Rule]`/`[Mitm]`/`[Script]`）
- `bing_remove_ads.js` — MITM 响应脚本：递归移除 `nativead` 原生广告卡与广告字段

## 安装（Loon 一键导入）

**推荐：commit 固定地址（不走 CDN 缓存，永远拿到确切版本）**

```
https://cdn.jsdelivr.net/gh/aoconch/bing-ad-blocker-loon@1a8b658/Bing-AD-Blocker.plugin
```

Loon 操作：配置 → 插件 → `+` → 通过 URL 添加 → 粘贴上面地址 → 启用。
若之前装过旧版，先左滑删除旧插件再添加（Loon 插件缓存按 URL 区分，新 URL = 重新拉取）。

之后每次插件更新，把 URL 中的 `@1a8b658` 换成最新 commit 短哈希即可强制刷新。

备用地址（raw.githubusercontent，需要代理可直连 GitHub）：
`https://raw.githubusercontent.com/aoconch/bing-ad-blocker-loon/main/Bing-AD-Blocker.plugin`

> ⚠️ 不要用 `@main` 的 jsDelivr 地址：jsDelivr 对 `@main` 有约 45 分钟的更新节流，且 purge 也会被限流，会出现"仓库已更新但手机还跑旧脚本"的假象。

安装后：Loon → 工具 → MitM 开启（主机名已含 `assets.msn.com` 等）→ 安装并信任证书 → 打开 Bing App。

## 手动部署到自己的仓库

1. 把本仓库推到 GitHub（任意公开仓库）。
2. 编辑 `Bing-AD-Blocker.plugin`，把 `script-path` 换成你自己的脚本地址（建议同样用 raw.githubusercontent）。
3. Loon 通过 URL 添加：`https://cdn.jsdelivr.net/gh/<你>/<仓库>@<COMMIT_SHA>/Bing-AD-Blocker.plugin`
4. 同上开启 MitM 并信任证书。

> 若只想要域名拦截、不想托管脚本：删掉 `.plugin` 里的 `[Script]` 整段即可，`[Rule]` 已能拦掉竞价广告与追踪。

## 怎么确认插件真的生效了

脚本会给每条被处理的响应打上响应头 **`X-Loon-AdBlock: removed=N`**（N=本响应移除的广告条目数）。
- 下次抓包 / 看 Loon 日志，只要出现这个头，就说明插件脚本确实跑起来了；
- `removed=0` 表示这条响应本就没有广告。
- 如果**完全看不到** `X-Loon-AdBlock` 头，说明插件没加载（检查导入 URL 是否正确、是否被墙、是否启用）。

## 调试

在 Bing App 请求 URL 后加 `?__debug=1`，Loon 日志会打印响应结构，便于发现新的广告字段。

## 故障排查

### 症状：插件显示"已加载"但仍然有广告

99% 是 **Loon 缓存了旧 plugin** 或 **CDN 缓存了旧脚本**。表现：`X-Loon-AdBlock` 头里是 `v=4`/`v=5` 而不是 `v=6`。

#### A. 强制刷新插件（推荐）

Loon 的插件缓存与 URL 一一对应。换一个新的 URL 即可让 Loon 当作新插件重拉——最简单的办法就是用 commit 固定地址（见上文"安装"），每次更新换哈希。

#### B. 自查 v6 标志

新版响应头应包含 `X-Loon-AdBlock: ...;v=6`；
新版 Loon 日志应包含 `[Bing去广告] v6 OK url=... removed=N`。

如果响应头是 `v=4`/`v=5` 或无版本号 → 插件是旧版，重新做 A。

#### C. 确认脚本在跑但版本不对

Loon 日志出现 `Finished execute http-response script:Bing去广告` 说明脚本在执行；此时若还有广告，看日志里打印的版本号即可判断是缓存问题还是规则漏判。
