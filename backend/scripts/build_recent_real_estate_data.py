import argparse
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import unquote

import requests


SEOUL_GU_CODES = {
    "종로구": "11110",
    "중구": "11140",
    "용산구": "11170",
    "성동구": "11200",
    "광진구": "11215",
    "동대문구": "11230",
    "중랑구": "11260",
    "성북구": "11290",
    "강북구": "11305",
    "도봉구": "11320",
    "노원구": "11350",
    "은평구": "11380",
    "서대문구": "11410",
    "마포구": "11440",
    "양천구": "11470",
    "강서구": "11500",
    "구로구": "11530",
    "금천구": "11545",
    "영등포구": "11560",
    "동작구": "11590",
    "관악구": "11620",
    "서초구": "11650",
    "강남구": "11680",
    "송파구": "11710",
    "강동구": "11740",
}


SERVICES = [
    {
        "key": "apartment_trade",
        "property_type": "아파트",
        "deal_kind": "매매",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
        "name_fields": ("aptNm", "aptName", "apartmentName"),
    },
    {
        "key": "apartment_rent",
        "property_type": "아파트",
        "deal_kind": "전월세",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
        "name_fields": ("aptNm", "aptName", "apartmentName"),
    },
    {
        "key": "officetel_trade",
        "property_type": "오피스텔",
        "deal_kind": "매매",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
        "name_fields": ("offiNm", "offiName", "buildingName"),
    },
    {
        "key": "officetel_rent",
        "property_type": "오피스텔",
        "deal_kind": "전월세",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
        "name_fields": ("offiNm", "offiName", "buildingName"),
    },
    {
        "key": "rowhouse_trade",
        "property_type": "연립다세대",
        "deal_kind": "매매",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
        "name_fields": ("mhouseNm", "houseNm", "buildingName"),
    },
    {
        "key": "rowhouse_rent",
        "property_type": "연립다세대",
        "deal_kind": "전월세",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
        "name_fields": ("mhouseNm", "houseNm", "buildingName"),
    },
    {
        "key": "single_house_trade",
        "property_type": "단독다가구",
        "deal_kind": "매매",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
        "name_fields": ("houseType", "buildingName"),
    },
    {
        "key": "single_house_rent",
        "property_type": "단독다가구",
        "deal_kind": "전월세",
        "url": "https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent",
        "name_fields": ("houseType", "buildingName"),
    },
]


def last_completed_months(count, today=None):
    today = today or date.today()
    year = today.year
    month = today.month - 1
    if month == 0:
        year -= 1
        month = 12

    values = []
    for _ in range(count):
        values.append(f"{year}{month:02d}")
        month -= 1
        if month == 0:
            year -= 1
            month = 12
    return list(reversed(values))


def text(item, *names, default=""):
    for name in names:
        node = item.find(name)
        if node is not None and node.text is not None:
            value = node.text.strip()
            if value:
                return value
    return default


def clean_money(value):
    cleaned = str(value or "").replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return "0"
    try:
        return f"{int(float(cleaned)):,}"
    except ValueError:
        return "0"


def clean_area(value):
    cleaned = str(value or "").replace(",", "").strip()
    if not cleaned:
        return "0"
    try:
        return str(round(float(cleaned), 3)).rstrip("0").rstrip(".")
    except ValueError:
        return "0"


def normalize_key(*parts):
    return "|".join(
        "".join(str(part or "").lower().split()).replace("-", "").replace("ㆍ", "").replace("·", "")
        for part in parts
    )


def month_from_contract(year, month):
    try:
        return f"{int(year):04d}{int(month):02d}"
    except ValueError:
        return ""


def parse_contract_date(year, month, day):
    try:
        return f"{int(year):04d}.{int(month):02d}.{int(day):02d}"
    except ValueError:
        return ""


