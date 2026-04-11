import type {
  AtlasPack,
  EdgeRecord,
  EcoIndexSnapshot,
  MicrocardRecord,
  PackageCounts,
  RegistryEntry,
  SearchFilters,
  SearchHit,
  SourceRecord,
  SymbolSearchHit,
  SourceRef,
  SymbolRecord,
} from "./types.js";
import { loadAtlasPack } from "./loader.js";

export class EcoIndex {
  private cards: MicrocardRecord[] = [];
  private symbols: Map<string, SymbolRecord> = new Map();
  private sources: Map<string, SourceRecord> = new Map();
  private edges: EdgeRecord[] = [];
  private registry: RegistryEntry[] = [];
  private packageMeta: Map<string, RegistryEntry> = new Map();
  private packageCounts: Map<string, PackageCounts> = new Map();

  hasData(): boolean {
    return (
      this.packageMeta.size > 0 ||
      this.cards.length > 0 ||
      this.symbols.size > 0 ||
      this.edges.length > 0
    );
  }

  stats(): { packages: number; cards: number; symbols: number; sources: number; edges: number } {
    return {
      packages: this.packageMeta.size,
      cards: this.cards.length,
      symbols: this.symbols.size,
      sources: this.sources.size,
      edges: this.edges.length,
    };
  }

  async loadFromRegistry(
    registry: RegistryEntry[],
    options: { force?: boolean } = {}
  ): Promise<void> {
    const normalizedRegistry = normalizeRegistryEntries(registry);

    const packs = await Promise.allSettled(
      normalizedRegistry.map((entry) => loadAtlasPack(entry, { force: Boolean(options.force) }))
    );

    this.reset(normalizedRegistry);

    for (let i = 0; i < packs.length; i++) {
      const result = packs[i];
      const entry = normalizedRegistry[i];
      const pkg = entry.package || inferPackage(entry);
      this.packageMeta.set(pkg, entry);
      this.packageCounts.set(pkg, {
        cards: 0,
        symbols: 0,
        edges: 0,
        manual_cards: 0,
        generated_cards: 0,
      });

      if (result.status === "rejected") {
        console.error(`[eco-index] Failed to load pack ${entry.repo}:`, result.reason);
        continue;
      }

      this.ingestPack(result.value, entry);
    }

    console.error(
      `[eco-index] Loaded ${this.cards.length} cards, ${this.symbols.size} symbols, ${this.edges.length} edges across ${this.packageMeta.size} packages`
    );
  }

  exportSnapshot(): EcoIndexSnapshot {
    return {
      version: 1,
      saved_at_ms: Date.now(),
      registry: this.registry.map((entry) => ({ ...entry })),
      cards: this.cards.map((card) => ({ ...card, sources: [...card.sources] })),
      symbols: [...this.symbols.values()].map((symbol) => ({ ...symbol })),
      edges: this.edges.map((edge) => ({ ...edge })),
      sources: [...this.sources.values()].map((source) => ({ ...source })),
    };
  }

