import { Router } from "express";

import { db } from "../lib/db";
import { requireAuth } from "../middleware/auth";

export const feedRouter = Router();

feedRouter.get("/friends", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const parsedLimit = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;

  const friendships = db
    .prepare(`SELECT user_a_id, user_b_id FROM friendships WHERE user_a_id = ? OR user_b_id = ?`)
    .all(userId, userId) as Array<{ user_a_id: string; user_b_id: string }>;

  const friendIds = friendships.map((f) => (f.user_a_id === userId ? f.user_b_id : f.user_a_id));

  if (friendIds.length === 0) {
    res.json({ feed: [] });
    return;
  }

  const placeholders = friendIds.map(() => "?").join(",");
  const foodSql = `
    SELECT fl.*, u.display_name
    FROM food_logs fl
    JOIN users u ON u.id = fl.user_id
    WHERE fl.user_id IN (${placeholders})
      AND fl.visibility IN ('FRIENDS', 'PUBLIC')
    ORDER BY fl.logged_at DESC
    LIMIT ?
  `;
  const exerciseSql = `
    SELECT el.*, u.display_name
    FROM exercise_logs el
    JOIN users u ON u.id = el.user_id
    WHERE el.user_id IN (${placeholders})
      AND el.visibility IN ('FRIENDS', 'PUBLIC')
    ORDER BY el.logged_at DESC
    LIMIT ?
  `;

  const foodRows = db.prepare(foodSql).all(...friendIds, limit) as any[];
  const exerciseRows = db.prepare(exerciseSql).all(...friendIds, limit) as any[];
  const feed = [
    ...foodRows.map((row) => ({
      kind: "food",
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
      items: row.items_json ? JSON.parse(row.items_json) : null,
      user: {
        id: row.user_id,
        displayName: row.display_name,
      },
    })),
    ...exerciseRows.map((row) => ({
      kind: "exercise",
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
      user: {
        id: row.user_id,
        displayName: row.display_name,
      },
    })),
  ]
    .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime())
    .slice(0, limit);

  res.json({
    feed,
  });
});

