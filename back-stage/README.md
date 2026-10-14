# Hyper Clock · back-stage

整套 Q775 系统的唯一控制面与安全边界，运行在 3001 端口，由根目录网关暴露为 `/admin`、`/ha` 和 `/api`。

## 职责

- 统一登录（密码或 TOTP 身份验证器，由 `AUTH_METHOD` 选择）、管理员/只读权限、IP 绑定会话与会话撤销。
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

## 首次启动与登录

复制 `.env.example` 为 `.env`，设置 HA 地址/令牌、至少 32 字符的会话密钥、引导管理员和 Kiosk 共享密钥（两个密钥各用 `openssl rand -hex 32` 生成，不能相同）。

| 变量 | 作用 |
| --- | --- |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` | 设置期间该管理员始终存在，且环境文件中的密码就是它的密码；删除这两行后改由界面管理（保留最后一次密码）。 |
| `AUTH_METHOD=password` | 账号 + 密码登录（默认）。 |
| `AUTH_METHOD=totp` | 账号 + 6 位验证码登录。未绑定的账号首次登录时凭密码扫码绑定；之后可在 `/admin/account` 凭当前验证码重新生成。 |

忘记密码或丢失手机时，在设备上运行 `sudo scripts/launch.sh --reset-user <账号>`：生成新密码、清除身份验证器并强制下线（账号不存在时创建为管理员）。

密码以随机盐 scrypt 哈希保存；运行时文件位于 `data/runtime-*.json`，由 `scripts/start.mjs` 通过 `HYPER_CLOCK_DATA_DIR` 固定在本目录，重建不会丢失。

## 原生 Linux 部署

Q775 上无需 Docker 的生产部署使用回环监听的 systemd 服务，并由 Nginx 统一开放 8080。用 `sudo scripts/deploy.sh` 部署、`sudo scripts/launch.sh` 启动；环境变量、手动步骤、Kiosk 与防火墙见 [`docs/linux-deployment.md`](../docs/linux-deployment.md)。

网关后面，本模块的静态资源走 `/back-stage-assets` 前缀（`next.config.mjs` 的 `assetPrefix`），因为 `/_next` 属于 watch-face；自定义网关时必须把该前缀转发到 3001。

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
| `/admin/account` | 账户安全：登录方式、身份验证器重新生成 |
| `/login` | 登录与首次绑定身份验证器 |
| `/ha` | 手机优先的独立 HA 控制页 |

## 背光桥接

API 只执行环境变量指定且位于 `/opt/hyper-clock/bin/` 的固定文件，不接受命令或参数。根据实机 `xrandr --query` 修改 `deploy/` 示例，安装到宿主机后再设置 `SYSTEM_API_ENABLED=true`。更严格的生产方案应使用受限 systemd socket 服务，不给容器特权模式或 Docker socket。
