# src/app.py
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import os, json, requests
from datetime import datetime
from math import radians, sin, cos, sqrt, atan2
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote
from threading import Lock
import logging
import re


# Flask 백엔드에서 ODsay를 호출하므로 Server API Key를 환경변수로 주입합니다.
ODSAY_API_KEY = unquote(os.environ.get("ODSAY_API_KEY", "")).strip()
if not ODSAY_API_KEY:
    logging.warning("ODsay API key is not configured. Set ODSAY_API_KEY before deployment.")

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(message)s')

app = Flask(__name__)
DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://web-zip-pickfront-maxqr07lefae8062.sel4.cloudtype.app",
    "https://port-0-zip-pick-maxqr07lefae8062.sel4.cloudtype.app",
    "https://zip-pick.com",
]
configured_allowed_origins = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = list(dict.fromkeys(DEFAULT_ALLOWED_ORIGINS + configured_allowed_origins))
CORS(app, resources={r"/api/*": {
    "origins": ALLOWED_ORIGINS
}})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ODSAY_PATH_CACHE = os.path.join(BASE_DIR, "odsay_path_cache.json")
ODSAY_USAGE_PATH = os.path.join(BASE_DIR, "odsay_usage.json")
MAX_ROUTE_CANDIDATES = int(os.environ.get("MAX_ROUTE_CANDIDATES", "20"))
MAX_ROUTE_WORKERS = int(os.environ.get("MAX_ROUTE_WORKERS", "3"))
ODSAY_DAILY_BUDGET = int(os.environ.get("ODSAY_DAILY_BUDGET", "900"))
DISTANCE_BUCKETS_M = [1000, 2000, 3000, 5000, 8000, 12000, 20000, 35000, 60000]
MIN_ODSAY_TRANSIT_DISTANCE_M = 700
WALK_SPEED_M_PER_MIN = 75

cache_lock = Lock()

def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json_file(path, data):
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp_path, path)

odsay_path_cache = load_json_file(ODSAY_PATH_CACHE, {})
odsay_usage = load_json_file(ODSAY_USAGE_PATH, {})

def current_usage_day():
    return datetime.now().strftime("%Y-%m-%d")

def can_use_odsay(kind):
    today = current_usage_day()
    with cache_lock:
        if odsay_usage.get("date") != today:
            odsay_usage.clear()
            odsay_usage.update({"date": today, "total": 0, "by_kind": {}})
        total = odsay_usage.get("total", 0)
        if total >= ODSAY_DAILY_BUDGET:
            return False
        odsay_usage["total"] = total + 1
        by_kind = odsay_usage.setdefault("by_kind", {})
        by_kind[kind] = by_kind.get(kind, 0) + 1
        save_json_file(ODSAY_USAGE_PATH, odsay_usage)
        return True

def path_cache_key(sx, sy, ex, ey):
    return "|".join(f"{float(v):.6f}" for v in (sx, sy, ex, ey))

# ─── ① 평일 7:00~8:30 평균 지하철 혼잡도 로드 & 맵 생성 ───
with open(os.path.join(BASE_DIR, 'subway1-8_congestion_331_07-830_weekday.json'), encoding='utf-8') as f1, \
     open(os.path.join(BASE_DIR, 'subway9_congestion_2023_07-830_weekday.json'), encoding='utf-8') as f9:
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

BUS_CONGESTION_PATH = os.path.join(BASE_DIR, "bus_congestion_202504.json")
if os.path.exists(BUS_CONGESTION_PATH):
    with open(BUS_CONGESTION_PATH, encoding="utf-8") as f:
        bus_congestion_data = json.load(f).get("routes", {})
else:
    bus_congestion_data = {}

def normalize_bus_stop_name(value):
    value = re.sub(r"\([^)]*\)", "", str(value or ""))
    return re.sub(r"[\s·ㆍ.,\-_/]", "", value)

