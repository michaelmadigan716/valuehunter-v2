// app/api/storage/save/route.js
// Saves scan data to Vercel KV (Upstash Redis)

export async function POST(request) {
  try {
    const { stocks, scanStats } = await request.json();
    
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    
    if (!KV_URL || !KV_TOKEN) {
      console.error('KV not configured');
      return Response.json({ error: 'KV not configured' }, { status: 500 });
    }

    const data = {
      timestamp: Date.now(),
      stocks,
      scanStats
    };

    // Save to Upstash Redis
    const response = await fetch(`${KV_URL}/set/valuehunter_data`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(data))
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('KV save error:', error);
      return Response.json({ error: 'Failed to save' }, { status: 500 });
    }

    return Response.json({ success: true });
    
  } catch (error) {
    console.error('Save error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
