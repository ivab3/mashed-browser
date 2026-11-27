import { wantedArchive, type ImportProgress, type ImportSource } from "./browser-import.js";
import { BrowserMode1Reader, discExtent, parseBrowserCue, readBrowserIso, requireDisc, type CheckImport } from "./disc-reader.js";
import { extractCabinetFile, readInstallShieldHeader } from "./installshield.js";

export async function extractDiscSources(
  inputs: readonly ImportSource[], progress: (value: ImportProgress) => void = () => {}, check: CheckImport = () => {},
): Promise<{ sources: ImportSource[]; rawBytesRead: number }> {
  const cues = inputs.filter((source) => /\.cue$/i.test(source.path));
  const bins = inputs.filter((source) => /\.bin$/i.test(source.path));
  requireDisc(inputs.length === 2 && cues.length === 1 && bins.length === 1,
    "Select both the .cue and its .bin file together (one of each)");
  requireDisc(cues[0]!.blob.size <= 65536, "CUE is too large");
  const cue = parseBrowserCue(await cues[0]!.blob.text());
  const bin = bins[0]!;
  requireDisc(bin.path.replaceAll("\\", "/").split("/").at(-1)!.toLowerCase() === cue.binName,
    `The selected BIN does not match the CUE. Select ${cue.binName}`);
  check();
  progress({ completed: 0, total: 1, label: "Reading disc filesystem…" });
  const reader = new BrowserMode1Reader(bin.blob, cue.startSector, check);
  const entries = await readBrowserIso(reader, check);
  const headers = entries.filter((entry) => !entry.directory && /(^|\/)data1\.hdr$/.test(entry.path));
  requireDisc(headers.length === 1, "Disc must contain exactly one InstallShield DATA1.HDR");
  const headerEntry = headers[0]!;
  requireDisc(headerEntry.size <= 8 * 1024 * 1024, "InstallShield header exceeds the 8 MiB budget");
  const header = readInstallShieldHeader(await reader.read(headerEntry.offset, headerEntry.size));
  const base = headerEntry.path.slice(0, -"data1.hdr".length);
  const files = header.files.filter((file) => wantedArchive(file.path) || file.path === "toastaudio/pc/audio/pcdics/permdict.rws");
  requireDisc(files.length > 0, "No supported Mashed game archives were found on this disc");
  const seen = new Set<string>();
  const total = files.reduce((sum, file) => sum + file.expanded, 0);
  requireDisc(Number.isSafeInteger(total) && total <= 256 * 1024 * 1024, "Selected disc content exceeds the 256 MiB budget");
  const sources: ImportSource[] = [];
  let completed = 0;
  for (const file of files) {
    check();
    requireDisc(!seen.has(file.path), `Duplicate InstallShield resource: ${file.path}`);
    seen.add(file.path);
    const cabinet = entries.find((entry) => !entry.directory && entry.path === `${base}data${file.volume}.cab`);
    requireDisc(cabinet, `Missing InstallShield DATA${file.volume}.CAB volume`);
    try {
      const blob = await extractCabinetFile(file, discExtent(reader, cabinet), header.version, check, (bytes) => {
        progress({ completed: completed + bytes, total, unit: "bytes",
          label: `Extracting ${file.path.split("/").at(-1)} · ${((completed + bytes) / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` });
      });
      sources.push({ path: file.path, blob });
      completed += blob.size;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new Error(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { sources, rawBytesRead: reader.bytesRead };
}
