# kmcb-service-control-centre macOS 安装与迁移指南

本指南面向第一次在另一台 Mac 上安装 `kmcb-service-control-centre` 的使用者。
重点是处理不同用户名、不同源码目录、不同业务仓库目录、不同端口和不同 Java 环境带来的差异。
Windows 使用者请阅读 [Windows 安装与使用指南](setup-guide.windows.zh-CN.md)。

## 1. 先理解三个不同的位置

安装过程中会出现三个不同的位置，不要把它们混在一起。

| 位置 | 用途 | 是否可以自定义 |
| --- | --- | --- |
| 控制中心源码目录 | 保存本仓库代码和 `config/services.json` | 可以放在任意位置 |
| 业务工作区根目录 | 保存被控制的前端和后端项目 | 必须在 `services.json` 中配置为绝对路径 |
| 安装运行目录 | macOS LaunchAgent 实际运行的副本 | 固定为 `~/Library/Application Support/KMCBServiceControl` |

例如，朋友的目录可以是：

```text
/Users/alice/Developer/kmcb-service-control-centre
/Users/alice/Developer/projects/kmcb-admin-webapp
/Users/alice/Developer/projects/kmcb-admin-api
/Users/alice/Developer/projects/kmcb-crm-api
```

在这个例子中：

- 控制中心源码目录是 `/Users/alice/Developer/kmcb-service-control-centre`。
- 业务工作区根目录是 `/Users/alice/Developer/projects`。
- `kmcb-admin-webapp` 等服务的 `cwd` 相对于业务工作区根目录填写。
- 安装脚本会根据当前登录用户自动使用 `/Users/alice/Library/Application Support/KMCBServiceControl`，不需要手动修改脚本。

## 2. 支持范围与前置条件

### 2.1 当前支持范围

本指南中的安装流程面向 macOS，并使用 `launchctl`、`lsof`、`ps`、`zsh` 和用户级 LaunchAgent。
项目同时提供 Windows 实现，但 Windows 的安装命令、运行目录和进程归属规则不同，应使用独立 Windows 指南。
Linux 尚未提供经过验证的安装流程。

### 2.2 必需软件

安装前确认以下软件可用：

- macOS。
- Node.js 20 或更高版本。
- npm。
- Git，仅在通过 Git 获取或更新源码时需要。
- 被管理项目自身需要的运行环境，例如 Maven、Java、pnpm 或 npm。
- 管理 `mobile-web` 时需要安装 HBuilderX，标准 `/Applications/HBuilderX.app` 路径会被自动识别。

执行以下命令检查基础环境：

```bash
sw_vers
node --version
npm --version
git --version
/usr/sbin/lsof -v | head -n 1
```

`node --version` 必须显示 `v20` 或更高主版本。
本项目当前没有第三方 npm 依赖，因此不要求先执行 `npm install`。

如果 HBuilderX 不在标准位置，请在 `mobile-web` 的 `envPosix` 中设置：

```json
"envPosix": {
  "HBUILDERX_HOME": "/自定义目录/HBuilderX.app"
}
```

启动器会使用 HBuilderX 自带的 Node.js、Vite 和 uni-app 编译器，不要求给 `kmcb-mobile` 增加 npm 启动脚本。

### 2.3 被管理项目必须先能独立运行

控制中心负责统一启动、停止、状态检查和日志收集，但不会自动安装业务项目的依赖。
每个业务项目的启动命令应先在其自身目录中手动验证一次。
确认启动命令、运行时、端口和环境变量正确后，再把命令写入服务注册表。

## 3. 获取控制中心源码

### 3.1 通过 Git 仓库获取

如果 Titus 已经把仓库推送到 Git 托管平台，请把真实地址替换到下面的命令中：

```bash
KMCB_CONTROL_REPO="/Users/alice/Developer/kmcb-service-control-centre"
git clone REPLACE_WITH_REPOSITORY_URL "$KMCB_CONTROL_REPO"
cd "$KMCB_CONTROL_REPO"
```

`KMCB_CONTROL_REPO` 只是当前终端会话中的辅助变量，可以换成任何有写权限的绝对路径。
控制中心源码目录不要求与业务项目位于同一个父目录。

### 3.2 通过 ZIP 文件获取

如果收到的是 ZIP 文件，可以执行：