def parse_transaction(item, service, gu_name, lawd_code):
    dong = text(item, "umdNm", "dong", "법정동").strip()
    jibun = text(item, "jibun", "bonbun", "지번").strip()
    name = text(item, *service["name_fields"]).strip()
    year = text(item, "dealYear", "년")
    month = text(item, "dealMonth", "월")
    day = text(item, "dealDay", "일")
    contract_month = month_from_contract(year, month)
    contract_date = parse_contract_date(year, month, day)

    deposit = text(item, "deposit", "보증금액", "rentDeposit")
    monthly = text(item, "monthlyRent", "월세금액")
    amount = text(item, "dealAmount", "거래금액")
    is_rent = service["deal_kind"] == "전월세"
    deal_amount = clean_money(deposit if is_rent else amount)
    monthly_amount = clean_money(monthly if is_rent else 0)

    if not dong or not contract_month:
        return None

    address = f"서울특별시 {gu_name} {dong}"
    if jibun:
        address = f"{address} {jibun}"

    return {
        "id": f"{service['key']}-{lawd_code}-{contract_date}-{dong}-{jibun}-{name}",
        "source": "molit_rtms",
        "service": service["key"],
        "property_type": service["property_type"],
        "deal_kind": service["deal_kind"],
        "구": gu_name,
        "법정동": dong,
        "지번": jibun,
        "유형": service["key"],
        "주소": address,
        "단지명": name or service["property_type"],
        "전용면적": clean_area(text(item, "excluUseAr", "exclusiveUseArea", "전용면적")),
        "층": text(item, "floor", "층", default=""),
        "거래금액": deal_amount,
        "월세금액": monthly_amount,
        "계약월": contract_month,
        "계약일": contract_date,
        "건축년도": text(item, "buildYear", "건축년도", default=""),
    }


def fetch_page(session, service, service_key, lawd_code, deal_ymd, page_no, num_rows):
    params = {
        "serviceKey": service_key,
        "LAWD_CD": lawd_code,
        "DEAL_YMD": deal_ymd,
        "pageNo": page_no,
        "numOfRows": num_rows,
    }
    response = session.get(service["url"], params=params, timeout=20)
    response.raise_for_status()
    return ET.fromstring(response.content)


def parse_response(root):
    total_text = root.findtext(".//totalCount") or "0"
    try:
        total_count = int(total_text)
    except ValueError:
        total_count = 0
    items = root.findall(".//item")
    result_code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    result_msg = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg")
    return total_count, items, result_code, result_msg


def fetch_service_month(session, service, service_key, lawd_code, gu_name, deal_ymd, num_rows, sleep_sec):
    rows = []
    page_no = 1
    total_count = None

    while True:
        root = fetch_page(session, service, service_key, lawd_code, deal_ymd, page_no, num_rows)
        total_count, items, result_code, result_msg = parse_response(root)
        if result_code and result_code not in ("00", "0000", "NORMAL SERVICE."):
            print(f"[warn] {service['key']} {gu_name} {deal_ymd}: {result_code} {result_msg}")

        for item in items:
            parsed = parse_transaction(item, service, gu_name, lawd_code)
            if parsed:
                rows.append(parsed)

        if total_count <= page_no * num_rows or not items:
            break
        page_no += 1
        time.sleep(sleep_sec)

    return rows


def load_legacy_coordinate_index(path):
    if not path.exists():
        return {}

    with path.open(encoding="utf-8") as f:
        legacy = json.load(f)

    index = {}
    for item in legacy:
        lat = item.get("위도")
        lng = item.get("경도")
        if lat is None or lng is None:
            continue
        gu = item.get("구", "")
        address = item.get("주소", "")
        dong = address.split()[2] if len(address.split()) >= 3 else ""
        jibun = address.split()[3] if len(address.split()) >= 4 else ""
        name = item.get("단지명", "")
        coords = {"위도": lat, "경도": lng}
        for key in (
            normalize_key(address),
            normalize_key(gu, dong, jibun),
            normalize_key(gu, dong, jibun, name),
            normalize_key(gu, name),
        ):
            if key:
                index.setdefault(key, coords)
    return index


