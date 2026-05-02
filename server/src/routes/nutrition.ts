import { Router } from "express";
import multer from "multer";

import { requireAuth } from "../middleware/auth";
import { analyzeFoodImage, analyzeFoodText } from "../services/aiNutrition";

export const nutritionRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

function normalizeAnalyzeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "AI 识别失败，请稍后重试。";
  }

  const message = error.message ?? "";

  if (message.includes("兼容模式调用失败")) {
    return "当前平台 /responses 不可用，且 /chat/completions 也调用失败。请确认 AI_MODEL 为支持图像输入的视觉模型，并检查该平台的图片输入格式要求。";
  }
  if (message.includes("convert_request_failed") || message.includes("not implemented")) {
    return "当前模型平台不支持 Responses 接口。请将 AI_PROVIDER 改为 openai_compat_auto 或 openai_compat_chat。";
  }
  if (
    message.includes("invalid_api_key") ||
    message.includes("Incorrect API key") ||
    message.includes("401")
  ) {
    return "AI_API_KEY 无效或已过期，请检查后端环境变量。";
  }
  if (message.includes("timeout") || message.includes("超时")) {
    return "AI 识别超时，请稍后重试，或调大 AI_TIMEOUT_MS。";
  }
  if (message.includes("Unable to process input image")) {
    return "模型无法处理这张图片，请换一张更清晰的食物照片重试。";
  }

  return `AI 识别失败：${message}`;
}

nutritionRouter.post("/analyze-image", requireAuth, upload.single("image"), async (req, res) => {
  let imageBase64: string | undefined;
  let mimeType = "image/jpeg";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";

  if (req.file) {
    imageBase64 = req.file.buffer.toString("base64");
    mimeType = req.file.mimetype || mimeType;
  } else if (typeof req.body?.imageBase64 === "string") {
    imageBase64 = req.body.imageBase64;
    mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : mimeType;
  }

  if (!imageBase64) {
    res.status(400).json({ message: "请提供图片文件或 imageBase64" });
    return;
  }

  if (description.length > 1000) {
    res.status(400).json({ message: "补充描述过长，请控制在 1000 字以内" });
    return;
  }

  try {
    const analysis = await analyzeFoodImage(imageBase64, mimeType, description || undefined);
    res.json({ analysis });
  } catch (error) {
    console.error("analyze-image failed:", error);
    if (description) {
      try {
        const fallbackAnalysis = await analyzeFoodText(description);
        res.json({
          analysis: fallbackAnalysis,
          fallback: "TEXT_ONLY",
          message: "图片识别失败，已按文字描述估算",
        });
        return;
      } catch (fallbackError) {
        console.error("analyze-image text fallback failed:", fallbackError);
      }
    }
    res.status(502).json({ message: normalizeAnalyzeErrorMessage(error) });
  }
});

nutritionRouter.post("/analyze-text", requireAuth, async (req, res) => {
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";

  if (!description) {
    res.status(400).json({ message: "请提供文字描述" });
    return;
  }

  if (description.length > 1000) {
    res.status(400).json({ message: "文字描述过长，请控制在 1000 字以内" });
    return;
  }

  try {
    const analysis = await analyzeFoodText(description);
    res.json({ analysis });
  } catch (error) {
    console.error("analyze-text failed:", error);
    res.status(502).json({ message: normalizeAnalyzeErrorMessage(error) });
  }
});

