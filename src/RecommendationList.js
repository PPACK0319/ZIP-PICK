import React, { useMemo, useState } from 'react'
import { useRecommend } from './hooks/useRecommend'
import { getListingTypeChipStyle } from './listingStyle'

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

function parseNumber(val) {
  const num = Number(String(val ?? '').replace(/,/g, ''))
  return Number.isFinite(num) ? num : 0
}

function parseOptionalNumber(val) {
  const num = Number(String(val ?? '').replace(/,/g, ''))
  return Number.isFinite(num) ? num : null
}

function priceScore(item) {
  const deposit = parseNumber(item.거래금액)
  const monthlyRent = parseNumber(item.월세금액)
  return deposit + monthlyRent * 12
}

function getAnnualBurden(item) {
  const provided = parseNumber(item.환산금액)
  return provided > 0 ? provided : priceScore(item)
}

function getPriceGapPercent(item, filters) {
  const provided = parseOptionalNumber(item.priceGapPercent)
  if (provided != null) return provided

  const budget = getFilterBudget(filters)
  if (budget == null || budget <= 0) return priceScore(item)
  return Math.abs(getAnnualBurden(item) - budget) / budget * 100
}

function getSortValue(item, sortBy, filters) {
  if (sortBy === 'recommend') return item.recommendationScore ?? 0
  if (sortBy === 'price') return getPriceGapPercent(item, filters)
  if (sortBy === 'area') return parseNumber(item.전용면적)
  if (sortBy === 'congestion') return item.avgCongestion ?? Number.POSITIVE_INFINITY
  return item.통근시간 ?? Number.POSITIVE_INFINITY
}

function formatPercent(value) {
  const num = parseOptionalNumber(value)
  if (num == null) return '-'
  return `${Number(num.toFixed(1)).toLocaleString()}%`
}

function formatMinutes(value) {
  const num = parseOptionalNumber(value)
  if (num == null) return '-'
  return `${Math.round(num)}분`
}

function getBudgetText(filters) {
  if (!filters) return '조건 없음'
  if (filters.searchMode !== 'detail') {
    return filters.maxBudget
      ? `1년 기준 부담금 ${formatPriceMan(filters.maxBudget)} 이하`
      : '1년 기준 부담금 제한 없음'
  }
  if (filters.dealType === '매매') {
    return filters.salePrice ? `매매가 ${formatPriceMan(filters.salePrice)} 이하` : '매매가 제한 없음'
  }
  if (filters.dealType === '전세') {
    return filters.jeonsePrice ? `전세보증금 ${formatPriceMan(filters.jeonsePrice)} 이하` : '전세보증금 제한 없음'
  }
  const depositText = filters.deposit ? `보증금 ${formatPriceMan(filters.deposit)} 이하` : '보증금 제한 없음'
  const monthlyText = filters.monthlyRent ? `월세 ${formatPriceMan(filters.monthlyRent)} 이하` : '월세 제한 없음'
  return `${depositText} / ${monthlyText}`
}

function getAreaText(filters) {
  const area = parseOptionalNumber(filters?.area)
  const pyeong = parseOptionalNumber(filters?.areaPyeong)
  if (area == null && pyeong == null) return '면적 제한 없음'
  if (pyeong != null) return `최소 ${Number(pyeong.toFixed(2))}평`
  return `최소 ${Number(area.toFixed(2))}㎡`
}

function getSearchTitle(filters) {
  const destination = filters?.destinationName || '선택 위치'
  return `${destination} 통근권 추천 매물`
}

function getSearchConditionText(filters) {
  if (!filters) return ''
  const commute = filters.commute ? `${filters.commute}분 이내` : '통근 제한 없음'
  const time = filters.departureTime ? `${filters.departureTime} 출발` : '출발시각 미지정'
  const modeText = filters.searchMode === 'detail'
    ? `${filters.dealType} 상세 조건`
    : '전체 1년 부담금 추천'
  return `${modeText} · ${getBudgetText(filters)} · ${getAreaText(filters)} · ${commute} · ${time}`
}

