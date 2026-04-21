import { Router } from "express";

import { db, nowIso } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { calculateTargets } from "../utils/targets";
import { updateTargetsSchema } from "./schemas";

export const profileRouter = Router();

const getProfileStmt = db.prepare(
  `SELECT id, display_name, age, sex, height_cm, weight_kg, activity_level, goal,
          target_calories, target_protein_gram, target_carbs_gram, target_fat_gram
   FROM users WHERE id = ?`,
);

const updateProfileStmt = db.prepare(
  `UPDATE users
   SET age = ?, sex = ?, height_cm = ?, weight_kg = ?, activity_level = ?, goal = ?,
       target_calories = ?, target_protein_gram = ?, target_carbs_gram = ?, target_fat_gram = ?,
       updated_at = ?
   WHERE id = ?`,
);

profileRouter.get("/targets", requireAuth, async (req, res) => {
  const row = getProfileStmt.get(req.user!.id) as
    | {
        id: string;
        display_name: string;
        age: number | null;
        sex: string | null;
        height_cm: number | null;
        weight_kg: number | null;
        activity_level: string | null;
        goal: string | null;
        target_calories: number | null;
        target_protein_gram: number | null;
        target_carbs_gram: number | null;
        target_fat_gram: number | null;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ message: "用户不存在" });
    return;
  }

  res.json({
    profile: {
      id: row.id,
      displayName: row.display_name,
      age: row.age,
      sex: row.sex,
      heightCm: row.height_cm,
      weightKg: row.weight_kg,
      activityLevel: row.activity_level,
      goal: row.goal,
      targetCalories: row.target_calories,
      targetProteinGram: row.target_protein_gram,
      targetCarbsGram: row.target_carbs_gram,
      targetFatGram: row.target_fat_gram,
    },
  });
});

profileRouter.put("/targets", requireAuth, async (req, res) => {
  const parsed = updateTargetsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? "目标参数不合法" });
    return;
  }

  const input = parsed.data;
  const generatedTargets = calculateTargets({
    age: input.age,
    sex: input.sex,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    activityLevel: input.activityLevel,
    goal: input.goal,
  });

  const finalTargets = {
    targetCalories: input.manualTargets?.targetCalories ?? generatedTargets.targetCalories,
    targetProteinGram: input.manualTargets?.targetProteinGram ?? generatedTargets.targetProteinGram,
    targetCarbsGram: input.manualTargets?.targetCarbsGram ?? generatedTargets.targetCarbsGram,
    targetFatGram: input.manualTargets?.targetFatGram ?? generatedTargets.targetFatGram,
  };

  updateProfileStmt.run(
    input.age,
    input.sex,
    input.heightCm,
    input.weightKg,
    input.activityLevel,
    input.goal,
    finalTargets.targetCalories,
    finalTargets.targetProteinGram,
    finalTargets.targetCarbsGram,
    finalTargets.targetFatGram,
    nowIso(),
    req.user!.id,
  );

  const updated = getProfileStmt.get(req.user!.id) as {
    id: string;
    display_name: string;
    age: number | null;
    sex: string | null;
    height_cm: number | null;
    weight_kg: number | null;
    activity_level: string | null;
    goal: string | null;
    target_calories: number | null;
    target_protein_gram: number | null;
    target_carbs_gram: number | null;
    target_fat_gram: number | null;
  };

  res.json({
    user: {
      id: updated.id,
      displayName: updated.display_name,
      age: updated.age,
      sex: updated.sex,
      heightCm: updated.height_cm,
      weightKg: updated.weight_kg,
      activityLevel: updated.activity_level,
      goal: updated.goal,
      targetCalories: updated.target_calories,
      targetProteinGram: updated.target_protein_gram,
      targetCarbsGram: updated.target_carbs_gram,
      targetFatGram: updated.target_fat_gram,
    },
    generatedTargets,
    finalTargets,
  });
});

