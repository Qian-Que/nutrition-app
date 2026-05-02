import { z } from "zod";

export const sexValues = ["MALE", "FEMALE"] as const;
export const activityLevelValues = ["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"] as const;
export const goalValues = ["LOSE_WEIGHT", "MAINTAIN", "GAIN_MUSCLE"] as const;
export const mealTypeValues = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export const logSourceValues = ["MANUAL", "AI"] as const;
export const logVisibilityValues = ["PRIVATE", "FRIENDS", "PUBLIC"] as const;
export const exerciseIntensityValues = ["LOW", "MODERATE", "HIGH"] as const;

export const registerSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z
    .string()
    .min(8, "密码至少 8 位")
    .max(64, "密码最多 64 位"),
  displayName: z
    .string()
    .min(2, "昵称至少 2 个字符")
    .max(32, "昵称最多 32 个字符"),
});

export const loginSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z
    .string()
    .min(8, "密码至少 8 位")
    .max(64, "密码最多 64 位"),
});

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
});

export const forgotPasswordConfirmSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  code: z
    .string()
    .regex(/^\d{6}$/, "验证码必须是 6 位数字"),
  newPassword: z
    .string()
    .min(8, "密码至少 8 位")
    .max(64, "密码最多 64 位"),
});

export const updateTargetsSchema = z.object({
  age: z.int().min(10, "年龄不能小于 10").max(90, "年龄不能大于 90"),
  sex: z.enum(sexValues),
  heightCm: z.number().min(120, "身高不能低于 120cm").max(240, "身高不能高于 240cm"),
  weightKg: z.number().min(30, "体重不能低于 30kg").max(250, "体重不能高于 250kg"),
  targetWeightKg: z.number().min(30, "目标体重不能低于 30kg").max(250, "目标体重不能高于 250kg").optional(),
  weeklyWeightChangeKg: z.number().min(0, "每周变化不能小于 0kg").max(1, "建议每周变化不超过 1kg").optional(),
  activityLevel: z.enum(activityLevelValues),
  goal: z.enum(goalValues),
  manualTargets: z
    .object({
      targetCalories: z.number().int().min(1000, "目标热量至少 1000").max(6000, "目标热量最多 6000").optional(),
      targetProteinGram: z.number().min(20, "蛋白质目标至少 20g").max(400, "蛋白质目标最多 400g").optional(),
      targetCarbsGram: z.number().min(20, "碳水目标至少 20g").max(800, "碳水目标最多 800g").optional(),
      targetFatGram: z.number().min(10, "脂肪目标至少 10g").max(300, "脂肪目标最多 300g").optional(),
    })
    .optional(),
});

export const createLogSchema = z.object({
  loggedAt: z.iso.datetime().optional(),
  mealType: z.enum(mealTypeValues).default("SNACK"),
  note: z.string().max(300, "备注最多 300 字").optional(),
  imageUri: z.string().url("图片地址格式不正确").optional(),
  source: z.enum(logSourceValues).default("MANUAL"),
  visibility: z.enum(logVisibilityValues).default("PRIVATE"),
  calories: z.number().min(0, "热量不能小于 0"),
  proteinGram: z.number().min(0, "蛋白质不能小于 0"),
  carbsGram: z.number().min(0, "碳水不能小于 0"),
  fatGram: z.number().min(0, "脂肪不能小于 0"),
  fiberGram: z.number().min(0, "膳食纤维不能小于 0").optional(),
  sugarGram: z.number().min(0, "糖不能小于 0").optional(),
  sodiumMg: z.number().min(0, "钠不能小于 0").optional(),
  nutrients: z
    .object({
      sugarGram: z.number().min(0).optional(),
      addedSugarGram: z.number().min(0).optional(),
      sugarAlcoholGram: z.number().min(0).optional(),
      sodiumMg: z.number().min(0).optional(),
      potassiumMg: z.number().min(0).optional(),
      calciumMg: z.number().min(0).optional(),
      ironMg: z.number().min(0).optional(),
      cholesterolMg: z.number().min(0).optional(),
      saturatedFatGram: z.number().min(0).optional(),
      transFatGram: z.number().min(0).optional(),
      monounsaturatedFatGram: z.number().min(0).optional(),
      polyunsaturatedFatGram: z.number().min(0).optional(),
      vitaminAIU: z.number().min(0).optional(),
      vitaminCMg: z.number().min(0).optional(),
      vitaminDIU: z.number().min(0).optional(),
    })
    .optional(),
  items: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const createExerciseLogSchema = z.object({
  loggedAt: z.iso.datetime().optional(),
  exerciseType: z.string().min(1, "运动类型不能为空").max(60, "运动类型最多 60 字"),
  durationMin: z.number().min(1, "运动时长至少 1 分钟").max(600, "运动时长最多 600 分钟"),
  intensity: z.enum(exerciseIntensityValues).default("MODERATE"),
  met: z.number().min(1, "MET 至少为 1").max(20, "MET 不能超过 20"),
  calories: z.number().min(0, "运动热量不能小于 0").max(5000, "单次运动热量过高"),
  note: z.string().max(300, "备注最多 300 字").optional(),
  source: z.enum(logSourceValues).default("AI"),
  visibility: z.enum(logVisibilityValues).default("PRIVATE"),
});

export const analyzeExerciseSchema = z.object({
  description: z.string().min(1, "请提供运动描述").max(1000, "运动描述最多 1000 字"),
});

export const createWeightLogSchema = z.object({
  loggedAt: z.iso.datetime().optional(),
  weightKg: z.number().min(30, "体重不能低于 30kg").max(250, "体重不能高于 250kg"),
  note: z.string().max(300, "备注最多 300 字").optional(),
});

export const sendFriendRequestSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
});

export const respondFriendRequestSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

export const createGroupSchema = z.object({
  name: z
    .string()
    .min(2, "群组名称至少 2 个字符")
    .max(50, "群组名称最多 50 个字符"),
  description: z.string().max(300, "群组描述最多 300 字").optional(),
});

export const shareGroupLogSchema = z.object({
  foodLogId: z.string().min(5, "饮食记录 ID 不合法"),
  message: z.string().max(300, "附言最多 300 字").optional(),
});

