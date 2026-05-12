import axios from 'axios';
import * as cheerio from 'cheerio';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchGoogle(query: string): Promise<SearchResult[]> {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ko`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const results: SearchResult[] = [];

    // Google 검색 결과 파싱
    $('div.g').each((_, element) => {
      const linkElement = $(element).find('a[href^="/url?"]').first();
      const titleElement = $(element).find('h3').first();
      const snippetElement = $(element).find('span').first();

      if (linkElement.length > 0 && titleElement.length > 0) {
        const href = linkElement.attr('href') || '';
        const urlMatch = href.match(/q=([^&]+)/);
        const url = urlMatch ? decodeURIComponent(urlMatch[1]) : '';

        const title = titleElement.text();
        const snippet = snippetElement.text();

        if (url && title && !url.startsWith('http://webcache')) {
          results.push({
            title,
            url,
            snippet,
          });
        }
      }
    });

    return results.slice(0, 5); // 상위 5개 결과만 반환
  } catch (error) {
    console.error('Google search error:', error);
    return [];
  }
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const lines = ['---', '#### 📚 검색 참고 자료', ''];

  results.forEach((result, index) => {
    lines.push(`**${index + 1}. [${result.title}](${result.url})**`);
    if (result.snippet) {
      lines.push(`> ${result.snippet}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
