/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Search, 
  MoreVertical, 
  MessageSquare, 
  Smile, 
  Paperclip, 
  Mic, 
  Send,
  User,
  Check,
  CheckCheck,
  Image,
  Video,
  Music,
  Sticker,
  Reply,
  ChevronDown,
  Phone,
  MoreHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types for different message formats
interface MessageContextInfo {
  quotedMessage?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
    imageMessage?: {
      jpegThumbnail?: string;
    };
  };
  quotedType?: string;
  stanzaId?: string;
  participant?: string;
}

interface WAMessage {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
    participant?: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text: string;
      contextInfo?: MessageContextInfo;
    };
    imageMessage?: {
      url?: string;
      mimetype?: string;
      caption?: string;
      jpegThumbnail?: string;
    };
    videoMessage?: {
      url?: string;
      mimetype?: string;
      caption?: string;
      jpegThumbnail?: string;
    };
    audioMessage?: {
      url?: string;
      mimetype?: string;
      ptt?: boolean;
    };
    stickerMessage?: {
      url?: string;
      mimetype?: string;
    };
    documentMessage?: {
      fileName?: string;
      mimetype?: string;
    };
    reactionMessage?: {
      text?: string;
    };
    senderKeyDistributionMessage?: {
      groupId?: string;
    };
    albumMessage?: {
      expectedImageCount?: number;
      expectedVideoCount?: number;
    };
  };
  messageTimestamp?: number;
  pushName?: string;
  broadcast?: boolean;
  participant?: string;
  messageContextInfo?: MessageContextInfo;
}

interface Message extends WAMessage {
  // Normalized fields for easier access
  _type?: 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'reaction' | 'unknown';
  _text?: string;
  _mediaUrl?: string;
  _thumbnail?: string;
  _isPTT?: boolean;
  _replyTo?: {
    text?: string;
    stanzaId?: string;
  };
}

interface Chat {
  id: string;
  name?: string;
  subject?: string;
  displayName?: string;
  avatar?: string | null;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageSender?: string;
  lastMessageTime?: number;
  description?: string;
  archived?: boolean;
}

interface ChatDetails {
  jid: string;
  displayName?: string;
  avatar?: string | null;
  participants?: any[];
  description?: string;
}

