# Q775 Sidecar（q775-daemon 0.2）

富士通 Q775 专用的独立 Linux 硬件桥。它不依赖 Docker，也不依赖 Hyper Clock 的 Next.js 服务。

## 定位

运行在 Q775 本机的轻量 sidecar：**只采集表盘和 HA 真正用得上的数据**，并负责**屏幕开关**与**平板睡眠 / 唤醒**。不依赖 Docker，也不依赖 Hyper Clock 的 Next.js 服务。

## 采集内容（精简后）

| HA 传感器（实体 ID 后缀） | 来源 |
| --- | --- |
| `cpu_percent` · `cpu_load_1m` · `memory_percent` · `swap_percent` · `system_uptime` | psutil |
| `cpu_temperature` | `x86_pkg_temp` 热区，其次 coretemp “Package id 0”，再其次最热核心 |
| `ambient_light`（lx） | IIO 环境光传感器（仅照度通道） |
| `battery_level` · 外接电源 · 正在充电 | `/sys/class/power_supply` |
| `q775_current_power` · `q775_power_measurement_source` | 电池放电时取电池功率（整机）；接入电源时取 Intel RAPL 封装功率（电池电流为 0，不再误报 0 W） |
| `disk_used` · `disk_health` | 根分区使用率；SMART 健康（30 分钟一次） |
| 屏幕开关、屏幕亮度 | `/sys/class/backlight`（见下文控制） |
| 摄像头 | 每个物理摄像头只保留一个采集节点（UVC 的元数据节点不再重复上报） |

0.1 版发布的 IIO 加速度 / 陀螺仪 / 倾角 / 磁力原始轴值、每个 snap 挂载点（固定 100%）、各热区与网卡温度、CPU 频率与核数、内存字节数、udev 设备树（约 860 项）以及每分钟一次的 PowerTOP 测量，均已移除或默认关闭（`enable_udev`、`enable_powertop` 可在需要诊断时打开）。HA 集成升级后会**自动删除这些已退役的实体**；保留下来的指标沿用原实体 ID，表盘与仪表盘绑定不受影响。

## Ubuntu 安装

```bash
cd daemon
sudo bash scripts/install-ubuntu.sh
```

安装器会安装 Python、PowerTOP、FFmpeg、v4l-utils、smartmontools，生成随机 64 位十六进制令牌，并启用 `q775-sensor-daemon.service`。

```bash
systemctl status q775-sensor-daemon
journalctl -u q775-sensor-daemon -f
curl http://127.0.0.1:8765/health
```

配置位于 `/etc/q775-daemon/config.toml`，权限应保持为 `0600`。除 `/health` 外的接口都要求：

```http
Authorization: Bearer <token>
```

PowerTOP 需要 root 才能完成测量。若需提高估算准确度，可以在电池供电、无重要任务时手动运行一次 `sudo powertop --calibrate`；校准会主动改变亮度和设备状态，因此安装器不会自动执行。

## 接口

除 `/health` 外都需要 `Authorization: Bearer <token>`。

| 方法与地址 | 用途 |
| --- | --- |
| `GET /health` | 无敏感数据的健康检查 |
| `GET /api/v1/state` | 精简状态：屏幕、唤醒源（Wi-Fi MAC、WoWLAN）、最近一次睡眠、全部指标 |
| `GET /api/v1/snapshot` | 完整快照（诊断用） |
| `POST /api/v1/display` | `{"power":"on"|"off"|"toggle"}`，和 / 或 `{"brightness":5–100}` |
| `POST /api/v1/sleep` | 挂起平板；可选 `{"wake_in_minutes":480}` 或 `{"wake_at":"2026-10-15T07:00:00+08:00"}` 设置 RTC 定时唤醒 |
| `POST /api/v1/wake` | 点亮屏幕 |
| `GET /ws` | 推送 `hello` · `snapshot` · `telemetry` · `input`（按键）· `device_tree`；屏幕状态变化立即推送 |
| `GET /camera/<id>.jpg` · `.mjpeg` | 单帧 JPEG / MJPEG 视频流 |

