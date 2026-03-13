import './App.css'

function App() {
  const year = new Date().getFullYear();
  const baseUrl = import.meta.env.BASE_URL;

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
                <video 
                  src={media.src} 
                  controls 
                  autoPlay 
                  muted 
                  loop 
                  playsInline 
                  preload="auto"
                  style={{ width: '100%', display: 'block' }}
                >
                  Your browser does not support the video tag.
                </video>
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
          <a href="#installation" className="nav-item"><span className="nav-text">Install</span></a>
          <a href="#setup" className="nav-item"><span className="nav-text">Setup</span></a>
          <a href="#privacy" className="nav-item"><span className="nav-text">Privacy</span></a>
        </nav>
        <a href="#installation" className="post-btn">Install Now</a>
      </aside>

      {/* Main Timeline */}
      <main className="main-content">
        <header className="sticky-header">
          <h2>Home</h2>
        </header>

        <Tweet 
          media={{ type: 'image', src: `${baseUrl}banner.jpg` }}
        >
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

        <Tweet 
          media={{ type: 'video', src: `${baseUrl}zero-slop-usage-video.mov` }}
        >
          <p>Check out ZeroSlop in action! Seamlessly integrated into your X timeline. 👇</p>
        </Tweet>

        <section id="features">
          <Tweet
            media={{ type: 'image', src: `${baseUrl}zero-slop-right-click.png` }}
          >
            <h2>Why ZeroSlop?</h2>
            <p>The timeline is being flooded with AI-generated slop. Our extension integrates natively into X to help you identify bot-like behavior instantly.</p>
            <ul>
              <li>Native-feeling Twitter UI</li>
              <li>Real-time scanning</li>
              <li>Customizable Auto-Scan</li>
            </ul>
          </Tweet>
        </section>

        <section id="installation">
          <Tweet>
            <h2>Developer Installation</h2>
            <p>1. Clone: <code>git clone https://github.com/woodj/zero-slop.git</code></p>
            <p>2. Open <code>chrome://extensions/</code></p>
            <p>3. Enable <strong>Developer mode</strong></p>
            <p>4. <strong>Load unpacked</strong> and select the <code>zero-slop</code> folder.</p>
          </Tweet>
        </section>

        <section id="setup">
          <Tweet
            media={{ type: 'image', src: `${baseUrl}zero-slop-analyzing.png` }}
          >
            <h2>Initial Setup</h2>
            <p>Get your API Key from <a href="https://www.zerogpt.com/dashboard" target="_blank" className="btn-inline">ZeroGPT Dashboard</a>.</p>
            <p>Add credits, paste the key into the extension popup, and you're ready to go!</p>
          </Tweet>
        </section>

        <section id="usage">
          <Tweet
            media={{ type: 'image', src: `${baseUrl}zero-slop-result.png` }}
          >
            <h2>How to Use</h2>
            <p>Right-click any tweet and select <strong>Check with ZeroGPT</strong>. Our AI agent will scan the text and give you a probability score in the corner of your screen.</p>
          </Tweet>
        </section>

        <section id="privacy">
          <Tweet>
            <h2>Privacy Policy</h2>
            <p>ZeroSlop is built with a privacy-first mindset. No data is stored on our servers. All processing happens between your browser and the ZeroGPT API.</p>
            <a href="https://github.com/woodj/zero-slop/blob/main/PRIVACY.md" target="_blank" className="btn-inline">Read full policy →</a>
          </Tweet>
        </section>

        <footer style={{ padding: '40px', textAlign: 'center', color: '#71767b', borderTop: '1px solid #2f3336' }}>
          <p>&copy; {year} ZeroSlop. Built for a cleaner timeline.</p>
        </footer>
      </main>

      {/* Right Sidebar */}
      <aside className="sidebar-right">
        <div className="search-bar">Search ZeroSlop Docs</div>
        
        <div className="trending-box">
          <div className="trending-title">Project Stats</div>
          <div className="trending-item">
            <div className="trending-category">Trending in Tech</div>
            <div className="trending-name">#ZeroSlop</div>
            <div className="trending-count">1.2k Scans today</div>
          </div>
          <div className="trending-item">
            <div className="trending-category">API Status</div>
            <div className="trending-name">ZeroGPT Online</div>
            <div className="trending-count">Latency: 240ms</div>
          </div>
        </div>

        <div className="trending-box">
          <div className="trending-title">Support</div>
          <div className="trending-item">
            <div className="trending-category">Donations</div>
            <div className="trending-name">Crypto Address</div>
            <div className="trending-count" style={{ wordBreak: 'break-all' }}>GY4453u...4qu5D3pump</div>
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App