  loadSnapshot(snapshot: EcoIndexSnapshot): void {
    if (!snapshot || snapshot.version !== 1) {
      throw new Error("Unsupported eco-index snapshot version.");
    }

    const normalizedRegistry = normalizeRegistryEntries(snapshot.registry || []);
    this.reset(normalizedRegistry);

    for (const raw of snapshot.cards || []) {
      const pkg = String(raw.package || "").trim();
      if (!pkg) continue;
      const entry = this.ensurePackageMetadata(
        pkg,
        normalizeLanguage(raw.language || this.packageMeta.get(pkg)?.language)
      );
      const card = normalizeCard(
        raw,
        entry.package || pkg,
        normalizeLanguage(entry.language || raw.language)
      );
      if (!card) continue;
      this.cards.push(card);
    }

    for (const raw of snapshot.symbols || []) {
      const pkg = inferPackageFromSymbol(raw.symbol);
      if (!pkg) continue;
      const entry = this.ensurePackageMetadata(
        pkg,
        normalizeLanguage(raw.language || this.packageMeta.get(pkg)?.language)
      );
      const symbol = normalizeSymbol(
        raw,
        entry.package || pkg,
        normalizeLanguage(entry.language || raw.language)
      );
      if (!symbol) continue;
      this.symbols.set(symbol.symbol, symbol);
    }

    for (const raw of snapshot.edges || []) {
      const pkg = inferPackageFromEdge(raw);
      const entry = pkg
        ? this.ensurePackageMetadata(pkg, normalizeLanguage())
        : null;
      const edge = normalizeEdge(raw, entry?.package || pkg || "unknownpkg");
      if (!edge) continue;
      this.edges.push(edge);
    }

    for (const raw of snapshot.sources || []) {
      const pkg = inferPackageFromSymbol(raw.symbol);
      if (!pkg || !raw.body) continue;
      const entry = this.ensurePackageMetadata(
        pkg,
        normalizeLanguage(raw.language || this.packageMeta.get(pkg)?.language)
      );
      const symbolText = String(raw.symbol);
      const symbol = symbolText.includes("::")
        ? symbolText
        : `${entry.package || pkg}::${symbolText}`;
      this.sources.set(symbol, {
        ...raw,
        symbol,
        language: raw.language || entry.language || "R",
      });
    }

    this.packageCounts = buildPackageCounts(this.cards, this.symbols, this.edges, this.packageMeta);
    console.error(
      `[eco-index] Restored ${this.cards.length} cards, ${this.symbols.size} symbols, ${this.edges.length} edges across ${this.packageMeta.size} packages from snapshot`
    );
  }

  private ingestPack(pack: AtlasPack, entry: RegistryEntry): void {
    const pkg = entry.package || pack.manifest.package || inferPackage(entry);
    const language = entry.language || pack.manifest.language || "R";
    const counts = this.packageCounts.get(pkg) || {
      cards: 0,
      symbols: 0,
      edges: 0,
      manual_cards: 0,
      generated_cards: 0,
    };

    for (const raw of pack.cards || []) {
      const card = normalizeCard(raw, pkg, language);
      if (card) {
        this.cards.push(card);
        counts.cards += 1;
        if (String((card as { kind?: unknown }).kind || "").toLowerCase() === "manual") {
          counts.manual_cards += 1;
        } else {
          counts.generated_cards += 1;
        }
      }
    }

    for (const raw of pack.symbols || []) {
      const symbol = normalizeSymbol(raw, pkg, language);
      if (symbol) {
        this.symbols.set(symbol.symbol, symbol);
        counts.symbols += 1;
      }
    }

    for (const raw of pack.edges || []) {
      const edge = normalizeEdge(raw, pkg);
      if (edge) {
        this.edges.push(edge);
        counts.edges += 1;
      }
    }

    for (const raw of pack.sources || []) {
      if (!raw || !raw.symbol || !raw.body) continue;
      const symbol = String(raw.symbol).includes("::")
        ? String(raw.symbol)
        : `${pkg}::${raw.symbol}`;
      this.sources.set(symbol, {
        ...raw,
        symbol,
        language: raw.language || language,
      });
    }

    this.packageCounts.set(pkg, counts);
  }

  private reset(registry: RegistryEntry[]): void {
    this.cards = [];
    this.symbols = new Map();
    this.sources = new Map();
    this.edges = [];
    this.registry = [...registry];
    this.packageMeta = new Map(
      registry.map((entry) => {
        const pkg = entry.package || inferPackage(entry);
        return [pkg, entry];
      })
    );
    this.packageCounts = buildPackageCounts(this.cards, this.symbols, this.edges, this.packageMeta);
  }

  private ensurePackageMetadata(
    pkg: string,
    language: "R" | "Python" = "R"
  ): RegistryEntry {
    const existing = this.packageMeta.get(pkg);
    if (existing) return existing;

    const placeholder: RegistryEntry = {
      repo: pkg,
      package: pkg,
      language,
    };
    this.packageMeta.set(pkg, placeholder);
    this.registry.push(placeholder);
    return placeholder;
  }

