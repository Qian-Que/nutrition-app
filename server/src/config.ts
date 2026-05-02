import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  aiProvider: process.env.AI_PROVIDER ?? "openai",
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
  aiApiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY,
  aiModel: process.env.AI_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
  aiImageDetail: process.env.AI_IMAGE_DETAIL ?? process.env.OPENAI_IMAGE_DETAIL ?? "auto",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 45000),
  aiBackupProvider: process.env.AI_BACKUP_PROVIDER ?? process.env.AI_PROVIDER ?? "openai_compat_auto",
  aiBackupBaseUrl: process.env.AI_BACKUP_BASE_URL ?? "",
  aiBackupApiKey: process.env.AI_BACKUP_API_KEY ?? "",
  aiBackupModel: process.env.AI_BACKUP_MODEL ?? "",
  aiBackupImageDetail: process.env.AI_BACKUP_IMAGE_DETAIL ?? "",
  aiBackupTimeoutMs: Number(process.env.AI_BACKUP_TIMEOUT_MS ?? 0),
};

