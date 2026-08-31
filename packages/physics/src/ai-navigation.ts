import { createAiNavigationTargets, type AiNavigationTarget, type AiRouteDriverState } from "@mashed/core";
import type { PhysicsRuntime } from "./index.js";

/** Deterministic chassis-width feelers against the same collision scene used by projectiles. */
export function probeAiNavigation(
  runtime: Pick<PhysicsRuntime, "castProjectileSegment">,
  state: AiRouteDriverState,
): readonly AiNavigationTarget[] {
  return createAiNavigationTargets(state).map((target) => {
    const dx = target.position[0] - state.position[0];
    const dz = target.position[2] - state.position[2];
    const length = Math.hypot(dx, dz);
    let clearance = 1;
    if (length > 1e-5) {
      const distance = Math.min(length, 8);
      for (const side of [-0.65, 0, 0.65]) {
        const start = [state.position[0] + dz / length * side, state.position[1], state.position[2] - dx / length * side] as const;
        const end = [start[0] + dx / length * distance, start[1], start[2] + dz / length * distance] as const;
        const hit = runtime.castProjectileSegment(start, end);
        if (hit && Math.abs(hit.normal[1]) < 0.5) {
          clearance = Math.min(clearance, hit.fraction);
        }
      }
    }
    return { ...target, clearance };
  });
}
