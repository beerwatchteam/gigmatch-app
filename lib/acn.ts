/** Weights for the Australian Securities and Investments Commission ACN checksum algorithm. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Validates an ACN using the official ASIC checksum algorithm:
 *  1. Strip all whitespace.
 *  2. Require exactly 9 digits.
 *  3. Multiply each of the first 8 digits by its corresponding weight.
 *  4. Sum the products.
 *  5. Check digit = (10 - (sum % 10)) % 10 — must equal the 9th digit.
 */
export function isValidACN(input: string): boolean {
  const digits = input.replace(/\s/g, '');
  if (!/^\d{9}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  const sum = d.slice(0, 8).reduce((acc, v, i) => acc + v * WEIGHTS[i], 0);
  const check = (10 - (sum % 10)) % 10;
  return d[8] === check;
}

/**
 * Formats a digit string as "XXX XXX XXX".
 * Strips all non-digits first. Returns the raw string unchanged if it is not
 * exactly 9 digits (e.g. while the user is still typing).
 * Store the unformatted digits in Firestore; use this only for display.
 */
export function formatACN(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 9) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
}
