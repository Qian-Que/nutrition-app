import { config } from "../config";

export type NutritionItem = {
  name: string;
  estimatedWeightGram?: number;
  calories: number;
  proteinGram: number;
  carbsGram: number;
  fatGram: number;
  fiberGram?: number;
};

export type NutritionAnalysis = {
  items: NutritionItem[];
  totals: {
    calories: number;
    proteinGram: number;
    carbsGram: number;
    fatGram: number;
    fiberGram: number;
    sugarGram: number;
    addedSugarGram: number;
    sugarAlcoholGram: number;
    sodiumMg: number;
    potassiumMg: number;
    calciumMg: number;
    ironMg: number;
    cholesterolMg: number;
    saturatedFatGram: number;
    transFatGram: number;
    monounsaturatedFatGram: number;
    polyunsaturatedFatGram: number;
    vitaminAIU: number;
    vitaminCMg: number;
    vitaminDIU: number;
  };
  confidence: number;
  notes: string;
  ai?: AIUsage;
};

type NutritionTotals = NutritionAnalysis["totals"];

type AIProvider = "openai" | "openai_compat_auto" | "openai_compat_responses" | "openai_compat_chat" | "gemini";

export type AIUsage = {
  provider: string;
  model: string;
  route: string;
};

type AIClientConfig = {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageDetail: "low" | "high" | "auto";
  timeoutMs: number;
  label: string;
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "totals", "confidence", "notes"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "calories", "proteinGram", "carbsGram", "fatGram"],
        properties: {
          name: { type: "string" },
          estimatedWeightGram: { type: "number" },
          calories: { type: "number" },
          proteinGram: { type: "number" },
          carbsGram: { type: "number" },
          fatGram: { type: "number" },
          fiberGram: { type: "number" },
        },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: [
        "calories",
        "proteinGram",
        "carbsGram",
        "fatGram",
        "fiberGram",
        "sugarGram",
        "addedSugarGram",
        "sugarAlcoholGram",
        "sodiumMg",
        "potassiumMg",
        "calciumMg",
        "ironMg",
        "cholesterolMg",
        "saturatedFatGram",
        "transFatGram",
        "monounsaturatedFatGram",
        "polyunsaturatedFatGram",
        "vitaminAIU",
        "vitaminCMg",
        "vitaminDIU",
      ],
      properties: {
        calories: { type: "number" },
        proteinGram: { type: "number" },
        carbsGram: { type: "number" },
        fatGram: { type: "number" },
        fiberGram: { type: "number" },
        sugarGram: { type: "number" },
        addedSugarGram: { type: "number" },
        sugarAlcoholGram: { type: "number" },
        sodiumMg: { type: "number" },
        potassiumMg: { type: "number" },
        calciumMg: { type: "number" },
        ironMg: { type: "number" },
        cholesterolMg: { type: "number" },
        saturatedFatGram: { type: "number" },
        transFatGram: { type: "number" },
        monounsaturatedFatGram: { type: "number" },
        polyunsaturatedFatGram: { type: "number" },
        vitaminAIU: { type: "number" },
        vitaminCMg: { type: "number" },
        vitaminDIU: { type: "number" },
      },
    },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildNutrientHintText(items: NutritionItem[], raw: any): string {
  const itemNames = items.map((item) => item.name).join(" ");
  const note = typeof raw?.notes === "string" ? raw.notes : "";
  return `${itemNames} ${note}`.toLowerCase();
}

