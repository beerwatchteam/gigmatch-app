/** Weights for the Australian Business Register ABN checksum algorithm. */
const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/**
 * Validates an ABN using the official Australian checksum algorithm:
 *  1. Strip all whitespace.
 *  2. Require exactly 11 digits.
 *  3. Subtract 1 from the first digit.
 *  4. Multiply each digit by its corresponding weight.
 *  5. The sum must be divisible by 89.
 */
export function isValidABN(input: string): boolean {
  const digits = input.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  d[0] = d[0] - 1;
  const sum = d.reduce((acc, v, i) => acc + v * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/**
 * Formats a digit string as "XX XXX XXX XXX".
 * Strips all non-digits first. Returns the raw string unchanged if it is not
 * exactly 11 digits (e.g. while the user is still typing).
 * Store the unformatted digits in Firestore; use this only for display.
 */
export function formatABN(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}
