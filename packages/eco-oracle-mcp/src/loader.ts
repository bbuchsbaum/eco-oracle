import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { extract } from "tar";
import type {
  AtlasManifest,
  AtlasPack,
  EcoIndexSnapshot,
  EdgeRecord,
  MicrocardRecord,
  RegistryEntry,
  SourceRecord,
  SymbolRecord,
} from "./types.js";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

const CACHE_DIR =
  process.env.ECO_CACHE_DIR || join(os.homedir(), ".cache", "eco-oracle");
const REFRESH_SECS = parseInt(process.env.ECO_REFRESH_SECS || "600", 10);
const GITHUB_TOKEN = process.env.ECO_GITHUB_TOKEN || "";

const DEFAULT_RELEASE_TAG = "eco-atlas";
const DEFAULT_ASSET_NAME = "atlas-pack.tgz";
const SNAPSHOT_VERSION = 1;

type RegistryDoc = RegistryEntry[] | { packages: RegistryEntry[] };

export async function loadRegistry(options: {
  url?: string;
  path?: string;
} = {}): Promise<RegistryEntry[]> {
  const registryPath = (options.path || "").trim();
  const registryUrl = (options.url || "").trim();

  let data: RegistryDoc;

  if (registryPath) {
    const raw = await readFile(registryPath, "utf-8");
    data = JSON.parse(raw) as RegistryDoc;
  } else if (registryUrl) {
    const effectiveUrl = await resolveRegistryUrl(registryUrl);
    const res = await fetchWithRetry(effectiveUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch registry (${res.status}): ${effectiveUrl}`);
    }
    data = (await res.json()) as RegistryDoc;
  } else {
    throw new Error("Set ECO_REGISTRY_URL or ECO_REGISTRY_PATH.");
  }

  const entries = Array.isArray(data) ? data : data?.packages;
  if (!Array.isArray(entries)) {
    throw new Error("Registry must be an array or an object with a packages array.");
  }

  return entries.map(normalizeRegistryEntry);
}

export async function loadAtlasPack(
  entry: RegistryEntry,
  options: { force?: boolean } = {}
): Promise<AtlasPack> {
  const force = Boolean(options.force);
  const slug = repoSlug(entry.repo || entry.package || "unknown");
  const packDir = join(CACHE_DIR, "packs", slug);
  const tgzPath = join(packDir, "atlas-pack.tgz");

  await mkdir(packDir, { recursive: true });

  const shouldDownload = await shouldRefreshTgz(tgzPath, force);
  if (shouldDownload) {
    await downloadAtlasPack(entry, tgzPath);
  }

  const tmpDir = await mkdtemp(join(os.tmpdir(), "eco-atlas-"));
  try {
    await extract({ file: tgzPath, cwd: tmpDir });

    const atlasSubdir = join(tmpDir, "atlas");
    const baseDir = fs.existsSync(atlasSubdir) ? atlasSubdir : tmpDir;

    const manifestPath = join(baseDir, "manifest.json");
    const manifest = (await safeReadJson(manifestPath)) as AtlasManifest;

    const cards = await readJsonl<MicrocardRecord>(join(baseDir, "cards.jsonl"));
    const symbols = await readJsonl<SymbolRecord>(join(baseDir, "symbols.jsonl"));
    const edges = await readJsonl<EdgeRecord>(join(baseDir, "edges.jsonl"));
    const sources = await readJsonl<SourceRecord>(join(baseDir, "sources.jsonl"));

    return {
      manifest: manifest || {},
      cards,
      symbols,
      edges,
      sources,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function loadIndexSnapshot(options: {
  url?: string;
  path?: string;
  maxAgeSecs?: number;
} = {}): Promise<EcoIndexSnapshot | null> {
  const snapshotFile = getSnapshotPath(options);
  if (!snapshotFile || !fs.existsSync(snapshotFile)) return null;

  try {
    const snapshotStat = await stat(snapshotFile);
    const maxAgeSecs = options.maxAgeSecs ?? REFRESH_SECS;
    if (maxAgeSecs > 0 && Date.now() - snapshotStat.mtimeMs > maxAgeSecs * 1000) {
      return null;
    }

    const registryPath = (options.path || "").trim();
    if (registryPath && fs.existsSync(registryPath)) {
      const registryStat = await stat(registryPath);
      if (registryStat.mtimeMs > snapshotStat.mtimeMs) {
        return null;
      }
    }

    const raw = await readFile(snapshotFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<EcoIndexSnapshot>;
    if (
      parsed.version !== SNAPSHOT_VERSION ||
      typeof parsed.saved_at_ms !== "number" ||
      !Array.isArray(parsed.registry) ||
      !Array.isArray(parsed.cards) ||
      !Array.isArray(parsed.symbols) ||
      !Array.isArray(parsed.edges) ||
      !Array.isArray(parsed.sources)
    ) {
      return null;
    }

    return {
      version: SNAPSHOT_VERSION,
      saved_at_ms: parsed.saved_at_ms,
      registry: parsed.registry,
      cards: parsed.cards,
      symbols: parsed.symbols,
      edges: parsed.edges,
      sources: parsed.sources,
    };
  } catch (error) {
    console.error("[loader] Failed to load eco-index snapshot:", error);
    return null;
  }
}

export async function saveIndexSnapshot(
  snapshot: EcoIndexSnapshot,
  options: { url?: string; path?: string } = {}
): Promise<void> {
  const snapshotFile = getSnapshotPath(options);
  if (!snapshotFile) return;

  await mkdir(join(CACHE_DIR, "snapshots"), { recursive: true });
  await writeFile(
    snapshotFile,
    JSON.stringify(
      {
        ...snapshot,
        version: SNAPSHOT_VERSION,
      },
      null,
      2
    )
  );
}

async function shouldRefreshTgz(tgzPath: string, force: boolean): Promise<boolean> {
  if (force) return true;
  if (!fs.existsSync(tgzPath)) return true;

  try {
    const st = await stat(tgzPath);
    return Date.now() - st.mtimeMs > REFRESH_SECS * 1000;
  } catch {
    return true;
  }
}

function getSnapshotPath(options: { url?: string; path?: string }): string {
  const key = snapshotKey(options);
  if (!key) return "";
  return join(CACHE_DIR, "snapshots", `${key}.json`);
}

function snapshotKey(options: { url?: string; path?: string }): string {
  const registryPath = (options.path || "").trim();
  const registryUrl = (options.url || "").trim();
  const locator = registryPath ? `path:${registryPath}` : registryUrl ? `url:${registryUrl}` : "";
  if (!locator) return "";
  return createHash("sha1").update(locator).digest("hex");
}

async function downloadAtlasPack(entry: RegistryEntry, destPath: string): Promise<void> {
  const directUrl = (entry.atlas_asset_url || entry.atlas_url || "").trim();
  if (directUrl) {
    await downloadToFile(
      directUrl,
      destPath,
      GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}
    );
    return;
  }

  const repo = (entry.repo || "").trim();
  if (!repo.includes("/")) {
    throw new Error(
      `Registry entry missing atlas URL and valid repo (org/repo): ${JSON.stringify(entry)}`
    );
  }

  const [owner, name] = repo.split("/");
  const tag = (entry.release_tag || DEFAULT_RELEASE_TAG).trim();
  const assetName = (entry.asset || DEFAULT_ASSET_NAME).trim();

  if (GITHUB_TOKEN) {
    const releaseRes = await fetchWithRetry(
      `https://api.github.com/repos/${owner}/${name}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!releaseRes.ok) {
      throw new Error(
        `Failed to resolve release tag ${tag} for ${repo} (${releaseRes.status})`
      );
    }

    const releaseJson = (await releaseRes.json()) as {
      assets?: Array<{ id: number; name: string }>;
    };

    const asset = (releaseJson.assets || []).find((a) => a.name === assetName);
    if (!asset) {
      throw new Error(`Release ${tag} in ${repo} is missing asset ${assetName}`);
    }

    await downloadToFile(
      `https://api.github.com/repos/${owner}/${name}/releases/assets/${asset.id}`,
      destPath,
      {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/octet-stream",
      }
    );
    return;
  }

  const publicUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(
    tag
  )}/${encodeURIComponent(assetName)}`;
  await downloadToFile(publicUrl, destPath);
}

async function downloadToFile(
  url: string,
  destPath: string,
  headers: Record<string, string> = {}
): Promise<void> {
  const res = await fetchWithRetry(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (${res.status})`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, bytes);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempt = 1
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (
      (response.status >= 500 || response.status === 429) &&
      attempt < MAX_RETRIES
    ) {
      const delay = RETRY_DELAY_MS * attempt;
      console.error(
        `[loader] HTTP ${response.status} for ${url}; retry ${attempt}/${MAX_RETRIES} in ${delay}ms`
      );
      await sleep(delay);
      return fetchWithRetry(url, init, attempt + 1);
    }

    return response;
  } catch (err: unknown) {
    clearTimeout(timer);

    const isTimeout = err instanceof Error && err.name === "AbortError";
    const isTransient = isTimeout || isNetworkError(err);

    if (isTransient && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * attempt;
      console.error(
        `[loader] transient fetch error for ${url}; retry ${attempt}/${MAX_RETRIES} in ${delay}ms`
      );
      await sleep(delay);
      return fetchWithRetry(url, init, attempt + 1);
    }

    throw err;
  }
}

