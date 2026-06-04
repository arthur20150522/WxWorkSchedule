---
name: wx-deploy
description: Use when the user says "部署", "/deploy", "上线", "发布", or after committing changes to WxSchedule. Automates git commit→push→remote pull→tsc compile→pm2 restart.
---

# WxSchedule 一键部署

触发词：**部署** / **/deploy** / **上线** / **发布**

## 远程服务器

Windows: `39.106.127.176`，SSH `Administrator`，项目路径 `C:\Users\Administrator\WxWorkSchedule`

## 部署步骤

1. 确认当前改动：`git diff --stat`
2. 如果没有未提交改动 → 跳到步骤 5（已 commit 过了）
3. 如果有未提交改动 → `git add` + `git commit -m "<描述>"` + `git push origin fork4win`
4. 如果有已 commit 未 push → `git push origin fork4win`
5. SSH 远程：`git pull origin fork4win`
6. 如果改动了 `server/src/*.ts` 或 `server/pybridge/*.py` → 远程执行 `npx tsc`
7. 根据改动重启 PM2：
   - `server/pybridge/` → `pm2 restart wx-bridge`
   - `server/src/` 或 `server/dist/` → `pm2 restart wx-schedule`
   - 两个都改了 → 先 restart wx-bridge，再 restart wx-schedule
8. 验证：检查 `pm2 list` 状态

## 快速参考

| 改了哪 | 要不要 tsc | 重启哪个 |
|--------|-----------|---------|
| `bridge.py` | ❌ | `wx-bridge` |
| `*.ts` | ✅ | `wx-schedule` |
| 两边都改了 | ✅ | 先 bridge 后 schedule |

## commit message 约定

格式：`<type>: <描述>`

type: `fix` / `feat` / `refactor` / `debug` / `chore`

用中文描述，简洁一句话。
