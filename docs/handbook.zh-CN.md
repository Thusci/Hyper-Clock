# Hyper Clock 技术手册

> 英文简介见仓库根目录 [README](../README.md)；部署步骤见 [linux-deployment.md](./linux-deployment.md)。

面向富士通 Stylistic Q775 的 7×24 小时智能桌面表盘、Home Assistant 局域网控制台与系统管理平台。视觉语言按高端酒店（喜来登、丽思卡尔顿新一代空间）的现代奢华气质设计，参考 Apple、Hermès、IWC 官网的克制排版、留白与细线语汇。

---

## 1. 模块边界

```text
Chromium Kiosk ── watch-face/      表盘：页面注册表、WebGL 天空、Multigraph 极简表盘、按键
                        │  SSE /api/public/stream（只读） · BFF /api/control（携带 Kiosk 密钥）
手机与电脑 ───── ha-console/       /ha 与 /admin/ha-control 共享的 HA 控制 UI
                        │  同源会话鉴权 API
                  back-stage/      控制面：env → store → auth → HA 桥 → KioskHub → 路由
                        │  单一 WebSocket
                  Home Assistant  +  daemon/（Q775 传感器、功耗、摄像头硬件桥）
```

| 目录 | 职责 |
| --- | --- |
| [`watch-face/`](../watch-face/) | 本机全屏表盘。不保存 HA Token，不含管理界面。 |
| [`back-stage/`](../back-stage/) | 唯一安全边界：会话、HA 单连接、配置、Kiosk 数据中枢、用户、审计、背光。 |
| [`ha-console/`](../ha-console/) | 移动优先的 HA 控制组件，由后台托管。 |
| [`daemon/`](../daemon/) | Q775 sidecar：精简遥测、屏幕开关（内核背光）、睡眠 / 唤醒（Wake-on-WLAN、RTC）、按键唤醒、摄像头桥及 HA 自定义集成。 |
| `gateway/`、`deploy/` | Nginx 网关、systemd 单元、Openbox/Chromium Kiosk 会话。 |

技术栈：Next.js 16.3.6、React 19.3、Tailwind CSS 4.3、TypeScript 6.0.3、ESLint 9.39.5、Node.js 24 LTS。

---

## 2. 设计语言 · Maison

### 原则
- **克制**：一个品牌强调色（香槟金 `--brand`），其余全部是暖中性色；状态色降低饱和度。
- **细线与留白**：卡片使用 1px 发丝边、近乎实色的材质和柔和长阴影；标题区以短金线引出大写字距标签（IWC 式）。
- **轻盈数字**：时钟与读数使用 Inter 300/400 字重与光学尺寸轴（大号自动切换显示字形）；标题 500 字重、紧字距。
- **单一光源**：每张卡片的高光位置跟随太阳/月亮在天空中的水平位置（`--light-x`），与 WebGL 天空的光源一致。

### 字体
- 拉丁字母与数字：Inter（`next/font` 构建时自托管，Kiosk 运行时无需联网）。
- 中文：系统 Noto Sans CJK SC，部署时安装 `fonts-noto-cjk`。

### 四个日光阶段（由 HA `sun.sun` 驱动，离线时按时区兜底）

| 阶段 | 气质 | 背景 / 文字 | 强调色 |
| --- | --- | --- | --- |
| 晨光 dawn | 珍珠与玫瑰金 | `#ece3de` → `#f6efe8` / 深墨 | `#a8785c` |
| 白昼 day | 骨瓷与青铜 | `#ebedec` → `#f3f2ee` / 墨黑 | `#94744c` |
| 黄昏 dusk | 浓缩咖啡与铜 | `#2a2124` → `#0d0b0c` / 象牙 | `#d19c6c` |
| 夜间 night | 缟玛瑙与香槟 | `#141416` → `#070707` / 象牙 | `#c8a978` |

所有颜色均为 `watch-face/src/app/globals.css` 中的 CSS 变量；WebGL 天空调色板 `watch-face/src/lib/sky-shader.ts` 与之一一对应。

### 动效：“如丝般顺滑”
| Token | 用途 |
| --- | --- |
| `--ease-silk` `cubic-bezier(.65,.05,.25,1)` | 所有大幅运动：翻页 1100ms、卡片材质与主题切换 1200ms、页面指示器 900ms |
| `--ease-spring` | 仅用于轻量到场反馈（约 2% 过冲） |
| smootherstep（JS） | Multigraph 指针：起止速度与加速度均为零 |

