export interface SourceRef {
  path: string;
  lines: [number, number];
}

export interface MicrocardRecord {
  id: string;
  package: string;
  language: "R" | "Python";
  kind?: "manual" | "generated" | "fallback";
  q: string;
  a: string;
  recipe: string;
  symbols: string[];
  tags?: string[];
  sources: SourceRef[];
  [key: string]: unknown;
}

export interface SymbolRecord {
  symbol: string;
  language?: "R" | "Python";
  type: "function" | "class" | "data" | "method" | "generic";
  signature: string;
  summary?: string | null;
  source?: SourceRef;
  tags?: string[];
  examples?: string;
  [key: string]: unknown;
}

export interface SourceRecord {
  symbol: string;
  language?: "R" | "Python";
  body: string;
  source?: SourceRef;
  internal_calls?: string[];
  [key: string]: unknown;
}

export interface EdgeRecord {
  // Canonical edge shape
  from?: string;
  to?: string;
  source?: SourceRef;
  kind?: "call" | "import" | "inherit" | "uses";

  // Legacy shape emitted by older extractors
  from_package?: string;
  to_symbol?: string;
  to_package?: string;
  via_snippet_id?: string;

  [key: string]: unknown;
}

export interface AtlasManifest {
  package?: string;
  version?: string;
  commit_sha?: string;
  build_timestamp?: string;
  language?: "R" | "Python";
  role?: string;
  tags?: string[];
  entrypoints?: string[];
  card_count?: number;
  symbol_count?: number;

  // Legacy field names
  commit?: string;
  built_at_utc?: string;

  [key: string]: unknown;
}

export interface RegistryEntry {
  repo: string;
  package?: string;
  language?: "R" | "Python";

  // Direct URL forms
  atlas_asset_url?: string;
  atlas_url?: string;

  // GitHub release resolution forms
  release_tag?: string;
  asset?: string;

  role?: string;
  tags?: string[];
  entrypoints?: string[];
  last_updated?: string;

  [key: string]: unknown;
}

export interface AtlasPack {
  manifest: AtlasManifest;
  cards: MicrocardRecord[];
  symbols: SymbolRecord[];
  edges: EdgeRecord[];
  sources: SourceRecord[];
}

export interface SearchFilters {
  package?: string;
  language?: "R" | "Python";
  tags?: string[];
  role?: string;
}

export interface SearchHit {
  card: MicrocardRecord;
  score: number;
  lexScore: number;
}

export interface SymbolSearchHit {
  symbol: SymbolRecord;
  score: number;
}
