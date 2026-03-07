import { isDeepStrictEqual } from "node:util";
import JSON5 from "json5";

export function replaceSensitiveValuesInRaw(params: {
  raw: string;
  sensitiveValues: string[];
  redactedSentinel: string;
}): string {
  const sentinel = params.redactedSentinel;
  const values = [...params.sensitiveValues]
    .filter((v) => v.length > 0)
    // Skip values that are substrings of the sentinel — replacing them would
    // expand sentinels already inserted by earlier iterations, causing
    // exponential string growth (RangeError: Invalid string length).
    .filter((v) => !sentinel.includes(v))
    // Skip values that contain the sentinel — replacing other occurrences
    // of this value would multiply sentinel instances, also causing growth.
    .filter((v) => !v.includes(sentinel))
    // Very short values (1-3 chars) can match thousands of times in a large
    // config string, inflating the result beyond V8's max string length.
    .filter((v) => v.length >= 4)
    .toSorted((a, b) => b.length - a.length);
  let result = params.raw;
  for (const value of values) {
    try {
      result = result.replaceAll(value, sentinel);
    } catch {
      // RangeError: Invalid string length — bail out and return the
      // partially-redacted string. The caller's
      // shouldFallbackToStructuredRawRedaction() will detect the
      // mismatch and fall back to structured JSON output.
      return result;
    }
  }
  return result;
}

export function shouldFallbackToStructuredRawRedaction(params: {
  redactedRaw: string;
  originalConfig: unknown;
  restoreParsed: (parsed: unknown) => { ok: boolean; result?: unknown };
}): boolean {
  try {
    const parsed = JSON5.parse(params.redactedRaw);
    const restored = params.restoreParsed(parsed);
    if (!restored.ok) {
      return true;
    }
    return !isDeepStrictEqual(restored.result, params.originalConfig);
  } catch {
    return true;
  }
}