- **翻页**：舞台以丝滑曲线平移；左右相邻页面以靠近当前页的边为铰链轻微后仰（`rotateY ±7°`、`translateZ -70px`）并淡出，形成克制的立体走廊。
- **卡片到场**：页面到达时，标题先浮现，卡片随后自下而上依次升起（5° 透视倾角，间隔 50ms）。每次进入页面都会重放。
- **页面提示**：按键翻页时顶部短暂显示大写字距页名与“2 / 7”。
- `prefers-reduced-motion` 下所有过渡缩短到近乎静止，WebGL 天空冻结为 2 fps。

---

## 3. 表盘

### 首页布局（信息优先，保持 Maison 气质）

```text
┌──────────────── 时钟列 ────────────────┐ ┌──────────── 右侧卡片 ────────────┐
│ HA 状态 · 日光模式                      │ │ 天气 HUD（矢量天气 / 日出日落轮播）│
│ 10:24  ◔ 秒盘                           │ ├──────────────────────────────────┤
│ 一周 · 日期                             │ │ 今日课程：上课中 · 还剩 32 分钟   │
│ 室内 22.2° │ 插座 104 W │ 网络 1.4 MB/s │ Q775 15% │ ▬▬ ▬▬ ▬▬|▬▬  时间轴 + 当前标记  │
│ ───────● 太阳轨迹 · 日落 18:11          │ ├────────────────┬─────────────────┤
│ 设备名        工作日 · 秋季 · 蛾眉月 · 实时同步 │ 本周日历         │ 我的设备（电量环）│
└─────────────────────────────────────────┘ ├────────────────┼─────────────────┤
                                            │ 室内：空调 · 插座 │ 概览轮播          │
                                            └────────────────┴─────────────────┘
```

- **复杂功能（Complications）**：时钟下方最多 4 个 IWC 式副表盘，依次为室内温度（室内温湿度传感器优先，其次空调的当前温度）、家用功率（非 Q775、非手机的 W 传感器）、路由器下行速度、Q775 CPU；没有数据的项目自动隐藏（`lib/glance.ts`）。
- **今日课程时间轴**：每节课一段，已结束的变淡，当前课程为品牌色，并以竖线标出“现在”；标题直接回答“现在在上什么、还剩多久”。
- **室内卡**：存在媒体播放器时显示媒体，否则显示空调模式 / 室内温度与插座实时功率 / 累计电量。
- **概览轮播**：绑定了简报、备忘或股票时轮播它们；否则轮播今日课程进度、日出日落、季节 · 月相 · 工作日和 Q775 连续运行时长，不再出现空卡片。

### 完整模式页面（`watch-face/src/registry/pages.tsx`）
首页 · 天气 · 设备与集成 · 课表 · 日历 · Q775 状态 · 行情 · 传感器。所有页面共享 `PageHeader`（短金线 + 大写字距标签 + 标题 + 右侧元信息），排版、间距和动效完全一致。天气预报列表使用静态的条件着色图标（Apple Weather 式），动画场景只保留在主视觉。

### 极简模式 · Multigraph（`components/display/multigraph.tsx`）
参照 Ferrari Luce 中控的 Multigraph 多功能表：黑色玻璃表盘、拉丝铝外圈、三根阳极氧化铝质感细长指针、120 刻度仪表分钟轨与下方数字读数窗。三根指针会按模式重新排布：

| 模式 | 指针含义 | 外圈刻度 | 读数窗 | 停留 |
| --- | --- | --- | --- | --- |
| TIME | 时 · 分 · 扫秒 | 12 个时标 | 星期 · 日期 | 22 s |
| WIND | 时针与分针叠成指南针指向风向，秒针为尾针 | N E S W | 风向 · 角度 · 风速 | 9 s |
| DAYLIGHT | 24 小时刻度：时针 = 日出，分针 = 日落，秒针 = 当前 | 00 / 06 / 12 / 18 + 日照弧 | 日出 / 日落 | 9 s |

缺少数据的模式会自动跳过。每次切换，三根指针依次错开 110ms，沿最短弧线以 smootherstep 曲线（1.9s）重新就位；外圈刻度同步以丝滑曲线交叉淡入。唤醒进入极简模式时，三根指针从 12 点依次扫入当前位置。

