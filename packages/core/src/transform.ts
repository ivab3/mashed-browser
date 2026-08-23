export type Vector3Tuple = readonly [number, number, number];
export type QuaternionTuple = readonly [number, number, number, number];

export interface SimulationTransform {
  position: Vector3Tuple;
  rotation: QuaternionTuple;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function cloneTransform(transform: SimulationTransform): SimulationTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
  };
}

export function interpolateTransform(
  previous: SimulationTransform,
  current: SimulationTransform,
  rawAlpha: number,
): SimulationTransform {
  const alpha = Math.min(1, Math.max(0, rawAlpha));
  const dot = previous.rotation[0] * current.rotation[0]
    + previous.rotation[1] * current.rotation[1]
    + previous.rotation[2] * current.rotation[2]
    + previous.rotation[3] * current.rotation[3];
  const direction = dot < 0 ? -1 : 1;
  const rotation: [number, number, number, number] = [
    lerp(previous.rotation[0], current.rotation[0] * direction, alpha),
    lerp(previous.rotation[1], current.rotation[1] * direction, alpha),
    lerp(previous.rotation[2], current.rotation[2] * direction, alpha),
    lerp(previous.rotation[3], current.rotation[3] * direction, alpha),
  ];
  const length = Math.hypot(...rotation);
  if (length > 0) {
    rotation[0] /= length;
    rotation[1] /= length;
    rotation[2] /= length;
    rotation[3] /= length;
  }
  return {
    position: [
      lerp(previous.position[0], current.position[0], alpha),
      lerp(previous.position[1], current.position[1], alpha),
      lerp(previous.position[2], current.position[2], alpha),
    ],
    rotation,
  };
}
