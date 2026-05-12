import OpenAI from 'openai';
import { CLARIFICATION_POLICY } from '@/lib/modes';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LocalAIOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface OpenAIChunkDelta {
  content?: string | null;
  reasoning_content?: string | null;
}

interface OpenAIChunkLike {
  choices?: Array<{
    delta?: OpenAIChunkDelta;
  }>;
}

export interface ClarificationQuestion {
  question: string;
  reason?: string;
  type?: 'open' | 'yesno' | 'choice';
  options?: string[];
}

export interface ClarificationPlan {
  needsClarification: boolean;
  questions: ClarificationQuestion[];
}

export type ResearchTarget = 'person' | 'general';

export interface ResearchIntentPlan {
  target: ResearchTarget;
  reasoning: string;
  searchFocus: string;
}

const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NVIDIA_MODEL = 'deepseek-ai/deepseek-v3.2';

export function getDefaultLocalModel() {
  return process.env.NVIDIA_MODEL || process.env.LOCAL_AI_MODEL || DEFAULT_NVIDIA_MODEL;
}

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'REQUEST_TIMEOUT' || error.name === 'TimeoutError' || error.name === 'AbortError';
}

function getNvidiaApiKey() {
  return process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY || '';
}

function getNvidiaBaseUrl() {
  return (process.env.NVIDIA_BASE_URL || DEFAULT_NVIDIA_BASE_URL).replace(/\/$/, '');
}

function extractJsonObject(text: string) {
  const startIndex = text.indexOf('{');
  const endIndex = text.lastIndexOf('}');

  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  try {
    return JSON.parse(text.slice(startIndex, endIndex + 1));
  } catch {
    return null;
  }
}

function normalizeClarificationPlan(value: unknown): ClarificationPlan | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<ClarificationPlan> & { questions?: unknown };
  const questions = Array.isArray(candidate.questions)
    ? candidate.questions
        .map((question) => {
          if (!question || typeof question !== 'object') return null;

          const item = question as Partial<ClarificationQuestion>;
          const questionText = String(item.question || '').trim();
          if (!questionText) return null;

          const normalized: ClarificationQuestion = { question: questionText };
          const reason = String(item.reason || '').trim();
          if (reason) normalized.reason = reason;

          const type = item.type;
          if (type === 'open' || type === 'yesno' || type === 'choice') {
            normalized.type = type;
          }

          if (Array.isArray(item.options)) {
            const options = item.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 6);
            if (options.length > 0) {
              normalized.options = options;
            }
          }

          return normalized;
        })
        .filter((question): question is ClarificationQuestion => Boolean(question))
        .slice(0, 3)
    : [];

  return {
    needsClarification: Boolean(candidate.needsClarification) && questions.length > 0,
    questions,
  };
}

function createOpenAIClient() {
  const apiKey = getNvidiaApiKey();

  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY is not set.');
  }

  return new OpenAI({
    apiKey,
    baseURL: getNvidiaBaseUrl(),
  });
}

function normalizeResearchIntentPlan(value: unknown): ResearchIntentPlan | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<ResearchIntentPlan>;
  const target = candidate.target === 'person' || candidate.target === 'general' ? candidate.target : null;
  if (!target) return null;

  return {
    target,
    reasoning: String(candidate.reasoning || '').trim(),
    searchFocus: String(candidate.searchFocus || '').trim(),
  };
}

function buildClarificationPrompt(mode: string) {
  return `You are a question optimizer for a chat wrapper.

Task:
- Decide whether the user's request can be answered now.
- If the request is underspecified, ask only the minimum number of questions needed, up to 3.
- Prefer the order: goal/success criterion, constraints/context, output format/audience.
- Prefer yes/no or multiple-choice wording when possible.
- If a safe assumption can unblock the task, do that instead of asking.
- Never ask more questions than necessary.

Output rules:
- Return JSON only.
- Schema:
  {"needsClarification": boolean, "questions": [{"question": string, "reason"?: string, "type"?: "open"|"yesno"|"choice", "options"?: string[]} ] }
- Questions must be concise and concrete.
- Max 3 questions.

Mode context: ${mode}

Policy:
${CLARIFICATION_POLICY}`;
}

