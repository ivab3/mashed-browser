/** Finds unique owned ArrayBuffers in a structured-clone-compatible asset DTO. */
export function transferablesIn(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new WeakSet<object>();
  const visit = (entry: unknown): void => {
    if (entry === null || typeof entry !== "object") {
      return;
    }
    if (ArrayBuffer.isView(entry)) {
      if (entry.buffer instanceof ArrayBuffer) {
        buffers.add(entry.buffer);
      }
      return;
    }
    if (entry instanceof ArrayBuffer) {
      buffers.add(entry);
      return;
    }
    if (visited.has(entry)) {
      return;
    }
    visited.add(entry);
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    Object.values(entry).forEach(visit);
  };
  visit(value);
  return [...buffers];
}