### 日月仪表（`components/display/celestial.tsx`）
- **太阳轨道**：昼弧立在透视地面之上，夜弧被压扁后从地面“下方”穿过，合成一条倾斜的立体轨道；今日已走过的弧段以金色渐亮，太阳近地平线时偏琥珀、高悬时近白，并带地平线余晖；日冕缓慢旋转、轻微呼吸。数据区显示“距日落 / 日出 N 小时 M 分”和昼长。
- **月相球**：按平均朔望月从日期直接计算（`lib/moon.ts`，比 HA 的 8 个状态精细得多），明暗分界线为精确的半椭圆；带球面光照、临边昏暗、暗面地照与月海纹理；在合成层上缓慢天平动。数据区显示照亮比例、月龄与距满月 / 新月天数。
- 所有运动都只是合成层上的 CSS 变换与过渡，SVG 不会每帧重绘，非当前页面不消耗资源。

### WebGL 天空（`components/display/sky-field.tsx` + `lib/sky-shader.ts`）
全屏单一着色器，随日光阶段与 HA 天气实时变化：流动的柔和色场与缎面高光、按真实太阳轨迹移动的日光、云层、三层雨丝、飘雪、低雾、雷暴闪光。天气变化约 2 秒渐变。

**星光顶篷**：深夜（22:30 渐入、23:30–04:30 全亮、05:30 前渐出）且天气晴朗时，夜空出现 Rolls-Royce Starlight 式的暖白光纤星点：细小核心、微弱光晕和缓慢浅幅的闪烁。每 6–16 秒会有一颗流星以缓出曲线斜向划过上半空，持续 1.5–2.4 秒，拖着渐隐的尾迹。有云、雨、雪、雾或雷暴时自动关闭。

---

## 3a. 与实际 Home Assistant 的适配

表盘按实体类型和集成自动发现数据，不写死实体 ID：个人设备来自 Companion App（`mobile_app`），日出日落在 `sun.sun` 停止更新时按 `zone.home` 坐标本地计算（`lib/solar.ts`），天气按字段在多个 `weather.*` 来源间回退，`lib/catalog.ts` 过滤 iBeacon 等非家庭集成。

具体站点的实测记录（实体清单、异常与建议）包含住址与设备信息，保存在不入库的 `docs/private/` 中。

---

## 4. Q775 硬件适配

目标设备：Intel Core i5-5300U、Intel HD Graphics 5500（Broadwell，24 EU，约 350 GFLOPS）、8 GB 内存、13.3″ 1920×1080 IGZO、Linux 下的 Chromium。

| 项目 | 做法 | 预算 |
| --- | --- | --- |
| 天空分辨率 | 最多 1100 px 宽渲染后放大（画面本就柔和） | 约 68 万像素/帧 |
| 天空帧率 | 平静 20 fps；降水或星光 30 fps；仅流星飞行时 60 fps | 约占 GPU 10–15% |
| 自动降级 | 连续掉帧时渲染宽度 1100 → 880 → 700 | — |
| 软件渲染 | 检测到 SwiftShader / llvmpipe 时停用 WebGL，回退到 CSS 渐变天空 | 避免 CPU 过载 |
| 毛玻璃 | 天空运行时卡片关闭 `backdrop-filter`，改用更实的色调（否则每帧都要重新模糊） | — |
| Multigraph | 指针运动时 60 fps，扫秒 30 fps，静止模式 4 fps；只更新 6 个 SVG 变换 | 极低 |
| 内存 | 极简/熄屏时卸载画布并立即释放 GPU 上下文 | — |
| 数据 | 后台 250ms 批量推送实体变化；浏览器缓存每 15s 最多写一次 | — |
| 长时间运行 | 着色器时间按周期回绕，所有回绕周期内的运动为整数圈，回绕不可见 | 7×24 稳定 |

部署后在 Kiosk 打开 `chrome://gpu` 确认 “WebGL: Hardware accelerated”。Kiosk 会话已启用 `--enable-gpu-rasterization`，X 服务器以 `-nocursor` 启动，表盘上不出现鼠标指针。

---

## 5. 后台运行逻辑（`back-stage/src/server/`）