def get_bus_no(subpath):
    lane = subpath.get("lane") or []
    lane = lane[0] if isinstance(lane, list) and lane else lane
    raw = lane.get("busNoKor") or lane.get("busNo") or lane.get("name") or ""
    raw = str(raw).strip()
    return raw[:-1] if raw.endswith("번") else raw

def get_bus_route(bus_no):
    candidates = [bus_no, bus_no.lstrip("0"), bus_no.zfill(3)]
    for key in candidates:
        if key in bus_congestion_data:
            return key, bus_congestion_data[key]
    return None, None

def get_bus_hour_key(departure_time):
    try:
        hour = int(str(departure_time or "07:00").split(":")[0])
    except (TypeError, ValueError):
        return "07"
    if hour <= 7:
        return "07"
    if hour >= 8:
        return "08"
    return f"{hour:02d}"

def find_bus_stop_indexes(stops, name):
    target = normalize_bus_stop_name(name)
    if not target:
        return []

    exact = [i for i, stop in enumerate(stops) if stop.get("norm") == target]
    if exact:
        return exact

    matches = []
    for i, stop in enumerate(stops):
        norm = stop.get("norm", "")
        if target in norm or norm in target:
            matches.append((abs(len(norm) - len(target)), i))
    return [i for _, i in sorted(matches)]

def choose_bus_segment_indexes(start_indexes, end_indexes, stop_count):
    best = None
    for start in start_indexes:
        for end in end_indexes:
            if start == end:
                continue
            distance = end - start if end > start else stop_count - start + end
            if distance <= 0:
                continue
            if best is None or distance < best[2]:
                best = (start, end, distance)
    return best

def slice_circular(values, start, end):
    if start <= end:
        return values[start:end + 1]
    return values[start:] + values[:end + 1]

def evaluate_bus_congestion(subpath, departure_time):
    bus_no = get_bus_no(subpath)
    route_no, route = get_bus_route(bus_no)
    if not route:
        return {"avg": None, "max": None}

    hour_key = get_bus_hour_key(departure_time)
    hour_data = route.get("hours", {}).get(hour_key)
    if not hour_data or not hour_data.get("maxOnboard"):
        return {"avg": None, "max": None}

    stops = route.get("stops", [])
    start_indexes = find_bus_stop_indexes(stops, subpath.get("startName"))
    end_indexes = find_bus_stop_indexes(stops, subpath.get("endName"))
    indexes = choose_bus_segment_indexes(start_indexes, end_indexes, len(stops))
    if not indexes:
        return {"avg": None, "max": None}

    start_idx, end_idx, _ = indexes
    onboard_values = slice_circular(hour_data.get("onboard", []), start_idx, end_idx)
    onboard_values = [v for v in onboard_values if isinstance(v, (int, float))]
    if not onboard_values:
        return {"avg": None, "max": None}

    max_onboard = hour_data["maxOnboard"]
    avg_onboard = sum(onboard_values) / len(onboard_values)
    peak_onboard = max(onboard_values)
    return {
        "avg": round(avg_onboard / max_onboard * 100, 1),
        "max": round(peak_onboard / max_onboard * 100, 1),
        "source": "승하차 기반 추정",
        "hour": hour_key,
        "route_no": route_no,
        "route_name": route.get("routeName"),
        "type_name": route.get("typeName"),
        "start_seq": stops[start_idx].get("seq"),
        "end_seq": stops[end_idx].get("seq"),
    }

# 더미/실거래 JSON 데이터 로드
DATA_PATH = os.path.join(BASE_DIR, "dummy_listings.json")
if not os.path.exists(DATA_PATH):
    DATA_PATH = os.path.join(BASE_DIR, "legacy", "dummy_listings.json")
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

def normalize_listing_key(value):
    return re.sub(r"\s+", "", str(value or "").strip())

