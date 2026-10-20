# JD × 简历 · 校招匹配与打招呼助手

面向 2027 届校招的岗位比较工具。支持上传多份简历、批量添加 JD、岗位匹配排序，并生成 Boss 直聘风格打招呼语。

## 主要能力

- PDF / DOCX / TXT 简历解析，JD 文档与截图 OCR，最多批量处理 12 条 JD。
- 结构化提取公司、岗位、职责、要求和关键词。
- 使用同一套标准比较 AI 产品经理、B 端产品经理及相关产品岗位。
- 逐项展示岗位要求、简历原文证据、硬性缺口、待核实项和可通过简历优化突出的能力。
- 按硬性条件 / 核心能力 / 加分项三类权重计算“岗位要求覆盖分”，默认权重为 50 / 35 / 15，可在页面调整并即时重新排序。
- 保留批量生成打招呼语、匹配点和沟通建议的原有流程。

## 匹配分如何计算

模型只把 JD 要求归为 `hard`、`core`、`bonus`，并根据带编号的简历原文证据判断 `met`、`partial`、`unmet`、`unknown`。服务端会验证证据编号是否真实存在，再按固定值计算：

| 状态 | 计分值 |
|---|---:|
| 已满足 `met` | 1.00 |
| 部分满足 `partial` | 0.60 |
| 待核实 `unknown` | 0.25 |
| 未满足 `unmet` | 0 |

每一类先计算平均覆盖率，再按页面设置的权重汇总。投递优先级同时检查硬性条件：存在明确硬性缺口时会标为低优先，硬性条件无证据时会标为“核实后投递”。排序依次按投递优先级、覆盖分和原始 JD 顺序执行，保证相同分析结果稳定排序。

该分数只表示当前简历对 JD 要求的证据覆盖程度，不是录用概率。

## 本地运行

```bash
cp .env.example .env.local
# 填 DEEPSEEK_API_KEY（必填）与 VISION_API_KEY（截图 OCR 用）
npm install
npm run dev
# http://localhost:3000
```

## 验证

```bash
npm test
npm run build
```

测试覆盖确定性计分、可调权重、硬性条件优先级、稳定排序、证据引用校验，以及原有文件类型识别、JD 输入兼容和访问口令回归。

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
