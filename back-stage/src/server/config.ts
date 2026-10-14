import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { pageKindIds } from "@/shared/page-kinds";
import { dataDir, files, writeJson } from "./store";
import type { AppConfig } from "@/types";

/**
 * The watch-face configuration: one validated document.
 * runtime-config.json holds the admin's edits; default-config.json is the shipped fallback.
 */
const trigger = z.object({ id: z.string(), entityId: z.string().min(1), toState: z.string().optional(), mode: z.enum(["full", "minimal"]), enabled: z.boolean() });
const entityList = (max: number) => z.array(z.string()).max(max).default([]);

export const configSchema = z.object({
  deviceName: z.string().min(1).max(80),
  locale: z.string().min(2).max(20),
  timezone: z.string().min(1).max(60),
  idle: z.object({
    minimalAfterMs: z.number().int().min(10_000).max(86_400_000),
    screenOffAfterMs: z.number().int().min(20_000).max(86_400_000),
    winLongPressMs: z.number().int().min(300).max(5000),
    voiceLongPressMs: z.number().int().min(300).max(5000),
    minimalLongPressMs: z.number().int().min(600).max(10_000),
  }).refine((value) => value.screenOffAfterMs > value.minimalAfterMs, { message: "熄屏时间必须晚于极简模式" }),
  voice: z.object({ enabled: z.boolean(), wakeWord: z.boolean(), winKey: z.boolean(), endpoint: z.union([z.literal(""), z.url()]) }),
  theme: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), cardOpacity: z.number().int().min(20).max(100), clockScale: z.number().int().min(70).max(140), burnInShift: z.boolean() }),
  weatherEntity: z.string().max(120),
  pages: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(30),
    enabled: z.boolean(),
    kind: z.enum(pageKindIds),
    cards: z.array(z.string()).max(20),
  })).min(1).max(12),
  entities: z.object({
    lights: entityList(80),
    sensors: entityList(80),
    calendars: entityList(20),
    courses: entityList(20),
    mediaPlayers: entityList(20),
    briefings: entityList(20),
    memos: entityList(20),
    stocks: entityList(30),
    systemMetrics: z.object({
      cpu: z.string().max(120).default(""), memory: z.string().max(120).default(""), disk: z.string().max(120).default(""),
      power: z.string().max(120).default(""), temperature: z.string().max(120).default(""), uptime: z.string().max(120).default(""),
    }).default({ cpu: "", memory: "", disk: "", power: "", temperature: "", uptime: "" }),
  }),
  wakeTriggers: z.array(trigger).max(80),
});

const dataFile = (name: string) => path.join(dataDir, name);

export async function readConfig(): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(dataFile(files.config), "utf8");
  } catch {
    raw = await fs.readFile(dataFile(files.defaultConfig), "utf8");
  }
  return configSchema.parse(JSON.parse(raw)) as AppConfig;
}

export async function writeConfig(value: unknown): Promise<AppConfig> {
  const parsed = configSchema.parse(value) as AppConfig;
  await writeJson(files.config, parsed);
  return parsed;
}