def contract_date_key(item):
    date_text = str(item.get("계약일") or "")
    digits = re.sub(r"\D", "", date_text)
    if len(digits) >= 8:
        return int(digits[:8])

    month_text = str(item.get("계약월") or "")
    month_digits = re.sub(r"\D", "", month_text)
    if len(month_digits) >= 6:
        return int(month_digits[:6] + "00")

    return 0

def search_duplicate_key(item):
    address = normalize_listing_key(item.get("주소"))
    building = normalize_listing_key(item.get("단지명"))
    property_type = normalize_listing_key(item.get("property_type") or item.get("주택유형"))
    deal_type = classify_deal_type(item)
    if not address and not building:
        return (item.get("id"), deal_type)
    return (address, building, property_type, deal_type)

def latest_listing_sort_key(item):
    return (
        contract_date_key(item),
        to_float(item.get("전용면적", 0)),
        to_int(item.get("거래금액", 0)),
        to_int(item.get("월세금액", 0)),
        str(item.get("id") or ""),
    )

def dedupe_latest_search_listings(items):
    latest_by_key = {}
    for item in items:
        key = search_duplicate_key(item)
        current = latest_by_key.get(key)
        if current is None or latest_listing_sort_key(item) > latest_listing_sort_key(current):
            latest_by_key[key] = item
    return list(latest_by_key.values())

def to_int(value, default=0):
    try:
        return int(float(str(value or default).replace(",", "")))
    except (TypeError, ValueError):
        return default

def to_float(value, default=0.0):
    try:
        return float(str(value or default).replace(",", ""))
    except (TypeError, ValueError):
        return default

def equivalent_price(deposit, monthly, multiplier=12):
    return deposit + monthly * multiplier

RECOMMENDATION_WEIGHTS = {
    "price": 0.35,
    "commute": 0.35,
    "area": 0.20,
    "congestion": 0.10,
}

def clamp_score(value, low=0.0, high=100.0):
    return max(low, min(high, float(value)))

def get_price_target(budget, monthly_user, deal_type, include_all_deal_types, budget_mode, monthly_multiplier):
    if budget <= 0:
        return 0
    if include_all_deal_types and budget_mode == "equivalent":
        return budget
    if deal_type == "월세" and monthly_user > 0:
        return equivalent_price(budget, monthly_user, monthly_multiplier)
    return budget

def get_price_value(deposit, monthly, deal_type, include_all_deal_types, budget_mode, monthly_multiplier):
    if include_all_deal_types and budget_mode == "equivalent":
        return equivalent_price(deposit, monthly, monthly_multiplier)
    if deal_type == "월세" and monthly > 0:
        return equivalent_price(deposit, monthly, monthly_multiplier)
    return deposit

def passes_budget_filter(deposit, monthly, deal_type, request_context):
    budget = request_context["budget"]
    if budget <= 0:
        return True

    if request_context["include_all_deal_types"] and request_context["budget_mode"] == "equivalent":
        return equivalent_price(deposit, monthly, request_context["monthly_multiplier"]) <= budget

    if deal_type == "월세":
        return deposit <= budget

    return deposit <= budget * 1.1

def price_fit_score(price_value, target):
    if target <= 0 or price_value <= 0:
        return 70.0, None
    gap_ratio = abs(price_value - target) / target
    over_penalty = max(0.0, (price_value - target) / target) * 40
    score = 100 - (gap_ratio * 100) - over_penalty
    return round(clamp_score(score), 1), round(gap_ratio * 100, 1)

def commute_fit_score(minutes, commute_limit):
    if minutes is None or minutes == float("inf"):
        return 50.0
    benchmark = (commute_limit + 10) if commute_limit > 0 else 60
    return round(clamp_score(100 - (float(minutes) / max(benchmark, 1)) * 70), 1)

def area_fit_score(area, min_area):
    if area <= 0:
        return 50.0
    if min_area > 0:
        ratio = area / min_area
        return round(clamp_score(70 + ((ratio - 1) / 0.5) * 30), 1)
    return round(clamp_score((area / 30) * 100), 1)

