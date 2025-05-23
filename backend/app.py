# src/app.py
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import os, json, requests
from datetime import datetime
from math import radians, sin, cos, sqrt, atan2
from functools import lru_cache
import logging
from flask_cors import CORS
import os, json, requests
from math import radians, sin, cos, sqrt, atan2
from functools import lru_cache
import logging
import re


# ───────────────────────────────────────────────────────────────
# 1) 여기에 발급받은 ODsay Web API Key를 넣으세요
ODSAY_API_KEY = "FxEeXTEl20Ld+DgPKA24VwfF7VVw7Yb0oeMHocGJnvE"
# ───────────────────────────────────────────────────────────────

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(message)s')

app = Flask(__name__)
CORS(app, resources={r"/api/*": {
    "origins": [
        "http://localhost:3000",
        "https://port-0-zip-pick-maxqr07lefae8062.sel4.cloudtype.app/"
    ]
}})

# ─── ① 평일 7:00~8:30 평균 지하철 혼잡도 로드 & 맵 생성 ───
# 파일 경로는 실제 위치에 맞게 조정하세요.
from datetime import datetime  # datetime 모듈 임포트

with open('subway1-8_congestion_331_07-830_weekday.json', encoding='utf-8') as f1, \
     open('subway9_congestion_2023_07-830_weekday.json', encoding='utf-8') as f9:
    raw1 = json.load(f1)
    raw9 = json.load(f9)

# (line_code, station_name, time_label) → congestion(percent)
congestion_map = {}
for item in raw1 + raw9:
    key = (
        item['line_code'],
        item['station_name'],
        item['time_label'],   # ex. "7시00분", "8시30분"
    )
    congestion_map[key] = item['congestion']

# ─── ② ISO timestamp → "7시00분"/"7시30분" 변환 ───
def to_time_label(dt_iso: str) -> str:
    dt = datetime.fromisoformat(dt_iso)
    h, m = dt.hour, dt.minute
    m = 30 if m >= 30 else 0
    return f"{h}시{m:02d}분"

def get_line_code(lane_name: str) -> int:
    """'수도권 7호선' 혹은 '9호선'에서 숫자만 추출해 반환."""
    digits = re.findall(r'\d+', lane_name)
    return int(digits[0]) if digits else None

def evaluate_congestion(subpath, time_label):
    """
    subpath     : ODsay API의 subPath 한 항목
    time_label  : "7시00분", "7시30분" 등 라벨
    반환        : {"avg": 시간 가중 평균 혼잡도, "max": 구간 내 최대 혼잡도}
    """
    # 1) 역 목록과 구간별 시간 분할
    if subpath.get('stationList'):
        stations = [st['stationName'] for st in subpath['stationList']]
        times    = [st.get('stationTime', subpath.get('sectionTime', 0))
                    for st in subpath['stationList']]
    else:
        sec      = subpath.get('sectionTime', 0) or 1
        stations = [subpath.get('startName'), subpath.get('endName')]
        times    = [sec/2, sec/2]

    total = sum(times) or 1

    # 2) 호선 번호 파싱
    lane_name = subpath['lane'][0]['name']
    line      = get_line_code(lane_name)
    if line is None:
        return {"avg": None, "max": None}

    # 3) 시간 가중 평균과 최대 혼잡도 계산
    weighted_sum = 0.0
    peak         = 0.0
    for st, t in zip(stations, times):
        cong = congestion_map.get((line, st, time_label))
        if cong is not None:
            weighted_sum += cong * (t / total)
            peak = max(peak, cong)

    return {
        "avg": round(weighted_sum, 1),
        "max": peak
    }

# 더미/실거래 JSON 데이터 로드
DATA_PATH = os.path.join(os.path.dirname(__file__), "dummy_listings.json")
with open(DATA_PATH, encoding="utf-8") as f:
    listings = json.load(f)

# --- 유틸 함수 정의 ------------------------------------------
def classify_deal_type(item):
    kind    = item.get("유형", "")
    monthly = int(str(item.get("월세금액") or 0).replace(",", "") or 0)
    if "trade" in kind:
        return "매매"
    if "rent" in kind:
        return "전세" if monthly == 0 else "월세"
    return "기타"

def haversine(lat1, lon1, lat2, lon2):
    R    = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a    = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))

def _find_station(lat, lng):
    url    = "https://api.odsay.com/v1/api/pointSearch"
    params = {
        "apiKey": ODSAY_API_KEY,
        "x": str(lng),
        "y": str(lat),
        "radius": "1500",
        "lang": "0"
    }
    try:
        r  = requests.get(url, params=params, timeout=5)
        js = r.json()
        st = js.get("result", {}).get("station", [])
        if st:
            return st[0]["stationID"]
    except Exception as e:
        logging.error("🚫 station-search error: %s", e)
    return None