```bash
KMCB_CONTROL_REPO="/Users/alice/Developer/kmcb-service-control-centre"
mkdir -p "$KMCB_CONTROL_REPO"
ditto -x -k "/Users/alice/Downloads/kmcb-service-control-centre.zip" "$KMCB_CONTROL_REPO"
cd "$KMCB_CONTROL_REPO"
chmod +x bin/svc.mjs scripts/install-launch-agent.sh scripts/uninstall-launch-agent.sh
```

ZIP 文件位置和目标目录需要替换成接收者机器上的真实路径。
`chmod` 步骤用于处理某些分享方式丢失可执行权限的情况。

### 3.3 确认源码完整

仓库根目录至少应包含以下内容：

```text
AGENTS.md
CHANGELOG.md
README.md
bin/
config/
docs/
package.json
public/
scripts/
src/
test/
```

执行以下命令确认当前目录正确：

```bash
pwd
test -f package.json
test -f config/services.json
test -x scripts/install-launch-agent.sh
```

## 4. 规划朋友机器上的业务工作区

### 4.1 选择 `workspaceRoot`

`workspaceRoot` 必须是绝对路径，并且必须包含所有被管理服务的项目目录。
建议选择能够包含这些项目的最窄共同父目录，不要直接使用 `/` 或整个用户主目录。

例如：

```text
/Users/alice/Developer/projects
├── kmcb-admin-api
├── kmcb-admin-webapp
├── kmcb-crm-api
└── kmcb-trace-web
```

对应配置应为：

```json
"workspaceRoot": "/Users/alice/Developer/projects"
```

如果业务仓库散落在多个位置，应先整理到一个共同父目录，或将 `workspaceRoot` 设置为能安全覆盖它们的共同父目录。
现有目录如果通过符号链接指向 `workspaceRoot` 外部，配置校验可能根据真实路径拒绝该服务，因此不要依赖符号链接绕过目录边界。

### 4.2 列出实际项目路径

在修改配置前，建议先建立一张本机清单：

| 服务 | 项目绝对路径 | 预期端口 | 启动命令 | 运行时 |
| --- | --- | --- | --- | --- |
| 管理后台 | `/Users/alice/Developer/projects/kmcb-admin-webapp` | `5211` | `npm run dev:mac` | Node.js |
| 主 API | `/Users/alice/Developer/projects/kmcb-admin-api/KJDigitalProject` | `8084` | Maven 打包后运行 JAR | Java |
| 其他服务 | 按本机实际路径填写 | 按项目配置填写 | 按项目验证结果填写 | 按项目要求填写 |

仓库自带的 `config/services.json` 是 Titus 机器的注册表示例，不应不经检查直接用于另一台机器。
朋友只应保留自己实际拥有并准备管理的服务。

## 5. 修改 `config/services.json`

### 5.1 顶层字段

配置文件入口是 `config/services.json`。
顶层字段含义如下：

| 字段 | 说明 | 建议 |
| --- | --- | --- |
| `title` | 页面标题 | 可以按团队或个人习惯修改 |
| `host` | 控制中心监听地址 | 只能使用 `127.0.0.1` 或 `localhost` |
| `port` | 控制中心端口 | 默认 `17600`，不能与业务服务端口重复 |
| `pollIntervalMs` | 页面刷新状态的间隔 | 默认 `2000` |
| `startupTimeoutMs` | 服务启动等待端口的最长时间 | 默认 `60000` |
| `stopTimeoutMs` | 优雅停止等待时间 | 默认 `12000` |
| `workspaceRoot` | 所有业务项目的共同父目录 | 必须改为朋友机器上的绝对路径 |
| `services` | 被管理服务列表 | 删除不存在的服务并逐项校正 |

不要把 `host` 改成 `0.0.0.0` 或局域网地址。
控制 API 具有启动和停止本机进程的能力，只允许绑定到本机回环地址。

### 5.2 每个服务的字段

每个服务对象主要包含以下字段：

