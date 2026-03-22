/**
 * /api/youtube.js — Vercel Serverless Function
 *
 * Tek endpoint, tüm YouTube verisini toplu döner.
 * Vercel Edge Cache: 6 saat (s-maxage=21600)
 * Her ziyaretçi bu cache'i paylaşır — YouTube API'ya sadece 6 saatte bir gider.
 *
 * Env var: YT_API_KEY  (Vercel Dashboard > Settings > Environment Variables)
 */

const YT_API   = 'https://www.googleapis.com/youtube/v3';
const CHANNEL_QUERY = 'P4 Otopark Galatasaray';
const MAX_VIDEOS    = 24;

async function ytGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`YouTube API: ${data.error.message}`);
  return data;
}

export default async function handler(req, res) {
  // CORS — kendi domain'in için
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const key = process.env.YT_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'YT_API_KEY env var eksik' });
  }

  try {
    // 1. Kanal ID bul
    const search = await ytGet(
      `${YT_API}/search?part=snippet&type=channel&q=${encodeURIComponent(CHANNEL_QUERY)}&maxResults=5&key=${key}`
    );
    const channelMatch = search.items?.find(i =>
      i.snippet.channelTitle.toLowerCase().includes('p4 otopark') ||
      i.snippet.channelTitle.toLowerCase().includes('p4otopark')
    ) || search.items?.[0];
    if (!channelMatch) throw new Error('Kanal bulunamadı');
    const channelId = channelMatch.snippet.channelId;

    // 2. Uploads playlist ID + kanal istatistikleri (tek istek)
    const chData = await ytGet(
      `${YT_API}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${key}`
    );
    const ch         = chData.items[0];
    const uploadsId  = ch.contentDetails.relatedPlaylists.uploads;
    const stats = {
      avatar: ch.snippet.thumbnails?.medium?.url || '',
      subs:   ch.statistics.subscriberCount,
      views:  ch.statistics.viewCount,
      vids:   ch.statistics.videoCount,
    };

    // 3. Son videolar
    const playlist = await ytGet(
      `${YT_API}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=${MAX_VIDEOS}&key=${key}`
    );
    const nextPageToken = playlist.nextPageToken || null;
    const videoIds = playlist.items
      .map(i => i.snippet.resourceId.videoId)
      .filter(Boolean)
      .join(',');

    const videoDetails = await ytGet(
      `${YT_API}/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${videoIds}&key=${key}`
    );
    const videos = videoDetails.items.map(v => ({
      id:          v.id,
      title:       v.snippet.title,
      desc:        (v.snippet.description || '').slice(0, 300),
      thumb:       v.snippet.thumbnails?.maxres?.url
                   || v.snippet.thumbnails?.high?.url
                   || v.snippet.thumbnails?.medium?.url
                   || '',
      published:   v.snippet.publishedAt,
      duration:    v.contentDetails?.duration || '',
      views:       v.statistics?.viewCount    || '0',
      likes:       v.statistics?.likeCount    || '0',
      isLive:      v.snippet.liveBroadcastContent === 'live',
      liveViewers: v.liveStreamingDetails?.concurrentViewers || null,
    }));

    // 4. Aktif canlı yayın kontrolü
    const liveSearch = await ytGet(
      `${YT_API}/search?part=snippet&channelId=${channelId}&eventType=live&type=video&maxResults=1&key=${key}`
    );
    const live = liveSearch.items?.length
      ? { id: liveSearch.items[0].id.videoId, title: liveSearch.items[0].snippet.title }
      : null;

    const payload = { stats, videos, nextPageToken, live, channelId, fetchedAt: Date.now() };

    // Vercel CDN'e 6 saat cache, tarayıcıya 5 dakika cache
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=300');
    return res.status(200).json(payload);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
