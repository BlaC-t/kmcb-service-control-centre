# kmcb-service-control-centre

这是 macOS 和 Windows 本机前后端开发服务的统一状态与进程控制入口。
页面固定监听 `http://127.0.0.1:17600`，不会向局域网开放。

## 能力

- 实时查看所有注册服务的端口、PID、运行状态和健康状态。
- 在 macOS 上识别工作目录匹配的外部进程，在 Windows 上安全管理控制中心启动的进程树，并拒绝控制归属不明的端口占用。
- 从一个页面启动、停止和重启服务。
- 查看每个服务最近的启动和运行日志。
- 服务启动超过 60 秒仍未监听固定端口时标记为异常，避免长期停留在“启动中”。
- 固定 STM-GK、管理后台、客户门户及各后端服务的端口。
- 对工作目录不匹配的端口占用拒绝执行停止或重启，避免误杀其他项目。

## 安装

不同机器上的用户名、工作区、端口、命令和 Java 路径通常不同，安装前必须先修改 `config/services.json`。

- macOS: [详细安装与迁移指南](docs/setup-guide.zh-CN.md)
- Windows: [Windows 安装与使用指南](docs/setup-guide.windows.zh-CN.md)

macOS 首次安装为登录服务：

```bash
KMCB_CONTROL_REPO="/Users/your-name/Projects/kmcb-service-control-centre"
cd "$KMCB_CONTROL_REPO"
./scripts/install-launch-agent.sh
```

Windows 首次安装为当前用户登录任务：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows.ps1
```

请在安装前逐项修改 `workspaceRoot`、`cwd`、端口、平台命令和运行时路径。

macOS 安装脚本会把运行副本放到 `~/Library/Application Support/KMCBServiceControl`。
Windows 安装脚本会把运行副本放到 `%LOCALAPPDATA%\KMCBServiceControl`。
源码和服务注册表位于独立的 `kmcb-service-control-centre` Git 仓库中，修改后重新执行安装脚本即可更新运行副本。

然后打开：

```text
http://127.0.0.1:17600
```

安装后，命令行也必须通过控制中心 API：

```bash
kmcb-svc status
kmcb-svc restart stm-gk-board
kmcb-svc logs stm-gk-board
```

控制中心未运行时，CLI 会自动引导启动控制中心本身。
除控制中心自身的引导启动外，不应再直接运行各业务服务的启动或重启命令。

## 服务注册表

端口和启动命令的唯一来源是 [config/services.json](config/services.json)。
新增服务时必须使用唯一的 `id` 和 `port`，并填写项目工作目录。
`command` 是 macOS/POSIX 命令，`commandWindows` 可以提供 Windows `cmd.exe` 命令。
公共环境变量使用 `env`，平台专用环境变量使用 `envPosix` 或 `envWindows`。
CRM API 和 CRM 客户网关固定使用项目要求的 Temurin Java 17，避免系统 Maven 默认 JDK 变化导致 Lombok 注解处理失败。
控制页面将两个 CRM 模块分别标记为 `kj-crm-api / StartApp / :7110` 和 `kj-crm-gateway-api / StartAppGateWay / :7111`，对应 IntelliJ 中的两个 Spring Boot 启动入口。

密码等本机秘密变量不得写入 `services.json`。
控制中心启动某个服务时会自动读取运行目录下的 `runtime/service-env/<service-id>.env`。
秘密文件采用普通 `KEY=value` 格式，其内容不会写入服务启动日志。
macOS 下秘密文件必须设置为权限 `600`。
Windows runtime 默认位于 `%LOCALAPPDATA%\KMCBServiceControl\runtime`，并依赖当前用户目录 ACL 保护。

后端重启会先执行 Maven 打包，再运行对应可执行 JAR。
这样可以避免本地 Maven 依赖过期，但首次启动会比前端服务慢。

## 验证

```bash
npm run check
npm test
```

测试使用临时目录和独立随机端口，不会停止或重启真实业务服务。
GitHub Actions 会在 macOS 和 Windows 的 Node.js 20 环境中运行相同检查。
Windows job 还会解析 PowerShell 脚本，并在包含中文字符的临时路径中实际验证安装、计划任务、CLI、控制 API 和卸载流程。
