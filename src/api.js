// src/api.js
import axios from 'axios'

// 1) 환경변수에 백엔드 URL이 없으면 로컬을 기본값으로
const BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api'

export const api = axios.create({
  baseURL: BASE,
  timeout: 5000,
})

// 2) 매물 목록 조회 (filters: { dealType, minPrice, maxPrice, ... })
export const fetchListings = (filters) =>
  api.get('/listings', { params: filters })

 // ① POST /recommend (JSON body)
 export const fetchRecommendations = (filters) =>
   api.post('/recommend', filters).then(res => res.data)

// 4) 경로 계산 (/api/path?SX=…&SY=…&EX=…&EY=…)
export const fetchPath = ({ SX, SY, EX, EY }) =>
  api.get('/path', { params: { SX, SY, EX, EY } })

// 5) 버스·지하철 곡선 (/api/loadLane?mapObject=…)
export const loadLane = (mapObj) =>
  api.get('/loadLane', { params: { mapObject: mapObj } })
