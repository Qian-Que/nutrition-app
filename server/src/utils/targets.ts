export type Sex = "MALE" | "FEMALE" | "OTHER";
export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export type Goal = "LOSE_WEIGHT" | "MAINTAIN" | "GAIN_MUSCLE";

const activityMultiplier: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

const goalDelta: Record<Goal, number> = {
  LOSE_WEIGHT: -400,
  MAINTAIN: 0,
  GAIN_MUSCLE: 300,
};

const proteinPerKg: Record<Goal, number> = {
  LOSE_WEIGHT: 1.9,
  MAINTAIN: 1.6,
  GAIN_MUSCLE: 2.0,
};

const fatPerKg = 0.8;

export type TargetInput = {
  age: number;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
};

function getBmr(input: TargetInput): number {
  const { weightKg, heightCm, age, sex } = input;

  if (sex === "MALE") {
    return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  }
  if (sex === "FEMALE") {
    return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  }

  const maleBmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  const femaleBmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  return (maleBmr + femaleBmr) / 2;
}

export function calculateTargets(input: TargetInput) {
  const bmr = getBmr(input);
  const tdee = bmr * activityMultiplier[input.activityLevel];
  const targetCalories = Math.max(1200, Math.round(tdee + goalDelta[input.goal]));

  const targetProteinGram = Number((input.weightKg * proteinPerKg[input.goal]).toFixed(1));
  const targetFatGram = Number((input.weightKg * fatPerKg).toFixed(1));

  const proteinCalories = targetProteinGram * 4;
  const fatCalories = targetFatGram * 9;
  const remainingCalories = Math.max(0, targetCalories - proteinCalories - fatCalories);
  const targetCarbsGram = Number((remainingCalories / 4).toFixed(1));

  return {
    targetCalories,
    targetProteinGram,
    targetCarbsGram,
    targetFatGram,
  };
}

