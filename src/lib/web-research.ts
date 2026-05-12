import axios from 'axios';
import * as cheerio from 'cheerio';

export type ResearchTarget = 'person' | 'general';

export interface ResearchSource {
  source: 'namuwiki' | 'wikipedia' | 'google';
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchPlan {
  target: ResearchTarget;
  steps: string[];
  sources: ResearchSource[];
  context: string;
  footer: string;
}

const GOOGLE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PERSON_HINTS = [
  '인물',
  '사람',
  '누구',
  '배우',
  '가수',
  '작가',
  '정치인',
  '기업인',
  '개발자',
  '감독',
  '교수',
  '프로필',
  '전기',
  '출생',
  '사망',
  '학력',
  '경력',
  'biography',
  'actor',
  'singer',
  'director',
  'president',
  'ceo',
  'founder',
];

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeForGoogleQuery(query: string) {
  return query.replace(/[\n\r]+/g, ' ').trim();
}

export function classifyResearchTarget(query: string): ResearchTarget {
  const text = query.toLowerCase();

  if (PERSON_HINTS.some((hint) => text.includes(hint))) {
    return 'person';
  }

  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= 4) {
    const hasProperNounLikeForm = words.some((word) => /[A-Z]/.test(word[0] ?? '') || /[가-힣]{2,}/.test(word));
    if (hasProperNounLikeForm) {
      return 'person';
    }
  }

  return 'general';
}

async function googleSearch(query: string, site?: string, limit = 3): Promise<ResearchSource[]> {
  const queryParts = site ? [`site:${site}`, query] : [query];
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(escapeForGoogleQuery(queryParts.join(' ')))}&hl=ko&gl=kr&num=10`;

  try {
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': GOOGLE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const results: ResearchSource[] = [];

    $('div.g').each((_, element) => {
      if (results.length >= limit) return;

      const link = $(element).find('a[href^="/url?"]').first();
      const title = normalizeText($(element).find('h3').first().text());
      const snippet = normalizeText(
        $(element)
          .find('div.VwiC3b, span.aCOpRe, div.IsZvec')
          .first()
          .text()
      );

      if (!link.length || !title) return;

      const href = link.attr('href') || '';
      const urlMatch = href.match(/[?&]q=([^&]+)/);
      const url = urlMatch ? decodeURIComponent(urlMatch[1]) : href;

      if (!url.startsWith('http')) return;

      results.push({
        source: site?.includes('namu.wiki') ? 'namuwiki' : site?.includes('wikipedia.org') ? 'wikipedia' : 'google',
        title,
        url,
        snippet,
      });
    });

    return results;
  } catch {
    return [];
  }
}

async function fetchWikipediaSummary(query: string): Promise<ResearchSource[]> {
  const endpoints = ['ko', 'en'];

  for (const lang of endpoints) {
    try {
      const searchResponse = await axios.get(
        `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=1`,
        {
          headers: { 'User-Agent': GOOGLE_USER_AGENT },
          timeout: 10000,
        }
      );

      const title = searchResponse.data?.pages?.[0]?.title;
      if (!title) continue;

      const summaryResponse = await axios.get(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        {
          headers: { 'User-Agent': GOOGLE_USER_AGENT },
          timeout: 10000,
        }
      );

      const data = summaryResponse.data || {};
      const snippet = normalizeText(data.extract || data.description || '');
      const url = data?.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

      if (title && url) {
        return [
          {
            source: 'wikipedia',
            title: `${title} (${lang})`,
            url,
            snippet,
          },
        ];
      }
    } catch {
      continue;
    }
  }

  return [];
}

function buildContext(target: ResearchTarget, sources: ResearchSource[]) {
  const label = target === 'person' ? '인물 정보' : '일반 정보';
  const lines = [`외부 조사 요약: ${label}`, ''];

  sources.forEach((source, index) => {
    lines.push(`${index + 1}. [${source.source.toUpperCase()}] ${source.title}`);
    lines.push(`   - URL: ${source.url}`);
    if (source.snippet) {
      lines.push(`   - 요약: ${source.snippet}`);
    }
    lines.push('');
  });

  lines.push('');
  lines.push('규칙: 외부 조사와 모델 지식이 다르면 차이를 명시하고, 가능한 한 외부 조사 결과를 우선해서 정리한다.');

  return lines.join('\n');
}

function buildFooter(sources: ResearchSource[]) {
  if (sources.length === 0) {
    return '';
  }

  const lines = ['## 참고 출처', ''];
  sources.forEach((source, index) => {
    lines.push(`${index + 1}. [${source.title}](${source.url})`);
  });

  return lines.join('\n');
}

export async function gatherResearchPlan(
  query: string,
  targetOverride?: ResearchTarget,
  searchFocus?: string
): Promise<ResearchPlan> {
  const trimmedQuery = normalizeText(searchFocus || query);
  const target = targetOverride || classifyResearchTarget(trimmedQuery);

  const steps =
    target === 'person'
      ? ['인물 정보로 판단해서 NamuWiki를 우선 조사하는 중입니다.', 'Wikipedia와 Google 보조 자료를 대조하는 중입니다.', '답변 초안을 정리하는 중입니다.']
      : ['Wikipedia 중심으로 기본 정보를 조사하는 중입니다.', 'Google 보조 자료로 최신 맥락을 확인하는 중입니다.', '답변 초안을 정리하는 중입니다.'];

  if (!trimmedQuery) {
    return {
      target,
      steps: ['질문이 비어 있어 외부 조사 없이 응답합니다.'],
      sources: [],
      context: '외부 조사 결과: 질문이 비어 있어 검색을 생략했습니다.',
      footer: '',
    };
  }

  const primarySite = target === 'person' ? 'namu.wiki' : 'wikipedia.org';
  const secondarySite = target === 'person' ? 'wikipedia.org' : 'namu.wiki';

  const [primaryResults, secondaryResults, wikipediaSummary, generalGoogle] = await Promise.all([
    googleSearch(trimmedQuery, primarySite, 3),
    googleSearch(trimmedQuery, secondarySite, 2),
    fetchWikipediaSummary(trimmedQuery),
    googleSearch(trimmedQuery, undefined, 2),
  ]);

  const sources = [...primaryResults, ...wikipediaSummary, ...secondaryResults, ...generalGoogle].filter(
    (source, index, self) => self.findIndex((item) => item.url === source.url) === index
  );

  return {
    target,
    steps,
    sources,
    context: buildContext(target, sources),
    footer: buildFooter(sources),
  };
}
