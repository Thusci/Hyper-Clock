import type { HaCatalog } from "@/types/config";

/**
 * Integrations whose "devices" are not the household's own: the client's HA tracks
 * ~70 passing car keys, scooters and wearables through iBeacon (460 entities), which
 * would otherwise bury the real devices on the Devices page and inflate every count.
 */
export const HIDDEN_INTEGRATIONS = new Set([
  "ibeacon", "private_ble_device", "bluetooth_le_tracker",
  // Phone and iPad data is taken only from the Companion App (mobile_app); these duplicate it.
  "icloud", "icloud3",
  // The host's Bluetooth adapter is infrastructure, not a household device.
  "bluetooth",
]);

/** Shown elsewhere on the face, so not repeated as tiles: Companion App devices (personal panel), weather services. */
const NOT_TILES = new Set(["mobile_app", "heweather", "met"]);

type CatalogDevice = HaCatalog["devices"][number];

export function isHouseholdDevice(device: CatalogDevice, catalog: HaCatalog) {
  const integrations = device.integrations ?? [];
  if (integrations.length) return integrations.some((domain) => !HIDDEN_INTEGRATIONS.has(domain));
  // Older caches lack device integrations; fall back to the platforms of the device's entities.
  const platforms = catalog.entities.filter((item) => item.deviceId === device.deviceId).map((item) => item.platform).filter(Boolean);
  return !platforms.length || platforms.some((platform) => !HIDDEN_INTEGRATIONS.has(platform!));
}

/** Physical household devices for the device grid and its counts: no service entries, no duplicates of other panels. */
export function isDeviceTile(device: CatalogDevice) {
  return !device.service && !(device.integrations ?? []).some((domain) => NOT_TILES.has(domain));
}

/** The catalog with non-household devices (and their entities) removed. */
export function householdCatalog(catalog: HaCatalog): HaCatalog {
  const kept = new Set(catalog.devices.filter((device) => isHouseholdDevice(device, catalog)).map((device) => device.deviceId));
  return {
    ...catalog,
    devices: catalog.devices.filter((device) => kept.has(device.deviceId)),
    entities: catalog.entities.filter((item) => (item.deviceId ? kept.has(item.deviceId) : !HIDDEN_INTEGRATIONS.has(item.platform ?? ""))),
    integrations: catalog.integrations.filter((item) => !HIDDEN_INTEGRATIONS.has(item.domain)),
  };
}
