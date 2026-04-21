import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { createLogSchema } from "./schemas";

export const logsRouter = Router();

function buildDayRange(dateString: string) {
  const start = new Date(`${dateString}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

logsRouter.get("/", requireAuth, async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;

  const baseQuery =
    "SELECT * FROM food_logs WHERE user_id = ?" +
    (date ? " AND logged_at >= ? AND logged_at < ?" : "") +
    " ORDER BY logged_at DESC";

  const rows = date
    ? (db.prepare(baseQuery).all(req.user!.id, buildDayRange(date).start, buildDayRange(date).end) as any[])
    : (db.prepare(baseQuery).all(req.user!.id) as any[]);

  const logs = rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    loggedAt: row.logged_at,
    mealType: row.meal_type,
    note: row.note,
    imageUri: row.image_uri,
    source: row.source,
    visibility: row.visibility,
    calories: row.calories,
    proteinGram: row.protein_gram,
    carbsGram: row.carbs_gram,
    fatGram: row.fat_gram,
    fiberGram: row.fiber_gram,
    sugarGram: row.sugar_gram,
    sodiumMg: row.sodium_mg,
    items: row.items_json ? JSON.parse(row.items_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const summary = logs.reduce(
    (acc, item) => {
      acc.calories += Number(item.calories);
      acc.proteinGram += Number(item.proteinGram);
      acc.carbsGram += Number(item.carbsGram);
      acc.fatGram += Number(item.fatGram);
      acc.fiberGram += Number(item.fiberGram ?? 0);
      return acc;
    },
    { calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 },
  );

  res.json({ logs, summary });
});

logsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "饮食记录参数不合法" });
    return;
  }

  const data = parsed.data;
  const id = createId();
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : now;

  db.prepare(
    `INSERT INTO food_logs (
      id, user_id, logged_at, meal_type, note, image_uri, source, visibility,
      calories, protein_gram, carbs_gram, fat_gram, fiber_gram, sugar_gram, sodium_mg,
      items_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.user!.id,
    loggedAt,
    data.mealType,
    data.note ?? null,
    data.imageUri ?? null,
    data.source,
    data.visibility,
    data.calories,
    data.proteinGram,
    data.carbsGram,
    data.fatGram,
    data.fiberGram ?? null,
    data.sugarGram ?? null,
    data.sodiumMg ?? null,
    data.items ? JSON.stringify(data.items) : null,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as any;

  res.status(201).json({
    log: {
      id: row.id,
      userId: row.user_id,
      loggedAt: row.logged_at,
      mealType: row.meal_type,
      note: row.note,
      imageUri: row.image_uri,
      source: row.source,
      visibility: row.visibility,
      calories: row.calories,
      proteinGram: row.protein_gram,
      carbsGram: row.carbs_gram,
      fatGram: row.fat_gram,
      fiberGram: row.fiber_gram,
      sugarGram: row.sugar_gram,
      sodiumMg: row.sodium_mg,
      items: row.items_json ? JSON.parse(row.items_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

