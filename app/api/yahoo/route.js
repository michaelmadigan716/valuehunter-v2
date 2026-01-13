// app/api/yahoo/route.js
// Proxies requests to Yahoo Finance API to avoid CORS issues

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    
    if (!ticker) {
      return Response.json({ error: 'Ticker required' }, { status: 400 });
    }

    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d&includePrePost=true`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    if (!response.ok) {
      console.log(`Yahoo returned ${response.status} for ${ticker}`);
      // Return empty data instead of error for missing tickers
      return Response.json({ 
        ticker,
        regularMarketPrice: null,
        previousClose: null,
        preMarketPrice: null,
        preMarketChange: null,
        postMarketPrice: null,
        postMarketChange: null,
        marketState: null,
        error: `Ticker not found: ${ticker}`
      });
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      return Response.json({ 
        ticker,
        regularMarketPrice: null,
        previousClose: null,
        preMarketPrice: null,
        preMarketChange: null,
        postMarketPrice: null,
        postMarketChange: null,
        marketState: null
      });
    }

    const meta = result.meta;
    
    return Response.json({
      ticker: meta.symbol,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose || meta.chartPreviousClose,
      preMarketPrice: meta.preMarketPrice || null,
      preMarketChange: meta.preMarketChangePercent || null,
      postMarketPrice: meta.postMarketPrice || null,
      postMarketChange: meta.postMarketChangePercent || null,
      marketState: meta.marketState // PRE, REGULAR, POST, CLOSED
    });
    
  } catch (error) {
    console.error('Yahoo route error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
