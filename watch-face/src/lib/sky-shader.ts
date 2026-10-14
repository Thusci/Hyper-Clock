import type { SolarPhase } from "@/hooks/use-solar-theme";

export type Rgb = [number, number, number];

export type SkyPalette = {
  top: Rgb;
  mid: Rgb;
  bottom: Rgb;
  glowA: Rgb;
  glowB: Rgb;
  sun: Rgb;
  /** Colour of the satin sheen bands (the brand accent of the phase). */
  sheen: Rgb;
  glow: number;
  sunStrength: number;
  light: number;
};

export type SkyWeather = {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  wind: number;
  storm: number;
};

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

// Mirrors the solar phase tokens in globals.css so the canvas and the CSS fallback agree.
export const skyPalettes: Record<SolarPhase, SkyPalette> = {
  dawn: { top: hex("#e9dfda"), mid: hex("#f1e7e1"), bottom: hex("#f6efe8"), glowA: hex("#e4bfa6"), glowB: hex("#b9c2d2"), sun: hex("#f3c9a4"), sheen: hex("#b98564"), glow: .38, sunStrength: .5, light: 1 },
  day: { top: hex("#e7eaea"), mid: hex("#e3e6e4"), bottom: hex("#f2f1ed"), glowA: hex("#ffffff"), glowB: hex("#c3ccd0"), sun: hex("#fff5e2"), sheen: hex("#a98252"), glow: .34, sunStrength: .35, light: 1 },
  dusk: { top: hex("#2a2124"), mid: hex("#1a1517"), bottom: hex("#0d0b0c"), glowA: hex("#7a4c3a"), glowB: hex("#3d3344"), sun: hex("#d19c6c"), sheen: hex("#d19c6c"), glow: .34, sunStrength: .45, light: 0 },
  night: { top: hex("#141416"), mid: hex("#0c0c0d"), bottom: hex("#070707"), glowA: hex("#2a2622"), glowB: hex("#1d2228"), sun: hex("#c8a978"), sheen: hex("#c8a978"), glow: .5, sunStrength: 0, light: 0 },
};

export function skyWeather(condition: string): SkyWeather {
  const c = condition || "";
  const weather: SkyWeather = { cloud: 0, rain: 0, snow: 0, fog: 0, wind: 0, storm: 0 };
  if (c === "partlycloudy") weather.cloud = .42;
  if (c === "cloudy") weather.cloud = .85;
  if (c === "windy") { weather.cloud = .18; weather.wind = .85; }
  if (c === "windy-variant") { weather.cloud = .55; weather.wind = .8; }
  if (c === "fog") { weather.cloud = .6; weather.fog = 1; }
  if (c === "rainy") { weather.cloud = .82; weather.rain = .55; }
  if (c === "pouring") { weather.cloud = 1; weather.rain = 1; weather.wind = .35; }
  if (c === "snowy") { weather.cloud = .78; weather.snow = .8; }
  if (c === "snowy-rainy") { weather.cloud = .85; weather.rain = .35; weather.snow = .45; }
  if (c === "hail") { weather.cloud = .9; weather.snow = .55; weather.rain = .3; }
  if (c === "lightning") { weather.cloud = .9; weather.storm = 1; }
  if (c === "lightning-rainy") { weather.cloud = 1; weather.rain = .8; weather.storm = 1; weather.wind = .3; }
  return weather;
}

export const skyVertex = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// Time uniforms wrap (uTime every 12 h, uTimeFast every 300 s) to keep float32 precision on a 24/7 kiosk.
// Every speed driven by uTimeFast is chosen so one wrap period moves a whole number of cycles, making the wrap seamless.
export const skyFragment = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uTimeFast;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBottom;
uniform vec3 uGlowA;
uniform vec3 uGlowB;
uniform vec3 uSunColor;
uniform vec3 uSheen;
uniform vec3 uSun;
uniform float uGlow;
uniform float uLight;
uniform float uCloud;
uniform float uRain;
uniform float uSnow;
uniform float uFog;
uniform float uWind;
uniform float uStars;
uniform float uFlash;
uniform float uStarlight;
uniform vec4 uMeteor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = rotate * p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}

