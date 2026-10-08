# 真心话大冒险

多人真心话大冒险小游戏。Unity 2022.3.54f1 LTS 客户端支持 Windows、Android、iOS 和 WebGL，业务层通过 Addressables 与 HybridCLR 热更新；实时后端使用 Node.js、TypeScript、Socket.IO 和 SQLite。

首版使用游客昵称和文字聊天。可以创建不限产品人数的房间并用 6 位房间码加入，也可以自动匹配严格 4 人的房间。服务端保留可配置安全上限，默认 64 人。

## 目录

- [shared/protocol.ts](shared/protocol.ts)：协议源。
- [server](server)：Fastify + Socket.IO 权威状态机。
- [client/TruthOrDare](client/TruthOrDare)：Unity 工程。`Assets/GameMain` 是启动层，`Assets/HotUpdate` 是可热更的大厅、房间和回合。
- [docs/protocol.md](docs/protocol.md)：事件、状态机和错误码。

## 启动后端

需要 Node.js 22 或更高版本。

```bash
cd server
npm install
npm start
```

开发监视模式使用 `npm run dev`。服务默认监听 `http://127.0.0.1:8787`。SQLite 数据文件位于 `server/data/app.db`。环境变量见 [server/.env.example](server/.env.example)。

检查接口：

```bash
curl http://127.0.0.1:8787/health
```

生产环境设置 `NODE_ENV=production` 后会关闭机器人补位接口。开发环境可在房间内使用“补齐 4 名机器人”或“机器人开局”。

## Unity

使用 Unity Hub 安装 **2022.3.54f1 LTS**，并加入 Windows、Android、iOS、WebGL 模块。Windows、Android 和 iOS 使用 IL2CPP；WebGL 本身就是 IL2CPP。打开 [client/TruthOrDare](client/TruthOrDare) 后，工程会应用横竖屏自动旋转、后台运行和新输入系统。

客户端默认连接 `http://127.0.0.1:8787`，配置在 `Assets/StreamingAssets/app-config.json`。WebGL 若从另一个域名打开，把 `CORS_ORIGINS` 改成该来源。

进入游戏后输入昵称，然后创建房间、输入房间码，或开始 4 人匹配。房主可在开局前选择轻松、热辣、大胆三个尺度，并决定是否包含更私密的题目。全员准备后开始。轮到自己时选择真心话或大冒险，完成后标记完成；每局可以主动跳过一次。

## 热更新

1. 导入包后执行 Unity 菜单 `HybridCLR/Installer`，再执行 `HybridCLR/Generate/All`。
2. 确认 `Game.HotUpdate` 已登记为 HybridCLR 热更新程序集。
3. Addressables 使用远程 catalog。资源组使用 LZ4；WebGL 包再由后端 `@fastify/compress` 做 Brotli/gzip。远程地址形如 `http://服务器/content/[BuildTarget]`。
4. 执行 `TruthOrDare/Build Hot Update Content`。它会编译热更新 DLL、复制 AOT 元数据、生成版本清单，并写入 `Assets/StreamingAssets` 与 `server/public/<平台>`。
5. 启动层按“下载 AOT 元数据、加载热更新 DLL、重新加载 Addressables catalog、进入热更入口”的顺序执行，避免热更类型被 Addressables 缓存成 `System.Object`。

整包菜单：

- `TruthOrDare/Build/Windows`
- `TruthOrDare/Build/Android`
- `TruthOrDare/Build/iOS`
- `TruthOrDare/Build/WebGL`

Android 需要对应 SDK。iOS 导出的是 Xcode 工程，签名和真机安装需要在 macOS 上完成。

## 测试

```bash
cd server
npm test
npm run lint
```

客户端纯规则测试与 Unity EditMode 使用同一份用例：

```bash
dotnet test client/Game.Core.Tests/Game.Core.Tests.csproj
```

Unity EditMode 可在 Test Runner 中运行 `Game.Tests`。

当前开发机没有安装 Unity Editor、Android SDK 或 Xcode，因此没有执行 Unity 编译、EditMode 图形测试、Windows/WebGL 播放器构建或移动端签名。后端测试、类型检查和 `dotnet test` 已覆盖协议归并、回合计分规则、房间权限、断线宽限、题库去重、并发 4 人匹配和真实 Socket.IO 对局。