@lru_cache(maxsize=512)
def get_commute_time(slat, slng, elat, elng):
    if haversine(slat, slng, elat, elng) < 700:
        return 9999
    sid = _find_station(slat, slng)
    eid = _find_station(elat, elng)
    if not sid or not eid:
        return 9999
    url    = "https://api.odsay.com/v1/api/searchPubTransPathT"
    params = {
        "apiKey": ODSAY_API_KEY,
        # 출발 ← 사용자(회사), 도착 ← 매물(집) 순서 유지
        "SX": str(slng), "SY": str(slat),
        "EX": str(elng), "EY": str(elat),
        "OPT": "0", "SearchType": "0", "SearchPathType": "0"
    }
    try:
        r  = requests.get(url, params=params, timeout=10)
        js = r.json()
        if js.get("error"):
            return 9999
        path = js.get("result", {}).get("path", [])
        if not path:
            return 9999
        return path[0]["info"]["totalTime"]
    except Exception as e:
        logging.error("🚫 path-search error: %s", e)
        return 9999

# --- 매물 전체 / 추천 API -----------------------------------
@app.route("/api/listings", methods=["GET"])
def get_all_listings():
    return Response(
        json.dumps(listings, ensure_ascii=False),
        content_type="application/json; charset=utf-8"
    )

@app.route("/api/recommend", methods=["POST"])
def recommend():
    data         = request.get_json() or {}
    slat         = float(data.get("lat", 0))
    slng         = float(data.get("lng", 0))
    budget       = int(data.get("budget", 0))
    deal_type    = data.get("deal_type", "")
    monthly_user = int(data.get("monthly", 0))
    tlim         = int(data.get("commute_limit", 0))
    cutoff       = tlim + 5  # +5분 여유

    logging.info(
        f"Request → type={deal_type}, budget={budget}, monthly_limit={monthly_user}, "
        f"time≤{tlim}min"
    )

    # 1) 예산·유형 필터링
    candidates = []
    for it in listings:
        dt      = classify_deal_type(it)
        deposit = int(str(it.get("거래금액","0")).replace(",", ""))
        monthly = int(str(it.get("월세금액") or 0).replace(",", ""))
        if dt != deal_type:
            continue
        if deal_type == "월세":
            if deposit > budget or monthly > monthly_user:
                continue
        else:
            if deposit > budget * 1.1:
                continue
        candidates.append(it)
    candidates = candidates[:10]

    # 2) 실제 통근시간 계산 & 경로 전체 구간(subPath) 조회
    results = []
    for it in candidates:
        elat   = float(it.get("위도", 0))
        elng   = float(it.get("경도", 0))
        approx = haversine(slat, slng, elat, elng) / 333
        if approx > cutoff:
            continue

        # -- ODsay 경로 API 호출 및 방어 로직 --
        path_resp = requests.get(
            "https://api.odsay.com/v1/api/searchPubTransPathT",
            params={
                "apiKey":         ODSAY_API_KEY,
                "SX":             str(slng), "SY": str(slat),
                "EX":             str(elng), "EY": str(elat),
                "OPT":            "0",
                "SearchType":     "0",
                "SearchPathType": "0"
            },
            timeout=10
        )
        resp_json = path_resp.json()
        # result 없거나 path 비어있으면 스킵
        if "result" not in resp_json or not resp_json["result"].get("path"):
            logging.error("🚫 ODsay 경로 응답 오류: %s", resp_json)
            continue

        path0 = resp_json["result"]["path"][0]
        info  = path0["info"]
        subps = path0.get("subPath", [])
        rt    = info.get("totalTime", float('inf'))

        if rt <= cutoff:
            it["통근시간"] = rt

            # -- 전체 경로에 대한 시간 가중 평균·최대 혼잡도 계산 --
            h, m       = map(int, data.get("departure_time", "07:00").split(":"))
            time_label = f"{h}시{m:02d}분"

            total_time   = 0
            weighted_sum = 0.0
            peak_max     = 0.0

            for seg in subps:
                if seg.get("trafficType") == 1:
                    sec  = seg.get("sectionTime", 0) or 0
                    congs = evaluate_congestion(seg, time_label)
                    if congs["avg"] is not None:
                        total_time   += sec
                        weighted_sum += congs["avg"] * sec
                        peak_max     = max(peak_max, congs["max"] or 0)

            it["avg_congestion"] = round(weighted_sum / total_time, 1) if total_time > 0 else None
            it["max_congestion"] = peak_max if total_time > 0 else None

            results.append(it)

    results.sort(key=lambda x: x["통근시간"])
    return jsonify(results[:10])


