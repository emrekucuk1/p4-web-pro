/**
 * /api/youtube.js — Vercel Serverless Function
 * Cache-Control: s-maxage=21600 → Vercel CDN 6 saat cache'ler
 * Tüm ziyaretçiler aynı cache'i kullanır, YouTube API günde sadece 4 kez çağrılır.
 *
 * Env: YT_API_KEY (Vercel Dashboard > Settings > Environment Variables)
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

async function ytGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`YouTube API: ${data.error.message}`);
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.YT_API_KEY;
  if (!key) return res.status(500).json({ error: 'YT_API_KEY eksik' });

  try {
    // 1. Kanal bul
    const search = await ytGet(
      `${BASE}/search?part=snippet&type=channel&q=P4+Otopark+Galatasaray&maxResults=5&key=${key}`
    );
    const match =
      search.items?.find(i =>
        i.snippet.channelTitle.toLowerCase().includes('p4 otopark') ||
        i.snippet.channelTitle.toLowerCase().includes('p4otopark')
      ) || search.items?.[0];
    if (!match) throw new Error('Kanal bulunamadı');
    const channelId = match.snippet.channelId;

    // 2. Kanal detayları + uploads playlist
    const chData = await ytGet(
      `${BASE}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${key}`
    );
    const ch = chData.items[0];
    const uploadsId = ch.contentDetails.relatedPlaylists.uploads;
    const stats = {
      avatar: ch.snippet.thumbnails?.medium?.url || '',
      subs:   ch.statistics.subscriberCount,
      views:  ch.statistics.viewCount,
      vids:   ch.statistics.videoCount,
    };

    // 3. Son 24 video
    const playlist = await ytGet(
      `${BASE}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=24&key=${key}`
    );
    const ids = playlist.items
      .map(i => i.snippet.resourceId.videoId)
      .filter(Boolean)
      .join(',');

    const details = await ytGet(
      `${BASE}/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${ids}&key=${key}`
    );
    const videos = details.items.map(v => ({
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

    // 4. Aktif canlı yayın
    const liveRes = await ytGet(
      `${BASE}/search?part=snippet&channelId=${channelId}&eventType=live&type=video&maxResults=1&key=${key}`
    );
    const live = liveRes.items?.length
      ? { id: liveRes.items[0].id.videoId, title: liveRes.items[0].snippet.title }
      : null;

    // Vercel CDN: 6 saat cache, tarayıcı: 5 dk
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=300');
    return res.status(200).json({
      stats,
      videos,
      nextPageToken: playlist.nextPageToken || null,
      live,
      fetchedAt: Date.now(),
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
