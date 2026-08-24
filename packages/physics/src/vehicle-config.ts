import rawDefaultConfig from "../data/arcade-default.json" with { type: "json" };

export type Vector3Config = readonly [number, number, number];
export type SurfaceType = "asphalt" | "ice" | "sand" | "mud";
export type SteeringSpeedCurve = "linear" | "reciprocal";

export interface SurfaceHandlingConfig {
  frictionSlip: number;
  sideFriction: number;
  engine: number;
  rollingBrake: number;
}

export interface VehicleConfig {
  id: string;
  displayName: string;
  spawn: { position: Vector3Config; headingRadians: number };
  chassis: {
    mass: number;
    halfExtents: Vector3Config;
    noseHalfExtents: Vector3Config;
    noseOffset: Vector3Config;
    centerOfMass: Vector3Config;
    linearDamping: number;
    angularDamping: number;
  };
  wheels: {
    connectionPoints: readonly [Vector3Config, Vector3Config, Vector3Config, Vector3Config];
    radius: number;
    suspensionRestLength: number;
    maxSuspensionTravel: number;
    suspensionStiffness: number;
    suspensionCompression: number;
    suspensionRelaxation: number;
    maxSuspensionForce: number;
  };
  drive: {
    engineForce: number;
    reverseForce: number;
    initialThrottleFactor: number;
    throttleRampSeconds: number;
    serviceBrakeForce: number;
    handbrakeForce: number;
    reverseEngageSpeed: number;
    maxForwardSpeed: number;
    maxReverseSpeed: number;
    maxSteeringAngle: number;
    steeringResponse: number;
    steeringSpeedCurve: SteeringSpeedCurve;
    steeringSpeedAttenuation: number;
    drivenWheels: readonly number[];
  };
  handling: {
    baseFrictionSlip: number;
    baseSideFriction: number;
    handbrakeRearGrip: number;
    downforce: number;
    uprightStrength: number;
    uprightDamping: number;
  };
  recovery: {
    lift: number;
    autoDelaySeconds: number;
    maximumUprightDot: number;
    maximumAutoSpeed: number;
  };
  surfaces: Record<SurfaceType, SurfaceHandlingConfig>;
}

export const DEFAULT_VEHICLE_CONFIG = rawDefaultConfig as unknown as VehicleConfig;