  searchCards(
    query: string,
    topK: number = 5,
    filters?: SearchFilters
  ): SearchHit[] {
    const normalizedQuery = normalize(query);
    const tokens = tokenise(normalizedQuery);

    const candidates = this.cards.filter((card) => this.matchesFilters(card, filters));

    const scored = candidates
      .map((card) => {
        const lexScore = lexicalScore(card, normalizedQuery, tokens);
        const score = lexScore + this.entrypointBoost(card);
        return { card, score, lexScore };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  searchSymbols(
    query: string,
    topK: number = 5,
    filters?: SearchFilters
  ): SymbolSearchHit[] {
    const normalizedQuery = normalize(query);
    const tokens = tokenise(normalizedQuery);
    const exactSym = /[A-Za-z][A-Za-z0-9._-]+::[A-Za-z][A-Za-z0-9._-]+/.exec(query)?.[0];
    const exactFn = query.includes("::") ? query.split("::")[1] || "" : query.trim();

    const scored: SymbolSearchHit[] = [];
    for (const symbol of this.symbols.values()) {
      const pkg = symbol.symbol.split("::")[0] || "";
      if (!this.packageMatchesFilters(pkg, filters)) continue;

      const fn = symbol.symbol.split("::")[1] || "";
      const fnNorm = normalize(fn);
      const summary = normalize(symbol.summary || "");
      const tags = normalize((symbol.tags || []).join(" "));

      let score = 0;
      for (const token of tokens) {
        if (fnNorm.includes(token)) score += 8;
        else if (tags.includes(token)) score += 5;
        else if (summary.includes(token)) score += 3;
      }

      if (normalizedQuery && summary.includes(normalizedQuery)) score += 8;
      if (exactSym && symbol.symbol === exactSym) score += 35;
      if (exactFn && fn === exactFn) score += 22;

      if (score > 0) {
        scored.push({ symbol, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  lookupSymbol(symbolQuery: string, limit = 10): {
    exact?: SymbolRecord;
    candidates: SymbolRecord[];
  } {
    const raw = symbolQuery.trim();
    if (!raw) return { candidates: [] };

    const exact = this.symbols.get(raw);
    if (exact) return { exact, candidates: [] };

    const needle = raw.includes("::") ? raw.split("::")[1] || "" : raw;
    const exactFnMatches: SymbolRecord[] = [];

    for (const symbol of this.symbols.values()) {
      const fn = symbol.symbol.split("::")[1] || "";
      if (fn === needle) exactFnMatches.push(symbol);
    }

    if (exactFnMatches.length > 0) {
      return { candidates: exactFnMatches.slice(0, limit) };
    }

    const containsNeedle = needle.toLowerCase();
    const fuzzyMatches: SymbolRecord[] = [];
    for (const symbol of this.symbols.values()) {
      const fn = (symbol.symbol.split("::")[1] || "").toLowerCase();
      if (fn.includes(containsNeedle)) fuzzyMatches.push(symbol);
    }

    return { candidates: fuzzyMatches.slice(0, limit) };
  }

  listPackages(filters?: {
    language?: "R" | "Python";
    tags?: string[];
    role?: string;
  }): RegistryEntry[] {
    let result = this.registry;

    if (filters?.language) {
      result = result.filter((p) => p.language === filters.language);
    }

    if (filters?.role) {
      result = result.filter((p) => p.role === filters.role);
    }

    if (filters?.tags?.length) {
      const required = new Set(filters.tags.map((t) => normalize(t)));
      result = result.filter((p) => {
        const tags = new Set((p.tags || []).map((t) => normalize(t)));
        for (const need of required) {
          if (!tags.has(need)) return false;
        }
        return true;
      });
    }

    return [...result].sort((a, b) => {
      const aPkg = a.package || inferPackage(a);
      const bPkg = b.package || inferPackage(b);
      return aPkg.localeCompare(bPkg);
    });
  }

  packageSummaries(filters?: {
    language?: "R" | "Python";
    tags?: string[];
    role?: string;
  }): Array<
    RegistryEntry & {
      card_count: number;
      symbol_count: number;
      edge_count: number;
      manual_card_count: number;
      generated_card_count: number;
      entrypoint_count: number;
    }
  > {
    const packages = this.listPackages(filters);
    return packages.map((entry) => {
      const pkg = entry.package || inferPackage(entry);
      const counts = this.packageCounts.get(pkg) || {
        cards: 0,
        symbols: 0,
        edges: 0,
        manual_cards: 0,
        generated_cards: 0,
      };
      return {
        ...entry,
        card_count: counts.cards,
        symbol_count: counts.symbols,
        edge_count: counts.edges,
        manual_card_count: counts.manual_cards,
        generated_card_count: counts.generated_cards,
        entrypoint_count: (entry.entrypoints || []).length,
      };
    });
  }

  getPackageMetadata(pkg: string): RegistryEntry | null {
    const hit = this.packageMeta.get(pkg);
    return hit ? { ...hit } : null;
  }

  fallbackHints(
    filters?: SearchFilters,
    limit = 5
  ): {
    packages: Array<{
      package: string;
      role?: string;
      tags?: string[];
      card_count: number;
      symbol_count: number;
    }>;
    entrypoints: string[];
    tags: string[];
  } {
    const packageRows = this.packageSummaries(filters)
      .sort((a, b) => b.card_count - a.card_count)
      .slice(0, limit)
      .map((p) => ({
        package: p.package || inferPackage(p),
        role: p.role,
        tags: p.tags || [],
        card_count: p.card_count,
        symbol_count: p.symbol_count,
      }));

    const entrypoints = dedupe(
      this.packageSummaries(filters).flatMap((p) => p.entrypoints || [])
    ).slice(0, Math.max(limit * 2, 8));

    const tagCounts = new Map<string, number>();
    for (const card of this.cards) {
      if (!this.matchesFilters(card, filters)) continue;
      for (const tag of card.tags || []) {
        const key = normalize(tag);
        if (!key) continue;
        tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
      }
    }

    const tags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(limit * 2, 10))
      .map(([tag]) => tag);

    return { packages: packageRows, entrypoints, tags };
  }

  whereUsed(symbol: string, topK: number = 10): EdgeRecord[] {
    const target = symbol.trim();
    return this.edges
      .filter((edge) => edge.to === target || edge.to_symbol === target)
      .slice(0, topK);
  }

  lookupSource(symbolQuery: string, limit = 10): {
    exact?: SourceRecord;
    candidates: SourceRecord[];
  } {
    const raw = symbolQuery.trim();
    if (!raw) return { candidates: [] };

    // Exact match on fully qualified symbol
    const exact = this.sources.get(raw);
    if (exact) return { exact, candidates: [] };

    // Bare function name — search across all packages
    const needle = raw.includes("::") ? raw.split("::")[1] || "" : raw;
    const exactFnMatches: SourceRecord[] = [];

    for (const source of this.sources.values()) {
      const fn = source.symbol.split("::")[1] || "";
      if (fn === needle) exactFnMatches.push(source);
    }

    if (exactFnMatches.length > 0) {
      return { candidates: exactFnMatches.slice(0, limit) };
    }

    // Fuzzy substring match
    const containsNeedle = needle.toLowerCase();
    const fuzzyMatches: SourceRecord[] = [];
    for (const source of this.sources.values()) {
      const fn = (source.symbol.split("::")[1] || "").toLowerCase();
      if (fn.includes(containsNeedle)) fuzzyMatches.push(source);
    }

    return { candidates: fuzzyMatches.slice(0, limit) };
  }

  private matchesFilters(card: MicrocardRecord, filters?: SearchFilters): boolean {
    if (!filters) return true;

    if (filters.package && card.package !== filters.package) {
      return false;
    }

    if (filters.language && card.language !== filters.language) {
      return false;
    }

    if (filters.role) {
      const role = this.packageMeta.get(card.package)?.role;
      if (role !== filters.role) return false;
    }

    if (filters.tags?.length) {
      const cardTags = new Set((card.tags || []).map((t) => normalize(t)));
      for (const tag of filters.tags) {
        if (!cardTags.has(normalize(tag))) return false;
      }
    }

    return true;
  }

  private packageMatchesFilters(pkg: string, filters?: SearchFilters): boolean {
    if (!filters) return true;
    const meta = this.packageMeta.get(pkg);
    if (!meta) return false;

    if (filters.package && pkg !== filters.package) return false;
    if (filters.language && meta.language !== filters.language) return false;
    if (filters.role && meta.role !== filters.role) return false;

    if (filters.tags?.length) {
      const have = new Set((meta.tags || []).map((t) => normalize(t)));
      for (const tag of filters.tags) {
        if (!have.has(normalize(tag))) return false;
      }
    }

    return true;
  }

  private entrypointBoost(card: MicrocardRecord): number {
    const entrypoints = this.packageMeta.get(card.package)?.entrypoints || [];
    if (entrypoints.length === 0) return 0;

    const set = new Set(entrypoints);
    for (const symbol of card.symbols) {
      if (set.has(symbol)) return 3;
    }
    return 0;
  }
}

function normalizeCard(
  raw: MicrocardRecord,
  defaultPackage: string,
  defaultLanguage: "R" | "Python"
): MicrocardRecord | null {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.id || !raw.q || !raw.a || !raw.recipe) return null;

  const lines = normalizeSources(raw.sources);
  if (lines.length === 0) return null;

  const pkg = String(raw.package || defaultPackage);
  const language = raw.language || defaultLanguage;
  const kind = normalizeCardKind(raw, lines);

  return {
    ...raw,
    id: String(raw.id),
    package: pkg,
    language,
    kind,
    q: String(raw.q),
    a: String(raw.a),
    recipe: String(raw.recipe),
    symbols: Array.isArray(raw.symbols) ? raw.symbols.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    sources: lines,
  };
}

function normalizeRegistryEntries(registry: RegistryEntry[]): RegistryEntry[] {
  return registry.map((entry) => {
    const pkg = inferPackage(entry);
    return {
      ...entry,
      package: pkg,
    };
  });
}

function normalizeCardKind(
  raw: MicrocardRecord,
  sources: SourceRef[]
): "manual" | "generated" | "fallback" {
  const explicit = String(raw.kind || "")
    .toLowerCase()
    .trim();
  if (explicit === "manual" || explicit === "generated" || explicit === "fallback") {
    return explicit;
  }

  const id = String(raw.id || "").toLowerCase();
  if (id.startsWith("manual#")) return "manual";
  if (id.startsWith("fallback#")) return "fallback";

  const sourcePaths = sources.map((s) => String(s.path || "").toLowerCase());
  if (sourcePaths.some((p) => p.endsWith("manual_cards.jsonl"))) return "manual";
  if (sourcePaths.some((p) => p.endsWith(".ecosystem.yml"))) return "fallback";

  return "generated";
}

function normalizeSymbol(
  raw: SymbolRecord,
  defaultPackage: string,
  defaultLanguage: "R" | "Python"
): SymbolRecord | null {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.symbol || !raw.signature) return null;

  const symbolText = String(raw.symbol);
  const symbol = symbolText.includes("::")
    ? symbolText
    : `${defaultPackage}::${symbolText}`;

  return {
    ...raw,
    symbol,
    language: raw.language || defaultLanguage,
    summary: raw.summary || null,
  };
}

function normalizeEdge(raw: EdgeRecord, defaultPackage: string): EdgeRecord | null {
  if (!raw || typeof raw !== "object") return null;

  if (raw.to_symbol && !raw.to) {
    return {
      from: raw.from_package
        ? `${raw.from_package}::unknown`
        : `${defaultPackage}::unknown`,
      to: String(raw.to_symbol),
      source: {
        path: String(raw.via_snippet_id || "unknown"),
        lines: [1, 1],
      },
      kind: "uses",
      ...raw,
    };
  }

  if (!raw.from || !raw.to) return null;

  return {
    ...raw,
    from: String(raw.from),
    to: String(raw.to),
    source: normalizeSource(raw.source),
    kind: raw.kind || "call",
  };
}

function normalizeSource(source: unknown): SourceRef {
  if (!source || typeof source !== "object") {
    return { path: "unknown", lines: [1, 1] };
  }

  const src = source as { path?: unknown; lines?: unknown };
  const path = typeof src.path === "string" && src.path.length > 0 ? src.path : "unknown";

  if (Array.isArray(src.lines) && src.lines.length >= 2) {
    const start = Number(src.lines[0]);
    const end = Number(src.lines[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return { path, lines: [start, end] };
    }
  }

  return { path, lines: [1, 1] };
}

function normalizeLanguage(value?: unknown): "R" | "Python" {
  return value === "Python" ? "Python" : "R";
}

function inferPackageFromSymbol(symbol: unknown): string {
  const text = String(symbol || "").trim();
  if (!text) return "";
  const [pkg] = text.split("::");
  return pkg || "";
}

function inferPackageFromEdge(edge: EdgeRecord): string {
  const from = String(edge.from || "").trim();
  if (from.includes("::")) return from.split("::")[0] || "";
  const legacy = String(edge.from_package || "").trim();
  return legacy || "";
}

function buildPackageCounts(
  cards: MicrocardRecord[],
  symbols: Map<string, SymbolRecord>,
  edges: EdgeRecord[],
  packageMeta: Map<string, RegistryEntry>
): Map<string, PackageCounts> {
  const counts = new Map<string, PackageCounts>();

  const ensureCounts = (pkg: string): PackageCounts => {
    const key = pkg.trim();
    if (!counts.has(key)) {
      counts.set(key, {
        cards: 0,
        symbols: 0,
        edges: 0,
        manual_cards: 0,
        generated_cards: 0,
      });
    }
    return counts.get(key)!;
  };

  for (const pkg of packageMeta.keys()) {
    ensureCounts(pkg);
  }

  for (const card of cards) {
    const pkgCounts = ensureCounts(card.package);
    pkgCounts.cards += 1;
    if (String(card.kind || "").toLowerCase() === "manual") {
      pkgCounts.manual_cards += 1;
    } else {
      pkgCounts.generated_cards += 1;
    }
  }

  for (const symbol of symbols.values()) {
    const pkg = inferPackageFromSymbol(symbol.symbol);
    if (!pkg) continue;
    ensureCounts(pkg).symbols += 1;
  }

  for (const edge of edges) {
    const pkg = inferPackageFromEdge(edge);
    if (!pkg) continue;
    ensureCounts(pkg).edges += 1;
  }

  return counts;
}

function normalizeSources(sources: unknown): SourceRef[] {
  if (!Array.isArray(sources)) return [];

  const normalized: SourceRef[] = [];
  for (const source of sources) {
    const item = normalizeSource(source);
    normalized.push(item);
  }
  return normalized;
}

function inferPackage(entry: RegistryEntry): string {
  if (entry.package && entry.package.trim()) return entry.package.trim();
  const parts = String(entry.repo || "").split("/");
  return parts[1] || parts[0] || "unknownpkg";
}

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9:_\-\s.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenise(text: string): string[] {
  const raw = normalize(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return expandTokens(raw);
}

function lexicalScore(card: MicrocardRecord, query: string, tokens: string[]): number {
  const q = normalize(card.q);
  const a = normalize(card.a);
  const meta = normalize(`${(card.tags || []).join(" ")} ${card.symbols.join(" ")}`);

  let score = 0;

  for (const token of tokens) {
    if (q.includes(token)) score += 6;
    else if (meta.includes(token)) score += 4;
    else if (a.includes(token)) score += 2;
  }

  if (query && q.includes(query)) score += 8;

  const exactSym = /[A-Za-z][A-Za-z0-9._-]+::[A-Za-z][A-Za-z0-9._-]+/.exec(query)?.[0];
  if (exactSym && card.symbols.includes(exactSym)) {
    score += 25;
  }

  return score;
}

function expandTokens(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const token of tokens) {
    out.add(token);

    const stem = stemToken(token);
    if (stem) out.add(stem);

    const synonyms = TOKEN_SYNONYMS[token];
    if (synonyms) {
      for (const syn of synonyms) out.add(syn);
    }
  }
  return [...out];
}

function stemToken(token: string): string {
  let t = token;
  if (t.endsWith("ization")) t = t.slice(0, -7);
  else if (t.endsWith("ation")) t = t.slice(0, -5);
  else if (t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.endsWith("es")) t = t.slice(0, -2);
  else if (t.endsWith("s") && t.length > 3) t = t.slice(0, -1);
  return t;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

const STOPWORDS = new Set([
  "how",
  "do",
  "i",
  "a",
  "an",
  "the",
  "is",
  "to",
  "in",
  "of",
  "for",
  "with",
  "and",
  "using",
  "use",
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  nifti: ["nii", "volume", "image"],
  nii: ["nifti", "volume", "image"],
  load: ["read", "import", "open"],
  read: ["load", "import"],
  roi: ["region", "parcel", "mask"],
  fmri: ["bold", "timeseries", "time-series"],
  covariance: ["cov", "covar", "correlation"],
  regularization: ["regularize", "shrinkage", "ridge", "lasso"],
  shrinkage: ["regularization", "ridge", "penalty"],
  parcellation: ["parcel", "cluster", "atlas"],
};
