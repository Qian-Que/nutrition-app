# NutriFlow 云端部署完整教程（Railway）

本教程目标：让你的 App 脱离本机电脑，手机可长期独立使用。

## 1. 在新建页面应该选哪个

在你截图这个 Railway 新建页，选择：

- `GitHub Repository`（正确）

不要选：

- `Database`：只创建数据库，不会部署你的后端 API
- `Function`：不适合当前 Express 服务
- `Empty Project`：需要手动再建服务，步骤更长

## 2. 部署前准备

1. 确保代码已推送到 GitHub：
```bash
cd "E:\AI\健康饮食"
git push -u origin main
```

2. 本地确认后端能构建：
```bash
cd server
npm install
npm run build
```

## 3. 在 Railway 创建后端服务

1. 进入 Railway，点击 `New Project`。
2. 选择 `GitHub Repository`。
3. 选中仓库：`Qian-Que/nutrition-app`。
4. 进入服务设置，把 `Root Directory` 设为：
- `server`
5. 若使用 Nixpacks/Railpack（非 Dockerfile），在 Variables 里增加：
- `NIXPACKS_NODE_VERSION=22`

说明：你的仓库是 monorepo，后端代码在 `server`，不设 Root Directory 会部署失败。

## 4. 配置持久化存储（SQLite 关键）

1. 在项目里给该服务添加 `Volume`。
2. 挂载路径（Mount Path）填：
- `/app/data`
3. 后端变量中配置：
- `SQLITE_PATH=/app/data/nutrition.db`

说明：不挂 Volume 时，服务重启后 SQLite 数据会丢失。

## 5. 配置环境变量（Railway Variables）

至少配置以下项：

```env
PORT=4000
JWT_SECRET=请替换为32位以上随机字符串
CORS_ORIGIN=*
SQLITE_PATH=/app/data/nutrition.db

AI_PROVIDER=openai_compat_auto
AI_BASE_URL=你的模型平台地址
AI_API_KEY=你的模型平台密钥
AI_MODEL=你的视觉模型ID
AI_IMAGE_DETAIL=auto
AI_TIMEOUT_MS=45000
```

如果你使用 OpenAI 官方：

```env
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-xxxx
AI_MODEL=gpt-4.1-mini
AI_IMAGE_DETAIL=auto
AI_TIMEOUT_MS=45000
```

## 6. 部署与健康检查

1. 触发部署（首次通常会自动部署）。
2. 部署完成后复制 Railway 提供的公网域名，例如：
- `https://your-api.up.railway.app`
3. 浏览器访问：
- `https://your-api.up.railway.app/health`

看到类似：

```json
{"ok":true,"service":"nutrition-server"}
```

说明后端正常。

## 7. 手机 App 连接云端

1. 打开 App 登录页。
2. 在“接口配置”填 Railway 域名（必须 `https`，且不要加 `/api`）。
3. 点击“测试连接”。
4. 成功后再登录/注册/图片识别。

## 8. 打包独立安装（Android）

在 `mobile` 目录：

```bash
npm install
npx eas login
npx eas build -p android --profile preview
```

安装 APK 后，首次打开仍需要在登录页保存一次云端接口地址。

## 9. 常见问题排查

1. 登录/识别请求超时
- 先在手机浏览器打开 `https://你的域名/health` 检查连通性
- 检查 Railway 部署是否成功

2. 部署成功但接口 404
- 基本是 Root Directory 没设为 `server`

3. 日志出现 `No such built-in module: node:sqlite`
- 说明运行时 Node 版本太低（常见是 Node 20）
- 使用 Dockerfile 部署，或设置 `NIXPACKS_NODE_VERSION=22` 后重新部署

4. 重启后数据丢失
- 没挂 Volume，或 `SQLITE_PATH` 不是 `/app/data/nutrition.db`

5. 图片识别失败
- 检查 `AI_PROVIDER`、`AI_MODEL` 是否支持图像输入
- 优先用 `AI_PROVIDER=openai_compat_auto`

## 10. 成本建议

1. 先用 Trial 跑通功能。
2. 长期稳定使用建议升级可持续运行方案（避免额度耗尽中断）。
3. 通常 AI 模型调用费用会高于主机费用，建议优先做图片压缩与调用频率控制。
