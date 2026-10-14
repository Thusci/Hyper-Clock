<div align="center">

# Hyper Clock

**A 24/7 smart desk clock, Home Assistant console and control plane for the Fujitsu Stylistic Q775.**

A quiet, hotel-lobby watch face that knows the weather, the light outside, your timetable and every device in the house, running on a ten-year-old Windows tablet given a second life as a Linux kiosk.

![Node.js 24 LTS](https://img.shields.io/badge/Node.js-24_LTS-3c873a?style=flat-square)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square)
![React 19](https://img.shields.io/badge/React-19-149eca?style=flat-square)
![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178c6?style=flat-square)
![Home Assistant](https://img.shields.io/badge/Home_Assistant-WebSocket-41bdf5?style=flat-square)

[Project site](#project-site) · [中文技术手册](docs/handbook.zh-CN.md) · [Deployment guide](docs/linux-deployment.md) · [Roadmap](TODO.md)

</div>

---

## What it is

Hyper Clock turns a Fujitsu Stylistic Q775 (Core i5-5300U, HD Graphics 5500, 13.3″ 1080p IGZO) into an always-on bedside or desk display:

- **Watch face**: a full-screen Chromium kiosk showing time, weather, sun and moon, today's classes, the calendar, personal devices and room climate, laid out with the restraint of a luxury watch catalogue.
- **Home Assistant console**: a mobile-first control panel at `/ha` for lights, switches, scenes, automations, sensors and cameras, usable from any phone on the LAN.
- **Back-stage**: the one place that holds the HA token. It handles sign-in (password or authenticator app), users and roles, watch-face configuration, wake rules, audit log and backlight control.
- **Q775 sidecar**: a small Python daemon that reports the tablet's own CPU, temperature, battery, ambient light and power to HA, and switches the screen and sleep state.

## Highlights

| | |
| --- | --- |
| **Maison design language** | Warm neutrals, one champagne-gold accent, hairline borders, Inter light numerals, and a single light source that follows the real sun across the sky. |
| **Four daylight phases** | Dawn, day, dusk and night themes driven by Home Assistant `sun.sun`, with a local solar calculation as fallback. |
| **Multigraph minimal mode** | A three-hand dial inspired by Ferrari's Luce Multigraph. The same hands re-arrange to show the time, a wind compass, or sunrise and sunset on a 24-hour scale. |
| **WebGL sky** | One shader for daylight, clouds, rain, snow, fog and lightning, plus a Starlight-style night canopy with the odd shooting star. It falls back to CSS automatically on software rendering. |
| **Built for a 2015 GPU** | Resolution and frame-rate budgets, automatic downgrading when frames drop, and canvases released in minimal mode. Designed to run around the clock. |
| **Secure by default** | LAN-only access, session plus CSRF plus rate limits on every write, sessions that can be revoked instantly, and the HA token never leaves the server. Optional TOTP sign-in. |
| **Hardware keys** | Win and volume keys flip pages, switch modes and wake the screen. The power key stays with systemd-logind. |

## Architecture

```text
Chromium kiosk ── watch-face/   Next.js · page registry · WebGL sky · Multigraph · key handling
                     │  SSE /api/public/stream (read-only) · BFF /api/control (kiosk secret)
Phones & laptops ── ha-console/  shared HA control UI, served by back-stage at /ha and /admin/ha-control
                     │  same-origin, session-authenticated API
                  back-stage/   Next.js control plane: env → store → auth → HA bridge → KioskHub → routes
                     │  one WebSocket
                  Home Assistant  +  daemon/ (Q775 sensors, power, backlight, camera bridge)

Nginx :8080 is the only port on the LAN; watch-face (3000) and back-stage (3001) listen on loopback.
```

| Directory | Responsibility |
| --- | --- |
| [`watch-face/`](watch-face/) | The kiosk display. Holds no HA token and no admin UI. |
| [`back-stage/`](back-stage/) | The security boundary: sessions, the single HA connection, configuration, KioskHub, users, audit, backlight. |
| [`ha-console/`](ha-console/) | Mobile-first HA control components, bundled into back-stage. |
| [`daemon/`](daemon/) | Q775 sidecar and the matching Home Assistant custom integration. |
| [`deploy/`](deploy/), [`gateway/`](gateway/) | systemd units, Nginx site, the Openbox and Chromium kiosk session, and the Docker gateway. |
| [`scripts/`](scripts/) | `deploy.sh` and `launch.sh` for the device. |
| [`site/`](site/) | The project website, published with GitHub Pages. |

## Quick start (development)

Requires Node.js 24 LTS and a reachable Home Assistant with a long-lived access token.

```bash
cp back-stage/.env.example back-stage/.env    # HA_URL, HA_TOKEN, secrets, first admin
cp watch-face/.env.example watch-face/.env    # same KIOSK_SHARED_SECRET as back-stage

(cd ha-console && npm install)
(cd back-stage && npm install && npm run dev)  # http://127.0.0.1:3001/admin
(cd watch-face && npm install && npm run dev)  # http://127.0.0.1:3000
```

Generate each secret with `openssl rand -hex 32`. `SESSION_SECRET` and `KIOSK_SHARED_SECRET` must be different.

## Production on the Q775

Ubuntu with systemd, Nginx and an Openbox/Chromium kiosk on tty1, no Docker needed. Prepare the machine and the env files in `/etc/hyper-clock/` once ([guide §2–3](docs/linux-deployment.md)), then:

```bash
sudo scripts/deploy.sh                       # preflight → back up data → sync to /opt/hyper-clock → build what changed → install units
sudo scripts/launch.sh --takeover-display    # start back-stage → watch-face → nginx → kiosk, with health checks
```

| Command | Purpose |
| --- | --- |
| `sudo scripts/deploy.sh --rebuild` | Force a clean `npm ci` and build. |
| `sudo scripts/deploy.sh --with-daemon` | Also install the Q775 sensor daemon. |
| `sudo scripts/launch.sh --no-kiosk` | Start the services but leave the local screen alone. |
| `sudo scripts/launch.sh --check` | Health checks only. |
| `sudo scripts/launch.sh --stop` | Stop the kiosk and both services. |
| `sudo scripts/launch.sh --reset-user admin` | New password, authenticator cleared, signed out everywhere. |

Then open `http://<q775-ip>:8080/` for the watch face, `/admin` for the control panel and `/ha` for the console. A Docker Compose setup is included as an alternative (`scripts/deploy.sh --docker && scripts/launch.sh --docker`).

## Configuration

The most important `back-stage` variables (the full list is in [`back-stage/.env.example`](back-stage/.env.example)):

| Variable | Meaning |
| --- | --- |
| `HA_URL`, `HA_TOKEN` | Home Assistant address and long-lived token. Kept on the server only. |
| `SESSION_SECRET`, `KIOSK_SHARED_SECRET` | Two different secrets of 32+ random characters. |
| `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` | While set, this admin always exists and this is its password. Remove both lines to manage the account in the UI. |
| `AUTH_METHOD` | `password` (default) or `totp`. With `totp`, users sign in with an authenticator code, binding it with their password on first sign-in. |
| `ALLOW_WAN`, `TRUST_PROXY_HEADERS`, `COOKIE_SECURE` | Network boundary. Keep LAN-only unless the device sits behind a VPN or HTTPS proxy. |
| `Q775_SIDECAR_URL`, `Q775_SIDECAR_TOKEN` | Screen on/off and brightness through the sidecar. |
| `HARVA_URL`, `HARVA_API_KEYS` | Optional BTC-HARVA service: adds the BTC/USDT 24 h trend and the rolling virtual-account card to the home face. Read-only keys, comma-separated. |

## Documentation

- [**技术手册 (Chinese handbook)**](docs/handbook.zh-CN.md): design language, every watch-face page, hardware budgets, back-stage internals, SSE events, API reference and extension guide.
- [**Linux deployment**](docs/linux-deployment.md): system preparation, secrets, manual steps behind the scripts, firewall, kiosk, updates and troubleshooting.
- Module notes: [back-stage](back-stage/README.md) · [watch-face](watch-face/README.md) · [ha-console](ha-console/README.md) · [daemon](daemon/README.md).
- [Roadmap and on-device verification checklist](TODO.md).

## Project site

The landing page in [`site/`](site/) is deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main` that touches it. To enable it, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. For a custom domain, enter it on the same page and add a `CNAME` DNS record pointing to `<user>.github.io`.

## Status

Hyper Clock is in active development for one specific device and household. On-device verification of keys, sensors, backlight and a 72-hour soak test is still open; progress is tracked in [TODO.md](TODO.md).

No license has been chosen yet, so all rights are reserved by the author until one is added.