function enrichTotalsByHeuristics(totals: NutritionTotals, items: NutritionItem[], raw: any): NutritionTotals {
  const next: NutritionTotals = { ...totals };
  const hintText = buildNutrientHintText(items, raw);

  const calories = Math.max(0, next.calories);
  const carbs = Math.max(0, next.carbsGram);
  const protein = Math.max(0, next.proteinGram);
  const fat = Math.max(0, next.fatGram);
  const fiber = Math.max(0, next.fiberGram);

  const salty = /(泡菜|咸菜|榨菜|腌|酱油|味噌|卤|火锅|拉面|方便面|汤底|咸|kimchi|pickle|brine|soy sauce|ramen|bacon|sausage)/i.test(
    hintText,
  );
  const sweet = /(糖|甜|奶茶|饮料|果汁|可乐|汽水|甜点|蛋糕|饼干|冰淇淋|巧克力|蜂蜜|果酱|sugar|sweet|juice|soda|cake|cookie|dessert|honey|jam)/i.test(
    hintText,
  );
  const fruit = /(苹果|香蕉|葡萄|橙|西瓜|草莓|芒果|菠萝|fruit|apple|banana|orange|grape|mango|pineapple|berry)/i.test(
    hintText,
  );
  const friedOrProcessed = /(油炸|炸|培根|腊肉|香肠|午餐肉|黄油|奶油|芝士|fried|bacon|sausage|butter|cream|cheese)/i.test(
    hintText,
  );
  const animalFood = /(鸡|牛|猪|羊|鱼|虾|蛋|奶|肉|chicken|beef|pork|lamb|fish|shrimp|egg|milk|meat)/i.test(
    hintText,
  );

  let sugarEstimate = carbs * (fruit ? 0.45 : sweet ? 0.34 : 0.18);
  if (!fruit && !sweet && carbs < 10) {
    sugarEstimate = carbs * 0.1;
  }
  sugarEstimate = clamp(sugarEstimate, carbs > 0 ? 0.2 : 0, carbs);
  const sugarLooksInvalid =
    next.sugarGram <= 0 ||
    (carbs >= 18 && next.sugarGram < 1) ||
    ((sweet || fruit) && carbs >= 8 && next.sugarGram < 2);
  if (sugarLooksInvalid && carbs > 0) {
    next.sugarGram = roundTo(sugarEstimate, 1);
  }

  let addedSugarEstimate = sweet ? next.sugarGram * 0.55 : fruit ? next.sugarGram * 0.12 : next.sugarGram * 0.25;
  addedSugarEstimate = clamp(addedSugarEstimate, 0, next.sugarGram);
  const addedSugarLooksInvalid =
    next.addedSugarGram < 0 ||
    next.addedSugarGram > next.sugarGram ||
    (sweet && next.sugarGram >= 3 && next.addedSugarGram < 1);
  if (addedSugarLooksInvalid) {
    next.addedSugarGram = roundTo(addedSugarEstimate, 1);
  }

  if (!Number.isFinite(next.sugarAlcoholGram) || next.sugarAlcoholGram < 0) {
    next.sugarAlcoholGram = 0;
  }
  if (next.sugarAlcoholGram > next.sugarGram) {
    next.sugarAlcoholGram = roundTo(clamp(next.sugarGram * 0.3, 0, next.sugarGram), 1);
  }

  let sodiumEstimate = Math.max(80, calories * 1.05, protein * 8 + carbs * 2 + fiber * 6);
  if (salty) {
    sodiumEstimate = Math.max(sodiumEstimate, 700);
  }
  if (/(泡菜|咸菜|榨菜|酱油|味噌|腌|火锅|拉面|方便面|汤底)/i.test(hintText)) {
    sodiumEstimate = Math.max(sodiumEstimate, 900);
  }
  const sodiumLooksInvalid = next.sodiumMg <= 0 || (salty && next.sodiumMg < 220);
  if (sodiumLooksInvalid) {
    next.sodiumMg = roundTo(clamp(sodiumEstimate, 50, 6000), 0);
  }

  if (next.potassiumMg <= 0) {
    next.potassiumMg = roundTo(Math.max(120, protein * 15 + carbs * 6 + fiber * 18), 0);
  }
  if (next.calciumMg <= 0) {
    next.calciumMg = roundTo(Math.max(30, protein * 3.2 + fat * 1.6 + fiber * 3), 0);
  }
  if (next.ironMg <= 0) {
    next.ironMg = roundTo(Math.max(0.4, protein * 0.07 + carbs * 0.015 + fiber * 0.1), 1);
  }

  if (next.cholesterolMg <= 0) {
    const cholesterolEstimate = animalFood ? Math.max(18, protein * 1.4 + fat * 2.2) : Math.max(0, protein * 0.2);
    next.cholesterolMg = roundTo(cholesterolEstimate, 0);
  }

  let saturatedEstimate = fat * (friedOrProcessed ? 0.38 : 0.32);
  saturatedEstimate = clamp(saturatedEstimate, 0, fat);
  if (next.saturatedFatGram <= 0 || next.saturatedFatGram > fat) {
    next.saturatedFatGram = roundTo(saturatedEstimate, 1);
  } else {
    next.saturatedFatGram = roundTo(clamp(next.saturatedFatGram, 0, fat), 1);
  }

  let transEstimate = friedOrProcessed ? fat * 0.015 : fat * 0.004;
  transEstimate = clamp(transEstimate, 0, Math.max(fat - next.saturatedFatGram, 0));
  if (next.transFatGram < 0 || next.transFatGram > fat) {
    next.transFatGram = roundTo(transEstimate, 1);
  } else {
    next.transFatGram = roundTo(clamp(next.transFatGram, 0, Math.max(fat - next.saturatedFatGram, 0)), 1);
  }

  const remainUnsaturated = Math.max(fat - next.saturatedFatGram - next.transFatGram, 0);
  let mono = next.monounsaturatedFatGram;
  let poly = next.polyunsaturatedFatGram;
  if (mono < 0 || poly < 0 || mono + poly <= 0 || mono + poly > Math.max(remainUnsaturated * 1.5, 0.1)) {
    mono = remainUnsaturated * 0.62;
    poly = remainUnsaturated * 0.38;
  } else if (mono + poly > remainUnsaturated && mono + poly > 0) {
    const scale = remainUnsaturated / (mono + poly);
    mono *= scale;
    poly *= scale;
  }
  next.monounsaturatedFatGram = roundTo(clamp(mono, 0, remainUnsaturated), 1);
  next.polyunsaturatedFatGram = roundTo(clamp(poly, 0, Math.max(remainUnsaturated - next.monounsaturatedFatGram, 0)), 1);

  if (next.vitaminAIU <= 0) {
    next.vitaminAIU = roundTo(Math.max(0, fat * 18 + fiber * 32), 0);
  }
  if (next.vitaminCMg <= 0) {
    const vitaminCEstimate = fruit ? fiber * 4 + carbs * 0.22 : fiber * 2.3 + carbs * 0.08;
    next.vitaminCMg = roundTo(Math.max(0, vitaminCEstimate), 1);
  }
  if (next.vitaminDIU <= 0) {
    next.vitaminDIU = roundTo(Math.max(0, protein * 0.45 + fat * 0.6), 0);
  }

  return next;
}

