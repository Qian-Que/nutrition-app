import bcrypt from "bcryptjs";
import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { createToken, requireAuth } from "../middleware/auth";
import { loginSchema, registerSchema } from "./schemas";

export const authRouter = Router();

const findUserByEmailStmt = db.prepare(
  `SELECT id, email, password_hash, display_name FROM users WHERE email = ?`,
);
const insertUserStmt = db.prepare(
  `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const findUserByIdStmt = db.prepare(
  `SELECT id, email, display_name, age, sex, height_cm, weight_kg, activity_level, goal,
          target_calories, target_protein_gram, target_carbs_gram, target_fat_gram
   FROM users WHERE id = ?`,
);

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "注册参数不合法" });
    return;
  }

  const { email, password, displayName } = parsed.data;
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

  const { email, password } = parsed.data;
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

