import { useState, useEffect, useRef } from 'react'
import './App.css'
import FieldGuide from './components/FieldGuide'
import SlopCycle from './components/SlopCycle'
import SlopMap from './components/SlopMap'

// Firebase Config (Public values only)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDDx5ZbgWcgsKxsP78EubqyWRHL9yxdXec",
  projectId: "zero-slop"
};
const FIRESTORE_DOCS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// Firestore's free plan allows about 50,000 document reads a day, shared by every visitor
// and every extension user, so the site reads as little as it can:
// - stats and recent detections refresh every 5 minutes, only while the tab is visible,
//   and the last result is shared between tabs through localStorage;
// - the full collections (search, network map, CSV) are read once and kept for 30 minutes;
// - after a 429 (quota exceeded) no request is made for 5 minutes.
const STATS_REFRESH_MS = 5 * 60 * 1000;
const FULL_DATA_TTL_MS = 30 * 60 * 1000;
const QUOTA_BACKOFF_MS = 5 * 60 * 1000;
const STATS_CACHE_KEY = 'zeroslop_registry_stats_v1';
const REGISTRY_UNAVAILABLE = "The community registry is temporarily unavailable. Try again later.";

let registryBackoffUntil = 0;

async function registryFetch(url) {
  if (Date.now() < registryBackoffUntil) throw new Error('Registry backing off after a quota error');
  const res = await fetch(url);
  if (res.status === 429) registryBackoffUntil = Date.now() + QUOTA_BACKOFF_MS;
  if (!res.ok) throw new Error(`Registry request failed: HTTP ${res.status}`);
  return res.json();
}

// Reads every document in a collection. Throws if any page fails, so callers never
// mistake a partial read for the whole registry.
async function fetchAllPages(collection) {
  let allDocsArr = [];
  let pageToken = "";
  do {
    const url = `${FIRESTORE_DOCS}/${collection}?key=${FIREBASE_CONFIG.apiKey}&pageSize=1000&orderBy=last_updated desc&pageToken=${pageToken}`;
    const data = await registryFetch(url);
    if (data.documents) allDocsArr = allDocsArr.concat(data.documents);
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return allDocsArr;
}

function parseStatsDoc(statsData) {
  const fields = statsData.fields || {};
  const remoteTotal = parseInt(fields.total_slops?.integerValue || fields.total_slops?.doubleValue || 0);
  const remoteAccounts = parseInt(fields.total_accounts?.integerValue || fields.total_accounts?.doubleValue || 0);
  const dailyMap = fields.daily_stats?.mapValue?.fields || {};
  const trendStats = {};
  Object.keys(dailyMap).forEach(date => {
    trendStats[date] = parseInt(dailyMap[date]?.integerValue || dailyMap[date]?.doubleValue || 0);
  });
  return {
    stats: { count: remoteTotal.toLocaleString(), accounts: remoteAccounts.toLocaleString(), rawCount: remoteTotal },
    trendStats
  };
}

function parseRecentDocs(data) {
  return (data.documents || [])
    .filter(doc => (doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0) > 15)
    .map(doc => ({
      name: doc.fields.author_name?.stringValue || "Unknown",
      handle: doc.fields.author_handle?.stringValue || "@anonymous",
      score: Math.round(doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0),
      pfp: doc.fields.author_pfp?.stringValue || "🤖",
      updateTime: doc.updateTime
    }));
}

function readStatsCache() {
  try { return JSON.parse(localStorage.getItem(STATS_CACHE_KEY)) || null; } catch { return null; }
}

function writeStatsCache(entry) {
  try { localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(entry)); } catch { /* storage full or blocked */ }
}

