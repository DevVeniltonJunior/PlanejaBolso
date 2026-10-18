/** Rounds to cents, avoiding floating point residue (e.g. 0.1 + 0.2). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((a, b) => a + b, 0))
}

/**
 * Parses user input such as "1.250,50", "1250,5", "1250.50" or "R$ 1.250".
 * Returns `null` for empty or invalid input.
 */
export function parseMoney(input: string): number | null {
  let s = input.replace(/R\$|\s/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? roundMoney(n) : null
}
