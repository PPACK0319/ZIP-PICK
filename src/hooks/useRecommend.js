import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/**
 * @param {object|null} filters 버튼 클릭 시에만 객체, 그 외에는 null
 * @returns {import('react-query').UseQueryResult<Array, Error>}
 */
export function useRecommend(filters) {
  const isDetailMode = filters?.searchMode === 'detail'
  let budget = Number(filters?.maxBudget) || 0
  let monthly = 0
  let dealType = '전체'

  if (isDetailMode) {
    dealType = filters?.dealType || '월세'
    if (dealType === '매매') {
      budget = Number(filters?.salePrice) || 0
    } else if (dealType === '전세') {
      budget = Number(filters?.jeonsePrice) || 0
    } else if (dealType === '월세') {
      budget = Number(filters?.deposit) || 0
      monthly = Number(filters?.monthlyRent) || 0
    }
  }

  // 2) 요청 body 준비
  const body = {
    lat:             filters?.centerCoords.lat   ?? 0,
    lng:             filters?.centerCoords.lng   ?? 0,
    departure_time:  filters?.departureTime      ?? '',
    transport:       filters?.transport          ?? '',
    deal_type:       dealType,
    budget,
    budget_mode:     isDetailMode ? 'strict' : 'equivalent',
    monthly_multiplier: 12,
    monthly,
    min_area:        Number(filters?.area)         || 0,
    commute_limit:   Number(filters?.commute)      || 0,
  }

  // 3) 디버그용 콘솔 로그
  console.log(
    '▶︎ Request →',
    `type=${body.deal_type}`,
    `budget=${body.budget}`,
    `budget_mode=${body.budget_mode}`,
    `monthly=${body.monthly}`,
    `time≤${body.commute_limit}min`,
    `(출근시간:${body.departure_time}, 교통:${body.transport})`
  )

  // 4) useQuery 호출
  return useQuery({
    queryKey: ['recommend', body],
    queryFn:  () => api
                    .post('/recommend', body)
                    .then(res => 
                      // snake_case로 내려오는 혼잡도 필드를 CamelCase로 매핑
                      res.data.map(item => ({
                        ...item,
                        avgCongestion: item.avg_congestion,
                        maxCongestion: item.max_congestion,
                        recommendationScore: item.recommendation_score,
                        scoreComponents: item.score_components,
                        scoreWeights: item.score_weights,
                        priceGapPercent: item.price_gap_percent
                      }))
                    ),
    enabled:         Boolean(filters),
    placeholderData: [],
    staleTime:       60_000,
  })
}
