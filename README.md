# DeepSea Local

DeepSea Local is a chat interface for structuring and refining ideas. It keeps the existing Next.js UI and now targets the NVIDIA OpenAI-compatible API for streaming chat completions.

## Features

- Streaming chat completions through NVIDIA's OpenAI-compatible endpoint
- Direct local access without login
- Lite, Standard, Hardcore, and Auto response modes
- Markdown rendering with copy, edit, and regenerate actions

## Requirements

- Node.js 20+
- npm
- NVIDIA API key

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Prepare environment variables:
   ```bash
   copy .env.example .env.local
   ```

3. Set `NVIDIA_API_KEY` in `.env.local` and, if needed, adjust `NVIDIA_MODEL`.

4. Start the Next.js app:
   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` and start chatting immediately.

## Environment Variables

```env
NVIDIA_API_KEY=your-nvidia-api-key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=deepseek-ai/deepseek-v3.2
```

Use any NVIDIA-hosted model name that the endpoint supports for `NVIDIA_MODEL`.

## Scripts

```bash
npm run dev
npm run build
npm start
npm run lint
```
