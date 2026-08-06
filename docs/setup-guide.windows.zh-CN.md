# kmcb-service-control-centre Windows 安装与使用指南

本指南用于在 Windows 10、Windows 11 或同类桌面 Windows 环境中安装和使用 `kmcb-service-control-centre`。
Windows 版本与 macOS 版本使用相同页面、API、CLI 和服务注册表，但运行目录、启动 Shell、进程归属识别和登录自启动机制不同。

## 1. Windows 版本提供什么

Windows 版本支持：

- 通过 `http://127.0.0.1:17600` 查看本机服务状态。
- 通过页面或 `kmcb-svc` 启动、停止、重启服务并查看日志。
- 使用 `cmd.exe` 执行每个服务的 Windows 启动命令。
- 使用 `netstat.exe` 识别监听端口和 PID。
- 使用 PowerShell CIM 查询控制中心启动的完整进程树。
- 使用 `taskkill.exe` 结束控制中心明确管理的 Windows 进程树。
- 使用当前用户的 Windows 计划任务在登录时自动启动控制中心。
- 将运行副本和日志保存在 `%LOCALAPPDATA%\KMCBServiceControl`。
- 在当前用户 PATH 中安装 `kmcb-svc.cmd`，不修改系统级 PATH。

Windows 版本不会控制归属无法确认的外部进程。
如果端口监听 PID 不在控制中心记录的进程树中，该服务会显示为 `conflict`，停止和重启操作会被拒绝。
这个行为用于避免误杀由其他项目、IDE、系统服务或其他用户启动的进程。

## 2. 前置条件

### 2.1 操作系统和权限

建议使用 Windows 10 或 Windows 11 的当前维护版本。
安装脚本只创建当前用户的运行目录、PATH 和登录计划任务，正常情况下不需要管理员权限。
公司设备如果通过组策略禁止创建计划任务，需要联系管理员授权，或暂时使用第 11 节的前台运行方式。

### 2.2 必需软件

必须安装：

- Node.js 20 或更高版本。
- Windows PowerShell 5.1 或 PowerShell 7。
- Git，仅在通过 Git 获取和更新源码时需要。
- 被管理项目自身需要的 npm、pnpm、Java、Maven 或其他运行时。
- 管理 `mobile-web` 时需要安装 Windows 版 HBuilderX。

在 PowerShell 中执行：

```powershell
$PSVersionTable.PSVersion
node --version
npm --version
git --version
where.exe node
```

`node --version` 必须显示 `v20` 或更高主版本。
`where.exe node` 应返回朋友计划长期使用的 Node.js 路径，因为安装脚本会把这个绝对路径写入运行包装脚本。

项目当前没有第三方 npm 依赖，所以不需要先执行 `npm install`。

手机端启动器会自动检查 `C:\HBuilderX`、`C:\Program Files\HBuilderX` 和 `%LOCALAPPDATA%\Programs\HBuilderX`。
如果 HBuilderX 位于其他目录，请在 `mobile-web` 的 `envWindows` 中设置：

```json
"envWindows": {
  "HBUILDERX_HOME": "D:/Developer Tools/HBuilderX"
}
```

启动器会使用 HBuilderX 自带的 Node.js、Vite 和 uni-app 编译器。

## 3. 获取源码

### 3.1 通过 GitHub 获取

把实际 GitHub 地址替换到下面的命令中：

```powershell
$ControlRepo = 'C:\Users\Alice\Developer\kmcb-service-control-centre'
git clone REPLACE_WITH_GITHUB_URL $ControlRepo
Set-Location $ControlRepo
```

控制中心源码可以放在任何当前用户有读写权限的位置。
源码目录不要求与被管理业务仓库位于同一个父目录。

### 3.2 通过 ZIP 获取

如果朋友收到的是 ZIP 文件，可以在资源管理器中解压，也可以在 PowerShell 中执行：

```powershell
$Archive = 'C:\Users\Alice\Downloads\kmcb-service-control-centre.zip'
$ControlRepo = 'C:\Users\Alice\Developer\kmcb-service-control-centre'
Expand-Archive -LiteralPath $Archive -DestinationPath $ControlRepo
Set-Location $ControlRepo
```

如果 ZIP 内还有一层同名目录，应进入真正包含 `package.json` 的目录。

### 3.3 确认源码完整

```powershell
Get-Location
Test-Path .\package.json
Test-Path .\config\services.json
Test-Path .\scripts\install-windows.ps1
Test-Path .\src\process-manager.mjs
```

