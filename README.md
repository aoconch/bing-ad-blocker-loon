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
3. Loon → 配置 → 插件 → `+` → 通过 URL 添加：
   `https://raw.githubusercontent.com/<你>/<仓库>/main/Bing-AD-Blocker.plugin`
4. Loon → 工具 → MitM 开启（主机名已含 `assets.msn.com` 等）→ 安装并信任证书。
5. 打开 Bing App，广告应已消失。

> 若只想要域名拦截、不想托管脚本：删掉 `.plugin` 里的 `[Script]` 整段即可，`[Rule]` 已能拦掉竞价广告与追踪。

## 调试

在 Bing App 请求 URL 后加 `?__debug=1`，Loon 日志会打印响应结构，便于发现新的广告字段。
