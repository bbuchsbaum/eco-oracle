import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("./loader.js", () => ({
  loadAtlasPack: vi.fn(),
}));
import { EcoIndex } from "./eco-index.js";
import { loadAtlasPack } from "./loader.js";
import type { AtlasPack, SourceRecord, SymbolRecord, MicrocardRecord } from "./types.js";

const mockedLoadAtlasPack = vi.mocked(loadAtlasPack);

function makePack(overrides: Partial<AtlasPack> = {}): AtlasPack {
  return {
    manifest: { package: "testpkg", version: "1.0.0", language: "R" },
    cards: [],
    symbols: [],
    edges: [],
    sources: [],
    ...overrides,
  };
}

function makeSource(symbol: string, body: string, extra: Partial<SourceRecord> = {}): SourceRecord {
  return {
    symbol,
    language: "R",
    body,
    source: { path: "R/test.R", lines: [1, 10] },
    internal_calls: [],
    ...extra,
  };
}

function makeSymbol(symbol: string, sig: string, extra: Partial<SymbolRecord> = {}): SymbolRecord {
  return {
    symbol,
    type: "function",
    signature: sig,
    summary: `Does ${symbol}`,
    language: "R",
    ...extra,
  };
}

function makeCard(id: string, pkg: string): MicrocardRecord {
  return {
    id,
    package: pkg,
    language: "R",
    q: "How do I test?",
    a: "Use testthat to write unit tests.",
    recipe: "testthat::test_that('it works', { expect_true(TRUE) })",
    symbols: [`${pkg}::test_fn`],
    sources: [{ path: "R/test.R", lines: [1, 5] }],
  };
}

