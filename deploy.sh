#!/bin/bash
# deploy.sh —— 一键把 Bing 去广告插件发布到你的 GitHub 并输出 Loon 导入地址
# 前置：已在终端执行过 `gh auth login`（会调用浏览器，Edge 已登录则直接批准即可）
# 用法： bash deploy.sh
set -e

REPO="bing-ad-blocker-loon"
PLUGIN="Bing-AD-Blocker.plugin"
JS="bing_remove_ads.js"

# ---- 0. 环境与登录检查 ----
if ! command -v gh >/dev/null 2>&1; then
  echo "✗ 未找到 gh CLI。请先安装： brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "✗ gh 尚未登录。请在终端执行以下命令（会打开浏览器，Edge 已登录 GitHub 时直接点批准）："
  echo ""
  echo "    gh auth login"
  echo ""
  echo "  备选：去 GitHub → Settings → Developer settings → Personal access tokens 生成一个有 repo 权限的 token，"
  echo "  然后在本终端执行： export GH_TOKEN=ghp_xxxx  再运行  bash deploy.sh"
  exit 1
fi

# 让 git 走 gh 的凭据助手（避免 SSH key 缺失导致 push 失败）
gh auth setup-git >/dev/null 2>&1 || true

echo "[*] 读取当前登录的 GitHub 用户名 ..."
USER=$(gh api user --jq .login)
if [[ -z "$USER" ]]; then
  echo "✗ 获取用户名失败：请确认  gh auth status  正常"
  exit 1
fi
echo "    用户名 = $USER"

echo "[*] 用真实用户名替换插件里的占位符 ..."
sed -i.bak "s/YOUR_GITHUB_USER/$USER/g" "$PLUGIN"
rm -f "$PLUGIN.bak"

echo "[*] 创建公开仓库 $USER/$REPO ..."
gh repo create "$REPO" --public --description "Loon 插件：屏蔽 Bing App 首页信息流原生广告 / RTB 竞价广告 / 推广追踪（基于真机抓包校准）" --confirm 2>&1 | tail -3 || echo "（仓库可能已存在，继续）"

echo "[*] 初始化 git 并提交 ..."
git init -q
git add "$PLUGIN" "$JS" README.md
git commit -qm "init: Bing AD Blocker for Loon (real-device calibrated)"

echo "[*] 推送 main 分支 ..."
git branch -M main 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$USER/$REPO.git"
git push -u origin main 2>&1 | tail -5

echo ""
echo "==============================================================="
echo " 部署完成 ✅"
echo ""
echo " Loon 导入地址（配置 → 插件 → + → 通过 URL 添加）："
echo "   https://raw.githubusercontent.com/$USER/$REPO/main/$PLUGIN"
echo ""
echo " 去广告脚本地址（已自动写入插件 script-path）："
echo "   https://raw.githubusercontent.com/$USER/$REPO/main/$JS"
echo "==============================================================="
echo ""
echo " 后续启用步骤："
echo "   1) Loon → 配置 → 插件 → + → 粘贴上面的插件 URL → 添加 → 启用"
echo "   2) Loon → 工具 → MitM → 开启，主机名已含 assets.msn.com 等"
echo "   3) Loon → 工具 → 证书 → 安装并信任（到 设置→通用→VPN与设备管理 信任）"
echo "   4) 打开 Bing App，广告应已消失"
