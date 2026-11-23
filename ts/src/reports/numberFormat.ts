const float64View = new Float64Array(1);
const bigUint64View = new BigUint64Array(float64View.buffer);

/**
 * Formats a finite IEEE-754 binary64 number to fixed decimal places using exact
 * binary64 round-half-to-even semantics, matching C++ `fmt::format("{:.Nf}", value)`.
 */
export function formatFixedHalfToEven(value: number, digits: number): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }

    if (value === 0) {
        return digits === 0 ? '0' : `0.${'0'.repeat(digits)}`;
    }

    const negative = value < 0;
    const absValue = Math.abs(value);

    float64View[0] = absValue;
    const bits = bigUint64View[0] ?? 0n;

    const biasedExp = Number((bits >> 52n) & 0x7ffn);
    const frac = bits & ((1n << 52n) - 1n);

    const mantissa = biasedExp === 0 ? frac : (1n << 52n) | frac;
    const exp2 = biasedExp === 0 ? -1074 : biasedExp - 1023 - 52;

    const scale10 = 10n ** BigInt(digits);
    let rounded: bigint;

    if (exp2 >= 0) {
        rounded = (mantissa * scale10) << BigInt(exp2);
    } else {
        const shift = BigInt(-exp2);
        const numerator = mantissa * scale10;
        const quotient = numerator >> shift;
        const remainder = numerator & ((1n << shift) - 1n);
        const half = 1n << (shift - 1n);

        if (remainder > half || (remainder === half && (quotient & 1n) === 1n)) {
            rounded = quotient + 1n;
        } else {
            rounded = quotient;
        }
    }

    const signPrefix = negative ? '-' : '';
    const raw = rounded.toString();

    if (digits === 0) {
        return `${signPrefix}${raw}`;
    }

    const padded = raw.padStart(digits + 1, '0');
    const intPart = padded.slice(0, padded.length - digits);
    const fracPart = padded.slice(padded.length - digits);

    return `${signPrefix}${intPart}.${fracPart}`;
}
