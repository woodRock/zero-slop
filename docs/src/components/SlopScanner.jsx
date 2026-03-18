import { useState } from 'react';

const SLOP_TYPES = [
  { id: 'type1', name: 'Type 1: Prompt-List Hustle', desc: "The 'N Prompts to X' hook. High audience capture, zero actual value.", emoji: '🧵' },
  { id: 'type2', name: 'Type 2: Passive Income Pitch', desc: 'Ads for courses/tools designed to sound like insider knowledge. Usually human-written but extraction-focused.', emoji: '💰' },
  { id: 'type3', name: 'Type 3: Social Proof Fabrication', desc: 'Fake testimonials or invented outcomes ("My cousin got 11 replies...").', emoji: '🧪' },
  { id: 'type4', name: 'Type 4: Evergreen Re-publisher', desc: 'Bots or multi-account operations recycling news or alarm-word hooks.', emoji: '🔄' },
  { id: 'type5', name: 'Type 5: Personal Transformation', desc: 'Vague transformation stories used as funnels for lifestyle products.', emoji: '🦋' },
];

export default function SlopScanner() {
  const [text, setText] = useState('');
  const [apiKey, setApiKey] = useState(localStorage.getItem('zerogpt_api_key') || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [extractionTest, setExtractionTest] = useState({
    accountability: false,
    funnel: false,
    replicability: false,
  });
  const [selectedType, setSelectedType] = useState('');

  const handleScan = async () => {
    if (!text) return alert('Please enter some text to scan.');
    if (!apiKey) return alert('Please enter a ZeroGPT API Key.');

    setLoading(true);
    localStorage.setItem('zerogpt_api_key', apiKey);

    try {
      const response = await fetch("https://api.zerogpt.com/api/detect/detectText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ApiKey": apiKey },
        body: JSON.stringify({ input_text: text })
      });

      const data = await response.json();
      if (data.success) {
        setResult(data.data);
      } else {
        alert('API Error: ' + (data.message || 'Unknown error'));
      }
    } catch (e) {
      alert('Network error. Ensure your API key is valid and CORS allows the request.');
    } finally {
      setLoading(false);
    }
  };

  const calculateSlopScore = () => {
    let score = result ? result.fakePercentage : 0;
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
      <h2 style={{ marginBottom: '15px' }}>🔍 Interactive Slop Scanner</h2>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#71767b', marginBottom: '5px' }}>ZeroGPT Business API Key:</label>
        <input 
          type="password" 
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your API key here..."
          style={{ 
            width: '100%', 
            padding: '10px', 
            borderRadius: '8px', 
            border: '1px solid #2f3336', 
            background: '#000', 
            color: '#fff' 
          }}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#71767b', marginBottom: '5px' }}>Tweet Text to Analyze:</label>
        <textarea 
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Paste the suspicious content here..."
          style={{ 
            width: '100%', 
            padding: '10px', 
            borderRadius: '8px', 
            border: '1px solid #2f3336', 
            background: '#000', 
            color: '#fff',
            resize: 'vertical'
          }}
        />
      </div>

      <button 
        onClick={handleScan}
        disabled={loading}
        style={{ 
          width: '100%', 
          padding: '12px', 
          borderRadius: '24px', 
          border: 'none', 
          background: '#1d9bf0', 
          color: '#fff', 
          fontWeight: 'bold',
          cursor: 'pointer',
          marginBottom: '20px'
        }}
      >
        {loading ? 'Analyzing Neural Curvature...' : 'Run Neural Analysis'}
      </button>

      {result && (
        <div style={{ padding: '15px', background: '#1d9bf01a', borderRadius: '12px', border: '1px solid #1d9bf04d' }}>
          <h3 style={{ color: '#1d9bf0', marginBottom: '10px' }}>Result: {result.fakePercentage}% AI-Generated</h3>
          <p style={{ fontSize: '0.9rem', marginBottom: '15px' }}>{result.feedback_message}</p>
          
          <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px' }}>
            <h4 style={{ marginBottom: '10px', fontSize: '0.9rem' }}>Apply Extraction Test (Optional)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={extractionTest.accountability} onChange={(e) => setExtractionTest({...extractionTest, accountability: e.target.checked})} />
                No named/accountable author with skin in the game? (+10% Slop)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={extractionTest.funnel} onChange={(e) => setExtractionTest({...extractionTest, funnel: e.target.checked})} />
                Contains a funnel (CTA, "Save this", link to course)? (+20% Slop)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={extractionTest.replicability} onChange={(e) => setExtractionTest({...extractionTest, replicability: e.target.checked})} />
                Claims are unverifiable or non-replicable? (+20% Slop)
              </label>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #2f3336', paddingTop: '15px', marginTop: '15px' }}>
            <h4 style={{ marginBottom: '10px', fontSize: '0.9rem' }}>Categorize Slop Type (Optional)</h4>
            <select 
              value={selectedType} 
              onChange={(e) => setSelectedType(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '8px', background: '#000', color: '#fff', border: '1px solid #2f3336' }}
            >
              <option value="">Uncategorized Slop</option>
              {SLOP_TYPES.map(type => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: '20px', textAlign: 'center', padding: '15px', background: '#000', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.8rem', color: '#71767b' }}>FINAL SLOP SCORE</div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: calculateSlopScore() > 70 ? '#f4212e' : '#ffd700' }}>
              {calculateSlopScore()}%
            </div>
            {selectedType && (
              <div style={{ marginTop: '5px', fontWeight: 'bold', color: '#1d9bf0' }}>
                {SLOP_TYPES.find(t => t.id === selectedType).emoji} {SLOP_TYPES.find(t => t.id === selectedType).name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
