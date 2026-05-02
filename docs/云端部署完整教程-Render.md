# NutriFlow 云端部署完整教程（Render）

本教程目标：让你的 App 脱离本机电脑，手机可长期独立使用。

---

## 1. 准备工作

1. 注册账号：
- GitHub（代码仓库）
- Render（云服务器）

2. 本地确认后端可运行：
```bash
cd server
npm install
npm run build
```

3. 把项目推送到 GitHub：
```bash
git init
git add .
git commit -m "init nutriflow"
git branch -M main
git remote add origin <https://github.com/Qian-Que/nutrition-app.git>
git push -u origin main
```

---

## 2. 在 Render 创建后端服务

1. 登录 Render，点击 `New +` -> `Web Service`。  
2. 选择你的 GitHub 仓库。  
3. 配置：
- `Name`：例如 `nutriflow-api`
- `Region`：选离你近的区域
- `Runtime`：`Docker`
- `Root Directory`：`server`
- `Branch`：`main`

4. 添加磁盘（非常关键）：
- 进入服务后 `Disks` -> `Add Disk`
- `Mount Path` 填：`/app/data`
- 大小可先 1GB

说明：本项目默认 SQLite，数据文件路径是 `/app/data/nutrition.db`。不挂磁盘会丢数据。

---

## 3. 配置环境变量（Render -> Environment）

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

如果你用 OpenAI 官方，可改为：

```env
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-xxxx
AI_MODEL=gpt-4.1-mini
AI_IMAGE_DETAIL=auto
AI_TIMEOUT_MS=45000
```

---

## 4. 部署与健康检查

1. 点击 `Manual Deploy` -> `Deploy latest commit`。  
2. 等待构建完成，拿到服务地址（例如）：
`https://nutriflow-api.onrender.com`

3. 在浏览器访问：
- `https://nutriflow-api.onrender.com/health`

看到类似：
```json
{"ok":true,"service":"nutrition-server"}
```
说明后端正常。

---

## 5. 手机 App 连接云端

1. 打开 App 登录页。  
2. 在“接口配置”输入你的 Render 地址（必须 `https`）。  
3. 点击“测试连接”。  
4. 测试成功后再注册/登录。

注意：不要填写 `http://127.0.0.1:4000` 或局域网 IP，这些只适用于本地调试。

---

## 6. 打包独立安装（Android）

在 `mobile` 目录：

```bash
npm install
npx eas login
npx eas build -p android --profile preview
```

构建完成后下载 APK 安装。  
安装后首次打开，仍需要在登录页填一次云端接口地址并保存。

---

## 7. 常见故障排查

1. `请求超时`  
- Render 首次访问可能冷启动 20~60 秒，重试一次。  
- 确认 `https://你的域名/health` 能打开。  

2. 手机连本地 IP 失败  
- 你手机和电脑不在同一 Wi-Fi。  
- 手机开了 VPN（很多 VPN 会拦截局域网访问）。  
- Windows 防火墙未放行 4000 端口。  

3. 注册/登录提示 401  
- `JWT_SECRET` 改过后旧 token 失效，重新登录即可。  

4. 重启后数据丢失  
- 没有挂载 `/app/data` 持久化磁盘。  

---

## 8. 生产建议

1. 把 `CORS_ORIGIN` 改为你的正式 App 域名白名单。  
2. `JWT_SECRET` 使用高强度随机值并妥善保管。  
3. SQLite 适合 MVP，用户量上来后建议迁移 PostgreSQL。  
4. 给 `/health` 配监控告警，避免服务中断无感知。
