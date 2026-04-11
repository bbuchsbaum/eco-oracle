#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EcoIndex } from "./eco-index.js";
import { loadIndexSnapshot, loadRegistry, saveIndexSnapshot } from "./loader.js";
import {
  buildPackagePayload,
  buildRegistryPackageRows,
  type PackageFilters,
} from "./package-listing.js";
import type { RegistryEntry } from "./types.js";

const DEFAULT_LOCAL_REGISTRY = path.resolve(
  process.cwd(),
  "eco-registry",
  "registry.json"
);

const REGISTRY_URL = (process.env.ECO_REGISTRY_URL || "").trim();
const REGISTRY_PATH = (() => {
  const explicitPath = (process.env.ECO_REGISTRY_PATH || "").trim();
  if (explicitPath) return explicitPath;
  // If URL is explicitly provided, prefer URL over local fallback path.
  if (REGISTRY_URL) return "";
  return fs.existsSync(DEFAULT_LOCAL_REGISTRY) ? DEFAULT_LOCAL_REGISTRY : "";
})();

const LEGACY_INTERVAL_MS = parsePositiveInt(process.env.ECO_REFRESH_INTERVAL_MS, 0);
const REFRESH_SECS =
  parsePositiveInt(process.env.ECO_REFRESH_SECS, 0) ||
  (LEGACY_INTERVAL_MS > 0 ? Math.max(1, Math.floor(LEGACY_INTERVAL_MS / 1000)) : 600);

let lastRefreshMs = 0;
let refreshInFlight: Promise<void> | null = null;
let lastRegistryRefreshMs = 0;
let registryRefreshInFlight: Promise<RegistryEntry[]> | null = null;
let registryCache: RegistryEntry[] = [];

const index = new EcoIndex();

const server = new McpServer({ name: "eco-oracle", version: "0.2.0" });

