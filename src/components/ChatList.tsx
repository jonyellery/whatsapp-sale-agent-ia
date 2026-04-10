import { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import ChatListItem from './ChatListItem';

interface Chat {
  id: string;
  name?: string;
  displayName?: string;
  avatar?: string | null;
  lastMessage?: string;
  lastMessageTime?: number;
  lastMessageSender?: string;
  unreadCount?: number;
  archived?: boolean;
  pinnedAt?: number;
  muted?: boolean;
  lastMessageStatus?: string;
}

interface ChatListProps {
  chats: Chat[];
  selectedChat: string | null;
  onSelectChat: (chatId: string) => void;
  onContextMenu: (e: React.MouseEvent, chatId: string) => void;
  getChatDisplayName: (chat: Chat) => string;
}

const ITEM_HEIGHT = 72;

// Cache for formatted times to avoid recalculation
const timeCache = new Map<number, string>();
const TIME_CACHE_MAX_SIZE = 500;

const formatTime = memo(function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const cached = timeCache.get(timestamp);
  if (cached) return cached;
  
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const result = isToday
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  
  // Limit cache size
  if (timeCache.size >= TIME_CACHE_MAX_SIZE) {
    timeCache.clear();
  }
  timeCache.set(timestamp, result);
  return result;
});

interface RowData {
  chats: Chat[];
  selectedChat: string | null;
  onSelectChat: (chatId: string) => void;
  onContextMenu: (e: React.MouseEvent, chatId: string) => void;
  getChatDisplayName: (chat: Chat) => string;
}

const ChatRow = memo(function ChatRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const chat = data.chats[index];
  return (
    <div style={style} className="wa-chat-item-wrapper">
      <div
        className={`wa-chat-item ${data.selectedChat === chat.id ? 'active' : ''}`}
        onClick={() => data.onSelectChat(chat.id)}
        onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); data.onContextMenu(e, chat.id); }}
      >
        {chat.avatar ? (
          <img src={chat.avatar} alt={data.getChatDisplayName(chat)} className="wa-chat-item-avatar" />
        ) : (
          <div className="wa-chat-item-avatar-placeholder">
            <span style={{ color: 'var(--wa-text-secondary)', fontSize: 20, fontWeight: 500 }}>
              {data.getChatDisplayName(chat).charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="wa-chat-item-content">
          <div className="wa-chat-item-top">
            <h3 className="wa-chat-item-name">{data.getChatDisplayName(chat)}</h3>
            <div className="wa-chat-item-top-right">
              {chat.pinnedAt && <span style={{ color: 'var(--wa-teal-dark)', fontSize: 12 }}>📌</span>}
              {chat.muted && <span style={{ opacity: 0.6, fontSize: 12 }}>🔕</span>}
              <span className={`wa-chat-item-time ${chat.unreadCount && chat.unreadCount > 0 ? 'unread' : ''}`}>
                {chat.lastMessageTime ? formatTime(chat.lastMessageTime) : ''}
              </span>
            </div>
          </div>
          <div className="wa-chat-item-bottom">
            <p className="wa-chat-item-message">
              {chat.lastMessage ? (
                <span className="wa-chat-item-message-text">
                  {chat.lastMessageSender && (
                    <span style={{ fontWeight: 500 }}>{chat.lastMessageSender}: </span>
                  )}
                  {chat.lastMessage}
                </span>
              ) : (
                'Toque para conversar'
              )}
            </p>
            {chat.unreadCount && chat.unreadCount > 0 ? (
              <span className="wa-chat-item-badge">{chat.unreadCount}</span>
            ) : (
              chat.lastMessageStatus && (
                <span className="wa-message-status">
                  {chat.lastMessageStatus === 'sent' && '✓'}
                  {chat.lastMessageStatus === 'delivered' && '✓✓'}
                  {chat.lastMessageStatus === 'read' && '✓✓'}
                </span>
              )
            )}
          </div>
        </div>
        <button
          className="wa-chat-item-menu"
          onClick={(e) => { e.stopPropagation(); data.onContextMenu(e, chat.id); }}
          title="Mais opções"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"></path></svg>
        </button>
      </div>
    </div>
  );
});

export const ChatList = memo(function ChatList({
  chats,
  selectedChat,
  onSelectChat,
  onContextMenu,
  getChatDisplayName
}: ChatListProps) {
  const [listHeight, setListHeight] = useState(500);
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoize the resize handler
  const handleResize = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setListHeight(window.innerHeight - rect.top - 10);
    }
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  const rowData = useMemo<RowData>(() => ({
    chats,
    selectedChat,
    onSelectChat,
    onContextMenu,
    getChatDisplayName
  }), [chats, selectedChat, onSelectChat, onContextMenu, getChatDisplayName]);

  if (chats.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--wa-text-secondary)' }}>
        Nenhuma conversa encontrada
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ height: '100%', overflow: 'hidden' }}>
      <List
        height={Math.max(listHeight, 200)}
        itemCount={chats.length}
        itemSize={ITEM_HEIGHT}
        width="100%"
        itemData={rowData}
        overscanCount={10}
      >
        {ChatRow}
      </List>
    </div>
  );
});

export default ChatList;