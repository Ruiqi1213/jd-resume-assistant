# JD × 简历 · 打招呼助手

批量 JD × 一份简历，一键生成 Boss 直聘风格打招呼语。

## 本地运行

```bash
cp .env.example .env.local
# 填 DEEPSEEK_API_KEY（必填）与 VISION_API_KEY（截图 OCR 用）
npm install
npm run dev
# http://localhost:3000
```

## 部署到 Vercel（公开给朋友用）

### 1. 准备工作（各 2 分钟）

1. **推到 GitHub**：Vercel 从 GitHub 仓库导入。不要提交 `.env.local`（已在 `.gitignore`）。
2. **Upstash Redis（必需，否则限流在 serverless 上失效）**：
   - 打开 <https://console.upstash.com> → Create Database → 选离用户近的 region → 复制 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。
   - 没配的话代码会自动降级为内存限流，但 Vercel 多实例之间不共享，刷子换个实例就能绕过。

### 2. 在 Vercel 设置环境变量（Settings → Environment Variables）

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 后台的 key（必填） |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `VISION_API_KEY` | 硅基流动的 key（截图 OCR 用） |
| `VISION_BASE_URL` | 默认 `https://api.siliconflow.cn/v1` |
| `VISION_MODEL` | 默认 `Qwen/Qwen3-VL-32B-Instruct` |
| `ACCESS_CODE` | **公网部署务必设置**，随机长字符串（`openssl rand -hex 16`），访客凭此口令进入 |
| `RATE_LIMIT_PER_HOUR` | 每个口令每小时调用上限，默认 20 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash 免费 Redis，用于跨实例限流 |

### 3. 防刷机制说明

- 未输入正确 `ACCESS_CODE` 时，所有 `/api/*` 返回 401，页面只显示口令输入框。
- 限流按**口令**分桶：同一个口令的所有访问者共享 `RATE_LIMIT_PER_HOUR` 配额。一个口令被刷爆不影响其他口令。
- 建议：给不同朋友发不同口令？当前版本是单口令，如需多口令轮换，改 `ACCESS_CODE` 重新部署即可，旧口令即刻失效。

### 4. 费用估算

- 一次「结构化解析 + 单条生成」约消耗 DeepSeek chat 2～4k tokens，约 ¥0.005～0.02。
- `RATE_LIMIT_PER_HOUR=20` 时，单口令一小时最多烧约 ¥0.4。余额告警请在 DeepSeek 后台设置。
