import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { config } from "../config";
import { db, nowIso } from "../lib/db";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  displayName: string;
};

type DbUserLite = {
  id: string;
  email: string;
  display_name: string;
};

const findUserByIdStmt = db.prepare("SELECT id, email, display_name FROM users WHERE id = ?");
const findUserByEmailStmt = db.prepare("SELECT id, email, display_name FROM users WHERE email = ?");
const insertRecoveredUserStmt = db.prepare(
  `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

function ensureUserExistsFromToken(payload: AuthTokenPayload) {
  const byId = findUserByIdStmt.get(payload.sub) as DbUserLite | undefined;
  if (byId) {
    return {
      id: byId.id,
      email: byId.email,
      displayName: byId.display_name,
    };
  }

  const byEmail = findUserByEmailStmt.get(payload.email) as DbUserLite | undefined;
  if (byEmail) {
    return {
      id: byEmail.id,
      email: byEmail.email,
      displayName: byEmail.display_name,
    };
  }

  const now = nowIso();
  insertRecoveredUserStmt.run(
    payload.sub,
    payload.email,
    "__RECOVERED_FROM_TOKEN__",
    payload.displayName,
    now,
    now,
  );

  return {
    id: payload.sub,
    email: payload.email,
    displayName: payload.displayName,
  };
}

export function createToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "30d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ message: "缺少登录凭证，请重新登录" });
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
    const recoveredUser = ensureUserExistsFromToken(decoded);

    req.user = {
      id: recoveredUser.id,
      email: recoveredUser.email,
      displayName: recoveredUser.displayName,
    };
    next();
  } catch {
    res.status(401).json({ message: "登录凭证无效或已过期，请重新登录" });
  }
}
