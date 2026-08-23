export interface VehicleInputFrame {
  /** Forward in [0, 1], reverse in [-1, 0]. */
  drive: number;
  /** Left in [-1, 0], right in [0, 1]. */
  steer: number;
  brake: number;
  handbrake: number;
  recover: boolean;
}

export const NEUTRAL_VEHICLE_INPUT: Readonly<VehicleInputFrame> = Object.freeze({
  drive: 0,
  steer: 0,
  brake: 0,
  handbrake: 0,
  recover: false,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function applyDeadzone(value: number, deadzone = 0.12): number {
  const normalizedDeadzone = clamp(deadzone, 0, 0.99);
  const magnitude = Math.abs(clamp(value, -1, 1));
  if (magnitude <= normalizedDeadzone) {
    return 0;
  }
  return Math.sign(value) * ((magnitude - normalizedDeadzone) / (1 - normalizedDeadzone));
}

export function sanitizeVehicleInput(input: VehicleInputFrame): VehicleInputFrame {
  return {
    drive: clamp(Number.isFinite(input.drive) ? input.drive : 0, -1, 1),
    steer: clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1),
    brake: clamp(Number.isFinite(input.brake) ? input.brake : 0, 0, 1),
    handbrake: clamp(Number.isFinite(input.handbrake) ? input.handbrake : 0, 0, 1),
    recover: input.recover,
  };
}

function pressed(keys: ReadonlySet<string>, ...codes: string[]): boolean {
  return codes.some((code) => keys.has(code));
}

function gamepadButton(gamepad: Gamepad | undefined, index: number): number {
  return gamepad?.buttons[index]?.value ?? 0;
}

export interface BrowserVehicleInputOptions {
  gamepadIndex?: number;
  deadzone?: number;
}

/** Keyboard and first-gamepad adapter. It owns no simulation state. */
export class BrowserVehicleInput {
  readonly #target: Window;
  readonly #keys = new Set<string>();
  readonly #gamepadIndex: number;
  readonly #deadzone: number;
  readonly #onKeyDown: (event: KeyboardEvent) => void;
  readonly #onKeyUp: (event: KeyboardEvent) => void;
  #recoveryLatched = false;

  constructor(target: Window = window, options: BrowserVehicleInputOptions = {}) {
    this.#target = target;
    this.#gamepadIndex = options.gamepadIndex ?? 0;
    this.#deadzone = options.deadzone ?? 0.12;
    this.#onKeyDown = (event) => {
      if (event.code === "KeyR" && !event.repeat) {
        this.#recoveryLatched = true;
      }
      if (BrowserVehicleInput.#isDrivingKey(event.code)) {
        event.preventDefault();
        this.#keys.add(event.code);
      }
    };
    this.#onKeyUp = (event) => {
      this.#keys.delete(event.code);
    };
    target.addEventListener("keydown", this.#onKeyDown);
    target.addEventListener("keyup", this.#onKeyUp);
  }

  sample(gamepads: readonly (Gamepad | null)[] = navigator.getGamepads()): VehicleInputFrame {
    const gamepad = gamepads[this.#gamepadIndex] ?? undefined;
    const keyboardDrive = Number(pressed(this.#keys, "KeyW", "ArrowUp"))
      - Number(pressed(this.#keys, "KeyS", "ArrowDown"));
    const keyboardSteer = Number(pressed(this.#keys, "KeyD", "ArrowRight"))
      - Number(pressed(this.#keys, "KeyA", "ArrowLeft"));
    const triggerDrive = gamepadButton(gamepad, 7) - gamepadButton(gamepad, 6);
    const stickSteer = applyDeadzone(gamepad?.axes[0] ?? 0, this.#deadzone);
    const recover = this.#recoveryLatched || Boolean(gamepad?.buttons[3]?.pressed);
    this.#recoveryLatched = false;
    return sanitizeVehicleInput({
      drive: Math.abs(keyboardDrive) > Math.abs(triggerDrive) ? keyboardDrive : triggerDrive,
      steer: Math.abs(keyboardSteer) > Math.abs(stickSteer) ? keyboardSteer : stickSteer,
      brake: Math.max(
        Number(pressed(this.#keys, "ShiftLeft", "ShiftRight")),
        gamepadButton(gamepad, 0),
      ),
      handbrake: Math.max(Number(this.#keys.has("Space")), gamepadButton(gamepad, 1)),
      recover,
    });
  }

  dispose(): void {
    this.#target.removeEventListener("keydown", this.#onKeyDown);
    this.#target.removeEventListener("keyup", this.#onKeyUp);
    this.#keys.clear();
  }

  static #isDrivingKey(code: string): boolean {
    return [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
      "ShiftLeft",
      "ShiftRight",
      "Space",
    ].includes(code);
  }
}
