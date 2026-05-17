import { config } from "../config";

export type EntryKind = "FOOD" | "EXERCISE" | "UNKNOWN";

export type AIUsage = {
  provider: string;
  model: string;
  route: string;
};

export type EntryClassification = {
  kind: EntryKind;
  confidence: number;
  reason: string;
  ai?: AIUsage;
};

type AIProvider = "openai_compat_chat" | "gemini";

type AIClientConfig = {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  label: string;
};

const exerciseHintPattern =
  /(运动|锻炼|跑步|慢跑|快走|散步|走路|骑行|单车|游泳|瑜伽|力量|健身|撸铁|深蹲|卧推|跳绳|爬楼|椭圆机|乒乓球|羽毛球|网球|篮球|足球|排球|壁球|拳击|搏击|划船|登山|徒步|爬山|滑雪|有氧|跳舞|舞蹈|普拉提|打球|训练|跑了|练了|打了|keep|strava|walk|run|jog|bike|cycling|swim|yoga|workout|gym|training|hiit|pilates|badminton|tennis|basketball|football|soccer|volleyball|table tennis|ping pong)/i;

const foodHintPattern =
  /(吃|喝|早餐|午餐|晚餐|加餐|饭|粥|面|米饭|肉|菜|蛋|奶|水果|饮料|零食|饼|包子|馒头|三明治|汉堡|沙拉|咖啡|奶茶|eat|ate|drink|meal|breakfast|lunch|dinner|snack|rice|noodle|food)/i;

function shouldUseGeminiNative(rawProvider: string, rawBaseUrl: string, model: string) {
  const provider = rawProvider.toLowerCase();
  return (
    provider === "gemini" ||
    provider === "gemini_native" ||
    provider === "google_gemini" ||
    ((provider === "openai_compat_auto" || provider === "") && /\/v1beta\/models\/?$/i.test(rawBaseUrl) && /^gemini-/i.test(model.trim()))
  );
}

function normalizeBaseUrl(url: string, provider: AIProvider): string {
  let normalized = String(url ?? "").trim().replace(/\/+$/, "");
  if (provider === "gemini") {
    normalized = normalized.replace(/\/v1beta\/openai$/i, "/v1beta/models");
    if (/\/v1beta$/i.test(normalized)) {
      normalized = `${normalized}/models`;
    }
  } else {
    normalized = normalized.replace(/\/v1beta\/models$/i, "/v1beta/openai");
    if (/\/v1beta$/i.test(normalized)) {
      normalized = `${normalized}/openai`;
    }
  }
  return normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildPrimaryClientConfig(): AIClientConfig | null {
  const apiKey = String(config.aiApiKey ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const provider: AIProvider = shouldUseGeminiNative(String(config.aiProvider ?? ""), config.aiBaseUrl, config.aiModel)
    ? "gemini"
    : "openai_compat_chat";

  return {
    provider,
    baseUrl: normalizeBaseUrl(config.aiBaseUrl, provider),
    apiKey,
    model: config.aiModel,
    timeoutMs: config.aiTimeoutMs,
    label: "主线路",
  };
}

function buildBackupClientConfig(): AIClientConfig | null {
  const backupKey = String(config.aiBackupApiKey ?? "").trim();
  const backupBaseUrl = String(config.aiBackupBaseUrl ?? "").trim();
  const backupModel = String(config.aiBackupModel ?? "").trim();
  const backupTouched = Boolean(backupKey || backupBaseUrl || backupModel);
  if (!backupTouched) {
    return null;
  }

  const apiKey = backupKey || String(config.aiApiKey ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const backupRawBaseUrl = backupBaseUrl || config.aiBaseUrl;
  const backupEffectiveModel = backupModel || config.aiModel;
  const provider: AIProvider = shouldUseGeminiNative(
    String(config.aiBackupProvider || config.aiProvider || ""),
    backupRawBaseUrl,
    backupEffectiveModel,
  )
    ? "gemini"
    : "openai_compat_chat";

  return {
    provider,
    baseUrl: normalizeBaseUrl(backupRawBaseUrl, provider),
    apiKey,
    model: backupEffectiveModel,
    timeoutMs: config.aiBackupTimeoutMs > 0 ? config.aiBackupTimeoutMs : config.aiTimeoutMs,
    label: "备用线路",
  };
}

function buildPrompt(description?: string) {
  return [
    "你是饮食与运动记录分类器。请只根据本次用户输入的文字和图片判断类别，不要结合历史记录。",
    "只返回 JSON，不要返回解释文字。",
    "JSON 字段：kind, confidence, reason。",
    "kind 只能是 FOOD、EXERCISE、UNKNOWN。",
    "FOOD：食物、饮料、餐食、食材、包装食品、菜单或与进食有关的描述。",
    "EXERCISE：运动、锻炼、体力活动、训练、球类项目、健身 App 截图或运动记录截图。",
    "如果图片是 Keep、Strava、Apple 健身、华为运动健康等运动记录截图，必须优先判为 EXERCISE。",
    "如果图片是餐盘、食物、饮料、食品包装，必须优先判为 FOOD。",
    "如果文字同时提到食物和运动，选择用户当前最想记录的主要行为；仍无法判断时返回 UNKNOWN。",
    "reason 必须使用简体中文，简短说明判断依据。",
    description?.trim() ? `用户文字：${description.trim()}` : "用户没有补充文字，请主要依据图片判断。",
  ].join("\n");
}

function heuristicClassify(description: string | undefined, hasImage: boolean): EntryClassification {
  const text = description?.trim() ?? "";
  const exercise = exerciseHintPattern.test(text);
  const food = foodHintPattern.test(text);

  if (exercise && !food) {
    return { kind: "EXERCISE", confidence: 0.62, reason: "文字包含明确运动信息。" };
  }
  if (food && !exercise) {
    return { kind: "FOOD", confidence: 0.62, reason: "文字包含明确饮食信息。" };
  }
  if (exercise && food) {
    return { kind: "UNKNOWN", confidence: 0.35, reason: "文字同时包含饮食和运动信息。" };
  }
  return {
    kind: "UNKNOWN",
    confidence: hasImage ? 0.2 : 0.1,
    reason: hasImage ? "仅凭当前信息无法可靠区分图片类型。" : "当前文字信息不足。",
  };
}

function buildGeminiGenerateContentUrl(baseUrl: string, model: string, apiKey: string) {
  const normalizedModel = model.trim().replace(/^models\//i, "");
  const endpoint = /\/models$/i.test(baseUrl)
    ? `${baseUrl}/${normalizedModel}:generateContent`
    : `${baseUrl}/models/${normalizedModel}:generateContent`;
  return `${endpoint}?key=${encodeURIComponent(apiKey)}`;
}

function extractJsonText(raw: string) {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }
  return text;
}

function extractGeminiText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n");
}

function extractOpenAIText(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function normalizeClassification(raw: any): EntryClassification {
  const rawKind = typeof raw?.kind === "string" ? raw.kind.trim().toUpperCase() : "";
  const kind: EntryKind = rawKind === "FOOD" || rawKind === "EXERCISE" || rawKind === "UNKNOWN" ? rawKind : "UNKNOWN";
  return {
    kind,
    confidence: clamp(toNumber(raw?.confidence, 0.5), 0, 1),
    reason: typeof raw?.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "AI 未提供分类说明。",
  };
}

function attachAIUsage(classification: EntryClassification, client: AIClientConfig): EntryClassification {
  return {
    ...classification,
    ai: {
      provider: client.provider,
      model: client.model,
      route: client.label,
    },
  };
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI API request failed (${response.status}): ${text}`);
    }
    return response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`AI request timeout (>${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(client: AIClientConfig, prompt: string, image?: { base64: string; mimeType: string }) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (image?.base64) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType || "image/jpeg",
        data: image.base64,
      },
    });
  }

  const payload = await fetchJsonWithTimeout(
    buildGeminiGenerateContentUrl(client.baseUrl, client.model, client.apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.05,
          maxOutputTokens: 220,
          responseMimeType: "application/json",
        },
      }),
    },
    client.timeoutMs,
  );
  return extractGeminiText(payload);
}

