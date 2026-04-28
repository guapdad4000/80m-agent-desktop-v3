import React from 'react';
import Animated80MLogo from '../../components/Animated80MLogo';

interface LoadingScreenProps {
  status?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ status }) => {
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#0f0f0f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '24px',
    }}>
      <Animated80MLogo />
      <div style={{
        fontFamily: "'Fira Code', monospace",
        fontSize: '13px',
        fontWeight: 700,
        color: '#4ade80',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      }}>
        80M AGENT DESKTOP
      </div>
      {/* Loading bar */}
      <div style={{
        width: '200px',
        height: '2px',
        background: 'rgba(74, 222, 128, 0.15)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          background: '#4ade80',
          animation: 'loadingBar 1.5s ease-in-out infinite',
          borderRadius: '2px',
        }} />
      </div>
      {status && (
        <div style={{
          fontFamily: "'Fira Code', monospace",
          fontSize: '10px',
          color: '#555',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {status}
        </div>
      )}
      <style>{`
        @keyframes loadingBar {
          0% { width: 0%; opacity: 1; }
          70% { width: 85%; opacity: 1; }
          100% { width: 85%; opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;
