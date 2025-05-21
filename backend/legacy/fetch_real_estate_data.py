import requests
import json
import time
from pathlib import Path

API_KEY = "9GkEY5hjMUkZeAwTp0QFT/URpV92slWx131S38TA4yG5kVS1z5k8CukSG4HtdirVvUTgg06eFj+N/fSuEPlG7A=="
GU_CODES = {
    "강남구": "11680", "강동구": "11740", "강북구": "11305", "강서구": "11500",
    "관악구": "11620", "광진구": "11215", "구로구": "11530", "금천구": "11545",
    "노원구": "11350", "도봉구": "11320", "동대문구": "11230", "동작구": "11590",
    "마포구": "11440", "서대문구": "11410", "서초구": "11650", "성동구": "11200",
    "성북구": "11290", "송파구": "11710", "양천구": "11470", "영등포구": "11560",
    "용산구": "11170", "은평구": "11380", "종로구": "11110", "중구": "11140", "중랑구": "11260"
}
DEAL_YMD = "202404"
NUM_ROWS = 10

# 매매, 전세, 월세 각각의 API URL 매핑
DEAL_TYPES = {
    "매매": "getRTMSDataSvcNrgTrade",
    "전세": "getRTMSDataSvcNrgRent",
    "월세": "getRTMSDataSvcNrgRent"
}

def fetch_real_estate():
    all_data = []
    for gu, code in GU_CODES.items():
        for deal_type, endpoint in DEAL_TYPES.items():
            url = (
                f"https://apis.data.go.kr/1611000/{endpoint}?serviceKey={API_KEY}"
                f"&LAWD_CD={code}&dealYmd={DEAL_YMD}&numOfRows={NUM_ROWS}&_type=json"
            )
            try:
                res = requests.get(url, timeout=5)
                res.raise_for_status()
                body = res.json().get("response", {}).get("body", {})
                items = body.get("items", {}).get("item", [])
                if not isinstance(items, list):  # 단일 dict일 경우
                    items = [items]
                for item in items:
                    item["구"] = gu
                    item["거래유형"] = deal_type
                    item["lat"] = None
                    item["lng"] = None
                all_data.extend(items)
                print(f"[✓] {gu} {deal_type} 수집 완료 ({len(items)}건)")
            except Exception as e:
                print(f"[!] {gu} {deal_type} 수집 실패:", e)
            time.sleep(0.2)
    return all_data

if __name__ == "__main__":
    output_path = Path("backend/real_data_raw.json")
    output_path.parent.mkdir(exist_ok=True)
    data = fetch_real_estate()
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[✓] 총 {len(data)}건 저장 완료 → {output_path}")