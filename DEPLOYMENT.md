# ZIP-PICK Deployment Notes

## GitHub

Do not commit local secrets or generated runtime files.

Ignored files include:

- `.env`
- `node_modules/`
- `build/`
- `backend/odsay_path_cache.json`
- `backend/odsay_usage.json`
- `backend/recent_transactions_seoul_6m.json`
- Python `__pycache__/`

The large raw 6-month transaction file is not required at runtime. Runtime search uses the refined JSON files such as `backend/dummy_listings.json`, `backend/market_activity_seoul.json`, and congestion JSON files.

## Frontend Environment

Create environment variables in the frontend deployment service:

```env
REACT_APP_API_BASE_URL=https://your-backend-domain/api
REACT_APP_KAKAO_JS_KEY=your-kakao-javascript-key
```

Local example:

```env
REACT_APP_API_BASE_URL=http://localhost:5000/api
REACT_APP_KAKAO_JS_KEY=your-kakao-javascript-key
```

## Backend Environment

Create environment variables in the backend deployment service:

```env
ODSAY_API_KEY=your-odsay-server-api-key
ALLOWED_ORIGINS=https://your-frontend-domain,http://localhost:3000
ODSAY_DAILY_BUDGET=900
MAX_ROUTE_CANDIDATES=20
MAX_ROUTE_WORKERS=3
FLASK_DEBUG=0
```

## Cloudtype Backend

Recommended backend settings:

- Root directory: `backend`
- Install command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 120`

After deploying the backend, check the service outbound IP and register it in ODsay LAB as the Server IP for the Server API key.

## Cloudtype Frontend

Recommended frontend settings:

- Root directory: project root
- Build command: `npm ci && npm run build`
- Publish directory: `build`

Set `REACT_APP_API_BASE_URL` to the deployed backend API URL before building.

## Local Run

Backend:

```powershell
cd backend
$env:ODSAY_API_KEY="your-odsay-server-api-key"
python app.py
```

Frontend:

```powershell
copy .env.example .env
npm.cmd start
```
