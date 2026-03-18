import { useState, useEffect } from 'react';

const SLOP_TYPES = [
  { id: 'type1', name: 'Type 1: Prompt-List Hustle', emoji: '🧵', keywords: ['thread', '🧵', 'prompts', 'bookmark', 'save this', 'part 1 of', 'act as a'] },
  { id: 'type2', name: 'Type 2: Passive Income Pitch', emoji: '💰', keywords: ['passive income', 'faceless', 'blueprint', 'money machine', 'cashing in', 'referral'] },
  { id: 'type3', name: 'Type 3: Social Proof Fabrication', emoji: '🧪', keywords: ['replies in', 'days', 'portfolio gain', 'responses', 'my cousin', 'my friend', 'submitted'] },
  { id: 'type4', name: 'Type 4: Evergreen Re-publisher', emoji: '🔄', keywords: ['shocking', 'researchers', 'just released', 'alert'] },
  { id: 'type5', name: 'Type 5: Personal Transformation', emoji: '🦋', keywords: ['lost', 'kg', 'transformation', 'using ai', 'before/after'] },
];

export default function SlopScanner() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [extractionTest, setExtractionTest] = useState({
    accountability: false,
    funnel: false,
    replicability: false,
  });

  const runHeuristicAnalysis = () => {
    if (!text) return;
    setLoading(true);
    
    // Simulate a brief "thinking" period for the "Neural" feel
    setTimeout(() => {
      const lowerText = text.toLowerCase();
      let detectedType = null;
      let matchCount = 0;

      // Rule-based heuristic detection
      SLOP_TYPES.forEach(type => {
        const matches = type.keywords.filter(k => lowerText.includes(k));
        if (matches.length > matchCount) {
          matchCount = matches.length;
          detectedType = type;
        }
      });

      // Calculate a "Probabilistic" score based on matches + length
      // Industrial slop tends to be structured
      let score = Math.min(matchCount * 25, 90);
      if (text.length > 280) score += 5; // Long threads/posts are more likely slop
      
      setResult({
        score: score,
        type: detectedType,
        matches: matchCount
      });
      setLoading(false);
    }, 800);
  };

  const calculateFinalScore = () => {
    let score = result ? result.score : 0;
    if (extractionTest.accountability) score += 10;
    if (extractionTest.funnel) score += 20;
    if (extractionTest.replicability) score += 20;
    return Math.min(score, 100);
  };

  return (
    <div className="slop-scanner-container" style={{ 
      background: '#16181c', 
      border: '1px solid #2f3336', 
      borderRadius: '16px', 
      padding: '20px',
      margin: '20px 0',
      color: '#e7e9ea'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2 style={{ margin: 0 }}>🔍 Slop-Sense Analyzer</h2>
        <span style={{ fontSize: '0.7rem', background: '#1d9bf033', color: '#1d9bf0', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>HEURISTIC ENGINE V1.0</span>
      </div>
      
      <p style={{ fontSize: '0.85rem', color: '#71767b', marginBottom: '15px' }}>
        Paste a tweet below to run a local heuristic analysis based on the <strong>Taxonomy of Slop</strong>. No API key required.
      </p>

      <div style={{ marginBottom: '15px' }}>
        <textarea 
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null); // Reset result on change
          }}
          rows={4}
          placeholder="Paste the suspicious content here (e.g. 'I used AI to lose 20kg in 10 days...')"
          style={{ 
            width: '100%', 
            padding: '12px', 
            borderRadius: '8px', 
            border: '1px solid #2f3336', 
            background: '#000', 
            color: '#fff',
            resize: 'vertical',
            fontSize: '1rem',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <button 
        onClick={runHeuristicAnalysis}
        disabled={loading || !text}
        style={{ 
          width: '100%', 
          padding: '12px', 
          borderRadius: '24px', 
          border: 'none', 
          background: text ? '#1d9bf0' : '#2f3336', 
          color: '#fff', 
          fontWeight: 'bold',
          cursor: text ? 'pointer' : 'default',
          marginBottom: '20px',
          transition: 'all 0.2s'
        }}
      >
        {loading ? 'Analyzing Extraction Mechanisms...' : 'Scan for Slop Patterns'}
      </button>

      {result && (
        <div style={{ padding: '15px', background: '#1d9bf01a', borderRadius: '12px', border: '1px solid #1d9bf04d', animation: 'fadeIn 0.5s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ color: '#1d9bf0', marginBottom: '5px' }}>
                {result.score > 50 ? '⚠️ High Slop Probability' : result.score > 20 ? '🧐 Suspicious Pattern' : '✅ Likely Organic'}
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#71767b' }}>
                {result.matches > 0 
                  ? `Detected ${result.matches} industrial extraction markers.` 
                  : "No obvious industrial hooks detected, but stay vigilant."}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: result.score > 50 ? '#f4212e' : '#ffd700' }}>{result.score}%</div>
              <div style={{ fontSize: '0.6rem', color: '#71767b' }}>PATTERN SCORE</div>
            </div>
          </div>
          
          <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px', marginTop: '15px' }}>
            <h4 style={{ marginBottom: '10px', fontSize: '0.9rem' }}>Apply the Extraction Test (Manual Review)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={extractionTest.accountability} onChange={(e) => setExtractionTest({...extractionTest, accountability: e.target.checked})} />
                No named/accountable author with skin in the game?
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={extractionTest.funnel} onChange={(e) => setExtractionTest({...extractionTest, funnel: e.target.checked})} />
                Contains a funnel (CTA, "Save this", link to course)?
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={extractionTest.replicability} onChange={(e) => setExtractionTest({...extractionTest, replicability: e.target.checked})} />
                Claims are unverifiable or non-replicable?
              </label>
            </div>
          </div>

          <div style={{ marginTop: '20px', textAlign: 'center', padding: '15px', background: '#000', borderRadius: '12px', border: '1px solid #2f3336' }}>
            <div style={{ fontSize: '0.7rem', color: '#71767b', letterSpacing: '1px' }}>TOTAL SLOP PROFILE</div>
            <div style={{ fontSize: '3rem', fontWeight: 'bold', color: calculateFinalScore() > 70 ? '#f4212e' : '#ffd700', lineHeight: '1' }}>
              {calculateFinalScore()}%
            </div>
            {result.type && (
              <div style={{ marginTop: '10px', fontWeight: 'bold', color: '#1d9bf0', fontSize: '1.1rem' }}>
                {result.type.emoji} {result.type.name}
              </div>
            )}
            <div style={{ marginTop: '10px', fontSize: '0.75rem', color: '#71767b' }}>
              This score represents the content's alignment with industrial engagement farming tactics.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
