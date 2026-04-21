import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { createGroupSchema, shareGroupLogSchema } from "./schemas";

export const groupsRouter = Router();

function isMember(groupId: string, userId: string) {
  const row = db
    .prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`)
    .get(groupId, userId) as { id: string } | undefined;
  return !!row;
}

groupsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "群组参数不合法" });
    return;
  }

  const now = nowIso();
  const groupId = createId();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO groups_data (id, name, description, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(groupId, parsed.data.name, parsed.data.description ?? null, req.user!.id, now, now);

    db.prepare(
      `INSERT INTO group_members (id, group_id, user_id, role, created_at)
       VALUES (?, ?, ?, 'OWNER', ?)`,
    ).run(createId(), groupId, req.user!.id, now);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const group = db.prepare(`SELECT * FROM groups_data WHERE id = ?`).get(groupId) as any;
  const members = db.prepare(`SELECT * FROM group_members WHERE group_id = ?`).all(groupId) as any[];

  res.status(201).json({ group: { ...group, members } });
});

groupsRouter.get("/my", requireAuth, async (req, res) => {
  const rows = db
    .prepare(
      `SELECT gm.id AS membership_id, gm.role, gm.created_at AS membership_created_at,
              g.id AS group_id, g.name, g.description, g.owner_id, g.created_at, g.updated_at,
              (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count,
              (SELECT COUNT(*) FROM group_posts gp2 WHERE gp2.group_id = g.id) AS post_count
       FROM group_members gm
       JOIN groups_data g ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY gm.created_at DESC`,
    )
    .all(req.user!.id) as any[];

  const memberships = rows.map((row) => ({
    id: row.membership_id,
    role: row.role,
    createdAt: row.membership_created_at,
    group: {
      id: row.group_id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _count: {
        members: Number(row.member_count),
        posts: Number(row.post_count),
      },
    },
  }));

  res.json({ memberships });
});

groupsRouter.post("/:groupId/join", requireAuth, async (req, res) => {
  const groupId = String(req.params.groupId);
  const group = db.prepare(`SELECT id FROM groups_data WHERE id = ?`).get(groupId) as
    | { id: string }
    | undefined;

  if (!group) {
    res.status(404).json({ message: "群组不存在" });
    return;
  }

  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO group_members (id, group_id, user_id, role, created_at)
     VALUES (?, ?, ?, 'MEMBER', ?)`,
  ).run(createId(), groupId, req.user!.id, now);

  const membership = db
    .prepare(`SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`)
    .get(groupId, req.user!.id);

  res.json({ membership });
});

groupsRouter.post("/:groupId/share-log", requireAuth, async (req, res) => {
  const groupId = String(req.params.groupId);
  const parsed = shareGroupLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "分享参数不合法" });
    return;
  }

  if (!isMember(groupId, req.user!.id)) {
    res.status(403).json({ message: "请先加入该群组" });
    return;
  }

  const log = db.prepare(`SELECT * FROM food_logs WHERE id = ?`).get(parsed.data.foodLogId) as
    | { id: string; user_id: string }
    | undefined;

  if (!log || log.user_id !== req.user!.id) {
    res.status(404).json({ message: "饮食记录不存在" });
    return;
  }

  const postId = createId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO group_posts (id, group_id, author_id, food_log_id, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(postId, groupId, req.user!.id, parsed.data.foodLogId, parsed.data.message ?? null, now);

  const post = db
    .prepare(
      `SELECT gp.id, gp.group_id, gp.author_id, gp.food_log_id, gp.message, gp.created_at,
              u.display_name AS author_display_name,
              fl.calories, fl.protein_gram, fl.carbs_gram, fl.fat_gram, fl.logged_at
       FROM group_posts gp
       JOIN users u ON u.id = gp.author_id
       JOIN food_logs fl ON fl.id = gp.food_log_id
       WHERE gp.id = ?`,
    )
    .get(postId) as any;

  res.status(201).json({
    post: {
      id: post.id,
      groupId: post.group_id,
      authorId: post.author_id,
      foodLogId: post.food_log_id,
      message: post.message,
      createdAt: post.created_at,
      author: {
        id: post.author_id,
        displayName: post.author_display_name,
      },
      foodLog: {
        id: post.food_log_id,
        loggedAt: post.logged_at,
        calories: post.calories,
        proteinGram: post.protein_gram,
        carbsGram: post.carbs_gram,
        fatGram: post.fat_gram,
      },
    },
  });
});

groupsRouter.get("/:groupId/feed", requireAuth, async (req, res) => {
  const groupId = String(req.params.groupId);
  if (!isMember(groupId, req.user!.id)) {
    res.status(403).json({ message: "请先加入该群组" });
    return;
  }

  const posts = db
    .prepare(
      `SELECT gp.id, gp.group_id, gp.author_id, gp.food_log_id, gp.message, gp.created_at,
              u.display_name AS author_display_name,
              fl.logged_at, fl.meal_type, fl.note, fl.calories, fl.protein_gram, fl.carbs_gram, fl.fat_gram
       FROM group_posts gp
       JOIN users u ON u.id = gp.author_id
       JOIN food_logs fl ON fl.id = gp.food_log_id
       WHERE gp.group_id = ?
       ORDER BY gp.created_at DESC
       LIMIT 100`,
    )
    .all(groupId) as any[];

  res.json({
    posts: posts.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      authorId: row.author_id,
      foodLogId: row.food_log_id,
      message: row.message,
      createdAt: row.created_at,
      author: {
        id: row.author_id,
        displayName: row.author_display_name,
      },
      foodLog: {
        id: row.food_log_id,
        loggedAt: row.logged_at,
        mealType: row.meal_type,
        note: row.note,
        calories: row.calories,
        proteinGram: row.protein_gram,
        carbsGram: row.carbs_gram,
        fatGram: row.fat_gram,
      },
    })),
  });
});

