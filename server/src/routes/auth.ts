import bcrypt from "bcryptjs";
import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { createToken, requireAuth } from "../middleware/auth";
import { forgotPasswordConfirmSchema, forgotPasswordRequestSchema, loginSchema, registerSchema } from "./schemas";

export const authRouter = Router();

const findUserByEmailStmt = db.prepare(
  `SELECT id, email, password_hash, display_name FROM users WHERE lower(email) = ?`,
);
const insertUserStmt = db.prepare(
  `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const updateUserPasswordStmt = db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`);
const findUserByIdStmt = db.prepare(
  `SELECT id, email, display_name, age, sex, height_cm, weight_kg, activity_level, goal,
          target_calories, target_protein_gram, target_carbs_gram, target_fat_gram
   FROM users WHERE id = ?`,
);
const deletePasswordResetByUserStmt = db.prepare(`DELETE FROM password_reset_codes WHERE user_id = ?`);
const insertPasswordResetStmt = db.prepare(
  `INSERT INTO password_reset_codes (id, user_id, email, code_hash, expires_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const findLatestValidResetCodeStmt = db.prepare(
  `SELECT id, user_id, code_hash, expires_at
   FROM password_reset_codes
   WHERE user_id = ? AND used_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1`,
);
const markResetUsedStmt = db.prepare(`UPDATE password_reset_codes SET used_at = ? WHERE id = ?`);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "注册参数不合法" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const { password, displayName } = parsed.data;
  const existing = findUserByEmailStmt.get(email) as { id: string } | undefined;

  if (existing) {
    res.status(409).json({ message: "该邮箱已被注册" });
    return;
  }

  const now = nowIso();
  const userId = createId();
  const passwordHash = await bcrypt.hash(password, 12);

  insertUserStmt.run(userId, email, passwordHash, displayName, now, now);

  const token = createToken({ sub: userId, email, displayName });

  res.status(201).json({
    token,
    user: {
      id: userId,
      email,
      displayName,
    },
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "登录参数不合法" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const { password } = parsed.data;
  const user = findUserByEmailStmt.get(email) as
    | { id: string; email: string; password_hash: string; display_name: string }
    | undefined;

  if (!user) {
    res.status(401).json({ message: "邮箱或密码错误" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ message: "邮箱或密码错误" });
    return;
  }

  const token = createToken({
    sub: user.id,
    email: user.email,
    displayName: user.display_name,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
    },
  });
});

authRouter.post("/forgot-password/request", async (req, res) => {
  const parsed = forgotPasswordRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "参数不合法" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const user = findUserByEmailStmt.get(email) as
    | { id: string; email: string; password_hash: string; display_name: string }
    | undefined;

  if (!user) {
    res.json({ message: "如果邮箱已注册，验证码会发送到该邮箱（演示环境直接返回验证码）" });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 8);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  deletePasswordResetByUserStmt.run(user.id);
  insertPasswordResetStmt.run(createId(), user.id, user.email, codeHash, expiresAt, now);

  res.json({
    message: "验证码已生成（演示环境直接显示），15 分钟内有效",
    code,
    expiresAt,
  });
});

authRouter.post("/forgot-password/confirm", async (req, res) => {
  const parsed = forgotPasswordConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "参数不合法" });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const user = findUserByEmailStmt.get(email) as
    | { id: string; email: string; password_hash: string; display_name: string }
    | undefined;

  if (!user) {
    res.status(404).json({ message: "用户不存在" });
    return;
  }

  const reset = findLatestValidResetCodeStmt.get(user.id) as
    | { id: string; user_id: string; code_hash: string; expires_at: string }
    | undefined;

  if (!reset) {
    res.status(400).json({ message: "请先获取验证码" });
    return;
  }

  if (new Date(reset.expires_at).getTime() < Date.now()) {
    res.status(400).json({ message: "验证码已过期，请重新获取" });
    return;
  }

  const codeValid = await bcrypt.compare(parsed.data.code, reset.code_hash);
  if (!codeValid) {
    res.status(400).json({ message: "验证码错误" });
    return;
  }

  const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  const now = nowIso();

  updateUserPasswordStmt.run(newPasswordHash, now, user.id);
  markResetUsedStmt.run(now, reset.id);

  res.json({ message: "密码已重置，请使用新密码登录" });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const row = findUserByIdStmt.get(req.user!.id) as
    | {
        id: string;
        email: string;
        display_name: string;
        age: number | null;
        sex: string | null;
        height_cm: number | null;
        weight_kg: number | null;
        activity_level: string | null;
        goal: string | null;
        target_calories: number | null;
        target_protein_gram: number | null;
        target_carbs_gram: number | null;
        target_fat_gram: number | null;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ message: "用户不存在" });
    return;
  }

  res.json({
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      age: row.age,
      sex: row.sex,
      heightCm: row.height_cm,
      weightKg: row.weight_kg,
      activityLevel: row.activity_level,
      goal: row.goal,
      targetCalories: row.target_calories,
      targetProteinGram: row.target_protein_gram,
      targetCarbsGram: row.target_carbs_gram,
      targetFatGram: row.target_fat_gram,
    },
  });
});
