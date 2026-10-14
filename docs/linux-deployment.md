# Q775 原生 Linux 部署

这套流程面向 Ubuntu + Xorg + Openbox，不依赖 Docker。现有 Home Assistant 继续运行在本机 `127.0.0.1:8123`；Nginx 是唯一面向局域网的入口。

## 1. 网络结构

| 服务 | 监听地址 | 用途 |
| --- | --- | --- |
| Home Assistant | `127.0.0.1:8123` | 由后台服务端访问 |
| watch-face | `127.0.0.1:3000` | 本机表盘服务 |
| back-stage | `127.0.0.1:3001` | 鉴权、HA 代理、管理端 |
| Nginx | `0.0.0.0:8080` | Kiosk 与局域网统一入口 |
| Q775 daemon | `127.0.0.1:8765` 或受限 LAN 地址 | 可选硬件遥测桥 |

不要把 3000、3001 或 HA Token 暴露到局域网。HTTP 部署适合可信局域网；跨不可信网络时应先接入 VPN 或 HTTPS，并启用安全 Cookie。

## 2. 系统准备

以下命令假定当前目录是项目根目录。Node.js 使用项目验证过的 24 LTS，安装完成后确认 `node --version` 为 `v24.x`。

```bash
sudo apt update
sudo apt install -y nginx rsync openssl xserver-xorg xinit openbox x11-utils x11-xserver-utils fonts-noto-cjk
node --version
npm --version
command -v node
```

`fonts-noto-cjk` 为表盘提供中文字形；拉丁字母与数字使用构建时自托管的 Inter，运行时无需联网。

服务模板按系统级 Node.js 的 `/usr/bin/node` 编写；如果 `command -v node` 返回其他路径，请同步修改两个 Web 服务单元的 `ExecStart`，不要让 systemd 依赖交互式 shell 或 NVM 初始化脚本。

Ubuntu 的 Chromium 可能由 Snap 提供。安装后只需保证 `chromium` 或 `chromium-browser` 命令存在：

```bash
sudo snap install chromium
command -v chromium || command -v chromium-browser
```

创建无 sudo 权限的运行账号和安装目录：

```bash
sudo adduser --disabled-password --gecos "Hyper Clock" hyperclock
sudo install -d -o hyperclock -g hyperclock /opt/hyper-clock
sudo rsync -a \
  --exclude node_modules \
  --exclude .next \
  --exclude .env \
  ./ /opt/hyper-clock/
sudo chown -R hyperclock:hyperclock /opt/hyper-clock
```

## 3. 配置密钥和 Home Assistant

在 HA 用户资料页创建长期访问令牌。分别生成会话密钥和 Kiosk 共享密钥：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

创建仅 root 和服务账号可读的环境文件：

```bash
sudo install -d -m 0750 -o root -g hyperclock /etc/hyper-clock
sudoedit /etc/hyper-clock/back-stage.env
```

填入：

```dotenv
NODE_ENV=production
HA_URL=http://127.0.0.1:8123
HA_TOKEN=粘贴_HA_长期访问令牌
SESSION_SECRET=粘贴第一条随机密钥
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=首次登录密码
# password：账号 + 密码；totp：账号 + 身份验证器验证码（密码只在首次绑定时使用一次）
AUTH_METHOD=password
ALLOW_WAN=false
TRUST_PROXY_HEADERS=true
COOKIE_SECURE=false
WATCH_FACE_ORIGIN=http://127.0.0.1:8080
NEXT_PUBLIC_WATCH_FACE_URL=http://127.0.0.1:8080/
KIOSK_SHARED_SECRET=粘贴第二条随机密钥
# 配置好 Q775 sidecar 后改为 true，表盘与后台的熄屏 / 点亮才会真正执行（否则只模拟）
SYSTEM_API_ENABLED=false
DISPLAY_OFF_COMMAND=/opt/hyper-clock/bin/display-off
DISPLAY_ON_COMMAND=/opt/hyper-clock/bin/display-on
# 推荐：通过 Q775 sidecar（第 8 节）控制屏幕；设置后上面两条命令不再使用
Q775_SIDECAR_URL=http://127.0.0.1:8765
Q775_SIDECAR_TOKEN=粘贴_/etc/q775-daemon/config.toml_中的_token
# 可选：BTC-HARVA（首页 BTC/USDT 走势与虚拟账户卡片）。在 HARVA 的 设置 → API keys 创建只读 key；
# 多个 key 用逗号分隔（每个 HARVA 用户一个），表盘显示这些用户的全部账户。留空则不显示卡片。
HARVA_URL=http://192.168.1.111:8000
HARVA_API_KEYS=harva_粘贴只读_key
```