这四个 `Test-Path` 命令都应返回 `True`。

## 4. 规划 Windows 业务工作区

### 4.1 选择共同父目录

`config/services.json` 中的 `workspaceRoot` 必须是所有被管理项目的共同父目录。
建议把项目放在类似下面的结构中：

```text
C:\Users\Alice\Developer\projects
├── kmcb-admin-api
├── kmcb-admin-webapp
├── kmcb-crm-api
└── kmcb-trace-web
```

JSON 中可以使用正斜杠，避免手动转义反斜杠：

```json
"workspaceRoot": "C:/Users/Alice/Developer/projects"
```

也可以使用双反斜杠：

```json
"workspaceRoot": "C:\\Users\\Alice\\Developer\\projects"
```

不要在 JSON 字符串中使用单个反斜杠路径，例如 `C:\Users\Alice` 的源码文本如果没有正确转义会形成无效 JSON。
建议统一使用正斜杠。

### 4.2 只保留朋友实际拥有的项目

仓库中的 `config/services.json` 是 Titus 本机项目组合的示例。
朋友应删除自己没有的服务，并逐项确认剩余服务的目录、端口、命令和运行时。
不存在的 `cwd` 不会阻止控制中心启动，但对应服务会显示为不可控制。

## 5. Windows 服务注册表

### 5.1 顶层配置

至少确认以下字段：

```json
{
  "title": "Alice Local Service Control",
  "host": "127.0.0.1",
  "port": 17600,
  "workspaceRoot": "C:/Users/Alice/Developer/projects",
  "services": []
}
```

`host` 只能使用 `127.0.0.1` 或 `localhost`。
不要使用 `0.0.0.0`、局域网 IP、公开域名、反向代理或隧道暴露控制 API。
控制中心端口必须唯一，不能与任何业务服务端口重复。

### 5.2 Windows 命令字段

每个服务可以同时提供两个命令：

```json
{
  "command": "exec npm run dev:mac",
  "commandWindows": "npm run dev"
}
```

- `command` 用于 macOS 和其他 POSIX 环境。
- `commandWindows` 用于 Windows，并通过 `cmd.exe /d /s /c` 执行。
- 如果未提供 `commandWindows`，Windows 会使用 `command`，并移除命令开头或 `&&`、`||` 后面的 POSIX `exec`。

建议为每个 Windows 服务显式填写 `commandWindows`，不要只依赖自动移除 `exec`。
Windows 命令必须使用 `cmd.exe` 语法，而不是 PowerShell cmdlet 语法。
不要在 `commandWindows` 中使用 `start` 或 `Start-Process` 把业务进程脱离根 `cmd.exe`，否则控制中心无法持续证明监听进程属于受管进程树。

前端示例：

```json
{
  "id": "admin-web",
  "name": "管理后台",
  "group": "frontend",
  "cwd": "kmcb-admin-webapp",
  "port": 5211,
  "protocol": "http",
  "openUrl": "http://127.0.0.1:5211",
  "command": "exec npm run dev:mac",
  "commandWindows": "npm run dev"
}
```

Java 后端示例：

```json
{
  "id": "main-api",
  "name": "BMS 主 API",
  "group": "backend",
  "cwd": "kmcb-admin-api/KJDigitalProject",
  "port": 8084,
  "protocol": "http",
  "openUrl": "http://127.0.0.1:8084/swagger-ui.html",
  "command": "mvn -q -pl KJ-web -am -DskipTests package && exec java -jar KJ-web/target/KJ-web-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev",
  "commandWindows": "mvn -q -pl KJ-web -am -DskipTests package && java -jar KJ-web/target/KJ-web-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev"
}
```

配置中的 `port` 不会自动改变应用实际监听端口。
必须确保 `commandWindows` 或业务项目配置让应用监听同一个端口。

### 5.3 平台环境变量

环境变量字段分为：

| 字段 | 生效范围 |
| --- | --- |
| `env` | macOS 和 Windows 共用 |
| `envPosix` | macOS/POSIX 专用 |
| `envWindows` | Windows 专用 |

例如：

```json
{
  "env": {
    "APP_MODE": "development"
  },
  "envPosix": {
    "JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
  },
  "envWindows": {
    "JAVA_HOME": "C:/Program Files/Eclipse Adoptium/jdk-17.0.12.7-hotspot"
  }
}
```

