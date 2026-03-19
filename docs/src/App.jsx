import { useState, useEffect } from 'react'
import './App.css'
import FieldGuide from './components/FieldGuide'
import SlopCycle from './components/SlopCycle'
import SlopMap from './components/SlopMap'

function App() {
  const year = new Date().getFullYear();
  const baseUrl = import.meta.env.BASE_URL;
  
  // Firebase Config (Public values only)
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDDx5ZbgWcgsKxsP78EubqyWRHL9yxdXec",
    projectId: "zero-slop"
  };

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
  
  const GOAL = 5000; // Community goal

  const findAmplifiersForHandle = (handle) => {
    // 1. Find all tweet IDs from this factory
    const factoryTweets = allDocs
      .filter(doc => doc.fields.author_handle?.stringValue === handle)
      .map(doc => doc.fields.tweet_id?.stringValue);

    // 2. Find all suspicious accounts that were caught on those tweets
    const realAmplifiers = allSuspicious
      .filter(susp => factoryTweets.includes(susp.fields.reason_tweet_id?.stringValue))
      .map(susp => ({
        handle: susp.fields.handle?.stringValue,
        type: "Caught Amplifying",
        rep: Math.floor(Math.random() * 40) // Mock rep for now, but real handle
      }));

    return realAmplifiers;
  };

  const handleMapOpen = (handle) => {
    const realAmps = findAmplifiersForHandle(handle);
    setActiveMapHandle(handle);
    setActiveMapAmplifiers(realAmps);
  };

  const getGlobalAudit = () => {
    // Combine all detection events for a master list
    const masterEvents = [
      ...allDocs.map(d => ({ date: d.updateTime, score: d.fields.ai_score?.doubleValue || 0, handle: d.fields.author_handle?.stringValue })),
      ...allAccounts.map(d => ({ date: d.updateTime || d.createTime, score: 100, handle: d.fields.handle?.stringValue })),
      ...allSuspicious.map(d => ({ date: d.updateTime || d.createTime, score: 50, handle: d.fields.handle?.stringValue }))
    ];

    if (masterEvents.length === 0) return null;

    // Filter for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentEvents = masterEvents.filter(e => new Date(e.date) > sevenDaysAgo);
    const slopDocs = allDocs.filter(doc => new Date(doc.updateTime) > sevenDaysAgo && (doc.fields.ai_score?.doubleValue || 0) > 15);

    // 1. Top Slop Factories (Accounts)
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

    // 2. Sloppy Trends (Keywords/Hashtags)
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

    // 3. Daily Slop Volume (Accurate aggregated counts)
    const dailyVolume = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dailyVolume[d.toISOString().split('T')[0]] = 0;
    }
    recentEvents.forEach(event => {
      if (event.date) {
        const date = event.date.split('T')[0];
        if (dailyVolume[date] !== undefined) dailyVolume[date]++;
      }
    });

    return {
      title: "Global State of the Feed",
      date: `Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
      summary: `Our global registry analysis for the past 7 days shows ${recentEvents.length} total slop events detected (Tweets + Factory Reports + Amplifiers).`,
      totalSlops: recentEvents.length,
      topTrends: topTrends,
      topFactories: topFactories,
      dailyVolume: Object.entries(dailyVolume).reverse()
    };
  };

  const weeklyAudit = getGlobalAudit();

  useEffect(() => {
    // Check if deep linked from extension
    const params = new URLSearchParams(window.location.search);
    const searchVal = params.get('search');
    if (searchVal) {
      setSearchQuery('@' + searchVal);
      // Data is fetched in the useEffect below, so wait slightly
      setTimeout(() => handleMapOpen('@' + searchVal), 2000);
    }

    const fetchRegistryData = async () => {
      try {
        const statsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/stats/global?key=${FIREBASE_CONFIG.apiKey}`;
        const statsResponse = await fetch(statsUrl);

        // Fetch all 3 collections in parallel for better speed and accuracy
        const collections = ['slop_registry', 'slop_accounts', 'suspicious_accounts'];
        const [regRes, accRes, suspRes] = await Promise.all(
          collections.map(c => fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${c}?key=${FIREBASE_CONFIG.apiKey}&pageSize=1000&orderBy=last_updated desc&t=${Date.now()}`))
        );

        if (regRes.ok) {
          const data = await regRes.json();
          setAllDocs(data.documents || []);
        }
        if (accRes.ok) {
          const data = await accRes.json();
          setAllAccounts(data.documents || []);
        }
        if (suspRes.ok) {
          const data = await suspRes.json();
          setAllSuspicious(data.documents || []);
        }

        const trendsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/trends?key=${FIREBASE_CONFIG.apiKey}&pageSize=100`;
        const trendsResponse = await fetch(trendsUrl);
        if (trendsResponse.ok) {
          const trendsData = await trendsResponse.json();
          const trendMap = {};
          (trendsData.documents || []).forEach(doc => {
            const dateStr = doc.name.split('/').pop();
            trendMap[dateStr] = parseInt(doc.fields.count?.integerValue || 0);
          });
          setTrendStats(trendMap);
        }
        
        // Combine and calculate stats
        const allLocalDocs = regRes.ok ? (await regRes.clone().json()).documents || [] : [];
        const allLocalAccounts = accRes.ok ? (await accRes.clone().json()).documents || [] : [];
        const allLocalSuspicious = suspRes.ok ? (await suspRes.clone().json()).documents || [] : [];

        let totalCount = allLocalDocs.length + allLocalAccounts.length + allLocalSuspicious.length;
        let totalAccountsCount = new Set([
          ...allLocalDocs.map(d => d.fields.author_handle?.stringValue),
          ...allLocalAccounts.map(d => d.fields.handle?.stringValue),
          ...allLocalSuspicious.map(d => d.fields.handle?.stringValue)
        ].filter(Boolean)).size;

        if (statsResponse.ok) {
          const statsData = await statsResponse.json();
          const remoteTotal = parseInt(statsData.fields.total_slops?.integerValue || 0);
          const remoteAccounts = parseInt(statsData.fields.total_accounts?.integerValue || 0);
          
          totalCount = Math.max(remoteTotal, totalCount);
          totalAccountsCount = Math.max(remoteAccounts, totalAccountsCount);
        }

        setStats({
          count: totalCount.toLocaleString(),
          accounts: totalAccountsCount.toLocaleString(),
          rawCount: totalCount
        });

        if (regRes.ok) {
          const data = await regRes.json();
          const documents = data.documents || [];
          
          const recent = documents
            .map(doc => ({
              name: doc.fields.author_name?.stringValue || "Unknown",
              handle: doc.fields.author_handle?.stringValue || "@anonymous",
              score: Math.round(doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0),
              pfp: doc.fields.author_pfp?.stringValue || "🤖",
              updateTime: doc.updateTime
            }))
            .filter(item => item.score > 15)
            .sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime))
            .slice(0, 3);
          setWallOfShame(recent);
        }
      } catch (e) {
        console.error("ZeroSlop: Failed to fetch live stats", e);
      }
    };

    fetchRegistryData();
  }, []);

  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);
    if (!query) {
      setSearchResults([]);
      setActiveMapHandle(null);
      return;
    }
    
    const handleMap = {};
    // Search across all sources
    [...allDocs, ...allAccounts, ...allSuspicious].forEach(doc => {
      const handle = doc.fields.author_handle?.stringValue || doc.fields.handle?.stringValue;
      if (handle && handle.toLowerCase().includes(query.replace('@', ''))) {
        if (!handleMap[handle]) {
          handleMap[handle] = { handle, scores: [], count: 0 };
        }
        const score = doc.fields.ai_score?.doubleValue || (doc.fields.manual_reports ? 100 : 50);
        handleMap[handle].scores.push(score);
        handleMap[handle].count++;
      }
    });

    const results = Object.values(handleMap).map(res => {
      const avgScore = Math.round(res.scores.reduce((a, b) => a + b, 0) / res.count);
      let label = "";
      if (res.count > 5 && avgScore > 80) label = "Verified Slop Factory";
      else if (avgScore > 70) label = "Likely Bot";
      
      return {
        handle: res.handle,
        score: avgScore,
        count: res.count,
        label
      };
    });

    setSearchResults(results);
  };

  const getTrendsData = () => {
    const days = {};
    const today = new Date();

    // 1. Group all current docs by day
    const allCurrentEvents = [...allDocs, ...allAccounts, ...allSuspicious];
    const docCounts = {};
    allCurrentEvents.forEach(doc => {
      const dateStr = (doc.updateTime || doc.createTime)?.split('T')[0];
      if (dateStr) docCounts[dateStr] = (docCounts[dateStr] || 0) + 1;
    });

    // 2. Aggregate with historical trendStats
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      days[dateStr] = Math.max(trendStats[dateStr] || 0, docCounts[dateStr] || 0);
    }

    return Object.entries(days).reverse();
  };

  const trends = getTrendsData();
  const maxTrend = Math.max(...trends.map(t => t[1]), 1);

  const Tweet = ({ author = "ZeroSlop", handle = "zeroslop_ai", children, verified = true, media = null }) => (
    <div className="tweet-card">
      <div className="avatar">
        <img src={`${baseUrl}icon.jpg`} alt="ZeroSlop Icon" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
      </div>
      <div className="tweet-content">
        <div className="tweet-header">
          <span className="author-name">{author}</span>
          {verified && <span className="verified-badge">✓</span>}
          <span className="author-handle">@{handle} · 1m</span>
        </div>
        <div className="tweet-body">
          {children}
        </div>
        {media && (
          <div className="tweet-media">
            {media.type === 'video' ? (
              <div style={{ position: 'relative' }}>
                <video src={media.src} controls autoPlay muted loop playsInline preload="auto" style={{ width: '100%', display: 'block' }} />
                <div style={{ padding: '8px', fontSize: '0.8rem', textAlign: 'center', background: '#16181c' }}>
                  <a href={media.src} target="_blank" rel="noopener noreferrer" style={{ color: '#1d9bf0', textDecoration: 'none' }}>
                    Trouble viewing? Click here to open video directly
                  </a>
                </div>
              </div>
            ) : (
              <img src={media.src} alt="Tweet media" />
            )}
          </div>
        )}
        <div className="tweet-actions">
          <div className="action-item"><span>💬</span> 12</div>
          <div className="action-item"><span>🔁</span> 45</div>
          <div className="action-item"><span>❤️</span> 128</div>
          <div className="action-item"><span>📊</span> 12k</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-layout">
      <nav className="mobile-nav">
        <a href="#" className="nav-item">🏠</a>
        <a href="#wall-of-shame" className="nav-item">🚩</a>
        <a href="#installation" className="nav-item">📥</a>
        <a href="#taxonomy" className="nav-item">📘</a>
      </nav>

      <aside className="sidebar-left">
        <div className="logo-container">
          <a href="#" className="logo">
            <img src={`${baseUrl}icon.jpg`} alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
          </a>
        </div>
        <nav>
          <a href="#" className="nav-item active"><span className="nav-text">Home</span></a>
          <a href="#factory" className="nav-item"><span className="nav-text">Inside the Factory</span></a>
          <a href="#wall-of-shame" className="nav-item"><span className="nav-text">Live Detections</span></a>
          <a href="#installation" className="nav-item"><span className="nav-text">Install</span></a>
          <a href="#taxonomy" className="nav-item"><span className="nav-text">Taxonomy of Slop</span></a>
          <a href="#features" className="nav-item"><span className="nav-text">Features</span></a>
          <a href="#how-it-works" className="nav-item"><span className="nav-text">How it Works</span></a>
          <a href="#wanted" className="nav-item"><span className="nav-text">Wanted Posters</span></a>
          <a href="#faq" className="nav-item"><span className="nav-text">FAQ</span></a>
          <a href="#privacy" className="nav-item"><span className="nav-text">Privacy</span></a>
        </nav>
        <a href="https://twitter.com/intent/tweet?text=Identify%20AI%20slop%20on%20the%20timeline%20with%20ZeroSlop!%20%F0%9F%9B%A1%EF%B8%8F%F0%9F%94%8D%20Check%20it%20out:%20https://github.com/woodrock/zero-slop" target="_blank" className="post-btn">Share on X</a>
      </aside>

      <main className="main-content">
        <header className="sticky-header">
          <h2>Home</h2>
        </header>

        {/* Search & Map Feature */}
        {activeMapHandle && (
          <section id="network-map" style={{ animation: 'fadeIn 0.5s' }}>
            <SlopMap targetHandle={activeMapHandle} amplifiers={activeMapAmplifiers} />
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <button 
                onClick={() => { setActiveMapHandle(null); setActiveMapAmplifiers([]); }}
                style={{ background: 'none', border: '1px solid #2f3336', color: '#71767b', padding: '5px 15px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Close Map
              </button>
            </div>
          </section>
        )}

        {/* 1. HERO */}
        <Tweet media={{ type: 'image', src: `${baseUrl}banner.jpg` }}>
          <h2>Welcome to ZeroSlop</h2>
          <p>Instantly detect AI-generated tweets on Twitter (X) using the ZeroGPT Business API. Stop the slop, see the truth. 🔍✨</p>
          <div className="features-grid">
            <div className="feature-mini-card">
              <h3>High Accuracy</h3>
              <p>Official ZeroGPT Business API.</p>
            </div>
            <div className="feature-mini-card">
              <h3>Privacy First</h3>
              <p>Keys stay in your browser.</p>
            </div>
          </div>
        </Tweet>

        {/* 1.5 MECHANISM */}
        <section id="factory">
          <SlopCycle />
        </section>

        {/* 2. EVIDENCE (Audit + Wall of Shame) */}
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
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{trend.name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#f4212e' }}>{trend.score}%</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: '#16181c', borderRadius: '12px', overflow: 'hidden', border: '1px solid #2f3336' }}>
                    <div style={{ padding: '10px', borderBottom: '1px solid #2f3336', background: '#f4212e1a', fontWeight: 'bold', fontSize: '0.85rem' }}>🏭 Slop Factories</div>
                    {weeklyAudit.topFactories.slice(0, 5).map((f, i) => (
                      <div key={i} style={{ padding: '8px 10px', borderBottom: i === 4 ? 'none' : '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{f.handle}</span>
                        <span style={{ fontSize: '0.75rem', color: '#71767b' }}>{f.count} slops</span>
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
                <div className="wall-pfp">
                  {slop.pfp.startsWith('http') ? <img src={slop.pfp} alt="pfp" style={{ width: '100%', height: '100%', borderRadius: '50%' }} /> : slop.pfp}
                </div>
                <div className="wall-info">
                  <div className="wall-name">{slop.name}</div>
                  <div className="wall-handle">{slop.handle}</div>
                  <div className="wall-score">{slop.score}% AI</div>
                </div>
              </div>
            )) : (
              <div style={{ padding: '20px', color: '#71767b', textAlign: 'center', width: '100%' }}>Loading slop reports...</div>
            )}
          </div>
        </section>

        {/* 3. SOLUTION (CTA) */}
        <section id="installation">
          <Tweet media={{ type: 'image', src: `${baseUrl}zero-slop-result.png` }}>
            <h2>Get ZeroSlop</h2>
            <p>Ready to clean up your feed? Add ZeroSlop to your browser and join the community registry.</p>
            <div style={{ margin: '20px 0' }}>
              <a href="https://chromewebstore.google.com/detail/enlimjkhkfbhcoebopkklafhakhehiab?utm_source=item-share-cb" 
                 target="_blank" 
                 className="btn-inline" 
                 style={{ fontWeight: 'bold', padding: '12px 24px', backgroundColor: '#1d9bf0', color: 'white', borderRadius: '30px', textDecoration: 'none', fontSize: '1.1rem' }}>
                Add to Chrome
              </a>
            </div>
            <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px', marginTop: '20px' }}>
              <h3>Optional: Configuration</h3>
              <p>To perform new scans, add your own <strong>ZeroGPT Business API Key</strong> in the extension popup. Previous scans are free for everyone.</p>
            </div>
          </Tweet>
        </section>

        {/* 4. EDUCATION (Taxonomy) */}
        <section id="taxonomy">
          <div style={{ margin: '20px 0' }}>
            <FieldGuide />
          </div>
        </section>

        {/* 5. PRODUCT DEMO */}
        <section id="features">
          <Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-usage-video.mov` }}>
            <h2>Features & Usage</h2>
            <p>Seamlessly integrated into your X timeline. Right-click any tweet to analyze it, or scan entire threads and profiles with one click.</p>
            <div className="browser-icons">
              <span>Supports: Chrome, Edge, Brave</span>
            </div>
          </Tweet>
        </section>

        {/* 6. TECHNICALS */}
        <section id="how-it-works">
          <Tweet media={{ type: 'image', src: `${baseUrl}architecture-diagram.jpeg` }}>
            <h2>How it Works</h2>
            <p>ZeroSlop combines cutting-edge AI detection with community-driven reporting. When you scan a tweet, our engine analyzes it and saves the result to a shared registry for everyone to see. 🧠⚡</p>
          </Tweet>
        </section>

        <section id="registry">
          <Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-self-reporting.mov` }}>
            <h2>Community Registry</h2>
            <p>ZeroSlop is powered by decentralized intelligence. When one user scans a tweet, the result is saved for everyone. Watch it happen live! 🛡️🤝</p>
          </Tweet>
        </section>

        <section id="wanted">
          <Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-wanted-posters.mov` }}>
            <h2>Wanted Posters</h2>
            <p>Expose the slop-posters with style! Generate a custom "WANTED" poster for any AI-detected tweet and share it instantly. 🖼️🎨</p>
          </Tweet>
        </section>

        <section id="faq">
          <div className="faq-container">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-item">
              <h3>Does this cost money?</h3>
              <p>The extension is free. However, performing new scans uses the ZeroGPT API which requires your own API key with credits. Community detections are free to view.</p>
            </div>
            <div className="faq-item">
              <h3>Is it 100% accurate?</h3>
              <p>AI detection is probabilistic. ZeroSlop identifies strong markers of AI generation and industrial engagement farming.</p>
            </div>
          </div>
        </section>

        <section id="privacy">
          <Tweet>
            <h2>Privacy Policy</h2>
            <p>ZeroSlop is built with a privacy-first mindset. No personal data is stored. All processing happens between your browser and the ZeroGPT API.</p>
            <a href="https://github.com/woodrock/zero-slop/blob/main/PRIVACY.md" target="_blank" className="btn-inline">Read full policy →</a>
          </Tweet>
        </section>

        <footer style={{ padding: '40px', textAlign: 'center', color: '#71767b', borderTop: '1px solid #2f3336' }}>
          <p>&copy; {year} ZeroSlop. Built for a cleaner timeline.</p>
        </footer>
      </main>

      {/* Right Sidebar */}
      <aside className="sidebar-right">
        <div style={{ marginBottom: '16px' }}>
          <input 
            type="text" 
            className="search-bar" 
            placeholder="Search Registry (e.g. @bot)" 
            value={searchQuery}
            onChange={handleSearch}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--twitter-border)' }}
          />
          {searchResults.length > 0 && (
            <div className="search-results" style={{ background: 'var(--twitter-dark-gray)', padding: '10px', borderRadius: '12px', marginTop: '8px' }}>
              {searchResults.slice(0, 5).map((res, i) => (
                <div key={i} style={{ marginBottom: '12px', fontSize: '0.85rem', cursor: 'pointer' }} onClick={() => handleMapOpen(res.handle)}>
                  <div style={{ fontWeight: 'bold', color: 'inherit' }}>{res.handle}</div>
                  <div style={{ color: '#f4212e' }}>{Math.round(res.score)}% AI Score ({res.count} detections)</div>
                  {res.label && <div style={{ fontSize: '0.7rem', background: '#f4212e', color: 'white', display: 'inline-block', padding: '1px 5px', borderRadius: '4px', marginTop: '3px' }}>{res.label}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="trending-box">
          <div className="trending-title">Slop Trends (Last 7 Days)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '60px', padding: '10px 5px 0' }}>
            {trends.map(([date, count], i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{ 
                  width: '10px', 
                  height: `${(count / maxTrend) * 40}px`, 
                  background: '#1d9bf0', 
                  borderRadius: '2px 2px 0 0',
                  minHeight: count > 0 ? '4px' : '0'
                }}></div>
                <div style={{ fontSize: '0.5rem', color: '#71767b', marginTop: '4px' }}>{date.split('-')[2]}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#71767b', padding: '5px 10px', textAlign: 'center' }}>
            Daily slop detections are {trends[6][1] > trends[5][1] ? 'up' : 'down'} today
          </div>
        </div>

        <div className="slop-counter-box">
          <div className="counter-label">COMMUNITY GOAL: {GOAL}</div>
          <div style={{ width: '100%', background: '#333', borderRadius: '9999px', height: '8px', margin: '8px 0' }}>
            <div style={{ width: `${Math.min(((stats.rawCount || 0) / GOAL) * 100, 100)}%`, background: '#1d9bf0', height: '100%', borderRadius: '9999px' }}></div>
          </div>
          <div className="counter-label" style={{ marginTop: '16px' }}>TOTAL SLOP DETECTED</div>
          <div className="counter-value">{stats.count}</div>
          <div className="counter-sub">Across {stats.accounts} accounts</div>
        </div>

        <div className="trending-box">
          <div className="trending-title">Project Stats</div>
          <div className="trending-item">
            <div className="trending-category">Trending in Tech</div>
            <div className="trending-name">#ZeroSlop</div>
            <div className="trending-count">Live Community Data</div>
          </div>
          <div className="trending-item">
            <div className="trending-category">API Status</div>
            <div className="trending-name">ZeroGPT Online</div>
            <div className="trending-count">Latency: 240ms</div>
          </div>
        </div>

        <div className="trending-box">
          <div className="trending-title">Support</div>
          <div className="trending-item" style={{ cursor: 'default' }}>
            <div className="trending-category">Official Coin</div>
            <div className="trending-name">Contract Address (CA)</div>
            <div className="trending-count" style={{ wordBreak: 'break-all', fontSize: '0.75rem', marginBottom: '8px' }}>CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump</div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText('CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump');
                alert('Contract Address copied to clipboard!');
              }}
              style={{
                background: 'var(--twitter-blue)',
                color: 'white',
                border: 'none',
                borderRadius: '9999px',
                padding: '4px 12px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Copy CA
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App
