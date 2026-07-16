// app/api/grok/route.js
// Proxies requests to xAI Grok API

const DEFAULT_MODEL = 'grok-4.3';

// Retired model names still floating around in old clients/sessions
const LEGACY_MODELS = {
  'grok-4': 'grok-4.5',
  'grok-4-fast-reasoning': 'grok-4.20',
  'grok-3-mini': 'grok-4.20-non-reasoning',
  'grok-3': 'grok-4.3',
};

export async function POST(request) {
  try {
    // Block cross-origin browser calls so random sites can't burn our xAI
    // credits through this endpoint. Same-origin requests pass; requests
    // without an Origin header (server-to-server) are allowed.
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (origin && host && new URL(origin).host !== host) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { prompt, isMatty, isTechnical, isConviction, agentPrompt, liveSearch, jsonMode, model } = await request.json();

    const GROK_KEY = process.env.GROK_API_KEY || process.env.NEXT_PUBLIC_GROK_KEY;

    if (!GROK_KEY) {
      return Response.json({ error: 'Grok API key not configured' }, { status: 500 });
    }

    const requested = model || DEFAULT_MODEL;
    const grokModel = LEGACY_MODELS[requested] || requested;

    // Different system prompts based on analysis type
    let systemPrompt;
    let maxTokens = 1200;

    if (jsonMode) {
      systemPrompt = `You are a financial data engine. Respond with ONLY valid JSON matching the structure requested by the user. No prose, no markdown, no code fences. Only include real, publicly traded companies.`;
      maxTokens = 6000;
    } else if (agentPrompt) {
      systemPrompt = `You are an expert equity and derivatives analyst. Follow the user's analysis instructions exactly. Be direct and substantive - no fluff. Always end with the exact score marker the user requests.`;
      maxTokens = 1500;
    } else if (isMatty) {
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
    } else if (isConviction) {
      systemPrompt = `You are an equity research analyst evaluating conviction on individual stocks.

Weigh: business quality and moat, supply-chain positioning for AI/robotics/energy megatrends, fundamentals (valuation, growth, margins), insider activity, and near-term catalysts.

Provide analysis then end with:
CONVICTION_SCORE: [0-100]`;
      maxTokens = 1500;
    } else {
      systemPrompt = `You are an insider trading analyst.

Evaluate: insider ownership %, recent buying vs selling, purchase size relative to net worth, cluster buying, C-suite transactions.

Provide analysis then end with:
INSIDER_CONVICTION: [0-100]`;
      maxTokens = 1500;
    }

    let text = '';

    if (liveSearch) {
      // Agent Tools API (/v1/responses): the model can search the web and X
      // for current news, filings, hires, and social chatter
      const response = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROK_KEY}`
        },
        body: JSON.stringify({
          model: grokModel,
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          tools: [{ type: "web_search" }, { type: "x_search" }],
          max_output_tokens: Math.max(maxTokens, 2500)
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Grok responses API error:', response.status, errorText);
        return Response.json({ error: `Grok API error: ${response.status}`, analysis: errorText }, { status: response.status });
      }

      const data = await response.json();
      for (const item of data.output || []) {
        if (item.type === 'message') {
          for (const c of item.content || []) {
            if ((c.type === 'output_text' || c.type === 'text') && c.text) text += c.text;
          }
        }
      }
      // Strip citation link markup like [[1]](https://...)
      text = text.replace(/\[\[\d+\]\]\([^)]*\)/g, '').trim();
    } else {
      const body = {
        model: grokModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens,
        temperature: jsonMode ? 0.1 : 0.3
      };
      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROK_KEY}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Grok API error:', response.status, errorText);
        return Response.json({ error: `Grok API error: ${response.status}`, analysis: errorText }, { status: response.status });
      }

      const data = await response.json();
      text = data.choices?.[0]?.message?.content || '';
    }

    // JSON mode: return the raw model output untouched so the client can parse it
    if (jsonMode) {
      return Response.json({ analysis: text });
    }

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

    let convictionScore = null;
    const scoreMatch = text.match(/CONVICTION_SCORE[:\s=]*(\d+)/i);
    if (scoreMatch) {
      convictionScore = Math.min(100, parseInt(scoreMatch[1]));
    }

    // Clean metrics from display text
    text = text.replace(/8MO_PREDICTION[:\s=]*[+-]?\d+%?/gi, '').trim();
    text = text.replace(/INSIDER_CONVICTION[:\s=]*\d+%?/gi, '').trim();
    text = text.replace(/CUP_HANDLE_SCORE[:\s=]*\d+%?/gi, '').trim();
    text = text.replace(/CONVICTION_SCORE[:\s=]*\d+%?/gi, '').trim();

    return Response.json({
      analysis: text || 'No response from AI',
      insiderConviction,
      cupHandleScore,
      mattyPrediction,
      convictionScore
    });

  } catch (error) {
    console.error('Grok route error:', error);
    return Response.json({ error: error.message, analysis: 'Error occurred' }, { status: 500 });
  }
}