平台专用字段会覆盖同名公共字段。
朋友必须把 `envWindows.JAVA_HOME` 改成本机真实 JDK 路径。

执行以下命令检查 Windows Java 和 Maven：

```powershell
java -version
mvn -version
where.exe java
where.exe mvn
```

### 5.4 先独立验证业务命令

在把服务交给控制中心前，先进入真实项目目录执行 Windows 命令。

例如：

```powershell
Set-Location 'C:\Users\Alice\Developer\projects\kmcb-admin-webapp'
npm run dev
```

确认项目能启动并监听预期端口后，使用 `Ctrl+C` 停止，再继续安装控制中心。
不要让这个手动进程继续占用端口，否则首次通过控制中心启动时会显示 `conflict`。

## 6. 安装前验证控制中心

回到控制中心源码目录：

```powershell
Set-Location $ControlRepo
npm run check
npm test
```

测试使用临时目录和随机端口，不会操作注册表中的真实业务服务。

只校验配置：

```powershell
node --input-type=module -e "import('./src/config.mjs').then(({ loadConfig }) => { const config = loadConfig(); console.log('workspaceRoot:', config.workspaceRoot); console.log('services:', config.services.length); })"
```

检查控制端口：

```powershell
Get-NetTCPConnection -LocalPort 17600 -State Listen -ErrorAction SilentlyContinue
```

如果端口由未知进程占用，不要直接执行 `Stop-Process`。
先确认进程归属，或为控制中心和所有服务重新规划唯一端口。
Windows 安装脚本会读取 `config/services.json` 中的控制端口，并拒绝替换归属不明的监听进程。

## 7. 安装 Windows 版本

### 7.1 允许当前 PowerShell 会话执行脚本

如果本机执行策略阻止本地脚本，执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

这只影响当前 PowerShell 进程，不修改系统级执行策略。

### 7.2 执行安装

```powershell
.\scripts\install-windows.ps1
```

安装脚本会：

1. 解析本机 `config/services.json` 并读取控制端口。
2. 停止并替换已有的当前用户 `KMCBServiceControl` 计划任务。
3. 拒绝覆盖由无关进程占用的控制端口。
4. 把代码和配置复制到 `%LOCALAPPDATA%\KMCBServiceControl`。
5. 在运行目录生成 `kmcb-svc.cmd` 和控制中心启动包装脚本。
6. 把运行目录的 `bin` 加入当前用户 PATH。
7. 创建使用当前用户、`Limited` 权限和登录触发器的计划任务。
8. 启动计划任务并轮询本机状态 API。

成功输出类似：

```text
Installed KMCBServiceControl
Dashboard: http://127.0.0.1:17600
CLI for this PowerShell session: kmcb-svc status
```

安装完成后建议关闭并重新打开 PowerShell，使当前用户 PATH 在所有终端中生效。

## 8. Windows 安装位置

| 内容 | 位置 |
| --- | --- |
| 安装运行副本 | `%LOCALAPPDATA%\KMCBServiceControl` |
| CLI | `%LOCALAPPDATA%\KMCBServiceControl\bin\kmcb-svc.cmd` |
| 控制中心日志 | `%LOCALAPPDATA%\KMCBServiceControl\runtime\control-center.log` |
| 业务服务日志 | `%LOCALAPPDATA%\KMCBServiceControl\runtime\logs\<service-id>.log` |
| 控制 Token | `%LOCALAPPDATA%\KMCBServiceControl\runtime\control-token` |
| 秘密环境文件 | `%LOCALAPPDATA%\KMCBServiceControl\runtime\service-env\<service-id>.env` |
| 登录自启动 | 当前用户计划任务 `KMCBServiceControl` |

安装后运行的是 `%LOCALAPPDATA%` 中的副本，不是 Git 源码目录。
修改源码或 `config/services.json` 后必须重新运行安装脚本同步。

## 9. 首次验证

打开新的 PowerShell，执行：

```powershell
where.exe kmcb-svc
kmcb-svc status
Invoke-RestMethod http://127.0.0.1:17600/api/status
Get-ScheduledTask -TaskName KMCBServiceControl
```

然后在浏览器打开：

```text
http://127.0.0.1:17600
```

先选择一个影响较小的服务验证完整生命周期：

```powershell
kmcb-svc start admin-web
kmcb-svc status admin-web
kmcb-svc logs admin-web
kmcb-svc stop admin-web
```

