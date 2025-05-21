// src/utils/formatPriceMan.js
export function formatPriceMan(v) {
  const amt = Number(v)
  if (!amt) return ''
  const eok = Math.floor(amt / 10000)
  const man = amt % 10000
  if (eok > 0) {
    return man > 0
      ? `${eok}억 ${man.toLocaleString()}만`
      : `${eok}억`
  }
  return `${amt.toLocaleString()}만`
}
