export interface VehicleInputFrame {
  /** Forward in [0, 1], reverse in [-1, 0]. */
  drive: number;
  /** Left in [-1, 0], right in [0, 1]. */
  steer: number;
  brake: number;
  handbrake: number;
  recover: boolean;
  /** One-shot item activation; optional for backward-compatible recorded input tapes. */
  useItem?: boolean;
}

export const NEUTRAL_VEHICLE_INPUT: Readonly<VehicleInputFrame> = Object.freeze({
  drive: 0,
  steer: 0,
  brake: 0,
  handbrake: 0,
  recover: false,
  useItem: false,
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
    useItem: Boolean(input.useItem),
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
  keyboard?: VehicleKeyboardBindings;
}

export interface VehicleKeyboardBindings {
  forward: readonly string[];
  reverse: readonly string[];
  left: readonly string[];
  right: readonly string[];
  brake: readonly string[];
  handbrake: readonly string[];
  recover: readonly string[];
  useItem: readonly string[];
}

export const PLAYER_ONE_KEYBOARD_BINDINGS: VehicleKeyboardBindings = Object.freeze({
  forward: ["KeyW"],
  reverse: ["KeyS"],
  left: ["KeyA"],
  right: ["KeyD"],
  brake: ["ShiftLeft"],
  handbrake: ["Space"],
  recover: ["KeyR"],
  useItem: ["KeyE"],
});

export const PLAYER_TWO_KEYBOARD_BINDINGS: VehicleKeyboardBindings = Object.freeze({
  forward: ["ArrowUp"],
  reverse: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  brake: ["ShiftRight"],
  handbrake: ["Enter"],
  recover: ["Backslash"],
  useItem: ["Slash"],
});

export const GAMEPAD_ONLY_KEYBOARD_BINDINGS: VehicleKeyboardBindings = Object.freeze({
  forward: [],
  reverse: [],
  left: [],
  right: [],
  brake: [],
  handbrake: [],
  recover: [],
  useItem: [],
});

export const SINGLE_PLAYER_KEYBOARD_BINDINGS: VehicleKeyboardBindings = Object.freeze({
  forward: [...PLAYER_ONE_KEYBOARD_BINDINGS.forward, ...PLAYER_TWO_KEYBOARD_BINDINGS.forward],
  reverse: [...PLAYER_ONE_KEYBOARD_BINDINGS.reverse, ...PLAYER_TWO_KEYBOARD_BINDINGS.reverse],
  left: [...PLAYER_ONE_KEYBOARD_BINDINGS.left, ...PLAYER_TWO_KEYBOARD_BINDINGS.left],
  right: [...PLAYER_ONE_KEYBOARD_BINDINGS.right, ...PLAYER_TWO_KEYBOARD_BINDINGS.right],
  brake: ["ShiftLeft", "ShiftRight"],
  handbrake: ["Space"],
  recover: ["KeyR"],
  useItem: ["KeyE", "Slash"],
});

/** Keyboard and first-gamepad adapter. It owns no simulation state. */
export class BrowserVehicleInput {
  readonly #target: Window;
  readonly #keys = new Set<string>();
  readonly #gamepadIndex: number;
  readonly #deadzone: number;
  readonly #keyboard: VehicleKeyboardBindings;
  readonly #onKeyDown: (event: KeyboardEvent) => void;
  readonly #onKeyUp: (event: KeyboardEvent) => void;
  #recoveryLatched = false;
  #useItemLatched = false;
  #gamepadUseWasPressed = false;

  constructor(target: Window = window, options: BrowserVehicleInputOptions = {}) {
    this.#target = target;
    this.#gamepadIndex = options.gamepadIndex ?? 0;
    this.#deadzone = options.deadzone ?? 0.12;
    this.#keyboard = options.keyboard ?? SINGLE_PLAYER_KEYBOARD_BINDINGS;
    this.#onKeyDown = (event) => {
      if (this.#keyboard.recover.includes(event.code) && !event.repeat) {
        this.#recoveryLatched = true;
      }
      if (this.#keyboard.useItem.includes(event.code) && !event.repeat) {
        this.#useItemLatched = true;
      }
      if (this.#isHandledKey(event.code)) {
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
    const keyboardDrive = Number(pressed(this.#keys, ...this.#keyboard.forward))
      - Number(pressed(this.#keys, ...this.#keyboard.reverse));
    const keyboardSteer = Number(pressed(this.#keys, ...this.#keyboard.right))
      - Number(pressed(this.#keys, ...this.#keyboard.left));
    const triggerDrive = gamepadButton(gamepad, 7) - gamepadButton(gamepad, 6);
    const stickSteer = applyDeadzone(gamepad?.axes[0] ?? 0, this.#deadzone);
    const recover = this.#recoveryLatched || Boolean(gamepad?.buttons[3]?.pressed);
    const gamepadUsePressed = Boolean(gamepad?.buttons[2]?.pressed);
    const useItem = this.#useItemLatched || (gamepadUsePressed && !this.#gamepadUseWasPressed);
    this.#gamepadUseWasPressed = gamepadUsePressed;
    this.#recoveryLatched = false;
    this.#useItemLatched = false;
    return sanitizeVehicleInput({
      drive: Math.abs(keyboardDrive) > Math.abs(triggerDrive) ? keyboardDrive : triggerDrive,
      steer: Math.abs(keyboardSteer) > Math.abs(stickSteer) ? keyboardSteer : stickSteer,
      brake: Math.max(
        Number(pressed(this.#keys, ...this.#keyboard.brake)),
        gamepadButton(gamepad, 0),
      ),
      handbrake: Math.max(
        Number(pressed(this.#keys, ...this.#keyboard.handbrake)),
        gamepadButton(gamepad, 1),
      ),
      recover,
      useItem,
    });
  }

  dispose(): void {
    this.#target.removeEventListener("keydown", this.#onKeyDown);
    this.#target.removeEventListener("keyup", this.#onKeyUp);
    this.#keys.clear();
  }

  #isHandledKey(code: string): boolean {
    return [
      ...this.#keyboard.forward,
      ...this.#keyboard.reverse,
      ...this.#keyboard.left,
      ...this.#keyboard.right,
      ...this.#keyboard.brake,
      ...this.#keyboard.handbrake,
      ...this.#keyboard.recover,
      ...this.#keyboard.useItem,
    ].includes(code);
  }
}