然后创建表盘环境文件；`KIOSK_SHARED_SECRET` 必须与上面完全一致：

```bash
sudoedit /etc/hyper-clock/watch-face.env
```

```dotenv
NODE_ENV=production
CONTROL_PLANE_URL=http://127.0.0.1:3001
NEXT_PUBLIC_CONTROL_PLANE_URL=
KIOSK_SHARED_SECRET=粘贴相同的第二条随机密钥
```

设置权限，并让 Next.js 构建阶段读取同一份配置：

```bash
sudo chown root:hyperclock /etc/hyper-clock/*.env
sudo chmod 0640 /etc/hyper-clock/*.env
sudo ln -sfn /etc/hyper-clock/back-stage.env /opt/hyper-clock/back-stage/.env
sudo ln -sfn /etc/hyper-clock/watch-face.env /opt/hyper-clock/watch-face/.env
```

`BOOTSTRAP_ADMIN_*` 设置期间，该账号始终存在，且 `BOOTSTRAP_ADMIN_PASSWORD` 就是它的密码（修改环境文件并重启 back-stage 即生效）。在用户管理页建立正式账号后，从环境文件删除这两行，账号即改由界面管理（保留最后一次的密码）。

`AUTH_METHOD=totp` 时：首次登录点“还没有绑定身份验证器？”，输入账号密码后扫描二维码并输入验证码完成绑定；之后只用账号 + 验证码登录。已登录用户可在“账户安全”页凭当前验证码重新生成。忘记密码或丢失手机：

```bash
sudo scripts/launch.sh --reset-user admin   # 生成新密码、清除身份验证器、强制下线；账号不存在时创建为管理员
```

> 完成第 2、3 节后，第 4–7 节可以用脚本完成：`sudo scripts/deploy.sh` 负责同步、构建并安装 systemd 单元与 Nginx 站点，`sudo scripts/launch.sh` 负责依次启动并做健康检查（首次启用 Kiosk 时加 `--takeover-display`）；`sudo scripts/launch-production.sh` 依次执行两者。下面是脚本执行的等价手动步骤。

## 4. 安装依赖并构建

```bash
sudo -u hyperclock npm --prefix /opt/hyper-clock/ha-console ci
sudo -u hyperclock npm --prefix /opt/hyper-clock/back-stage ci
sudo -u hyperclock npm --prefix /opt/hyper-clock/watch-face ci
sudo -u hyperclock npm --prefix /opt/hyper-clock/back-stage run typecheck
sudo -u hyperclock npm --prefix /opt/hyper-clock/watch-face run typecheck
sudo -u hyperclock npm --prefix /opt/hyper-clock/back-stage run build
sudo -u hyperclock npm --prefix /opt/hyper-clock/watch-face run build
```

后台依赖的 `ha-console` 通过本地文件依赖链接，需先安装它自己的依赖；它不需要单独启动第三个服务。

两个模块的 `next.config.mjs` 都以仓库根目录为 `outputFileTracingRoot`，因此独立服务器位于 `.next/standalone/<模块名>/server.js`；`scripts/start.mjs` 会自动定位它。后台运行数据由 `start.mjs` 固定写入 `back-stage/data`，不会随重建丢失。

## 5. 安装 systemd 服务

```bash
sudo install -m 0644 /opt/hyper-clock/deploy/linux/hyper-clock-back-stage.service /etc/systemd/system/
sudo install -m 0644 /opt/hyper-clock/deploy/linux/hyper-clock-watch-face.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hyper-clock-back-stage.service hyper-clock-watch-face.service
```

确认两个服务只监听回环地址：

```bash
systemctl status hyper-clock-back-stage hyper-clock-watch-face
ss -lntp | grep -E ':3000|:3001'
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3000/api/health
```

## 6. 安装 Nginx 局域网入口

```bash
sudo install -m 0644 /opt/hyper-clock/deploy/linux/nginx-hyper-clock.conf /etc/nginx/sites-available/hyper-clock
sudo ln -sfn /etc/nginx/sites-available/hyper-clock /etc/nginx/sites-enabled/hyper-clock
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
curl http://127.0.0.1:8080/api/health
```

如果默认站点占用了 8080 或配置了另一个 `default_server`，先停用对应站点，再执行 `nginx -t`。局域网访问地址为：

