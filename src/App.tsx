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
  Play,
  Moon,
  Sun,
  Bell,
  Keyboard,
  Settings,
  Users,
  Tv,
  CircleDot,
  MessageSquarePlus,
  Pin,
  VolumeX,
  Filter,
  Star,
  MessageCircle,
  Pencil,
  Eye,
  EyeOff,
  Clock,
  Lock,
  Globe,
  UserPlus,
  UserMinus,
  Shield,
  Link,
  Megaphone,
  Hash,
  Download,
  Ban,
  RotateCcw,
  Plus,
  MapPin,
  Contact,
  BarChart3
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
      caption?: string;
    };
    videoMessage?: {
      jpegThumbnail?: string;
      caption?: string;
    };
    stickerMessage?: {};
    audioMessage?: {};
    documentMessage?: {
      fileName?: string;
    };
    contactMessage?: {
      displayName?: string;
    };
    locationMessage?: {};
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
      title?: string;
      description?: string;
      jpegThumbnail?: string;
      matchedText?: string;
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
      seconds?: number;
      contextInfo?: MessageContextInfo;
    };
    audioMessage?: {
      url?: string;
      mimetype?: string;
      ptt?: boolean;
      seconds?: number;
    };
    stickerMessage?: {
      url?: string;
      mimetype?: string;
      isAnimated?: boolean;
    };
    documentMessage?: {
      fileName?: string;
      mimetype?: string;
      title?: string;
      pageCount?: number;
      fileSize?: string | number;
      contextInfo?: MessageContextInfo;
    };
    documentWithCaptionMessage?: {
      message?: {
        documentMessage?: {
          fileName?: string;
          mimetype?: string;
          caption?: string;
        };
      };
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
    protocolMessage?: {
      type?: number;
      key?: {
        remoteJid?: string;
        id?: string;
        fromMe?: boolean;
      };
      editedMessage?: {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { caption?: string };
        videoMessage?: { caption?: string };
      };
    };
    senderKeyDistributionMessage?: {
      groupId?: string;
    };
    albumMessage?: {
      expectedImageCount?: number;
      expectedVideoCount?: number;
    };
    locationMessage?: {
      degreesLatitude?: number;
      degreesLongitude?: number;
      name?: string;
      address?: string;
      url?: string;
      jpegThumbnail?: string;
    };
    liveLocationMessage?: {
      degreesLatitude?: number;
      degreesLongitude?: number;
      caption?: string;
      jpegThumbnail?: string;
      sequenceNumber?: number;
    };
    contactMessage?: {
      displayName?: string;
      vcard?: string;
    };
    contactsArrayMessage?: {
      displayName?: string;
      contacts?: Array<{
        displayName?: string;
        vcard?: string;
      }>;
    };
    listMessage?: {
      title?: string;
      description?: string;
      buttonText?: string;
      footerText?: string;
      sections?: Array<{
        title?: string;
        rows?: Array<{
          title?: string;
          description?: string;
        }>;
      }>;
    };
    listResponseMessage?: {
      title?: string;
      singleSelectReply?: {
        selectedRowId?: string;
      };
      contextInfo?: MessageContextInfo;
    };
    buttonsMessage?: {
      contentText?: string;
      footerText?: string;
      headerType?: number;
      buttons?: Array<{
        buttonId?: string;
        buttonText?: { displayText?: string };
        type?: number;
      }>;
    };
    buttonsResponseMessage?: {
      selectedButtonId?: string;
      selectedDisplayText?: string;
      contextInfo?: MessageContextInfo;
    };
    templateMessage?: {
      hydratedTemplate?: {
        hydratedContentText?: string;
        hydratedFooterText?: string;
        hydratedButtons?: Array<{
          index?: number;
          quickReplyButton?: { displayText?: string };
          urlButton?: { displayText?: string; url?: string };
          callButton?: { displayText?: string; phoneNumber?: string };
        }>;
      };
    };
    templateButtonReplyMessage?: {
      selectedId?: string;
      selectedDisplayText?: string;
      contextInfo?: MessageContextInfo;
    };
    groupInviteMessage?: {
      groupJid?: string;
      inviteCode?: string;
      inviteExpiration?: number;
      groupName?: string;
      jpegThumbnail?: string;
      caption?: string;
    };
    productMessage?: {
      product?: {
        title?: string;
        description?: string;
        currencyCode?: string;
        priceAmount1000?: number;
        productImage?: {
          jpegThumbnail?: string;
        };
      };
    };
    orderMessage?: {
      orderId?: string;
      thumbnail?: string;
      itemCount?: number;
      status?: number;
      surface?: number;
      message?: string;
      orderTitle?: string;
      sellerJid?: string;
      token?: string;
    };
    pollCreationMessage?: {
      name?: string;
      options?: Array<{
        optionName?: string;
      }>;
    };
    viewOnceMessage?: {
      message?: any;
    };
    viewOnceMessageV2?: {
      message?: any;
    };
    ephemeralMessage?: {
      message?: any;
    };
    editedMessage?: {
      message?: {
        protocolMessage?: {
          type?: number;
          key?: any;
          editedMessage?: any;
          timestampMs?: number;
        };
      };
    };
    ptvMessage?: {
      url?: string;
      mimetype?: string;
      caption?: string;
      jpegThumbnail?: string;
      seconds?: number;
    };
    call?: {
      callKey?: Uint8Array;
      conversionSource?: string;
      conversionData?: Uint8Array;
      conversionDelaySeconds?: number;
    };
  };
  messageTimestamp?: number;
  pushName?: string;
  broadcast?: boolean;
  participant?: string;
  messageContextInfo?: MessageContextInfo;
  status?: number;
  messageStubType?: number;
  messageStubParameters?: string[];
}

interface Message extends WAMessage {
  // Normalized fields for easier access
  _type?: 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'reaction' | 'location' | 'liveLocation' | 'contact' | 'contacts' | 'list' | 'listResponse' | 'buttons' | 'buttonsResponse' | 'template' | 'groupInvite' | 'poll' | 'product' | 'order' | 'deleted' | 'edited' | 'system' | 'viewOnce' | 'ephemeral' | 'call' | 'ptv' | 'album' | 'unknown';
  _text?: string;
  _mediaUrl?: string;
  _thumbnail?: string;
  _isPTT?: boolean;
  _duration?: number;
  _replyTo?: {
    text?: string;
    stanzaId?: string;
    author?: string;
    isMedia?: boolean;
    mediaType?: string;
    thumbnail?: string;
  };
  _mentions?: string[];
  _reactionTo?: {
    remoteJid?: string;
    id?: string;
    fromMe?: boolean;
    participant?: string;
  };
  _linkPreview?: {
    title?: string;
    description?: string;
    thumbnail?: string;
    matchedText?: string;
    canonicalUrl?: string;
  };
  _location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  _contactInfo?: {
    displayName?: string;
    vcard?: string;
    count?: number;
  };
  _pollOptions?: string[];
  _interactiveContent?: {
    title?: string;
    description?: string;
    buttonText?: string;
    footerText?: string;
    buttons?: string[];
  };
  _groupInvite?: {
    groupName?: string;
    inviteCode?: string;
    inviteExpiration?: number;
  };
  _isViewOnce?: boolean;
  _isEphemeral?: boolean;
  _isDeleted?: boolean;
  _editedText?: string;
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
  lastMessageStatus?: string; // 'sent' | 'delivered' | 'read' | 'played'
  description?: string;
  archived?: boolean;
  archive?: boolean;
  pinned?: boolean;
  pinnedAt?: number;
  muted?: boolean;
  ephemeralExpiration?: number;
}

interface ChatDetails {
  jid: string;
  displayName?: string;
  avatar?: string | null;
  participants?: any[];
  description?: string;
}

// Helper to build media proxy URL
const getMediaProxyUrl = (msg: WAMessage): string => {
  const jid = msg.key.remoteJid;
  const messageId = msg.key.id;
  return `/api/media/${encodeURIComponent(jid)}/${encodeURIComponent(messageId)}`;
};

// Helper to extract clean phone number from JID (removes device suffix)
const getPhoneNumber = (jid: string): string => {
  if (!jid) return '';
  // Remove @s.whatsapp.net, @g.us, @lid, etc.
  const base = jid.split('@')[0];
  // Remove device suffix like :5 or :12
  return base.split(':')[0];
};

// Helper to extract quoted message text from various types
const getQuotedMessageText = (quoted: any): string => {
  if (!quoted) return '[Mídia]';
  if (quoted.conversation) return quoted.conversation;
  if (quoted.extendedTextMessage?.text) return quoted.extendedTextMessage.text;
  if (quoted.imageMessage) return quoted.imageMessage.caption || '📷 Foto';
  if (quoted.videoMessage) return quoted.videoMessage.caption || '🎥 Vídeo';
  if (quoted.audioMessage) return quoted.audioMessage.ptt ? '🎤 Áudio' : '🎵 Áudio';
  if (quoted.stickerMessage) return '🎨 Sticker';
  if (quoted.documentMessage) return `📄 ${quoted.documentMessage.fileName || 'Documento'}`;
  if (quoted.contactMessage) return `👤 ${quoted.contactMessage.displayName || 'Contato'}`;
  if (quoted.locationMessage) return '📍 Localização';
  if (quoted.pollCreationMessage) return `📊 ${quoted.pollCreationMessage.name || 'Enquete'}`;
  if (quoted.liveLocationMessage) return '📍 Localização em tempo real';
  return '[Mídia]';
};

// Helper to extract full reply details from quoted message
const getReplyDetails = (quoted: any): { text: string; isMedia: boolean; mediaType?: string; thumbnail?: string } => {
  if (!quoted) return { text: '[Mídia]', isMedia: false };
  if (quoted.conversation) return { text: quoted.conversation, isMedia: false };
  if (quoted.extendedTextMessage?.text) return { text: quoted.extendedTextMessage.text, isMedia: false };
  if (quoted.imageMessage) return { 
    text: quoted.imageMessage.caption || '📷 Foto', 
    isMedia: true, 
    mediaType: 'image',
    thumbnail: quoted.imageMessage.jpegThumbnail
  };
  if (quoted.videoMessage) return { 
    text: quoted.videoMessage.caption || '🎥 Vídeo', 
    isMedia: true, 
    mediaType: 'video',
    thumbnail: quoted.videoMessage.jpegThumbnail
  };
  if (quoted.audioMessage) return { 
    text: quoted.audioMessage.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio', 
    isMedia: true, 
    mediaType: 'audio'
  };
  if (quoted.stickerMessage) return { text: '🎨 Sticker', isMedia: true, mediaType: 'sticker' };
  if (quoted.documentMessage) return { 
    text: `📄 ${quoted.documentMessage.fileName || 'Documento'}`, 
    isMedia: true, 
    mediaType: 'document'
  };
  if (quoted.contactMessage) return { text: `👤 ${quoted.contactMessage.displayName || 'Contato'}`, isMedia: false };
  if (quoted.locationMessage) return { text: '📍 Localização', isMedia: true, mediaType: 'location' };
  if (quoted.liveLocationMessage) return { text: '📍 Localização em tempo real', isMedia: true, mediaType: 'location' };
  if (quoted.pollCreationMessage) return { text: `📊 ${quoted.pollCreationMessage.name || 'Enquete'}`, isMedia: false };
  return { text: '[Mídia]', isMedia: false };
};

// Handle wrapped messages (viewOnce, ephemeral, documentWithCaption, etc.)
// Convert group system message stubType to human-readable text
const getStubTypeText = (stubType: number, params: string[]): string => {
  const getName = (param?: string): string => {
    if (!param) return 'Alguém';
    try {
      const parsed = JSON.parse(param);
      return getPhoneNumber(parsed.id || param);
    } catch {
      return getPhoneNumber(param);
    }
  };

  switch (stubType) {
    case 20: return '📋 Grupo criado';
    case 21: return `📝 Nome do grupo alterado para "${params[0] || ''}"`;
    case 22: return '🖼️ Foto do grupo alterada';
    case 23: return '🔗 Link de convite alterado';
    case 24: return '📝 Descrição do grupo alterada';
    case 25: return params[0] === 'on' 
      ? '🔒 Somente admins podem editar informações do grupo'
      : '🔓 Todos podem editar informações do grupo';
    case 26: return params[0] === 'on'
      ? '📢 Somente admins podem enviar mensagens'
      : '💬 Todos podem enviar mensagens';
    case 27: return params.map(p => `${getName(p)} entrou no grupo`).join(', ');
    case 28: return params.map(p => `${getName(p)} foi removido(a) do grupo`).join(', ');
    case 29: return params.map(p => `${getName(p)} agora é admin`).join(', ');
    case 30: return params.map(p => `${getName(p)} não é mais admin`).join(', ');
    case 31: return params.map(p => `${getName(p)} foi convidado(a)`).join(', ');
    case 32: return params.map(p => `${getName(p)} saiu do grupo`).join(', ');
    case 33: return '📱 Número de telefone alterado';
    case 43: return '🗑️ Grupo foi excluído';
    case 69: return params[0] === 'on'
      ? '📤 Encaminhamento limitado ativado'
      : '📤 Encaminhamento limitado desativado';
    case 71: return params.map(p => `${getName(p)} solicitou entrar no grupo`).join(', ');
    case 140: return params.map(p => `${getName(p)} aceitou o convite`).join(', ');
    case 144: return params.map(p => `${getName(p)} solicitou entrar`).join(', ');
    default: return `[Notificação do grupo (tipo ${stubType})]`;
  }
};

