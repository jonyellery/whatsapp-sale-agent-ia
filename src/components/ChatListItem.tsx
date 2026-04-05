import { memo } from 'react';

interface ChatListItemProps {
  id: string;
  name: string;
  avatar?: string | null;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount?: number;
  isSelected?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const formatTime = (timestamp?: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const ChatListItem = memo(function ChatListItem({
  id,
  name,
  avatar,
  lastMessage,
  lastMessageTime,
  unreadCount,
  isSelected,
  onClick,
  onContextMenu
}: ChatListItemProps) {
  return (
    <div
      className={`wa-chat-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="wa-chat-avatar">
        {avatar ? (
          <img src={avatar} alt={name} />
        ) : (
          <div className="wa-chat-avatar-placeholder">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="wa-chat-info">
        <div className="wa-chat-header">
          <span className="wa-chat-name">{name}</span>
          <span className="wa-chat-time">
            {formatTime(lastMessageTime)}
          </span>
        </div>
        <div className="wa-chat-preview">
          <span className={`wa-chat-message ${unreadCount ? 'unread' : ''}`}>
            {lastMessage || 'Sem mensagens'}
          </span>
          {unreadCount && unreadCount > 0 && (
            <span className="wa-chat-badge">{unreadCount}</span>
          )}
        </div>
      </div>
    </div>
  );
});

export default ChatListItem;