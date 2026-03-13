import './App.css'

function App() {
  return (
    <div className="app">
      <header className="hero">
        <div className="container">
          <h1>ZeroSlop</h1>
          <p>Instantly detect AI-generated tweets on Twitter (X) using the ZeroGPT Business API.</p>
          <a href="#installation" className="btn">Get Started</a>
        </div>
      </header>

      <main className="container">
        <section id="features">
          <h2>Why ZeroSlop?</h2>
          <div className="features-grid">
            <div className="feature-card">
              <h3>High Accuracy</h3>
              <p>Uses the official ZeroGPT Business API for enterprise-grade detection.</p>
            </div>
            <div className="feature-card">
              <h3>Seamless Integration</h3>
              <p>Native-feeling Twitter-style results directly in your feed.</p>
            </div>
            <div className="feature-card">
              <h3>Privacy First</h3>
              <p>Your API key is stored locally in your browser, never on our servers.</p>
            </div>
          </div>
        </section>

        <section id="installation">
          <h2>Developer Installation</h2>
          <p>Since ZeroSlop is a developer tool, you can install it manually in just a few steps.</p>
          
          <div className="step">
            <h3><span className="step-number">1</span> Clone the Repository</h3>
            <p>Open your terminal and run:</p>
            <pre><code>git clone https://github.com/woodj/zero-slop.git</code></pre>
          </div>

          <div className="step">
            <h3><span className="step-number">2</span> Open Extensions Page</h3>
            <p>In Google Chrome, navigate to <code>chrome://extensions/</code> by typing it in the address bar.</p>
          </div>

          <div className="step">
            <h3><span className="step-number">3</span> Enable Developer Mode</h3>
            <p>Toggle the <strong>Developer mode</strong> switch in the top right corner of the page.</p>
          </div>

          <div className="step">
            <h3><span className="step-number">4</span> Load Unpacked</h3>
            <p>Click the <strong>Load unpacked</strong> button and select the <code>zero-slop</code> folder you just cloned.</p>
          </div>
        </section>

        <section id="setup">
          <h2>Initial Setup</h2>
          <div className="step">
            <h3><span className="step-number">1</span> Get an API Key</h3>
            <p>Create an account at <a href="https://www.zerogpt.com/login" target="_blank" rel="noopener noreferrer">ZeroGPT.com</a> and navigate to your <a href="https://www.zerogpt.com/dashboard" target="_blank" rel="noopener noreferrer">Dashboard</a> to generate your unique API Key.</p>
          </div>
          <div className="step">
            <h3><span className="step-number">2</span> Add Credits</h3>
            <p>The ZeroGPT Business API is a paid service. Ensure you have a balance or a subscription in your ZeroGPT account.</p>
          </div>
          <div className="step">
            <h3><span className="step-number">3</span> Configure Extension</h3>
            <p>Click the ZeroSlop icon in your Chrome toolbar, paste your API Key, and click <strong>Save</strong>.</p>
          </div>
        </section>

        <section id="usage">
          <h2>How to Use</h2>
          <p>Simply navigate to <a href="https://twitter.com" target="_blank" rel="noopener noreferrer">Twitter (X)</a> and use the context menu:</p>
          <ul>
            <li><strong>Option 1:</strong> Highlight text in a tweet, right-click, and select <strong>Check with ZeroGPT</strong>.</li>
            <li><strong>Option 2:</strong> Right-click anywhere on a tweet to automatically extract and check its content.</li>
          </ul>
          <p>A result overlay will appear in the top-right corner of the page showing the AI detection percentage.</p>
        </section>

        <section id="updating">
          <h2>Updating the Extension</h2>
          <p>To get the latest features and fixes, follow these steps:</p>
          <div className="step">
            <h3><span className="step-number">1</span> Pull Latest Changes</h3>
            <p>In your cloned <code>zero-slop</code> folder, run:</p>
            <pre><code>git pull origin main</code></pre>
          </div>
          <div className="step">
            <h3><span className="step-number">2</span> Reload in Chrome</h3>
            <p>Go back to <code>chrome://extensions/</code> and click the <strong>Refresh</strong> icon on the ZeroSlop card.</p>
          </div>
        </section>

        <section id="support">
          <h2>Support the Project</h2>
          <p>If you find ZeroSlop useful, you can support its development at this address:</p>
          <pre><code>GY4453uGkG6QKbSU7YtduxhRqD4CETBaWr4qu5D3pump</code></pre>
        </section>

        <section id="privacy">
          <h2>Privacy Policy</h2>
          <p>ZeroSlop is built with a privacy-first mindset. We do not collect or store any of your personal data on our servers.</p>
          <ul>
            <li><strong>Local Storage:</strong> Your API key and settings are stored only in your browser.</li>
            <li><strong>Encrypted Transit:</strong> Tweet text is sent securely to the ZeroGPT API via HTTPS for analysis.</li>
            <li><strong>No Tracking:</strong> We do not use any cookies or tracking scripts.</li>
          </ul>
          <p>For more details, view our <a href="https://github.com/woodj/zero-slop/blob/main/PRIVACY.md" target="_blank" rel="noopener noreferrer">full Privacy Policy on GitHub</a>.</p>
        </section>
      </main>

      <footer>
        <div className="container">
          <p>&copy; {new Date().getFullYear()} ZeroSlop. All rights reserved. | <a href="#privacy">Privacy Policy</a></p>
        </div>
      </footer>
    </div>
  )
}

export default App
