/**
 * YouTube helpers with a scrape-based fallback.
 *
 * play-dl's search() currently breaks ("Cannot read properties of undefined
 * (reading 'browseId')") because YouTube changed its results payload. We try
 * play-dl first and fall back to parsing videoIds out of the results HTML,
 * then enrich each hit via the oEmbed endpoint (title/channel/thumbnail).
 */

export interface YtResult {
  id: string;
  title: string;
  channel: string;
  url: string;
  thumbnail: string;
  durationRaw: string;
  views?: number;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function toWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

async function enrichViaOEmbed(id: string): Promise<YtResult | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(toWatchUrl(id))}&format=json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    return {
      id,
      title: data.title || 'Unknown',
      channel: data.author_name || 'Unknown',
      url: toWatchUrl(id),
      thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      durationRaw: '',
    };
  } catch {
    return null;
  }
}

async function searchViaScrape(query: string, limit: number): Promise<YtResult[]> {
  const res = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);

  const html = await res.text();
  const ids: string[] = [];
  for (const match of html.matchAll(/"videoId":"([\w-]{11})"/g)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
    if (ids.length >= limit) break;
  }
  if (!ids.length) throw new Error('No results found');

  const enriched = await Promise.all(ids.map(enrichViaOEmbed));
  return enriched.filter((r): r is YtResult => !!r);
}

export async function ytSearch(query: string, limit = 5): Promise<YtResult[]> {
  try {
    const play = (await import('play-dl')).default;
    const results = await play.search(query, { limit });
    if (results.length) {
      return results.map(v => ({
        id: v.id || '',
        title: v.title || 'Unknown',
        channel: v.channel?.name || 'Unknown',
        url: v.url,
        thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        durationRaw: v.durationRaw || '',
        views: v.views,
      }));
    }
  } catch {
    // fall through to scrape
  }
  return searchViaScrape(query, limit);
}

/** Look up details for a single watch URL via play-dl, falling back to oEmbed. */
export async function ytVideoInfo(url: string): Promise<YtResult | null> {
  try {
    const play = (await import('play-dl')).default;
    const info = await play.video_info(url);
    const d = info.video_details;
    return {
      id: d.id || '',
      title: d.title || 'Unknown',
      channel: d.channel?.name || 'Unknown',
      url: d.url || url,
      thumbnail: d.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
      durationRaw: d.durationRaw || '',
      views: d.views,
    };
  } catch {
    const id = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1];
    if (!id) return null;
    return enrichViaOEmbed(id);
  }
}