function buildResearchIntentPrompt() {
  return `You classify what kind of information the user is asking for.

Return JSON only.
Schema:
{"target":"person"|"general","reasoning":"string","searchFocus":"string"}

Rules:
- Use "person" when the request is about a human being, profile, career, history, biography, or identity.
- Use "general" for concepts, places, products, technical topics, events, or abstract information.
- Keep reasoning short.
- searchFocus should be a compact query string optimized for web lookup.
- Do not add extra keys.
`;
}

function toOpenAISSE(delta: OpenAIChunkDelta) {
  const payload: { choices: Array<{ delta: { content?: string; reasoning_content?: string } }> } = {
    choices: [{ delta: {} }],
  };

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    payload.choices[0].delta.content = delta.content;
  }

  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    payload.choices[0].delta.reasoning_content = delta.reasoning_content;
  }

  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createStreamingResponseBody(upstreamBody: AsyncIterable<OpenAIChunkLike>) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of upstreamBody) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          const hasContent = typeof delta.content === 'string' && delta.content.length > 0;
          const hasReasoning = typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0;

          if (!hasContent && !hasReasoning) continue;

          controller.enqueue(encoder.encode(toOpenAISSE(delta)));
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      if (typeof (upstreamBody as AsyncIterator<OpenAIChunkLike>).return === 'function') {
        await (upstreamBody as AsyncIterator<OpenAIChunkLike>).return?.();
      }
    },
  });
}

export async function localAIFetch(
  messages: Message[],
  model = getDefaultLocalModel(),
  options: LocalAIOptions = {}
) {
  const { temperature = 0.25, maxTokens = 700, timeoutMs = 120000 } = options;

  try {
    const client = createOpenAIClient();
    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        temperature,
        top_p: 0.95,
        max_tokens: maxTokens,
        extra_body: {
          chat_template_kwargs: {
            thinking: true,
          },
        },
      },
      {
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    return createStreamingResponseBody(stream);
  } catch (error: unknown) {
    if (isTimeoutError(error)) {
      throw new Error('REQUEST_TIMEOUT');
    }

    if (error instanceof TypeError) {
      throw new Error('NVIDIA OpenAI-compatible API server is not reachable. Check NVIDIA_API_KEY and network access.');
    }

    throw error;
  }
}

export async function planClarification(
  messages: Message[],
  mode: string,
  model = getDefaultLocalModel(),
  options: LocalAIOptions = {}
): Promise<ClarificationPlan> {
  const { timeoutMs = 30000 } = options;

  try {
    const client = createOpenAIClient();
    const response = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'system', content: buildClarificationPrompt(mode) }, ...messages],
        temperature: 0,
        top_p: 1,
        max_tokens: 400,
      },
      {
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    const content = response.choices[0]?.message?.content ?? '';
    const parsed = normalizeClarificationPlan(extractJsonObject(content));

    if (parsed) {
      return parsed;
    }
  } catch {
    // Fail open: if planning fails, answer directly instead of blocking the user.
  }

  return {
    needsClarification: false,
    questions: [],
  };
}

export async function planResearchIntent(
  query: string,
  model = getDefaultLocalModel(),
  options: LocalAIOptions = {}
): Promise<ResearchIntentPlan> {
  const { timeoutMs = 12000 } = options;

  try {
    const client = createOpenAIClient();
    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: buildResearchIntentPrompt() },
          { role: 'user', content: query },
        ],
        temperature: 0,
        top_p: 1,
        max_tokens: 200,
      },
      {
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    const parsed = normalizeResearchIntentPlan(extractJsonObject(response.choices[0]?.message?.content ?? ''));
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fail open.
  }

  const fallbackTarget: ResearchTarget = /[가-힣]{2,}|actor|singer|director|ceo|founder|배우|가수|작가|정치인|프로필/i.test(query)
    ? 'person'
    : 'general';

  return {
    target: fallbackTarget,
    reasoning: 'Fallback classification used because the AI classification request failed.',
    searchFocus: query.trim(),
  };
}
