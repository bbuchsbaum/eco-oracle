import { describe, expect, it } from "vitest";
import {
  buildPackagePayload,
  buildRegistryPackageRows,
} from "./package-listing.js";
import type { RegistryEntry } from "./types.js";

const registry: RegistryEntry[] = [
  {
    repo: "bbuchsbaum/bidser",
    package: "bidser",
    language: "R",
    role: "ingest",
    tags: ["bids", "neuroimaging", "fmri"],
    entrypoints: ["bidser::bids_project", "bidser::read_events"],
  },
  {
    repo: "bbuchsbaum/delarr",
    package: "delarr",
    language: "R",
    role: "transform",
    tags: ["arrays", "data"],
    entrypoints: ["delarr::collect"],
  },
];

describe("package listing helpers", () => {
  it("builds registry-only package rows with null counts", () => {
    const rows = buildRegistryPackageRows(registry, {
      language: "R",
      tags: ["fmri"],
      role: "ingest",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].package).toBe("bidser");
    expect(rows[0].card_count).toBeNull();
    expect(rows[0].entrypoint_count).toBe(2);
  });

  it("builds metadata-only payloads with incomplete count flags", () => {
    const rows = buildRegistryPackageRows(registry, {});
    const payload = buildPackagePayload(rows, {}, false);

    expect(payload.totals.packages).toBe(2);
    expect(payload.totals.cards).toBeNull();
    expect(payload.totals.counts_complete).toBe(false);
    expect(payload.packages[0].manual_ratio).toBeNull();
    expect(payload.packages[0].counts_complete).toBe(false);
  });

  it("builds counted payloads when index-backed counts are available", () => {
    const payload = buildPackagePayload(
      [
        {
          ...registry[0],
          card_count: 10,
          symbol_count: 25,
          edge_count: 4,
          manual_card_count: 3,
          generated_card_count: 7,
          entrypoint_count: 2,
        },
        {
          ...registry[1],
          card_count: 5,
          symbol_count: 8,
          edge_count: 1,
          manual_card_count: 0,
          generated_card_count: 5,
          entrypoint_count: 1,
        },
      ],
      { language: "R" },
      true
    );

    expect(payload.totals.packages).toBe(2);
    expect(payload.totals.cards).toBe(15);
    expect(payload.totals.manual_cards).toBe(3);
    expect(payload.totals.manual_ratio).toBe(0.2);
    expect(payload.totals.counts_complete).toBe(true);
    expect(payload.packages[0].manual_ratio).toBe(0.3);
  });
});
