export type HaRole = "admin" | "viewer";

export type HaCatalogEntity = {
  entityId: string;
  name: string;
  domain: string;
  deviceId?: string | null;
  areaId?: string | null;
  areaName?: string;
  state?: string;
  attributes: Record<string, unknown>;
  disabled?: boolean;
};

export type HaArea = { areaId: string; name: string };
export type HaCatalogIntegration = {
  domain: string;
  title: string;
  state: string;
  source?: string;
  entryCount: number;
  deviceCount: number;
  entityCount: number;
  serviceCount: number;
};
export type HaCatalog = { connected: boolean; areas: HaArea[]; integrations: HaCatalogIntegration[]; entities: HaCatalogEntity[] };
