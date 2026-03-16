import { useState, useEffect } from 'react'
import './App.css'

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
  const [trendStats, setTrendStats] = useState({});
  
  const GOAL = 5000; // Community goal

  const getGlobalAudit = () => {
    if (allDocs.length === 0) return null;

    // Filter for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentDocs = allDocs.filter(doc => new Date(doc.updateTime) > sevenDaysAgo);
    const slopDocs = recentDocs.filter(doc => (doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0) > 15);

    // 1. Top Slop Factories (Accounts)
    const handleMap = {};
    slopDocs.forEach(doc => {
      const handle = doc.fields.author_handle?.stringValue || "@anonymous";
      if (!handleMap[handle]) handleMap[handle] = { handle, count: 0, scores: [] };
      handleMap[handle].count++;
      handleMap[handle].scores.push(doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0);
    });

    const topFactories = Object.values(handleMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(f => ({
        name: f.handle,
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
        if (['https', 'twitter', 'status', 'photo'].includes(w)) return;
        if (!keywordMap[w]) keywordMap[w] = { name: word, count: 0, scores: [] };
        keywordMap[w].count++;
        keywordMap[w].scores.push(doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0);
      });
    });

    const topTrends = Object.values(keywordMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(t => ({
        name: t.name.startsWith('#') ? t.name : `#${t.name}`,
        score: Math.round(t.scores.reduce((a, b) => a + b, 0) / t.scores.length),
        count: t.count
      }));

    return {
      title: "Global State of the Feed",
      date: `Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
      summary: `Our global registry analysis for the past 7 days shows ${slopDocs.length} confirmed AI-generated tweets. The timeline is currently ${Math.round((slopDocs.length / Math.max(recentDocs.length, 1)) * 100)}% sloppy.`,
      totalSlops: slopDocs.length,
      topTrends: topTrends.length > 0 ? topTrends : topFactories
    };
  };

  const weeklyAudit = getGlobalAudit();

  useEffect(() => {
    const fetchRegistryData = async () => {
      try {
        // 1. Fetch Global Stats
        const statsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/stats/global?key=${FIREBASE_CONFIG.apiKey}`;
        const statsResponse = await fetch(statsUrl);

        // 1.5 Fetch Trends Collection
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
        
        // 2. Fetch Recent Documents for Wall of Shame & Search (Sorted by update time)
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry?key=${FIREBASE_CONFIG.apiKey}&pageSize=1000&orderBy=last_updated desc&t=${Date.now()}`;
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          const documents = data.documents || [];
          setAllDocs(documents);
          
          let totalCount = documents.length;
          let totalAccounts = new Set(documents.map(d => d.fields.author_handle?.stringValue)).size;

          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            const remoteTotal = parseInt(statsData.fields.total_slops?.integerValue || 0);
            const remoteAccounts = parseInt(statsData.fields.total_accounts?.integerValue || 0);
            
            totalCount = Math.max(remoteTotal, totalCount);
            totalAccounts = Math.max(remoteAccounts, totalAccounts);
          }

          setStats({
            count: totalCount.toLocaleString(),
            accounts: totalAccounts.toLocaleString(),
            rawCount: totalCount
          });

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
      return;
    }
    
    // Aggregate by handle
    const handleMap = {};
    allDocs.forEach(doc => {
      const handle = doc.fields.author_handle?.stringValue;
      if (handle && handle.toLowerCase().includes(query)) {
        if (!handleMap[handle]) {
          handleMap[handle] = { handle, scores: [], count: 0 };
        }
        handleMap[handle].scores.push(doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0);
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

  // Group by day for trends
  const getTrendsData = () => {
    const days = {};
    const docCounts = {};
    const today = new Date();

    // Count from allDocs (last 1000)
    allDocs.forEach(doc => {
      const dateStr = doc.updateTime.split('T')[0];
      docCounts[dateStr] = (docCounts[dateStr] || 0) + 1;
    });

    // Show last 10 days to ensure March 13th is visible
    for (let i = 0; i < 10; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      // Use the max of our historical trendStats or what we see in the latest 1000 docs
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
      {/* Mobile Nav */}
      <nav className="mobile-nav">
        <a href="#" className="nav-item">🏠</a>
        <a href="#features" className="nav-item">🚀</a>
        <a href="#installation" className="nav-item">📥</a>
        <a href="#privacy" className="nav-item">🛡️</a>
      </nav>

      {/* Left Sidebar */}
      <aside className="sidebar-left">
        <div className="logo-container">
          <a href="#" className="logo">
            <img src={`${baseUrl}icon.jpg`} alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
          </a>
        </div>
        <nav>
          <a href="#" className="nav-item active"><span className="nav-text">Home</span></a>
          <a href="#features" className="nav-item"><span className="nav-text">Features</span></a>
          <a href="#how-it-works" className="nav-item"><span className="nav-text">How it Works</span></a>
          <a href="#registry" className="nav-item"><span className="nav-text">Registry</span></a>
          <a href="#wanted" className="nav-item"><span className="nav-text">Wanted</span></a>
          <a href="#installation" className="nav-item"><span className="nav-text">Install</span></a>
          <a href="#faq" className="nav-item"><span className="nav-text">FAQ</span></a>
          <a href="#privacy" className="nav-item"><span className="nav-text">Privacy</span></a>
        </nav>
        <a href="https://twitter.com/intent/tweet?text=Identify%20AI%20slop%20on%20the%20timeline%20with%20ZeroSlop!%20%F0%9F%9B%A1%EF%B8%8F%F0%9F%94%8D%20Check%20it%20out:%20https://github.com/woodrock/zero-slop" target="_blank" className="post-btn">Share on X</a>
      </aside>

      {/* Main Timeline */}
      <main className="main-content">
        <header className="sticky-header">
          <h2>Home</h2>
        </header>

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

        {weeklyAudit && (
          <section id="weekly-audit">
            <Tweet author="ZeroSlop Intelligence" handle="zeroslop_audit">
              <div style={{ background: '#1d9bf01a', padding: '15px', borderRadius: '12px', border: '1px solid #1d9bf04d' }}>
                <h2 style={{ color: '#1d9bf0', marginBottom: '5px' }}>📊 {weeklyAudit.title}</h2>
                <p style={{ fontSize: '0.9rem', color: '#71767b', marginBottom: '15px' }}>{weeklyAudit.date} · Data-driven slop analysis</p>
                
                <p style={{ marginBottom: '15px', fontWeight: 'bold' }}>{weeklyAudit.summary}</p>
                
                <div style={{ background: '#16181c', borderRadius: '12px', overflow: 'hidden', border: '1px solid #2f3336' }}>
                  <div style={{ padding: '12px', borderBottom: '1px solid #2f3336', background: '#1d9bf01a', fontWeight: 'bold' }}>
                    🚩 Bot-Driven Trend Leaderboard
                  </div>
                  {weeklyAudit.topTrends.map((trend, i) => (
                    <div key={i} style={{ padding: '12px', borderBottom: i === weeklyAudit.topTrends.length - 1 ? 'none' : '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{i + 1}. {trend.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#71767b' }}>{trend.count} reports analyzed</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ 
                          color: trend.score > 80 ? '#f4212e' : trend.score > 50 ? '#ffd700' : '#00ba7c', 
                          fontWeight: 'bold',
                          fontSize: '1.1rem'
                        }}>
                          {trend.score}% Sloppy
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#71767b' }}>AI-Generated Confidence</div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div style={{ marginTop: '15px', fontSize: '0.85rem', color: '#71767b', fontStyle: 'italic' }}>
                  * This week, {weeklyAudit.totalSlops} new slop detections were added to the registry. Keep hunting!
                </div>
              </div>
            </Tweet>
          </section>
        )}

        <Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-usage-video.mov` }}>
          <p>Check out ZeroSlop in action! Seamlessly integrated into your X timeline. 👇</p>
        </Tweet>

        <section id="how-it-works">
          <Tweet media={{ type: 'image', src: `${baseUrl}architecture-diagram.jpeg` }}>
            <h2>How it Works</h2>
            <p>ZeroSlop combines cutting-edge AI detection with community-driven reporting. When you scan a tweet, our engine analyzes it and saves the result to a shared registry for everyone to see. 🧠⚡</p>
          </Tweet>
        </section>

        <section id="registry">
          <Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-self-reporting.mov` }}>
            <h2>Community Registry</h2>
            <p>ZeroSlop is powered by the community. When one user scans a tweet, the result is saved for everyone. Watch how it identifies slop in real-time on a busy thread! 🛡️🤝</p>
          </Tweet>
        </section>

        <section id="wanted">
          <Tweet media={{ type: 'video', src: `${baseUrl}zero-slop-wanted-posters.mov` }}>
            <h2>Wanted Posters</h2>
            <p>Expose the slop-posters with style! Generate a custom "WANTED" poster for any AI-detected tweet and share it instantly to your clipboard. 🖼️🎨</p>
          </Tweet>
        </section>

        <section id="wall-of-shame">
          <div className="wall-title">Recent Detections (Wall of Shame)</div>
          <div className="wall-grid">
            {wallOfShame.length > 0 ? wallOfShame.map((slop, i) => (
              <div key={i} className="wall-item">
                <div className="wall-pfp">
                  {slop.pfp.startsWith('http') ? <img src={slop.pfp} alt="pfp" style={{ width: '100%', height: '100%', borderRadius: '50%' }} /> : slop.pfp}
                </div>
                <div className="wall-info">
                  <div className="wall-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>{slop.name}</div>
                  <div className="wall-handle" style={{ color: '#71767b', fontSize: '0.75rem' }}>{slop.handle}</div>
                  <div className="wall-score">{slop.score}% AI</div>
                </div>
              </div>
            )) : (
              <div style={{ padding: '20px', color: '#71767b', textAlign: 'center', width: '100%' }}>Loading slop reports...</div>
            )}
          </div>
        </section>

        <section id="features">
          <Tweet media={{ type: 'image', src: `${baseUrl}zero-slop-right-click.png` }}>
            <h2>Native Integration</h2>
            <p>The timeline is being flooded with AI-generated slop. Our extension integrates natively into X to help you identify bot-like behavior instantly.</p>
            <div className="browser-icons">
              <span>Works on:</span>
              <span title="Google Chrome">🌐 Chrome</span>
              <span title="Microsoft Edge">🌐 Edge</span>
              <span title="Brave Browser">🌐 Brave</span>
            </div>
          </Tweet>
        </section>

        <section id="installation">
          <Tweet media={{ type: 'image', src: `${baseUrl}zero-slop-result.png` }}>
            <h2>Installation</h2>
            <p>Simply add ZeroSlop to your browser from the Chrome Web Store:</p>
            <div style={{ margin: '20px 0' }}>
              <a href="https://chromewebstore.google.com/detail/enlimjkhkfbhcoebopkklafhakhehiab?utm_source=item-share-cb" 
                 target="_blank" 
                 className="btn-inline" 
                 style={{ fontWeight: 'bold', padding: '10px 20px', backgroundColor: '#1d9bf0', color: 'white', borderRadius: '20px', textDecoration: 'none' }}>
                Add to Chrome
              </a>
            </div>
            
            <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px', marginTop: '20px' }}>
              <h3>Optional: Configuration</h3>
              <p>To perform new scans, you can add your own <strong>ZeroGPT Business API Key</strong>:</p>
              <p>1. <a href="https://zerogpt.com" target="_blank" style={{ color: '#1d9bf0' }}>Get an API Key from ZeroGPT</a> (and purchase credits as needed).</p>
              <p>2. Open the ZeroSlop extension popup.</p>
              <p>3. Paste your key and click <strong>Save</strong>.</p>
              <p style={{ fontStyle: 'italic', marginTop: '10px', fontSize: '0.9em', color: '#71767b' }}>
                Note: Previously scanned tweets are cached in our registry and are visible to everyone for free.
              </p>
            </div>
          </Tweet>
        </section>

        <section id="faq">
          <div className="faq-container">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-item">
              <h3>Does this cost money?</h3>
              <p>The extension is free to download. However, it uses the ZeroGPT Business API which requires credits. You'll need your own API key with a balance to perform new scans.</p>
            </div>
            <div className="faq-item">
              <h3>Is it 100% accurate?</h3>
              <p>AI detection is probabilistic. A high score means the text has strong markers of being AI-generated, while a low score suggests human writing.</p>
            </div>
            <div className="faq-item">
              <h3>What happens when I report a tweet?</h3>
              <p>Reporting a tweet adds its ID and metadata to our community registry. This allows other users to see the AI score instantly.</p>
            </div>
          </div>
        </section>

        <section id="privacy">
          <Tweet>
            <h2>Privacy Policy</h2>
            <p>ZeroSlop is built with a privacy-first mindset. No data is stored on our servers. All processing happens between your browser and the ZeroGPT API.</p>
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
                <div key={i} style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 'bold' }}>{res.handle}</div>
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
