// api/unshorten.js — Vercel Serverless Function
// Resolve Google Maps short links (maps.app.goo.gl) server-side
// No CORS issues because this runs on Vercel's server

export default async function handler(req, res) {
  // Allow all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    // Follow all redirects server-side (no CORS block on server)
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });

    const finalUrl = response.url;

    // Try to extract coordinates from the final URL directly
    const coordPatterns = [
      /@(-?[\d.]+),(-?[\d.]+)/,
      /!3d(-?[\d.]+)!4d(-?[\d.]+)/,
      /[?&]q=(-?[\d.]+),(-?[\d.]+)/,
      /[?&]ll=(-?[\d.]+),(-?[\d.]+)/,
    ];

    for (const pattern of coordPatterns) {
      const m = finalUrl.match(pattern);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          return res.status(200).json({ lat, lng, source: 'url' });
        }
      }
    }

    // If URL doesn't have coords, read HTML and look for them
    const html = await response.text();

    // Pattern: window.location redirect
    const winLoc = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']*google[^"']*maps[^"']+)["']/);
    if (winLoc) {
      for (const p of coordPatterns) {
        const m = winLoc[1].match(p);
        if (m) {
          const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
          if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return res.status(200).json({ lat, lng, source: 'html-window-location' });
          }
        }
      }
    }

    // Pattern: JSON-LD or meta coordinates
    const latLngMatch = html.match(/"latitude":\s*(-?[\d.]+)[\s\S]{0,100}"longitude":\s*(-?[\d.]+)/);
    if (latLngMatch) {
      const lat = parseFloat(latLngMatch[1]), lng = parseFloat(latLngMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return res.status(200).json({ lat, lng, source: 'json-ld' });
      }
    }

    // Return the final URL so client can try parsing it
    return res.status(200).json({ finalUrl, source: 'url-only' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
