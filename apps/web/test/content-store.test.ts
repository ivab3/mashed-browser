import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentStore, readCachedContentFile, type StoredContent } from "../src/content-store.js";

function manifest(hash: string): StoredContent {
  return { version: 1, catalog: { version: 1, tracks: [], vehicles: [] },
    hashes: { "toastart/test.dff": hash }, total: 1, bytes: 4 };
}

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });

describe("persistent local library", () => {
  it("restores an active library and its file after reopening the database", async () => {
    const first = await ContentStore.open();
    const saved = manifest("first");
    await first.savePending(saved, { hash: "first", blob: new Blob(["data"]) });
    await first.activate(saved);
    first.close();
    const reopened = await ContentStore.open();
    expect(await reopened.manifest("active")).toEqual(saved);
    expect(await reopened.manifest("pending")).toBeUndefined();
    expect(await (await readCachedContentFile(saved, "toastart/test.dff", "test.dff")).text()).toBe("data");
    reopened.close();
  });

  it("keeps the previous library while interrupted work remains resumable", async () => {
    const store = await ContentStore.open();
    await store.savePending(manifest("old"), { hash: "old", blob: new Blob(["old!"]) });
    await store.activate(manifest("old"));
    const partial = { ...manifest("new"), total: 2 };
    await store.savePending(partial, { hash: "new", blob: new Blob(["new!"]) });
    await expect(store.activate(partial)).rejects.toThrow("incomplete");
    store.close();
    const reopened = await ContentStore.open();
    expect(await reopened.manifest("active")).toEqual(manifest("old"));
    expect(await reopened.manifest("pending")).toEqual(partial);
    expect(await (await reopened.blob("new"))?.text()).toBe("new!");
    reopened.close();
  });

  it("prunes orphaned payloads while retaining active and pending libraries", async () => {
    const store = await ContentStore.open();
    await store.savePending(manifest("orphan"), { hash: "orphan", blob: new Blob(["gone"]) });
    await store.savePending(manifest("active"), { hash: "active", blob: new Blob(["keep"]) });
    await store.activate(manifest("active"));
    await store.savePending(manifest("pending"), { hash: "pending", blob: new Blob(["work"]) });
    await store.prune();
    expect(await store.blob("orphan")).toBeUndefined();
    expect(await store.blob("active")).toBeInstanceOf(Blob);
    expect(await store.blob("pending")).toBeInstanceOf(Blob);
    store.close();
  });

  it("reports evicted or missing cached data with a repair action", async () => {
    await expect(readCachedContentFile(manifest("missing"), "toastart/test.dff", "test.dff"))
      .rejects.toThrow("import the folder again");
  });
});
