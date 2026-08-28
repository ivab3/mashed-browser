import { runStageFiveSoak } from "./stage-five-soak.js";

const startedAt = performance.now();
const report = runStageFiveSoak({ measureHeap: true });
console.log(JSON.stringify({
  ...report,
  wallSeconds: (performance.now() - startedAt) / 1000,
}, null, 2));

