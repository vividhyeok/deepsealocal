# DeepSea Local 개발 메모

## 현재 구성

- Next.js App Router 기반 로컬 웹 앱
- 로그인 없이 바로 열리는 로컬 래퍼
- AI 응답은 NVIDIA OpenAI 호환 API로 중계
- 기본 모델은 `NVIDIA_MODEL=deepseek-ai/deepseek-v3.2`

## 실행 흐름

1. 브라우저에서 `/chat` 접속
2. `/chat`에서 메시지를 `/api/chat`으로 전송
3. 서버 라우트가 NVIDIA OpenAI 호환 스트림을 기존 SSE 형태로 변환
4. 클라이언트가 기존 스트리밍 UI에 토큰을 누적 표시

## 로컬 실행 체크리스트

```bash
npm install
copy .env.example .env.local
NVIDIA_API_KEY를 `.env.local`에 설정
npm run dev
```

`http://localhost:3000`으로 접속합니다.
