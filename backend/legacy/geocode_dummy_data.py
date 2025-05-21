import json
import time
import requests

KAKAO_REST_API_KEY = "18e911d85380035dff228cc1dba44960"  # 예: 18e911d8...

# 원본 파일 경로
INPUT_FILE = "dummy_data.json"
OUTPUT_FILE = "dummy_data_with_coords.json"

def get_coords_from_address(address):
    url = f"https://dapi.kakao.com/v2/local/search/address.json?query={address}"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    try:
        res = requests.get(url, headers=headers)
        res.raise_for_status()
        result = res.json()
        if result['documents']:
            x = float(result['documents'][0]['x'])
            y = float(result['documents'][0]['y'])
            return x, y
    except Exception as e:
        print(f"[ERROR] {address}: {e}")
    return None, None

def main():
    with open(INPUT_FILE, encoding="utf-8") as f:
        data = json.load(f)

    enriched = []
    for i, row in enumerate(data):
        addr = row.get("주소")
        if not addr:
            continue
        x, y = get_coords_from_address(addr)
        row["lng"] = x
        row["lat"] = y
        enriched.append(row)

        if (i + 1) % 10 == 0:
            print(f"{i+1}건 처리됨, 2초 대기 중...")
            time.sleep(2)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)
    print(f"[완료] {OUTPUT_FILE}에 저장됨.")

if __name__ == "__main__":
    main()
