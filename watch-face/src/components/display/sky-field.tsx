"use client";

import { useEffect, useRef } from "react";
import type { SolarPhase } from "@/hooks/use-solar-theme";
import { type Rgb, skyFragment, skyPalettes, skyVertex, skyWeather } from "@/lib/sky-shader";

type SkyFieldProps = {
  phase: SolarPhase;
  timezone: string;
  condition: string;
  progress: number;
  sunUp: boolean;
  onReady: (ready: boolean) => void;
};

type SkyState = {
  top: Rgb; mid: Rgb; bottom: Rgb; glowA: Rgb; glowB: Rgb; sunColor: Rgb; sheen: Rgb;
  sunX: number; sunY: number; sunZ: number;
  glow: number; light: number; stars: number; starlight: number;
  cloud: number; rain: number; snow: number; fog: number; wind: number; storm: number;
};

const vectorKeys = ["top", "mid", "bottom", "glowA", "glowB", "sunColor", "sheen"] as const;
const scalarKeys = ["sunX", "sunY", "sunZ", "glow", "light", "stars", "starlight", "cloud", "rain", "snow", "fog", "wind", "storm"] as const;

/*
 * Budget for the Q775 (Core i5-5300U, Intel HD Graphics 5500, 1920×1080, Chromium on Linux).
 * The sky renders at ≤1100 px wide and is upscaled (it is soft by design), at 20 fps calm,
 * 30 fps with precipitation or starlight and 60 fps only while a meteor is in flight —
 * roughly 10–15 % of the GPU. Two guards keep it honest on real hardware:
 *   - a software renderer (SwiftShader/llvmpipe) means no GPU: fall back to the CSS sky;
 *   - if frames keep arriving late, the backing width steps down 1100 → 880 → 700.
 */
const BACKING_WIDTHS = [1100, 880, 700];
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software/i;

/** Rolls-Royce "Starlight" hours: fully on 23:30–04:30, fading in from 22:30 and out by 05:30. */
function lateNightLevel(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const minutes = Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const shifted = (minutes + 120) % 1440; // 22:00 → 0, so the window is contiguous
  if (shifted < 30 || shifted > 450) return 0;
  if (shifted < 90) return (shifted - 30) / 60;
  if (shifted > 390) return (450 - shifted) / 60;
  return 1;
}

