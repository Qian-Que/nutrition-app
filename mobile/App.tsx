import AsyncStorage from "@react-native-async-storage/async-storage";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const AUTH_STORAGE_KEY = "nutrition_app_auth_v1";
const API_BASE_URL_STORAGE_KEY = "nutrition_app_api_base_url_v1";
const parsedTimeoutMs = Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? 30000);
const API_REQUEST_TIMEOUT_MS = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0 ? parsedTimeoutMs : 30000;

function normalizeBaseUrl(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

const DEFAULT_API_BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000");
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
  };
  confidence: number;
  notes: string;
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
  items?: unknown;
  note?: string;
  imageUri?: string | null;
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

type MealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";
type Sex = "MALE" | "FEMALE";
type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
type Goal = "LOSE_WEIGHT" | "MAINTAIN" | "GAIN_MUSCLE";
type GroupRole = "OWNER" | "ADMIN" | "MEMBER";

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

function formatMealType(value: MealType | string) {
  const found = mealOptions.find((option) => option.value === value);
  return found?.label ?? value;
}

function formatVisibility(value: Visibility | string) {
  const found = visibilityOptions.find((option) => option.value === value);
  return found?.label ?? value;
}

function formatRole(value: GroupRole | string) {
  return roleLabelMap[value as GroupRole] ?? value;
}

function normalizeErrorMessage(error: unknown) {
  const fallback = "请求失败，请稍后重试。";
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.name === "AbortError" || error.message.includes("请求超时")) {
    return "请求超时，请检查网络后重试。若已使用云端接口，请检查 Railway 服务状态与 AI 变量配置。";
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
  const baseUrl = normalizeBaseUrl(runtimeApiBaseUrl);
  if (!baseUrl) {
    throw new ApiRequestError("接口地址未配置");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
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

  return payload as T;
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

  useEffect(() => {
    setApiInput(apiBaseUrl);
  }, [apiBaseUrl]);

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
      </ScrollView>
    </SafeAreaView>
  );
}

