import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import dotenv from "dotenv";

dotenv.config();

const dbPath = process.env.SQLITE_PATH ?? path.resolve(process.cwd(), "data", "nutrition.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  age INTEGER,
  sex TEXT,
  height_cm REAL,
  weight_kg REAL,
  activity_level TEXT,
  goal TEXT DEFAULT 'MAINTAIN',
  target_calories INTEGER,
  target_protein_gram REAL,
  target_carbs_gram REAL,
  target_fat_gram REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  note TEXT,
  image_uri TEXT,
  source TEXT NOT NULL,
  visibility TEXT NOT NULL,
  calories REAL NOT NULL,
  protein_gram REAL NOT NULL,
  carbs_gram REAL NOT NULL,
  fat_gram REAL NOT NULL,
  fiber_gram REAL,
  sugar_gram REAL,
  sodium_mg REAL,
  items_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_logged_at ON food_logs (user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (requester_id, receiver_id),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_a_id, user_b_id),
  FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groups_data (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups_data(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_posts (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  food_log_id TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES groups_data(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (food_log_id) REFERENCES food_logs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_group_posts_group_created ON group_posts (group_id, created_at DESC);
`);

export function createId() {
  return randomUUID().replace(/-/g, "");
}

export function nowIso() {
  return new Date().toISOString();
}