把 `admin-web` 替换成朋友注册表中的真实服务 ID。

## 10. 秘密环境变量

不要把密码、Token、数据库密码或 SMTP 密码提交到 `config/services.json`。
在当前用户 runtime 下创建服务秘密文件：

```powershell
$RuntimeDir = Join-Path $env:LOCALAPPDATA 'KMCBServiceControl\runtime'
$SecretDir = Join-Path $RuntimeDir 'service-env'
$SecretFile = Join-Path $SecretDir 'crm-gateway.env'
New-Item -ItemType Directory -Path $SecretDir -Force | Out-Null
New-Item -ItemType File -Path $SecretFile -Force | Out-Null
notepad.exe $SecretFile
```

文件内容使用 `KEY=value`：

```dotenv
SMTP_USERNAME=replace-with-real-value
SMTP_PASSWORD=replace-with-real-value
```

文件位于当前用户的 `%LOCALAPPDATA%` 中，并依赖 Windows 用户 ACL 保护。
如需显式限制 ACL，可以执行：

```powershell
icacls $SecretFile /inheritance:r /grant:r "${env:USERNAME}:(F)"
```

修改秘密文件后重启对应业务服务即可，不需要重新安装控制中心。

## 11. 不安装计划任务的前台运行方式

这个方式适合安装受组策略限制时临时验证，不适合长期使用。

在控制中心源码目录执行：

```powershell
$env:SERVICE_CONTROL_RUNTIME = Join-Path $env:LOCALAPPDATA 'KMCBServiceControl\runtime'
node .\src\server.mjs
```

保持该窗口打开，再从另一个 PowerShell 使用源码 CLI：

```powershell
node .\bin\svc.mjs status
```

关闭服务器窗口后控制中心会停止，登录时也不会自动启动。

## 12. Windows 进程归属与冲突规则

Windows 无法像 macOS `lsof -d cwd` 一样稳定读取所有外部进程的当前工作目录。
因此 Windows 使用更保守的规则：

- 控制中心启动服务时记录根 `cmd.exe` PID。
- 状态检查通过 PowerShell CIM 建立该 PID 的完整子进程树。
- 监听端口 PID 位于该进程树中时，状态可以是 `running` 或 `unhealthy`。
- 监听端口 PID 不在该进程树中时，状态是 `conflict`。
- `stop` 和 `restart` 只对记录的受管进程树使用 `taskkill.exe /T /F`。
- 无法确认归属的外部监听绝不会被停止。

如果朋友先从 IntelliJ、VS Code 或独立终端启动服务，Windows 控制中心会把该端口视为冲突。
应从原启动入口正常停止服务，然后改由控制中心启动。

## 13. 日常命令

```powershell
kmcb-svc status
kmcb-svc status <service-id>
kmcb-svc start <service-id>
kmcb-svc stop <service-id>
kmcb-svc restart <service-id>
kmcb-svc logs <service-id>
```

不要同时从控制中心、IDE 和独立终端重复启动同一服务。

## 14. 修改配置和升级

从 GitHub 获取更新前，先保存朋友本机的 `config/services.json`。
该文件受 Git 跟踪，并且每台机器的路径可能不同。

配置没有本地改动时：

```powershell
git pull --ff-only
npm run check
npm test
.\scripts\install-windows.ps1
kmcb-svc status
```

配置有本地改动时，先备份并暂存：

```powershell
$ConfigBackup = Join-Path $env:TEMP "services.$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
Copy-Item .\config\services.json $ConfigBackup
git stash push -m 'local Windows service registry before update' -- config/services.json
git pull --ff-only
git stash pop
npm run check
npm test
.\scripts\install-windows.ps1
```

发生配置冲突时，根据本机真实路径、端口、命令和上游新增字段手动合并，并使用 `$ConfigBackup` 对照。

如果 Node.js 安装路径发生变化，也必须重新运行安装脚本，因为 Windows 包装脚本保存了安装时解析到的 Node.js 绝对路径。

## 15. 日志和诊断

查看控制中心日志：

```powershell
Get-Content "$env:LOCALAPPDATA\KMCBServiceControl\runtime\control-center.log" -Tail 200
```

查看业务服务日志：

```powershell
kmcb-svc logs <service-id>
```

查看计划任务：

```powershell
Get-ScheduledTask -TaskName KMCBServiceControl | Format-List *
Get-ScheduledTaskInfo -TaskName KMCBServiceControl
```

查看控制端口：