| 字段 | 是否必需 | 说明 |
| --- | --- | --- |
| `id` | 是 | CLI 使用的唯一标识，只能使用小写字母、数字和连字符 |
| `name` | 否 | 页面显示名称 |
| `projectName` | 否 | 页面显示的项目名称，省略时会从路径推导 |
| `description` | 否 | 服务用途说明 |
| `group` | 否 | 页面分组，例如 `frontend` 或 `backend` |
| `cwd` | 是 | 相对于 `workspaceRoot` 的项目工作目录 |
| `port` | 是 | 服务实际监听的唯一端口 |
| `protocol` | 是 | `http`、`https` 或 `tcp` |
| `openUrl` | 否 | 页面打开和 HTTP 健康检查使用的地址 |
| `command` | 是 | 在 `cwd` 中由 `/bin/zsh -lc` 执行的启动命令 |
| `commandWindows` | 否 | Windows 专用的 `cmd.exe` 命令，macOS 会忽略 |
| `env` | 否 | 两个平台共用且可以提交的非秘密环境变量 |
| `envPosix` | 否 | macOS/POSIX 专用的非秘密环境变量 |
| `envWindows` | 否 | Windows 专用的非秘密环境变量 |

`id` 和 `port` 在整个文件中必须唯一。
业务服务的 `port` 也不能与控制中心端口 `17600` 重复。
`cwd` 对应的目录不存在时，控制中心可以启动，但该服务会显示为不可控制。
配置中的 `port` 不会自动改变业务应用的端口，启动命令或业务项目配置必须确保应用实际监听同一个端口。

### 5.3 最小可用配置示例

下面的例子只管理一个前端项目：

```json
{
  "title": "Alice Local Service Control",
  "host": "127.0.0.1",
  "port": 17600,
  "pollIntervalMs": 2000,
  "startupTimeoutMs": 60000,
  "stopTimeoutMs": 12000,
  "workspaceRoot": "/Users/alice/Developer/projects",
  "services": [
    {
      "id": "admin-web",
      "name": "管理后台",
      "description": "BMS 前端",
      "group": "frontend",
      "cwd": "kmcb-admin-webapp",
      "port": 5211,
      "protocol": "http",
      "openUrl": "http://127.0.0.1:5211",
      "command": "exec npm run dev:mac"
    }
  ]
}
```

JSON 不支持注释，也不允许最后一个字段或数组项后面保留多余逗号。

### 5.4 启动命令的注意事项

长时间运行的最终进程建议使用 `exec`，这样控制中心能够更可靠地管理进程生命周期。

前端示例：

```json
"command": "exec npm run dev -- --port 3300"
```

Java 后端示例：

```json
"command": "mvn -q -pl KJ-web -am -DskipTests package && exec java -jar KJ-web/target/KJ-web-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev"
```

不要直接复制与朋友项目版本不一致的 JAR 名称、Maven 模块名或 Spring Profile。
先在对应 `cwd` 目录手动执行并确认命令可用，再写入注册表。

### 5.5 Java 路径差异

仓库当前示例对部分 CRM 服务写有 Titus 机器上的 Temurin Java 17 路径：

```json
"env": {
  "JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
}
```

朋友应执行以下命令查看本机可用 JDK：

```bash
/usr/libexec/java_home -V
/usr/libexec/java_home -v 17
```

如果项目需要 Java 17，应把 `/usr/libexec/java_home -v 17` 输出的真实路径写入 `JAVA_HOME`。
如果项目不要求固定 JDK，可以删除该服务的 `env.JAVA_HOME`，但应先确认默认 `java` 和 `mvn` 使用正确版本。

## 6. 配置秘密环境变量

密码、Token、SMTP 密码和数据库密码不得写入 `config/services.json`。
控制中心会在启动服务时读取以下位置：

```text
~/Library/Application Support/KMCBServiceControl/runtime/service-env/<service-id>.env
```

建议先完成第 8 节安装，再创建秘密文件。

以 `crm-gateway` 为例：

```bash
KMCB_RUNTIME_DIR="$HOME/Library/Application Support/KMCBServiceControl/runtime"
mkdir -p "$KMCB_RUNTIME_DIR/service-env"
chmod 700 "$KMCB_RUNTIME_DIR/service-env"
touch "$KMCB_RUNTIME_DIR/service-env/crm-gateway.env"
chmod 600 "$KMCB_RUNTIME_DIR/service-env/crm-gateway.env"
nano "$KMCB_RUNTIME_DIR/service-env/crm-gateway.env"
```

文件内容使用普通 `KEY=value` 格式：

```dotenv
SMTP_USERNAME=replace-with-real-value
SMTP_PASSWORD=replace-with-real-value
```

