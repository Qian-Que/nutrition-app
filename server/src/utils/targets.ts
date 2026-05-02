export type Sex = "MALE" | "FEMALE";
export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export type Goal = "LOSE_WEIGHT" | "MAINTAIN" | "GAIN_MUSCLE";

const activityMultiplier: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
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
  targetWeightKg?: number;
  weeklyWeightChangeKg?: number;
  activityLevel: ActivityLevel;
  goal: Goal;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getBmr(input: TargetInput): number {
  const { weightKg, heightCm, age, sex } = input;

  if (sex === "FEMALE") {
    return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  }

  return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
}

function resolveDailyEnergyAdjustment(input: TargetInput) {
  const targetWeight = input.targetWeightKg;
  const rawRate = input.weeklyWeightChangeKg;

  if (!targetWeight || targetWeight <= 0 || !rawRate || rawRate <= 0) {
    if (input.goal === "LOSE_WEIGHT") {
      return { dailyCalories: -400, weeklyRateKg: 0.36, targetDate: null, note: "未设置目标体重，按温和减脂缺口估算。" };
    }
    if (input.goal === "GAIN_MUSCLE") {
      return { dailyCalories: 250, weeklyRateKg: 0.2, targetDate: null, note: "未设置目标体重，按轻微热量盈余估算。" };
    }
    return { dailyCalories: 0, weeklyRateKg: 0, targetDate: null, note: "维持目标不设置热量缺口。" };
  }

  const diffKg = targetWeight - input.weightKg;
  if (Math.abs(diffKg) < 0.2 || input.goal === "MAINTAIN") {
    return { dailyCalories: 0, weeklyRateKg: 0, targetDate: null, note: "当前体重接近目标，按维持热量计算。" };
  }

  const requestedRate = clamp(rawRate, 0.25, input.goal === "LOSE_WEIGHT" ? 1 : 0.5);
  const direction = diffKg < 0 ? -1 : 1;
  const dailyCalories = direction * ((requestedRate * 7700) / 7);
  const weeks = Math.ceil(Math.abs(diffKg) / requestedRate);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + weeks * 7);

  return {
    dailyCalories,
    weeklyRateKg: requestedRate,
    targetDate: targetDate.toISOString().slice(0, 10),
    note:
      direction < 0
        ? "按安全减重速度估算热量缺口，实际变化会受水分、训练和执行度影响。"
        : "按缓慢增重速度估算热量盈余，优先配合力量训练。",
  };
}

export function calculateTargets(input: TargetInput) {
  const bmr = getBmr(input);
  const tdee = bmr * activityMultiplier[input.activityLevel];
  const adjustment = resolveDailyEnergyAdjustment(input);
  const minCalories = input.sex === "FEMALE" ? 1200 : 1500;
  const maxDeficit = input.goal === "LOSE_WEIGHT" ? 770 : 500;
  const boundedAdjustment =
    adjustment.dailyCalories < 0
      ? Math.max(adjustment.dailyCalories, -maxDeficit)
      : Math.min(adjustment.dailyCalories, 500);
  const targetCalories = Math.max(minCalories, Math.round(tdee + boundedAdjustment));

  const targetProteinGram = Number((input.weightKg * proteinPerKg[input.goal]).toFixed(1));
  const minimumFatGram = input.weightKg * fatPerKg;
  const targetFatGram = Number(Math.max(minimumFatGram, (targetCalories * 0.22) / 9).toFixed(1));

  const proteinCalories = targetProteinGram * 4;
  const fatCalories = targetFatGram * 9;
  const remainingCalories = Math.max(80 * 4, targetCalories - proteinCalories - fatCalories);
  const targetCarbsGram = Number((remainingCalories / 4).toFixed(1));

  return {
    targetCalories,
    targetProteinGram,
    targetCarbsGram,
    targetFatGram,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetWeightKg: input.targetWeightKg ?? null,
    weeklyWeightChangeKg: adjustment.weeklyRateKg,
    targetDate: adjustment.targetDate,
    planNote: adjustment.note,
  };
}