def congestion_fit_score(congestion):
    if congestion is None:
        return 65.0
    return round(clamp_score(100 - float(congestion)), 1)

def approx_commute_minutes(distance_m):
    return distance_m / 333

def route_candidate_pool(items, limit):
    if len(items) <= limit:
        return items

    selected = []
    seen = set()
    for radius in DISTANCE_BUCKETS_M:
        bucket = [item for item in items if item.get("_distance_m", float("inf")) <= radius]
        bucket.sort(key=lambda item: (-item.get("_prescore", 0), item.get("_distance_m", float("inf"))))
        for item in bucket:
            item_id = item.get("id") or f"{item.get('주소')}|{item.get('단지명')}|{item.get('계약일')}"
            if item_id in seen:
                continue
            seen.add(item_id)
            selected.append(item)
            if len(selected) >= limit:
                return selected

    remaining = sorted(
        (item for item in items if (item.get("id") or f"{item.get('주소')}|{item.get('단지명')}|{item.get('계약일')}") not in seen),
        key=lambda item: (item.get("_distance_m", float("inf")), -item.get("_prescore", 0)),
    )
    return selected + remaining[:max(0, limit - len(selected))]

def recommendation_score(item, request_context):
    deposit = to_int(item.get("거래금액", 0))
    monthly = to_int(item.get("월세금액", 0))
    area = to_float(item.get("전용면적", 0))
    deal_type = classify_deal_type(item)
    target = get_price_target(
        request_context["budget"],
        request_context["monthly_user"],
        request_context["deal_type"],
        request_context["include_all_deal_types"],
        request_context["budget_mode"],
        request_context["monthly_multiplier"],
    )
    price_value = get_price_value(
        deposit,
        monthly,
        deal_type,
        request_context["include_all_deal_types"],
        request_context["budget_mode"],
        request_context["monthly_multiplier"],
    )

    price_score, gap_percent = price_fit_score(price_value, target)
    scores = {
        "price": price_score,
        "commute": commute_fit_score(item.get("통근시간"), request_context["commute_limit"]),
        "area": area_fit_score(area, request_context["min_area"]),
        "congestion": congestion_fit_score(item.get("avg_congestion")),
    }
    total = sum(scores[key] * RECOMMENDATION_WEIGHTS[key] for key in RECOMMENDATION_WEIGHTS)
    return round(total, 1), scores, gap_percent

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
        if not can_use_odsay("pointSearch"):
            return None
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
        if not can_use_odsay("searchPubTransPathT"):
            return 9999
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

@lru_cache(maxsize=2048)
def search_public_transport_path(sx, sy, ex, ey):
    key = path_cache_key(sx, sy, ex, ey)
    with cache_lock:
        cached = odsay_path_cache.get(key)
    if cached:
        return cached

    try:
        distance_m = round(haversine(float(sy), float(sx), float(ey), float(ex)))
    except (TypeError, ValueError):
        distance_m = None

    if distance_m is not None and distance_m < MIN_ODSAY_TRANSIT_DISTANCE_M:
        minutes = max(1, round(distance_m / WALK_SPEED_M_PER_MIN))
        result = {
            "result": {
                "path": [{
                    "pathType": 3,
                    "info": {
                        "totalTime": minutes,
                        "totalWalk": distance_m,
                        "trafficDistance": 0,
                        "payment": 0,
                        "mapObj": "",
                    },
                    "subPath": [{
                        "trafficType": 3,
                        "distance": distance_m,
                        "sectionTime": minutes,
                        "startX": float(sx),
                        "startY": float(sy),
                        "endX": float(ex),
                        "endY": float(ey),
                    }],
                }]
            },
            "localWalkOnly": True,
        }
        with cache_lock:
            odsay_path_cache[key] = result
            save_json_file(ODSAY_PATH_CACHE, odsay_path_cache)
        return result

    if not can_use_odsay("searchPubTransPathT"):
        return {"error": [{"code": "LOCAL_LIMIT", "message": "ODsay daily safety budget reached."}]}

    resp = requests.get(
        "https://api.odsay.com/v1/api/searchPubTransPathT",
        params={
            "apiKey":         ODSAY_API_KEY,
            "SX":             str(sx), "SY": str(sy),
            "EX":             str(ex), "EY": str(ey),
            "OPT":            "0",
            "SearchType":     "0",
            "SearchPathType": "0"
        },
        timeout=12
    )
    result = resp.json()
    if not result.get("error"):
        with cache_lock:
            odsay_path_cache[key] = result
            save_json_file(ODSAY_PATH_CACHE, odsay_path_cache)
    return result

