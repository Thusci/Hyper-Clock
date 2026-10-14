import type { HassEntity, HassEntityMap } from "@/types/config";

function attribute(entity: HassEntity | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = entity?.attributes[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function stockNumber(entity: HassEntity | undefined, ...keys: string[]) {
  const value = attribute(entity, ...keys);
  const number = Number(value);
  return value !== undefined && Number.isFinite(number) ? number : undefined;
}

export function stockText(entity: HassEntity | undefined, ...keys: string[]) {
  const value = attribute(entity, ...keys);
  return value === undefined ? "" : String(value);
}

export function stockSymbol(entity: HassEntity | undefined, id: string) {
  return stockText(entity, "symbol", "friendly_name") || id.replace(/^sensor\./, "").toUpperCase();
}

export function stockCurrency(entity: HassEntity | undefined) {
  return stockText(entity, "currencySymbol", "currency", "unit_of_measurement");
}

export function stockPrice(entity: HassEntity | undefined) {
  const state = Number(entity?.state);
  return Number.isFinite(state) ? state : stockNumber(entity, "regularMarketPrice", "regular_market_price");
}

export function stockChange(entity: HassEntity | undefined) {
  return stockNumber(entity, "regularMarketChange", "regular_market_change", "change");
}

export function stockPercent(entity: HassEntity | undefined) {
  return stockNumber(entity, "regularMarketChangePercent", "regular_market_change_percent", "change_percent");
}

export function stockDirection(entity: HassEntity | undefined, history: number[] = []) {
  const trending = stockText(entity, "trending").toLowerCase();
  if (trending === "up") return 1;
  if (trending === "down") return -1;
  const change = stockChange(entity);
  if (change !== undefined) return Math.sign(change);
  if (history.length > 1) return Math.sign(history.at(-1)! - history[0]);
  return 0;
}

export function isStockEntity(entity: HassEntity) {
  const attributes = entity.attributes;
  return entity.entity_id.startsWith("sensor.yahoofinance_") || (
    typeof attributes.symbol === "string" && (
      "regularMarketPrice" in attributes ||
      "regularMarketChange" in attributes ||
      "regular_market_change" in attributes ||
      "quoteType" in attributes
    )
  );
}

export function resolveStockIds(configured: string[], entities: HassEntityMap) {
  const ids = configured.length ? configured : Object.values(entities).filter(isStockEntity).map((entity) => entity.entity_id);
  return [...new Set(ids)].sort((left, right) => stockSymbol(entities[left], left).localeCompare(stockSymbol(entities[right], right), "zh-CN"));
}

export function formatStockNumber(value: number | undefined, maximumFractionDigits = 2) {
  return value === undefined ? "--" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}
