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
  };
  confidence: number;
  notes: string;
};

type AIProvider = "openai" | "openai_compat_auto" | "openai_compat_responses" | "openai_compat_chat";

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
      required: ["calories", "proteinGram", "carbsGram", "fatGram", "fiberGram"],
      properties: {
        calories: { type: "number" },
        proteinGram: { type: "number" },
        carbsGram: { type: "number" },
        fatGram: { type: "number" },
        fiberGram: { type: "number" },
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

function resolveProvider(): AIProvider {
  const raw = String(config.aiProvider ?? "openai").toLowerCase();

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

function resolveImageDetail(): "low" | "high" | "auto" {
  const detail = String(config.aiImageDetail ?? "auto").toLowerCase();
  if (detail === "low" || detail === "high") {
    return detail;
  }
  return "auto";
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildPrompt() {
  return [
    "你是营养师助手。请根据食物图片估算食物组成与营养。",
    "请仅返回 JSON，不要输出任何解释文字。",
    "JSON 必须包含 items/totals/confidence/notes 四个字段。",
    "items 每项包含 name/calories/proteinGram/carbsGram/fatGram，可选 estimatedWeightGram/fiberGram。",
    "totals 必须包含 calories/proteinGram/carbsGram/fatGram/fiberGram。",
    "如果不确定，请在 notes 说明不确定点，并降低 confidence。",
  ].join("\n");
}

function buildTextPrompt(description: string) {
  return [
    "你是营养师助手。用户会用文字描述这顿饭，请估算食物与营养。",
    "请仅返回 JSON，不要输出任何解释文字。",
    "JSON 必须包含 items/totals/confidence/notes 四个字段。",
    "items 每项包含 name/calories/proteinGram/carbsGram/fatGram，可选 estimatedWeightGram/fiberGram。",
    "totals 必须包含 calories/proteinGram/carbsGram/fatGram/fiberGram。",
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

  const totals = {
    calories: toNumber(raw?.totals?.calories, computedTotals.calories),
    proteinGram: toNumber(raw?.totals?.proteinGram, computedTotals.proteinGram),
    carbsGram: toNumber(raw?.totals?.carbsGram, computedTotals.carbsGram),
    fatGram: toNumber(raw?.totals?.fatGram, computedTotals.fatGram),
    fiberGram: toNumber(raw?.totals?.fiberGram, computedTotals.fiberGram),
  };

  return {
    items,
    totals,
    confidence: Math.max(0, Math.min(1, toNumber(raw?.confidence, 0.5))),
    notes: String(raw?.notes ?? "图像识别结果仅供参考，建议手动复核。"),
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
    },
    confidence: 0.35,
    notes: "未配置 AI_API_KEY（或 OPENAI_API_KEY），当前为演示估算值。",
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
}) {
  const { baseUrl, apiKey, model, prompt, imageDataUrl, imageDetail, strictJsonSchema } = params;

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
    config.aiTimeoutMs,
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
}) {
  const { baseUrl, apiKey, model, prompt, imageDataUrl, imageDetail } = params;

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
    config.aiTimeoutMs,
  );

  const outputText = extractTextOutputFromChatCompletions(payload);
  if (!outputText) {
    throw new Error("AI 未返回有效内容");
  }

  return outputText;
}

async function callResponsesApiText(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  strictJsonSchema: boolean;
}) {
  const { baseUrl, apiKey, model, prompt, strictJsonSchema } = params;

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
    config.aiTimeoutMs,
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
}) {
  const { baseUrl, apiKey, model, prompt } = params;

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
    config.aiTimeoutMs,
  );

  const outputText = extractTextOutputFromChatCompletions(payload);
  if (!outputText) {
    throw new Error("AI 未返回有效内容");
  }

  return outputText;
}

export async function analyzeFoodImage(base64Image: string, mimeType: string) {
  if (!config.aiApiKey) {
    return mockAnalysis();
  }

  const provider = resolveProvider();
  const baseUrl = normalizeBaseUrl(config.aiBaseUrl);
  const prompt = buildPrompt();
  const imageDetail = resolveImageDetail();
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

  let rawText: string;

  if (provider === "openai") {
    rawText = await callResponsesApi({
      baseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      prompt,
      imageDataUrl,
      imageDetail,
      strictJsonSchema: true,
    });
  } else if (provider === "openai_compat_responses") {
    rawText = await callResponsesApi({
      baseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      prompt,
      imageDataUrl,
      imageDetail,
      strictJsonSchema: false,
    });
  } else if (provider === "openai_compat_chat") {
    rawText = await callChatCompletionsApi({
      baseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      prompt,
      imageDataUrl,
      imageDetail,
    });
  } else {
    try {
      rawText = await callResponsesApi({
        baseUrl,
        apiKey: config.aiApiKey,
        model: config.aiModel,
        prompt,
        imageDataUrl,
        imageDetail,
        strictJsonSchema: false,
      });
    } catch (error) {
      rawText = await callChatCompletionsApi({
        baseUrl,
        apiKey: config.aiApiKey,
        model: config.aiModel,
        prompt,
        imageDataUrl,
        imageDetail,
      }).catch((chatError) => {
        throw new Error(
          `兼容模式调用失败。responses 错误：${(error as Error).message}；chat 错误：${(chatError as Error).message}`,
        );
      });
    }
  }

  const jsonText = extractJsonText(rawText);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI 返回结果不是有效 JSON");
  }

  return normalizeAnalysis(parsed);
}

export async function analyzeFoodText(description: string) {
  if (!config.aiApiKey) {
    return {
      ...mockAnalysis(),
      notes: "未配置 AI_API_KEY（或 OPENAI_API_KEY），当前为演示估算值。你也可以先记录文字描述。",
    };
  }

  const provider = resolveProvider();
  const baseUrl = normalizeBaseUrl(config.aiBaseUrl);
  const prompt = buildTextPrompt(description);

  let rawText: string;

  if (provider === "openai") {
    rawText = await callResponsesApiText({
      baseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      prompt,
      strictJsonSchema: true,
    });
  } else if (provider === "openai_compat_responses") {
    rawText = await callResponsesApiText({
      baseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      prompt,
      strictJsonSchema: false,
    });
  } else if (provider === "openai_compat_chat") {
    rawText = await callChatCompletionsApiText({
      baseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      prompt,
    });
  } else {
    try {
      rawText = await callResponsesApiText({
        baseUrl,
        apiKey: config.aiApiKey,
        model: config.aiModel,
        prompt,
        strictJsonSchema: false,
      });
    } catch (error) {
      rawText = await callChatCompletionsApiText({
        baseUrl,
        apiKey: config.aiApiKey,
        model: config.aiModel,
        prompt,
      }).catch((chatError) => {
        throw new Error(
          `兼容模式调用失败。responses 错误：${(error as Error).message}；chat 错误：${(chatError as Error).message}`,
        );
      });
    }
  }

  const jsonText = extractJsonText(rawText);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI 返回结果不是有效 JSON");
  }

  return normalizeAnalysis(parsed);
}