```powershell
Get-NetTCPConnection -LocalPort 17600 -State Listen -ErrorAction SilentlyContinue
```

查看指定 PID：

```powershell
Get-CimInstance Win32_Process -Filter 'ProcessId = 1234' | Select-Object ProcessId, ParentProcessId, CommandLine
```

把 `1234` 替换为真实 PID。

## 16. 常见问题

### 16.1 PowerShell 禁止执行脚本

使用当前进程范围的临时放行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows.ps1
```

不要为了这个工具修改整台机器的系统级执行策略。

### 16.2 `node.exe` 找不到

确认 Node.js 20 或更高版本已经安装，并在新的 PowerShell 中执行：

```powershell
where.exe node
node --version
```

### 16.3 `kmcb-svc` 找不到

先打开新的 PowerShell。
仍然找不到时直接执行：

```powershell
& "$env:LOCALAPPDATA\KMCBServiceControl\bin\kmcb-svc.cmd" status
```

检查用户 PATH：

```powershell
[Environment]::GetEnvironmentVariable('Path', 'User')
```

### 16.4 服务显示 `conflict`

Windows 上这通常表示端口由控制中心进程树以外的进程监听。
从 IntelliJ、VS Code、终端或任务管理器确认原进程归属，并从原启动入口正常停止。
不要强制结束不确定归属的 PID。

### 16.5 服务一直 `starting`

执行：

```powershell
kmcb-svc logs <service-id>
```

检查 `commandWindows`、业务依赖、实际监听端口、Java 或 Node.js 版本，以及首次构建是否超过 `startupTimeoutMs`。

### 16.6 Java 路径不正确

执行：

```powershell
where.exe java
java -version
mvn -version
```

把真实 JDK 根目录写入对应服务的 `envWindows.JAVA_HOME`，然后重新运行安装脚本。

### 16.7 安装器拒绝占用的控制端口

安装器只会替换命令行明确属于当前源码目录或 `%LOCALAPPDATA%\KMCBServiceControl` 的控制中心进程。
如果端口属于其他进程，安装会停止并报告 PID。
应确认占用者或更改配置，不要绕过检查。

## 17. 卸载

完全卸载并删除 runtime、日志、Token 和秘密环境文件：

```powershell
.\scripts\uninstall-windows.ps1
```

卸载程序代码但保留 runtime 数据：

```powershell
.\scripts\uninstall-windows.ps1 -KeepRuntime
```

卸载脚本会：

- 停止并删除当前用户计划任务。
- 只停止命令行属于安装运行目录的控制中心监听进程。
- 从当前用户 PATH 中删除控制中心 `bin` 目录。
- 根据 `-KeepRuntime` 决定保留或删除 runtime。
- 不删除 Git 源码仓库和任何业务项目仓库。

完全卸载前应备份需要保留的 `service-env` 秘密文件和日志。

## 18. Windows 最终验收清单

- Windows 10 或 Windows 11 环境可用。
- Node.js 版本为 20 或更高。
- `workspaceRoot` 已替换为朋友机器的真实绝对路径。
- 每个保留服务的 `cwd` 真实存在。
- 每个服务的 `id` 和 `port` 唯一。
- 每个 `commandWindows` 已在对应项目目录独立验证。
- Java 服务的 `envWindows.JAVA_HOME` 使用本机真实路径。
- 密码和 Token 只存放在 `%LOCALAPPDATA%` 的 `service-env` 中。
- `npm run check` 和 `npm test` 通过。
- PowerShell 安装脚本成功完成。
- 计划任务 `KMCBServiceControl` 存在并正在运行。
- `kmcb-svc status` 可以列出服务。
- 浏览器可以打开 `http://127.0.0.1:17600`。
- 至少完成一个低风险服务的启动、状态、日志和停止验证。
- 外部端口占用显示为 `conflict`，且控制中心拒绝停止它。

## 19. 已知限制

- Windows 上只自动控制由控制中心启动并记录的进程树。
- 从 IDE 或其他终端启动的外部服务会显示为冲突，即使它属于同一个项目。
- Windows 停止使用 `taskkill.exe /T /F`，业务服务不会收到 POSIX `SIGTERM`。
- 安装依赖当前用户能够创建 Windows 计划任务。
- Linux 尚未提供经过验证的进程管理和安装实现。
- `config/services.json` 是受 Git 跟踪的机器配置，多台机器更新时需要手动处理路径差异。
