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
    GroupMetadata,
    getUrlInfo,
    Browsers
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

const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFilePath = path.join(logsDir, `app-${timestamp}.log`);
const fileLogger = (msg: string) => {
    const logLine = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(logFilePath, logLine);
};

const originalConsoleLog = console.log;
console.log = (...args: unknown[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    originalConsoleLog(...args);
    fileLogger(msg);
};

fileLogger(`=== Sistema iniciado em ${timestamp} ===`);

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

// Extract clean phone number from JID (removes domain and device suffix)
const getPhoneNumber = (jid: string): string => {
    if (!jid) return '';
    // Handle @lid JIDs - extract the LID part
    if (jid.endsWith('@lid')) {
        return jid.split('@')[0]; // Just return the LID part
    }
    const base = jid.split('@')[0];
    return base.split(':')[0];
};

// Check if JID is a valid chat type (individual, group, LID, newsletter, broadcast)
const isValidChatJid = (jid: string): boolean => {
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us') || 
           jid.endsWith('@lid') || jid.endsWith('@newsletter') || jid.endsWith('@broadcast');
};

// Helper to deduplicate chats: prefer @s.whatsapp.net over @lid for same phone number
// Also handles when LID hasn't been mapped yet - uses phone number extraction as fallback
const deduplicateChats = (chats: any[]): any[] => {
    const seenPhones = new Set<string>();
    const seenLids = new Set<string>();
    
    return chats.filter(chat => {
        const chatId = chat.id;
        
        // Handle @lid JIDs - check if we have a mapping to phone number
        if (chatId.endsWith('@lid')) {
            const lidPart = chatId.replace('@lid', '');
            
            // Already processed this LID?
            if (seenLids.has(lidPart)) return false;
            seenLids.add(lidPart);
            
            // Check if we have a mapping to phone number
            const pn = lidToPhoneMap.get(lidPart);
            if (pn) {
                // Check if we already have this phone
                if (seenPhones.has(pn)) return false;
                seenPhones.add(pn);
            } else {
                // No mapping yet - treat LID as unique (keep it)
            }
            return true;
        }
        
        // Handle @s.whatsapp.net JIDs (without device suffix)
        if (chatId.endsWith('@s.whatsapp.net') && !chatId.includes(':')) {
            const phone = chatId.replace('@s.whatsapp.net', '');
            if (seenPhones.has(phone)) return false;
            seenPhones.add(phone);
            return true;
        }
        
        // Groups and other types - keep as-is
        return true;
    });
};

// Resolve a JID (including @lid) to the best display name available
// Uses LID→PN mapping to find the real contact when available
const resolveContactName = (jid: string, contactsStore: { [key: string]: any }): string => {
    if (!jid) return '';
    
    // Direct lookup
    const direct = contactsStore[jid];
    if (direct?.notify || direct?.name) return direct.notify || direct.name;
    
    // For @lid JIDs, try to resolve via LID→PN mapping
    if (jid.endsWith('@lid')) {
        const lidUser = jid.split('@')[0];
        const pnUser = lidToPhoneMap.get(lidUser);
        if (pnUser) {
            const pnJid = `${pnUser}@s.whatsapp.net`;
            const pnContact = contactsStore[pnJid];
            if (pnContact?.notify || pnContact?.name) return pnContact.notify || pnContact.name;
            // Return formatted phone number
            return pnUser;
        }
    }
    
    return getPhoneNumber(jid);
};

// Normalize JID: convert @lid to @s.whatsapp.net if mapping exists
const normalizeJidForLid = (jid: string): string => {
    if (!jid) return jid;
    if (jid.endsWith('@lid')) {
        const lidPart = jid.replace('@lid', '');
        const pnUser = lidToPhoneMap.get(lidPart);
        if (pnUser) {
            return `${pnUser}@s.whatsapp.net`;
        }
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

// LID → Phone Number mapping store (resolve @lid JIDs to real phone numbers) - MUST be declared before use
const lidToPhoneMap = new Map<string, string>(); // lidUser -> pnUser
const phoneToLidMap = new Map<string, string>(); // pnUser -> lidUser

// Cached formatted LID mappings to avoid recomputation on each socket connection
let cachedLidMappings: Record<string, string> = {};

const updateCachedLidMappings = () => {
    cachedLidMappings = {};
    lidToPhoneMap.forEach((pn, lid) => {
        cachedLidMappings[`${lid}@lid`] = `${pn}@s.whatsapp.net`;
    });
};

// Load existing LID ↔ Phone Number mappings from auth_info_baileys/
const authDir = path.join(__dirname, "auth_info_baileys");
if (fs.existsSync(authDir)) {
    const files = fs.readdirSync(authDir);
    for (const file of files) {
        if (file.startsWith('lid-mapping-') && file.endsWith('_reverse.json')) {
            // Reverse mapping: lid-mapping-{lidUser}_reverse.json → contains PN user
            const lidUser = file.replace('lid-mapping-', '').replace('_reverse.json', '');
            try {
                const pnUser = JSON.parse(readFileSync(path.join(authDir, file), 'utf-8'));
                if (pnUser && lidUser) {
                    lidToPhoneMap.set(lidUser, pnUser);
                    phoneToLidMap.set(pnUser, lidUser);
                }
            } catch {}
        }
    }
    // Initialize cached LID mappings after loading
    updateCachedLidMappings();
}

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 100; // max 100 requests per minute per IP

const rateLimit = (req: any, res: any, next: any) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
        rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
};

// Presence tracking
const presenceMap = new Map<string, string>();

console.log(`[LID] Loaded ${lidToPhoneMap.size} LID↔PN mappings from auth store`);

// Avatar cache with TTL - jid -> { url: string|null, expires: number }
// Increased to handle all chats (6241+ chats)
const MAX_AVATAR_CACHE_SIZE = 10000;
const avatarCache = new Map<string, { url: string | null; expires: number }>();
const AVATAR_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours TTL

const getCachedAvatar = (jid: string): string | null | undefined => {
    const cached = avatarCache.get(jid);
    if (cached && cached.expires > Date.now()) {
        return cached.url;
    }
    return undefined; // expired or not found
};

const setCachedAvatar = (jid: string, url: string | null) => {
    // Evict oldest if at capacity
    if (avatarCache.size >= MAX_AVATAR_CACHE_SIZE) {
        const firstKey = avatarCache.keys().next().value;
        if (firstKey) avatarCache.delete(firstKey);
    }
    avatarCache.set(jid, { url, expires: Date.now() + AVATAR_CACHE_TTL });
};

// Chat timestamps cache to avoid recalculating from messages on every sort
// Increased to handle all chats
const MAX_TIMESTAMPS_CACHE_SIZE = 10000;
const chatTimestampsCache = new Map<string, number>();
let timestampsCacheValid = false;

const invalidateTimestampsCache = () => {
    timestampsCacheValid = false;
};

// Message search index by base phone number for O(1) lookup instead of O(n) iteration
// Increased to handle more contacts
const MAX_MESSAGE_INDEX_SIZE = 10000;
const messageSearchIndex = new Map<string, Set<string>>(); // baseJid -> Set of message JIDs

const updateMessageSearchIndex = (msgJid: string) => {
    if (msgJid.endsWith('@s.whatsapp.net') && msgJid.includes(':')) {
        const baseJid = msgJid.split(':')[0];
        // Evict old entries if at capacity
        if (messageSearchIndex.size >= MAX_MESSAGE_INDEX_SIZE && !messageSearchIndex.has(baseJid)) {
            const firstKey = messageSearchIndex.keys().next().value;
            if (firstKey) messageSearchIndex.delete(firstKey);
        }
        if (!messageSearchIndex.has(baseJid)) {
            messageSearchIndex.set(baseJid, new Set());
        }
        messageSearchIndex.get(baseJid)!.add(msgJid);
    }
};

const getMessageJidsForPhone = (phoneJid: string): string[] => {
    const baseJid = phoneJid.replace('@s.whatsapp.net', '');
    const variants = messageSearchIndex.get(baseJid);
    return variants ? Array.from(variants) : [];
};

// Enhanced store implementation for Baileys v7 with contacts and groups
class SimpleStore {
    chats: {
        all: () => any[];
        get: (jid: string) => any;
        set: (jid: string, data: any) => void;
        delete: (jid: string) => void;
    };
    messages: { [jid: string]: { all: () => any[]; map?: Map<string, any> } };
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
            set: (jid: string, data: any) => chatsMap.set(jid, data),
            delete: (jid: string) => chatsMap.delete(jid)
        };
        
        this.messages = {};
        const getMessagesObj = (jid: string) => {
            if (!this.messages[jid]) {
                const map = new Map();
                this.messages[jid] = {
                    all: () => Array.from(map.values()),
                    map
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
                if (chat.id && (isValidChatJid(chat.id))) {
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
                // Use normalizeJid to remove device suffix (e.g., 558512345678:5@s.whatsapp.net -> 558512345678@s.whatsapp.net)
                let jid = normalizeJid(msg.key.remoteJid!);
                
                // Normalize LID to phone number if mapping exists
                if (jid.endsWith('@lid')) {
                    const lidPart = jid.replace('@lid', '');
                    let pnUser = lidToPhoneMap.get(lidPart);
                    
                    // If no mapping exists, try to get from remoteJidAlt
                    if (!pnUser && (msg.key as any).remoteJidAlt) {
                        const altJid = (msg.key as any).remoteJidAlt;
                        if (altJid.endsWith('@s.whatsapp.net')) {
                            pnUser = altJid.split('@')[0];
                        }
                    }
                    
                    if (pnUser) {
                        jid = `${pnUser}@s.whatsapp.net`;
                    }
                }
                
                console.log(`[STORE] msg from=${msg.key.fromMe ? 'ME' : jid}, ts=${msg.messageTimestamp}, type=${Object.keys(msg.message || {}).join(',') || 'none'}`);
                
                if (!this.messages[jid]) {
                    const map = new Map();
                    this.messages[jid] = {
                        all: () => Array.from(map.values()),
                        map
                    };
                }
                const msgMap = this.messages[jid].map;
                if (!msgMap.has(msg.key.id)) {
                    msgMap.set(msg.key.id, msg);
                    markJidDirty(jid);
                    console.log(`[STORE] msg stored for ${jid}, total=${msgMap.size}`);
                } else {
                    console.log(`[STORE] duplicate msg skipped for ${jid}`);
                }
                
                // Also extract contact info from pushName
                const pushName = msg.pushName || msg.key?.pushName;
                if (pushName && jid) {
                    const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);
                    if (contactJid && !contactJid.includes('@g.us')) {
                        const existingContact = this.contacts[contactJid];
                        if (!existingContact) {
                            this.contacts[contactJid] = {
                                id: contactJid,
                                name: pushName,
                                notify: pushName,
                                imgUrl: null
                            };
                        } else if (!existingContact.name && !existingContact.notify) {
                            existingContact.name = pushName;
                            existingContact.notify = pushName;
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
                    
                    // Only update existing chat entries - don't create new empty chats
                    const chatJid = contact.id;
                    if (chatJid.endsWith('@s.whatsapp.net')) {
                        const existingChat = this.chats.get(chatJid);
                        if (existingChat) {
                            // Update existing chat name if missing
                            if (!existingChat.name || existingChat.name === getPhoneNumber(chatJid)) {
                                existingChat.name = contact.name || contact.notify || existingChat.name;
                            }
                        }
                        // Don't create new chat - let it be created on first message
                    }
                }
            }
        });

        // LID ↔ Phone Number mapping events
        eventEmitter.on("lid-mapping.update", (mapping: any) => {
            if (mapping?.pn && mapping?.lid) {
                const lidUser = mapping.lid.split('@')[0];
                const pnUser = mapping.pn.split('@')[0];
                lidToPhoneMap.set(lidUser, pnUser);
                phoneToLidMap.set(pnUser, lidUser);
                console.log(`[STORE] LID mapping: ${lidUser} -> ${pnUser}`);
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

// Persist store to files in separate directory
const storeDir = path.join(__dirname, "store");
const storeChatsPath = path.join(storeDir, "chats.json");
const storeContactsPath = path.join(storeDir, "contacts.json");
const storeGroupMetadataPath = path.join(storeDir, "group-metadata.json");
const storeMessagesDir = path.join(storeDir, "messages");
const storeMetaPath = path.join(storeDir, "meta.json");

if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true });
if (!fs.existsSync(storeMessagesDir)) fs.mkdirSync(storeMessagesDir, { recursive: true });

let lastStoreCleanup = Date.now();
let dirtyJids = new Set<string>();
let dirtyChats = new Set<string>(); // Para salvar apenas chats modificados
let saveScheduled = false;

const markJidDirty = (jid: string) => {
    dirtyJids.add(jid);
    scheduleSave();
};

const markChatDirty = (chatId: string) => {
    dirtyChats.add(chatId);
    scheduleSave();
};

const scheduleSave = () => {
    if (saveScheduled) return;
    saveScheduled = true;
    setTimeout(() => {
        saveStore();
        saveScheduled = false;
    }, 30000); // 30 seconds debounce to reduce I/O
};

const saveStore = () => {
    // Save chats - merge with existing chats to prevent data loss
    let chatsToSave: any[] = [];
    
    // First, load existing chats from file to merge
    let existingChats: any[] = [];
    if (fs.existsSync(storeChatsPath)) {
        try {
            existingChats = JSON.parse(fs.readFileSync(storeChatsPath, 'utf-8'));
            if (!Array.isArray(existingChats)) existingChats = [];
        } catch (e) {
            existingChats = [];
        }
    }
    
    if (dirtyChats.size > 0) {
        // Diff save: merge dirty chats with existing
        const dirtyChatsList: any[] = [];
        for (const chatId of dirtyChats) {
            const chat = store.chats.get(chatId);
            if (chat) dirtyChatsList.push(chat);
        }
        // Merge: existing + dirty (dirty overwrites existing)
        const existingMap = new Map(existingChats.map(c => [c.id, c]));
        for (const chat of dirtyChatsList) {
            existingMap.set(chat.id, chat);
        }
        chatsToSave = deduplicateChats(Array.from(existingMap.values()));
        console.log(`[STORE] Diff save: ${dirtyChatsList.length} dirty + ${existingChats.length} existing = ${chatsToSave.length} total...`);
        fs.writeFileSync(storeChatsPath, JSON.stringify(chatsToSave));
        dirtyChats.clear();
    } else if (existingChats.length > 0) {
        // No dirty chats, but preserve existing
        chatsToSave = existingChats;
    }
    
    // Save contacts (always, small data)
    fs.writeFileSync(storeContactsPath, JSON.stringify(store.contacts));
    
    // Save group metadata (always, small data)
    fs.writeFileSync(storeGroupMetadataPath, JSON.stringify(store.groupMetadata));
    
    // Save meta (last cleanup timestamp)
    fs.writeFileSync(storeMetaPath, JSON.stringify({ lastStoreCleanup }));
    
    // Save only dirty JIDs - messages that changed since last save
    let totalMessages = 0;
    
    if (dirtyJids.size > 0) {
        console.log(`[STORE] Saving ${dirtyJids.size} dirty JIDs...`);
        
        for (const jid of dirtyJids) {
            let msgs = store.messages[jid]?.all() || [];
            
            if (msgs.length === 0) {
                // Remove file if no messages
                const safeJid = jid.replace(/[^a-zA-Z0-9@.-]/g, '_');
                const msgFilePath = path.join(storeMessagesDir, `${safeJid}.json`);
                if (fs.existsSync(msgFilePath)) fs.unlinkSync(msgFilePath);
                continue;
            }
            
            totalMessages += msgs.length;
            const safeJid = jid.replace(/[^a-zA-Z0-9@.-]/g, '_');
            const msgFilePath = path.join(storeMessagesDir, `${safeJid}.json`);
            fs.writeFileSync(msgFilePath, JSON.stringify(msgs));
        }
        
        dirtyJids.clear();
    }
    
    console.log(`[STORE] Saved ${chatsToSave.length} chats, ${totalMessages} messages`);
};

const forceSaveAllMessages = () => {
    // Mark all JIDs as dirty for full save
    for (const jid of Object.keys(store.messages)) {
        dirtyJids.add(jid);
    }
    scheduleSave();
};

// Load store from files
if (fs.existsSync(storeChatsPath)) {
    try {
        const chatsData = JSON.parse(fs.readFileSync(storeChatsPath, 'utf-8'));
        if (Array.isArray(chatsData)) {
            // Deduplicate chats on load - prefer @s.whatsapp.net over @lid for same phone
            const dedupedChats = deduplicateChats(chatsData);
            for (const chat of dedupedChats) {
                if (chat.id && isValidChatJid(chat.id)) {
                    store.chats.set(chat.id, chat);
                }
            }
            console.log("[STORE] Loaded chats:", chatsData.length, "(deduped to", dedupedChats.length, ")");
        }
    } catch (e) {
        console.log("[STORE] Error loading chats:", e);
    }
}

if (fs.existsSync(storeContactsPath)) {
    try {
        store.contacts = JSON.parse(fs.readFileSync(storeContactsPath, 'utf-8'));
        console.log("[STORE] Loaded contacts:", Object.keys(store.contacts).length);
    } catch (e) {
        console.log("[STORE] Error loading contacts:", e);
    }
}

if (fs.existsSync(storeGroupMetadataPath)) {
    try {
        store.groupMetadata = JSON.parse(fs.readFileSync(storeGroupMetadataPath, 'utf-8'));
        console.log("[STORE] Loaded group metadata:", Object.keys(store.groupMetadata).length);
    } catch (e) {
        console.log("[STORE] Error loading group metadata:", e);
    }
}

if (fs.existsSync(storeMetaPath)) {
    try {
        const meta = JSON.parse(fs.readFileSync(storeMetaPath, 'utf-8'));
        lastStoreCleanup = meta.lastStoreCleanup || Date.now();
        console.log("[STORE] Last cleanup:", new Date(lastStoreCleanup).toISOString());
    } catch (e) {}
}

// Load messages from individual files
const messageFiles = fs.readdirSync(storeMessagesDir).filter(f => f.endsWith('.json'));
console.log("[STORE] Loading messages from", messageFiles.length, "files...");

for (const file of messageFiles) {
    try {
        const jid = file.replace('.json', '').replace(/_/g, '.');
        const msgs = JSON.parse(fs.readFileSync(path.join(storeMessagesDir, file), 'utf-8'));
        const map: Map<string, any> = new Map(msgs.map((m: any) => [m.key.id, m]));
        store.messages[jid] = { all: () => Array.from(map.values()), map };
        
        if (!store.chats.get(jid)) {
            store.chats.set(jid, {
                id: jid,
                name: getPhoneNumber(jid),
                unreadCount: 0
            });
            markChatDirty(jid); // Marcar para persistência
        }
    } catch (e) {
        console.log("[STORE] Error loading message file", file, ":", e);
    }
}

// After loading, normalize LID messages to phone JIDs if mapping exists
console.log("[STORE] Normalizing LID messages to phone JIDs...");
for (const [lid, pn] of lidToPhoneMap) {
    const lidJid = `${lid}@lid`;
    const pnJid = `${pn}@s.whatsapp.net`;
    const lidMsgs = store.messages[lidJid];
    const pnMsgs = store.messages[pnJid];
    
    if (lidMsgs && lidMsgs.map) {
        if (pnMsgs && pnMsgs.map) {
            // Merge LID messages into phone messages
            for (const [msgId, msg] of lidMsgs.map) {
                if (!pnMsgs.map.has(msgId)) {
                    pnMsgs.map.set(msgId, msg);
                }
            }
            // Update the all() function
            pnMsgs.all = () => Array.from(pnMsgs.map.values());
            markJidDirty(pnJid);
            console.log(`[STORE] Merged LID ${lid} messages into phone ${pn}`);
        } else {
            // Move LID messages to phone JID
            store.messages[pnJid] = lidMsgs;
            markJidDirty(pnJid);
            console.log(`[STORE] Moved LID ${lid} messages to phone ${pn}`);
        }
    }
}

console.log("[STORE] Loaded messages for", Object.keys(store.messages).length, "JIDs");

// Recalculate timestamps after loading - original logic preserved
const getAllChatMessages = (chatId: string): any[] => {
    let msgs = store.messages[chatId]?.all() || [];
    if (chatId && chatId.endsWith('@s.whatsapp.net') && !chatId.includes(':')) {
        const baseJid = chatId.replace('@s.whatsapp.net', '');
        for (const key of Object.keys(store.messages)) {
            if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                msgs = msgs.concat(store.messages[key]?.all() || []);
            }
        }
        const lid = phoneToLidMap.get(baseJid);
        if (lid) {
            const lidJid = `${lid}@lid`;
            const lidMsgs = store.messages[lidJid]?.all() || [];
            msgs = msgs.concat(lidMsgs);
        }
    }
    if (chatId?.endsWith('@lid')) {
        const lidPart = chatId.replace('@lid', '');
        const pnUser = lidToPhoneMap.get(lidPart);
        if (pnUser) {
            const pnJid = `${pnUser}@s.whatsapp.net`;
            const pnMsgs = store.messages[pnJid]?.all() || [];
            msgs = msgs.concat(pnMsgs);
        }
    }
    return msgs;
};

const allChats = store.chats.all();
for (const chat of allChats) {
    if (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@lid')) {
        const chatMessages = getAllChatMessages(chat.id);
        if (chatMessages.length > 0) {
            const latestMsgTs = Math.max(...chatMessages.map((m: any) => m.messageTimestamp || 0));
            if (latestMsgTs > 0) {
                chat.conversationTimestamp = latestMsgTs;
                store.chats.set(chat.id, chat);
                markChatDirty(chat.id);
            }
        }
    }
}
console.log("[STORE] Recalculated timestamps for individual chats from messages");

// Save store via schedule (dirty saves happen automatically via markChatDirty)
setInterval(() => scheduleSave(), 30_000);

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

// Global io instance for debounced emissions
let ioInstance: any = null;
let lastEmittedChatsMap: Map<string, any> = new Map();

// Reset diff cache (call on initial load / history sync)
export const resetChatsDiffCache = () => {
    lastEmittedChatsMap = new Map();
};

// Debounce timeout reference (moved inside startServer for access to helpers)
let emitChatsTimeout: NodeJS.Timeout | null = null;

async function startServer() {
    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
        }
    });
    ioInstance = io; // Assign global io for debounced emissions

    const PORT = 3000;

    let emitSequence = 0; // Sequence number to prevent race conditions

    // Helper to emit chats-list in diff format
    const emitChatsListDiff = (io: any, chats: any[], isFullReplace: boolean = false) => {
        if (!io) return;
        emitSequence++;
        if (isFullReplace) {
            // Full replace - send all chats as updates
            io.emit("chats-list", {
                type: 'diff',
                sequence: emitSequence,
                changes: { updated: chats, removed: [] },
                total: chats.length
            });
            console.log('[EMIT] Full replace diff, count:', chats.length, 'seq:', emitSequence);
        } else {
            // Diff with empty changes - just to update sequence
            io.emit("chats-list", {
                type: 'diff',
                sequence: emitSequence,
                changes: { updated: [], removed: [] },
                total: chats.length
            });
            console.log('[EMIT] Empty diff, seq:', emitSequence);
        }
    };

    // Debounce helper for emitting chats list with diff (always use diff for speed!)
    const emitChatsDebounced = async () => {
        if (!ioInstance) return;
        
        if (emitChatsTimeout) {
            clearTimeout(emitChatsTimeout);
        }
        emitChatsTimeout = setTimeout(async () => {
            emitSequence++; // Always increment sequence
            let allChats = store.chats.all().filter((c: any) => c &&
                c && isValidChatJid(c.id) && c.archived !== true
            );
            // Deduplicate contacts: prefer @s.whatsapp.net over @lid for same phone number
            const seenPhones = new Set<string>();
            allChats = allChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            allChats = sortChatsByRecent(allChats);
            
            // Use cached-only avatars for fast emit (don't await all profilePictureUrl calls)
            const allWithCachedAvatars = allChats.map(getChatWithAvatarCachedOnly);
            
            // Calculate diff: detect changes between last emission and current state
            const changedChats: any[] = [];
            const currentMap = new Map<string, any>();
            
            console.log('[EMIT-CHATS] Last emitted count:', lastEmittedChatsMap.size, 'Current count:', allWithCachedAvatars.length);
            
            for (const chat of allWithCachedAvatars) {
                currentMap.set(chat.id, chat);
                const lastChat = lastEmittedChatsMap.get(chat.id);
                
                // Chat is new or has meaningful changes
                if (!lastChat || 
                    lastChat.conversationTimestamp !== chat.conversationTimestamp ||
                    lastChat.unreadCount !== chat.unreadCount ||
                    lastChat.name !== chat.name ||
                    lastChat.avatar !== chat.avatar) {
                    changedChats.push(chat);
                }
            }
            
            console.log('[EMIT-CHATS] Changed chats:', changedChats.length, 'sample lastMessageTime:', changedChats[0]?.lastMessageTime, 'sample conversationTimestamp:', changedChats[0]?.conversationTimestamp);
            
            // Detect removed chats
            const removedChats = Array.from(lastEmittedChatsMap.keys()).filter(
                id => !currentMap.has(id)
            );
            
// Always use diff! Add sequence to prevent race conditions
            const currentSequence = emitSequence;
            
            if (changedChats.length === 0 && removedChats.length === 0) {
                // No changes - still emit diff with empty changes to confirm sequence
                ioInstance.emit("chats-list", {
                    type: 'diff',
                    sequence: currentSequence,
                    changes: { updated: [], removed: [] },
                    total: allWithCachedAvatars.length
                });
                console.log('[EMIT-CHATS] Emitting DIFF (no changes), sequence:', currentSequence);
            } else {
                // Diff emit - fetch avatars only for changed chats (much faster!)
                const changedWithAvatars = await Promise.all(changedChats.map(getChatWithAvatarFromStore));
                console.log('[EMIT-CHATS] Emitting DIFF, changed:', changedWithAvatars.map(c => ({ id: c.id, lastMessageTime: c.lastMessageTime })), 'sequence:', currentSequence);
                ioInstance.emit("chats-list", {
                    type: 'diff',
                    sequence: currentSequence,
                    changes: {
                        updated: changedWithAvatars,
                        removed: removedChats
                    },
                    total: allWithCachedAvatars.length
                });
            }
            // Always update last emitted map
            lastEmittedChatsMap = currentMap;
        }, 300); // 300ms debounce para msgs em tempo real
    };

    // Apply rate limiting to all API routes
    app.use("/api", rateLimit);

    // Baileys Logic
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    let sock: any = null;
    let qrCode: string | null = null;
    let connectionStatus: "connecting" | "open" | "close" | "qr" = "connecting";
    const reconnectAttempts = { current: 0 };

    // Helper function to process array in batches with concurrency limit and rate limiting
    const processInBatches = async <T, R>(items: T[], fn: (item: T) => Promise<R>, batchSize: number = 2): Promise<R[]> => {
        const results: R[] = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            try {
                const batchResults = await Promise.all(batch.map(fn));
                results.push(...batchResults);
            } catch (e: any) {
                // Handle rate limit errors gracefully - skip this batch
                const errorMsg = e?.message || String(e);
                if (errorMsg.includes('rate-overlimit') || e?.data === 429) {
                    console.log(`[SOCKET] Rate limit hit at batch ${Math.floor(i/batchSize)}, waiting 3s...`);
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                console.error(`[SOCKET] Batch error:`, errorMsg);
            }
            // Add delay between batches to avoid rate limiting
            if (i + batchSize < items.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        return results;
    };

    // Helper function to get chat with avatar from cache only (no fetching)
    const getChatWithAvatarCachedOnly = (chat: any): any => {
        let displayName = chat.name || chat.subject || resolveContactName(chat.id, store.contacts);
        let avatar = null;

        // Check for archived status
        const isArchived = chat.archive === true || chat.archived === true;

        // Try to get name from contacts (including LID resolution)
        const contact = store.contacts[chat.id];
        if (contact) {
            displayName = contact.notify || contact.name || displayName;
        }
        // If still showing a LID number or just the ID, try to resolve it
        if (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@lid')) {
            displayName = resolveContactName(chat.id, store.contacts) || displayName;
        }

        // For groups, try to get from group metadata
        if (chat.id.endsWith('@g.us')) {
            if (store.groupMetadata[chat.id]) {
                displayName = store.groupMetadata[chat.id].subject || displayName;
            } else if (sock) {
                try {
                    const groupMeta = sock.groupMetadata(chat.id);
                    store.groupMetadata[chat.id] = groupMeta;
                    displayName = groupMeta.subject || displayName;
                } catch (e) {}
            }
        }

        // Get cached avatar only
        avatar = getCachedAvatar(chat.id);
        if (avatar === undefined) avatar = null;

        // Get last message for this chat
        let lastMessageText = '';
        let lastMessageSender = displayName; // Default to chat display name
        let lastMessageTime = chat.conversationTimestamp || chat.lastMessageRecvTimestamp || 0;
        // Try cache first for speed - getChatWithAvatarCachedOnly
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
        
        // For @lid, also check the corresponding @s.whatsapp.net JID
        if (chat.id.endsWith('@lid')) {
            const lidPart = chat.id.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                const pnJid = `${pnUser}@s.whatsapp.net`;
                chatMessages = chatMessages.concat(store.messages[pnJid]?.all() || []);
            }
        }
        
        let lastMessageFromMe = false;
        
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
                // Check if last message was sent by me
                lastMessageFromMe = lastMsg.key?.fromMe === true;
                
                // Use the actual timestamp from the last message (handle Long object from Baileys)
                const msgTs = lastMsg.messageTimestamp;
                lastMessageTime = (msgTs?.low || msgTs) || lastMessageTime;

                // For groups, try to get the sender's name from the message
                if (chat.id.endsWith('@g.us') && !lastMsg.key.fromMe) {
                    // Get sender name from pushName, contacts store, LID mapping, or phone number
                    const participantJid = lastMsg.key?.participant;
                    const resolvedName = participantJid ? resolveContactName(participantJid, store.contacts) : null;
                    const senderName = lastMsg.pushName || resolvedName || 'Membro';
                    lastMessageSender = senderName;
                }

                // Extract message text based on type (simplified for performance)
                if (lastMsg.message?.conversation) {
                    lastMessageText = lastMsg.message.conversation;
                } else if (lastMsg.message?.extendedTextMessage?.text) {
                    lastMessageText = lastMsg.message.extendedTextMessage.text;
                } else if (lastMsg.message?.imageMessage) {
                    lastMessageText = lastMsg.message.imageMessage.caption || '📷 Foto';
                } else if (lastMsg.message?.videoMessage) {
                    lastMessageText = lastMsg.message.videoMessage.caption || '🎥 Vídeo';
                } else if (lastMsg.message?.audioMessage) {
                    lastMessageText = lastMsg.message.audioMessage.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio';
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
            pinnedAt: chat.pinnedAt,
            muted: chat.muted,
            ephemeralExpiration: chat.ephemeralExpiration,
            unreadCount: chat.unreadCount || 0,
            lastMessage: lastMessageText,
            lastMessageSender: lastMessageSender,
            lastMessageTime: lastMessageTime,
            lastMessageFromMe,
            conversationTimestamp: lastMessageTime
        };
    };

    // Helper function to get chat with avatar (defined at function scope so it can be used by API endpoints)
    const getChatWithAvatarFromStore = async (chat: any): Promise<any> => {
        let displayName = chat.name || chat.subject || resolveContactName(chat.id, store.contacts);
        let avatar = null;
        
        // Check for archived status
        const isArchived = chat.archive === true || chat.archived === true;
        
        // Try to get name from contacts (including LID resolution)
        const contact = store.contacts[chat.id];
        if (contact) {
            displayName = contact.notify || contact.name || displayName;
        }
        // If still showing a LID number or just the ID, try to resolve it
        if (chat.id.endsWith('@s.whatsapp.net') || chat.id.endsWith('@lid')) {
            displayName = resolveContactName(chat.id, store.contacts) || displayName;
        }
        
        // For groups, try to get from group metadata
        if (chat.id.endsWith('@g.us')) {
            if (store.groupMetadata[chat.id]) {
                displayName = store.groupMetadata[chat.id].subject || displayName;
            } else if (sock) {
                try {
                    const groupMeta = await sock.groupMetadata(chat.id);
                    store.groupMetadata[chat.id] = groupMeta;
                    displayName = groupMeta.subject || displayName;
                } catch (e) {}
            }
        }
        
        // Try to get profile picture - use cached avatar with TTL to prevent flickering
        // Normalize JID to ensure consistent cache key (@lid -> @s.whatsapp.net)
        const cacheKey = chat.id.endsWith('@lid') 
            ? (() => { const lidPart = chat.id.replace('@lid', ''); const pn = lidToPhoneMap.get(lidPart); return pn ? `${pn}@s.whatsapp.net` : chat.id; })()
            : chat.id;
        
        if (sock) {
            const cachedAvatar = getCachedAvatar(cacheKey);
            if (cachedAvatar !== undefined) {
                avatar = cachedAvatar;
            } else {
                try {
                    // Add timeout to prevent hanging on avatar fetches
                    avatar = await Promise.race([
                        sock.profilePictureUrl(chat.id, 'image'),
                        new Promise<null>((_, reject) =>
                            setTimeout(() => reject(new Error('Avatar fetch timeout')), 5000)
                        )
                    ]);
                    setCachedAvatar(cacheKey, avatar || null);
                } catch (e) {
                    setCachedAvatar(cacheKey, null);
                }
            }
        }
        
        // Get last message for this chat
        let lastMessageText = '';
        let lastMessageSender = displayName; // Default to chat display name
        let lastMessageTime = chat.conversationTimestamp || chat.lastMessageRecvTimestamp || 0;
        // Try cache first for speed - getChatWithAvatarCachedOnly
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
        
        // For @lid, also check the corresponding @s.whatsapp.net JID
        if (chat.id.endsWith('@lid')) {
            const lidPart = chat.id.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                const pnJid = `${pnUser}@s.whatsapp.net`;
                chatMessages = chatMessages.concat(store.messages[pnJid]?.all() || []);
            }
        }
        
        let lastMessageFromMe = false;
        
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
                // Check if last message was sent by me
                lastMessageFromMe = lastMsg.key?.fromMe === true;
                
                // Use the actual timestamp from the last message (handle Long object from Baileys)
                const msgTs = lastMsg.messageTimestamp;
                lastMessageTime = (msgTs?.low || msgTs) || lastMessageTime;
                
                // For groups, try to get the sender's name from the message
                if (chat.id.endsWith('@g.us') && !lastMsg.key.fromMe) {
                    // Get sender name from pushName, contacts store, LID mapping, or phone number
                    const participantJid = lastMsg.key?.participant;
                    const resolvedName = participantJid ? resolveContactName(participantJid, store.contacts) : null;
                    const senderName = lastMsg.pushName || resolvedName || 'Membro';
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
                    lastMessageText = '📷 Foto';
                } else if (lastMsg.message?.videoMessage?.caption) {
                    lastMessageText = lastMsg.message.videoMessage.caption;
                } else if (lastMsg.message?.videoMessage) {
                    lastMessageText = '🎥 Vídeo';
                } else if (lastMsg.message?.audioMessage) {
                    lastMessageText = lastMsg.message.audioMessage.ptt ? '🎤 Mensagem de voz' : '🎵 Áudio';
                } else if (lastMsg.message?.stickerMessage) {
                    lastMessageText = '🎨 Sticker';
                } else if (lastMsg.message?.documentMessage) {
                    lastMessageText = `📄 ${lastMsg.message.documentMessage.fileName || 'Documento'}`;
                } else if (lastMsg.message?.locationMessage) {
                    lastMessageText = lastMsg.message.locationMessage.name || lastMsg.message.locationMessage.address || '📍 Localização';
                } else if (lastMsg.message?.liveLocationMessage) {
                    lastMessageText = lastMsg.message.liveLocationMessage.caption || '📍 Localização em tempo real';
                } else if (lastMsg.message?.contactMessage) {
                    lastMessageText = `👤 ${lastMsg.message.contactMessage.displayName || 'Contato'}`;
                } else if (lastMsg.message?.contactsArrayMessage) {
                    const count = lastMsg.message.contactsArrayMessage.contacts?.length || 0;
                    lastMessageText = `👥 ${count} contato${count !== 1 ? 's' : ''}`;
                } else if (lastMsg.message?.pollCreationMessage) {
                    lastMessageText = `📊 ${lastMsg.message.pollCreationMessage.name || 'Enquete'}`;
                } else if (lastMsg.message?.listMessage) {
                    lastMessageText = lastMsg.message.listMessage.title || lastMsg.message.listMessage.description || '📋 Lista';
                } else if (lastMsg.message?.listResponseMessage) {
                    lastMessageText = lastMsg.message.listResponseMessage.title || '📋 Resposta de lista';
                } else if (lastMsg.message?.buttonsMessage) {
                    lastMessageText = lastMsg.message.buttonsMessage.contentText || '🔘 Mensagem com botões';
                } else if (lastMsg.message?.buttonsResponseMessage) {
                    lastMessageText = lastMsg.message.buttonsResponseMessage.selectedDisplayText || '🔘 Resposta de botão';
                } else if (lastMsg.message?.templateMessage) {
                    lastMessageText = lastMsg.message.templateMessage.hydratedTemplate?.hydratedContentText || '📝 Template';
                } else if (lastMsg.message?.templateButtonReplyMessage) {
                    lastMessageText = lastMsg.message.templateButtonReplyMessage.selectedDisplayText || '🔘 Resposta de template';
                } else if (lastMsg.message?.groupInviteMessage) {
                    lastMessageText = `Convite para ${lastMsg.message.groupInviteMessage.groupName || 'grupo'}`;
                } else if (lastMsg.message?.productMessage) {
                    lastMessageText = `🛒 ${lastMsg.message.productMessage.product?.title || 'Produto'}`;
                } else if (lastMsg.message?.orderMessage) {
                    lastMessageText = `📦 ${lastMsg.message.orderMessage.orderTitle || 'Pedido'}`;
                } else if (lastMsg.message?.call) {
                    lastMessageText = '📞 Chamada';
                } else if (lastMsg.message?.protocolMessage) {
                    lastMessageText = '🚫 Mensagem apagada';
                } else if (lastMsg.message?.viewOnceMessage || lastMsg.message?.viewOnceMessageV2) {
                    lastMessageText = '👀 Visualização única';
                } else if (lastMsg.message?.ephemeralMessage) {
                    lastMessageText = '⏱️ Mensagem temporária';
                } else if (lastMsg.message?.albumMessage) {
                    lastMessageText = '📸 Álbum';
                } else if (lastMsg.message?.ptvMessage) {
                    lastMessageText = '🎥 Vídeo';
                } else if (lastMsg.message?.reactionMessage) {
                    // Skip reactions - they are filtered out above
                    lastMessageText = '';
                } else if (lastMsg.messageStubType) {
                    // Group system messages
                    const stubNames: Record<number, string> = {
                        20: '📋 Grupo criado',
                        21: '📝 Nome do grupo alterado',
                        22: '🖼️ Foto do grupo alterada',
                        23: '🔗 Link de convite alterado',
                        24: '📝 Descrição alterada',
                        25: '🔒 Configuração do grupo alterada',
                        26: '📢 Modo de envio alterado',
                        27: '👤 Entrou no grupo',
                        28: '👤 Removido do grupo',
                        29: '👤 Promovido a admin',
                        30: '👤 Não é mais admin',
                        31: '👤 Convidado para o grupo',
                        32: '👤 Saiu do grupo',
                        33: '📱 Número alterado',
                        43: '🗑️ Grupo excluído',
                        71: '👤 Solicitou entrar',
                    };
                    lastMessageText = stubNames[lastMsg.messageStubType] || '[Notificação do grupo]';
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
            pinnedAt: chat.pinnedAt,
            muted: chat.muted,
            ephemeralExpiration: chat.ephemeralExpiration,
            unreadCount: chat.unreadCount || 0,
            lastMessage: lastMessageText,
            lastMessageSender: lastMessageSender,
            lastMessageTime: lastMessageTime,
            lastMessageFromMe,
            conversationTimestamp: lastMessageTime
        };
    };

    // Helper to sort chats by most recent message - usa conversationTimestamp diretamente (já atualizado em tempo real)
    const sortChatsByRecent = (chats: any[]): any[] => {
        return chats.sort((a, b) => {
            // Pinned chats always come first
            const aPinned = a.pinnedAt || 0;
            const bPinned = b.pinnedAt || 0;
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            if (aPinned && bPinned) return bPinned - aPinned;

            // Use conversationTimestamp diretamente (atualizado em tempo real via updateChatTimestamp)
            const aMsgTime = a.conversationTimestamp || a.lastMessageRecvTimestamp || 0;
            const bMsgTime = b.conversationTimestamp || b.lastMessageRecvTimestamp || 0;
            
            return bMsgTime - aMsgTime; // Descending order (most recent first)
        });
    };

    // Helpers
    const getOrCreateMessages = (jid: string) => {
        if (!store.messages[jid]) {
            const map = new Map();
            store.messages[jid] = {
                all: () => Array.from(map.values()),
                map
            };
        } else if (!store.messages[jid].map) {
            // If exists but no map, create it from all()
            const msgs = store.messages[jid].all();
            const map = new Map(msgs.map(m => [m.key.id, m]));
            store.messages[jid].map = map;
            // Update all to use map
            store.messages[jid].all = () => Array.from(map.values());
        }
        return store.messages[jid].map!;
    };

    const updateChatTimestamp = (jid: string, timestamp: number) => {
        const chat = store.chats.get(jid);
        if (!chat) return;

        const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
        if (isNaN(ts)) return;

        if (!chat.conversationTimestamp || ts > chat.conversationTimestamp) {
            chat.conversationTimestamp = ts;
            store.chats.set(jid, chat);
            markChatDirty(jid);
        }
    };

    const syncLidAndPhoneTimestamp = (jid: string, timestamp: number) => {
        if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
            const base = jid.replace('@s.whatsapp.net', '');
            const lid = phoneToLidMap.get(base);
            if (lid) updateChatTimestamp(`${lid}@lid`, timestamp);
        }

        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pn = lidToPhoneMap.get(lidPart);
            if (pn) updateChatTimestamp(`${pn}@s.whatsapp.net`, timestamp);
        }
    };

    const upsertContact = (jid: string, pushName: string, msg: any) => {
        const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);

        if (!contactJid || contactJid.includes('@g.us')) return;

        let contact = store.contacts[contactJid];

        if (!contact) {
            store.contacts[contactJid] = {
                id: contactJid,
                name: pushName,
                notify: pushName,
                imgUrl: null
            };
        } else if (!contact.name && !contact.notify) {
            contact.name = pushName;
            contact.notify = pushName;
        }

        // Only update chat if it already exists - don't create empty chats
        if (contactJid.endsWith('@s.whatsapp.net') && !contactJid.includes(':')) {
            const phone = contactJid.replace('@s.whatsapp.net', '');
            const lid = phoneToLidMap.get(phone);
            const existingLidChat = lid ? store.chats.get(`${lid}@lid`) : null;
            const existingChat = store.chats.get(contactJid);
            
            if (existingChat && (!existingChat.name || existingChat.name === getPhoneNumber(contactJid))) {
                existingChat.name = pushName;
                store.chats.set(contactJid, existingChat);
            }
            // Don't create new chat - let it be created on first message
        }
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
                    
                    // Backoff exponencial para evitar sobrecarga em caso de indisponibilidade do servidor
                    const RECONNECT_BASE_DELAY = 5000; // 5 segundos
                    const RECONNECT_MAX_DELAY = 30000; // 30 segundos máximo
                    const RECONNECT_MAX_ATTEMPTS = 10;
                    
                    const currentAttempt = (reconnectAttempts.current = (reconnectAttempts.current || 0) + 1);
                    
                    if (shouldReconnect && currentAttempt <= RECONNECT_MAX_ATTEMPTS) {
                        // Calcula delay exponencial: 5s, 10s, 15s, 20s, 25s, 30s, 30s...
                        const delay = Math.min(
                            RECONNECT_BASE_DELAY * currentAttempt,
                            RECONNECT_MAX_DELAY
                        );
                        
                        console.log(`[RECONNECT] Attempt ${currentAttempt}/${RECONNECT_MAX_ATTEMPTS} - waiting ${delay/1000}s before retry...`);
                        
                        setTimeout(() => {
                            connectToWhatsApp();
                        }, delay);
                    } else if (shouldReconnect && currentAttempt > RECONNECT_MAX_ATTEMPTS) {
                        console.log("[RECONNECT] Max attempts reached. Stopping auto-reconnect. Please restart the server manually.");
                        io.emit("connection-update", { status: "close", error: "Max reconnection attempts reached. Please restart the server." });
                    }
                }
            } else if (connection === "open") {
                console.log("opened connection");
                console.log("User JID:", sock.user?.id);
                console.log("receivedPendingNotifications:", receivedPendingNotifications);
                connectionStatus = "open";
                qrCode = null;
                reconnectAttempts.current = 0;
io.emit("connection-update", { status: "open" });
                
                // FAST EMIT - send chats immediately without waiting for avatars
                setTimeout(async () => {
                    console.log("[SYNC] Fast initial emit...");
                    
                    let chats = store.chats.all().filter((c: any) => c &&
                        isValidChatJid(c.id) && c.archived !== true
                    );
                    
                    console.log("Chats found:", chats.length);

                    // Sort by most recent first
                    const chatsSorted = sortChatsByRecent(chats);
                    
                    // FAST: send WITHOUT avatar fetching (frontend fetches on-demand)
                    const chatsFastEmit = chatsSorted.map((chat: any) => ({
                        id: chat.id,
                        name: chat.name || chat.subject || resolveContactName(chat.id, store.contacts),
                        displayName: chat.name || chat.subject || resolveContactName(chat.id, store.contacts),
                        unreadCount: chat.unreadCount || 0,
                        archived: false,
                        conversationTimestamp: chat.conversationTimestamp || 0,
                        pinnedAt: chat.pinnedAt,
                        muted: chat.muted,
                        ephemeralExpiration: chat.ephemeralExpiration
                    }));
                    
                    console.log("Fast emit:", chatsFastEmit.length);
                    emitChatsListDiff(io, chatsFastEmit, true);
                    
                    // Background avatar fetch - parallel in batches (sem re-emissão completa)
                    // Os avatares serão puxados pelo frontend sob demanda
                    setTimeout(async () => {
                        console.log("[SYNC] Fetching avatars in background (no re-emit)...");
                        const BATCH_SIZE = 10;
                        
                        for (let i = 0; i < chatsSorted.length; i += BATCH_SIZE) {
                            const batch = chatsSorted.slice(i, i + BATCH_SIZE);
                            await Promise.all(batch.map(getChatWithAvatarFromStore));
                            if (i + BATCH_SIZE < chatsSorted.length) {
                                await new Promise(r => setTimeout(r, 100));
                            }
                        }
                        console.log("[SYNC] Background avatar fetch completed");
                    }, 1000);
                    
// Safety sync: ensure all contacts have chat entries - but only for chats with messages
// Chats without messages will be created on first message
                    setTimeout(async () => {
                        console.log("[SAFETY] Fast contact-to-chat sync...");
                        
                        // Only process contacts that already have chats (with messages)
                        // Don't create empty chats here
                        let existingCount = 0;
                        for (const [jid, contact] of Object.entries(store.contacts)) {
                            if (jid.endsWith('@s.whatsapp.net') && store.chats.get(jid)) {
                                const c = contact as any;
                                const chat = store.chats.get(jid);
                                if (chat && (!chat.name || chat.name === getPhoneNumber(jid))) {
                                    chat.name = c.name || c.notify || chat.name;
                                    store.chats.set(jid, chat);
                                }
                                existingCount++;
                            }
                        }
                        console.log(`[SAFETY] Updated ${existingCount} existing chats from contacts`);
                        
                        // Não re-emitir todos os chats aqui - os chats de contatos ficam em background
                        // e serão включены naturalmente quando tiverem mensagens

                        // Skip sequential group metadata - lazy load on-demand
                    }, 3000);
                }, 3000);
            }
        });

        sock.ev.on("creds.update", saveCreds);

            // Function to emit chats with debounce
            const emitChats = async () => {
                emitChatsDebounced();
            };

        // Create a helper function to ensure chat exists
        // Also prevents duplicate chats (e.g., both @lid and @s.whatsapp.net for same phone)
        const ensureChatExists = (jid: string) => {
            // First check if chat already exists (either @s.whatsapp.net or @lid)
            const existingChat = store.chats.get(jid);
            if (existingChat) return;
            
            // Check for duplicate based on phone number
            let phone: string | undefined;
            let lid: string | undefined;
            
            if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                phone = jid.replace('@s.whatsapp.net', '');
                lid = phoneToLidMap.get(phone);
            } else if (jid.endsWith('@lid')) {
                lid = jid.replace('@lid', '');
                phone = lidToPhoneMap.get(lid);
            }
            
            if (phone) {
                // Check if there's already a chat for this phone number (different format)
                if (jid.endsWith('@s.whatsapp.net') && lid) {
                    // Coming from @s.whatsapp.net, check if @lid exists
                    const existingLidChat = store.chats.get(`${lid}@lid`);
                    if (existingLidChat) return; // Don't create duplicate
                } else if (jid.endsWith('@lid') && phone) {
                    // Coming from @lid, check if @s.whatsapp.net exists
                    const existingPnChat = store.chats.get(`${phone}@s.whatsapp.net`);
                    if (existingPnChat) return; // Don't create duplicate
                }
            }
            
            // No existing chat found - create new one
            const contact = store.contacts[jid];
            const chatName = contact?.name || contact?.notify || resolveContactName(jid, store.contacts);
            store.chats.set(jid, {
                id: jid,
                name: chatName,
                unreadCount: 0
            });
            markChatDirty(jid); // Novo chat precisa ser salvo
        };

        sock.ev.on("chats.upsert", async (chats: any[]) => {
            console.log("[SOCKET] chats.upsert event received:", chats.length, "chats");
            for (const chat of chats) {
                if (chat.id && (isValidChatJid(chat.id))) {
                    console.log(`[SOCKET] Upsert chat ${chat.id}: archived=${chat.archived}, archive=${chat.archive}, name=${chat.name || chat.subject}`);
                    const existing = store.chats.get(chat.id);
                    const merged = store.mergeChatData(existing, chat);
                    store.chats.set(chat.id, merged);
                    markChatDirty(chat.id); // Chat modificado precisa ser salvo
                }
            }
            emitChats();
        });
        
        // CRITICAL: Handle chat metadata updates from WhatsApp server
        // This is where changes made on mobile (like archiving) sync to web
        sock.ev.on("chats.update", async (updates: any[]) => {
            console.log("[SOCKET] chats.update received:", JSON.stringify(updates, null, 2));
            
            for (const update of updates) {
                if (!update.id) continue;
                
                // Normalize LID to phone number if mapping exists
                let jid = update.id;
                
                // Try to get phone number from LID mapping OR from remoteJidAlt in messages
                if (jid.endsWith('@lid')) {
                    const lidPart = jid.replace('@lid', '');
                    let pnUser = lidToPhoneMap.get(lidPart);
                    
                    // If no mapping exists, try to get from message in the update
                    if (!pnUser && update.messages && update.messages[0]?.message?.key?.remoteJidAlt) {
                        const altJid = update.messages[0].message.key.remoteJidAlt;
                        if (altJid.endsWith('@s.whatsapp.net')) {
                            pnUser = altJid.split('@')[0];
                            // Also update the LID→PN mapping for future use
                            lidToPhoneMap.set(lidPart, pnUser);
                            phoneToLidMap.set(pnUser, lidPart);
                            updateCachedLidMappings();
                            io.emit("lid-mappings", cachedLidMappings);
                            console.log(`[SOCKET] Inferred LID mapping from chats.update: ${lidPart} -> ${pnUser}`);
                        }
                    }
                    
                    if (pnUser) {
                        jid = `${pnUser}@s.whatsapp.net`;
                    }
                }
                
                console.log(`[SOCKET] Processing update for chat ${jid} (original: ${update.id})`);
                console.log(`[SOCKET] Update payload: archived=${update.archived}, name=${update.name}, archive=${update.archive}`);
                
                // Check if it's a valid chat (including @lid)
                if (!(isValidChatJid(jid))) {
                    console.log(`[SOCKET] Skipping non-chat JID: ${jid}`);
                    continue;
                }
                
                const chat = store.chats.get(jid);
                
                // Also check if there's an @lid variant that needs to be migrated
                let lidChat = null;
                if (jid.endsWith('@s.whatsapp.net')) {
                    const phone = jid.replace('@s.whatsapp.net', '');
                    const lid = phoneToLidMap.get(phone);
                    if (lid) {
                        lidChat = store.chats.get(`${lid}@lid`);
                    }
                }
                
                if (chat) {
                    // Merge the update with existing chat data - prioritize newer timestamp
                    const existingTs = chat.conversationTimestamp || 0;
                    const updateTs = update.conversationTimestamp || 0;
                    const newTs = Math.max(existingTs, updateTs);
                    
                    const mergedChat = { ...chat, ...update, conversationTimestamp: newTs };
                    
                    console.log(`[SOCKET] Before merge - archived=${chat.archived}, name=${chat.name || chat.subject}, ts=${existingTs}`);
                    console.log(`[SOCKET] After merge - archived=${mergedChat.archived}, name=${mergedChat.name || mergedChat.subject}, ts=${newTs}`);
                    
                    // Update the store
                    store.chats.set(jid, mergedChat);
                    markChatDirty(jid);
                    
                    // If there's an @lid variant, migrate it to @s.whatsapp.net and delete the old one
                    if (lidChat) {
                        // Delete the @lid variant
                        if (jid.endsWith('@s.whatsapp.net')) {
                            const phone = jid.replace('@s.whatsapp.net', '');
                            const oldLid = phoneToLidMap.get(phone);
                            if (oldLid) {
                                store.chats.delete(`${oldLid}@lid`);
                            }
                        }
                        console.log(`[SOCKET] Migrated @lid chat to @s.whatsapp.net: ${jid}`);
                    }
                } else if (lidChat) {
                    // Chat exists only as @lid - migrate to @s.whatsapp.net
                    const contactInfo = store.contacts[jid];
                    const chatName = update.name || update.subject || contactInfo?.name || contactInfo?.notify || resolveContactName(jid, store.contacts);
                    const existingTs = lidChat.conversationTimestamp || 0;
                    const updateTs = update.conversationTimestamp || 0;
                    const newTs = Math.max(existingTs, updateTs);
                    
                    const migratedChat = {
                        ...lidChat,
                        id: jid,
                        name: chatName,
                        archived: update.archived || update.archive || lidChat.archived || false,
                        unreadCount: update.unreadCount ?? lidChat.unreadCount ?? 0,
                        conversationTimestamp: newTs,
                        ...update
                    };
                    store.chats.set(jid, migratedChat);
                    store.chats.delete(`${jid.endsWith('@s.whatsapp.net') ? jid.replace('@s.whatsapp.net', '') : jid}@lid`.replace('@s.whatsapp.net', '@lid'));
                    store.chats.delete(update.id); // Delete old @lid ID
                    markChatDirty(jid);
                    console.log(`[SOCKET] Migrated chat from @lid to @s.whatsapp.net: ${jid}`);
                } else {
                    // Chat doesn't exist in store (e.g. after store cleanup) - create it from the update
                    // Normalize LID to phone JID
                    const contactInfo = store.contacts[jid];
                    const chatName = update.name || update.subject || contactInfo?.name || contactInfo?.notify || resolveContactName(jid, store.contacts);
                    store.chats.set(jid, {
                        id: jid,
                        name: chatName,
                        archived: update.archived || update.archive || false,
                        unreadCount: update.unreadCount || 0,
                        conversationTimestamp: update.conversationTimestamp || 0,
                        ...update
                    });
                    markChatDirty(jid);
                    console.log(`[SOCKET] Created chat from update ${jid}: ${chatName}`);
                }
            }
            
            // Emit new messages from the update - realtime message sync
            for (const update of updates) {
                if (update.messages && update.messages.length > 0) {
                    for (const msgWrapper of update.messages) {
                        const msg = msgWrapper.message;
                        if (msg?.key?.remoteJid) {
                            // Normalize LID in message JID
                            let msgJid = msg.key.remoteJid;
                            if (msgJid.endsWith('@lid')) {
                                const lidPart = msgJid.replace('@lid', '');
                                const pnUser = lidToPhoneMap.get(lidPart);
                                if (pnUser) {
                                    msgJid = `${pnUser}@s.whatsapp.net`;
                                }
                            }
                            msg.key.remoteJid = msgJid;
                            console.log(`[SOCKET] Emitting new-message from chats.update for ${msgJid}`);
                            io.emit("new-message", msg);
                        }
                    }
                }
            }
            
            // Get all chats and emit to frontend - FILTER OUT archived
            let allChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            
            allChats = sortChatsByRecent(allChats);
            
            emitChats();
        });

        sock.ev.on("contacts.upsert", async (contacts: any[]) => {
            console.log("[SOCKET] contacts.upsert event received:", contacts.length, "contacts");
            
            for (const contact of contacts) {
                console.log(`[SOCKET] Processing contact ${contact.id}: name=${contact.name}, notify=${contact.notify}`);
                
                store.contacts[contact.id] = contact;
                
                // Only update existing chat entries - don't create new empty chats
                // Chats should be created when messages arrive
                if (contact.id.endsWith('@s.whatsapp.net')) {
                    const phone = contact.id.replace('@s.whatsapp.net', '');
                    const lid = phoneToLidMap.get(phone);
                    const existingLidChat = lid ? store.chats.get(`${lid}@lid`) : null;
                    
                    const existingChat = store.chats.get(contact.id);
                    if (existingChat) {
                        // Update existing chat with contact name - PRESERVE archived status and timestamp
                        const updatedChat = {
                            ...existingChat,
                            name: contact.name || contact.notify || existingChat.name
                            // Do NOT touch archived or conversationTimestamp - preserve existing values
                        };
                        store.chats.set(contact.id, updatedChat);
                    }
                }
            }
            
            // Emit contacts to frontend
            io.emit("contacts-update", Object.values(store.contacts));
            
            emitChats();
        });

        // Listen for LID ↔ Phone Number mappings and emit to frontend
        sock.ev.on("lid-mapping.update", (mapping: any) => {
            if (mapping?.pn && mapping?.lid) {
                const lidUser = mapping.lid.split('@')[0];
                const pnUser = mapping.pn.split('@')[0];
                lidToPhoneMap.set(lidUser, pnUser);
                phoneToLidMap.set(pnUser, lidUser);
                console.log(`[SOCKET] LID mapping updated: ${lidUser} -> ${pnUser}`);
                // Update cached mappings and emit
                updateCachedLidMappings();
                io.emit("lid-mappings", cachedLidMappings);
            }
        });

        sock.ev.on("messages.upsert", async (m: any) => {
            console.log(`[SOCKET] upsert: ${m.type} (${m.messages?.length || 0})`);

            const newMessages: any[] = [];

            for (const msg of m.messages) {
                let jid = normalizeJid(msg.key.remoteJid);
                if (!jid) continue;

                // Normalize LID to phone number if mapping exists
                if (jid.endsWith('@lid')) {
                    const lidPart = jid.replace('@lid', '');
                    let pnUser = lidToPhoneMap.get(lidPart);
                    
                    // If no mapping exists, try to get from remoteJidAlt
                    if (!pnUser && msg.key.remoteJidAlt) {
                        const altJid = msg.key.remoteJidAlt;
                        if (altJid.endsWith('@s.whatsapp.net')) {
                            pnUser = altJid.split('@')[0];
                            // Also update the LID→PN mapping for future use
                            lidToPhoneMap.set(lidPart, pnUser);
                            phoneToLidMap.set(pnUser, lidPart);
                            console.log(`[SOCKET] Inferred LID mapping from remoteJidAlt: ${lidPart} -> ${pnUser}`);
                        }
                    }
                    
                    if (pnUser) {
                        jid = `${pnUser}@s.whatsapp.net`;
                    }
                }

                ensureChatExists(jid);

                const msgMap = getOrCreateMessages(jid);

                if (!msgMap.has(msg.key.id)) {
                    msgMap.set(msg.key.id, msg);
                    newMessages.push(msg);
                    markJidDirty(jid);
                }

                if (msg.messageTimestamp) {
                    updateChatTimestamp(jid, msg.messageTimestamp);
                    syncLidAndPhoneTimestamp(jid, msg.messageTimestamp);
                }

                const pushName = msg.pushName || msg.key?.pushName;
                if (pushName) upsertContact(jid, pushName, msg);
            }

            // Emit em lote (melhor performance)
            if (newMessages.length) {
                io.emit("new-message-batch", newMessages);
                // Also emit individually for frontend compatibility
                for (const msg of newMessages) {
                    io.emit("new-message", msg);
                }
            }

            emitChats();
        });

        // Sincronização em tempo real: mensagens editadas ou excluídas
        sock.ev.on("messages.update", async (updates: any[]) => {
            console.log("Messages update:", updates.length);

            const updated: any[] = [];
            const deleted: any[] = [];

            for (const { key, update } of updates) {
                let jid = normalizeJid(key.remoteJid);
                if (!jid) continue;

                // Normalize LID to phone number if mapping exists
                if (jid.endsWith('@lid')) {
                    const lidPart = jid.replace('@lid', '');
                    const pnUser = lidToPhoneMap.get(lidPart);
                    if (pnUser) {
                        jid = `${pnUser}@s.whatsapp.net`;
                    }
                }

                const msgMap = store.messages[jid]?.map;
                if (!msgMap) continue;

                const msg = msgMap.get(key.id);
                if (!msg) continue;

                switch (update.update) {
                    case 'delete':
                        msgMap.delete(key.id);
                        deleted.push({ jid, messageId: key.id });
                        break;

                    case 'message':
                        msg.message = update.message;
                        updated.push(msg);
                        break;

                    case 'status':
                        updated.push({
                            jid,
                            messageId: key.id,
                            status: update.status
                        });
                        break;
                }
            }

            if (updated.length) io.emit("message-updated-batch", updated);
            if (deleted.length) io.emit("message-deleted-batch", deleted);

            emitChats();
        });

        // Sincronização em tempo real: recibos de mensagem (leitura, entrega)
        sock.ev.on("message-receipt.update", async (receipts: any[]) => {
            console.log("Receipts:", receipts.length);

            const payload = receipts.map(({ key, receipt }) => ({
                jid: key.remoteJid,
                messageId: key.id,
                type: receipt.type || 'delivered',
                timestamp: receipt.timestamp
            }));

            io.emit("message-receipt-batch", payload);
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
                let jid = normalizeJid(key.remoteJid);
                
                // Normalize LID to phone number if mapping exists
                if (jid.endsWith('@lid')) {
                    const lidPart = jid.replace('@lid', '');
                    const pnUser = lidToPhoneMap.get(lidPart);
                    if (pnUser) {
                        jid = `${pnUser}@s.whatsapp.net`;
                    }
                }
                
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
                
                // Store the reaction in messages - use persistent map
                if (!store.messages[jid]) {
                    const map = new Map();
                    store.messages[jid] = { all: () => Array.from(map.values()), map };
                }
                const msgMap = store.messages[jid].map;
                if (msgMap && !msgMap.has(reactionMsg.key.id)) {
                    msgMap.set(reactionMsg.key.id, reactionMsg);
                    markJidDirty(jid);
                }
                
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
            
            // Process LID ↔ Phone Number mappings from history sync
            if (history.lidPnMappings && history.lidPnMappings.length > 0) {
                for (const mapping of history.lidPnMappings) {
                    if (mapping?.pn && mapping?.lid) {
                        const lidUser = mapping.lid.split('@')[0];
                        const pnUser = mapping.pn.split('@')[0];
                        lidToPhoneMap.set(lidUser, pnUser);
                        phoneToLidMap.set(pnUser, lidUser);
                    }
                }
                console.log(`[SOCKET] Processed ${history.lidPnMappings.length} LID mappings from history`);
            }
            
            // Track archived chats being loaded
            let archivedCount = 0;
            
            // Process chats from history
            if (history.chats && history.chats.length > 0) {
                for (const chat of history.chats) {
                    if (chat.id && (isValidChatJid(chat.id))) {
                        console.log(`[SOCKET] History chat ${chat.id}: archived=${chat.archived}, name=${chat.name || chat.subject}`);
                        
                        // Normalize LID to phone JID
                        let chatJid = chat.id;
                        if (chatJid.endsWith('@lid')) {
                            const lidPart = chatJid.replace('@lid', '');
                            let pnUser = lidToPhoneMap.get(lidPart);
                            
                            // Try to get from remoteJidAlt if available
                            if (!pnUser && (chat as any).messages && (chat as any).messages[0]?.message?.key?.remoteJidAlt) {
                                const altJid = (chat as any).messages[0].message.key.remoteJidAlt;
                                if (altJid.endsWith('@s.whatsapp.net')) {
                                    pnUser = altJid.split('@')[0];
                                    lidToPhoneMap.set(lidPart, pnUser);
                                    phoneToLidMap.set(pnUser, lidPart);
                                }
                            }
                            
                            if (pnUser) {
                                chatJid = `${pnUser}@s.whatsapp.net`;
                            }
                        }
                        
                        if (chat.archived === true) {
                            archivedCount++;
                        }
                        
                        // Merge with existing chat to preserve conversationTimestamp from messages
                        const existingChat = store.chats.get(chatJid);
                        if (existingChat) {
                            // Preserve existing timestamp if it exists and is valid
                            const merged = {
                                ...chat,
                                id: chatJid, // Use normalized JID
                                conversationTimestamp: existingChat.conversationTimestamp || chat.conversationTimestamp || 0
                            };
                            store.chats.set(chatJid, merged);
                        } else {
                            store.chats.set(chatJid, { ...chat, id: chatJid });
                        }
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
                        // Only create if no existing @lid chat for same phone
                        if (contact.id.endsWith('@s.whatsapp.net')) {
                            const phone = contact.id.replace('@s.whatsapp.net', '');
                            const lid = phoneToLidMap.get(phone);
                            const existingLidChat = lid ? store.chats.get(`${lid}@lid`) : null;
                            
                            const existingChat = store.chats.get(contact.id);
                            const contactName = contact.name || contact.notify || getPhoneNumber(contact.id);
                            // Only create chat if it already exists or will have messages later
                            // Don't create empty chats from contacts - let them be created on first message
                            if (existingChat && (!existingChat.name || existingChat.name === getPhoneNumber(contact.id))) {
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
                    let jid = msg.key?.remoteJid ? normalizeJid(msg.key.remoteJid) : null;
                    
                    // Normalize LID to phone number if mapping exists
                    if (jid && jid.endsWith('@lid')) {
                        const lidPart = jid.replace('@lid', '');
                        let pnUser = lidToPhoneMap.get(lidPart);
                        
                        // Try to get from remoteJidAlt if available
                        if (!pnUser && (msg.key as any).remoteJidAlt) {
                            const altJid = (msg.key as any).remoteJidAlt;
                            if (altJid.endsWith('@s.whatsapp.net')) {
                                pnUser = altJid.split('@')[0];
                                lidToPhoneMap.set(lidPart, pnUser);
                                phoneToLidMap.set(pnUser, lidPart);
                            }
                        }
                        
                        if (pnUser) {
                            jid = `${pnUser}@s.whatsapp.net`;
                        }
                    }
                    
                    // Extract pushName from message and store as contact
                    if (msg.pushName && jid) {
                        const contactJid = msg.key.fromMe ? jid : (msg.key.participant || jid);
                        if (contactJid && !contactJid.includes('@g.us')) {
                            const existingContact = store.contacts[contactJid];
                            if (!existingContact) {
                                store.contacts[contactJid] = {
                                    id: contactJid,
                                    name: msg.pushName,
                                    notify: msg.pushName,
                                    imgUrl: null
                                };
                            } else if (!existingContact.name && !existingContact.notify) {
                                existingContact.name = msg.pushName;
                                existingContact.notify = msg.pushName;
                            }
                        }
                    }
                    
                    if (jid) {
                        // Store the actual message - use persistent array to avoid losing messages
                        if (!store.messages[jid]) {
                            const map = new Map();
                            store.messages[jid] = {
                                all: () => Array.from(map.values()),
                                map
                            };
                        }
                        const msgMap = store.messages[jid].map;
                        if (msgMap && msg.key?.id && !msgMap.has(msg.key.id)) {
                            msgMap.set(msg.key.id, msg);
                            markJidDirty(jid);
                            // Update search index for fast lookups
                            updateMessageSearchIndex(jid);
                        }

                        const existingChat = store.chats.get(jid);
                        if (!existingChat) {
                            // Create a basic chat entry for this JID
                            const contactInfo = store.contacts[jid];
                            const chatName = contactInfo?.name || contactInfo?.notify || getPhoneNumber(jid);
                            store.chats.set(jid, {
                                id: jid,
                                name: chatName,
                                unreadCount: 0,
                                conversationTimestamp: msg.messageTimestamp?.low || msg.messageTimestamp
                            });
                        } else if (msg.messageTimestamp && (!existingChat.conversationTimestamp || (msg.messageTimestamp?.low || msg.messageTimestamp) > existingChat.conversationTimestamp)) {
                            // Update timestamp if this message is newer
                            existingChat.conversationTimestamp = msg.messageTimestamp?.low || msg.messageTimestamp;
                        }
                    }
                }
                console.log(`[SOCKET] Stored ${history.messages.length} messages from history`);
            }
            
            // Recalculate conversationTimestamp for ALL chats from their latest messages
            const getAllMessagesForChat = (chatId: string): any[] => {
                let msgs = store.messages[chatId]?.all() || [];
                if (chatId.endsWith('@s.whatsapp.net') && !chatId.includes(':')) {
                    const baseJid = chatId.replace('@s.whatsapp.net', '');
                    for (const key of Object.keys(store.messages)) {
                        if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                            msgs = msgs.concat(store.messages[key]?.all() || []);
                        }
                    }
                    const lid = phoneToLidMap.get(baseJid);
                    if (lid) {
                        const lidMsgs = store.messages[`${lid}@lid`]?.all() || [];
                        msgs = msgs.concat(lidMsgs);
                    }
                }
                if (chatId.endsWith('@lid')) {
                    const lidPart = chatId.replace('@lid', '');
                    const pnUser = lidToPhoneMap.get(lidPart);
                    if (pnUser) {
                        const pnMsgs = store.messages[`${pnUser}@s.whatsapp.net`]?.all() || [];
                        msgs = msgs.concat(pnMsgs);
                    }
                }
                return msgs;
            };
            
            for (const chat of store.chats.all()) {
                const chatMessages = getAllMessagesForChat(chat.id);
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
            let allChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            
            // Deduplicate chats: prefer @s.whatsapp.net over @lid for same phone number
            const seenPhones = new Set<string>();
            allChats = allChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            
            allChats = sortChatsByRecent(allChats);
            
            // Log counts for debugging
            const totalChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id)
            );
            const totalArchivedCount = totalChats.filter((c: any) => c.archived === true).length;
            console.log(`[SOCKET] After history sync: ${totalChats.length} total, ${totalArchivedCount} archived, ${allChats.length} active to emit`);

            // Emit chats with cached avatars first for faster initial load
            const chatsWithCachedAvatars = allChats.map(getChatWithAvatarCachedOnly);
            console.log(`[SOCKET] Emitting chats-list from history sync (cached avatars): ${chatsWithCachedAvatars.length} active chats`);
            ioInstance?.emit('chats-list', {
                type: 'diff',
                sequence: 1,
                changes: {
                    updated: chatsWithCachedAvatars,
                    removed: []
                },
                total: chatsWithCachedAvatars.length
            });
            lastEmittedChatsMap = new Map(chatsWithCachedAvatars.map(chat => [chat.id, chat]));
            emitSequence = 1;

            // Fetch missing avatars in background without blocking (no re-emit to avoid duplication)
            // Only fetch for first 50 most recent chats to avoid rate limiting
            setImmediate(async () => {
                try {
                    const chatsToFetch = allChats.slice(0, 50);
                    console.log(`[SOCKET] Fetching avatars for first ${chatsToFetch.length} recent chats`);
                    await processInBatches(chatsToFetch, getChatWithAvatarFromStore, 2);
                    console.log(`[SOCKET] Background avatar fetch completed (first 50)`);
                } catch (e) {
                    console.error('[SOCKET] Error fetching avatars in background:', e);
                }
            });
        });
    };

    connectToWhatsApp();

    // API Routes
    app.get("/api/status", (req, res) => {
        res.json({ status: connectionStatus, qr: qrCode });
    });

    // LID → Phone Number mappings for resolving @lid JIDs
    app.get("/api/lid-mappings", (_req, res) => {
        const mappings: Record<string, string> = {};
        lidToPhoneMap.forEach((pnUser, lidUser) => {
            mappings[`${lidUser}@lid`] = `${pnUser}@s.whatsapp.net`;
        });
        res.json(mappings);
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
                c && (c.archived === true || c.archive === true) &&
                (isValidChatJid(c.id));

            let archivedChats = allChats.filter(isChatArchived);
            
            console.log("Direct archived chats in store:", archivedChats.length);
            
            // If no explicitly archived chats, check if there are any with archived property set
            // This is for debugging - some chats might be in a different state
            const chatsWithArchivedProp = allChats.filter((c: any) => 
                c.archived !== undefined &&
                (isValidChatJid(c.id))
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
                        .filter((c: any) => isValidChatJid(c.id))
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
            let activeChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            const seenPhones = new Set<string>();
            activeChats = activeChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            activeChats = sortChatsByRecent(activeChats);
            const activeWithAvatars = await Promise.all(activeChats.map(getChatWithAvatarFromStore));
            emitChatsListDiff(io, activeWithAvatars, true);
            
            res.json({ success: true, archived: archive });
        } catch (e) {
            console.log("Error archiving chat:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // Delete a chat completely from store
    app.delete("/api/chat", express.json(), async (req, res) => {
        try {
            const { jid } = req.body;
            if (!jid) {
                return res.status(400).json({ error: "jid é obrigatório" });
            }

            console.log(`[API] Deleting chat ${jid} from store...`);

            // Delete chat from store.chats (use delete, not set undefined)
            store.chats.delete(jid);

            // Delete messages from store.messages
            if (store.messages[jid]) {
                delete store.messages[jid];
                markJidDirty(jid);
            }

            // Also delete LID variant if exists
            if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                const baseJid = jid.replace('@s.whatsapp.net', '');
                const lid = phoneToLidMap.get(baseJid);
                if (lid) {
                    const lidJid = `${lid}@lid`;
                    store.chats.delete(lidJid);
                    if (store.messages[lidJid]) {
                        delete store.messages[lidJid];
                        markJidDirty(lidJid);
                    }
                }
            }

            // Save immediately after deletion
            saveStore();

            // Emit updated chat list
            const activeChats = store.chats.all().filter((c: any) => c &&
                c && isValidChatJid(c.id) && c.archived !== true
            );
            const chatsWithAvatars = await Promise.all(activeChats.map(getChatWithAvatarFromStore));
            emitChatsListDiff(io, chatsWithAvatars, true);

            res.json({ success: true });
        } catch (e) {
            console.log("Error deleting chat:", e);
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
            const activeChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            const seenPhones = new Set<string>();
            const dedupedActive = activeChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            
            console.log("[API] Active chats in store:", dedupedActive.length);
            
            // Log total and archived counts for debugging
            const allChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id)
            );
            const archivedCount = allChats.filter((c: any) => c.archived === true).length;
            console.log(`[API] Total: ${allChats.length}, Archived: ${archivedCount}, Active: ${dedupedActive.length}`);
            
            // Emit only active chats
            const chatsWithAvatars = await Promise.all(dedupedActive.map(getChatWithAvatarFromStore));
            
            emitChatsListDiff(io, chatsWithAvatars, true);
            
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
                .filter((c: any) => isValidChatJid(c.id))
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
            let allChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            const seenPhones = new Set<string>();
            allChats = allChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            allChats = sortChatsByRecent(allChats);
            
            const chatsWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
            
            const totalChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id)
            );
            const archivedCount = totalChats.filter((c: any) => c.archived === true).length;
            console.log(`[API] Sync complete: ${totalChats.length} total, ${archivedCount} archived, ${chatsWithAvatars.length} active`);
            
            emitChatsListDiff(io, chatsWithAvatars, true);
            
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
            
            // Also run force sync for individual contacts
            console.log("[FETCH-CHATS] Running force sync for contacts...");
            const contacts = Object.keys(store.contacts)
                .filter(j => j.endsWith('@s.whatsapp.net'));
            
            console.log(`[FETCH-CHATS] Found ${contacts.length} contacts to force sync`);
            
            let syncedCount = 0;
            let createdChats = 0;
            
            for (const contactJid of contacts) {
                try {
                    const key = {
                        remoteJid: contactJid,
                        fromMe: false,
                        id: ''
                    };
                    await sock.fetchMessageHistory(30, key, Math.floor(Date.now() / 1000));
                    await new Promise(r => setTimeout(r, 30));
                    
                    syncedCount++;
                    
                    // Only create chat if there's no existing @lid chat for same phone
                    if (!store.chats.get(contactJid)) {
                        const phone = contactJid.replace('@s.whatsapp.net', '');
                        const lid = phoneToLidMap.get(phone);
                        const existingLidChat = lid ? store.chats.get(`${lid}@lid`) : null;
                        
                        if (!existingLidChat) {
                            const contact = store.contacts[contactJid];
                            store.chats.set(contactJid, {
                                id: contactJid,
                                name: contact?.name || contact?.notify || getPhoneNumber(contactJid),
                                unreadCount: 0,
                                archived: false,
                                conversationTimestamp: Math.floor(Date.now() / 1000)
                            });
                            createdChats++;
                        }
                    }
                } catch (e) {}
            }
            
            console.log(`[FETCH-CHATS] Synced ${syncedCount}/${contacts.length} contacts, created ${createdChats} chats`);
            
            await new Promise(r => setTimeout(r, 2000));
            
            const chats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            const deduped = deduplicateChats(chats);
            
            // Get avatars - use the function that checks contacts and groups
            const chatsWithAvatars = await Promise.all(deduped.map(getChatWithAvatarFromStore));
            
            console.log("Active chats after fetch:", chatsWithAvatars.length);
            
            emitChatsListDiff(io, chatsWithAvatars, true);
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
            
            const chats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            const deduped = deduplicateChats(chats);
            
            // Get avatars - use the function that checks contacts and groups
            const chatsWithAvatars = await Promise.all(deduped.map(getChatWithAvatarFromStore));
            emitChatsListDiff(io, chatsWithAvatars, true);
            res.json({ count: chatsWithAvatars.length });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Force sync all individual contacts - fetch messages for all known contacts
    // This ensures chats that haven't been synced yet appear in the list
    app.get("/api/force-sync", async (req, res) => {
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log("[FORCE-SYNC] Starting force sync for all contacts...");
            
            // Get all contacts with @s.whatsapp.net
            const contacts = Object.keys(store.contacts)
                .filter(j => j.endsWith('@s.whatsapp.net'));
            
            console.log(`[FORCE-SYNC] Found ${contacts.length} contacts to sync`);
            
            let syncedCount = 0;
            let createdChats = 0;
            
            // For each contact, fetch message history to trigger chat creation
            for (const contactJid of contacts) {
                try {
                    const key = {
                        remoteJid: contactJid,
                        fromMe: false,
                        id: ''
                    };
                    
                    // Fetch history for this contact (limit 30 messages)
                    await sock.fetchMessageHistory(30, key, Math.floor(Date.now() / 1000));
                    
                    // Small delay to avoid rate limiting
                    await new Promise(r => setTimeout(r, 50));
                    
                    syncedCount++;
                    
                    // Only create chat if there's no existing @lid chat for same phone
                    if (!store.chats.get(contactJid)) {
                        const phone = contactJid.replace('@s.whatsapp.net', '');
                        const lid = phoneToLidMap.get(phone);
                        const existingLidChat = lid ? store.chats.get(`${lid}@lid`) : null;
                        
                        if (!existingLidChat) {
                            const contact = store.contacts[contactJid];
                            store.chats.set(contactJid, {
                                id: contactJid,
                                name: contact?.name || contact?.notify || getPhoneNumber(contactJid),
                                unreadCount: 0,
                                archived: false,
                                conversationTimestamp: Math.floor(Date.now() / 1000)
                            });
                            createdChats++;
                        }
                    }
                } catch (e) {
                    // Continue with next contact even if one fails
                    console.log(`[FORCE-SYNC] Failed to sync ${contactJid}:`, e.message);
                }
            }
            
            console.log(`[FORCE-SYNC] Synced ${syncedCount}/${contacts.length} contacts, created ${createdChats} new chats`);
            
            // Also check contacts that we don't have in store - try to fetch their profile
            // to add them to contacts
            const existingChats = store.chats.all().filter((c: any) => 
                c && c.id.endsWith('@s.whatsapp.net') && c.archived !== true
            );
            
            // Wait for any pending message processing
            await new Promise(r => setTimeout(r, 3000));
            
            // Get all active chats and emit
            let allChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            allChats = deduplicateChats(allChats);
            allChats = sortChatsByRecent(allChats);
            const chatsWithAvatars = await Promise.all(allChats.map(getChatWithAvatarFromStore));
            
            console.log(`[FORCE-SYNC] Emitting ${chatsWithAvatars.length} chats (${existingChats.length} individual)`);
            emitChatsListDiff(io, chatsWithAvatars, true);
            
            res.json({ 
                synced: syncedCount, 
                totalContacts: contacts.length,
                createdChats: createdChats,
                totalChats: chatsWithAvatars.length
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Get all contacts (including those without chats)
    app.get("/api/contacts", (req, res) => {
        const contacts = Object.values(store.contacts)
            .filter(c => c.id && c.id.endsWith('@s.whatsapp.net'))
            .map(c => ({
                id: c.id,
                name: c.name,
                notify: c.notify,
                imgUrl: c.imgUrl
            }));
        res.json(contacts);
    });

    app.get("/api/chats", (req, res) => {
        // Return ACTIVE chats from store with contact info - FILTER archived
        const chats = store.chats.all().filter((c: any) => c &&
            isValidChatJid(c.id) && c.archived !== true
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
                displayName: name || getPhoneNumber(chat.id),
                avatar: avatar,
                description: description
            };
        });
        res.json(chats);
    });

    // Get chat with full details including avatar
    app.get("/api/chat/:jid", async (req, res) => {
        let { jid } = req.params;
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
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
        let { jid } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const before = req.query.before as string;
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
        let allMsgs: any[] = [];
        const seen = new Set<string>();
        
        // Coleta msgs do store local
        for (const msg of (store.messages[jid]?.all() || [])) {
            if (msg.key?.id && !seen.has(msg.key.id)) {
                seen.add(msg.key.id);
                allMsgs.push(msg);
            }
        }
        
        // Para contatos individuais, também verifica variantes de device
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
        
        // Ordena por timestamp cronológico (mais antigas primeiro)
        allMsgs.sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
        
        // Aplicar paginação
        if (before) {
            const beforeTime = parseInt(before);
            allMsgs = allMsgs.filter((m: any) => (m.messageTimestamp || 0) < beforeTime);
        }
        
        allMsgs = allMsgs.slice(0, limit);
        
        res.json(allMsgs);
    });

    // Get recent messages (newest first) - for WhatsApp Web style pagination
    app.get("/api/messages/:jid/recent", (req, res) => {
        let { jid } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        const after = req.query.after as string;
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
        let allMsgs: any[] = [];
        const seen = new Set<string>();
        
        // Coleta msgs do store local
        for (const msg of (store.messages[jid]?.all() || [])) {
            if (msg.key?.id && !seen.has(msg.key.id)) {
                seen.add(msg.key.id);
                allMsgs.push(msg);
            }
        }
        
        // Para contatos individuais, também verifica variantes de device
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
        
        // Ordena por timestamp crescente (mais antigas primeiro) - correto para display
        allMsgs.sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
        
        // Aplicar paginação - after é timestamp para carregar mensagens mais recentes que ele
        if (after) {
            const afterTime = parseInt(after);
            allMsgs = allMsgs.filter((m: any) => (m.messageTimestamp || 0) > afterTime);
        }
        
        // Slice para pegar as mais recentes do array ordenado (ascendente)
        // As mais antigas estão no início, as mais recentes no final
        allMsgs = allMsgs.slice(-limit);
        
        // Retorna totalCount para o frontend saber se há mais mensagens
        const totalInStore = seen.size;
        res.json({ messages: allMsgs, totalCount: totalInStore });
    });

    // Load more messages (older)
    app.get("/api/messages/:jid/load-more", async (req, res) => {
        let { jid } = req.params;
        const before = parseInt(req.query.before as string) || Math.floor(Date.now() / 1000);
        const limit = parseInt(req.query.limit as string) || 30;
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            console.log(`[LOAD-MORE] Loading more messages for ${jid}, before ${before}, limit ${limit}`);
            
            // Use Baileys fetchMessageHistory to fetch older messages
            const key = {
                remoteJid: jid,
                fromMe: false,
                id: ''
            };
            
            const history = await sock.fetchMessageHistory(limit, key, before);
            console.log("[LOAD-MORE] Fetched history:", history?.length || 0, "messages");
            
            // Store the fetched messages
            if (history && history.length > 0) {
                console.log("[LOAD-MORE] First msg timestamp:", history[0]?.messageTimestamp, "Last msg timestamp:", history[history.length-1]?.messageTimestamp);
                for (const msg of history) {
                    if (!msg || !msg.key) continue;
                    
                    const msgJid = normalizeJid(msg.key.remoteJid);
                    console.log("[LOAD-MORE] Storing msg:", msg.key.id, "ts=", msg.messageTimestamp, "jid=", msgJid);
                    
                    if (!store.messages[msgJid]) {
                        const map = new Map();
                        store.messages[msgJid] = {
                            all: () => Array.from(map.values()),
                            map
                        };
                    }
                    const msgMap = store.messages[msgJid].map;
                    if (msgMap && msg.key.id && !msgMap.has(msg.key.id)) {
                        msgMap.set(msg.key.id, msg);
                        markJidDirty(msgJid);
                    }
                }
            }
            
            console.log("[LOAD-MORE] Before timestamp:", before);
            console.log("[LOAD-MORE] Store messages keys for this jid:", Object.keys(store.messages).filter(k => k.includes(jid.split('@')[0])));
            
            // Get messages before the timestamp - check all device JID variants
            // Use >= to include messages at exactly the boundary (just older than current oldest)
            let allMsgs: any[] = [];
            const seen = new Set<string>();
            
            // Check the exact JID
            const storeMsgs = store.messages[jid]?.all() || [];
            console.log("[LOAD-MORE] Messages in store for exact jid:", storeMsgs.length);
            for (const msg of storeMsgs) {
                if (msg.key?.id && !seen.has(msg.key.id)) {
                    // Only include messages older than 'before' (which is the oldest current message timestamp)
                    if ((msg.messageTimestamp || 0) < before || (msg.messageTimestamp || 0) === before) {
                        seen.add(msg.key.id);
                        allMsgs.push(msg);
                        console.log("[LOAD-MORE] Included msg:", msg.key.id, "ts=", msg.messageTimestamp);
                    }
                }
            }
            
            // For individual contacts, also check device-specific JID variants
            if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                const baseJid = jid.replace('@s.whatsapp.net', '');
                for (const key of Object.keys(store.messages)) {
                    if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                        for (const msg of (store.messages[key]?.all() || [])) {
                            if (msg.key?.id && !seen.has(msg.key.id)) {
                                if ((msg.messageTimestamp || 0) < before || (msg.messageTimestamp || 0) === before) {
                                    seen.add(msg.key.id);
                                    allMsgs.push(msg);
                                }
                            }
                        }
                    }
                }
            }
            
            allMsgs = allMsgs
                .sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
                .slice(0, limit);
            
            res.json(allMsgs);
        } catch (e) {
            console.log("Error loading more messages:", e);
            res.status(500).json({ error: e.message });
        }
    });

    // Media proxy endpoint - downloads encrypted media from WhatsApp and serves it
    app.get("/api/media/:jid/:messageId", async (req, res) => {
        let { jid, messageId } = req.params;
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
        if (!sock) {
            return res.status(500).json({ error: "Socket not initialized" });
        }
        
        try {
            // Find the message
            let msg: any = null;
            
            // Check exact JID
            const msgs = store.messages[jid]?.all() || [];
            msg = msgs.find((m: any) => m.key?.id === messageId);
            
            // For individual contacts, also check device variants
            if (!msg && jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                const baseJid = jid.replace('@s.whatsapp.net', '');
                for (const key of Object.keys(store.messages)) {
                    if (key.startsWith(baseJid + ':') && key.endsWith('@s.whatsapp.net')) {
                        const variantMsgs = store.messages[key]?.all() || [];
                        msg = variantMsgs.find((m: any) => m.key?.id === messageId);
                        if (msg) break;
                    }
                }
            }
            
            if (!msg) {
                return res.status(404).json({ error: "Message not found" });
            }
            
            // Determine media type and download
            let stream: any;
            let contentType = 'application/octet-stream';
            let filename = 'media';
            
            const message = msg.message;
            if (!message) {
                return res.status(404).json({ error: "No message content" });
            }
            
            // Unwrap if needed
            const inner = message.viewOnceMessage?.message 
                || message.viewOnceMessageV2?.message 
                || message.ephemeralMessage?.message
                || message.documentWithCaptionMessage?.message
                || message;
            
            if (inner.stickerMessage) {
                stream = await downloadContentFromMessage(inner.stickerMessage, 'sticker');
                contentType = inner.stickerMessage.mimetype || 'image/webp';
                filename = 'sticker.webp';
            } else if (inner.imageMessage) {
                stream = await downloadContentFromMessage(inner.imageMessage, 'image');
                contentType = inner.imageMessage.mimetype || 'image/jpeg';
                filename = 'image.jpg';
            } else if (inner.videoMessage) {
                stream = await downloadContentFromMessage(inner.videoMessage, 'video');
                contentType = inner.videoMessage.mimetype || 'video/mp4';
                filename = 'video.mp4';
            } else if (inner.audioMessage) {
                stream = await downloadContentFromMessage(inner.audioMessage, 'audio');
                contentType = inner.audioMessage.mimetype || 'audio/ogg';
                filename = inner.audioMessage.ptt ? 'voice.ogg' : 'audio.ogg';
            } else if (inner.documentMessage) {
                stream = await downloadContentFromMessage(inner.documentMessage, 'document');
                contentType = inner.documentMessage.mimetype || 'application/octet-stream';
                filename = inner.documentMessage.fileName || 'document';
            } else if (inner.locationMessage) {
                // Location doesn't need download - return map placeholder
                return res.status(404).json({ error: "Location messages don't have downloadable media" });
            } else {
                return res.status(400).json({ error: "No downloadable media in message" });
            }
            
            // Collect stream chunks
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
                chunks.push(Buffer.from(chunk));
            }
            const buffer = Buffer.concat(chunks);
            
            // Set headers and send
            res.set('Content-Type', contentType);
            res.set('Content-Length', String(buffer.length));
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(buffer);
            
        } catch (e: any) {
            console.log("Error downloading media:", e.message || e);
            res.status(500).json({ error: e.message || "Failed to download media" });
        }
    });

    app.post("/api/send", express.json(), async (req, res) => {
        const { jid, text } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const sentMsg = await sock.sendMessage(jid, { text });
            // Don't manually update chat - let Baileys events handle it naturally
            res.json(sentMsg);
        } catch (err) {
            console.error('[SEND] Error:', err);
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
        if (!jid) return res.status(400).json({ error: "Missing jid" });
        try {
            // Clean device suffix but keep @s.whatsapp.net/@g.us/@lid
            let cleanJid = jid;
            if (jid.includes(':') && (jid.includes('@s.whatsapp.net') || jid.includes('@newsletter') || jid.includes('@broadcast'))) {
                cleanJid = jid.replace(/:\d+@/, '@');
            }
            
            // Check if chat exists directly
            let chat = store.chats.get(cleanJid);
            
            // If not found, try with @lid <-> @s.whatsapp.net conversion
            if (!chat) {
                if (cleanJid.endsWith('@s.whatsapp.net')) {
                    const base = cleanJid.replace('@s.whatsapp.net', '');
                    const lid = phoneToLidMap.get(base);
                    if (lid) {
                        chat = store.chats.get(`${lid}@lid`);
                    }
                } else if (cleanJid.endsWith('@lid')) {
                    const lidPart = cleanJid.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn) {
                        chat = store.chats.get(`${pn}@s.whatsapp.net`);
                    }
                }
            }
            
            if (chat) {
                chat.unreadCount = 0;
                store.chats.set(chat.id, chat);
                markChatDirty(chat.id);
            }
            
            // Use chatRead instead of sendReadReceipt (Baileys v6+)
            if (typeof sock?.chatRead === 'function') {
                await sock.chatRead(cleanJid);
            } else if (typeof sock?.sendReadReceipt === 'function') {
                await sock.sendReadReceipt(cleanJid);
            }
            emitChatsDebounced();
            res.json({ success: true });
        } catch (err) {
            console.error('[MARK-READ] Error:', err);
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
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
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
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
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

            if (forEveryone) {
                // Delete for everyone
                await sock.sendMessage(jid, { delete: msg.key });
            } else {
                // Delete for me only - clear chat history up to this message
                await sock.chatModify({ clear: { messages: [{ id: msg.key.id, fromMe: msg.key.fromMe, timestamp: msg.messageTimestamp }] } }, jid);
                // Remove from local store
                const chatMsgs = store.messages[jid]?.all() || [];
                const idx = chatMsgs.findIndex((m: any) => m.key?.id === messageId);
                if (idx !== -1) chatMsgs.splice(idx, 1);
            }
            res.json({ success: true, forEveryone });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Edit a message
    app.post("/api/edit-message", express.json(), async (req, res) => {
        const { jid, messageId, newText } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !messageId || !newText) return res.status(400).json({ error: "Missing required fields: jid, messageId, newText" });
        try {
            const msgs = store.messages[jid]?.all() || [];
            const msg = msgs.find((m: any) => m.key?.id === messageId);
            if (!msg) return res.status(404).json({ error: "Message not found" });

            const sentMsg = await sock.sendMessage(jid, { text: newText }, { edit: msg.key });
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Forward a message
    app.post("/api/forward-message", express.json(), async (req, res) => {
        const { fromJid, toJid, messageId } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!fromJid || !toJid || !messageId) return res.status(400).json({ error: "Missing required fields: fromJid, toJid, messageId" });
        try {
            const msgs = store.messages[fromJid]?.all() || [];
            const msg = msgs.find((m: any) => m.key?.id === messageId);
            if (!msg) return res.status(404).json({ error: "Message not found" });

            const sentMsg = await sock.sendMessage(toJid, { forward: msg });
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Pin/unpin a chat
    app.post("/api/pin-chat", express.json(), async (req, res) => {
        const { jid, pin } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || pin === undefined) return res.status(400).json({ error: "Missing required fields: jid, pin" });
        try {
            await sock.chatModify({ pin: pin ? true : false }, jid);
            // Update local store
            const chat = store.chats.get(jid);
            if (chat) {
                chat.pinnedAt = pin ? Date.now() : undefined;
                store.chats.set(jid, chat);
            }
            res.json({ success: true, pinned: pin });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Mute/unmute a chat
    app.post("/api/mute-chat", express.json(), async (req, res) => {
        const { jid, mute, duration } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || mute === undefined) return res.status(400).json({ error: "Missing required fields: jid, mute" });
        try {
            // duration: '8h', '1w', 'always' or null to unmute
            if (mute) {
                let muteUntil = 0;
                const now = Math.floor(Date.now() / 1000);
                switch (duration) {
                    case '8h': muteUntil = now + 8 * 60 * 60; break;
                    case '1w': muteUntil = now + 7 * 24 * 60 * 60; break;
                    case 'always': muteUntil = now + 365 * 24 * 60 * 60; break;
                    default: muteUntil = now + 8 * 60 * 60;
                }
                await sock.chatModify({ mute: muteUntil }, jid);
            } else {
                await sock.chatModify({ mute: null }, jid);
            }
            // Update local store
            const chat = store.chats.get(jid);
            if (chat) {
                chat.muted = mute;
                store.chats.set(jid, chat);
            }
            res.json({ success: true, muted: mute, duration });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Set ephemeral/disappearing messages
    app.post("/api/set-ephemeral", express.json(), async (req, res) => {
        const { jid, ephemeralExpiration } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || ephemeralExpiration === undefined) return res.status(400).json({ error: "Missing required fields: jid, ephemeralExpiration" });
        try {
            // ephemeralExpiration: 0 (off), 86400 (24h), 604800 (7d), 7776000 (90d)
            if (jid.endsWith('@g.us')) {
                await sock.groupToggleEphemeral(jid, ephemeralExpiration);
            } else {
                await sock.chatModify({ ephemeralExpiration }, jid);
            }
            res.json({ success: true, ephemeralExpiration });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Star/unstar a message
    app.post("/api/star-message", express.json(), async (req, res) => {
        const { jid, messageId, star } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !messageId || star === undefined) return res.status(400).json({ error: "Missing required fields: jid, messageId, star" });
        try {
            const msgs = store.messages[jid]?.all() || [];
            const msg = msgs.find((m: any) => m.key?.id === messageId);
            if (!msg) return res.status(404).json({ error: "Message not found" });

            // Use native Baileys star method
            await sock.star(jid, [{ id: msg.key.id, fromMe: msg.key.fromMe }], star);

            // Update local store
            msg.starred = star;
            res.json({ success: true, starred: star });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get starred messages
    app.get("/api/starred-messages", (req, res) => {
        const allStarred: any[] = [];
        for (const [jid, msgObj] of Object.entries(store.messages)) {
            for (const msg of msgObj.all()) {
                if (msg.starred) {
                    allStarred.push({ ...msg, chatJid: jid });
                }
            }
        }
        allStarred.sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0));
        res.json(allStarred);
    });

    // Block a contact
    app.post("/api/block-contact", express.json(), async (req, res) => {
        const { jid, block } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || block === undefined) return res.status(400).json({ error: "Missing required fields: jid, block" });
        try {
            await sock.updateBlockStatus(jid, block ? 'block' : 'unblock');
            res.json({ success: true, blocked: block });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get blocked contacts
    app.get("/api/blocked-contacts", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const blocked = await sock.fetchBlocklist();
            res.json(blocked || []);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get shared media with a contact
    app.get("/api/shared-media/:jid", (req, res) => {
        let jid = decodeURIComponent(req.params.jid);
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
        const media: any[] = [];
        
        for (const [chatJid, msgObj] of Object.entries(store.messages)) {
            // Match the specific contact JID (including device variants)
            const baseJid = jid.replace('@s.whatsapp.net', '');
            if (!chatJid.includes(baseJid)) continue;
            
            for (const msg of msgObj.all()) {
                if (msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage) {
                    media.push({
                        key: msg.key,
                        type: msg.message?.imageMessage ? 'image' : msg.message?.videoMessage ? 'video' : msg.message?.audioMessage ? 'audio' : 'document',
                        caption: msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || msg.message?.documentMessage?.fileName || '',
                        timestamp: msg.messageTimestamp,
                        thumbnail: msg.message?.imageMessage?.jpegThumbnail || msg.message?.videoMessage?.jpegThumbnail
                    });
                }
            }
        }
        media.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        res.json({ media: media.slice(0, 50) });
    });

    // Get common groups with a contact
    app.get("/api/common-groups/:jid", async (req, res) => {
        let jid = decodeURIComponent(req.params.jid);
        
        // Normalize LID to phone number if mapping exists
        if (jid.endsWith('@lid')) {
            const lidPart = jid.replace('@lid', '');
            const pnUser = lidToPhoneMap.get(lidPart);
            if (pnUser) {
                jid = `${pnUser}@s.whatsapp.net`;
            }
        }
        
        const groups: any[] = [];
        
        // Find groups where this contact is a participant
        for (const [groupJid, meta] of Object.entries(store.groupMetadata)) {
            if (groupJid.endsWith('@g.us')) {
                const participants = (meta as any).participants || [];
                const isParticipant = participants.some((p: any) => {
                    const pJid = p.id;
                    return pJid === jid || pJid?.startsWith(jid.split('@')[0] + ':');
                });
                if (isParticipant) {
                    groups.push({
                        jid: groupJid,
                        name: (meta as any).subject,
                        participants: participants.length
                    });
                }
            }
        }
        res.json({ groups });
    });

    // Get device info (connected devices)
    app.get("/api/device-info", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const devices = await sock.getDevices();
            const deviceList = Object.entries(devices || {}).map(([deviceJid, info]: [string, any]) => ({
                device: info.device || 'Unknown',
                platform: info.platform || 'web',
                lastSeen: info.lastSeen || 0
            }));
            res.json({ devices: deviceList });
        } catch (err) {
            // Fallback for older versions
            res.json({ devices: [{ device: 'Celular', platform: 'Android/iOS', lastSeen: Date.now() / 1000 }] });
        }
    });

    // Search messages
    app.get("/api/search-messages", (req, res) => {
        const query = (req.query.q as string || '').toLowerCase();
        const jid = req.query.jid as string;
        const filter = req.query.filter as string || 'all';
        if (!query) return res.status(400).json({ error: "Missing search query 'q'" });

        const results: any[] = [];
        const searchIn = jid ? { [jid]: store.messages[jid] } : store.messages;

        for (const [chatJid, msgObj] of Object.entries(searchIn)) {
            if (!msgObj) continue;
            for (const msg of msgObj.all()) {
                let text = '';
                let matchesFilter = true;

                // Check filter type
                if (filter === 'image') {
                    matchesFilter = !!msg.message?.imageMessage;
                    text = msg.message?.imageMessage?.caption || '';
                } else if (filter === 'video') {
                    matchesFilter = !!msg.message?.videoMessage;
                    text = msg.message?.videoMessage?.caption || '';
                } else if (filter === 'document') {
                    matchesFilter = !!msg.message?.documentMessage;
                    text = msg.message?.documentMessage?.fileName || '';
                } else if (filter === 'link') {
                    text = msg.message?.extendedTextMessage?.text || '';
                    matchesFilter = text.includes('http://') || text.includes('https://') || text.includes('www.');
                } else {
                    text = msg.message?.conversation
                        || msg.message?.extendedTextMessage?.text
                        || msg.message?.imageMessage?.caption
                        || msg.message?.videoMessage?.caption
                        || '';
                }

                if (matchesFilter && text.toLowerCase().includes(query)) {
                    results.push({ ...msg, chatJid });
                }
            }
        }
        results.sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0));
        res.json(results.slice(0, 50));
    });

    // Get unread chats
    app.get("/api/unread-chats", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const unreadChats = store.chats.all().filter((c: any) =>
            (isValidChatJid(c.id))
            && c.unreadCount > 0
            && c.archived !== true
        );
        const sorted = sortChatsByRecent(unreadChats);
        const withAvatars = await Promise.all(sorted.map(getChatWithAvatarFromStore));
        res.json(withAvatars);
    });

    // Logout / disconnect session
    app.post("/api/logout", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            await sock.logout();
            sock = null;
            connectionStatus = "close";
            qrCode = null;
            io.emit("connection-update", { status: "close", loggedOut: true });
            res.json({ success: true, message: "Session logged out" });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== GROUP MANAGEMENT ====================

    // Create a group
    app.post("/api/group/create", express.json(), async (req, res) => {
        const { name, participants } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!name || !participants || !Array.isArray(participants)) {
            return res.status(400).json({ error: "Missing required fields: name, participants[]" });
        }
        try {
            const group = await sock.groupCreate(name, participants);
            // Store group metadata
            try {
                const meta = await sock.groupMetadata(group.id);
                store.groupMetadata[group.id] = meta;
                store.chats.set(group.id, {
                    id: group.id,
                    name: meta.subject,
                    unreadCount: 0,
                    conversationTimestamp: Math.floor(Date.now() / 1000)
                });
            } catch (e) {}
            res.json(group);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update group subject/name
    app.post("/api/group/subject", express.json(), async (req, res) => {
        const { jid, subject } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !subject) return res.status(400).json({ error: "Missing required fields: jid, subject" });
        try {
            await sock.groupUpdateSubject(jid, subject);
            // Update local store
            const chat = store.chats.get(jid);
            if (chat) {
                chat.name = subject;
                store.chats.set(jid, chat);
            }
            if (store.groupMetadata[jid]) {
                store.groupMetadata[jid].subject = subject;
            }
            res.json({ success: true, subject });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update group description
    app.post("/api/group/description", express.json(), async (req, res) => {
        const { jid, description } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.groupUpdateDescription(jid, description || '');
            if (store.groupMetadata[jid]) {
                store.groupMetadata[jid].desc = description;
            }
            res.json({ success: true, description });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update group picture
    app.post("/api/group/picture", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        const file = req.file;
        if (!jid || !file) return res.status(400).json({ error: "Missing required fields: jid, file" });
        try {
            const buffer = readFileSync(file.path);
            await sock.updateProfilePicture(jid, buffer);
            try { unlinkSync(file.path); } catch {}
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Add participants to group
    app.post("/api/group/add", express.json(), async (req, res) => {
        const { jid, participants } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !participants || !Array.isArray(participants)) {
            return res.status(400).json({ error: "Missing required fields: jid, participants[]" });
        }
        try {
            const result = await sock.groupParticipantsUpdate(jid, participants, 'add');
            // Refresh group metadata
            try {
                const meta = await sock.groupMetadata(jid);
                store.groupMetadata[jid] = meta;
            } catch (e) {}
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Remove participants from group
    app.post("/api/group/remove", express.json(), async (req, res) => {
        const { jid, participants } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !participants || !Array.isArray(participants)) {
            return res.status(400).json({ error: "Missing required fields: jid, participants[]" });
        }
        try {
            const result = await sock.groupParticipantsUpdate(jid, participants, 'remove');
            try {
                const meta = await sock.groupMetadata(jid);
                store.groupMetadata[jid] = meta;
            } catch (e) {}
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Promote participants to admin
    app.post("/api/group/promote", express.json(), async (req, res) => {
        const { jid, participants } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !participants || !Array.isArray(participants)) {
            return res.status(400).json({ error: "Missing required fields: jid, participants[]" });
        }
        try {
            const result = await sock.groupParticipantsUpdate(jid, participants, 'promote');
            try {
                const meta = await sock.groupMetadata(jid);
                store.groupMetadata[jid] = meta;
            } catch (e) {}
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Demote admin
    app.post("/api/group/demote", express.json(), async (req, res) => {
        const { jid, participants } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !participants || !Array.isArray(participants)) {
            return res.status(400).json({ error: "Missing required fields: jid, participants[]" });
        }
        try {
            const result = await sock.groupParticipantsUpdate(jid, participants, 'demote');
            try {
                const meta = await sock.groupMetadata(jid);
                store.groupMetadata[jid] = meta;
            } catch (e) {}
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Leave a group
    app.post("/api/group/leave", express.json(), async (req, res) => {
        const { jid } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.groupLeave(jid);
            // Remove from local store
            store.chats.set(jid, { ...store.chats.get(jid), archived: true });
            delete store.groupMetadata[jid];
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get group invite link
    app.get("/api/group/invite-link/:jid", async (req, res) => {
        const { jid } = req.params;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const code = await sock.groupInviteCode(jid);
            res.json({ inviteLink: `https://chat.whatsapp.com/${code}`, code });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Revoke group invite link
    app.post("/api/group/revoke-invite", express.json(), async (req, res) => {
        const { jid } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            const code = await sock.groupRevokeInvite(jid);
            res.json({ success: true, newCode: code, inviteLink: `https://chat.whatsapp.com/${code}` });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update group settings (who can send messages / edit info)
    app.post("/api/group/settings", express.json(), async (req, res) => {
        const { jid, setting, value } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !setting) return res.status(400).json({ error: "Missing required fields: jid, setting (announcement/locked/restrict)" });
        try {
            // setting: 'announcement' (only admins send), 'locked' (only admins edit info), 'restrict' (general restriction)
            await sock.groupSettingUpdate(jid, setting);
            res.json({ success: true, setting, value });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== MESSAGE TYPES ====================

    // Send location
    app.post("/api/send-location", express.json(), async (req, res) => {
        const { jid, latitude, longitude, name, address } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || latitude === undefined || longitude === undefined) {
            return res.status(400).json({ error: "Missing required fields: jid, latitude, longitude" });
        }
        try {
            const sentMsg = await sock.sendMessage(jid, {
                location: {
                    degreesLatitude: latitude,
                    degreesLongitude: longitude,
                    name: name || '',
                    address: address || ''
                }
            });
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
            }
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send contact
    app.post("/api/send-contact", express.json(), async (req, res) => {
        const { jid, fullName, phoneNumber } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !fullName || !phoneNumber) {
            return res.status(400).json({ error: "Missing required fields: jid, fullName, phoneNumber" });
        }
        try {
            const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${fullName}\nTEL;type=CELL;type=VOICE;waid=${phoneNumber}:${phoneNumber}\nEND:VCARD`;
            const sentMsg = await sock.sendMessage(jid, {
                contacts: {
                    displayName: fullName,
                    contacts: [{ vcard }]
                }
            });
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
            }
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send poll
    app.post("/api/send-poll", express.json(), async (req, res) => {
        const { jid, name, options, selectableCount } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !name || !options || !Array.isArray(options)) {
            return res.status(400).json({ error: "Missing required fields: jid, name, options[]" });
        }
        try {
            const sentMsg = await sock.sendMessage(jid, {
                poll: {
                    name,
                    values: options,
                    selectableCount: selectableCount || 1
                }
            });
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
            }
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send sticker
    app.post("/api/send-sticker", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        const file = req.file;
        if (!jid || !file) return res.status(400).json({ error: "Missing required fields: jid, file" });
        try {
            const buffer = readFileSync(file.path);
            const sentMsg = await sock.sendMessage(jid, {
                sticker: buffer,
                mimetype: file.mimetype
            });
            try { unlinkSync(file.path); } catch {}
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
            }
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send view-once media (image or video)
    app.post("/api/send-viewonce", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, caption, mediaType } = req.body;
        const file = req.file;
        if (!jid || !file) return res.status(400).json({ error: "Missing required fields: jid, file" });
        try {
            const buffer = readFileSync(file.path);
            const mime = file.mimetype;
            const type = mediaType || mime.split('/')[0];
            let msgContent: any;
            if (type === 'video') {
                msgContent = { video: buffer, mimetype: mime, caption: caption || '', viewOnce: true };
            } else {
                msgContent = { image: buffer, mimetype: mime, caption: caption || '', viewOnce: true };
            }
            const sentMsg = await sock.sendMessage(jid, msgContent);
            try { unlinkSync(file.path); } catch {}
            const ts = sentMsg?.messageTimestamp?.low || sentMsg?.messageTimestamp;
            if (ts) {
                updateChatTimestamp(jid, ts);
                syncLidAndPhoneTimestamp(jid, ts);
                emitChatsDebounced(true);
            }
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send with link preview
    app.post("/api/send-with-preview", express.json(), async (req, res) => {
        const { jid, text, replyTo } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !text) return res.status(400).json({ error: "Missing required fields: jid, text" });
        try {
            // Generate link preview
            const urlInfo = await getUrlInfo(text, { thumbnailWidth: 300, fetchOpts: { timeout: 5000 } });
            const opts: any = {};
            if (replyTo) {
                const msgs = store.messages[jid]?.all() || [];
                const quotedMsg = msgs.find((m: any) => m.key?.id === replyTo);
                if (quotedMsg) opts.quoted = quotedMsg;
            }
            const sentMsg = await sock.sendMessage(jid, { text }, opts);
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Pin a message in chat
    app.post("/api/pin-message", express.json(), async (req, res) => {
        const { jid, messageId, type, time } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !messageId) return res.status(400).json({ error: "Missing required fields: jid, messageId" });
        try {
            const msgs = store.messages[jid]?.all() || [];
            const msg = msgs.find((m: any) => m.key?.id === messageId);
            if (!msg) return res.status(404).json({ error: "Message not found" });
            // type: 'pin' or 'unpin', time: 86400 (24h), 604800 (7d), 2592000 (30d)
            const pinValue = type === 'unpin' ? 'UNPIN' : 'PIN_IN_CHAT';
            const sentMsg = await sock.sendMessage(jid, {
                pin: msg.key,
                type: pinValue,
                time: time || 604800
            });
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Keep message (prevent disappearing)
    app.post("/api/keep-message", express.json(), async (req, res) => {
        const { jid, messageId, keep } = req.body;
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        if (!jid || !messageId) return res.status(400).json({ error: "Missing required fields: jid, messageId" });
        try {
            const msgs = store.messages[jid]?.all() || [];
            const msg = msgs.find((m: any) => m.key?.id === messageId);
            if (!msg) return res.status(404).json({ error: "Message not found" });
            await sock.chatModify({
                keep: {
                    type: keep ? 1 : 0, // 1=keep, 0=unkeep
                    key: msg.key,
                    timestampMs: Date.now().toString()
                }
            }, jid);
            res.json({ success: true, kept: keep });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== STATUS / STORIES ====================

    // Post a text status
    app.post("/api/status/text", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { text, backgroundColor, font, statusJidList } = req.body;
        if (!text) return res.status(400).json({ error: "Missing required field: text" });
        try {
            const sentMsg = await sock.sendMessage('status@broadcast', { text }, {
                backgroundColor: backgroundColor || '#25D366',
                font: font || 0,
                statusJidList: statusJidList || undefined
            });
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Post an image/video status
    app.post("/api/status/media", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { caption, mediaType, statusJidList } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        try {
            const buffer = readFileSync(file.path);
            const mime = file.mimetype;
            const type = mediaType || mime.split('/')[0];
            let msgContent: any;
            if (type === 'video') {
                msgContent = { video: buffer, mimetype: mime, caption: caption || '' };
            } else {
                msgContent = { image: buffer, mimetype: mime, caption: caption || '' };
            }
            const sentMsg = await sock.sendMessage('status@broadcast', msgContent, {
                statusJidList: statusJidList || undefined
            });
            try { unlinkSync(file.path); } catch {}
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get contacts' statuses
    app.get("/api/status", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            // Get all contacts with @s.whatsapp.net
            const jids = Object.keys(store.contacts)
                .filter(j => j.endsWith('@s.whatsapp.net'))
                .slice(0, 50);
            if (jids.length === 0) return res.json([]);
            const statuses = await sock.fetchStatus(...jids);
            res.json(statuses || []);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get specific contact's status
    app.get("/api/status/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const status = await sock.fetchStatus(jid);
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // React to a status
    app.post("/api/status/react", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, messageId, emoji } = req.body;
        if (!jid || !messageId) return res.status(400).json({ error: "Missing required fields: jid, messageId" });
        try {
            await sock.sendMessage(jid, {
                react: {
                    key: { remoteJid: jid, id: messageId, fromMe: false },
                    text: emoji || ''
                }
            });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update status privacy
    app.post("/api/status/privacy", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { value } = req.body; // 'all', 'contacts', 'contact_blacklist', 'none'
        if (!value) return res.status(400).json({ error: "Missing required field: value" });
        try {
            await sock.updateStatusPrivacy(value);
            res.json({ success: true, value });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update profile status text
    app.post("/api/profile/status", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { status } = req.body;
        if (status === undefined) return res.status(400).json({ error: "Missing required field: status" });
        try {
            await sock.updateProfileStatus(status);
            res.json({ success: true, status });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== NEWSLETTERS / CHANNELS ====================

    // Create a newsletter/channel
    app.post("/api/newsletter/create", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: "Missing required field: name" });
        try {
            const newsletter = await sock.newsletterCreate(name, description);
            res.json(newsletter);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Follow a newsletter
    app.post("/api/newsletter/follow", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.newsletterFollow(jid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Unfollow a newsletter
    app.post("/api/newsletter/unfollow", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.newsletterUnfollow(jid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Mute/unmute newsletter
    app.post("/api/newsletter/mute", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, mute } = req.body;
        if (!jid || mute === undefined) return res.status(400).json({ error: "Missing required fields: jid, mute" });
        try {
            if (mute) {
                await sock.newsletterMute(jid);
            } else {
                await sock.newsletterUnmute(jid);
            }
            res.json({ success: true, muted: mute });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get newsletter metadata
    app.get("/api/newsletter/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const metadata = await sock.newsletterMetadata('jid', jid);
            res.json(metadata);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get newsletter by invite code
    app.get("/api/newsletter/invite/:code", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { code } = req.params;
        try {
            const metadata = await sock.newsletterMetadata('invite', code);
            res.json(metadata);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get newsletter messages
    app.get("/api/newsletter/:jid/messages", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        const count = parseInt(req.query.count as string) || 20;
        try {
            const messages = await sock.newsletterFetchMessages(jid, count, 0, 0);
            res.json(messages || []);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Send message to newsletter
    app.post("/api/newsletter/send", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, text } = req.body;
        if (!jid || !text) return res.status(400).json({ error: "Missing required fields: jid, text" });
        try {
            const sentMsg = await sock.sendMessage(jid, { text });
            res.json(sentMsg);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // React to newsletter message
    app.post("/api/newsletter/react", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, serverId, reaction } = req.body;
        if (!jid || !serverId) return res.status(400).json({ error: "Missing required fields: jid, serverId" });
        try {
            await sock.newsletterReactMessage(jid, serverId, reaction || '');
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update newsletter name
    app.post("/api/newsletter/name", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, name } = req.body;
        if (!jid || !name) return res.status(400).json({ error: "Missing required fields: jid, name" });
        try {
            await sock.newsletterUpdateName(jid, name);
            res.json({ success: true, name });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update newsletter description
    app.post("/api/newsletter/description", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, description } = req.body;
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.newsletterUpdateDescription(jid, description || '');
            res.json({ success: true, description });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update newsletter picture
    app.post("/api/newsletter/picture", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        const file = req.file;
        if (!jid || !file) return res.status(400).json({ error: "Missing required fields: jid, file" });
        try {
            const buffer = readFileSync(file.path);
            await sock.newsletterUpdatePicture(jid, buffer);
            try { unlinkSync(file.path); } catch {}
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Remove newsletter picture
    app.delete("/api/newsletter/picture/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            await sock.newsletterRemovePicture(jid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get newsletter subscribers count
    app.get("/api/newsletter/:jid/subscribers", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const count = await sock.newsletterSubscribers(jid);
            res.json({ subscribers: count });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get newsletter admin count
    app.get("/api/newsletter/:jid/admin-count", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const count = await sock.newsletterAdminCount(jid);
            res.json({ adminCount: count });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Delete newsletter
    app.delete("/api/newsletter/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            await sock.newsletterDelete(jid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== COMMUNITIES ====================

    // Create a community
    app.post("/api/community/create", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { subject, description } = req.body;
        if (!subject) return res.status(400).json({ error: "Missing required field: subject" });
        try {
            const community = await sock.communityCreate(subject, description || '');
            // Fetch and store metadata
            try {
                const meta = await sock.communityMetadata(community.id);
                store.chats.set(community.id, {
                    id: community.id,
                    name: meta.subject,
                    unreadCount: 0,
                    conversationTimestamp: Math.floor(Date.now() / 1000)
                });
                store.groupMetadata[community.id] = meta;
            } catch (e) {}
            res.json(community);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get community metadata
    app.get("/api/community/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const meta = await sock.communityMetadata(jid);
            res.json(meta);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Link a group to a community
    app.post("/api/community/link-group", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { groupJid, communityJid } = req.body;
        if (!groupJid || !communityJid) return res.status(400).json({ error: "Missing required fields: groupJid, communityJid" });
        try {
            await sock.communityLinkGroup(groupJid, communityJid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Unlink a group from a community
    app.post("/api/community/unlink-group", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { groupJid, communityJid } = req.body;
        if (!groupJid || !communityJid) return res.status(400).json({ error: "Missing required fields: groupJid, communityJid" });
        try {
            await sock.communityUnlinkGroup(groupJid, communityJid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Fetch linked groups of a community
    app.get("/api/community/:jid/groups", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const groups = await sock.communityFetchLinkedGroups(jid);
            res.json(groups || []);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Leave a community
    app.post("/api/community/leave", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.communityLeave(jid);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update community subject
    app.post("/api/community/subject", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, subject } = req.body;
        if (!jid || !subject) return res.status(400).json({ error: "Missing required fields: jid, subject" });
        try {
            await sock.communityUpdateSubject(jid, subject);
            res.json({ success: true, subject });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update community description
    app.post("/api/community/description", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, description } = req.body;
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            await sock.communityUpdateDescription(jid, description);
            res.json({ success: true, description });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get community invite link
    app.get("/api/community/invite-link/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const code = await sock.communityInviteCode(jid);
            res.json({ inviteLink: `https://chat.whatsapp.com/${code}`, code });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Revoke community invite
    app.post("/api/community/revoke-invite", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: "Missing required field: jid" });
        try {
            const code = await sock.communityRevokeInvite(jid);
            res.json({ success: true, newCode: code });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Accept community invite
    app.post("/api/community/accept-invite", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: "Missing required field: code" });
        try {
            const result = await sock.communityAcceptInvite(code);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Community participant actions (approve/reject join requests)
    app.post("/api/community/participants", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, participants, action } = req.body;
        if (!jid || !participants || !action) return res.status(400).json({ error: "Missing required fields: jid, participants[], action (approve/reject)" });
        try {
            const result = await sock.communityRequestParticipantsUpdate(jid, participants, action);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Community settings (announcement/locked)
    app.post("/api/community/settings", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, setting } = req.body; // 'announcement', 'not_announcement', 'locked', 'unlocked'
        if (!jid || !setting) return res.status(400).json({ error: "Missing required fields: jid, setting" });
        try {
            await sock.communitySettingUpdate(jid, setting);
            res.json({ success: true, setting });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== BROADCAST LISTS ====================

    // Send broadcast message (to multiple contacts at once)
    app.post("/api/send-broadcast", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { recipients, text } = req.body;
        if (!recipients || !Array.isArray(recipients) || !text) {
            return res.status(400).json({ error: "Missing required fields: recipients[], text" });
        }
        try {
            const results: any[] = [];
            for (const jid of recipients) {
                try {
                    const sentMsg = await sock.sendMessage(jid, { text }, { broadcast: true });
                    results.push({ jid, success: true, messageId: sentMsg?.key?.id });
                } catch (e) {
                    results.push({ jid, success: false, error: (e as Error).message });
                }
            }
            res.json({ results });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== WHATSAPP BUSINESS ====================

    // Update business profile
    app.post("/api/business/profile", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { address, websites, email, description, hours } = req.body;
        try {
            await sock.updateBussinesProfile({ address, websites, email, description, hours });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get business profile
    app.get("/api/business/profile/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        try {
            const profile = await sock.getBusinessProfile(jid);
            res.json(profile);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get catalog
    app.get("/api/business/catalog/:jid", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid } = req.params;
        const limit = parseInt(req.query.limit as string) || 20;
        try {
            const catalog = await sock.getCatalog({ jid, limit });
            res.json(catalog);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get collections
    app.get("/api/business/collections", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        try {
            const collections = await sock.getCollections();
            res.json(collections);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Create product
    app.post("/api/business/product", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { name, description, price, currency, images, url } = req.body;
        if (!name || !price) return res.status(400).json({ error: "Missing required fields: name, price" });
        try {
            const product = await sock.productCreate({
                name,
                description: description || '',
                price,
                currency: currency || 'BRL',
                images: images || [],
                url: url || ''
            } as any);
            res.json(product);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update product
    app.put("/api/business/product/:id", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { id } = req.params;
        try {
            const product = await sock.productUpdate(id, req.body);
            res.json(product);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Delete product(s)
    app.delete("/api/business/product", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { productIds } = req.body;
        if (!productIds || !Array.isArray(productIds)) return res.status(400).json({ error: "Missing required field: productIds[]" });
        try {
            await sock.productDelete(productIds);
            res.json({ success: true, deleted: productIds.length });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Get order details
    app.get("/api/business/order/:orderId", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { orderId } = req.params;
        const token = req.query.token as string;
        if (!token) return res.status(400).json({ error: "Missing query param: token" });
        try {
            const order = await sock.getOrderDetails(orderId, token);
            res.json(order);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Update cover photo
    app.post("/api/business/cover", upload.single("file"), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        try {
            const buffer = readFileSync(file.path);
            const result = await sock.updateCoverPhoto(buffer);
            try { unlinkSync(file.path); } catch {}
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== LABELS ====================

    // Add label
    app.post("/api/labels", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, labels } = req.body;
        if (!jid || !labels) return res.status(400).json({ error: "Missing required fields: jid, labels" });
        try {
            await sock.addLabel(jid, labels);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Add label to chat
    app.post("/api/labels/chat", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, labelId } = req.body;
        if (!jid || !labelId) return res.status(400).json({ error: "Missing required fields: jid, labelId" });
        try {
            await sock.addChatLabel(jid, labelId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Remove label from chat
    app.delete("/api/labels/chat", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, labelId } = req.body;
        if (!jid || !labelId) return res.status(400).json({ error: "Missing required fields: jid, labelId" });
        try {
            await sock.removeChatLabel(jid, labelId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Add label to message
    app.post("/api/labels/message", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, messageId, labelId } = req.body;
        if (!jid || !messageId || !labelId) return res.status(400).json({ error: "Missing required fields: jid, messageId, labelId" });
        try {
            await sock.addMessageLabel(jid, messageId, labelId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Remove label from message
    app.delete("/api/labels/message", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { jid, messageId, labelId } = req.body;
        if (!jid || !messageId || !labelId) return res.status(400).json({ error: "Missing required fields: jid, messageId, labelId" });
        try {
            await sock.removeMessageLabel(jid, messageId, labelId);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== QUICK REPLIES ====================

    // Add/edit quick reply
    app.post("/api/quick-reply", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const quickReply = req.body;
        if (!quickReply) return res.status(400).json({ error: "Missing request body" });
        try {
            await sock.addOrEditQuickReply(quickReply);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Remove quick reply
    app.delete("/api/quick-reply", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { timestamp } = req.body;
        if (!timestamp) return res.status(400).json({ error: "Missing required field: timestamp" });
        try {
            await sock.removeQuickReply(timestamp);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== LINKED DEVICES ====================

    // Request pairing code for companion device
    app.post("/api/pairing-code", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { phoneNumber } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: "Missing required field: phoneNumber" });
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            res.json({ pairingCode: code });
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // Check if number is on WhatsApp
    app.post("/api/on-whatsapp", express.json(), async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const { numbers } = req.body;
        if (!numbers || !Array.isArray(numbers)) return res.status(400).json({ error: "Missing required field: numbers[]" });
        try {
            const results = await sock.onWhatsApp(...numbers);
            res.json(results || []);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== LINK PREVIEW ====================

    // Get link preview info
    app.get("/api/link-preview", async (req, res) => {
        if (!sock) return res.status(500).json({ error: "Socket not initialized" });
        const url = req.query.url as string;
        if (!url) return res.status(400).json({ error: "Missing query param: url" });
        try {
            const info = await getUrlInfo(url, { thumbnailWidth: 300, fetchOpts: { timeout: 5000 } });
            res.json(info);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ==================== EXPORT CHAT ====================

    // Export chat messages as text
    app.get("/api/export-chat/:jid", (req, res) => {
        const { jid } = req.params;
        const limit = parseInt(req.query.limit as string) || 500;
        const msgs = store.messages[jid]?.all() || [];
        const sorted = [...msgs]
            .sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
            .slice(-limit);

        const contact = store.contacts[jid];
        const chatName = contact?.name || contact?.notify || getPhoneNumber(jid);

        let output = `${chatName}\n`;
        output += `${'='.repeat(40)}\n\n`;

        for (const msg of sorted) {
            const ts = msg.messageTimestamp
                ? new Date((msg.messageTimestamp as number) * 1000).toLocaleString('pt-BR')
                : '?';
            const sender = msg.key.fromMe ? 'Você' : (msg.pushName || getPhoneNumber(msg.key.participant || jid));
            const text = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || msg.message?.imageMessage?.caption
                || msg.message?.videoMessage?.caption
                || '[mídia]';
            output += `[${ts}] ${sender}: ${text}\n`;
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="chat-${getPhoneNumber(jid)}.txt"`);
        res.send(output);
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
        
        // Send current LID mappings
        if (lidToPhoneMap.size > 0) {
            socket.emit("lid-mappings", cachedLidMappings);
        }
        
        socket.on("get-chats", async () => {
            // Ordenar diretamente pelo conversationTimestamp (já atualizado em tempo real)
            let existingChats = store.chats.all().filter((c: any) => c &&
                isValidChatJid(c.id) && c.archived !== true
            );
            
            // Deduplicate chats: prefer @s.whatsapp.net over @lid for same phone number
            const seenPhones = new Set<string>();
            existingChats = existingChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            
            existingChats = sortChatsByRecent(existingChats);
            
            if (existingChats.length > 0) {
                // Use the optimized function that checks contacts, groups, and uses avatar cache
                const resolvedChats = await Promise.all(existingChats.map(getChatWithAvatarFromStore));
                emitChatsListDiff(socket, resolvedChats, true);
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
                emitChatsListDiff(socket, [], false);
            }
        });

        socket.on("get-messages", async (jid) => {
            let allMsgs: any[] = [];
            const seen = new Set<string>();
            
            console.log(`[GET-MESSAGES] Looking for messages for ${jid}`);
            console.log(`[GET-MESSAGES] Store messages keys:`, Object.keys(store.messages).filter(k => k.includes(jid.split('@')[0])));
            
            // Normalize LID to phone JID if needed (in case frontend still sends LID)
            let actualJid = jid;
            if (jid.endsWith('@lid')) {
                const lidPart = jid.replace('@lid', '');
                let pnUser = lidToPhoneMap.get(lidPart);
                if (!pnUser && (jid as any).remoteJidAlt) {
                    const altJid = (jid as any).remoteJidAlt;
                    if (altJid.endsWith('@s.whatsapp.net')) {
                        pnUser = altJid.split('@')[0];
                    }
                }
                if (pnUser) {
                    actualJid = `${pnUser}@s.whatsapp.net`;
                }
            }
            
            // 1. Busca JID direto
            for (const msg of (store.messages[actualJid]?.all() || [])) {
                if (msg.key?.id && !seen.has(msg.key.id)) {
                    seen.add(msg.key.id);
                    allMsgs.push(msg);
                }
            }
            
            // 2. Para individuais, verifica variantes de device e LID usando índice otimizado
            if (actualJid.endsWith('@s.whatsapp.net') && !actualJid.includes(':')) {
                const baseJid = actualJid.replace('@s.whatsapp.net', '');
                
                // Busca variantes de device usando o índice O(1) em vez de O(n)
                const deviceJids = getMessageJidsForPhone(actualJid);
                for (const key of deviceJids) {
                    for (const msg of (store.messages[key]?.all() || [])) {
                        if (msg.key?.id && !seen.has(msg.key.id)) {
                            seen.add(msg.key.id);
                            allMsgs.push(msg);
                        }
                    }
                }
                
                // Busca pelo LID
                const lid = phoneToLidMap.get(baseJid);
                if (lid) {
                    const lidJid = `${lid}@lid`;
                    for (const msg of (store.messages[lidJid]?.all() || [])) {
                        if (msg.key?.id && !seen.has(msg.key.id)) {
                            seen.add(msg.key.id);
                            allMsgs.push(msg);
                        }
                    }
                }
            }
            
            console.log(`[GET-MESSAGES] Found ${allMsgs.length} messages in store for ${jid}`);

            // 3. Se temos menos de 100 msgs, tenta buscar mais do servidor
            const MAX_ATTEMPTS = 5;
            const BATCH_SIZE = 50;

            if (allMsgs.length < 100 && sock) {
                // Encontra a msg mais antiga para usar como cursor
                allMsgs.sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

                let oldestTimestamp = allMsgs.length > 0
                    ? allMsgs[0].messageTimestamp
                    : Math.floor(Date.now() / 1000);

                console.log(`[GET-MESSAGES] Attempting to fetch more messages, oldest: ${oldestTimestamp}`);

                for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    try {
                        const key = {
                            remoteJid: jid,
                            fromMe: false,
                            id: ''
                        };

                        const fetched = await sock.fetchMessageHistory(BATCH_SIZE, key, oldestTimestamp);

                        if (!fetched || fetched.length === 0) {
                            console.log(`[GET-MESSAGES] No more messages to fetch`);
                            break;
                        }

                        console.log(`[GET-MESSAGES] Fetched ${fetched.length} messages on attempt ${attempt + 1}`);

                        let newMessagesCount = 0;
                        let newOldestTimestamp = oldestTimestamp;

                        for (let i = 0; i < fetched.length; i++) {
                            const msg = fetched[i];

                            // Debug nas primeiras msgs
                            if (attempt === 0 && i < 3) {
                                console.log(`[GET-MESSAGES] Raw msg[${i}]:`, JSON.stringify(msg).slice(0, 200));
                            }

                            // Aceita qualquer msg que tenha dados minimamente úteis
                            if (!msg) continue;

                            // Usa uma estratégia mais flexível para identificar msgs
                            const msgId = msg.key?.id || msg.messageID || msg.id;
                            const msgTimestamp = msg.messageTimestamp || msg.timestamp;

                            if (!msgId) continue;

                            // Atualiza o cursor para a msg mais antiga
                            if (msgTimestamp && msgTimestamp < newOldestTimestamp) {
                                newOldestTimestamp = msgTimestamp;
                            }

                            // Cria um objeto de msg padronizado
                            const standardizedMsg = {
                                key: {
                                    remoteJid: msg.key?.remoteJid || jid,
                                    fromMe: msg.key?.fromMe || msg.fromMe || false,
                                    id: msgId,
                                    participant: msg.key?.participant || msg.participant
                                },
                                message: msg.message || msg.data || {},
                                messageTimestamp: msgTimestamp,
                                pushName: msg.pushName || msg.push_name
                            };

                            // SEMPRE adiciona ao resultado
                            const seenKey = msgId.toString();
                            if (!seen.has(seenKey)) {
                                seen.add(seenKey);
                                allMsgs.push(standardizedMsg);
                                newMessagesCount++;
                            }

                            // Armazena no store
                            if (!store.messages[jid]) {
                                const map = new Map();
                                store.messages[jid] = {
                                    all: () => Array.from(map.values()),
                                    map
                                };
                            }
                            const msgMap = store.messages[jid].map;
                            if (msgMap && !msgMap.has(msgId)) {
                                msgMap.set(msgId, standardizedMsg);

                                // Update chat timestamp when new messages are added
                                const chat = store.chats.get(jid);
                                if (chat && msgTimestamp) {
                                    if (!chat.conversationTimestamp || msgTimestamp > chat.conversationTimestamp) {
                                        chat.conversationTimestamp = msgTimestamp;
                                        store.chats.set(jid, chat);
                                    }
                                }
                                // Also update LID variant if exists
                                if (jid.endsWith('@s.whatsapp.net') && !jid.includes(':')) {
                                    const baseJid = jid.replace('@s.whatsapp.net', '');
                                    const lid = phoneToLidMap.get(baseJid);
                                    if (lid) {
                                        const lidChat = store.chats.get(`${lid}@lid`);
                                        if (lidChat && (!lidChat.conversationTimestamp || msgTimestamp > lidChat.conversationTimestamp)) {
                                            lidChat.conversationTimestamp = msgTimestamp;
                                            store.chats.set(`${lid}@lid`, lidChat);
                                        }
                                    }
                                }
                                // Also update @s.whatsapp.net variant if this is @lid
                                if (jid.endsWith('@lid')) {
                                    const lidPart = jid.replace('@lid', '');
                                    const pnUser = lidToPhoneMap.get(lidPart);
                                    if (pnUser) {
                                        const pnChat = store.chats.get(`${pnUser}@s.whatsapp.net`);
                                        if (pnChat && (!pnChat.conversationTimestamp || msgTimestamp > pnChat.conversationTimestamp)) {
                                            pnChat.conversationTimestamp = msgTimestamp;
                                            store.chats.set(`${pnUser}@s.whatsapp.net`, pnChat);
                                        }
                                    }
                                }
                            }
                        }

                        // Atualiza o cursor para a próxima iteração
                        oldestTimestamp = newOldestTimestamp;

                        console.log(`[GET-MESSAGES] Added ${newMessagesCount} messages, new oldest: ${oldestTimestamp}`);

                        // Se não encontrou msgs novas, continua tentando com timestamp mais antigo
                        if (newMessagesCount === 0) {
                            oldestTimestamp = oldestTimestamp - 86400; // 24h menos
                            console.log(`[GET-MESSAGES] No new messages, trying older timestamp...`);
                            continue;
                        }

                    } catch (e) {
                        console.log(`[GET-MESSAGES] Error fetching more:`, e);
                        break;
                    }
                }
            }

            // 4. Resync final para garantir
            if (sock) {
                try {
                    await sock.resyncAppState(['regular'], false);
                } catch (e) {
                    console.log(`[GET-MESSAGES] Resync error:`, e);
                }
            }

            // 5. Ordena e emite
            allMsgs.sort((a: any, b: any) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
            
            // Emit updated chats-list so the chat moves to correct position based on latest message
            const allChats = store.chats.all().filter((c: any) => c && !c.archived);
            
            // Deduplicate chats: prefer @s.whatsapp.net over @lid for same phone number
            const seenPhones = new Set<string>();
            const dedupedChats = allChats.filter(chat => {
                if (chat.id.endsWith('@lid')) {
                    const lidPart = chat.id.replace('@lid', '');
                    const pn = lidToPhoneMap.get(lidPart);
                    if (pn && seenPhones.has(pn)) return false;
                    if (pn) seenPhones.add(pn);
                } else if (chat.id.endsWith('@s.whatsapp.net') && !chat.id.includes(':')) {
                    const phone = chat.id.replace('@s.whatsapp.net', '');
                    if (seenPhones.has(phone)) return false;
                    seenPhones.add(phone);
                }
                return true;
            });
            
            dedupedChats.sort((a: any, b: any) => (b.conversationTimestamp || 0) - (a.conversationTimestamp || 0));
            emitChatsListDiff(socket, dedupedChats, true);

            console.log(`[GET-MESSAGES] Emitting ${allMsgs.length} messages for ${jid}`);
            socket.emit("messages-list", { jid, messages: allMsgs, totalCount: allMsgs.length });
        });

        // Get chat details including avatar
        socket.on("get-chat-details", async (jid) => {
            try {
                let displayName = getPhoneNumber(jid);
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
                socket.emit("chat-details", { jid, displayName: getPhoneNumber(jid), avatar: null });
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