function resolveProvider(rawInput?: string): AIProvider {
  const raw = String(rawInput ?? config.aiProvider ?? "openai").toLowerCase();

  if (raw === "gemini" || raw === "gemini_native" || raw === "google_gemini") {
    return "gemini";
  }

  if (
    raw === "openai" ||
    raw === "openai_compat_auto" ||
    raw === "openai_compat_responses" ||
    raw === "openai_compat_chat"
  ) {
    return raw;
  }

  return "openai_compat_auto";
}

function resolveImageDetail(rawInput?: string): "low" | "high" | "auto" {
  const detail = String(rawInput ?? config.aiImageDetail ?? "auto").toLowerCase();
  if (detail === "low" || detail === "high") {
    return detail;
  }
  return "auto";
}

function shouldUseGeminiNative(provider: AIProvider, rawBaseUrl: string, model: string) {
  return (
    provider === "gemini" ||
    (provider === "openai_compat_auto" && /\/v1beta\/models\/?$/i.test(rawBaseUrl) && /^gemini-/i.test(model.trim()))
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

function normalizeProviderForBaseUrl(provider: AIProvider, baseUrl: string): AIProvider {
  if (provider === "openai_compat_auto" && /\/v1beta\/openai$/i.test(baseUrl)) {
    return "openai_compat_chat";
  }
  return provider;
}

function buildPrimaryClientConfig(): AIClientConfig | null {
  const apiKey = String(config.aiApiKey ?? "").trim();
  if (!apiKey) {
    return null;
  }
  const rawProvider = resolveProvider(config.aiProvider);
  const provider = shouldUseGeminiNative(rawProvider, config.aiBaseUrl, config.aiModel) ? "gemini" : rawProvider;
  const baseUrl = normalizeBaseUrl(config.aiBaseUrl, provider);
  const effectiveProvider = normalizeProviderForBaseUrl(provider, baseUrl);

  return {
    provider: effectiveProvider,
    baseUrl,
    apiKey,
    model: config.aiModel,
    imageDetail: resolveImageDetail(config.aiImageDetail),
    timeoutMs: config.aiTimeoutMs,
    label: "主线路",
  };
}

function buildBackupClientConfig(): AIClientConfig | null {
  const backupKey = String(config.aiBackupApiKey ?? "").trim();
  const backupBaseUrl = String(config.aiBackupBaseUrl ?? "").trim();
  const backupModel = String(config.aiBackupModel ?? "").trim();

  // 只要任一备线字段填写，就尝试启用备线；未填写项回退主线配置。
  const backupTouched = Boolean(backupKey || backupBaseUrl || backupModel);
  if (!backupTouched) {
    return null;
  }

  const apiKey = backupKey || String(config.aiApiKey ?? "").trim();
  if (!apiKey) {
    return null;
  }

  const timeoutMs = Number(config.aiBackupTimeoutMs);
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : config.aiTimeoutMs;
  const backupRawBaseUrl = backupBaseUrl || config.aiBaseUrl;
  const backupEffectiveModel = backupModel || config.aiModel;
  const rawProvider = resolveProvider(config.aiBackupProvider || config.aiProvider);
  const provider = shouldUseGeminiNative(rawProvider, backupRawBaseUrl, backupEffectiveModel) ? "gemini" : rawProvider;
  const baseUrl = normalizeBaseUrl(backupRawBaseUrl, provider);
  const effectiveProvider = normalizeProviderForBaseUrl(provider, baseUrl);

  return {
    provider: effectiveProvider,
    baseUrl,
    apiKey,
    model: backupEffectiveModel,
    imageDetail: resolveImageDetail(config.aiBackupImageDetail || config.aiImageDetail),
    timeoutMs: effectiveTimeoutMs,
    label: "备用线路",
  };
}

function buildPrompt(description?: string) {
  const lines = [
    "你是营养师助手。请根据食物图片估算食物组成与营养。",
    "请仅返回 JSON，不要输出任何解释文字。",
    "JSON 必须包含 items/totals/confidence/notes 四个字段。",
    "items 每项包含 name/calories/proteinGram/carbsGram/fatGram，可选 estimatedWeightGram/fiberGram。",
    "totals 必须包含以下全部字段（都要给数字，无法确定时给合理估算，不要省略字段）：",
    "calories/proteinGram/carbsGram/fatGram/fiberGram/sugarGram/addedSugarGram/sugarAlcoholGram/sodiumMg/potassiumMg/calciumMg/ironMg/cholesterolMg/saturatedFatGram/transFatGram/monounsaturatedFatGram/polyunsaturatedFatGram/vitaminAIU/vitaminCMg/vitaminDIU。",
    "如果不确定，请在 notes 说明不确定点，并降低 confidence。",
  ];

  if (description?.trim()) {
    lines.push(`用户补充描述：${description.trim()}`);
  }

  return lines.join("\n");
}

function buildTextPrompt(description: string) {
  return [
    "你是营养师助手。用户会用文字描述这顿饭，请估算食物与营养。",
    "请仅返回 JSON，不要输出任何解释文字。",
    "JSON 必须包含 items/totals/confidence/notes 四个字段。",
    "items 每项包含 name/calories/proteinGram/carbsGram/fatGram，可选 estimatedWeightGram/fiberGram。",
    "totals 必须包含以下全部字段（都要给数字，无法确定时给合理估算，不要省略字段）：",
    "calories/proteinGram/carbsGram/fatGram/fiberGram/sugarGram/addedSugarGram/sugarAlcoholGram/sodiumMg/potassiumMg/calciumMg/ironMg/cholesterolMg/saturatedFatGram/transFatGram/monounsaturatedFatGram/polyunsaturatedFatGram/vitaminAIU/vitaminCMg/vitaminDIU。",
    "如果不确定，请在 notes 说明不确定点，并降低 confidence。",
    `用户描述：${description}`,
  ].join("\n");
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI 接口调用失败（${response.status}）：${errorText}`);
    }

    return response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`AI 请求超时（>${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTextOutputFromResponses(response: any): string | null {
  if (typeof response?.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text;
  }

  const outputBlocks = response?.output;
  if (!Array.isArray(outputBlocks)) {
    return null;
  }

  for (const block of outputBlocks) {
    const contents = block?.content;
    if (!Array.isArray(contents)) {
      continue;
    }

    for (const item of contents) {
      if (typeof item?.text === "string" && item.text.trim().length > 0) {
        return item.text;
      }
    }
  }

  return null;
}

function extractTextOutputFromChatCompletions(response: any): string | null {
  const messageContent = response?.choices?.[0]?.message?.content;

  if (typeof messageContent === "string" && messageContent.trim().length > 0) {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    const textParts = messageContent
      .map((item) => {
        if (typeof item?.text === "string") {
          return item.text;
        }
        if (typeof item?.content === "string") {
          return item.content;
        }
        return "";
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  return null;
}

function extractTextOutputFromGemini(response: any): string | null {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function buildGeminiGenerateContentUrl(baseUrl: string, model: string, apiKey: string) {
  const normalizedModel = model.trim().replace(/^models\//i, "");
  const endpoint = /\/models$/i.test(baseUrl)
    ? `${baseUrl}/${normalizedModel}:generateContent`
    : `${baseUrl}/models/${normalizedModel}:generateContent`;
  return `${endpoint}?key=${encodeURIComponent(apiKey)}`;
}

function extractJsonText(rawText: string): string {
  const text = rawText.trim();
  if (text.length === 0) {
    throw new Error("AI 未返回有效内容");
  }

  const fencedJson = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson?.[1]) {
    return fencedJson[1].trim();
  }

  const fencedAny = text.match(/```\s*([\s\S]*?)```/i);
  if (fencedAny?.[1]) {
    return fencedAny[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}

function normalizeAnalysis(raw: any): NutritionAnalysis {
  const items = Array.isArray(raw?.items)
    ? raw.items.map((item: any) => ({
        name: String(item?.name ?? "未知食物"),
        estimatedWeightGram:
          item?.estimatedWeightGram === undefined ? undefined : toNumber(item.estimatedWeightGram),
        calories: toNumber(item?.calories),
        proteinGram: toNumber(item?.proteinGram),
        carbsGram: toNumber(item?.carbsGram),
        fatGram: toNumber(item?.fatGram),
        fiberGram: item?.fiberGram === undefined ? undefined : toNumber(item?.fiberGram),
      }))
    : [];

  const computedTotals = items.reduce(
    (
      acc: { calories: number; proteinGram: number; carbsGram: number; fatGram: number; fiberGram: number },
      item: NutritionItem,
    ) => {
      acc.calories += item.calories;
      acc.proteinGram += item.proteinGram;
      acc.carbsGram += item.carbsGram;
      acc.fatGram += item.fatGram;
      acc.fiberGram += item.fiberGram ?? 0;
      return acc;
    },
    { calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 },
  );

  const rawTotals: NutritionTotals = {
    calories: toNumber(raw?.totals?.calories, computedTotals.calories),
    proteinGram: toNumber(raw?.totals?.proteinGram, computedTotals.proteinGram),
    carbsGram: toNumber(raw?.totals?.carbsGram, computedTotals.carbsGram),
    fatGram: toNumber(raw?.totals?.fatGram, computedTotals.fatGram),
    fiberGram: toNumber(raw?.totals?.fiberGram, computedTotals.fiberGram),
    sugarGram: toNumber(raw?.totals?.sugarGram),
    addedSugarGram: toNumber(raw?.totals?.addedSugarGram),
    sugarAlcoholGram: toNumber(raw?.totals?.sugarAlcoholGram),
    sodiumMg: toNumber(raw?.totals?.sodiumMg),
    potassiumMg: toNumber(raw?.totals?.potassiumMg),
    calciumMg: toNumber(raw?.totals?.calciumMg),
    ironMg: toNumber(raw?.totals?.ironMg),
    cholesterolMg: toNumber(raw?.totals?.cholesterolMg),
    saturatedFatGram: toNumber(raw?.totals?.saturatedFatGram),
    transFatGram: toNumber(raw?.totals?.transFatGram),
    monounsaturatedFatGram: toNumber(raw?.totals?.monounsaturatedFatGram),
    polyunsaturatedFatGram: toNumber(raw?.totals?.polyunsaturatedFatGram),
    vitaminAIU: toNumber(raw?.totals?.vitaminAIU),
    vitaminCMg: toNumber(raw?.totals?.vitaminCMg),
    vitaminDIU: toNumber(raw?.totals?.vitaminDIU),
  };
  const totals = enrichTotalsByHeuristics(rawTotals, items, raw);

  return {
    items,
    totals,
    confidence: Math.max(0, Math.min(1, toNumber(raw?.confidence, 0.5))),
    notes: String(raw?.notes ?? "图像识别结果仅供参考，建议手动复核。"),
  };
}

function attachAIUsage(analysis: NutritionAnalysis, client: AIClientConfig): NutritionAnalysis {
  return {
    ...analysis,
    ai: {
      provider: client.provider,
      model: client.model,
      route: client.label,
    },
  };
}

function mockAnalysis(): NutritionAnalysis {
  return {
    items: [
      {
        name: "示例餐食（请手动修正）",
        estimatedWeightGram: 250,
        calories: 480,
        proteinGram: 26,
        carbsGram: 52,
        fatGram: 18,
        fiberGram: 5,
      },
    ],
    totals: {
      calories: 480,
      proteinGram: 26,
      carbsGram: 52,
      fatGram: 18,
      fiberGram: 5,
      sugarGram: 6,
      addedSugarGram: 0,
      sugarAlcoholGram: 0,
      sodiumMg: 650,
      potassiumMg: 520,
      calciumMg: 90,
      ironMg: 3.2,
      cholesterolMg: 85,
      saturatedFatGram: 5.2,
      transFatGram: 0,
      monounsaturatedFatGram: 7.5,
      polyunsaturatedFatGram: 3.1,
      vitaminAIU: 480,
      vitaminCMg: 12,
      vitaminDIU: 24,
    },
    confidence: 0.35,
    notes: "未配置 AI_API_KEY（或 OPENAI_API_KEY），当前为演示估算值。",
    ai: {
      provider: "local",
      model: "本地演示估算",
      route: "本地",
    },
  };
}

async function callResponsesApi(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  imageDataUrl: string;
  imageDetail: "low" | "high" | "auto";
  strictJsonSchema: boolean;
  timeoutMs: number;
}) {
  const { baseUrl, apiKey, model, prompt, imageDataUrl, imageDetail, strictJsonSchema, timeoutMs } = params;

  const requestBody: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: imageDetail,
          },
        ],
      },
    ],
    max_output_tokens: 1000,
  };

  if (strictJsonSchema) {
    requestBody.text = {
      format: {
        type: "json_schema",
        name: "nutrition_analysis",
        schema: outputSchema,
        strict: true,
      },
    };
  }

  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    timeoutMs,
  );

  const outputText = extractTextOutputFromResponses(payload);
  if (!outputText) {
    throw new Error("AI 未返回有效内容");
  }

  return outputText;
}

async function callChatCompletionsApi(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  imageDataUrl: string;
  imageDetail: "low" | "high" | "auto";
  timeoutMs: number;
}) {
  const { baseUrl, apiKey, model, prompt, imageDataUrl, imageDetail, timeoutMs } = params;

  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是营养师助手。请只返回 JSON，不要返回任何多余文字。",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                  detail: imageDetail,
                },
              },
            ],
          },
        ],
      }),
    },
    timeoutMs,
  );

  const outputText = extractTextOutputFromChatCompletions(payload);
  if (!outputText) {
    throw new Error("AI 未返回有效内容");
  }

  return outputText;
}

