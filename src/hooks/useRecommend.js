import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/**
 * @param {object|null} filters 버튼 클릭 시에만 객체, 그 외에는 null
 * @returns {import('react-query').UseQueryResult<Array, Error>}
 */
export function useRecommend(filters) {
  // 1) dealType 에 따라 budget 계산 (만원 단위)
  let budget = 0
  if (filters?.dealType === '매매') {
    budget = Number(filters.salePrice) || 0
  } else if (filters?.dealType === '전세') {
    budget = Number(filters.jeonsePrice) || 0
  } else if (filters?.dealType === '월세') {
    budget = Number(filters.deposit) || 0
  }

  // 2) 요청 body 준비
  const body = {
    lat:             filters?.centerCoords.lat   ?? 0,
    lng:             filters?.centerCoords.lng   ?? 0,
    departure_time:  filters?.departureTime      ?? '',
    transport:       filters?.transport          ?? '',
    deal_type:       filters?.dealType           ?? 'all',
    budget,                                // 매매/전세: budget, 월세: 보증금
    monthly:         Number(filters?.monthlyRent) || 0,
    commute_limit:   Number(filters?.commute)      || 0,
  }

  // 3) 디버그용 콘솔 로그
  console.log(
    '▶︎ Request →',
    `type=${body.deal_type}`,
    `budget=${body.budget}`,
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
                        maxCongestion: item.max_congestion
                      }))
                    ),
    enabled:         Boolean(filters),
    placeholderData: [],
    staleTime:       60_000,
  })
}
