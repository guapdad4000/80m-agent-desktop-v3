import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Props {
  messages: Message[];
  isLoading: boolean;
}

const Messages: React.FC<Props> = ({ messages, isLoading }) => {
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);

  return (
    <div className="messages-80m">
      {messages.length === 0 && !isLoading && (
        <div className="welcome-empty-80m">
          <h2>80M AGENT CONTROL</h2>
          <p>Send a message to start a session with your agent.</p>
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`msg-80m ${msg.role}`}
          onMouseEnter={() => setHoveredMsg(msg.id)}
          onMouseLeave={() => setHoveredMsg(null)}
        >
          {msg.role === 'user' && (
            <div className="msg-80m-label">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              USER_ID:SVR
            </div>
          )}
          <div className="msg-80m-bubble">
            {msg.role === 'assistant' && hoveredMsg === msg.id && (
              <div className="msg-80m-actions">
                <button className="msg-80m-action-btn" title="Copy">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            )}
            {msg.role === 'assistant' && (
              <div className="msg-80m-bot-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 8V4H8" />
                  <rect x="4" y="8" width="16" height="12" rx="2" />
                  <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
                </svg>
              </div>
            )}
            {msg.role === 'assistant' ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {msg.content}
              </ReactMarkdown>
            ) : (
              msg.content
            )}
          </div>
          {msg.role === 'assistant' && (
            <div className="msg-80m-assistant-label">prawnius_V4</div>
          )}
        </div>
      ))}
      {isLoading && (
        <div className="msg-80m assistant">
          <span className="msg-80m-role">assistant</span>
          <div className="msg-80m-bubble">
            <div className="msg-80m-loading">
              <div className="msg-80m-loading-dots">
                <span /><span /><span />
              </div>
              <span>thinking...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Messages;
