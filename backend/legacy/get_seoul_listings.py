import requests
import time

# 서울 25개 구의 행정코드
seoul_gu_codes = {
    "강남구": "1168000000",
    "강동구": "1174000000",
    "강북구": "1130500000",
    "강서구": "1150000000",
    "관악구": "1162000000",
    "광진구": "1121500000",
    "구로구": "1153000000",
    "금천구": "1154500000",
    "노원구": "1135000000",
    "도봉구": "1132000000",
    "동대문구": "1123000000",
    "동작구": "1159000000",
    "마포구": "1144000000",
    "서대문구": "1141000000",
    "서초구": "1165000000",
    "성동구": "1120000000",
    "성북구": "1129000000",
    "송파구": "1171000000",
    "양천구": "1147000000",
    "영등포구": "1156000000",
    "용산구": "1117000000",
    "은평구": "1138000000",
    "종로구": "1111000000",
    "중구": "1114000000",
    "중랑구": "1126000000"
}

headers = {
    "Referer": "https://new.land.naver.com/",
    "User-Agent": "Mozilla/5.0"
}

def get_all_seoul_listings():
    results = []

    for gu, code in seoul_gu_codes.items():
        params = {
            "cortarNo": code,
            "realEstateType": "APT",
            "tradeType": "A1",  # 매매
            "order": "rank",
            "priceType": "RETAIL"
        }

        url = "https://new.land.naver.com/api/articles"
        response = requests.get(url, headers=headers, params=params)
        data = response.json().get("articleList", [])[:100]

        for item in data:
            results.append({
                "구": gu,
                "단지명": item.get("articleName"),
                "가격": item.get("dealOrWarrantPrc"),
                "면적": item.get("area1"),
                "거래유형": item.get("tradeTypeName"),
                "주소": item.get("address"),
                "위도": item.get("latitude"),
                "경도": item.get("longitude")
            })

        time.sleep(1.5)  # 차단 방지용

    return results
