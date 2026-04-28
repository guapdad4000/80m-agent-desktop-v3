import React, { useState, useEffect } from 'react';

interface Props {
  onBack: () => void;
}

const Settings: React.FC<Props> = ({ onBack }) => {
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (window.hermesAPI) {
      window.hermesAPI.getModelConfig?.().then(
        (cfg: { provider: string; model: string; baseUrl: string } | null) => {
          if (cfg) {
            setProvider(cfg.provider || 'openrouter');
            setModel(cfg.model || '');
            setBaseUrl(cfg.baseUrl || '');
          }
          setLoading(false);
        },
        () => setLoading(false)
      );
    } else {
      setLoading(false);
    }
  }, []);

  const handleSave = async () => {
    if (window.hermesAPI) {
      try {
        await window.hermesAPI.setModelConfig(provider, model, baseUrl);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (_) {}
    }
  };

  if (loading) {
    return (
      <div className="main-80m">
        <div className="chat-header-80m">
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: '#4ade80',
              cursor: 'pointer',
              fontFamily: "'Fira Code', monospace",
              fontSize: '12px',
            }}
          >
            ← Back
          </button>
          <span className="chat-header-80m-title">CONFIG</span>
          <span />
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Fira Code', monospace",
            color: '#555',
            fontSize: '12px',
          }}
        >
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="main-80m">
      <div className="chat-header-80m">
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: '#4ade80',
            cursor: 'pointer',
            fontFamily: "'Fira Code', monospace",
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ← Back
        </button>
        <span className="chat-header-80m-title">CONFIG</span>
        <span />
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <section>
          <h3
            style={{
              fontFamily: "'Fira Code', monospace",
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: '#4ade80',
              textTransform: 'uppercase',
              marginBottom: '16px',
            }}
          >
            Provider
          </h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {['openrouter', 'openai', 'anthropic', 'custom'].map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: `1px solid ${provider === p ? '#4ade80' : 'rgba(74,222,128,0.15)'}`,
                  background: provider === p ? 'rgba(74,222,128,0.1)' : 'transparent',
                  color: provider === p ? '#4ade80' : '#666',
                  fontFamily: "'Fira Code', monospace",
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3
            style={{
              fontFamily: "'Fira Code', monospace",
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: '#4ade80',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            Model Name
          </h3>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. anthropic/claude-3-5-sonnet"
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid rgba(74,222,128,0.15)',
              background: '#1a1a1a',
              color: '#e8e8e8',
              fontFamily: "'Fira Code', monospace",
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </section>

        <section>
          <h3
            style={{
              fontFamily: "'Fira Code', monospace",
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: '#4ade80',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            Base URL
          </h3>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://openrouter.ai/api/v1"
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid rgba(74,222,128,0.15)',
              background: '#1a1a1a',
              color: '#e8e8e8',
              fontFamily: "'Fira Code', monospace",
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </section>

        <button
          onClick={handleSave}
          style={{
            alignSelf: 'flex-start',
            padding: '10px 24px',
            borderRadius: '10px',
            border: 'none',
            background: '#4ade80',
            color: '#0f0f0f',
            fontFamily: "'Fira Code', monospace",
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.05em',
          }}
        >
          {saved ? 'SAVED ✓' : 'SAVE CONFIG'}
        </button>
      </div>
    </div>
  );
};

export default Settings;
