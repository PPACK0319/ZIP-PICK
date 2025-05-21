import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api',
  timeout: 5000,
});

// 예시: /recommend 엔드포인트 호출
export const fetchRecommendations = (filters) =>
  api.get('/recommend', { params: filters });
