const ctx: Worker = self as any;

interface MessageData {
  type: 'normalize' | 'filter' | 'sort';
  id: string;
  data: any;
}

ctx.onmessage = (e: MessageEvent<MessageData>) => {
  const { type, id, data } = e.data;

  try {
    let result: any;

    switch (type) {
      case 'normalize':
        result = normalizeMessageWorker(data);
        break;
      case 'filter':
        result = filterMessagesWorker(data.messages, data.filter);
        break;
      case 'sort':
        result = sortMessagesWorker(data.messages);
        break;
      default:
        result = null;
    }

    ctx.postMessage({ id, success: true, result });
  } catch (error) {
    ctx.postMessage({ id, success: false, error: String(error) });
  }
};

function normalizeMessageWorker(msg: any): any {
  if (!msg.message) return { ...msg, _type: 'unknown' };

  const message = msg.message;
  const normalized: any = { ...msg };

  if (message.conversation) {
    normalized._type = 'text';
    normalized._text = message.conversation;
  } else if (message.extendedTextMessage) {
    normalized._type = 'text';
    normalized._text = message.extendedTextMessage.text;
  } else if (message.imageMessage) {
    normalized._type = 'image';
    normalized._text = message.imageMessage.caption || '';
  } else if (message.videoMessage) {
    normalized._type = 'video';
    normalized._text = message.videoMessage.caption || '';
  } else if (message.audioMessage) {
    normalized._type = 'audio';
    normalized._text = message.audioMessage.ptt ? '🎤 Áudio' : '🎵 Áudio';
  } else if (message.stickerMessage) {
    normalized._type = 'sticker';
    normalized._text = 'Sticker';
  } else if (message.documentMessage) {
    normalized._type = 'document';
    normalized._text = message.documentMessage.fileName || 'Documento';
  } else if (message.reactionMessage) {
    normalized._type = 'reaction';
    normalized._text = message.reactionMessage.text || '';
  } else if (message.protocolMessage) {
    if (message.protocolMessage.type === 0) {
      normalized._type = 'deleted';
      normalized._text = 'Mensagem apagada';
    }
  } else {
    normalized._type = 'unknown';
  }

  return normalized;
}

function filterMessagesWorker(messages: any[], filter: string): any[] {
  if (!filter || filter === 'all') return messages;
  return messages.filter(m => m._type === filter);
}

function sortMessagesWorker(messages: any[]): any[] {
  return [...messages].sort((a, b) => 
    (a.messageTimestamp || 0) - (b.messageTimestamp || 0)
  );
}

export {};