async function callOpenAICompat(client: AIClientConfig, prompt: string, image?: { base64: string; mimeType: string }) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  if (image?.base64) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType || "image/jpeg"};base64,${image.base64}`,
        detail: "auto",
      },
    });
  }

  const payload = await fetchJsonWithTimeout(
    `${client.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: client.model,
        temperature: 0.05,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是记录类型分类器。必须只返回 JSON。" },
          { role: "user", content: image ? content : prompt },
        ],
      }),
    },
    client.timeoutMs,
  );
  return extractOpenAIText(payload);
}

async function analyzeWithClient(
  client: AIClientConfig,
  description: string | undefined,
  image?: { base64: string; mimeType: string },
) {
  const prompt = buildPrompt(description);
  const text = client.provider === "gemini" ? await callGemini(client, prompt, image) : await callOpenAICompat(client, prompt, image);
  if (!text) {
    throw new Error("AI 未返回有效内容");
  }
  return attachAIUsage(normalizeClassification(JSON.parse(extractJsonText(text))), client);
}

export async function classifyEntry(params: {
  description?: string;
  imageBase64?: string;
  mimeType?: string;
}): Promise<EntryClassification> {
  const description = params.description?.trim();
  const image = params.imageBase64
    ? { base64: params.imageBase64.trim(), mimeType: params.mimeType || "image/jpeg" }
    : undefined;
  const primary = buildPrimaryClientConfig();
  const backup = buildBackupClientConfig();

  if (!primary && !backup) {
    return heuristicClassify(description, Boolean(image));
  }

  let primaryError: Error | null = null;
  if (primary) {
    try {
      const result = await analyzeWithClient(primary, description, image);
      console.info(`[ai] classifier ${primary.label} success provider=${primary.provider} model=${primary.model} kind=${result.kind}`);
      return result;
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[ai] classifier ${primary.label} failed provider=${primary.provider} model=${primary.model}: ${primaryError.message}`,
      );
    }
  }

  if (backup) {
    try {
      const result = await analyzeWithClient(backup, description, image);
      console.info(`[ai] classifier ${backup.label} success provider=${backup.provider} model=${backup.model} kind=${result.kind}`);
      return result;
    } catch (error) {
      const backupError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[ai] classifier ${backup.label} failed provider=${backup.provider} model=${backup.model}: ${backupError.message}`,
      );
      throw new Error(
        `分类主线路失败：${primaryError?.message ?? "未配置"}；分类备用线路失败：${backupError.message}`,
      );
    }
  }

  throw primaryError ?? new Error("AI 分类不可用");
}
