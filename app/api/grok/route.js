// app/api/grok/route.js
// Proxies requests to xAI Grok API

export async function POST(request) {
  try {
    const { prompt, isMatty, isTechnical, model } = await request.json();
    
    const GROK_KEY = process.env.NEXT_PUBLIC_GROK_KEY;
    
    if (!GROK_KEY) {
      return Response.json({ error: 'Grok API key not configured' }, { status: 500 });
    }

    // Use provided model or default to grok-4
    const grokModel = model || 'grok-4';

    // Different system prompts based on analysis type
    let systemPrompt;
    let maxTokens = 1200;
    
    if (isMatty) {
      systemPrompt = `You are a senior equity research analyst specializing in "singularity" infrastructure plays - companies positioned to benefit from AI, robotics, energy transition, and automation megatrends.

Your analysis framework:
- Supply chain positioning: How critical is this company to compute (chips, data centers), energy (nuclear, batteries, grid), or embodiment (robotics, sensors, actuators)?
- Balance sheet strength: Net cash position, debt levels, runway
- Insider activity: Recent purchases, ownership stakes, conviction signals
- Catalysts: What could drive significant price movement in the next 8 months?
- Valuation: Current price relative to opportunity size

Provide a thorough, professional analysis (2-3 paragraphs). Be direct and substantive - no fluff.

End with your 8-month price prediction:
8MO_PREDICTION: [predicted % return from -80 to +800]

Be decisive. Strong setups warrant aggressive targets (+200% to +800%). Poor risk/reward warrants negative predictions.`;
      maxTokens = 2000;
    } else if (isTechnical) {
      systemPrompt = `You are a technical analyst specializing in Cup and Handle patterns.

Evaluate: cup shape (U vs V), depth (10-35% ideal), duration, handle formation, volume, breakout potential.

Provide analysis then end with:
CUP_HANDLE_SCORE: [0-100]`;
      maxTokens = 1500;
    } else {
      systemPrompt = `You are an insider trading analyst.

Evaluate: insider ownership %, recent buying vs selling, purchase size relative to net worth, cluster buying, C-suite transactions.

Provide analysis then end with:
INSIDER_CONVICTION: [0-100]`;
      maxTokens = 1500;
    }

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: grokModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Grok API error:', response.status, errorText);
      return Response.json({ error: `Grok API error: ${response.status}`, analysis: errorText }, { status: response.status });
    }

    const data = await response.json();
    let text = data.choices?.[0]?.message?.content || '';
    
    // Clean up markdown
    text = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/##/g, '').replace(/#/g, '').replace(/`/g, '');
    
    // Extract metrics if present
    let insiderConviction = null;
    const convictionMatch = text.match(/INSIDER_CONVICTION[:\s=]*(\d+)/i);
    if (convictionMatch) {
      insiderConviction = Math.min(100, parseInt(convictionMatch[1]));
    }
    
    let cupHandleScore = null;
    const cupHandleMatch = text.match(/CUP_HANDLE_SCORE[:\s=]*(\d+)/i);
    if (cupHandleMatch) {
      cupHandleScore = Math.min(100, parseInt(cupHandleMatch[1]));
    }
    
    let mattyPrediction = null;
    const mattyMatch = text.match(/8MO_PREDICTION[:\s=]*([+-]?\d+)/i);
    if (mattyMatch) {
      mattyPrediction = Math.min(800, Math.max(-80, parseInt(mattyMatch[1])));
    }
    
    // Clean metrics from display text
    text = text.replace(/8MO_PREDICTION[:\s=]*[+-]?\d+%?/gi, '').trim();
    text = text.replace(/INSIDER_CONVICTION[:\s=]*\d+%?/gi, '').trim();
    text = text.replace(/CUP_HANDLE_SCORE[:\s=]*\d+%?/gi, '').trim();
    
    return Response.json({ 
      analysis: text || 'No response from AI',
      insiderConviction,
      cupHandleScore,
      mattyPrediction
    });
    
  } catch (error) {
    console.error('Grok route error:', error);
    return Response.json({ error: error.message, analysis: 'Error occurred' }, { status: 500 });
  }
}