- 表盘：`http://Q775_IP:8080/`
- 管理后台：`http://Q775_IP:8080/admin`
- HA 控制台：`http://Q775_IP:8080/ha`

使用 UFW 时，只允许实际局域网网段访问 8080。远程操作前先确保 SSH 已放行：

```bash
sudo ufw allow OpenSSH
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
sudo ufw deny 3000/tcp
sudo ufw deny 3001/tcp
```

请将示例网段替换为真实 LAN CIDR。

## 7. 启用 Xorg、Openbox 与 Chromium Kiosk

先确认 SSH 可用，以便图形会话启动失败时远程恢复。Kiosk 单元会占用 TTY1，因此启用前应关闭显示管理器：

```bash
sudo systemctl disable --now gdm3.service
sudo chmod 0755 /opt/hyper-clock/deploy/linux/kiosk-session
sudo install -m 0644 /opt/hyper-clock/deploy/linux/hyper-clock-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hyper-clock-kiosk.service
```

Kiosk 会话会统一管理 Xorg、Openbox 与 Chromium 的生命周期。正常关闭 Chromium 时服务保持停止；只有异常退出才会重启，且 120 秒内最多尝试 3 次，避免 Openbox/Xorg 无限重启。如果此前安装过旧服务文件，更新后必须重新复制 unit 并执行 `systemctl daemon-reload`。

检查图形会话：

```bash
systemctl status hyper-clock-kiosk
journalctl -u hyper-clock-kiosk -f
```

恢复到 GNOME：

```bash
sudo systemctl disable --now hyper-clock-kiosk.service
sudo systemctl enable --now gdm3.service
```

短按电源、长按关机菜单及背光事件仍应按 Q775 实机的 logind/udev 配置实现；不要把电源键交给网页。

## 8. 可选：Q775 传感器与 HA 集成

硬件桥不依赖 Docker：

```bash
cd /opt/hyper-clock/daemon
sudo bash scripts/install-ubuntu.sh
```

随后将 `daemon/home_assistant/custom_components/q775_bridge` 复制到 HA 配置目录的 `custom_components/`，重启 HA，并从“设置 → 设备与服务”添加 **Q775 Sensor Daemon**。详细步骤见 [`daemon/README.md`](../daemon/README.md)。

## 9. 更新与回滚

把新版代码放到源码目录（例如 `git pull`）后：

```bash
sudo scripts/deploy.sh    # 自动备份 back-stage/data（保留最近 5 份）、同步、只重建有变化的模块
sudo scripts/launch.sh    # 重启服务并做健康检查
```

备份位于 `/opt/hyper-clock/back-stage/data.backup-<时间>/`。回滚时：把代码恢复到上一版本并重新部署；如需恢复数据，先 `sudo scripts/launch.sh --stop`，再把备份目录中的文件复制回 `back-stage/data/`。修改环境文件前另行备份 `/etc/hyper-clock`。不要删除 HA Token 或用户数据后直接重建。

## 10. 日志与故障定位

```bash
journalctl -u hyper-clock-back-stage -u hyper-clock-watch-face -f
journalctl -u nginx -f
curl http://127.0.0.1:8123/api/ -H "Authorization: Bearer HA_TOKEN"
```

- 后台显示 HA 离线：检查 `HA_URL`、令牌和 8123 监听地址。
- 表盘显示连接失败：检查 8080 的 `/api/public/stream` 是否由 Nginx 转发到 3001。
- 登录返回 `CSRF check failed`：确认 Nginx 使用 `proxy_set_header Host $http_host;`，且 `/back-stage-assets/` 被转发到 3001（登录页的脚本加载失败时，表单会退化为不带 CSRF 头的普通提交）。可在浏览器开发者工具 Network 面板查看是否有 404。
- 后台无法登录：检查 `SESSION_SECRET` 长度、系统时间和 `runtime-users.json` 权限；`BOOTSTRAP_ADMIN_PASSWORD` 设置期间，它就是该账号的密码；其他账号用 `sudo scripts/launch.sh --reset-user <账号>` 重置。
- 身份验证器验证码总是错误：检查 Q775 与手机的系统时间（`timedatectl`），两者相差应小于 30 秒。
- Kiosk 黑屏：通过 SSH 检查 Chromium 命令、Xorg 日志和 `hyper-clock-kiosk` 日志。
- 修改 `NEXT_PUBLIC_*` 后必须重新执行对应模块的 `npm run build`。
