// src/MapView.js
import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useRecommend } from './hooks/useRecommend'
import { api } from './api'
import { LISTING_TYPE_COLORS, getListingTypeColor } from './listingStyle'

const KAKAO_JS_KEY = process.env.REACT_APP_KAKAO_JS_KEY
const KAKAO_ROADVIEW_SCRIPT_ID = 'kakao-roadview-sdk'
let kakaoRoadviewSdkPromise = null

export const BUS_COLORS = {
  trunk: '#3D5BAB',
  branch: '#53B332',
  rapid: '#E60012',
  airport: '#9B5200',
  circular: '#F99D1C',
  village: '#53B332',
  default: '#3D5BAB',
}
export const BUS_COLOR = BUS_COLORS.default
export const WALK_COLOR = '#999999'
export const MARKET_ACTIVITY_COLORS = {
  1: '#FEE5D9',
  2: '#FCBBA1',
  3: '#FC9272',
  4: '#FB6A4A',
  5: '#CB181D',
}
export const MARKET_ACTIVITY_LABELS = {
  1: '0~20%',
  2: '21~40%',
  3: '41~60%',
  4: '61~80%',
  5: '81~100%',
}
const MARKET_ACTIVITY_LEGEND_GRADES = [5, 4, 3, 2, 1]
const MARKET_ACTIVITY_GEO_OFFSET = {
  lat: 0.0018,
  lng: -0.0018,
}
export const SUBWAY_CODE_COLORS = {
  1001: '#0052A4',
  1002: '#00A84D',
  1003: '#EF7C1C',
  1004: '#00A4E3',
  1005: '#996CAC',
  1006: '#CD7C2F',
  1007: '#747F00',
  1008: '#E6186C',
  1009: '#BDB092',
  1075: '#77C4A3',
  1077: '#D31145',
  1071: '#0090D2',
  1076: '#0C8E72',
  1078: '#B7C452',
  1079: '#81A914',
  1065: '#7CA8D5',
  1067: '#ED8B00',
  1062: '#FABE00',
  1116: '#FABE00',
}

const ODSAY_SUBWAY_CODE_TO_COLOR_KEY = {
  116: 1062,
}

export const SUBWAY_NAME_TO_CODE = {
  '수도권 1호선': 1001,
  '1호선': 1001,
  '수도권 2호선': 1002,
  '2호선': 1002,
  '수도권 3호선': 1003,
  '3호선': 1003,
  '수도권 4호선': 1004,
  '4호선': 1004,
  '수도권 5호선': 1005,
  '5호선': 1005,
  '수도권 6호선': 1006,
  '6호선': 1006,
  '수도권 7호선': 1007,
  '7호선': 1007,
  '수도권 8호선': 1008,
  '8호선': 1008,
  '수도권 9호선': 1009,
  '9호선': 1009,
  '경의중앙선': 1075,
  '신분당선': 1077,
  '공항철도': 1071,
  '경춘선': 1076,
  '우이신설선': 1078,
  '서해선': 1079,
  '인천1호선': 1065,
  '인천2호선': 1067,
  '수도권 수인.분당선': 1062,
  '수도권 수인·분당선': 1062,
  '수인.분당선': 1062,
  '수인·분당선': 1062,
  '수인분당선': 1062,
}

function formatPriceMan(val) {
  const cleaned = String(val).replace(/,/g, '')
  const amt = Number(cleaned)
  if (Number.isNaN(amt) || amt <= 0) return '가격 정보 없음'

  const eok = Math.floor(amt / 10000)
  const man = amt % 10000
  if (eok > 0) {
    return man > 0 ? `${eok}억 ${man.toLocaleString()}만` : `${eok}억`
  }
  return `${amt.toLocaleString()}만`
}

function formatArea(val) {
  const sqm = Number(val)
  if (!sqm || isNaN(sqm)) return '-'
  const pyeong = (sqm / 3.3058).toFixed(2)
  return `${sqm.toLocaleString()}㎡ (${pyeong}평)`
}

