#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { c as createTar } from "tar";

type BenchOptions = {
  packages: number;
  cardsPerPackage: number;
  symbolsPerPackage: number;
  edgesPerPackage: number;
  iterations: number;
  json: boolean;
  keepTemp: boolean;
};

type ScenarioResult = {
  name: string;
  iterations: number;
  mean_ms: number;
  min_ms: number;
  max_ms: number;
  p50_ms: number;
  p95_ms: number;
};

type FixtureContext = {
  rootDir: string;
  cacheDir: string;
  registryPath: string;
};

type RegistryModule = typeof import("./loader.js");
type EcoIndexModule = typeof import("./eco-index.js");
type PackageListingModule = typeof import("./package-listing.js");
type RegistryEntry = import("./types.js").RegistryEntry;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await createFixtureContext();

  process.env.ECO_CACHE_DIR = fixture.cacheDir;
  process.env.ECO_REFRESH_SECS = "3600";

  const loader = (await import("./loader.js")) as RegistryModule;
  const ecoIndex = (await import("./eco-index.js")) as EcoIndexModule;
  const packageListing = (await import("./package-listing.js")) as PackageListingModule;

  try {
    await seedBenchmarkFixture(fixture, options);

    const registry = await loader.loadRegistry({ path: fixture.registryPath });
    const warmIndex = new ecoIndex.EcoIndex();
    await withMutedConsoleError(async () => {
      await warmIndex.loadFromRegistry(registry, { force: false });
    });

    const snapshot = warmIndex.exportSnapshot();
    await loader.saveIndexSnapshot(snapshot, { path: fixture.registryPath });

    const firstPackage = registry[0]?.package || "pkg001";
    const symbolQuery = `${firstPackage}::fn_0001`;
    const cardQuery = `normalize signal ${firstPackage}`;

    const scenarios: Array<{
      name: string;
      fn: () => Promise<void>;
    }> = [
      {
        name: "cold_packages_registry_only",
        fn: async () => {
          const rows = packageListing.buildRegistryPackageRows(
            await loader.loadRegistry({ path: fixture.registryPath }),
            {}
          );
          packageListing.buildPackagePayload(rows, {}, false);
        },
      },
      {
        name: "cold_packages_from_snapshot",
        fn: async () => {
          const restored = await loader.loadIndexSnapshot({
            path: fixture.registryPath,
            maxAgeSecs: 3600,
          });
          if (!restored) throw new Error("Missing snapshot for benchmark.");
          const index = new ecoIndex.EcoIndex();
          await withMutedConsoleError(async () => {
            index.loadSnapshot(restored);
          });
          packageListing.buildPackagePayload(index.packageSummaries({}), {}, true);
        },
      },
      {
        name: "cold_full_refresh",
        fn: async () => {
          const index = new ecoIndex.EcoIndex();
          const freshRegistry = await loader.loadRegistry({ path: fixture.registryPath });
          await withMutedConsoleError(async () => {
            await index.loadFromRegistry(freshRegistry, { force: false });
          });
        },
      },
      {
        name: "cold_exact_symbol_targeted",
        fn: async () => {
          const index = new ecoIndex.EcoIndex();
          await withMutedConsoleError(async () => {
            await index.loadPackages([registry[0]], { force: false });
          });
          index.lookupSymbol(symbolQuery, 10);
        },
      },
      {
        name: "warm_packages_from_index",
        fn: async () => {
          packageListing.buildPackagePayload(warmIndex.packageSummaries({}), {}, true);
        },
      },
      {
        name: "warm_symbol_lookup",
        fn: async () => {
          warmIndex.lookupSymbol(symbolQuery, 10);
        },
      },
      {
        name: "warm_card_search",
        fn: async () => {
          warmIndex.searchCards(cardQuery, 5, {});
        },
      },
    ];

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario.name, options.iterations, scenario.fn));
    }

    const output = {
      fixture: {
        packages: options.packages,
        cards_per_package: options.cardsPerPackage,
        symbols_per_package: options.symbolsPerPackage,
        edges_per_package: options.edgesPerPackage,
      },
      runtime: {
        node: process.version,
        gc_exposed: typeof (globalThis as { gc?: () => void }).gc === "function",
      },
      results,
      comparisons: buildComparisons(results),
      temp_dir: options.keepTemp ? fixture.rootDir : null,
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printSummary(output);
    }
  } finally {
    if (!options.keepTemp) {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }
}

