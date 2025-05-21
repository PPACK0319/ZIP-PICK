from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import xml.etree.ElementTree as ET
import httpx

app = FastAPI()

# CORS 설정 (React Native 연결 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 공공데이터포털 인증키
API_KEY = "9GkEY5hjMUkZeAwTp0QFT/URpV92slWx131S38TA4yG5kVS1z5k8CukSG4HtdirVvUTgg06eFj+N/fSuEPlG7A=="

# 카카오 REST API 키
KAKAO_REST_API_KEY = "18e911d85380035dff228cc1dba44960"

@app.get("/")
def read_root():
    return {"message": "ZIP-PICK 백엔드 서버가 작동 중입니다."}

# 주소 → 위경도 변환
def geocode_address(address: str):
    url = "https://dapi.kakao.com/v2/local/search/address.json"
    headers = {
        "Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"
    }
    params = {
        "query": address
    }
    try:
        response = httpx.get(url, headers=headers, params=params, timeout=10.0)
        if response.status_code == 200:
            documents = response.json().get("documents", [])
            if documents:
                location = documents[0]
                return float(location["y"]), float(location["x"])
    except Exception as e:
        print("Geocoding 실패:", e)
    return None, None

# 아파트 실거래가 + 위경도 연동
@app.get("/fetch-apartments")
def fetch_apartment_data():
    url = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
    params = {
        "serviceKey": API_KEY,
        "LAWD_CD": "11110",       # 서울 종로구
        "DEAL_YMD": "202401",     # 2024년 1월
        "pageNo": "1",
        "numOfRows": "1",
    }

    try:
        response = httpx.get(url, params=params, timeout=10.0)
        if response.status_code != 200:
            return {"error": "요청 실패", "status": response.status_code}

        root = ET.fromstring(response.text)
        items = root.findall(".//item")

        results = []
        for item in items:
            apt_name = item.findtext("aptNm")
            road_name = item.findtext("roadNm")
            bonbun = item.findtext("roadNmBonbun")  # 건물 본번

            if not road_name or not bonbun:
                continue  # 주소 정보가 불완전한 경우 생략

            # 카카오 주소검색용 문자열 (예: 종로66길 28)
            address = f"서울특별시 종로구 {road_name} {bonbun}".strip()
            lat, lng = geocode_address(address)

            results.append({
                "단지명": apt_name,
                "주소": item.findtext("jibun"),
                "도로명": road_name,
                "건물번호": bonbun,
                "위도": lat,
                "경도": lng,
                "전용면적": item.findtext("excluUseAr"),
                "거래금액": item.findtext("dealAmount"),
                "층": item.findtext("floor"),
                "건축년도": item.findtext("buildYear"),
                "계약일": f"{item.findtext('dealYear')}.{item.findtext('dealMonth')}.{item.findtext('dealDay')}",
            })

        return {"아파트거래": results}

    except Exception as e:
        return {"error": str(e)}