秘密文件必须使用 `600` 权限，否则控制中心会拒绝读取。
秘密文件只在对应服务启动时读取，修改后需要重启该业务服务，但不需要重新安装控制中心。
安装脚本会保留运行目录中的秘密文件。
卸载脚本会删除整个运行目录，也会删除这些秘密文件，因此卸载前必须自行备份需要保留的秘密配置。

## 7. 安装前验证

### 7.1 检查源码语法和测试

在控制中心源码目录执行：

```bash
npm run check
npm test
```

测试使用临时目录和随机端口，不会启动、停止或重启注册表中的真实业务服务。

### 7.2 只验证配置文件

下面的命令会加载并校验 `config/services.json`，但不会启动控制中心或业务服务：

```bash
node --input-type=module -e "import('./src/config.mjs').then(({ loadConfig }) => { const config = loadConfig(); console.log('workspaceRoot:', config.workspaceRoot); console.log('services:', config.services.length); })"
```

常见配置错误包括：

- `workspaceRoot` 不是朋友机器上的真实绝对路径。
- 两个服务使用了同一个 `id`。
- 两个服务使用了同一个端口。
- 业务服务端口与控制中心端口重复。
- `cwd` 解析后位于 `workspaceRoot` 外部。
- `protocol` 不是 `http`、`https` 或 `tcp`。
- `command` 为空。

### 7.3 检查控制中心端口

执行：

```bash
/usr/sbin/lsof -nP -iTCP:17600 -sTCP:LISTEN
```

没有输出表示端口当前未被监听。
如果端口由另一个应用占用，不要直接终止未知进程。
应先确认进程归属，或者在 `services.json` 中为控制中心选择另一个未占用且不与业务服务重复的端口。
当前安装脚本的端口占用检查固定检查 `17600`，因此如果需要更换控制中心端口，应先调整安装脚本实现并补充测试，而不是只修改 JSON。

## 8. 安装为 macOS 登录服务

在控制中心源码目录执行：

```bash
./scripts/install-launch-agent.sh
```

安装脚本会完成以下操作：

1. 检查 `17600` 是否被不属于控制中心的进程占用。
2. 将 `src`、`public`、`config`、`bin` 和 `package.json` 同步到 `~/Library/Application Support/KMCBServiceControl`。
3. 创建用户级 LaunchAgent `~/Library/LaunchAgents/com.kmcb.service-control.plist`。
4. 创建 CLI 链接 `~/.local/bin/kmcb-svc`。
5. 启动控制中心并检查 `http://127.0.0.1:17600/api/status`。

安装成功后应看到类似输出：

```text
Installed com.kmcb.service-control
Dashboard: http://127.0.0.1:17600
CLI: /Users/alice/.local/bin/kmcb-svc status
```

安装脚本自动使用当前用户的主目录和当前 Node.js 可执行文件路径。
控制中心源码目录可以与 Titus 的目录完全不同，不需要修改安装脚本中的 `HOME` 相关路径。

## 9. 配置 CLI 的 PATH

即使 `~/.local/bin` 尚未加入 `PATH`，也可以直接执行：

```bash
"$HOME/.local/bin/kmcb-svc" status
```

如果希望直接使用 `kmcb-svc`，确认当前 shell 的 `PATH`：

```bash
echo "$PATH"
command -v kmcb-svc
```

如果找不到命令，在 `~/.zshrc` 中加入以下一行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

然后重新打开终端，或执行：

```bash
source "$HOME/.zshrc"
command -v kmcb-svc
```

## 10. 首次验证

### 10.1 验证控制中心 API

```bash
curl -fsS http://127.0.0.1:17600/api/status
```

成功时会返回包含 `summary` 和 `services` 的 JSON。

### 10.2 验证 CLI

```bash
kmcb-svc status
kmcb-svc status admin-web
```

第二条命令中的 `admin-web` 应替换为朋友配置中的真实服务 ID。

### 10.3 验证页面

在浏览器中打开：

```text
http://127.0.0.1:17600
```

逐项检查项目名称、工作目录、端口和状态是否与朋友机器一致。
第一次验证时建议先选择一个影响较小的服务执行启动和停止，不要一次启动全部后端服务。

### 10.4 验证一个业务服务

```bash
kmcb-svc start admin-web
kmcb-svc status admin-web
kmcb-svc logs admin-web
kmcb-svc stop admin-web
```

