export interface CameraSubject {
  position: readonly [number, number, number];
}

export interface SharedCameraFit {
  center: readonly [number, number, number];
  radiusMeters: number;
  trailMeters: number;
  heightMeters: number;
  lookAheadMeters: number;
}

const MAX_FIT_RADIUS_METERS = 20;

/** Pure multiplayer framing contract; rendering interpolation stays outside this calculation. */
export function fitSharedCamera(subjects: readonly CameraSubject[]): SharedCameraFit {
  if (subjects.length === 0) {
    throw new Error("Shared camera requires at least one subject");
  }
  const center = subjects.reduce<[number, number, number]>((sum, subject) => {
    if (subject.position.some((component) => !Number.isFinite(component))) {
      throw new Error("Shared camera subjects must have finite positions");
    }
    sum[0] += subject.position[0];
    sum[1] += subject.position[1];
    sum[2] += subject.position[2];
    return sum;
  }, [0, 0, 0]);
  center[0] /= subjects.length;
  center[1] /= subjects.length;
  center[2] /= subjects.length;

  let radiusMeters = 0;
  for (const subject of subjects) {
    radiusMeters = Math.max(radiusMeters, Math.hypot(
      subject.position[0] - center[0],
      subject.position[1] - center[1],
      subject.position[2] - center[2],
    ));
  }
  const fittedRadius = Math.min(radiusMeters, MAX_FIT_RADIUS_METERS);
  return {
    center,
    radiusMeters,
    trailMeters: 10 + fittedRadius * 1.15,
    heightMeters: 7.2 + fittedRadius * 0.95,
    lookAheadMeters: Math.max(0.75, 3 - fittedRadius * 0.18),
  };
}