```text
env.ts         唯一读取 process.env 的地方（zod 校验）
store.ts       data/*.json 原子写入；同一文件的读改写串行化；审计日志
security.ts    客户端 IP、局域网判定、Kiosk 密钥（常数时间比较）、CSRF、令牌桶
auth.ts        账号（scrypt）、登录方式（密码 / TOTP）、会话（签名 Cookie + 会话表双重校验，可即时吊销）
totp.ts        RFC 6238 验证码、防重放、二维码
ha.ts          全进程唯一 HA 连接；库自带重连，30 秒心跳检测半开连接，所有请求带超时，掉线/恢复通过 onStatus 通知
harva.ts       BTC-HARVA 只读客户端（价格、24 小时 5 分钟线、虚拟账户；各部分独立缓存）
config.ts      表盘配置 schema（页面类型来自 shared/page-kinds.ts）
http.ts        route(policy, action) 请求管线
display.ts     背光命令（仅 /opt/hyper-clock/bin 下的固定可执行文件）
kiosk/hub.ts   KioskHub：表盘的唯一数据源
kiosk/feeds.ts 数据 feed 注册表（agenda · weather · history · btc）
kiosk/commands.ts  Kiosk 命令注册表（ha · display · kiosk）
page-auth.ts   服务端页面登录守卫
```

### 请求管线
每个 API 路由都写成 `route(policy, action)`，按固定顺序执行：

1. **access**：`public` / `kiosk`（共享密钥）/ `user` / `admin`（会话 + 角色）
2. **csrf**：同源校验与双提交 Token
3. **rate**：按调用者的令牌桶
4. **body**：zod 解析，action 拿到的就是校验后的值
5. **action**：返回对象即 JSON；抛出 `HttpError(status, message)` 即错误响应；其他异常统一 500 并记录日志

读一个路由的 policy，就知道它执行了哪些安全检查。

### KioskHub 生命周期
1. 第一个表盘连接时启动一次：读取配置与磁盘缓存后立即向表盘推送缓存，再在后台连接 HA（HA 不可达不会阻塞表盘）。
2. 每次（重新）连接后执行 **resync**（同一时间只运行一个）：拉取注册表与全部状态，运行所有 feed，广播 `ready` 并立即写盘。如果 HA 换了新连接，会重新订阅 `state_changed`。合并时按 HA 的 `last_updated` 保留较新的实体状态。
3. HA 掉线后先等待 20 秒；仍未恢复才广播 `offline`，表盘显示缓存并明确标注。短暂抖动或 HA 重启不会让表盘在“已连接 / 缓存”之间来回跳。库会自动重连，resync 失败时每 15 秒重试。`needsHa: false` 的 feed（如 `btc`）在 HA 掉线期间照常刷新。
4. 实体变化合并 250ms 后作为一个 `entities` 事件推送；唤醒触发器只在状态真正变化时触发，属性更新不会触发。
5. 每 5 秒检查配置文件，有改动就推送 `config` 并刷新 feed，连接保持不断开。
6. 快照在每次 resync 成功后立即写入 `runtime-ha-cache.json`，其余时间最多每 30 秒写一次。值未变化的 feed 不会重复推送。

表盘端（`use-ha-stream.ts`）的规则：数据只合并、从不清空；实体只会被同时或更新的状态覆盖（旧缓存不会盖掉新值）；SSE 断开后安静重连，20 秒后才显示离线；45 秒收不到心跳即视为断开并重连；每次连接完成立即写入浏览器缓存。每个页面和卡片都有错误边界，单个卡片出错只影响它自己，并会自动重试。

所有表盘客户端共享同一个订阅和同一组定时器。

### SSE 事件（`/api/public/stream`）
| 事件 | 数据 |
| --- | --- |
| `config` | 完整表盘配置 |
| `cache` | 离线时的最近快照 `{entities, catalog, feeds, updatedAt}`；表盘只用它填补空缺，不覆盖更新的数据 |
| `catalog` | 区域 / 设备 / 实体 / 集成目录 |
| `entities` | 变化的实体（首次为全量） |
| `feed` | `{ name, value }` |
| `wake` | `{ mode, triggerId }` |
| `ready` / `offline` / `heartbeat` | 连接状态 |