describe("EcoIndex source ingestion and lookup", () => {
  let index: EcoIndex;

  beforeEach(async () => {
    mockedLoadAtlasPack.mockReset();
    index = new EcoIndex();

    const pack = makePack({
      sources: [
        makeSource("testpkg::compute", 'function(x, method = "default") {\n  result <- stats::optim(x)\n  testpkg:::helper(result)\n  result\n}', {
          internal_calls: ["stats::optim", "testpkg:::helper"],
        }),
        makeSource("testpkg::transform", "function(data) {\n  data * 2\n}"),
        makeSource("testpkg::fit_model", "function(x, y, ...) {\n  lm(y ~ x)\n}"),
      ],
      symbols: [
        makeSymbol("testpkg::compute", 'compute(x, method = "default")'),
        makeSymbol("testpkg::transform", "transform(data)"),
        makeSymbol("testpkg::fit_model", "fit_model(x, y, ...)"),
      ],
      cards: [makeCard("testpkg::howto/test", "testpkg")],
    });

    // Use loadFromRegistry with a fake registry entry that we can inject the pack into
    // Since loadFromRegistry calls loadAtlasPack which needs network, we test via
    // the internal ingestPack pathway by loading directly.
    // We'll use a workaround: call loadFromRegistry with an empty registry, then
    // directly access ingestPack via the index.
    // Actually, let's just test the public API by constructing the index properly.
    // The cleanest way is to test ingestPack indirectly.

    // We'll monkey-patch for testing since there's no DI.
    // Instead, let's directly call the private method via bracket notation.
    (index as any).registry = [{ repo: "test/testpkg", package: "testpkg", language: "R" }];
    (index as any).packageMeta.set("testpkg", { repo: "test/testpkg", package: "testpkg", language: "R" });
    (index as any).packageCounts.set("testpkg", { cards: 0, symbols: 0, edges: 0, manual_cards: 0, generated_cards: 0 });
    (index as any).ingestPack(pack, { repo: "test/testpkg", package: "testpkg", language: "R" });
  });

  describe("lookupSource", () => {
    it("returns exact match for fully qualified symbol", () => {
      const result = index.lookupSource("testpkg::compute");
      expect(result.exact).toBeDefined();
      expect(result.exact!.symbol).toBe("testpkg::compute");
      expect(result.exact!.body).toContain("stats::optim");
      expect(result.exact!.internal_calls).toEqual(["stats::optim", "testpkg:::helper"]);
      expect(result.candidates).toHaveLength(0);
    });

    it("returns exact match with source location", () => {
      const result = index.lookupSource("testpkg::compute");
      expect(result.exact!.source).toEqual({ path: "R/test.R", lines: [1, 10] });
    });

    it("returns candidates for bare function name", () => {
      const result = index.lookupSource("compute");
      expect(result.exact).toBeUndefined();
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].symbol).toBe("testpkg::compute");
    });

    it("returns fuzzy matches for partial name", () => {
      const result = index.lookupSource("fit");
      expect(result.exact).toBeUndefined();
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].symbol).toBe("testpkg::fit_model");
    });

    it("returns empty for non-existent symbol", () => {
      const result = index.lookupSource("nonexistent");
      expect(result.exact).toBeUndefined();
      expect(result.candidates).toHaveLength(0);
    });

    it("returns all matches when bare name matches multiple", async () => {
      // Add a second package with a 'transform' function
      const pack2 = makePack({
        manifest: { package: "otherpkg", version: "1.0.0", language: "R" },
        sources: [makeSource("otherpkg::transform", "function(x) { x + 1 }")],
      });
      (index as any).packageMeta.set("otherpkg", { repo: "test/otherpkg", package: "otherpkg", language: "R" });
      (index as any).packageCounts.set("otherpkg", { cards: 0, symbols: 0, edges: 0, manual_cards: 0, generated_cards: 0 });
      (index as any).ingestPack(pack2, { repo: "test/otherpkg", package: "otherpkg", language: "R" });

      const result = index.lookupSource("transform");
      expect(result.exact).toBeUndefined();
      expect(result.candidates).toHaveLength(2);
      const symbols = result.candidates.map((c) => c.symbol).sort();
      expect(symbols).toEqual(["otherpkg::transform", "testpkg::transform"]);
    });

    it("respects limit parameter", async () => {
      const pack2 = makePack({
        manifest: { package: "otherpkg", version: "1.0.0", language: "R" },
        sources: [makeSource("otherpkg::transform", "function(x) { x + 1 }")],
      });
      (index as any).packageMeta.set("otherpkg", { repo: "test/otherpkg", package: "otherpkg", language: "R" });
      (index as any).packageCounts.set("otherpkg", { cards: 0, symbols: 0, edges: 0, manual_cards: 0, generated_cards: 0 });
      (index as any).ingestPack(pack2, { repo: "test/otherpkg", package: "otherpkg", language: "R" });

      const result = index.lookupSource("transform", 1);
      expect(result.candidates).toHaveLength(1);
    });
  });

  describe("source ingestion", () => {
    it("indexes sources from atlas pack", () => {
      const stats = index.stats();
      expect(stats.sources).toBe(3);
    });

    it("qualifies bare symbols during ingestion", async () => {
      // Source record without pkg:: prefix should get qualified
      const pack2 = makePack({
        manifest: { package: "barepkg", version: "1.0.0", language: "R" },
        sources: [{ symbol: "bare_fn", body: "function() 42" } as SourceRecord],
      });
      (index as any).packageMeta.set("barepkg", { repo: "test/barepkg", package: "barepkg", language: "R" });
      (index as any).packageCounts.set("barepkg", { cards: 0, symbols: 0, edges: 0, manual_cards: 0, generated_cards: 0 });
      (index as any).ingestPack(pack2, { repo: "test/barepkg", package: "barepkg", language: "R" });

      const result = index.lookupSource("barepkg::bare_fn");
      expect(result.exact).toBeDefined();
      expect(result.exact!.symbol).toBe("barepkg::bare_fn");
    });

    it("skips source records missing body", async () => {
      const prevStats = index.stats();
      const pack2 = makePack({
        manifest: { package: "badpkg", version: "1.0.0", language: "R" },
        sources: [{ symbol: "badpkg::no_body" } as any],
      });
      (index as any).packageMeta.set("badpkg", { repo: "test/badpkg", package: "badpkg", language: "R" });
      (index as any).packageCounts.set("badpkg", { cards: 0, symbols: 0, edges: 0, manual_cards: 0, generated_cards: 0 });
      (index as any).ingestPack(pack2, { repo: "test/badpkg", package: "badpkg", language: "R" });

      // Should not have added anything new
      expect(index.stats().sources).toBe(prevStats.sources);
    });

    it("handles packs with no sources.jsonl gracefully", async () => {
      const pack2 = makePack({
        manifest: { package: "nosrc", version: "1.0.0", language: "R" },
      });
      // sources defaults to [] in makePack
      (index as any).packageMeta.set("nosrc", { repo: "test/nosrc", package: "nosrc", language: "R" });
      (index as any).packageCounts.set("nosrc", { cards: 0, symbols: 0, edges: 0, manual_cards: 0, generated_cards: 0 });
      (index as any).ingestPack(pack2, { repo: "test/nosrc", package: "nosrc", language: "R" });

      // Should not crash, sources count unchanged
      expect(index.stats().sources).toBe(3);
    });
  });

  describe("snapshot round-trip", () => {
    it("restores stats, symbol lookup, source lookup, and package summaries", () => {
      const snapshot = index.exportSnapshot();
      const restored = new EcoIndex();

      restored.loadSnapshot(snapshot);

      expect(restored.stats()).toEqual(index.stats());
      expect(restored.lookupSource("testpkg::compute").exact?.internal_calls).toEqual([
        "stats::optim",
        "testpkg:::helper",
      ]);
      expect(restored.lookupSymbol("testpkg::compute").exact?.signature).toBe(
        'compute(x, method = "default")'
      );

      const summaries = restored.packageSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].package).toBe("testpkg");
      expect(summaries[0].card_count).toBe(1);
      expect(summaries[0].symbol_count).toBe(3);
      expect(summaries[0].edge_count).toBe(0);
    });
  });

  describe("partial package loading", () => {
    it("loads only requested packages for exact package lookups", async () => {
      const localIndex = new EcoIndex();
      mockedLoadAtlasPack.mockResolvedValueOnce(
        makePack({
          manifest: { package: "pkg1", version: "1.0.0", language: "R" },
          symbols: [makeSymbol("pkg1::alpha_exact", "alpha_exact(x)")],
          sources: [makeSource("pkg1::alpha_exact", "function(x) x")],
          cards: [
            {
              ...makeCard("pkg1::howto/alpha", "pkg1"),
              q: "How do I alpha_exact?",
              a: "Use alpha_exact.",
              recipe: "pkg1::alpha_exact(x)",
              symbols: ["pkg1::alpha_exact"],
            },
          ],
        })
      );

      await localIndex.loadPackages([{ repo: "test/pkg1", package: "pkg1", language: "R" }]);

      expect(mockedLoadAtlasPack).toHaveBeenCalledTimes(1);
      expect(localIndex.isPackageLoaded("pkg1")).toBe(true);
      expect(localIndex.loadedPackageCount()).toBe(1);
      expect(localIndex.lookupSymbol("pkg1::alpha_exact").exact?.symbol).toBe("pkg1::alpha_exact");
    });

    it("force reloading a package replaces prior package data instead of duplicating it", async () => {
      const localIndex = new EcoIndex();
      mockedLoadAtlasPack
        .mockResolvedValueOnce(
          makePack({
            manifest: { package: "pkg1", version: "1.0.0", language: "R" },
            symbols: [makeSymbol("pkg1::old_exact_only", "old_exact_only(x)")],
            sources: [makeSource("pkg1::old_exact_only", "function(x) x")],
          })
        )
        .mockResolvedValueOnce(
          makePack({
            manifest: { package: "pkg1", version: "1.0.1", language: "R" },
            symbols: [makeSymbol("pkg1::new_exact_only", "new_exact_only(x)")],
            sources: [makeSource("pkg1::new_exact_only", "function(x) x + 1")],
          })
        );

      await localIndex.loadPackages([{ repo: "test/pkg1", package: "pkg1", language: "R" }]);
      await localIndex.loadPackages(
        [{ repo: "test/pkg1", package: "pkg1", language: "R" }],
        { force: true }
      );

      expect(mockedLoadAtlasPack).toHaveBeenCalledTimes(2);
      expect(localIndex.lookupSymbol("pkg1::old_exact_only").exact).toBeUndefined();
      expect(localIndex.lookupSymbol("pkg1::new_exact_only").exact?.symbol).toBe(
        "pkg1::new_exact_only"
      );
      expect(localIndex.stats().symbols).toBe(1);
    });
  });
});