function parseNumber(val) {
  const num = Number(String(val ?? '').replace(/,/g, ''))
  return Number.isFinite(num) ? num : 0
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function classifyListingDealType(item) {
  const kind = String(item.유형 || '')
  const monthly = parseNumber(item.월세금액)
  if (kind.includes('trade')) return '매매'
  if (kind.includes('rent')) return monthly > 0 ? '월세' : '전세'
  return monthly > 0 ? '월세' : '기타'
}

function getListingColor(item) {
  return getListingTypeColor(classifyListingDealType(item))
}

function listingPopup(item, filters) {
  const addr = item.주소 || '주소 정보 없음'
  const name = item.단지명 || ''
  const commute = item.통근시간 != null ? `${item.통근시간}분` : '-'
  const lat = Number(item.위도 ?? item.lat)
  const lng = Number(item.경도 ?? item.lng)
  const hasRoadviewCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const roadviewTitle = [addr, name].filter(Boolean).join(' ')
  const dealType = classifyListingDealType(item)
  const monthly = parseNumber(item.월세금액)
  const equivalent = parseNumber(item.환산금액)
  const priceBlock = monthly > 0
    ? `<div>보증금: ${formatPriceMan(item.거래금액)}</div>
       <div>월세: ${formatPriceMan(item.월세금액 || 0)}</div>
       <div>1년 기준 부담금: ${formatPriceMan(equivalent || parseNumber(item.거래금액) + monthly * 12)}</div>`
    : `<div>${dealType}: ${formatPriceMan(item.거래금액)}</div>`

  return `
    <div class="listing-popup-card">
      <div class="listing-popup-info">
        <div class="listing-popup-address">${escapeHtml(addr)}</div>
        <div class="listing-popup-name">${escapeHtml(name)}</div>
        ${priceBlock}
        <div>면적: ${formatArea(item.전용면적 || 0)}</div>
        <div>통근시간: ${commute}</div>
      </div>
      <div class="listing-popup-actions">
        <button
          type="button"
          class="listing-roadview-button"
          ${hasRoadviewCoords ? `data-roadview-lat="${lat}" data-roadview-lng="${lng}" data-roadview-title="${escapeHtml(roadviewTitle)}"` : 'disabled'}
        >
          로드뷰 미리보기
        </button>
      </div>
    </div>
  `
}

function loadKakaoRoadviewSdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('window unavailable'))
  if (window.kakao?.maps?.Roadview && window.kakao?.maps?.RoadviewClient) {
    return Promise.resolve(window.kakao)
  }
  if (!KAKAO_JS_KEY) {
    return Promise.reject(new Error('REACT_APP_KAKAO_JS_KEY is missing'))
  }
  if (kakaoRoadviewSdkPromise) return kakaoRoadviewSdkPromise

  kakaoRoadviewSdkPromise = new Promise((resolve, reject) => {
    const resolveWhenReady = () => {
      if (!window.kakao?.maps) {
        reject(new Error('Kakao maps SDK unavailable'))
        return
      }
      window.kakao.maps.load(() => resolve(window.kakao))
    }

    const existing = document.getElementById(KAKAO_ROADVIEW_SCRIPT_ID)
    if (existing) {
      existing.addEventListener('load', resolveWhenReady, { once: true })
      existing.addEventListener('error', () => reject(new Error('Kakao SDK load failed')), { once: true })
      if (window.kakao?.maps) resolveWhenReady()
      return
    }

    const script = document.createElement('script')
    script.id = KAKAO_ROADVIEW_SCRIPT_ID
    script.async = true
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&autoload=false`
    script.onload = resolveWhenReady
    script.onerror = () => reject(new Error('Kakao SDK load failed'))
    document.head.appendChild(script)
  })

  return kakaoRoadviewSdkPromise
}

function mountListingRoadviewButtons(root = document, onOpenRoadview) {
  const nodes = root?.querySelectorAll?.('.listing-roadview-button[data-roadview-lat][data-roadview-lng]')
  if (!nodes?.length) return

  nodes.forEach(node => {
    if (node.dataset.roadviewBound === '1') return
    node.dataset.roadviewBound = '1'

    const lat = Number(node.dataset.roadviewLat)
    const lng = Number(node.dataset.roadviewLng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    node.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      onOpenRoadview?.({
        lat,
        lng,
        title: node.dataset.roadviewTitle || '로드뷰 미리보기',
      })
    })
  })
}

function clearLayers(layersRef) {
  layersRef.current.forEach(layer => layer.remove())
  layersRef.current = []
}

function clearLayer(layerRef) {
  layerRef.current?.remove()
  layerRef.current = null
}

function hasCoords(value) {
  return Number.isFinite(Number(value?.[0])) && Number.isFinite(Number(value?.[1]))
}

function getDrawerWidth(isDrawerOpen) {
  if (!isDrawerOpen || typeof document === 'undefined') return 0
  const drawer = document.querySelector('.drawer.open')
  return drawer?.getBoundingClientRect().width || 0
}

function fitBoundsInsideVisibleMap(map, bounds, isDrawerOpen) {
  if (!map || !bounds?.isValid?.()) return

  const basePadding = 40
  const drawerWidth = getDrawerWidth(isDrawerOpen)
  map.fitBounds(bounds, {
    paddingTopLeft: [basePadding, basePadding],
    paddingBottomRight: [basePadding + drawerWidth, basePadding],
  })
}

function normalizeSubwayCode(code) {
  const numberCode = Number(code)
  if (!Number.isFinite(numberCode)) return null
  if (ODSAY_SUBWAY_CODE_TO_COLOR_KEY[numberCode]) return ODSAY_SUBWAY_CODE_TO_COLOR_KEY[numberCode]
  return numberCode >= 1000 ? numberCode : 1000 + numberCode
}

function getSubwayColorByCode(...codes) {
  for (const code of codes) {
    const colorKey = normalizeSubwayCode(code)
    if (colorKey && SUBWAY_CODE_COLORS[colorKey]) {
      return SUBWAY_CODE_COLORS[colorKey]
    }
  }
  return null
}

function getSubwayColorByName(name) {
  if (!name) return null
  if (name.includes('수인') || name.includes('분당')) {
    return SUBWAY_CODE_COLORS[1062]
  }

  const codeFromName = SUBWAY_NAME_TO_CODE[name]
  if (codeFromName && SUBWAY_CODE_COLORS[codeFromName]) {
    return SUBWAY_CODE_COLORS[codeFromName]
  }

  const lineMatch = String(name).match(/([1-9])호선/)
  if (lineMatch) {
    return getSubwayColorByCode(Number(lineMatch[1]))
  }

  return null
}

function getSubwayColor(segment, lane) {
  const laneInfo = Array.isArray(segment?.lane) ? segment.lane[0] : segment?.lane
  const names = [
    laneInfo?.nameKor,
    laneInfo?.name,
    lane?.nameKor,
    lane?.name,
  ].filter(Boolean)

  for (const name of names) {
    const colorFromName = getSubwayColorByName(name)
    if (colorFromName) return colorFromName
  }

  return getSubwayColorByCode(
    laneInfo?.subwayCode,
    laneInfo?.type,
    lane?.subwayCode,
    lane?.type
  ) || BUS_COLORS.default
}

export function getBusColor(segment, lane) {
  const laneInfo = Array.isArray(segment?.lane) ? segment.lane[0] : segment?.lane
  const busNo = String(laneInfo?.busNoKor || laneInfo?.busNo || lane?.busNoKor || lane?.busNo || '').trim()
  const digits = busNo.replace(/[^0-9]/g, '')
  const type = Number(laneInfo?.type ?? lane?.type)

  if (/^공항|airport/i.test(busNo) || type === 4 || type === 14) return BUS_COLORS.airport
  if (/^M/i.test(busNo) || /^9\d{3}$/.test(digits) || type === 3 || type === 13) return BUS_COLORS.rapid
  if (/순환/.test(busNo) || type === 15) return BUS_COLORS.circular
  if (/마을/.test(busNo) || type === 16) return BUS_COLORS.village
  if (/^\d{4}$/.test(digits)) return BUS_COLORS.branch
  if (/^\d{3}$/.test(digits) || /^\d{2,3}[A-Z]?$/.test(busNo)) return BUS_COLORS.trunk

  return BUS_COLORS.default
}

export function getTransitColor(segment, lane) {
  if (segment?.trafficType === 2) return getBusColor(segment, lane)
  return getSubwayColor(segment, lane)
}

function buildMarketActivityIndex(activity) {
  const regions = Array.isArray(activity?.regions) ? activity.regions : []
  const sorted = [...regions]
    .filter(region => Number.isFinite(Number(region.last3_count ?? region.activity_score)))
    .sort((a, b) => Number(a.last3_count ?? a.activity_score) - Number(b.last3_count ?? b.activity_score))

  const byGu = new Map()
  sorted.forEach((region, index) => {
    const grade = Math.min(5, Math.floor((index * 5) / Math.max(sorted.length, 1)) + 1)
    byGu.set(region.gu, { ...region, relative_grade: grade })
  })
  return byGu
}

function getMarketActivityColor(grade) {
  return MARKET_ACTIVITY_COLORS[grade] || '#F3F4F6'
}

function shiftGeoCoordinates(coords) {
  if (!Array.isArray(coords)) return coords
  if (
    coords.length >= 2 &&
    Number.isFinite(Number(coords[0])) &&
    Number.isFinite(Number(coords[1]))
  ) {
    return [
      Number(coords[0]) + MARKET_ACTIVITY_GEO_OFFSET.lng,
      Number(coords[1]) + MARKET_ACTIVITY_GEO_OFFSET.lat,
    ]
  }
  return coords.map(shiftGeoCoordinates)
}

function shiftDistrictGeoJson(geoJson) {
  if (!geoJson?.features) return geoJson
  return {
    ...geoJson,
    features: geoJson.features.map(feature => ({
      ...feature,
      geometry: feature.geometry
        ? {
            ...feature.geometry,
            coordinates: shiftGeoCoordinates(feature.geometry.coordinates),
          }
        : feature.geometry,
    })),
  }
}

export default forwardRef(function MapView(
  { filters, selected, mapCenter, routeTarget, isDrawerOpen },
  ref
) {
  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.9780 }
  const containerRef = useRef(null)
  const mapInst = useRef(null)
  const centerMarker = useRef(null)
  const popupRef = useRef(null)
  const listingMarkersRef = useRef([])
  const routeMarkersRef = useRef([])
  const lineRefs = useRef([])
  const marketActivityLayerRef = useRef(null)
  const marketTooltipRef = useRef(null)
  const roadviewContainerRef = useRef(null)
  const [districtGeoJson, setDistrictGeoJson] = useState(null)
  const [marketActivity, setMarketActivity] = useState(null)
  const [roadviewTarget, setRoadviewTarget] = useState(null)
  const [roadviewStatus, setRoadviewStatus] = useState('idle')
  const { data: listings = [] } = useRecommend(filters)
  const showMarketActivity = !filters && !routeTarget
  const marketActivityByGu = useMemo(
    () => buildMarketActivityIndex(marketActivity),
    [marketActivity]
  )

  useImperativeHandle(ref, () => ({
    invalidateSize: () => mapInst.current?.invalidateSize(),
  }), [])

  useEffect(() => {
    if (!roadviewTarget || !roadviewContainerRef.current) return

    let cancelled = false
    const container = roadviewContainerRef.current
    container.innerHTML = ''
    setRoadviewStatus('loading')

    loadKakaoRoadviewSdk()
      .then(kakao => {
        if (cancelled || !container) return
        const position = new kakao.maps.LatLng(roadviewTarget.lat, roadviewTarget.lng)
        const client = new kakao.maps.RoadviewClient()
        client.getNearestPanoId(position, 140, panoId => {
          if (cancelled || !document.body.contains(container)) return
          if (!panoId) {
            setRoadviewStatus('empty')
            return
          }

          container.innerHTML = ''
          const roadview = new kakao.maps.Roadview(container)
          roadview.setPanoId(panoId, position)
          setRoadviewStatus('ready')
        })
      })
      .catch(() => {
        if (!cancelled) setRoadviewStatus('error')
      })

    return () => {
      cancelled = true
      container.innerHTML = ''
    }
  }, [roadviewTarget])

  useEffect(() => {
    let timer = null

    const initMap = () => {
      const L = window.L
      if (!L) {
        timer = window.setTimeout(initMap, 100)
        return
      }
      if (mapInst.current || !containerRef.current) return

      mapInst.current = L.map(containerRef.current).setView(
        [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
        11
      )
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapInst.current)

      const marketPane = mapInst.current.createPane('marketActivityPane')
      marketPane.style.zIndex = 350

      L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
      }).addTo(mapInst.current)
    }

    initMap()
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng])

  useEffect(() => {
    let cancelled = false

    Promise.all([
      api.get('/market-activity').then(res => res.data),
      fetch('/data/seoul_municipalities_geo.json').then(res => res.json()),
    ])
      .then(([activity, geoJson]) => {
        if (cancelled) return
        setMarketActivity(activity)
        setDistrictGeoJson(shiftDistrictGeoJson(geoJson))
      })
      .catch(err => console.error('시장 활동 지도 데이터 로딩 에러 ▶', err))

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!mapInst.current) return
    window.setTimeout(() => {
      mapInst.current?.invalidateSize()
      mapInst.current?.setView([mapCenter.lat, mapCenter.lng])
    }, 0)
  }, [isDrawerOpen, mapCenter])

  useEffect(() => {
    const L = window.L
    if (!L || !mapInst.current) return

    const isDefault =
      mapCenter.lat === DEFAULT_CENTER.lat &&
      mapCenter.lng === DEFAULT_CENTER.lng

    centerMarker.current?.remove()
    centerMarker.current = null
    if (isDefault) return

    centerMarker.current = L.marker([mapCenter.lat, mapCenter.lng], {
      title: '내 위치',
    }).addTo(mapInst.current)
  }, [mapCenter, DEFAULT_CENTER.lat, DEFAULT_CENTER.lng])

  useEffect(() => {
    const L = window.L
    if (!L || !mapInst.current) return

    clearLayer(marketActivityLayerRef)
    clearLayer(marketTooltipRef)
    if (!showMarketActivity || !districtGeoJson || marketActivityByGu.size === 0) return

    const layer = L.geoJSON(districtGeoJson, {
      pane: 'marketActivityPane',
      style: feature => {
        const guName = feature?.properties?.name
        const stat = marketActivityByGu.get(guName)
        const grade = stat?.relative_grade || 0
        return {
          color: '#991B1B',
          weight: 1,
          opacity: 0.7,
          fillColor: getMarketActivityColor(grade),
          fillOpacity: grade ? 0.48 : 0.08,
        }
      },
      onEachFeature: (feature, layerItem) => {
        const guName = feature?.properties?.name
        const stat = marketActivityByGu.get(guName)
        const grade = stat?.relative_grade || 0
        const tooltipContent = stat
          ? `<strong>${guName}</strong><br/>
             거래활동 ${MARKET_ACTIVITY_LABELS[stat.relative_grade]} · 서울 내 상대 분위<br/>
             최근 3개월 거래량 ${Number(stat.last3_count).toLocaleString()}건`
          : `<strong>${guName}</strong><br/>거래활동 정보 없음`

        layerItem.on({
          mouseover: e => {
            clearLayer(marketTooltipRef)
            layerItem.setStyle({
              color: '#1F2937',
              weight: 2.5,
              opacity: 0.95,
              fillOpacity: 0.6,
            })
            layerItem.bringToFront()
            marketTooltipRef.current = L.tooltip({
              direction: 'top',
              offset: [0, -8],
              opacity: 0.96,
              className: 'market-activity-tooltip',
            })
              .setLatLng(e.latlng)
              .setContent(tooltipContent)
              .addTo(mapInst.current)
          },
          mousemove: e => {
            marketTooltipRef.current?.setLatLng(e.latlng)
          },
          mouseout: () => {
            clearLayer(marketTooltipRef)
            layerItem.setStyle({
              color: '#991B1B',
              weight: 1,
              opacity: 0.7,
              fillColor: getMarketActivityColor(grade),
              fillOpacity: grade ? 0.48 : 0.08,
            })
          },
        })
      },
    }).addTo(mapInst.current)

    marketActivityLayerRef.current = layer
    const isDefaultCenter =
      mapCenter.lat === DEFAULT_CENTER.lat &&
      mapCenter.lng === DEFAULT_CENTER.lng
    if (isDefaultCenter && layer.getBounds().isValid()) {
      mapInst.current.fitBounds(layer.getBounds(), { padding: [28, 28] })
    }

    return () => {
      clearLayer(marketTooltipRef)
      clearLayer(marketActivityLayerRef)
    }
  }, [showMarketActivity, districtGeoJson, marketActivityByGu, mapCenter, DEFAULT_CENTER.lat, DEFAULT_CENTER.lng])

  useEffect(() => {
    const L = window.L
    if (!L || !mapInst.current) return

    clearLayers(listingMarkersRef)
    if (!filters) return
    if (routeTarget) return

    const bounds = L.latLngBounds([[mapCenter.lat, mapCenter.lng]])
    listings.forEach(item => {
      const lat = item.위도 ?? item.lat
      const lng = item.경도 ?? item.lng
      if (lat == null || lng == null) return

      const marker = L.circleMarker([lat, lng], {
        radius: 9,
        color: '#ffffff',
        weight: 3,
        fillColor: getListingColor(item),
        fillOpacity: 0.95,
        opacity: 1,
        title: item.단지명 || '',
      })
        .bindPopup(listingPopup(item, filters), { maxWidth: 430 })
        .addTo(mapInst.current)

      marker.on('popupopen', event => {
        window.requestAnimationFrame(() => {
          mountListingRoadviewButtons(event.popup?.getElement?.(), target => {
            mapInst.current?.closePopup()
            setRoadviewTarget(target)
          })
        })
      })

      listingMarkersRef.current.push(marker)
      bounds.extend([lat, lng])
    })

    fitBoundsInsideVisibleMap(mapInst.current, bounds, isDrawerOpen)
  }, [filters, listings, mapCenter, routeTarget, isDrawerOpen])

  useEffect(() => {
    const L = window.L
    if (!L || !selected || !mapInst.current) return

    const lat = selected.위도 ?? selected.lat
    const lng = selected.경도 ?? selected.lng
    if (lat == null || lng == null) return

    popupRef.current?.remove()
    popupRef.current = L.popup({ maxWidth: 430 })
      .setLatLng([lat, lng])
      .setContent(listingPopup(selected, filters))
      .openOn(mapInst.current)

    window.requestAnimationFrame(() => {
      mountListingRoadviewButtons(popupRef.current?.getElement?.(), target => {
        mapInst.current?.closePopup()
        setRoadviewTarget(target)
      })
    })
    mapInst.current.panTo([lat, lng])
  }, [selected, filters])

  useEffect(() => {
    const L = window.L
    if (!L || !mapInst.current) return

    let cancelled = false
    clearLayers(routeMarkersRef)
    clearLayers(lineRefs)

    if (!routeTarget) return

    const SX = routeTarget.경도 ?? routeTarget.lng
    const SY = routeTarget.위도 ?? routeTarget.lat
    const EX = mapCenter.lng
    const EY = mapCenter.lat
    const startPos = [Number(SY), Number(SX)]
    const endPos = [Number(EY), Number(EX)]

    routeMarkersRef.current.push(
      L.marker(startPos, { title: '출발지' }).addTo(mapInst.current),
      L.marker(endPos, { title: '도착지' }).addTo(mapInst.current)
    )

    api.get('/path', { params: { SX, SY, EX, EY } })
      .then(res => res.data)
      .then(data => {
        if (cancelled) return
        if (data.error) throw new Error(data.error)

        const subPath = data.subPath || []
        const transitSegments = subPath.filter(sp => sp.trafficType !== 3)
        const lanes = data.lanes || []
        const bounds = L.latLngBounds([startPos, endPos])

        if (transitSegments.length === 0) {
          const walkLine = L.polyline([startPos, endPos], {
            color: WALK_COLOR,
            weight: 5,
            opacity: 0.85,
            dashArray: '8 8',
          }).addTo(mapInst.current)
          walkLine.bringToFront()
          lineRefs.current.push(walkLine)
          fitBoundsInsideVisibleMap(mapInst.current, bounds, isDrawerOpen)
          return
        }

        transitSegments.forEach((segment, index) => {
          const start = [Number(segment.startY), Number(segment.startX)]
          const end = [Number(segment.endY), Number(segment.endX)]

          if (hasCoords(start) && hasCoords(end)) {
            if (index === 0 && hasCoords(startPos)) {
              const walkLine = L.polyline([startPos, start], {
                color: WALK_COLOR,
                weight: 5,
                opacity: 0.85,
                dashArray: '8 8',
              }).addTo(mapInst.current)
              walkLine.bringToFront()
              lineRefs.current.push(walkLine)
            }

            if (index === transitSegments.length - 1 && hasCoords(endPos)) {
              const walkLine = L.polyline([end, endPos], {
                color: WALK_COLOR,
                weight: 5,
                opacity: 0.85,
                dashArray: '8 8',
              }).addTo(mapInst.current)
              walkLine.bringToFront()
              lineRefs.current.push(walkLine)
            }
          }
        })

        let transitLaneIndex = 0
        lanes.forEach((lane) => {
          const segment = transitSegments[transitLaneIndex] || null
          transitLaneIndex += 1
          ;(lane.section || []).forEach(sec => {
            const path = (sec.graphPos || [])
              .map(p => [Number(p.y), Number(p.x)])
              .filter(hasCoords)
            if (path.length === 0) return

            const strokeColor = getTransitColor(segment, lane)

            const casing = L.polyline(path, {
              color: '#ffffff',
              weight: 13,
              opacity: 0.88,
            }).addTo(mapInst.current)

            const poly = L.polyline(path, {
              color: strokeColor,
              weight: 8,
              opacity: 0.95,
            }).addTo(mapInst.current)

            casing.bringToFront()
            poly.bringToFront()
            lineRefs.current.push(casing)
            lineRefs.current.push(poly)
            poly.getLatLngs().forEach(point => bounds.extend(point))
          })
        })

        fitBoundsInsideVisibleMap(mapInst.current, bounds, isDrawerOpen)
      })
      .catch(err => console.error('경로 시각화 에러 ▶', err))

    return () => {
      cancelled = true
    }
  }, [routeTarget, mapCenter, isDrawerOpen])

  return (
    <div className="map-view-shell">
      <div ref={containerRef} className="leaflet-map-view" />
      <div className="map-compass" aria-label="방위">
        <span>N</span>
        <div className="map-compass-arrow" />
      </div>
      {filters && !routeTarget && (
        <div className="listing-legend" aria-label="매물 유형 범례">
          <div className="listing-legend-title">매물 유형</div>
          <div className="listing-legend-grid">
            <span className="listing-legend-dot" style={{ backgroundColor: LISTING_TYPE_COLORS.매매 }} />
            <span>매매</span>
            <span className="listing-legend-dot" style={{ backgroundColor: LISTING_TYPE_COLORS.전세 }} />
            <span>전세</span>
            <span className="listing-legend-dot" style={{ backgroundColor: LISTING_TYPE_COLORS.월세 }} />
            <span>월세</span>
          </div>
        </div>
      )}
      {showMarketActivity && marketActivity && (
        <div className="market-activity-legend" aria-label="거래활동 단계구분도 범례">
          <div className="market-activity-title">거래활동 단계구분도</div>
          <div className="market-activity-subtitle">서울 구 단위 상대 분위</div>
          {MARKET_ACTIVITY_LEGEND_GRADES.map(grade => (
            <div className="market-activity-row" key={grade}>
              <span
                className="market-activity-swatch"
                style={{ backgroundColor: MARKET_ACTIVITY_COLORS[grade] }}
              />
              <span>{MARKET_ACTIVITY_LABELS[grade]}</span>
            </div>
          ))}
          <div className="market-activity-note">
            최근 3개월 거래량 기준으로 5단계 구분
          </div>
        </div>
      )}
      {roadviewTarget && (
        <div
          className="roadview-modal-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setRoadviewTarget(null)
          }}
        >
          <section className="roadview-modal" role="dialog" aria-modal="true" aria-label="로드뷰 미리보기">
            <div className="roadview-modal-header">
              <div>
                <span className="roadview-modal-kicker">로드뷰 미리보기</span>
                <h3>{roadviewTarget.title || '선택 매물 주변'}</h3>
              </div>
              <button
                type="button"
                className="roadview-modal-close"
                onClick={() => setRoadviewTarget(null)}
                aria-label="로드뷰 닫기"
              >
                ×
              </button>
            </div>
            <div className="roadview-modal-body">
              <div ref={roadviewContainerRef} className="roadview-modal-view" />
              {roadviewStatus !== 'ready' && (
                <div className="roadview-modal-status">
                  {roadviewStatus === 'empty'
                    ? '이 위치 주변에는 로드뷰가 없습니다.'
                    : roadviewStatus === 'error'
                      ? '로드뷰를 불러오지 못했습니다.'
                      : '로드뷰를 불러오는 중입니다.'}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
})
