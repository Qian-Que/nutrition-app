import { Router } from "express";

import { createId, db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { normalizeFriendPair } from "../utils/friendship";
import { respondFriendRequestSchema, sendFriendRequestSchema } from "./schemas";

export const friendsRouter = Router();

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

