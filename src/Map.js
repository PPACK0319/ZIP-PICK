// src/MapView.js
import React, { useEffect, useRef } from 'react'
import { useRecommend } from './hooks/useRecommend'

// “3억 2,683만” 포맷 함수 (입력값은 ‘만원’ 단위)
function formatPriceMan(val) {
  const amt = Number(val)
  const eok = Math.floor(amt / 10000)
  const man = amt % 10000
  if (eok > 0) {
    return man > 0 ? `${eok}억 ${man.toLocaleString()}만` : `${eok}억`
  }
  return `${amt.toLocaleString()}만`
}

// 평수 ↔ ㎡ 상호 변환 함수
function formatArea(val) {
  const sqm    = Number(val)
  const pyeong = sqm / 3.3058
  return `${sqm.toLocaleString()}㎡ (${pyeong.toFixed(2)}평)`
}

export default function MapView({ filters, selected, mapCenter }) {
  const DEFAULT_CENTER = { lat: 37.5665, lng: 126.9780 }
  const mapRef       = useRef(null)
  const mapInst      = useRef(null)
  const centerMarker = useRef(null)
  const infoWin      = useRef(null)
  const markersRef   = useRef([])

  // filters가 있을 때만 호출
  const { data: listings = [] } = useRecommend(filters)

  // 1) 맵 초기화
  useEffect(() => {
    if (!window.kakao?.maps) return

    mapInst.current = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(
        DEFAULT_CENTER.lat,
        DEFAULT_CENTER.lng
      ),
      level: 4
    })

    // InfoWindow 생성 (닫기 버튼 + 너비 제한 확대)
    infoWin.current = new window.kakao.maps.InfoWindow({
      removable: true,
      maxWidth: 300
    })
  }, [])

  // 2) mapCenter 변경 시 (노란별 마커)
  useEffect(() => {
    if (!mapInst.current) return

    if (
      mapCenter.lat === DEFAULT_CENTER.lat &&
      mapCenter.lng === DEFAULT_CENTER.lng
    ) {
      centerMarker.current?.setMap(null)
      centerMarker.current = null
      return
    }

    const latLng = new window.kakao.maps.LatLng(mapCenter.lat, mapCenter.lng)
    mapInst.current.setCenter(latLng)
    centerMarker.current?.setMap(null)

    const markerImage = new window.kakao.maps.MarkerImage(
      'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
      new window.kakao.maps.Size(35, 40),
      { offset: new window.kakao.maps.Point(27, 69) }
    )
    centerMarker.current = new window.kakao.maps.Marker({
      position: latLng,
      image: markerImage,
      map: mapInst.current,
      title: '내 위치'
    })
  }, [mapCenter])

  // 3) 매물 마커 렌더링
  useEffect(() => {
    if (!mapInst.current) return
    if (!filters) {
      markersRef.current.forEach(m => m.setMap(null))
      markersRef.current = []
      return
    }

    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    const bounds = new window.kakao.maps.LatLngBounds()
    bounds.extend(new window.kakao.maps.LatLng(
      mapCenter.lat,
      mapCenter.lng
    ))

    listings.forEach(item => {
      const lat = item.위도  || item.lat
      const lng = item.경도  || item.lng
      if (lat == null || lng == null) return

      const pos    = new window.kakao.maps.LatLng(lat, lng)
      const marker = new window.kakao.maps.Marker({
        position: pos,
        map:       mapInst.current,
        title:     item.단지명 || ''
      })

      window.kakao.maps.event.addListener(marker, 'mouseover', () => {
        mapRef.current.style.cursor = 'pointer'
      })
      window.kakao.maps.event.addListener(marker, 'mouseout', () => {
        mapRef.current.style.cursor = ''
      })

      window.kakao.maps.event.addListener(marker, 'click', () => {
        const addr    = item.주소   || '주소 정보 없음'
        const name    = item.단지명 || ''
        const commute = item.통근시간 != null ? `${item.통근시간}분` : '-'

        // 팝업 내용 HTML
        const content = `
          <div style="
            padding:8px;
            width:300px;
            font-size:14px;
            line-height:1.4;
            word-wrap:break-word;
          ">
            <strong style="display:block;margin-bottom:6px;">${addr}</strong>
            <small style="display:block;margin-bottom:8px;color:#555;">${name}</small>
            ${filters.dealType === '월세'
              ? `<div>보증금: ${formatPriceMan(item.거래금액)}</div>
                 <div>월세: ${formatPriceMan(item.월세금액||0)}</div>`
              : `<div>가격: ${formatPriceMan(item.거래금액)}</div>`
            }
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

  // 4) 리스트에서 선택된 매물 강조
  useEffect(() => {
    if (!selected || !mapInst.current) return

    const lat = selected.위도 || selected.lat
    const lng = selected.경도 || selected.lng
    if (lat == null || lng == null) return

    const pos = new window.kakao.maps.LatLng(lat, lng)
    mapInst.current.panTo(pos)

    const addr    = selected.주소   || '주소 정보 없음'
    const name    = selected.단지명 || ''
    const commute = selected.통근시간 != null ? `${selected.통근시간}분` : '-'

    const content = `
      <div style="
        padding:8px;
        width:250px;
        font-size:14px;
        line-height:1.4;
        word-wrap:break-word;
      ">
        <strong style="display:block;margin-bottom:6px;">${addr}</strong>
        <small style="display:block;margin-bottom:8px;color:#555;">${name}</small>
        ${filters.dealType === '월세'
          ? `<div>보증금: ${formatPriceMan(selected.거래금액)}</div>
             <div>월세: ${formatPriceMan(selected.월세금액||0)}</div>`
          : `<div>가격: ${formatPriceMan(selected.거래금액)}</div>`
        }
        <div>면적: ${formatArea(selected.전용면적||0)}</div>
        <div>통근시간: ${commute}</div>
      </div>
    `

    infoWin.current.setContent(content)
    infoWin.current.open(mapInst.current,
      new window.kakao.maps.Marker({ position: pos })
    )
  }, [selected])

  return (
    <div
      ref={mapRef}
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box'
      }}
    />
  )
}