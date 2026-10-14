# Hyper Clock Back Stage

整套 Q775 系统的唯一控制面与安全边界，运行在 3001 端口，由根目录网关暴露为 `/admin`、`/ha` 和 `/api`。

## 职责

- 统一登录、管理员/只读权限、IP 绑定会话与会话撤销。
- 唯一持有 Home Assistant 长期令牌，维护进程级单例 WebSocket 连接。
- 提供 HA 原生集成/区域/设备/实体树、全量增量状态流、天气预报、受限服务调用和摄像头代理。
- 集成目录直接聚合 `config_entries/get`、设备/实体注册表和 `get_services`，既覆盖实体型设备，也覆盖服务型与无设备集成。
- 管理表盘页面、内容、主题、按键/省电规则、HA 唤醒触发器和语音预留。
- 自动发现天气和全部设备；日历、课程、重点传感器、媒体、简报和备忘可单独绑定，并持久化设备树、状态、日程与预报快照。
- 管理用户、审计日志、Kiosk 在线状态和固定背光命令。

## 安全模型

- 网关传入真实客户端 IP，`proxy.ts` 默认只接受回环、RFC1918、链路本地和 IPv6 ULA；`ALLOW_WAN=false` 是默认值。
- 写操作要求签名会话、角色检查、同源校验和双提交 CSRF Token；HA 命令另有每用户/IP 令牌桶限流。
- HA Token 只存在 `.env`，任何 UI、配置响应和日志都不会回传令牌。
- Kiosk 控制使用独立的 32 位以上共享密钥，经 `watch-face` 服务端 BFF 转发；浏览器看不到密钥。
- 摄像头流由已登录路由代理，不暴露 HA 地址和令牌。

如果使用自定义反向代理，必须由代理覆盖（而不是追加客户端提供的）`X-Real-IP`，并在确认代理可信后设置 `TRUST_PROXY_HEADERS=true`。保持该变量为 `false` 时，生产启动脚本只监听 `127.0.0.1`；不要把 3001 端口直接暴露到局域网或公网。

根目录 HTTP 网关使用 `COOKIE_SECURE=false`。一旦通过 HTTPS 或 VPN 入口部署，应把它改为 `true`，确保会话 Cookie 只经加密连接传输。

## 首次启动

复制 `.env.example` 为 `.env`，设置 HA 地址/令牌、至少 32 字符的会话密钥、引导管理员和 Kiosk 共享密钥。引导账号只在用户库为空时创建；正式环境应尽快在 `/admin/user-management` 建立正式账号。

账号密码使用随机盐 scrypt 哈希保存，运行时文件位于 `data/runtime-*.json`。

## 原生 Linux 部署

Q775 上无需 Docker 的生产部署使用回环监听的 systemd 服务，并由 Nginx 统一开放 8080。环境变量、构建、自启动、Kiosk 与防火墙步骤见 [`docs/linux-deployment.md`](../docs/linux-deployment.md)。

## 路由

| 路由 | 功能 |
|---|---|
| `/admin` | 系统概览 |
| `/admin/ha-control` | 嵌入式 HA 控制 |
| `/admin/dashboard-config` | 表盘页面与主题 |
| `/admin/rules-config` | 超时、按键、触发器、屏幕测试 |
| `/admin/voice-setting` | 语音接入合同 |
| `/admin/user-management` | 用户与会话 |
| `/admin/system-log` | 审计、筛选、CSV 导出 |
| `/ha` | 手机优先的独立 HA 控制页 |

## 背光桥接

API 只执行环境变量指定且位于 `/opt/hyper-clock/bin/` 的固定文件，不接受命令或参数。根据实机 `xrandr --query` 修改 `deploy/` 示例，安装到宿主机后再设置 `SYSTEM_API_ENABLED=true`。更严格的生产方案应使用受限 systemd socket 服务，不给容器特权模式或 Docker socket。
