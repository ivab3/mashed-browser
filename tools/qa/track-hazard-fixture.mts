import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Generated QA placements only. No original model or source course is embedded here.
const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("Pass an existing empty temporary output directory");
// The default debug grid is centred at [-4, 1.05, -8]. One falling barrel arms on impact and
// chains the grounded barrel; both two-player grid slots are inside both five-metre blasts.
const positions = [[-4, 5, -8], [-2, 0.16, -8]];
const bytes = new Uint8Array(4 + positions.length * 76);
const view = new DataView(bytes.buffer);
view.setUint32(0, positions.length, true);
for (const [index, position] of positions.entries()) {
  const offset = 4 + index * 76;
  for (const [field, value] of [[0, 13], [4, 64], [8, 0x1c02000a], [12, 1], [16, 52], [20, 0x1c02000a], [72, 3]]) {
    view.setUint32(offset + field!, value!, true);
  }
  [1, 0, 0, 0, 1, 0, 0, 0, 1, ...position].forEach((value, field) => view.setFloat32(offset + 24 + field * 4, value, true));
}
await writeFile(resolve(outputDirectory, "RBARREL.MTS"), bytes, { flag: "wx" });
await writeFile(resolve(outputDirectory, "COURSE.LUA"), `-- Synthetic QA fixture: not the original Warzone course.
Course_Id(33)
Clump_Filename(1, "RBarrel.dff")
Clump_Exclude_From_World(1)
Mts_Filename(2, "RBarrel.mts")
ExpObj_Clump_Mts_Pair(1, 2)
`, { flag: "wx" });
console.log(`Generated two synthetic starting-grid barrel placements in ${resolve(outputDirectory)}. In a fresh browser tab, load these files plus your local RBARREL.DFF, select two players, then Start simulation.`);