async function callGeminiGenerateContentApi(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  base64Image?: string;
  mimeType?: string;
  timeoutMs: number;
}) {
  const { baseUrl, apiKey, model, prompt, base64Image, mimeType, timeoutMs } = params;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (base64Image) {
    parts.push({
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data: base64Image,
      },
    });
  }

  const payload = await fetchJsonWithTimeout(
    buildGeminiGenerateContentUrl(baseUrl, model, apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1000,
          responseMimeType: "application/json",
        },
      }),
    },
    timeoutMs,
  );

  const outputText = extractTextOutputFromGemini(payload);
  if (!outputText) {
    throw new Error("Gemini 未返回有效内容");
  }

  return outputText;
}

async function callResponsesApiText(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  strictJsonSchema: boolean;
  timeoutMs: number;
}) {
  const { baseUrl, apiKey, model, prompt, strictJsonSchema, timeoutMs } = params;

  const requestBody: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    max_output_tokens: 1000,
  };

  if (strictJsonSchema) {
    requestBody.text = {
      format: {
        type: "json_schema",
        name: "nutrition_analysis",
        schema: outputSchema,
        strict: true,
      },
    };
  }

  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/responses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    timeoutMs,
  );

  const outputText = extractTextOutputFromResponses(payload);
  if (!outputText) {
    throw new Error("AI 未返回有效内容");
  }

  return outputText;
}

