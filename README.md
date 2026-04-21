# NutriFlow（Journable 风格饮食记录 App）

这是一个从 0 搭建的全栈移动应用示例，核心目标是：
- 拍照/相册识别食物并估算热量和营养
- 日常饮食记录与统计
- 按人群和目标计算每日摄入目标
- 注册登录 + 好友 + 群组 + 数据分享

## 目录结构

- `server`：Node.js + Express + SQLite API
- `mobile`：Expo React Native 客户端

## 功能映射

1. 图片识别热量（拍照 + 相册）
- 移动端：`mobile/App.tsx` → “识别”页，支持拍照和相册
- 服务端：`POST /api/nutrition/analyze-image`
- AI：默认接 OpenAI Responses API（可配置模型）

2. 卡路里与营养成分
- 服务端记录字段：`calories/proteinGram/carbsGram/fatGram/fiberGram` 等
- 接口：`POST /api/logs`、`GET /api/logs`

3. 按人群与目标动态调整每日摄入
- 接口：`PUT /api/profile/targets`
- 输入：年龄、性别、身高、体重、活动水平、目标（减脂/维持/增肌）
- 输出：每日热量 + 三大营养素目标

4. 注册登录 + 好友 + 群组分享
- 认证：`/api/auth/register`、`/api/auth/login`、`/api/auth/me`
- 好友：`/api/friends/*`
- 群组：`/api/groups/*`
- 好友动态：`GET /api/feed/friends`

## 启动后端

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

默认地址：`http://localhost:4000`

## 无电脑独立使用（推荐）

要做到“手机离开电脑也能用”，后端必须部署到云端（不是本机）。

1. 把仓库推到 GitHub（或 GitLab）。
2. 在 Render / Railway 创建服务，服务根目录指向 `server`。
   - Railway 新建页请选择 `GitHub Repository`
3. 使用 Docker 部署（仓库已提供 `server/Dockerfile`）。
4. 配置环境变量（至少这些）：
   - `PORT=4000`
   - `JWT_SECRET=你自己的强随机字符串`
   - `CORS_ORIGIN=*`
   - `SQLITE_PATH=/app/data/nutrition.db`
   - `AI_PROVIDER` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`
5. 如果使用 SQLite，请给服务挂持久化磁盘并挂载到 `/app/data`（否则重启会丢数据）。
6. 部署完成后拿到 HTTPS 地址（例如 `https://your-api.onrender.com`）。
7. 在手机 App 登录页“接口配置”里填这个 HTTPS 地址，点“测试连接”，成功后再登录/注册。

完整图文步骤见：
- Railway（推荐）：[`docs/云端部署完整教程-Railway.md`](docs/云端部署完整教程-Railway.md)
- Render（备选）：[`docs/云端部署完整教程-Render.md`](docs/云端部署完整教程-Render.md)

### 后端环境变量（`server/.env`）

- `PORT`：API 端口（默认 4000）
- `JWT_SECRET`：JWT 密钥
- `SQLITE_PATH`：SQLite 文件路径
- `AI_PROVIDER`：模型提供方类型（`openai` / `openai_compat_auto` / `openai_compat_responses` / `openai_compat_chat`）
- `AI_BASE_URL`：模型服务地址
- `AI_API_KEY`：模型服务密钥
- `AI_MODEL`：模型名（支持非 GPT）
- `AI_IMAGE_DETAIL`：图片细节等级（`low` / `high` / `auto`）
- `AI_TIMEOUT_MS`：请求超时毫秒

后端运行环境要求：
- Node.js `>= 22`（使用 `node:sqlite`）

### 多模型 API 接入步骤（不限 GPT）

1. 在你要用的平台创建 API Key。  
2. 按平台是否兼容 OpenAI 协议配置 `server/.env`。  
3. 重启后端后，App 侧接口不变：`POST /api/nutrition/analyze-image`。

OpenAI 官方示例：
```env
AI_PROVIDER="openai"
AI_BASE_URL="https://api.openai.com/v1"
AI_API_KEY="sk-..."
AI_MODEL="gpt-4.1-mini"
AI_IMAGE_DETAIL="auto"
```