### 数据文件（`back-stage/data/`）
`runtime-config.json` 配置 · `default-config.json` 出厂配置 · `runtime-users.json` 账号 · `runtime-sessions.json` 会话 · `runtime-favorites.json` 收藏 · `runtime-kiosk.json` Kiosk 状态 · `runtime-ha-cache.json` HA 快照 · `audit.ndjson` 审计日志。

### API 一览
| 路由 | 访问 | 作用 |
| --- | --- | --- |
| `GET /api/health` | public | 健康检查 |
| `GET /api/public/config` · `GET /api/public/stream` | public（仅限局域网） | 表盘配置与数据流 |
| `POST /api/public/control` | kiosk | 表盘命令（经 watch-face `/api/control` 转发） |
| `POST /api/auth/login` · `logout` | public + CSRF | 登录（按 `AUTH_METHOD` 使用密码或验证码）与退出 |
| `POST /api/auth/totp/setup` · `verify` | public + CSRF | 首次绑定身份验证器：密码换二维码，验证码确认后登录 |
| `POST /api/auth/totp/renew` | user + CSRF | 已登录用户凭当前验证码重新生成 |
| `GET/PUT /api/admin/config` | user / admin | 读取与保存配置 |
| `GET /api/admin/status` · `logs` | user | 状态（含 KioskHub）与审计 |
| `GET/PUT/DELETE /api/admin/users` · `GET/DELETE /api/admin/sessions` | admin | 账号与会话 |
| `GET /api/ha/catalog` · `GET /api/ha/stream` · `GET/PUT /api/ha/favorites` | user | HA 控制台 |
| `POST /api/ha/service` | admin | HA 服务调用（白名单域） |
| `GET /api/ha/camera/[entityId]` | user | 摄像头代理 |
| `POST /api/system/display` | admin + CSRF | 屏幕测试 |

---

## 6. 扩展指南

### 新增一个表盘页面
1. 在 `watch-face/src/components/display/` 编写组件，使用 `PageHeader` 保持一致的标题区。
2. 在 `watch-face/src/registry/pages.tsx` 中注册：`myPage: (p) => <MyPage config={p.config} entities={p.entities} data={p.feeds.myFeed} />`。
3. 在 `back-stage/src/shared/page-kinds.ts` 追加 `{ kind: "myPage", label: "我的页面" }`。配置校验和后台编辑器的下拉框会自动包含它。
4. 后台“表盘编辑”中启用即可。表盘若遇到未知页面类型，会显示占位提示，不会崩溃。

### 新增一种数据（feed）
在 `back-stage/src/server/kiosk/feeds.ts` 中编写并追加到 `feeds`：

```ts
const airQuality: Feed<MyData> = {
  name: "air",
  intervalMs: 10 * 60_000,
  load: async ({ config, entities, catalog }) => fetchSomething(),
};
```

KioskHub 会在连接、定时和配置变化时运行它，表盘以 `feeds.air` 读取，传输层无需任何改动。如需类型提示，在 `watch-face/src/types/config.ts` 的 `FeedMap` 中补充字段。

### 新增一个 Kiosk 命令
在 `back-stage/src/server/kiosk/commands.ts` 中用 `command({ kind, schema, run })` 定义并加入 `commands`。表盘通过 `/api/control` 以 `{ kind: "...", ... }` 调用，`/api/public/control` 会按 `kind` 分发。

### 新增一个 API 路由
```ts
export const POST = route(
  { access: "admin", csrf: true, body: z.object({ ... }) },
  async ({ body, user, ip }) => { ...; return { ok: true }; },
);
```

### 调整视觉
只修改 `globals.css` 顶部的 token（颜色、圆角 `--r-*`、缓动 `--ease-*`）。天空颜色同步修改 `lib/sky-shader.ts` 的 `skyPalettes`。

---

## 7. 按键

- Win / 音量加短按：下一页；音量减：上一页。翻页时顶部显示页名。
- Win 长按：完整 / 极简切换；启用语音后，普通长按发出语音事件，超长按切换极简。
- 任意功能键从极简或熄屏模式唤醒。
- 电源键不进入网页，由 Linux systemd-logind / udev 处理。

所有阈值在 `/admin/rules-config` 中修改。

---

## 8. 启动与部署

### 部署与启动（生产）
完成 [`docs/linux-deployment.md`](./linux-deployment.md) 第 2、3 节的系统准备与密钥配置后，分两步：