async function runScenario(
  name: string,
  iterations: number,
  fn: () => Promise<void>
): Promise<ScenarioResult> {
  const samples: number[] = [];

  await maybeRunGc();
  await fn();
  await maybeRunGc();

  for (let i = 0; i < iterations; i += 1) {
    await maybeRunGc();
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  return {
    name,
    iterations,
    mean_ms: round4(mean(samples)),
    min_ms: round4(samples[0] || 0),
    max_ms: round4(samples[samples.length - 1] || 0),
    p50_ms: round4(percentile(samples, 0.5)),
    p95_ms: round4(percentile(samples, 0.95)),
  };
}

async function seedBenchmarkFixture(
  fixture: FixtureContext,
  options: BenchOptions
): Promise<void> {
  const registry: RegistryEntry[] = [];
  const sourceRoot = join(fixture.rootDir, "packs-src");
  await mkdir(sourceRoot, { recursive: true });

  for (let packageIndex = 1; packageIndex <= options.packages; packageIndex += 1) {
    const pkg = `pkg${String(packageIndex).padStart(3, "0")}`;
    const repo = `bench/${pkg}`;
    registry.push({
      repo,
      package: pkg,
      language: "R",
      role: packageIndex % 2 === 0 ? "transform" : "ingest",
      tags: [packageIndex % 2 === 0 ? "signal" : "timeseries", "benchmark", pkg],
      entrypoints: [`${pkg}::fn_0001`, `${pkg}::fn_0002`],
      release_tag: "eco-atlas",
      asset: "atlas-pack.tgz",
    });

    const packRoot = join(sourceRoot, pkg);
    const atlasDir = join(packRoot, "atlas");
    await mkdir(atlasDir, { recursive: true });

    const cards: Array<Record<string, unknown>> = [];
    const symbols: Array<Record<string, unknown>> = [];
    const sources: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];

    for (let symbolIndex = 1; symbolIndex <= options.symbolsPerPackage; symbolIndex += 1) {
      const fnName = `fn_${String(symbolIndex).padStart(4, "0")}`;
      const symbol = `${pkg}::${fnName}`;
      symbols.push({
        symbol,
        type: "function",
        signature: `${fnName}(x, method = "default")`,
        summary: `Benchmark function ${fnName} for ${pkg}`,
        language: "R",
        tags: ["benchmark", pkg, symbolIndex % 2 === 0 ? "signal" : "timeseries"],
        source: { path: "R/functions.R", lines: [symbolIndex, symbolIndex + 4] },
      });
      sources.push({
        symbol,
        language: "R",
        body: [
          `${fnName} <- function(x, method = "default") {`,
          `  y <- x + ${symbolIndex}`,
          `  if (method == "normalize") y <- y / ${symbolIndex + 1}`,
          "  y",
          "}",
        ].join("\n"),
        source: { path: "R/functions.R", lines: [symbolIndex, symbolIndex + 4] },
        internal_calls: [],
      });
    }

    for (let cardIndex = 1; cardIndex <= options.cardsPerPackage; cardIndex += 1) {
      const symbolNumber = ((cardIndex - 1) % options.symbolsPerPackage) + 1;
      const fnName = `fn_${String(symbolNumber).padStart(4, "0")}`;
      cards.push({
        id: `${pkg}::howto/${String(cardIndex).padStart(4, "0")}`,
        package: pkg,
        language: "R",
        kind: cardIndex % 5 === 0 ? "manual" : "generated",
        q: `How do I normalize signal in ${pkg}?`,
        a: `Use ${pkg}::${fnName} to normalize benchmark signal.`,
        recipe: `${pkg}::${fnName}(x, method = "normalize")`,
        symbols: [`${pkg}::${fnName}`],
        tags: ["benchmark", "normalize", "signal", pkg],
        sources: [{ path: "R/functions.R", lines: [symbolNumber, symbolNumber + 4] }],
      });
    }

    for (let edgeIndex = 1; edgeIndex <= options.edgesPerPackage; edgeIndex += 1) {
      const fromFn = `fn_${String(((edgeIndex - 1) % options.symbolsPerPackage) + 1).padStart(4, "0")}`;
      const toPackageIndex = (packageIndex % options.packages) + 1;
      const toPkg = `pkg${String(toPackageIndex).padStart(3, "0")}`;
      const toFn = `fn_${String(((edgeIndex + 2) % options.symbolsPerPackage) + 1).padStart(4, "0")}`;
      edges.push({
        from: `${pkg}::${fromFn}`,
        to: `${toPkg}::${toFn}`,
        kind: "call",
        source: { path: "R/functions.R", lines: [edgeIndex, edgeIndex + 1] },
      });
    }

    await writeJson(join(atlasDir, "manifest.json"), {
      package: pkg,
      version: "0.1.0",
      language: "R",
      role: packageIndex % 2 === 0 ? "transform" : "ingest",
      tags: [packageIndex % 2 === 0 ? "signal" : "timeseries", "benchmark", pkg],
      entrypoints: [`${pkg}::fn_0001`, `${pkg}::fn_0002`],
      card_count: cards.length,
      symbol_count: symbols.length,
    });
    await writeJsonl(join(atlasDir, "cards.jsonl"), cards);
    await writeJsonl(join(atlasDir, "symbols.jsonl"), symbols);
    await writeJsonl(join(atlasDir, "edges.jsonl"), edges);
    await writeJsonl(join(atlasDir, "sources.jsonl"), sources);

    const cachePackDir = join(fixture.cacheDir, "packs", repo.replaceAll("/", "__"));
    await mkdir(cachePackDir, { recursive: true });
    await createTar(
      {
        gzip: true,
        cwd: packRoot,
        file: join(cachePackDir, "atlas-pack.tgz"),
      },
      ["atlas"]
    );
  }

  await writeJson(fixture.registryPath, registry);
}