const unwrapMessage = (msg: WAMessage): WAMessage => {
  const message = msg.message;
  if (!message) return msg;

  // Unwrap viewOnceMessage
  if (message.viewOnceMessage?.message) {
    return { ...msg, message: message.viewOnceMessage.message };
  }
  // Unwrap viewOnceMessageV2
  if (message.viewOnceMessageV2?.message) {
    return { ...msg, message: message.viewOnceMessageV2.message };
  }
  // Unwrap ephemeralMessage
  if (message.ephemeralMessage?.message) {
    return { ...msg, message: message.ephemeralMessage.message };
  }
  // Unwrap documentWithCaptionMessage
  if (message.documentWithCaptionMessage?.message) {
    return { ...msg, message: message.documentWithCaptionMessage.message };
  }
  return msg;
};

// Helper to extract message content and determine type
const normalizeMessage = (inputMsg: WAMessage): Message => {
  const msg = unwrapMessage(inputMsg);
  const normalized: Message = { ...msg, message: msg.message };
  
  // Handle group system messages (stub types)
  if (msg.messageStubType) {
    normalized._type = 'system';
    normalized._text = getStubTypeText(msg.messageStubType, msg.messageStubParameters || []);
    return normalized;
  }
  
  // Track if it's a wrapped message
  const isWrapped = msg !== inputMsg;
  if (inputMsg.message?.viewOnceMessage || inputMsg.message?.viewOnceMessageV2) {
    normalized._isViewOnce = true;
  }
  if (inputMsg.message?.ephemeralMessage) {
    normalized._isEphemeral = true;
  }

  // Check for text message (conversation or extendedTextMessage)
  if (msg.message?.conversation) {
    normalized._type = 'text';
    normalized._text = msg.message.conversation;
  } else if (msg.message?.extendedTextMessage) {
    normalized._type = 'text';
    normalized._text = msg.message.extendedTextMessage.text;
    
    // Extract link preview info
    const etm = msg.message.extendedTextMessage;
    if (etm.title || etm.description || etm.jpegThumbnail || etm.matchedText) {
      normalized._linkPreview = {
        title: etm.title,
        description: etm.description,
        thumbnail: etm.jpegThumbnail,
        matchedText: etm.matchedText,
        canonicalUrl: etm.matchedText
      };
    }
    
    if (etm.contextInfo?.quotedMessage) {
      const quoted = etm.contextInfo.quotedMessage;
      const replyDetails = getReplyDetails(quoted);
      normalized._replyTo = {
        text: replyDetails.text,
        stanzaId: etm.contextInfo.stanzaId,
        author: etm.contextInfo.participant,
        isMedia: replyDetails.isMedia,
        mediaType: replyDetails.mediaType,
        thumbnail: replyDetails.thumbnail
      };
    }
    // Check for mentions in contextInfo
    if (etm.contextInfo?.mentionedJid) {
      normalized._mentions = etm.contextInfo.mentionedJid;
    }
  }
  // Image message
  else if (msg.message?.imageMessage) {
    normalized._type = 'image';
    normalized._mediaUrl = getMediaProxyUrl(msg);
    normalized._thumbnail = msg.message.imageMessage.jpegThumbnail;
    normalized._text = msg.message.imageMessage.caption || '';
    if (msg.message.imageMessage?.contextInfo?.mentionedJid) {
      normalized._mentions = msg.message.imageMessage.contextInfo.mentionedJid;
    }
    if (msg.message.imageMessage?.contextInfo?.quotedMessage) {
      const qi = msg.message.imageMessage.contextInfo;
      const rd = getReplyDetails(qi.quotedMessage);
      normalized._replyTo = {
        text: rd.text,
        stanzaId: qi.stanzaId,
        author: qi.participant,
        isMedia: rd.isMedia,
        mediaType: rd.mediaType,
        thumbnail: rd.thumbnail
      };
    }
  }
  // Video message
  else if (msg.message?.videoMessage) {
    normalized._type = 'video';
    normalized._mediaUrl = getMediaProxyUrl(msg);
    normalized._thumbnail = msg.message.videoMessage.jpegThumbnail;
    normalized._text = msg.message.videoMessage.caption || '';
    normalized._duration = msg.message.videoMessage.seconds;
    if (msg.message.videoMessage?.contextInfo?.mentionedJid) {
      normalized._mentions = msg.message.videoMessage.contextInfo.mentionedJid;
    }
    if (msg.message.videoMessage?.contextInfo?.quotedMessage) {
      const qi = msg.message.videoMessage.contextInfo;
      const rd = getReplyDetails(qi.quotedMessage);
      normalized._replyTo = {
        text: rd.text,
        stanzaId: qi.stanzaId,
        author: qi.participant,
        isMedia: rd.isMedia,
        mediaType: rd.mediaType,
        thumbnail: rd.thumbnail
      };
    }
  }
  // PTV message (push-to-video)
  else if (msg.message?.ptvMessage) {
    normalized._type = 'ptv';
    normalized._mediaUrl = getMediaProxyUrl(msg);
    normalized._thumbnail = msg.message.ptvMessage.jpegThumbnail;
    normalized._duration = msg.message.ptvMessage.seconds;
    normalized._text = msg.message.ptvMessage.caption || '';
  }
  // Audio message
  else if (msg.message?.audioMessage) {
    normalized._type = 'audio';
    normalized._mediaUrl = getMediaProxyUrl(msg);
    normalized._isPTT = msg.message.audioMessage.ptt;
    normalized._duration = msg.message.audioMessage.seconds;
    normalized._text = msg.message.audioMessage.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio';
  }
  // Sticker message
  else if (msg.message?.stickerMessage) {
    normalized._type = 'sticker';
    normalized._mediaUrl = getMediaProxyUrl(msg);
    normalized._text = 'Sticker';
  }
  // Document message
  else if (msg.message?.documentMessage) {
    normalized._type = 'document';
    normalized._text = msg.message.documentMessage.fileName || msg.message.documentMessage.title || 'Documento';
    if (msg.message.documentMessage?.contextInfo?.quotedMessage) {
      normalized._replyTo = {
        text: getQuotedMessageText(msg.message.documentMessage.contextInfo.quotedMessage),
        stanzaId: msg.message.documentMessage.contextInfo.stanzaId
      };
    }
  }
  // Reaction message
  else if (msg.message?.reactionMessage) {
    normalized._type = 'reaction';
    normalized._text = msg.message.reactionMessage.text || '';
    normalized._reactionTo = msg.message.reactionMessage.key;
  }
  // Protocol message (deletions, edits, etc.)
  else if (msg.message?.protocolMessage) {
    const pmType = msg.message.protocolMessage.type;
    // Type 0 = REVOKE (deleted message)
    if (pmType === 0) {
      normalized._type = 'deleted';
      normalized._isDeleted = true;
      normalized._text = '🚫 Essa mensagem foi apagada';
    }
    // Type 14 = EPHEMERAL setting
    else if (pmType === 14) {
      normalized._type = 'system';
      normalized._text = '⏱️ Mensagens temporárias ativadas';
    }
    else {
      normalized._type = 'system';
      normalized._text = 'ℹ️ Atualização de mensagem';
    }
  }
  // Edited message
  else if (msg.message?.editedMessage?.message?.protocolMessage) {
    const editedProto = msg.message.editedMessage.message.protocolMessage;
    const edited = editedProto.editedMessage;
    normalized._type = 'edited';
    if (edited?.conversation) {
      normalized._text = edited.conversation;
      normalized._editedText = edited.conversation;
    } else if (edited?.extendedTextMessage?.text) {
      normalized._text = edited.extendedTextMessage.text;
      normalized._editedText = edited.extendedTextMessage.text;
    } else if (edited?.imageMessage?.caption) {
      normalized._text = edited.imageMessage.caption;
    } else if (edited?.videoMessage?.caption) {
      normalized._text = edited.videoMessage.caption;
    } else {
      normalized._text = '✏️ Mensagem editada';
    }
  }
  // Location message
  else if (msg.message?.locationMessage) {
    normalized._type = 'location';
    const loc = msg.message.locationMessage;
    normalized._location = {
      latitude: loc.degreesLatitude,
      longitude: loc.degreesLongitude,
      name: loc.name,
      address: loc.address
    };
    normalized._text = loc.name || loc.address || '📍 Localização';
    normalized._thumbnail = loc.jpegThumbnail;
  }
  // Live location message
  else if (msg.message?.liveLocationMessage) {
    normalized._type = 'liveLocation';
    const loc = msg.message.liveLocationMessage;
    normalized._location = {
      latitude: loc.degreesLatitude,
      longitude: loc.degreesLongitude,
      name: loc.caption || 'Localização em tempo real'
    };
    normalized._text = loc.caption || '📍 Localização em tempo real';
    normalized._thumbnail = loc.jpegThumbnail;
  }
  // Contact message
  else if (msg.message?.contactMessage) {
    normalized._type = 'contact';
    normalized._contactInfo = {
      displayName: msg.message.contactMessage.displayName,
      vcard: msg.message.contactMessage.vcard
    };
    normalized._text = `👤 ${msg.message.contactMessage.displayName || 'Contato'}`;
  }
  // Contacts array message
  else if (msg.message?.contactsArrayMessage) {
    normalized._type = 'contacts';
    const contacts = msg.message.contactsArrayMessage.contacts || [];
    normalized._contactInfo = {
      displayName: msg.message.contactsArrayMessage.displayName,
      count: contacts.length
    };
    normalized._text = `👥 ${contacts.length} contato${contacts.length !== 1 ? 's' : ''}`;
  }
  // Poll creation message
  else if (msg.message?.pollCreationMessage) {
    normalized._type = 'poll';
    const poll = msg.message.pollCreationMessage;
    normalized._text = `📊 ${poll.name || 'Enquete'}`;
    normalized._pollOptions = (poll.options || []).map(o => o.optionName || '');
  }
  // List message
  else if (msg.message?.listMessage) {
    normalized._type = 'list';
    const list = msg.message.listMessage;
    normalized._interactiveContent = {
      title: list.title,
      description: list.description,
      buttonText: list.buttonText,
      footerText: list.footerText
    };
    normalized._text = list.title || list.description || '📋 Lista';
  }
  // List response message
  else if (msg.message?.listResponseMessage) {
    normalized._type = 'listResponse';
    const resp = msg.message.listResponseMessage;
    normalized._text = resp.title || resp.singleSelectReply?.selectedRowId || '📋 Resposta de lista';
    if (resp.contextInfo?.quotedMessage) {
      normalized._replyTo = {
        text: getQuotedMessageText(resp.contextInfo.quotedMessage),
        stanzaId: resp.contextInfo.stanzaId
      };
    }
  }
  // Buttons message
  else if (msg.message?.buttonsMessage) {
    normalized._type = 'buttons';
    const btn = msg.message.buttonsMessage;
    normalized._interactiveContent = {
      title: btn.contentText,
      footerText: btn.footerText,
      buttons: (btn.buttons || []).map(b => b.buttonText?.displayText || '')
    };
    normalized._text = btn.contentText || '🔘 Mensagem com botões';
  }
  // Buttons response message
  else if (msg.message?.buttonsResponseMessage) {
    normalized._type = 'buttonsResponse';
    const resp = msg.message.buttonsResponseMessage;
    normalized._text = resp.selectedDisplayText || resp.selectedButtonId || '🔘 Resposta de botão';
    if (resp.contextInfo?.quotedMessage) {
      normalized._replyTo = {
        text: getQuotedMessageText(resp.contextInfo.quotedMessage),
        stanzaId: resp.contextInfo.stanzaId
      };
    }
  }
  // Template message
  else if (msg.message?.templateMessage) {
    normalized._type = 'template';
    const tmpl = msg.message.templateMessage.hydratedTemplate;
    if (tmpl) {
      normalized._interactiveContent = {
        title: tmpl.hydratedContentText,
        footerText: tmpl.hydratedFooterText,
        buttons: (tmpl.hydratedButtons || []).map(b => {
          if (b.quickReplyButton) return b.quickReplyButton.displayText || '';
          if (b.urlButton) return `${b.urlButton.displayText || '🔗'}`;
          if (b.callButton) return `📞 ${b.callButton.displayText || ''}`;
          return '';
        }).filter(Boolean)
      };
      normalized._text = tmpl.hydratedContentText || '📝 Template';
    } else {
      normalized._text = '📝 Template';
    }
  }
  // Template button reply message
  else if (msg.message?.templateButtonReplyMessage) {
    normalized._type = 'template';
    const resp = msg.message.templateButtonReplyMessage;
    normalized._text = resp.selectedDisplayText || resp.selectedId || '🔘 Resposta de template';
    if (resp.contextInfo?.quotedMessage) {
      normalized._replyTo = {
        text: getQuotedMessageText(resp.contextInfo.quotedMessage),
        stanzaId: resp.contextInfo.stanzaId
      };
    }
  }
  // Group invite message
  else if (msg.message?.groupInviteMessage) {
    normalized._type = 'groupInvite';
    const invite = msg.message.groupInviteMessage;
    normalized._groupInvite = {
      groupName: invite.groupName,
      inviteCode: invite.inviteCode,
      inviteExpiration: invite.inviteExpiration
    };
    normalized._text = invite.caption || `Convite para o grupo ${invite.groupName || ''}`;
    normalized._thumbnail = invite.jpegThumbnail;
  }
  // Product message
  else if (msg.message?.productMessage) {
    normalized._type = 'product';
    const prod = msg.message.productMessage.product;
    if (prod) {
      normalized._text = `🛒 ${prod.title || 'Produto'}`;
      normalized._thumbnail = prod.productImage?.jpegThumbnail;
    } else {
      normalized._text = '🛒 Produto';
    }
  }
  // Order message
  else if (msg.message?.orderMessage) {
    normalized._type = 'order';
    const order = msg.message.orderMessage;
    normalized._text = `📦 ${order.orderTitle || order.message || 'Pedido'}`;
    normalized._thumbnail = order.thumbnail;
  }
  // Call message
  else if (msg.message?.call) {
    normalized._type = 'call';
    normalized._text = '📞 Chamada';
  }
  // Album message
  else if (msg.message?.albumMessage) {
    normalized._type = 'album';
    const album = msg.message.albumMessage;
    const imgCount = album.expectedImageCount || 0;
    const vidCount = album.expectedVideoCount || 0;
    const parts: string[] = [];
    if (imgCount > 0) parts.push(`${imgCount} foto${imgCount !== 1 ? 's' : ''}`);
    if (vidCount > 0) parts.push(`${vidCount} vídeo${vidCount !== 1 ? 's' : ''}`);
    normalized._text = `📸 Álbum${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
  }
  // View once (should have been unwrapped, but just in case)
  else if (msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2) {
    normalized._type = 'viewOnce';
    normalized._text = '👀 Mensagem de visualização única';
  }
  // Ephemeral (should have been unwrapped, but just in case)
  else if (msg.message?.ephemeralMessage) {
    normalized._type = 'ephemeral';
    normalized._text = '⏱️ Mensagem temporária';
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
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'favorites' | 'groups'>('all');
  const [navRailSection, setNavRailSection] = useState<'chats' | 'status' | 'channels' | 'communities' | 'archived' | 'starred'>('chats');
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
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
  
  // Dark mode state
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('wa-dark-mode');
    return saved === 'true';
  });
  
  // Forward message state
  const [forwardModal, setForwardModal] = useState<{ messageId: string; text: string } | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardSelected, setForwardSelected] = useState<string[]>([]);
  const [forwarding, setForwarding] = useState(false);
  
  // Profile panel state
  const [profileOpen, setProfileOpen] = useState(false);
  
  // Keyboard shortcuts help
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  
  // Desktop notifications
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('wa-notifications') === 'true';
  });

  // New modals state
  const [muteModal, setMuteModal] = useState<string | null>(null); // chat jid
  const [ephemeralModal, setEphemeralModal] = useState<string | null>(null); // chat jid
  const [createGroupModal, setCreateGroupModal] = useState(false);
  const [groupManageModal, setGroupManageModal] = useState<string | null>(null); // group jid
  const [statusModal, setStatusModal] = useState(false);
  const [createChannelModal, setCreateChannelModal] = useState(false);
  const [channelDetailModal, setChannelDetailModal] = useState<string | null>(null);
  const [createCommunityModal, setCreateCommunityModal] = useState(false);
  const [communityManageModal, setCommunityManageModal] = useState<string | null>(null);
  const [broadcastModal, setBroadcastModal] = useState(false);
  const [businessProfileModal, setBusinessProfileModal] = useState(false);
  const [blockConfirmModal, setBlockConfirmModal] = useState<string | null>(null); // jid to block
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [messageSearchResults, setMessageSearchResults] = useState<any[]>([]);
  const [editMessageModal, setEditMessageModal] = useState<{ id: string; text: string } | null>(null);

  // Status data
  const [statuses, setStatuses] = useState<any[]>([]);
  const [statusText, setStatusText] = useState('');
  const [statusFile, setStatusFile] = useState<File | null>(null);

  // Newsletter/Channel data
  const [newsletters, setNewsletters] = useState<any[]>([]);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [channelMessages, setChannelMessages] = useState<any[]>([]);

  // Community data
  const [communities, setCommunities] = useState<any[]>([]);
  const [communityName, setCommunityName] = useState('');
  const [communityDesc, setCommunityDesc] = useState('');

  // Group management
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupParticipants, setNewGroupParticipants] = useState('');
  const [groupEditName, setGroupEditName] = useState('');
  const [groupEditDesc, setGroupEditDesc] = useState('');
  const [groupAddParticipant, setGroupAddParticipant] = useState('');

  // Broadcast
  const [broadcastRecipients, setBroadcastRecipients] = useState<string[]>([]);
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastSearch, setBroadcastSearch] = useState('');

  // Business
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [businessWebsite, setBusinessWebsite] = useState('');
  
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

  // Apply dark mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('wa-dark-mode', String(darkMode));
  }, [darkMode]);

  // Request notification permission
  useEffect(() => {
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    localStorage.setItem('wa-notifications', String(notificationsEnabled));
  }, [notificationsEnabled]);

  // Desktop notification for new messages
  const showDesktopNotification = useCallback((title: string, body: string) => {
    if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    // Don't show if tab is focused
    if (document.hasFocus()) return;
    try {
      new Notification(title, { body, icon: '/favicon.ico', tag: 'wa-message' });
    } catch {}
  }, [notificationsEnabled]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('.wa-sidebar input[type="text"]') as HTMLInputElement;
        searchInput?.focus();
      }
      // Ctrl/Cmd + F: Search messages in chat
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (selectedChatRef.current) {
          e.preventDefault();
          setMessageSearchOpen(true);
        }
      }
      // Ctrl/Cmd + D: Toggle dark mode
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        setDarkMode(prev => !prev);
      }
      // Ctrl/Cmd + E: Open emoji picker (when in chat)
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        setEmojiPickerOpen(prev => !prev);
      }
      // Escape: Close modals/panels
      if (e.key === 'Escape') {
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (forwardModal) { setForwardModal(null); return; }
        if (profileOpen) { setProfileOpen(false); return; }
        if (emojiPickerOpen) { setEmojiPickerOpen(false); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (replyTo) { setReplyTo(null); return; }
        if (editMessageModal) { setEditMessageModal(null); return; }
        if (messageSearchOpen) { setMessageSearchOpen(false); setMessageSearchQuery(''); return; }
        if (muteModal) { setMuteModal(null); return; }
        if (ephemeralModal) { setEphemeralModal(null); return; }
        if (createGroupModal) { setCreateGroupModal(false); return; }
        if (groupManageModal) { setGroupManageModal(null); return; }
        if (statusModal) { setStatusModal(false); return; }
        if (createChannelModal) { setCreateChannelModal(false); return; }
        if (createCommunityModal) { setCreateCommunityModal(false); return; }
        if (broadcastModal) { setBroadcastModal(false); return; }
        if (businessProfileModal) { setBusinessProfileModal(false); return; }
        if (blockConfirmModal) { setBlockConfirmModal(null); return; }
        if (channelDetailModal) { setChannelDetailModal(null); return; }
        if (communityManageModal) { setCommunityManageModal(null); return; }
      }
      // Ctrl/Cmd + /: Show shortcuts help
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      }
      // Ctrl/Cmd + N: Toggle notifications
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        setNotificationsEnabled(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsOpen, forwardModal, profileOpen, emojiPickerOpen, contextMenu, replyTo, editMessageModal, messageSearchOpen, muteModal, ephemeralModal, createGroupModal, groupManageModal, statusModal, createChannelModal, createCommunityModal, broadcastModal, businessProfileModal, blockConfirmModal, channelDetailModal, communityManageModal, selectedChat]);

  // Keep ref in sync with state
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  // Simple store for contacts (will be populated from server)
  const store = useRef({
    contacts: {} as Record<string, any>,
    lidMappings: {} as Record<string, string> // @lid JID -> @s.whatsapp.net JID
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
        // Fetch LID → Phone Number mappings
        fetch('/api/lid-mappings')
          .then(r => r.json())
          .then((mappings: Record<string, string>) => {
            store.current.lidMappings = { ...store.current.lidMappings, ...mappings };
          })
          .catch(() => {});
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
        // Re-sort after merge to ensure correct order (new chats may have been appended at end)
        return [...mergedChats, ...newChats].sort(
          (a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0)
        );
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
      } else if (!msg.key.fromMe) {
        // Show desktop notification for messages not in current chat
        const senderName = msg.pushName || 'Contato';
        const msgText = normalizedMsg._text || 'Mídia';
        showDesktopNotification(senderName, msgText.length > 50 ? msgText.slice(0, 50) + '...' : msgText);
      }
      
      // Update chat list (skip reactions - they should not appear as last message preview)
      if (normalizedMsg._type !== 'reaction') {
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
      }
    });

    newSocket.on('message-deleted', (data: { jid: string; messageId: string }) => {
      if (selectedChatRef.current === data.jid) {
        setMessages(prev => prev.map(m => 
          m.key.id === data.messageId 
            ? { ...m, _type: 'deleted' as const, _isDeleted: true, _text: '🚫 Essa mensagem foi apagada', message: undefined }
            : m
        ));
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
              name: contact.name || contact.notify || getPhoneNumber(contact.id),
              displayName: contact.name || contact.notify || getPhoneNumber(contact.id)
            };
          }
        });
        return updated;
      });
    });

    newSocket.on('lid-mappings', (mappings: Record<string, string>) => {
      store.current.lidMappings = { ...store.current.lidMappings, ...mappings };
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
          
          // Deduplicate before prepending (older messages go at the start), then sort chronologically
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.key.id).filter(Boolean));
            const uniqueOlder = normalizedOlder.filter(m => !m.key.id || !existingIds.has(m.key.id));
            return [...uniqueOlder, ...prev].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
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
    const participantJid = msg.participant || msg.key?.participant;
    if (participantJid) {
      const contact = store.current.contacts[participantJid];
      if (contact?.notify || contact?.name) return contact.notify || contact.name;
      // For @lid JIDs, try LID→PN mapping to find the real contact
      if (participantJid.endsWith('@lid')) {
        const mappedPn = store.current.lidMappings[participantJid];
        if (mappedPn) {
          const pnContact = store.current.contacts[mappedPn];
          if (pnContact?.notify || pnContact?.name) return pnContact.notify || pnContact.name;
          return getPhoneNumber(mappedPn);
        }
      }
      return getPhoneNumber(participantJid) || 'Usuário';
    }
    return 'Usuário';
  };

  // Get display name for chat in sidebar
  const getChatDisplayName = (chat: Chat): string => {
    // Try different sources for display name
    if (chat.displayName) return chat.displayName;
    if (chat.name) return chat.name;
    if (chat.subject) return chat.subject; // For groups
    
    // Try contacts store
    const contact = store.current.contacts[chat.id];
    if (contact) {
      return contact.name || contact.notify || getPhoneNumber(chat.id);
    }
    
    // For contacts, extract phone number
    const jid = chat.id;
    if (jid.endsWith('@g.us')) {
      // For groups, use a fallback
      return 'Grupo';
    }
    // For individual contacts, just show the phone number
    return getPhoneNumber(jid);
  };

  // Get contact name from JID - using contacts from server
  const getContactName = (jid: string): string => {
    if (!jid) return '';
    // Try to get from store.contacts
    const contact = store.current.contacts[jid];
    if (contact) {
      return contact.name || contact.notify || getPhoneNumber(jid);
    }
    // For @lid JIDs, try LID→PN mapping
    if (jid.endsWith('@lid')) {
      const mappedPn = store.current.lidMappings[jid];
      if (mappedPn) {
        const pnContact = store.current.contacts[mappedPn];
        if (pnContact) return pnContact.name || pnContact.notify || getPhoneNumber(mappedPn);
        return getPhoneNumber(mappedPn);
      }
    }
    // Fallback to phone number
    return getPhoneNumber(jid);
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
      const jidNumber = getPhoneNumber(jid);
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

  // Open forward modal
  const handleOpenForward = (msg: Message) => {
    const text = msg._text || '[Mídia]';
    setForwardModal({ messageId: msg.key.id, text });
    setForwardSelected([]);
    setForwardSearch('');
    setContextMenu(null);
  };

  // Forward message to selected chats
  const handleForwardMessage = async () => {
    if (!forwardModal || forwardSelected.length === 0 || forwarding) return;
    setForwarding(true);
    try {
      for (const jid of forwardSelected) {
        await fetch('/api/forward-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromJid: selectedChat, toJid: jid, messageId: forwardModal.messageId }),
        });
      }
      showToast(`Mensagem encaminhada para ${forwardSelected.length} conversa(s)`);
      setForwardModal(null);
    } catch {
      showToast('Erro ao encaminhar mensagem');
    } finally {
      setForwarding(false);
    }
  };

  // Toggle notification permission
  const toggleNotifications = async () => {
    if (!('Notification' in window)) {
      showToast('Notificações não suportadas neste navegador');
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Permissão de notificação negada. Habilite nas configurações do navegador.');
      return;
    }
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setNotificationsEnabled(true);
        showToast('Notificações ativadas');
      }
    } else {
      setNotificationsEnabled(prev => !prev);
      showToast(notificationsEnabled ? 'Notificações desativadas' : 'Notificações ativadas');
    }
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

  // Edit message
  const handleEditMessage = async (messageId: string, newText: string) => {
    if (!selectedChat || !newText.trim()) return;
    try {
      await fetch('/api/edit-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, newText: newText.trim() })
      });
      showToast('Mensagem editada');
    } catch { showToast('Erro ao editar mensagem'); }
    setEditMessageModal(null);
    setContextMenu(null);
  };

  // Star message
  const handleStarMessage = async (messageId: string, star: boolean) => {
    if (!selectedChat) return;
    try {
      await fetch('/api/star-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, star })
      });
      showToast(star ? 'Mensagem estrelada' : 'Estrela removida');
    } catch { showToast('Erro ao estrelar mensagem'); }
    setContextMenu(null);
  };

  // Pin message in chat
  const handlePinMessage = async (messageId: string, time: number = 604800) => {
    if (!selectedChat) return;
    try {
      await fetch('/api/pin-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, type: 'pin', time })
      });
      showToast('Mensagem fixada na conversa');
    } catch { showToast('Erro ao fixar mensagem'); }
    setContextMenu(null);
  };

  // Keep message
  const handleKeepMessage = async (messageId: string) => {
    if (!selectedChat) return;
    try {
      await fetch('/api/keep-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, keep: true })
      });
      showToast('Mensagem mantida');
    } catch { showToast('Erro ao manter mensagem'); }
    setContextMenu(null);
  };

  // Delete message for me only
  const handleDeleteForMe = async (messageId: string) => {
    if (!selectedChat) return;
    try {
      await fetch('/api/delete-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: selectedChat, messageId, forEveryone: false })
      });
      setMessages(prev => prev.filter(m => m.key.id !== messageId));
      showToast('Mensagem apagada para você');
    } catch { showToast('Erro ao apagar mensagem'); }
    setContextMenu(null);
  };

  // Pin/unpin chat
  const handlePinChat = async (jid: string, pin: boolean) => {
    try {
      await fetch('/api/pin-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, pin })
      });
      setChats(prev => prev.map(c => c.id === jid ? { ...c, pinnedAt: pin ? Date.now() : undefined } : c));
      showToast(pin ? 'Conversa fixada' : 'Conversa desafixada');
    } catch { showToast('Erro ao fixar conversa'); }
    setContextMenu(null);
  };

  // Mute chat
  const handleMuteChat = async (jid: string, duration: string) => {
    try {
      await fetch('/api/mute-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, mute: true, duration })
      });
      setChats(prev => prev.map(c => c.id === jid ? { ...c, muted: true } : c));
      showToast('Conversa silenciada');
    } catch { showToast('Erro ao silenciar'); }
    setMuteModal(null);
    setContextMenu(null);
  };

  // Unmute chat
  const handleUnmuteChat = async (jid: string) => {
    try {
      await fetch('/api/mute-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, mute: false })
      });
      setChats(prev => prev.map(c => c.id === jid ? { ...c, muted: false } : c));
      showToast('Conversa dessilenciada');
    } catch { showToast('Erro ao dessilenciar'); }
    setContextMenu(null);
  };

  // Set ephemeral messages
  const handleSetEphemeral = async (jid: string, ephemeralExpiration: number) => {
    try {
      await fetch('/api/set-ephemeral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, ephemeralExpiration })
      });
      const label = ephemeralExpiration === 0 ? 'desativadas' : ephemeralExpiration === 86400 ? '24 horas' : ephemeralExpiration === 604800 ? '7 dias' : '90 dias';
      showToast(`Mensagens desaparecidas: ${label}`);
    } catch { showToast('Erro ao configurar mensagens desaparecidas'); }
    setEphemeralModal(null);
    setContextMenu(null);
  };

  // Search messages in chat
  const handleSearchMessages = async () => {
    if (!messageSearchQuery.trim()) return;
    try {
      const params = new URLSearchParams({ q: messageSearchQuery });
      if (selectedChat) params.set('jid', selectedChat);
      const res = await fetch(`/api/search-messages?${params}`);
      const data = await res.json();
      setMessageSearchResults(data);
    } catch { showToast('Erro ao buscar mensagens'); }
  };

  // Export chat
  const handleExportChat = (jid?: string) => {
    const chatId = jid || selectedChat;
    if (!chatId) return;
    window.open(`/api/export-chat/${chatId}`, '_blank');
    setContextMenu(null);
    showToast('Exportando conversa...');
  };

  // Block contact
  const handleBlockContact = async (jid: string, block: boolean) => {
    try {
      await fetch('/api/block-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, block })
      });
      showToast(block ? 'Contato bloqueado' : 'Contato desbloqueado');
    } catch { showToast('Erro ao bloquear contato'); }
    setBlockConfirmModal(null);
    setContextMenu(null);
  };

  // Send view-once media
  const handleSendViewOnce = async (file: File) => {
    if (!selectedChat) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('jid', selectedChat);
      formData.append('caption', mediaCaption);
      formData.append('mediaType', file.type.split('/')[0]);
      await fetch('/api/send-viewonce', { method: 'POST', body: formData });
      setMediaPreview(null);
      setMediaCaption('');
      showToast('Mídia de visualização única enviada');
    } catch { showToast('Erro ao enviar view-once'); }
  };

  // Create group
  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !newGroupParticipants.trim()) return;
    try {
      const participants = newGroupParticipants.split(',').map(p => p.trim()).filter(Boolean);
      await fetch('/api/group/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, participants })
      });
      showToast('Grupo criado com sucesso');
      setCreateGroupModal(false);
      setNewGroupName('');
      setNewGroupParticipants('');
      // Refresh chats
      if (socket) socket.emit('get-chats');
    } catch { showToast('Erro ao criar grupo'); }
  };

  // Group management handlers
  const handleUpdateGroupSubject = async (jid: string, subject: string) => {
    try {
      await fetch('/api/group/subject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, subject })
      });
      showToast('Nome do grupo atualizado');
      setGroupEditName('');
    } catch { showToast('Erro ao atualizar nome'); }
  };

  const handleUpdateGroupDescription = async (jid: string, description: string) => {
    try {
      await fetch('/api/group/description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, description })
      });
      showToast('Descrição atualizada');
      setGroupEditDesc('');
    } catch { showToast('Erro ao atualizar descrição'); }
  };

  const handleGroupAction = async (jid: string, participant: string, action: string) => {
    try {
      await fetch(`/api/group/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid, participants: [participant] })
      });
      showToast(`Ação ${action} realizada`);
      setGroupAddParticipant('');
    } catch { showToast(`Erro ao ${action}`); }
  };

  const handleLeaveGroup = async (jid: string) => {
    try {
      await fetch('/api/group/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid })
      });
      setChats(prev => prev.filter(c => c.id !== jid));
      if (selectedChat === jid) setSelectedChat(null);
      setGroupManageModal(null);
      showToast('Você saiu do grupo');
    } catch { showToast('Erro ao sair do grupo'); }
  };

  const handleGetGroupInviteLink = async (jid: string) => {
    try {
      const res = await fetch(`/api/group/invite-link/${jid}`);
      const data = await res.json();
      if (data.inviteLink) {
        navigator.clipboard.writeText(data.inviteLink).catch(() => {});
        showToast('Link de convite copiado!');
      }
    } catch { showToast('Erro ao obter link'); }
  };

  // Status handlers
  const handlePostTextStatus = async () => {
    if (!statusText.trim()) return;
    try {
      await fetch('/api/status/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: statusText })
      });
      showToast('Status publicado');
      setStatusText('');
      setStatusModal(false);
    } catch { showToast('Erro ao publicar status'); }
  };

  const handlePostMediaStatus = async () => {
    if (!statusFile) return;
    try {
      const formData = new FormData();
      formData.append('file', statusFile);
      formData.append('mediaType', statusFile.type.split('/')[0]);
      await fetch('/api/status/media', { method: 'POST', body: formData });
      showToast('Status publicado');
      setStatusFile(null);
      setStatusModal(false);
    } catch { showToast('Erro ao publicar status'); }
  };

  const loadStatuses = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatuses(data);
    } catch {}
  };

  // Newsletter handlers
  const handleCreateChannel = async () => {
    if (!channelName.trim()) return;
    try {
      await fetch('/api/newsletter/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: channelName, description: channelDesc })
      });
      showToast('Canal criado');
      setCreateChannelModal(false);
      setChannelName('');
      setChannelDesc('');
    } catch { showToast('Erro ao criar canal'); }
  };

  const handleFollowChannel = async (jid: string) => {
    try {
      await fetch('/api/newsletter/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid })
      });
      showToast('Canal seguido');
    } catch { showToast('Erro ao seguir canal'); }
  };

  const handleUnfollowChannel = async (jid: string) => {
    try {
      await fetch('/api/newsletter/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid })
      });
      showToast('Canal deixado de seguir');
    } catch { showToast('Erro ao deixar de seguir'); }
  };

  const loadChannelMessages = async (jid: string) => {
    try {
      const res = await fetch(`/api/newsletter/${jid}/messages`);
      const data = await res.json();
      setChannelMessages(data);
      setChannelDetailModal(jid);
    } catch { showToast('Erro ao carregar mensagens do canal'); }
  };

  // Community handlers
  const handleCreateCommunity = async () => {
    if (!communityName.trim()) return;
    try {
      await fetch('/api/community/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: communityName, description: communityDesc })
      });
      showToast('Comunidade criada');
      setCreateCommunityModal(false);
      setCommunityName('');
      setCommunityDesc('');
    } catch { showToast('Erro ao criar comunidade'); }
  };

  const handleLinkGroupToCommunity = async (communityJid: string, groupJid: string) => {
    try {
      await fetch('/api/community/link-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupJid, communityJid })
      });
      showToast('Grupo vinculado à comunidade');
    } catch { showToast('Erro ao vincular grupo'); }
  };

  // Broadcast handler
  const handleSendBroadcast = async () => {
    if (broadcastRecipients.length === 0 || !broadcastText.trim()) return;
    try {
      await fetch('/api/send-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: broadcastRecipients, text: broadcastText })
      });
      showToast(`Mensagem enviada para ${broadcastRecipients.length} contato(s)`);
      setBroadcastModal(false);
      setBroadcastText('');
      setBroadcastRecipients([]);
    } catch { showToast('Erro ao enviar broadcast'); }
  };

  // Business profile handler
  const handleUpdateBusinessProfile = async () => {
    try {
      await fetch('/api/business/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: businessAddress,
          email: businessEmail,
          description: businessDescription,
          websites: businessWebsite ? [businessWebsite] : []
        })
      });
      showToast('Perfil comercial atualizado');
      setBusinessProfileModal(false);
    } catch { showToast('Erro ao atualizar perfil'); }
  };

  // Filtered chats based on search and filter
  const filteredChats = chats.filter(chat => {
    if (chat.archived) return false;
    if (chatFilter === 'unread' && (!chat.unreadCount || chat.unreadCount <= 0)) return false;
    if (chatFilter === 'groups' && !chat.id.endsWith('@g.us')) return false;
    if (chatFilter === 'favorites') return false;
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

  // Format duration in seconds to mm:ss
  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Process messages to group album images together
  const processAlbumGroups = (msgs: Message[]): (Message & { _albumItems?: Message[]; _albumId?: string })[] => {
    const result: (Message & { _albumItems?: Message[]; _albumId?: string })[] = [];
    const processed = new Set<string>();
    
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      if (!msg.key.id || processed.has(msg.key.id)) continue;
      
      // Check if this message is the start of an album
      if (msg._type === 'image' || msg._type === 'video') {
        const albumItems: Message[] = [msg];
        const albumId = `album-${msg.key.id}`;
        
        // Look ahead for consecutive images/videos from the same sender
        for (let j = i + 1; j < msgs.length; j++) {
          const nextMsg = msgs[j];
          if (!nextMsg.key.id || processed.has(nextMsg.key.id)) continue;
          
          // Must be image or video
          if (nextMsg._type !== 'image' && nextMsg._type !== 'video') break;
          
          // Must be from same sender
          if (nextMsg.key.fromMe !== msg.key.fromMe) break;
          
          // Must be within 5 seconds
          const timeDiff = Math.abs((nextMsg.messageTimestamp || 0) - (msg.messageTimestamp || 0));
          if (timeDiff > 5) break;
          
          // Current item must not have caption (albums don't have captions on each image)
          // Actually the first or last item might have caption, so check this condition loosely
          albumItems.push(nextMsg);
          processed.add(nextMsg.key.id);
        }
        
        // If we found 2+ consecutive images/videos, treat as album
        if (albumItems.length >= 2) {
          result.push({
            ...msg,
            _albumItems: albumItems,
            _albumId: albumId
          });
          // Mark all album items as processed
          for (const item of albumItems) {
            if (item.key.id) processed.add(item.key.id);
          }
        } else {
          result.push(msg);
        }
      } else {
        result.push(msg);
      }
    }
    
    return result;
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
            ) : (
              <div className="wa-media-placeholder">
                <ImageIcon size={32} />
                <span>📷 Foto</span>
              </div>
            )}
            {msg._text && msg._text !== '[Imagem]' && msg._text !== '' && (
              <p className="wa-media-caption">{processMentions(msg._text, msg._mentions)}</p>
            )}
            {msg._isViewOnce && (
              <span className="wa-view-once-badge">👁️ Visualização única</span>
            )}
            {msg._isEphemeral && (
              <span className="wa-ephemeral-badge">⏱️ Temporária</span>
            )}
          </div>
        );
      
      case 'video':
        return (
          <div className="wa-video-container">
            {msg._thumbnail ? (
              <div className="wa-video-thumb-wrapper">
                <img 
                  src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                  alt={msg._text || 'Vídeo'} 
                  className="wa-media-thumbnail"
                />
                <div className="wa-video-play-overlay">
                  <Play size={32} fill="white" />
                </div>
                {msg._duration && (
                  <span className="wa-video-duration">{formatDuration(msg._duration)}</span>
                )}
              </div>
            ) : (
              <div className="wa-media-placeholder">
                <Video size={32} />
                <span>🎥 Vídeo{msg._duration ? ` (${formatDuration(msg._duration)})` : ''}</span>
              </div>
            )}
            {msg._text && msg._text !== '[Vídeo]' && msg._text !== '' && (
              <p className="wa-media-caption">{processMentions(msg._text, msg._mentions)}</p>
            )}
          </div>
        );
      
      case 'ptv':
        return (
          <div className="wa-video-container">
            {msg._thumbnail ? (
              <div className="wa-video-thumb-wrapper">
                <img 
                  src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                  alt="Vídeo" 
                  className="wa-media-thumbnail"
                />
                <div className="wa-video-play-overlay">
                  <Play size={32} fill="white" />
                </div>
                {msg._duration && (
                  <span className="wa-video-duration">{formatDuration(msg._duration)}</span>
                )}
              </div>
            ) : (
              <div className="wa-media-placeholder">
                <Video size={32} />
                <span>🎥 Vídeo{msg._duration ? ` (${formatDuration(msg._duration)})` : ''}</span>
              </div>
            )}
            {msg._text && msg._text !== '' && (
              <p className="wa-media-caption">{msg._text}</p>
            )}
          </div>
        );
      
      case 'audio':
        return (
          <div className="wa-audio-container">
            {msg._isPTT ? (
              <div className="wa-ptt">
                <div className="wa-ptt-icon">
                  <Mic size={18} />
                </div>
                <div className="wa-ptt-info">
                  <span className="wa-ptt-label">Mensagem de voz</span>
                  {msg._duration && (
                    <span className="wa-ptt-duration">{formatDuration(msg._duration)}</span>
                  )}
                </div>
                <button className="wa-ptt-play" title="Reproduzir">
                  <Play size={16} />
                </button>
              </div>
            ) : (
              <div className="wa-audio">
                <div className="wa-audio-icon">
                  <Music size={18} />
                </div>
                <div className="wa-audio-info">
                  <span className="wa-audio-label">Áudio</span>
                  {msg._duration && (
                    <span className="wa-audio-duration">{formatDuration(msg._duration)}</span>
                  )}
                </div>
                <button className="wa-audio-play" title="Reproduzir">
                  <Play size={16} />
                </button>
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
              <div className="wa-media-placeholder">
                <Smile size={32} />
                <span>Sticker</span>
              </div>
            )}
          </div>
        );
      
      case 'document':
        return (
          <div className="wa-document-container">
            <div className="wa-document-icon">
              <FileText size={24} />
            </div>
            <div className="wa-document-info">
              <span className="wa-document-name">{msg._text || 'Documento'}</span>
              {msg.message?.documentMessage?.mimetype && (
                <span className="wa-document-type">{msg.message.documentMessage.mimetype}</span>
              )}
            </div>
          </div>
        );
      
      case 'location':
        return (
          <div className="wa-location-container">
            {msg._thumbnail ? (
              <img 
                src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                alt="Localização" 
                className="wa-location-map"
              />
            ) : (
              <div className="wa-location-map-placeholder">
                <span className="wa-location-pin">📍</span>
              </div>
            )}
            <div className="wa-location-info">
              {msg._location?.name && (
                <span className="wa-location-name">{msg._location.name}</span>
              )}
              {msg._location?.address && (
                <span className="wa-location-address">{msg._location.address}</span>
              )}
              {msg._location?.latitude !== undefined && msg._location?.longitude !== undefined && (
                <a 
                  className="wa-location-link"
                  href={`https://www.google.com/maps?q=${msg._location.latitude},${msg._location.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  Abrir no Google Maps
                </a>
              )}
            </div>
          </div>
        );
      
      case 'liveLocation':
        return (
          <div className="wa-location-container">
            {msg._thumbnail ? (
              <img 
                src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                alt="Localização em tempo real" 
                className="wa-location-map"
              />
            ) : (
              <div className="wa-location-map-placeholder">
                <span className="wa-location-pin">📍</span>
              </div>
            )}
            <div className="wa-location-info">
              <span className="wa-location-name">📍 Localização em tempo real</span>
              {msg._location?.latitude !== undefined && msg._location?.longitude !== undefined && (
                <a 
                  className="wa-location-link"
                  href={`https://www.google.com/maps?q=${msg._location.latitude},${msg._location.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  Abrir no Google Maps
                </a>
              )}
            </div>
          </div>
        );
      
      case 'contact':
        return (
          <div className="wa-contact-container">
            <div className="wa-contact-avatar">
              <User size={24} />
            </div>
            <div className="wa-contact-info">
              <span className="wa-contact-name">{msg._contactInfo?.displayName || 'Contato'}</span>
              <span className="wa-contact-action">Toque para ver o contato</span>
            </div>
          </div>
        );
      
      case 'contacts':
        return (
          <div className="wa-contacts-container">
            <div className="wa-contact-avatar">
              <Users size={24} />
            </div>
            <div className="wa-contact-info">
              <span className="wa-contact-name">{msg._text || 'Contatos'}</span>
              <span className="wa-contact-action">Toque para ver os contatos</span>
            </div>
          </div>
        );
      
      case 'poll':
        return (
          <div className="wa-poll-container">
            <div className="wa-poll-header">
              <span className="wa-poll-icon">📊</span>
              <span className="wa-poll-title">{msg.message?.pollCreationMessage?.name || 'Enquete'}</span>
            </div>
            <div className="wa-poll-options">
              {(msg._pollOptions || []).map((option, i) => (
                <div key={i} className="wa-poll-option">
                  <span className="wa-poll-option-radio"></span>
                  <span className="wa-poll-option-text">{option}</span>
                </div>
              ))}
            </div>
          </div>
        );
      
      case 'list':
      case 'listResponse':
        return (
          <div className="wa-list-container">
            <div className="wa-list-icon">📋</div>
            <div className="wa-list-content">
              {msg._interactiveContent?.title && (
                <span className="wa-list-title">{msg._interactiveContent.title}</span>
              )}
              {msg._interactiveContent?.description && (
                <span className="wa-list-description">{msg._interactiveContent.description}</span>
              )}
              <span className="wa-list-action">Toque para ver as opções</span>
            </div>
          </div>
        );
      
      case 'buttons':
      case 'buttonsResponse':
        return (
          <div className="wa-buttons-container">
            {msg._interactiveContent?.title && (
              <p className="wa-buttons-text">{msg._interactiveContent.title}</p>
            )}
            {msg._interactiveContent?.buttons && msg._interactiveContent.buttons.length > 0 && (
              <div className="wa-buttons-list">
                {msg._interactiveContent.buttons.map((btn, i) => (
                  <div key={i} className="wa-button-item">{btn}</div>
                ))}
              </div>
            )}
            {msg._interactiveContent?.footerText && (
              <span className="wa-buttons-footer">{msg._interactiveContent.footerText}</span>
            )}
          </div>
        );
      
      case 'template':
        return (
          <div className="wa-template-container">
            {msg._interactiveContent?.title && (
              <p className="wa-template-text">{msg._interactiveContent.title}</p>
            )}
            {msg._interactiveContent?.buttons && msg._interactiveContent.buttons.length > 0 && (
              <div className="wa-buttons-list">
                {msg._interactiveContent.buttons.map((btn, i) => (
                  <div key={i} className="wa-button-item">{btn}</div>
                ))}
              </div>
            )}
            {msg._interactiveContent?.footerText && (
              <span className="wa-template-footer">{msg._interactiveContent.footerText}</span>
            )}
          </div>
        );
      
      case 'groupInvite':
        return (
          <div className="wa-group-invite-container">
            {msg._thumbnail ? (
              <img 
                src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                alt={msg._groupInvite?.groupName || 'Convite'} 
                className="wa-group-invite-image"
              />
            ) : (
              <div className="wa-group-invite-icon">
                <Users size={28} />
              </div>
            )}
            <div className="wa-group-invite-info">
              <span className="wa-group-invite-title">
                Convite para {msg._groupInvite?.groupName || 'grupo'}
              </span>
              <span className="wa-group-invite-action">Toque para entrar no grupo</span>
            </div>
          </div>
        );
      
      case 'product':
        return (
          <div className="wa-product-container">
            {msg._thumbnail ? (
              <img 
                src={`data:image/jpeg;base64,${msg._thumbnail}`} 
                alt="Produto" 
                className="wa-product-image"
              />
            ) : (
              <div className="wa-product-icon">🛒</div>
            )}
            <div className="wa-product-info">
              <span className="wa-product-name">{msg.message?.productMessage?.product?.title || 'Produto'}</span>
              {msg.message?.productMessage?.product?.description && (
                <span className="wa-product-description">{msg.message.productMessage.product.description}</span>
              )}
            </div>
          </div>
        );
      
      case 'order':
        return (
          <div className="wa-order-container">
            <div className="wa-order-icon">📦</div>
            <div className="wa-order-info">
              <span className="wa-order-title">{msg._text || 'Pedido'}</span>
              {msg.message?.orderMessage?.itemCount && (
                <span className="wa-order-detail">{msg.message.orderMessage.itemCount} item(s)</span>
              )}
            </div>
          </div>
        );
      
      case 'deleted':
        return (
          <div className="wa-deleted-container">
            <span className="wa-deleted-text">{msg._text}</span>
          </div>
        );
      
      case 'edited':
        return (
          <div className="wa-edited-container">
            <span className="wa-edited-text">{msg._editedText || msg._text}</span>
            <span className="wa-edited-badge">✏️ editada</span>
          </div>
        );
      
      case 'system':
        return (
          <div className="wa-system-container">
            <span className="wa-system-text">{msg._text}</span>
          </div>
        );
      
      case 'call':
        return (
          <div className="wa-call-container">
            <Phone size={18} />
            <span>{msg._text}</span>
          </div>
        );
      
      case 'viewOnce':
        return (
          <div className="wa-view-once-container">
            <div className="wa-view-once-icon">👁️</div>
            <span className="wa-view-once-text">Mensagem de visualização única</span>
          </div>
        );
      
      case 'ephemeral':
        return (
          <div className="wa-ephemeral-container">
            <div className="wa-ephemeral-icon">⏱️</div>
            <span className="wa-ephemeral-text">Mensagem temporária</span>
          </div>
        );
      
      case 'album':
        return (
          <div className="wa-album-container">
            <div className="wa-album-icon">📸</div>
            <span className="wa-album-text">{msg._text || 'Álbum'}</span>
          </div>
        );
      
      case 'reaction':
        // Reaction messages are rendered inline below the original message, not as bubbles
        return null;
      
      case 'text':
        return (
          <div className="wa-text-content">
            <p className="wa-message-text">{processMentions(msg._text || '[Mensagem]', msg._mentions)}</p>
            {msg._linkPreview && (
              <div className="wa-link-preview">
                {msg._linkPreview.thumbnail && (
                  <img 
                    src={`data:image/jpeg;base64,${msg._linkPreview.thumbnail}`}
                    alt=""
                    className="wa-link-preview-thumb"
                  />
                )}
                <div className="wa-link-preview-info">
                  {msg._linkPreview.title && (
                    <span className="wa-link-preview-title">{msg._linkPreview.title}</span>
                  )}
                  {msg._linkPreview.description && (
                    <span className="wa-link-preview-description">{msg._linkPreview.description}</span>
                  )}
                  {msg._linkPreview.matchedText && (
                    <span className="wa-link-preview-url">{msg._linkPreview.matchedText}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      
      default:
        return <p className="wa-message-text">{processMentions(msg._text || '[Mensagem]', msg._mentions)}</p>;
    }
  };

  if (status === 'qr' && qr) {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: 'var(--wa-bg)' }}>
        <div className="p-10 rounded-lg shadow-md flex flex-col items-center max-w-md text-center" style={{ background: 'var(--wa-modal-bg)' }}>
          <h1 className="text-2xl font-light mb-6" style={{ color: 'var(--wa-text-primary)' }}>Para usar o WhatsApp no seu computador:</h1>
          <ol className="text-left text-sm space-y-3 mb-8" style={{ color: 'var(--wa-text-secondary)' }}>
            <li>1. Abra o WhatsApp no seu celular</li>
            <li>2. Toque em Mais opções ou Configurações e selecione Aparelhos conectados</li>
            <li>3. Toque em Conectar um aparelho</li>
            <li>4. Aponte seu celular para esta tela para capturar o código</li>
          </ol>
          <div className="p-4 rounded-lg" style={{ background: 'var(--wa-modal-bg)', border: '4px solid var(--wa-border)' }}>
            <img src={qr} alt="QR Code" className="w-64 h-64" />
          </div>
          <p className="mt-6 text-xs" style={{ color: 'var(--wa-text-secondary)' }}>O código QR será atualizado automaticamente.</p>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: 'var(--wa-bg)' }}>
        <div className="w-16 h-16 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-medium" style={{ color: 'var(--wa-text-secondary)' }}>Conectando ao WhatsApp...</p>
      </div>
    );
  }

  if (status === 'close') {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: 'var(--wa-bg)' }}>
        <div className="p-10 rounded-lg shadow-md flex flex-col items-center max-w-md text-center" style={{ background: 'var(--wa-modal-bg)' }}>
          <h1 className="text-2xl font-light text-red-500 mb-4">Conexão Fechada</h1>
          <p className="mb-6" style={{ color: 'var(--wa-text-secondary)' }}>A conexão com o WhatsApp foi encerrada. Tentando reconectar...</p>
          <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`wa-container ${selectedChat ? 'chat-open' : ''}`}>
      {/* Navigation Rail */}
      <nav className="wa-nav-rail">
        <button 
          className={`wa-nav-rail-item ${navRailSection === 'chats' ? 'active' : ''}`}
          onClick={() => setNavRailSection('chats')}
          title="Conversas"
        >
          <MessageCircle size={24} />
          {chats.filter(c => !c.archived && c.unreadCount && c.unreadCount > 0).length > 0 && (
            <span className="wa-nav-rail-badge">
              {chats.filter(c => !c.archived && c.unreadCount && c.unreadCount > 0).reduce((sum, c) => sum + (c.unreadCount || 0), 0)}
            </span>
          )}
        </button>
        <button 
          className={`wa-nav-rail-item ${navRailSection === 'status' ? 'active' : ''}`}
          onClick={() => { setNavRailSection('status'); loadStatuses(); }}
          title="Status"
        >
          <CircleDot size={24} />
        </button>
        <button 
          className={`wa-nav-rail-item ${navRailSection === 'channels' ? 'active' : ''}`}
          onClick={() => setNavRailSection('channels')}
          title="Canais"
        >
          <Tv size={24} />
        </button>
        <button 
          className={`wa-nav-rail-item ${navRailSection === 'communities' ? 'active' : ''}`}
          onClick={() => setNavRailSection('communities')}
          title="Comunidades"
        >
          <Users size={24} />
        </button>
        <div className="wa-nav-rail-divider" />
        <button 
          className={`wa-nav-rail-item ${navRailSection === 'archived' ? 'active' : ''}`}
          onClick={() => { setNavRailSection('archived'); loadArchivedChats(); }}
          title="Arquivadas"
        >
          <Archive size={24} />
        </button>
        <button 
          className={`wa-nav-rail-item ${navRailSection === 'starred' ? 'active' : ''}`}
          onClick={() => setNavRailSection('starred')}
          title="Mensagens com estrela"
        >
          <Star size={24} />
        </button>
        <div className="wa-nav-rail-spacer" />
        <button 
          className={`wa-nav-rail-item ${darkMode ? 'active' : ''}`}
          onClick={() => setDarkMode(prev => !prev)}
          title={darkMode ? 'Modo claro' : 'Modo escuro'}
        >
          {darkMode ? <Sun size={24} /> : <Moon size={24} />}
        </button>
        <button 
          className="wa-nav-rail-item"
          onClick={() => setProfileOpen(true)}
          title="Perfil"
        >
          <div className="wa-nav-rail-avatar">
            <User size={18} />
            {chats.some(c => !c.archived && c.unreadCount && c.unreadCount > 0) && (
              <span className="wa-nav-rail-avatar-dot" />
            )}
          </div>
        </button>
      </nav>

      {/* Sidebar */}
      <div className="wa-sidebar">
        <div className="wa-header">
          <div className="wa-header-title">
            <h2>
              {navRailSection === 'status' ? 'Status' : navRailSection === 'channels' ? 'Canais' : navRailSection === 'communities' ? 'Comunidades' : navRailSection === 'archived' ? 'Arquivadas' : navRailSection === 'starred' ? 'Estreladas' : 'WhatsApp'}
            </h2>
          </div>
          <div className="flex gap-5" style={{ color: 'var(--wa-text-secondary)' }}>
            <motion.button whileTap={{ scale: 0.9 }} title="Nova conversa" onClick={() => setCreateGroupModal(true)}>
              <MessageSquarePlus size={24} />
            </motion.button>
            <div style={{ position: 'relative' }}>
              <motion.button whileTap={{ scale: 0.9 }} title="Menu" onClick={() => setSidebarMenuOpen(prev => !prev)}>
                <MoreVertical size={24} />
              </motion.button>
              {sidebarMenuOpen && (
                <>
                  <div className="wa-context-menu-overlay" onClick={() => setSidebarMenuOpen(false)} />
                  <div className="wa-context-menu" style={{ right: 0, left: 'auto', top: '100%', marginTop: 4 }}>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); setCreateGroupModal(true); }}>
                      <Users size={18} /> Novo grupo
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); setCreateChannelModal(true); }}>
                      <Tv size={18} /> Novo canal
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); setCreateCommunityModal(true); }}>
                      <Users size={18} /> Nova comunidade
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); setBroadcastModal(true); }}>
                      <Megaphone size={18} /> Broadcast
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); setBusinessProfileModal(true); }}>
                      <Contact size={18} /> Perfil comercial
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); refreshChats(); }}>
                      <MessageSquare size={18} /> Atualizar conversas
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); loadMoreChats(); }}>
                      <ChevronDown size={18} /> Carregar mais conversas
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); toggleNotifications(); }}>
                      <Bell size={18} /> {notificationsEnabled ? 'Desativar notificações' : 'Ativar notificações'}
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); setShortcutsOpen(true); }}>
                      <Keyboard size={18} /> Atalhos de teclado
                    </div>
                    <div className="wa-context-menu-item" onClick={() => { setSidebarMenuOpen(false); }}>
                      <Settings size={18} /> Configurações
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Filter chips - only show for chats section */}
        {navRailSection === 'chats' && (
        <div className="wa-filters">
          {([
            { key: 'all' as const, label: 'Todos' },
            { key: 'unread' as const, label: 'Não lidos', count: chats.filter(c => !c.archived && c.unreadCount && c.unreadCount > 0).length },
            { key: 'favorites' as const, label: 'Favoritos' },
            { key: 'groups' as const, label: 'Grupos' },
          ]).map(f => (
            <button
              key={f.key}
              className={`wa-filter-chip ${chatFilter === f.key ? 'active' : ''}`}
              onClick={() => setChatFilter(f.key)}
            >
              {f.label}
              {f.count && f.count > 0 && (
                <span className="wa-filter-chip-badge">{f.count}</span>
              )}
            </button>
          ))}
        </div>
        )}

        {/* Search */}
        <div className="p-2" style={{ background: 'var(--wa-sidebar-bg)' }}>
          <div className="flex items-center px-3 py-1.5 rounded-lg" style={{ background: 'var(--wa-search-input)' }}>
            <Search className="mr-3" size={18} style={{ color: 'var(--wa-text-secondary)' }} />
            <input 
              type="text" 
              placeholder={navRailSection === 'chats' ? 'Pesquisar ou começar uma nova conversa' : navRailSection === 'status' ? 'Pesquisar status...' : navRailSection === 'channels' ? 'Pesquisar canais...' : 'Pesquisar...'}
              className="bg-transparent border-none outline-none text-sm w-full"
              style={{ color: 'var(--wa-text-primary)' }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ color: 'var(--wa-text-secondary)' }}>
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Conditional content based on nav rail section */}
        {navRailSection === 'status' ? (
          <div className="wa-chat-list">
            <div style={{ padding: 16 }}>
              <button className="wa-context-menu-item" style={{ width: '100%', justifyContent: 'center', padding: 12, background: 'var(--wa-teal-dark)', color: 'white', borderRadius: 8, marginBottom: 16 }} onClick={() => setStatusModal(true)}>
                <Plus size={18} /> Novo status
              </button>
              {statuses.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--wa-text-secondary)', padding: 24, fontSize: 14 }}>
                  Nenhum status disponível
                </div>
              ) : (
                statuses.map((s: any) => (
                  <div key={s.jid || s.id} className="wa-chat-item" style={{ padding: 12 }}>
                    <div className="wa-chat-item-avatar-placeholder"><User size={28} style={{ color: 'var(--wa-text-secondary)' }} /></div>
                    <div className="wa-chat-item-content">
                      <h3 className="wa-chat-item-name">{s.pushName || s.status?.toString().slice(0, 30) || 'Contato'}</h3>
                      <p className="wa-chat-item-message">{s.setAt ? new Date(s.setAt).toLocaleString('pt-BR') : ''}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : navRailSection === 'channels' ? (
          <div className="wa-chat-list">
            <div style={{ padding: 16 }}>
              <button className="wa-context-menu-item" style={{ width: '100%', justifyContent: 'center', padding: 12, background: 'var(--wa-teal-dark)', color: 'white', borderRadius: 8, marginBottom: 16 }} onClick={() => setCreateChannelModal(true)}>
                <Plus size={18} /> Criar canal
              </button>
              {newsletters.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--wa-text-secondary)', padding: 24, fontSize: 14 }}>
                  Nenhum canal encontrado. Crie ou siga um canal.
                </div>
              ) : (
                newsletters.map((n: any) => (
                  <div key={n.id} className="wa-chat-item" style={{ padding: 12 }} onClick={() => loadChannelMessages(n.id)}>
                    <div className="wa-chat-item-avatar-placeholder"><Tv size={28} style={{ color: 'var(--wa-text-secondary)' }} /></div>
                    <div className="wa-chat-item-content">
                      <h3 className="wa-chat-item-name">{n.name}</h3>
                      <p className="wa-chat-item-message">{n.description || 'Canal'}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : navRailSection === 'communities' ? (
          <div className="wa-chat-list">
            <div style={{ padding: 16 }}>
              <button className="wa-context-menu-item" style={{ width: '100%', justifyContent: 'center', padding: 12, background: 'var(--wa-teal-dark)', color: 'white', borderRadius: 8, marginBottom: 16 }} onClick={() => setCreateCommunityModal(true)}>
                <Plus size={18} /> Criar comunidade
              </button>
              {communities.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--wa-text-secondary)', padding: 24, fontSize: 14 }}>
                  Nenhuma comunidade encontrada.
                </div>
              ) : (
                communities.map((c: any) => (
                  <div key={c.id} className="wa-chat-item" style={{ padding: 12 }} onClick={() => setCommunityManageModal(c.id)}>
                    <div className="wa-chat-item-avatar-placeholder"><Users size={28} style={{ color: 'var(--wa-text-secondary)' }} /></div>
                    <div className="wa-chat-item-content">
                      <h3 className="wa-chat-item-name">{c.name || c.subject}</h3>
                      <p className="wa-chat-item-message">{c.description || 'Comunidade'}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
        <>

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
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: chat.id, isGroup: chat.id.endsWith('@g.us' ) }); }}
            >
              {chat.avatar ? (
                <img src={chat.avatar} alt={getChatDisplayName(chat)} className="wa-chat-item-avatar" />
              ) : (
                <div className="wa-chat-item-avatar-placeholder">
                  <User size={28} style={{ color: 'var(--wa-text-secondary)' }} />
                </div>
              )}
              <div className="wa-chat-item-content">
                <div className="wa-chat-item-top">
                  <h3 className="wa-chat-item-name">
                    {chat.id.endsWith('@g.us') && <Users size={14} style={{ marginRight: 4, verticalAlign: 'middle', opacity: 0.6 }} />}
                    {getChatDisplayName(chat)}
                  </h3>
                  <div className="wa-chat-item-top-right">
                    {chat.pinnedAt && <Pin size={14} className="wa-chat-item-pin" />}
                    {chat.muted && <VolumeX size={14} className="wa-chat-item-muted-icon" />}
                    <span className={`wa-chat-item-time ${chat.unreadCount && chat.unreadCount > 0 ? 'unread' : ''}`}>
                      {formatChatTime(chat.lastMessageTime)}
                    </span>
                  </div>
                </div>
                <div className="wa-chat-item-bottom">
                  <p className="wa-chat-item-message">
                    {typingJids.has(chat.id) ? (
                      <span style={{ color: 'var(--wa-teal-dark)', fontStyle: 'italic' }}>digitando...</span>
                    ) : chat.lastMessage ? (
                      <span className="wa-chat-item-message-text">
                        {chat.lastMessageStatus && (
                          <span className="wa-chat-item-check">
                            {chat.lastMessageStatus === 'sent' && <Check size={16} className="wa-check-sent-icon" />}
                            {chat.lastMessageStatus === 'delivered' && <CheckCheck size={16} className="wa-check-delivered-icon" />}
                            {chat.lastMessageStatus === 'read' && <CheckCheck size={16} className="wa-check-read-icon" />}
                          </span>
                        )}
                        {chat.lastMessageSender && chat.id.endsWith('@g.us') && (
                          <span>{chat.lastMessageSender}: </span>
                        )}
                        {chat.lastMessage}
                      </span>
                    ) : (
                      'Toque para conversar'
                    )}
                  </p>
                  {chat.unreadCount && chat.unreadCount > 0 && (
                    <span className="wa-unread-badge">{chat.unreadCount}</span>
                  )}
                </div>
              </div>
              <button
                className="wa-chat-item-menu"
                onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: chat.id, isGroup: chat.id.endsWith('@g.us' ) }); }}
                title="Mais opções"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          ))}
          {filteredChats.length === 0 && (
            <div className="p-4 text-center text-sm" style={{ color: 'var(--wa-text-secondary)' }}>
              {searchQuery ? 'Nenhuma conversa encontrada' : chatFilter === 'unread' ? 'Nenhuma conversa não lida' : chatFilter === 'groups' ? 'Nenhuma conversa em grupo' : chatFilter === 'favorites' ? 'Nenhum favorito' : 'Nenhuma conversa'}
            </div>
          )}
        </div>
        </>
        )}
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
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--wa-border)' }}>
                    <User size={24} style={{ color: 'var(--wa-text-secondary)' }} />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-medium truncate" style={{ color: 'var(--wa-text-primary)' }}>
                    {chatDetails?.displayName || chats.find(c => c.id === selectedChat)?.displayName || getPhoneNumber(selectedChat)}
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
                <Search size={20} className="cursor-pointer" onClick={() => setMessageSearchOpen(true)} title="Buscar mensagens" />
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
              {processAlbumGroups(messages.filter(m => m._type !== 'reaction')).map((msg, idx, arr) => {
                const isGroup = selectedChat?.endsWith('@g.us');
                const showSenderName = isGroup && !msg.key.fromMe;
                const prevMsg = idx > 0 ? arr[idx - 1] : null;
                const showDate = !prevMsg || getDateLabel(msg.messageTimestamp) !== getDateLabel(prevMsg.messageTimestamp);
                const isContinuation = prevMsg && prevMsg.key.fromMe === msg.key.fromMe;
                const isAlbum = !!(msg as any)._albumItems;
                const albumItems = (msg as any)._albumItems as Message[] | undefined;

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
                    {msg._type === 'system' ? (
                      <div className="wa-system-message">
                        <span className="wa-system-message-text">{msg._text}</span>
                      </div>
                    ) : (
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
                          <div className="wa-reply-indicator-bar" style={{ background: msg._replyTo.author ? `hsl(${(msg._replyTo.author || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 70%, 40%)` : 'var(--wa-teal-dark)' }}></div>
                          <div className="wa-reply-indicator-content">
                            <div className="wa-reply-indicator-name" style={{ color: msg._replyTo.author ? `hsl(${(msg._replyTo.author || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 70%, 40%)` : 'var(--wa-teal-dark)' }}>
                              {msg._replyTo.author ? getContactName(msg._replyTo.author) : 'Você'}
                            </div>
                            {msg._replyTo.thumbnail ? (
                              <div className="wa-reply-indicator-media">
                                <img 
                                  src={`data:image/jpeg;base64,${msg._replyTo.thumbnail}`}
                                  alt=""
                                  className="wa-reply-indicator-thumb"
                                />
                                <div className="wa-reply-indicator-media-text">
                                  <span className="wa-reply-indicator-media-type">
                                    {msg._replyTo.mediaType === 'image' ? '📷 Foto' : msg._replyTo.mediaType === 'video' ? '🎥 Vídeo' : msg._replyTo.text}
                                  </span>
                                  <span className="wa-reply-indicator-caption">
                                    {msg._replyTo.mediaType === 'image' || msg._replyTo.mediaType === 'video' 
                                      ? msg._replyTo.text.replace(/^(📷 Foto|🎥 Vídeo)\s*/, '') || ''
                                      : ''
                                    }
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="wa-reply-indicator-text">{msg._replyTo.text}</div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Sender name for groups */}
                      {showSenderName && (
                        <div className="wa-sender-name" style={{ color: `hsl(${(msg.participant || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 70%, 40%)` }}>
                          {getSenderName(msg)}
                        </div>
                      )}
                      
                      {isAlbum && albumItems ? (
                        <div className={`wa-album-grid ${albumItems.length === 2 ? 'wa-album-grid-2' : albumItems.length === 3 ? 'wa-album-grid-3' : albumItems.length >= 4 ? 'wa-album-grid-4' : ''}`}>
                          {albumItems.slice(0, 4).map((item, itemIdx) => (
                            <div key={item.key.id || itemIdx} className="wa-album-item">
                              {item._type === 'image' ? (
                                item._thumbnail ? (
                                  <img 
                                    src={`data:image/jpeg;base64,${item._thumbnail}`} 
                                    alt=""
                                    className="wa-album-item-img"
                                  />
                                ) : item._mediaUrl ? (
                                  <img 
                                    src={item._mediaUrl} 
                                    alt=""
                                    className="wa-album-item-img"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="wa-album-item-placeholder"><ImageIcon size={24} /></div>
                                )
                              ) : (
                                item._thumbnail ? (
                                  <div className="wa-album-item-video">
                                    <img 
                                      src={`data:image/jpeg;base64,${item._thumbnail}`} 
                                      alt=""
                                      className="wa-album-item-img"
                                    />
                                    <div className="wa-album-item-play"><Play size={20} fill="white" /></div>
                                  </div>
                                ) : (
                                  <div className="wa-album-item-placeholder"><Video size={24} /></div>
                                )
                              )}
                            </div>
                          ))}
                          {albumItems.length > 4 && (
                            <div className="wa-album-more">+{albumItems.length - 4}</div>
                          )}
                        </div>
                      ) : (
                        renderMessageContent(msg)
                      )}
                      
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
                    )}
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
            <div className="w-64 h-64 rounded-full flex items-center justify-center mb-8" style={{ opacity: 0.4, background: 'var(--wa-search-input)' }}>
              <MessageSquare size={100} style={{ color: 'var(--wa-text-secondary)' }} />
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
          <div className="wa-context-menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 450) }}>
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
                  if (msg?.key.fromMe && msg._type === 'text') {
                    setEditMessageModal({ id: msg.key.id, text: msg._text || '' });
                  } else {
                    showToast('Só é possível editar mensagens de texto enviadas por você');
                  }
                  setContextMenu(null);
                }}>
                  <Pencil size={18} /> Editar
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  const msg = messages.find(m => m.key.id === contextMenu.messageId);
                  if (msg) handleCopyMessage(msg._text);
                }}>
                  <Copy size={18} /> Copiar
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  const msg = messages.find(m => m.key.id === contextMenu.messageId);
                  if (msg) handleOpenForward(msg);
                }}>
                  <Forward size={18} /> Encaminhar
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
                <div className="wa-context-menu-item" onClick={() => {
                  handleStarMessage(contextMenu.messageId!, true);
                }}>
                  <Star size={18} /> Estrelar
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  handlePinMessage(contextMenu.messageId!);
                }}>
                  <Pin size={18} /> Fixar na conversa
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  handleKeepMessage(contextMenu.messageId!);
                }}>
                  <Lock size={18} /> Manter mensagem
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  handleDeleteForMe(contextMenu.messageId!);
                }}>
                  <Trash2 size={18} /> Apagar para mim
                </div>
                <div className="wa-context-menu-item danger" onClick={() => handleDeleteMessage(contextMenu.messageId!)}>
                  <Trash2 size={18} /> Apagar para todos
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
                <div className="wa-context-menu-item" onClick={() => {
                  const chat = chats.find(c => c.id === contextMenu.chatId);
                  if (chat?.muted) {
                    handleUnmuteChat(contextMenu.chatId!);
                  } else {
                    setMuteModal(contextMenu.chatId!);
                    setContextMenu(null);
                  }
                }}>
                  {chats.find(c => c.id === contextMenu.chatId)?.muted ? <Bell size={18} /> : <VolumeX size={18} />}
                  {chats.find(c => c.id === contextMenu.chatId)?.muted ? 'Dessilenciar' : 'Silenciar'}
                </div>
                <div className="wa-context-menu-item" onClick={() => {
                  const chat = chats.find(c => c.id === contextMenu.chatId);
                  handlePinChat(contextMenu.chatId!, !chat?.pinnedAt);
                }}>
                  <Pin size={18} /> {chats.find(c => c.id === contextMenu.chatId)?.pinnedAt ? 'Desafixar' : 'Fixar conversa'}
                </div>
                {contextMenu.chatId?.endsWith('@g.us') && (
                  <>
                    <div className="wa-context-menu-item" onClick={() => {
                      setEphemeralModal(contextMenu.chatId!);
                      setContextMenu(null);
                    }}>
                      <Clock size={18} /> Mensagens desaparecidas
                    </div>
                    <div className="wa-context-menu-item" onClick={() => {
                      setGroupManageModal(contextMenu.chatId!);
                      const chat = chats.find(c => c.id === contextMenu.chatId);
                      setGroupEditName(chat?.name || chat?.displayName || '');
                      setGroupEditDesc('');
                      setContextMenu(null);
                    }}>
                      <Users size={18} /> Gerenciar grupo
                    </div>
                  </>
                )}
                {!contextMenu.chatId?.endsWith('@g.us') && (
                  <div className="wa-context-menu-item" onClick={() => {
                    const chat = chats.find(c => c.id === contextMenu.chatId);
                    if (chat) {
                      setBlockConfirmModal(contextMenu.chatId!);
                      setContextMenu(null);
                    }
                  }}>
                    <Ban size={18} /> Bloquear contato
                  </div>
                )}
                <div className="wa-context-menu-item" onClick={() => {
                  handleExportChat(contextMenu.chatId);
                }}>
                  <Download size={18} /> Exportar conversa
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

      {/* Forward Message Modal */}
      {forwardModal && (
        <div className="wa-modal-overlay" onClick={() => setForwardModal(null)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Encaminhar mensagem</h3>
              <button className="wa-modal-close" onClick={() => setForwardModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="wa-modal-search">
              <input
                type="text"
                placeholder="Pesquisar conversa..."
                value={forwardSearch}
                onChange={e => setForwardSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="wa-modal-body">
              {chats
                .filter(c => {
                  const name = getChatDisplayName(c).toLowerCase();
                  return !forwardSearch.trim() || name.includes(forwardSearch.toLowerCase());
                })
                .map(chat => (
                  <div
                    key={chat.id}
                    className={`wa-forward-item ${forwardSelected.includes(chat.id) ? 'selected' : ''}`}
                    onClick={() => {
                      setForwardSelected(prev =>
                        prev.includes(chat.id)
                          ? prev.filter(id => id !== chat.id)
                          : [...prev, chat.id]
                      );
                    }}
                  >
                    {chat.avatar ? (
                      <img src={chat.avatar} alt="" className="wa-chat-item-avatar" />
                    ) : (
                      <div className="wa-chat-item-avatar-placeholder">
                        <User size={28} style={{ color: 'var(--wa-text-secondary)' }} />
                      </div>
                    )}
                    <div className="wa-chat-item-content">
                      <h3 className="wa-chat-item-name">{getChatDisplayName(chat)}</h3>
                    </div>
                    {forwardSelected.includes(chat.id) && (
                      <Check size={20} style={{ color: 'var(--wa-teal-dark)' }} />
                    )}
                  </div>
                ))}
              {chats.filter(c => {
                const name = getChatDisplayName(c).toLowerCase();
                return !forwardSearch.trim() || name.includes(forwardSearch.toLowerCase());
              }).length === 0 && (
                <div className="p-4 text-center text-sm" style={{ color: 'var(--wa-text-secondary)' }}>
                  Nenhuma conversa encontrada
                </div>
              )}
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setForwardModal(null)}>
                Cancelar
              </button>
              <button
                className="wa-modal-btn wa-modal-btn-primary"
                disabled={forwardSelected.length === 0 || forwarding}
                onClick={handleForwardMessage}
              >
                {forwarding ? 'Enviando...' : `Encaminhar${forwardSelected.length > 0 ? ` (${forwardSelected.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Profile Panel */}
      {profileOpen && (
        <>
          <div className="wa-context-menu-overlay" onClick={() => setProfileOpen(false)} />
          <div className="wa-profile-panel">
            <div className="wa-profile-header">
              <button className="wa-modal-close" onClick={() => setProfileOpen(false)} style={{ color: 'white' }}>
                <ArrowLeft size={24} />
              </button>
              <div>
                <h3>Perfil</h3>
                <p>Configurações da conta</p>
              </div>
            </div>
            <div className="wa-profile-avatar">
              <User size={80} style={{ color: 'var(--wa-text-secondary)' }} />
            </div>
            <div className="wa-profile-info">
              <div className="wa-profile-section">
                <div className="wa-profile-section-label">Nome</div>
                <div className="wa-profile-section-value">Usuário WhatsApp</div>
              </div>
              <div className="wa-profile-section">
                <div className="wa-profile-section-label">Telefone</div>
                <div className="wa-profile-section-value">
                  {socket ? 'Conectado' : 'Desconectado'}
                </div>
              </div>
              <div className="wa-profile-section">
                <div className="wa-profile-section-label">Sobre</div>
                <div className="wa-profile-section-value">Hey there! I am using WhatsApp.</div>
              </div>
              <div className="wa-profile-section" style={{ border: 'none' }}>
                <div className="wa-profile-section-label">Configurações</div>
                <label className="wa-notification-toggle" style={{ padding: '8px 0', marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={darkMode}
                    onChange={() => setDarkMode(prev => !prev)}
                  />
                  Modo escuro
                </label>
                <label className="wa-notification-toggle" style={{ padding: '8px 0' }}>
                  <input
                    type="checkbox"
                    checked={notificationsEnabled}
                    onChange={toggleNotifications}
                  />
                  Notificações desktop
                </label>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Keyboard Shortcuts Help */}
      {shortcutsOpen && (
        <div className="wa-shortcuts-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="wa-shortcuts-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-shortcuts-header">
              <h3>Atalhos de Teclado</h3>
              <button className="wa-modal-close" onClick={() => setShortcutsOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="wa-shortcuts-body">
              <div className="wa-shortcut-group">
                <h4>Navegação</h4>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Pesquisar conversas</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Ctrl</span>
                    <span className="wa-shortcut-key">K</span>
                  </div>
                </div>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Alternar modo escuro</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Ctrl</span>
                    <span className="wa-shortcut-key">D</span>
                  </div>
                </div>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Abrir seletor de emoji</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Ctrl</span>
                    <span className="wa-shortcut-key">E</span>
                  </div>
                </div>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Alternar notificações</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Ctrl</span>
                    <span className="wa-shortcut-key">N</span>
                  </div>
                </div>
              </div>
              <div className="wa-shortcut-group">
                <h4>Mensagens</h4>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Enviar mensagem</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Enter</span>
                  </div>
                </div>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Nova linha</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Shift</span>
                    <span className="wa-shortcut-key">Enter</span>
                  </div>
                </div>
              </div>
              <div className="wa-shortcut-group">
                <h4>Geral</h4>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Mostrar atalhos</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Ctrl</span>
                    <span className="wa-shortcut-key">/</span>
                  </div>
                </div>
                <div className="wa-shortcut-item">
                  <span className="wa-shortcut-desc">Fechar modal / painel</span>
                  <div className="wa-shortcut-keys">
                    <span className="wa-shortcut-key">Esc</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mute Duration Modal */}
      {muteModal && (
        <div className="wa-modal-overlay" onClick={() => setMuteModal(null)}>
          <div className="wa-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Silenciar notificações</h3>
              <button className="wa-modal-close" onClick={() => setMuteModal(null)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <p style={{ marginBottom: 16, color: 'var(--wa-text-secondary)', fontSize: 14 }}>
                As notificações desta conversa serão silenciadas.
              </p>
              {[{ label: '8 horas', value: '8h' }, { label: '1 semana', value: '1w' }, { label: 'Sempre', value: 'always' }].map(opt => (
                <button key={opt.value} className="wa-context-menu-item" style={{ width: '100%', justifyContent: 'center', padding: 12 }}
                  onClick={() => handleMuteChat(muteModal, opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ephemeral Messages Modal */}
      {ephemeralModal && (
        <div className="wa-modal-overlay" onClick={() => setEphemeralModal(null)}>
          <div className="wa-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Mensagens desaparecidas</h3>
              <button className="wa-modal-close" onClick={() => setEphemeralModal(null)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <p style={{ marginBottom: 16, color: 'var(--wa-text-secondary)', fontSize: 14 }}>
                Novas mensagens nesta conversa desaparecerão após o tempo selecionado.
              </p>
              {[{ label: 'Desativar', value: 0 }, { label: '24 horas', value: 86400 }, { label: '7 dias', value: 604800 }, { label: '90 dias', value: 7776000 }].map(opt => (
                <button key={opt.value} className="wa-context-menu-item" style={{ width: '100%', justifyContent: 'center', padding: 12 }}
                  onClick={() => handleSetEphemeral(ephemeralModal, opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {createGroupModal && (
        <div className="wa-modal-overlay" onClick={() => setCreateGroupModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Criar grupo</h3>
              <button className="wa-modal-close" onClick={() => setCreateGroupModal(false)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Nome do grupo</label>
                <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                  placeholder="Nome do grupo" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Participantes (números separados por vírgula)</label>
                <textarea value={newGroupParticipants} onChange={e => setNewGroupParticipants(e.target.value)}
                  placeholder="5511999999999, 5511888888888" rows={3}
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)', resize: 'vertical' }} />
              </div>
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setCreateGroupModal(false)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-primary" onClick={handleCreateGroup} disabled={!newGroupName.trim() || !newGroupParticipants.trim()}>Criar grupo</button>
            </div>
          </div>
        </div>
      )}

      {/* Group Management Modal */}
      {groupManageModal && (
        <div className="wa-modal-overlay" onClick={() => setGroupManageModal(null)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Gerenciar grupo</h3>
              <button className="wa-modal-close" onClick={() => setGroupManageModal(null)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16, maxHeight: 400, overflowY: 'auto' }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Nome do grupo</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={groupEditName} onChange={e => setGroupEditName(e.target.value)}
                    style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} />
                  <button className="wa-modal-btn wa-modal-btn-primary" style={{ padding: '8px 12px' }}
                    onClick={() => handleUpdateGroupSubject(groupManageModal, groupEditName)}>Salvar</button>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Descrição</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={groupEditDesc} onChange={e => setGroupEditDesc(e.target.value)}
                    style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} />
                  <button className="wa-modal-btn wa-modal-btn-primary" style={{ padding: '8px 12px' }}
                    onClick={() => handleUpdateGroupDescription(groupManageModal, groupEditDesc)}>Salvar</button>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Adicionar participante</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={groupAddParticipant} onChange={e => setGroupAddParticipant(e.target.value)}
                    placeholder="5511999999999@s.whatsapp.net" style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} />
                  <button className="wa-modal-btn wa-modal-btn-primary" style={{ padding: '8px 12px' }}
                    onClick={() => handleGroupAction(groupManageModal, groupAddParticipant, 'add')}>Adicionar</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="wa-modal-btn wa-modal-btn-secondary" style={{ flex: 1 }}
                  onClick={() => handleGroupAction(groupManageModal, groupAddParticipant, 'promote')}>
                  <Shield size={14} /> Promover
                </button>
                <button className="wa-modal-btn wa-modal-btn-secondary" style={{ flex: 1 }}
                  onClick={() => handleGroupAction(groupManageModal, groupAddParticipant, 'demote')}>
                  <UserMinus size={14} /> Rebaixar
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="wa-modal-btn wa-modal-btn-secondary" style={{ flex: 1 }}
                  onClick={() => handleGetGroupInviteLink(groupManageModal)}>
                  <Link size={14} /> Copiar link de convite
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="wa-modal-btn wa-modal-btn-secondary" style={{ flex: 1 }}
                  onClick={() => fetch('/api/group/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jid: groupManageModal, setting: 'announcement' }) }).then(() => showToast('Configurado: só admins enviam'))}>
                  <Lock size={14} /> Só admins enviam
                </button>
                <button className="wa-modal-btn wa-modal-btn-secondary" style={{ flex: 1 }}
                  onClick={() => fetch('/api/group/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jid: groupManageModal, setting: 'not_announcement' }) }).then(() => showToast('Configurado: todos enviam'))}>
                  <Globe size={14} /> Todos enviam
                </button>
              </div>
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-danger" onClick={() => handleLeaveGroup(groupManageModal)}>Sair do grupo</button>
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setGroupManageModal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Status Modal */}
      {statusModal && (
        <div className="wa-modal-overlay" onClick={() => setStatusModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Publicar status</h3>
              <button className="wa-modal-close" onClick={() => setStatusModal(false)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Texto do status</label>
                <textarea value={statusText} onChange={e => setStatusText(e.target.value)} placeholder="O que você está pensando?"
                  rows={3} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)', resize: 'vertical' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Ou envie uma foto/vídeo</label>
                <input type="file" accept="image/*,video/*" onChange={e => setStatusFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setStatusModal(false)}>Cancelar</button>
              {statusFile ? (
                <button className="wa-modal-btn wa-modal-btn-primary" onClick={handlePostMediaStatus}>Publicar mídia</button>
              ) : (
                <button className="wa-modal-btn wa-modal-btn-primary" onClick={handlePostTextStatus} disabled={!statusText.trim()}>Publicar texto</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {createChannelModal && (
        <div className="wa-modal-overlay" onClick={() => setCreateChannelModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Criar canal</h3>
              <button className="wa-modal-close" onClick={() => setCreateChannelModal(false)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Nome do canal</label>
                <input type="text" value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="Nome do canal"
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Descrição</label>
                <textarea value={channelDesc} onChange={e => setChannelDesc(e.target.value)} placeholder="Descrição do canal"
                  rows={3} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)', resize: 'vertical' }} />
              </div>
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setCreateChannelModal(false)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-primary" onClick={handleCreateChannel} disabled={!channelName.trim()}>Criar canal</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Community Modal */}
      {createCommunityModal && (
        <div className="wa-modal-overlay" onClick={() => setCreateCommunityModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Criar comunidade</h3>
              <button className="wa-modal-close" onClick={() => setCreateCommunityModal(false)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Nome da comunidade</label>
                <input type="text" value={communityName} onChange={e => setCommunityName(e.target.value)} placeholder="Nome da comunidade"
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>Descrição</label>
                <textarea value={communityDesc} onChange={e => setCommunityDesc(e.target.value)} placeholder="Descrição da comunidade"
                  rows={3} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)', resize: 'vertical' }} />
              </div>
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setCreateCommunityModal(false)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-primary" onClick={handleCreateCommunity} disabled={!communityName.trim()}>Criar comunidade</button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Modal */}
      {broadcastModal && (
        <div className="wa-modal-overlay" onClick={() => setBroadcastModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Enviar broadcast</h3>
              <button className="wa-modal-close" onClick={() => setBroadcastModal(false)}><X size={20} /></button>
            </div>
            <div className="wa-modal-search">
              <input type="text" placeholder="Pesquisar contato..." value={broadcastSearch} onChange={e => setBroadcastSearch(e.target.value)} autoFocus />
            </div>
            <div className="wa-modal-body">
              {chats.filter(c => !c.id.endsWith('@g.us') && (!broadcastSearch.trim() || getChatDisplayName(c).toLowerCase().includes(broadcastSearch.toLowerCase()))).map(chat => (
                <div key={chat.id} className={`wa-forward-item ${broadcastRecipients.includes(chat.id) ? 'selected' : ''}`}
                  onClick={() => setBroadcastRecipients(prev => prev.includes(chat.id) ? prev.filter(id => id !== chat.id) : [...prev, chat.id])}>
                  {chat.avatar ? <img src={chat.avatar} alt="" className="wa-chat-item-avatar" /> : <div className="wa-chat-item-avatar-placeholder"><User size={28} style={{ color: 'var(--wa-text-secondary)' }} /></div>}
                  <div className="wa-chat-item-content"><h3 className="wa-chat-item-name">{getChatDisplayName(chat)}</h3></div>
                  {broadcastRecipients.includes(chat.id) && <Check size={20} style={{ color: 'var(--wa-teal-dark)' }} />}
                </div>
              ))}
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <textarea value={broadcastText} onChange={e => setBroadcastText(e.target.value)} placeholder="Mensagem para todos os selecionados..."
                rows={3} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)', resize: 'vertical' }} />
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setBroadcastModal(false)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-primary" onClick={handleSendBroadcast} disabled={broadcastRecipients.length === 0 || !broadcastText.trim()}>
                Enviar{broadcastRecipients.length > 0 ? ` (${broadcastRecipients.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Business Profile Modal */}
      {businessProfileModal && (
        <div className="wa-modal-overlay" onClick={() => setBusinessProfileModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Perfil comercial</h3>
              <button className="wa-modal-close" onClick={() => setBusinessProfileModal(false)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              {[
                { label: 'Endereço', value: businessAddress, set: setBusinessAddress, placeholder: 'Rua Example, 123' },
                { label: 'E-mail', value: businessEmail, set: setBusinessEmail, placeholder: 'contato@exemplo.com' },
                { label: 'Descrição', value: businessDescription, set: setBusinessDescription, placeholder: 'Sobre seu negócio' },
                { label: 'Website', value: businessWebsite, set: setBusinessWebsite, placeholder: 'https://exemplo.com' },
              ].map(field => (
                <div key={field.label} style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--wa-text-secondary)' }}>{field.label}</label>
                  <input type="text" value={field.value} onChange={e => field.set(e.target.value)} placeholder={field.placeholder}
                    style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} />
                </div>
              ))}
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setBusinessProfileModal(false)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-primary" onClick={handleUpdateBusinessProfile}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Block Confirm Modal */}
      {blockConfirmModal && (
        <div className="wa-modal-overlay" onClick={() => setBlockConfirmModal(null)}>
          <div className="wa-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Bloquear contato</h3>
              <button className="wa-modal-close" onClick={() => setBlockConfirmModal(null)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <p style={{ color: 'var(--wa-text-secondary)', fontSize: 14 }}>
                Este contato não poderá mais enviar mensagens ou fazer ligações para você. Também não verá seu status.
              </p>
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setBlockConfirmModal(null)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-danger" onClick={() => handleBlockContact(blockConfirmModal, true)}>Bloquear</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Message Modal */}
      {editMessageModal && (
        <div className="wa-modal-overlay" onClick={() => setEditMessageModal(null)}>
          <div className="wa-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Editar mensagem</h3>
              <button className="wa-modal-close" onClick={() => setEditMessageModal(null)}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ padding: 16 }}>
              <textarea value={editMessageModal.text} onChange={e => setEditMessageModal(prev => prev ? { ...prev, text: e.target.value } : null)}
                rows={4} autoFocus style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)', resize: 'vertical' }} />
            </div>
            <div className="wa-modal-footer">
              <button className="wa-modal-btn wa-modal-btn-secondary" onClick={() => setEditMessageModal(null)}>Cancelar</button>
              <button className="wa-modal-btn wa-modal-btn-primary" onClick={() => handleEditMessage(editMessageModal.id, editMessageModal.text)}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Message Search Modal */}
      {messageSearchOpen && (
        <div className="wa-modal-overlay" onClick={() => { setMessageSearchOpen(false); setMessageSearchQuery(''); setMessageSearchResults([]); }}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Buscar mensagens</h3>
              <button className="wa-modal-close" onClick={() => { setMessageSearchOpen(false); setMessageSearchQuery(''); setMessageSearchResults([]); }}><X size={20} /></button>
            </div>
            <div style={{ padding: '8px 16px' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" value={messageSearchQuery} onChange={e => setMessageSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearchMessages()} placeholder="Digite para buscar..."
                  style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid var(--wa-border)', background: 'var(--wa-bg-primary)', color: 'var(--wa-text-primary)' }} autoFocus />
                <button className="wa-modal-btn wa-modal-btn-primary" onClick={handleSearchMessages}>Buscar</button>
              </div>
            </div>
            <div className="wa-modal-body" style={{ maxHeight: 400 }}>
              {messageSearchResults.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--wa-text-secondary)', fontSize: 14 }}>
                  {messageSearchQuery ? 'Nenhum resultado encontrado' : 'Digite algo para buscar'}
                </div>
              ) : (
                messageSearchResults.map((msg: any) => {
                  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '[mídia]';
                  const time = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toLocaleString('pt-BR') : '';
                  return (
                    <div key={msg.key?.id} className="wa-context-menu-item" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 12 }}
                      onClick={() => { setSelectedChat(msg.chatJid || msg.key?.remoteJid); setMessageSearchOpen(false); setMessageSearchQuery(''); setMessageSearchResults([]); }}>
                      <div style={{ fontSize: 12, color: 'var(--wa-text-secondary)', marginBottom: 4 }}>{time}</div>
                      <div style={{ fontSize: 14 }}>{text}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Channel Detail Modal */}
      {channelDetailModal && (
        <div className="wa-modal-overlay" onClick={() => { setChannelDetailModal(null); setChannelMessages([]); }}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-header">
              <h3>Mensagens do canal</h3>
              <button className="wa-modal-close" onClick={() => { setChannelDetailModal(null); setChannelMessages([]); }}><X size={20} /></button>
            </div>
            <div className="wa-modal-body" style={{ maxHeight: 400 }}>
              {channelMessages.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--wa-text-secondary)' }}>Nenhuma mensagem encontrada</div>
              ) : (
                channelMessages.map((msg: any, i: number) => {
                  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[mídia]';
                  return (
                    <div key={i} style={{ padding: 12, borderBottom: '1px solid var(--wa-border)' }}>
                      <div style={{ fontSize: 14 }}>{text}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
