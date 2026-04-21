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
  const sql = `
    SELECT fl.*, u.display_name
    FROM food_logs fl
    JOIN users u ON u.id = fl.user_id
    WHERE fl.user_id IN (${placeholders})
      AND fl.visibility IN ('FRIENDS', 'PUBLIC')
    ORDER BY fl.logged_at DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...friendIds, limit) as any[];

  res.json({
    feed: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      loggedAt: row.logged_at,
      mealType: row.meal_type,
      note: row.note,
      source: row.source,
      visibility: row.visibility,
      calories: row.calories,
      proteinGram: row.protein_gram,
      carbsGram: row.carbs_gram,
      fatGram: row.fat_gram,
      user: {
        id: row.user_id,
        displayName: row.display_name,
      },
    })),
  });
});

