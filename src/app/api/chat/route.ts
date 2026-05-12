import { NextRequest, NextResponse } from 'next/server';
import {
  getDefaultLocalModel,
  isTimeoutError,
  localAIFetch,
  planClarification,
  planResearchIntent,
  type Message,
} from '@/lib/ai-providers';
import { detectMode, SYSTEM_PROMPTS, type Mode } from '@/lib/modes';
import { gatherResearchPlan } from '@/lib/web-research';

export const runtime = 'nodejs';

const MODE_OPTIONS: Record<Exclude<Mode, 'auto'>, { maxTokens: number; timeoutMs: number; temperature: number }> = {
  lite: { maxTokens: 700, timeoutMs: 120000, temperature: 0.2 },
  standard: { maxTokens: 1100, timeoutMs: 120000, temperature: 0.25 },
  hardcore: { maxTokens: 1600, timeoutMs: 180000, temperature: 0.35 },
};

type ProgressStep = 'classify' | 'crawl' | 'compare' | 'compose';

function compactMessages(messages: Message[]) {
  const recent = messages.slice(-8);
  return recent.map((message) => ({
    role: message.role,
    content: String(message.content || '').slice(0, 2200),
  }));
}

function buildMessages(messages: Message[], mode: Exclude<Mode, 'auto'>, researchContext?: string): Message[] {
  const systemMessages: Message[] = [{ role: 'system', content: SYSTEM_PROMPTS[mode] }];

  if (researchContext) {
    systemMessages.push({
      role: 'system',
      content: researchContext,
    });
  }

  systemMessages.push({
    role: 'system',
    content: `Answer in Korean unless the user asks otherwise.
Be extremely detailed.
When web research exists, compare the sources against your own knowledge and explicitly note contradictions or uncertainty.
Prefer structured Markdown with sections.
Add a clear source section at the end.
Do not be brief unless the user requests brevity.`,
  });

  return [...systemMessages, ...messages.filter((message) => message.role !== 'system')];
}

function resolveMode(requestedMode: Mode, content: string): Exclude<Mode, 'auto'> {
  if (requestedMode === 'auto') {
    const detected = detectMode(content, 'auto');
    return detected === 'auto' ? 'standard' : detected;
  }

  return requestedMode;
}

function formatQuestions(questions: Array<{ question: string; reason?: string }>) {
  return questions
    .map((question, index) => {
      const number = index + 1;
      const reason = question.reason ? `\n   - 이유: ${question.reason}` : '';
      return `${number}. ${question.question}${reason}`;
    })
    .join('\n');
}

function buildResearchContextBlock(research: Awaited<ReturnType<typeof gatherResearchPlan>>, target: string, reasoning: string) {
  const lines = [
    `외부 조사 계획: ${target}`,
    reasoning ? `AI 분류 이유: ${reasoning}` : '',
    '',
    research.context,
    research.footer ? '' : '',
    research.footer || '',
    '',
    '출력 규칙:',
    '- 외부 조사 결과를 최대한 자세히 요약하고, 모델의 기존 지식과 비교한다.',
    '- 서로 다른 출처의 내용이 다르면 차이를 분명히 적는다.',
    '- 사용자가 복사하기 쉽게 Markdown으로 정리한다.',
  ].filter(Boolean);

  return lines.join('\n');
}

function makeStepEvent(step: ProgressStep, message: string) {
  return `data: {"choices":[{"delta":{"content":"[STEP:${step}] ${message.replace(/"/g, '\\"')}\\n"}}]}\n\n`;
}

function wrapStreamWithProgress(originalStream: ReadableStream<Uint8Array>, steps: Array<{ step: ProgressStep; message: string }>) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const item of steps) {
          controller.enqueue(encoder.encode(makeStepEvent(item.step, item.message)));
        }

        const reader = originalStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];

    if (rawMessages.length === 0) {
      return NextResponse.json({ error: 'Messages are required.' }, { status: 400 });
    }

    const messages = compactMessages(rawMessages);
    const lastMessage = messages[messages.length - 1];
    const requestedMode: Mode = body?.mode || 'auto';
    const mode = resolveMode(requestedMode, lastMessage?.content ?? '');
    const model = body?.model || getDefaultLocalModel();
    const clarification = await planClarification(buildMessages(messages, mode), mode, model, {
      timeoutMs: 15000,
    });

    if (clarification.needsClarification) {
      return NextResponse.json({
        type: 'clarification',
        questions: clarification.questions,
        content: formatQuestions(clarification.questions),
      });
    }

    const userQuery = messages.filter((message) => message.role === 'user').at(-1)?.content || '';
    const researchIntent = await planResearchIntent(userQuery, model, { timeoutMs: 12000 });
    const researchPlan = await gatherResearchPlan(userQuery, researchIntent.target, researchIntent.searchFocus);
    const researchContext = buildResearchContextBlock(researchPlan, researchIntent.target, researchIntent.reasoning);

    const steps: Array<{ step: ProgressStep; message: string }> = [
      {
        step: 'classify',
        message: researchIntent.target === 'person' ? 'AI가 인물 정보로 분류했습니다.' : 'AI가 일반 정보로 분류했습니다.',
      },
      {
        step: 'crawl',
        message:
          researchIntent.target === 'person'
            ? 'NamuWiki를 우선으로, Wikipedia와 Google 보조 자료를 함께 수집하는 중입니다.'
            : 'Wikipedia를 우선으로, Google 보조 자료를 함께 수집하는 중입니다.',
      },
      {
        step: 'compare',
        message: '외부 조사 결과와 모델 지식을 대조하는 중입니다.',
      },
      {
        step: 'compose',
        message: '답변을 최대한 자세하게 정리하는 중입니다.',
      },
    ];

    const originalStream = await localAIFetch(buildMessages(messages, mode, researchContext), model, MODE_OPTIONS[mode]);
    const stream = wrapStreamWithProgress(originalStream, steps);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    if (isTimeoutError(error) || (error instanceof Error && error.message === 'REQUEST_TIMEOUT')) {
      return NextResponse.json(
        { error: '로컬 AI 응답 시간이 초과되었습니다. 입력을 줄이거나 더 작은 모델로 다시 시도하세요.' },
        { status: 504 }
      );
    }

    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
