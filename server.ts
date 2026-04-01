import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    WAMessageKey,
    Contact,
    proto,
    GroupMetadata
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import fs from "fs";
import multer from "multer";
import { readFileSync, unlinkSync } from "fs";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: "silent" });

// Normalize JID by removing device suffix for individual contacts
// e.g., "551199999:5@s.whatsapp.net" -> "551199999@s.whatsapp.net"
// Groups (@g.us) and LIDs (@lid) are not affected
const normalizeJid = (jid: string): string => {
    if (!jid) return jid;
    if (jid.endsWith('@s.whatsapp.net') && jid.includes(':')) {
        return jid.replace(/:\d+@/, '@');
    }
    return jid;
};

// File upload configuration
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 } });

// Presence tracking
const presenceMap = new Map<string, string>();

// Enhanced store implementation for Baileys v7 with contacts and groups
class SimpleStore {
    chats: {
        all: () => any[];
        get: (jid: string) => any;
        set: (jid: string, data: any) => void;
    };
    messages: { [jid: string]: { all: () => any[] } };
    contacts: { [jid: string]: any };
    groupMetadata: { [jid: string]: any };
    
    constructor() {
        const chatsMap = new Map<string, any>();
        const messagesMap = new Map<string, any[]>();
        const contactsMap = new Map<string, any>();
        const groupsMap = new Map<string, any>();
        
        this.chats = {
            all: () => Array.from(chatsMap.values()),
            get: (jid: string) => chatsMap.get(jid),
            set: (jid: string, data: any) => chatsMap.set(jid, data)
        };
        
        this.messages = {};
        const getMessagesObj = (jid: string) => {
            if (!this.messages[jid]) {
                this.messages[jid] = {
                    all: () => messagesMap.get(jid) || []
                };
            }
            return this.messages[jid];
        };
        
        this.contacts = contactsMap;
        this.groupMetadata = {};
    }
    
    // Helper to merge chat data - preserves local data while updating from API
    mergeChatData(existing: any, updates: any): any {
        if (!existing) return updates;
        
        // Create a new object with existing data
        const merged: any = { ...existing };
        
        // Update with new data from API
        // This ensures we get the latest metadata like archived status
        for (const key of Object.keys(updates)) {
            // Special handling for specific fields:
            
            // archived: API value takes precedence (user may have archived on mobile)
            if (key === 'archived' || key === 'archive') {
                merged.archived = updates[key];
            }
            // name/subject: API value takes precedence
            else if (key === 'name' || key === 'subject') {
                if (updates[key]) {
                    merged[key] = updates[key];
                }
            }
            // unreadCount: API value takes precedence
            else if (key === 'unreadCount') {
                merged.unreadCount = updates[key];
            }
            // timestamp fields: API value takes precedence
            else if (key === 'conversationTimestamp' || key === 'lastMessageRecvTimestamp') {
                if (updates[key]) {
                    merged[key] = updates[key];
                }
            }
            // For all other fields, merge
            else if (updates[key] !== undefined) {
                merged[key] = updates[key];
            }
        }
        
        return merged;
    }
    
    bind(eventEmitter: any) {
        // Handle new chats - upsert means insert or update
        eventEmitter.on("chats.upsert", (chats: any[]) => {
            console.log("[STORE] chats.upsert received:", chats.length, "chats");
            for (const chat of chats) {
                if (chat.id && (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@g.us'))) {
                    console.log(`[STORE] Upsert chat ${chat.id}: archived=${chat.archived}, name=${chat.name || chat.subject}`);
                    const existing = this.chats.get(chat.id);
                    const merged = this.mergeChatData(existing, chat);
                    this.chats.set(chat.id, merged);
                }
            }
        });
        
        // Handle chat updates - this is where mobile changes sync to web
        // When user archives a chat on mobile, this event is triggered
        eventEmitter.on("chats.update", (updates: any[]) => {
            console.log("[STORE] chats.update received:", JSON.stringify(updates, null, 2));
            for (const update of updates) {
                if (!update.id) continue;
                
                // Check if it's a valid chat (contact or group)
                if (!(update.id.endsWith('@s.whatsapp.net') || update.id.endsWith('@g.us'))) continue;
                
                const existing = this.chats.get(update.id);
                if (existing) {
                    console.log(`[STORE] Updating chat ${update.id}:`);
                    console.log(`  - Existing: archived=${existing.archived}, name=${existing.name || existing.subject}`);
                    console.log(`  - Update: archived=${update.archived}, name=${update.name}`);
                    
                    const merged = this.mergeChatData(existing, update);
                    console.log(`  - Merged: archived=${merged.archived}, name=${merged.name || merged.subject}`);
                    
                    this.chats.set(update.id, merged);
                }
            }
        });
        
        eventEmitter.on("messages.upsert", (m: { messages: any[], type: string }) => {
            console.log(`[STORE] messages.upsert fired: type=${m.type}, count=${m.messages?.length || 0}`);
            for (const msg of m.messages) {
                const jid = normalizeJid(msg.key.remoteJid!);
                console.log(`[STORE] msg from=${msg.key.fromMe ? 'ME' : jid}, ts=${msg.messageTimestamp}, type=${Object.keys(msg.message || {}).join(',') || 'none'}`);
                if (!this.messages[jid]) {
                    const arr: any[] = [];
                    this.messages[jid] = { all: () => arr };
                }
                const msgs = this.messages[jid].all();
                // Avoid duplicates
                if (!msgs.find((x: any) => x.key?.id === msg.key?.id)) {
                    msgs.push(msg);
                    console.log(`[STORE] msg stored for ${jid}, total=${msgs.length}`);
                } else {
                    console.log(`[STORE] duplicate msg skipped for ${jid}`);
                }
                
                // Also extract contact info from pushName
                const pushName = msg.pushName || msg.key?.pushName;
                if (pushName && jid) {
                    const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);
                    if (contactJid && !contactJid.includes('@g.us') && !contactJid.includes('@lid')) {
                        if (!this.contacts[contactJid]) {
                            this.contacts[contactJid] = {
                                id: contactJid,
                                name: pushName,
                                notify: pushName,
                                imgUrl: null
                            };
                        }
                    }
                }
            }
        });
        
        eventEmitter.on("contacts.upsert", (contacts: any[]) => {
            console.log("[STORE] contacts.upsert received:", contacts.length, "contacts");
            for (const contact of contacts) {
                if (contact.id) {
                    console.log(`[STORE] Contact ${contact.id}: name=${contact.name}, notify=${contact.notify}`);
                    // Merge contact data
                    const existing = this.contacts[contact.id];
                    if (existing) {
                        this.contacts[contact.id] = { ...existing, ...contact };
                    } else {
                        this.contacts[contact.id] = contact;
                    }
                    
                    // CRITICAL: Also create/update chat entry for this contact
                    // This ensures individual contacts appear in chat list
                    const chatJid = contact.id;
                    if (chatJid.endsWith('@s.whatsapp.net')) {
                        const existingChat = this.chats.get(chatJid);
                        if (!existingChat) {
                            this.chats.set(chatJid, {
                                id: chatJid,
                                name: contact.name || contact.notify || chatJid.split('@')[0],
                                unreadCount: 0,
                                archived: false
                            });
                            console.log(`[STORE] Created chat from contact ${chatJid}: ${contact.name || contact.notify}`);
                        }
                    }
                }
            }
        });
    }
    
    getContact(jid: string) {
        // Check if it's a group
        if (jid.endsWith('@g.us')) {
            return this.groupMetadata[jid] || null;
        }
        // Return contact info
        return this.contacts[jid] || null;
    }
    
    async fetchGroupMetadata(sock: any, jid: string) {
        try {
            const metadata = await sock.groupMetadata(jid);
            this.groupMetadata[jid] = metadata;
            return metadata;
        } catch (e) {
            return null;
        }
    }

    clearMessagesAndMetadata() {
        const msgCount = Object.keys(this.messages).length;
        const metaCount = Object.keys(this.groupMetadata).length;
        this.messages = {};
        this.groupMetadata = {};
        console.log(`[STORE] Daily cleanup: cleared ${msgCount} message JIDs and ${metaCount} group metadata entries`);
    }
}

const store = new SimpleStore();

// Persist store to file - including metadata like archived status
const storePath = path.join(__dirname, "baileys_store.json");
let lastStoreCleanup = Date.now();