function classifyDealType(item) {
  const kind = String(item.유형 || '')
  const monthlyRent = parseNumber(item.월세금액)
  if (kind.includes('trade')) return '매매'
  if (kind.includes('rent')) return monthlyRent > 0 ? '월세' : '전세'
  return monthlyRent > 0 ? '월세' : '거래'
}

function getCongestionLabel(value) {
  const congestion = parseOptionalNumber(value)
  if (congestion == null) return null
  if (congestion < 40) return '혼잡도 여유'
  if (congestion < 70) return '혼잡도 보통'
  if (congestion < 90) return '혼잡도 혼잡'
  return '혼잡도 높음'
}

function getFilterBudget(filters) {
  if (!filters) return null
  if (filters.searchMode !== 'detail') return parseOptionalNumber(filters.maxBudget)
  if (filters.dealType === '매매') return parseOptionalNumber(filters.salePrice)
  if (filters.dealType === '전세') return parseOptionalNumber(filters.jeonsePrice)
  const deposit = parseOptionalNumber(filters.deposit)
  const monthly = parseOptionalNumber(filters.monthlyRent)
  if (deposit == null && monthly == null) return null
  return (deposit || 0) + (monthly || 0) * 12
}

function getRecommendationReasons(item, filters) {
  const reasons = []
  const commute = parseOptionalNumber(item.통근시간)
  const commuteLimit = parseOptionalNumber(filters?.commute)
  const annualBurden = getAnnualBurden(item)
  const budget = getFilterBudget(filters)
  const area = parseOptionalNumber(item.전용면적)
  const minArea = parseOptionalNumber(filters?.area)
  const congestionLabel = getCongestionLabel(item.avgCongestion)

  if (commute != null) {
    reasons.push(commuteLimit != null && commute <= commuteLimit
      ? `통근 ${Math.round(commute)}분`
      : '통근시간 확인')
  }
  if (budget != null && annualBurden > 0 && annualBurden <= budget) {
    const gapPercent = getPriceGapPercent(item, filters)
    if (gapPercent <= 10) reasons.push('금액 매우 근접')
    else if (gapPercent <= 25) reasons.push('금액 근접')
    else reasons.push('부담금 기준 충족')
  }
  if (minArea != null && area != null && area >= minArea) {
    reasons.push('면적 기준 충족')
  }
  if (congestionLabel) {
    reasons.push(congestionLabel)
  }

  return reasons.length ? reasons.slice(0, 4) : ['조건 내 추천']
}

function getSummary(listings) {
  const count = listings.length
  const commuteValues = listings
    .map(item => parseOptionalNumber(item.통근시간))
    .filter(value => value != null)
  const congestionValues = listings
    .map(item => parseOptionalNumber(item.avgCongestion))
    .filter(value => value != null)
  const areaValues = listings
    .map(item => parseOptionalNumber(item.전용면적))
    .filter(value => value != null)

  const average = values =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

  return {
    count,
    avgCommute: average(commuteValues),
    bestCommute: commuteValues.length ? Math.min(...commuteValues) : null,
    avgCongestion: average(congestionValues),
    maxArea: areaValues.length ? Math.max(...areaValues) : null,
  }
}

