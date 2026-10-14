import type { HassEntity, HassEntityMap } from "@/types/config";

export type WeatherValue = number | string;

type MetricKey =
  | "temperature" | "apparentTemperature" | "humidity" | "windSpeed" | "windScale"
  | "pressure" | "visibility" | "windDirection" | "cloud" | "dew" | "uv"
  | "precipitation" | "aqi" | "airCategory" | "primaryPollutant"
  | "pm25" | "pm10" | "no2" | "so2" | "co" | "o3" | "weatherText";

type MetricSpec = {
  suffixes: string[];
  names: string[];
  attributes: string[];
  fallbackUnit?: string;
};

const invalidStates = new Set(["", "unknown", "unavailable", "none", "null"]);

const metricSpecs: Record<MetricKey, MetricSpec> = {
  temperature: { suffixes: ["temperature", "heweather_temperature", "temprature"], names: ["室外温度", "温度"], attributes: ["temperature"], fallbackUnit: "°" },
  apparentTemperature: { suffixes: ["feelslike", "feels_like", "apparent_temperature"], names: ["体感温度"], attributes: ["apparent_temperature", "feels_like", "feelslike"], fallbackUnit: "°" },
  humidity: { suffixes: ["humidity"], names: ["室外湿度", "湿度"], attributes: ["humidity"], fallbackUnit: "%" },
  windSpeed: { suffixes: ["windspeed", "wind_speed"], names: ["风速"], attributes: ["wind_speed"], fallbackUnit: "km/h" },
  windScale: { suffixes: ["windscale", "wind_scale"], names: ["风力等级"], attributes: ["wind_scale", "windscale"], fallbackUnit: "级" },
  pressure: { suffixes: ["pressure"], names: ["大气压强", "气压"], attributes: ["pressure"], fallbackUnit: "hPa" },
  visibility: { suffixes: ["vis", "visibility"], names: ["能见度"], attributes: ["visibility", "vis"], fallbackUnit: "km" },
  windDirection: { suffixes: ["winddir", "wind_direction", "wind_bearing"], names: ["风向"], attributes: ["wind_bearing", "wind_direction", "winddir"] },
  cloud: { suffixes: ["cloud", "cloud_coverage"], names: ["云量"], attributes: ["cloud_coverage", "cloud"], fallbackUnit: "%" },
  dew: { suffixes: ["dew", "dew_point"], names: ["露点温度", "露点"], attributes: ["dew_point", "dew"], fallbackUnit: "°" },
  uv: { suffixes: ["uv", "uv_index", "suggestion_uv"], names: ["紫外线指数", "紫外线"], attributes: ["uv_index", "uv"], fallbackUnit: "UV" },
  precipitation: { suffixes: ["precip", "precipitation"], names: ["小时降水量", "降水量"], attributes: ["precipitation", "precip"], fallbackUnit: "mm" },
  aqi: { suffixes: ["aqi", "qlty", "air_quality_index"], names: ["综合空气质量", "空气质量指数", "空气污染扩散条件指数"], attributes: ["aqi", "air_quality_index"], fallbackUnit: "AQI" },
  airCategory: { suffixes: ["category", "air_quality_level"], names: ["空气质量指数等级", "空气质量等级"], attributes: ["category", "air_quality_level"] },
  primaryPollutant: { suffixes: ["primary", "primary_pollutant"], names: ["空气质量主要污染物", "主要污染物"], attributes: ["primary", "primary_pollutant"] },
  pm25: { suffixes: ["pm25", "pm2_5"], names: ["PM2.5"], attributes: ["pm25", "pm2_5"], fallbackUnit: "μg/m³" },
  pm10: { suffixes: ["pm10"], names: ["PM10"], attributes: ["pm10"], fallbackUnit: "μg/m³" },
  no2: { suffixes: ["no2"], names: ["二氧化氮"], attributes: ["no2"], fallbackUnit: "μg/m³" },
  so2: { suffixes: ["so2"], names: ["二氧化硫"], attributes: ["so2"], fallbackUnit: "μg/m³" },
  co: { suffixes: ["co"], names: ["一氧化碳"], attributes: ["co"], fallbackUnit: "mg/m³" },
  o3: { suffixes: ["o3", "ozone"], names: ["臭氧"], attributes: ["o3", "ozone"], fallbackUnit: "μg/m³" },
  weatherText: { suffixes: ["text", "weather_text", "weather_description"], names: ["天气描述"], attributes: ["condition_cn", "weather_description", "text"] },
};

export type WeatherMetric = { value: WeatherValue | null; unit: string; entityId?: string };

export type WeatherSnapshot = {
  entityId: string;
  fallbackEntityId: string;
  entity?: HassEntity;
  sourceName: string;
  condition: string;
  conditionLabel: string;
  metrics: Record<MetricKey, WeatherMetric>;
};

function valid(value: unknown): value is string | number {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && !invalidStates.has(value.trim().toLowerCase());
}

function valueOf(value: string | number): WeatherValue {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  return trimmed !== "" && Number.isFinite(numeric) ? numeric : trimmed;
}

