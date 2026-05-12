
import type { Message } from './ai-providers';
import type { Mode } from './modes';

export interface ConversationData {
    messages: Message[];
    mode: Mode;
    date: string;
}

export function generateMarkdown(data: ConversationData): string {
    const frontmatter = `---
mode: ${data.mode}
date: ${data.date}
---

`;

    const content = data.messages.map(m => {
        const roleTitle = m.role === 'user' ? '## User' : m.role === 'assistant' ? '## Assistant' : '## System';
        return `${roleTitle}\n\n${m.content}\n`;
    }).join('\n');

    return frontmatter + content;
}

export function parseMarkdown(text: string): ConversationData {
    const lines = text.split('\n');
    let mode: Mode = 'standard';
    let date = new Date().toISOString();
    const messages: Message[] = [];

    // Parse Frontmatter
    let i = 0;
    if (lines[0].trim() === '---') {
        i = 1;
        while (i < lines.length && lines[i].trim() !== '---') {
            const line = lines[i];
            if (line.startsWith('mode:')) mode = line.split(':')[1].trim() as Mode;
            if (line.startsWith('date:')) date = line.split(':')[1].trim();
            i++;
        }
        i++; // Skip closing ---
    }

    // Parse Messages
    let currentRole: 'user' | 'assistant' | 'system' | null = null;
    let currentContent: string[] = [];

    const pushMessage = () => {
        if (currentRole && currentContent.length > 0) {
            messages.push({
                role: currentRole,
                content: currentContent.join('\n').trim(),
            });
            currentContent = [];
        }
    };

    for (; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '## User') {
            pushMessage();
            currentRole = 'user';
        } else if (line.trim() === '## Assistant') {
            pushMessage();
            currentRole = 'assistant';
        } else if (line.trim() === '## System') {
            pushMessage();
            currentRole = 'system';
        } else {
            if (currentRole) {
                currentContent.push(line);
            }
        }
    }
    pushMessage();

    return { messages, mode, date };
}
