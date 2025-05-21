import pandas as pd
import json

# 1) 원본 CSV 읽기
df = pd.read_csv(
    '서울교통공사_지하철혼잡도정보_20250331.csv',
    encoding='cp949'
)

# (디버그) 실제 컬럼명 출력
print("=== CSV Columns ===")
print(df.columns.tolist())

# 2) 뽑아낼 시간대
time_cols = ['7시00분','7시30분','8시00분','8시30분']

# 3) melt → long 포맷
df_long = df.melt(
    id_vars=['요일구분','호선','역번호','출발역','상하구분'],
    value_vars=time_cols,
    var_name='time_label',
    value_name='congestion'
)

# (디버그) 중간 컬럼명 출력
print("=== After melt Columns ===")
print(df_long.columns.tolist())

# 4) 평일 · 1~8호선 · 선택된 시간대 필터
df_filtered = df_long[
    (df_long['요일구분'] == '평일') &
    (df_long['호선']
       .astype(str)
       .str.replace('호선','')
       .astype(int)
       .between(1,8)
    ) &
    (df_long['time_label'].isin(time_cols))
]

# 5) 컬럼명 변경 및 station_name 추가
df_filtered = df_filtered.rename(columns={
    '호선':        'line_code',
    '역번호':      'station_id',
    '상하구분':    'direction',
    '출발역':      'station_name',  # 여기 컬럼명이 정확해야 합니다
})

# (디버그) 컬럼명 최종 확인
print("=== Renamed Columns ===")
print(df_filtered.columns.tolist())

# 6) 원하는 순서로 JSON 레코드 만들기
output_records = df_filtered[[
    'line_code',
    'station_id',
    'station_name',
    'direction',
    'time_label',
    'congestion'
]].to_dict(orient='records')

# 7) JSON 파일로 저장
out_path = 'subway_congestion_3월31_07-830_1to8_weekday.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output_records, f, ensure_ascii=False, indent=2)

print(f"✅ Saved {len(output_records)} records to {out_path}")
