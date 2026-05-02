# 饮食营养助手 NutriFlow

React Native + Express + SQLite 的饮食、体重、运动记录应用。支持图片/文字 AI 识别、目标营养计算、体重追踪、运动估算、好友动态与可见范围。

## 当前版本

- 移动端构建标识：`2026-05-02-r10`
- 后端会自动迁移新增字段和表，无需手动执行 SQL。
- 本次新增：目标体重、减重/增重效率、体重追踪图表、运动识别与记录、运动热量纳入每日剩余热量、健康分析增强。

## 核心功能

1. 饮食识别与记录
- 图片识别：`POST /api/nutrition/analyze-image`
- 文字识别：`POST /api/nutrition/analyze-text`
- 图片可附加文字描述，提高识别准确性。
- 记录详情包含宏量营养素、部分微量营养素和健康分析。

2. 运动识别与记录
- 发送“跑步 30 分钟”“力量训练 45 分钟”等文字后，App 会自动走运动识别。
- 后端接口：`POST /api/exercises/analyze`
- 运动记录接口：`GET /api/exercises`、`POST /api/exercises`、`PUT /api/exercises/:id`、`DELETE /api/exercises/:id`
- 每日剩余热量会按 `目标热量 - 食物摄入 + 运动消耗` 计算。

3. 目标营养
- 支持年龄、身高、体重、性别、活动水平、目标类型。
- 支持目标体重和每周体重变化速度。
- 算法使用 Mifflin-St Jeor BMR、活动系数 TDEE、目标体重速度折算热量调整。
- 减重速度限制为较保守的健康范围，避免过低热量目标。

4. 体重追踪
- 新增“体重”页面。
- 支持记录体重、日期和备注。
- 使用简单图表展示近期变化。
- 新体重会同步更新用户当前体重，并重新计算目标营养。
- 后端接口：`GET /api/weights`、`POST /api/weights`、`DELETE /api/weights/:id`

5. 社交与可见范围
- 记录可设置：仅自己可见、好友可见、公开。
- 动态页用于查看好友或公开记录。
- 好友详情可查看可见范围内的统计和日历。

## 目录结构

- `server`：Express + SQLite 后端
- `mobile`：Expo React Native 源码
- `docs`：云端部署文档
- `E:\mobile_clean\mobile`：本机 Android 打包镜像目录，打包前需要同步最新 `mobile/App.tsx`

## 本地开发

### 启动后端

```powershell
cd E:\AI\healthydiet\server
Copy-Item .env.example .env
npm install
npm run dev
```

默认地址：`http://127.0.0.1:4000`

### 启动移动端

```powershell
cd E:\AI\healthydiet\mobile
Copy-Item .env.example .env
npm install
npm run start
```

## Railway 部署后端

Railway 服务建议设置：

- Root Directory：`server`
- Start Command：`npm run start`
- Healthcheck Path：`/health`
- Public Networking Port：`4000`

必填变量：

```env
PORT=4000
NODE_VERSION=22
JWT_SECRET=change-to-a-long-random-secret
CORS_ORIGIN=*
SQLITE_PATH=/data/nutrition.db
```

AI 变量示例：

```env
AI_PROVIDER=openai_compat_auto
AI_BASE_URL=https://你的兼容服务/v1
AI_API_KEY=你的key
AI_MODEL=支持图片和文字的模型
AI_IMAGE_DETAIL=auto
AI_TIMEOUT_MS=45000
```

备用线路可选：

```env
AI_BACKUP_PROVIDER=openai_compat_auto
AI_BACKUP_BASE_URL=https://备用兼容服务/v1
AI_BACKUP_API_KEY=备用key
AI_BACKUP_MODEL=备用模型
AI_BACKUP_IMAGE_DETAIL=auto
AI_BACKUP_TIMEOUT_MS=45000
```

部署后测试：

```text
https://你的railway域名/health
```

浏览器打开根路径出现 `接口不存在：GET /` 是正常现象，必须访问 `/health`。

## Android 本地打包

推荐从英文路径镜像打包：`E:\mobile_clean\mobile`。

先同步源码：

```powershell
Copy-Item "E:\AI\healthydiet\mobile\App.tsx" "E:\mobile_clean\mobile\App.tsx" -Force
```

如果需要重新生成 Android 工程，先关闭 Android Studio 和占用中的终端，再执行：

```powershell
cd E:\mobile_clean\mobile
npx expo prebuild -p android --clean
```

Release APK 打包：

```powershell
cd E:\mobile_clean\mobile\android
.\gradlew.bat --stop
.\gradlew.bat clean
.\gradlew.bat assembleRelease
```

APK 输出位置：

```text
E:\mobile_clean\mobile\android\app\build\outputs\apk\release\app-release.apk
```

安装到手机：

```powershell
$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
adb devices
adb install -r E:\mobile_clean\mobile\android\app\build\outputs\apk\release\app-release.apk
```

如果安装后仍是旧版，先卸载手机上的旧 App，再安装新 APK。

## 常见问题

### App 请求超时

检查顺序：

1. 登录页接口地址是否是 Railway 的 `https://...up.railway.app`
2. 浏览器能否打开 `https://你的域名/health`
3. Railway 服务是否在线
4. Railway AI 变量是否正确
5. 手机是否安装了最新构建标识 `2026-05-02-r10`

### `SDK location not found`

在 `E:\mobile_clean\mobile\android\local.properties` 写入：

```properties
sdk.dir=C:\\Users\\你的用户名\\AppData\\Local\\Android\\Sdk
```

### `adb` 命令找不到

```powershell
$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
adb devices
```

### `EBUSY ... classes.dex`

关闭 Android Studio、模拟器、占用该目录的终端，然后执行：

```powershell
cd E:\mobile_clean\mobile\android
.\gradlew.bat --stop
.\gradlew.bat clean
```

### AI 识别失败

先确认后端接口可用，再检查 Railway 变量：

- `AI_BASE_URL` 必须以 `/v1` 结尾，除非服务商明确不需要。
- `AI_MODEL` 必须支持当前输入类型；图片识别必须使用支持视觉的模型。
- 第三方兼容平台建议使用 `AI_PROVIDER=openai_compat_auto`。
- 如果主线路不稳定，配置 `AI_BACKUP_*`。

## 健康算法说明

- 基础代谢：Mifflin-St Jeor 公式。
- 维护热量：BMR 乘以活动系数得到 TDEE。
- 体重目标：按每周目标变化折算每日热量调整，并设置安全上限和最低热量保护。
- 运动热量：使用 AI 估算运动类型、时长、强度和 MET，再按体重与时长估算消耗。
- 所有结果只适合日常记录和估算，不等同于医生或注册营养师建议。
