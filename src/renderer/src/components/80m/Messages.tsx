import React from 'react';
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
  return (
    <div className="messages-80m">
      {messages.length === 0 && !isLoading && (
        <div className="welcome-empty-80m">
          <h2>80M AGENT CONTROL</h2>
          <p>Send a message to start a session with your agent.</p>
        </div>
      )}
      {messages.map((msg) => (
        <div key={msg.id} className={`msg-80m ${msg.role}`}>
          <span className="msg-80m-role">{msg.role}</span>
          <div className="msg-80m-bubble">
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