async function callChatCompletionsApiText(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
}) {
  const { baseUrl, apiKey, model, prompt, timeoutMs } = params;

  const payload = await fetchJsonWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是营养师助手。请只返回 JSON，不要返回任何多余文字。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    },
    timeoutMs,
  );

  const outputText = extractTextOutputFromChatCompletions(payload);
  if (!outputText) {
    throw new Error("AI 未返回有效内容");
  }

  return outputText;
}

function parseAnalysisFromRawText(rawText: string): NutritionAnalysis {
  const jsonText = extractJsonText(rawText);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI 返回结果不是有效 JSON");
  }

  return normalizeAnalysis(parsed);
}

async function analyzeImageWithClient(
  client: AIClientConfig,
  base64Image: string,
  mimeType: string,
  description?: string,
) {
  const prompt = buildPrompt(description);
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;
  let rawText: string;

  if (client.provider === "gemini") {
    rawText = await callGeminiGenerateContentApi({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      base64Image,
      mimeType,
      timeoutMs: client.timeoutMs,
    });
  } else if (client.provider === "openai") {
    rawText = await callResponsesApi({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      imageDataUrl,
      imageDetail: client.imageDetail,
      strictJsonSchema: true,
      timeoutMs: client.timeoutMs,
    });
  } else if (client.provider === "openai_compat_responses") {
    rawText = await callResponsesApi({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      imageDataUrl,
      imageDetail: client.imageDetail,
      strictJsonSchema: false,
      timeoutMs: client.timeoutMs,
    });
  } else if (client.provider === "openai_compat_chat") {
    rawText = await callChatCompletionsApi({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      imageDataUrl,
      imageDetail: client.imageDetail,
      timeoutMs: client.timeoutMs,
    });
  } else {
    try {
      rawText = await callResponsesApi({
        baseUrl: client.baseUrl,
        apiKey: client.apiKey,
        model: client.model,
        prompt,
        imageDataUrl,
        imageDetail: client.imageDetail,
        strictJsonSchema: false,
        timeoutMs: client.timeoutMs,
      });
    } catch (error) {
      rawText = await callChatCompletionsApi({
        baseUrl: client.baseUrl,
        apiKey: client.apiKey,
        model: client.model,
        prompt,
        imageDataUrl,
        imageDetail: client.imageDetail,
        timeoutMs: client.timeoutMs,
      }).catch((chatError) => {
        throw new Error(
          `兼容模式调用失败。responses 错误：${(error as Error).message}；chat 错误：${(chatError as Error).message}`,
        );
      });
    }
  }

  return attachAIUsage(parseAnalysisFromRawText(rawText), client);
}

