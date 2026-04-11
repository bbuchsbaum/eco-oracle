import type { RegistryEntry } from "./types.js";

export type PackageFilters = {
  language?: "R" | "Python";
  tags?: string[];
  role?: string;
};

type PackageCountsValue = number | null;

export type PackageListingRow = RegistryEntry & {
  card_count: PackageCountsValue;
  symbol_count: PackageCountsValue;
  edge_count: PackageCountsValue;
  manual_card_count: PackageCountsValue;
  generated_card_count: PackageCountsValue;
  entrypoint_count: number;
  manual_ratio: number | null;
  counts_complete: boolean;
};

export type PackageListingPayload = {
  totals: {
    packages: number;
    cards: PackageCountsValue;
    symbols: PackageCountsValue;
    edges: PackageCountsValue;
    manual_cards: PackageCountsValue;
    generated_cards: PackageCountsValue;
    manual_ratio: number | null;
    counts_complete: boolean;
  };
  filters: {
    language: "R" | "Python" | null;
    tags: string[];
    role: string | null;
  };
  packages: PackageListingRow[];
};

type PackageSummaryInput = RegistryEntry & {
  card_count: PackageCountsValue;
  symbol_count: PackageCountsValue;
  edge_count: PackageCountsValue;
  manual_card_count: PackageCountsValue;
  generated_card_count: PackageCountsValue;
  entrypoint_count: number;
};

export function buildRegistryPackageRows(
  registry: RegistryEntry[],
  filters: PackageFilters = {}
): PackageSummaryInput[] {
  return filterRegistryPackages(registry, filters).map((entry) => ({
    ...entry,
    card_count: null,
    symbol_count: null,
    edge_count: null,
    manual_card_count: null,
    generated_card_count: null,
    entrypoint_count: (entry.entrypoints || []).length,
  }));
}

export function buildPackagePayload(
  rows: PackageSummaryInput[],
  filters: PackageFilters = {},
  countsComplete: boolean
): PackageListingPayload {
  const packages = rows.map((pkg) => ({
    ...pkg,
    manual_ratio:
      countsComplete && (pkg.card_count || 0) > 0
        ? Number(((pkg.manual_card_count || 0) / (pkg.card_count || 0)).toFixed(4))
        : null,
    counts_complete: countsComplete,
  }));

  const totals = countsComplete
    ? (() => {
        const counts = rows.reduce(
          (acc, pkg) => {
            acc.packages += 1;
            acc.cards += pkg.card_count || 0;
            acc.symbols += pkg.symbol_count || 0;
            acc.edges += pkg.edge_count || 0;
            acc.manual_cards += pkg.manual_card_count || 0;
            acc.generated_cards += pkg.generated_card_count || 0;
            return acc;
          },
          {
            packages: 0,
            cards: 0,
            symbols: 0,
            edges: 0,
            manual_cards: 0,
            generated_cards: 0,
          }
        );

        return {
          ...counts,
          manual_ratio:
            counts.cards > 0
              ? Number((counts.manual_cards / counts.cards).toFixed(4))
              : null,
          counts_complete: true,
        };
      })()
    : {
        packages: rows.length,
        cards: null,
        symbols: null,
        edges: null,
        manual_cards: null,
        generated_cards: null,
        manual_ratio: null,
        counts_complete: false,
      };

  return {
    totals,
    filters: {
      language: filters.language || null,
      tags: filters.tags || [],
      role: filters.role || null,
    },
    packages,
  };
}

function filterRegistryPackages(
  registry: RegistryEntry[],
  filters: PackageFilters
): RegistryEntry[] {
  let result = registry;

  if (filters.language) {
    result = result.filter((entry) => entry.language === filters.language);
  }

  if (filters.role) {
    result = result.filter((entry) => entry.role === filters.role);
  }

  if (filters.tags?.length) {
    const required = new Set(filters.tags.map(normalizeTag));
    result = result.filter((entry) => {
      const tags = new Set((entry.tags || []).map(normalizeTag));
      for (const tag of required) {
        if (!tags.has(tag)) return false;
      }
      return true;
    });
  }

  return [...result].sort((a, b) => {
    const aPkg = String(a.package || inferPackageFromRepo(a.repo));
    const bPkg = String(b.package || inferPackageFromRepo(b.repo));
    return aPkg.localeCompare(bPkg);
  });
}

function inferPackageFromRepo(repo: string): string {
  const parts = String(repo || "").split("/");
  return parts[1] || parts[0] || "unknownpkg";
}

function normalizeTag(tag: string): string {
  return String(tag || "").trim().toLowerCase();
}