```bash
# 1. 部署：预检 → 备份运行数据 → 同步到 /opt/hyper-clock → 按需构建 → 安装 systemd 单元与 Nginx 站点
sudo scripts/deploy.sh
sudo scripts/deploy.sh --rebuild            # 强制重新 npm ci 与构建
sudo scripts/deploy.sh --with-daemon        # 同时安装 Q775 传感器守护进程
sudo scripts/deploy.sh --check              # 只做预检，不改动任何东西

# 2. 启动：back-stage → watch-face → Nginx →（守护进程）→ Kiosk，每一步都等待健康检查
sudo scripts/launch.sh
sudo scripts/launch.sh --takeover-display   # 首次启用 Kiosk：停用 gdm3，让表盘接管 tty1
sudo scripts/launch.sh --no-kiosk           # 只启动服务，不动本机屏幕
sudo scripts/launch.sh --check              # 只做健康检查
sudo scripts/launch.sh --stop               # 停止 Kiosk 与两个服务
sudo scripts/launch.sh --reset-user admin   # 重置账号：新密码、清除身份验证器、强制下线

sudo scripts/launch-production.sh           # 一次完成上面两步（两边的参数都接受）
scripts/deploy.sh --docker && scripts/launch.sh --docker   # 改用 docker compose
```

两个脚本都可以重复执行：
- **预检**：Node 24、Nginx、服务账号、CJK 字体、环境文件权限；密钥长度足够、两个密钥互不相同、两端 Kiosk 密钥一致、不是仓库自带的示例值；`CONTROL_PLANE_URL` 已设置。
- **同步**：同步前先备份 `back-stage/data`（保留最近 5 份）；不覆盖运行数据、环境文件或构建产物。
- **构建**：按源码、依赖锁和环境文件的内容哈希判断是否需要重建；需要重建时先停止服务；构建失败时显示最后 60 行日志。
- **运行数据**：后台数据始终写入 `back-stage/data`（由 `scripts/start.mjs` 通过 `HYPER_CLOCK_DATA_DIR` 指定）。旧版本误写到 `.next/standalone/back-stage/data` 的数据会在重建前自动迁回。
- **启动**：`launch.sh` 不构建任何东西；没有部署过会提示先运行 `deploy.sh`。失败时只显示本次启动的日志。
- **收尾**：确认 3000 / 3001 只监听回环地址，并打印访问地址。

### 分步部署
1. 复制根目录 `.env.example` 与 `back-stage/.env.example`，两处 `KIOSK_SHARED_SECRET` 必须一致，并且与 `SESSION_SECRET` 不同（各用 `openssl rand -hex 32` 生成）。
2. 在 `back-stage/.env` 设置 HA 地址、长期令牌和首个管理员。
3. 原生 Linux 部署（推荐）：按 [`docs/linux-deployment.md`](./linux-deployment.md) 执行，包含 `fonts-noto-cjk`、构建、systemd、Nginx、Openbox/Chromium Kiosk 与防火墙。
4. Docker：`docker compose up -d --build`，只发布 8080 网关端口。
5. 开发：在 `back-stage/` 与 `watch-face/` 分别执行 `npm install && npm run dev`（端口 3001 / 3000）。

修改 `NEXT_PUBLIC_*` 后需要重新构建对应模块。

---

## 9. 安全与待办

已具备：HA Token 仅存在于服务端；默认只接受局域网访问；写操作需要角色、CSRF 和限流；Kiosk 密钥使用常数时间比较；会话可即时吊销；背光只执行固定白名单文件。

**仍需处理（交付前）**
- 开发机上的 `back-stage/.env` 与 `.env.TEST` 包含真实 HA 长期令牌，且两个密钥曾使用同一个可推测的值。`.gitignore` 现已排除所有 `.env*`（示例文件除外），但只要这些文件曾经被复制、打包或提交过，就应在 HA 中吊销令牌并用 `openssl rand -hex 32` 重新生成全部密钥。
- `/api/public/stream` 与 `/api/public/config` 对整个局域网开放（含位置类实体）；watch-face 的 `/api/control` 会为任何局域网请求附加 Kiosk 密钥。建议由 watch-face 代理数据流，并让两者只接受本机 Kiosk（`X-Real-IP` 为 127.0.0.1）。这会改变“局域网可直接打开表盘”的现状，需要确认后再实施。
- 触摸屏已损坏：设备页的区域切换与开关、长列表滚动仍依赖触控。建议为按键增加选择焦点模型，或改为自动轮播 / 分页。
- 唤醒用的那一次按键还会同时翻页（`use-display-controller.ts`）。
- `TODO.md` 中的实机验证项：真实 HA 联调、按键键值、传感器映射、背光桥接（注意 `ProtectHome=true` 会让 `xrandr` 读不到 X 授权文件）以及 72 小时稳定性测试。