async function analyzeTextWithClient(client: AIClientConfig, description: string) {
  const prompt = buildTextPrompt(description);
  let rawText: string;

  if (client.provider === "gemini") {
    rawText = await callGeminiGenerateContentApi({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      timeoutMs: client.timeoutMs,
    });
  } else if (client.provider === "openai") {
    rawText = await callResponsesApiText({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      strictJsonSchema: true,
      timeoutMs: client.timeoutMs,
    });
  } else if (client.provider === "openai_compat_responses") {
    rawText = await callResponsesApiText({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      strictJsonSchema: false,
      timeoutMs: client.timeoutMs,
    });
  } else if (client.provider === "openai_compat_chat") {
    rawText = await callChatCompletionsApiText({
      baseUrl: client.baseUrl,
      apiKey: client.apiKey,
      model: client.model,
      prompt,
      timeoutMs: client.timeoutMs,
    });
  } else {
    try {
      rawText = await callResponsesApiText({
        baseUrl: client.baseUrl,
        apiKey: client.apiKey,
        model: client.model,
        prompt,
        strictJsonSchema: false,
        timeoutMs: client.timeoutMs,
      });
    } catch (error) {
      rawText = await callChatCompletionsApiText({
        baseUrl: client.baseUrl,
        apiKey: client.apiKey,
        model: client.model,
        prompt,
        timeoutMs: client.timeoutMs,
      }).catch((chatError) => {
        throw new Error(
          `兼容模式调用失败。responses 错误：${(error as Error).message}；chat 错误：${(chatError as Error).message}`,
        );
      });
    }
  }

  return attachAIUsage(parseAnalysisFromRawText(rawText), client);
}

