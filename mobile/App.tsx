import AsyncStorage from "@react-native-async-storage/async-storage";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer, useFocusEffect } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const AUTH_STORAGE_KEY = "nutrition_app_auth_v1";
const API_BASE_URL_STORAGE_KEY = "nutrition_app_api_base_url_v2";
const LEGACY_API_BASE_URL_STORAGE_KEY = "nutrition_app_api_base_url_v1";
const VISIBILITY_PREF_STORAGE_KEY = "nutrition_app_visibility_pref_v1";
const CLOUD_DEFAULT_API_BASE_URL = "https://strong-amazement-production-c91d.up.railway.app";
const APP_BUILD_LABEL = "2026-05-07-r14";
const parsedTimeoutMs = Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? 30000);
const API_REQUEST_TIMEOUT_MS = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0 ? parsedTimeoutMs : 30000;
const parsedAnalyzeTimeoutMs = Number(process.env.EXPO_PUBLIC_ANALYZE_TIMEOUT_MS ?? 140000);
const ANALYZE_REQUEST_TIMEOUT_MS =
  Number.isFinite(parsedAnalyzeTimeoutMs) && parsedAnalyzeTimeoutMs > 0 ? parsedAnalyzeTimeoutMs : 140000;

function normalizeBaseUrl(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function isLikelyLocalBaseUrl(value: string | null | undefined) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) {
    return false;
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return true;
    }
    if (/^10\./.test(hostname)) {
      return true;
    }
    if (/^192\.168\./.test(hostname)) {
      return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const DEFAULT_API_BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? CLOUD_DEFAULT_API_BASE_URL);
let runtimeApiBaseUrl = DEFAULT_API_BASE_URL;

const Tab = createBottomTabNavigator();

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

type AuthPayload = {
  token: string;
  user: AuthUser;
};

type MicroNutrients = {
  sugarGram?: number;
  addedSugarGram?: number;
  sugarAlcoholGram?: number;
  sodiumMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  cholesterolMg?: number;
  saturatedFatGram?: number;
  transFatGram?: number;
  monounsaturatedFatGram?: number;
  polyunsaturatedFatGram?: number;
  vitaminAIU?: number;
  vitaminCMg?: number;
  vitaminDIU?: number;
};

type NutritionAnalysis = {
  items: Array<{
    name: string;
    estimatedWeightGram?: number;
    calories: number;
    proteinGram: number;
    carbsGram: number;
    fatGram: number;
    fiberGram?: number;
  }>;
  totals: {
    calories: number;
    proteinGram: number;
    carbsGram: number;
    fatGram: number;
    fiberGram: number;
  } & Required<MicroNutrients>;
  confidence: number;
  notes: string;
  ai?: AIUsage | null;
};

type NutritionItem = NutritionAnalysis["items"][number];

type AIUsage = {
  provider?: string | null;
  model?: string | null;
  route?: string | null;
};

type AiConversationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageUri?: string | null;
  logId?: string;
};

type AiConversationDraft = {
  analysis: NutritionAnalysis;
  contextText: string;
  imageUri: string | null;
  imageBase64: string | null;
  imageMimeType: string;
};

type FoodLog = {
  id: string;
  loggedAt: string;
  mealType: MealType;
  source: "MANUAL" | "AI";
  visibility: Visibility;
  calories: number;
  proteinGram: number;
  carbsGram: number;
  fatGram: number;
  fiberGram?: number;
  sugarGram?: number;
  sodiumMg?: number;
  nutrients?: MicroNutrients | null;
  items?: unknown;
  note?: string;
  imageUri?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  aiRoute?: string | null;
};

type ExerciseIntensity = "LOW" | "MODERATE" | "HIGH";

type ExerciseLog = {
  id: string;
  loggedAt: string;
  exerciseType: string;
  durationMin: number;
  intensity: ExerciseIntensity | string;
  met: number;
  calories: number;
  note?: string | null;
  source: "MANUAL" | "AI";
  visibility: Visibility;
  aiProvider?: string | null;
  aiModel?: string | null;
  aiRoute?: string | null;
};

type ExerciseAnalysis = {
  exerciseType: string;
  durationMin: number;
  intensity: ExerciseIntensity;
  met: number;
  calories: number;
  confidence: number;
  notes: string;
  ai?: AIUsage | null;
};

type WeightLog = {
  id: string;
  loggedAt: string;
  weightKg: number;
  note?: string | null;
};

type CalendarDaySummary = {
  date: string;
  count: number;
  calories: number;
  proteinGram: number;
  carbsGram: number;
  fatGram: number;
};

type FriendItem = {
  id: string;
  email: string;
  displayName: string;
};

type SocialStackParamList = {
  SocialHome: undefined;
  FriendList: undefined;
  DynamicActions: undefined;
  FriendDetail: { friend: FriendItem };
};

const SocialStack = createNativeStackNavigator<SocialStackParamList>();

type GroupMembership = {
  id: string;
  role: GroupRole;
  group: {
    id: string;
    name: string;
    description: string | null;
    _count: {
      members: number;
      posts: number;
    };
  };
};

type SocialFilter =
  | { type: "ALL" }
  | { type: "FRIEND"; friendId: string }
  | { type: "GROUP"; groupId: string };

type IncomingFriendRequest = {
  id: string;
  requester: FriendItem;
};

type OutgoingFriendRequest = {
  id: string;
  receiver: FriendItem;
};

type GroupFeedPost = {
  id: string;
  message?: string | null;
  createdAt?: string;
  author?: {
    id: string;
    displayName: string;
  };
  foodLog?: {
    loggedAt: string;
    mealType: MealType | string;
    calories: number;
    proteinGram: number;
    carbsGram: number;
    fatGram: number;
    note?: string | null;
    items?: unknown;
  };
};

type SocialFeedItem = {
  id: string;
  userId: string;
  loggedAt: string;
  mealType: MealType | string;
  note?: string | null;
  items?: unknown;
  source: "MANUAL" | "AI" | string;
  visibility: Visibility | string;
  calories: number;
  proteinGram: number;
  carbsGram: number;
  fatGram: number;
  user: {
    id: string;
    displayName: string;
  };
};

type FriendDetailPayload = {
  friend: {
    id: string;
    email: string;
    displayName: string;
    age: number | null;
    sex: string | null;
    activityLevel: string | null;
    goal: string | null;
    targetCalories: number | null;
    targetProteinGram: number | null;
    targetCarbsGram: number | null;
    targetFatGram: number | null;
  };
  stats: {
    days: number;
    logCount: number;
    caloriesSum: number;
    proteinSum: number;
    carbsSum: number;
    fatSum: number;
  };
  recentLogs: FoodLog[];
};

type MealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";
type Sex = "MALE" | "FEMALE";
type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
type Goal = "LOSE_WEIGHT" | "MAINTAIN" | "GAIN_MUSCLE";
type GroupRole = "OWNER" | "ADMIN" | "MEMBER";
type AnalyzeMode = "IMAGE" | "TEXT";

type Option<T extends string> = {
  label: string;
  value: T;
};

const mealOptions: ReadonlyArray<Option<MealType>> = [
  { label: "早餐", value: "BREAKFAST" },
  { label: "午餐", value: "LUNCH" },
  { label: "晚餐", value: "DINNER" },
  { label: "加餐", value: "SNACK" },
];

const visibilityOptions: ReadonlyArray<Option<Visibility>> = [
  { label: "仅自己可见", value: "PRIVATE" },
  { label: "好友可见", value: "FRIENDS" },
  { label: "公开", value: "PUBLIC" },
];

const exerciseIntensityOptions: ReadonlyArray<Option<ExerciseIntensity>> = [
  { label: "低强度", value: "LOW" },
  { label: "中等强度", value: "MODERATE" },
  { label: "高强度", value: "HIGH" },
];

const sexOptions: ReadonlyArray<Option<Sex>> = [
  { label: "男", value: "MALE" },
  { label: "女", value: "FEMALE" },
];

const activityOptions: ReadonlyArray<Option<ActivityLevel>> = [
  { label: "久坐", value: "SEDENTARY" },
  { label: "轻度活动", value: "LIGHT" },
  { label: "中度活动", value: "MODERATE" },
  { label: "高度活动", value: "ACTIVE" },
  { label: "非常活跃", value: "VERY_ACTIVE" },
];

const goalOptions: ReadonlyArray<Option<Goal>> = [
  { label: "减脂", value: "LOSE_WEIGHT" },
  { label: "维持", value: "MAINTAIN" },
  { label: "增肌", value: "GAIN_MUSCLE" },
];

const roleLabelMap: Record<GroupRole, string> = {
  OWNER: "群主",
  ADMIN: "管理员",
  MEMBER: "成员",
};

class ApiRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

const analyzeModeOptions: ReadonlyArray<Option<AnalyzeMode>> = [
  { label: "图片识别", value: "IMAGE" },
  { label: "文字估算", value: "TEXT" },
];

function formatMealType(value: MealType | string) {
  const found = mealOptions.find((option) => option.value === value);
  return found?.label ?? value;
}

function formatVisibility(value: Visibility | string) {
  const found = visibilityOptions.find((option) => option.value === value);
  return found?.label ?? value;
}

function parseVisibility(value: string | null | undefined): Visibility | null {
  if (value === "PRIVATE" || value === "FRIENDS" || value === "PUBLIC") {
    return value;
  }
  return null;
}

function formatRole(value: GroupRole | string) {
  return roleLabelMap[value as GroupRole] ?? value;
}

function extractFoodNames(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (item && typeof item === "object" && "name" in item) {
        const name = (item as { name?: unknown }).name;
        return typeof name === "string" ? name.trim() : "";
      }
      return "";
    })
    .filter((name) => name.length > 0);
}

function summarizeFood(items: unknown, note?: string | null): string {
  const names = extractFoodNames(items);
  if (names.length > 0) {
    return names.join("、");
  }

  if (typeof note === "string" && note.trim().length > 0) {
    return note.trim();
  }

  return "未填写";
}

function summarizeFoodFromLog(log: FoodLog): string {
  return summarizeFood(log.items, log.note);
}

function createConversationMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatAiAnalysisText(analysis: NutritionAnalysis): string {
  const totals = analysis.totals;
  const itemsPreview = analysis.items
    .slice(0, 4)
    .map((item) => item.name)
    .join("?");
  const notes = analysis.notes?.trim();

  return [
    `??????? ${Math.round(safeNumber(totals.calories, 0))} ?????? ${safeFixed(totals.proteinGram, 1)}g??? ${safeFixed(totals.carbsGram, 1)}g??? ${safeFixed(totals.fatGram, 1)}g?`,
    itemsPreview ? `?????${itemsPreview}${analysis.items.length > 4 ? " ?" : ""}?` : "",
    notes ? `???${notes}` : "",
    "??????????????????????????????",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function toLogDate(loggedAt: string): string {
  const date = new Date(loggedAt);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(loggedAt)) {
    return loggedAt.slice(0, 10);
  }
  return loggedAt;
}

function summarizeLogs(logs: FoodLog[]) {
  return logs.reduce(
    (acc, item) => {
      acc.calories += Number(item.calories ?? 0);
      acc.proteinGram += Number(item.proteinGram ?? 0);
      acc.carbsGram += Number(item.carbsGram ?? 0);
      acc.fatGram += Number(item.fatGram ?? 0);
      acc.fiberGram += Number(item.fiberGram ?? 0);
      return acc;
    },
    { calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 },
  );
}

function buildMonthStatsFromLogs(logs: FoodLog[], month: string): Record<string, CalendarDaySummary> {
  const next: Record<string, CalendarDaySummary> = {};

  for (const log of logs) {
    const date = toLogDate(log.loggedAt);
    if (!date.startsWith(`${month}-`)) {
      continue;
    }

    const current = next[date] ?? {
      date,
      count: 0,
      calories: 0,
      proteinGram: 0,
      carbsGram: 0,
      fatGram: 0,
    };

    current.count += 1;
    current.calories += Number(log.calories ?? 0);
    current.proteinGram += Number(log.proteinGram ?? 0);
    current.carbsGram += Number(log.carbsGram ?? 0);
    current.fatGram += Number(log.fatGram ?? 0);

    next[date] = current;
  }

  return next;
}

function isEndpointNotFound(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const explicitlyMissingEndpoint =
    message.includes("接口不存在") ||
    message.includes("cannot get ") ||
    message.includes("route not found") ||
    message.includes("endpoint not found");

  if (!explicitlyMissingEndpoint) {
    return false;
  }

  if (error instanceof ApiRequestError && error.status !== 404) {
    return false;
  }

  return true;
}

function normalizeErrorMessage(error: unknown) {
  const fallback = "请求失败，请稍后重试。";
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.name === "AbortError" || error.message.includes("请求超时")) {
    return "请求超时，请检查网络后重试。若已使用云端接口，请检查 Railway 服务状态。";
  }
  if (error.message.includes("接口地址未配置")) {
    return "接口地址未配置，请先在登录页设置后端地址。";
  }
  if (error.message.includes("Network request failed")) {
    return "网络请求失败，请检查接口地址是否为可访问的 HTTPS 域名。若是本地调试，请检查同网连接、防火墙和 VPN。";
  }
  if (error.message.trim().length === 0) {
    return fallback;
  }
  return error.message;
}

function isTimeoutLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("超时") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborterror")
  );
}

function isNetworkLikeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    error.name === "AbortError" ||
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborterror") ||
    message.includes("请求超时")
  );
}

function estimateFromDescription(description: string, hasImage: boolean): NutritionAnalysis {
  const text = description.trim();
  const lc = text.toLowerCase();
  const isDrink = /豆浆|牛奶|奶|粥|汤|饮料|咖啡|茶|juice|milk|soup|drink/.test(text);
  const hasRice = /米饭|饭团|面|粉|饺|包子|馒头|饼|rice|noodle|bread/.test(text);
  const hasProtein = /鸡|牛|猪|鱼|虾|蛋|豆腐|肉|chicken|beef|fish|egg|tofu/.test(text);
  const hasOil = /油炸|炸鸡|肥肉|奶油|黄油|芝士|坚果|peanut|fried|oil/.test(text);
  const amountHintLarge = /大碗|一升|1l|1000ml|超大|两份|双份|加量/.test(lc);

  let calories = 260;
  let carbs = 28;
  let protein = 12;
  let fat = 9;
  let fiber = 3;

  if (isDrink) {
    calories = 180;
    carbs = 20;
    protein = 8;
    fat = 5;
    fiber = 1;
  }
  if (hasRice) {
    carbs += 24;
    calories += 110;
  }
  if (hasProtein) {
    protein += 14;
    calories += 90;
  }
  if (hasOil) {
    fat += 8;
    calories += 90;
  }
  if (hasImage) {
    calories += 40;
    carbs += 4;
    fat += 2;
  }
  if (amountHintLarge) {
    calories *= 1.45;
    carbs *= 1.4;
    protein *= 1.35;
    fat *= 1.35;
    fiber *= 1.3;
  }

  const itemName = text.length > 0 ? text.slice(0, 30) : "餐食估算";
  return normalizeClientAnalysis({
    items: [
      {
        name: itemName,
        calories,
        proteinGram: protein,
        carbsGram: carbs,
        fatGram: fat,
        fiberGram: fiber,
      },
    ],
    totals: {
      calories,
      proteinGram: protein,
      carbsGram: carbs,
      fatGram: fat,
      fiberGram: fiber,
    },
    confidence: 0.35,
    notes: "AI 接口超时，已按文字与上下文进行本地估算，建议后续手动微调。",
    ai: {
      provider: "local",
      model: "本地估算",
      route: "本地",
    },
  });
}

function isUnauthorizedError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401 || error.status === 403) {
      return true;
    }
    if (error.status === 404 && error.message.includes("用户不存在")) {
      return true;
    }
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("登录凭证") ||
    error.message.includes("未授权") ||
    error.message.includes("请重新登录") ||
    error.message.includes("用户不存在")
  );
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  options?: { timeoutMs?: number },
): Promise<T> {
  const preferredBaseUrl = normalizeBaseUrl(runtimeApiBaseUrl);
  if (!preferredBaseUrl) {
    throw new ApiRequestError("接口地址未配置");
  }
  const cloudDefaultBaseUrl = normalizeBaseUrl(DEFAULT_API_BASE_URL);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const timeoutMs = options?.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
  const candidateBaseUrls = [preferredBaseUrl];
  if (
    cloudDefaultBaseUrl &&
    cloudDefaultBaseUrl !== preferredBaseUrl &&
    isLikelyLocalBaseUrl(preferredBaseUrl) &&
    !isLikelyLocalBaseUrl(cloudDefaultBaseUrl)
  ) {
    candidateBaseUrls.push(cloudDefaultBaseUrl);
  }

  let lastNetworkError: unknown;
  for (let index = 0; index < candidateBaseUrls.length; index += 1) {
    const currentBaseUrl = candidateBaseUrls[index]!;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${currentBaseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      lastNetworkError = error;

      const hasFallback = index < candidateBaseUrls.length - 1;
      if (hasFallback && isNetworkLikeError(error)) {
        continue;
      }
      throw new Error(normalizeErrorMessage(error));
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let payload: { message?: string } = {};
    if (text) {
      try {
        payload = JSON.parse(text) as { message?: string };
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      throw new ApiRequestError(payload.message ?? `请求失败（${response.status}）`, response.status);
    }

    if (currentBaseUrl !== preferredBaseUrl) {
      runtimeApiBaseUrl = currentBaseUrl;
      void AsyncStorage.setItem(API_BASE_URL_STORAGE_KEY, currentBaseUrl);
      void AsyncStorage.removeItem(LEGACY_API_BASE_URL_STORAGE_KEY);
    }

    return payload as T;
  }

  throw new Error(normalizeErrorMessage(lastNetworkError));
}

function todayDateString() {
  const now = new Date();
  return toDateString(now);
}

function toDateString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDateString(dateString: string, deltaDays: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toDateString(date);
}

function toMonthString(dateString: string) {
  return dateString.slice(0, 7);
}

function shiftMonthString(monthString: string, deltaMonths: number) {
  const [yearRaw, monthRaw] = monthString.split("-");
  const date = new Date(Number(yearRaw), Number(monthRaw) - 1, 1);
  date.setMonth(date.getMonth() + deltaMonths);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarCells(monthString: string) {
  const [yearRaw, monthRaw] = monthString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const firstDay = new Date(year, month - 1, 1);
  const startOffset = firstDay.getDay();
  const startDate = new Date(year, month - 1, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      date: toDateString(date),
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1,
    };
  });
}

function buildWeekStripCells(dateString: string) {
  const selected = new Date(`${dateString}T12:00:00`);
  const start = new Date(selected);
  start.setDate(selected.getDate() - selected.getDay());
  const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: toDateString(date),
      day: date.getDate(),
      weekLabel: weekLabels[date.getDay()],
    };
  });
}

function inferMealTypeForDate(dateString: string): MealType {
  if (dateString !== todayDateString()) {
    return "LUNCH";
  }

  const hour = new Date().getHours();
  if (hour < 10) {
    return "BREAKFAST";
  }
  if (hour < 15) {
    return "LUNCH";
  }
  if (hour < 21) {
    return "DINNER";
  }
  return "SNACK";
}

function formatLogAsAssistantMessage(log: FoodLog): string {
  const itemSummary = summarizeFoodFromLog(log);
  const nutrition = `热量 ${Math.round(log.calories)} 千卡 · 蛋白质 ${Number(log.proteinGram).toFixed(1)}g · 碳水 ${Number(log.carbsGram).toFixed(1)}g · 脂肪 ${Number(log.fatGram).toFixed(1)}g`;
  return `已记录：${itemSummary}\n${nutrition}`;
}

function parseLogItems(items: unknown): NutritionItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const row = item as Record<string, unknown>;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) {
        return null;
      }
      return {
        name,
        estimatedWeightGram:
          typeof row.estimatedWeightGram === 'number' && Number.isFinite(row.estimatedWeightGram)
            ? row.estimatedWeightGram
            : undefined,
        calories: Number(row.calories ?? 0),
        proteinGram: Number(row.proteinGram ?? 0),
        carbsGram: Number(row.carbsGram ?? 0),
        fatGram: Number(row.fatGram ?? 0),
        fiberGram: typeof row.fiberGram === 'number' && Number.isFinite(row.fiberGram) ? row.fiberGram : undefined,
      } as NutritionItem;
    })
    .filter((item): item is NutritionItem => Boolean(item));
}

