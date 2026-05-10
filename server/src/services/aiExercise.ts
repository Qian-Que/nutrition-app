import { config } from "../config";

export type ExerciseIntensity = "LOW" | "MODERATE" | "HIGH";

export type AIUsage = {
  provider: string;
  model: string;
  route: string;
};

export type ExerciseAnalysis = {
  exerciseType: string;
  durationMin: number;
  intensity: ExerciseIntensity;
  met: number;
  calories: number;
  confidence: number;
  notes: string;
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

const chineseOutputRules = [
  "语言要求：所有可展示文本必须使用简体中文，包括 exerciseType 和 notes。",
  "运动名称必须使用常见中文叫法，例如 Running 写作“跑步”，Weight training 写作“力量训练”。",
  "不要输出英文运动名、英文解释或中英混排内容，除非是无法翻译的品牌或专有名称。",
];

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

export function estimateExerciseCalories(met: number, weightKg: number, durationMin: number) {
  return Math.round(clamp(met, 1, 20) * Math.max(weightKg, 30) * (Math.max(durationMin, 1) / 60));
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

function buildTextPrompt(description: string, weightKg: number) {
  return [
    "你是运动营养助手。请从用户描述中识别本次运动，并估算运动强度、MET 与消耗热量。",
    "只返回 JSON，不要返回解释文字。",
    ...chineseOutputRules,
    "JSON 字段：exerciseType, durationMin, intensity, met, calories, confidence, notes。",
    "intensity 只能是 LOW、MODERATE、HIGH。",
    "durationMin 必须是分钟；如果用户没有明确时长，请根据描述保守估计。",
    "如果截图或描述中已经给出消耗热量，请优先使用该热量；否则用 MET、体重和时长估算。",
    "MET 请用常见运动代谢当量估算：散步约 2.5-3.5，快走约 4-5，跑步约 7-12，骑行约 5-10，力量训练约 3.5-6，游泳约 6-10。",
    `用户当前体重：${weightKg}kg。`,
    `用户描述：${description}`,
  ].join("\n");
}

function buildImagePrompt(description: string | undefined, weightKg: number) {
  return [
    "你是运动记录截图识别助手。请从图片中读取运动 App 截图或运动记录截图的信息，例如 Keep、Strava、Apple 健身、Garmin、华为运动健康、小米运动、跑步机/骑行机记录等。",
    "优先从截图 OCR 中提取运动类型、运动时长、消耗热量、距离、配速、步数、心率等字段，再估算 MET 与强度。",
    "如果截图中已经有消耗热量/kcal/千卡，请直接采用截图数值作为 calories。",
    "如果只有距离和配速，请推算时长；如果只有时长和运动类型，请结合体重与 MET 估算热量。",
    "如果图片不是运动记录、没有可识别的运动数据，返回 isExercise=false，exerciseType='非运动记录'，confidence 低于 0.2。",
    "只返回 JSON，不要返回解释文字。",
    ...chineseOutputRules,
    "JSON 字段：isExercise, exerciseType, durationMin, intensity, met, calories, confidence, notes。",
    "intensity 只能是 LOW、MODERATE、HIGH。durationMin 必须是分钟。notes 用中文简要说明从截图提取到的关键数据，例如“截图显示跑步 35 分钟，消耗 286 千卡，距离 5.2 公里”。",
    `用户当前体重：${weightKg}kg。`,
    description?.trim() ? `用户补充描述：${description.trim()}` : "用户未补充文字描述，请主要依赖截图。",
  ].join("\n");
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const safeUrl = maskSensitiveUrl(url);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI API request failed (${response.status}): ${text}`);
    }
    return response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`AI request timeout (>${timeoutMs}ms): ${safeUrl}`);
    }
    throw new Error(`AI network request failed: ${safeUrl}; ${formatFetchFailure(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function maskSensitiveUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("key")) {
      parsed.searchParams.set("key", "***");
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/([?&]key=)[^&]+/i, "$1***");
  }
}

function formatFetchFailure(error: unknown) {
  const anyError = error as any;
  const message = anyError?.message ? String(anyError.message) : String(error);
  const cause = anyError?.cause;
  if (!cause) {
    return message;
  }
  const causeMessage = cause?.message ? String(cause.message) : "";
  const causeCode = cause?.code || cause?.errno || cause?.name;
  return [message, causeCode ? `cause=${causeCode}` : "", causeMessage].filter(Boolean).join("; ");
}

function extractText(response: any) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => item?.text ?? item?.content ?? "").join("\n");
  }
  return "";
}

function extractGeminiText(response: any) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n");
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

function normalizeAnalysis(raw: any, weightKg: number, fallbackDescription: string, options?: { rejectNonExercise?: boolean }): ExerciseAnalysis {
  const rawType = typeof raw?.exerciseType === "string" ? raw.exerciseType.trim() : "";
  const isExplicitNonExercise =
    raw?.isExercise === false || /^(not[_\s-]?exercise|none|非运动记录|不是运动|无运动)$/i.test(rawType);
  const confidence = clamp(toNumber(raw?.confidence, 0.65), 0, 1);
  if (options?.rejectNonExercise && (isExplicitNonExercise || confidence < 0.25)) {
    throw new Error("图片不是运动记录或运动信息不足");
  }

  const exerciseType = rawType && !isExplicitNonExercise ? rawType.slice(0, 60) : fallbackDescription.slice(0, 30) || "运动";
  const durationMin = clamp(toNumber(raw?.durationMin, 30), 1, 600);
  const intensity: ExerciseIntensity =
    raw?.intensity === "LOW" || raw?.intensity === "HIGH" || raw?.intensity === "MODERATE" ? raw.intensity : "MODERATE";
  const defaultMet = intensity === "HIGH" ? 8 : intensity === "LOW" ? 3 : 5;
  const met = clamp(toNumber(raw?.met, defaultMet), 1, 20);
  const calories = Math.round(clamp(toNumber(raw?.calories, 0), 0, 5000));
  return {
    exerciseType,
    durationMin: Math.round(durationMin),
    intensity,
    met: Number(met.toFixed(1)),
    calories: calories > 0 ? calories : estimateExerciseCalories(met, weightKg, durationMin),
    confidence,
    notes: typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim() : "按运动类型、体重和时长估算消耗。",
  };
}