# --- 매물 전체 / 추천 API -----------------------------------
@app.route("/api/listings", methods=["GET"])
def get_all_listings():
    return Response(
        json.dumps(listings, ensure_ascii=False),
        content_type="application/json; charset=utf-8"
    )

@app.route("/api/market-activity", methods=["GET"])
def get_market_activity():
    activity_path = os.path.join(BASE_DIR, "market_activity_seoul.json")
    if not os.path.exists(activity_path):
        return jsonify({"regions": [], "message": "market_activity_seoul.json 파일이 없습니다."})
    with open(activity_path, encoding="utf-8") as f:
        return Response(
            json.dumps(json.load(f), ensure_ascii=False),
            content_type="application/json; charset=utf-8"
        )

def compact_place_name(item, query):
    address = item.get("address") or {}
    display_name = item.get("display_name") or query
    first_display_part = display_name.split(",")[0].strip()

    name_candidates = [
        item.get("name"),
        (item.get("namedetails") or {}).get("name"),
        address.get("amenity"),
        address.get("university"),
        address.get("school"),
        address.get("college"),
        address.get("hospital"),
        address.get("station"),
        address.get("railway"),
        address.get("bus_stop"),
        address.get("tourism"),
        address.get("office"),
        address.get("shop"),
        address.get("leisure"),
        address.get("building"),
        first_display_part,
    ]

    for name in name_candidates:
        if name:
            return str(name).strip()
    return query

def compact_place_address(item, title):
    address = item.get("address") or {}
    display_name = item.get("display_name") or ""
    city = address.get("city") or address.get("province") or address.get("state")
    district = (
        address.get("city_district")
        or address.get("borough")
        or address.get("county")
        or address.get("suburb")
    )
    road = address.get("road") or address.get("pedestrian") or address.get("footway")
    house_number = address.get("house_number")

    parts = []
    for value in [city, district, road]:
        if value and value not in parts and value != title:
            parts.append(value)
    if house_number and road:
        parts[-1] = f"{road} {house_number}"
    elif house_number:
        parts.append(str(house_number))

    if parts:
        return " ".join(parts)

    display_parts = [
        part.strip()
        for part in display_name.split(",")
        if part.strip() and part.strip() != title
    ]
    return " ".join(display_parts[:3])

@app.route("/api/geocode", methods=["GET"])
def geocode():
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return jsonify([])

    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "json",
                "addressdetails": "1",
                "namedetails": "1",
                "limit": "5",
                "countrycodes": "kr",
            },
            headers={
                "User-Agent": "zip-pick-local/1.0"
            },
            timeout=10
        )
        resp.raise_for_status()
        places = []
        for item in resp.json():
            lat = item.get("lat")
            lon = item.get("lon")
            if lat is None or lon is None:
                continue
            title = compact_place_name(item, query)
            places.append({
                "name": title,
                "address": compact_place_address(item, title),
                "fullName": item.get("display_name", title),
                "type": item.get("type"),
                "lat": float(lat),
                "lng": float(lon),
            })
        return jsonify(places)
    except Exception as e:
        logging.error("geocode error: %s", e)
        return jsonify({"error": "주소 검색 실패"}), 502

