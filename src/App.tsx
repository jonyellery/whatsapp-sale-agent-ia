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
  Image as ImageIcon,
  Video,
  Music,
  Sticker,
  Reply,
  ChevronDown,
  ChevronUp,
  Phone,
  MoreHorizontal,
  X,
  XCircle,
  Trash2,
  FileText,
  StopCircle,
  ArrowLeft,
  Archive,
  Copy,
  Forward,
  Play
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
  mentionedJid?: string[];
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
      contextInfo?: MessageContextInfo;
    };
    videoMessage?: {
      url?: string;
      mimetype?: string;
      caption?: string;
      jpegThumbnail?: string;
      contextInfo?: MessageContextInfo;
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
      key?: {
        remoteJid?: string;
        id?: string;
        fromMe?: boolean;
        participant?: string;
      };
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
  _mentions?: string[];
  _reactionTo?: {
    remoteJid?: string;
    id?: string;
    fromMe?: boolean;
    participant?: string;
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
  archive?: boolean; // For API responses that use 'archive' instead of 'archived'
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
    // Check for mentions in contextInfo
    if (msg.message.extendedTextMessage.contextInfo?.mentionedJid) {
      normalized._mentions = msg.message.extendedTextMessage.contextInfo.mentionedJid;
    }
  }
  // Image message
  else if (msg.message?.imageMessage) {
    normalized._type = 'image';
    normalized._mediaUrl = msg.message.imageMessage.url;
    normalized._thumbnail = msg.message.imageMessage.jpegThumbnail;
    normalized._text = msg.message.imageMessage.caption || '[Imagem]';
    // Check for mentions in image message
    if (msg.message.imageMessage?.contextInfo?.mentionedJid) {
      normalized._mentions = msg.message.imageMessage.contextInfo.mentionedJid;
    }
  }
  // Video message
  else if (msg.message?.videoMessage) {
    normalized._type = 'video';
    normalized._mediaUrl = msg.message.videoMessage.url;
    normalized._thumbnail = msg.message.videoMessage.jpegThumbnail;
    normalized._text = msg.message.videoMessage.caption || '[Vídeo]';
    // Check for mentions in video message
    if (msg.message.videoMessage?.contextInfo?.mentionedJid) {
      normalized._mentions = msg.message.videoMessage.contextInfo.mentionedJid;
    }
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
    // Store the key of the message being reacted to
    normalized._reactionTo = msg.message.reactionMessage.key;
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
  const [loadingChats, setLoadingChats] = useState(false);
  
  // New state for features
  const [searchQuery, setSearchQuery] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; text: string; sender: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chatId?: string; messageId?: string; isGroup: boolean } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string; type: string } | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [typingJids, setTypingJids] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, string>>({}); // messageId -> status
  const [emojiCategory, setEmojiCategory] = useState('frequent');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const oldestMessageTimeRef = useRef<number>(Math.floor(Date.now() / 1000));
  const selectedChatRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const prevMessagesCountRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  // Simple store for contacts (will be populated from server)
  const store = useRef({
    contacts: {} as Record<string, any>
  });

  // Socket connection - created ONCE, never recreated
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
      const filteredChats = data
        .filter(c => c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
        .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
      
      setChats(prevChats => {
        const incomingMap = new Map(filteredChats.map(c => [c.id, c]));
        const mergedChats = prevChats.map(existingChat => {
          const incoming = incomingMap.get(existingChat.id);
          if (incoming) {
            // Normalize archived: Baileys may send 'archive' or 'archived'
            const incomingArchived = incoming.archived !== undefined 
              ? incoming.archived 
              : incoming.archive !== undefined 
                ? incoming.archive 
                : existingChat.archived;
            return {
              ...existingChat,
              ...incoming,
              archived: incomingArchived
            };
          }
          return existingChat;
        });
        const existingIds = new Set(prevChats.map(c => c.id));
        const newChats = filteredChats.filter(c => !existingIds.has(c.id));
        return [...mergedChats, ...newChats];
      });
    });

    newSocket.on('chat-details', (data: ChatDetails) => {
      if (selectedChatRef.current === data.jid) {
        setChatDetails(data);
      }
    });

    newSocket.on('messages-list', (data: { jid: string; messages: WAMessage[] }) => {
      if (selectedChatRef.current === data.jid) {
        const normalizedMessages = data.messages.map(normalizeMessage);
        setMessages(normalizedMessages);
        
        if (normalizedMessages.length > 0) {
          const oldest = normalizedMessages[0];
          oldestMessageTimeRef.current = oldest.messageTimestamp || oldestMessageTimeRef.current;
        }
        
        setHasMoreMessages(data.messages.length >= 30);
        prevMessagesCountRef.current = normalizedMessages.length;
      }
    });

    newSocket.on('new-message', (msg: WAMessage) => {
      if (!msg?.key?.remoteJid) return;
      const normalizedMsg = normalizeMessage(msg);
      
      if (selectedChatRef.current === msg.key.remoteJid) {
        setMessages(prev => {
          // Deduplication: check if message already exists
          if (normalizedMsg.key.id && prev.some(m => m.key.id === normalizedMsg.key.id)) {
            return prev;
          }
          return [...prev, normalizedMsg];
        });
      }
      
      // Update chat list
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
          const [item] = updated.splice(index, 1);
          updated.unshift(item);
        }
        return updated;
      });
    });

    newSocket.on('message-deleted', (data: { jid: string; messageId: string }) => {
      if (selectedChatRef.current === data.jid) {
        setMessages(prev => prev.filter(m => m.key.id !== data.messageId));
      }
    });

    newSocket.on('message-updated', (msg: WAMessage) => {
      if (!msg?.key?.remoteJid || !msg?.key?.id) return;
      if (selectedChatRef.current === msg.key.remoteJid) {
        const normalizedMsg = normalizeMessage(msg);
        setMessages(prev => prev.map(m => m.key.id === msg.key.id ? normalizedMsg : m));
      }
    });

    newSocket.on('new-reaction', (data: { jid: string; reaction: WAMessage; targetMessageKey: any }) => {
      if (selectedChatRef.current === data.jid && data.reaction) {
        const normalizedReaction = normalizeMessage(data.reaction);
        setMessages(prev => {
          if (normalizedReaction.key.id && prev.some(m => m.key.id === normalizedReaction.key.id)) {
            return prev;
          }
          return [normalizedReaction, ...prev];
        });
      }
    });

    newSocket.on('contacts-update', (contacts: any[]) => {
      contacts.forEach(contact => {
        store.current.contacts[contact.id] = contact;
      });
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

    newSocket.on('typing-update', (data: { jid: string; isTyping: boolean }) => {
      setTypingJids(prev => {
        const next = new Set(prev);
        if (data.isTyping) next.add(data.jid);
        else next.delete(data.jid);
        return next;
      });
      // Clear typing after 5s
      if (data.isTyping) {
        setTimeout(() => {
          setTypingJids(prev => {
            const next = new Set(prev);
            next.delete(data.jid);
            return next;
          });
        }, 5000);
      }
    });

    newSocket.on('presence-update', (data: { jid: string; status: string }) => {
      setPresenceMap(prev => ({ ...prev, [data.jid]: data.status }));
    });

    newSocket.on('presence-bulk', (data: Record<string, string>) => {
      setPresenceMap(data);
    });

    newSocket.on('message-receipt', (data: { jid: string; messageId: string; type: string }) => {
      setReceipts(prev => ({ ...prev, [data.messageId]: data.type }));
    });

    newSocket.on('message-status-update', (data: { jid: string; messageId: string; status: any }) => {
      if (data.status?.status) {
        setReceipts(prev => ({ ...prev, [data.messageId]: data.status.status }));
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (selectedChat && socket) {
      // Clear messages immediately when switching chats
      setMessages([]);
      // Reset pagination state when switching chats
      oldestMessageTimeRef.current = Math.floor(Date.now() / 1000);
      setHasMoreMessages(true);
      prevMessagesCountRef.current = 0;
      isNearBottomRef.current = true;
      
      socket.emit('get-messages', selectedChat);
      socket.emit('get-chat-details', selectedChat);
    }
  }, [selectedChat, socket]);

  // Smart auto-scroll: only scroll to bottom when new messages arrive and user is near bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    const isNewMessage = messages.length > prevMessagesCountRef.current && !isLoadingMoreRef.current;
    prevMessagesCountRef.current = messages.length;
    
    if (isNewMessage && isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Force scroll to bottom when chat is first opened (initial message load)
  useEffect(() => {
    if (selectedChat && messages.length > 0) {
      // Small delay to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedChat]);

  // Load more messages handler - preserves scroll position
  const loadMoreMessages = useCallback(async () => {
    if (!selectedChat || isLoadingMore || !hasMoreMessages) return;
    
    setIsLoadingMore(true);
    isLoadingMoreRef.current = true;
    
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    
    try {
      const response = await fetch(
        `/api/messages/${encodeURIComponent(selectedChat)}/load-more?before=${oldestMessageTimeRef.current}&limit=30`
      );
      
      if (response.ok) {
        const olderMessages: WAMessage[] = await response.json();
        
        if (olderMessages.length > 0) {
          const normalizedOlder = olderMessages.map(normalizeMessage);
          
          // Deduplicate before prepending (older messages go at the start)
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.key.id).filter(Boolean));
            const uniqueOlder = normalizedOlder.filter(m => !m.key.id || !existingIds.has(m.key.id));
            return [...uniqueOlder, ...prev];
          });
          
          // Update oldest timestamp (first item is the oldest since server returns oldest-first)
          const oldest = normalizedOlder[0];
          oldestMessageTimeRef.current = oldest.messageTimestamp || oldestMessageTimeRef.current;
          
          // Preserve scroll position after DOM updates
          if (container) {
            requestAnimationFrame(() => {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = newScrollHeight - prevScrollHeight;
            });
          }
          
          setHasMoreMessages(olderMessages.length >= 30);
        } else {
          setHasMoreMessages(false);
        }
      }
    } catch (err) {
      console.error('Error loading more messages:', err);
    } finally {
      setIsLoadingMore(false);
      isLoadingMoreRef.current = false;
    }
  }, [selectedChat, isLoadingMore, hasMoreMessages]);

  // Track scroll position to determine if user is near bottom
  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    
    // "Near bottom" means within 150px of the bottom (newest messages)
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150;
  }, []);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedChat || !socket) return;

    const text = inputText;
    setInputText('');
    sendTyping(false);

    try {
      const url = replyTo ? '/api/send-reply' : '/api/send';
      const body: any = { jid: selectedChat, text };
      if (replyTo) body.replyTo = replyTo.id;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      if (response.ok) {
        const sentMsg = await response.json();
        setMessages(prev => {
          if (sentMsg?.key?.id && prev.some(m => m.key.id === sentMsg.key.id)) return prev;
          return [...prev, normalizeMessage(sentMsg)];
        });
      } else {
        showToast('Erro ao enviar mensagem');
      }
    } catch (err) {
      showToast('Erro ao enviar mensagem');
    }
    setReplyTo(null);
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

  // Load older chats that haven't been synced yet
  const loadMoreChats = async () => {
    if (!socket || status !== 'open' || loadingChats) return;
    
    setLoadingChats(true);
    try {
      console.log('Loading more chats from server...');
      const response = await fetch('/api/fetch-chats', { method: 'GET' });
      const data = await response.json();
      console.log('Fetched chats:', data.count);
    } catch (e) {
      console.log('Load more chats error:', e);
    } finally {
      setLoadingChats(false);
    }
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
      const contact = store.current.contacts[msg.participant];
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

  // Get contact name from JID - using contacts from server
  const getContactName = (jid: string): string => {
    // Try to get from store.contacts
    const contact = store.current.contacts[jid];
    if (contact) {
      return contact.name || contact.notify || jid.split('@')[0];
    }
    // Fallback to JID number
    return jid.split('@')[0];
  };

  // Process mentions in message text - replace @jid with contact name
  const processMentions = (text: string | undefined, mentions?: string[]): React.ReactNode => {
    if (!text) return null;
    
    // For simplicity, we'll return the text as is if no mentions
    // The mentions will be highlighted in the message display
    if (!mentions || mentions.length === 0) {
      return text;
    }
    
    // Replace each mention with highlighted name
    let result = text;
    mentions.forEach(jid => {
      const contactName = getContactName(jid);
      // Try to replace the JID in the text (could be in format @jid or just the number)
      const jidNumber = jid.split('@')[0];
      result = result.replace(new RegExp(`@${jidNumber}`, 'g'), `@${contactName}`);
      result = result.replace(new RegExp(jidNumber, 'g'), `@${contactName}`);
    });
    
    // Split by @ to create React elements with highlighted mentions
    const parts = result.split(/(@\w+)/);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} className="wa-mention">{part}</span>;
      }
      return part;
    });
  };

  // Show toast notification
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Mark chat as read
  const markChatAsRead = async (jid: string) => {
    try {
      await fetch('/api/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid })
      });
      setChats(prev => prev.map(c => c.id === jid ? { ...c, unreadCount: 0 } : c));
    } catch {}
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const type = file.type.split('/')[0];
    setMediaPreview({ file, url, type });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Send media
  const handleSendMedia = async () => {
    if (!mediaPreview || !selectedChat) return;
    const formData = new FormData();
    formData.append('file', mediaPreview.file);
    formData.append('jid', selectedChat);
    formData.append('caption', mediaCaption);
    formData.append('mediaType', mediaPreview.type);
    if (replyTo) formData.append('replyTo', replyTo.id);
    try {
      const res = await fetch('/api/send-media', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Falha ao enviar');
      const sent = await res.json();
      setMessages(prev => {
        if (sent?.key?.id && prev.some(m => m.key.id === sent.key.id)) return prev;
        return [...prev, normalizeMessage(sent)];
      });
    } catch {
      showToast('Erro ao enviar mídia');
    }
    setMediaPreview(null);
    setMediaCaption('');
    setReplyTo(null);
  };

  // Audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size > 0 && selectedChat) {
          const formData = new FormData();
          formData.append('file', blob, 'audio.webm');
          formData.append('jid', selectedChat);
          formData.append('mediaType', 'audio');
          formData.append('ptt', 'true');
          if (replyTo) formData.append('replyTo', replyTo.id);
          try {
            const res = await fetch('/api/send-media', { method: 'POST', body: formData });
            if (res.ok) {
              const sent = await res.json();
              setMessages(prev => {
                if (sent?.key?.id && prev.some(m => m.key.id === sent.key.id)) return prev;
                return [...prev, normalizeMessage(sent)];
              });
            }
          } catch { showToast('Erro ao enviar áudio'); }
        }
        setReplyTo(null);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);
    } catch {
      showToast('Erro ao acessar microfone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  };

  // Send typing indicator
  const sendTyping = useCallback((isTyping: boolean) => {
    if (!socket || !selectedChat) return;
    socket.emit('typing', { jid: selectedChat, isTyping });
  }, [socket, selectedChat]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTyping(true);
    typingTimeoutRef.current = window.setTimeout(() => sendTyping(false), 2000);
  };

  // Reply to message
  const handleReply = (msg: Message) => {
    const text = msg._text || '[Mídia]';
    const sender = msg.key.fromMe ? 'Você' : (msg.pushName || 'Contato');
    setReplyTo({ id: msg.key.id, text, sender });
    setContextMenu(null);
  };

  // Delete message
  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedChat) return;
    try {
      await fetch('/api/delete-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, forEveryone: true })
      });
      setMessages(prev => prev.filter(m => m.key.id !== messageId));
    } catch { showToast('Erro ao deletar mensagem'); }
    setContextMenu(null);
  };

  // Copy message text
  const handleCopyMessage = (text?: string) => {
    if (text) navigator.clipboard.writeText(text).catch(() => {});
    setContextMenu(null);
    showToast('Mensagem copiada');
  };

  // Send reaction
  const handleSendReaction = async (messageId: string, emoji: string) => {
    if (!selectedChat) return;
    try {
      await fetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, emoji })
      });
    } catch {}
    setContextMenu(null);
  };

  // Filtered chats based on search
  const filteredChats = chats.filter(chat => {
    const inTab = activeTab === 'arquivadas' ? chat.archived : !chat.archived;
    if (!inTab) return false;
    if (!searchQuery.trim()) return true;
    const name = getChatDisplayName(chat).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  // Format recording time
  const formatRecordingTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Get date label for separator
  const getDateLabel = (timestamp?: number): string | null => {
    if (!timestamp) return null;
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Hoje';
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  // Emoji data
  const emojiData: Record<string, string[]> = {
    'Rostos': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱'],
    'Saudações': ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏'],
    'Corações': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
    'Animais': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🪲'],
    'Comida': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍕','🍔','🍟','🌭','🍿','🧂','🥓','🧇','🥞','🧈','🍞','🥐','🥨','🧀','🍖','🍗','🥩','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🥮'],
    'Atividades': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥍','🏑','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸','🥌','🎿'],
    'Viagens': ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍','🛺','🚲','🛴','✈','🚀','🛸','🚁','⛵','🚤','🛥','🛳','⛴','🚢'],
    'Objetos': ['⌚','📱','💻','⌨','🖥','🖨','🖱','🖲','🕹','🗜','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽','🎞','📞','☎','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🧯','🛢','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖','🧰','🔧','🔨','⚒','🛠','⛏','🪚','🔩','⚙','🧱','⛓'],
    'Símbolos': ['❤','💯','✅','❌','⭐','🔥','💤','💬','👁‍🗨','🔔','🎵','🎶','➕','➖','➗','✖','💲','💱','™','©','®','〰','➰','➿','🔚','🔙','🔛','🔝','🔜','✔','☑','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔲','🔳','▪','▫','◾','◽','◼','◻','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫']
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
              <p className="wa-media-caption">{processMentions(msg._text, msg._mentions)}</p>
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
        // Reaction messages are rendered inline below the original message, not as bubbles
        return null;
      
      default:
        return <p className="wa-message-text">{processMentions(msg._text || '[Mensagem]', msg._mentions)}</p>;
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

  return (
    <div className={`wa-container ${selectedChat ? 'chat-open' : ''}`}>
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
            <motion.button 
              whileTap={{ scale: 0.9 }} 
              onClick={loadMoreChats} 
              title="Carregar mais conversas"
              disabled={loadingChats}
            >
              {loadingChats ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <ChevronDown size={20} />
              )}
            </motion.button>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="wa-tabs">
          <button 
            className={`wa-tab ${activeTab === 'ativas' ? 'active' : ''}`}
            onClick={() => setActiveTab('ativas')}
          >
            Conversas
          </button>
          <button 
            className={`wa-tab ${activeTab === 'arquivadas' ? 'active' : ''}`}
            onClick={() => { setActiveTab('arquivadas'); loadArchivedChats(); }}
          >
            <Archive size={14} />
            Arquivadas
          </button>
        </div>

        {/* Search */}
        <div className="p-2 bg-white">
          <div className="bg-[#f0f2f5] flex items-center px-3 py-1.5 rounded-lg">
            <Search className="text-gray-400 mr-3" size={18} />
            <input 
              type="text" 
              placeholder="Pesquisar ou começar uma nova conversa" 
              className="bg-transparent border-none outline-none text-sm w-full"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Chat List */}
        <div className="wa-chat-list">
          {filteredChats.map((chat) => (
            <div 
              key={chat.id} 
              className={`wa-chat-item ${selectedChat === chat.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedChat(chat.id);
                if (chat.unreadCount && chat.unreadCount > 0) markChatAsRead(chat.id);
              }}
            >
              {chat.avatar ? (
                <img src={chat.avatar} alt={getChatDisplayName(chat)} className="wa-chat-item-avatar" />
              ) : (
                <div className="wa-chat-item-avatar-placeholder">
                  <User className="text-gray-400" size={28} />
                </div>
              )}
              <div className="wa-chat-item-content">
                <div className="wa-chat-item-top">
                  <h3 className="wa-chat-item-name">{getChatDisplayName(chat)}</h3>
                  <span className={`wa-chat-item-time ${chat.unreadCount && chat.unreadCount > 0 ? 'unread' : ''}`}>
                    {formatChatTime(chat.lastMessageTime)}
                  </span>
                </div>
                <div className="wa-chat-item-bottom">
                  <p className="wa-chat-item-message">
                    {typingJids.has(chat.id) ? (
                      <span style={{ color: '#00a884', fontStyle: 'italic' }}>digitando...</span>
                    ) : chat.lastMessage 
                      ? `${chat.lastMessageSender && chat.id.endsWith('@g.us') ? chat.lastMessageSender + ': ' : ''}${chat.lastMessage}` 
                      : 'Toque para conversar'}
                  </p>
                  {chat.unreadCount && chat.unreadCount > 0 && (
                    <span className="wa-unread-badge">{chat.unreadCount}</span>
                  )}
                </div>
              </div>
              <button
                className="wa-archive-btn"
                onClick={(e) => { e.stopPropagation(); toggleArchiveChat(chat.id, chat.archived || false); }}
                title={chat.archived ? 'Desarquivar' : 'Arquivar'}
              >
                {chat.archived ? '📤' : '📥'}
              </button>
            </div>
          ))}
          {filteredChats.length === 0 && (
            <div className="p-4 text-center text-gray-400">
              {searchQuery ? 'Nenhuma conversa encontrada' : activeTab === 'ativas' ? 'Nenhuma conversa ativa' : 'Nenhuma conversa arquivada'}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="wa-main">
        {selectedChat ? (
          <>
            <div className="wa-header">
              <div className="wa-header-left">
                <button className="wa-input-icon-btn" onClick={() => setSelectedChat(null)} style={{ display: 'none' }}>
                  <ArrowLeft size={20} />
                </button>
                {chatDetails?.avatar ? (
                  <img src={chatDetails.avatar} alt={chatDetails.displayName} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <User className="text-gray-400" size={24} />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-medium text-gray-800 truncate">
                    {chatDetails?.displayName || chats.find(c => c.id === selectedChat)?.displayName || selectedChat.split('@')[0]}
                  </h3>
                  <p className={`wa-header-status ${presenceMap[selectedChat] === 'available' ? 'online' : ''}`}>
                    {selectedChat?.endsWith('@g.us') 
                      ? `${chatDetails?.participants?.length || 0} participantes`
                      : typingJids.has(selectedChat) 
                        ? 'digitando...' 
                        : presenceMap[selectedChat] === 'available' 
                          ? 'online' 
                          : presenceMap[selectedChat] === 'composing'
                            ? 'digitando...'
                            : 'visto por último ' + (presenceMap[selectedChat] ? 'recentemente' : '')}
                  </p>
                </div>
              </div>
              <div className="wa-header-right">
                <Phone size={20} className="cursor-pointer" />
                <Search size={20} className="cursor-pointer" />
                <MoreHorizontal 
                  size={20} 
                  className="cursor-pointer"
                  onClick={(e) => setContextMenu({ x: e.clientX, y: e.clientY, chatId: selectedChat, isGroup: selectedChat.endsWith('@g.us') })}
                />
              </div>
            </div>

            {/* Messages Area */}
            <div className="wa-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
              {hasMoreMessages && messages.length > 0 && (
                <div className="wa-load-more-container">
                  {isLoadingMore ? (
                    <div className="wa-load-more">
                      <div className="w-5 h-5 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
                      <span>Carregando mensagens...</span>
                    </div>
                  ) : (
                    <button className="wa-load-more-btn" onClick={loadMoreMessages}>
                      <ChevronUp size={16} />
                      <span>Carregar mensagens anteriores</span>
                    </button>
                  )}
                </div>
              )}
              
              {!hasMoreMessages && messages.length > 0 && (
                <div className="wa-no-more"><span>Início da conversa</span></div>
              )}

              {/* Filter out reaction messages for the main list */}
              {messages.filter(m => m._type !== 'reaction').map((msg, idx, arr) => {
                const isGroup = selectedChat?.endsWith('@g.us');
                const showSenderName = isGroup && !msg.key.fromMe;
                const prevMsg = idx > 0 ? arr[idx - 1] : null;
                const showDate = !prevMsg || getDateLabel(msg.messageTimestamp) !== getDateLabel(prevMsg.messageTimestamp);
                const isContinuation = prevMsg && prevMsg.key.fromMe === msg.key.fromMe;

                const reactions = messages.filter(m => 
                  m._type === 'reaction' && m._reactionTo?.id === msg.key.id
                );

                const receiptStatus = receipts[msg.key.id];
                const showChecks = msg.key.fromMe;

                return (
                  <React.Fragment key={msg.key.id || idx}>
                    {showDate && (
                      <div className="wa-date-separator">
                        <span>{getDateLabel(msg.messageTimestamp)}</span>
                      </div>
                    )}
                    <motion.div 
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`wa-bubble ${msg.key.fromMe ? 'wa-bubble-self' : 'wa-bubble-other'} ${isContinuation ? 'wa-bubble-continuation' : ''}`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, messageId: msg.key.id, isGroup: !!isGroup });
                      }}
                    >
                      {/* Reply indicator */}
                      {msg._replyTo && (
                        <div className="wa-reply-indicator">
                          <div className="wa-reply-indicator-bar"></div>
                          <div className="wa-reply-indicator-content">
                            <div className="wa-reply-indicator-name">Você</div>
                            <div className="wa-reply-indicator-text">{msg._replyTo.text}</div>
                          </div>
                        </div>
                      )}
                      
                      {/* Sender name for groups */}
                      {showSenderName && (
                        <div className="wa-sender-name" style={{ color: `hsl(${(msg.participant || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 70%, 40%)` }}>
                          {getSenderName(msg)}
                        </div>
                      )}
                      
                      {renderMessageContent(msg)}
                      
                      {/* Reactions */}
                      {reactions.length > 0 && (
                        <div className="wa-message-reactions">
                          {reactions.map((r, ri) => (
                            <span key={ri} className="wa-inline-reaction" onClick={() => handleSendReaction(msg.key.id, r._text || '')}>
                              {r._text}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Reaction trigger on hover */}
                      <button 
                        className="wa-reaction-trigger"
                        onClick={() => handleSendReaction(msg.key.id, '👍')}
                        title="Reagir"
                      >
                        <Smile size={14} />
                      </button>
                      
                      {/* Time + delivery status */}
                      <div className="wa-message-meta">
                        <span className="wa-message-time">{formatTime(msg.messageTimestamp)}</span>
                        {showChecks && (
                          <span className="wa-message-check">
                            {receiptStatus === 'read' ? (
                              <CheckCheck size={14} className="wa-check-read" />
                            ) : receiptStatus === 'delivered' ? (
                              <CheckCheck size={14} className="wa-check-delivered" />
                            ) : (
                              <Check size={14} className="wa-check-sent" />
                            )}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Media Preview */}
            {mediaPreview && (
              <div className="wa-media-preview">
                {mediaPreview.type === 'image' ? (
                  <img src={mediaPreview.url} className="wa-media-preview-thumb" alt="Preview" />
                ) : mediaPreview.type === 'video' ? (
                  <div className="wa-media-preview-icon"><Video size={24} /></div>
                ) : mediaPreview.type === 'audio' ? (
                  <div className="wa-media-preview-icon"><Music size={24} /></div>
                ) : (
                  <div className="wa-media-preview-icon"><FileText size={24} /></div>
                )}
                <div className="wa-media-preview-info">
                  <div className="wa-media-preview-name">{mediaPreview.file.name}</div>
                  <div className="wa-media-preview-size">{formatFileSize(mediaPreview.file.size)}</div>
                </div>
                {mediaPreview.type !== 'audio' && (
                  <input
                    className="wa-media-preview-caption"
                    placeholder="Adicionar legenda..."
                    value={mediaCaption}
                    onChange={e => setMediaCaption(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendMedia()}
                  />
                )}
                <motion.button whileTap={{ scale: 0.9 }} onClick={handleSendMedia} className="wa-send-btn active">
                  <Send size={22} />
                </motion.button>
                <button className="wa-media-preview-cancel" onClick={() => { setMediaPreview(null); setMediaCaption(''); }}>
                  <X size={20} />
                </button>
              </div>
            )}

            {/* Reply Preview */}
            {replyTo && (
              <div className="wa-reply-preview">
                <div className="wa-reply-preview-content">
                  <div className="wa-reply-preview-name">{replyTo.sender}</div>
                  <div className="wa-reply-preview-text">{replyTo.text}</div>
                </div>
                <button className="wa-reply-preview-close" onClick={() => setReplyTo(null)}>
                  <XCircle size={18} />
                </button>
              </div>
            )}

            {/* Emoji Picker */}
            {emojiPickerOpen && (
              <div className="wa-emoji-picker" ref={emojiPickerRef}>
                <div className="wa-emoji-picker-header">
                  <input
                    className="wa-emoji-picker-search"
                    placeholder="Pesquisar emoji..."
                    value={emojiSearch}
                    onChange={e => setEmojiSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="wa-emoji-categories">
                  {Object.keys(emojiData).map(cat => (
                    <button
                      key={cat}
                      className={`wa-emoji-category-btn ${emojiCategory === cat ? 'active' : ''}`}
                      onClick={() => setEmojiCategory(cat)}
                      title={cat}
                    >
                      {emojiData[cat][0]}
                    </button>
                  ))}
                </div>
                <div className="wa-emoji-grid">
                  {Object.entries(emojiData).map(([cat, emojis]) => {
                    const filtered = emojiSearch
                      ? emojis // In real app, would filter by name
                      : emojis;
                    if (emojiSearch || emojiCategory === cat) {
                      return (
                        <React.Fragment key={cat}>
                          {!emojiSearch && <div className="wa-emoji-section-title">{cat}</div>}
                          {filtered.map((emoji, i) => (
                            <button
                              key={`${cat}-${i}`}
                              className="wa-emoji-btn"
                              onClick={() => {
                                setInputText(prev => prev + emoji);
                                setEmojiPickerOpen(false);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </React.Fragment>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}

            {/* Input Area */}
            {!mediaPreview && (
              <div className="wa-input-area">
                <button 
                  className="wa-input-icon-btn"
                  onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                >
                  <Smile size={24} />
                </button>
                
                <button 
                  className="wa-input-icon-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={24} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
                
                {isRecording ? (
                  <div className="wa-recording-indicator">
                    <div className="wa-recording-dot"></div>
                    <span className="wa-recording-text">Gravando...</span>
                    <span className="wa-recording-timer">{formatRecordingTime(recordingTime)}</span>
                  </div>
                ) : (
                  <div className="wa-input-wrapper">
                    <textarea
                      className="wa-input"
                      placeholder="Digite uma mensagem"
                      value={inputText}
                      onChange={handleInputChange}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                      }}
                      rows={1}
                      style={{ height: 'auto', minHeight: '24px', maxHeight: '100px' }}
                    />
                  </div>
                )}
                
                {inputText.trim() ? (
                  <motion.button whileTap={{ scale: 0.9 }} onClick={handleSendMessage} className="wa-send-btn active">
                    <Send size={24} />
                  </motion.button>
                ) : isRecording ? (
                  <motion.button whileTap={{ scale: 0.9 }} onClick={stopRecording} className="wa-send-btn">
                    <StopCircle size={24} style={{ color: '#ea0038' }} />
                  </motion.button>
                ) : (
                  <motion.button 
                    whileTap={{ scale: 0.9 }} 
                    onMouseDown={startRecording}
                    className="wa-send-btn"
                  >
                    <Mic size={24} />
                  </motion.button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="wa-empty-state">
            <div className="w-64 h-64 bg-[#f0f2f5] rounded-full flex items-center justify-center mb-8" style={{ opacity: 0.4 }}>
              <MessageSquare size={100} className="text-gray-400" />
            </div>
            <h2>WhatsApp Web</h2>
            <p>
              Envie e receba mensagens sem precisar manter seu celular conectado. 
              Use o WhatsApp em até 4 aparelhos conectados e um celular ao mesmo tempo.
            </p>
            <div className="wa-empty-state-footer">
              <CheckCheck size={14} /> Protegido com criptografia de ponta a ponta
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="wa-context-menu-overlay" onClick={() => setContextMenu(null)} />
          <div className="wa-context-menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 300) }}>
            {contextMenu.messageId ? (
              <>
                <div className="wa-context-menu-item" onClick={() => {
                  const msg = messages.find(m => m.key.id === contextMenu.messageId);
                  if (msg) handleReply(msg);
                }}>
                  <Reply size={18} /> Responder
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  const msg = messages.find(m => m.key.id === contextMenu.messageId);
                  if (msg) handleCopyMessage(msg._text);
                }}>
                  <Copy size={18} /> Copiar
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  handleSendReaction(contextMenu.messageId!, '👍');
                }}>
                  <span style={{ fontSize: 18 }}>👍</span> Reagir
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  handleSendReaction(contextMenu.messageId!, '❤️');
                }}>
                  <span style={{ fontSize: 18 }}>❤️</span> Curtir
                </div>
                <div className="wa-context-menu-item danger" onClick={() => handleDeleteMessage(contextMenu.messageId!)}>
                  <Trash2 size={18} /> Deletar
                </div>
              </>
            ) : contextMenu.chatId ? (
              <>
                <div className="wa-context-menu-item" onClick={() => {
                  toggleArchiveChat(contextMenu.chatId!, chats.find(c => c.id === contextMenu.chatId)?.archived || false);
                  setContextMenu(null);
                }}>
                  <Archive size={18} /> {chats.find(c => c.id === contextMenu.chatId)?.archived ? 'Desarquivar' : 'Arquivar'}
                </div>
                <div className="wa-context-menu-item" onClick={() => { setContextMenu(null); showToast('Chat silenciado'); }}>
                  <span style={{ fontSize: 18 }}>🔇</span> Silenciar
                </div>
                <div className="wa-context-menu-item" onClick={() => { setContextMenu(null); showToast('Chat fixado'); }}>
                  <span style={{ fontSize: 18 }}>📌</span> Fixar conversa
                </div>
                <div className="wa-context-menu-item danger" onClick={() => {
                  if (contextMenu.chatId) {
                    setChats(prev => prev.filter(c => c.id !== contextMenu.chatId));
                    if (selectedChat === contextMenu.chatId) setSelectedChat(null);
                  }
                  setContextMenu(null);
                }}>
                  <Trash2 size={18} /> Apagar conversa
                </div>
              </>
            ) : null}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && <div className="wa-toast">{toast}</div>}
    </div>
  );
}
