// Runs on GitHub every hour. Uses public market and news data only.
const fs = require('fs');
const UA = { 'User-Agent': 'Mozilla/5.0 (personal news feed)' };
const SEC_UA = { 'User-Agent': 'Field Guide 215574640+Hyzennn-cloud@users.noreply.github.com', Accept: 'application/json' };
const OUT = 'feed.json';
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const JUNK = /shares (bought|sold|acquired|purchased)|stake in|position in|holdings in|\bacquires?\b.*shares|\bsells?\b.*shares|short interest|stock position/i;

async function quote(sym, range = '5d') {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(sym + ' ' + r.status);
  const x = (await r.json()).chart.result[0], m = x.meta;
  const closes = x.indicators.quote[0].close.filter(v => v != null);
  const prev = closes.length > 1 ? closes[closes.length - 2] : m.chartPreviousClose;
  return { s: sym, price: m.regularMarketPrice, prev, hi: m.fiftyTwoWeekHigh, lo: m.fiftyTwoWeekLow, time: m.regularMarketTime, closes };
}

const tag = (s, n) => (s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '';
const clean = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function news(q) {
  const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { headers: UA });
  if (!r.ok) throw new Error('news ' + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const src = clean(tag(m[1], 'source')), raw = clean(tag(m[1], 'title'));
    const t = src && raw.endsWith(' - ' + src) ? raw.slice(0, -(src.length + 3)) : raw;
    return { t, l: clean(tag(m[1], 'link')), s: src, d: new Date(tag(m[1], 'pubDate')).getTime() };
  });
}

function kind(t) {
  if (/carquest/i.test(t)) return 'Carquest';
  if (/price target|upgrade|downgrade|\brating\b|analyst|initiat/i.test(t)) return 'Analysts';
  if (/earnings|results|quarter|\bQ[1-4]\b|guidance|outlook/i.test(t)) return 'Earnings';
  return 'News';
}

async function filings() {
  const r = await fetch('https://data.sec.gov/submissions/CIK0001158449.json', { headers: SEC_UA });
  if (!r.ok) throw new Error('sec ' + r.status);
  const f = (await r.json()).filings.recent, out = [];
  for (let i = 0; i < f.form.length && out.length < 8; i++) {
    if (!['8-K', '10-Q', '10-K'].includes(f.form[i])) continue;
    out.push({ f: f.form[i], d: f.filingDate[i], l: `https://www.sec.gov/Archives/edgar/data/1158449/${f.accessionNumber[i].replace(/-/g, '')}/${f.primaryDocument[i]}` });
  }
  return out;
}

(async () => {
  const feed = { updated: Date.now() };
  const attempt = async (key, fn) => { try { feed[key] = await fn(); } catch (e) { console.log('kept old', key, e.message); feed[key] = old[key]; } };
  await attempt('quote', () => quote('AAP', '3mo'));
  await attempt('peers', () => Promise.all(['ORLY', 'AZO', 'GPC'].map(s => quote(s))).then(a => a.map(({ s, price, prev }) => ({ s, price, prev }))));
  await attempt('news', async () => {
    const a = (await Promise.all([news('"Advance Auto Parts" when:14d'), news('Carquest when:30d')])).flat();
    const seen = new Set();
    return a.filter(n => n.t && !JUNK.test(n.t) && !seen.has(n.t.toLowerCase().slice(0, 60)) && seen.add(n.t.toLowerCase().slice(0, 60)))
      .sort((x, y) => y.d - x.d).slice(0, 40).map(n => ({ ...n, k: kind(n.t) }));
  });
  await attempt('filings', filings);
  fs.writeFileSync(OUT, JSON.stringify(feed));
  console.log('quote', feed.quote?.price, 'news', feed.news?.length, 'filings', feed.filings?.length);
})();
