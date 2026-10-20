import assert from "node:assert/strict";
import { after, test as nodeTest } from "node:test";

// Runs this repository's existing Bun assertions on Node when Bun is unavailable.
export const test = nodeTest;
export const afterAll = after;
export function expect(actual: unknown) {
    return {
        toBe(expected: unknown) { assert.equal(actual, expected); },
        toBeCloseTo(expected: number, precision = 2) { assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 0.5 * 10 ** -precision, `${actual} is not close to ${expected} at precision ${precision}`); },
        toBeGreaterThanOrEqual(expected: number) { assert.ok(typeof actual === "number" && actual >= expected, `${actual} < ${expected}`); },
        toBeLessThanOrEqual(expected: number) { assert.ok(typeof actual === "number" && actual <= expected, `${actual} > ${expected}`); },
        toBeLessThan(expected: number) { assert.ok(typeof actual === "number" && actual < expected, `${actual} >= ${expected}`); },
    };
}