async function createFixtureContext(): Promise<FixtureContext> {
  const rootDir = await mkdtemp(join(os.tmpdir(), "eco-oracle-bench-"));
  const cacheDir = join(rootDir, "cache");
  const registryPath = join(rootDir, "registry.json");
  await mkdir(cacheDir, { recursive: true });
  return { rootDir, cacheDir, registryPath };
}

function buildComparisons(results: ScenarioResult[]): Record<string, number | null> {
  const lookup = new Map(results.map((result) => [result.name, result]));
  const fullRefresh = lookup.get("cold_full_refresh")?.mean_ms || 0;
  const snapshot = lookup.get("cold_packages_from_snapshot")?.mean_ms || 0;
  const registryOnly = lookup.get("cold_packages_registry_only")?.mean_ms || 0;
  const targetedSymbol = lookup.get("cold_exact_symbol_targeted")?.mean_ms || 0;

  return {
    snapshot_vs_full_refresh:
      snapshot > 0 ? round4(fullRefresh / snapshot) : null,
    registry_only_vs_full_refresh:
      registryOnly > 0 ? round4(fullRefresh / registryOnly) : null,
    targeted_symbol_vs_full_refresh:
      targetedSymbol > 0 ? round4(fullRefresh / targetedSymbol) : null,
  };
}

function printSummary(output: {
  fixture: Record<string, number>;
  runtime: { node: string; gc_exposed: boolean };
  results: ScenarioResult[];
  comparisons: Record<string, number | null>;
  temp_dir: string | null;
}): void {
  console.log("EcoOracle MCP benchmark");
  console.log(JSON.stringify(output.fixture));
  console.log(
    `Node ${output.runtime.node} | gc_exposed=${String(output.runtime.gc_exposed)}`
  );
  console.table(
    output.results.map((result) => ({
      scenario: result.name,
      iterations: result.iterations,
      mean_ms: result.mean_ms,
      p50_ms: result.p50_ms,
      p95_ms: result.p95_ms,
      min_ms: result.min_ms,
      max_ms: result.max_ms,
    }))
  );
  console.log("Comparisons");
  console.table(output.comparisons);
  if (output.temp_dir) {
    console.log(`Fixture directory kept at ${output.temp_dir}`);
  }
}

async function withMutedConsoleError<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

async function maybeRunGc(): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === "function") gc();
}

function parseArgs(argv: string[]): BenchOptions {
  const options: BenchOptions = {
    packages: 24,
    cardsPerPackage: 40,
    symbolsPerPackage: 80,
    edgesPerPackage: 120,
    iterations: 5,
    json: false,
    keepTemp: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--keep-temp") {
      options.keepTemp = true;
      continue;
    }
    if (arg === "--packages" && next) {
      options.packages = parsePositiveInt(next, options.packages);
      i += 1;
      continue;
    }
    if (arg === "--cards-per-package" && next) {
      options.cardsPerPackage = parsePositiveInt(next, options.cardsPerPackage);
      i += 1;
      continue;
    }
    if (arg === "--symbols-per-package" && next) {
      options.symbolsPerPackage = parsePositiveInt(next, options.symbolsPerPackage);
      i += 1;
      continue;
    }
    if (arg === "--edges-per-package" && next) {
      options.edgesPerPackage = parsePositiveInt(next, options.edgesPerPackage);
      i += 1;
      continue;
    }
    if (arg === "--iterations" && next) {
      options.iterations = parsePositiveInt(next, options.iterations);
      i += 1;
      continue;
    }
  }

  return options;
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(q * (values.length - 1))));
  return values[index];
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const text = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, text.length > 0 ? `${text}\n` : "", "utf-8");
}

main().catch((error) => {
  console.error("[eco-oracle-bench] Fatal:", error);
  process.exit(1);
});
