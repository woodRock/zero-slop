import React from 'react';

const TAXONOMY = [
  {
    type: "Type 1",
    title: "Prompt-list hustle",
    emoji: "🧵",
    desc: "The 'N [tool] prompts to [do expensive thing] for free' template. The post itself is the advertisement. The 'value' is always just below the fold.",
    extraction: "Audience-capture-to-funnel. Sells followership for newsletter signups or course sales.",
    marker: "AI Score: 0-40% (Often human-written templates)."
  },
  {
    type: "Type 2",
    title: "Passive income pitches",
    emoji: "💰",
    desc: "'Faceless creators are cashing in' or 'Kids animation = silent money machine.' Written in a register designed to sound like insider knowledge.",
    extraction: "Pure funnel. Bait for a course blueprint or tool referral link.",
    marker: "AI Score: consistently 0% (Refined by human marketers)."
  },
  {
    type: "Type 3",
    title: "Social proof fabrication",
    emoji: "🧪",
    desc: "Testimonial-format ads for AI tools where the testimonials are invented. Uses specific, unverifiable numbers (e.g., '11 replies in 9 days').",
    extraction: "False outcome promise. Designed to be credible-sounding but fabricated.",
    marker: "AI Score: High (~67%) as AI generates the fake story."
  },
  {
    type: "Type 4",
    title: "Evergreen re-publishers",
    emoji: "🔄",
    desc: "Scheduler bots or multi-account operations posting the same alarm-word hooks or lightly paraphrased news items.",
    extraction: "Attention laundering. Strips nuance from real info to maximize reach.",
    marker: "Duplicate content detected across multiple accounts."
  },
  {
    type: "Type 5",
    title: "Personal transformation",
    emoji: "🦋",
    desc: "The transformation story (lifestyle, health, or wealth) applied to a product or course funnel. Vague method, high emotion.",
    extraction: "Product funnel. The story exists solely to sell the 'how-to'.",
    marker: "AI Score: ~50% (Drafted by AI, lightly edited)."
  }
];

export default function FieldGuide() {
  return (
    <div className="field-guide" style={{ color: '#e7e9ea' }}>
      <div style={{ padding: '20px', borderBottom: '1px solid #2f3336' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>📘 The Taxonomy of Slop</h2>
        <p style={{ color: '#71767b', fontSize: '0.95rem' }}>
          Slop isn't just AI-generated content. It is content produced industrially, without genuine intent, designed for audience extraction.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1px', background: '#2f3336' }}>
        {TAXONOMY.map((item, i) => (
          <div key={i} style={{ background: '#16181c', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '15px' }}>
              <div style={{ fontSize: '2rem' }}>{item.emoji}</div>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#1d9bf0', fontWeight: 'bold' }}>{item.type}</div>
                <h3 style={{ fontSize: '1.1rem', margin: '4px 0' }}>{item.title}</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '10px' }}>{item.desc}</p>
                <div style={{ fontSize: '0.85rem', padding: '10px', background: '#000', borderRadius: '8px', border: '1px solid #2f3336' }}>
                  <div style={{ marginBottom: '5px' }}><strong>Extraction:</strong> {item.extraction}</div>
                  <div style={{ color: '#f4212e' }}><strong>Diagnostic:</strong> {item.marker}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '20px', background: '#1d9bf01a', borderTop: '1px solid #1d9bf04d' }}>
        <h3 style={{ marginBottom: '15px', color: '#1d9bf0' }}>🛡️ The Extraction Test</h3>
        <p style={{ fontSize: '0.9rem', marginBottom: '15px' }}>
          Move beyond the "AI Score." To identify slop, ask three questions:
        </p>
        <ul style={{ paddingLeft: '20px', fontSize: '0.9rem', lineHeight: '1.6' }}>
          <li><strong>Accountability:</strong> Is there a named, verifiable author with "skin in the game"?</li>
          <li><strong>The Funnel:</strong> Is the content an end in itself, or merely bait for a downstream product?</li>
          <li><strong>Replicability:</strong> If you followed the instructions exactly, would you get the claimed result?</li>
        </ul>
        <p style={{ marginTop: '10px', fontSize: '0.85rem', fontStyle: 'italic', color: '#71767b' }}>
          If a post fails two of these, it is industrial slop.
        </p>
      </div>
    </div>
  );
}
