import { useState } from 'react';

export default function FeedAuditor({ database = [] }) {
  const [input, setInput] = useState('');
  const [results, setResult] = useState(null);

  const runAudit = () => {
    // Extract handles (support with or without @, separated by spaces, commas or newlines)
    const handles = input.split(/[\s,]+/)
      .map(h => h.trim().toLowerCase().replace('@', ''))
      .filter(h => h.length > 0);

    if (handles.length === 0) return;

    const redShields = [];
    const blueShields = [];

    handles.forEach(handle => {
      const match = database.find(acc => 
        (acc.fields.handle?.stringValue || "").toLowerCase().replace('@', '') === handle
      );

      if (match) {
        const type = match.fields.shield_type?.stringValue || 'red';
        const report = {
          handle: match.fields.handle?.stringValue,
          name: match.fields.name?.stringValue || "Unknown",
          type: type
        };
        if (type === 'red') redShields.push(report);
        else if (type === 'blue') blueShields.push(report);
      }
    });

    setResult({
      totalChecked: handles.length,
      redCount: redShields.length,
      blueCount: blueShields.length,
      redList: redShields,
      blueList: blueShields,
      slopScore: Math.round(((redShields.length + (blueShields.length * 0.5)) / handles.length) * 100)
    });
  };

  return (
    <div className="feed-auditor" style={{ 
      background: '#16181c', 
      border: '1px solid #2f3336', 
      borderRadius: '20px', 
      padding: '24px',
      margin: '20px 0',
      color: '#e7e9ea'
    }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>🕵️ Bounty Hunter Feed Auditor</h2>
        <p style={{ fontSize: '0.85rem', color: '#71767b', marginTop: '4px' }}>
          Paste a list of handles to check them against the ZeroSlop Registry.
        </p>
      </div>

      <textarea 
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={5}
        placeholder="Paste handles here (e.g. @jason_coder0, @heynavtoor, elonmusk...)"
        style={{ 
          width: '100%', 
          padding: '16px', 
          borderRadius: '12px', 
          border: '2px solid #2f3336', 
          background: '#000', 
          color: '#fff',
          fontSize: '1rem',
          boxSizing: 'border-box',
          marginBottom: '15px',
          outline: 'none'
        }}
      />

      <button 
        onClick={runAudit}
        disabled={!input}
        style={{ 
          width: '100%', 
          padding: '12px', 
          borderRadius: '30px', 
          border: 'none', 
          background: input ? '#1d9bf0' : '#2f3336', 
          color: '#fff', 
          fontWeight: 'bold',
          cursor: input ? 'pointer' : 'default',
          marginBottom: '20px'
        }}
      >
        Run Network Audit
      </button>

      {results && (
        <div style={{ animation: 'fadeIn 0.4s' }}>
          <div style={{ background: '#000', borderRadius: '16px', padding: '20px', border: '1px solid #2f3336', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', color: '#71767b', letterSpacing: '1px', fontWeight: 'bold' }}>NETWORK SLOP PROFILE</div>
            <div style={{ fontSize: '3.5rem', fontWeight: '900', color: results.slopScore > 20 ? '#f4212e' : '#00ba7c', margin: '5px 0' }}>
              {results.slopScore}%
            </div>
            <div style={{ fontSize: '0.9rem', color: '#71767b' }}>
              Checked {results.totalChecked} accounts. Found {results.redCount + results.blueCount} matches.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' }}>
            <div style={{ background: '#f4212e1a', padding: '15px', borderRadius: '12px', border: '1px solid #f4212e4d' }}>
              <div style={{ fontWeight: 'bold', color: '#f4212e', marginBottom: '10px', fontSize: '0.8rem' }}>🚩 FACTORIES ({results.redCount})</div>
              {results.redList.map((acc, i) => (
                <div key={i} style={{ fontSize: '0.8rem', marginBottom: '4px' }}>{acc.handle}</div>
              ))}
              {results.redCount === 0 && <div style={{ fontSize: '0.75rem', color: '#71767b' }}>None found.</div>}
            </div>
            <div style={{ background: '#1d9bf01a', padding: '15px', borderRadius: '12px', border: '1px solid #1d9bf04d' }}>
              <div style={{ fontWeight: 'bold', color: '#1d9bf0', marginBottom: '10px', fontSize: '0.8rem' }}>🔵 HIGH AI ({results.blueCount})</div>
              {results.blueList.map((acc, i) => (
                <div key={i} style={{ fontSize: '0.8rem', marginBottom: '4px' }}>{acc.handle}</div>
              ))}
              {results.blueCount === 0 && <div style={{ fontSize: '0.75rem', color: '#71767b' }}>None found.</div>}
            </div>
          </div>

          <div style={{ marginTop: '20px', padding: '15px', background: '#16181c', borderRadius: '12px', border: '1px solid #2f3336', fontSize: '0.8rem', textAlign: 'center', color: '#71767b' }}>
            <strong>Recommendation:</strong> {results.slopScore > 20 ? "Your network has a high concentration of industrial slop. Consider pruning these accounts to restore a human timeline." : "Your network is relatively healthy and human-centric."}
          </div>
        </div>
      )}
    </div>
  );
}
