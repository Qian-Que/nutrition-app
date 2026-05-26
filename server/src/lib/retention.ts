import { db } from "./db";

const RETENTION_DAYS = 60;

export function pruneOldTimeSeriesData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  db.exec("BEGIN");
  try {
    const groupPosts = db
      .prepare(
        `DELETE FROM group_posts
         WHERE food_log_id IN (SELECT id FROM food_logs WHERE logged_at < ?)`,
      )
      .run(cutoffIso);
    const foodLogs = db.prepare("DELETE FROM food_logs WHERE logged_at < ?").run(cutoffIso);
    const exerciseLogs = db.prepare("DELETE FROM exercise_logs WHERE logged_at < ?").run(cutoffIso);
    const weightLogs = db.prepare("DELETE FROM weight_logs WHERE logged_at < ?").run(cutoffIso);

    const result = {
      groupPosts: Number(groupPosts.changes),
      foodLogs: Number(foodLogs.changes),
      exerciseLogs: Number(exerciseLogs.changes),
      weightLogs: Number(weightLogs.changes),
    };
    db.exec("COMMIT");

    const total = result.groupPosts + result.foodLogs + result.exerciseLogs + result.weightLogs;
    if (total > 0) {
      console.log(
        `[retention] pruned ${total} old rows before ${cutoffIso} ` +
          `(food=${result.foodLogs}, exercise=${result.exerciseLogs}, weight=${result.weightLogs}, groupPosts=${result.groupPosts})`,
      );
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function startRetentionJob() {
  try {
    pruneOldTimeSeriesData();
  } catch (error) {
    console.error("[retention] initial prune failed:", error);
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    try {
      pruneOldTimeSeriesData();
    } catch (error) {
      console.error("[retention] scheduled prune failed:", error);
    }
  }, oneDayMs).unref();
}