// Fibre-optic headliner points: warm-white pinpoints with a faint halo and a slow, shallow shimmer.
float starlightLayer(vec2 p, float cells, float density, float seed) {
  vec2 grid = p * cells;
  vec2 cell = floor(grid);
  float h = hash(cell + seed);
  vec2 offset = vec2(hash(cell + seed + 1.7), hash(cell + seed + 8.3)) - 0.5;
  float d = length(fract(grid) - 0.5 - offset * 0.6);
  float core = smoothstep(0.13, 0.0, d);
  float halo = exp(-d * d * 60.0) * 0.18;
  float shimmer = 0.78 + 0.22 * sin(uTime * (0.25 + h * 0.6) + h * 61.0);
  return (core + halo) * step(1.0 - density, h) * shimmer * (0.45 + 0.55 * hash(cell + seed + 4.4));
}

// One shooting star: uMeteor = (start.x, start.y, heading in radians, progress 0..1; < 0 when idle).
float meteor(vec2 p, float aspect) {
  if (uMeteor.w < 0.0) return 0.0;
  vec2 start = vec2(uMeteor.x * aspect, uMeteor.y);
  vec2 dir = vec2(cos(uMeteor.z), sin(uMeteor.z));
  float ease = 1.0 - pow(1.0 - uMeteor.w, 2.2);
  vec2 head = start + dir * ease * 0.62;
  float tail = 0.2 + 0.1 * (1.0 - uMeteor.w);
  vec2 rel = p - head;
  float along = -dot(rel, dir);
  float across = abs(rel.x * dir.y - rel.y * dir.x);
  float body = smoothstep(tail, 0.0, along) * step(0.0, along) * smoothstep(0.0026, 0.0, across);
  float spark = exp(-dot(rel, rel) * 9000.0);
  float life = smoothstep(0.0, 0.12, uMeteor.w) * (1.0 - smoothstep(0.62, 1.0, uMeteor.w));
  return (body * 0.85 + spark) * life;
}

float rainLayer(vec2 p, float scale, float speed, float seed, float density) {
  float slant = 0.16 + uWind * 0.28;
  vec2 rp = vec2((p.x + p.y * slant) * scale, p.y);
  float column = floor(rp.x);
  float h = hash(vec2(column, seed));
  float active = step(1.0 - density, hash(vec2(column + 31.0, seed)));
  float y = fract(rp.y * (1.1 + h * 0.6) + uTimeFast * speed + h * 7.0);
  float streak = smoothstep(0.0, 0.012, y) * (1.0 - smoothstep(0.0, 0.2, y));
  float x = abs(fract(rp.x) - 0.5 - (h - 0.5) * 0.5);
  return streak * smoothstep(0.075, 0.0, x) * active;
}