async function ensureFresh(force = false): Promise<void> {
  const now = Date.now();
  if (!force && index.hasData() && now - lastRefreshMs < REFRESH_SECS * 1000) {
    return;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      if (!force && !index.hasData() && (await hydrateIndexFromSnapshot())) {
        return;
      }

      const registry = await ensureRegistryFresh(force);

      await index.loadFromRegistry(registry, { force });
      const snapshot = index.exportSnapshot();
      lastRefreshMs = snapshot.saved_at_ms;
      setRegistryCache(snapshot.registry, snapshot.saved_at_ms);
      try {
        await saveIndexSnapshot(snapshot, {
          url: REGISTRY_URL,
          path: REGISTRY_PATH,
        });
      } catch (error) {
        console.error("[eco-oracle] Failed to persist snapshot:", error);
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  await refreshInFlight;
}

async function ensureRegistryFresh(force = false): Promise<RegistryEntry[]> {
  const now = Date.now();
  if (!force && registryCache.length > 0 && now - lastRegistryRefreshMs < REFRESH_SECS * 1000) {
    return registryCache;
  }

  if (!registryRefreshInFlight) {
    registryRefreshInFlight = (async () => {
      const registry = await loadRegistry({
        url: REGISTRY_URL,
        path: REGISTRY_PATH,
      });
      setRegistryCache(registry);
      return registryCache;
    })().finally(() => {
      registryRefreshInFlight = null;
    });
  }

  return registryRefreshInFlight;
}

async function hydrateIndexFromSnapshot(): Promise<boolean> {
  if (index.hasData()) return true;

  const snapshot = await loadIndexSnapshot({
    url: REGISTRY_URL,
    path: REGISTRY_PATH,
    maxAgeSecs: REFRESH_SECS,
  });

  if (!snapshot) return false;

  index.loadSnapshot(snapshot);
  lastRefreshMs = snapshot.saved_at_ms;
  setRegistryCache(snapshot.registry, snapshot.saved_at_ms);
  return true;
}

function setRegistryCache(registry: RegistryEntry[], refreshedAtMs = Date.now()): void {
  registryCache = registry.map((entry) => ({ ...entry }));
  lastRegistryRefreshMs = refreshedAtMs;
}

server.registerTool(
  "eco_howto",
  {
    description:
      "Search ecosystem microcards and return compact how-to answers + short code recipes.",
    inputSchema: {
      query: z.string().min(3).describe("Natural language query, ideally phrased as 'How do I ...?'") ,
      top_k: z.number().int().min(1).max(10).optional().describe("Number of results (default 5)"),
      package: z.string().optional().describe("Optional package filter (e.g. 'mypkg')"),
      language: z.enum(["R", "Python"]).optional().describe("Optional language filter"),
      tags: z.array(z.string()).optional().describe("Optional tags filter (must all match)"),
      role: z.string().optional().describe("Optional package role filter (e.g. ingest, model)"),
      filters: z
        .object({
          package: z.string().optional(),
          language: z.enum(["R", "Python"]).optional(),
          tags: z.array(z.string()).optional(),
          role: z.string().optional(),
        })
        .optional()
        .describe("Backward-compatible filter object"),
      include_symbol_fallback: z
        .boolean()
        .optional()
        .describe("When true (default), include symbol-based candidates when card results are sparse"),
      refresh: z.boolean().optional().describe("Force refresh registry + packs before searching"),
    },
  },
  async ({
    query,
    top_k,
    package: pkg,
    language,
    tags,
    role,
    filters,
    include_symbol_fallback,
    refresh,
  }) => {
    await ensureFresh(Boolean(refresh));
    const requestedTopK = top_k ?? 5;

    const mergedFilters = {
      package: pkg ?? filters?.package,
      language: language ?? filters?.language,
      tags: tags ?? filters?.tags,
      role: role ?? filters?.role,
    };

    let hits = index.searchCards(query, requestedTopK, mergedFilters);
    let packageRouting: {
      attempted: boolean;
      candidates: Array<{ package: string; score: number; reasons: string[] }>;
      selected_package: string | null;
    } | null = null;

    if (hits.length === 0 && !mergedFilters.package) {
      const routeCandidates = rankPackageRoutes(
        query,
        index.listPackages({
          language: mergedFilters.language,
          tags: mergedFilters.tags,
          role: mergedFilters.role,
        }),
        3
      );

      packageRouting = {
        attempted: true,
        candidates: routeCandidates,
        selected_package: null,
      };

      for (const candidate of routeCandidates) {
        const routedHits = index.searchCards(query, requestedTopK, {
          ...mergedFilters,
          package: candidate.package,
        });
        if (routedHits.length > 0) {
          hits = routedHits;
          packageRouting.selected_package = candidate.package;
          break;
        }
      }
    }

    const symbolFilters =
      packageRouting?.selected_package && !mergedFilters.package
        ? { ...mergedFilters, package: packageRouting.selected_package }
        : mergedFilters;
    const shouldFallback = include_symbol_fallback !== false;
    const symbolCandidates =
      shouldFallback && hits.length < 2
        ? index.searchSymbols(query, Math.max(3, requestedTopK), symbolFilters)
        : [];
    const hints = hits.length === 0 ? index.fallbackHints(symbolFilters, 5) : null;

    const strategy = (() => {
      if (hits.length > 0) {
        if (packageRouting?.selected_package) {
          return symbolCandidates.length > 0
            ? "card_via_package_route_plus_symbol_fallback"
            : "card_via_package_route";
        }
        return symbolCandidates.length > 0 ? "card_plus_symbol_fallback" : "card";
      }
      return symbolCandidates.length > 0 ? "symbol_fallback" : "no_match";
    })();

    const payload = {
      query,
      strategy,
      results: hits.map((hit) => {
        const cardKind = String((hit.card as { kind?: unknown }).kind || "generated").toLowerCase();
        return {
          id: hit.card.id,
          package: hit.card.package,
          language: hit.card.language,
          q: hit.card.q,
          a: hit.card.a,
          recipe: hit.card.recipe,
          tags: hit.card.tags || [],
          symbols: hit.card.symbols,
          sources: hit.card.sources,
          kind: cardKind,
          provenance: cardKind === "manual" || cardKind === "fallback" ? cardKind : "generated",
          package_meta: sanitizePackageMeta(index.getPackageMetadata(hit.card.package)),
          score: hit.score,
          lex_score: hit.lexScore,
        };
      }),
      symbol_candidates: symbolCandidates.map((hit) => ({
        symbol: hit.symbol.symbol,
        type: hit.symbol.type,
        signature: hit.symbol.signature,
        summary: hit.symbol.summary || null,
        source: hit.symbol.source || null,
        score: hit.score,
      })),
      package_routing: packageRouting,
      diagnostics: {
        filters: mergedFilters,
        result_counts: {
          cards: hits.length,
          manual_cards: countManualCards(hits),
          generated_cards: hits.length - countManualCards(hits),
          symbol_candidates: symbolCandidates.length,
        },
        metadata_fields: ["role", "tags", "entrypoints"],
      },
      suggestions: hints
        ? {
            packages: hints.packages,
            entrypoints: hints.entrypoints,
            tags: hints.tags,
          }
        : null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

server.registerTool(
  "eco_symbol",
  {
    description:
      "Lookup compact symbol cards (exports/signatures). Accepts pkg::fn or bare fn for candidate lookup.",
    inputSchema: {
      symbol: z.string().min(1).describe("Symbol like 'pkg::fn' or just 'fn'"),
      refresh: z.boolean().optional().describe("Force refresh registry + packs before lookup"),
    },
  },
  async ({ symbol, refresh }) => {
    await ensureFresh(Boolean(refresh));

    const found = index.lookupSymbol(symbol, 10);

    const payload = found.exact
      ? { query: symbol, exact: true, result: found.exact }
      : { query: symbol, exact: false, candidates: found.candidates };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

server.registerTool(
  "eco_packages",
  {
    description:
      "List packages in the ecosystem and basic metadata (language/role/tags/entrypoints).",
    inputSchema: {
      language: z.enum(["R", "Python"]).optional(),
      tags: z.array(z.string()).optional(),
      role: z.string().optional(),
      refresh: z.boolean().optional().describe("Force refresh registry + packs before listing"),
    },
  },
  async ({ language, tags, role, refresh }) => {
    const filters: PackageFilters = { language, tags, role };

    let payload;
    if (refresh) {
      await ensureFresh(true);
      payload = buildPackagePayload(index.packageSummaries(filters), filters, true);
    } else {
      await hydrateIndexFromSnapshot();
      if (index.hasData()) {
        payload = buildPackagePayload(index.packageSummaries(filters), filters, true);
      } else {
        const registry = await ensureRegistryFresh(false);
        payload = buildPackagePayload(buildRegistryPackageRows(registry, filters), filters, false);
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

server.registerTool(
  "eco_where_used",
  {
    description:
      "Find where a symbol (pkg::fn) is used across packages, returning source pointers.",
    inputSchema: {
      symbol: z.string().min(1).describe("Symbol in pkg::fn format"),
      top_k: z.number().int().min(1).max(50).optional().describe("Number of results (default 10)"),
      refresh: z.boolean().optional().describe("Force refresh registry + packs before searching"),
    },
  },
  async ({ symbol, top_k, refresh }) => {
    await ensureFresh(Boolean(refresh));

    const edges = index.whereUsed(symbol, top_k ?? 10);

    const payload = {
      query: symbol,
      results: edges.map((edge) => ({
        from: edge.from ?? (edge.from_package ? `${edge.from_package}::unknown` : "unknown::unknown"),
        to: edge.to ?? edge.to_symbol ?? "unknown::unknown",
        kind: edge.kind ?? "uses",
        source: edge.source ?? {
          path: edge.via_snippet_id || "unknown",
          lines: [1, 1],
        },
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

server.registerTool(
  "eco_source",
  {
    description:
      "Retrieve the full source code of an exported function. Returns the function body, file location, and internal calls made within it. Use this when you need to understand HOW a function works, not just its signature.",
    inputSchema: {
      symbol: z
        .string()
        .min(1)
        .describe("Symbol like 'pkg::fn' or just 'fn' for fuzzy lookup"),
      refresh: z.boolean().optional().describe("Force refresh registry + packs before lookup"),
    },
  },
  async ({ symbol, refresh }) => {
    await ensureFresh(Boolean(refresh));

    const found = index.lookupSource(symbol, 10);

    if (found.exact) {
      const symRecord = index.lookupSymbol(symbol, 1);
      const payload = {
        query: symbol,
        exact: true,
        result: {
          symbol: found.exact.symbol,
          language: found.exact.language || "R",
          body: found.exact.body,
          source: found.exact.source || null,
          internal_calls: found.exact.internal_calls || [],
          signature: symRecord.exact?.signature || null,
          summary: symRecord.exact?.summary || null,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    }

    const payload = {
      query: symbol,
      exact: false,
      candidates: found.candidates.map((src) => ({
        symbol: src.symbol,
        language: src.language || "R",
        body: src.body,
        source: src.source || null,
        internal_calls: src.internal_calls || [],
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

server.registerTool(
  "eco_refresh",
  {
    description: "Force refresh registry + atlas packs now.",
    inputSchema: {},
  },
  async () => {
    await ensureFresh(true);

    const payload = {
      ok: true,
      refreshed_at: new Date().toISOString(),
      stats: index.stats(),
      registry_source: REGISTRY_PATH
        ? { type: "path", value: REGISTRY_PATH }
        : { type: "url", value: REGISTRY_URL },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  }
);

async function main() {
  try {
    if (!(await hydrateIndexFromSnapshot())) {
      await ensureRegistryFresh(false);
    }
  } catch (err) {
    console.error(
      "[eco-oracle] Startup warmup failed (server will still run and retry on tool call):",
      err
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[eco-oracle] MCP server running on stdio");

  if (!index.hasData()) {
    void ensureFresh(false).catch((err) => {
      console.error("[eco-oracle] Background refresh failed:", err);
    });
  }
}

main().catch((err) => {
  console.error("[eco-oracle] Fatal:", err);
  process.exit(1);
});

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function countManualCards(
  hits: Array<{ card: Record<string, unknown> }>
): number {
  let n = 0;
  for (const hit of hits) {
    if (String(hit.card.kind || "").toLowerCase() === "manual") n += 1;
  }
  return n;
}

function sanitizePackageMeta(
  meta: {
    package?: string;
    role?: string;
    tags?: string[];
    entrypoints?: string[];
  } | null
): {
  package: string | null;
  role: string | null;
  tags: string[];
  entrypoints: string[];
} {
  if (!meta) {
    return {
      package: null,
      role: null,
      tags: [],
      entrypoints: [],
    };
  }

  return {
    package: meta.package || null,
    role: meta.role || null,
    tags: meta.tags || [],
    entrypoints: meta.entrypoints || [],
  };
}

type RouteCandidate = {
  package: string;
  score: number;
  reasons: string[];
};

function rankPackageRoutes(
  query: string,
  packages: Array<{
    package?: string;
    repo: string;
    role?: string;
    tags?: string[];
    entrypoints?: string[];
  }>,
  limit: number
): RouteCandidate[] {
  const queryNorm = normalizeRouteText(query);
  const tokens = tokeniseRouteText(queryNorm);
  if (tokens.length === 0) return [];

  const scored: RouteCandidate[] = [];

  for (const entry of packages) {
    const pkg = String(entry.package || inferPackageFromRepo(entry.repo));
    if (!pkg) continue;

    const pkgNorm = normalizeRouteText(pkg);
    const repoNorm = normalizeRouteText(entry.repo || "");
    const roleNorm = normalizeRouteText(entry.role || "");
    const tagNorm = (entry.tags || []).map((t) => normalizeRouteText(String(t)));
    const epNorm = (entry.entrypoints || []).map((ep) => normalizeRouteText(String(ep)));
    const epFnNorm = (entry.entrypoints || []).map((ep) =>
      normalizeRouteText(extractFnName(String(ep)))
    );

    let score = 0;
    const reasons = new Set<string>();

    for (const token of tokens) {
      if (pkgNorm.includes(token)) {
        score += 14;
        reasons.add("package");
      }
      if (tagNorm.some((t) => t.includes(token))) {
        score += 10;
        reasons.add("tags");
      }
      if (epNorm.some((e) => e.includes(token)) || epFnNorm.some((fn) => fn.includes(token))) {
        score += 10;
        reasons.add("entrypoints");
      }
      if (roleNorm.includes(token)) {
        score += 7;
        reasons.add("role");
      }
      if (repoNorm.includes(token)) {
        score += 3;
        reasons.add("repo");
      }
    }

    if (queryNorm && epNorm.some((e) => e.includes(queryNorm))) {
      score += 8;
      reasons.add("entrypoints");
    }

    if (score > 0) {
      scored.push({
        package: pkg,
        score,
        reasons: [...reasons],
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.package.localeCompare(b.package);
  });

  return scored.slice(0, Math.max(1, limit));
}

function normalizeRouteText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9:_\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokeniseRouteText(text: string): string[] {
  return normalizeRouteText(text)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function inferPackageFromRepo(repo: string): string {
  const parts = String(repo || "").split("/");
  return parts[parts.length - 1] || "";
}

function extractFnName(symbol: string): string {
  const parts = String(symbol || "").split("::");
  return parts.length > 1 ? parts[1] : parts[0];
}
