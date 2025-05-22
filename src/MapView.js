// src/MapView.js
import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useRecommend } from './hooks/useRecommend'



// —— 컬러 상수 ——
export const BUS_COLOR = '#000080'   // 버스: 네이비
export const WALK_COLOR = '#999999'  // 도보: 그레이
export const SUBWAY_CODE_COLORS = {
  1001: '#0052A4',  // 1호선
  1002: '#00A84D',  // 2호선
  1003: '#EF7C1C',  // 3호선
  1004: '#00A4E3',  // 4호선
  1005: '#996CAC',  // 5호선
  1006: '#CD7C2F',  // 6호선
  1007: '#747F00',  // 7호선
  1008: '#E6186C',  // 8호선
  1009: '#BDB092',  // 9호선
  1075: '#77C4A3',  // 경의중앙선
  1077: '#D31145',  // 신분당선
  1071: '#0090D2',  // 공항철도
  1076: '#0C8E72',  // 경춘선
  1078: '#B7C452',  // 우이신설선
  1079: '#81A914',  // 서해선
  1065: '#7CA8D5',  // 인천1호선
  1067: '#ED8B00',  // 인천2호선
  1062: '#FABE00',  // 분당선/수인분당선
}

// 프론트엔드용 지하철명→코드 매핑 (필요 시 사용)
export const SUBWAY_NAME_TO_CODE = {
  '수도권 1호선': 1001,
  '수도권 2호선': 1002,
  '2호선': 1002,
  '수도권 3호선': 1003,
  '수도권 4호선': 1004,
  '수도권 5호선': 1005,
  '수도권 6호선': 1006,
  '수도권 7호선': 1007,
  '수도권 8호선': 1008,
  '수도권 9호선': 1009,
  '경의중앙선':    1075,
  '신분당선':      1077,
  '공항철도':      1071,
  '경춘선':        1076,
  '우이신설선':    1078,
  '서해선':        1079,
  '인천1호선':     1065,
  '인천2호선':     1067,
  '수도권 수인.분당선':     1062,
  '수도권 수인·분당선':    1062
}

console.log('API_BASE_URL=', process.env.REACT_APP_API_BASE_URL);

// 가격 포맷 (단위: 만원)
function formatPriceMan(val) {
  // 1) 문자열로 변환 후 쉼표 제거
  const cleaned = String(val).replace(/,/g, "");
  // 2) 숫자 변환
  const amt = Number(cleaned);
  // 3) NaN 또는 0 이하일 땐 대체 텍스트
  if (Number.isNaN(amt) || amt <= 0) {
    return "가격 정보 없음";
  }
  // 4) 억/만원 단위 계산
  const eok = Math.floor(amt / 10000);
  const man = amt % 10000;
  // 5) 결과 문자열 반환
  if (eok > 0) {
    return man > 0
      ? `${eok}억 ${man.toLocaleString()}만`
      : `${eok}억`;
  }
  return `${amt.toLocaleString()}만`;
}

// ㎡ ↔ 평 변환
function formatArea(val) {
  const sqm = Number(val)
  if (!sqm || isNaN(sqm)) return '-'
  const pyeong = (sqm / 3.3058).toFixed(2)
  return `${sqm.toLocaleString()}㎡ (${pyeong}평)`
}

