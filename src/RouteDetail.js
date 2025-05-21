import React, { useEffect, useState } from 'react'
import './RouteDetail.css'
import { api } from './api'

import {
  BUS_COLOR,
  WALK_COLOR,
  SUBWAY_CODE_COLORS,
  SUBWAY_NAME_TO_CODE
} from './MapView'

// 교통수단 타입 매핑: 1=지하철, 2=버스, 3=도보
export default function RouteDetail({ routeTarget, mapCenter, companyName, departureTime, onClose }) {
  const [info, setInfo]       = useState(null)
  const [steps, setSteps]     = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!routeTarget || !mapCenter) return
    setLoading(true)
    setError(null)
    setInfo(null)
    setSteps([])

    // 출발지(집), 도착지(회사)
    const originLat = routeTarget.위도 != null ? routeTarget.위도 : routeTarget.lat
    const originLng = routeTarget.경도 != null ? routeTarget.경도 : routeTarget.lng
    const destLat   = mapCenter.lat
    const destLng   = mapCenter.lng

    // axios 인스턴스 사용
    api.get('/path', {
      params: {
        SX: originLng,
        SY: originLat,
        EX: destLng,
        EY: destLat,
        DT: departureTime
      }
    })
      .then(res => {
        const data = res.data
        if (data.error) throw new Error(data.error)
        setInfo(data.info)
        setSteps(data.subPath || [])
      })
      .catch(e => {
        console.error(e)
        setError('경로 정보를 불러오는 중 오류가 발생했습니다.')
      })
      .finally(() => setLoading(false))
  }, [routeTarget, mapCenter, departureTime])

  if (!routeTarget) return null

  // 요약 정보
  const totalTime     = info?.totalTime || 0
  const totalWalk     = info?.totalWalk || 0
  const transferCount = Math.max(0, steps.filter(s => s.trafficType !== 3).length - 1)

  // 가로 요약 타임라인
  const bars = steps.map((s, i) => {
    const secTime = s.sectionTime || s.time || 0
    const pct     = (secTime / (totalTime || 1)) * 100
    let color = '#888'
    if (s.trafficType === 2) color = BUS_COLOR
    else if (s.trafficType === 3) color = WALK_COLOR
    else {
      const laneInfo = Array.isArray(s.lane) ? s.lane[0] : s.lane
      const name     = laneInfo?.nameKor || laneInfo?.name || ''
      const code     = SUBWAY_NAME_TO_CODE[name]
      color          = SUBWAY_CODE_COLORS[code] || '#888'
    }
    return (
      <div
        key={i}
        className="timeline-bar-segment"
        style={{ flex: pct, backgroundColor: color }}
        title={`${secTime}분`}
      />
    )
  })

  return (
    <>
      <div className="route-detail">
        {loading && <div className="status">경로 불러오는 중…</div>}
        {error   && <div className="status error">{error}</div>}

        {!loading && !error && info && (
          <>
            <h3 className="route-title">{companyName}까지</h3>
            <div className="route-summary">
              <span>{Math.floor(totalTime/60)}시간 {totalTime%60}분</span>
              <span>· 도보 {totalWalk}m</span>
              <span>· 환승 {transferCount}회</span>
              {/* 전체 혼잡도 요약 */}
              {(() => {
                const subs = steps.filter(s => s.trafficType === 1 && s.avg_congestion != null)
                if (subs.length === 0) return null
                const totTime = subs.reduce((sum, s) => sum + (s.sectionTime||s.time||0), 0)
                const wSum    = subs.reduce((sum, s) => sum + ((s.sectionTime||s.time||0) * s.avg_congestion), 0)
                const avgAll  = (wSum / totTime).toFixed(1)
                const peakAll = Math.max(...subs.map(s => s.max_congestion || 0))
                return (
                  <span>· 혼잡도 {avgAll}% (최대 {peakAll}%)</span>
                )
              })()}
            </div>

            <div className="timeline-bar">{bars}</div>

            {/* 세로 스텝별 타임라인 */}
            <div className="vertical-timeline-container">
              <ul className="step-list">
                {steps.map((s, i) => {
                  const t    = s.trafficType
                  const dist = Math.round(s.distance || 0)
                  const tm   = s.sectionTime || s.time || 0
                  if (t === 3 && dist === 0 && tm === 0) return null

                  let contentJsx = null

                  if (t === 3) {
                    let pathDesc = ''
                    if (i === 0) {
                      const nextStation = steps[1]?.startName || ''
                      pathDesc = `${routeTarget.단지명 || routeTarget.name} → ${nextStation}`
                    } else if (i === steps.length - 1) {
                      const prevStation = steps[i-1]?.endName || ''
                      pathDesc = `${prevStation} → ${companyName}`
                    } else return null

                    contentJsx = (
                      <>
                        <div className="step-transit-detail">{pathDesc}</div>
                        <div className="step-meta-small">도보 ({dist}m, {tm}분)</div>
                      </>
                    )
                  } else if (t === 1) {
                    const laneInfo = Array.isArray(s.lane) ? s.lane[0] : s.lane
                    const lineName = laneInfo?.nameKor || laneInfo?.name || ''
                    contentJsx = (
                      <>
                        <div className="step-line-name">{`${lineName}:`}</div>
                        <div className="step-transit-detail">
                          {`${s.startName}역 승차 → ${s.endName}역 하차`}
                        </div>
                        <div className="step-meta-small">
                          ({s.stationCount}정거장, {tm}분 / 평균 {s.avg_congestion != null ? s.avg_congestion.toFixed(0) : '-'}%, 최대 {s.max_congestion != null ? s.max_congestion.toFixed(0) : '-'}%)
                        </div>
                      </>
                    )
                  } else if (t === 2) {
                    const busInfo = Array.isArray(s.lane) ? s.lane[0] : s.lane
                    const busNo   = busInfo?.busNoKor || busInfo?.busNo || ''
                    contentJsx = (
                      <>
                        <div className="step-line-name">{`${busNo}번:`}</div>
                        <div className="step-transit-detail">
                          {`${s.startName}승차 → ${s.endName}하차`}
                        </div>
                        <div className="step-meta-small">버스 구간</div>
                      </>
                    )
                  }

                  const cls = t === 2 ? 'bus' : t === 3 ? 'walk' : 'subway'
                  const laneInfo = Array.isArray(s.lane) ? s.lane[0] : s.lane
                  const code     = SUBWAY_NAME_TO_CODE[laneInfo?.nameKor || laneInfo?.name]
                  const lineColor = SUBWAY_CODE_COLORS[code] || ''

                  return (
                    <li key={i} className={`step-item ${cls}`} style={lineColor ? { color: lineColor } : {}}>
                      <div className="step-content">{contentJsx}</div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </div>
      <button className="back-btn" onClick={onClose}>이전으로</button>
    </>
  )
}