仅使用朋友注册表中确实存在的服务 ID。
控制中心以注册表中的 `cwd` 和 `command` 启动服务，并检查配置端口是否被该项目目录中的进程监听。

## 11. 日常使用

```bash
kmcb-svc status
kmcb-svc status <service-id>
kmcb-svc start <service-id>
kmcb-svc stop <service-id>
kmcb-svc restart <service-id>
kmcb-svc logs <service-id>
```

安装完成后，服务生命周期操作应统一通过页面或 `kmcb-svc` 执行。
不要同时在控制中心、IDE 和其他终端中重复启动同一服务。
控制中心可以识别由 IDE 或终端启动且工作目录匹配的外部进程，但统一入口可以减少重复进程和端口冲突。

## 12. 修改配置或升级代码

安装后运行的是 `Application Support` 中的副本，不是源码目录本身。
修改 `config/services.json`、`src`、`public` 或 `bin` 后，必须重新执行安装脚本：

```bash
npm run check
npm test
./scripts/install-launch-agent.sh
kmcb-svc status
```

安装脚本会重新同步代码和注册表，但保留 `runtime` 下的日志、状态、控制 Token 和秘密环境文件。

当前实现把 `config/services.json` 作为受 Git 跟踪的机器配置文件。
朋友修改本机路径后，Git 会显示该文件有本地改动。
执行 `git pull` 前应先检查并备份本机配置，避免上游注册表更新覆盖个人路径或产生不易理解的合并冲突。

如果 `config/services.json` 没有本地改动，可以直接执行：

```bash
git pull --ff-only
npm run check
npm test
./scripts/install-launch-agent.sh
```

如果 `config/services.json` 有本机路径改动，先备份并暂存该文件，再更新和恢复：

```bash
KMCB_CONFIG_BACKUP="/tmp/services.$(date +%Y%m%d-%H%M%S).json"
cp config/services.json "$KMCB_CONFIG_BACKUP"
git stash push -m "local service registry before update" -- config/services.json
git pull --ff-only
git stash pop
npm run check
npm test
./scripts/install-launch-agent.sh
```

只在 `git status --short` 明确显示 `config/services.json` 有改动时使用上述 `git stash` 流程。
如果 `git stash pop` 报告冲突，应根据朋友机器的实际路径、端口和项目组合手动合并，并使用 `$KMCB_CONFIG_BACKUP` 对照，不要直接采用任意一侧的完整文件。

## 13. 状态含义

| 状态 | 含义 | 建议处理 |
| --- | --- | --- |
| `running` | 端口由匹配项目目录的进程监听，健康检查通过 | 正常使用 |
| `stopped` | 没有匹配进程监听端口 | 确认项目目录存在后启动 |
| `starting` | 已启动进程，仍在等待端口 | 等待或查看日志 |
| `unhealthy` | 端口已监听但 HTTP 检查失败，或启动超时 | 查看日志、协议和 `openUrl` |
| `conflict` | 端口被其他项目目录中的进程占用 | 确认占用者，不要由控制中心强制停止 |

控制中心会拒绝停止工作目录不匹配的端口占用进程。
这是防止误杀其他项目的重要安全边界，不应绕过。

## 14. 日志与诊断

### 14.1 控制中心日志

```text
~/Library/Application Support/KMCBServiceControl/runtime/control-center.log
```

查看最近日志：

```bash
tail -n 200 "$HOME/Library/Application Support/KMCBServiceControl/runtime/control-center.log"
```

### 14.2 业务服务日志

```text
~/Library/Application Support/KMCBServiceControl/runtime/logs/<service-id>.log
```

优先通过 CLI 查看：

```bash
kmcb-svc logs <service-id>
```

### 14.3 LaunchAgent 状态

```bash
launchctl print "gui/$UID/com.kmcb.service-control"
```

### 14.4 确认监听进程

```bash
/usr/sbin/lsof -nP -iTCP:17600 -sTCP:LISTEN
```

## 15. 常见问题

### 15.1 `Project directory does not exist`

原因通常是 `workspaceRoot` 或服务 `cwd` 仍然使用 Titus 的目录结构。
把 `workspaceRoot` 改成朋友机器上的真实共同父目录，并把 `cwd` 改成相对该目录的真实路径。
修改后重新运行安装脚本。

### 15.2 `Duplicate or reserved port`

