import React from 'react'
import { useRecommend } from './hooks/useRecommend'

// 가격 포맷 함수
function formatPriceMan(val) {
  const cleaned = String(val).replace(/,/g, "")
  const amt = Number(cleaned)
  if (Number.isNaN(amt) || amt <= 0) return '정보 없음'
  const eok = Math.floor(amt / 10000)
  const man = amt % 10000
  return eok > 0
    ? man > 0 ? `${eok}억 ${man.toLocaleString()}만` : `${eok}억`
    : `${amt.toLocaleString()}만`
}

// 면적 포맷 함수
function formatArea(val) {
  const sqm = Number(val)
  if (!sqm || isNaN(sqm)) return '-'
  const pyeong = (sqm / 3.3058).toFixed(2)
  return `${sqm.toFixed(2)}㎡ (${pyeong}평)`
}

export default function RecommendationList({ filters, onSelect, onRoute }) {
  const { data: listings = [], isLoading, isFetching, error } = useRecommend(filters)

  if (!filters) return null
  if ((isLoading || isFetching) && listings.length === 0) return <div>불러오는 중…</div>
  if (error) return <div>추천 정보를 불러오는 중 오류가 발생했습니다.</div>
  if (!isFetching && listings.length === 0) return <div>조건에 맞는 매물이 없습니다.</div>

  return (
    <>
      <h2 className="drawer-title">추천 매물</h2>
      <div className="cards-container">
        {listings.map(item => {
          const address = item.주소 || '주소 정보 없음'
          const name = item.단지명 || ''
          const deposit = Number(String(item.거래금액 || '').replace(/,/g, ''))
          const monthlyRent = Number(String(item.월세금액 || '').replace(/,/g, ''))
          const priceText = monthlyRent > 0
            ? `보증금 ${formatPriceMan(deposit)} / 월세 ${formatPriceMan(monthlyRent)}`
            : `가격 ${formatPriceMan(deposit)}`
          const areaText = formatArea(item.전용면적)
          const commuteText = item.통근시간 != null ? `${item.통근시간}분` : '-'
          const congestionText = item.avgCongestion != null ? `${item.avgCongestion}%` : '정보 없음'

          return (
            <div
              key={`${item.id}-${address}`}
              className="card"
              onClick={() => onSelect(item)}
            >
              {/* 헤더 */}
              <div className="card-header">
                <div className="card-address">{address}</div>
                {name && <div className="card-address">{name}</div>}
              </div>

              {/* 본문: 가격-면적-정보행 */}
              <div className="card-body">
                <div className="card-price">
              {monthlyRent > 0
                ? (
                  <>
                    보증금 <span className="price-highlight">
                      {formatPriceMan(deposit)}
                    </span>
                    {' '} / 월세{' '}
                    <span className="price-highlight">
                      {formatPriceMan(monthlyRent)}
                    </span>
                  </>
                )
                : (
                  <>가격 <span className="price-highlight">
                   {formatPriceMan(deposit)}
                  </span></>
                )
              }
            </div>
                <div className="card-area">면적: {areaText}</div>
                <div className="info-row">
                  <span className="card-area">통근시간: {commuteText}</span>
                  <span className="card-area">혼잡도: {congestionText}</span>
                  <button
                    className="btn-primary"
                    onClick={e => { e.stopPropagation(); onRoute(item) }}
                  >경로 확인</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
