# Streaming Notes

The app keeps the client-side OpenAI-style SSE parser, but the server now streams NVIDIA OpenAI-compatible chunks into that format.

## Server Flow

- `src/app/api/chat/route.ts` receives chat requests directly.
- `src/lib/ai-providers.ts` calls `https://integrate.api.nvidia.com/v1` through the OpenAI SDK.
- Each SDK chunk is converted to `data: {"choices":[{"delta":{"content":"...","reasoning_content":"..."}}]}` when those fields are present.
- The stream ends with `data: [DONE]`.

Authentication is no longer part of the flow; `/chat` is directly accessible.

## Local Timeouts

The server still uses longer timeouts for slow reasoning models:

- Client timeout: 180 seconds
- Lite/Standard server timeout: 120 seconds
- Hardcore server timeout: 180 seconds