@app.route("/api/recommend", methods=["POST"])
def recommend():
    data         = request.get_json() or {}
    slat         = float(data.get("lat", 0))
    slng         = float(data.get("lng", 0))
    budget       = to_int(data.get("budget", 0))
    deal_type    = data.get("deal_type", "")
    monthly_user = to_int(data.get("monthly", 0))
    min_area     = to_float(data.get("min_area", 0))
    budget_mode  = data.get("budget_mode", "strict")
    monthly_multiplier = to_int(data.get("monthly_multiplier", 12), 12)
    tlim         = to_int(data.get("commute_limit", 0))
    cutoff       = tlim + 5 if tlim > 0 else float("inf")  # +5분 여유
    include_all_deal_types = deal_type in ("", "전체", "all")
    request_context = {
        "budget": budget,
        "monthly_user": monthly_user,
        "deal_type": deal_type,
        "include_all_deal_types": include_all_deal_types,
        "budget_mode": budget_mode,
        "monthly_multiplier": monthly_multiplier,
        "commute_limit": tlim,
        "min_area": min_area,
    }

    logging.info(
        f"Request → type={deal_type}, budget={budget}, monthly_limit={monthly_user}, "
        f"budget_mode={budget_mode}, monthly_x={monthly_multiplier}, "
        f"min_area={min_area}, time≤{tlim}min"
    )

    # 1) 예산·유형 필터링. 여기서 통과한 매물만 거리 확장/ODsay 후보가 된다.
    search_source_listings = dedupe_latest_search_listings(listings)
    candidates = []
    budget_passed_count = 0
    for it in search_source_listings:
        dt      = classify_deal_type(it)
        deposit = to_int(it.get("거래금액", 0))
        monthly = to_int(it.get("월세금액", 0))
        area    = to_float(it.get("전용면적", 0))

        if not include_all_deal_types and dt != deal_type:
            continue

        if not passes_budget_filter(deposit, monthly, dt, request_context):
            continue

        if monthly_user > 0 and dt == "월세" and monthly > monthly_user:
            continue

        budget_passed_count += 1

        if min_area > 0 and area < min_area:
            continue

        it = dict(it)
        it["환산금액"] = equivalent_price(deposit, monthly, monthly_multiplier)
        candidates.append(it)

    def enrich_candidate(it):
        try:
            distance_m = haversine(slat, slng, float(it.get("위도", 0)), float(it.get("경도", 0)))
        except (TypeError, ValueError):
            distance_m = float("inf")
        temp = dict(it)
        temp["통근시간"] = approx_commute_minutes(distance_m)
        score, _, _ = recommendation_score(temp, request_context)
        it["_distance_m"] = distance_m
        it["_approx_commute"] = temp["통근시간"]
        it["_prescore"] = score
        return it

    condition_passed_count = len(candidates)
    candidates = [enrich_candidate(it) for it in candidates]
    candidates = route_candidate_pool(candidates, MAX_ROUTE_CANDIDATES)
    logging.info(
        "Candidate flow → source=%s, deduped=%s, budget_passed=%s, condition_passed=%s, odsay_candidates=%s",
        len(listings),
        len(search_source_listings),
        budget_passed_count,
        condition_passed_count,
        min(len(candidates), MAX_ROUTE_CANDIDATES),
    )

    h, m       = map(int, data.get("departure_time", "07:00").split(":"))
    time_label = f"{h}시{m:02d}분"

    def build_recommendation(it):
        elat   = float(it.get("위도", 0))
        elng   = float(it.get("경도", 0))
        approx = it.get("_approx_commute")
        if approx is None:
            approx = approx_commute_minutes(haversine(slat, slng, elat, elng))
        if approx > cutoff:
            return None

        resp_json = search_public_transport_path(
            round(slng, 7), round(slat, 7), round(elng, 7), round(elat, 7)
        )

        # result 없거나 path 비어있으면 스킵
        if "result" not in resp_json or not resp_json["result"].get("path"):
            logging.error("🚫 ODsay 경로 응답 오류: %s", resp_json)
            return None

        path0 = resp_json["result"]["path"][0]
        info  = path0["info"]
        subps = path0.get("subPath", [])
        rt    = info.get("totalTime", float('inf'))

        if rt > cutoff:
            return None

        item = dict(it)
        item.pop("_distance_m", None)
        item.pop("_approx_commute", None)
        item.pop("_prescore", None)
        item["통근시간"] = rt
        item["직선거리"] = round(haversine(slat, slng, elat, elng))

        # 전체 경로에 대한 시간 가중 평균·최대 혼잡도 계산
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
            elif seg.get("trafficType") == 2:
                sec  = seg.get("sectionTime", 0) or 0
                congs = evaluate_bus_congestion(seg, data.get("departure_time", "07:00"))
                if congs["avg"] is not None:
                    total_time   += sec
                    weighted_sum += congs["avg"] * sec
                    peak_max     = max(peak_max, congs["max"] or 0)

        item["avg_congestion"] = round(weighted_sum / total_time, 1) if total_time > 0 else None
        item["max_congestion"] = peak_max if total_time > 0 else None
        score, components, price_gap_percent = recommendation_score(item, request_context)
        item["recommendation_score"] = score
        item["score_components"] = components
        item["score_weights"] = RECOMMENDATION_WEIGHTS
        item["price_gap_percent"] = price_gap_percent
        return item

    # 2) 실제 통근시간 계산 & 경로 전체 구간(subPath) 조회
    results = []
    with ThreadPoolExecutor(max_workers=MAX_ROUTE_WORKERS) as executor:
        futures = [executor.submit(build_recommendation, it) for it in candidates]
        for future in as_completed(futures):
            try:
                item = future.result()
            except Exception as e:
                logging.error("🚫 recommendation-build error: %s", e)
                continue
            if item:
                results.append(item)

    results.sort(key=lambda x: x.get("recommendation_score", 0), reverse=True)
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
        path_js = search_public_transport_path(
            round(sx, 7), round(sy, 7), round(ex, 7), round(ey, 7)
        )
        if path_js.get("error"):
            logging.error("🚫 ODsay path 응답 오류: %s", path_js)
            return jsonify({"error": "경로 기본 정보 생성 실패"}), 400
        path0   = path_js["result"]["path"][0]
        info    = path0["info"]
        subps   = path0.get("subPath", [])

        raw = info.get("mapObj", "")
        if raw:
            first = raw.split("@", 1)[0]
            if len(first.split(":")) != 2:
                raw = f"0:0@{raw}"

    except Exception as e:
        logging.error("🚫 path-detail error: %s", e)
        return jsonify({"error": "경로 기본 정보 생성 실패"}), 400

    # 2) 그래픽 로드 (loadLane)
    lanes = []
    if raw:
        try:
            if not can_use_odsay("loadLane"):
                return jsonify({"error": "ODsay 일일 안전예산을 초과했습니다."}), 429
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

    # 3) subPath에 avg_congestion, max_congestion 주입
    for seg in subps:
        if seg.get("trafficType") == 1:  # 1=지하철
            congs = evaluate_congestion(seg, time_label)
            seg["avg_congestion"] = congs["avg"]
            seg["max_congestion"] = congs["max"]
            seg["congestion_source"] = "지하철 혼잡도"
        elif seg.get("trafficType") == 2:  # 2=버스
            congs = evaluate_bus_congestion(seg, dt_param)
            seg["avg_congestion"] = congs["avg"]
            seg["max_congestion"] = congs["max"]
            seg["congestion_source"] = congs.get("source")
            seg["bus_congestion"] = congs
        else:
            seg["avg_congestion"] = None
            seg["max_congestion"] = None
            seg["congestion_source"] = None

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
        if not can_use_odsay("loadLane"):
            return jsonify({"error": "ODsay 일일 안전예산을 초과했습니다."}), 429
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
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", debug=debug, port=port)