function DashboardScreen({
  token,
  refreshKey,
  onAuthInvalid,
}: {
  token: string;
  refreshKey: number;
  onAuthInvalid: () => void;
}) {
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [summary, setSummary] = useState({ calories: 0, proteinGram: 0, carbsGram: 0, fatGram: 0, fiberGram: 0 });
  const [dailyTarget, setDailyTarget] = useState<null | {
    targetCalories: number | null;
    targetProteinGram: number | null;
    targetCarbsGram: number | null;
    targetFatGram: number | null;
  }>(null);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [selectedMonth, setSelectedMonth] = useState(toMonthString(todayDateString()));
  const [monthStats, setMonthStats] = useState<Record<string, CalendarDaySummary>>({});

  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [mealType, setMealType] = useState<MealType>("LUNCH");
  const [manualVisibility, setManualVisibility] = useState<Visibility>("PRIVATE");
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<"MANUAL" | "AI">("MANUAL");
  const [editingLoggedAt, setEditingLoggedAt] = useState<string | null>(null);

  const resetManualForm = useCallback(() => {
    setEditingLogId(null);
    setEditingSource("MANUAL");
    setEditingLoggedAt(null);
    setMealType("LUNCH");
    setManualVisibility("PRIVATE");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
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
          };
        }>("/api/profile/targets", {}, token),
      ]);
      setLogs(logPayload.logs);
      setSummary(logPayload.summary);
      setDailyTarget(targetPayload.profile);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        onAuthInvalid();
        return;
      }
      Alert.alert("加载失败", normalizeErrorMessage(error));
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
      Alert.alert("加载日历失败", normalizeErrorMessage(error));
    } finally {
      setCalendarLoading(false);
    }
  }, [onAuthInvalid, selectedMonth, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar, refreshKey]);

  useEffect(() => {
    const monthFromDate = toMonthString(selectedDate);
    if (monthFromDate !== selectedMonth) {
      setSelectedMonth(monthFromDate);
    }
  }, [selectedDate, selectedMonth]);

  const remainCalories = useMemo(() => {
    if (!dailyTarget?.targetCalories) {
      return null;
    }
    return Math.round(dailyTarget.targetCalories - summary.calories);
  }, [dailyTarget?.targetCalories, summary.calories]);

  const selectedDayStats = monthStats[selectedDate];
  const previousDayStats = monthStats[shiftDateString(selectedDate, -1)];
  const caloriesChange =
    selectedDayStats && previousDayStats
      ? Math.round(selectedDayStats.calories - previousDayStats.calories)
      : null;

  const submitManualLog = useCallback(async () => {
    if (!calories || !protein || !carbs || !fat) {
      Alert.alert("提示", "请完整填写营养数据。");
      return;
    }

    try {
      const loggedAt = editingLoggedAt ?? new Date(`${selectedDate}T12:00:00`).toISOString();
      const path = editingLogId ? `/api/logs/${editingLogId}` : "/api/logs";
      const method = editingLogId ? "PUT" : "POST";

      await apiRequest<{ log: FoodLog }>(
        path,
        {
          method,
          body: JSON.stringify({
            loggedAt,
            mealType,
            source: editingLogId ? editingSource : "MANUAL",
            visibility: manualVisibility,
            calories: Number(calories),
            proteinGram: Number(protein),
            carbsGram: Number(carbs),
            fatGram: Number(fat),
          }),
        },
        token,
      );

      resetManualForm();
      await Promise.all([load(), loadCalendar()]);
    } catch (error) {
      Alert.alert("保存失败", normalizeErrorMessage(error));
    }
  }, [
    calories,
    carbs,
    editingLogId,
    editingLoggedAt,
    editingSource,
    fat,
    load,
    loadCalendar,
    manualVisibility,
    mealType,
    protein,
    resetManualForm,
    selectedDate,
    token,
  ]);

  const startEditLog = useCallback((item: FoodLog) => {
    setEditingLogId(item.id);
    setEditingSource(item.source);
    setEditingLoggedAt(item.loggedAt);
    setMealType(item.mealType);
    setManualVisibility(item.visibility);
    setCalories(String(item.calories));
    setProtein(String(item.proteinGram));
    setCarbs(String(item.carbsGram));
    setFat(String(item.fatGram));
    setSelectedDate(item.loggedAt.slice(0, 10));
  }, []);

  const deleteLog = useCallback(
    (item: FoodLog) => {
      Alert.alert("确认删除", "确定删除这条记录吗？", [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await apiRequest(`/api/logs/${item.id}`, { method: "DELETE" }, token);
                if (editingLogId === item.id) {
                  resetManualForm();
                }
                await Promise.all([load(), loadCalendar()]);
              } catch (error) {
                Alert.alert("删除失败", normalizeErrorMessage(error));
              }
            })();
          },
        },
      ]);
    },
    [editingLogId, load, loadCalendar, resetManualForm, token],
  );

  const calendarCells = useMemo(() => buildCalendarCells(selectedMonth), [selectedMonth]);
  const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>饮食记录</Text>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>日历查看</Text>
            <View style={styles.rowGap}>
              <Pressable
                style={styles.ghostButton}
                onPress={() => {
                  const nextMonth = shiftMonthString(selectedMonth, -1);
                  setSelectedMonth(nextMonth);
                  setSelectedDate(`${nextMonth}-01`);
                }}
              >
                <Text style={styles.ghostButtonText}>上月</Text>
              </Pressable>
              <Pressable
                style={styles.ghostButton}
                onPress={() => {
                  const nextMonth = shiftMonthString(selectedMonth, 1);
                  setSelectedMonth(nextMonth);
                  setSelectedDate(`${nextMonth}-01`);
                }}
              >
                <Text style={styles.ghostButtonText}>下月</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.metric}>{selectedMonth}</Text>
          <Text style={styles.hint}>选中日期：{selectedDate}</Text>
          {caloriesChange !== null ? (
            <Text style={[styles.hint, caloriesChange > 0 ? styles.dangerText : undefined]}>
              相比前一天：{caloriesChange > 0 ? "+" : ""}
              {caloriesChange} 千卡
            </Text>
          ) : null}
          {calendarLoading ? <Text style={styles.hint}>日历数据加载中...</Text> : null}

          <View style={styles.calendarWeekRow}>
            {weekLabels.map((label) => (
              <View key={label} style={styles.calendarWeekCell}>
                <Text style={styles.calendarWeekText}>{label}</Text>
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
                      styles.calendarCellButton,
                      active && styles.calendarCellButtonActive,
                      !cell.inCurrentMonth && styles.calendarCellButtonMuted,
                    ]}
                    onPress={() => {
                      setSelectedDate(cell.date);
                    }}
                  >
                    <Text style={[styles.calendarDayText, active && styles.calendarDayTextActive]}>{cell.day}</Text>
                    <Text style={[styles.calendarCalText, active && styles.calendarCalTextActive]}>
                      {dayStats ? Math.round(dayStats.calories) : "-"}
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

          <Text style={styles.metric}>热量：{Math.round(summary.calories)} 千卡</Text>
          <Text style={styles.metric}>蛋白质：{summary.proteinGram.toFixed(1)} g</Text>
          <Text style={styles.metric}>碳水：{summary.carbsGram.toFixed(1)} g</Text>
          <Text style={styles.metric}>脂肪：{summary.fatGram.toFixed(1)} g</Text>
          {dailyTarget?.targetCalories ? (
            <Text style={[styles.metric, remainCalories !== null && remainCalories < 0 ? styles.dangerText : undefined]}>
              剩余热量：{remainCalories} 千卡
            </Text>
          ) : (
            <Text style={styles.hint}>你还未设置每日目标，请到“目标”页先填写身体参数。</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{editingLogId ? "编辑记录" : "手动添加记录"}</Text>
          <OptionRow label="餐次" options={mealOptions} value={mealType} onChange={setMealType} />
          <OptionRow label="可见范围" options={visibilityOptions} value={manualVisibility} onChange={setManualVisibility} />
          <NumberInput value={calories} onChangeText={setCalories} placeholder="热量（千卡）" />
          <NumberInput value={protein} onChangeText={setProtein} placeholder="蛋白质（g）" />
          <NumberInput value={carbs} onChangeText={setCarbs} placeholder="碳水（g）" />
          <NumberInput value={fat} onChangeText={setFat} placeholder="脂肪（g）" />
          <View style={styles.rowGap}>
            <Pressable style={styles.primaryButton} onPress={submitManualLog}>
              <Text style={styles.primaryButtonText}>{editingLogId ? "更新记录" : "保存记录"}</Text>
            </Pressable>
            {editingLogId ? (
              <Pressable style={styles.ghostButton} onPress={resetManualForm}>
                <Text style={styles.ghostButtonText}>取消编辑</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>{selectedDate} 记录列表</Text>
            <Pressable style={styles.ghostButton} onPress={() => void load()}>
              <Text style={styles.ghostButtonText}>{loading ? "加载中..." : "刷新"}</Text>
            </Pressable>
          </View>

          {logs.length === 0 ? <Text style={styles.hint}>当前日期还没有记录。</Text> : null}
          {logs.map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>
                {formatMealType(item.mealType)} · {Math.round(item.calories)} 千卡
              </Text>
              <Text style={styles.logSub}>
                蛋白质 {item.proteinGram}g / 碳水 {item.carbsGram}g / 脂肪 {item.fatGram}g
              </Text>
              <Text style={styles.logSub}>来源：{item.source === "AI" ? "智能识别" : "手动录入"}</Text>
              <Text style={styles.logSub}>可见范围：{formatVisibility(item.visibility)}</Text>
              <Text style={styles.logSub}>{new Date(item.loggedAt).toLocaleString()}</Text>
              <View style={styles.rowGap}>
                <Pressable style={styles.secondaryButton} onPress={() => startEditLog(item)}>
                  <Text style={styles.secondaryButtonText}>编辑</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={() => deleteLog(item)}>
                  <Text style={styles.dangerText}>删除</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AnalyzeScreen({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [analysis, setAnalysis] = useState<NutritionAnalysis | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mealType, setMealType] = useState<MealType>("LUNCH");
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");

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
          { timeoutMs: 90000 },
        );
        setAnalysis(payload.analysis);
      } catch (error) {
        Alert.alert("识别失败", normalizeErrorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  const saveAnalysis = useCallback(async () => {
    if (!analysis) {
      return;
    }

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
            calories: Number(analysis.totals.calories.toFixed(1)),
            proteinGram: Number(analysis.totals.proteinGram.toFixed(1)),
            carbsGram: Number(analysis.totals.carbsGram.toFixed(1)),
            fatGram: Number(analysis.totals.fatGram.toFixed(1)),
            fiberGram: Number(analysis.totals.fiberGram.toFixed(1)),
            items: analysis.items,
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
  }, [analysis, imageUri, mealType, onSaved, token, visibility]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>拍照识别</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>上传方式</Text>
          <View style={styles.rowGap}>
            <Pressable style={styles.primaryButton} onPress={() => void handleImagePick("camera")}>
              <Text style={styles.primaryButtonText}>拍照识别</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void handleImagePick("library")}>
              <Text style={styles.secondaryButtonText}>从相册选择</Text>
            </Pressable>
          </View>
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
            <Text style={styles.cardTitle}>智能识别结果</Text>
            <Text style={styles.metric}>热量：{analysis.totals.calories.toFixed(1)} 千卡</Text>
            <Text style={styles.metric}>蛋白质：{analysis.totals.proteinGram.toFixed(1)} g</Text>
            <Text style={styles.metric}>碳水：{analysis.totals.carbsGram.toFixed(1)} g</Text>
            <Text style={styles.metric}>脂肪：{analysis.totals.fatGram.toFixed(1)} g</Text>
            <Text style={styles.metric}>膳食纤维：{analysis.totals.fiberGram.toFixed(1)} g</Text>
            <Text style={styles.hint}>置信度：{(analysis.confidence * 100).toFixed(0)}%</Text>
            <Text style={styles.hint}>{analysis.notes}</Text>

            <OptionRow label="餐次" options={mealOptions} value={mealType} onChange={setMealType} />
            <OptionRow label="可见范围" options={visibilityOptions} value={visibility} onChange={setVisibility} />

            {analysis.items.map((item, index) => (
              <View key={`${item.name}-${index}`} style={styles.itemRow}>
                <Text style={styles.logTitle}>{item.name}</Text>
                <Text style={styles.logSub}>
                  {item.calories.toFixed(0)} 千卡 · 蛋白质 {item.proteinGram.toFixed(1)} / 碳水{" "}
                  {item.carbsGram.toFixed(1)} / 脂肪 {item.fatGram.toFixed(1)}
                </Text>
              </View>
            ))}

            <Pressable style={styles.primaryButton} onPress={() => void saveAnalysis()}>
              <Text style={styles.primaryButtonText}>保存为饮食记录</Text>
            </Pressable>
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
  const [sex, setSex] = useState<Sex>("MALE");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>("MODERATE");
  const [goal, setGoal] = useState<Goal>("LOSE_WEIGHT");
  const [result, setResult] = useState<null | {
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
  }, [activityLevel, age, goal, height, sex, token, weight]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>目标设置</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>身体信息</Text>
          <NumberInput value={age} onChangeText={setAge} placeholder="年龄" />
          <NumberInput value={height} onChangeText={setHeight} placeholder="身高（cm）" />
          <NumberInput value={weight} onChangeText={setWeight} placeholder="体重（kg）" />

          <OptionRow label="性别" options={sexOptions} value={sex} onChange={setSex} />
          <OptionRow label="活动水平" options={activityOptions} value={activityLevel} onChange={setActivityLevel} />
          <OptionRow label="目标" options={goalOptions} value={goal} onChange={setGoal} />

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

function SocialScreen({ token, user, onLogout }: { token: string; user: AuthUser; onLogout: () => void }) {
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [incoming, setIncoming] = useState<any[]>([]);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [feed, setFeed] = useState<any[]>([]);

  const [friendEmail, setFriendEmail] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [joinGroupId, setJoinGroupId] = useState("");
  const [shareGroupId, setShareGroupId] = useState("");
  const [shareLogId, setShareLogId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupFeed, setGroupFeed] = useState<any[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [friendsPayload, requestsPayload, groupPayload, feedPayload] = await Promise.all([
        apiRequest<{ friends: FriendItem[] }>("/api/friends", {}, token),
        apiRequest<{ incoming: any[]; outgoing: any[] }>("/api/friends/requests", {}, token),
        apiRequest<{ memberships: GroupMembership[] }>("/api/groups/my", {}, token),
        apiRequest<{ feed: any[] }>("/api/feed/friends?limit=20", {}, token),
      ]);
      setFriends(friendsPayload.friends);
      setIncoming(requestsPayload.incoming);
      setOutgoing(requestsPayload.outgoing);
      setGroups(groupPayload.memberships);
      setFeed(feedPayload.feed);
    } catch (error) {
      Alert.alert("加载失败", normalizeErrorMessage(error));
    }
  }, [token]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const sendRequest = useCallback(async () => {
    if (!friendEmail) {
      Alert.alert("提示", "请先输入好友邮箱。");
      return;
    }
    try {
      await apiRequest(
        "/api/friends/request",
        {
          method: "POST",
          body: JSON.stringify({ email: friendEmail }),
        },
        token,
      );
      setFriendEmail("");
      await loadAll();
    } catch (error) {
      Alert.alert("发送失败", normalizeErrorMessage(error));
    }
  }, [friendEmail, loadAll, token]);

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
        Alert.alert("操作失败", normalizeErrorMessage(error));
      }
    },
    [loadAll, token],
  );

  const createGroup = useCallback(async () => {
    if (!groupName) {
      Alert.alert("提示", "请输入群组名称。");
      return;
    }
    try {
      await apiRequest(
        "/api/groups",
        {
          method: "POST",
          body: JSON.stringify({
            name: groupName,
            description: groupDescription,
          }),
        },
        token,
      );
      setGroupName("");
      setGroupDescription("");
      await loadAll();
    } catch (error) {
      Alert.alert("创建失败", normalizeErrorMessage(error));
    }
  }, [groupDescription, groupName, loadAll, token]);

  const joinGroup = useCallback(async () => {
    if (!joinGroupId) {
      Alert.alert("提示", "请输入群组编号。");
      return;
    }
    try {
      await apiRequest(
        `/api/groups/${joinGroupId}/join`,
        {
          method: "POST",
        },
        token,
      );
      setJoinGroupId("");
      await loadAll();
    } catch (error) {
      Alert.alert("加入失败", normalizeErrorMessage(error));
    }
  }, [joinGroupId, loadAll, token]);

  const shareLogToGroup = useCallback(async () => {
    if (!shareGroupId || !shareLogId) {
      Alert.alert("提示", "请填写群组编号和饮食记录编号。");
      return;
    }

    try {
      await apiRequest(
        `/api/groups/${shareGroupId}/share-log`,
        {
          method: "POST",
          body: JSON.stringify({
            foodLogId: shareLogId,
            message: shareMessage,
          }),
        },
        token,
      );
      setShareMessage("");
      Alert.alert("成功", "已分享到群组。");
      await loadAll();
    } catch (error) {
      Alert.alert("分享失败", normalizeErrorMessage(error));
    }
  }, [loadAll, shareGroupId, shareLogId, shareMessage, token]);

  const loadGroupFeed = useCallback(async () => {
    if (!selectedGroupId) {
      setGroupFeed([]);
      return;
    }

    try {
      const payload = await apiRequest<{ posts: any[] }>(`/api/groups/${selectedGroupId}/feed`, {}, token);
      setGroupFeed(payload.posts);
    } catch (error) {
      Alert.alert("加载群组动态失败", normalizeErrorMessage(error));
    }
  }, [selectedGroupId, token]);

  useEffect(() => {
    void loadGroupFeed();
  }, [loadGroupFeed]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.screenContainer}>
        <Text style={styles.screenTitle}>社交</Text>
        <Text style={styles.hint}>当前账号：{user.displayName}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>好友系统</Text>
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

          <Text style={styles.sectionTitle}>我的好友（{friends.length}）</Text>
          {friends.length === 0 ? <Text style={styles.hint}>暂无好友</Text> : null}
          {friends.map((friend) => (
            <Text key={friend.id} style={styles.logSub}>
              - {friend.displayName}（{friend.email}）
            </Text>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>群组系统</Text>
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

          <Text style={styles.sectionTitle}>我加入的群组（{groups.length}）</Text>
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

          <Text style={styles.sectionTitle}>分享到群组</Text>
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

          <Text style={styles.sectionTitle}>查看群组动态</Text>
          <TextInput
            style={styles.input}
            value={selectedGroupId}
            onChangeText={setSelectedGroupId}
            placeholder="输入群组编号"
            placeholderTextColor="#8992a3"
          />
          <Pressable style={styles.ghostButton} onPress={() => void loadGroupFeed()}>
            <Text style={styles.ghostButtonText}>刷新群组动态</Text>
          </Pressable>
          {groupFeed.map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.author.displayName}</Text>
              <Text style={styles.logSub}>
                {formatMealType(item.foodLog.mealType)} · {Math.round(item.foodLog.calories)} 千卡
              </Text>
              {item.message ? <Text style={styles.logSub}>{item.message}</Text> : null}
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>好友动态</Text>
            <Pressable style={styles.ghostButton} onPress={() => void loadAll()}>
              <Text style={styles.ghostButtonText}>刷新</Text>
            </Pressable>
          </View>

          {feed.length === 0 ? <Text style={styles.hint}>暂无好友动态</Text> : null}
          {feed.map((item) => (
            <View key={item.id} style={styles.logRow}>
              <Text style={styles.logTitle}>{item.user.displayName}</Text>
              <Text style={styles.logSub}>
                {formatMealType(item.mealType)} · {Math.round(item.calories)} 千卡
              </Text>
              <Text style={styles.logSub}>
                蛋白质 {item.proteinGram} / 碳水 {item.carbsGram} / 脂肪 {item.fatGram}
              </Text>
            </View>
          ))}
        </View>

        <Pressable style={[styles.ghostButton, { marginBottom: 18 }]} onPress={onLogout}>
          <Text style={styles.ghostButtonText}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function MainTabs({ auth, onLogout }: { auth: AuthPayload; onLogout: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0);

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
        <Tab.Screen name="记录">
          {() => <DashboardScreen token={auth.token} refreshKey={refreshKey} onAuthInvalid={onLogout} />}
        </Tab.Screen>
        <Tab.Screen name="识别">
          {() => <AnalyzeScreen token={auth.token} onSaved={() => setRefreshKey((prev) => prev + 1)} />}
        </Tab.Screen>
        <Tab.Screen name="目标">{() => <TargetsScreen token={auth.token} />}</Tab.Screen>
        <Tab.Screen name="社交">
          {() => <SocialScreen token={auth.token} user={auth.user} onLogout={onLogout} />}
        </Tab.Screen>
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
        const appliedApi = savedApi || DEFAULT_API_BASE_URL;
        runtimeApiBaseUrl = appliedApi;
        setApiBaseUrl(appliedApi);

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
  card: {
    backgroundColor: "#101c31",
    borderColor: "#243146",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
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
  itemRow: {
    borderTopColor: "#2b3a53",
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 8,
  },
});
