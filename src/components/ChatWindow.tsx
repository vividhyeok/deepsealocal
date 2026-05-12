'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Copy, Plus, Send, Square } from 'lucide-react';
import MessageItem from './MessageItem';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/ai-providers';

const CLIENT_TIMEOUT_MS = 180000;

type ProgressStepId = 'classify' | 'crawl' | 'compare' | 'compose';

type ProgressStep = {
  id: ProgressStepId;
  title: string;
  detail: string;
  status: 'pending' | 'active' | 'done';
};

const DEFAULT_PROGRESS_STEPS: ProgressStep[] = [
  {
    id: 'classify',
    title: '정보 유형 분류',
    detail: '질문이 인물인지 일반 정보인지 AI가 먼저 판별합니다.',
    status: 'pending',
  },
  {
    id: 'crawl',
    title: '외부 조사',
    detail: '인물은 NamuWiki 우선, 일반 정보는 Wikipedia 우선으로 크롤링하고 Google 보조 자료를 함께 확인합니다.',
    status: 'pending',
  },
  {
    id: 'compare',
    title: '대조 분석',
    detail: '수집된 자료와 모델 내부 지식을 비교해서 차이와 불확실성을 정리합니다.',
    status: 'pending',
  },
  {
    id: 'compose',
    title: '답변 작성',
    detail: '복사하기 쉬운 긴 형식으로, 최대한 자세하게 답변을 정리합니다.',
    status: 'pending',
  },
];

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>(DEFAULT_PROGRESS_STEPS);
  const [copiedLatest, setCopiedLatest] = useState(false);

  const mode = 'auto' as const;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isInitialState = messages.length === 0;
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
  }, [input]);

  const stopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
    setProgressSteps(DEFAULT_PROGRESS_STEPS);
    stopGeneration();
  };

  const updateProgressStep = (id: ProgressStepId, detail?: string) => {
    setProgressSteps((prev) =>
      prev.map((step) => {
        if (step.id === id) {
          return {
            ...step,
            status: 'active',
            detail: detail || step.detail,
          };
        }

        if (step.status === 'active') {
          return {
            ...step,
            status: 'done',
          };
        }

        return step;
      })
    );
  };

  const completeProgress = () => {
    setProgressSteps((prev) => prev.map((step) => ({ ...step, status: 'done' })));
  };

  const sendMessage = async (content: string, overrideMessages?: Message[]) => {
    if ((!content.trim() && !overrideMessages) || isLoading) return;

    const history = overrideMessages || [...messages, { role: 'user' as const, content }];
    setMessages(history);
    setInput('');
    setIsLoading(true);
    setProgressSteps(DEFAULT_PROGRESS_STEPS);

    abortControllerRef.current = new AbortController();
    const timeoutId = setTimeout(() => abortControllerRef.current?.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, mode }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || response.statusText || 'Failed to generate response');
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();

        if (data?.type === 'clarification' && Array.isArray(data.questions) && data.questions.length > 0) {
          const clarificationText = formatClarificationMessage(data.questions);
          setMessages([...history, { role: 'assistant', content: clarificationText }]);
          completeProgress();
          return;
        }
      }

      if (!response.body) {
        throw new Error('응답 스트림이 비어 있습니다.');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') {
            completeProgress();
            continue;
          }

          let parsed: { choices?: Array<{ delta?: { content?: string } }> };
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const token = parsed.choices?.[0]?.delta?.content || '';
          const stepMatch = token.match(/^\[STEP:(classify|crawl|compare|compose)\]\s*(.*)$/s);

          if (stepMatch) {
            const [, stepId, detail] = stepMatch as [string, ProgressStepId, string];
            updateProgressStep(stepId, detail || undefined);
            continue;
          }

          accumulated += token;
        }

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: accumulated };
          return updated;
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '요청 시간이 초과되었습니다. 입력을 줄이거나 로컬 모델 상태를 확인한 뒤 다시 시도하세요.',
          },
        ]);
      } else {
        const message = error instanceof Error ? error.message : '응답 생성 중 오류가 발생했습니다.';
        setMessages((prev) => [...prev, { role: 'assistant', content: `오류: ${message}` }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleContinue = () => {
    const continuation: Message = {
      role: 'user',
      content: '위 내용을 이어서 정리해줘.',
    };
    sendMessage('', [...messages, continuation]);
  };

  const handleRegenerate = () => {
    const latest = messages[messages.length - 1];
    if (latest?.role !== 'assistant') return;

    const history = messages.slice(0, -1);
    setMessages(history);
    sendMessage('', history);
  };

  const handleEditMessage = (index: number, newContent: string) => {
    const history: Message[] = [...messages.slice(0, index), { role: 'user', content: newContent }];
    sendMessage('', history);
  };

  const handleCopyLatest = async () => {
    if (!latestAssistantMessage?.content) return;
    await navigator.clipboard.writeText(latestAssistantMessage.content);
    setCopiedLatest(true);
    setTimeout(() => setCopiedLatest(false), 1200);
  };

  return (
    <div className="flex h-screen flex-col bg-[#f7f7f8] text-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-200/80 bg-[#f7f7f8]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-gray-700 transition hover:bg-white"
          >
            <Image src="/logo.png" alt="DeepSea 로고" width={24} height={24} unoptimized />
            <span>DeepSea Local</span>
          </button>

          <div className="flex items-center gap-2">
            {!isInitialState && (
              <button
                onClick={handleNewChat}
                className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:text-gray-900"
                title="새 채팅"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full max-w-5xl flex-1 px-4',
          isInitialState ? 'flex items-center justify-center' : 'overflow-y-auto pb-44 pt-6'
        )}
      >
        {isInitialState ? (
          <section className="w-full max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="relative h-24 w-24 overflow-hidden rounded-2xl shadow-xl ring-1 ring-gray-200 transition-transform duration-300 hover:scale-105">
                <Image src="/logo.png" alt="DeepSea Local Logo" fill className="object-contain" priority unoptimized />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-5xl">질문부터 답변까지 품질을 정리합니다</h1>
                <p className="text-sm text-gray-500 md:text-lg">
                  AI가 정보 유형을 먼저 분류하고, 인물은 NamuWiki 중심으로, 일반 정보는 Wikipedia 중심으로 크롤링한 뒤 최대한 자세하게 정리합니다.
                </p>
              </div>
            </div>
            <InputBox textareaRef={textareaRef} input={input} onInput={setInput} onSend={() => sendMessage(input)} isLoading={isLoading} onStop={stopGeneration} />
          </section>
        ) : (
          <section className="mx-auto w-full max-w-3xl space-y-1">
            {messages.map((message, index) => (
              <MessageItem
                key={index}
                message={message}
                isStreaming={isLoading && index === messages.length - 1 && message.role === 'assistant'}
                onRegenerate={index === messages.length - 1 && message.role === 'assistant' ? handleRegenerate : undefined}
                onEdit={(content) => handleEditMessage(index, content)}
              />
            ))}
            <div ref={messagesEndRef} />
          </section>
        )}
      </main>

      {!isInitialState && (
        <footer className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-[#f7f7f8]/90 px-4 py-4 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl space-y-2">
            <ProgressPanel steps={progressSteps} />

            <InputBox textareaRef={textareaRef} input={input} onInput={setInput} onSend={() => sendMessage(input)} isLoading={isLoading} onStop={stopGeneration} />

            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                {isLoading && (
                  <button
                    onClick={handleContinue}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:text-gray-900"
                  >
                    <ArrowRight className="h-3 w-3" />
                    이어서 작성
                  </button>
                )}

                {latestAssistantMessage?.content && !isLoading && (
                  <button
                    onClick={handleCopyLatest}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:text-gray-900"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedLatest ? '복사됨' : '최신 답변 복사'}
                  </button>
                )}
              </div>

              <p className="text-center text-[11px] text-gray-500">중요한 정보는 직접 확인하세요.</p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function ProgressPanel({ steps }: { steps: ProgressStep[] }) {
  const activeStep = steps.find((step) => step.status === 'active');
  const completedCount = steps.filter((step) => step.status === 'done').length;

  return (
    <details className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <summary className="cursor-pointer list-none text-sm font-medium text-gray-800">
        {activeStep ? `작업 중: ${activeStep.title}` : '작업 상태'}
        <span className="ml-2 text-xs text-gray-500">{completedCount}/{steps.length}</span>
      </summary>
      <div className="mt-3 space-y-2">
        {steps.map((step) => (
          <div key={step.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-gray-800">{step.title}</div>
              <span className="text-[11px] text-gray-500">
                {step.status === 'active' ? '진행 중' : step.status === 'done' ? '완료' : '대기'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-600">{step.detail}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function formatClarificationMessage(questions: Array<{ question: string; reason?: string; type?: string; options?: string[] }>) {
  const lines = ['## 먼저 확인할 것', ''];

  questions.slice(0, 3).forEach((question, index) => {
    const label = `${index + 1}. ${question.question}`;
    lines.push(label);

    if (question.reason) {
      lines.push(`   - 이유: ${question.reason}`);
    }

    if (Array.isArray(question.options) && question.options.length > 0) {
      lines.push(`   - 예시: ${question.options.join(' / ')}`);
    }
  });

  lines.push('', '위 질문에 답하면 바로 다음 단계로 이어서 정리할게요.');
  return lines.join('\n');
}

interface InputBoxProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  onInput: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
  onStop: () => void;
}

function InputBox({ textareaRef, input, onInput, onSend, isLoading, onStop }: InputBoxProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder="정리하고 싶은 생각이나 초안을 입력하세요."
        rows={1}
        className="min-h-14 max-h-45 w-full resize-none rounded-xl border-0 px-3 py-3 text-[15px] outline-none placeholder:text-gray-400"
      />

      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        {isLoading ? (
          <button onClick={onStop} className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white">
            <Square className="mr-1 h-3.5 w-3.5" />
            중지
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim()}
            className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="mr-1 h-3.5 w-3.5" />
            전송
          </button>
        )}
      </div>
    </div>
  );
}