type RawGithubUrlParts = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
};

async function resolveRegistryUrl(url: string): Promise<string> {
  const raw = parseRawGithubUrl(url);
  if (!raw) return url;
  if (isLikelyCommitSha(raw.ref)) return url;

  const sha = await resolveGitRefToSha(raw.owner, raw.repo, raw.ref);
  if (!sha) return url;

  const pinned = `https://raw.githubusercontent.com/${raw.owner}/${raw.repo}/${sha}/${raw.path}`;
  console.error(
    `[loader] Resolved registry URL ref ${raw.owner}/${raw.repo}@${raw.ref} -> ${sha.slice(0, 12)}`
  );
  return pinned;
}

function parseRawGithubUrl(url: string): RawGithubUrlParts | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "raw.githubusercontent.com") return null;

    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length < 4) return null;

    const [owner, repo, ref, ...rest] = seg;
    if (!owner || !repo || !ref || rest.length === 0) return null;

    return {
      owner,
      repo,
      ref,
      path: rest.join("/"),
    };
  } catch {
    return null;
  }
}

function isLikelyCommitSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

async function resolveGitRefToSha(
  owner: string,
  repo: string,
  ref: string
): Promise<string | null> {
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(
    ref
  )}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetchWithRetry(endpoint, { headers });
  if (!res.ok) {
    console.error(
      `[loader] Unable to resolve ${owner}/${repo}@${ref} to commit SHA (${res.status}); using original URL`
    );
    return null;
  }

  const json = (await res.json()) as { sha?: unknown };
  const sha = typeof json.sha === "string" ? json.sha.trim() : "";
  return isLikelyCommitSha(sha) ? sha : null;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].some((code) =>
    err.message.includes(code)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repoSlug(repo: string): string {
  return String(repo || "unknown").replaceAll("/", "__");
}

function normalizeRegistryEntry(entry: RegistryEntry): RegistryEntry {
  return {
    ...entry,
    release_tag: entry.release_tag || DEFAULT_RELEASE_TAG,
    asset: entry.asset || DEFAULT_ASSET_NAME,
  };
}

async function safeReadJson(filePath: string): Promise<unknown | null> {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!fs.existsSync(filePath)) return [];

  const out: T[] = [];
  const raw = await readFile(filePath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines but continue loading the pack.
    }
  }
  return out;
}