两个服务使用了同一端口，或者某个服务使用了控制中心端口。
为每个服务分配唯一端口，并同步修改业务项目的实际启动端口和 `openUrl`。

### 15.3 `Refusing installation: port 17600 belongs to ...`

端口 `17600` 正由另一个目录中的进程使用。
先用 `lsof` 和 `ps` 确认进程归属。
不要终止不确定归属的进程。

### 15.4 服务一直是 `starting` 或变成 `unhealthy`

先执行：

```bash
kmcb-svc logs <service-id>
```

然后检查以下内容：

- 依赖是否已经安装。
- 启动命令是否能在服务 `cwd` 中独立运行。
- 应用实际端口是否与注册表一致。
- `protocol` 和 `openUrl` 是否正确。
- Java、Maven、Node.js 等运行时是否正确。
- 首次构建是否超过 `startupTimeoutMs`。

### 15.5 `kmcb-svc: command not found`

直接使用 `"$HOME/.local/bin/kmcb-svc"`，或按照第 9 节把 `~/.local/bin` 加入 `PATH`。

### 15.6 Java 或 Maven 使用了错误版本

执行：

```bash
java -version
mvn -version
/usr/libexec/java_home -V
```

为需要固定 JDK 的服务在 `env.JAVA_HOME` 中填写朋友机器的真实路径，然后重新安装控制中心。

### 15.7 秘密环境文件被拒绝

执行：

```bash
chmod 600 "$HOME/Library/Application Support/KMCBServiceControl/runtime/service-env/<service-id>.env"
```

把 `<service-id>` 替换为真实服务 ID。
如果文件内容格式错误，确保每个有效行都使用 `KEY=value`，并删除无效语法。

## 16. 卸载

在控制中心源码目录执行：

```bash
./scripts/uninstall-launch-agent.sh
```

卸载脚本会停止并移除 LaunchAgent、删除 `~/.local/bin/kmcb-svc` 链接，并删除整个 `~/Library/Application Support/KMCBServiceControl` 目录。
这会同时删除控制 Token、状态、日志和 `service-env` 中的秘密文件。
需要保留的日志或秘密配置必须在卸载前备份。
卸载不会删除控制中心源码仓库，也不会删除任何业务项目仓库。

## 17. 分享前检查清单

Titus 分享仓库前应确认：

- 已提交本指南、README 入口和 CHANGELOG 更新。
- 仓库中没有 `.runtime`、控制 Token、日志或秘密环境文件。
- `config/services.json` 中没有密码、Token 或其他秘密。
- 已明确告诉接收者，仓库自带注册表是示例，必须逐项修改本机路径和运行时。
- 如果通过 ZIP 分享，ZIP 来源应是已提交的 Git 内容，而不是包含本地忽略文件的整个目录复制。

可以从已提交版本生成干净 ZIP：

```bash
git archive --format=zip --output ../kmcb-service-control-centre.zip HEAD
```

## 18. 接收者最终验收清单

- Node.js 版本为 20 或更高。
- `workspaceRoot` 是接收者机器上的绝对路径。
- 每个保留服务的 `cwd` 真实存在并位于 `workspaceRoot` 内。
- 每个 `id` 和 `port` 唯一。
- 每个启动命令已在对应项目目录中单独验证。
- `JAVA_HOME` 等运行时路径已替换为接收者机器上的真实路径。
- 秘密变量只保存在 mode `600` 的 `service-env` 文件中。
- `npm run check` 和 `npm test` 通过。
- 安装脚本成功完成。
- `curl http://127.0.0.1:17600/api/status` 返回状态。
- `kmcb-svc status` 能列出服务。
- 页面只通过 `http://127.0.0.1:17600` 在本机访问。
- 至少完成一个低风险服务的启动、日志、状态和停止验证。

## 19. 已知限制

- 本文只描述 macOS，Windows 应使用独立的 Windows 指南。
- macOS 安装脚本的控制端口预检仍固定为 `17600`，仅修改 JSON 中的控制中心端口并不足以完成 macOS 迁移。
- `config/services.json` 当前是受 Git 跟踪的机器配置，不同使用者需要自行处理本地路径修改与后续上游更新之间的合并。
- 仓库不会安装或修复业务项目自身的 Node.js、Java、Maven、数据库或其他依赖。
- 页面和 API 只应在本机回环地址使用，不支持公开部署、反向代理或隧道暴露。
