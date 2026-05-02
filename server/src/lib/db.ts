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
  target_weight_kg REAL,
  weekly_weight_change_kg REAL,
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
  nutrients_json TEXT,
  items_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_logged_at ON food_logs (user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  exercise_type TEXT NOT NULL,
  duration_min REAL NOT NULL,
  intensity TEXT NOT NULL,
  met REAL NOT NULL,
  calories REAL NOT NULL,
  note TEXT,
  source TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_logged_at ON exercise_logs (user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS weight_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_weight_logs_user_logged_at ON weight_logs (user_id, logged_at DESC);

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

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_created ON password_reset_codes (user_id, created_at DESC);
`);

function getTableColumns(tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function ensureColumn(tableName: string, columnName: string, columnDefinition: string) {
  const columns = getTableColumns(tableName);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

ensureColumn("food_logs", "fiber_gram", "fiber_gram REAL");
ensureColumn("food_logs", "sugar_gram", "sugar_gram REAL");
ensureColumn("food_logs", "sodium_mg", "sodium_mg REAL");
ensureColumn("food_logs", "items_json", "items_json TEXT");
ensureColumn("food_logs", "nutrients_json", "nutrients_json TEXT");
ensureColumn("users", "target_weight_kg", "target_weight_kg REAL");
ensureColumn("users", "weekly_weight_change_kg", "weekly_weight_change_kg REAL");

export function createId() {
  return randomUUID().replace(/-/g, "");
}

export function nowIso() {
  return new Date().toISOString();
}

