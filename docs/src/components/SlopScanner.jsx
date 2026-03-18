import { useState, useEffect } from 'react';

const SLOP_RULES = [
  { id: 'hook_thread', name: 'Thread Hook Pattern', weight: 30, regex: /(thread|🧵|1\/\d+|read on|below)/gi, desc: "Classic 'audience-capture' thread structure." },
  { id: 'hook_urgency', name: 'Manufactured Urgency', weight: 25, regex: /(bookmark|save this|don't miss|stop scrolling|limited time|act now|hurry)/gi, desc: "Uses FOMO to drive bookmarks/engagement." },
  { id: 'hook_hustle', name: 'Hustle/Passive Income', weight: 35, regex: /(passive income|faceless|money machine|cashing in|blueprint|side hustle|0 to \$|financial freedom)/gi, desc: "Common 'get rich' extraction funnel." },
  { id: 'hook_ai_hype', name: 'AI Over-Hype', weight: 20, regex: /(game changer|changing everything|ai will|prompt engineering|chatgpt prompts|upload to)/gi, desc: "Generic AI hype used to sell low-value lists." },
  { id: 'hook_social_proof', name: 'Fabricated Proof', weight: 30, regex: /(my cousin|my friend|replies in \d+|days|results are|proof|verified)/gi, desc: "Anecdotal evidence designed to bypass skepticism." },
  { id: 'hook_clickbait', name: 'Clickbait Alarmism', weight: 25, regex: /(shocking|insane|unbelievable|nobody is talking|secrets|revealed|hidden)/gi, desc: "Uses alarmist language to trigger clicks." },
];

export default function SlopScanner() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState([]);
  const [extractionTest, setExtractionTest] = useState({
    accountability: false,
    funnel: false,
    replicability: false,
  });

  const runAdvancedAnalysis = () => {
    if (!text) return;
    setLoading(true);
    
    setTimeout(() => {
      const detected = [];
      let totalWeight = 0;

      // 1. Rule-based Regex Matching
      SLOP_RULES.forEach(rule => {
        const matches = text.match(rule.regex);
        if (matches) {
          detected.push({ ...rule, count: matches.length });
          totalWeight += rule.weight;
        }
      });

      // 2. Emoji Density Check
      const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
      const emojis = text.match(emojiRegex) || [];
      if (emojis.length > 5) {
        detected.push({ 
          id: 'emoji_density', 
          name: 'High Emoji Density', 
          weight: 15, 
          desc: `Detected ${emojis.length} emojis. High visual stimulation is a slop hallmark.` 
        });
        totalWeight += 15;
      }

      // 3. Structural Vibe Check
      if (text.length > 500 && !text.includes('\n\n')) {
        detected.push({ 
          id: 'block_text', 
          name: 'Wall of Text', 
          weight: 10, 
          desc: "Industrial content is usually broken into airy chunks; a solid block is unusual but can be suspicious if paired with hooks." 
        });
        totalWeight += 10;
      }

      setDiagnostics({
        score: Math.min(totalWeight, 95),
        findings: detected
      });
      setLoading(false);
    }, 1000);
  };

  const calculateFinalScore = () => {
    let score = diagnostics.score || 0;
    if (extractionTest.accountability) score += 10;
    if (extractionTest.funnel) score += 20;
    if (extractionTest.replicability) score += 20;
    return Math.min(score, 100);
  };

  return (
    <div className="slop-scanner-v2" style={{ 
      background: '#16181c', 
      border: '1px solid #2f3336', 
      borderRadius: '20px', 
      padding: '24px',
      margin: '20px 0',
      color: '#e7e9ea',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem' }}>🛡️ Slop-Sense Engine V2.0</h2>
          <div style={{ fontSize: '0.75rem', color: '#71767b', marginTop: '4px' }}>Pro-active Industrial Pattern Recognition</div>
        </div>
        <div style={{ background: '#1d9bf0', color: '#fff', padding: '4px 10px', borderRadius: '99px', fontSize: '0.7rem', fontWeight: 'bold' }}>LIVE</div>
      </div>

      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <textarea 
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDiagnostics([]);
          }}
          rows={5}
          placeholder="Paste suspect tweet or thread content..."
          style={{ 
            width: '100%', 
            padding: '16px', 
            borderRadius: '12px', 
            border: '2px solid #2f3336', 
            background: '#000', 
            color: '#fff',
            resize: 'vertical',
            fontSize: '1.1rem',
            boxSizing: 'border-box',
            outline: 'none',
            transition: 'border-color 0.2s'
          }}
          onFocus={(e) => e.target.style.borderColor = '#1d9bf0'}
          onBlur={(e) => e.target.style.borderColor = '#2f3336'}
        />
      </div>

      <button 
        onClick={runAdvancedAnalysis}
        disabled={loading || !text}
        style={{ 
          width: '100%', 
          padding: '14px', 
          borderRadius: '30px', 
          border: 'none', 
          background: text ? '#1d9bf0' : '#2f3336', 
          color: '#fff', 
          fontWeight: '900',
          fontSize: '1rem',
          cursor: text ? 'pointer' : 'default',
          marginBottom: '20px',
          boxShadow: text ? '0 4px 14px rgba(29, 155, 240, 0.4)' : 'none'
        }}
      >
        {loading ? '🔍 DE-CONSTRUCTING EXTRACTION MECHANISMS...' : '⚡ ANALYZE SLOP PROFILE'}
      </button>

      {diagnostics.findings && diagnostics.findings.length > 0 && (
        <div style={{ animation: 'fadeIn 0.4s' }}>
          <div style={{ background: '#000', borderRadius: '16px', padding: '20px', border: '1px solid #2f3336', marginBottom: '20px' }}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '0.7rem', color: '#71767b', letterSpacing: '2px', fontWeight: 'bold' }}>PATTERN MATCH PROBABILITY</div>
              <div style={{ fontSize: '4rem', fontWeight: '900', color: diagnostics.score > 60 ? '#f4212e' : '#ffd700', lineHeight: '1' }}>
                {diagnostics.score}%
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#71767b', marginBottom: '10px', textTransform: 'uppercase' }}>Diagnostic Findings:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {diagnostics.findings.map(finding => (
                <div key={finding.id} style={{ display: 'flex', gap: '10px', padding: '10px', background: '#16181c', borderRadius: '8px', borderLeft: '4px solid #f4212e' }}>
                  <div style={{ fontSize: '1.2rem' }}>🚩</div>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{finding.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#71767b' }}>{finding.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '20px', background: '#1d9bf011', borderRadius: '16px', border: '1px solid #1d9bf033' }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#1d9bf0' }}>Verify with the Extraction Test</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" style={{ transform: 'scale(1.2)' }} checked={extractionTest.accountability} onChange={(e) => setExtractionTest({...extractionTest, accountability: e.target.checked})} />
                No named/accountable author with "skin in the game"?
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" style={{ transform: 'scale(1.2)' }} checked={extractionTest.funnel} onChange={(e) => setExtractionTest({...extractionTest, funnel: e.target.checked})} />
                Content acts as bait for a funnel (CTA, link, "Save this")?
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" style={{ transform: 'scale(1.2)' }} checked={extractionTest.replicability} onChange={(e) => setExtractionTest({...extractionTest, replicability: e.target.checked})} />
                Claims are unverifiable or instructions are non-functional?
              </label>
            </div>
          </div>

          <div style={{ marginTop: '20px', textAlign: 'center', padding: '24px', background: '#000', borderRadius: '20px', border: '2px solid #2f3336' }}>
            <div style={{ fontSize: '0.8rem', color: '#71767b', letterSpacing: '1px', fontWeight: 'bold' }}>FINAL SLOP PROFILE</div>
            <div style={{ fontSize: '5rem', fontWeight: '900', color: calculateFinalScore() > 75 ? '#f4212e' : '#ffd700', lineHeight: '1', margin: '10px 0' }}>
              {calculateFinalScore()}%
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: calculateFinalScore() > 75 ? '#f4212e' : '#ffd700' }}>
              {calculateFinalScore() > 75 ? 'INDUSTRIAL SLOP DETECTED' : calculateFinalScore() > 40 ? 'SUSPICIOUS EXTRACTION PROFILE' : 'LOW SLOP INDICATORS'}
            </div>
          </div>
        </div>
      )}

      {diagnostics.findings && diagnostics.findings.length === 0 && !loading && text && (
        <div style={{ marginTop: '20px', padding: '20px', background: '#00ba7c1a', borderRadius: '12px', border: '1px solid #00ba7c33', textAlign: 'center', animation: 'fadeIn 0.4s' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>✅</div>
          <div style={{ fontWeight: 'bold', color: '#00ba7c' }}>Clean Profile</div>
          <div style={{ fontSize: '0.85rem', color: '#71767b' }}>No obvious industrial extraction markers found. Proceed with normal human caution.</div>
        </div>
      )}
    </div>
  );
}