function attachAIUsage(analysis: ExerciseAnalysis, client: AIClientConfig): ExerciseAnalysis {
  return {
    ...analysis,
    ai: {
      provider: client.provider,
      model: client.model,
      route: client.label,
    },
  };
}

function heuristicExercise(description: string, weightKg: number): ExerciseAnalysis {
  const text = description.toLowerCase();
  const durationMatch = description.match(/(\d+(?:\.\d+)?)\s*(分钟|min|mins|minute|minutes|小时|h|hour|hours)/i);
  let durationMin = 30;
  if (durationMatch) {
    const value = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    durationMin = unit.includes("小时") || unit === "h" || unit.includes("hour") ? value * 60 : value;
  }

  let exerciseType = "运动";
  let met = 5;
  let intensity: ExerciseIntensity = "MODERATE";
  if (/跑|run|jog/.test(text)) {
    exerciseType = "跑步";
    met = 8.5;
    intensity = "HIGH";
  } else if (/快走|walk|散步|走路/.test(text)) {
    exerciseType = /快走/.test(text) ? "快走" : "步行";
    met = /快走/.test(text) ? 4.3 : 3.2;
    intensity = /快走/.test(text) ? "MODERATE" : "LOW";
  } else if (/骑|bike|cycling|单车/.test(text)) {
    exerciseType = "骑行";
    met = 6.8;
  } else if (/游泳|swim/.test(text)) {
    exerciseType = "游泳";
    met = 7.5;
    intensity = "HIGH";
  } else if (/力量|撸铁|健身|深蹲|卧推|training|strength|gym/.test(text)) {
    exerciseType = "力量训练";
    met = 4.8;
  } else if (/瑜伽|yoga/.test(text)) {
    exerciseType = "瑜伽";
    met = 2.8;
    intensity = "LOW";
  }

  return {
    ...normalizeAnalysis({ exerciseType, durationMin, intensity, met, confidence: 0.4 }, weightKg, description),
    ai: {
      provider: "local",
      model: "本地运动估算",
      route: "本地",
    },
  };
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
          temperature: 0.15,
          maxOutputTokens: 700,
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
        temperature: 0.15,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是运动消耗估算助手。必须只返回 JSON。" },
          { role: "user", content: image ? content : prompt },
        ],
      }),
    },
    client.timeoutMs,
  );
  return extractText(payload);
}

async function analyzeWithClient(
  client: AIClientConfig,
  prompt: string,
  weightKg: number,
  fallbackDescription: string,
  image?: { base64: string; mimeType: string },
) {
  const text = client.provider === "gemini" ? await callGemini(client, prompt, image) : await callOpenAICompat(client, prompt, image);
  if (!text) {
    throw new Error("AI 未返回有效内容");
  }

  return attachAIUsage(
    normalizeAnalysis(JSON.parse(extractJsonText(text)), weightKg, fallbackDescription, { rejectNonExercise: Boolean(image) }),
    client,
  );
}

async function withBackupFallback(
  action: (client: AIClientConfig) => Promise<ExerciseAnalysis>,
  fallbackDescription: string,
  weightKg: number,
) {
  const primary = buildPrimaryClientConfig();
  const backup = buildBackupClientConfig();
  if (!primary && !backup) {
    return heuristicExercise(fallbackDescription, weightKg);
  }

  let primaryError: Error | null = null;
  if (primary) {
    try {
      const result = await action(primary);
      console.info(`[ai] ${primary.label} success provider=${primary.provider} model=${primary.model}`);
      return result;
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[ai] ${primary.label} failed provider=${primary.provider} model=${primary.model}: ${primaryError.message}`);
    }
  }

  if (backup) {
    try {
      const result = await action(backup);
      console.info(`[ai] ${backup.label} success provider=${backup.provider} model=${backup.model}`);
      return result;
    } catch (error) {
      const backupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[ai] ${backup.label} failed provider=${backup.provider} model=${backup.model}: ${backupError.message}`);
      throw new Error(
        primaryError
          ? `${primary?.label ?? "主线路"}失败：${primaryError.message}；${backup.label}失败：${backupError.message}`
          : backupError.message,
      );
    }
  }

  throw primaryError ?? new Error("未配置可用 AI 线路");
}

export async function analyzeExerciseText(description: string, weightKg: number) {
  return withBackupFallback(
    (client) => analyzeWithClient(client, buildTextPrompt(description, weightKg), weightKg, description),
    description,
    weightKg,
  );
}

export async function analyzeExerciseImage(base64Image: string, mimeType: string, description: string | undefined, weightKg: number) {
  const fallbackDescription = description?.trim() || "运动截图";
  return withBackupFallback(
    (client) =>
      analyzeWithClient(
        client,
        buildImagePrompt(description, weightKg),
        weightKg,
        fallbackDescription,
        { base64: base64Image, mimeType },
      ),
    fallbackDescription,
    weightKg,
  );
}
