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

  const toggleAreaUnit = () => {  
  setAreaUnit(u => (u === 'm2' ? 'p' : 'm2'));
  };

  // ───── 주소 자동완성 ─────
  const [address,     setAddress]     = useState('')
  const debouncedAddress             = useDebounce(address, 300)
  const [suggestions, setSuggestions] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const selectingRef = useRef(false);

  // 카카오맵 인스턴스를 받을 레퍼런스 (forwardRef)
  const mapRef = useRef(null)
  // 마지막으로 적용된 bounds 저장
  const lastBoundsRef = useRef(null)

  // ▶ 드로어 열림/닫힘 시: resize + 마지막 bounds 재적용
  useEffect(() => {
    if (!mapRef.current) return
    window.kakao.maps.event.trigger(mapRef.current, 'resize')
    if (lastBoundsRef.current) {
      mapRef.current.setBounds(lastBoundsRef.current)
    }
  }, [isDrawerOpen])

  // 주소 자동완성 검색
  useEffect(() => {
    // 선택 플래그가 세워진 상태면(=selectSuggestion 호출 직후) 플래그만 리셋하고 재검색 스킵
  if (selectingRef.current) {
    selectingRef.current = false
    return
  }
    if (debouncedAddress.trim().length < 2 || !window.kakao) {
      setSuggestions([])
      return
    }
    setIsSearching(true)
    const ps = new window.kakao.maps.services.Places()
    ps.keywordSearch(debouncedAddress, (data, status) => {
      setIsSearching(false)
      setSuggestions(
        status === window.kakao.maps.services.Status.OK ? data : []
      )
    })
  }, [debouncedAddress])

  // ───── 전체 필터 상태 ─────
  const [filters, setFilters] = useState({
    dealType:      '매매',
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

  const handleAreaChange = e => {
    const area = e.target.value
    const pyeong = area ? (parseFloat(area) / 3.3058).toFixed(2) : ''
    setFilters(f => ({ ...f, area, areaPyeong: pyeong }))
  }
  const handlePyeongChange = e => {
    const areaPyeong = e.target.value
    const area = areaPyeong
      ? (parseFloat(areaPyeong) * 3.3058).toFixed(2)
      : ''
    setFilters(f => ({ ...f, area, areaPyeong }))
  }

  // 주소 제안 선택
  const selectSuggestion = useCallback(place => {
    selectingRef.current = true
    const newCenter = { lat: +place.y, lng: +place.x }
    setAddress(place.place_name)
    setSuggestions([])
    setFilters(f => ({ ...f, centerCoords: newCenter, destinationName: place.place_name }))
    setMapCenter(newCenter)
  }, [])

  // 위치 설정 버튼
  const setAddressCoords = useCallback(e => {
    e.preventDefault()
    if (!address.trim() || !window.kakao) return
    const geocoder = new window.kakao.maps.services.Geocoder()
    geocoder.addressSearch(address, (res, status) => {
      if (
        status === window.kakao.maps.services.Status.OK &&
        res.length
      ) {
        const { x, y } = res[0]
        const newCenter = { lat: +y, lng: +x }
        setFilters(f => ({ ...f, centerCoords: newCenter, destinationName: address }))
        setMapCenter(newCenter)
      }
    })
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
  {suggestions.length > 0 && (
    <ul className="suggestions">
      {suggestions.map((p, i) => (
        <li key={i} onClick={() => selectSuggestion(p)}>
          {p.place_name}
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
          <label>거래유형</label>
          <select value={filters.dealType} onChange={e => {
            const dt = e.target.value
            setFilters(f => ({ ...f, dealType: dt, salePrice: '', jeonsePrice: '', deposit: '', monthlyRent: '' }))
          }}>
            <option value="매매">매매</option>
            <option value="전세">전세</option>
            <option value="월세">월세</option>
          </select>
        </div>
        {/* Price Inputs */}
{filters.dealType === '매매' && (
  <div className="filter-group">
    <label>매매금 (만원)</label>
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
    <label>전세금 (만원)</label>
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
      <label>보증금 (만원)</label>
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
      <label>월세 (만원)</label>
      <div className="input-group">
        <input
          type="number"
          placeholder="예: 50"
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
        {/* Area Toggle Input */}
<div className="filter-group">
  {/* 1) 레이블 + 세그먼티드 컨트롤 */}
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px'
  }}>
    <label>최소 면적</label>
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
    placeholder={areaUnit === 'm2' ? '㎡ 단위 입력' : '평 단위 입력'}
    value={areaUnit === 'm2' ? filters.area : filters.areaPyeong}
    onChange={handleAreaInput}
    style={{ width: '100%' }}
  />
</div>



        {/* Commute Options */}
        <div className="section-header">
          <ClockIcon /> <span>통근 옵션</span>
        </div>
        <div className="filter-group">
          <label>통근제한 (분)</label>
          <input type="number" placeholder="예: 30" value={filters.commute} onChange={handleFilterChange('commute')} />
        </div>
        <div className="filter-group">
          <label>출발 희망시간</label>
          <select value={filters.departureTime} onChange={handleFilterChange('departureTime')}>
            {['07:00','07:30','08:00','08:30',].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>


        {/* 추천 매물 보기 */}
        <div className="recommendation">
          <button className="primary-btn" onClick={handleSearch}>
            추천 매물 보기
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
          onBoundsChange={bounds => lastBoundsRef.current = bounds}
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
