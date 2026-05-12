'use client';

import { useState } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Download, Pencil, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/ai-providers';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
  onExport?: () => void;
}

export default function MessageItem({ message, isStreaming, onRegenerate, onEdit, onExport }: MessageItemProps) {
  const isUser = message.role === 'user';
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={cn('group mb-5 flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex w-full max-w-[95%] gap-3 md:max-w-[88%]', isUser ? 'flex-row-reverse' : 'flex-row')}>
        <div className="mt-1 h-7 w-7 shrink-0 overflow-hidden rounded-full border border-gray-200 bg-white">
          {isUser ? (
            <div className="flex h-full items-center justify-center text-[10px] font-semibold text-gray-600">ME</div>
          ) : (
            <Image src="/logo.png" alt="DeepSea 로고" width={28} height={28} unoptimized />
          )}
        </div>

        <div
          className={cn(
            'w-full rounded-2xl border px-4 py-3 text-[15px] leading-7 shadow-sm',
            isUser ? 'border-gray-200 bg-white' : 'border-transparent bg-transparent'
          )}
        >
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-gray-200 p-2 text-sm outline-none focus:border-gray-400"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsEditing(false)} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600">
                  취소
                </button>
                <button
                  onClick={() => {
                    onEdit?.(editContent);
                    setIsEditing(false);
                  }}
                  className="rounded-md bg-gray-900 px-2 py-1 text-xs text-white"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="prose prose-sm max-w-none break-words text-gray-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                {isStreaming && <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-gray-700 align-middle" />}
              </div>

              <div
                className={cn(
                  'mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100',
                  isUser ? 'justify-end' : 'justify-start'
                )}
              >
                {!isUser && (
                  <button onClick={handleCopy} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="복사">
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
                {!isUser && !isStreaming && onRegenerate && (
                  <button onClick={onRegenerate} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="다시 생성">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isUser && !isStreaming && onExport && (
                  <button onClick={onExport} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="내보내기">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
                {isUser && (
                  <button onClick={() => setIsEditing(true)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="수정">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
