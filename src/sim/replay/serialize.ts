/**
 * Canonical serialization.
 *
 * Procedure (documented, brief section 6):
 * - Objects serialize with keys in ascending UTF-16 lexicographic order.
 * - Arrays serialize in element order.
 * - Permitted leaf values: finite integers, booleans, strings, null.
 * - Rejected outright: undefined, functions, symbols, bigint, NaN/Infinity,
 *   non-integer numbers, Map, Set, Date, class instances (anything whose
 *   prototype is not Object.prototype or Array.prototype).
 *
 * Canonical state is integers-only by construction; rejecting non-integer
 * numbers here turns any accidental float leak into a loud failure instead of
 * a silent cross-platform hash divergence.
 */
export function canonicalSerialize(value: unknown): string {
  const out: string[] = [];
  writeValue(value, out, '$');
  return out.join('');
}

function writeValue(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`canonical-serialize-non-integer-number at ${path}: ${value}`);
      }
      out.push(String(value));
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'object':
      break;
    default:
      throw new Error(`canonical-serialize-unsupported-type at ${path}: ${typeof value}`);
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      writeValue(value[i], out, `${path}[${i}]`);
    }
    out.push(']');
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`canonical-serialize-non-plain-object at ${path}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  out.push('{');
  let first = true;
  for (const key of keys) {
    const v = record[key];
    if (v === undefined) {
      throw new Error(`canonical-serialize-undefined-value at ${path}.${key}`);
    }
    if (!first) out.push(',');
    first = false;
    out.push(JSON.stringify(key), ':');
    writeValue(v, out, `${path}.${key}`);
  }
  out.push('}');
}