// forwardRef 로 부모(App.js)에서 mapInst 참조 가능하게
export default forwardRef(function MapView(
  { filters, selected, mapCenter, routeTarget, isDrawerOpen },
  ref
) {
  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.9780 }
  const containerRef  = useRef(null)
  const mapInst       = useRef(null)
  const centerMarker  = useRef(null)
  const infoWin       = useRef(null)
  const markersRef    = useRef([])
  const lineRefs      = useRef([])

  // Listings 훅
  const { data: listings = [] } = useRecommend(filters)

  // 부모에서 mapInst.current 에 접근할 수 있도록
  useImperativeHandle(ref, () => mapInst.current, [])

  // 1) 맵 초기화
  useEffect(() => {
    if (!window.kakao?.maps || mapInst.current) return
    mapInst.current = new window.kakao.maps.Map(containerRef.current, {
      center: new window.kakao.maps.LatLng(
        DEFAULT_CENTER.lat,
        DEFAULT_CENTER.lng
      ),
      level: 4
    })
    infoWin.current = new window.kakao.maps.InfoWindow({
      removable: true,
      maxWidth: 350
    })
  }, [])

  // 1-1) 드로어 열림/닫힘 & center 변경 시: resize + center 재설정
  useEffect(() => {
    if (!mapInst.current) return
    window.kakao.maps.event.trigger(mapInst.current, 'resize')
    mapInst.current.setCenter(
      new window.kakao.maps.LatLng(mapCenter.lat, mapCenter.lng)
    )
  }, [isDrawerOpen, mapCenter])

  // 2) “내 위치” 스타 마커
  useEffect(() => {
    if (!mapInst.current) return
    const isDefault =
      mapCenter.lat === DEFAULT_CENTER.lat &&
      mapCenter.lng === DEFAULT_CENTER.lng
    if (isDefault) {
      centerMarker.current?.setMap(null)
      centerMarker.current = null
      return
    }
    const pos = new window.kakao.maps.LatLng(
      mapCenter.lat,
      mapCenter.lng
    )
    mapInst.current.setCenter(pos)
    centerMarker.current?.setMap(null)
    const starImg = new window.kakao.maps.MarkerImage(
      'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
      new window.kakao.maps.Size(35, 40),
      { offset: new window.kakao.maps.Point(27, 69) }
    )
    centerMarker.current = new window.kakao.maps.Marker({
      position: pos,
      image:    starImg,
      map:      mapInst.current,
      title:    '내 위치'
    })
  }, [mapCenter])

  // 3) 매물 마커 렌더링
  useEffect(() => {
    if (!mapInst.current) return
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []
    if (!filters) return

    const bounds = new window.kakao.maps.LatLngBounds()
    bounds.extend(
      new window.kakao.maps.LatLng(mapCenter.lat, mapCenter.lng)
    )

    listings.forEach(item => {
      const lat = item.위도 ?? item.lat
      const lng = item.경도 ?? item.lng
      if (lat == null || lng == null) return

      const pos = new window.kakao.maps.LatLng(lat, lng)
      const marker = new window.kakao.maps.Marker({
        position: pos,
        map:      mapInst.current,
        title:    item.단지명 || ''
      })

      window.kakao.maps.event.addListener(marker, 'click', () => {
        const addr    = item.주소   || '주소 정보 없음'
        const name    = item.단지명 || ''
        const commute = item.통근시간 != null
          ? `${item.통근시간}분`
          : '-'
        const priceBlock =
          filters.dealType === '월세'
            ? `<div>보증금: ${formatPriceMan(item.거래금액)}</div>
               <div>월세: ${formatPriceMan(item.월세금액||0)}</div>`
            : `<div>가격: ${formatPriceMan(item.거래금액)}</div>`

        const content = `
          <div style="
            padding:8px;
            width:300px;
            font-family:sans-serif;
            word-wrap:break-word;
          ">
            <div style="font-size:16px;font-weight:700;margin-bottom:6px;">
              ${addr}
            </div>
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#333;">
              ${name}
            </div>
            ${priceBlock}
            <div>면적: ${formatArea(item.전용면적||0)}</div>
            <div>통근시간: ${commute}</div>
          </div>
        `
        infoWin.current.setContent(content)
        infoWin.current.open(mapInst.current, marker)
      })

      markersRef.current.push(marker)
      bounds.extend(pos)
    })

    if (!bounds.isEmpty()) {
      mapInst.current.setBounds(bounds)
    }
  }, [filters, listings, mapCenter])

  // 4) 리스트에서 클릭된 매물 강조
  useEffect(() => {
    if (!selected || !mapInst.current) return
    const lat = selected.위도 ?? selected.lat
    const lng = selected.경도 ?? selected.lng
    if (lat == null || lng == null) return

    const pos = new window.kakao.maps.LatLng(lat, lng)
    mapInst.current.panTo(pos)

    // 클릭된 마커만 InfoWindow 열기
    const addr    = selected.주소   || '주소 정보 없음'
    const name    = selected.단지명 || ''
    const commute = selected.통근시간 != null
      ? `${selected.통근시간}분`
      : '-'
    const priceBlock =
      filters.dealType === '월세'
        ? `<div>보증금: ${formatPriceMan(selected.거래금액)}</div>
           <div>월세: ${formatPriceMan(selected.월세금액||0)}</div>`
        : `<div>가격: ${formatPriceMan(selected.거래금액)}</div>`

    const content = `
      <div style="
        padding:8px;
        width:300px;
        font-family:sans-serif;
        word-wrap:break-word;
      ">
        <div style="font-size:16px;font-weight:700;margin-bottom:6px;">
          ${addr}
        </div>
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#333;">
          ${name}
        </div>
        ${priceBlock}
        <div>면적: ${formatArea(selected.전용면적||0)}</div>
        <div>통근시간: ${commute}</div>
      </div>
    `
    infoWin.current.setContent(content)
    infoWin.current.open(
      mapInst.current,
      new window.kakao.maps.Marker({ position: pos })
    )
  }, [selected, filters])

  // 5) 경로 시각화: /api/path → 직선 보행 → loadLane → 버스/지하철 → 보행 덮어쓰기
// 5) 경로 시각화: /api/path → 첫·마지막 보행 직선 → /api/loadLane → 버스·지하철 곡선 → 보행 직선 덮어쓰기
useEffect(() => {
  if (!mapInst.current) return
  let subPath = []

  // ① 기존 마커·선 초기화
  markersRef.current.forEach(m => m.setMap(null))
  lineRefs.current.forEach(l => l.setMap(null))
  markersRef.current = []
  lineRefs.current = []

  if (!routeTarget) return

  // ② 출발지·도착지 좌표
  const SX = mapCenter.lng
  const SY = mapCenter.lat
  const EX = routeTarget.경도 ?? routeTarget.lng
  const EY = routeTarget.위도 ?? routeTarget.lat

  // ③ 출발지·도착지 마커
  const startPos = new window.kakao.maps.LatLng(SY, SX)
  const endPos   = new window.kakao.maps.LatLng(EY, EX)
  const starIcon = new window.kakao.maps.MarkerImage(
    'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
    new window.kakao.maps.Size(35, 40),
    { offset: new window.kakao.maps.Point(27, 69) }
  )
  markersRef.current.push(
    new window.kakao.maps.Marker({ position: startPos, image: starIcon, map: mapInst.current })
  )
  markersRef.current.push(
    new window.kakao.maps.Marker({ position: endPos, map: mapInst.current })
  )

  // 1) /api/path 호출 → subPath + mapObj
  fetch(`${process.env.REACT_APP_API_BASE_URL}/path?SX=${SX}&SY=${SY}&EX=${EX}&EY=${EY}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) throw new Error(data.error)

      // ④ subPath 저장
      subPath = data.subPath || []

      // ⑤ 첫·마지막 도보 직선 그리기
      const walks = subPath.filter(sp => sp.trafficType === 3)
      ;[walks[0], walks[walks.length - 1]].forEach(sp => {
        if (!sp) return
        const linePath = [
          new window.kakao.maps.LatLng(sp.startY, sp.startX),
          new window.kakao.maps.LatLng(sp.endY,   sp.endX)
        ]
        const walkLine = new window.kakao.maps.Polyline({
          map:           mapInst.current,
          path:          linePath,
          strokeWeight:  4,
          strokeColor:   WALK_COLOR,
          strokeOpacity: 0.7,
          strokeStyle:   'solid',
          zIndex:        999
        })
        lineRefs.current.push(walkLine)
      })

      // 다음 then으로 mapObj만 전달
      return data.mapObj
    })
    // 2) /api/loadLane 호출 → 버스·지하철 곡선 그리기
    .then(mo => fetch(`${process.env.REACT_APP_API_BASE_URL}/loadLane?mapObject=${encodeURIComponent(mo)}`))
    .then(r => r.json())
    .then(js => {
      // ⑥ 곡선 그리기 전 경계(bounds) 준비
      const bounds = new window.kakao.maps.LatLngBounds()
      bounds.extend(startPos)
      bounds.extend(endPos)

      // ⑦ 버스·지하철 곡선 그리기
      js.result.lane.forEach(lane => {
        if (lane.type === 3) return
        lane.section.forEach(sec => {
          const path = sec.graphPos.map(
            p => new window.kakao.maps.LatLng(p.y, p.x)
          )
          const strokeColor =
            lane.type === 2
              ? BUS_COLOR
              : SUBWAY_CODE_COLORS[1000 + lane.type] || BUS_COLOR

          const poly = new window.kakao.maps.Polyline({
            map:           mapInst.current,
            path,
            strokeWeight:  6,
            strokeColor,
            strokeOpacity: 1.0,
            strokeStyle:   'solid'
          })
          lineRefs.current.push(poly)
          poly.getPath().forEach(pt => bounds.extend(pt))
        })
      })

      // ⑧ 버스·지하철 위에 첫·마지막 도보 직선 다시 덮어쓰기
      const walksAgain = subPath.filter(sp => sp.trafficType === 3)
      ;[walksAgain[0], walksAgain[walksAgain.length - 1]].forEach(sp => {
        if (!sp) return
        const linePath = [
          new window.kakao.maps.LatLng(sp.startY, sp.startX),
          new window.kakao.maps.LatLng(sp.endY,   sp.endX)
        ]
        const walkLine = new window.kakao.maps.Polyline({
          map:           mapInst.current,
          path:          linePath,
          strokeWeight:  4,
          strokeColor:   WALK_COLOR,
          strokeOpacity: 0.7,
          strokeStyle:   'solid',
          zIndex:        999
        })
        lineRefs.current.push(walkLine)
      })

      // ⑨ 지도를 전체 경계에 맞춤
      mapInst.current.setBounds(bounds)
    })
    .catch(err => console.error('경로 시각화 에러 ▶', err))
}, [routeTarget, mapCenter])

  return (<div ref={containerRef} style={{ width:'100%', height:'100%' }} />)
})
