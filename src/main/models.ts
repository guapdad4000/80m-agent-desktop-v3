import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import DEFAULT_MODELS from "./default-models";

const MODELS_FILE = join(HERMES_HOME, "models.json");
const MODEL_CATALOG_URL =
  "https://hermes-agent.nousresearch.com/docs/api/model-catalog.json";
const MODEL_CATALOG_CACHE = join(HERMES_HOME, "cache", "model_catalog.json");
const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

export interface CatalogModel {
  provider: string;
  model: string;
  name: string;
  description: string;
  baseUrl: string;
  source: "catalog" | "fallback";
}

interface RawCatalogModel {
  id?: unknown;
  description?: unknown;
}

interface RawCatalogProvider {
  models?: unknown;
}

interface RawModelCatalog {
  version?: unknown;
  providers?: unknown;
}

function readModels(): SavedModel[] {
  try {
    if (!existsSync(MODELS_FILE)) return [];
    return JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeModels(models: SavedModel[]): void {
  safeWriteFile(MODELS_FILE, JSON.stringify(models, null, 2));
}

function seedDefaults(): SavedModel[] {
  const models: SavedModel[] = DEFAULT_MODELS.map((m) => ({
    id: randomUUID(),
    name: m.name,
    provider: m.provider,
    model: m.model,
    baseUrl: m.baseUrl,
    createdAt: Date.now(),
  }));
  writeModels(models);
  return models;
}

export function listModels(): SavedModel[] {
  if (!existsSync(MODELS_FILE)) {
    return seedDefaults();
  }
  const models = readModels();
  let changed = false;

  for (const defaultModel of DEFAULT_MODELS) {
    const exists = models.some(
      (m) =>
        m.provider === defaultModel.provider && m.model === defaultModel.model,
    );
    if (!exists) {
      models.push({
        id: randomUUID(),
        name: defaultModel.name,
        provider: defaultModel.provider,
        model: defaultModel.model,
        baseUrl: defaultModel.baseUrl,
        createdAt: Date.now(),
      });
      changed = true;
    }
  }

  if (changed) writeModels(models);
  return models;
}

function isFreshCache(filePath: string): boolean {
  try {
    return Date.now() - statSync(filePath).mtimeMs < MODEL_CATALOG_TTL_MS;
  } catch {
    return false;
  }
}

function modelNameFromId(id: string): string {
  const leaf = id.split("/").pop() || id;
  return leaf
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseCatalog(raw: RawModelCatalog, source: "catalog"): CatalogModel[] {
  if (
    raw.version !== 1 ||
    !raw.providers ||
    typeof raw.providers !== "object"
  ) {
    return [];
  }

  const result: CatalogModel[] = [];
  const providers = raw.providers as Record<string, RawCatalogProvider>;
  for (const [provider, providerCatalog] of Object.entries(providers)) {
    if (!Array.isArray(providerCatalog.models)) continue;
    for (const entry of providerCatalog.models as RawCatalogModel[]) {
      if (!entry || typeof entry.id !== "string") continue;
      const description =
        typeof entry.description === "string" ? entry.description : "";
      result.push({
        provider,
        model: entry.id,
        name: modelNameFromId(entry.id),
        description,
        baseUrl: "",
        source,
      });
    }
  }
  return result;
}

function fallbackCatalog(): CatalogModel[] {
  return DEFAULT_MODELS.map((m) => ({
    provider: m.provider,
    model: m.model,
    name: m.name,
    description: "fallback",
    baseUrl: m.baseUrl,
    source: "fallback",
  }));
}

function readCachedCatalog(): CatalogModel[] {
  try {
    if (!existsSync(MODEL_CATALOG_CACHE)) return [];
    const raw = JSON.parse(readFileSync(MODEL_CATALOG_CACHE, "utf-8"));
    return parseCatalog(raw, "catalog");
  } catch {
    return [];
  }
}

export async function listModelCatalog(): Promise<CatalogModel[]> {
  if (isFreshCache(MODEL_CATALOG_CACHE)) {
    const cached = readCachedCatalog();
    if (cached.length) return cached;
  }

  try {
    const response = await fetch(MODEL_CATALOG_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = (await response.json()) as RawModelCatalog;
    const parsed = parseCatalog(raw, "catalog");
    if (!parsed.length) throw new Error("Invalid model catalog");
    safeWriteFile(MODEL_CATALOG_CACHE, JSON.stringify(raw, null, 2));
    return parsed;
  } catch {
    const cached = readCachedCatalog();
    return cached.length ? cached : fallbackCatalog();
  }
}

export function addModel(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): SavedModel {
  const models = readModels();

  // Dedup: if same model ID + provider exists, return existing
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;

  const entry: SavedModel = {
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
  };
  models.push(entry);
  writeModels(models);
  return entry;
}

export function removeModel(id: string): boolean {
  const models = readModels();
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  writeModels(filtered);
  return true;
}

export function updateModel(
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): boolean {
  const models = readModels();
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  models[idx] = { ...models[idx], ...fields };
  writeModels(models);
  return true;
}
