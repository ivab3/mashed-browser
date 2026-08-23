import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface FixtureRecord {
  archive: { entryCount: number };
  entries: string[];
  keyFiles: Record<string, { sizeBytes: number; sha256: string }>;
}

describe("committed extraction fixture metadata", () => {
  it("has complete unique file lists and valid key hashes", () => {
    const path = new URL("../../../reference/extraction-fixtures.json", import.meta.url);
    const document = JSON.parse(readFileSync(path, "utf8")) as { fixtures: FixtureRecord[] };

    for (const fixture of document.fixtures) {
      expect(fixture.entries).toHaveLength(fixture.archive.entryCount);
      expect(new Set(fixture.entries.map((name) => name.toLocaleLowerCase("en-US"))).size).toBe(
        fixture.entries.length,
      );
      for (const [name, metadata] of Object.entries(fixture.keyFiles)) {
        expect(fixture.entries).toContain(name);
        expect(metadata.sizeBytes).toBeGreaterThan(0);
        expect(metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