OpenAI 兼容平台示例（可接第三方模型）：
```env
AI_PROVIDER="openai_compat_auto"
AI_BASE_URL="https://openrouter.ai/api/v1"
AI_API_KEY="你的平台密钥"
AI_MODEL="平台支持的视觉模型ID"
AI_IMAGE_DETAIL="auto"
```

说明：如果你不是直连 OpenAI 官方（`api.openai.com`），建议优先用 `AI_PROVIDER=openai_compat_auto`，避免平台不支持 `/responses` 导致识别失败。

### 如何选模型（食物图像识别）

- 低成本优先：选择轻量视觉模型（例如 mini/flash 级）
- 准确率优先：选择高阶视觉模型（通常价格更高）
- 如果你用第三方平台：只要该模型支持图像输入并能返回 JSON，即可接入

### 图片识别常见报错（AI 接口）

- 提示“当前模型平台不支持 Responses 接口”：
  - 把 `AI_PROVIDER` 改为 `openai_compat_auto` 或 `openai_compat_chat`
- 提示“模型无法处理这张图片”：
  - 换清晰、完整的食物图片（避免过暗、过小、纯色图）
  - 确认 `AI_MODEL` 是支持图像输入的视觉模型
- 提示“AI_API_KEY 无效或已过期”：
  - 检查并更新 `AI_API_KEY`
- 提示“请求超时”：
  - 检查 Railway 服务是否在线
  - 检查 `AI_BASE_URL / AI_API_KEY / AI_MODEL` 是否正确
  - 可适当调大 `AI_TIMEOUT_MS`（例如 60000）

## 启动移动端

```bash
cd mobile
cp .env.example .env
npm install
npm run start
```

### 移动端环境变量（`mobile/.env`）

- `EXPO_PUBLIC_API_BASE_URL`：后端 API 地址
- `EXPO_PUBLIC_API_TIMEOUT_MS`：请求超时毫秒数（默认 30000）

说明（独立安装包）：
- App 内“接口配置”优先级高于 `mobile/.env`
- 只要你在登录页保存了云端地址，后续请求会使用该地址
- 不需要把 Railway 域名再写回本地 `mobile/.env`

常见地址：
- iOS 模拟器 / Web：`http://127.0.0.1:4000`
- Android 模拟器：`http://10.0.2.2:4000`
- 真机：使用你电脑局域网 IP（例如 `http://192.168.1.8:4000`）
- 独立使用（推荐）：云端 HTTPS 地址（例如 `https://your-api.onrender.com`）

> 现在登录页支持直接修改并保存接口地址，也可以一键“测试连接”。

### 登录超时排查（真机）

如果你看到“请求超时”：

1. 在手机浏览器直接打开：`http://你的电脑IP:4000/health`（本地）或 `https://你的云端域名/health`（云端）。  
2. 若是本地 IP：关闭手机 VPN，确保手机和电脑同一 Wi-Fi。  
3. Windows 防火墙里允许 `Node.js` 私有网络访问，或放行 4000 端口。  
4. IP 变化后，回到登录页更新“接口配置”。  

## 打包为独立 App（不依赖电脑常驻）

如果你希望手机上长期独立使用，而不是每次都连 Expo 开发服务：

1. 安装并登录 EAS：
```bash
cd mobile
npm install
npx eas login
```
2. 构建 Android 安装包（已提供 `mobile/eas.json`）：
```bash
npx eas build -p android --profile preview
```
3. 安装 APK 后，在登录页填写你的云端 API 地址并测试连接。

> 关键点：独立 App = 云端后端 + EAS 打包。只做其一都不完整。

## 已实现页面

- 登录/注册
- 今日记录（统计 + 手动添加）
- 拍照识别并保存
- 目标设置与计算
- 好友请求、好友列表
- 群组创建/加入/分享/群组动态
- 好友动态

## 说明

- 当前 AI 识别是“估算”，建议保留人工修正流程。
- 社交分享的“分享到群组”需要输入日志 ID（可在记录接口结果中拿到）。
- 这是可运行 MVP，后续可以继续扩展：条码识别、食物数据库、消息通知、图表分析、推送、云部署等。
