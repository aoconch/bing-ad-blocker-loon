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

## 部署（一键）

```bash
gh auth login          # 首次：浏览器授权
bash deploy.sh          # 自动建仓库、推送、输出 Loon 导入地址
```

## 手动部署

1. 把本仓库推到 GitHub（任意公开仓库）。
2. 编辑 `Bing-AD-Blocker.plugin`，把两处 `YOUR_GITHUB_USER` 换成你的用户名。
3. Loon → 配置 → 插件 → `+` → 通过 URL 添加（**建议用 jsDelivr，国内更稳**）：
   `https://cdn.jsdelivr.net/gh/<你>/<仓库>@main/Bing-AD-Blocker.plugin`
   备用 raw 地址：`https://raw.githubusercontent.com/<你>/<仓库>/main/Bing-AD-Blocker.plugin`
4. Loon → 工具 → MitM 开启（主机名已含 `assets.msn.com` 等）→ 安装并信任证书。
5. 打开 Bing App，广告应已消失。

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
X-Loon-AdBlock 响应头 = 0 出现。99% 是 **Loon 缓存了旧 plugin** 或 **jsDelivr 缓存了旧脚本**。

#### A. 强制刷新插件（推荐）

Loon 的插件缓存与 URL 一一对应。换一个新的 URL 即可让 Loon 当作新插件重拉：

```
https://cdn.jsdelivr.net/gh/aoconch/bing-ad-blocker-loon@<COMMIT_SHA>/Bing-AD-Blocker.plugin
```

把 `<COMMIT_SHA>` 换成最新 7 位 commit 哈希（永远会得到带最新 `?v=N` cache-bust 的 plugin）。

Loon 操作：左滑旧 plugin → 删除 → `+` → 通过 URL 添加 → 粘贴上面 URL → 启用。

#### B. 自查 v5 标志

新版响应头应包含 `X-Loon-AdBlock: ...;v=5`；
新版 Loon 日志应包含 `[Bing去广告] v5 OK url=... removed=N`。

如果响应头是 `v=4` 或无 → 插件是旧版，重新做 A。