# --- 1) 경로(mapObj) + 상세(subPath) + 그래픽(lanes) 일괄 반환 ----
@app.route("/api/path", methods=["GET"])
def get_path_mapobj():
    # 쿼리 파라미터: 출발 ← 매물(집), 도착 ← 사용자(회사)
    sx = request.args.get("SX", type=float)
    sy = request.args.get("SY", type=float)
    ex = request.args.get("EX", type=float)
    ey = request.args.get("EY", type=float)

    # 출근시간 파라미터 DT 읽어 "7시30분" 형식으로 변환
    dt_param   = request.args.get("DT", default="07:00")
    h, m       = map(int, dt_param.split(":"))
    time_label = f"{h}시{m:02d}분"

    # 1) 경로 검색 (ODsay)
    try:
        path_resp = requests.get(
            "https://api.odsay.com/v1/api/searchPubTransPathT",
            params={
                "apiKey":         ODSAY_API_KEY,
                "SX":             str(sx), "SY": str(sy),
                "EX":             str(ex), "EY": str(ey),
                "OPT":            "0",
                "SearchType":     "0",
                "SearchPathType": "0"
            },
            timeout=10
        )
        path_js = path_resp.json()
        path0   = path_js["result"]["path"][0]
        info    = path0["info"]
        subps   = path0.get("subPath", [])

        raw   = info.get("mapObj", "")
        first = raw.split("@", 1)[0]
        if len(first.split(":")) != 2:
            raw = f"0:0@{raw}"

    except Exception as e:
        logging.error("🚫 path-detail error: %s", e)
        return jsonify({"error": "경로 기본 정보 생성 실패"}), 400

    # 2) 그래픽 로드 (loadLane)
    try:
        lane_resp = requests.get(
            "https://api.odsay.com/v1/api/loadLane",
            params={
                "apiKey":    ODSAY_API_KEY,
                "mapObject": raw,
                "lang":      "0",
                "output":    "json"
            },
            timeout=10
        )
        lane_js = lane_resp.json()
        lanes   = lane_js.get("result", {}).get("lane", [])
    except Exception as e:
        logging.error("🚫 loadLane proxy error: %s", e)
        return jsonify({"error": "경로 그래픽 정보 생성 실패"}), 500

    # 3) subPath에 avg_congestion, max_congestion 주입 (지하철만)
    for seg in subps:
        if seg.get("trafficType") == 1:  # 1=지하철
            congs = evaluate_congestion(seg, time_label)
            seg["avg_congestion"] = congs["avg"]
            seg["max_congestion"] = congs["max"]
        else:
            seg["avg_congestion"] = None
            seg["max_congestion"] = None

    # 4) 최종 반환
    return jsonify({
        "mapObj": raw,
        "info": {
            "totalTime":       info.get("totalTime"),
            "totalWalk":       info.get("totalWalk"),
            "trafficDistance": info.get("trafficDistance"),
            "payment":         info.get("payment")
        },
        "subPath": subps,
        "lanes":   lanes
    })



# --- 2) mapObj → 그래픽 데이터 --------------------------------
@app.route("/api/loadLane", methods=["GET"])
def proxy_load_lane():
    map_object = request.args.get("mapObject", "")
    if not map_object:
        return jsonify({"error": "mapObject 파라미터가 없습니다."}), 400

    first = map_object.split("@", 1)[0]
    if len(first.split(":")) != 2:
        map_object = f"0:0@{map_object}"

    try:
        lane_resp = requests.get(
            "https://api.odsay.com/v1/api/loadLane",
            params={
                "apiKey":    ODSAY_API_KEY,
                "mapObject": map_object,
                "lang":      "0",
                "output":    "json"
            },
            timeout=10
        )
        lane_js = lane_resp.json()
        # result 없거나 lane 비어있으면 빈 리스트
        if "result" not in lane_js or not lane_js["result"].get("lane"):
            logging.error("🚫 ODsay loadLane 응답 오류: %s", lane_js)
            lanes = []
        else:
            lanes = lane_js["result"]["lane"]
        return jsonify({"result": {"lane": lanes}})
    except Exception as e:
        logging.error("🚫 proxy_load_lane error: %s", e)
        return jsonify({"error": "경로 그래픽 데이터 생성 실패"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
