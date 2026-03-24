#!/usr/bin/env node
/**
 * discover.mjs — Scan all org repos for .ecosystem.yml and update registry.json
 *
 * Requires:
 *   GH_TOKEN  — PAT with read:org + repo scope
 *   GH_ORG or GH_OWNER — GitHub org/user owner name
 * Optional:
 *   GH_OWNER_KIND — "org" or "user" (auto-detected when omitted)
 */

import fs from "node:fs";

const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || process.env.GH_ORG;
const OWNER_KIND_OVERRIDE = process.env.GH_OWNER_KIND;

if (!TOKEN || !OWNER) {
  console.error("Missing GH_TOKEN and GH_OWNER/GH_ORG");
  process.exit(1);
}

const REGISTRY_PATH = "registry.json";
const DEFAULT_ATLAS_RELEASE_TAG = "eco-atlas";
const DEFAULT_ATLAS_ASSET_NAME  = "atlas-pack.tgz";

async function ghGet(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
  return res.json();
}

async function detectOwnerKind() {
  if (OWNER_KIND_OVERRIDE === "org" || OWNER_KIND_OVERRIDE === "user") {
    return OWNER_KIND_OVERRIDE;
  }

  const org = await ghGet(`/orgs/${OWNER}`);
  if (org) return "org";

  const user = await ghGet(`/users/${OWNER}`);
  if (user) return "user";

  throw new Error(`Could not resolve owner kind for ${OWNER}`);
}

function asBoolean(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return false;
}

function asLanguage(v) {
  const raw = String(v || "").trim().toLowerCase();
  if (raw === "r") return "R";
  if (raw === "python" || raw === "py") return "Python";
  return "";
}

function asStringArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

async function getFileContent(repo, filePath) {
  const data = await ghGet(`/repos/${OWNER}/${repo}/contents/${filePath}`);
  if (!data || data.type !== "file") return null;
  return Buffer.from(data.content, "base64").toString("utf-8");
}

/** Minimal YAML parser for .ecosystem.yml (key: value and lists only) */
function parseEcosystemYml(text) {
  const result = {};
  const lines = text.split("\n");
  let currentKey = null;
  let currentList = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;

    // List item
    if (line.match(/^\s+-\s+/) && currentList !== null) {
      const val = line.replace(/^\s+-\s+/, "").replace(/^['"]|['"]$/g, "").trim();
      result[currentKey].push(val);
      continue;
    }

    currentList = null;

    // key: value or key: [inline, list]
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)?$/);
    if (!m) continue;

    const key = m[1];
    const val = (m[2] || "").trim();
    currentKey = key;

    if (val.startsWith("[")) {
      // Inline array
      const inner = val.replace(/^\[|\]$/g, "");
      result[key] = inner
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else if (val === "" || val === null) {
      result[key] = [];
      currentList = key;
    } else {
      result[key] = val.replace(/^['"]|['"]$/g, "");
    }
  }

  return result;
}

async function getAtlasAssetUrl(repo, releaseTag, assetName) {
  const release = await ghGet(
    `/repos/${OWNER}/${repo}/releases/tags/${encodeURIComponent(releaseTag)}`
  );
  if (!release) return null;

  const asset = (release.assets || []).find((a) => a.name === assetName);
  return asset ? asset.browser_download_url : null;
}

async function validateAtlasUrl(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.ok || res.status === 302;
  } catch {
    return false;
  }
}

async function listOwnerRepos(ownerKind) {
  const repos = [];
  let page = 1;
  while (true) {
    const endpoint =
      ownerKind === "org"
        ? `/orgs/${OWNER}/repos?per_page=100&page=${page}&type=all`
        : `/users/${OWNER}/repos?per_page=100&page=${page}&type=owner`;
    const data = await ghGet(endpoint);
    if (!data || data.length === 0) break;
    repos.push(...data.map((r) => r.name));
    if (data.length < 100) break;
    page++;
  }
  return repos;
}

// --- Main ---

const ownerKind = await detectOwnerKind();
console.error(`[discover] Scanning ${OWNER} (${ownerKind}) for .ecosystem.yml...`);

const existing = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
const existingMap = new Map(existing.map((e) => [e.repo, e]));

const repos = await listOwnerRepos(ownerKind);
console.error(`[discover] Found ${repos.length} repos`);

const updated = [];
let added = 0, unchanged = 0, failed = 0;

for (const repo of repos) {
  const fullName = `${OWNER}/${repo}`;
  try {
    const content = await getFileContent(repo, ".ecosystem.yml");
    if (!content) continue;

    const cfg = parseEcosystemYml(content);
    const ecosystemEnabled = asBoolean(cfg.ecosystem);
    const language = asLanguage(cfg.language);
    if (!ecosystemEnabled || !language) continue;

    const releaseTag = String(cfg.release_tag || DEFAULT_ATLAS_RELEASE_TAG);
    const assetName = String(cfg.asset || DEFAULT_ATLAS_ASSET_NAME);
    const atlasUrl = await getAtlasAssetUrl(repo, releaseTag, assetName);
    const valid    = await validateAtlasUrl(atlasUrl);

    if (!valid && atlasUrl) {
      console.error(`[discover] Warning: atlas URL unreachable for ${fullName}: ${atlasUrl}`);
    }

    const entry = {
      repo: fullName,
      package: cfg.package || repo,
      language,
      release_tag: releaseTag,
      asset: assetName,
      atlas_asset_url: valid ? atlasUrl : "",
      role: cfg.role || null,
      tags: asStringArray(cfg.tags),
      entrypoints: asStringArray(cfg.entrypoints),
      last_updated: new Date().toISOString(),
    };

    updated.push(entry);

    if (existingMap.has(fullName)) {
      unchanged++;
    } else {
      added++;
      console.error(`[discover] + ${fullName} (${entry.package})`);
    }
  } catch (err) {
    console.error(`[discover] Error processing ${fullName}: ${err.message}`);
    // Keep existing entry if present
    if (existingMap.has(fullName)) {
      updated.push(existingMap.get(fullName));
    }
    failed++;
  }
}

// Preserve entries for repos no longer found (may be private/renamed)
for (const [fullName, entry] of existingMap) {
  if (!updated.find((e) => e.repo === fullName)) {
    console.error(`[discover] Keeping existing entry for missing repo: ${fullName}`);
    updated.push(entry);
  }
}

updated.sort((a, b) => a.repo.localeCompare(b.repo));
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(updated, null, 2) + "\n", "utf-8");

console.error(
  `[discover] Done: ${updated.length} total entries (+${added} new, ${unchanged} unchanged, ${failed} errors)`
);
