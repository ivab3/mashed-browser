import { runVehicleTuningSuite } from "./tuning.js";

console.log(JSON.stringify(await runVehicleTuningSuite(), null, 2));