def attach_coordinates(rows, coordinate_index):
    listings = []
    missing = 0
    seen = set()

    for row in rows:
        keys = (
            normalize_key(row["주소"]),
            normalize_key(row["구"], row["법정동"], row["지번"]),
            normalize_key(row["구"], row["법정동"], row["지번"], row["단지명"]),
            normalize_key(row["구"], row["단지명"]),
        )
        coords = next((coordinate_index.get(key) for key in keys if coordinate_index.get(key)), None)
        if not coords:
            missing += 1
            continue

        dedupe_key = normalize_key(
            row["service"],
            row["주소"],
            row["단지명"],
            row["전용면적"],
            row["층"],
            row["거래금액"],
            row["월세금액"],
            row["계약일"],
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        listing = dict(row)
        listing["위도"] = coords["위도"]
        listing["경도"] = coords["경도"]
        listings.append(listing)

    return listings, missing


def cap_search_listings(listings, max_per_group):
    if not max_per_group or max_per_group <= 0:
        return listings

    grouped = defaultdict(list)
    for item in listings:
        grouped[(item.get("구"), item.get("service"), item.get("계약월"))].append(item)

    capped = []
    for group_items in grouped.values():
        group_items.sort(
            key=lambda item: (
                item.get("계약일", ""),
                float(str(item.get("전용면적", "0")).replace(",", "") or 0),
            ),
            reverse=True,
        )
        capped.extend(group_items[:max_per_group])
    return capped


def aggregate_activity(rows, months):
    gu_stats = {
        gu: {
            "gu": gu,
            "lawd_cd": code,
            "total": 0,
            "by_month": {month: 0 for month in months},
            "by_property_type": defaultdict(int),
            "by_deal_kind": defaultdict(int),
        }
        for gu, code in SEOUL_GU_CODES.items()
    }

    for row in rows:
        gu = row["구"]
        month = row["계약월"]
        stat = gu_stats[gu]
        stat["total"] += 1
        if month in stat["by_month"]:
            stat["by_month"][month] += 1
        stat["by_property_type"][row["property_type"]] += 1
        stat["by_deal_kind"][row["deal_kind"]] += 1

    last3 = months[-3:]
    prev3 = months[:3]
    counts = []
    changes = []
    for stat in gu_stats.values():
        last_count = sum(stat["by_month"].get(month, 0) for month in last3)
        prev_count = sum(stat["by_month"].get(month, 0) for month in prev3)
        change_rate = None if prev_count == 0 else round((last_count - prev_count) / prev_count * 100, 1)
        stat["last3_count"] = last_count
        stat["prev3_count"] = prev_count
        stat["change_rate"] = change_rate
        counts.append(last_count)
        changes.append(max(change_rate or 0, 0))

    max_count = max(counts) if counts else 1
    max_change = max(changes) if changes else 1
    max_count = max(max_count, 1)
    max_change = max(max_change, 1)

    scored = []
    for stat in gu_stats.values():
        count_score = stat["last3_count"] / max_count * 100
        change_score = max(stat["change_rate"] or 0, 0) / max_change * 100
        score = round(count_score * 0.7 + change_score * 0.3, 1)
        stat["activity_score"] = score
        scored.append(score)

    sorted_scores = sorted(scored)

    def grade(score):
        if not sorted_scores:
            return 1
        rank = sorted_scores.index(score)
        percentile = rank / max(len(sorted_scores) - 1, 1)
        return min(5, int(percentile * 5) + 1)

    for stat in gu_stats.values():
        stat["activity_grade"] = grade(stat["activity_score"])
        stat["by_property_type"] = dict(stat["by_property_type"])
        stat["by_deal_kind"] = dict(stat["by_deal_kind"])

    return {
        "generated_at": date.today().isoformat(),
        "months": months,
        "basis": "최근 3개월 거래건수 70% + 직전 3개월 대비 증가율 30%",
        "regions": list(gu_stats.values()),
    }


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def sanitize_error(value):
    return re.sub(r"serviceKey=[^&\\s)]+", "serviceKey=***", str(value))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-key", default=os.environ.get("PUBLIC_DATA_SERVICE_KEY", ""))
    parser.add_argument("--months", nargs="*", default=None)
    parser.add_argument("--month-count", type=int, default=6)
    parser.add_argument("--output-dir", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--legacy-listings", default="")
    parser.add_argument("--num-rows", type=int, default=1000)
    parser.add_argument("--sleep", type=float, default=0.08)
    parser.add_argument("--save-raw", action="store_true")
    parser.add_argument("--allow-empty", action="store_true")
    parser.add_argument("--max-search-listings-per-group", type=int, default=20)
    parser.add_argument("--gu", nargs="*", default=None)
    parser.add_argument("--services", nargs="*", default=None)
    args = parser.parse_args()

    service_key = unquote(args.service_key).strip()
    if not service_key:
        raise SystemExit("PUBLIC_DATA_SERVICE_KEY 또는 --service-key가 필요합니다.")

    output_dir = Path(args.output_dir)
    legacy_path = Path(args.legacy_listings) if args.legacy_listings else output_dir / "legacy" / "dummy_listings.json"
    months = args.months or last_completed_months(args.month_count)

    all_rows = []
    errors = []
    session = requests.Session()
    gu_items = [
        (gu_name, lawd_code)
        for gu_name, lawd_code in SEOUL_GU_CODES.items()
        if not args.gu or gu_name in args.gu or lawd_code in args.gu
    ]
    service_items = [
        service
        for service in SERVICES
        if not args.services or service["key"] in args.services
    ]

    for month in months:
        for gu_name, lawd_code in gu_items:
            for service in service_items:
                try:
                    rows = fetch_service_month(
                        session,
                        service,
                        service_key,
                        lawd_code,
                        gu_name,
                        month,
                        args.num_rows,
                        args.sleep,
                    )
                    all_rows.extend(rows)
                    print(f"[ok] {month} {gu_name} {service['key']}: {len(rows)}")
                except Exception as exc:
                    message = sanitize_error(f"{month} {gu_name} {service['key']}: {exc}")
                    print(f"[error] {message}")
                    errors.append(message)
                time.sleep(args.sleep)

    if not all_rows and not args.allow_empty:
        summary = {
            "months": months,
            "transaction_count": 0,
            "search_listing_count": 0,
            "missing_coordinate_count": 0,
            "error_count": len(errors),
            "errors": errors[:20],
            "skipped_outputs": True,
            "message": "수집된 거래가 없어 기존 JSON 출력을 덮어쓰지 않았습니다.",
        }
        write_json(output_dir / "recent_real_estate_build_summary.json", summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    coordinate_index = load_legacy_coordinate_index(legacy_path)
    listings, missing_coords = attach_coordinates(all_rows, coordinate_index)
    listings = cap_search_listings(listings, args.max_search_listings_per_group)
    activity = aggregate_activity(all_rows, months)

    write_json(output_dir / "market_activity_seoul.json", activity)
    write_json(output_dir / "dummy_listings.json", listings)
    if args.save_raw:
        write_json(output_dir / "recent_transactions_seoul_6m.json", all_rows)

    summary = {
        "months": months,
        "transaction_count": len(all_rows),
        "search_listing_count": len(listings),
        "missing_coordinate_count": missing_coords,
        "error_count": len(errors),
        "errors": errors[:20],
        "outputs": {
            "market_activity": str(output_dir / "market_activity_seoul.json"),
            "search_listings": str(output_dir / "dummy_listings.json"),
            "raw_transactions": str(output_dir / "recent_transactions_seoul_6m.json") if args.save_raw else None,
        },
    }
    write_json(output_dir / "recent_real_estate_build_summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
