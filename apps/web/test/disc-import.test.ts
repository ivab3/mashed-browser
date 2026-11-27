import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BrowserMode1Reader, parseBrowserCue, readBrowserIso } from "../src/disc-reader.js";
import { extractDiscSources } from "../src/disc-import.js";
import { extractCabinetFile, readInstallShieldHeader } from "../src/installshield.js";

const cue = 'FILE "game.bin" BINARY\n TRACK 01 MODE1/2352\n INDEX 01 00:00:00';
const bytes = (text: string) => new TextEncoder().encode(text);
const source = (data: Uint8Array<ArrayBuffer>) => ({ size: data.length, read: async (offset: number, length: number) => data.slice(offset, offset + length) });

function rawDisc(iso: Uint8Array<ArrayBuffer>, pregap = 0): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array((Math.ceil(iso.length / 2048) + pregap) * 2352);
  for (let i = 0; i < raw.length / 2352; i++) {
    const offset = i * 2352;
    raw.fill(255, offset + 1, offset + 11);
    raw[offset + 15] = 1;
    if (i >= pregap) raw.set(iso.subarray((i - pregap) * 2048, (i - pregap + 1) * 2048), offset + 16);
  }
  return raw;
}
function directoryRecord(name: string | number, sector: number, size: number, flags = 0): Uint8Array<ArrayBuffer> {
  const id = typeof name === "number" ? new Uint8Array([name]) : bytes(name);
  const data = new Uint8Array(33 + id.length + (id.length % 2 === 0 ? 1 : 0));
  const view = new DataView(data.buffer);
  data[0] = data.length;
  view.setUint32(2, sector, true); view.setUint32(6, sector);
  view.setUint32(10, size, true); view.setUint32(14, size);
  data[25] = flags; data[32] = id.length; data.set(id, 33);
  return data;
}
function isoFixture(entries: Uint8Array<ArrayBuffer>[], sectors = 24): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(sectors * 2048);
  const p = 16 * 2048;
  data[p] = 1; data.set(bytes("CD001"), p + 1); data[p + 6] = 1;
  const view = new DataView(data.buffer);
  view.setUint32(p + 80, sectors, true); view.setUint32(p + 84, sectors);
  view.setUint16(p + 128, 2048, true); view.setUint16(p + 130, 2048);
  data.set(directoryRecord(0, 20, 2048, 2), p + 156);
  let offset = 20 * 2048;
  for (const record of [directoryRecord(0, 20, 2048, 2), directoryRecord(1, 20, 2048, 2), ...entries]) {
    data.set(record, offset); offset += record.length;
  }
  return data;
}
function cabinetFixture(payload = bytes("original payload"), compressed = true) {
  const directory = "TOASTART\\VEHICLES";
  const name = "Wildfire.piz";
  const tableSize = 4 + 87 + directory.length + 1 + name.length + 1;
  const header = new Uint8Array(128 + tableSize);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x28635349, true); view.setUint32(4, 0x0100600c, true);
  view.setUint32(12, 64, true); view.setUint32(16, 64, true);
  view.setUint32(64 + 12, 64, true);
  view.setUint32(64 + 20, tableSize, true); view.setUint32(64 + 24, tableSize, true);
  view.setUint32(64 + 28, 1, true); view.setUint32(64 + 40, 1, true); view.setUint32(64 + 44, 4, true);
  view.setUint32(128, 91, true);
  header.set(bytes(directory), 128 + 91);
  header.set(bytes(name), 128 + 92 + directory.length);
  const blocks: Uint8Array<ArrayBuffer>[] = [];
  for (let p = 0; p < payload.length; p += 32768) {
    const chunk = payload.slice(p, p + 32768);
    if (compressed) {
      const deflated = deflateRawSync(chunk);
      blocks.push(new Uint8Array([deflated.length & 255, deflated.length >>> 8]), new Uint8Array(deflated));
    } else blocks.push(chunk);
  }
  const stored = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0));
  let p = 0; for (const block of blocks) { stored.set(block, p); p += block.length; }
  view.setUint16(132, compressed ? 4 : 0, true);
  view.setBigUint64(134, BigInt(payload.length), true);
  view.setBigUint64(142, BigInt(stored.length), true);
  view.setBigUint64(150, 128n, true);
  header.set(createHash("md5").update(payload).digest(), 158);
  view.setUint32(132 + 58, 92 + directory.length, true);
  view.setUint16(132 + 85, 2, true);
  const cabinet = new Uint8Array(128 + stored.length);
  const cv = new DataView(cabinet.buffer);
  cv.setUint32(0, 0x28635349, true); cv.setUint32(4, 0x0100600c, true); cv.setBigUint64(20, 128n, true);
  cabinet.set(stored, 128);
  return { header, cabinet, payload };
}

