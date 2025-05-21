// src/utils/formatPrice.js
export function formatPrice(raw) {
  const price = Number(raw)
  const eok   = Math.floor(price / 100000000)
  const rest  = price % 100000000
  if (eok > 0) {
    return `${eok}억 ${rest.toLocaleString()}원`
  }
  return `${price.toLocaleString()}원`
}