---

## 10. 变更记录

### 连接稳定性与 BTC-HARVA
- **HA 连接**：30 秒心跳检测半开连接并强制重连；连接、请求、REST 调用都有超时，HA 卡住不会再挂起 resync 或 feed；令牌失效时重建连接并重新订阅。
- **KioskHub**：启动时不等待 HA；resync 串行；掉线 20 秒宽限期后才通知离线；resync 成功后立即写盘。
- **表盘**：按 `last_updated` 合并实体，旧缓存不再覆盖新值（数字来回跳的根源）；SSE 心跳看门狗与安静重连；配置未变化时不重新渲染；页面、天空、Multigraph 与卡片的错误边界，加上 `error.tsx` / `global-error.tsx` 自动恢复（不再整页崩溃）。
- **BTC-HARVA**：首页新增 BTC/USDT 卡片（24 小时 5 分钟收盘价走势、24 小时涨跌、高低点）和轮播的虚拟账户卡片（总计与每个账户的胜负、胜率、P&L）。数据由后台用只读 API key 拉取（`HARVA_URL`、`HARVA_API_KEYS`），后台与浏览器各自缓存，HARVA 不可达时显示最后的数值并标注时间。
- **小屏**：天气卡片高度不足时自动隐藏次要读数，不再与标题重叠。

### 部署与登录
- **脚本拆分**：`scripts/deploy.sh`（同步、构建、安装）与 `scripts/launch.sh`（启动、健康检查、`--stop`、`--reset-user`），公共部分在 `scripts/lib/common.sh`；`launch-production.sh` 保留为两者的组合。
- **构建修复**：两个模块的独立服务器位于 `.next/standalone/<模块名>/server.js`，`start.mjs` 自动定位；是否重建按内容哈希判断。
- **运行数据**：后台数据固定写入 `back-stage/data`，不再随重建丢失。
- **网关**：Nginx 转发带端口的 `Host`；后台静态资源使用独立前缀 `/back-stage-assets`，修复登录页无法加载脚本导致的 CSRF 错误。
- **登录**：`BOOTSTRAP_ADMIN_PASSWORD` 设置期间即为该账号密码；新增 `AUTH_METHOD=totp` 身份验证器登录、首次绑定、“账户安全”页重新生成与命令行重置。

### 表盘与后台

- **视觉**：Maison 设计语言（暖中性色 + 香槟金）、Inter 自托管、统一 `PageHeader`、发丝边卡片、单一光源高光、细线页面指示器、页名提示。
- **动效**：丝滑曲线翻页与立体相邻页、卡片依次升起、Multigraph 指针 smootherstep 编排。
- **WebGL**：日光与天气天空、缎面高光、Rolls-Royce 式深夜星光与流星；软件渲染回退与自动降级。
- **极简表盘**：Ferrari Luce 式 Multigraph（时间 / 风向罗盘 / 日照）。
- **表盘架构**：页面注册表、通用 `feeds`、浏览器缓存节流；预报列表改为静态图标以降低开销。
- **后台架构**：分层 `server/` 模块、`route()` 请求管线、KioskHub 共享订阅与批量推送、feed 与命令注册表、HA 重连修复、文件写入串行化。
- **安全修复**：`/api/system/display` 不再接受未鉴权的 `source: "kiosk"` 调用；Kiosk 密钥与 CSRF 改为常数时间比较。
- **部署**：`fonts-noto-cjk`、Chromium GPU 光栅化、隐藏光标。
- **Sidecar 0.2**：只保留有用指标（HA 中约 250 个实体精简为 15 个以内，旧实体自动清理），新增屏幕开关 / 亮度、睡眠 / 唤醒和按键唤醒；后台 `setDisplay` 优先走 sidecar（`Q775_SIDECAR_URL` / `Q775_SIDECAR_TOKEN`），不再依赖 `xrandr` 访问 X 会话。
