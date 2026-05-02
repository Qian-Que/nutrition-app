import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { createLogSchema } from "./schemas";

export const logsRouter = Router();

type LogRow = {
  id: string;
  user_id: string;
  logged_at: string;
  meal_type: string;
  note: string | null;
  image_uri: string | null;
  source: string;
  visibility: string;
  calories: number;
  protein_gram: number;
  carbs_gram: number;
  fat_gram: number;
  fiber_gram: number | null;
  sugar_gram: number | null;
  sodium_mg: number | null;
  nutrients_json: string | null;
  items_json: string | null;
  created_at: string;
  updated_at: string;
};

function buildDayRange(dateString: string) {
  const start = new Date(`${dateString}T00:00:00+08:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function buildMonthRange(monthString: string) {
  const [yearRaw, monthRaw] = monthString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`);
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = new Date(`${endYear}-${String(endMonth).padStart(2, "0")}-01T00:00:00+08:00`);
  return { start: start.toISOString(), end: end.toISOString() };
}

function mapLogRow(row: LogRow) {
  const parseMaybeJson = (value: string | null) => {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  return {
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
    nutrients: parseMaybeJson(row.nutrients_json),
    items: parseMaybeJson(row.items_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

logsRouter.get("/", requireAuth, async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;

  const baseQuery =
    "SELECT * FROM food_logs WHERE user_id = ?" +
    (date ? " AND logged_at >= ? AND logged_at < ?" : "") +
    " ORDER BY logged_at DESC";

  const rows = date
    ? (db.prepare(baseQuery).all(req.user!.id, buildDayRange(date).start, buildDayRange(date).end) as LogRow[])
    : (db.prepare(baseQuery).all(req.user!.id) as LogRow[]);

  const logs = rows.map((row) => mapLogRow(row));

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

logsRouter.get("/calendar", requireAuth, async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : "";

  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ message: "month 参数格式错误，应为 YYYY-MM" });
    return;
  }

  const { start, end } = buildMonthRange(month);

  const rows = db
    .prepare(
      `SELECT
        date(logged_at, '+8 hours') AS date,
        COUNT(*) AS count,
        SUM(calories) AS calories,
        SUM(protein_gram) AS protein_gram,
        SUM(carbs_gram) AS carbs_gram,
        SUM(fat_gram) AS fat_gram
      FROM food_logs
      WHERE user_id = ? AND logged_at >= ? AND logged_at < ?
      GROUP BY date(logged_at, '+8 hours')
      ORDER BY date ASC`,
    )
    .all(req.user!.id, start, end) as Array<{
    date: string;
    count: number;
    calories: number | null;
    protein_gram: number | null;
    carbs_gram: number | null;
    fat_gram: number | null;
  }>;

  const days = rows.map((row) => ({
    date: row.date,
    count: Number(row.count ?? 0),
    calories: Number(row.calories ?? 0),
    proteinGram: Number(row.protein_gram ?? 0),
    carbsGram: Number(row.carbs_gram ?? 0),
    fatGram: Number(row.fat_gram ?? 0),
  }));

  res.json({ month, days });
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
      nutrients_json, items_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    data.nutrients ? JSON.stringify(data.nutrients) : null,
    data.items ? JSON.stringify(data.items) : null,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as LogRow;

  res.status(201).json({ log: mapLogRow(row) });
});

logsRouter.put("/:id", requireAuth, async (req, res) => {
  const logId = String(req.params.id);
  const parsed = createLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "饮食记录参数不合法" });
    return;
  }

  const existing = db
    .prepare("SELECT id, logged_at FROM food_logs WHERE id = ? AND user_id = ?")
    .get(logId, req.user!.id) as { id: string; logged_at: string } | undefined;

  if (!existing) {
    res.status(404).json({ message: "饮食记录不存在" });
    return;
  }

  const data = parsed.data;
  const now = nowIso();
  const loggedAt = data.loggedAt ? new Date(data.loggedAt).toISOString() : existing.logged_at;

  db.prepare(
    `UPDATE food_logs
     SET logged_at = ?, meal_type = ?, note = ?, image_uri = ?, source = ?, visibility = ?,
         calories = ?, protein_gram = ?, carbs_gram = ?, fat_gram = ?, fiber_gram = ?, sugar_gram = ?, sodium_mg = ?,
         nutrients_json = ?, items_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
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
    data.nutrients ? JSON.stringify(data.nutrients) : null,
    data.items ? JSON.stringify(data.items) : null,
    now,
    logId,
    req.user!.id,
  );

  const row = db
    .prepare("SELECT * FROM food_logs WHERE id = ? AND user_id = ?")
    .get(logId, req.user!.id) as LogRow;

  res.json({ log: mapLogRow(row) });
});

logsRouter.delete("/:id", requireAuth, async (req, res) => {
  const logId = String(req.params.id);
  const existing = db
    .prepare("SELECT id FROM food_logs WHERE id = ? AND user_id = ?")
    .get(logId, req.user!.id) as { id: string } | undefined;

  if (!existing) {
    res.status(404).json({ message: "饮食记录不存在" });
    return;
  }

  db.prepare("DELETE FROM food_logs WHERE id = ? AND user_id = ?").run(logId, req.user!.id);

  res.json({ success: true });
});