async function withBackupFallback<T>(
  primary: AIClientConfig | null,
  backup: AIClientConfig | null,
  action: (client: AIClientConfig) => Promise<T>,
): Promise<T> {
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
      if (primaryError) {
        const primaryLabel = primary?.label ?? "主线路";
        throw new Error(`${primaryLabel}失败：${primaryError.message}；${backup.label}失败：${backupError.message}`);
      }
      throw backupError;
    }
  }

  if (primaryError) {
    throw primaryError;
  }

  throw new Error("未配置可用 AI 线路，请检查 AI_API_KEY 与备用线路配置。");
}

export async function analyzeFoodImage(base64Image: string, mimeType: string, description?: string) {
  const primary = buildPrimaryClientConfig();
  const backup = buildBackupClientConfig();

  if (!primary && !backup) {
    return mockAnalysis();
  }

  return withBackupFallback(primary, backup, (client) =>
    analyzeImageWithClient(client, base64Image, mimeType, description),
  );
}

export async function analyzeFoodText(description: string) {
  const primary = buildPrimaryClientConfig();
  const backup = buildBackupClientConfig();

  if (!primary && !backup) {
    return {
      ...mockAnalysis(),
      notes: "未配置 AI_API_KEY（或 OPENAI_API_KEY），当前为演示估算值。你也可以先记录文字描述。",
    };
  }

  return withBackupFallback(primary, backup, (client) => analyzeTextWithClient(client, description));
}