function targetState(phase: SolarPhase, condition: string, progress: number, sunUp: boolean): SkyState {
  const palette = skyPalettes[phase];
  const weather = skyWeather(condition);
  const arc = Math.max(0, Math.min(1, progress));
  const clearNight = phase === "night" && condition !== "" ? 1 - weather.cloud : phase === "night" ? .8 : 0;
  return {
    top: palette.top, mid: palette.mid, bottom: palette.bottom, glowA: palette.glowA, glowB: palette.glowB, sunColor: palette.sun, sheen: palette.sheen,
    sunX: sunUp ? .12 + arc * .76 : .78,
    sunY: sunUp ? .32 + Math.sin(Math.PI * arc) * .58 : .86,
    sunZ: sunUp ? palette.sunStrength : phase === "night" ? .18 : .1,
    glow: palette.glow, light: palette.light, stars: Math.max(0, clearNight), starlight: 0,
    ...weather,
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("Sky shader failed to compile", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

export function SkyField({ phase, timezone, condition, progress, sunUp, onReady }: SkyFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const target = useRef(targetState(phase, condition, progress, sunUp));
  const zone = useRef(timezone);

  useEffect(() => {
    target.current = targetState(phase, condition, progress, sunUp);
    zone.current = timezone;
  }, [condition, phase, progress, sunUp, timezone]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas per mount: a context released with loseContext() can never be reused.
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    if (!gl) {
      canvas.remove();
      onReady(false);
      return;
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (SOFTWARE_RENDERER.test(renderer)) {
      console.warn(`Sky disabled: software WebGL renderer (${renderer})`);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
      onReady(false);
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const current: SkyState = structuredClone(target.current);
    let program: WebGLProgram | null = null;
    let uniforms: Record<string, WebGLUniformLocation | null> = {};
    let frame = 0;
    let lastDraw = 0;
    let lastTick = performance.now();
    let elapsed = 0;
    let flashAt = 0;
    let nextFlash = 0;
    let lost = false;
    let quality = 0;
    let lateFrames = 0;
    let checkedLateNight = 0;
    let lateNight = lateNightLevel(zone.current);
    let meteorStart = 0;
    let meteorDuration = 0;
    let nextMeteor = 0;
    let meteorShape = [0, 0, 0];

    const setup = () => {
      const vertex = compile(gl, gl.VERTEX_SHADER, skyVertex);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, skyFragment);
      if (!vertex || !fragment) return false;
      program = gl.createProgram();
      if (!program) return false;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const names = ["uRes", "uTime", "uTimeFast", "uTop", "uMid", "uBottom", "uGlowA", "uGlowB", "uSunColor", "uSheen", "uSun", "uGlow", "uLight", "uCloud", "uRain", "uSnow", "uFog", "uWind", "uStars", "uFlash", "uStarlight", "uMeteor"];
      uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program!, name)]));
      return true;
    };

    const resize = () => {
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      const scale = Math.min(1, BACKING_WIDTHS[quality] / width);
      const backingWidth = Math.max(1, Math.round(width * scale));
      const backingHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

    const flashLevel = (now: number) => {
      if (reducedMotion.matches || current.storm < .2) return 0;
      if (!nextFlash) nextFlash = now + 3000 + Math.random() * 6000;
      if (now >= nextFlash) {
        flashAt = now;
        nextFlash = now + 4000 + Math.random() * 9000;
      }
      const age = now - flashAt;
      if (age > 700) return 0;
      const pulse = (start: number, width: number) => Math.max(0, 1 - Math.abs(age - start) / width);
      return Math.min(1, pulse(40, 60) + pulse(210, 90) * .7) * current.storm;
    };

    /** Slow, sparse meteors in the upper sky; a new one every 6–16 s while starlight is on. */
    const meteorLevel = (now: number) => {
      if (reducedMotion.matches || current.starlight < .5) { meteorDuration = 0; return -1; }
      if (!nextMeteor) nextMeteor = now + 2500 + Math.random() * 5000;
      if (!meteorDuration && now >= nextMeteor) {
        const leftward = Math.random() < .5;
        meteorShape = [leftward ? .55 + Math.random() * .35 : .1 + Math.random() * .35, .62 + Math.random() * .32, (leftward ? Math.PI + .38 : -.38) + (Math.random() - .5) * .3];
        meteorStart = now;
        meteorDuration = 1500 + Math.random() * 900;
      }
      if (!meteorDuration) return -1;
      const progress = (now - meteorStart) / meteorDuration;
      if (progress >= 1) {
        meteorDuration = 0;
        nextMeteor = now + 6000 + Math.random() * 10_000;
        return -1;
      }
      return progress;
    };

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      if (lost || !program) return;
      const meteorActive = meteorDuration > 0;
      const active = Math.max(current.rain, current.snow, current.storm, current.starlight) > .05;
      const fps = reducedMotion.matches ? 2 : meteorActive ? 60 : active ? 30 : 20;
      const interval = 1000 / fps;
      if (now - lastDraw < interval - 2) return;
      // Governor: sustained late frames mean the GPU is saturated, so render fewer pixels.
      if (lastDraw && now - lastDraw > interval * 1.8) lateFrames++;
      else lateFrames = Math.max(0, lateFrames - .25);
      if (lateFrames > 45 && quality < BACKING_WIDTHS.length - 1) {
        quality++;
        lateFrames = 0;
        resize();
        console.info(`Sky quality lowered to ${BACKING_WIDTHS[quality]} px`);
      }
      lastDraw = now;
      if (now - checkedLateNight > 15_000) {
        checkedLateNight = now;
        lateNight = lateNightLevel(zone.current);
      }
      const dt = Math.min(.25, (now - lastTick) / 1000);
      lastTick = now;
      if (!reducedMotion.matches) elapsed += dt;

      const base = target.current;
      const clearSky = base.cloud < .3 && base.rain + base.snow + base.fog + base.storm === 0;
      const goal = { ...base, starlight: base.light === 0 && base.sunZ < .2 && clearSky ? lateNight : 0, stars: base.stars * (1 - lateNight * .6) };
      const colorStep = ease(dt, 1.6);
      const weatherStep = ease(dt, 2.2);
      for (const key of vectorKeys) for (let i = 0; i < 3; i++) current[key][i] += (goal[key][i] - current[key][i]) * colorStep;
      const starStep = ease(dt, 6);
      for (const key of scalarKeys) current[key] += (goal[key] - current[key]) * (key === "starlight" ? starStep : key.startsWith("sun") || key === "glow" || key === "light" ? colorStep : weatherStep);

      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, elapsed % 43200);
      gl.uniform1f(uniforms.uTimeFast, elapsed % 300);
      gl.uniform3fv(uniforms.uTop, current.top);
      gl.uniform3fv(uniforms.uMid, current.mid);
      gl.uniform3fv(uniforms.uBottom, current.bottom);
      gl.uniform3fv(uniforms.uGlowA, current.glowA);
      gl.uniform3fv(uniforms.uGlowB, current.glowB);
      gl.uniform3fv(uniforms.uSunColor, current.sunColor);
      gl.uniform3fv(uniforms.uSheen, current.sheen);
      gl.uniform3f(uniforms.uSun, current.sunX, current.sunY, current.sunZ);
      gl.uniform1f(uniforms.uGlow, current.glow);
      gl.uniform1f(uniforms.uLight, current.light);
      gl.uniform1f(uniforms.uCloud, current.cloud);
      gl.uniform1f(uniforms.uRain, current.rain);
      gl.uniform1f(uniforms.uSnow, current.snow);
      gl.uniform1f(uniforms.uFog, current.fog);
      gl.uniform1f(uniforms.uWind, current.wind);
      gl.uniform1f(uniforms.uStars, current.stars);
      gl.uniform1f(uniforms.uFlash, flashLevel(now));
      gl.uniform1f(uniforms.uStarlight, current.starlight);
      gl.uniform4f(uniforms.uMeteor, meteorShape[0], meteorShape[1], meteorShape[2], meteorLevel(now));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      lastTick = performance.now();
      lastDraw = 0;
      frame = window.requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (document.hidden) window.cancelAnimationFrame(frame);
      else start();
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      program = null;
      window.cancelAnimationFrame(frame);
      onReady(false);
    };
    const onRestored = () => {
      lost = false;
      if (!setup()) return;
      resize();
      onReady(true);
      start();
    };

    if (!setup()) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
      onReady(false);
      return;
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", onVisibility);
    onReady(true);
    start();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", onVisibility);
      onReady(false);
      // Free the GPU context right away; the face remounts the sky on every minimal/off cycle.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [onReady]);

  return <div ref={hostRef} className="sky-field" aria-hidden="true" />;
}
