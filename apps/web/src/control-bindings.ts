import type { VehicleKeyboardBindings } from "@mashed/input";

export const CONTROL_BINDING_ACTIONS = [
  "forward",
  "reverse",
  "left",
  "right",
  "brake",
  "handbrake",
  "recover",
  "useItem",
] as const;

export type ControlBindingAction = (typeof CONTROL_BINDING_ACTIONS)[number];

export interface ControlBindingsV1 {
  readonly version: 1;
  readonly playerOne: Readonly<Record<ControlBindingAction, string>>;
}

interface BindingsKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ControlBindingsLoadResult =
  | { ok: true; bindings: ControlBindingsV1; restored: boolean }
  | { ok: false; error: string; bindings: ControlBindingsV1; restored: false };

export type ControlBindingsSaveResult =
  | { ok: true }
  | { ok: false; error: string };

const STORAGE_KEY = "mashed-browser:bindings:v1";
const RESERVED_CODES = new Set([
  "Escape",
  "KeyC",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftRight",
  "Enter",
  "Backslash",
  "Slash",
]);
const AUXILIARY_CODES = new Set([
  "Space", "ShiftLeft", "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "Comma", "Period", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Minus", "Equal", "Backquote",
  "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter",
]);

export const DEFAULT_CONTROL_BINDINGS: ControlBindingsV1 = Object.freeze({
  version: 1,
  playerOne: Object.freeze({
    forward: "KeyW",
    reverse: "KeyS",
    left: "KeyA",
    right: "KeyD",
    brake: "ShiftLeft",
    handbrake: "Space",
    recover: "KeyR",
    useItem: "KeyE",
  }),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRebindableKeyboardCode(code: string): boolean {
  const knownCode = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(code) || AUXILIARY_CODES.has(code);
  return knownCode && !RESERVED_CODES.has(code);
}

/** Strictly validates one-key-per-action P1 bindings and protects P2/global reserved keys. */
export function parseControlBindings(value: unknown): ControlBindingsV1 {
  if (!isRecord(value)) {
    throw new Error("Control bindings must be an object");
  }
  const rootKeys = Object.keys(value);
  if (rootKeys.some((key) => key !== "version" && key !== "playerOne")) {
    throw new Error("Control bindings contain an unsupported field");
  }
  if (value["version"] !== 1 || !isRecord(value["playerOne"])) {
    throw new Error("Unsupported control bindings version or player record");
  }
  const playerOne = value["playerOne"];
  const actionSet = new Set<string>(CONTROL_BINDING_ACTIONS);
  const unexpectedAction = Object.keys(playerOne).find((key) => !actionSet.has(key));
  if (unexpectedAction) {
    throw new Error(`Control binding action ${unexpectedAction} is not supported`);
  }
  const result = {} as Record<ControlBindingAction, string>;
  for (const action of CONTROL_BINDING_ACTIONS) {
    const code = playerOne[action];
    if (typeof code !== "string" || !isRebindableKeyboardCode(code)) {
      throw new Error(`Control binding ${action} has an invalid or reserved key code`);
    }
    result[action] = code;
  }
  if (new Set(Object.values(result)).size !== CONTROL_BINDING_ACTIONS.length) {
    throw new Error("Control bindings must use one unique key per action");
  }
  return Object.freeze({ version: 1, playerOne: Object.freeze(result) });
}

/** Rebinds one action; assigning an occupied key swaps the two actions instead of duplicating input. */
export function rebindControlAction(
  bindings: ControlBindingsV1,
  action: ControlBindingAction,
  code: string,
): ControlBindingsV1 {
  const current = parseControlBindings(bindings);
  if (!isRebindableKeyboardCode(code)) {
    throw new Error(`Key ${code || "(empty)"} is reserved or unsupported`);
  }
  const next = { ...current.playerOne };
  const previousCode = next[action];
  const occupiedAction = CONTROL_BINDING_ACTIONS.find((candidate) => next[candidate] === code);
  if (occupiedAction && occupiedAction !== action) {
    next[occupiedAction] = previousCode;
  }
  next[action] = code;
  return parseControlBindings({ version: 1, playerOne: next });
}

export function vehicleKeyboardBindings(bindings: ControlBindingsV1): VehicleKeyboardBindings {
  const playerOne = parseControlBindings(bindings).playerOne;
  return {
    forward: [playerOne.forward],
    reverse: [playerOne.reverse],
    left: [playerOne.left],
    right: [playerOne.right],
    brake: [playerOne.brake],
    handbrake: [playerOne.handbrake],
    recover: [playerOne.recover],
    useItem: [playerOne.useItem],
  };
}

export function formatKeyboardCode(code: string): string {
  const labels: Readonly<Record<string, string>> = {
    Space: "Space",
    ShiftLeft: "Left Shift",
    ControlLeft: "Left Ctrl",
    AltLeft: "Left Alt",
    ShiftRight: "Right Shift",
    ControlRight: "Right Ctrl",
    AltRight: "Right Alt",
  };
  return labels[code] ?? (code.startsWith("Key") || code.startsWith("Digit") ? code.replace(/^(Key|Digit)/, "") : code);
}

export class ControlBindingsStorage {
  readonly #getStorage: () => BindingsKeyValueStorage;

  constructor(getStorage: () => BindingsKeyValueStorage) {
    this.#getStorage = getStorage;
  }

  load(): ControlBindingsLoadResult {
    try {
      const serialized = this.#getStorage().getItem(STORAGE_KEY);
      return serialized === null
        ? { ok: true, bindings: DEFAULT_CONTROL_BINDINGS, restored: false }
        : { ok: true, bindings: parseControlBindings(JSON.parse(serialized)), restored: true };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
        bindings: DEFAULT_CONTROL_BINDINGS,
        restored: false,
      };
    }
  }

  save(bindings: ControlBindingsV1): ControlBindingsSaveResult {
    try {
      const validated = parseControlBindings(bindings);
      this.#getStorage().setItem(STORAGE_KEY, JSON.stringify(validated));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }
}