describe("CUE and MODE1 input", () => {
  it("reads named binary and nonzero INDEX 01 while rejecting ambiguous/unsafe CUE", () => {
    expect(parseBrowserCue(cue.replace("00:00:00", "00:02:00"))).toEqual({ binName: "game.bin", startSector: 150 });
    for (const invalid of [cue.replace("game.bin", "../game.bin"), cue.replace("game.bin", "C:\\game.bin"),
      cue.replace("MODE1/2352", "AUDIO"), cue.replace("00:00:00", "00:60:00"), cue.replace("00:00:00", "00:00:75"),
      cue + '\nFILE "extra.bin" BINARY', cue + "\nTRACK 02 AUDIO", cue.replace("BINARY", "WAVE")]) {
      expect(() => parseBrowserCue(invalid)).toThrow();
    }
  });
  it("reads across raw-sector boundaries and honors pregap without returning header/ECC bytes", async () => {
    const logical = new Uint8Array(4096); logical.fill(7, 0, 2048); logical.fill(9, 2048);
    const reader = new BrowserMode1Reader(new Blob([rawDisc(logical, 2)]), 2);
    expect([...await reader.read(2046, 4)]).toEqual([7, 7, 9, 9]);
    await expect(reader.read(4090, 10)).rejects.toThrow("bounds");
    expect(() => new BrowserMode1Reader(new Blob(["short"])) ).toThrow("multiple");
    const damaged = rawDisc(logical); damaged[15] = 2;
    await expect(new BrowserMode1Reader(new Blob([damaged])).read(0, 1)).rejects.toThrow("MODE1");
    damaged[15] = 1; damaged[1] = 0;
    await expect(new BrowserMode1Reader(new Blob([damaged])).read(0, 1)).rejects.toThrow("sync");
  });
  it("rejects missing or wrong BIN before reading it and supports cooperative cancellation", async () => {
    await expect(extractDiscSources([{ path: "game.cue", blob: new Blob([cue]) }])).rejects.toThrow("both");
    await expect(extractDiscSources([{ path: "game.cue", blob: new Blob([cue]) }, { path: "wrong.bin", blob: new Blob() }])).rejects.toThrow("does not match");
    const reader = new BrowserMode1Reader(new Blob([rawDisc(new Uint8Array(4096))]), 0, () => { throw new DOMException("cancel", "AbortError"); });
    await expect(reader.read(0, 1)).rejects.toHaveProperty("name", "AbortError");
    expect(reader.bytesRead).toBe(0);
  });
});

describe("bounded ISO filesystem", () => {
  it("finds files and strips version suffixes", async () => {
    const iso = isoFixture([directoryRecord("DATA1.HDR;1", 21, 100)]);
    expect(await readBrowserIso(source(iso))).toEqual([{ path: "data1.hdr", offset: 21 * 2048, size: 100, directory: false }]);
  });
  it("rejects cycles, out-of-range extents, duplicate paths and multi-extent records", async () => {
    for (const entries of [[directoryRecord("LOOP", 20, 2048, 2)], [directoryRecord("BAD", 99, 2048)],
      [directoryRecord("A", 21, 1), directoryRecord("A", 21, 1)], [directoryRecord("SPLIT", 21, 10, 0x80)]]) {
      await expect(readBrowserIso(source(isoFixture(entries)))).rejects.toThrow();
    }
    const iso = isoFixture([directoryRecord("OK", 21, 10)]); iso[20 * 2048 + 6] = 1;
    await expect(readBrowserIso(source(iso))).rejects.toThrow("byte-order");
  });
  it("tolerates the reference disc's trailing manual only within actual track bounds", async () => {
    const iso = isoFixture([directoryRecord("MANUAL.PDF", 21, 3000)]);
    const view = new DataView(iso.buffer); view.setUint32(16 * 2048 + 80, 22, true); view.setUint32(16 * 2048 + 84, 22);
    expect(await readBrowserIso(source(iso))).toHaveLength(1);
  });
});

