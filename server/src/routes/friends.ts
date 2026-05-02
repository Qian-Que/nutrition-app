import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { normalizeFriendPair } from "../utils/friendship";
import { respondFriendRequestSchema, sendFriendRequestSchema } from "./schemas";

export const friendsRouter = Router();

type FriendLogRow = {
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

function mapFriendLogRow(row: FriendLogRow) {
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

function withTransaction(fn: () => void) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

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

function ensureFriendAccess(userId: string, friendId: string) {
  const isFriend = db
    .prepare(
      `SELECT id FROM friendships
       WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)`,
    )
    .get(userId, friendId, friendId, userId) as { id: string } | undefined;

  return Boolean(isFriend);
}

friendsRouter.get("/", requireAuth, async (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.display_name
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a_id = ? THEN f.user_b_id ELSE f.user_a_id END
       WHERE f.user_a_id = ? OR f.user_b_id = ?
       ORDER BY u.display_name ASC`,
    )
    .all(req.user!.id, req.user!.id, req.user!.id) as any[];

  const friends = rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  }));

  res.json({ friends });
});

friendsRouter.get("/:friendId/profile", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const friendId = String(req.params.friendId);

  if (!ensureFriendAccess(userId, friendId)) {
    res.status(403).json({ message: "仅可查看好友详情" });
    return;
  }

  const friend = db
    .prepare(
      `SELECT id, email, display_name, age, sex, activity_level, goal,
              target_calories, target_protein_gram, target_carbs_gram, target_fat_gram
       FROM users WHERE id = ?`,
    )
    .get(friendId) as
    | {
        id: string;
        email: string;
        display_name: string;
        age: number | null;
        sex: string | null;
        activity_level: string | null;
        goal: string | null;
        target_calories: number | null;
        target_protein_gram: number | null;
        target_carbs_gram: number | null;
        target_fat_gram: number | null;
      }
    | undefined;

  if (!friend) {
    res.status(404).json({ message: "好友不存在" });
    return;
  }

  const parsedLimit = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
  const parsedDays = Number(req.query.days ?? 30);
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 90) : 30;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startIso = startDate.toISOString();

  const statsRow = db
    .prepare(
      `SELECT
         COUNT(*) AS log_count,
         COALESCE(SUM(calories), 0) AS calories_sum,
         COALESCE(SUM(protein_gram), 0) AS protein_sum,
         COALESCE(SUM(carbs_gram), 0) AS carbs_sum,
         COALESCE(SUM(fat_gram), 0) AS fat_sum
       FROM food_logs
       WHERE user_id = ?
         AND visibility IN ('FRIENDS', 'PUBLIC')
         AND logged_at >= ?`,
    )
    .get(friendId, startIso) as {
    log_count: number;
    calories_sum: number;
    protein_sum: number;
    carbs_sum: number;
    fat_sum: number;
  };

  const recentRows = db
    .prepare(
      `SELECT * FROM food_logs
       WHERE user_id = ? AND visibility IN ('FRIENDS', 'PUBLIC')
       ORDER BY logged_at DESC
       LIMIT ?`,
    )
    .all(friendId, limit) as FriendLogRow[];

  const recentLogs = recentRows.map((row) => mapFriendLogRow(row));

  res.json({
    friend: {
      id: friend.id,
      email: friend.email,
      displayName: friend.display_name,
      age: friend.age,
      sex: friend.sex,
      activityLevel: friend.activity_level,
      goal: friend.goal,
      targetCalories: friend.target_calories,
      targetProteinGram: friend.target_protein_gram,
      targetCarbsGram: friend.target_carbs_gram,
      targetFatGram: friend.target_fat_gram,
    },
    stats: {
      days,
      logCount: Number(statsRow.log_count ?? 0),
      caloriesSum: Number(statsRow.calories_sum ?? 0),
      proteinSum: Number(statsRow.protein_sum ?? 0),
      carbsSum: Number(statsRow.carbs_sum ?? 0),
      fatSum: Number(statsRow.fat_sum ?? 0),
    },
    recentLogs,
  });
});

friendsRouter.get("/:friendId/logs", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const friendId = String(req.params.friendId);

  if (!ensureFriendAccess(userId, friendId)) {
    res.status(403).json({ message: "仅可查看好友记录" });
    return;
  }

  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ message: "date 参数格式错误，应为 YYYY-MM-DD" });
    return;
  }

  const baseQuery =
    "SELECT * FROM food_logs WHERE user_id = ? AND visibility IN ('FRIENDS', 'PUBLIC')" +
    (date ? " AND logged_at >= ? AND logged_at < ?" : "") +
    " ORDER BY logged_at DESC";

  const rows = date
    ? (db.prepare(baseQuery).all(friendId, buildDayRange(date).start, buildDayRange(date).end) as FriendLogRow[])
    : (db.prepare(baseQuery).all(friendId) as FriendLogRow[]);

  const logs = rows.map((row) => mapFriendLogRow(row));

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

friendsRouter.get("/:friendId/calendar", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const friendId = String(req.params.friendId);

  if (!ensureFriendAccess(userId, friendId)) {
    res.status(403).json({ message: "仅可查看好友记录" });
    return;
  }

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
      WHERE user_id = ?
        AND visibility IN ('FRIENDS', 'PUBLIC')
        AND logged_at >= ? AND logged_at < ?
      GROUP BY date(logged_at, '+8 hours')
      ORDER BY date ASC`,
    )
    .all(friendId, start, end) as Array<{
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

friendsRouter.get("/requests", requireAuth, async (req, res) => {
  const incoming = db
    .prepare(
      `SELECT fr.id, fr.requester_id, fr.receiver_id, fr.status, fr.created_at,
              u.id AS requester_user_id, u.email AS requester_email, u.display_name AS requester_display_name
       FROM friend_requests fr
       JOIN users u ON u.id = fr.requester_id
       WHERE fr.receiver_id = ? AND fr.status = 'PENDING'
       ORDER BY fr.created_at DESC`,
    )
    .all(req.user!.id) as any[];

  const outgoing = db
    .prepare(
      `SELECT fr.id, fr.requester_id, fr.receiver_id, fr.status, fr.created_at,
              u.id AS receiver_user_id, u.email AS receiver_email, u.display_name AS receiver_display_name
       FROM friend_requests fr
       JOIN users u ON u.id = fr.receiver_id
       WHERE fr.requester_id = ? AND fr.status = 'PENDING'
       ORDER BY fr.created_at DESC`,
    )
    .all(req.user!.id) as any[];

  res.json({
    incoming: incoming.map((row) => ({
      id: row.id,
      requesterId: row.requester_id,
      receiverId: row.receiver_id,
      status: row.status,
      createdAt: row.created_at,
      requester: {
        id: row.requester_user_id,
        email: row.requester_email,
        displayName: row.requester_display_name,
      },
    })),
    outgoing: outgoing.map((row) => ({
      id: row.id,
      requesterId: row.requester_id,
      receiverId: row.receiver_id,
      status: row.status,
      createdAt: row.created_at,
      receiver: {
        id: row.receiver_user_id,
        email: row.receiver_email,
        displayName: row.receiver_display_name,
      },
    })),
  });
});

friendsRouter.post("/request", requireAuth, async (req, res) => {
  const parsed = sendFriendRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "好友请求参数不合法" });
    return;
  }

  const requesterId = req.user!.id;
  const receiver = db
    .prepare(`SELECT id, email, display_name FROM users WHERE email = ?`)
    .get(parsed.data.email) as { id: string; email: string; display_name: string } | undefined;

  if (!receiver) {
    res.status(404).json({ message: "目标用户不存在" });
    return;
  }

  if (receiver.id === requesterId) {
    res.status(400).json({ message: "不能添加自己为好友" });
    return;
  }

  const pair = normalizeFriendPair(requesterId, receiver.id);

  const existingFriendship = db
    .prepare(`SELECT id FROM friendships WHERE user_a_id = ? AND user_b_id = ?`)
    .get(pair.userAId, pair.userBId) as { id: string } | undefined;

  if (existingFriendship) {
    res.status(409).json({ message: "你们已经是好友了" });
    return;
  }

  const reversePending = db
    .prepare(
      `SELECT id, status FROM friend_requests WHERE requester_id = ? AND receiver_id = ?`,
    )
    .get(receiver.id, requesterId) as { id: string; status: string } | undefined;

  if (reversePending?.status === "PENDING") {
    withTransaction(() => {
      const now = nowIso();
      db.prepare(`UPDATE friend_requests SET status = 'ACCEPTED', updated_at = ? WHERE id = ?`).run(
        now,
        reversePending.id,
      );
      db.prepare(
        `INSERT OR IGNORE INTO friendships (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)`,
      ).run(createId(), pair.userAId, pair.userBId, now);
    });

    res.status(201).json({ message: "检测到对方已请求你，已自动互加好友", autoAccepted: true });
    return;
  }

  const existingRequest = db
    .prepare(`SELECT id, status FROM friend_requests WHERE requester_id = ? AND receiver_id = ?`)
    .get(requesterId, receiver.id) as { id: string; status: string } | undefined;

  const now = nowIso();
  if (existingRequest) {
    if (existingRequest.status === "PENDING") {
      res.status(409).json({ message: "好友请求已发送，请等待对方处理" });
      return;
    }

    db.prepare(`UPDATE friend_requests SET status = 'PENDING', updated_at = ? WHERE id = ?`).run(
      now,
      existingRequest.id,
    );

    const request = db.prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(existingRequest.id) as any;
    res.status(201).json({ request });
    return;
  }

  const requestId = createId();
  db.prepare(
    `INSERT INTO friend_requests (id, requester_id, receiver_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'PENDING', ?, ?)`,
  ).run(requestId, requesterId, receiver.id, now, now);

  const request = db.prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(requestId) as any;
  res.status(201).json({ request });
});

friendsRouter.post("/request/:requestId/respond", requireAuth, async (req, res) => {
  const parsed = respondFriendRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "处理请求参数不合法" });
    return;
  }

  const requestId = String(req.params.requestId);
  const request = db
    .prepare(`SELECT * FROM friend_requests WHERE id = ?`)
    .get(requestId) as
    | {
        id: string;
        requester_id: string;
        receiver_id: string;
        status: string;
      }
    | undefined;

  if (!request) {
    res.status(404).json({ message: "好友请求不存在" });
    return;
  }

  if (request.receiver_id !== req.user!.id) {
    res.status(403).json({ message: "你没有权限处理该请求" });
    return;
  }

  if (request.status !== "PENDING") {
    res.status(409).json({ message: "该请求已被处理" });
    return;
  }

  const now = nowIso();

  if (parsed.data.action === "reject") {
    db.prepare(`UPDATE friend_requests SET status = 'REJECTED', updated_at = ? WHERE id = ?`).run(
      now,
      request.id,
    );

    const updated = db.prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(request.id);
    res.json({ request: updated });
    return;
  }

  const pair = normalizeFriendPair(request.requester_id, request.receiver_id);

  withTransaction(() => {
    db.prepare(`UPDATE friend_requests SET status = 'ACCEPTED', updated_at = ? WHERE id = ?`).run(
      now,
      request.id,
    );
    db.prepare(
      `INSERT OR IGNORE INTO friendships (id, user_a_id, user_b_id, created_at) VALUES (?, ?, ?, ?)`,
    ).run(createId(), pair.userAId, pair.userBId, now);
  });

  const updated = db.prepare(`SELECT * FROM friend_requests WHERE id = ?`).get(request.id);
  res.json({ request: updated, becameFriends: true });
});

