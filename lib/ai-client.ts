export function deepseekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  return { apiKey, baseUrl, model };
}

export function visionConfig() {
  const apiKey = process.env.VISION_API_KEY || "";
  const baseUrl = (process.env.VISION_BASE_URL || "https://api.siliconflow.cn/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.VISION_MODEL || "Qwen/Qwen2.5-VL-72B-Instruct";
  return { apiKey, baseUrl, model };
}

export function getRateLimitPerHour(): number {
  const raw = Number(process.env.RATE_LIMIT_PER_HOUR || "20");
  if (!Number.isFinite(raw) || raw <= 0) return 20;
  return Math.floor(raw);
}

export function isV1BaseUrl(baseUrl: string): boolean {
  return /\/v1$/.test(baseUrl);
}

export async function chatCompletions(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { baseUrl, apiKey, model, systemPrompt, userPrompt } = params;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 1600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM调用失败(${res.status})：${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM返回为空");
  return content;
}

export async function visionOcrImage(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageDataUrl: string;
  prompt?: string;
}): Promise<string> {
  const res = await fetch(`${params.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.1,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                params.prompt ||
                "请识别这张招聘JD截图中的全部文字，按原始排版输出，不要翻译，不要省略，不要添加解释。",
            },
            { type: "image_url", image_url: { url: params.imageDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`视觉模型调用失败(${res.status})：${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("视觉模型返回为空");
  return content;
}