function formatClockTime(loggedAt: string) {
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTimeLabel(loggedAt: string) {
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) {
    return loggedAt;
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function toLocalDateInput(loggedAt: string) {
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) {
    return todayDateString();
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalTimeInput(loggedAt: string) {
  const date = new Date(loggedAt);
  if (Number.isNaN(date.getTime())) {
    return "12:00";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function mergeDateAndTimeToIso(dateText: string, timeText: string, fallbackIso: string) {
  const dateMatch = dateText.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeText.trim().match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    return fallbackIso;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return fallbackIso;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) {
    return fallbackIso;
  }
  return date.toISOString();
}

function buildLoggedAtForSelectedDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  const now = new Date();
  if (Number.isNaN(date.getTime())) {
    return now.toISOString();
  }
  date.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
  return date.toISOString();
}

function isExerciseIntent(text: string) {
  return /(运动|锻炼|跑步|慢跑|快走|散步|走路|骑行|单车|游泳|瑜伽|力量|健身|撸铁|深蹲|卧推|跳绳|爬楼|椭圆机|乒乓球|羽毛球|网球|篮球|足球|排球|壁球|台球|拳击|搏击|划船|登山|徒步|爬山|滑雪|有氧|跳舞|舞蹈|普拉提|打球|跑了|练了|打了|walk|run|jog|bike|cycling|swim|yoga|workout|gym|training|hiit|pilates|badminton|tennis|basketball|football|soccer|volleyball|table tennis|ping pong)/i.test(
    text,
  );
}

function normalizeExerciseAnalysis(raw: unknown): ExerciseAnalysis {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intensity =
    data.intensity === "LOW" || data.intensity === "HIGH" || data.intensity === "MODERATE" ? data.intensity : "MODERATE";
  const rawAi = data.ai && typeof data.ai === "object" ? (data.ai as Record<string, unknown>) : null;
  return {
    exerciseType:
      typeof data.exerciseType === "string" && data.exerciseType.trim().length > 0 ? data.exerciseType.trim() : "运动",
    durationMin: Math.max(1, safeRounded(data.durationMin, 0, 30)),
    intensity,
    met: clamp(safeNumber(data.met, intensity === "HIGH" ? 8 : intensity === "LOW" ? 3 : 5), 1, 20),
    calories: Math.max(0, safeRounded(data.calories, 0, 0)),
    confidence: clamp(safeNumber(data.confidence, 0.6), 0, 1),
    notes: typeof data.notes === "string" && data.notes.trim().length > 0 ? data.notes.trim() : "按运动类型、时长和体重估算。",
    ai: rawAi
      ? {
          provider: typeof rawAi.provider === "string" ? rawAi.provider : null,
          model: typeof rawAi.model === "string" ? rawAi.model : null,
          route: typeof rawAi.route === "string" ? rawAi.route : null,
        }
      : null,
  };
}

function formatIntensity(value: string) {
  if (value === "LOW") {
    return "低强度";
  }
  if (value === "HIGH") {
    return "高强度";
  }
  return "中等强度";
}

function formatGram(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(digits).replace(/\.0$/, '')}g`;
}

function formatMg(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(digits)}mg`;
}

function formatIU(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Math.round(Number(value))}IU`;
}

function formatKcal(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Math.round(Number(value))} 千卡`;
}

function formatSignedKcalChange(value: number | null) {
  if (value === null || Number.isNaN(Number(value))) {
    return "较前日 - 千卡";
  }
  const rounded = Math.round(Number(value));
  if (rounded > 0) {
    return `较前日 +${rounded} 千卡`;
  }
  if (rounded < 0) {
    return `较前日 ${rounded} 千卡`;
  }
  return "较前日 0 千卡";
}

function formatAIUsageText(source: { aiProvider?: string | null; aiModel?: string | null; aiRoute?: string | null } | null | undefined) {
  const model = source?.aiModel?.trim();
  const provider = source?.aiProvider?.trim();
  const route = source?.aiRoute?.trim();
  if (!model && !provider && !route) {
    return "识别模型：未记录（旧记录或手动记录）";
  }
  const left = route ? `${route}` : provider || "AI";
  const right = model ? ` · ${model}` : "";
  return `识别模型：${left}${right}`;
}

function aiUsageFromAnalysis(analysis: { ai?: AIUsage | null } | null | undefined) {
  return {
    aiProvider: analysis?.ai?.provider ?? undefined,
    aiModel: analysis?.ai?.model ?? undefined,
    aiRoute: analysis?.ai?.route ?? undefined,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeFixed(value: unknown, digits = 1, fallback = 0) {
  return safeNumber(value, fallback).toFixed(digits);
}

function safeRounded(value: unknown, digits = 1, fallback = 0) {
  return Number(safeFixed(value, digits, fallback));
}

function finiteOrNull(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveOrEstimate(
  value: number | null,
  estimate: number,
  options?: {
    treatNonPositiveAsMissing?: boolean;
    minReasonable?: number;
  },
) {
  if (value === null) {
    return estimate;
  }
  if (options?.treatNonPositiveAsMissing && value <= 0) {
    return estimate;
  }
  if (typeof options?.minReasonable === 'number' && value < options.minReasonable) {
    return estimate;
  }
  return value;
}

function buildNutrientHintText(log: FoodLog) {
  const names = parseLogItems(log.items)
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0)
    .join(' ');
  const note = (log.note ?? '').trim();
  return `${names} ${note}`.toLowerCase();
}

function estimateLogNutrients(log: FoodLog, source: MicroNutrients): Required<MicroNutrients> {
  const calories = Math.max(0, Number(log.calories ?? 0));
  const carbs = Math.max(0, Number(log.carbsGram ?? 0));
  const protein = Math.max(0, Number(log.proteinGram ?? 0));
  const fat = Math.max(0, Number(log.fatGram ?? 0));
  const fiber = Math.max(0, Number(log.fiberGram ?? 0));
  const hintText = buildNutrientHintText(log);

  const likelySalty =
    /(泡菜|咸菜|榨菜|腌|酱油|味噌|卤|火锅|拉面|方便面|汤底|咸|kimchi|pickle|brine|soy sauce|ramen|bacon|sausage)/i.test(
      hintText,
    );
  const likelySweet =
    /(糖|甜|奶茶|饮料|果汁|可乐|汽水|甜点|蛋糕|饼干|冰淇淋|巧克力|蜂蜜|果酱|sugar|sweet|juice|soda|cake|cookie|dessert|honey|jam)/i.test(
      hintText,
    );
  const likelyFruit =
    /(苹果|香蕉|葡萄|橙|西瓜|草莓|芒果|菠萝|fruit|apple|banana|orange|grape|mango|pineapple|berry)/i.test(
      hintText,
    );
  const friedOrProcessed =
    /(油炸|炸|培根|腊肉|香肠|午餐肉|黄油|奶油|芝士|fried|bacon|sausage|butter|cream|cheese)/i.test(hintText);
  const animalFood =
    /(鸡|牛|猪|羊|鱼|虾|蛋|奶|肉|chicken|beef|pork|lamb|fish|shrimp|egg|milk|meat)/i.test(hintText);

  let sugarEstimate = carbs * (likelyFruit ? 0.45 : likelySweet ? 0.34 : 0.18);
  if (!likelyFruit && !likelySweet && carbs < 10) {
    sugarEstimate = carbs * 0.1;
  }
  sugarEstimate = clamp(sugarEstimate, carbs > 0 ? 0.2 : 0, carbs);
  const rawSugar = finiteOrNull(source.sugarGram);
  const sugar = rawSugar === null
    ? sugarEstimate
    : (carbs >= 12 && rawSugar <= 0) || ((likelySweet || likelyFruit) && carbs >= 8 && rawSugar < 1.5)
      ? sugarEstimate
      : rawSugar;

  const rawAddedSugar = finiteOrNull(source.addedSugarGram);
  let addedSugarEstimate = likelySweet ? sugar * 0.55 : likelyFruit ? sugar * 0.12 : sugar * 0.25;
  addedSugarEstimate = clamp(addedSugarEstimate, 0, sugar);
  const addedSugar = rawAddedSugar === null || rawAddedSugar < 0 || rawAddedSugar > sugar
    ? addedSugarEstimate
    : likelySweet && sugar >= 3 && rawAddedSugar < 1
      ? addedSugarEstimate
      : rawAddedSugar;

  const rawSugarAlcohol = finiteOrNull(source.sugarAlcoholGram);
  const sugarAlcohol = rawSugarAlcohol === null || rawSugarAlcohol < 0
    ? 0
    : clamp(rawSugarAlcohol, 0, sugar);

  let saturatedFat = resolveOrEstimate(
    finiteOrNull(source.saturatedFatGram),
    clamp(fat * (friedOrProcessed ? 0.38 : 0.32), 0, fat),
    { treatNonPositiveAsMissing: true },
  );
  let transFat = resolveOrEstimate(
    finiteOrNull(source.transFatGram),
    clamp(fat * (friedOrProcessed ? 0.015 : 0.004), 0, fat),
    { treatNonPositiveAsMissing: true },
  );
  let monounsaturatedFat = resolveOrEstimate(
    finiteOrNull(source.monounsaturatedFatGram),
    clamp(fat * 0.38, 0, fat),
    { treatNonPositiveAsMissing: true },
  );
  let polyunsaturatedFat = resolveOrEstimate(
    finiteOrNull(source.polyunsaturatedFatGram),
    clamp(fat * 0.2, 0, fat),
    { treatNonPositiveAsMissing: true },
  );

  saturatedFat = clamp(saturatedFat, 0, fat);
  transFat = clamp(transFat, 0, Math.max(fat - saturatedFat, 0));
  const variableTotal = monounsaturatedFat + polyunsaturatedFat;
  const remainAfterFixed = Math.max(fat - saturatedFat - transFat, 0);
  if (variableTotal > 0) {
    const scale = remainAfterFixed / variableTotal;
    monounsaturatedFat = clamp(monounsaturatedFat * scale, 0, remainAfterFixed);
    polyunsaturatedFat = clamp(polyunsaturatedFat * scale, 0, remainAfterFixed - monounsaturatedFat);
  } else {
    monounsaturatedFat = remainAfterFixed;
    polyunsaturatedFat = 0;
  }

  let sodiumEstimate = Math.max(80, calories * 1.1, protein * 8 + carbs * 2 + fiber * 6);
  if (likelySalty) {
    sodiumEstimate = Math.max(sodiumEstimate, 700);
  }
  if (/(泡菜|咸菜|榨菜|酱油|味噌|腌|火锅|拉面|方便面|汤底)/i.test(hintText)) {
    sodiumEstimate = Math.max(sodiumEstimate, 900);
  }
  const sodiumMg = resolveOrEstimate(finiteOrNull(source.sodiumMg), sodiumEstimate, {
    treatNonPositiveAsMissing: true,
    minReasonable: likelySalty ? 220 : undefined,
  });
  const potassiumMg = resolveOrEstimate(
    finiteOrNull(source.potassiumMg),
    Math.max(120, protein * 14 + carbs * 6 + fiber * 15),
    { treatNonPositiveAsMissing: true },
  );
  const calciumMg = resolveOrEstimate(
    finiteOrNull(source.calciumMg),
    Math.max(30, protein * 3.2 + fat * 1.4 + fiber * 2.8),
    { treatNonPositiveAsMissing: true },
  );
  const ironMg = resolveOrEstimate(
    finiteOrNull(source.ironMg),
    Math.max(0.4, protein * 0.06 + carbs * 0.015 + fiber * 0.12),
    { treatNonPositiveAsMissing: true },
  );
  const cholesterolEstimate = animalFood ? Math.max(18, protein * 1.4 + saturatedFat * 11) : Math.max(0, protein * 0.2);
  const cholesterolMg = resolveOrEstimate(
    finiteOrNull(source.cholesterolMg),
    cholesterolEstimate,
    { treatNonPositiveAsMissing: true },
  );
  const vitaminAIU = resolveOrEstimate(finiteOrNull(source.vitaminAIU), Math.max(0, fat * 18 + fiber * 35), {
    treatNonPositiveAsMissing: true,
  });
  const vitaminCEstimate = likelyFruit ? Math.max(0, fiber * 4 + carbs * 0.22) : Math.max(0, fiber * 2.3 + carbs * 0.08);
  const vitaminCMg = resolveOrEstimate(
    finiteOrNull(source.vitaminCMg),
    vitaminCEstimate,
    { treatNonPositiveAsMissing: true },
  );
  const vitaminDIU = resolveOrEstimate(
    finiteOrNull(source.vitaminDIU),
    Math.max(0, protein * 0.45 + fat * 0.6),
    { treatNonPositiveAsMissing: true },
  );

  return {
    sugarGram: roundTo(sugar, 1),
    addedSugarGram: roundTo(addedSugar, 1),
    sugarAlcoholGram: roundTo(sugarAlcohol, 1),
    sodiumMg: roundTo(sodiumMg, 0),
    potassiumMg: roundTo(potassiumMg, 0),
    calciumMg: roundTo(calciumMg, 0),
    ironMg: roundTo(ironMg, 1),
    cholesterolMg: roundTo(cholesterolMg, 0),
    saturatedFatGram: roundTo(saturatedFat, 1),
    transFatGram: roundTo(transFat, 1),
    monounsaturatedFatGram: roundTo(monounsaturatedFat, 1),
    polyunsaturatedFatGram: roundTo(polyunsaturatedFat, 1),
    vitaminAIU: roundTo(vitaminAIU, 0),
    vitaminCMg: roundTo(vitaminCMg, 1),
    vitaminDIU: roundTo(vitaminDIU, 0),
  };
}

function getLogNutrients(log: FoodLog): Required<MicroNutrients> {
  const raw: MicroNutrients = {
    sugarGram: log.nutrients?.sugarGram ?? log.sugarGram,
    addedSugarGram: log.nutrients?.addedSugarGram,
    sugarAlcoholGram: log.nutrients?.sugarAlcoholGram,
    sodiumMg: log.nutrients?.sodiumMg ?? log.sodiumMg,
    potassiumMg: log.nutrients?.potassiumMg,
    calciumMg: log.nutrients?.calciumMg,
    ironMg: log.nutrients?.ironMg,
    cholesterolMg: log.nutrients?.cholesterolMg,
    saturatedFatGram: log.nutrients?.saturatedFatGram,
    transFatGram: log.nutrients?.transFatGram,
    monounsaturatedFatGram: log.nutrients?.monounsaturatedFatGram,
    polyunsaturatedFatGram: log.nutrients?.polyunsaturatedFatGram,
    vitaminAIU: log.nutrients?.vitaminAIU,
    vitaminCMg: log.nutrients?.vitaminCMg,
    vitaminDIU: log.nutrients?.vitaminDIU,
  };
  return estimateLogNutrients(log, raw);
}

function buildPersistedNutritionFromAnalysis(analysis: NutritionAnalysis) {
  const totals = (analysis?.totals ?? {}) as Partial<NutritionAnalysis["totals"]>;
  const calories = safeRounded(totals.calories, 1, 0);
  const proteinGram = safeRounded(totals.proteinGram, 1, 0);
  const carbsGram = safeRounded(totals.carbsGram, 1, 0);
  const fatGram = safeRounded(totals.fatGram, 1, 0);
  const fiberGram = safeRounded(totals.fiberGram, 1, 0);

  const estimatedNutrients = estimateLogNutrients(
    {
      id: "tmp",
      loggedAt: new Date().toISOString(),
      mealType: "SNACK",
      source: "AI",
      visibility: "PRIVATE",
      calories,
      proteinGram,
      carbsGram,
      fatGram,
      fiberGram,
      note: analysis.items
        .map((item) => item.name.trim())
        .filter((name) => name.length > 0)
        .join('、'),
      items: analysis.items,
    },
    {
      sugarGram: finiteOrNull(totals.sugarGram) ?? undefined,
      addedSugarGram: finiteOrNull(totals.addedSugarGram) ?? undefined,
      sugarAlcoholGram: finiteOrNull(totals.sugarAlcoholGram) ?? undefined,
      sodiumMg: finiteOrNull(totals.sodiumMg) ?? undefined,
      potassiumMg: finiteOrNull(totals.potassiumMg) ?? undefined,
      calciumMg: finiteOrNull(totals.calciumMg) ?? undefined,
      ironMg: finiteOrNull(totals.ironMg) ?? undefined,
      cholesterolMg: finiteOrNull(totals.cholesterolMg) ?? undefined,
      saturatedFatGram: finiteOrNull(totals.saturatedFatGram) ?? undefined,
      transFatGram: finiteOrNull(totals.transFatGram) ?? undefined,
      monounsaturatedFatGram: finiteOrNull(totals.monounsaturatedFatGram) ?? undefined,
      polyunsaturatedFatGram: finiteOrNull(totals.polyunsaturatedFatGram) ?? undefined,
      vitaminAIU: finiteOrNull(totals.vitaminAIU) ?? undefined,
      vitaminCMg: finiteOrNull(totals.vitaminCMg) ?? undefined,
      vitaminDIU: finiteOrNull(totals.vitaminDIU) ?? undefined,
    },
  );

  return {
    calories,
    proteinGram,
    carbsGram,
    fatGram,
    fiberGram,
    sugarGram: estimatedNutrients.sugarGram,
    sodiumMg: estimatedNutrients.sodiumMg,
    nutrients: estimatedNutrients,
  };
}

function normalizeClientAnalysis(raw: unknown): NutritionAnalysis {
  const data = (raw && typeof raw === "object" ? raw : {}) as {
    items?: unknown;
    totals?: Record<string, unknown>;
    confidence?: unknown;
    notes?: unknown;
    ai?: unknown;
  };
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: NutritionAnalysis["items"] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) {
      continue;
    }
    const estimatedWeightGram = safeNumber(row.estimatedWeightGram, 0);
    items.push({
      name,
      estimatedWeightGram: estimatedWeightGram > 0 ? estimatedWeightGram : undefined,
      calories: safeNumber(row.calories, 0),
      proteinGram: safeNumber(row.proteinGram, 0),
      carbsGram: safeNumber(row.carbsGram, 0),
      fatGram: safeNumber(row.fatGram, 0),
      fiberGram: safeNumber(row.fiberGram, 0),
    });
  }

  const totalsRaw = data.totals ?? {};
  const fallbackTotals = items.reduce(
    (acc, item) => {
      acc.calories += item.calories;
      acc.proteinGram += item.proteinGram;
      acc.carbsGram += item.carbsGram;
      acc.fatGram += item.fatGram;
      acc.fiberGram += item.fiberGram ?? 0;
      return acc;
    },
    { calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 },
  );

  const totals: NutritionAnalysis["totals"] = {
    calories: safeNumber(totalsRaw.calories, fallbackTotals.calories),
    proteinGram: safeNumber(totalsRaw.proteinGram, fallbackTotals.proteinGram),
    carbsGram: safeNumber(totalsRaw.carbsGram, fallbackTotals.carbsGram),
    fatGram: safeNumber(totalsRaw.fatGram, fallbackTotals.fatGram),
    fiberGram: safeNumber(totalsRaw.fiberGram, fallbackTotals.fiberGram),
    sugarGram: safeNumber(totalsRaw.sugarGram, 0),
    addedSugarGram: safeNumber(totalsRaw.addedSugarGram, 0),
    sugarAlcoholGram: safeNumber(totalsRaw.sugarAlcoholGram, 0),
    sodiumMg: safeNumber(totalsRaw.sodiumMg, 0),
    potassiumMg: safeNumber(totalsRaw.potassiumMg, 0),
    calciumMg: safeNumber(totalsRaw.calciumMg, 0),
    ironMg: safeNumber(totalsRaw.ironMg, 0),
    cholesterolMg: safeNumber(totalsRaw.cholesterolMg, 0),
    saturatedFatGram: safeNumber(totalsRaw.saturatedFatGram, 0),
    transFatGram: safeNumber(totalsRaw.transFatGram, 0),
    monounsaturatedFatGram: safeNumber(totalsRaw.monounsaturatedFatGram, 0),
    polyunsaturatedFatGram: safeNumber(totalsRaw.polyunsaturatedFatGram, 0),
    vitaminAIU: safeNumber(totalsRaw.vitaminAIU, 0),
    vitaminCMg: safeNumber(totalsRaw.vitaminCMg, 0),
    vitaminDIU: safeNumber(totalsRaw.vitaminDIU, 0),
  };

  const rawAi = data.ai && typeof data.ai === "object" ? (data.ai as Record<string, unknown>) : null;
  return {
    items,
    totals,
    confidence: clamp(safeNumber(data.confidence, 0.5), 0, 1),
    notes: typeof data.notes === "string" && data.notes.trim().length > 0 ? data.notes.trim() : "已按可用信息自动估算。",
    ai: rawAi
      ? {
          provider: typeof rawAi.provider === "string" ? rawAi.provider : null,
          model: typeof rawAi.model === "string" ? rawAi.model : null,
          route: typeof rawAi.route === "string" ? rawAi.route : null,
        }
      : null,
  };
}

function buildHealthAnalysis(log: FoodLog, target?: { targetCalories: number | null; targetProteinGram: number | null; targetCarbsGram: number | null; targetFatGram: number | null } | null) {
  const calories = Number(log.calories ?? 0);
  const protein = Number(log.proteinGram ?? 0);
  const carbs = Number(log.carbsGram ?? 0);
  const fat = Number(log.fatGram ?? 0);
  const fiber = Number(log.fiberGram ?? 0);
  const nutrients = getLogNutrients(log);

  const points: string[] = [];
  const proteinKcal = protein * 4;
  const carbsKcal = carbs * 4;
  const fatKcal = fat * 9;
  const macroKcal = proteinKcal + carbsKcal + fatKcal;
  if (macroKcal > 0) {
    const proteinPct = (proteinKcal / macroKcal) * 100;
    const fatPct = (fatKcal / macroKcal) * 100;
    const carbsPct = (carbsKcal / macroKcal) * 100;
    points.push(
      `宏量结构：蛋白质约 ${proteinPct.toFixed(0)}%、碳水约 ${carbsPct.toFixed(0)}%、脂肪约 ${fatPct.toFixed(0)}%。这更接近能量占比，比按克数比较更可靠。`,
    );
  }

  if (protein >= 25) {
    points.push("蛋白质较充足，有利于肌肉修复和减脂期饱腹感。");
  } else if (protein < 12 && calories > 300) {
    points.push("相对热量而言蛋白质偏低，后续可增加鸡蛋、鱼虾、瘦肉、豆制品或奶类。");
  }

  if (fiber >= 6) {
    points.push("膳食纤维表现较好，有助于延缓胃排空、提高饱腹感并稳定餐后血糖。");
  } else {
    points.push("膳食纤维偏低，建议搭配蔬菜、菌菇、豆类或全谷物，尤其是以精制主食为主时。");
  }

  if (nutrients.sodiumMg > 1000) {
    points.push("钠摄入估算偏高，若包含泡菜、腌制品、汤底或酱料，建议当天其余餐减少高盐食物并增加饮水。");
  } else if (nutrients.sodiumMg < 250 && calories > 300) {
    points.push("钠估算较低，若实际添加了酱料、泡菜或汤底，建议手动修正钠含量。");
  }

  if (nutrients.sugarGram > 15) {
    points.push("糖含量较高，若来自含糖饮料或甜点，应注意它们饱腹感较弱，容易推高全天能量。");
  }
  if (nutrients.saturatedFatGram > 8 || nutrients.transFatGram > 0.5) {
    points.push("饱和脂肪或反式脂肪偏高时，建议减少油炸、奶油、肥肉和加工肉，优先选择鱼类、坚果和橄榄油等不饱和脂肪来源。");
  }

  if (target?.targetCalories && target.targetCalories > 0) {
    const ratio = calories / target.targetCalories;
    if (ratio > 0.55) {
      points.push("这条记录已占全天热量目标的一半以上，后续餐建议以高蛋白、低油烹调和高纤维蔬菜为主。");
    } else if (ratio < 0.15) {
      points.push("这条记录热量占比偏低，如为正餐，建议确认是否漏记主食、油脂或饮品。");
    } else {
      points.push("这条记录热量占比适中，可结合全天剩余热量继续安排。");
    }
  }

  return `${points.join(" ")} 以上为基于图片/文字和常见食物数据库的估算，不替代医疗建议；如有疾病、孕期或特殊饮食需求，应按医生或营养师方案执行。`;
}

function buildExerciseHealthAnalysis(
  exercise: ExerciseLog,
  context: {
    foodSummary: { calories: number; proteinGram: number; carbsGram: number; fatGram: number; fiberGram: number };
    exerciseSummary: { calories: number; durationMin: number };
    target?: {
      targetCalories: number | null;
      targetProteinGram: number | null;
      targetCarbsGram: number | null;
      targetFatGram: number | null;
    } | null;
  },
) {
  const calories = Math.max(0, Number(exercise.calories ?? 0));
  const duration = Math.max(0, Number(exercise.durationMin ?? 0));
  const met = Math.max(1, Number(exercise.met ?? 1));
  const totalExerciseCalories = Math.max(0, Number(context.exerciseSummary.calories ?? 0));
  const totalExerciseDuration = Math.max(0, Number(context.exerciseSummary.durationMin ?? 0));
  const foodCalories = Math.max(0, Number(context.foodSummary.calories ?? 0));
  const netCalories = Math.round(foodCalories - totalExerciseCalories);
  const targetCalories = Number(context.target?.targetCalories ?? 0);
  const points: string[] = [];

  points.push(
    `这次${exercise.exerciseType || "运动"}估算消耗 ${Math.round(calories)} 千卡，时长约 ${Math.round(duration)} 分钟，强度为${formatIntensity(
      exercise.intensity,
    )}，MET 约 ${roundTo(met, 1)}。`,
  );

  if (totalExerciseCalories > 0) {
    const share = clamp((calories / totalExerciseCalories) * 100, 0, 100);
    points.push(`它约占今天运动消耗的 ${share.toFixed(0)}%，今日累计运动 ${Math.round(totalExerciseDuration)} 分钟。`);
  }

  if (targetCalories > 0) {
    const remain = Math.round(targetCalories - netCalories);
    points.push(
      `结合今天已记录饮食与运动，当前净摄入约 ${netCalories} 千卡，距离今日目标${remain >= 0 ? `还剩 ${remain}` : `已超出 ${Math.abs(remain)}`} 千卡。`,
    );
    if (remain > 650) {
      points.push("当前热量缺口较大，若不是刻意安排低热量日，建议补充一餐含优质蛋白、复合碳水和蔬菜的正餐，避免长期过低摄入影响恢复。");
    } else if (remain < -350) {
      points.push("当前净摄入已明显高于目标，后续可优先选择低油、高蛋白和高纤维食物，并把额外运动作为辅助而不是抵消进食的主要手段。");
    } else {
      points.push("当前净摄入与目标距离较可控，可根据饥饿感和训练恢复安排后续饮食。");
    }
  }

  const proteinTarget = Number(context.target?.targetProteinGram ?? 0);
  if (proteinTarget > 0) {
    const proteinRatio = context.foodSummary.proteinGram / proteinTarget;
    if (proteinRatio < 0.55 && calories >= 150) {
      points.push("蛋白质完成度偏低，运动后可补充鸡蛋、鱼虾、瘦肉、豆制品或奶类，帮助肌肉修复和维持饱腹感。");
    } else if (proteinRatio >= 0.8) {
      points.push("今天蛋白质完成度较好，有利于训练恢复和体重管理。");
    }
  }

  const carbsTarget = Number(context.target?.targetCarbsGram ?? 0);
  if (carbsTarget > 0 && calories >= 250 && context.foodSummary.carbsGram / carbsTarget < 0.35) {
    points.push("运动消耗较高且碳水完成度偏低时，可适量补充米饭、土豆、燕麦或水果，帮助恢复糖原并降低疲劳感。");
  }

  if (duration >= 45 || calories >= 350) {
    points.push("本次运动量较大，注意补水；如果大量出汗，可适量补充电解质，尤其在高温或长时间有氧后。");
  }

  if (/(力量|健身|撸铁|深蹲|卧推|硬拉|训练|strength|gym|lift|weight)/i.test(exercise.exerciseType)) {
    points.push("力量训练后建议保证睡眠和蛋白质摄入，并给同一肌群留出恢复时间。");
  } else if (/(跑|骑|游|快走|有氧|run|bike|cycling|swim|walk|cardio)/i.test(exercise.exerciseType)) {
    points.push("有氧训练对心肺和能量消耗有帮助，若频率较高，应关注膝踝或肩部等重复负荷部位的恢复。");
  }

  return `${points.join(" ")} 运动消耗基于运动类型、时长、强度和常见 MET 估算，实际值会受体重、心率、动作质量和设备误差影响。`;
}

function NumberInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      keyboardType="numeric"
      placeholder={placeholder}
      placeholderTextColor="#8992a3"
    />
  );
}

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{label}</Text>
      <View style={styles.optionWrap}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.optionChip, active && styles.optionChipActive]}
              onPress={() => onChange(option.value)}
            >
              <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AuthScreen({
  onAuthed,
  apiBaseUrl,
  onSaveApiBaseUrl,
}: {
  onAuthed: (payload: AuthPayload) => void;
  apiBaseUrl: string;
  onSaveApiBaseUrl: (nextUrl: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiInput, setApiInput] = useState(apiBaseUrl);
  const [testingApi, setTestingApi] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotHint, setForgotHint] = useState("");

  useEffect(() => {
    setApiInput(apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!forgotEmail && email) {
      setForgotEmail(email);
    }
  }, [email, forgotEmail]);

  const validateApiUrl = useCallback((raw: string) => {
    const normalized = normalizeBaseUrl(raw);
    if (!normalized) {
      return { ok: false as const, message: "请先填写接口地址。", url: normalized };
    }
    if (!/^https?:\/\//i.test(normalized)) {
      return { ok: false as const, message: "接口地址需以 http:// 或 https:// 开头。", url: normalized };
    }
    return { ok: true as const, message: "", url: normalized };
  }, []);

  const saveApiUrl = useCallback(async () => {
    const checked = validateApiUrl(apiInput);
    if (!checked.ok) {
      Alert.alert("提示", checked.message);
      return;
    }

    await onSaveApiBaseUrl(checked.url);
    Alert.alert("已保存", `当前接口地址：${checked.url}`);
  }, [apiInput, onSaveApiBaseUrl, validateApiUrl]);

  const testApiConnection = useCallback(async () => {
    const checked = validateApiUrl(apiInput);
    if (!checked.ok) {
      Alert.alert("提示", checked.message);
      return;
    }

    setTestingApi(true);
    try {
      await onSaveApiBaseUrl(checked.url);
      await apiRequest("/health", {}, undefined, { timeoutMs: 10000 });
      Alert.alert("连接成功", `已连接：${checked.url}`);
    } catch (error) {
      Alert.alert("连接失败", normalizeErrorMessage(error));
    } finally {
      setTestingApi(false);
    }
  }, [apiInput, onSaveApiBaseUrl, validateApiUrl]);

  const handleSubmit = useCallback(async () => {
    if (!email || !password) {
      Alert.alert("提示", "请填写邮箱和密码。");
      return;
    }
    if (mode === "register" && !displayName) {
      Alert.alert("提示", "注册时请填写昵称。");
      return;
    }
    const checked = validateApiUrl(apiInput);
    if (!checked.ok) {
      Alert.alert("提示", checked.message);
      return;
    }

    setLoading(true);
    try {
      await onSaveApiBaseUrl(checked.url);
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = await apiRequest<AuthPayload>(path, {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      }, undefined, { timeoutMs: 60000 });
      onAuthed(payload);
    } catch (error) {
      Alert.alert("请求失败", normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [apiInput, displayName, email, mode, onAuthed, onSaveApiBaseUrl, password, validateApiUrl]);

  const handleForgotRequest = useCallback(async () => {
    const targetEmail = (forgotEmail || email).trim();
    if (!targetEmail) {
      Alert.alert("提示", "请先输入注册邮箱。");
      return;
    }

    const checked = validateApiUrl(apiInput);
    if (!checked.ok) {
      Alert.alert("提示", checked.message);
      return;
    }

    setForgotLoading(true);
    try {
      await onSaveApiBaseUrl(checked.url);
      const payload = await apiRequest<{ message?: string; code?: string; expiresAt?: string }>(
        "/api/auth/forgot-password/request",
        {
          method: "POST",
          body: JSON.stringify({ email: targetEmail }),
        },
        undefined,
        { timeoutMs: 30000 },
      );

      let hint = payload.message ?? "验证码已发送，请继续重置密码。";
      if (payload.code) {
        setForgotCode(payload.code);
        hint = `${hint}\n演示验证码：${payload.code}`;
      }
      if (payload.expiresAt) {
        hint = `${hint}\n有效期至：${new Date(payload.expiresAt).toLocaleString()}`;
      }

      setForgotEmail(targetEmail);
      setForgotHint(hint);
      setForgotOpen(true);
      Alert.alert("验证码已生成", hint);
    } catch (error) {
      Alert.alert("获取验证码失败", normalizeErrorMessage(error));
    } finally {
      setForgotLoading(false);
    }
  }, [apiInput, email, forgotEmail, onSaveApiBaseUrl, validateApiUrl]);

  const handleForgotConfirm = useCallback(async () => {
    const targetEmail = forgotEmail.trim();
    if (!targetEmail || !forgotCode.trim() || !forgotNewPassword.trim()) {
      Alert.alert("提示", "请填写邮箱、验证码和新密码。");
      return;
    }
    if (forgotNewPassword.trim().length < 8) {
      Alert.alert("提示", "新密码至少 8 位。");
      return;
    }

    const checked = validateApiUrl(apiInput);
    if (!checked.ok) {
      Alert.alert("提示", checked.message);
      return;
    }

    setForgotLoading(true);
    try {
      await onSaveApiBaseUrl(checked.url);
      const payload = await apiRequest<{ message?: string }>(
        "/api/auth/forgot-password/confirm",
        {
          method: "POST",
          body: JSON.stringify({
            email: targetEmail,
            code: forgotCode.trim(),
            newPassword: forgotNewPassword.trim(),
          }),
        },
        undefined,
        { timeoutMs: 30000 },
      );

      setPassword(forgotNewPassword.trim());
      setForgotOpen(false);
      setForgotCode("");
      setForgotNewPassword("");
      setForgotHint(payload.message ?? "密码已重置，请使用新密码登录。");
      Alert.alert("重置成功", payload.message ?? "密码已重置，请使用新密码登录。");
    } catch (error) {
      Alert.alert("重置失败", normalizeErrorMessage(error));
    } finally {
      setForgotLoading(false);
    }
  }, [apiInput, forgotCode, forgotEmail, forgotNewPassword, onSaveApiBaseUrl, validateApiUrl]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.authContainer}>
        <Text style={styles.logo}>饮食营养助手</Text>
        <Text style={styles.subtitle}>饮食记录与营养控制</Text>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeButton, mode === "login" && styles.modeButtonActive]}
            onPress={() => setMode("login")}
          >
            <Text style={[styles.modeText, mode === "login" && styles.modeTextActive]}>登录</Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === "register" && styles.modeButtonActive]}
            onPress={() => setMode("register")}
          >
            <Text style={[styles.modeText, mode === "register" && styles.modeTextActive]}>注册</Text>
          </Pressable>
        </View>

        {mode === "register" ? (
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="昵称"
            placeholderTextColor="#8992a3"
          />
        ) : null}

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="邮箱"
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor="#8992a3"
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="密码（至少 8 位）"
          secureTextEntry
          placeholderTextColor="#8992a3"
        />

        <Pressable style={styles.primaryButton} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.primaryButtonText}>{loading ? "提交中..." : mode === "login" ? "登录" : "注册"}</Text>
        </Pressable>
        {mode === "login" ? (
          <View style={styles.sectionBlock}>
            <Pressable style={styles.ghostButton} onPress={() => setForgotOpen((prev) => !prev)}>
              <Text style={styles.ghostButtonText}>{forgotOpen ? "收起忘记密码" : "忘记密码"}</Text>
            </Pressable>
          </View>
        ) : null}
        {mode === "login" && forgotOpen ? (
          <View style={[styles.card, { marginTop: 10 }]}>
            <Text style={styles.cardTitle}>忘记密码</Text>
            <TextInput
              style={styles.input}
              value={forgotEmail}
              onChangeText={setForgotEmail}
              placeholder="注册邮箱"
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor="#8992a3"
            />
            <Pressable style={styles.secondaryButton} onPress={() => void handleForgotRequest()} disabled={forgotLoading}>
              <Text style={styles.secondaryButtonText}>{forgotLoading ? "发送中..." : "获取验证码"}</Text>
            </Pressable>
            <TextInput
              style={styles.input}
              value={forgotCode}
              onChangeText={setForgotCode}
              placeholder="验证码（6位）"
              keyboardType="number-pad"
              placeholderTextColor="#8992a3"
            />
            <TextInput
              style={styles.input}
              value={forgotNewPassword}
              onChangeText={setForgotNewPassword}
              placeholder="新密码（至少 8 位）"
              secureTextEntry
              placeholderTextColor="#8992a3"
            />
            <Pressable style={styles.primaryButton} onPress={() => void handleForgotConfirm()} disabled={forgotLoading}>
              <Text style={styles.primaryButtonText}>{forgotLoading ? "提交中..." : "确认重置密码"}</Text>
            </Pressable>
            {forgotHint ? <Text style={styles.hint}>{forgotHint}</Text> : null}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>接口配置</Text>
        <TextInput
          style={styles.input}
          value={apiInput}
          onChangeText={setApiInput}
          placeholder="例如：https://你的接口域名"
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#8992a3"
        />
        <View style={styles.rowGap}>
          <Pressable style={styles.secondaryButton} onPress={() => void testApiConnection()} disabled={testingApi}>
            <Text style={styles.secondaryButtonText}>{testingApi ? "检测中..." : "测试连接"}</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={() => void saveApiUrl()}>
            <Text style={styles.ghostButtonText}>保存地址</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>当前接口地址：{apiBaseUrl || "未设置"}</Text>
        <Text style={styles.hint}>独立使用请填写云端 HTTPS 地址；本地调试请填局域网 IP。</Text>
        <Text style={styles.hint}>构建标识：{APP_BUILD_LABEL}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function DashboardScreen({
  token,
  onAuthInvalid,
}: {
  token: string;
  onAuthInvalid: () => void;
}) {
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [summary, setSummary] = useState({ calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 });
  const [exercises, setExercises] = useState<ExerciseLog[]>([]);
  const [exerciseSummary, setExerciseSummary] = useState({ calories: 0, durationMin: 0 });
  const [previousDayNetCalories, setPreviousDayNetCalories] = useState<number | null>(null);
  const [dailyTarget, setDailyTarget] = useState<null | {
    targetCalories: number | null;
    targetProteinGram: number | null;
    targetCarbsGram: number | null;
    targetFatGram: number | null;
    targetWeightKg?: number | null;
    weeklyWeightChangeKg?: number | null;
  }>(null);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [selectedMonth, setSelectedMonth] = useState(toMonthString(todayDateString()));
  const [monthStats, setMonthStats] = useState<Record<string, CalendarDaySummary>>({});
  const [calendarExpanded, setCalendarExpanded] = useState(false);

  const [conversationInput, setConversationInput] = useState('');
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationImageUri, setConversationImageUri] = useState<string | null>(null);
  const [conversationImageBase64, setConversationImageBase64] = useState<string | null>(null);
  const [conversationImageMimeType, setConversationImageMimeType] = useState('image/jpeg');
  const [conversationVisibility, setConversationVisibility] = useState<Visibility>('PRIVATE');
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const [detailExerciseId, setDetailExerciseId] = useState<string | null>(null);
  const [editLogId, setEditLogId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editCalories, setEditCalories] = useState('');
  const [editProtein, setEditProtein] = useState('');
  const [editCarbs, setEditCarbs] = useState('');
  const [editFat, setEditFat] = useState('');
  const [editFiber, setEditFiber] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editVisibility, setEditVisibility] = useState<Visibility>('PRIVATE');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editExerciseId, setEditExerciseId] = useState<string | null>(null);
  const [editExerciseType, setEditExerciseType] = useState('');
  const [editExerciseNote, setEditExerciseNote] = useState('');
  const [editExerciseDuration, setEditExerciseDuration] = useState('');
  const [editExerciseCalories, setEditExerciseCalories] = useState('');
  const [editExerciseMet, setEditExerciseMet] = useState('');
  const [editExerciseDate, setEditExerciseDate] = useState('');
  const [editExerciseTime, setEditExerciseTime] = useState('');
  const [editExerciseIntensity, setEditExerciseIntensity] = useState<ExerciseIntensity>('MODERATE');
  const [editExerciseVisibility, setEditExerciseVisibility] = useState<Visibility>('PRIVATE');
  const [savingExerciseEdit, setSavingExerciseEdit] = useState(false);

  useEffect(() => {
    let active = true;
    const loadPreferredVisibility = async () => {
      try {
        const saved = parseVisibility(await AsyncStorage.getItem(VISIBILITY_PREF_STORAGE_KEY));
        if (active && saved) {
          setConversationVisibility(saved);
        }
      } catch {
        // ignore visibility preference load errors
      }
    };
    void loadPreferredVisibility();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(VISIBILITY_PREF_STORAGE_KEY, conversationVisibility);
  }, [conversationVisibility]);

  const pickConversationImage = useCallback(async (mode: 'camera' | 'library') => {
    if (mode === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('权限不足', '请先在系统设置中允许访问相机。');
        return;
      }
    }

    const result =
      mode === 'camera'
        ? await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            quality: 0.5,
            base64: true,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
          })
        : await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true,
            quality: 0.5,
            base64: true,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
          });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert('失败', '未获取到图片数据，请重试。');
      return;
    }

    setConversationImageUri(asset.uri);
    setConversationImageBase64(asset.base64);
    setConversationImageMimeType(asset.mimeType ?? 'image/jpeg');
  }, []);

  const clearConversationImage = useCallback(() => {
    setConversationImageUri(null);
    setConversationImageBase64(null);
    setConversationImageMimeType('image/jpeg');
  }, []);

  const resetEditState = useCallback(() => {
    setEditLogId(null);
    setEditNote('');
    setEditCalories('');
    setEditProtein('');
    setEditCarbs('');
    setEditFat('');
    setEditFiber('');
    setEditDate('');
    setEditTime('');
    setEditVisibility('PRIVATE');
  }, []);

  const resetExerciseEditState = useCallback(() => {
    setEditExerciseId(null);
    setEditExerciseType('');
    setEditExerciseNote('');
    setEditExerciseDuration('');
    setEditExerciseCalories('');
    setEditExerciseMet('');
    setEditExerciseDate('');
    setEditExerciseTime('');
    setEditExerciseIntensity('MODERATE');
    setEditExerciseVisibility('PRIVATE');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [logPayload, targetPayload] = await Promise.all([
        apiRequest<{
          logs: FoodLog[];
          summary: { calories: number; proteinGram: number; carbsGram: number; fatGram: number; fiberGram: number };
        }>(`/api/logs?date=${selectedDate}`, {}, token),
        apiRequest<{
          profile: {
            targetCalories: number | null;
            targetProteinGram: number | null;
            targetCarbsGram: number | null;
            targetFatGram: number | null;
            targetWeightKg?: number | null;
            weeklyWeightChangeKg?: number | null;
          };
        }>('/api/profile/targets', {}, token),
      ]);

      let exercisePayload: {
        exercises: ExerciseLog[];
        summary: { calories: number; durationMin: number };
      } = {
        exercises: [],
        summary: { calories: 0, durationMin: 0 },
      };
      try {
        exercisePayload = await apiRequest<{
          exercises: ExerciseLog[];
          summary: { calories: number; durationMin: number };
        }>(`/api/exercises?date=${selectedDate}`, {}, token);
      } catch (exerciseError) {
        if (isUnauthorizedError(exerciseError)) {
          onAuthInvalid();
          return;
        }
        if (!isEndpointNotFound(exerciseError)) {
          throw exerciseError;
        }
      }

      let nextPreviousDayNetCalories: number | null = null;
      const previousDate = shiftDateString(selectedDate, -1);
      try {
        const previousLogPayload = await apiRequest<{
          logs: FoodLog[];
          summary: { calories: number; proteinGram: number; carbsGram: number; fatGram: number; fiberGram: number };
        }>(`/api/logs?date=${previousDate}`, {}, token);

        let previousExerciseCalories = 0;
        try {
          const previousExercisePayload = await apiRequest<{
            exercises: ExerciseLog[];
            summary: { calories: number; durationMin: number };
          }>(`/api/exercises?date=${previousDate}`, {}, token);
          previousExerciseCalories = Number(previousExercisePayload.summary.calories ?? 0);
        } catch (previousExerciseError) {
          if (isUnauthorizedError(previousExerciseError)) {
            onAuthInvalid();
            return;
          }
          if (!isEndpointNotFound(previousExerciseError)) {
            throw previousExerciseError;
          }
        }
        nextPreviousDayNetCalories = Math.round(Number(previousLogPayload.summary.calories ?? 0) - previousExerciseCalories);
      } catch (previousDayError) {
        if (isUnauthorizedError(previousDayError)) {
          onAuthInvalid();
          return;
        }
        nextPreviousDayNetCalories = null;
      }

      setLogs(logPayload.logs);
      setSummary(logPayload.summary);
      setExercises(exercisePayload.exercises);
      setExerciseSummary(exercisePayload.summary);
      setDailyTarget(targetPayload.profile);
      setPreviousDayNetCalories(nextPreviousDayNetCalories);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert('加载失败', normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [onAuthInvalid, selectedDate, token]);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const payload = await apiRequest<{ month: string; days: CalendarDaySummary[] }>(
        `/api/logs/calendar?month=${selectedMonth}`,
        {},
        token,
      );
      const nextStats: Record<string, CalendarDaySummary> = {};
      for (const day of payload.days) {
        nextStats[day.date] = day;
      }
      setMonthStats(nextStats);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert('加载日历失败', normalizeErrorMessage(error));
    } finally {
      setCalendarLoading(false);
    }
  }, [onAuthInvalid, selectedMonth, token]);

  const openEditLogModal = useCallback(
    (log: FoodLog) => {
      const nextVisibility: Visibility =
        log.visibility === 'FRIENDS' || log.visibility === 'PUBLIC' || log.visibility === 'PRIVATE'
          ? log.visibility
          : 'PRIVATE';
      setEditLogId(log.id);
      setEditNote(log.note?.trim() ?? summarizeFoodFromLog(log));
      setEditCalories(String(Number(log.calories ?? 0)));
      setEditProtein(String(Number(log.proteinGram ?? 0)));
      setEditCarbs(String(Number(log.carbsGram ?? 0)));
      setEditFat(String(Number(log.fatGram ?? 0)));
      setEditFiber(String(Number(log.fiberGram ?? 0)));
      setEditDate(toLocalDateInput(log.loggedAt));
      setEditTime(toLocalTimeInput(log.loggedAt));
      setEditVisibility(nextVisibility);
    },
    [],
  );

  const deleteLogRecord = useCallback(
    async (log: FoodLog) => {
      try {
        await apiRequest(
          `/api/logs/${log.id}`,
          {
            method: 'DELETE',
          },
          token,
        );
        if (detailLogId === log.id) {
          setDetailLogId(null);
        }
        if (editLogId === log.id) {
          resetEditState();
        }
        await Promise.all([load(), loadCalendar()]);
      } catch (error) {
        if (isUnauthorizedError(error)) {
          onAuthInvalid();
          return;
        }
        Alert.alert('删除失败', normalizeErrorMessage(error));
      }
    },
    [detailLogId, editLogId, load, loadCalendar, onAuthInvalid, resetEditState, token],
  );

  const openLogMoreActions = useCallback(
    (log: FoodLog) => {
      const summaryText = summarizeFoodFromLog(log);
      Alert.alert('更多操作', summaryText || '请选择操作', [
        { text: '取消', style: 'cancel' },
        { text: '编辑条目', onPress: () => openEditLogModal(log) },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            Alert.alert('确认删除', '删除后无法恢复，确定要删除这条记录吗？', [
              { text: '取消', style: 'cancel' },
              { text: '删除', style: 'destructive', onPress: () => void deleteLogRecord(log) },
            ]);
          },
        },
      ]);
    },
    [deleteLogRecord, openEditLogModal],
  );

  const openEditExerciseModal = useCallback((exercise: ExerciseLog) => {
    const nextIntensity: ExerciseIntensity =
      exercise.intensity === 'LOW' || exercise.intensity === 'HIGH' || exercise.intensity === 'MODERATE'
        ? exercise.intensity
        : 'MODERATE';
    const nextVisibility: Visibility =
      exercise.visibility === 'FRIENDS' || exercise.visibility === 'PUBLIC' || exercise.visibility === 'PRIVATE'
        ? exercise.visibility
        : 'PRIVATE';
    setEditExerciseId(exercise.id);
    setEditExerciseType(exercise.exerciseType || '运动');
    setEditExerciseNote(exercise.note?.trim() ?? '');
    setEditExerciseDuration(String(Number(exercise.durationMin ?? 0)));
    setEditExerciseCalories(String(Number(exercise.calories ?? 0)));
    setEditExerciseMet(String(Number(exercise.met ?? 1)));
    setEditExerciseDate(toLocalDateInput(exercise.loggedAt));
    setEditExerciseTime(toLocalTimeInput(exercise.loggedAt));
    setEditExerciseIntensity(nextIntensity);
    setEditExerciseVisibility(nextVisibility);
  }, []);

  const deleteExerciseRecord = useCallback(
    async (exercise: ExerciseLog) => {
      try {
        await apiRequest(
          `/api/exercises/${exercise.id}`,
          {
            method: 'DELETE',
          },
          token,
        );
        if (editExerciseId === exercise.id) {
          resetExerciseEditState();
        }
        if (detailExerciseId === exercise.id) {
          setDetailExerciseId(null);
        }
        await load();
      } catch (error) {
        if (isUnauthorizedError(error)) {
          onAuthInvalid();
          return;
        }
        Alert.alert('删除失败', normalizeErrorMessage(error));
      }
    },
    [detailExerciseId, editExerciseId, load, onAuthInvalid, resetExerciseEditState, token],
  );

  const openExerciseMoreActions = useCallback(
    (exercise: ExerciseLog) => {
      Alert.alert('更多操作', exercise.exerciseType || '运动记录', [
        { text: '取消', style: 'cancel' },
        { text: '编辑运动', onPress: () => openEditExerciseModal(exercise) },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            Alert.alert('确认删除', '删除后无法恢复，确定要删除这条运动记录吗？', [
              { text: '取消', style: 'cancel' },
              { text: '删除', style: 'destructive', onPress: () => void deleteExerciseRecord(exercise) },
            ]);
          },
        },
      ]);
    },
    [deleteExerciseRecord, openEditExerciseModal],
  );

  const closeEditModal = useCallback(() => {
    if (savingEdit) {
      return;
    }
    resetEditState();
  }, [resetEditState, savingEdit]);

  const closeExerciseEditModal = useCallback(() => {
    if (savingExerciseEdit) {
      return;
    }
    resetExerciseEditState();
  }, [resetExerciseEditState, savingExerciseEdit]);

  const saveEditedLog = useCallback(async () => {
    if (!editLogId) {
      return;
    }
    const targetLog = logs.find((item) => item.id === editLogId);
    if (!targetLog) {
      Alert.alert('提示', '记录不存在，请刷新后重试。');
      resetEditState();
      return;
    }

    const toNumberOr = (raw: string, fallback: number) => {
      const normalized = raw.trim().replace(',', '.');
      const value = Number(normalized);
      return Number.isFinite(value) ? value : fallback;
    };

    setSavingEdit(true);
    try {
      const nextLoggedAt = mergeDateAndTimeToIso(editDate, editTime, targetLog.loggedAt);
      const nextSelectedDate = toLogDate(nextLoggedAt);
      await apiRequest(
        `/api/logs/${targetLog.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            loggedAt: nextLoggedAt,
            mealType: targetLog.mealType,
            source: targetLog.source,
            visibility: editVisibility,
            imageUri: targetLog.imageUri ?? undefined,
            note: editNote.trim() || summarizeFoodFromLog(targetLog),
            calories: Number(toNumberOr(editCalories, Number(targetLog.calories ?? 0)).toFixed(1)),
            proteinGram: Number(toNumberOr(editProtein, Number(targetLog.proteinGram ?? 0)).toFixed(1)),
            carbsGram: Number(toNumberOr(editCarbs, Number(targetLog.carbsGram ?? 0)).toFixed(1)),
            fatGram: Number(toNumberOr(editFat, Number(targetLog.fatGram ?? 0)).toFixed(1)),
            fiberGram: Number(toNumberOr(editFiber, Number(targetLog.fiberGram ?? 0)).toFixed(1)),
            sugarGram: Number(targetLog.sugarGram ?? targetLog.nutrients?.sugarGram ?? 0),
            sodiumMg: Number(targetLog.sodiumMg ?? targetLog.nutrients?.sodiumMg ?? 0),
            nutrients: targetLog.nutrients ?? undefined,
            items: targetLog.items,
            aiProvider: targetLog.aiProvider ?? undefined,
            aiModel: targetLog.aiModel ?? undefined,
            aiRoute: targetLog.aiRoute ?? undefined,
          }),
        },
        token,
      );

      resetEditState();
      if (/^\d{4}-\d{2}-\d{2}$/.test(nextSelectedDate) && nextSelectedDate !== selectedDate) {
        setSelectedDate(nextSelectedDate);
        setSelectedMonth(toMonthString(nextSelectedDate));
        await loadCalendar();
      } else {
        await Promise.all([load(), loadCalendar()]);
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert('保存失败', normalizeErrorMessage(error));
    } finally {
      setSavingEdit(false);
    }
  }, [
    editCalories,
    editCarbs,
    editDate,
    editFat,
    editFiber,
    editLogId,
    editNote,
    editProtein,
    editTime,
    editVisibility,
    load,
    loadCalendar,
    logs,
    onAuthInvalid,
    resetEditState,
    selectedDate,
    token,
  ]);

  const saveEditedExercise = useCallback(async () => {
    if (!editExerciseId) {
      return;
    }
    const targetExercise = exercises.find((item) => item.id === editExerciseId);
    if (!targetExercise) {
      Alert.alert('提示', '运动记录不存在，请刷新后重试。');
      resetExerciseEditState();
      return;
    }

    const toNumberOr = (raw: string, fallback: number) => {
      const normalized = raw.trim().replace(',', '.');
      const value = Number(normalized);
      return Number.isFinite(value) ? value : fallback;
    };

    const nextExerciseType = editExerciseType.trim() || targetExercise.exerciseType || '运动';
    const nextDuration = Number(toNumberOr(editExerciseDuration, Number(targetExercise.durationMin ?? 1)).toFixed(1));
    const nextCalories = Number(toNumberOr(editExerciseCalories, Number(targetExercise.calories ?? 0)).toFixed(1));
    const nextMet = Number(toNumberOr(editExerciseMet, Number(targetExercise.met ?? 1)).toFixed(1));

    if (nextDuration < 1) {
      Alert.alert('提示', '运动时长至少 1 分钟。');
      return;
    }
    if (nextMet < 1) {
      Alert.alert('提示', 'MET 至少为 1。');
      return;
    }

    setSavingExerciseEdit(true);
    try {
      const nextLoggedAt = mergeDateAndTimeToIso(editExerciseDate, editExerciseTime, targetExercise.loggedAt);
      const nextSelectedDate = toLogDate(nextLoggedAt);
      await apiRequest(
        `/api/exercises/${targetExercise.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            loggedAt: nextLoggedAt,
            exerciseType: nextExerciseType,
            durationMin: nextDuration,
            intensity: editExerciseIntensity,
            met: nextMet,
            calories: nextCalories,
            note: editExerciseNote.trim() || undefined,
            source: targetExercise.source,
            visibility: editExerciseVisibility,
            aiProvider: targetExercise.aiProvider ?? undefined,
            aiModel: targetExercise.aiModel ?? undefined,
            aiRoute: targetExercise.aiRoute ?? undefined,
          }),
        },
        token,
      );

      resetExerciseEditState();
      if (/^\d{4}-\d{2}-\d{2}$/.test(nextSelectedDate) && nextSelectedDate !== selectedDate) {
        setSelectedDate(nextSelectedDate);
        setSelectedMonth(toMonthString(nextSelectedDate));
      } else {
        await load();
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert('保存失败', normalizeErrorMessage(error));
    } finally {
      setSavingExerciseEdit(false);
    }
  }, [
    editExerciseCalories,
    editExerciseDate,
    editExerciseDuration,
    editExerciseId,
    editExerciseIntensity,
    editExerciseMet,
    editExerciseNote,
    editExerciseTime,
    editExerciseType,
    editExerciseVisibility,
    exercises,
    load,
    onAuthInvalid,
    resetExerciseEditState,
    selectedDate,
    token,
  ]);

  const sendConversationMessage = useCallback(async () => {
    const currentInput = conversationInput.trim();
    const hasImage = Boolean(conversationImageBase64);

    if (!currentInput && !hasImage) {
      Alert.alert('提示', '请先输入内容，或添加一张图片。');
      return;
    }

    setConversationLoading(true);
    try {
      const description = currentInput.slice(0, 1200);
      const persistExerciseAnalysis = async (analysisRaw: ExerciseAnalysis, notePrefix?: string) => {
        const analysis = normalizeExerciseAnalysis(analysisRaw);
        const noteParts = [notePrefix?.trim(), analysis.notes?.trim()].filter(Boolean);
        await apiRequest(
          '/api/exercises',
          {
            method: 'POST',
            body: JSON.stringify({
              loggedAt: buildLoggedAtForSelectedDate(selectedDate),
              exerciseType: analysis.exerciseType,
              durationMin: analysis.durationMin,
              intensity: analysis.intensity,
              met: analysis.met,
              calories: analysis.calories,
              note: noteParts.join('；'),
              source: 'AI',
              visibility: conversationVisibility,
              ...aiUsageFromAnalysis(analysis),
            }),
          },
          token,
        );

        setConversationInput('');
        clearConversationImage();
        await Promise.all([load(), loadCalendar()]);
      };

      if (!hasImage && isExerciseIntent(description)) {
        const exercisePayload = await apiRequest<{ analysis: ExerciseAnalysis }>(
          '/api/exercises/analyze',
          {
            method: 'POST',
            body: JSON.stringify({ description }),
          },
          token,
          { timeoutMs: Math.min(ANALYZE_REQUEST_TIMEOUT_MS, 70000) },
        );
        await persistExerciseAnalysis(exercisePayload.analysis, description);
        return;
      }

      if (hasImage) {
        try {
          const exercisePayload = await apiRequest<{ analysis: ExerciseAnalysis }>(
            '/api/exercises/analyze-image',
            {
              method: 'POST',
              body: JSON.stringify({
                imageBase64: conversationImageBase64,
                mimeType: conversationImageMimeType,
                description: description || undefined,
              }),
            },
            token,
            { timeoutMs: Math.min(ANALYZE_REQUEST_TIMEOUT_MS, 90000) },
          );
          await persistExerciseAnalysis(exercisePayload.analysis, description || '运动截图');
          return;
        } catch (exerciseImageError) {
          if (isUnauthorizedError(exerciseImageError)) {
            throw exerciseImageError;
          }

          const explicitlyNotExercise =
            exerciseImageError instanceof ApiRequestError &&
            exerciseImageError.status === 422 &&
            /(不是运动记录|运动信息不足|非运动记录)/.test(exerciseImageError.message);

          if (isExerciseIntent(description) && !explicitlyNotExercise) {
            throw exerciseImageError;
          }
        }
      }

      let usedTextFallback = false;
      let usedLocalFallback = false;
      let payload: { analysis: NutritionAnalysis };

      if (hasImage) {
        try {
          payload = await apiRequest<{ analysis: NutritionAnalysis }>(
            '/api/nutrition/analyze-image',
            {
              method: 'POST',
              body: JSON.stringify({
                imageBase64: conversationImageBase64,
                mimeType: conversationImageMimeType,
                description: description || undefined,
              }),
            },
            token,
            { timeoutMs: Math.min(ANALYZE_REQUEST_TIMEOUT_MS, 85000) },
          );
        } catch (imageError) {
          if (isUnauthorizedError(imageError)) {
            throw imageError;
          }
          if (!currentInput) {
            throw imageError;
          }
          try {
            payload = await apiRequest<{ analysis: NutritionAnalysis }>(
              '/api/nutrition/analyze-text',
              {
                method: 'POST',
                body: JSON.stringify({ description: currentInput }),
              },
              token,
              { timeoutMs: Math.min(ANALYZE_REQUEST_TIMEOUT_MS, 70000) },
            );
            usedTextFallback = true;
          } catch (textError) {
            if (isUnauthorizedError(textError)) {
              throw textError;
            }
            payload = { analysis: estimateFromDescription(currentInput || description, true) };
            usedTextFallback = true;
            usedLocalFallback = true;
          }
        }
      } else {
        try {
          payload = await apiRequest<{ analysis: NutritionAnalysis }>(
            '/api/nutrition/analyze-text',
            {
              method: 'POST',
              body: JSON.stringify({ description }),
            },
            token,
            { timeoutMs: Math.min(ANALYZE_REQUEST_TIMEOUT_MS, 70000) },
          );
        } catch (textError) {
          if (isUnauthorizedError(textError)) {
            throw textError;
          }
          if (!currentInput && !description) {
            throw textError;
          }
          if (!isTimeoutLikeError(textError)) {
            throw textError;
          }
          payload = { analysis: estimateFromDescription(currentInput || description, false) };
          usedLocalFallback = true;
        }
      }

      const analysis = normalizeClientAnalysis(payload.analysis);
      const normalized = buildPersistedNutritionFromAnalysis(analysis);
      const itemNames = analysis.items
        .map((item) => item.name.trim())
        .filter((name) => name.length > 0)
        .slice(0, 6)
        .join('、');
      const baseNote = currentInput || (itemNames ? `识别内容：${itemNames}` : '对话记录');
      const note = usedLocalFallback
        ? `${baseNote}（AI 超时，已本地估算）`
        : usedTextFallback
          ? `${baseNote}（图片未成功解析，已按文字估算）`
          : baseNote;

      await apiRequest(
        '/api/logs',
        {
          method: 'POST',
          body: JSON.stringify({
            loggedAt: buildLoggedAtForSelectedDate(selectedDate),
            mealType: inferMealTypeForDate(selectedDate),
            source: 'AI',
            visibility: conversationVisibility,
            imageUri: conversationImageUri ?? undefined,
            note,
            calories: normalized.calories,
            proteinGram: normalized.proteinGram,
            carbsGram: normalized.carbsGram,
            fatGram: normalized.fatGram,
            fiberGram: normalized.fiberGram,
            sugarGram: normalized.sugarGram,
            sodiumMg: normalized.sodiumMg,
            nutrients: normalized.nutrients,
            items: analysis.items,
            ...aiUsageFromAnalysis(analysis),
          }),
        },
        token,
      );

      setConversationInput('');
      clearConversationImage();
      await Promise.all([load(), loadCalendar()]);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      if (isEndpointNotFound(error) && isExerciseIntent(conversationInput.trim())) {
        Alert.alert(
          '后端未升级',
          '当前后端还没有运动识别接口。请把最新 server 代码推送到 GitHub，并等待 Railway 重新部署完成后再试。',
        );
        return;
      }
      Alert.alert('发送失败', normalizeErrorMessage(error));
    } finally {
      setConversationLoading(false);
    }
  }, [
    clearConversationImage,
    conversationImageBase64,
    conversationImageMimeType,
    conversationImageUri,
    conversationInput,
    conversationVisibility,
    load,
    loadCalendar,
    onAuthInvalid,
    selectedDate,
    token,
  ]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    setSelectedMonth(toMonthString(selectedDate));
  }, [selectedDate]);

  const remainCalories = useMemo(() => {
    if (!dailyTarget?.targetCalories) {
      return null;
    }
    return Math.round(dailyTarget.targetCalories - summary.calories + exerciseSummary.calories);
  }, [dailyTarget?.targetCalories, exerciseSummary.calories, summary.calories]);

  const netCalories = useMemo(
    () => Math.round(Number(summary.calories ?? 0) - Number(exerciseSummary.calories ?? 0)),
    [exerciseSummary.calories, summary.calories],
  );

  const calorieChangeFromPreviousDay = useMemo(() => {
    if (previousDayNetCalories === null) {
      return null;
    }
    return netCalories - previousDayNetCalories;
  }, [netCalories, previousDayNetCalories]);

  const calendarCells = useMemo(() => buildCalendarCells(selectedMonth), [selectedMonth]);
  const weekStripCells = useMemo(() => buildWeekStripCells(selectedDate), [selectedDate]);

  const nutrientCards = useMemo(
    () => [
      { key: 'carbs', label: '碳水', current: summary.carbsGram, target: dailyTarget?.targetCarbsGram, unit: 'g' },
      { key: 'protein', label: '蛋白质', current: summary.proteinGram, target: dailyTarget?.targetProteinGram, unit: 'g' },
      { key: 'fat', label: '脂肪', current: summary.fatGram, target: dailyTarget?.targetFatGram, unit: 'g' },
      { key: 'fiber', label: '纤维', current: summary.fiberGram, target: null, unit: 'g' },
    ],
    [dailyTarget?.targetCarbsGram, dailyTarget?.targetFatGram, dailyTarget?.targetProteinGram, summary],
  );

  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime());
  }, [logs]);

  const sortedJournalEntries = useMemo(() => {
    const foodEntries = logs.map((log) => ({ kind: 'food' as const, id: log.id, loggedAt: log.loggedAt, log }));
    const exerciseEntries = exercises.map((exercise) => ({
      kind: 'exercise' as const,
      id: exercise.id,
      loggedAt: exercise.loggedAt,
      exercise,
    }));
    return [...foodEntries, ...exerciseEntries].sort(
      (a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime(),
    );
  }, [exercises, logs]);

  const detailLog = useMemo(
    () => (detailLogId ? logs.find((item) => item.id === detailLogId) ?? null : null),
    [detailLogId, logs],
  );

  const detailExercise = useMemo(
    () => (detailExerciseId ? exercises.find((item) => item.id === detailExerciseId) ?? null : null),
    [detailExerciseId, exercises],
  );

  useEffect(() => {
    if (detailLogId && !detailLog) {
      setDetailLogId(null);
    }
  }, [detailLog, detailLogId]);

  useEffect(() => {
    if (detailExerciseId && !detailExercise) {
      setDetailExerciseId(null);
    }
  }, [detailExercise, detailExerciseId]);

  const detailItems = useMemo(() => parseLogItems(detailLog?.items), [detailLog?.items]);

  const detailNutrientRows = useMemo(() => {
    if (!detailLog) {
      return [] as Array<{ label: string; value: string }>;
    }
    const carbs = Number(detailLog.carbsGram ?? 0);
    const fiber = Number(detailLog.fiberGram ?? 0);
    const nutrients = getLogNutrients(detailLog);
    return [
      { label: '总碳水化合物', value: formatGram(carbs) },
      { label: '膳食纤维', value: formatGram(fiber) },
      { label: '糖', value: formatGram(nutrients.sugarGram) },
      { label: '添加糖', value: formatGram(nutrients.addedSugarGram) },
      { label: '糖醇', value: formatGram(nutrients.sugarAlcoholGram) },
      { label: '净碳水化合物', value: formatGram(Math.max(carbs - fiber, 0)) },
      { label: '蛋白质', value: formatGram(detailLog.proteinGram) },
      { label: '总脂肪', value: formatGram(detailLog.fatGram) },
      { label: '饱和脂肪', value: formatGram(nutrients.saturatedFatGram) },
      { label: '反式脂肪', value: formatGram(nutrients.transFatGram) },
      { label: '多不饱和脂肪', value: formatGram(nutrients.polyunsaturatedFatGram) },
      { label: '单不饱和脂肪', value: formatGram(nutrients.monounsaturatedFatGram) },
      { label: '胆固醇', value: formatMg(nutrients.cholesterolMg) },
      { label: '钠', value: formatMg(nutrients.sodiumMg) },
      { label: '钙', value: formatMg(nutrients.calciumMg) },
      { label: '铁', value: formatMg(nutrients.ironMg, 1) },
      { label: '钾', value: formatMg(nutrients.potassiumMg) },
      { label: '维生素 A', value: formatIU(nutrients.vitaminAIU) },
      { label: '维生素 C', value: formatMg(nutrients.vitaminCMg, 1) },
      { label: '维生素 D', value: formatIU(nutrients.vitaminDIU) },
    ];
  }, [detailLog]);

  const detailExerciseRows = useMemo(() => {
    if (!detailExercise) {
      return [] as Array<{ label: string; value: string }>;
    }
    const totalExerciseCalories = Number(exerciseSummary.calories ?? 0);
    const targetCalories = Number(dailyTarget?.targetCalories ?? 0);
    const net = Number(summary.calories ?? 0) - totalExerciseCalories;
    const remain = targetCalories > 0 ? targetCalories - net : null;
    const exerciseShare = totalExerciseCalories > 0 ? (Number(detailExercise.calories ?? 0) / totalExerciseCalories) * 100 : null;
    return [
      { label: '运动类型', value: detailExercise.exerciseType || '运动' },
      { label: '运动强度', value: formatIntensity(detailExercise.intensity) },
      { label: '运动时长', value: `${Math.round(Number(detailExercise.durationMin ?? 0))} 分钟` },
      { label: '估算 MET', value: roundTo(Number(detailExercise.met ?? 0), 1).toString() },
      { label: '本次消耗', value: formatKcal(detailExercise.calories) },
      { label: '占今日运动消耗', value: exerciseShare === null ? '-' : `${clamp(exerciseShare, 0, 100).toFixed(0)}%` },
      { label: '今日食物摄入', value: formatKcal(summary.calories) },
      { label: '今日运动消耗', value: formatKcal(totalExerciseCalories) },
      { label: '今日净摄入', value: formatKcal(net) },
      { label: '目标剩余', value: remain === null ? '-' : formatKcal(remain) },
    ];
  }, [dailyTarget?.targetCalories, detailExercise, exerciseSummary.calories, summary.calories]);

  if (detailExercise) {
    const exerciseHealthText = buildExerciseHealthAnalysis(detailExercise, {
      foodSummary: summary,
      exerciseSummary,
      target: dailyTarget,
    });
    return (
      <SafeAreaView style={styles.journalSafe}>
        <View style={styles.journalContainer}>
          <View style={styles.logDetailHeader}>
            <Pressable style={styles.logDetailBackButton} onPress={() => setDetailExerciseId(null)}>
              <Text style={styles.logDetailBackText}>← 返回</Text>
            </Pressable>
            <Text style={styles.logDetailHeaderTime}>{formatDateTimeLabel(detailExercise.loggedAt)}</Text>
          </View>

          <ScrollView contentContainerStyle={styles.logDetailScrollContent}>
            <View style={styles.logDetailCard}>
              <View style={styles.logDetailTopContent}>
                <Text style={styles.logDetailTitle}>运动：{detailExercise.exerciseType || '运动'}</Text>
                <Text style={styles.logDetailSubtitle}>{detailExercise.note || '无补充描述'}</Text>
              </View>

              <View style={styles.logDetailSummaryRow}>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>消耗</Text>
                  <Text style={styles.logDetailSummaryValue}>{Math.round(Number(detailExercise.calories ?? 0))}</Text>
                </View>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>时长</Text>
                  <Text style={styles.logDetailSummaryValue}>{Math.round(Number(detailExercise.durationMin ?? 0))}分</Text>
                </View>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>强度</Text>
                  <Text style={styles.logDetailSummaryValue}>{formatIntensity(detailExercise.intensity)}</Text>
                </View>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>MET</Text>
                  <Text style={styles.logDetailSummaryValue}>{roundTo(Number(detailExercise.met ?? 0), 1)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.logDetailCard}>
              <Text style={styles.logDetailSectionTitle}>运动分析</Text>
              <Text style={styles.logDetailSectionText}>{exerciseHealthText}</Text>
            </View>

            <View style={styles.logDetailCard}>
              <Text style={styles.logDetailSectionTitle}>运动与当天目标</Text>
              {detailExerciseRows.map((row) => (
                <View key={row.label} style={styles.logDetailNutrientRow}>
                  <Text style={styles.logDetailNutrientLabel}>{row.label}</Text>
                  <Text style={styles.logDetailNutrientValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.logDetailAiFootnote}>{formatAIUsageText(detailExercise)}</Text>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  if (detailLog) {
    const detailHealthText = buildHealthAnalysis(detailLog, dailyTarget);
    return (
      <SafeAreaView style={styles.journalSafe}>
        <View style={styles.journalContainer}>
          <View style={styles.logDetailHeader}>
            <Pressable style={styles.logDetailBackButton} onPress={() => setDetailLogId(null)}>
              <Text style={styles.logDetailBackText}>← 返回</Text>
            </Pressable>
            <Text style={styles.logDetailHeaderTime}>{formatDateTimeLabel(detailLog.loggedAt)}</Text>
          </View>

          <ScrollView contentContainerStyle={styles.logDetailScrollContent}>
            <View style={styles.logDetailCard}>
              <View style={styles.logDetailTop}>
                {detailLog.imageUri ? <Image source={{ uri: detailLog.imageUri }} style={styles.logDetailImage} /> : null}
                <View style={styles.logDetailTopContent}>
                  <Text style={styles.logDetailTitle}>{summarizeFoodFromLog(detailLog)}</Text>
                  <Text style={styles.logDetailSubtitle}>{detailLog.note || '无补充描述'}</Text>
                </View>
              </View>

              {detailItems.length > 0 ? (
                <View style={styles.logDetailItemsList}>
                  {detailItems.map((item, idx) => (
                    <View key={`${item.name}-${idx}`} style={styles.logDetailItemRow}>
                      <Text style={styles.logDetailItemName}>
                        {item.name}
                        {item.estimatedWeightGram ? ` (${Math.round(item.estimatedWeightGram)}g)` : ''}
                      </Text>
                      <Text style={styles.logDetailItemNutrition}>
                        热量 {Math.round(item.calories)} 千卡 · 碳水 {formatGram(item.carbsGram)} · 蛋白质 {formatGram(item.proteinGram)} · 脂肪{' '}
                        {formatGram(item.fatGram)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.logDetailSummaryRow}>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>卡路里</Text>
                  <Text style={styles.logDetailSummaryValue}>{Math.round(detailLog.calories)}</Text>
                </View>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>碳水</Text>
                  <Text style={styles.logDetailSummaryValue}>{formatGram(detailLog.carbsGram)}</Text>
                </View>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>蛋白质</Text>
                  <Text style={styles.logDetailSummaryValue}>{formatGram(detailLog.proteinGram)}</Text>
                </View>
                <View style={styles.logDetailSummaryCell}>
                  <Text style={styles.logDetailSummaryLabel}>脂肪</Text>
                  <Text style={styles.logDetailSummaryValue}>{formatGram(detailLog.fatGram)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.logDetailCard}>
              <Text style={styles.logDetailSectionTitle}>健康分析</Text>
              <Text style={styles.logDetailSectionText}>{detailHealthText}</Text>
            </View>

            <View style={styles.logDetailCard}>
              <Text style={styles.logDetailSectionTitle}>营养成分</Text>
              {detailNutrientRows.map((row) => (
                <View key={row.label} style={styles.logDetailNutrientRow}>
                  <Text style={styles.logDetailNutrientLabel}>{row.label}</Text>
                  <Text style={styles.logDetailNutrientValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.logDetailAiFootnote}>{formatAIUsageText(detailLog)}</Text>
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.journalSafe}>
      <View style={styles.journalContainer}>
        <View style={styles.journalTopBar}>
          <Pressable style={styles.journalDateButton} onPress={() => setCalendarExpanded((prev) => !prev)}>
            <Text style={styles.journalDateText}>{selectedDate === todayDateString() ? '今天' : selectedDate}</Text>
            <Text style={styles.journalDateArrow}>{calendarExpanded ? '▲' : '▼'}</Text>
          </Pressable>
          <Text style={styles.journalRemainText}>{formatSignedKcalChange(calorieChangeFromPreviousDay)}</Text>
        </View>

        {calendarExpanded ? (
          <View style={styles.journalCalendarCard}>
            <View style={styles.cardHeaderRow}>
              <Pressable style={styles.journalMiniButton} onPress={() => setSelectedMonth(shiftMonthString(selectedMonth, -1))}>
                <Text style={styles.journalMiniButtonText}>上月</Text>
              </Pressable>
              <Text style={styles.journalMonthText}>{selectedMonth}</Text>
              <Pressable style={styles.journalMiniButton} onPress={() => setSelectedMonth(shiftMonthString(selectedMonth, 1))}>
                <Text style={styles.journalMiniButtonText}>下月</Text>
              </Pressable>
            </View>
            {calendarLoading ? <Text style={styles.journalMutedText}>日历加载中...</Text> : null}

            <View style={styles.calendarWeekRow}>
              {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
                <View key={label} style={styles.calendarWeekCell}>
                  <Text style={styles.journalWeekLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {calendarCells.map((cell) => {
                const dayStats = monthStats[cell.date];
                const active = cell.date === selectedDate;
                return (
                  <View key={cell.date} style={styles.calendarCell}>
                    <Pressable
                      style={[
                        styles.journalCalendarCell,
                        active && styles.journalCalendarCellActive,
                        !cell.inCurrentMonth && styles.calendarCellButtonMuted,
                      ]}
                      onPress={() => setSelectedDate(cell.date)}
                    >
                      <Text style={[styles.journalCalendarDayText, active && styles.journalCalendarDayTextActive]}>{cell.day}</Text>
                      <Text style={[styles.journalCalendarCalText, active && styles.journalCalendarDayTextActive]}>
                        {dayStats ? Math.round(dayStats.calories) : '-'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.journalWeekStrip}
            contentContainerStyle={styles.journalWeekStripContent}
          >
            {weekStripCells.map((cell) => {
              const active = cell.date === selectedDate;
              return (
                <Pressable
                  key={cell.date}
                  style={[styles.journalWeekChip, active && styles.journalWeekChipActive]}
                  onPress={() => setSelectedDate(cell.date)}
                >
                  <Text style={[styles.journalWeekChipTop, active && styles.journalWeekChipTextActive]}>{cell.weekLabel}</Text>
                  <Text style={[styles.journalWeekChipBottom, active && styles.journalWeekChipTextActive]}>{cell.day}日</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.journalSummaryRow}>
          <View style={styles.journalSummaryCard}>
            <Text style={styles.journalCardTitle}>卡路里</Text>
            <View style={styles.journalStatGrid}>
              <View style={styles.journalStatCell}>
                <Text style={styles.journalStatValue}>{Math.round(summary.calories)}</Text>
                <Text style={styles.journalStatLabel}>食物</Text>
              </View>
              <View style={styles.journalStatCell}>
                <Text style={styles.journalStatValue}>{Math.round(exerciseSummary.calories)}</Text>
                <Text style={styles.journalStatLabel}>锻炼</Text>
              </View>
              <View style={styles.journalStatCell}>
                <Text style={styles.journalStatValue}>{remainCalories === null ? '-' : remainCalories}</Text>
                <Text style={styles.journalStatLabel}>剩余</Text>
              </View>
            </View>
          </View>

          <View style={styles.journalSummaryCard}>
            <Text style={styles.journalCardTitle}>宏量营养</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.journalMacroRow}>
              {nutrientCards.map((item) => {
                const target = item.target && item.target > 0 ? item.target : null;
                return (
                  <View key={item.key} style={styles.journalMacroItem}>
                    <Text style={styles.journalMacroLabel}>{item.label}</Text>
                    <Text style={styles.journalMacroValue}>
                      {Math.round(item.current * 10) / 10}
                      {item.unit}
                      {target ? ` / ${Math.round(target * 10) / 10}${item.unit}` : ''}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>

        <ScrollView style={styles.journalChatList} contentContainerStyle={styles.journalChatListContent}>
          {loading ? <ActivityIndicator size='large' color='#1e5eff' /> : null}

          {!loading && sortedJournalEntries.length === 0 ? (
            <View style={styles.journalEmptyCard}>
              <Text style={styles.journalEmptyTitle}>今天还没有记录</Text>
              <Text style={styles.journalEmptyText}>可在下方输入饮食或运动描述，系统会自动识别并生成记录卡片。</Text>
            </View>
          ) : null}

          {sortedJournalEntries.map((entry) => {
            if (entry.kind === 'exercise') {
              const exercise = entry.exercise;
              return (
                <View key={`exercise-${exercise.id}`} style={styles.journalEntryCard}>
                  <Pressable
                    style={styles.journalEntryMain}
                    onPress={() => {
                      setDetailLogId(null);
                      setDetailExerciseId(exercise.id);
                    }}
                  >
                    <View style={styles.journalEntryTextWrap}>
                      <Text style={styles.journalEntryTitle}>运动：{exercise.exerciseType}</Text>
                      {exercise.note ? <Text style={styles.journalEntryNote}>{exercise.note}</Text> : null}
                    </View>
                    <View style={styles.journalEntryMetrics}>
                      <Text style={styles.journalEntryMetric}>消耗 {Math.round(exercise.calories)} 千卡</Text>
                      <Text style={styles.journalEntryMetric}>时长 {Math.round(exercise.durationMin)} 分钟</Text>
                      <Text style={styles.journalEntryMetric}>{formatIntensity(exercise.intensity)}</Text>
                      <Text style={styles.journalEntryMetric}>MET {Math.round(exercise.met * 10) / 10}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.journalEntryFooter}>
                    <Text style={styles.journalEntryTime}>{formatClockTime(exercise.loggedAt)}</Text>
                    <View style={styles.journalEntryActions}>
                      <Pressable style={styles.journalEntryActionButton} onPress={() => openEditExerciseModal(exercise)}>
                        <Text style={styles.journalEntryActionText}>编辑</Text>
                      </Pressable>
                      <Pressable style={styles.journalEntryActionButton} onPress={() => openExerciseMoreActions(exercise)}>
                        <Text style={styles.journalEntryActionText}>更多</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            }
            const log = entry.log;
            const items = parseLogItems(log.items);
            return (
              <View key={`food-${log.id}`} style={styles.journalEntryCard}>
                <Pressable
                  style={styles.journalEntryMain}
                  onPress={() => {
                    setDetailExerciseId(null);
                    setDetailLogId(log.id);
                  }}
                >
                  <View style={styles.journalEntryTop}>
                    {log.imageUri ? <Image source={{ uri: log.imageUri }} style={styles.journalEntryImage} /> : null}
                    <View style={styles.journalEntryTextWrap}>
                      <Text style={styles.journalEntryTitle}>{summarizeFoodFromLog(log)}</Text>
                      {log.note ? <Text style={styles.journalEntryNote}>{log.note}</Text> : null}
                    </View>
                  </View>

                  {items.length > 0 ? (
                    <View style={styles.journalEntryItems}>
                      {items.slice(0, 3).map((item, index) => (
                        <Text key={`${item.name}-${index}`} style={styles.journalEntryItemText}>
                          {item.name} · 热量 {Math.round(item.calories)} · 碳水 {formatGram(item.carbsGram)} · 蛋白质 {formatGram(item.proteinGram)}
                        </Text>
                      ))}
                      {items.length > 3 ? <Text style={styles.journalEntryMoreHint}>点击查看全部 {items.length} 项</Text> : null}
                    </View>
                  ) : null}

                  <View style={styles.journalEntryMetrics}>
                    <Text style={styles.journalEntryMetric}>热量 {Math.round(log.calories)} 千卡</Text>
                    <Text style={styles.journalEntryMetric}>碳水 {formatGram(log.carbsGram)}</Text>
                    <Text style={styles.journalEntryMetric}>蛋白质 {formatGram(log.proteinGram)}</Text>
                    <Text style={styles.journalEntryMetric}>脂肪 {formatGram(log.fatGram)}</Text>
                  </View>
                </Pressable>

                <View style={styles.journalEntryFooter}>
                  <Text style={styles.journalEntryTime}>{formatClockTime(log.loggedAt)}</Text>
                  <View style={styles.journalEntryActions}>
                    <Pressable style={styles.journalEntryActionButton} onPress={() => openEditLogModal(log)}>
                      <Text style={styles.journalEntryActionText}>编辑</Text>
                    </Pressable>
                    <Pressable style={styles.journalEntryActionButton} onPress={() => openLogMoreActions(log)}>
                      <Text style={styles.journalEntryActionText}>更多</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {conversationImageUri ? (
          <View style={styles.journalPendingImageWrap}>
            <Image source={{ uri: conversationImageUri }} style={styles.journalPendingImage} />
            <Pressable style={styles.journalPendingRemove} onPress={clearConversationImage}>
              <Text style={styles.journalPendingRemoveText}>移除图片</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.journalComposerRow}>
          <Pressable style={styles.journalMediaButton} onPress={() => void pickConversationImage('library')}>
            <Text style={styles.journalMediaButtonText}>🖼</Text>
          </Pressable>
          <Pressable style={styles.journalMediaButton} onPress={() => void pickConversationImage('camera')}>
            <Text style={styles.journalMediaButtonText}>📷</Text>
          </Pressable>
          <TextInput
            style={styles.journalInput}
            value={conversationInput}
            onChangeText={setConversationInput}
            placeholder='你吃了什么或做了什么锻炼？可加图片说明。'
            placeholderTextColor='#8f9bb0'
            multiline
          />
          <Pressable style={styles.journalSendButton} onPress={() => void sendConversationMessage()} disabled={conversationLoading}>
            <Text style={styles.journalSendButtonText}>{conversationLoading ? '发送中' : '发送'}</Text>
          </Pressable>
        </View>

        <View style={styles.journalComposerMetaRow}>
          <Text style={styles.journalMutedText}>可见范围</Text>
          <View style={styles.journalVisibilityRow}>
            {visibilityOptions.map((option) => {
              const active = conversationVisibility === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.journalVisibilityChip, active && styles.journalVisibilityChipActive]}
                  onPress={() => setConversationVisibility(option.value)}
                >
                  <Text style={[styles.journalVisibilityText, active && styles.journalVisibilityTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Modal visible={Boolean(editLogId)} transparent animationType='fade' onRequestClose={closeEditModal}>
          <View style={styles.journalEditModalMask}>
            <View style={styles.journalEditModalCard}>
              <Text style={styles.journalEditModalTitle}>编辑记录</Text>

              <TextInput
                style={[styles.input, styles.journalEditInput]}
                value={editNote}
                onChangeText={setEditNote}
                placeholder='这条记录的描述'
                placeholderTextColor='#8f9bb0'
                multiline
              />

              <View style={styles.journalEditGrid}>
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editDate}
                  onChangeText={setEditDate}
                  placeholder='日期 YYYY-MM-DD'
                  placeholderTextColor='#8f9bb0'
                />
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editTime}
                  onChangeText={setEditTime}
                  placeholder='时间 HH:mm'
                  placeholderTextColor='#8f9bb0'
                />
              </View>

              <View style={styles.journalEditGrid}>
                <TextInput style={[styles.input, styles.journalEditInput]} value={editCalories} onChangeText={setEditCalories} keyboardType='decimal-pad' placeholder='热量(千卡)' placeholderTextColor='#8f9bb0' />
                <TextInput style={[styles.input, styles.journalEditInput]} value={editProtein} onChangeText={setEditProtein} keyboardType='decimal-pad' placeholder='蛋白质(g)' placeholderTextColor='#8f9bb0' />
                <TextInput style={[styles.input, styles.journalEditInput]} value={editCarbs} onChangeText={setEditCarbs} keyboardType='decimal-pad' placeholder='碳水(g)' placeholderTextColor='#8f9bb0' />
                <TextInput style={[styles.input, styles.journalEditInput]} value={editFat} onChangeText={setEditFat} keyboardType='decimal-pad' placeholder='脂肪(g)' placeholderTextColor='#8f9bb0' />
                <TextInput style={[styles.input, styles.journalEditInput]} value={editFiber} onChangeText={setEditFiber} keyboardType='decimal-pad' placeholder='纤维(g)' placeholderTextColor='#8f9bb0' />
              </View>

              <OptionRow label='可见范围' options={visibilityOptions} value={editVisibility} onChange={setEditVisibility} />

              <View style={styles.rowGap}>
                <Pressable style={styles.secondaryButton} onPress={closeEditModal} disabled={savingEdit}>
                  <Text style={styles.secondaryButtonText}>取消</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={() => void saveEditedLog()} disabled={savingEdit}>
                  <Text style={styles.primaryButtonText}>{savingEdit ? '保存中...' : '保存修改'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={Boolean(editExerciseId)} transparent animationType='fade' onRequestClose={closeExerciseEditModal}>
          <View style={styles.journalEditModalMask}>
            <View style={styles.journalEditModalCard}>
              <Text style={styles.journalEditModalTitle}>编辑运动</Text>

              <TextInput
                style={[styles.input, styles.journalEditInput]}
                value={editExerciseType}
                onChangeText={setEditExerciseType}
                placeholder='运动类型，例如跑步、力量训练'
                placeholderTextColor='#8f9bb0'
              />

              <TextInput
                style={[styles.input, styles.journalEditInput]}
                value={editExerciseNote}
                onChangeText={setEditExerciseNote}
                placeholder='备注（可选）'
                placeholderTextColor='#8f9bb0'
                multiline
              />

              <View style={styles.journalEditGrid}>
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editExerciseDate}
                  onChangeText={setEditExerciseDate}
                  placeholder='日期 YYYY-MM-DD'
                  placeholderTextColor='#8f9bb0'
                />
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editExerciseTime}
                  onChangeText={setEditExerciseTime}
                  placeholder='时间 HH:mm'
                  placeholderTextColor='#8f9bb0'
                />
              </View>

              <View style={styles.journalEditGrid}>
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editExerciseDuration}
                  onChangeText={setEditExerciseDuration}
                  keyboardType='decimal-pad'
                  placeholder='时长(分钟)'
                  placeholderTextColor='#8f9bb0'
                />
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editExerciseCalories}
                  onChangeText={setEditExerciseCalories}
                  keyboardType='decimal-pad'
                  placeholder='消耗(千卡)'
                  placeholderTextColor='#8f9bb0'
                />
                <TextInput
                  style={[styles.input, styles.journalEditInput]}
                  value={editExerciseMet}
                  onChangeText={setEditExerciseMet}
                  keyboardType='decimal-pad'
                  placeholder='MET'
                  placeholderTextColor='#8f9bb0'
                />
              </View>

              <OptionRow
                label='强度'
                options={exerciseIntensityOptions}
                value={editExerciseIntensity}
                onChange={setEditExerciseIntensity}
              />
              <OptionRow label='可见范围' options={visibilityOptions} value={editExerciseVisibility} onChange={setEditExerciseVisibility} />

              <View style={styles.rowGap}>
                <Pressable style={styles.secondaryButton} onPress={closeExerciseEditModal} disabled={savingExerciseEdit}>
                  <Text style={styles.secondaryButtonText}>取消</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={() => void saveEditedExercise()} disabled={savingExerciseEdit}>
                  <Text style={styles.primaryButtonText}>{savingExerciseEdit ? '保存中...' : '保存修改'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}
function AnalyzeScreen({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [analysis, setAnalysis] = useState<NutritionAnalysis | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mealType, setMealType] = useState<MealType>("LUNCH");
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  const [analyzeMode, setAnalyzeMode] = useState<AnalyzeMode>("IMAGE");
  const [textDescription, setTextDescription] = useState("");
  const [textSourceNote, setTextSourceNote] = useState("");

  useEffect(() => {
    let active = true;
    const loadPreferredVisibility = async () => {
      try {
        const saved = parseVisibility(await AsyncStorage.getItem(VISIBILITY_PREF_STORAGE_KEY));
        if (active && saved) {
          setVisibility(saved);
        }
      } catch {
        // ignore visibility preference load errors
      }
    };
    void loadPreferredVisibility();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(VISIBILITY_PREF_STORAGE_KEY, visibility);
  }, [visibility]);

  const handleImagePick = useCallback(
    async (mode: "camera" | "library") => {
      if (mode === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("权限不足", "请先在系统设置中允许访问相机。");
          return;
        }
      }

      const result =
        mode === "camera"
          ? await ImagePicker.launchCameraAsync({
              allowsEditing: true,
              quality: 0.5,
              base64: true,
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
            })
          : await ImagePicker.launchImageLibraryAsync({
              allowsEditing: true,
              quality: 0.5,
              base64: true,
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
            });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert("失败", "未获取到图片数据，请重试。");
        return;
      }

      setLoading(true);
      setImageUri(asset.uri);
      setAnalysis(null);
      setTextSourceNote("");

      try {
        const payload = await apiRequest<{ analysis: NutritionAnalysis }>(
          "/api/nutrition/analyze-image",
          {
            method: "POST",
            body: JSON.stringify({
              imageBase64: asset.base64,
              mimeType: asset.mimeType ?? "image/jpeg",
            }),
          },
          token,
          { timeoutMs: ANALYZE_REQUEST_TIMEOUT_MS },
        );
        setAnalysis(normalizeClientAnalysis(payload.analysis));
      } catch (error) {
        Alert.alert("识别失败", normalizeErrorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const handleTextAnalyze = useCallback(async () => {
    const description = textDescription.trim();
    if (!description) {
      Alert.alert("提示", "请先输入本次饮食文字描述。");
      return;
    }

    setLoading(true);
    setImageUri(null);
    setAnalysis(null);
    setTextSourceNote(description);

    try {
      const payload = await apiRequest<{ analysis: NutritionAnalysis }>(
        "/api/nutrition/analyze-text",
        {
          method: "POST",
          body: JSON.stringify({ description }),
        },
        token,
        { timeoutMs: ANALYZE_REQUEST_TIMEOUT_MS },
      );
      setAnalysis(normalizeClientAnalysis(payload.analysis));
    } catch (error) {
      Alert.alert("识别失败", normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [textDescription, token]);

  const saveAnalysis = useCallback(async () => {
    if (!analysis) {
      return;
    }
    const normalized = buildPersistedNutritionFromAnalysis(analysis);

    const itemNames = analysis.items.map((item) => item.name?.trim()).filter((name) => Boolean(name)) as string[];
    const noteParts = [itemNames.length > 0 ? `吃了：${itemNames.join("、")}` : "", textSourceNote ? `描述：${textSourceNote}` : ""]
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const mergedNote = noteParts.length > 0 ? noteParts.join("；") : undefined;

    setLoading(true);
    try {
      await apiRequest(
        "/api/logs",
        {
          method: "POST",
          body: JSON.stringify({
            mealType,
            source: "AI",
            visibility,
            imageUri: imageUri ?? undefined,
            note: mergedNote,
            calories: normalized.calories,
            proteinGram: normalized.proteinGram,
            carbsGram: normalized.carbsGram,
            fatGram: normalized.fatGram,
            fiberGram: normalized.fiberGram,
            sugarGram: normalized.sugarGram,
            sodiumMg: normalized.sodiumMg,
            nutrients: normalized.nutrients,
            items: analysis.items,
            ...aiUsageFromAnalysis(analysis),
          }),
        },
        token,
      );
      Alert.alert("保存成功", "智能识别结果已保存为饮食记录。");
      onSaved();
    } catch (error) {
      Alert.alert("保存失败", normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [analysis, imageUri, mealType, onSaved, textSourceNote, token, visibility]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>智能识别</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>说明：支持图片识别和文字描述两种 AI 估算方式，识别后可直接保存为每日记录。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>识别方式</Text>
          <OptionRow label="方式" options={analyzeModeOptions} value={analyzeMode} onChange={setAnalyzeMode} />

          {analyzeMode === "IMAGE" ? (
            <View style={styles.rowGap}>
              <Pressable style={styles.primaryButton} onPress={() => void handleImagePick("camera")}>
                <Text style={styles.primaryButtonText}>拍照识别</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void handleImagePick("library")}>
                <Text style={styles.secondaryButtonText}>从相册选择</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.textareaInput}
                value={textDescription}
                onChangeText={setTextDescription}
                placeholder="请输入饮食描述，例如：午餐吃了150g鸡胸肉、1碗米饭、半份西兰花"
                placeholderTextColor="#8992a3"
                multiline
              />
              <Pressable style={styles.primaryButton} onPress={() => void handleTextAnalyze()}>
                <Text style={styles.primaryButtonText}>文字估算</Text>
              </Pressable>
            </>
          )}
        </View>

        {imageUri ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>图片预览</Text>
            <Image source={{ uri: imageUri }} style={styles.previewImage} />
          </View>
        ) : null}

        {loading ? <ActivityIndicator size="large" color="#1e5eff" /> : null}

        {analysis ? (
          <View style={styles.card}>
            {(() => {
              const normalized = buildPersistedNutritionFromAnalysis(analysis);
              return (
                <>
            <Text style={styles.cardTitle}>智能识别结果</Text>
            <Text style={styles.metric}>热量：{safeFixed(normalized.calories, 1)} 千卡</Text>
            <Text style={styles.metric}>蛋白质：{safeFixed(normalized.proteinGram, 1)} g</Text>
            <Text style={styles.metric}>碳水：{safeFixed(normalized.carbsGram, 1)} g</Text>
            <Text style={styles.metric}>脂肪：{safeFixed(normalized.fatGram, 1)} g</Text>
            <Text style={styles.metric}>膳食纤维：{safeFixed(normalized.fiberGram, 1)} g</Text>
            <Text style={styles.hint}>置信度：{safeFixed(safeNumber(analysis.confidence, 0) * 100, 0)}%</Text>
            <Text style={styles.hint}>{analysis.notes}</Text>
            {textSourceNote ? <Text style={styles.hint}>本次描述：{textSourceNote}</Text> : null}

            <OptionRow label="餐次" options={mealOptions} value={mealType} onChange={setMealType} />
            <OptionRow label="可见范围" options={visibilityOptions} value={visibility} onChange={setVisibility} />

            {analysis.items.map((item, index) => (
              <View key={`${item.name}-${index}`} style={styles.itemRow}>
                <Text style={styles.logTitle}>{item.name}</Text>
                <Text style={styles.logSub}>
                  {safeFixed(item.calories, 0)} 千卡 · 蛋白质 {safeFixed(item.proteinGram, 1)} / 碳水{" "}
                  {safeFixed(item.carbsGram, 1)} / 脂肪 {safeFixed(item.fatGram, 1)}
                </Text>
              </View>
            ))}

            <Pressable style={styles.primaryButton} onPress={() => void saveAnalysis()}>
              <Text style={styles.primaryButtonText}>保存为饮食记录</Text>
            </Pressable>
                </>
              );
            })()}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TargetsScreen({ token }: { token: string }) {
  const [age, setAge] = useState("25");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("65");
  const [targetWeight, setTargetWeight] = useState("60");
  const [weeklyWeightChange, setWeeklyWeightChange] = useState("0.5");
  const [sex, setSex] = useState<Sex>("MALE");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("MODERATE");
  const [goal, setGoal] = useState<Goal>("LOSE_WEIGHT");
  const [result, setResult] = useState<null | {
    generatedTargets: {
      targetCalories: number;
      targetProteinGram: number;
      targetCarbsGram: number;
      targetFatGram: number;
      bmr?: number;
      tdee?: number;
      targetWeightKg?: number | null;
      weeklyWeightChangeKg?: number | null;
      targetDate?: string | null;
      planNote?: string;
    };
    finalTargets: {
      targetCalories: number;
      targetProteinGram: number;
      targetCarbsGram: number;
      targetFatGram: number;
    };
  }>(null);

  const loadCurrent = useCallback(async () => {
    try {
      const payload = await apiRequest<{
        profile: {
          age: number | null;
          heightCm: number | null;
          weightKg: number | null;
          sex: string | null;
          activityLevel: ActivityLevel | null;
          goal: Goal | null;
          targetWeightKg: number | null;
          weeklyWeightChangeKg: number | null;
        };
      }>("/api/profile/targets", {}, token);

      if (payload.profile.age) {
        setAge(String(payload.profile.age));
      }
      if (payload.profile.heightCm) {
        setHeight(String(payload.profile.heightCm));
      }
      if (payload.profile.weightKg) {
        setWeight(String(payload.profile.weightKg));
      }
      if (payload.profile.targetWeightKg) {
        setTargetWeight(String(payload.profile.targetWeightKg));
      }
      if (payload.profile.weeklyWeightChangeKg) {
        setWeeklyWeightChange(String(payload.profile.weeklyWeightChangeKg));
      }
      if (payload.profile.sex === "MALE" || payload.profile.sex === "FEMALE") {
        setSex(payload.profile.sex);
      }
      if (payload.profile.activityLevel) {
        setActivityLevel(payload.profile.activityLevel);
      }
      if (payload.profile.goal) {
        setGoal(payload.profile.goal);
      }
    } catch {
      // 首次进入时可忽略加载失败。
    }
  }, [token]);

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  const submit = useCallback(async () => {
    try {
      const payload = await apiRequest<{
        generatedTargets: {
          targetCalories: number;
          targetProteinGram: number;
          targetCarbsGram: number;
          targetFatGram: number;
        };
        finalTargets: {
          targetCalories: number;
          targetProteinGram: number;
          targetCarbsGram: number;
          targetFatGram: number;
        };
      }>(
        "/api/profile/targets",
        {
          method: "PUT",
          body: JSON.stringify({
            age: Number(age),
            sex,
            heightCm: Number(height),
            weightKg: Number(weight),
            targetWeightKg: Number(targetWeight),
            weeklyWeightChangeKg: Number(weeklyWeightChange),
            activityLevel,
            goal,
          }),
        },
        token,
      );
      setResult(payload);
    } catch (error) {
      Alert.alert("保存失败", normalizeErrorMessage(error));
    }
  }, [activityLevel, age, goal, height, sex, targetWeight, token, weeklyWeightChange, weight]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>目标设置</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>身体信息</Text>
          <NumberInput value={age} onChangeText={setAge} placeholder="年龄" />
          <NumberInput value={height} onChangeText={setHeight} placeholder="身高（cm）" />
          <NumberInput value={weight} onChangeText={setWeight} placeholder="体重（kg）" />
          <NumberInput value={targetWeight} onChangeText={setTargetWeight} placeholder="目标体重（kg）" />
          <NumberInput value={weeklyWeightChange} onChangeText={setWeeklyWeightChange} placeholder="每周变化（kg，建议 0.25-1.0）" />

          <OptionRow label="性别" options={sexOptions} value={sex} onChange={setSex} />
          <OptionRow label="活动水平" options={activityOptions} value={activityLevel} onChange={setActivityLevel} />
          <OptionRow label="目标" options={goalOptions} value={goal} onChange={setGoal} />
          <Text style={styles.hint}>
            算法采用 Mifflin-St Jeor BMR、活动系数估算 TDEE，并把减重速度限制在较稳妥范围，避免过低热量。
          </Text>

          <Pressable style={styles.primaryButton} onPress={() => void submit()}>
            <Text style={styles.primaryButtonText}>计算并保存目标</Text>
          </Pressable>
        </View>

        {result ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>系统建议目标</Text>
            <Text style={styles.metric}>热量：{result.generatedTargets.targetCalories} 千卡</Text>
            <Text style={styles.metric}>蛋白质：{result.generatedTargets.targetProteinGram} g</Text>
            <Text style={styles.metric}>碳水：{result.generatedTargets.targetCarbsGram} g</Text>
            <Text style={styles.metric}>脂肪：{result.generatedTargets.targetFatGram} g</Text>
            <Text style={styles.metric}>BMR：{result.generatedTargets.bmr ?? "-"} 千卡，TDEE：{result.generatedTargets.tdee ?? "-"} 千卡</Text>
            <Text style={styles.metric}>
              目标体重：{result.generatedTargets.targetWeightKg ?? "-"} kg，每周变化：{result.generatedTargets.weeklyWeightChangeKg ?? "-"} kg
            </Text>
            {result.generatedTargets.targetDate ? <Text style={styles.metric}>预计到达日期：{result.generatedTargets.targetDate}</Text> : null}
            {result.generatedTargets.planNote ? <Text style={styles.hint}>{result.generatedTargets.planNote}</Text> : null}

            <Text style={[styles.cardTitle, { marginTop: 14 }]}>当前生效目标</Text>
            <Text style={styles.metric}>热量：{result.finalTargets.targetCalories} 千卡</Text>
            <Text style={styles.metric}>蛋白质：{result.finalTargets.targetProteinGram} g</Text>
            <Text style={styles.metric}>碳水：{result.finalTargets.targetCarbsGram} g</Text>
            <Text style={styles.metric}>脂肪：{result.finalTargets.targetFatGram} g</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function WeightTrackerScreen({ token }: { token: string }) {
  const [logs, setLogs] = useState<WeightLog[]>([]);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadWeights = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest<{ logs: WeightLog[]; latest: WeightLog | null; changeKg: number }>(
        "/api/weights?limit=120",
        {},
        token,
      );
      setLogs(payload.logs);
      if (!weight && payload.latest?.weightKg) {
        setWeight(String(payload.latest.weightKg));
      }
    } catch (error) {
      if (isEndpointNotFound(error)) {
        setLogs([]);
        return;
      }
      Alert.alert("加载体重失败", normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [token, weight]);

  useEffect(() => {
    void loadWeights();
  }, [loadWeights]);

  const saveWeight = useCallback(async () => {
    const numericWeight = Number(weight.replace(",", "."));
    if (!Number.isFinite(numericWeight)) {
      Alert.alert("提示", "请输入有效体重。");
      return;
    }

    setSaving(true);
    try {
      await apiRequest(
        "/api/weights",
        {
          method: "POST",
          body: JSON.stringify({
            weightKg: numericWeight,
            loggedAt: mergeDateAndTimeToIso(date, formatClockTime(new Date().toISOString()), new Date().toISOString()),
            note: note.trim() || undefined,
          }),
        },
        token,
      );
      setNote("");
      await loadWeights();
      Alert.alert("已保存", "体重已记录，并会用于更新每日目标。");
    } catch (error) {
      if (isEndpointNotFound(error)) {
        Alert.alert(
          "后端未升级",
          "当前后端还没有体重追踪接口。请在 Railway 部署最新 GitHub 提交后再保存体重。",
        );
        return;
      }
      Alert.alert("保存失败", normalizeErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [date, loadWeights, note, token, weight]);

  const ordered = useMemo(() => [...logs].reverse(), [logs]);
  const minWeight = useMemo(() => Math.min(...ordered.map((item) => item.weightKg), Number(weight) || 0), [ordered, weight]);
  const maxWeight = useMemo(() => Math.max(...ordered.map((item) => item.weightKg), Number(weight) || 0), [ordered, weight]);
  const latest = logs[0] ?? null;
  const first = logs.length > 0 ? logs[logs.length - 1] : null;
  const change = latest && first ? Number((latest.weightKg - first.weightKg).toFixed(1)) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>体重追踪</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>新增体重</Text>
          <NumberInput value={weight} onChangeText={setWeight} placeholder="体重（kg）" />
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="日期（YYYY-MM-DD）"
            placeholderTextColor="#8992a3"
          />
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="备注（可选）"
            placeholderTextColor="#8992a3"
          />
          <Pressable style={styles.primaryButton} onPress={() => void saveWeight()} disabled={saving}>
            <Text style={styles.primaryButtonText}>{saving ? "保存中..." : "保存体重"}</Text>
          </Pressable>
          <Text style={styles.hint}>保存后会用最新体重重新计算目标热量与宏量营养。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>趋势</Text>
          {loading ? <ActivityIndicator size="small" color="#1e5eff" /> : null}
          {latest ? (
            <>
              <Text style={styles.metric}>最新：{latest.weightKg} kg</Text>
              <Text style={[styles.metric, change > 0 ? styles.dangerText : undefined]}>
                较最早记录：{change > 0 ? "+" : ""}{change} kg
              </Text>
            </>
          ) : (
            <Text style={styles.hint}>暂无体重记录。</Text>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weightChart}>
            {ordered.slice(-40).map((item) => {
              const span = Math.max(maxWeight - minWeight, 1);
              const height = 28 + ((item.weightKg - minWeight) / span) * 90;
              return (
                <View key={item.id} style={styles.weightBarWrap}>
                  <Text style={styles.weightBarValue}>{item.weightKg}</Text>
                  <View style={[styles.weightBar, { height }]} />
                  <Text style={styles.weightBarDate}>{toLogDate(item.loggedAt).slice(5)}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>最近记录</Text>
          {logs.slice(0, 12).map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.weightKg} kg</Text>
              <Text style={styles.logSub}>
                {toLogDate(item.loggedAt)} {formatClockTime(item.loggedAt)}{item.note ? ` · ${item.note}` : ""}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SocialHomeScreen({
  token,
  user,
  onOpenFriend,
  onOpenFriendList,
  onOpenActions,
  onAuthInvalid,
}: {
  token: string;
  user: AuthUser;
  onOpenFriend: (friend: FriendItem) => void;
  onOpenFriendList: () => void;
  onOpenActions: () => void;
  onAuthInvalid: () => void;
}) {
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [feed, setFeed] = useState<SocialFeedItem[]>([]);
  const [groupFeeds, setGroupFeeds] = useState<Record<string, GroupFeedPost[]>>({});
  const [feedFilter, setFeedFilter] = useState<SocialFilter>({ type: "ALL" });
  const [feedLoading, setFeedLoading] = useState(false);
  const [groupFeedLoading, setGroupFeedLoading] = useState(false);

  const loadAll = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setFeedLoading(true);
    }
    try {
      const [friendsPayload, groupPayload, feedPayload] = await Promise.all([
        apiRequest<{ friends: FriendItem[] }>("/api/friends", {}, token),
        apiRequest<{ memberships: GroupMembership[] }>("/api/groups/my", {}, token),
        apiRequest<{ feed: SocialFeedItem[] }>("/api/feed/friends?limit=20", {}, token),
      ]);
      setFriends(friendsPayload.friends);
      setGroups(groupPayload.memberships);
      setFeed(feedPayload.feed);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("加载失败", normalizeErrorMessage(error));
    } finally {
      if (showLoading) {
        setFeedLoading(false);
      }
    }
  }, [onAuthInvalid, token]);

  useFocusEffect(
    useCallback(() => {
      void loadAll(true);
    }, [loadAll]),
  );

  const loadGroupFeed = useCallback(
    async (groupId: string) => {
      if (!groupId) {
        return;
      }
      setGroupFeedLoading(true);
      try {
        const payload = await apiRequest<{ posts: GroupFeedPost[] }>(`/api/groups/${groupId}/feed`, {}, token);
        setGroupFeeds((prev) => ({ ...prev, [groupId]: payload.posts }));
      } catch (error) {
        if (isUnauthorizedError(error)) {
          onAuthInvalid();
          return;
        }
        Alert.alert("加载群组动态失败", normalizeErrorMessage(error));
      } finally {
        setGroupFeedLoading(false);
      }
    },
    [onAuthInvalid, token],
  );

  useEffect(() => {
    if (feedFilter.type === "FRIEND" && !friends.some((item) => item.id === feedFilter.friendId)) {
      setFeedFilter({ type: "ALL" });
      return;
    }
    if (feedFilter.type === "GROUP" && !groups.some((item) => item.group.id === feedFilter.groupId)) {
      setFeedFilter({ type: "ALL" });
    }
  }, [feedFilter, friends, groups]);

  const selectFriendFilter = useCallback((friendId: string) => {
    setFeedFilter({ type: "FRIEND", friendId });
  }, []);

  const selectGroupFilter = useCallback(
    (groupId: string) => {
      setFeedFilter({ type: "GROUP", groupId });
      if (!groupFeeds[groupId]) {
        void loadGroupFeed(groupId);
      }
    },
    [groupFeeds, loadGroupFeed],
  );

  const openFriendFromName = useCallback(
    (payload: { id: string; displayName: string }) => {
      const matched = friends.find((item) => item.id === payload.id);
      if (matched) {
        onOpenFriend(matched);
        return;
      }
      onOpenFriend({
        id: payload.id,
        displayName: payload.displayName,
        email: "",
      });
    },
    [friends, onOpenFriend],
  );

  const filteredFriendFeed = useMemo(() => {
    if (feedFilter.type === "FRIEND") {
      return feed.filter((item) => item.userId === feedFilter.friendId);
    }
    return feed;
  }, [feed, feedFilter]);

  const selectedGroup = useMemo(() => {
    if (feedFilter.type !== "GROUP") {
      return null;
    }
    return groups.find((item) => item.group.id === feedFilter.groupId)?.group ?? null;
  }, [feedFilter, groups]);

  const selectedGroupFeed = useMemo(() => {
    if (feedFilter.type !== "GROUP") {
      return [];
    }
    return groupFeeds[feedFilter.groupId] ?? [];
  }, [feedFilter, groupFeeds]);

  const currentFilterLabel = useMemo(() => {
    if (feedFilter.type === "ALL") {
      return "全部动态";
    }
    if (feedFilter.type === "FRIEND") {
      const matched = friends.find((item) => item.id === feedFilter.friendId);
      return matched ? `${matched.displayName} 的动态` : "好友动态";
    }
    return selectedGroup ? `${selectedGroup.name} 群动态` : "群组动态";
  }, [feedFilter, friends, selectedGroup]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <View style={styles.dynamicHeaderRow}>
          <View style={styles.dynamicHeaderTextWrap}>
            <Text style={styles.screenTitle}>动态</Text>
            <Text style={styles.hint}>欢迎回来，{user.displayName}</Text>
          </View>
          <View style={styles.dynamicHeaderActionRow}>
            <Pressable style={styles.dynamicCircleButton} onPress={onOpenFriendList}>
              <Text style={styles.dynamicCircleButtonText}>{">"}</Text>
            </Pressable>
            <Pressable style={styles.dynamicCircleButton} onPress={onOpenActions}>
              <Text style={styles.dynamicCircleButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>好友 / 群组筛选</Text>
            <Pressable style={styles.ghostButton} onPress={() => void loadAll(true)}>
              <Text style={styles.ghostButtonText}>刷新</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dynamicFilterRow}
          >
            <Pressable
              style={[styles.dynamicFilterChip, feedFilter.type === "ALL" && styles.dynamicFilterChipActive]}
              onPress={() => setFeedFilter({ type: "ALL" })}
            >
              <Text
                style={[
                  styles.dynamicFilterChipText,
                  feedFilter.type === "ALL" && styles.dynamicFilterChipTextActive,
                ]}
              >
                全部
              </Text>
            </Pressable>
            {friends.map((friend) => (
              <Pressable
                key={friend.id}
                style={[
                  styles.dynamicFilterChip,
                  feedFilter.type === "FRIEND" &&
                    feedFilter.friendId === friend.id &&
                    styles.dynamicFilterChipActive,
                ]}
                onPress={() => selectFriendFilter(friend.id)}
              >
                <Text
                  style={[
                    styles.dynamicFilterChipText,
                    feedFilter.type === "FRIEND" &&
                      feedFilter.friendId === friend.id &&
                      styles.dynamicFilterChipTextActive,
                  ]}
                >
                  {friend.displayName}
                </Text>
              </Pressable>
            ))}
            {groups.map((item) => (
              <Pressable
                key={item.group.id}
                style={[
                  styles.dynamicFilterChip,
                  styles.dynamicFilterChipGroup,
                  feedFilter.type === "GROUP" &&
                    feedFilter.groupId === item.group.id &&
                    styles.dynamicFilterChipActive,
                ]}
                onPress={() => selectGroupFilter(item.group.id)}
              >
                <Text
                  style={[
                    styles.dynamicFilterChipText,
                    feedFilter.type === "GROUP" &&
                      feedFilter.groupId === item.group.id &&
                      styles.dynamicFilterChipTextActive,
                  ]}
                >
                  {item.group.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.hint}>点击昵称可进入好友详情；点击右上角 “+” 可添加好友和管理群组。</Text>
        </View>

        <View style={[styles.card, styles.highlightCard]}>
          <Text style={styles.cardTitle}>{currentFilterLabel}</Text>

          {feedFilter.type === "GROUP" ? (
            <>
              {groupFeedLoading ? <Text style={styles.hint}>群组动态加载中...</Text> : null}
              {!groupFeedLoading && selectedGroupFeed.length === 0 ? <Text style={styles.hint}>暂无群组动态</Text> : null}
              {selectedGroupFeed.map((item) => {
                const author = item.author ?? { id: "", displayName: "未知用户" };
                const foodLog = item.foodLog;
                const timestamp = item.createdAt ?? foodLog?.loggedAt;
                return (
                  <View key={item.id} style={styles.logRow}>
                    {author.id ? (
                      <Pressable onPress={() => openFriendFromName(author)}>
                        <Text style={styles.dynamicNameLink}>{author.displayName}</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.logTitle}>{author.displayName}</Text>
                    )}
                    {foodLog ? (
                      <>
                        <Text style={styles.logSub}>
                          {formatMealType(foodLog.mealType)} · {Math.round(foodLog.calories)} 千卡
                        </Text>
                        <Text style={styles.logSub}>吃了：{summarizeFood(foodLog.items, foodLog.note)}</Text>
                        <Text style={styles.logSub}>
                          蛋白质 {foodLog.proteinGram} / 碳水 {foodLog.carbsGram} / 脂肪 {foodLog.fatGram}
                        </Text>
                      </>
                    ) : null}
                    {item.message ? <Text style={styles.logSub}>{item.message}</Text> : null}
                    {timestamp ? <Text style={styles.hint}>{new Date(timestamp).toLocaleString()}</Text> : null}
                  </View>
                );
              })}
            </>
          ) : (
            <>
              {feedLoading ? <Text style={styles.hint}>动态加载中...</Text> : null}
              {!feedLoading && filteredFriendFeed.length === 0 ? <Text style={styles.hint}>暂无好友动态</Text> : null}
              {filteredFriendFeed.map((item) => (
                <View key={item.id} style={styles.logRow}>
                  <Pressable onPress={() => openFriendFromName(item.user)}>
                    <Text style={styles.dynamicNameLink}>{item.user.displayName}</Text>
                  </Pressable>
                  <Text style={styles.logSub}>
                    {formatMealType(item.mealType)} · {Math.round(item.calories)} 千卡
                  </Text>
                  <Text style={styles.logSub}>吃了：{summarizeFood(item.items, item.note)}</Text>
                  <Text style={styles.logSub}>
                    蛋白质 {item.proteinGram} / 碳水 {item.carbsGram} / 脂肪 {item.fatGram}
                  </Text>
                  <Text style={styles.hint}>{new Date(item.loggedAt).toLocaleString()}</Text>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FriendListScreen({
  token,
  onOpenFriend,
  onAuthInvalid,
}: {
  token: string;
  onOpenFriend: (friend: FriendItem) => void;
  onAuthInvalid: () => void;
}) {
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest<{ friends: FriendItem[] }>("/api/friends", {}, token);
      setFriends(payload.friends);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("加载好友列表失败", normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [onAuthInvalid, token]);

  useFocusEffect(
    useCallback(() => {
      void loadFriends();
    }, [loadFriends]),
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>好友列表</Text>
        <Text style={styles.hint}>点击好友可查看详细数据与日历。</Text>

        <View style={styles.card}>
          {loading ? <Text style={styles.hint}>加载中...</Text> : null}
          {!loading && friends.length === 0 ? <Text style={styles.hint}>暂无好友，去动态页右上角 “+” 添加。</Text> : null}
          {friends.map((friend) => (
            <Pressable key={friend.id} style={styles.logRow} onPress={() => onOpenFriend(friend)}>
              <Text style={styles.dynamicNameLink}>{friend.displayName}</Text>
              <Text style={styles.logSub}>{friend.email}</Text>
              <Text style={styles.hint}>点击查看好友详情</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DynamicActionsScreen({
  token,
  onAuthInvalid,
  onLogout,
}: {
  token: string;
  onAuthInvalid: () => void;
  onLogout: () => void;
}) {
  const [incoming, setIncoming] = useState<IncomingFriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingFriendRequest[]>([]);
  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [friendEmail, setFriendEmail] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [joinGroupId, setJoinGroupId] = useState("");
  const [shareGroupId, setShareGroupId] = useState("");
  const [shareLogId, setShareLogId] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [requestsPayload, groupPayload] = await Promise.all([
        apiRequest<{ incoming: IncomingFriendRequest[]; outgoing: OutgoingFriendRequest[] }>("/api/friends/requests", {}, token),
        apiRequest<{ memberships: GroupMembership[] }>("/api/groups/my", {}, token),
      ]);

      setIncoming(requestsPayload.incoming);
      setOutgoing(requestsPayload.outgoing);
      setGroups(groupPayload.memberships);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("加载操作中心失败", normalizeErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [onAuthInvalid, token]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );

  const sendRequest = useCallback(async () => {
    if (!friendEmail.trim()) {
      Alert.alert("提示", "请先输入好友邮箱。");
      return;
    }

    try {
      await apiRequest(
        "/api/friends/request",
        {
          method: "POST",
          body: JSON.stringify({ email: friendEmail.trim() }),
        },
        token,
      );
      setFriendEmail("");
      Alert.alert("成功", "好友请求已发送。");
      await loadAll();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("发送失败", normalizeErrorMessage(error));
    }
  }, [friendEmail, loadAll, onAuthInvalid, token]);

  const respondRequest = useCallback(
    async (requestId: string, action: "accept" | "reject") => {
      try {
        await apiRequest(
          `/api/friends/request/${requestId}/respond`,
          {
            method: "POST",
            body: JSON.stringify({ action }),
          },
          token,
        );
        await loadAll();
      } catch (error) {
        if (isUnauthorizedError(error)) {
          onAuthInvalid();
          return;
        }
        Alert.alert("操作失败", normalizeErrorMessage(error));
      }
    },
    [loadAll, onAuthInvalid, token],
  );

  const createGroup = useCallback(async () => {
    if (!groupName.trim()) {
      Alert.alert("提示", "请输入群组名称。");
      return;
    }

    try {
      await apiRequest(
        "/api/groups",
        {
          method: "POST",
          body: JSON.stringify({
            name: groupName.trim(),
            description: groupDescription.trim(),
          }),
        },
        token,
      );
      setGroupName("");
      setGroupDescription("");
      Alert.alert("成功", "群组已创建。");
      await loadAll();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("创建失败", normalizeErrorMessage(error));
    }
  }, [groupDescription, groupName, loadAll, onAuthInvalid, token]);

  const joinGroup = useCallback(async () => {
    if (!joinGroupId.trim()) {
      Alert.alert("提示", "请输入群组编号。");
      return;
    }
    try {
      await apiRequest(
        `/api/groups/${joinGroupId.trim()}/join`,
        {
          method: "POST",
        },
        token,
      );
      setJoinGroupId("");
      Alert.alert("成功", "已加入群组。");
      await loadAll();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("加入失败", normalizeErrorMessage(error));
    }
  }, [joinGroupId, loadAll, onAuthInvalid, token]);

  const shareLogToGroup = useCallback(async () => {
    if (!shareGroupId.trim() || !shareLogId.trim()) {
      Alert.alert("提示", "请填写群组编号和饮食记录编号。");
      return;
    }
    try {
      await apiRequest(
        `/api/groups/${shareGroupId.trim()}/share-log`,
        {
          method: "POST",
          body: JSON.stringify({
            foodLogId: shareLogId.trim(),
            message: shareMessage.trim(),
          }),
        },
        token,
      );
      setShareMessage("");
      Alert.alert("成功", "饮食记录已分享到群组。");
      await loadAll();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("分享失败", normalizeErrorMessage(error));
    }
  }, [loadAll, onAuthInvalid, shareGroupId, shareLogId, shareMessage, token]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>动态操作</Text>
        <Text style={styles.hint}>添加好友、处理请求、创建/加入群组、分享到群组。</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>添加好友</Text>
          <TextInput
            style={styles.input}
            value={friendEmail}
            onChangeText={setFriendEmail}
            placeholder="输入对方注册邮箱"
            placeholderTextColor="#8992a3"
            autoCapitalize="none"
          />
          <Pressable style={styles.primaryButton} onPress={() => void sendRequest()}>
            <Text style={styles.primaryButtonText}>发送好友请求</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>好友请求</Text>
          {loading ? <Text style={styles.hint}>加载中...</Text> : null}

          <Text style={styles.sectionTitle}>收到的请求</Text>
          {incoming.length === 0 ? <Text style={styles.hint}>暂无</Text> : null}
          {incoming.map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.requester.displayName}</Text>
              <Text style={styles.logSub}>{item.requester.email}</Text>
              <View style={styles.rowGap}>
                <Pressable style={styles.secondaryButton} onPress={() => void respondRequest(item.id, "accept")}>
                  <Text style={styles.secondaryButtonText}>接受</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={() => void respondRequest(item.id, "reject")}>
                  <Text style={styles.ghostButtonText}>拒绝</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <Text style={styles.sectionTitle}>已发送请求</Text>
          {outgoing.length === 0 ? <Text style={styles.hint}>暂无</Text> : null}
          {outgoing.map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.receiver.displayName}</Text>
              <Text style={styles.logSub}>{item.receiver.email}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>群组管理</Text>
          <TextInput
            style={styles.input}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="新群组名称"
            placeholderTextColor="#8992a3"
          />
          <TextInput
            style={styles.input}
            value={groupDescription}
            onChangeText={setGroupDescription}
            placeholder="群组描述（可选）"
            placeholderTextColor="#8992a3"
          />
          <Pressable style={styles.primaryButton} onPress={() => void createGroup()}>
            <Text style={styles.primaryButtonText}>创建群组</Text>
          </Pressable>

          <TextInput
            style={styles.input}
            value={joinGroupId}
            onChangeText={setJoinGroupId}
            placeholder="输入群组编号并加入"
            placeholderTextColor="#8992a3"
          />
          <Pressable style={styles.secondaryButton} onPress={() => void joinGroup()}>
            <Text style={styles.secondaryButtonText}>加入群组</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>我的群组（{groups.length}）</Text>
          {groups.length === 0 ? <Text style={styles.hint}>暂无</Text> : null}
          {groups.map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.group.name}</Text>
              <Text style={styles.logSub}>群组编号：{item.group.id}</Text>
              <Text style={styles.logSub}>
                成员 {item.group._count.members} · 动态 {item.group._count.posts} · 角色 {formatRole(item.role)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>分享到群组</Text>
          <TextInput
            style={styles.input}
            value={shareGroupId}
            onChangeText={setShareGroupId}
            placeholder="群组编号"
            placeholderTextColor="#8992a3"
          />
          <TextInput
            style={styles.input}
            value={shareLogId}
            onChangeText={setShareLogId}
            placeholder="饮食记录编号"
            placeholderTextColor="#8992a3"
          />
          <TextInput
            style={styles.input}
            value={shareMessage}
            onChangeText={setShareMessage}
            placeholder="附言（可选）"
            placeholderTextColor="#8992a3"
          />
          <Pressable style={styles.secondaryButton} onPress={() => void shareLogToGroup()}>
            <Text style={styles.secondaryButtonText}>提交分享</Text>
          </Pressable>
        </View>

        <Pressable style={[styles.ghostButton, { marginBottom: 18 }]} onPress={onLogout}>
          <Text style={styles.ghostButtonText}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function FriendDetailScreen({
  token,
  friend,
  onAuthInvalid,
}: {
  token: string;
  friend: FriendItem;
  onAuthInvalid: () => void;
}) {
  const [friendDetail, setFriendDetail] = useState<FriendDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [dayLoading, setDayLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [selectedMonth, setSelectedMonth] = useState(toMonthString(todayDateString()));
  const [monthStats, setMonthStats] = useState<Record<string, CalendarDaySummary>>({});
  const [dayLogs, setDayLogs] = useState<FoodLog[]>([]);
  const [daySummary, setDaySummary] = useState({
    calories: 0,
    proteinGram: 0,
    carbsGram: 0,
    fatGram: 0,
    fiberGram: 0,
  });
  const [legacyApiHint, setLegacyApiHint] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    try {
      const payload = await apiRequest<FriendDetailPayload>(
        `/api/friends/${friend.id}/profile?days=90&limit=20`,
        {},
        token,
      );
      setFriendDetail(payload);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("加载好友详情失败", normalizeErrorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  }, [friend.id, onAuthInvalid, token]);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const payload = await apiRequest<{ month: string; days: CalendarDaySummary[] }>(
        `/api/friends/${friend.id}/calendar?month=${selectedMonth}`,
        {},
        token,
      );

      const nextStats: Record<string, CalendarDaySummary> = {};
      for (const day of payload.days) {
        nextStats[day.date] = day;
      }
      setMonthStats(nextStats);
      setLegacyApiHint(null);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      if (isEndpointNotFound(error)) {
        const fallbackStats = buildMonthStatsFromLogs(friendDetail?.recentLogs ?? [], selectedMonth);
        setMonthStats(fallbackStats);
        setLegacyApiHint(null);
        return;
      }
      Alert.alert("加载好友日历失败", normalizeErrorMessage(error));
    } finally {
      setCalendarLoading(false);
    }
  }, [friend.id, friendDetail?.recentLogs, onAuthInvalid, selectedMonth, token]);

  const loadDayLogs = useCallback(async () => {
    setDayLoading(true);
    try {
      const payload = await apiRequest<{
        logs: FoodLog[];
        summary: { calories: number; proteinGram: number; carbsGram: number; fatGram: number; fiberGram: number };
      }>(`/api/friends/${friend.id}/logs?date=${selectedDate}`, {}, token);

      setDayLogs(payload.logs);
      setDaySummary(payload.summary);
      setLegacyApiHint(null);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      if (isEndpointNotFound(error)) {
        const fallbackLogs = (friendDetail?.recentLogs ?? []).filter((log) => toLogDate(log.loggedAt) === selectedDate);
        setDayLogs(fallbackLogs);
        setDaySummary(summarizeLogs(fallbackLogs));
        setLegacyApiHint(null);
        return;
      }
      Alert.alert("加载好友当日记录失败", normalizeErrorMessage(error));
    } finally {
      setDayLoading(false);
    }
  }, [friend.id, friendDetail?.recentLogs, onAuthInvalid, selectedDate, token]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    void loadDayLogs();
  }, [loadDayLogs]);

  useEffect(() => {
    setSelectedMonth(toMonthString(selectedDate));
  }, [selectedDate]);

  const remainCalories = useMemo(() => {
    if (!friendDetail?.friend.targetCalories) {
      return null;
    }
    return Math.round(friendDetail.friend.targetCalories - daySummary.calories);
  }, [daySummary.calories, friendDetail?.friend.targetCalories]);

  const selectedDayStats = monthStats[selectedDate];
  const previousDayStats = monthStats[shiftDateString(selectedDate, -1)];
  const caloriesChange =
    selectedDayStats && previousDayStats
      ? Math.round(selectedDayStats.calories - previousDayStats.calories)
      : null;

  const calendarCells = useMemo(() => buildCalendarCells(selectedMonth), [selectedMonth]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>好友详情</Text>

        <View style={[styles.card, styles.detailCard]}>
          <Text style={styles.cardTitle}>{friend.displayName}</Text>
          <Text style={styles.logSub}>{friend.email}</Text>
          {detailLoading && !friendDetail ? <Text style={styles.hint}>加载中...</Text> : null}
          {legacyApiHint ? <Text style={styles.hint}>{legacyApiHint}</Text> : null}
          {friendDetail ? (
            <>
              <Text style={styles.metric}>
                近 {friendDetail.stats.days} 天：{friendDetail.stats.logCount} 条，累计 {Math.round(friendDetail.stats.caloriesSum)} 千卡
              </Text>
              <Text style={styles.logSub}>
                目标：热量 {friendDetail.friend.targetCalories ?? "-"}，蛋白质 {friendDetail.friend.targetProteinGram ?? "-"}，
                碳水 {friendDetail.friend.targetCarbsGram ?? "-"}，脂肪 {friendDetail.friend.targetFatGram ?? "-"}
              </Text>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>日历查看</Text>
            <View style={styles.rowGap}>
              <Pressable style={styles.ghostButton} onPress={() => setSelectedMonth(shiftMonthString(selectedMonth, -1))}>
                <Text style={styles.ghostButtonText}>上月</Text>
              </Pressable>
              <Pressable style={styles.ghostButton} onPress={() => setSelectedMonth(shiftMonthString(selectedMonth, 1))}>
                <Text style={styles.ghostButtonText}>下月</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.metric}>{selectedMonth}</Text>
          <Text style={styles.hint}>选中日期：{selectedDate}</Text>
          {caloriesChange !== null ? (
            <Text style={[styles.hint, caloriesChange > 0 ? styles.dangerText : undefined]}>
              较前一天变化：{caloriesChange > 0 ? "+" : ""}
              {caloriesChange} 千卡
            </Text>
          ) : null}
          {calendarLoading ? <Text style={styles.hint}>日历数据加载中...</Text> : null}

          <View style={styles.calendarWeekRow}>
            {["日", "一", "二", "三", "四", "五", "六"].map((week) => (
              <View key={week} style={styles.calendarWeekCell}>
                <Text style={styles.calendarWeekText}>{week}</Text>
              </View>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {calendarCells.map((cell) => {
              const daySummary = monthStats[cell.date];
              const active = cell.date === selectedDate;
              return (
                <View key={cell.date} style={styles.calendarCell}>
                  <Pressable
                    style={[
                      styles.calendarCellButton,
                      active && styles.calendarCellButtonActive,
                      !cell.inCurrentMonth && styles.calendarCellButtonMuted,
                    ]}
                    onPress={() => setSelectedDate(cell.date)}
                  >
                    <Text style={[styles.calendarDayText, active && styles.calendarDayTextActive]}>{cell.day}</Text>
                    <Text style={[styles.calendarCalText, active && styles.calendarCalTextActive]}>
                      {daySummary ? `${Math.round(daySummary.calories)}` : "-"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>{selectedDate} 摄入</Text>
            <View style={styles.rowGap}>
              <Pressable style={styles.ghostButton} onPress={() => setSelectedDate(shiftDateString(selectedDate, -1))}>
                <Text style={styles.ghostButtonText}>前一天</Text>
              </Pressable>
              <Pressable style={styles.ghostButton} onPress={() => setSelectedDate(shiftDateString(selectedDate, 1))}>
                <Text style={styles.ghostButtonText}>后一天</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.metric}>热量：{Math.round(daySummary.calories)} 千卡</Text>
          <Text style={styles.metric}>蛋白质：{daySummary.proteinGram.toFixed(1)} g</Text>
          <Text style={styles.metric}>碳水：{daySummary.carbsGram.toFixed(1)} g</Text>
          <Text style={styles.metric}>脂肪：{daySummary.fatGram.toFixed(1)} g</Text>
          <Text style={styles.metric}>纤维：{daySummary.fiberGram.toFixed(1)} g</Text>
          {remainCalories !== null ? (
            <Text style={[styles.metric, remainCalories < 0 ? styles.dangerText : undefined]}>
              距离目标剩余：{remainCalories > 0 ? `${remainCalories} 千卡` : `超出 ${Math.abs(remainCalories)} 千卡`}
            </Text>
          ) : (
            <Text style={styles.hint}>好友未设置目标热量</Text>
          )}
          {dayLoading ? <Text style={styles.hint}>当日记录加载中...</Text> : null}
          {dayLogs.length === 0 ? <Text style={styles.hint}>该日期暂无可见记录</Text> : null}
          {dayLogs.map((log) => (
            <View key={log.id} style={styles.logRow}>
              <Text style={styles.logTitle}>
                {formatMealType(log.mealType)} · {Math.round(log.calories)} 千卡
              </Text>
              <Text style={styles.logSub}>吃了：{summarizeFoodFromLog(log)}</Text>
              <Text style={styles.logSub}>
                蛋白质 {log.proteinGram} / 碳水 {log.carbsGram} / 脂肪 {log.fatGram}
              </Text>
              <Text style={styles.hint}>{new Date(log.loggedAt).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SocialNavigator({ token, user, onLogout }: { token: string; user: AuthUser; onLogout: () => void }) {
  return (
    <SocialStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0f1724" },
        headerTintColor: "#e9effd",
        contentStyle: { backgroundColor: "#081223" },
      }}
    >
      <SocialStack.Screen name="SocialHome" options={{ headerShown: false }}>
        {({ navigation }) => (
          <SocialHomeScreen
            token={token}
            user={user}
            onOpenFriend={(friend) => navigation.navigate("FriendDetail", { friend })}
            onOpenFriendList={() => navigation.navigate("FriendList")}
            onOpenActions={() => navigation.navigate("DynamicActions")}
            onAuthInvalid={onLogout}
          />
        )}
      </SocialStack.Screen>
      <SocialStack.Screen name="FriendList" options={{ title: "好友列表" }}>
        {({ navigation }) => (
          <FriendListScreen
            token={token}
            onAuthInvalid={onLogout}
            onOpenFriend={(friend) => navigation.navigate("FriendDetail", { friend })}
          />
        )}
      </SocialStack.Screen>
      <SocialStack.Screen name="DynamicActions" options={{ title: "动态操作" }}>
        {() => <DynamicActionsScreen token={token} onAuthInvalid={onLogout} onLogout={onLogout} />}
      </SocialStack.Screen>
      <SocialStack.Screen
        name="FriendDetail"
        options={({ route }) => ({
          title: `好友：${route.params.friend.displayName}`,
        })}
      >
        {({ route }) => <FriendDetailScreen token={token} friend={route.params.friend} onAuthInvalid={onLogout} />}
      </SocialStack.Screen>
    </SocialStack.Navigator>
  );
}

function MainTabs({ auth, onLogout }: { auth: AuthPayload; onLogout: () => void }) {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            height: 62,
            backgroundColor: "#0f1724",
            borderTopColor: "#273245",
          },
          tabBarLabelStyle: {
            color: "#d9e2f5",
            fontSize: 12,
            marginBottom: 6,
          },
        }}
      >
        <Tab.Screen name="记录">{() => <DashboardScreen token={auth.token} onAuthInvalid={onLogout} />}</Tab.Screen>
        <Tab.Screen name="目标">{() => <TargetsScreen token={auth.token} />}</Tab.Screen>
        <Tab.Screen name="体重">{() => <WeightTrackerScreen token={auth.token} />}</Tab.Screen>
        <Tab.Screen name="动态">{() => <SocialNavigator token={auth.token} user={auth.user} onLogout={onLogout} />}</Tab.Screen>
      </Tab.Navigator>
      <StatusBar style="light" />
    </NavigationContainer>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [auth, setAuth] = useState<AuthPayload | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const savedApi = normalizeBaseUrl(await AsyncStorage.getItem(API_BASE_URL_STORAGE_KEY));
        const legacySavedApi = normalizeBaseUrl(await AsyncStorage.getItem(LEGACY_API_BASE_URL_STORAGE_KEY));
        const rawSavedApi = savedApi || legacySavedApi;
        const shouldPreferCloudDefault =
          !!rawSavedApi && isLikelyLocalBaseUrl(rawSavedApi) && !isLikelyLocalBaseUrl(DEFAULT_API_BASE_URL);
        const appliedApi = shouldPreferCloudDefault ? DEFAULT_API_BASE_URL : rawSavedApi || DEFAULT_API_BASE_URL;

        runtimeApiBaseUrl = appliedApi;
        setApiBaseUrl(appliedApi);

        await AsyncStorage.setItem(API_BASE_URL_STORAGE_KEY, appliedApi);
        if (legacySavedApi) {
          await AsyncStorage.removeItem(LEGACY_API_BASE_URL_STORAGE_KEY);
        }

        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) {
          return;
        }

        const cached = JSON.parse(raw) as AuthPayload;
        setAuth(cached);

        try {
          await apiRequest("/api/auth/me", {}, cached.token, { timeoutMs: 12000 });
        } catch (error) {
          if (isUnauthorizedError(error)) {
            await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
            setAuth(null);
          }
        }
      } catch {
        setAuth(null);
      } finally {
        setBooting(false);
      }
    };

    void bootstrap();
  }, []);

  const handleSaveApiBaseUrl = useCallback(async (nextUrl: string) => {
    const normalized = normalizeBaseUrl(nextUrl);
    runtimeApiBaseUrl = normalized;
    setApiBaseUrl(normalized);
    await AsyncStorage.setItem(API_BASE_URL_STORAGE_KEY, normalized);
    await AsyncStorage.removeItem(LEGACY_API_BASE_URL_STORAGE_KEY);
  }, []);

  const handleAuthed = useCallback(async (payload: AuthPayload) => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    setAuth(payload);
  }, []);

  const handleLogout = useCallback(async () => {
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    setAuth(null);
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={styles.safeCenter}>
        <ActivityIndicator size="large" color="#1e5eff" />
        <Text style={styles.hint}>正在初始化...</Text>
      </SafeAreaView>
    );
  }

  if (!auth) {
    return <AuthScreen onAuthed={handleAuthed} apiBaseUrl={apiBaseUrl} onSaveApiBaseUrl={handleSaveApiBaseUrl} />;
  }

  return <MainTabs auth={auth} onLogout={handleLogout} />;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#081223",
  },
  safeCenter: {
    flex: 1,
    backgroundColor: "#081223",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  authContainer: {
    padding: 24,
    gap: 12,
  },
  logo: {
    fontSize: 34,
    fontWeight: "800",
    color: "#f7f9ff",
    marginTop: 8,
  },
  subtitle: {
    color: "#9fb0cc",
    marginBottom: 18,
  },
  modeRow: {
    flexDirection: "row",
    backgroundColor: "#111b2d",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 4,
  },
  modeButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  modeButtonActive: {
    backgroundColor: "#1d2d4f",
  },
  modeText: {
    color: "#9fb0cc",
    fontWeight: "600",
  },
  modeTextActive: {
    color: "#f5f8ff",
  },
  input: {
    backgroundColor: "#0f1a2f",
    color: "#e8edfb",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#273245",
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 8,
  },
  textareaInput: {
    backgroundColor: "#0f1a2f",
    color: "#e8edfb",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#273245",
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 8,
    minHeight: 88,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: "#2667ff",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    marginTop: 10,
    minWidth: 120,
  },
  primaryButtonText: {
    color: "#f8fbff",
    fontWeight: "700",
  },
  secondaryButton: {
    borderColor: "#2b6fff",
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    minWidth: 120,
  },
  secondaryButtonText: {
    color: "#90b4ff",
    fontWeight: "700",
  },
  ghostButton: {
    borderColor: "#314055",
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginTop: 8,
    minWidth: 80,
  },
  ghostButtonText: {
    color: "#a9b7ce",
    fontWeight: "600",
  },
  hint: {
    color: "#93a1bb",
    fontSize: 12,
    marginTop: 6,
  },
  screenContainer: {
    padding: 14,
    gap: 12,
  },
  screenTitle: {
    color: "#f4f7ff",
    fontSize: 26,
    fontWeight: "800",
  },
  dynamicHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  dynamicHeaderTextWrap: {
    flex: 1,
  },
  dynamicHeaderActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  dynamicCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#314055",
    backgroundColor: "#111b2d",
    alignItems: "center",
    justifyContent: "center",
  },
  dynamicCircleButtonText: {
    color: "#d5e3ff",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  dynamicFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  dynamicFilterChip: {
    borderWidth: 1,
    borderColor: "#324562",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#0f1a2f",
  },
  dynamicFilterChipActive: {
    borderColor: "#4f88ff",
    backgroundColor: "#1b2c4e",
  },
  dynamicFilterChipGroup: {
    borderColor: "#3b5377",
  },
  dynamicFilterChipText: {
    color: "#8fa1c0",
    fontSize: 12,
    fontWeight: "600",
  },
  dynamicFilterChipTextActive: {
    color: "#d7e5ff",
  },
  dynamicNameLink: {
    color: "#9ec0ff",
    fontWeight: "800",
    fontSize: 15,
  },
  card: {
    backgroundColor: "#101c31",
    borderColor: "#243146",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  highlightCard: {
    borderColor: "#2f73ff",
    backgroundColor: "#0f2342",
  },
  detailCard: {
    borderColor: "#415677",
  },
  cardTitle: {
    color: "#edf2ff",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 6,
  },
  metric: {
    color: "#d8e3fa",
    marginTop: 3,
    fontSize: 15,
  },
  dangerText: {
    color: "#ff8080",
  },
  sectionBlock: {
    marginTop: 10,
  },
  sectionTitle: {
    color: "#b5c4de",
    marginTop: 8,
    marginBottom: 5,
    fontSize: 13,
    fontWeight: "600",
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  optionChip: {
    borderWidth: 1,
    borderColor: "#324562",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  optionChipActive: {
    borderColor: "#4f88ff",
    backgroundColor: "#1b2c4e",
  },
  optionChipText: {
    color: "#8fa1c0",
    fontSize: 12,
    fontWeight: "600",
  },
  optionChipTextActive: {
    color: "#d7e5ff",
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logRow: {
    borderTopColor: "#243146",
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 8,
  },
  logTitle: {
    color: "#e9effd",
    fontWeight: "700",
  },
  logSub: {
    color: "#9fb0cc",
    marginTop: 2,
    fontSize: 12,
  },
  logImage: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    marginTop: 8,
  },
  rowGap: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  calendarWeekRow: {
    flexDirection: "row",
    marginTop: 10,
  },
  calendarWeekCell: {
    width: "14.285%",
    alignItems: "center",
  },
  calendarWeekText: {
    color: "#8fa1c0",
    fontSize: 12,
    fontWeight: "600",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
  },
  calendarCell: {
    width: "14.285%",
    padding: 2,
  },
  calendarCellButton: {
    borderWidth: 1,
    borderColor: "#2f3e57",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  calendarCellButtonActive: {
    borderColor: "#4f88ff",
    backgroundColor: "#1b2c4e",
  },
  calendarCellButtonMuted: {
    opacity: 0.45,
  },
  calendarDayText: {
    color: "#dce7ff",
    fontWeight: "700",
    fontSize: 12,
  },
  calendarDayTextActive: {
    color: "#f7fbff",
  },
  calendarCalText: {
    marginTop: 2,
    color: "#90a6cb",
    fontSize: 10,
  },
  calendarCalTextActive: {
    color: "#d3e2ff",
  },
  previewImage: {
    width: "100%",
    height: 230,
    borderRadius: 12,
    marginTop: 6,
  },
  chatArea: {
    marginTop: 10,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: "#273245",
    borderRadius: 12,
    padding: 10,
    gap: 8,
    backgroundColor: "#0d1829",
  },
  chatBubble: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  chatBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#1b2c4e",
    maxWidth: "92%",
  },
  chatBubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#132238",
    maxWidth: "100%",
  },
  chatBubbleText: {
    color: "#dce7ff",
    lineHeight: 20,
    fontSize: 13,
  },
  chatAttachmentContainer: {
    marginTop: 8,
    gap: 8,
  },
  chatAttachmentImage: {
    width: "100%",
    height: 180,
    borderRadius: 10,
  },
  itemRow: {
    borderTopColor: "#2b3a53",
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
  },
  journalSafe: {
    flex: 1,
    backgroundColor: "#081223",
  },
  journalContainer: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
  },
  journalTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  journalIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#243146",
    backgroundColor: "#101c31",
    alignItems: "center",
    justifyContent: "center",
  },
  journalIconText: {
    color: "#eaf1ff",
    fontSize: 18,
    fontWeight: "700",
  },
  journalDateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#243146",
    backgroundColor: "#101c31",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  journalDateText: {
    color: "#f5f8ff",
    fontSize: 16,
    fontWeight: "800",
  },
  journalDateArrow: {
    color: "#9eb0cf",
    fontSize: 10,
    fontWeight: "700",
  },
  journalRemainText: {
    marginLeft: "auto",
    color: "#c8d7f3",
    fontSize: 13,
    fontWeight: "700",
  },
  journalHeaderRight: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  journalHeaderMeta: {
    color: "#d2ddf4",
    fontSize: 15,
    fontWeight: "700",
  },
  journalCalendarCard: {
    backgroundColor: "#101c31",
    borderColor: "#243146",
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  journalMiniButton: {
    borderWidth: 1,
    borderColor: "#2f3f59",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  journalMiniButtonText: {
    color: "#adc1e6",
    fontWeight: "700",
    fontSize: 12,
  },
  journalMonthText: {
    color: "#eaf2ff",
    fontWeight: "700",
    fontSize: 13,
  },
  journalMutedText: {
    color: "#8fa2c3",
    fontSize: 12,
  },
  journalWeekLabel: {
    color: "#8fa1c0",
    fontSize: 11,
    fontWeight: "600",
  },
  journalCalendarCell: {
    borderWidth: 1,
    borderColor: "#2f3e57",
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 2,
    backgroundColor: "#0f1a2f",
  },
  journalCalendarCellActive: {
    borderColor: "#4f88ff",
    backgroundColor: "#1b2c4e",
  },
  journalCalendarDayText: {
    color: "#dce7ff",
    fontWeight: "700",
    fontSize: 11,
  },
  journalCalendarDayTextActive: {
    color: "#f7fbff",
  },
  journalCalendarCalText: {
    marginTop: 1,
    color: "#90a6cb",
    fontSize: 9,
  },
  journalWeekStrip: {
    maxHeight: 56,
  },
  journalWeekStripContent: {
    paddingRight: 6,
    alignItems: "center",
    gap: 6,
  },
  journalWeekChip: {
    minWidth: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2f3e57",
    backgroundColor: "#0f1a2f",
    paddingHorizontal: 7,
    paddingVertical: 6,
    alignItems: "center",
  },
  journalWeekChipActive: {
    borderColor: "#4f88ff",
    backgroundColor: "#1b2c4e",
  },
  journalWeekChipTop: {
    color: "#9eb2d5",
    fontSize: 10,
    fontWeight: "700",
  },
  journalWeekChipBottom: {
    color: "#dce7ff",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 0,
  },
  journalWeekChipTextActive: {
    color: "#f6fbff",
  },
  journalSummaryRow: {
    flexDirection: "row",
    gap: 6,
  },
  journalSummaryCard: {
    flex: 1,
    backgroundColor: "#101c31",
    borderColor: "#243146",
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  journalCardTitle: {
    color: "#eaf2ff",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
  },
  journalStatGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  journalStatCell: {
    flex: 1,
    alignItems: "center",
  },
  journalStatValue: {
    color: "#f6fbff",
    fontSize: 16,
    fontWeight: "800",
  },
  journalStatLabel: {
    color: "#8ea0bd",
    marginTop: 1,
    fontSize: 10,
  },
  journalMacroRow: {
    gap: 6,
    paddingRight: 4,
  },
  journalMacroItem: {
    minWidth: 76,
    borderWidth: 1,
    borderColor: "#2c3c57",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    backgroundColor: "#0f1a2f",
  },
  journalMacroLabel: {
    color: "#9eb2d4",
    fontSize: 10,
  },
  journalMacroValue: {
    color: "#f3f8ff",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 1,
  },
  journalChatList: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#243146",
    borderRadius: 12,
    backgroundColor: "#0d182a",
  },
  journalChatListContent: {
    padding: 8,
    gap: 6,
  },
  journalEmptyCard: {
    borderWidth: 1,
    borderColor: "#2b3a54",
    borderRadius: 12,
    backgroundColor: "#12213a",
    padding: 12,
    gap: 6,
  },
  journalEmptyTitle: {
    color: "#edf4ff",
    fontSize: 14,
    fontWeight: "700",
  },
  journalEmptyText: {
    color: "#9fb4d8",
    fontSize: 12,
    lineHeight: 18,
  },
  journalEntryCard: {
    borderWidth: 1,
    borderColor: "#283752",
    borderRadius: 12,
    backgroundColor: "#10203a",
    padding: 10,
    gap: 8,
  },
  journalEntryMain: {
    gap: 8,
  },
  journalEntryTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  journalEntryImage: {
    width: 74,
    height: 74,
    borderRadius: 10,
    backgroundColor: "#182a46",
  },
  journalEntryTextWrap: {
    flex: 1,
    gap: 4,
  },
  journalEntryTitle: {
    color: "#f4f9ff",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  journalEntryNote: {
    color: "#a9bddf",
    fontSize: 12,
    lineHeight: 18,
  },
  journalEntryItems: {
    gap: 5,
    paddingTop: 2,
  },
  journalEntryItemText: {
    color: "#d6e5ff",
    fontSize: 11,
    lineHeight: 16,
  },
  journalEntryMoreHint: {
    color: "#89a9dc",
    fontSize: 11,
    fontWeight: "600",
  },
  journalEntryMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  journalEntryMetric: {
    color: "#dce9ff",
    fontSize: 11,
    backgroundColor: "#1a2e4e",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  journalEntryFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 2,
  },
  journalEntryTime: {
    color: "#93a9cc",
    fontSize: 11,
  },
  journalEntryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  journalEntryActionButton: {
    borderWidth: 1,
    borderColor: "#36507b",
    borderRadius: 8,
    backgroundColor: "#142744",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  journalEntryActionText: {
    color: "#dce9ff",
    fontSize: 11,
    fontWeight: "700",
  },
  journalChatBubble: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    maxWidth: "92%",
  },
  journalChatBubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#1b2c4e",
    borderTopRightRadius: 4,
  },
  journalChatBubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#132338",
    borderTopLeftRadius: 4,
  },
  journalChatImage: {
    width: 150,
    height: 100,
    borderRadius: 6,
  },
  journalChatText: {
    color: "#dce7ff",
    fontSize: 12,
    lineHeight: 17,
  },
  journalPendingImageWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
  },
  journalPendingImage: {
    width: 62,
    height: 62,
    borderRadius: 8,
  },
  journalPendingRemove: {
    borderWidth: 1,
    borderColor: "#385076",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  journalPendingRemoveText: {
    color: "#a9c2ee",
    fontWeight: "700",
  },
  journalEditRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 6,
  },
  journalEditText: {
    color: "#a9c2ee",
    fontSize: 11,
    flex: 1,
  },
  journalEditCancel: {
    borderWidth: 1,
    borderColor: "#39557e",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#132743",
  },
  journalEditCancelText: {
    color: "#d7e7ff",
    fontSize: 11,
    fontWeight: "700",
  },
  journalEditModalMask: {
    flex: 1,
    backgroundColor: "rgba(3, 8, 18, 0.72)",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  journalEditModalCard: {
    borderWidth: 1,
    borderColor: "#2a3a55",
    borderRadius: 14,
    backgroundColor: "#0f1c32",
    padding: 12,
    gap: 10,
  },
  journalEditModalTitle: {
    color: "#f4f9ff",
    fontSize: 16,
    fontWeight: "800",
  },
  journalEditInput: {
    minHeight: 40,
  },
  journalEditGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  journalComposerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  journalMediaButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2d3e5d",
    backgroundColor: "#101c31",
    alignItems: "center",
    justifyContent: "center",
  },
  journalMediaButtonText: {
    color: "#d7e6ff",
    fontSize: 14,
  },
  journalInput: {
    flex: 1,
    minHeight: 34,
    maxHeight: 96,
    borderWidth: 1,
    borderColor: "#29384f",
    borderRadius: 10,
    backgroundColor: "#111b2d",
    color: "#e8f0ff",
    paddingHorizontal: 9,
    paddingVertical: 6,
    textAlignVertical: "top",
    fontSize: 13,
  },
  journalSendButton: {
    minWidth: 58,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#2a6dff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  journalSendButtonText: {
    color: "#f7fbff",
    fontWeight: "800",
    fontSize: 12,
  },
  journalComposerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 30,
  },
  journalVisibilityRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  journalVisibilityChip: {
    borderWidth: 1,
    borderColor: "#324562",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#0f1a2f",
  },
  journalVisibilityChipActive: {
    borderColor: "#4f88ff",
    backgroundColor: "#1b2c4e",
  },
  journalVisibilityText: {
    color: "#8fa1c0",
    fontSize: 11,
    fontWeight: "600",
  },
  journalVisibilityTextActive: {
    color: "#d7e5ff",
  },
  logDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 2,
  },
  logDetailBackButton: {
    borderWidth: 1,
    borderColor: "#2f4464",
    borderRadius: 10,
    backgroundColor: "#101f37",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  logDetailBackText: {
    color: "#dceaff",
    fontSize: 12,
    fontWeight: "700",
  },
  logDetailHeaderTime: {
    color: "#9fb3d7",
    fontSize: 12,
    fontWeight: "600",
  },
  logDetailScrollContent: {
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  logDetailCard: {
    borderWidth: 1,
    borderColor: "#263651",
    borderRadius: 12,
    backgroundColor: "#101f37",
    padding: 10,
    gap: 8,
  },
  logDetailTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  logDetailImage: {
    width: 96,
    height: 96,
    borderRadius: 10,
    backgroundColor: "#172944",
  },
  logDetailTopContent: {
    flex: 1,
    gap: 4,
  },
  logDetailTitle: {
    color: "#f4f9ff",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
  },
  logDetailSubtitle: {
    color: "#a5badf",
    fontSize: 12,
    lineHeight: 18,
  },
  logDetailItemsList: {
    gap: 8,
  },
  logDetailItemRow: {
    borderTopWidth: 1,
    borderTopColor: "#273953",
    paddingTop: 8,
    gap: 3,
  },
  logDetailItemName: {
    color: "#ecf4ff",
    fontSize: 14,
    fontWeight: "700",
  },
  logDetailItemNutrition: {
    color: "#b7caea",
    fontSize: 12,
    lineHeight: 17,
  },
  logDetailSummaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  logDetailSummaryCell: {
    flex: 1,
    backgroundColor: "#132843",
    borderRadius: 10,
    padding: 8,
    gap: 2,
  },
  logDetailSummaryLabel: {
    color: "#9fb6da",
    fontSize: 11,
  },
  logDetailSummaryValue: {
    color: "#f4f9ff",
    fontSize: 16,
    fontWeight: "800",
  },
  logDetailSectionTitle: {
    color: "#f4f9ff",
    fontSize: 15,
    fontWeight: "800",
  },
  logDetailSectionText: {
    color: "#b5c8e6",
    fontSize: 13,
    lineHeight: 20,
  },
  logDetailNutrientRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#2a3a55",
    paddingVertical: 8,
  },
  logDetailNutrientLabel: {
    color: "#d7e5ff",
    fontSize: 13,
  },
  logDetailNutrientValue: {
    color: "#f3f8ff",
    fontSize: 13,
    fontWeight: "700",
  },
  logDetailAiFootnote: {
    color: "#6f819f",
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
    paddingTop: 2,
  },
  weightChart: {
    alignItems: "flex-end",
    gap: 10,
    paddingVertical: 12,
  },
  weightBarWrap: {
    alignItems: "center",
    justifyContent: "flex-end",
    width: 44,
    gap: 5,
  },
  weightBar: {
    width: 18,
    borderRadius: 999,
    backgroundColor: "#4f88ff",
  },
  weightBarValue: {
    color: "#dce7ff",
    fontSize: 11,
    fontWeight: "700",
  },
  weightBarDate: {
    color: "#8fa1c0",
    fontSize: 10,
  },
});