const saveStore = () => {
    const chatsToSave = store.chats.all();
    console.log(`[STORE] Saving ${chatsToSave.length} chats to file...`);
    
    // Log a sample of archived chats being saved
    const archivedCount = chatsToSave.filter((c: any) => c.archived === true).length;
    console.log(`[STORE] Archived chats being saved: ${archivedCount}`);
    
    const data = {
        chats: chatsToSave,
        messages: Object.fromEntries(
            Object.entries(store.messages).map(([k, v]) => [k, v.all()])
        ),
        contacts: store.contacts,
        groupMetadata: store.groupMetadata,
        lastStoreCleanup
    };
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
};

// Load store from file if exists
if (fs.existsSync(storePath)) {
    try {
        const data = JSON.parse(fs.readFileSync(storePath, 'utf-8'));

        if (data.chats && Array.isArray(data.chats)) {
            for (const chat of data.chats) {
                if (chat.id && (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@g.us'))) {
                    store.chats.set(chat.id, chat);
                }
            }
            console.log("[STORE] Loaded chats from store file:", data.chats.length);
        }

        if (data.messages) {
            for (const [jid, msgs] of Object.entries(data.messages)) {
                store.messages[jid] = { all: () => msgs as any[] };
                if (!store.chats.get(jid)) {
                    store.chats.set(jid, {
                        id: jid,
                        name: jid.split('@')[0],
                        unreadCount: 0
                    });
                }
            }
            console.log("[STORE] Loaded messages from store file, JIDs:", Object.keys(data.messages).length);
        }

        if (data.contacts) {
            for (const [jid, contact] of Object.entries(data.contacts)) {
                store.contacts[jid] = contact;
                if (jid.endsWith('@s.whatsapp.net') && !store.chats.get(jid)) {
                    const c = contact as any;
                    store.chats.set(jid, {
                        id: jid,
                        name: c.name || c.notify || jid.split('@')[0],
                        unreadCount: 0
                    });
                }
            }
            console.log("[STORE] Loaded contacts from store file:", Object.keys(store.contacts).length);
        }

        if (data.groupMetadata) {
            for (const [jid, meta] of Object.entries(data.groupMetadata)) {
                store.groupMetadata[jid] = meta;
            }
            console.log("[STORE] Loaded group metadata from store file:", Object.keys(store.groupMetadata).length);
        }

        if (data.lastStoreCleanup) {
            lastStoreCleanup = data.lastStoreCleanup;
            console.log("[STORE] Last cleanup:", new Date(lastStoreCleanup).toISOString());
        }

    } catch (e) {
        console.log("[STORE] Failed to load store:", e);
    }
}

// Save store every 10 seconds
setInterval(saveStore, 10_000);

// Daily cleanup: clear messages and group metadata if 24h have passed
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const dailyCleanupCheck = () => {
    if (Date.now() - lastStoreCleanup >= TWENTY_FOUR_HOURS) {
        console.log("[STORE] 24h elapsed since last cleanup, clearing messages and metadata...");
        store.clearMessagesAndMetadata();
        lastStoreCleanup = Date.now();
        // Save AFTER clearing - this preserves chats and contacts in the file, without messages
        saveStore();
    }
};

// Check on startup and every hour
dailyCleanupCheck();
setInterval(dailyCleanupCheck, 60 * 60 * 1000);

async function startServer() {
    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
        }
    });

    const PORT = 3000;

    // Baileys Logic
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    let sock: any = null;
    let qrCode: string | null = null;
    let connectionStatus: "connecting" | "open" | "close" | "qr" = "connecting";

    // Helper function to get chat with avatar (defined at function scope so it can be used by API endpoints)
    const getChatWithAvatarFromStore = async (chat: any): Promise<any> => {
        let displayName = chat.name || chat.subject || chat.id.split('@')[0];
        let avatar = null;
        
        // Check for archived status - Baileys uses 'archive' field in updates, but 'archived' in history
        // Ensure we handle both cases
        const isArchived = chat.archive === true || chat.archived === true;
        
        // Try to get name from contacts
        const contact = store.contacts[chat.id];
        if (contact) {
            displayName = contact.notify || contact.name || displayName;
        }
        
        // For groups, try to get from group metadata
        if (chat.id.endsWith('@g.us')) {
            // First check if we have it in store
            if (store.groupMetadata[chat.id]) {
                displayName = store.groupMetadata[chat.id].subject || displayName;
            } else if (sock) {
                // Try to fetch group metadata
                try {
                    const groupMeta = await sock.groupMetadata(chat.id);
                    store.groupMetadata[chat.id] = groupMeta;
                    displayName = groupMeta.subject || displayName;
                } catch (e) {
                    // Group metadata not available
                }
            }
        }
        
        // Try to get profile picture
        if (sock) {
            try {
                avatar = await sock.profilePictureUrl(chat.id, 'image');
            } catch (e) {
                // No profile picture
            }
        }
        
        // Get last message for this chat
        let lastMessageText = '';
        let lastMessageSender = displayName; // Default to chat display name
        let lastMessageTime = chat.conversationTimestamp || chat.lastMessageRecvTimestamp || 0;
        let chatMessages = store.messages[chat.id]?.all() || [];
        
        // For individual contacts, also check device-specific JID variants
        if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
            const baseJid = chat.id.replace('@s.whatsapp.net', '');
            for (const key of Object.keys(store.messages)) {
                if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                    chatMessages = chatMessages.concat(store.messages[key]?.all() || []);
                }
            }
        }
        
        // Debug log
        if (chat.id.includes('@s.whatsapp.net')) {
            console.log(`[AVATAR] Chat ${chat.id}: ${chatMessages.length} messages, timestamp: ${lastMessageTime}, archived: ${isArchived}`);
        }
        
        if (chatMessages.length > 0) {
            // Sort by timestamp descending to get the most recent
            // Filter out reactions - they should not appear as last message preview (matches WhatsApp Web behavior)
            const sortedMessages = [...chatMessages]
                .filter((m: any) => !m.message?.reactionMessage)
                .sort((a: any, b: any) => 
                    (b.messageTimestamp || 0) - (a.messageTimestamp || 0)
                );
            const lastMsg = sortedMessages[0];
            
            if (lastMsg) {
                // Use the actual timestamp from the last message
                lastMessageTime = lastMsg.messageTimestamp || lastMessageTime;
                
                // For groups, try to get the sender's name from the message
                if (chat.id.endsWith('@g.us') && !lastMsg.key.fromMe) {
                    // Get sender name from pushName or participant
                    const senderName = lastMsg.pushName || lastMsg.key?.participant?.split('@')[0] || 'Membro';
                    lastMessageSender = senderName;
                }
                
                // Extract message text based on type
                if (lastMsg.message?.conversation) {
                    lastMessageText = lastMsg.message.conversation;
                } else if (lastMsg.message?.extendedTextMessage?.text) {
                    lastMessageText = lastMsg.message.extendedTextMessage.text;
                } else if (lastMsg.message?.imageMessage?.caption) {
                    lastMessageText = lastMsg.message.imageMessage.caption;
                } else if (lastMsg.message?.imageMessage) {
                    lastMessageText = '[Imagem]';
                } else if (lastMsg.message?.videoMessage?.caption) {
                    lastMessageText = lastMsg.message.videoMessage.caption;
                } else if (lastMsg.message?.videoMessage) {
                    lastMessageText = '[Vídeo]';
                } else if (lastMsg.message?.audioMessage) {
                    lastMessageText = lastMsg.message.audioMessage.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio';
                } else if (lastMsg.message?.stickerMessage) {
                    lastMessageText = 'Sticker';
                } else if (lastMsg.message?.documentMessage) {
                    lastMessageText = `📄 ${lastMsg.message.documentMessage.fileName || 'Documento'}`;
                } else {
                    lastMessageText = '[Mensagem]';
                }
            }
        }
        
        return {
            ...chat,
            id: chat.id,
            displayName,
            avatar,
            archived: isArchived,
            lastMessage: lastMessageText,
            lastMessageSender: lastMessageSender,
            lastMessageTime: lastMessageTime,
            conversationTimestamp: lastMessageTime
        };
    };

    // Helper to sort chats by most recent message (defined at function scope for API endpoints)
    const sortChatsByRecent = (chats: any[]): any[] => {
        return chats.sort((a, b) => {
            // Get timestamp from chat or from last message in store
            const aTime = a.conversationTimestamp || a.lastMessageRecvTimestamp || 0;
            const bTime = b.conversationTimestamp || b.lastMessageRecvTimestamp || 0;
            
            // If chat timestamp is 0 or undefined, try to get from store messages
            const aMsgTime = aTime === 0 || !aTime 
                ? (store.messages[a.id]?.all()?.sort((m1: any, m2: any) => (m2.messageTimestamp || 0) - (m1.messageTimestamp || 0))[0]?.messageTimestamp || 0)
                : aTime;
            const bMsgTime = bTime === 0 || !bTime 
                ? (store.messages[b.id]?.all()?.sort((m1: any, m2: any) => (m2.messageTimestamp || 0) - (m1.messageTimestamp || 0))[0]?.messageTimestamp || 0)
                : bTime;
            
            return bMsgTime - aMsgTime; // Descending order (most recent first)
        });
    };

    const connectToWhatsApp = async () => {
        sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: state,
            logger,
            browser: ["WhatsApp Web Clone", "Chrome", "1.0.0"],
            // Sincroniza o histórico completo do WhatsApp mobile
            syncFullHistory: true,
            // Opções de estabilidade de conexão
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 30_000,
            // Get message function for history
            getMessage: async (key: any) => {
                const messages = store.messages[key.remoteJid]?.all() || [];
                const msg = messages.find((m: any) => m.key.id === key.id);
                return msg?.message || undefined;
            }
        });

        store.bind(sock.ev);

        sock.ev.on("connection.update", async (update: any) => {
            const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;
            
            if (qr) {
                qrCode = await QRCode.toDataURL(qr);
                connectionStatus = "qr";
                io.emit("connection-update", { status: "qr", qr: qrCode });
            }

            if (connection === "close") {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const isConflict = (lastDisconnect?.error as any)?.data?.tag === 'conflict';
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                
                // Don't reconnect on conflict (another WhatsApp Web session is active)
                // or on logged out
                const shouldReconnect = !isLoggedOut && !isConflict;
                
                if (isConflict) {
                    console.log("\n[CONFLITO] Outra sessão do WhatsApp Web já está conectada com este número.");
                    console.log("Feche as outras abas do WhatsApp Web ou desconecte do celular (WhatsApp > Aparelhos conectados).");
                    console.log("Aguardando 30 segundos antes de tentar novamente...\n");
                    connectionStatus = "close";
                    io.emit("connection-update", { status: "close", error: "Outra sessão do WhatsApp Web está ativa. Feche as outras abas ou desconecte do celular." });
                    // Retry after 30 seconds
                    setTimeout(() => {
                        console.log("[CONFLITO] Tentando reconectar...");
                        connectToWhatsApp();
                    }, 30_000);
                } else {
                    console.log("connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect);
                    connectionStatus = "close";
                    io.emit("connection-update", { status: "close" });
                    if (shouldReconnect) {
                        // Add delay to avoid rapid reconnection loops
                        setTimeout(() => connectToWhatsApp(), 5_000);
                    }
                }
            } else if (connection === "open") {
                console.log("opened connection");
                console.log("User JID:", sock.user?.id);
                console.log("receivedPendingNotifications:", receivedPendingNotifications);
                connectionStatus = "open";
                qrCode = null;
                io.emit("connection-update", { status: "open" });
                
                // Emit current chats and wait for WhatsApp to send more via events
                setTimeout(async () => {
                    console.log("[SYNC] Checking for chats after connection...");
                    
                    let chats = store.chats.all().filter((c: any) => 
                        (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
                    );
                    
                    console.log("Chats found:", chats.length);
                    
                    // Recalculate timestamps from messages before emitting
                    for (const chat of chats) {
                        const chatMessages = store.messages[chat.id]?.all() || [];
                        if (chatMessages.length > 0) {
                            const latestMsgTs = Math.max(...chatMessages.map((m: any) => m.messageTimestamp || 0));
                            if (latestMsgTs > 0 && (!chat.conversationTimestamp || latestMsgTs > chat.conversationTimestamp)) {
                                chat.conversationTimestamp = latestMsgTs;
                                store.chats.set(chat.id, chat);
                            }
                        }
                    }
                    
                    // Send whatever chats we have - use the outer function that checks contacts and groups
                    // Sort by most recent first - ALREADY FILTERED archived above
                    const chatsSorted = sortChatsByRecent(chats);
                    const chatsWithAvatars = await Promise.all(chatsSorted.map(getChatWithAvatar));
                    console.log("Emitting chats:", chatsWithAvatars.length);
                    io.emit("chats-list", chatsWithAvatars);
                    
                    // Delayed re-emit after history sync has had time to complete
                    // This catches updates from messaging-history.set that arrive after the initial emit
                    setTimeout(async () => {
                        console.log("[DELAYED-SYNC] Re-emitting chats-list after history sync settle...");
                        let allChats = store.chats.all().filter((c: any) => 
                            (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
                        );
                        // Recalculate timestamps one more time
                        for (const chat of allChats) {
                            const chatMessages = store.messages[chat.id]?.all() || [];
                            if (chatMessages.length > 0) {
                                const latestMsgTs = Math.max(...chatMessages.map((m: any) => m.messageTimestamp || 0));
                                if (latestMsgTs > 0 && (!chat.conversationTimestamp || latestMsgTs > chat.conversationTimestamp)) {
                                    chat.conversationTimestamp = latestMsgTs;
                                    store.chats.set(chat.id, chat);
                                }
                            }
                        }
                        allChats = store.chats.all().filter((c: any) => 
                            (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
                        );
                        allChats = sortChatsByRecent(allChats);
                        const refreshedWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
                        console.log(`[DELAYED-SYNC] Re-emitting ${refreshedWithAvatars.length} chats with fresh timestamps`);
                        io.emit("chats-list", refreshedWithAvatars);
                    }, 15000);
                    
                    // Safety sync: after another delay, ensure all contacts have chat entries
                    // This catches contacts that arrived via contacts.upsert after the initial emit
                    setTimeout(async () => {
                        console.log("[SAFETY] Running delayed contact-to-chat sync...");
                        let createdCount = 0;
                        for (const [jid, contact] of Object.entries(store.contacts)) {
                            if (jid.endsWith('@s.whatsapp.net') && !store.chats.get(jid)) {
                                const c = contact as any;
                                store.chats.set(jid, {
                                    id: jid,
                                    name: c.name || c.notify || jid.split('@')[0],
                                    unreadCount: 0,
                                    conversationTimestamp: Math.floor(Date.now() / 1000)
                                });
                                createdCount++;
                            }
                        }
                        console.log(`[SAFETY] Created ${createdCount} chats from contacts`);
                        
                        // Re-emit the full chat list if any were created
                        if (createdCount > 0) {
                            let allChats = store.chats.all().filter((c: any) => 
                                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
                            );
                            allChats = sortChatsByRecent(allChats);
                            const allWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
                            console.log(`[SAFETY] Re-emitting ${allWithAvatars.length} active chats`);
                            io.emit("chats-list", allWithAvatars);
                        }

                        // Update group metadata on every startup
                        const groupChats = store.chats.all().filter((c: any) => c.id.endsWith('@g.us'));
                        console.log(`[GROUPS] Fetching metadata for ${groupChats.length} groups...`);
                        let groupsUpdated = 0;
                        for (const group of groupChats) {
                            try {
                                const meta = await sock.groupMetadata(group.id);
                                store.groupMetadata[group.id] = meta;
                                // Update chat name with group subject
                                if (meta.subject) {
                                    const existingChat = store.chats.get(group.id);
                                    if (existingChat) {
                                        existingChat.name = meta.subject;
                                        store.chats.set(group.id, existingChat);
                                    }
                                }
                                groupsUpdated++;
                            } catch (e) {
                                // Group might have been deleted
                            }
                        }
                        console.log(`[GROUPS] Updated metadata for ${groupsUpdated}/${groupChats.length} groups`);
                        
                        // Re-emit chats with updated group names - FILTER archived
                        let refreshedChats = store.chats.all().filter((c: any) => 
                            (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
                        );
                        refreshedChats = sortChatsByRecent(refreshedChats);
                        const refreshedWithAvatars = await Promise.all(refreshedChats.map(getChatWithAvatarFromStore));
                        io.emit("chats-list", refreshedWithAvatars);
                    }, 5000);
                }, 8000);
            }
        });

        sock.ev.on("creds.update", saveCreds);

        // Function to get chat with avatar info - uses improved logic with contacts and groups
        // Also sorts chats by conversationTimestamp (most recent first)
        const getChatWithAvatar = async (chat: any) => {
            return await getChatWithAvatarFromStore(chat);
        };

        // Create a helper function to ensure chat exists
        const ensureChatExists = (jid: string) => {
            const existingChat = store.chats.get(jid);
            if (!existingChat) {
                // Try to get name from contacts
                const contact = store.contacts[jid];
                const chatName = contact?.name || contact?.notify || jid.split('@')[0];
                // Create a basic chat entry
                store.chats.set(jid, {
                    id: jid,
                    name: chatName,
                    unreadCount: 0,
                    conversationTimestamp: Math.floor(Date.now() / 1000)
                });
            }
        };

        sock.ev.on("chats.upsert", async (chats: any[]) => {
            console.log("[SOCKET] chats.upsert event received:", chats.length, "chats");
            // Ensure each chat exists before updating - USE MERGE to preserve archived status
            for (const chat of chats) {
                if (chat.id && (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@g.us'))) {
                    console.log(`[SOCKET] Upsert chat ${chat.id}: archived=${chat.archived}, archive=${chat.archive}, name=${chat.name || chat.subject}`);
                    const existing = store.chats.get(chat.id);
                    const merged = store.mergeChatData(existing, chat);
                    store.chats.set(chat.id, merged);
                }
            }
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            console.log(`[SOCKET] Emitting chats-list after upsert: ${allWithAvatars.length} chats (archived filtered)`);
            io.emit("chats-list", allWithAvatars);
        });
        
        // CRITICAL: Handle chat metadata updates from WhatsApp server
        // This is where changes made on mobile (like archiving) sync to web
        sock.ev.on("chats.update", async (updates: any[]) => {
            console.log("[SOCKET] chats.update received:", JSON.stringify(updates, null, 2));
            
            for (const update of updates) {
                if (!update.id) continue;
                
                console.log(`[SOCKET] Processing update for chat ${update.id}`);
                console.log(`[SOCKET] Update payload: archived=${update.archived}, name=${update.name}, archive=${update.archive}`);
                
                // Check if it's a valid chat
                if (!(update.id.endsWith('@s.whatsapp.net') || update.id.endsWith('@g.us'))) {
                    console.log(`[SOCKET] Skipping non-chat JID: ${update.id}`);
                    continue;
                }
                
                const chat = store.chats.get(update.id);
                if (chat) {
                    // Merge the update with existing chat data
                    // The mergeChatData in SimpleStore handles this properly
                    const mergedChat = { ...chat, ...update };
                    
                    console.log(`[SOCKET] Before merge - archived=${chat.archived}, name=${chat.name || chat.subject}`);
                    console.log(`[SOCKET] After merge - archived=${mergedChat.archived}, name=${mergedChat.name || mergedChat.subject}`);
                    
                    // Update the store
                    store.chats.set(update.id, mergedChat);
                } else {
                    // Chat doesn't exist in store (e.g. after store cleanup) - create it from the update
                    const contactInfo = store.contacts[update.id];
                    const chatName = update.name || update.subject || contactInfo?.name || contactInfo?.notify || update.id.split('@')[0];
                    store.chats.set(update.id, {
                        id: update.id,
                        name: chatName,
                        archived: update.archived || update.archive || false,
                        unreadCount: update.unreadCount || 0,
                        ...update
                    });
                    console.log(`[SOCKET] Created chat from update ${update.id}: ${chatName}`);
                }
            }
            
            // Get all chats and emit to frontend - FILTER OUT archived
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            console.log(`[SOCKET] Emitting chats-list after update: ${allWithAvatars.length} active chats`);
            io.emit("chats-list", allWithAvatars);
        });

        sock.ev.on("contacts.upsert", async (contacts: any[]) => {
            console.log("[SOCKET] contacts.upsert event received:", contacts.length, "contacts");
            
            for (const contact of contacts) {
                console.log(`[SOCKET] Processing contact ${contact.id}: name=${contact.name}, notify=${contact.notify}`);
                
                store.contacts[contact.id] = contact;
                
                // CRITICAL: Also create chat entry for individual contacts if not exists
                // This ensures contacts appear in the chat list
                if (contact.id.endsWith('@s.whatsapp.net')) {
                    const existingChat = store.chats.get(contact.id);
                    if (!existingChat) {
                        store.chats.set(contact.id, {
                            id: contact.id,
                            name: contact.name || contact.notify || contact.id.split('@')[0],
                            unreadCount: 0,
                            archived: false,
                            conversationTimestamp: Math.floor(Date.now() / 1000)
                        });
                        console.log(`[SOCKET] Created chat from contact ${contact.id}: ${contact.name || contact.notify}`);
                    } else {
                        // Update existing chat with contact name - PRESERVE archived status
                        const updatedChat = {
                            ...existingChat,
                            name: contact.name || contact.notify || existingChat.name
                            // Do NOT touch archived - preserve existing value
                        };
                        store.chats.set(contact.id, updatedChat);
                    }
                }
            }
            
            // Emit contacts to frontend
            io.emit("contacts-update", Object.values(store.contacts));
            
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            
            console.log(`[SOCKET] Emitting chats-list from contacts.upsert: ${allWithAvatars.length} active chats`);
            
            io.emit("chats-list", allWithAvatars);
        });

        sock.ev.on("messages.upsert", async (m: any) => {
            // Process ALL message types: "notify" (new incoming), "append" (history/sent from other devices)
            console.log(`[SOCKET] messages.upsert: type=${m.type}, count=${m.messages?.length || 0}`);
            for (const msg of m.messages) {
                const jid = normalizeJid(msg.key.remoteJid);
                if (!jid) continue;
                
                // Ensure chat exists for this message (won't overwrite archived)
                ensureChatExists(jid);
                
                // Store the message - use persistent array to avoid losing messages
                if (!store.messages[jid]) {
                    const arr: any[] = [];
                    store.messages[jid] = { all: () => arr };
                }
                const msgs = store.messages[jid].all();
                if (!msgs.find((x: any) => x.key?.id === msg.key?.id)) {
                    msgs.push(msg);
                }
                
                // Update chat timestamp
                const chat = store.chats.get(jid);
                if (chat && msg.messageTimestamp) {
                    if (!chat.conversationTimestamp || msg.messageTimestamp > chat.conversationTimestamp) {
                        chat.conversationTimestamp = msg.messageTimestamp;
                        store.chats.set(jid, chat);
                    }
                }
                
                // Extract pushName from message and store as contact
                const pushName = msg.pushName || msg.key?.pushName;
                if (pushName && jid) {
                    const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);
                    if (contactJid && !contactJid.includes('@g.us') && !contactJid.includes('@lid')) {
                        if (!store.contacts[contactJid]) {
                            store.contacts[contactJid] = {
                                id: contactJid,
                                name: pushName,
                                notify: pushName,
                                imgUrl: null
                            };
                        }
                        // Ensure chat entry exists for this contact (only if missing)
                        const existingChat = store.chats.get(contactJid);
                        if (!existingChat) {
                            store.chats.set(contactJid, {
                                id: contactJid,
                                name: pushName,
                                unreadCount: 0,
                                conversationTimestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000)
                            });
                        }
                    }
                }
                
                // Emit ALL new messages (including fromMe) for real-time sync
                // Frontend handles deduplication
                io.emit("new-message", msg);
            }
            
            // Update chat list after processing messages
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            io.emit("chats-list", allWithAvatars);
        });

        // Sincronização em tempo real: mensagens editadas ou excluídas
        sock.ev.on("messages.update", async (updates: any[]) => {
            console.log("Messages update received:", JSON.stringify(updates, null, 2));
            
            for (const update of updates) {
                const { key, update: msgUpdate } = update;
                const jid = normalizeJid(key.remoteJid);
                
                // Ensure chat exists
                ensureChatExists(jid);
                
                // Get messages for this chat
                const messages = store.messages[jid]?.all() || [];
                const msgIndex = messages.findIndex((m: any) => m.key?.id === key.id);
                
                if (msgIndex !== -1) {
                    const msg = messages[msgIndex];
                    
                    // Handle different update types
                    if (msgUpdate.update === 'delete') {
                        // Message was deleted
                        console.log("Message deleted:", key.id);
                        io.emit("message-deleted", { jid, messageId: key.id });
                    } else if (msgUpdate.update === 'message') {
                        // Message was edited
                        console.log("Message edited:", key.id);
                        msg.message = msgUpdate.message;
                        io.emit("message-updated", msg);
                    } else if (msgUpdate.update === 'status') {
                        // Status update (e.g., read, delivered)
                        console.log("Message status update:", key.id, msgUpdate.update);
                        io.emit("message-status-update", { jid, messageId: key.id, status: msgUpdate.status });
                    }
                }
                

            }
            
            // Update chat list with recent messages - FILTER archived
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            io.emit("chats-list", allWithAvatars);
        });

        // Sincronização em tempo real: recibos de mensagem (leitura, entrega)
        sock.ev.on("message-receipt.update", async (receipts: any[]) => {
            console.log("Message receipts update received:", JSON.stringify(receipts, null, 2));
            
            for (const receiptData of receipts) {
                const { key, receipt: receiptInfo } = receiptData;
                const jid = key.remoteJid;
                const messageId = key.id;
                
                // Different receipt types:
                // - 'read' = mensagem foi lida
                // - 'delivered' = mensagem foi entregue
                // - 'played' = áudio foi reproduzido
                const receiptType = receiptInfo.type || 'delivered';
                
                console.log("Receipt:", messageId, "from", jid, "type:", receiptType);
                
                // Emit receipt update to frontend
                io.emit("message-receipt", {
                    jid,
                    messageId,
                    type: receiptType,
                    timestamp: receiptInfo.timestamp
                });
            }
        });

        sock.ev.on("contacts.update", (contacts: Contact[]) => {
            io.emit("contacts-update", contacts);
        });

        // Handle presence updates (online/offline/typing)
        sock.ev.on("presence.update", (update: any) => {
            const id = update.id;
            if (id) {
                const presences = update.presences || {};
                for (const [jid, presence] of Object.entries(presences)) {
                    const p = presence as any;
                    const status = p.lastKnownPresence || 'unavailable';
                    presenceMap.set(jid, status);
                    io.emit("presence-update", { jid, status });
                }
            }
        });
        
        // Handle reactions - Baileys emits 'messages.reaction' events
        sock.ev.on("messages.reaction", async (reactions: any[]) => {
            console.log("Received reactions:", JSON.stringify(reactions, null, 2));
            
            for (const reactionData of reactions) {
                const { key, reaction } = reactionData;
                const jid = normalizeJid(key.remoteJid);
                
                // Ensure chat exists
                ensureChatExists(jid);
                
                // Create a reaction message object
                const reactionMsg = {
                    key: key,
                    message: {
                        reactionMessage: {
                            key: key,
                            text: reaction?.text || '',
                            sender: reaction?.sender || key.participant
                        }
                    },
                    messageTimestamp: reaction?.timestamp || Math.floor(Date.now() / 1000),
                    pushName: reaction?.pushName || key?.pushName
                };
                
                // Store the reaction in messages - use persistent array
                if (!store.messages[jid]) {
                    const arr: any[] = [];
                    store.messages[jid] = { all: () => arr };
                }
                const msgs = store.messages[jid].all();
                msgs.push(reactionMsg);
                
                // Emit reaction to frontend
                io.emit("new-reaction", {
                    jid,
                    reaction: reactionMsg,
                    targetMessageKey: key
                });
                
                // Also emit as new-message to update chat list (showing reaction emoji)
                io.emit("new-message", reactionMsg);
            }
        });
        
        // Handle messaging history sync - this is where chats come from in Baileys v7
        sock.ev.on("messaging-history.set", async (history: any) => {
            console.log("[SOCKET] Received messaging-history.set event:", {
                chats: history.chats?.length || 0,
                contacts: history.contacts?.length || 0,
                messages: history.messages?.length || 0,
                syncType: history.syncType
            });
            
            // Track archived chats being loaded
            let archivedCount = 0;
            
            // Process chats from history
            if (history.chats && history.chats.length > 0) {
                for (const chat of history.chats) {
                    if (chat.id && (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@g.us'))) {
                        console.log(`[SOCKET] History chat ${chat.id}: archived=${chat.archived}, name=${chat.name || chat.subject}`);
                        
                        if (chat.archived === true) {
                            archivedCount++;
                        }
                        
                        store.chats.set(chat.id, chat);
                    }
                }
                console.log(`[SOCKET] Processed ${history.chats.length} chats from history, ${archivedCount} archived`);
            }
            
            // Process contacts from history
            if (history.contacts && history.contacts.length > 0) {
                for (const contact of history.contacts) {
                    if (contact.id) {
                        // Merge contact data
                        const existing = store.contacts[contact.id];
                        if (existing) {
                            store.contacts[contact.id] = { ...existing, ...contact };
                        } else {
                            store.contacts[contact.id] = contact;
                        }
                        
                        // Always ensure chat entry exists for individual contacts
                        if (contact.id.endsWith('@s.whatsapp.net')) {
                            const existingChat = store.chats.get(contact.id);
                            const contactName = contact.name || contact.notify || contact.id.split('@')[0];
                            if (!existingChat) {
                                store.chats.set(contact.id, {
                                    id: contact.id,
                                    name: contactName,
                                    unreadCount: 0,
                                    conversationTimestamp: Math.floor(Date.now() / 1000)
                                });
                                console.log(`[SOCKET] Created chat from history contact ${contact.id}: ${contactName}`);
                            } else if (!existingChat.name || existingChat.name === contact.id.split('@')[0]) {
                                // Update chat name if it's currently just a phone number
                                existingChat.name = contactName;
                                store.chats.set(contact.id, existingChat);
                            }
                        }
                    }
                }
                console.log(`[SOCKET] Processed ${history.contacts.length} contacts from history`);
            }
            
            // Process messages from history - STORE MESSAGES AND CREATE CHATS FROM MESSAGE JIDs!
            if (history.messages && history.messages.length > 0) {
                for (const msg of history.messages) {
                    const jid = msg.key?.remoteJid ? normalizeJid(msg.key.remoteJid) : null;
                    
                    // Extract pushName from message and store as contact
                    if (msg.pushName && jid) {
                        const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);
                        if (contactJid && !contactJid.includes('@g.us') && !contactJid.includes('@lid')) {
                            store.contacts[contactJid] = {
                                id: contactJid,
                                name: msg.pushName,
                                notify: msg.pushName,
                                imgUrl: null
                            };
                        }
                    }
                    
                    if (jid) {
                        // Store the actual message - use persistent array to avoid losing messages
                        if (!store.messages[jid]) {
                            const arr: any[] = [];
                            store.messages[jid] = { all: () => arr };
                        }
                        const msgs = store.messages[jid].all();
                        // Avoid duplicates
                        if (!msgs.find((x: any) => x.key?.id === msg.key?.id)) {
                            msgs.push(msg);
                        }

                        const existingChat = store.chats.get(jid);
                        if (!existingChat) {
                            // Create a basic chat entry for this JID
                            const contactInfo = store.contacts[jid];
                            const chatName = contactInfo?.name || contactInfo?.notify || jid.split('@')[0];
                            store.chats.set(jid, {
                                id: jid,
                                name: chatName,
                                unreadCount: 0,
                                conversationTimestamp: msg.messageTimestamp
                            });
                        } else if (msg.messageTimestamp && (!existingChat.conversationTimestamp || msg.messageTimestamp > existingChat.conversationTimestamp)) {
                            // Update timestamp if this message is newer
                            existingChat.conversationTimestamp = msg.messageTimestamp;
                        }
                    }
                }
                console.log(`[SOCKET] Stored ${history.messages.length} messages from history`);
            }
            
            // Recalculate conversationTimestamp for ALL chats from their latest messages
            // This ensures timestamps are always correct even if WhatsApp sends stale data
            for (const chat of store.chats.all()) {
                const chatMessages = store.messages[chat.id]?.all() || [];
                if (chatMessages.length > 0) {
                    const latestMsgTs = Math.max(...chatMessages.map((m: any) => m.messageTimestamp || 0));
                    if (latestMsgTs > 0 && (!chat.conversationTimestamp || latestMsgTs > chat.conversationTimestamp)) {
                        chat.conversationTimestamp = latestMsgTs;
                        store.chats.set(chat.id, chat);
                    }
                }
            }
            
            // Get all ACTIVE chats with avatars - FILTER archived
            // Sort by most recent first
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            
            // Log counts for debugging
            const totalChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            const totalArchivedCount = totalChats.filter((c: any) => c.archived === true).length;
            console.log(`[SOCKET] After history sync: ${totalChats.length} total, ${totalArchivedCount} archived, ${allChats.length} active to emit`);
            
            const chatsWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
            console.log(`[SOCKET] Emitting chats-list from history sync: ${chatsWithAvatars.length} active chats`);
            io.emit("chats-list", chatsWithAvatars);
        });
    };

    connectToWhatsApp();

    // API Routes
    app.get("/api/status", (req, res) => {
        res.json({ status: connectionStatus, qr: qrCode });
    });

    // Load archived chats from server
    app.get("/api/load-archived", async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log("Loading archived chats...");
            
            // Get all chats from store and check for archived flag
            const allChats = store.chats.all();
            console.log("Total chats in store:", allChats.length);
            
            // Filter chats that are archived (archived === true OR archive === true)
            // Baileys may send either 'archived' or 'archive' depending on the event type
            const isChatArchived = (c: any) => 
                (c.archived === true || c.archive === true) &&
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'));

            let archivedChats = allChats.filter(isChatArchived);
            
            console.log("Direct archived chats in store:", archivedChats.length);
            
            // If no explicitly archived chats, check if there are any with archived property set
            // This is for debugging - some chats might be in a different state
            const chatsWithArchivedProp = allChats.filter((c: any) => 
                c.archived !== undefined &&
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
            );
            console.log("Chats with archived property (true/false):", chatsWithArchivedProp.length);
            
            // Now try to actually fetch archived chats from WhatsApp server
            // This forces WhatsApp to send the archived conversations
            if (archivedChats.length === 0 && sock) {
                try {
                    console.log("Attempting to fetch archived chats from WhatsApp server...");
                    
                    // Method 1: Use chatModify to trigger archive sync
                    // This doesn't modify anything but may trigger a sync
                    const allJids = store.chats.all()
                        .filter((c: any) => c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
                        .map((c: any) => c.id);
                    
                    // Just request one archived chat to trigger the sync
                    // This is a workaround - the real way is to have user open archived tab in WA
                    for (const jid of allJids.slice(0, 5)) {
                        try {
                            await sock.chatModify({ archive: false }, jid);
                        } catch (e) {}
                    }
                    
                    // Wait and check again
                    await new Promise(r => setTimeout(r, 2000));
                    
                    archivedChats = store.chats.all().filter(isChatArchived);
                    
                    console.log("After sync attempt, archived chats:", archivedChats.length);
                } catch (e) {
                    console.log("Error fetching archived:", e);
                }
            }
            
            const archivedWithAvatars = await Promise.all(archivedChats.map(getChatWithAvatarFromStore));
            console.log("Archived chats found:", archivedWithAvatars.length);
            
            res.json({ 
                count: archivedWithAvatars.length, 
                chats: archivedWithAvatars 
            });
        } catch (e) {
            console.log("Error loading archived:", e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // Archive/Unarchive a chat
    app.post("/api/archive-chat", express.json(), async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            const { jid, archive } = req.body;
            console.log(`Archiving chat ${jid}:`, archive);
            
            // Use Baileys chatModify to archive/unarchive
            await sock.chatModify({ archive: archive }, jid);
            
            // Update local store
            const chat = store.chats.get(jid);
            if (chat) {
                store.chats.set(jid, { ...chat, archived: archive });
            }
            
            // Re-emit active chats list (archived chat will disappear from active list)
            let activeChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            activeChats = sortChatsByRecent(activeChats);
            const activeWithAvatars = await Promise.all(activeChats.map(getChatWithAvatarFromStore));
            io.emit("chats-list", activeWithAvatars);
            
            res.json({ success: true, archived: archive });
        } catch (e) {
            console.log("Error archiving chat:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // Force refresh chats - triggers Baileys to fetch from server
    app.get("/api/refresh-chats", async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log("[API] Force refreshing chats from WhatsApp server...");
            
            // Get current ACTIVE chats - FILTER archived
            const activeChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            
            console.log("[API] Active chats in store:", activeChats.length);
            
            // Log total and archived counts for debugging
            const allChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            const archivedCount = allChats.filter((c: any) => c.archived === true).length;
            console.log(`[API] Total: ${allChats.length}, Archived: ${archivedCount}, Active: ${activeChats.length}`);
            
            // Emit only active chats
            const chatsWithAvatars = await Promise.all(activeChats.map(getChatWithAvatarFromStore));
            
            io.emit("chats-list", chatsWithAvatars);
            
            res.json({ 
                count: chatsWithAvatars.length, 
                archivedCount: archivedCount,
                chats: chatsWithAvatars,
                message: "Chats list refreshed from server" 
            });
        } catch (e) {
            console.log("[API] Error refreshing chats:", e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // Force sync from WhatsApp server - triggers metadata sync
    app.get("/api/sync-chats", async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log("[API] Requesting chat metadata sync from WhatsApp server...");
            
            // Get all chat JIDs
            const allJids = store.chats.all()
                .filter((c: any) => c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
                .map((c: any) => c.id);
            
            console.log(`[API] Will sync metadata for ${allJids.length} chats`);
            
            // The act of fetching group metadata can help trigger sync
            // Also try to fetch chat metadata for each chat
            for (const jid of allJids.slice(0, 20)) { // Limit to 20 to avoid timeout
                try {
                    // This can help trigger the metadata sync for the chat
                    if (jid.endsWith('@g.us') && sock.groupMetadata) {
                        const meta = await sock.groupMetadata(jid);
                        store.groupMetadata[jid] = meta;
                    }
                    
                    // Small delay between requests
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (e) {
                    // Ignore errors for individual chats
                }
            }
            
            // After potential sync, emit updated ACTIVE chats - FILTER archived
            let allChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            
            const chatsWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
            
            const totalChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            const archivedCount = totalChats.filter((c: any) => c.archived === true).length;
            console.log(`[API] Sync complete: ${totalChats.length} total, ${archivedCount} archived, ${chatsWithAvatars.length} active`);
            
            io.emit("chats-list", chatsWithAvatars);
            
            res.json({ 
                count: chatsWithAvatars.length,
                archivedCount: archivedCount,
                message: "Chat metadata synchronized" 
            });
        } catch (e) {
            console.log("[API] Error syncing chats:", e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // Debug endpoint to check store
    app.get("/api/debug/store", (req, res) => {
        const chats = store.chats.all();
        const contacts = store.contacts;
        
        // Get archived stats
        const archivedChats = chats.filter((c: any) => c.archived === true);
        const activeChats = chats.filter((c: any) => c.archived !== true);
        
        // Get chats by type
        const individualChats = chats.filter((c: any) => c.id.endsWith('@s.whatsapp.net'));
        const groupChats = chats.filter((c: any) => c.id.endsWith('@g.us'));
        
        res.json({
            chatsCount: chats.length,
            contactsCount: Object.keys(contacts).length,
            archivedChatsCount: archivedChats.length,
            activeChatsCount: activeChats.length,
            individualChatsCount: individualChats.length,
            groupChatsCount: groupChats.length,
            individualChatsSample: individualChats.slice(0, 5).map((c: any) => ({
                id: c.id,
                name: c.name || c.subject,
                archived: c.archived
            })),
            groupChatsSample: groupChats.slice(0, 3)
        });
    });

    // Force fetch all chats using Baileys
    app.get("/api/fetch-chats", async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log("Fetching all chats via API...");
            
            // Try different methods to get chats
            if (sock.loadAllOldChatIds) {
                console.log("Loading all old chat IDs...");
                await sock.loadAllOldChatIds();
            }
            
            // Wait for sync
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Try to resync app state to trigger chat updates
            try {
                if (typeof sock.resyncAppState === 'function') {
                    await sock.resyncAppState(['regular_high', 'regular_low', 'regular'], false);
                    console.log("App state resync triggered");
                }
            } catch (e) {
                console.log("Error resyncing app state:", e);
            }
            
            // Also try to send a message to ourselves to trigger full sync
            if (sock.user?.id) {
                try {
                    // Send a hidden message to trigger sync
                    await sock.sendMessage(sock.user.id, { text: '🔄' }, {
                        background: true,
                        waitForResponse: false
                    });
                } catch (e) {}
            }
            
            // Wait more for sync
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const chats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            
            // Get avatars - use the function that checks contacts and groups
            const chatsWithAvatars = await Promise.all(chats.map(getChatWithAvatarFromStore));
            
            console.log("Active chats after fetch:", chatsWithAvatars.length);
            
            io.emit("chats-list", chatsWithAvatars);
            res.json({ count: chatsWithAvatars.length, chats: chatsWithAvatars });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Sync message history manually
    app.get("/api/sync-history", async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log("Requesting message history sync...");
            
            // Try to trigger history sync - fetch some recent messages
            const jid = req.query.jid as string;
            if (jid) {
                // Fetch history for specific chat
                const key = {
                    remoteJid: jid,
                    fromMe: false,
                    id: ''
                };
                await sock.fetchMessageHistory(50, key, Math.floor(Date.now() / 1000));
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const chats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            
            // Get avatars - use the function that checks contacts and groups
            const chatsWithAvatars = await Promise.all(chats.map(getChatWithAvatarFromStore));
            io.emit("chats-list", chatsWithAvatars);
            res.json({ count: chatsWithAvatars.length });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get("/api/chats", (req, res) => {
        // Return ACTIVE chats from store with contact info - FILTER archived
        const chats = store.chats.all().filter((c: any) => 
            (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
        ).map((chat: any) => {
            const contact = store.getContact(chat.id);
            let name = chat.name || chat.subject;
            let avatar = null;
            let description = '';
            
            if (chat.id.endsWith('@g.us') && contact) {
                name = contact.subject || name;
                description = contact.desc || '';
            } else if (contact) {
                name = contact.notify || contact.name || name;
            }
            
            return {
                ...chat,
                displayName: name || chat.id.split('@')[0],
                avatar: avatar,
                description: description
            };
        });
        res.json(chats);
    });

    // Get chat with full details including avatar
    app.get("/api/chat/:jid", async (req, res) => {
        const { jid } = req.params;
        
        try {
            const chat = store.chats.get(jid);
            if (!chat) {
                return res.status(404).json({ error: "Chat not found" });
            }
            
            let displayName = chat.name || chat.subject;
            let avatar = null;
            let participants = [];
            let description = '';
            
            // Get profile picture for both contacts and groups
            if (sock) {
                try {
                    const profilePic = await sock.profilePictureUrl(jid, 'image');
                    avatar = profilePic;
                } catch (e) {
                    // Profile pic not available
                }
            }
            
            if (jid.endsWith('@g.us')) {
                // Get group metadata
                try {
                    if (sock) {
                        const groupMeta = await sock.groupMetadata(jid);
                        store.groupMetadata[jid] = groupMeta;
                        displayName = groupMeta.subject || displayName;
                        participants = groupMeta.participants || [];
                        description = groupMeta.desc || '';
                    }
                } catch (e) {
                    // Group metadata not available
                }
            } else {
                // Get contact info
                const contact = store.contacts[jid];
                if (contact) {
                    displayName = contact.notify || contact.name || displayName;
                }
            }
            
            res.json({
                ...chat,
                id: jid,
                displayName,
                avatar,
                participants,
                description
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get profile picture
    app.get("/api/avatar/:jid", async (req, res) => {
        const { jid } = req.params;
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            const profilePic = await sock.profilePictureUrl(jid, 'image');
            res.json({ url: profilePic });
        } catch (e) {
            res.json({ url: null });
        }
    });

    // Get group metadata
    app.get("/api/group/:jid", async (req, res) => {
        const { jid } = req.params;
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            const groupMeta = await sock.groupMetadata(jid);
            store.groupMetadata[jid] = groupMeta;
            res.json(groupMeta);
        } catch (e) {
            res.status(500).json({ error: "Failed to get group metadata" });
        }
    });

    app.get("/api/messages/:jid", (req, res) => {
        const { jid } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const before = req.query.before as string;
        
        // Collect messages from the requested JID and all device variants
        let allMsgs: any[] = [];
        const seen = new Set<string>();
        
        // Check the exact JID first
        for (const msg of (store.messages[jid]?.all() || [])) {
            if (msg.key?.id && !seen.has(msg.key.id)) {
                seen.add(msg.key.id);
                allMsgs.push(msg);
            }
        }
        
        // For individual contacts, also check device-specific JID variants
        if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
            const baseJid = jid.replace('@s.whatsapp.net', '');
            for (const key of Object.keys(store.messages)) {
                if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                    for (const msg of (store.messages[key]?.all() || [])) {
                        if (msg.key?.id && !seen.has(msg.key.id)) {
                            seen.add(msg.key.id);
                            allMsgs.push(msg);
                        }
                    }
                }
            }
        }
        
        // Sort by timestamp ascending (oldest first)
        allMsgs.sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
        
        // Apply pagination
        if (before) {
            const beforeTime = parseInt(before);
            allMsgs = allMsgs.filter((m: any) => (m.messageTimestamp || 0) < beforeTime);
        }
        
        // Limit results
        allMsgs = allMsgs.slice(0, limit);
        
        res.json(allMsgs);
    });

    // Load more messages (older)
    app.get("/api/messages/:jid/load-more", async (req, res) => {
        const { jid } = req.params;
        const before = parseInt(req.query.before as string) || Math.floor(Date.now() / 1000);
        const limit = parseInt(req.query.limit as string) || 30;
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log(`Loading more messages for ${jid}, before ${before}`);
            
            // Use Baileys to fetch older messages
            const key = {
                remoteJid: jid,
                fromMe: false,
                id: ''
            };
            
            const history = await sock.fetchMessageHistory(limit, key, before);
            console.log("Fetched history:", history?.length || 0, "messages");
            
            // Store the fetched messages
            if (history && history.length > 0) {
                for (const msg of history) {
                    if (!msg || !msg.key) continue; // Skip invalid messages
                    
                    // Normalize JID to prevent device suffix mismatch
                    const msgJid = normalizeJid(msg.key.remoteJid);
                    
                    if (!store.messages[msgJid]) {
                        const arr: any[] = [];
                        store.messages[msgJid] = { all: () => arr };
                    }
                    const msgs = store.messages[msgJid].all();
                    // Avoid duplicates
                    if (msg.key.id && !msgs.find((m: any) => m.key?.id === msg.key.id)) {
                        msgs.push(msg);
                    }
                }
            }
            
            // Get messages before the timestamp - check all device JID variants
            let allMsgs: any[] = [];
            const seen = new Set<string>();
            
            // Check the exact JID
            for (const msg of (store.messages[jid]?.all() || [])) {
                if (msg.key?.id && !seen.has(msg.key.id)) {
                    seen.add(msg.key.id);
                    allMsgs.push(msg);
                }
            }
            
            // For individual contacts, also check device-specific JID variants
            if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                const baseJid = jid.replace('@s.whatsapp.net', '');
                for (const key of Object.keys(store.messages)) {
                    if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                        for (const msg of (store.messages[key]?.all() || [])) {
                            if (msg.key?.id && !seen.has(msg.key.id)) {
                                seen.add(msg.key.id);
                                allMsgs.push(msg);
                            }
                        }
                    }
                }
            }
            
            allMsgs = allMsgs
                .filter((m: any) => (m.messageTimestamp || 0) < before)
                .sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
                .slice(0, limit);
            
            res.json(allMsgs);
        } catch (e) {
            console.log("Error loading more messages:", e);
            res.status(500).json({ error: e.message });
        }
    });

    app.post("/api/send", express.json(), async (req, res) => {
        const { jid, text } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const sentMsg = await sock.sendMessage(jid, { text });
            // Don't emit here - messages.upsert event handler already broadcasts
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send a reaction to a message
    app.post("/api/react", express.json(), async (req, res) => {
        const { jid, messageId, emoji } = req.body;
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        if (!jid || !messageId || !emoji) {
            return res.status(400).json({ error: "Missing required fields: jid, messageId, emoji" });
        }
        
        try {
            console.log(`Sending reaction ${emoji} to message ${messageId} in chat ${jid}`);
            
            // Find the original message to get its key
            const messages = store.messages[jid]?.all() || [];
            const originalMsg = messages.find((m: any) => m.key?.id === messageId);
            
            if (!originalMsg) {
                // Try to create a key from the messageId
                const reactionKey = {
                    remoteJid: jid,
                    id: messageId,
                    fromMe: false
                };
                
                const sentReaction = await sock.sendMessage(jid, {
                    react: {
                        key: reactionKey,
                        text: emoji
                    }
                });
                
                console.log("Reaction sent (without original key):", sentReaction);
                return res.json(sentReaction);
            }
            
            // Send reaction with the original message key
            const sentReaction = await sock.sendMessage(jid, {
                react: {
                    key: originalMsg.key,
                    text: emoji
                }
            });
            
            console.log("Reaction sent:", sentReaction);
            res.json(sentReaction);
        } catch (err) {
            console.log("Error sending reaction:", err);
            res.status(500).json({ error: err.message });
        }
    });

    // Remove a reaction from a message (send empty text)
    app.post("/api/remove-reaction", express.json(), async (req, res) => {
        const { jid, messageId } = req.body;
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        if (!jid || !messageId) {
            return res.status(400).json({ error: "Missing required fields: jid, messageId" });
        }
        
        try {
            console.log(`Removing reaction from message ${messageId} in chat ${jid}`);
            
            // Find the original message to get its key
            const messages = store.messages[jid]?.all() || [];
            const originalMsg = messages.find((m: any) => m.key?.id === messageId);
            
            if (!originalMsg) {
                // Try to create a key from the messageId
                const reactionKey = {
                    remoteJid: jid,
                    id: messageId,
                    fromMe: false
                };
                
                const removedReaction = await sock.sendMessage(jid, {
                    react: {
                        key: reactionKey,
                        text: ''  // Empty text removes the reaction
                    }
                });
                
                console.log("Reaction removed (without original key):", removedReaction);
                return res.json(removedReaction);
            }
            
            // Remove reaction with the original message key
            const removedReaction = await sock.sendMessage(jid, {
                react: {
                    key: originalMsg.key,
                    text: ''  // Empty text removes the reaction
                }
            });
            
            console.log("Reaction removed:", removedReaction);
            res.json(removedReaction);
        } catch (err) {
            console.log("Error removing reaction:", err);
            res.status(500).json({ error: err.message });
        }
    });

    // Mark chat as read
    app.post("/api/mark-read", express.json(), async (req, res) => {
        const { jid } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const chat = store.chats.get(jid);
            if (chat) {
                chat.unreadCount = 0;
                store.chats.set(jid, chat);
            }
            await sock.sendReadReceipt(jid);
            // Re-emit chats list with updated unread count - FILTER archived
            let allChats = store.chats.all().filter((c: any) =>
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
            io.emit("chats-list", allWithAvatars);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Upload and send media
    app.post("/api/send-media", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const { jid, caption, replyTo, mediaType } = req.body;
            const file = req.file;
            if (!file) return res.status(400).json({ error: "No file uploaded" });

            const buffer = readFileSync(file.path);
            const mime = file.mimetype;
            const fileName = file.originalname;
            const type = mediaType || mime.split('/')[0];

            let msgContent: any;
            const opts: any = {};
            if (replyTo) {
                const msgs = store.messages[jid]?.all() || [];
                const quotedMsg = msgs.find((m: any) => m.key?.id === replyTo);
                if (quotedMsg) opts.quoted = quotedMsg;
            }

            if (type === 'image') {
                msgContent = { image: buffer, mimetype: mime, caption: caption || '' };
            } else if (type === 'video') {
                msgContent = { video: buffer, mimetype: mime, caption: caption || '' };
            } else if (type === 'audio') {
                msgContent = { audio: buffer, mimetype: mime, ptt: req.body.ptt === 'true' };
            } else {
                msgContent = { document: buffer, mimetype: mime, fileName };
            }

            const sentMsg = await sock.sendMessage(jid, msgContent, opts);
            // Clean up uploaded file
            try { unlinkSync(file.path); } catch {}
            if (sentMsg) {
                io.emit("new-message", sentMsg);
            }
            res.json(sentMsg);
        } catch (err) {
            console.error("Error sending media:", err);
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send with reply support
    app.post("/api/send-reply", express.json(), async (req, res) => {
        const { jid, text, replyTo } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const opts: any = {};
            if (replyTo) {
                const msgs = store.messages[jid]?.all() || [];
                const quotedMsg = msgs.find((m: any) => m.key?.id === replyTo);
                if (quotedMsg) opts.quoted = quotedMsg;
            }
            const sentMsg = await sock.sendMessage(jid, { text }, opts);
            if (sentMsg) {
                io.emit("new-message", sentMsg);
            }
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Delete a message
    app.post("/api/delete-message", express.json(), async (req, res) => {
        const { jid, messageId, forEveryone } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const msgs = store.messages[jid]?.all() || [];
            const msg = msgs.find((m: any) => m.key?.id === messageId);
            if (!msg) return res.status(404).json({ error: "Message not found" });
            await sock.sendMessage(jid, { delete: msg.key });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        try {
            const vite = await createViteServer({
                server: { middlewareMode: true },
                appType: "spa",
            });
            app.use(vite.middlewares);
        } catch (e: any) {
            console.log("Vite middleware failed to start, serving static files instead:", e.message);
            const distPath = path.join(process.cwd(), "dist");
            app.use(express.static(distPath));
            app.get("*", (req, res) => {
                res.sendFile(path.join(distPath, "index.html"));
            });
        }
    } else {
        const distPath = path.join(process.cwd(), "dist");
        app.use(express.static(distPath));
        app.get("*", (req, res) => {
            res.sendFile(path.join(distPath, "index.html"));
        });
    }

    // Socket.io connection
    io.on("connection", (socket) => {
        console.log("Client connected to socket");
        socket.emit("connection-update", { status: connectionStatus, qr: qrCode });
        
        // Send current presence states
        socket.emit("presence-bulk", Object.fromEntries(presenceMap));
        
        socket.on("get-chats", async () => {
            // Try to get chats with avatar info - sort by most recent first - FILTER archived
            let existingChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            
            // Recalculate timestamps from messages to ensure freshness
            for (const chat of existingChats) {
                const chatMessages = store.messages[chat.id]?.all() || [];
                if (chatMessages.length > 0) {
                    const latestMsgTs = Math.max(...chatMessages.map((m: any) => m.messageTimestamp || 0));
                    if (latestMsgTs > 0 && (!chat.conversationTimestamp || latestMsgTs > chat.conversationTimestamp)) {
                        chat.conversationTimestamp = latestMsgTs;
                        store.chats.set(chat.id, chat);
                    }
                }
            }
            
            // Re-fetch after timestamp updates
            existingChats = store.chats.all().filter((c: any) => 
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')) && c.archived !== true
            );
            existingChats = sortChatsByRecent(existingChats);
            
            if (existingChats.length > 0) {
                // Use the function that checks contacts and groups
                const resolvedChats = await Promise.all(existingChats.map(getChatWithAvatarFromStore));
                socket.emit("chats-list", resolvedChats);
            } else {
                // Try triggering sync again
                if (sock.user?.id) {
                    try {
                        await sock.sendMessage(sock.user.id, { text: '🔄' }, {
                            background: true,
                            waitForResponse: false
                        });
                    } catch (e) {}
                }
                socket.emit("chats-list", []);
            }
        });

        socket.on("get-messages", (jid) => {
            // Collect messages from the requested JID and all device variants
            // For individual contacts, messages may be stored under JIDs with device suffixes
            // e.g., "551199999:5@s.whatsapp.net" instead of "551199999@s.whatsapp.net"
            let allMsgs: any[] = [];
            const seen = new Set<string>();
            
            // Check the exact JID first
            for (const msg of (store.messages[jid]?.all() || [])) {
                if (msg.key?.id && !seen.has(msg.key.id)) {
                    seen.add(msg.key.id);
                    allMsgs.push(msg);
                }
            }
            
            // For individual contacts, also check device-specific JID variants
            if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                const baseJid = jid.replace('@s.whatsapp.net', '');
                for (const key of Object.keys(store.messages)) {
                    if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                        for (const msg of (store.messages[key]?.all() || [])) {
                            if (msg.key?.id && !seen.has(msg.key.id)) {
                                seen.add(msg.key.id);
                                allMsgs.push(msg);
                            }
                        }
                    }
                }
            }
            
            allMsgs.sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
            socket.emit("messages-list", { jid, messages: allMsgs });
        });
        
        // Get chat details including avatar
        socket.on("get-chat-details", async (jid) => {
            try {
                let displayName = jid.split('@')[0];
                let avatar = null;
                let participants = [];
                let description = '';
                
                const chat = store.chats.get(jid);
                if (chat) {
                    displayName = chat.name || chat.subject || displayName;
                }
                
                // Get profile picture
                if (sock) {
                    try {
                        avatar = await sock.profilePictureUrl(jid, 'image');
                    } catch (e) {}
                }
                
                // Get group metadata
                if (jid.endsWith('@g.us') && sock) {
                    try {
                        const groupMeta = await sock.groupMetadata(jid);
                        store.groupMetadata[jid] = groupMeta;
                        displayName = groupMeta.subject || displayName;
                        participants = groupMeta.participants || [];
                        description = groupMeta.desc || '';
                    } catch (e) {}
                }
                
                socket.emit("chat-details", {
                    jid,
                    displayName,
                    avatar,
                    participants,
                    description
                });
            } catch (e) {
                socket.emit("chat-details", { jid, displayName: jid.split('@')[0], avatar: null });
            }
        });

        // Typing indicator
        socket.on("typing", async (data: { jid: string; isTyping: boolean }) => {
            if (!sock) return;
            try {
                const presence = data.isTyping ? 'composing' : 'available';
                await sock.sendPresenceUpdate(presence, data.jid);
            } catch (e) {}
            // Broadcast to other clients
            socket.broadcast.emit("typing-update", { jid: data.jid, isTyping: data.isTyping });
        });

        socket.on("disconnect", () => {
            console.log("Client disconnected from socket");
        });
    });

    httpServer.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer().catch(err => {
    console.error("Failed to start server:", err);
});
