import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { analyzeExerciseText, estimateExerciseCalories } from "../services/aiExercise";
import { analyzeExerciseSchema, createExerciseLogSchema } from "./schemas";

export const exercisesRouter = Router();

type ExerciseRow = {
  id: string;
  user_id: string;
  logged_at: string;
  exercise_type: string;
  duration_min: number;
  intensity: string;
  met: number;
  calories: number;
  note: string | null;
  source: string;
  visibility: string;
  ai_provider: string | null;
  ai_model: string | null;
  ai_route: string | null;
  created_at: string;
  updated_at: string;
};

function buildDayRange(dateString: string) {
  const start = new Date(`${dateString}T00:00:00+08:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function mapExerciseRow(row: ExerciseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    loggedAt: row.logged_at,
    exerciseType: row.exercise_type,
    durationMin: row.duration_min,
    intensity: row.intensity,
    met: row.met,
    calories: row.calories,
    note: row.note,
    source: row.source,
    visibility: row.visibility,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    aiRoute: row.ai_route,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getCurrentWeightKg(userId: string) {
  const weightLog = db
    .prepare("SELECT weight_kg FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 1")
    .get(userId) as { weight_kg: number } | undefined;
  if (weightLog?.weight_kg) {
    return weightLog.weight_kg;
  }

  const user = db.prepare("SELECT weight_kg FROM users WHERE id = ?").get(userId) as { weight_kg: number | null } | undefined;
  return user?.weight_kg ?? 65;
}

exercisesRouter.get("/", requireAuth, async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ message: "date 参数格式错误，应为 YYYY-MM-DD" });
    return;
  }

  const baseQuery =
    "SELECT * FROM exercise_logs WHERE user_id = ?" +
    (date ? " AND logged_at >= ? AND logged_at < ?" : "") +
    " ORDER BY logged_at DESC";
  const rows = date
    ? (db.prepare(baseQuery).all(req.user!.id, buildDayRange(date).start, buildDayRange(date).end) as ExerciseRow[])
    : (db.prepare(baseQuery).all(req.user!.id) as ExerciseRow[]);
  const exercises = rows.map((row) => mapExerciseRow(row));
  const summary = exercises.reduce(
    (acc, item) => {
      acc.calories += Number(item.calories ?? 0);
      acc.durationMin += Number(item.durationMin ?? 0);
      return acc;
    },
    { calories: 0, durationMin: 0 },
  );

  res.json({ exercises, summary });
});

exercisesRouter.post("/analyze", requireAuth, async (req, res) => {
  const parsed = analyzeExerciseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "运动描述不合法" });
    return;
  }

  try {
    const weightKg = getCurrentWeightKg(req.user!.id);
    const analysis = await analyzeExerciseText(parsed.data.description, weightKg);
    res.json({ analysis, weightKg });
  } catch (error) {
    console.error("analyze-exercise failed:", error);
    res.status(502).json({ message: error instanceof Error ? `运动识别失败：${error.message}` : "运动识别失败" });
  }
});

exercisesRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createExerciseLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "运动记录参数不合法" });
    return;
  }

  const data = parsed.data;
  const id = createId();
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : now;
  const weightKg = getCurrentWeightKg(req.user!.id);
  const calories = data.calories > 0 ? data.calories : estimateExerciseCalories(data.met, weightKg, data.durationMin);

  db.prepare(
    `INSERT INTO exercise_logs (
      id, user_id, logged_at, exercise_type, duration_min, intensity, met, calories,
      note, source, visibility, ai_provider, ai_model, ai_route, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.user!.id,
    loggedAt,
    data.exerciseType,
    data.durationMin,
    data.intensity,
    data.met,
    calories,
    data.note ?? null,
    data.source,
    data.visibility,
    data.aiProvider ?? null,
    data.aiModel ?? null,
    data.aiRoute ?? null,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM exercise_logs WHERE id = ?").get(id) as ExerciseRow;
  res.status(201).json({ exercise: mapExerciseRow(row) });
});

exercisesRouter.put("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const parsed = createExerciseLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "运动记录参数不合法" });
    return;
  }

  const existing = db
    .prepare("SELECT id, logged_at, ai_provider, ai_model, ai_route FROM exercise_logs WHERE id = ? AND user_id = ?")
    .get(id, req.user!.id) as
    | { id: string; logged_at: string; ai_provider: string | null; ai_model: string | null; ai_route: string | null }
    | undefined;
  if (!existing) {
    res.status(404).json({ message: "运动记录不存在" });
    return;
  }

  const data = parsed.data;
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : existing.logged_at;
  db.prepare(
    `UPDATE exercise_logs
     SET logged_at = ?, exercise_type = ?, duration_min = ?, intensity = ?, met = ?, calories = ?,
         note = ?, source = ?, visibility = ?, ai_provider = ?, ai_model = ?, ai_route = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    loggedAt,
    data.exerciseType,
    data.durationMin,
    data.intensity,
    data.met,
    data.calories,
    data.note ?? null,
    data.source,
    data.visibility,
    data.aiProvider ?? existing.ai_provider ?? null,
    data.aiModel ?? existing.ai_model ?? null,
    data.aiRoute ?? existing.ai_route ?? null,
    now,
    id,
    req.user!.id,
  );

  const row = db.prepare("SELECT * FROM exercise_logs WHERE id = ?").get(id) as ExerciseRow;
  res.json({ exercise: mapExerciseRow(row) });
});

exercisesRouter.delete("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const existing = db
    .prepare("SELECT id FROM exercise_logs WHERE id = ? AND user_id = ?")
    .get(id, req.user!.id) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ message: "运动记录不存在" });
    return;
  }

  db.prepare("DELETE FROM exercise_logs WHERE id = ? AND user_id = ?").run(id, req.user!.id);
  res.json({ success: true });
});
