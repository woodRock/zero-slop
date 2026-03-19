import React from 'react';

const PHASES = [
  {
    id: 1,
    title: "Phase 1: The Input (Bait)",
    icon: "🎣",
    color: "#1d9bf0",
    text: "The Fantasy Pipeline. Inputs like 'Job-Replacement Myths' and 'Passive Income Lies' are designed to trigger financial anxiety and FOMO.",
    markers: ["$120k sales rep for free", "48 websites to make $200/hr", "Faceless YouTube blueprints"]
  },
  {
    id: 2,
    title: "Phase 2: Extraction (Harvesting)",
    icon: "🚜",
    color: "#ffd700",
    text: "Coordinated Network amplification. The factory forces you to behave like a bot—Like, Comment, Save—to juice the algorithm and harvest your lead data.",
    markers: ["Comment 'NEED' to get link", "Like & Retweet for giveaway", "Save/Bookmark this thread"]
  },
  {
    id: 3,
    title: "Phase 3: Monetization (Promo Racket)",
    icon: "💰",
    color: "#f4212e",
    text: "Reach is Currency. The factory pitches its manufactured 'millions of impressions' to low-quality AI wrappers and Masterclasses for promotion contracts.",
    markers: ["Paid promotion for AI apps", "SaaS referral loops", "Synthetic reach summaries"]
  },
  {
    id: 4,
    title: "Phase 4: The Perpetual Loop",
    icon: "🔄",
    color: "#7856ff",
    text: "Identity Arbitrage. Using social proof from Phase 3 to build 'Guru' authority and launch the final payload: the $2,997 Course Upsell.",
    markers: ["$2,997 Agentic Mastermind", "High-ticket coaching upsells", "The 'Authenticity' mirage"]
  }
];

export default function SlopCycle() {
  return (
    <div className="slop-cycle" style={{ color: '#e7e9ea', padding: '20px', background: '#000', borderRadius: '20px', border: '1px solid #2f3336' }}>
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.6rem', color: '#fff', marginBottom: '10px' }}>🏭 Inside the Slop Factory</h2>
        <p style={{ color: '#71767b', fontSize: '0.9rem' }}>The 2026 Industrial Extraction Cycle: From Bait to Monetization.</p>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Conveyor Belt Line */}
        <div style={{ position: 'absolute', left: '20px', top: '0', bottom: '0', width: '2px', background: 'linear-gradient(180deg, #1d9bf0 0%, #ffd700 33%, #f4212e 66%, #7856ff 100%)', opacity: '0.3' }}></div>

        {PHASES.map((phase, i) => (
          <div key={phase.id} style={{ marginBottom: '40px', position: 'relative', paddingLeft: '50px' }}>
            <div style={{ 
              position: 'absolute', 
              left: '0', 
              top: '0', 
              width: '40px', 
              height: '40px', 
              background: '#16181c', 
              borderRadius: '50%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              fontSize: '1.2rem',
              border: `2px solid ${phase.color}`,
              zIndex: '2'
            }}>
              {phase.icon}
            </div>
            
            <div style={{ background: '#16181c', padding: '15px', borderRadius: '12px', border: '1px solid #2f3336' }}>
              <h3 style={{ color: phase.color, margin: '0 0 10px 0', fontSize: '1.1rem' }}>{phase.title}</h3>
              <p style={{ fontSize: '0.9rem', lineHeight: '1.5', marginBottom: '12px' }}>{phase.text}</p>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {phase.markers.map((marker, m) => (
                  <span key={m} style={{ fontSize: '0.7rem', padding: '4px 8px', background: '#000', color: '#71767b', borderRadius: '4px', border: '1px solid #2f3336' }}>
                    • {marker}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '20px', padding: '15px', background: '#f4212e1a', borderRadius: '12px', border: '1px solid #f4212e4d', textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#f4212e' }}>🚩 DIAGNOSTIC: THE BLUEPRINT IS A FUNNEL</div>
        <p style={{ fontSize: '0.8rem', color: '#71767b', marginTop: '5px' }}>
          When you see a post demanding a "Like and Comment," you are seeing a vat of human trust being emptied into the machine.
        </p>
      </div>
    </div>
  );
}
