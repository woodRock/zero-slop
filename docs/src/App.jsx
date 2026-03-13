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

  useEffect(() => {
    // 1. Fetch Total Stats
    // Note: Firestore REST doesn't have a simple 'count' endpoint without complex queries
    // So we fetch the recent list and estimate or use a dedicated stats doc if you had one.
    // For now, let's fetch the actual documents to get real data.
    const fetchRegistryData = async () => {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry?key=${FIREBASE_CONFIG.apiKey}&pageSize=100`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const documents = data.documents || [];
          
          // Update Stats
          setStats({
            count: documents.length.toLocaleString(),
            accounts: new Set(documents.map(d => d.fields.author_handle?.stringValue)).size.toLocaleString()
          });

          // Update Wall of Shame (Latest 3)
          const recent = documents
            .sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime))
            .slice(0, 3)
            .map(doc => ({
              name: doc.fields.author_name?.stringValue || "Unknown",
              handle: doc.fields.author_handle?.stringValue || "@anonymous",
              score: Math.round(doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0),
              pfp: doc.fields.author_pfp?.stringValue || "🤖"
            }));
          setWallOfShame(recent);
        }
      } catch (e) {
        console.error("ZeroSlop: Failed to fetch live stats", e);
      }
    };

    fetchRegistryData();
  }, []);

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
          <Tweet media={{ type: 'image', src: `${baseUrl}installation-guide.jpeg` }}>
            <h2>Installation Guide</h2>
            <p>Choose your preferred way to install ZeroSlop:</p>
            <div style={{ marginBottom: '20px' }}>
              <h3>Option 1: Direct Download (Easiest)</h3>
              <p>1. <a href="https://github.com/woodrock/zero-slop/raw/main/zero-slop-extension.zip" className="btn-inline" style={{ fontWeight: 'bold' }}>Download zero-slop-extension.zip</a></p>
              <p>2. Extract the ZIP file to a folder on your computer.</p>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <h3>Option 2: Developers (Git)</h3>
              <p>1. Clone: <code>git clone https://github.com/woodrock/zero-slop.git</code></p>
            </div>
            <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px' }}>
              <h3>Final Steps</h3>
              <p>1. Open <code>chrome://extensions/</code></p>
              <p>2. Enable <strong>Developer mode</strong></p>
              <p>3. Click <strong>Load unpacked</strong> and select the <code>zero-slop</code> folder.</p>
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
        <div className="search-bar">Search ZeroSlop Docs</div>
        
        <div className="slop-counter-box">
          <div className="counter-label">TOTAL SLOP DETECTED</div>
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
            <div className="trending-category">Donations</div>
            <div className="trending-name">Solana Address</div>
            <div className="trending-count" style={{ wordBreak: 'break-all', fontSize: '0.75rem', marginBottom: '8px' }}>CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump</div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText('CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump');
                alert('Address copied to clipboard!');
              }}
              style={{
                background: 'var(--twitter-blue)', color: 'white', border: 'none', borderRadius: '9999px',
                padding: '4px 12px', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer'
              }}
            >
              Copy Address
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App
