import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { calculateTargets } from "../utils/targets";
import { createWeightLogSchema } from "./schemas";

export const weightsRouter = Router();

type WeightRow = {
  id: string;
  user_id: string;
  logged_at: string;
  weight_kg: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

function mapWeightRow(row: WeightRow) {
  return {
    id: row.id,
    userId: row.user_id,
    loggedAt: row.logged_at,
    weightKg: row.weight_kg,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function recalculateTargetsForLatestWeight(userId: string, latestWeightKg: number) {
  const profile = db
    .prepare(
      `SELECT age, sex, height_cm, activity_level, goal, target_weight_kg, weekly_weight_change_kg
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | {
        age: number | null;
        sex: string | null;
        height_cm: number | null;
        activity_level: string | null;
        goal: string | null;
        target_weight_kg: number | null;
        weekly_weight_change_kg: number | null;
      }
    | undefined;

  if (!profile?.age || !profile.sex || !profile.height_cm || !profile.activity_level || !profile.goal) {
    db.prepare("UPDATE users SET weight_kg = ?, updated_at = ? WHERE id = ?").run(latestWeightKg, nowIso(), userId);
    return null;
  }

  const targets = calculateTargets({
    age: profile.age,
    sex: profile.sex === "FEMALE" ? "FEMALE" : "MALE",
    heightCm: profile.height_cm,
    weightKg: latestWeightKg,
    targetWeightKg: profile.target_weight_kg ?? undefined,
    weeklyWeightChangeKg: profile.weekly_weight_change_kg ?? undefined,
    activityLevel:
      profile.activity_level === "SEDENTARY" ||
      profile.activity_level === "LIGHT" ||
      profile.activity_level === "MODERATE" ||
      profile.activity_level === "ACTIVE" ||
      profile.activity_level === "VERY_ACTIVE"
        ? profile.activity_level
        : "MODERATE",
    goal:
      profile.goal === "LOSE_WEIGHT" || profile.goal === "GAIN_MUSCLE" || profile.goal === "MAINTAIN"
        ? profile.goal
        : "MAINTAIN",
  });

  db.prepare(
    `UPDATE users
     SET weight_kg = ?, target_calories = ?, target_protein_gram = ?, target_carbs_gram = ?, target_fat_gram = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    latestWeightKg,
    targets.targetCalories,
    targets.targetProteinGram,
    targets.targetCarbsGram,
    targets.targetFatGram,
    nowIso(),
    userId,
  );

  return targets;
}

weightsRouter.get("/", requireAuth, async (req, res) => {
  const limitRaw = Number(req.query.limit ?? 90);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 365) : 90;
  const rows = db
    .prepare("SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT ?")
    .all(req.user!.id, limit) as WeightRow[];

  const logs = rows.map((row) => mapWeightRow(row));
  const latest = logs[0] ?? null;
  const oldest = logs.length > 0 ? logs[logs.length - 1] : null;
  const changeKg = latest && oldest ? Number((latest.weightKg - oldest.weightKg).toFixed(1)) : 0;

  res.json({ logs, latest, changeKg });
});

weightsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createWeightLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "体重记录参数不合法" });
    return;
  }

  const data = parsed.data;
  const id = createId();
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : now;

  db.prepare(
    `INSERT INTO weight_logs (id, user_id, logged_at, weight_kg, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.user!.id, loggedAt, data.weightKg, data.note ?? null, now, now);

  const row = db.prepare("SELECT * FROM weight_logs WHERE id = ?").get(id) as WeightRow;
  const targets = recalculateTargetsForLatestWeight(req.user!.id, data.weightKg);

  res.status(201).json({ log: mapWeightRow(row), targets });
});

weightsRouter.delete("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const existing = db
    .prepare("SELECT id FROM weight_logs WHERE id = ? AND user_id = ?")
    .get(id, req.user!.id) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ message: "体重记录不存在" });
    return;
  }

  db.prepare("DELETE FROM weight_logs WHERE id = ? AND user_id = ?").run(id, req.user!.id);
  const latest = db
    .prepare("SELECT weight_kg FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 1")
    .get(req.user!.id) as { weight_kg: number } | undefined;
  if (latest) {
    recalculateTargetsForLatestWeight(req.user!.id, latest.weight_kg);
  }
  res.json({ success: true });
});