// Helper to extract message content and determine type
const normalizeMessage = (msg: WAMessage): Message => {
  const normalized: Message = { ...msg };
  
  // Check for text message (conversation or extendedTextMessage)
  if (msg.message?.conversation) {
    normalized._type = 'text';
    normalized._text = msg.message.conversation;
  } else if (msg.message?.extendedTextMessage) {
    normalized._type = 'text';
    normalized._text = msg.message.extendedTextMessage.text;
    if (msg.message.extendedTextMessage.contextInfo?.quotedMessage) {
      const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      normalized._replyTo = {
        text: quoted.conversation || quoted.extendedTextMessage?.text || '[Mídia]',
        stanzaId: msg.message.extendedTextMessage.contextInfo.stanzaId
      };
    }
  }
  // Image message
  else if (msg.message?.imageMessage) {
    normalized._type = 'image';
    normalized._mediaUrl = msg.message.imageMessage.url;
    normalized._thumbnail = msg.message.imageMessage.jpegThumbnail;
    normalized._text = msg.message.imageMessage.caption || '[Imagem]';
  }
  // Video message
  else if (msg.message?.videoMessage) {
    normalized._type = 'video';
    normalized._mediaUrl = msg.message.videoMessage.url;
    normalized._thumbnail = msg.message.videoMessage.jpegThumbnail;
    normalized._text = msg.message.videoMessage.caption || '[Vídeo]';
  }
  // Audio message
  else if (msg.message?.audioMessage) {
    normalized._type = 'audio';
    normalized._mediaUrl = msg.message.audioMessage.url;
    normalized._isPTT = msg.message.audioMessage.ptt;
    normalized._text = msg.message.audioMessage.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio';
  }
  // Sticker message
  else if (msg.message?.stickerMessage) {
    normalized._type = 'sticker';
    normalized._mediaUrl = msg.message.stickerMessage.url;
    normalized._text = 'Sticker';
  }
  // Document message
  else if (msg.message?.documentMessage) {
    normalized._type = 'document';
    normalized._text = `📄 ${msg.message.documentMessage.fileName || 'Documento'}`;
  }
  // Reaction message
  else if (msg.message?.reactionMessage) {
    normalized._type = 'reaction';
    normalized._text = msg.message.reactionMessage.text || '👍';
  }
  // Album message (placeholder)
  else if (msg.message?.albumMessage) {
    normalized._type = 'image';
    normalized._text = `📸 Álbum (${msg.message.albumMessage.expectedImageCount || ''} fotos)`;
  }
  // Unknown type
  else {
    normalized._type = 'unknown';
    normalized._text = '[Mensagem não suportada]';
  }
  
  return normalized;
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'open' | 'close' | 'qr'>('connecting');
  const [qr, setQr] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ativas' | 'arquivadas'>('ativas');
  const [chatDetails, setChatDetails] = useState<ChatDetails | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const oldestMessageTimeRef = useRef<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connection-update', (data: { status: any; qr: string | null }) => {
      setStatus(data.status);
      setQr(data.qr);
      if (data.status === 'open') {
        newSocket.emit('get-chats');
      }
    });

    newSocket.on('chats-list', (data: Chat[]) => {
      // Sort chats by last message time
      const filteredChats = data
        .filter(c => c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
        .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
      setChats(filteredChats);
    });

    newSocket.on('chat-details', (data: ChatDetails) => {
      if (selectedChat === data.jid) {
        setChatDetails(data);
      }
    });

    newSocket.on('messages-list', (data: { jid: string; messages: WAMessage[] }) => {
      if (selectedChat === data.jid) {
        const normalizedMessages = data.messages.map(normalizeMessage);
        setMessages(normalizedMessages);
        
        // Update oldest message timestamp for load more
        if (normalizedMessages.length > 0) {
          const oldest = normalizedMessages[normalizedMessages.length - 1];
          oldestMessageTimeRef.current = oldest.messageTimestamp || oldestMessageTimeRef.current;
        }
        
        // If less than 30 messages, there might be more
        setHasMoreMessages(data.messages.length >= 30);
      }
    });

    newSocket.on('new-message', (msg: WAMessage) => {
      const normalizedMsg = normalizeMessage(msg);
      
      if (selectedChat === msg.key.remoteJid) {
        setMessages(prev => [normalizedMsg, ...prev]);
      }
      
      // Update chat list last message
      setChats(prev => {
        const updated = [...prev];
        const index = updated.findIndex(c => c.id === msg.key.remoteJid);
        const text = normalizedMsg._text || 'Mídia';
        
        if (index !== -1) {
          updated[index] = { 
            ...updated[index], 
            lastMessage: text,
            lastMessageTime: msg.messageTimestamp
          };
          // Move to top
          const [item] = updated.splice(index, 1);
          updated.unshift(item);
        }
        return updated;
      });
    });

    newSocket.on('contacts-update', (contacts: any[]) => {
      setChats(prev => {
        const updated = [...prev];
        contacts.forEach(contact => {
          const index = updated.findIndex(c => c.id === contact.id);
          if (index !== -1) {
            updated[index] = { 
              ...updated[index], 
              name: contact.name || contact.notify || contact.id.split('@')[0],
              displayName: contact.name || contact.notify || contact.id.split('@')[0]
            };
          }
        });
        return updated;
      });
    });

    return () => {
      newSocket.close();
    };
  }, [selectedChat]);

  useEffect(() => {
    if (selectedChat && socket) {
      // Reset pagination state when switching chats
      oldestMessageTimeRef.current = Math.floor(Date.now() / 1000);
      setHasMoreMessages(true);
      
      socket.emit('get-messages', selectedChat);
      socket.emit('get-chat-details', selectedChat);
    }
  }, [selectedChat, socket]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load more messages handler
  const loadMoreMessages = useCallback(async () => {
    if (!selectedChat || isLoadingMore || !hasMoreMessages) return;
    
    setIsLoadingMore(true);
    try {
      const response = await fetch(
        `/api/messages/${encodeURIComponent(selectedChat)}/load-more?before=${oldestMessageTimeRef.current}&limit=30`
      );
      
      if (response.ok) {
        const olderMessages: WAMessage[] = await response.json();
        
        if (olderMessages.length > 0) {
          const normalizedOlder = olderMessages.map(normalizeMessage);
          setMessages(prev => [...prev, ...normalizedOlder]);
          
          // Update oldest timestamp
          const oldest = normalizedOlder[normalizedOlder.length - 1];
          oldestMessageTimeRef.current = oldest.messageTimestamp || oldestMessageTimeRef.current;
          
          // Check if there are more messages
          setHasMoreMessages(olderMessages.length >= 30);
        } else {
          setHasMoreMessages(false);
        }
      }
    } catch (err) {
      console.error('Error loading more messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [selectedChat, isLoadingMore, hasMoreMessages]);

  // Handle scroll to load more
  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop } = e.currentTarget;
    
    // Load more when scrolled to top
    if (scrollTop < 100) {
      loadMoreMessages();
    }
  }, [loadMoreMessages]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedChat || !socket) return;

    const text = inputText;
    setInputText('');

    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, text }),
      });
      
      if (response.ok) {
        const sentMsg = await response.json();
        setMessages(prev => [normalizeMessage(sentMsg), ...prev]);
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };
  
  const refreshChats = async () => {
    if (!socket || status !== 'open') return;
    
    try {
      await fetch('/api/refresh-chats', { method: 'GET' });
    } catch (e) {
      console.log('Refresh error:', e);
    }
    
    socket.emit('get-chats');
  };

  // Force load archived chats from server
  const loadArchivedChats = async () => {
    if (!socket || status !== 'open') return;
    
    try {
      const response = await fetch('/api/load-archived', { method: 'GET' });
      const data = await response.json();
      console.log('Archived chats response:', data);
      
      if (data.chats && data.chats.length > 0) {
        // Merge archived chats into existing chats
        setChats(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newArchived = data.chats.filter((c: Chat) => !existingIds.has(c.id));
          return [...prev, ...newArchived.map((c: Chat) => ({ ...c, archived: true }))];
        });
      }
    } catch (e) {
      console.log('Load archived error:', e);
    }
  };

  // Archive/unarchive a chat
  const toggleArchiveChat = async (jid: string, currentlyArchived: boolean) => {
    if (!socket || status !== 'open') return;
    
    try {
      const response = await fetch('/api/archive-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, archive: !currentlyArchived })
      });
      const data = await response.json();
      console.log('Archive toggle result:', data);
      
      // Update local state
      setChats(prev => prev.map(c => 
        c.id === jid ? { ...c, archived: !currentlyArchived } : c
      ));
      
      // Refresh the chat list
      socket.emit('get-chats');
    } catch (e) {
      console.log('Archive toggle error:', e);
    }
  };

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatChatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const now = new Date();
    const msgDate = new Date(timestamp * 1000);
    
    if (msgDate.toDateString() === now.toDateString()) {
      return msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (msgDate.toDateString() === yesterday.toDateString()) {
      return 'Ontem';
    }
    
    return msgDate.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  };

  // Get display name for message sender (for group messages)
  const getSenderName = (msg: Message): string => {
    if (msg.key.fromMe) return 'Você';
    if (msg.pushName) return msg.pushName;
    if (msg.participant) {
      // Try to get name from contacts or use ID
      const contact = store.contacts[msg.participant];
      return contact?.notify || contact?.name || msg.participant.split('@')[0];
    }
    return 'Usuário';
  };

  // Get display name for chat in sidebar
  const getChatDisplayName = (chat: Chat): string => {
    // Try different sources for display name
    if (chat.displayName) return chat.displayName;
    if (chat.name) return chat.name;
    if (chat.subject) return chat.subject; // For groups
    
    // For contacts, extract from ID
    const jid = chat.id;
    if (jid.endsWith('@g.us')) {
      // For groups, use a fallback
      return 'Grupo';
    }
    // For individual contacts, just show the number
    return jid.split('@')[0];
  };

  // Render message content based on type
  const renderMessageContent = (msg: Message) => {
    switch (msg._type) {
      case 'image':
        return (
          <div className="wa-image-container">
            {msg._thumbnail ? (
              <img 
                src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                alt={msg._text || 'Imagem'} 
                className="wa-media-image"
              />
            ) : msg._mediaUrl ? (
              <img 
                src={msg._mediaUrl} 
                alt={msg._text || 'Imagem'} 
                className="wa-media-image"
                loading="lazy"
              />
            ) : null}
            {msg._text && msg._text !== '[Imagem]' && (
              <p className="wa-media-caption">{msg._text}</p>
            )}
          </div>
        );
      
      case 'video':
        return (
          <div className="wa-video-container">
            {msg._thumbnail ? (
              <img 
                src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                alt={msg._text || 'Vídeo'} 
                className="wa-media-thumbnail"
              />
            ) : (
              <div className="wa-media-placeholder">
                <Video size={32} />
              </div>
            )}
            <span className="wa-media-label">{msg._text || '[Vídeo]'}</span>
          </div>
        );
      
      case 'audio':
        return (
          <div className="wa-audio-container">
            {msg._isPTT ? (
              <div className="wa-ptt">
                <Music size={18} />
                <span>Mensagem de voz</span>
              </div>
            ) : (
              <div className="wa-audio">
                <Music size={18} />
                <span>Áudio</span>
              </div>
            )}
          </div>
        );
      
      case 'sticker':
        return (
          <div className="wa-sticker-container">
            {msg._mediaUrl ? (
              <img 
                src={msg._mediaUrl} 
                alt="Sticker" 
                className="wa-sticker"
                loading="lazy"
              />
            ) : (
              <Sticker size={48} className="text-gray-400" />
            )}
          </div>
        );
      
      case 'document':
        return (
          <div className="wa-document-container">
            <Paperclip size={20} />
            <span>{msg._text || 'Documento'}</span>
          </div>
        );
      
      case 'reaction':
        return (
          <div className="wa-reaction">
            <span className="wa-reaction-emoji">{msg._text}</span>
          </div>
        );
      
      default:
        return <p className="wa-message-text">{msg._text || '[Mensagem]'}</p>;
    }
  };

  if (status === 'qr' && qr) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#f0f2f5]">
        <div className="bg-white p-10 rounded-lg shadow-md flex flex-col items-center max-w-md text-center">
          <h1 className="text-2xl font-light text-gray-700 mb-6">Para usar o WhatsApp no seu computador:</h1>
          <ol className="text-left text-sm text-gray-600 space-y-3 mb-8">
            <li>1. Abra o WhatsApp no seu celular</li>
            <li>2. Toque em Mais opções ou Configurações e selecione Aparelhos conectados</li>
            <li>3. Toque em Conectar um aparelho</li>
            <li>4. Aponte seu celular para esta tela para capturar o código</li>
          </ol>
          <div className="bg-white p-4 border-4 border-gray-100 rounded-lg">
            <img src={qr} alt="QR Code" className="w-64 h-64" />
          </div>
          <p className="mt-6 text-xs text-gray-400">O código QR será atualizado automaticamente.</p>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#f0f2f5]">
        <div className="w-16 h-16 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-500 font-medium">Conectando ao WhatsApp...</p>
      </div>
    );
  }

  if (status === 'close') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#f0f2f5]">
        <div className="bg-white p-10 rounded-lg shadow-md flex flex-col items-center max-w-md text-center">
          <h1 className="text-2xl font-light text-red-500 mb-4">Conexão Fechada</h1>
          <p className="text-gray-600 mb-6">A conexão com o WhatsApp foi encerrada. Tentando reconectar...</p>
          <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  // Simple store for contacts (will be populated from server)
  const store = {
    contacts: {} as Record<string, any>
  };

  return (
    <div className="wa-container">
      {/* Sidebar */}
      <div className="wa-sidebar">
        <div className="wa-header">
          <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
            <User className="text-gray-500" size={24} />
          </div>
          <div className="flex gap-5 text-gray-500">
            <motion.button whileTap={{ scale: 0.9 }} onClick={refreshChats} title="Atualizar conversas">
              <MessageSquare size={20} />
            </motion.button>
            <motion.button whileTap={{ scale: 0.9 }}><MoreVertical size={20} /></motion.button>
          </div>
        </div>

        {/* Tab buttons for Active/Archived */}
        <div className="wa-tabs">
          <button 
            className={`wa-tab ${activeTab === 'ativas' ? 'active' : ''}`}
            onClick={() => setActiveTab('ativas')}
          >
            Conversas
          </button>
          <button 
            className={`wa-tab ${activeTab === 'arquivadas' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('arquivadas');
              loadArchivedChats();
            }}
          >
            Arquivadas
          </button>
        </div>

        <div className="p-2 bg-white">
          <div className="bg-[#f0f2f5] flex items-center px-3 py-1.5 rounded-lg">
            <Search className="text-gray-400 mr-3" size={18} />
            <input 
              type="text" 
              placeholder="Pesquisar ou começar uma nova conversa" 
              className="bg-transparent border-none outline-none text-sm w-full"
            />
          </div>
        </div>

        <div className="wa-chat-list">
          {/* Filter chats based on active tab */}
          {chats.filter(chat => activeTab === 'arquivadas' ? chat.archived : !chat.archived).map((chat) => (
            <div 
              key={chat.id} 
              className={`wa-chat-item ${selectedChat === chat.id ? 'active' : ''}`}
              onClick={() => setSelectedChat(chat.id)}
            >
              {chat.avatar ? (
                <img 
                  src={chat.avatar} 
                  alt={chat.displayName || chat.name}
                  className="w-12 h-12 rounded-full object-cover mr-3 flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                  <User className="text-gray-400" size={28} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="font-medium text-[16px] text-gray-800 truncate">
                    {getChatDisplayName(chat)}
                  </h3>
                  <span className="text-xs text-gray-400">
                    {formatChatTime(chat.lastMessageTime)}
                  </span>
                </div>
                <p className="text-sm text-gray-500 truncate">
                  {chat.lastMessage ? `${chat.lastMessageSender || getChatDisplayName(chat)}: ${chat.lastMessage}` : 'Toque para conversar'}
                </p>
              </div>
              {/* Archive button */}
              <button
                className="wa-archive-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleArchiveChat(chat.id, chat.archived || false);
                }}
                title={chat.archived ? 'Desarquivar' : 'Arquivar'}
              >
                {chat.archived ? '📤' : '📥'}
              </button>
            </div>
          ))}
          {chats.filter(chat => activeTab === 'arquivadas' ? chat.archived : !chat.archived).length === 0 && (
            <div className="p-4 text-center text-gray-400">
              {activeTab === 'ativas' ? 'Nenhuma conversa ativa' : 'Nenhuma conversa arquivada'}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="wa-main">
        {selectedChat ? (
          <>
            <div className="wa-header">
              <div className="flex items-center">
                {chatDetails?.avatar ? (
                  <img 
                    src={chatDetails.avatar}
                    alt={chatDetails.displayName}
                    className="w-10 h-10 rounded-full object-cover mr-3"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center mr-3">
                    <User className="text-gray-400" size={24} />
                  </div>
                )}
                <div>
                  <h3 className="font-medium text-gray-800">
                    {chatDetails?.displayName || chats.find(c => c.id === selectedChat)?.displayName || selectedChat.split('@')[0]}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedChat?.endsWith('@g.us') 
                      ? `${chatDetails?.participants?.length || 0} participantes`
                      : 'online'}
                  </p>
                </div>
              </div>
              <div className="flex gap-5 text-gray-500">
                <Phone size={20} />
                <Search size={20} />
                <MoreHorizontal size={20} />
              </div>
            </div>

            <div 
              className="wa-messages" 
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
            >
              {/* Load more indicator */}
              {isLoadingMore && (
                <div className="wa-load-more">
                  <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
                  <span>Carregando mensagens...</span>
                </div>
              )}
              
              {!hasMoreMessages && messages.length > 0 && (
                <div className="wa-no-more">
                  <span>Início da conversa</span>
                </div>
              )}

              {messages.map((msg, idx) => {
                const isGroup = selectedChat?.endsWith('@g.us');
                const showSenderName = isGroup && !msg.key.fromMe;
                
                return (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.key.id || idx} 
                    className={`wa-bubble ${msg.key.fromMe ? 'wa-bubble-self' : 'wa-bubble-other'}`}
                  >
                    {/* Reply indicator */}
                    {msg._replyTo && (
                      <div className="wa-reply-indicator">
                        <Reply size={14} />
                        <span>{msg._replyTo.text}</span>
                      </div>
                    )}
                    
                    {/* Sender name for group messages */}
                    {showSenderName && (
                      <div className="wa-sender-name">
                        {getSenderName(msg)}
                      </div>
                    )}
                    
                    {/* Message content */}
                    {renderMessageContent(msg)}
                    
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[11px] text-gray-500">
                        {formatTime(msg.messageTimestamp)}
                      </span>
                      {msg.key.fromMe && <CheckCheck size={14} className="text-[#53bdeb]" />}
                    </div>
                  </motion.div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="wa-input-area">
              <Smile className="text-gray-500" size={24} />
              <Paperclip className="text-gray-500" size={24} />
              <input 
                type="text" 
                placeholder="Digite uma mensagem" 
                className="wa-input"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              {inputText.trim() ? (
                <motion.button 
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSendMessage}
                  className="text-[#00a884]"
                >
                  <Send size={24} />
                </motion.button>
              ) : (
                <Mic className="text-gray-500" size={24} />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-10">
            <div className="w-64 h-64 bg-gray-100 rounded-full flex items-center justify-center mb-8">
              <MessageSquare size={100} className="text-gray-300" />
            </div>
            <h1 className="text-3xl font-light text-gray-600 mb-4">WhatsApp Web Clone</h1>
            <p className="text-gray-500 max-w-md">
              Envie e receba mensagens sem precisar manter seu celular conectado. 
              Use o WhatsApp em até 4 aparelhos conectados e um celular ao mesmo tempo.
            </p>
            <div className="mt-auto text-gray-400 text-xs flex items-center gap-1">
              <CheckCheck size={14} /> Protegido com criptografia de ponta a ponta
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
