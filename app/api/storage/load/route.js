// app/api/storage/load/route.js
// Loads scan data from Vercel KV (Upstash Redis)

export async function GET(request) {
  try {
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    
    if (!KV_URL || !KV_TOKEN) {
      console.error('KV not configured');
      return Response.json({ error: 'KV not configured' }, { status: 500 });
    }

    // Load from Upstash Redis
    const response = await fetch(`${KV_URL}/get/valuehunter_data`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('KV load error:', error);
      return Response.json({ error: 'Failed to load' }, { status: 500 });
    }

    const result = await response.json();
    
    // Upstash returns { result: "stringified json" }
    if (result.result) {
      const data = JSON.parse(result.result);
      return Response.json(data);
    }
    
    return Response.json({ stocks: [], scanStats: null, timestamp: null });
    
  } catch (error) {
    console.error('Load error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