function App() {
  const year = new Date().getFullYear();
  const baseUrl = import.meta.env.BASE_URL;

  const [stats, setStats] = useState({ count: "...", accounts: "..." });
  const [wallOfShame, setWallOfShame] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [allDocs, setAllDocs] = useState([]);
  const [allAccounts, setAllAccounts] = useState([]);
  const [allSuspicious, setAllSuspicious] = useState([]);
  const [trendStats, setTrendStats] = useState({});
  const [activeMapHandle, setActiveMapHandle] = useState(null);
  const [activeMapAmplifiers, setActiveMapAmplifiers] = useState([]);
  const [registryNotice, setRegistryNotice] = useState(null);
  const fullDataRef = useRef({ promise: null, loadedAt: 0 });
  const latestQueryRef = useRef("");

  const GOAL = 5000; // Community goal

  // Reads all three collections at most once per FULL_DATA_TTL_MS. Concurrent callers share
  // one request. On failure the last good data stays on screen and a notice is shown.
  const loadAllCollections = () => {
    const cache = fullDataRef.current;
    if (cache.promise && (!cache.loadedAt || Date.now() - cache.loadedAt < FULL_DATA_TTL_MS)) return cache.promise;
    const promise = Promise.all([
      fetchAllPages('slop_registry'),
      fetchAllPages('slop_accounts'),
      fetchAllPages('suspicious_accounts')
    ]).then(([reg, acc, susp]) => {
      if (fullDataRef.current.promise === promise) fullDataRef.current.loadedAt = Date.now();
      setAllDocs(reg); setAllAccounts(acc); setAllSuspicious(susp);
      return { reg, acc, susp };
    }).catch((e) => {
      console.error("ZeroSlop: Failed to load the registry", e);
      if (fullDataRef.current.promise === promise) {
        // Fall back to whatever loaded before, so a refresh failure doesn't blank the page.
        fullDataRef.current = cache.loadedAt ? cache : { promise: null, loadedAt: 0 };
      }
      setRegistryNotice(REGISTRY_UNAVAILABLE);
      if (cache.loadedAt) return cache.promise;
      throw e;
    });
    fullDataRef.current = { promise, loadedAt: 0 };
    return promise;
  };

  const findAmplifiersForHandle = (handle) => {
    const target = handle.toLowerCase().replace('@', '');
    const factoryTweets = allDocs
      .filter(doc => (doc.fields.author_handle?.stringValue || "").toLowerCase().replace('@', '') === target)
      .map(doc => doc.fields.tweet_id?.stringValue);

    const realAmplifiers = allSuspicious
      .filter(susp => {
        const suspFactory = (susp.fields.factory_handle?.stringValue || "").toLowerCase().replace('@', '');
        const reasonId = susp.fields.reason_tweet_id?.stringValue;
        return (suspFactory === target) || (reasonId && factoryTweets.includes(reasonId));
      })
      .map(susp => ({
        handle: susp.fields.handle?.stringValue,
        type: "Caught Amplifying",
        rep: Math.floor(Math.random() * 40)
      }));

    return realAmplifiers;
  };

  const handleMapOpen = async (handle) => {
    const target = handle.toLowerCase().replace('@', '');
    setActiveMapHandle(handle);
    setActiveMapAmplifiers([]); // Loading state

    console.log(`ZeroSlop: Discovering network for ${handle}...`);

    // 1. Load the registry (cached; only read from Firestore once per FULL_DATA_TTL_MS)
    let currentDocs, currentSuspicious;
    try {
      ({ reg: currentDocs, susp: currentSuspicious } = await loadAllCollections());
    } catch {
      return; // notice is already shown
    }

    // 2. Aggressive Linkage
    // a) Find all confirmed tweets by this factory
    const factoryTweets = currentDocs
      .filter(doc => (doc.fields.author_handle?.stringValue || "").toLowerCase().replace('@', '') === target)
      .map(doc => doc.fields.tweet_id?.stringValue);

    // b) Find all amplifiers matching handle OR any of those tweet IDs
    const realAmps = currentSuspicious
      .filter(susp => {
        const suspFactory = (susp.fields.factory_handle?.stringValue || "").toLowerCase().replace('@', '');
        const reasonId = susp.fields.reason_tweet_id?.stringValue;
        return (suspFactory === target) || (reasonId && factoryTweets.includes(reasonId));
      })
      .map(susp => ({
        handle: susp.fields.handle?.stringValue,
        type: "Caught Amplifying",
        rep: Math.floor(Math.random() * 40)
      }));

    setActiveMapAmplifiers(realAmps);
  };

  const getGlobalAudit = () => {
    const masterEvents = [
      ...allDocs.map(d => ({ date: d.updateTime, score: d.fields.ai_score?.doubleValue || 0, handle: d.fields.author_handle?.stringValue })),
      ...allAccounts.map(d => ({ date: d.updateTime || d.createTime, score: 100, handle: d.fields.handle?.stringValue })),
      ...allSuspicious.map(d => ({ date: d.updateTime || d.createTime, score: 50, handle: d.fields.handle?.stringValue }))
    ];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentEvents = masterEvents.filter(e => e.date && new Date(e.date) > sevenDaysAgo);
    const slopDocs = allDocs.filter(doc => doc.updateTime && new Date(doc.updateTime) > sevenDaysAgo && (doc.fields.ai_score?.doubleValue || 0) > 15);

    const handleMap = {};
    slopDocs.forEach(doc => {
      const handle = doc.fields.author_handle?.stringValue || "@anonymous";
      if (!handleMap[handle]) handleMap[handle] = { handle, count: 0, scores: [] };
      handleMap[handle].count++;
      handleMap[handle].scores.push(doc.fields.ai_score?.doubleValue || 0);
    });

    const topFactories = Object.values(handleMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(f => ({
        handle: f.handle,
        score: Math.round(f.scores.reduce((a, b) => a + b, 0) / f.scores.length),
        count: f.count
      }));

    const keywordMap = {};
    slopDocs.forEach(doc => {
      const text = doc.fields.text?.stringValue || "";
      const words = text.match(/#[a-z0-9_]+|(?<=^|(?<=[^a-z0-9_]))[a-z0-9_]{5,}(?=[^a-z0-9_]|$)/gi) || [];
      words.forEach(word => {
        const w = word.toLowerCase();
        if (['https', 'twitter', 'status', 'photo', 'thread', 'check', 'repost'].includes(w)) return;
        if (!keywordMap[w]) keywordMap[w] = { name: word, count: 0, scores: [] };
        keywordMap[w].count++;
        keywordMap[w].scores.push(doc.fields.ai_score?.doubleValue || 0);
      });
    });

    const topTrends = Object.values(keywordMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(t => ({
        name: t.name.startsWith('#') ? t.name : `#${t.name}`,
        score: Math.round(t.scores.reduce((a, b) => a + b, 0) / t.scores.length),
        count: t.count
      }));

    // Use pre-aggregated trendStats for the volume chart
    const dailyVolume = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dailyVolume.push([dateStr, trendStats[dateStr] || 0]);
    }

    return {
      title: "Global State of the Feed",
      date: `Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
      summary: masterEvents.length > 0 
        ? `Our global registry analysis for the past 7 days shows ${recentEvents.length} total slop events detected.`
        : "Registry analysis complete. No slop events detected in this window.",
      totalSlops: recentEvents.length,
      topTrends: topTrends,
      topFactories: topFactories,
      dailyVolume: dailyVolume.reverse()
    };
  };

  const weeklyAudit = getGlobalAudit();

  // Stats and recent detections: refresh every STATS_REFRESH_MS while the tab is visible.
  // The result is cached in localStorage, so reloads and other open tabs reuse it.
  useEffect(() => {
    let inFlight = false;

    const applyEntry = (entry) => {
      if (entry.stats) setStats(entry.stats);
      if (entry.trendStats) setTrendStats(entry.trendStats);
      if (entry.wallOfShame) setWallOfShame(entry.wallOfShame);
      if (entry.unavailable) setRegistryNotice(REGISTRY_UNAVAILABLE);
    };

    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [statsData, recentData] = await Promise.all([
          registryFetch(`${FIRESTORE_DOCS}/stats/global?key=${FIREBASE_CONFIG.apiKey}`),
          registryFetch(`${FIRESTORE_DOCS}/slop_registry?key=${FIREBASE_CONFIG.apiKey}&pageSize=5&orderBy=last_updated desc`)
        ]);
        const entry = { savedAt: Date.now(), ...parseStatsDoc(statsData), wallOfShame: parseRecentDocs(recentData) };
        writeStatsCache(entry);
        applyEntry(entry);
        setRegistryNotice(null);
      } catch (e) {
        console.error("ZeroSlop: Failed to fetch live stats", e);
        // Keep showing the last good data; record the attempt so other tabs don't retry at once.
        const cached = readStatsCache();
        writeStatsCache({ ...(cached || {}), savedAt: Date.now(), unavailable: true });
        setRegistryNotice(REGISTRY_UNAVAILABLE);
      } finally {
        inFlight = false;
      }
    };

    const refreshIfDue = () => {
      if (document.visibilityState === 'hidden') return;
      const cached = readStatsCache();
      if (cached && Date.now() - cached.savedAt < STATS_REFRESH_MS) {
        applyEntry(cached); // another tab (or an earlier visit) fetched recently
        return;
      }
      refresh();
    };

    const cached = readStatsCache();
    if (cached) applyEntry(cached);
    refreshIfDue();

    const interval = setInterval(refreshIfDue, STATS_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfDue);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfDue);
    };
  }, []);

  // ?search=handle opens that handle's network map. Reads the full registry once, on load.
  useEffect(() => {
    const searchVal = new URLSearchParams(window.location.search).get('search');
    if (!searchVal) return;
    const handle = '@' + searchVal;
    setSearchQuery(handle);
    loadAllCollections().then(({ susp }) => {
      const realAmps = susp.filter(s => (s.fields.factory_handle?.stringValue || "").toLowerCase().replace('@', '') === searchVal.toLowerCase());
      setActiveMapHandle(handle);
      setActiveMapAmplifiers(realAmps.map(s => ({ handle: s.fields.handle?.stringValue, type: "Caught Amplifying", rep: 10 })));
    }).catch(() => { /* notice is already shown */ });
  }, []);

  const handleSearch = async (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);
    latestQueryRef.current = query;
    if (!query) { setSearchResults([]); setActiveMapHandle(null); return; }

    let data;
    try {
      data = await loadAllCollections();
    } catch {
      return; // notice is already shown
    }
    if (latestQueryRef.current !== query) return; // a newer keystroke has taken over

    const handleMap = {};
    [...data.reg, ...data.acc, ...data.susp].forEach(doc => {
      const handle = doc.fields.author_handle?.stringValue || doc.fields.handle?.stringValue;
      if (handle && handle.toLowerCase().includes(query.replace('@', ''))) {
        if (!handleMap[handle]) { handleMap[handle] = { handle, scores: [], count: 0 }; }
        const score = doc.fields.ai_score?.doubleValue || (doc.fields.manual_reports ? 100 : 50);
        handleMap[handle].scores.push(score); handleMap[handle].count++;
      }
    });

    const results = Object.values(handleMap).map(res => ({
      handle: res.handle, score: Math.round(res.scores.reduce((a, b) => a + b, 0) / res.count), count: res.count,
      label: res.count > 5 && Math.round(res.scores.reduce((a, b) => a + b, 0) / res.count) > 80 ? "Verified Slop Factory" : ""
    }));
    setSearchResults(results);
  };

  const getTrendsData = () => {
    const days = []; const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      days.push([dateStr, trendStats[dateStr] || 0]);
    }
    return days.reverse();
  };

  const trends = getTrendsData();
  const maxTrend = Math.max(...trends.map(t => t[1]), 1);

  const Tweet = ({ author = "ZeroSlop", handle = "zeroslop_ai", children, verified = true, media = null }) => (
    <div className="tweet-card">
      <div className="avatar"><img src={`${baseUrl}icon.jpg`} alt="ZeroSlop Icon" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /></div>
      <div className="tweet-content">
        <div className="tweet-header"><span className="author-name">{author}</span>{verified && <span className="verified-badge">✓</span>}<span className="author-handle">@{handle} · 1m</span></div>
        <div className="tweet-body">{children}</div>
        {media && (
          <div className="tweet-media">
            {media.type === 'video' ? (
              <div style={{ position: 'relative' }}>
                <video src={media.src} controls autoPlay muted loop playsInline preload="auto" style={{ width: '100%', display: 'block' }} />
                <div style={{ padding: '8px', fontSize: '0.8rem', textAlign: 'center', background: '#16181c' }}><a href={media.src} target="_blank" rel="noopener noreferrer" style={{ color: '#1d9bf0', textDecoration: 'none' }}>Trouble viewing? Click here</a></div>
              </div>
            ) : ( <img src={media.src} alt="Tweet media" /> )}
          </div>
        )}
        <div className="tweet-actions"><div className="action-item"><span>💬</span> 12</div><div className="action-item"><span>🔁</span> 45</div><div className="action-item"><span>❤️</span> 128</div><div className="action-item"><span>📊</span> 12k</div></div>
      </div>
    </div>
  );

  return (
    <div className="app-layout">
      <nav className="mobile-nav"><a href="#" className="nav-item">🏠</a><a href="#wall-of-shame" className="nav-item">🚩</a><a href="#installation" className="nav-item">📥</a><a href="#taxonomy" className="nav-item">📘</a></nav>
      <aside className="sidebar-left">
        <div className="logo-container"><a href="#" className="logo"><img src={`${baseUrl}icon.jpg`} alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '50%' }} /></a></div>
        <nav>
          <a href="#" className="nav-item active"><span className="nav-text">Home</span></a>
          <a href="#factory" className="nav-item"><span className="nav-text">Inside the Factory</span></a>
          <a href="#wall-of-shame" className="nav-item"><span className="nav-text">Live Detections</span></a>
          <a href="#installation" className="nav-item"><span className="nav-text">Install</span></a>
          <a href="#taxonomy" className="nav-item"><span className="nav-text">Taxonomy of Slop</span></a>
          <a href="#features" className="nav-item"><span className="nav-text">Features</span></a>
          <a href="#how-it-works" className="nav-item"><span className="nav-text">How it Works</span></a>
          <a href="#research-data" className="nav-item"><span className="nav-text">Research Data</span></a>
          <a href="#wanted" className="nav-item"><span className="nav-text">Wanted Posters</span></a>
          <a href="#faq" className="nav-item"><span className="nav-text">FAQ</span></a>
          <a href="#privacy" className="nav-item"><span className="nav-text">Privacy</span></a>
        </nav>
        <a href="https://twitter.com/intent/tweet?text=Identify%20AI%20slop%20on%20the%20timeline%20with%20ZeroSlop!%20%F0%9F%9B%A1%EF%B8%8F%F0%9F%94%8D%20Check%20it%20out:%20https://github.com/woodrock/zero-slop" target="_blank" className="post-btn">Share on X</a>
      </aside>
      <main className="main-content">
        <header className="sticky-header"><h2>Home</h2></header>
        {activeMapHandle && (
          <section id="network-map" style={{ animation: 'fadeIn 0.5s' }}>
            <SlopMap targetHandle={activeMapHandle} amplifiers={activeMapAmplifiers} />
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <button onClick={() => { setActiveMapHandle(null); setActiveMapAmplifiers([]); }} style={{ background: 'none', border: '1px solid #2f3336', color: '#71767b', padding: '5px 15px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.8rem' }}>Close Map</button>
            </div>
          </section>
        )}
        <Tweet media={{ type: 'image', src: `${baseUrl}banner.jpg` }}>
          <h2>Welcome to ZeroSlop</h2>
          <p>Instantly detect AI-generated tweets on Twitter (X) using the ZeroGPT Business API. Stop the slop, see the truth. 🔍✨</p>
          <div className="features-grid"><div className="feature-mini-card"><h3>High Accuracy</h3><p>Official ZeroGPT Business API.</p></div><div className="feature-mini-card"><h3>Privacy First</h3><p>Keys stay in your browser.</p></div></div>
        </Tweet>
        <section id="factory"><SlopCycle /></section>
        {weeklyAudit && (
          <section id="weekly-audit">
            <Tweet author="ZeroSlop Intelligence" handle="zeroslop_audit">
              <div style={{ background: '#1d9bf01a', padding: '15px', borderRadius: '12px', border: '1px solid #1d9bf04d' }}>
                <h2 style={{ color: '#1d9bf0', marginBottom: '5px' }}>📊 {weeklyAudit.title}</h2>
                <p style={{ fontSize: '0.9rem', color: '#71767b', marginBottom: '15px' }}>{weeklyAudit.date} · Data-driven slop analysis</p>
                <p style={{ marginBottom: '15px', fontWeight: 'bold' }}>{weeklyAudit.summary}</p>
                <div className="audit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                  <div style={{ background: '#16181c', borderRadius: '12px', overflow: 'hidden', border: '1px solid #2f3336' }}>
                    <div style={{ padding: '10px', borderBottom: '1px solid #2f3336', background: '#1d9bf01a', fontWeight: 'bold', fontSize: '0.85rem' }}>🚩 Trending Slop</div>
                    {weeklyAudit.topTrends.slice(0, 5).map((trend, i) => (
                      <div key={i} style={{ padding: '8px 10px', borderBottom: i === 4 ? 'none' : '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{trend.name}</span><span style={{ fontSize: '0.75rem', color: '#f4212e' }}>{trend.score}%</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: '#16181c', borderRadius: '12px', overflow: 'hidden', border: '1px solid #2f3336' }}>
                    <div style={{ padding: '10px', borderBottom: '1px solid #2f3336', background: '#f4212e1a', fontWeight: 'bold', fontSize: '0.85rem' }}>🏭 Slop Factories</div>
                    {weeklyAudit.topFactories.slice(0, 5).map((f, i) => (
                      <div key={i} style={{ padding: '8px 10px', borderBottom: i === 4 ? 'none' : '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{f.handle}</span><span style={{ fontSize: '0.75rem', color: '#71767b' }}>{f.count} slops</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Tweet>
          </section>
        )}
        <section id="wall-of-shame">
          <div className="wall-title">Recent Detections (Wall of Shame)</div>
          <div className="wall-grid">
            {wallOfShame.length > 0 ? wallOfShame.map((slop, i) => (
              <div key={i} className="wall-item">
                <div className="wall-pfp">{slop.pfp.startsWith('http') ? <img src={slop.pfp} alt="pfp" style={{ width: '100%', height: '100%', borderRadius: '50%' }} /> : slop.pfp}</div>
                <div className="wall-info"><div className="wall-name">{slop.name}</div><div className="wall-handle">{slop.handle}</div><div className="wall-score">{slop.score}% AI</div></div>
              </div>
            )) : <div style={{ padding: '20px', color: '#71767b', textAlign: 'center', width: '100%' }}>{registryNotice || "Loading slop reports..."}</div>}
          </div>
        </section>
        <section id="installation">
          <Tweet media={{ type: 'image', src: `${baseUrl}zero-slop-result.jpg` }}>
            <h2>Get ZeroSlop</h2><p>Ready to clean up your feed? Add ZeroSlop to your browser and join the community registry.</p>
            <div style={{ margin: '20px 0' }}><a href="https://chromewebstore.google.com/detail/enlimjkhkfbhcoebopkklafhakhehiab?utm_source=item-share-cb" target="_blank" className="btn-inline" style={{ fontWeight: 'bold', padding: '12px 24px', backgroundColor: '#1d9bf0', color: 'white', borderRadius: '30px', textDecoration: 'none', fontSize: '1.1rem' }}>Add to Chrome</a></div>
            <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px', marginTop: '20px' }}><h3>Optional: Configuration</h3><p>To perform new scans, add your own <strong>ZeroGPT Business API Key</strong> in the extension popup. Previous scans are free for everyone.</p></div>
          </Tweet>
        </section>
        <section id="taxonomy"><div style={{ margin: '20px 0' }}><FieldGuide /></div></section>
        <section id="features"><Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-usage-video.mp4` }}><h2>Features & Usage</h2><p>Every post and profile on X gets a ZeroSlop button. Open it to check the post's text, its photos and videos, the whole thread, or the account, then tag it as slop or human in one tap.</p><div className="browser-icons"><span>Supports: Chrome, Edge, Brave</span></div></Tweet></section>
        <section id="how-it-works"><Tweet media={{ type: 'image', src: `${baseUrl}architecture-diagram.jpeg` }}><h2>How it Works</h2><p>ZeroSlop combines cutting-edge AI detection with community-driven reporting. When you scan a tweet, our engine analyzes it and saves the result to a shared registry for everyone to see. 🧠⚡</p></Tweet></section>
        <section id="registry"><Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-self-reporting.mov` }}><h2>Community Registry</h2><p>ZeroSlop is powered by decentralized intelligence. When one user scans a tweet, the result is saved for everyone. Watch it happen live! 🛡️🤝</p></Tweet></section>
        <section id="research-data">
          <Tweet author="ZeroSlop Research" handle="zeroslop_data">
            <div style={{ background: '#1d9bf01a', padding: '20px', borderRadius: '12px', border: '1px solid #1d9bf04d' }}>
              <h2 style={{ color: '#1d9bf0', marginBottom: '10px' }}>🧬 Research Dataset v1.3</h2>
              <p style={{ marginBottom: '15px' }}>Our community-curated dataset of AI slop, factory networks, and bot amplifiers is available for <strong>academic research and non-commercial use</strong> upon request.</p>
              <div style={{ marginBottom: '15px' }}><a href="mailto:j.r.h.wood98@gmail.com?subject=ZeroSlop%20Research%20Access%20Request" style={{ color: '#1d9bf0', textDecoration: 'underline', fontSize: '0.9rem' }}>Request Research Access Key →</a></div>
              <div style={{ fontSize: '0.8rem', color: '#71767b', marginBottom: '20px', padding: '10px', background: '#000', borderRadius: '8px', border: '1px solid #2f3336' }}>🛡️ PROTECTING THE HUMAN WEB: Access is restricted to prevent adversarial use by automated slop networks.</div>
              <button onClick={async () => {
                  const pass = prompt("Enter researcher password to unlock download:");
                  if (pass === "zeroslop-research-2026") {
                    let reg, acc, susp;
                    try {
                      ({ reg, acc, susp } = await loadAllCollections());
                    } catch {
                      alert(REGISTRY_UNAVAILABLE);
                      return;
                    }
                    const escapeCSV = (str) => { if (!str) return '""'; const clean = str.toString().replace(/"/g, '""').replace(/\n/g, ' '); return `"${clean}"`; };
                    
                    const ORGANIC_GUARD_RULES = [
                      // --- Hard Blocks (Points >= 5) ---
                      /\bfollow\s+(me|@\w+)\b/i, /must follow/i, /\bcomment\b.{0,30}\bto (get|receive|join|access)\b/i,
                      /\b(retweet|like\s+and\s+retweet)\b/i, /\bbookmark\s+(this|it|now|thread|post)\b/i, /\bsave\s+this\b/i,
                      /\b(dm\s+me|dm\s+for|send\s+me\s+(a\s+)?dm)\b/i,
                      /\$[\d,]+\+?\s*\/\s*(mo|month|day|week|hr|hour|year)/i, /\$[\d,]+[k]?\s+per\s+(mo|month|day|week|hour)/i,
                      /\$[\d,]+.{0,40}(replac|instead of|consultant|lawyer|doctor|agency|degree|analyst|designer|copywriter)/i,
                      /\b(make|earn|generate|earning|making)\b.{0,20}\$[\d,]+/i,
                      /\b(money machine|cash machine|print money|income machine)\b/i, /\bside\s+(hustle|income)\b/i, /\bdata entry\b/i,
                      /\bhere are\s+[1-9]\d*\b/i, /\b[1-9]\d*\s+prompts?\b/i,
                      /\b[1-9]\d*\s+(tools?|hacks?|tricks?|ways?|tips?|secrets?|mistakes?|steps?)\b/i,
                      /\b(use these|try these|steal these|copy these)\b.{0,20}\b(prompts?|tools?|tricks?)\b/i,
                      /\bact (as|like) (a |an )?(professional|expert|senior|world-class|harvard)/i,
                      /\bstep[\s-]by[\s-]step\b/i, /\b[1-9]\d*\+?\s*free\s+(ai\s+)?courses?\b/i,
                      /\bBREAKING\b/, /\bGOODBYE\b/, /\bR\.?I\.?P\.?\b/i, /\bSTOP (telling|using|doing|saying)\b/,
                      /\bCANCELLED\b.{0,60}(chatgpt|netflix|spotify|prime|subscription)/i,
                      /\b(most people don.t know|nobody (talks|is talking) about|very few (know|people)|hardly anyone|95% of people|99% of people)\b/i,
                      /\bfor free\b/i, /\bfaceless\b/i, /passive income/i,
                      /\bno (experience|skills?|coding|degree|team|budget|camera|luck)\b/i,
                      /\bzero to.{0,30}(income|money|\$)\b/i, /\b(forget|ditch|quit|goodbye|replace)\s+chatgpt\b/i,
                      /\b(giveaway|giving away)\b/i, /\b(prize|reward).{0,30}(follow|retweet|like|comment|enter)/i,
                      /\bfree for \d+\s*hours?\b/i, /\b(limited (spots?|seats?)|only \d+ spots?)\b/i,
                      /\b(paid courses?).{0,30}free\b/i, /\ball paid.{0,20}free\b/i,
                      /\b(blueprint|masterclass|cheatsheet|playbook).{0,40}(free|get|dm|comment|follow)\b/i,
                      /\b(course|ebook|pdf).{0,40}\$[\d,]+\b/i,
                      /\bgrok.{0,20}imagine\b/i, /\b(apob|pollo ai|seedance|heygen|synthesia)\b/i,
                      /\bai\s+ugc\b/i, /\bupload.{0,20}(photo|video|image).{0,40}(generate|create|make|turn into)\b/i,
                      /\b(stop|still)\s+paying\s+for\b.{0,30}(storage|icloud|gmail|subscription)/i,
                      /\bI\s+(found|discovered)\s+a\s+(way|secret|tool)\b/i,
                      /\b(I\s+)?hope\s+this\s+helps\s+you\s*↓/i,
                      /\bstop\s+(declining|rejecting)\s+spam\s+calls\b/i,
                      /\bif\s+your\s+iphone\s+gets\s+stolen\b/i,
                      /\b(most|9[59]% of)\s+(developers|students|people)\s+are\s+using\b.{0,30}\bwrong\b/i,
                      /\bsomeone\s+(built|leaked|compiled|just)\s+a\s+(tool|skill|system|repo|skill)\b/i,
                      /\b(your|a)\s+\$[\d,]+\s+camera\b.{0,50}\blosing\b/i,
                      /\b(vibe\s+coding|claude\s+code|openclaw)\b/i,
                      /\b(don.t|do\s+not)\s+change\s+the\s+iphone\b/i,
                      /\bbest\s+for\s+(logic|writing|research|video)\b/i,

                      // --- Soft Signals ---
                      /[\u{1D400}-\u{1D7FF}]/u, /(changed my life|show more|read on|curiosity)/i, /\+.{0,20}\+.{0,20}=/
                    ];

                    const csvRows = [ 
                      ["Type", "Handle", "Text", "AI Score", "Detected At", "Label"], 
                      ...reg.map(d => {
                        const score = d.fields.ai_score?.doubleValue || d.fields.ai_score?.integerValue || 0;
                        const slopType = d.fields.slop_type?.stringValue;
                        const manualReport = d.fields.manual_report?.booleanValue || false;
                        const text = d.fields.text?.stringValue || "";
                        
                        const isSlopHeuristic = ORGANIC_GUARD_RULES.some(re => re.test(text));

                        let label = "organic-human";
                        if (score > 15) {
                          label = "ai-generated";
                        } else if ((slopType && slopType !== "type_organic_human") || 
                            (manualReport && slopType !== "type_organic_human") ||
                            (isSlopHeuristic && slopType !== "type_organic_human")) {
                          label = "slop-factory";
                        }
                        
                        return ["Tweet", escapeCSV(d.fields.author_handle?.stringValue), escapeCSV(d.fields.text?.stringValue), score, escapeCSV(d.updateTime), label];
                      }), 
                      ...acc.map(d => ["Factory", escapeCSV(d.fields.handle?.stringValue), "N/A", 100, escapeCSV(d.updateTime || d.createTime), "slop-factory"]), 
                      ...susp.map(d => ["Amplifier", escapeCSV(d.fields.handle?.stringValue), "N/A", 50, escapeCSV(d.updateTime || d.createTime), "slop-factory"]) 
                    ];
                    const csvContent = csvRows.map(e => e.join(",")).join("\n");
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `zeroslop_dataset_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
                  } else { alert("Incorrect password. Please contact @jrhwood for research access."); }
                }} style={{ background: '#1d9bf0', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>📥 Download Community Dataset (CSV)</button>
            </div>
          </Tweet>
        </section>
        <section id="wanted"><Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-wanted-posters.mp4` }}><h2>Wanted Posters</h2><p>Expose the slop-posters with style! Check a post, then copy a "WANTED" poster stamped with its AI score straight from the ZeroSlop panel and share it. 🖼️🎨</p></Tweet></section>
        <section id="faq"><div className="faq-container"><h2>Frequently Asked Questions</h2><div className="faq-item"><h3>Does this cost money?</h3><p>The extension is free. However, performing new scans uses the ZeroGPT API which requires your own API key with credits. Community detections are free to view.</p></div><div className="faq-item"><h3>Is it 100% accurate?</h3><p>AI detection is probabilistic. ZeroSlop identifies strong markers of AI generation and industrial engagement farming.</p></div></div></section>
        <section id="privacy"><Tweet><h2>Privacy Policy</h2><p>ZeroSlop is built with a privacy-first mindset. No personal data is stored. All processing happens between your browser and the ZeroGPT API.</p><a href="https://github.com/woodrock/zero-slop/blob/main/PRIVACY.md" target="_blank" className="btn-inline">Read full policy →</a></Tweet></section>
        <footer style={{ padding: '40px', textAlign: 'center', color: '#71767b', borderTop: '1px solid #2f3336' }}><p>&copy; {year} ZeroSlop. Built for a cleaner timeline.</p></footer>
      </main>
      <aside className="sidebar-right">
        <div style={{ marginBottom: '16px' }}>
          <input type="text" className="search-bar" placeholder="Search Registry (e.g. @bot)" value={searchQuery} onChange={handleSearch} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--twitter-border)' }} />
          {searchResults.length > 0 && (
            <div className="search-results" style={{ background: 'var(--twitter-dark-gray)', padding: '10px', borderRadius: '12px', marginTop: '8px' }}>
              {searchResults.slice(0, 5).map((res, i) => (
                <div key={i} style={{ marginBottom: '12px', fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => handleMapOpen(res.handle)}><div style={{ fontWeight: 'bold', color: 'inherit' }}>{res.handle}</div><div style={{ color: '#f4212e' }}>{Math.round(res.score)}% AI Score ({res.count} detections)</div></div>
              ))}
            </div>
          )}
        </div>
        {registryNotice && (
          <div role="status" className="registry-notice">{registryNotice}</div>
        )}
        <div className="trending-box">
          <div className="trending-title">Slop Trends (Last 7 Days)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '60px', padding: '10px 5px 0' }}>
            {trends.map(([date, count], i) => ( <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}><div style={{ width: '10px', height: `${(count / maxTrend) * 40}px`, background: '#1d9bf0', borderRadius: '2px 2px 0 0', minHeight: count > 0 ? '4px' : '0' }}></div><div style={{ fontSize: '0.5rem', color: '#71767b', marginTop: '4px' }}>{date.split('-')[2]}</div></div> ))}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#71767b', padding: '5px 10px', textAlign: 'center' }}>Daily slop detections are {trends.length >= 7 && trends[6][1] > trends[5][1] ? 'up' : 'down'} today</div>
        </div>
        <div className="slop-counter-box"><div className="counter-label">COMMUNITY GOAL: {GOAL}</div><div style={{ width: '100%', background: '#333', borderRadius: '9999px', height: '8px', margin: '8px 0' }}><div style={{ width: `${Math.min(((stats.rawCount || 0) / GOAL) * 100, 100)}%`, background: '#1d9bf0', height: '100%', borderRadius: '9999px' }}></div></div><div className="counter-label" style={{ marginTop: '16px' }}>TOTAL SLOP DETECTED</div><div className="counter-value">{registryNotice && stats.count === "..." ? "—" : stats.count}</div><div className="counter-sub">{registryNotice && stats.accounts === "..." ? "Unavailable right now" : `Across ${stats.accounts} accounts`}</div></div>
        <div className="trending-box"><div className="trending-title">Project Stats</div><div className="trending-item"><div className="trending-category">Trending in Tech</div><div className="trending-name">#ZeroSlop</div><div className="trending-count">Live Community Data</div></div><div className="trending-item"><div className="trending-category">API Status</div><div className="trending-name">ZeroGPT Online</div><div className="trending-count">Latency: 240ms</div></div></div>
        <div className="trending-box"><div className="trending-title">Support</div><div className="trending-item" style={{ cursor: 'default' }}><div className="trending-category">Official Coin</div><div className="trending-name">Contract Address (CA)</div><div className="trending-count" style={{ wordBreak: 'break-all', fontSize: '0.75rem', marginBottom: '8px' }}>CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump</div><button onClick={() => { navigator.clipboard.writeText('CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump'); alert('Contract Address copied to clipboard!'); }} style={{ background: 'var(--twitter-blue)', color: 'white', border: 'none', borderRadius: '9999px', padding: '4px 12px', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer' }}>Copy CA</button></div></div>
      </aside>
    </div>
  )
}

export default App