float snowLayer(vec2 p, float scale, float cellsPerSecond, float seed, float density) {
  vec2 sp = p * scale;
  sp.y += uTimeFast * cellsPerSecond;
  sp.x += sin(uTimeFast * 0.6074 + sp.y * 0.55 + seed) * 0.32;
  vec2 cell = floor(sp);
  vec2 key = vec2(cell.x, mod(cell.y, 64.0)) + seed;
  float h = hash(key);
  vec2 offset = vec2(hash(key + 3.1), hash(key + 7.7)) - 0.5;
  float d = length(fract(sp) - 0.5 - offset * 0.55);
  float size = 0.045 + 0.05 * h;
  return smoothstep(size, size * 0.25, d) * step(1.0 - density, h);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime;

  vec3 color = mix(uBottom, uMid, smoothstep(0.0, 0.55, uv.y));
  color = mix(color, uTop, smoothstep(0.45, 1.0, uv.y));

  vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t * 0.018)), fbm(p * 1.1 + vec2(5.2, -t * 0.014)));
  vec2 r = vec2(fbm(p * 1.4 + 2.0 * q + vec2(1.7, 9.2) + t * 0.010), fbm(p * 1.4 + 2.0 * q + vec2(8.3, 2.8) - t * 0.012));
  float field = fbm(p * 1.2 + 2.2 * r);
  float clear = 1.0 - uCloud * 0.65;
  color = mix(color, uGlowA, smoothstep(0.38, 0.92, field) * uGlow * clear);
  color = mix(color, uGlowB, smoothstep(0.42, 0.88, r.x) * uGlow * 0.75 * clear);

  // Satin: thin highlights along the contours of the warped field, drifting very slowly.
  float fold = 0.5 + 0.5 * sin(field * 11.0 + r.y * 4.0 + t * 0.04);
  float satin = pow(fold, 14.0) * smoothstep(0.15, 0.85, uv.y + 0.2 * r.x);
  color = mix(color, uSheen, satin * mix(0.11, 0.07, uLight) * clear);

  vec2 sun = vec2(uSun.x * aspect, uSun.y);
  float sd = length(p - sun);
  color += uSunColor * (exp(-sd * sd * 4.5) * 0.5 + exp(-sd * 20.0) * 0.32) * uSun.z * (1.0 - uCloud * 0.72);

  if (uStars > 0.01) {
    vec2 grid = p * 70.0;
    vec2 cell = floor(grid);
    float h = hash(cell);
    vec2 offset = vec2(hash(cell + 1.3), hash(cell + 9.1)) - 0.5;
    float d = length(fract(grid) - 0.5 - offset * 0.7);
    float twinkle = 0.55 + 0.45 * sin(t * (0.6 + h * 1.8) + h * 40.0);
    float star = smoothstep(0.09, 0.0, d) * step(0.986, h) * twinkle;
    color += vec3(0.86, 0.91, 1.0) * star * uStars * smoothstep(0.2, 0.9, uv.y);
  }

  if (uStarlight > 0.01) {
    float starlight = starlightLayer(p, 64.0, 0.05, 3.0) + starlightLayer(p, 38.0, 0.035, 9.0) * 1.2;
    float dome = smoothstep(0.05, 0.75, uv.y);
    color += vec3(1.0, 0.95, 0.86) * starlight * uStarlight * dome * 0.75;
    color += vec3(1.0, 0.97, 0.9) * meteor(p, aspect) * uStarlight;
  }

  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, vec3(luminance) * mix(0.92, 0.97, uLight), uCloud * 0.5);

  if (uCloud > 0.01) {
    float drift = t * (0.008 + uWind * 0.03);
    float c1 = fbm(vec2(p.x * 1.5 - drift * 3.0, p.y * 3.0) + q * 0.6);
    float c2 = fbm(vec2(p.x * 3.1 - drift * 5.0 + 3.1, p.y * 5.2));
    float mass = c1 * 0.7 + c2 * 0.3 + (uv.y - 0.5) * 0.22;
    float threshold = mix(0.82, 0.3, uCloud);
    float cloud = smoothstep(threshold, threshold + 0.3, mass);
    vec3 cloudColor = mix(uMid * 1.3 + 0.05, vec3(0.97, 0.98, 1.0), uLight * 0.85);
    cloudColor *= 0.8 + 0.2 * smoothstep(0.2, 0.8, c2);
    color = mix(color, cloudColor, cloud * 0.82);
  }

  color *= 1.0 - uRain * 0.16;

  if (uFog > 0.01) {
    float haze = fbm(vec2(p.x * 2.0 - t * 0.02, p.y * 6.0));
    float band = smoothstep(0.8, 0.0, uv.y) * (0.55 + 0.45 * haze);
    color = mix(color, mix(uMid + 0.12, vec3(0.86, 0.88, 0.91), 0.45 + 0.35 * uLight), band * uFog * 0.72);
  }

  if (uRain > 0.01) {
    float rain = rainLayer(p, 42.0, 1.6, 1.0, 0.35 + uRain * 0.5) * 0.45
      + rainLayer(p, 64.0, 2.2, 2.0, 0.3 + uRain * 0.5) * 0.65
      + rainLayer(p, 90.0, 2.8, 3.0, 0.25 + uRain * 0.5) * 0.85;
    color = mix(color, mix(vec3(0.82, 0.88, 0.97), vec3(0.3, 0.4, 0.52), uLight), clamp(rain * uRain * 0.55, 0.0, 1.0));
  }

  if (uSnow > 0.01) {
    float snow = snowLayer(p, 9.0, 0.64, 11.0, uSnow * 0.75) * 0.5
      + snowLayer(p, 14.0, 0.8533, 23.0, uSnow * 0.8) * 0.75
      + snowLayer(p, 20.0, 1.0667, 37.0, uSnow * 0.85);
    color = mix(color, mix(vec3(1.0), vec3(0.93, 0.96, 1.0), uLight), clamp(snow * uSnow, 0.0, 1.0));
  }

  color += vec3(0.74, 0.8, 1.0) * uFlash * (0.22 + 0.32 * smoothstep(0.2, 1.0, uv.y));

  float vignette = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.0, 1.15)));
  color *= mix(mix(0.84, 0.94, uLight), 1.0, vignette);

  color += (hash(gl_FragCoord.xy + fract(uTimeFast)) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(color, 1.0);
}
`;
