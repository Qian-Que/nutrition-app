import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { config } from "../config";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  displayName: string;
};

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
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      displayName: decoded.displayName,
    };
    next();
  } catch {
    res.status(401).json({ message: "登录凭证无效或已过期，请重新登录" });
  }
}

