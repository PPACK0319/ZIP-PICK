// src/App.js
import React, { useState, useCallback, useEffect, useRef } from 'react'
import './index.css'
import logo from './assets/Logo_Optimized.jpg'           // ← ① 로고 이미지
import { MapPin, Search as SearchIcon, Clock as ClockIcon } from 'lucide-react'
import MapView from './MapView'
import RecommendationList from './RecommendationList'
import RouteDetail from './RouteDetail'
import SlidingDrawer from './components/SlidingDrawer'
import { formatPriceMan } from './utils/formatPriceMan'
import { api } from './api'

// Debounce 훅: 입력이 멈춘 뒤 delay(ms) 후에 value를 업데이트
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function App() {
  // ───── 검색 파라미터 & 드로어 상태 ─────
  const [searchParams,    setSearchParams]    = useState(null)
  const [selectedListing, setSelectedListing] = useState(null)

  // ───── 경로 확인용 상태 ─────
  const [routeTarget,     setRouteTarget]     = useState(null)
  const [isDrawerOpen,    setIsDrawerOpen]    = useState(false)

  // ───── 지도 중심 좌표 ─────
  const [mapCenter, setMapCenter] = useState({
    lat: 37.5665,
    lng: 126.9780
  })

  const [areaUnit, setAreaUnit] = useState('m2');

  // ───── 주소 자동완성 ─────
  const [address,     setAddress]     = useState('')
  const debouncedAddress             = useDebounce(address, 300)
  const [suggestions, setSuggestions] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const selectingRef = useRef(false);

  // 지도 인스턴스를 받을 레퍼런스 (forwardRef)
  const mapRef = useRef(null)

  // ▶ 드로어 열림/닫힘 시: 지도 크기 재계산
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.invalidateSize?.()
  }, [isDrawerOpen])

  // 주소 자동완성 검색
  useEffect(() => {
    // 선택 플래그가 세워진 상태면(=selectSuggestion 호출 직후) 플래그만 리셋하고 재검색 스킵
  if (selectingRef.current) {
    selectingRef.current = false
    return
  }
    const query = debouncedAddress.trim()
    if (query.length < 2) {
      setSuggestions([])
      return
    }
    let ignore = false
    setIsSearching(true)
    api.get('/geocode', { params: { q: query } })
      .then(res => {
        if (!ignore) setSuggestions(Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => {
        if (!ignore) setSuggestions([])
      })
      .finally(() => {
        if (!ignore) setIsSearching(false)
      })
    return () => { ignore = true }
  }, [debouncedAddress])

  // ───── 전체 필터 상태 ─────
  const [filters, setFilters] = useState({
    searchMode:    'simple',
    dealType:      '월세',
    maxBudget:     '',
    salePrice:     '',
    jeonsePrice:   '',
    deposit:       '',
    monthlyRent:   '',
    area:          '',
    areaPyeong:    '',
    commute:       '',
    departureTime: '07:00',
    centerCoords:  { lat: 37.5665, lng: 126.9780 },
    destinationName: '',
  })

  const handleFilterChange = useCallback(key => e => {
    setFilters(f => ({ ...f, [key]: e.target.value }))
  }, [])

 // 통합 면적 입력 핸들러
  const handleAreaInput = e => {
    const v = parseFloat(e.target.value) || 0
    if (areaUnit === 'm2') {
      setFilters(f => ({
        ...f,
        area: v.toString(),
        areaPyeong: (v / 3.3058).toFixed(2),
      }))
    } else {
      setFilters(f => ({
        ...f,
        areaPyeong: v.toString(),
        area: (v * 3.3058).toFixed(2),
      }))
    }
  }

  // 주소 제안 선택
  const selectSuggestion = useCallback(place => {
    selectingRef.current = true
    const newCenter = { lat: +place.lat, lng: +place.lng }
    const placeName = place.name || place.fullName || ''
    setAddress(placeName)
    setSuggestions([])
    setFilters(f => ({ ...f, centerCoords: newCenter, destinationName: placeName }))
    setMapCenter(newCenter)
  }, [])

  // 위치 설정 버튼
  const setAddressCoords = useCallback(async e => {
    e.preventDefault()
    const query = address.trim()
    if (!query) return
    setIsSearching(true)
    try {
      const res = await api.get('/geocode', { params: { q: query } })
      const place = Array.isArray(res.data) ? res.data[0] : null
      if (!place) return
      const newCenter = { lat: +place.lat, lng: +place.lng }
      const placeName = place.name || place.fullName || query
      setAddress(placeName)
      setSuggestions([])
      setFilters(f => ({ ...f, centerCoords: newCenter, destinationName: placeName }))
      setMapCenter(newCenter)
    } finally {
      setIsSearching(false)
    }
  }, [address])

  // 검색 / 리셋 / 경로 버튼
  const handleSearch = () => {
    setSearchParams({ ...filters })
    setSelectedListing(null)
    setRouteTarget(null)
    setIsDrawerOpen(true)
  }
  const handleReset = () => {
    setSearchParams(null)
    setSelectedListing(null)
    setRouteTarget(null)
    setIsDrawerOpen(false)
  }
  const handleRoute = item => {
    setRouteTarget(item)
    setSelectedListing(null)
    setIsDrawerOpen(true)
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <img src={logo} alt="Zip-Pick 로고" className="sidebar-logo" />
          <h1 className="sidebar-title">ZIP-PICK</h1>
        </div>

        {/* Address Input */}
        <form onSubmit={setAddressCoords} className="address-form">
          <div className="section-header">
            <MapPin /> <span>직장 또는 학교 주소</span>
          </div>
          <input
            type="text"
            placeholder="예: 건국대학교"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
           { /* suggestions가 있을 때만 렌더링 */ }
  {isSearching && <div className="suggestions-status">주소 검색 중...</div>}
  {suggestions.length > 0 && (
    <ul className="suggestions">
      {suggestions.map((p, i) => (
        <li key={i} onClick={() => selectSuggestion(p)}>
          <span className="suggestion-name">{p.name}</span>
          {p.address && <span className="suggestion-address">{p.address}</span>}
        </li>
      ))}
    </ul>
  )}  {/* ← 이 부분에서 )와 }를 순서대로 닫아주셔야 에러가 사라집니다 */}

</form>
             <hr/>
        {/* Search Criteria */}
        <div className="section-header">
          <SearchIcon /> <span>검색 조건</span>
        </div>
        <div className="filter-group">
          <label>검색 방식</label>
          <p className="field-hint">전체 거래유형을 예산 기준으로 비교하거나, 거래유형별 상세 조건을 설정할 수 있습니다.</p>
          <div className="mode-toggle" role="group" aria-label="추천 방식 선택">
            <button
              type="button"
              className={filters.searchMode === 'simple' ? 'active' : ''}
              onClick={() => setFilters(f => ({ ...f, searchMode: 'simple' }))}
            >
              전체 금액 추천
            </button>
            <button
              type="button"
              className={filters.searchMode === 'detail' ? 'active' : ''}
              onClick={() => setFilters(f => ({ ...f, searchMode: 'detail' }))}
            >
              거래유형별 상세
            </button>
          </div>
        </div>

        {filters.searchMode === 'simple' ? (
          <div className="mode-panel">
            <div className="filter-group">
              <label>최대 예산</label>
              <p className="field-hint">매매가, 전세보증금, 월세 1년 부담금을 같은 기준으로 비교합니다. 월세는 보증금 + 월세 × 12로 계산합니다.</p>
              <div className="input-group">
                <input
                  type="number"
                  placeholder="예: 50000"
                  value={filters.maxBudget}
                  onChange={handleFilterChange('maxBudget')}
                />
                {filters.maxBudget && (
                  <span className="input-addon">
                    {formatPriceMan(filters.maxBudget)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mode-panel">
            <div className="filter-group">
              <label>거래유형</label>
              <p className="field-hint">원하는 계약 방식이 정해져 있을 때 사용합니다.</p>
              <select value={filters.dealType} onChange={e => {
                const dt = e.target.value
                setFilters(f => ({ ...f, dealType: dt }))
              }}>
                <option value="매매">매매</option>
                <option value="전세">전세</option>
                <option value="월세">월세</option>
              </select>
            </div>

            {filters.dealType === '매매' && (
              <div className="filter-group">
                <label>최대 매매가</label>
                <p className="field-hint">이 금액 이하의 매매 매물을 우선 추천합니다.</p>
                <div className="input-group">
                  <input
                    type="number"
                    placeholder="예: 50000"
                    value={filters.salePrice}
                    onChange={handleFilterChange('salePrice')}
                  />
                  {filters.salePrice && (
                    <span className="input-addon">
                      {formatPriceMan(filters.salePrice)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {filters.dealType === '전세' && (
              <div className="filter-group">
                <label>최대 전세보증금</label>
                <p className="field-hint">이 금액 이하의 전세 매물을 우선 추천합니다.</p>
                <div className="input-group">
                  <input
                    type="number"
                    placeholder="예: 20000"
                    value={filters.jeonsePrice}
                    onChange={handleFilterChange('jeonsePrice')}
                  />
                  {filters.jeonsePrice && (
                    <span className="input-addon">
                      {formatPriceMan(filters.jeonsePrice)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {filters.dealType === '월세' && (
              <>
                <div className="filter-group">
                  <label>최대 보증금</label>
                  <p className="field-hint">이 금액 이하의 월세 보증금을 우선 추천합니다.</p>
                  <div className="input-group">
                    <input
                      type="number"
                      placeholder="예: 5000"
                      value={filters.deposit}
                      onChange={handleFilterChange('deposit')}
                    />
                    {filters.deposit && (
                      <span className="input-addon">
                        {formatPriceMan(filters.deposit)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="filter-group">
                  <label>최대 월세</label>
                  <p className="field-hint">월 단위로 지불 가능한 최대 임대료를 입력합니다.</p>
                  <div className="input-group">
                    <input
                      type="number"
                      placeholder="예: 60"
                      value={filters.monthlyRent}
                      onChange={handleFilterChange('monthlyRent')}
                    />
                    {filters.monthlyRent && (
                      <span className="input-addon">
                        {formatPriceMan(filters.monthlyRent)}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Area Toggle Input */}
<div className="filter-group">
  {/* 1) 레이블 + 세그먼티드 컨트롤 */}
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px'
  }}>
    <div>
      <label>최소 전용면적</label>
      <p className="field-hint">추천 대상에 포함할 최소 전용면적을 입력합니다.</p>
    </div>
    <div className="unit-toggle">
      <button
        type="button"
        className={areaUnit === 'm2' ? 'active' : ''}
        onClick={() => setAreaUnit('m2')}
      >
        ㎡
      </button>
      <button
        type="button"
        className={areaUnit === 'p' ? 'active' : ''}
        onClick={() => setAreaUnit('p')}
      >
        평
      </button>
    </div>
  </div>

  {/* 2) 입력창은 레이블/토글 아래 */}
  <input
    type="number"
    placeholder={areaUnit === 'm2' ? '예: 20' : '예: 6'}
    value={areaUnit === 'm2' ? filters.area : filters.areaPyeong}
    onChange={handleAreaInput}
    style={{ width: '100%' }}
  />
</div>



        {/* Commute Options */}
        <div className="section-header">
          <ClockIcon /> <span>통근 기준</span>
        </div>
        <div className="filter-group">
          <label>최대 통근시간</label>
          <p className="field-hint">허용 가능한 편도 통근시간을 분 단위로 입력합니다.</p>
          <input type="number" placeholder="예: 30" value={filters.commute} onChange={handleFilterChange('commute')} />
        </div>
        <div className="filter-group">
          <label>출발 시간</label>
          <p className="field-hint">해당 시간에 출발하는 기준으로 경로를 계산합니다.</p>
          <select value={filters.departureTime} onChange={handleFilterChange('departureTime')}>
            {['07:00','07:30','08:00','08:30',].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>


        {/* 추천 매물 보기 */}
        <div className="recommendation">
          <button className="primary-btn" onClick={handleSearch}>
            내 조건으로 추천 보기
          </button>
        </div>
      </aside>

      <main className="map-container">
        <MapView
          ref={mapRef}
          filters={searchParams}
          selected={selectedListing}
          mapCenter={mapCenter}
          routeTarget={routeTarget}
          isDrawerOpen={isDrawerOpen}
        />

        <SlidingDrawer isOpen={isDrawerOpen} onClose={handleReset}>
          {routeTarget ? (
            <RouteDetail
              routeTarget={routeTarget}
              mapCenter={mapCenter}
              onClose={() => setRouteTarget(null)}
              companyName={filters.destinationName}
              departureTime={filters.departureTime}
            />
          ) : (
            <>
              <RecommendationList
                filters={searchParams}
                onSelect={item => setSelectedListing(item)}
                onRoute={handleRoute}
              />{/* 최종 검색 버튼 */}
              
            </>
          )}
        </SlidingDrawer>
      </main>
    </div>
)
}