export default function RecommendationList({ filters, onSelect, onRoute }) {
  const { data: listings = [], isLoading, isFetching, error } = useRecommend(filters)
  const [sortBy, setSortBy] = useState('recommend')

  const sortedListings = useMemo(() => {
    const direction = sortBy === 'area' || sortBy === 'recommend' ? -1 : 1
    return [...listings].sort((a, b) => {
      const primary = (getSortValue(a, sortBy, filters) - getSortValue(b, sortBy, filters)) * direction
      if (primary !== 0) return primary
      const scoreTie = (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0)
      if (scoreTie !== 0) return scoreTie
      return (a.통근시간 ?? 9999) - (b.통근시간 ?? 9999)
    })
  }, [listings, sortBy, filters])

  const summary = useMemo(() => getSummary(listings), [listings])
  const header = filters ? (
    <div className="drawer-list-header">
      <div>
        <p className="drawer-eyebrow">현재 검색 조건</p>
        <h2 className="drawer-title">{getSearchTitle(filters)}</h2>
        <p className="search-condition-text">{getSearchConditionText(filters)}</p>
      </div>
      <div className="result-summary" aria-label="검색결과 요약">
        <div>
          <strong>{summary.count}</strong>
          <span>추천 매물</span>
        </div>
        <div>
          <strong>{formatMinutes(summary.avgCommute)}</strong>
          <span>평균 통근</span>
        </div>
        <div>
          <strong>{formatMinutes(summary.bestCommute)}</strong>
          <span>최단 통근</span>
        </div>
        <div>
          <strong>{formatPercent(summary.avgCongestion)}</strong>
          <span>평균 혼잡도</span>
        </div>
      </div>
      <div className="congestion-note">
        추천순은 금액 근접도 35%, 통근 35%, 면적 20%, 혼잡도 10%를 반영합니다. 전체 추천의 1년 기준 부담금은 보증금 + 월세 × 12로 계산하며, 버스 혼잡도는 승하차 기반 추정값입니다.
      </div>
      <label className="sort-control">
        <span>정렬</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="recommend">추천순</option>
          <option value="time">시간 짧은순</option>
          <option value="price">금액 가까운순</option>
          <option value="area">면적 넓은순</option>
          <option value="congestion">혼잡도 낮은순</option>
        </select>
      </label>
    </div>
  ) : null

  if (!filters) return null
  if ((isLoading || isFetching) && listings.length === 0) {
    return <>{header}<div className="drawer-status">불러오는 중…</div></>
  }
  if (error) {
    return <>{header}<div className="drawer-status">추천 정보를 불러오는 중 오류가 발생했습니다.</div></>
  }
  if (!isFetching && listings.length === 0) {
    return <>{header}<div className="drawer-status">조건에 맞는 매물이 없습니다.</div></>
  }

  return (
    <>
      {header}
      <div className="cards-container">
        {sortedListings.map(item => {
          const address = item.주소 || '주소 정보 없음'
          const name = item.단지명 || ''
          const title = [address, name].filter(Boolean).join(' ')
          const dealType = classifyDealType(item)
          const deposit = Number(String(item.거래금액 || '').replace(/,/g, ''))
          const monthlyRent = Number(String(item.월세금액 || '').replace(/,/g, ''))
          const equivalentPrice = getAnnualBurden(item)
          const reasons = getRecommendationReasons(item, filters)
          const areaText = formatArea(item.전용면적)
          const commuteText = item.통근시간 != null ? `${item.통근시간}분` : '-'
          const congestionText = item.avgCongestion != null ? `${item.avgCongestion}%` : '정보 없음'
          const scoreText = item.recommendationScore != null
            ? `${Math.round(item.recommendationScore)}점`
            : null

          return (
            <div
              key={`${item.id}-${address}`}
              className="card"
              onClick={() => onSelect(item)}
            >
              {/* 헤더 */}
              <div className="card-header">
                <div className="card-heading-row">
                  <div className="card-badges">
                    <span className="deal-chip" style={getListingTypeChipStyle(dealType)}>{dealType}</span>
                  </div>
                  <div className="card-address">{title}</div>
                </div>
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
                  <>{dealType} <span className="price-highlight">
                   {formatPriceMan(deposit)}
                  </span></>
                )
              }
            </div>
                {monthlyRent > 0 && (
                  <div className="card-area">1년 기준 부담금: {formatPriceMan(equivalentPrice)}</div>
                )}
                <div className="card-area">면적: {areaText}</div>
                <div className="reason-block">
                  <div className="reason-title-row">
                    {scoreText
                      ? <span className="score-chip">추천 {scoreText}</span>
                      : <div className="reason-title">추천 기준</div>
                    }
                  </div>
                  <div className="reason-chips">
                    {reasons.map(reason => (
                      <span key={reason} className="reason-chip">{reason}</span>
                    ))}
                  </div>
                </div>
                <div className="info-row">
                  <div className="card-meta">
                    <span className="card-area">통근시간: {commuteText}</span>
                    <span className="card-area">혼잡도: {congestionText}</span>
                  </div>
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