## 屏幕与睡眠 / 唤醒

| 场景 | 做法 | 唤醒方式 |
| --- | --- | --- |
| **熄屏**（推荐的日常方式） | 写 `bl_power=4` 关闭背光（驱动不支持时亮度置 0），系统与 Kiosk 继续运行 | 任意硬件按键、HA“Wake screen”、表盘 `/api/control`；瞬时恢复 |
| **挂起**（长时间不用） | 先启用 Wake-on-WLAN 魔术包，按需写 RTC 定时唤醒，再通过 logind `systemctl suspend` | HA `wake_on_lan.send_magic_packet`（Wi-Fi MAC 见 `/api/v1/state`）、RTC 定时、电源键 |

- **按键唤醒**：sidecar 被动读取 `/dev/input` 中键盘类设备（音量键、Windows 键），不独占设备，Chromium 照常收到按键。即使浏览器卡住，按键也能点亮屏幕。
- **自动挂起**：一台常亮的墙面设备不应自行休眠。安装脚本会关闭 GNOME 的接电自动挂起，睡眠只在 HA 或 API 请求时发生。
- **软件无法把已挂起的机器叫醒**，因此唤醒只能依靠上表中的外部来源。挂起前务必确认 `/api/v1/state` 中 `power_control.wowlan.supported` 为 `true`：Q775 的 Intel 无线网卡一般支持魔术包；如果不支持，请改用“熄屏”或 RTC 定时唤醒。
- 恢复后 sidecar 会自动点亮屏幕、刷新数据，并在 `last_sleep` 中记录实际睡眠时长。

## 接入 Home Assistant

1. 将 `home_assistant/custom_components/q775_bridge` 复制到 HA 配置目录的 `custom_components/`。
2. 重启 Home Assistant。
3. 在“设置 → 设备与服务 → 添加集成”搜索 **Q775 Sensor Daemon**。
4. 填写 `http://Q775局域网地址:8765` 和 `/etc/q775-daemon/config.toml` 中的令牌。

集成使用本地 WebSocket 推送创建 CPU、内存、温度、环境光、电池、功率、磁盘和背光实体；摄像头实体在 HA 内代理受保护的 JPEG/MJPEG，不把令牌暴露给浏览器。

当前集成使用 Home Assistant 新版提供的 `LIGHT_LUX` 照度单位常量，兼容已移除 `UnitOfIlluminance` 的 2026.x 版本。升级集成文件后需要重启 Home Assistant 容器；无需删除已有配置项或重新安装传感器守护进程。

集成 0.2 新增的实体：

| 实体 | 作用 |
| --- | --- |
| `switch.q775_*_screen` | 屏幕开 / 关（瞬时，系统保持运行） |
| `number.q775_*_screen_brightness` | 屏幕亮度 5–100% |
| `button.q775_*_wake_screen` | 点亮屏幕 |
| `button.q775_*_sleep` | 挂起平板（先启用 Wake-on-WLAN） |

唤醒挂起中的平板，可在 HA 中调用：

```yaml
action: wake_on_lan.send_magic_packet
data:
  mac: "<power_control.wifi.mac>"
```

升级步骤：复制新的 `custom_components/q775_bridge` 后重启 HA；在 Q775 上重新运行 `sudo bash scripts/install-ubuntu.sh`。安装脚本会重启服务，并把旧配置中的 `enable_udev` / `enable_powertop` 改为 `false`。


## 本地开发验证

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
ruff check .
q775-daemon --config ./config.toml --check
```

Windows 开发机只能验证配置、协议和模拟 sysfs 测试；IIO、udev、PowerTOP、SMART 与 V4L2 必须在 Q775 的 Linux 系统上做最终硬件验证。
