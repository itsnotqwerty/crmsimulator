const UINT32_RANGE = 0x1_0000_0000;

export interface RandomResult {
  value: number;
  cursor: number;
}

function mix(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

export function randomAt(seed: number, cursor: number): number {
  const input = (seed + Math.imul(cursor + 1, 0x9e3779b9)) >>> 0;
  return mix(input) / UINT32_RANGE;
}

export function nextRandom(seed: number, cursor: number): RandomResult {
  return { value: randomAt(seed, cursor), cursor: cursor + 1 };
}

export function randomInteger(
  seed: number,
  cursor: number,
  minimum: number,
  maximum: number,
): RandomResult {
  if (
    !Number.isInteger(minimum) || !Number.isInteger(maximum) ||
    maximum < minimum
  ) {
    throw new RangeError("Random integer bounds must be ordered integers");
  }

  const result = nextRandom(seed, cursor);
  return {
    value: minimum + Math.floor(result.value * (maximum - minimum + 1)),
    cursor: result.cursor,
  };
}

export function pick<T>(
  values: readonly T[],
  seed: number,
  cursor: number,
): { value: T; cursor: number } {
  if (values.length === 0) {
    throw new RangeError("Cannot choose from an empty collection");
  }

  const result = randomInteger(seed, cursor, 0, values.length - 1);
  return { value: values[result.value], cursor: result.cursor };
}
