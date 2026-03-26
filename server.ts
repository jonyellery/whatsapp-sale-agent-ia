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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: "silent" });

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
    
    bind(eventEmitter: any) {
        eventEmitter.on("chats.upsert", (chats: any[]) => {
            for (const chat of chats) {
                this.chats.set(chat.id, chat);
            }
        });
        eventEmitter.on("chats.update", (updates: any[]) => {
            for (const update of updates) {
                const chat = this.chats.get(update.id);
                if (chat) {
                    this.chats.set(update.id, { ...chat, ...update });
                }
            }
        });
        eventEmitter.on("messages.upsert", (m: { messages: any[] }) => {
            for (const msg of m.messages) {
                const jid = msg.key.remoteJid!;
                if (!this.messages[jid]) {
                    this.messages[jid] = { all: () => [] };
                }
                const msgs = this.messages[jid].all();
                msgs.push(msg);
            }
        });
        eventEmitter.on("contacts.upsert", (contacts: any[]) => {
            for (const contact of contacts) {
                this.contacts[contact.id] = contact;
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
}

const store = new SimpleStore();

// Persist store to file
const storePath = path.join(__dirname, "baileys_store.json");
const saveStore = () => {
    const data = {
        chats: store.chats.all(),
        messages: Object.fromEntries(
            Object.entries(store.messages).map(([k, v]) => [k, v.all()])
        )
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
            console.log("Loaded chats from store file:", data.chats.length);
        }
        if (data.messages) {
            for (const [jid, msgs] of Object.entries(data.messages)) {
                store.messages[jid] = { all: () => msgs as any[] };
                // Also create a basic chat entry for this JID if not already present
                if (!store.chats.get(jid)) {
                    store.chats.set(jid, {
                        id: jid,
                        name: jid.split('@')[0],
                        unreadCount: 0
                    });
                }
            }
            console.log("Loaded messages from store file, JIDs:", Object.keys(data.messages).length);
        }
    } catch (e) {
        console.log("Failed to load store:", e);
    }
}

// Save store every 10 seconds
setInterval(saveStore, 10_000);

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
        
        // Check for archived status - Baileys uses 'archive' field
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
        const chatMessages = store.messages[chat.id]?.all() || [];
        if (chatMessages.length > 0) {
            // Sort by timestamp descending to get the most recent
            const sortedMessages = [...chatMessages].sort((a: any, b: any) => 
                (b.messageTimestamp || 0) - (a.messageTimestamp || 0)
            );
            const lastMsg = sortedMessages[0];
            
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
            } else if (lastMsg.message?.reactionMessage) {
                lastMessageText = lastMsg.message.reactionMessage.text || '👍';
            } else {
                lastMessageText = '[Mensagem]';
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
            const aTime = a.conversationTimestamp || a.lastMessageRecvTimestamp || 0;
            const bTime = b.conversationTimestamp || b.lastMessageRecvTimestamp || 0;
            return bTime - aTime; // Descending order (most recent first)
        });
    };

    const connectToWhatsApp = async () => {
        sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: state,
            logger,
            browser: ["WhatsApp Web Clone", "Chrome", "1.0.0"],
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
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log("connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect);
                connectionStatus = "close";
                io.emit("connection-update", { status: "close" });
                if (shouldReconnect) {
                    connectToWhatsApp();
                }
            } else if (connection === "open") {
                console.log("opened connection");
                console.log("User JID:", sock.user?.id);
                connectionStatus = "open";
                qrCode = null;
                io.emit("connection-update", { status: "open" });
                
                // Wait longer for full history sync (Baileys loads chats progressively)
                setTimeout(async () => {
                    console.log("Checking for chats after initial sync...");
                    
                    // Check if there are any chats
                    let chats = store.chats.all().filter((c: any) => 
                        c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
                    );
                    
                    console.log("Chats found after wait:", chats.length);
                    
                    if (chats.length === 0) {
                        console.log("No chats, trying alternative sync method...");
                        
                        // Try to fetch chats using pagination (newer Baileys API)
                        try {
                            // This may help trigger the sync
                            if (sock.user) {
                                console.log("Trying to trigger sync via chat query...");
                            }
                        } catch (e) {
                            console.log("Error in alternative sync:", e);
                        }
                        
                        // Wait more
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        
                        chats = store.chats.all().filter((c: any) => 
                            c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
                        );
                        console.log("Chats after second wait:", chats.length);
                    }
                    
                    // Send whatever chats we have - use the outer function that checks contacts and groups
                    // Sort by most recent first
                    const chatsSorted = sortChatsByRecent(chats);
                    const chatsWithAvatars = await Promise.all(chatsSorted.map(getChatWithAvatar));
                    console.log("Emitting chats:", chatsWithAvatars.length);
                    io.emit("chats-list", chatsWithAvatars);
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
                // Create a basic chat entry
                store.chats.set(jid, {
                    id: jid,
                    name: jid.split('@')[0],
                    unreadCount: 0
                });
            }
        };

        sock.ev.on("chats.upsert", async (chats: any[]) => {
            // Ensure each chat exists before updating
            for (const chat of chats) {
                store.chats.set(chat.id, chat);
            }
            let allChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            io.emit("chats-list", allWithAvatars);
        });
        
        sock.ev.on("chats.update", async (updates: any[]) => {
            console.log("Chats update received:", JSON.stringify(updates, null, 2));
            for (const update of updates) {
                console.log("Chat update for:", update.id, "archived:", update.archived);
                const chat = store.chats.get(update.id);
                if (chat) {
                    const updatedChat = { ...chat, ...update };
                    const chatWithAvatar = await getChatWithAvatar(updatedChat);
                    store.chats.set(update.id, chatWithAvatar);
                }
            }
            let allChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            io.emit("chats-list", allWithAvatars);
        });

        sock.ev.on("contacts.upsert", async (contacts: any[]) => {
            for (const contact of contacts) {
                store.contacts[contact.id] = contact;
                // Also ensure chat exists for this contact
                ensureChatExists(contact.id);
            }
            let allChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            allChats = sortChatsByRecent(allChats);
            const allWithAvatars = await Promise.all(
                allChats.map(getChatWithAvatar)
            );
            io.emit("chats-list", allWithAvatars);
        });

        sock.ev.on("messages.upsert", async (m: any) => {
            if (m.type === "notify") {
                for (const msg of m.messages) {
                    const jid = msg.key.remoteJid;
                    // Ensure chat exists for this message
                    ensureChatExists(jid);
                    
                    // Extract pushName from message and store as contact
                    // pushName can be at msg.pushName or msg.key.pushName
                    const pushName = msg.pushName || msg.key?.pushName;
                    if (pushName && jid) {
                        // For group messages, use participant JID; for direct messages, use the chat JID
                        const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);
                        if (contactJid && !contactJid.includes('@g.us') && !contactJid.includes('@lid')) {
                            store.contacts[contactJid] = {
                                id: contactJid,
                                name: pushName,
                                notify: pushName,
                                imgUrl: null
                            };
                        }
                    }
                    
                    if (!msg.key.fromMe) {
                        io.emit("new-message", msg);
                    }
                }
            }
        });

        sock.ev.on("contacts.update", (contacts: Contact[]) => {
            io.emit("contacts-update", contacts);
        });
        
        // Handle messaging history sync - this is where chats come from in Baileys v7
        sock.ev.on("messaging-history.set", async (history: any) => {
            console.log("Received messaging history:", {
                chats: history.chats?.length || 0,
                contacts: history.contacts?.length || 0,
                messages: history.messages?.length || 0,
                syncType: history.syncType
            });
            
            // Process chats from history
            if (history.chats && history.chats.length > 0) {
                for (const chat of history.chats) {
                    if (chat.id && (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@g.us'))) {
                        console.log("Chat from history:", chat.id, "archived:", chat.archived);
                        store.chats.set(chat.id, chat);
                    }
                }
            }
            
            // Process contacts from history
            if (history.contacts && history.contacts.length > 0) {
                for (const contact of history.contacts) {
                    if (contact.id) {
                        store.contacts[contact.id] = contact;
                        // Ensure we have a chat entry for this contact
                        if (!store.chats.get(contact.id)) {
                            store.chats.set(contact.id, {
                                id: contact.id,
                                name: contact.name || contact.notify || contact.id.split('@')[0],
                                unreadCount: 0
                            });
                        }
                    }
                }
            }
            
            // Process messages from history - CREATE CHATS FROM MESSAGE JIDs!
            if (history.messages && history.messages.length > 0) {
                for (const msg of history.messages) {
                    const jid = msg.key?.remoteJid;
                    
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
                    
                    if (jid && !store.chats.get(jid)) {
                        // Create a basic chat entry for this JID
                        store.chats.set(jid, {
                            id: jid,
                            name: jid.split('@')[0],
                            unreadCount: 0,
                            conversationTimestamp: msg.messageTimestamp
                        });
                    }
                }
            }
            
            // Get all chats with avatars - use the function that checks contacts and groups
            // Sort by most recent first
            let allChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            allChats = sortChatsByRecent(allChats);
            
            const chatsWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
            console.log("Emitting chats from history:", chatsWithAvatars.length);
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
            
            // Filter chats that are archived (archived === true)
            // Note: undefined means the chat was not returned with archived status from WhatsApp
            // false means the chat explicitly has archived=false (not archived)
            let archivedChats = allChats.filter((c: any) => 
                c.archived === true &&
                (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
            );
            
            console.log("Direct archived chats in store (archived === true):", archivedChats.length);
            
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
                    
                    archivedChats = store.chats.all().filter((c: any) => 
                        c.archived === true &&
                        (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us'))
                    );
                    
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
            console.log("Forcing chat refresh...");
            
            // Try using the newer Baileys method if available
            // This forces the library to request chat list from server
            const currentChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            
            console.log("Current chats in store:", currentChats.length);
            
            // Emit current chats - use the function that checks contacts and groups
            const chatsWithAvatars = await Promise.all(currentChats.map(getChatWithAvatarFromStore));
            io.emit("chats-list", chatsWithAvatars);
            
            res.json({ 
                count: chatsWithAvatars.length, 
                chats: chatsWithAvatars,
                message: "Chats list refreshed" 
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Debug endpoint to check store
    app.get("/api/debug/store", (req, res) => {
        const chats = store.chats.all();
        const contacts = store.contacts;
        res.json({
            chatsCount: chats.length,
            contactsCount: Object.keys(contacts).length,
            chatsSample: chats.slice(0, 3)
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
                await sock.loadAllOldChatIds();
            }
            
            // Wait for sync
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const chats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
            );
            
            // Get avatars - use the function that checks contacts and groups
            const chatsWithAvatars = await Promise.all(chats.map(getChatWithAvatarFromStore));
            
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
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
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
        // Return chats from store with contact info
        const chats = store.chats.all().filter((c: any) => 
            c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
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
        
        let messages = store.messages[jid]?.all() || [];
        
        // Sort by timestamp descending (newest first)
        messages = messages.sort((a: any, b: any) => 
            (b.messageTimestamp || 0) - (a.messageTimestamp || 0)
        );
        
        // Apply pagination
        if (before) {
            const beforeTime = parseInt(before);
            messages = messages.filter((m: any) => 
                (m.messageTimestamp || 0) < beforeTime
            );
        }
        
        // Limit results
        messages = messages.slice(0, limit);
        
        res.json(messages);
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
                    
                    if (!store.messages[jid]) {
                        store.messages[jid] = { all: () => [] };
                    }
                    const msgs = store.messages[jid].all();
                    // Avoid duplicates
                    if (msg.key.id && !msgs.find((m: any) => m.key?.id === msg.key.id)) {
                        msgs.push(msg);
                    }
                }
            }
            
            // Get messages before the timestamp
            let messages = store.messages[jid]?.all() || [];
            messages = messages
                .filter((m: any) => (m.messageTimestamp || 0) < before)
                .sort((a: any, b: any) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
                .slice(0, limit);
            
            res.json(messages);
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
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
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
        
        socket.on("get-chats", async () => {
            // Try to get chats with avatar info - sort by most recent first
            let existingChats = store.chats.all().filter((c: any) => 
                c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')
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
            socket.emit("messages-list", { jid, messages: store.messages[jid]?.all() || [] });
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
    });

    httpServer.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer().catch(err => {
    console.error("Failed to start server:", err);
});