describe("InstallShield v6", () => {
  it.each([true, false])("extracts %s-compressed payload with MD5 verification", async compressed => {
    const fixture = cabinetFixture(new Uint8Array(70000).map((_, index) => index % 251), compressed);
    const parsed = readInstallShieldHeader(fixture.header);
    const output = await extractCabinetFile(parsed.files[0]!, source(fixture.cabinet), parsed.version);
    expect(new Uint8Array(await output.arrayBuffer())).toEqual(fixture.payload);
  });
  it("rejects checksum corruption, truncation, compression bombs and unsupported payload flags", async () => {
    const fixture = cabinetFixture();
    const { files, version } = readInstallShieldHeader(fixture.header); const file = files[0]!;
    await expect(extractCabinetFile({ ...file, md5: new Uint8Array(16) }, source(fixture.cabinet), version)).rejects.toThrow("MD5");
    await expect(extractCabinetFile(file, source(fixture.cabinet.slice(0, -1)), version)).rejects.toThrow("bounds");
    await expect(extractCabinetFile({ ...file, expanded: 1 }, source(fixture.cabinet), version)).rejects.toThrow("budget");
    for (const flags of [1, 2, 5]) await expect(extractCabinetFile({ ...file, flags }, source(fixture.cabinet), version)).rejects.toThrow("unsupported");
    await expect(extractCabinetFile({ ...file, links: 1 }, source(fixture.cabinet), version)).rejects.toThrow("linked");
    const badBlock = fixture.cabinet.slice(); badBlock[128] = 255; badBlock[129] = 255;
    await expect(extractCabinetFile(file, source(badBlock), version)).rejects.toThrow("bounds");
    await expect(extractCabinetFile({ ...file, path: "../escape" }, source(fixture.cabinet), version)).rejects.toThrow("Unsafe");
  });
  it("rejects invalid descriptor and string table offsets", () => {
    const fixture = cabinetFixture();
    const truncated = fixture.header.slice(0, -1);
    expect(() => readInstallShieldHeader(truncated)).toThrow("bounds");
    const bad = fixture.header.slice(); new DataView(bad.buffer).setUint32(132 + 58, 0xffffffff, true);
    expect(() => readInstallShieldHeader(bad)).toThrow("bounds");
    const newer = fixture.header.slice(); new DataView(newer.buffer).setUint32(4, 0x01007000, true);
    expect(() => readInstallShieldHeader(newer)).toThrow("version 7");
    new DataView(newer.buffer).setUint32(4, 0x03000258, true);
    expect(() => readInstallShieldHeader(newer)).toThrow("encoding");
  });
  it("cancels during compressed extraction before publishing a result", async () => {
    const fixture = cabinetFixture(new Uint8Array(70000));
    const parsed = readInstallShieldHeader(fixture.header); let cancelled = false;
    await expect(extractCabinetFile(parsed.files[0]!, source(fixture.cabinet), parsed.version,
      () => { if (cancelled) throw new DOMException("cancel", "AbortError"); }, () => { cancelled = true; }))
      .rejects.toHaveProperty("name", "AbortError");
  });
  it("runs CUE → BIN → ISO → CAB on synthetic data and rejects a missing cabinet", async () => {
    const fixture = cabinetFixture();
    const iso = isoFixture([directoryRecord("DATA1.HDR;1", 21, fixture.header.length), directoryRecord("DATA2.CAB;1", 22, fixture.cabinet.length)]);
    iso.set(fixture.header, 21 * 2048); iso.set(fixture.cabinet, 22 * 2048);
    const result = await extractDiscSources([{ path: "game.cue", blob: new Blob([cue]) }, { path: "game.bin", blob: new Blob([rawDisc(iso)]) }]);
    expect(result.sources[0]!.path).toBe("toastart/vehicles/wildfire.piz");
    expect(new Uint8Array(await result.sources[0]!.blob.arrayBuffer())).toEqual(fixture.payload);
    new DataView(iso.buffer).setUint16(21 * 2048 + 132 + 85, 3, true);
    await expect(extractDiscSources([{ path: "game.cue", blob: new Blob([cue]) }, { path: "game.bin", blob: new Blob([rawDisc(iso)]) }])).rejects.toThrow("DATA3.CAB");
  });
});
