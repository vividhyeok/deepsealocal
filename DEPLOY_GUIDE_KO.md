# DeepSea Local 로컬 실행 가이드

이 프로젝트는 NVIDIA의 OpenAI 호환 API를 사용하는 Next.js 앱입니다. 로그인 절차는 제거했고, 로컬 실행용 래퍼로 바로 열리도록 구성합니다.

## 1. 필수 설치

- Node.js 20 이상
- npm
- NVIDIA API 키

## 2. 환경 변수

`.env.example`을 `.env.local`로 복사한 뒤 필요한 값을 조정합니다.

```env
NVIDIA_API_KEY=your-nvidia-api-key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=deepseek-ai/deepseek-v3.2
```

## 3. 모델 설정

기본 모델은 `deepseek-ai/deepseek-v3.2`입니다.

필요하면 `NVIDIA_MODEL`을 지원되는 다른 모델명으로 바꿔도 됩니다.

## 4. 앱 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속하면 바로 채팅 화면이 열립니다.

## 5. 문제 해결

- `NVIDIA API key is not set`: `.env.local`의 `NVIDIA_API_KEY`를 확인하세요.
- `NVIDIA OpenAI-compatible API server is not reachable`: 네트워크와 `NVIDIA_BASE_URL`을 확인하세요.
- 응답이 느림: 더 작은 `NVIDIA_MODEL`을 사용하거나 `lite` 모드로 전환하세요.