function isQWeather(entity: HassEntity | undefined) {
  if (!entity) return false;
  const id = entity.entity_id.toLowerCase();
  const name = String(entity.attributes.friendly_name ?? "").toLowerCase();
  return id.includes("he_feng_tian_qi") || id.includes("heweather") || id.includes("qweather") || name.includes("和风") || name.includes("qweather") || name.includes("heweather");
}

function usableWeather(entity: HassEntity | undefined) {
  return Boolean(entity && entity.entity_id.startsWith("weather.") && valid(entity.state));
}

function sensorFor(entities: HassEntityMap, spec: MetricSpec) {
  const qSensors = Object.values(entities).filter((entity) => entity.entity_id.startsWith("sensor.") && isQWeather(entity));
  for (const suffix of spec.suffixes) {
    const exact = qSensors.find((entity) => entity.entity_id.toLowerCase().endsWith(`_${suffix}`) && valid(entity.state));
    if (exact) return exact;
  }
  return qSensors.find((entity) => {
    if (!valid(entity.state)) return false;
    const name = String(entity.attributes.friendly_name ?? "").trim().toLowerCase();
    return spec.names.some((candidate) => name === candidate.toLowerCase() || name.endsWith(candidate.toLowerCase()));
  });
}

function attributeMetric(entities: Array<HassEntity | undefined>, spec: MetricSpec): WeatherMetric | null {
  for (const entity of entities) {
    if (!entity) continue;
    for (const key of spec.attributes) {
      const value = entity.attributes[key];
      if (!valid(value)) continue;
      const unitKey = key === "wind_speed" ? "wind_speed_unit" : key === "pressure" ? "pressure_unit" : key === "visibility" ? "visibility_unit" : "unit_of_measurement";
      return { value: valueOf(value), unit: String(entity.attributes[unitKey] ?? spec.fallbackUnit ?? ""), entityId: entity.entity_id };
    }
  }
  return null;
}

function canonicalCondition(raw: string) {
  const value = raw.trim().toLowerCase();
  if (["clear-night", "cloudy", "fog", "hail", "lightning", "lightning-rainy", "partlycloudy", "pouring", "rainy", "snowy", "snowy-rainy", "sunny", "windy", "windy-variant", "exceptional"].includes(value)) return value;
  if (/雷/.test(raw)) return /雨/.test(raw) ? "lightning-rainy" : "lightning";
  if (/暴雨|大暴雨|特大暴雨/.test(raw)) return "pouring";
  if (/雨夹雪|冻雨/.test(raw)) return "snowy-rainy";
  if (/雪|冰雹/.test(raw)) return "snowy";
  if (/雨/.test(raw)) return "rainy";
  if (/雾|霾|沙|尘/.test(raw)) return "fog";
  if (/多云|少云/.test(raw)) return "partlycloudy";
  if (/阴|云/.test(raw)) return "cloudy";
  if (/风/.test(raw)) return "windy";
  if (/晴/.test(raw)) return "sunny";
  return value;
}

export function resolveWeatherSnapshot(entities: HassEntityMap, configuredId = "", forecastId = ""): WeatherSnapshot {
  const weatherEntities = Object.values(entities).filter((entity) => entity.entity_id.startsWith("weather."));
  const configured = entities[configuredId];
  const qWeather = weatherEntities.find((entity) => entity.entity_id === "weather.he_feng_tian_qi")
    ?? weatherEntities.find((entity) => isQWeather(entity));
  const fallback = usableWeather(configured) ? configured
    : usableWeather(entities[forecastId]) ? entities[forecastId]
      : weatherEntities.find(usableWeather);
  const primary = usableWeather(qWeather) ? qWeather : fallback ?? qWeather;
  const sources = [primary, fallback].filter((entity, index, values) => entity && values.indexOf(entity) === index);
  const metrics = Object.fromEntries(Object.entries(metricSpecs).map(([key, spec]) => {
    const sensor = sensorFor(entities, spec);
    if (sensor && valid(sensor.state)) {
      return [key, { value: valueOf(sensor.state), unit: String(sensor.attributes.unit_of_measurement ?? spec.fallbackUnit ?? ""), entityId: sensor.entity_id } satisfies WeatherMetric];
    }
    return [key, attributeMetric(sources, spec) ?? { value: null, unit: spec.fallbackUnit ?? "" }];
  })) as Record<MetricKey, WeatherMetric>;
  const text = metrics.weatherText.value;
  const rawCondition = valid(primary?.state) ? primary.state : valid(text) ? String(text) : valid(fallback?.state) ? fallback.state : "";
  const condition = canonicalCondition(rawCondition);
  const conditionLabel = valid(text) ? String(text) : rawCondition;
  return {
    entityId: primary?.entity_id ?? "",
    fallbackEntityId: fallback?.entity_id ?? "",
    entity: primary,
    sourceName: String(primary?.attributes.friendly_name ?? (qWeather ? "和风天气" : fallback?.attributes.friendly_name ?? "等待天气数据")),
    condition,
    conditionLabel,
    metrics,
  };
}

export function formatWeatherMetric(metric: WeatherMetric, fractionDigits = 1) {
  if (metric.value == null) return "--";
  const value = typeof metric.value === "number"
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: fractionDigits }).format(metric.value)
    : metric.value;
  return `${value}${metric.unit}`;
}
