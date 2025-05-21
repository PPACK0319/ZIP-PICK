# backend/process_9호선_congestion_all_sheets.py

import pandas as pd
import numpy as np
import re
import json

# 1) Excel 모든 시트 읽기 (두 번째 행을 컬럼명으로)
xls = pd.read_excel(
    '2023년 9호선 역별 시간별 혼잡도 자료.xlsx',
    engine='openpyxl',
    header=1,
    sheet_name=None
)

records = []

# 2) 평일 시트만 처리
for sheet_name, raw in xls.items():
    if '평일' not in sheet_name:
        continue

    # 시트명에서 방향·운행구분 추출
    m = re.match(r'(상선|하선)(일반|급행)\(평일\)', sheet_name)
    if not m:
        continue
    direction    = '상행' if m.group(1) == '상선' else '하행'
    service_type = '완행' if m.group(2) == '일반'  else '급행'

    # 메타 열 제거
    raw.columns = raw.columns.str.strip()
    drop_cols = [c for c in raw.columns if c.startswith('Unnamed') or c.startswith('(기준일자')]
    df = raw.drop(columns=drop_cols)

    # 역명: '구분' 컬럼에서 바로 사용
    df['station_name'] = df['구분'].astype(str).str.strip()

    # 7:00~8:30 네 구간만 뽑기
    wanted = ['07:00~07:29','07:30~07:59','08:00~08:29','08:30~08:59']
    found  = [c for c in wanted if c in df.columns]

    # melt → long
    df_long = df.melt(
        id_vars=['station_name'],
        value_vars=found,
        var_name='time_label',
        value_name='congestion'
    )

    # time_label을 "7시00분" 형식으로
    df_long['time_label'] = df_long['time_label'].str.replace(
        r'(\d{2}):(\d{2})~.*',
        lambda m: f"{int(m.group(1))}시{m.group(2)}분",
        regex=True
    )

    # 고정값 채우기
    df_long['line_code']    = 9          # 숫자 9
    df_long['station_id']   = None       # None → null
    df_long['direction']    = direction
    df_long['service_type'] = service_type

    # 1~8호선 스키마와 같은 순서로 재배열
    for rec in df_long.to_dict(orient='records'):
        records.append({
            'line_code':    rec['line_code'],
            'station_id':   rec['station_id'],
            'station_name': rec['station_name'],
            'direction':    rec['direction'],
            'time_label':   rec['time_label'],
            'congestion':   rec['congestion'],
            'service_type': rec['service_type'],
        })

# JSON 저장
out_path = 'subway9_congestion_2023_07-830_weekday.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(records, f, ensure_ascii=False, indent=2)

print(f"✅ 저장 완료: {out_path} ({len(records)} 레코드)")
