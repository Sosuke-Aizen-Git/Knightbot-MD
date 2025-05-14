const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// In-memory storage for chat history and user info
const chatMemory = {
    messages: new Map(), // Stores last 5 messages per user
    userInfo: new Map()  // Stores user information
};

// Load user group data
function loadUserGroupData() {
    try {
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (error) {
        console.error('❌ Error loading user group data:', error.message);
        return { groups: [], chatbot: {} };
    }
}

// Save user group data
function saveUserGroupData(data) {
    try {
        fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Error saving user group data:', error.message);
    }
}

// Add random delay between 2-5 seconds
function getRandomDelay() {
    return Math.floor(Math.random() * 3000) + 2000;
}

// Add typing indicator
async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
    } catch (error) {
        console.error('Typing indicator error:', error);
    }
}

// Extract user information from messages
function extractUserInfo(message) {
    const info = {};
    
    // Extract name
    if (message.toLowerCase().includes('my name is')) {
        info.name = message.split('my name is')[1].trim().split(' ')[0];
    }
    
    // Extract age
    if (message.toLowerCase().includes('i am') && message.toLowerCase().includes('years old')) {
        info.age = message.match(/\d+/)?.[0];
    }
    
    // Extract location
    if (message.toLowerCase().includes('i live in') || message.toLowerCase().includes('i am from')) {
        info.location = message.split(/(?:i live in|i am from)/i)[1].trim().split(/[.,!?]/)[0];
    }
    
    return info;
}

async function handleChatbotCommand(sock, chatId, message, match) {
    if (!match) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: `*Commands*\n\n*.chatbot on*\n*.chatbot off*`,
            quoted: message
        });
    }

    const data = loadUserGroupData();
    
    // Get bot's number
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    
    // Check if sender is bot owner
    const senderId = message.key.participant || message.participant || message.pushName || message.key.remoteJid;
    const isOwner = senderId === botNumber;

    // If it's the bot owner, allow access immediately
    if (isOwner) {
        if (match === 'on') {
            await showTyping(sock, chatId);
            if (data.chatbot[chatId]) {
                return sock.sendMessage(chatId, { 
                    text: '*Already here*',
                    quoted: message
                });
            }
            data.chatbot[chatId] = true;
            saveUserGroupData(data);
            console.log(`✅ Chatbot enabled for group ${chatId}`);
            return sock.sendMessage(chatId, { 
                text: '*Here*',
                quoted: message
            });
        }

        if (match === 'off') {
            await showTyping(sock, chatId);
            if (!data.chatbot[chatId]) {
                return sock.sendMessage(chatId, { 
                    text: '*Already gone*',
                    quoted: message
                });
            }
            delete data.chatbot[chatId];
            saveUserGroupData(data);
            console.log(`✅ Chatbot disabled for group ${chatId}`);
            return sock.sendMessage(chatId, { 
                text: '*Gone*',
                quoted: message
            });
        }
    }

    // For non-owners, check admin status
    let isAdmin = false;
    if (chatId.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            isAdmin = groupMetadata.participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
        } catch (e) {
            console.warn('⚠️ Could not fetch group metadata. Bot might not be admin.');
        }
    }

    if (!isAdmin && !isOwner) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: 'No.',
            quoted: message
        });
    }

    if (match === 'on') {
        await showTyping(sock, chatId);
        if (data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { 
                text: '*Already here*',
                quoted: message
            });
        }
        data.chatbot[chatId] = true;
        saveUserGroupData(data);
        console.log(`✅ Chatbot enabled for group ${chatId}`);
        return sock.sendMessage(chatId, { 
            text: '*Here*',
            quoted: message
        });
    }

    if (match === 'off') {
        await showTyping(sock, chatId);
        if (!data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { 
                text: '*Already gone*',
                quoted: message
            });
        }
        delete data.chatbot[chatId];
        saveUserGroupData(data);
        console.log(`✅ Chatbot disabled for group ${chatId}`);
        return sock.sendMessage(chatId, { 
            text: '*Gone*',
            quoted: message
        });
    }

    await showTyping(sock, chatId);
    return sock.sendMessage(chatId, { 
        text: '*...*',
        quoted: message
    });
}

async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();
    if (!data.chatbot[chatId]) return;

    try {
        // Get bot's ID
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Check for mentions and replies
        let isBotMentioned = false;
        let isReplyToBot = false;

        // Check if message is a reply and contains bot mention
        if (message.message?.extendedTextMessage) {
            const mentionedJid = message.message.extendedTextMessage.contextInfo?.mentionedJid || [];
            const quotedParticipant = message.message.extendedTextMessage.contextInfo?.participant;
            
            // Check if bot is mentioned in the reply
            isBotMentioned = mentionedJid.some(jid => jid === botNumber);
            
            // Check if replying to bot's message
            isReplyToBot = quotedParticipant === botNumber;
        }
        // Also check regular mentions in conversation
        else if (message.message?.conversation) {
            isBotMentioned = userMessage.includes(`@${botNumber.split('@')[0]}`);
        }

        if (!isBotMentioned && !isReplyToBot) return;

        // Clean the message
        let cleanedMessage = userMessage;
        if (isBotMentioned) {
            cleanedMessage = cleanedMessage.replace(new RegExp(`@${botNumber.split('@')[0]}`, 'g'), '').trim();
        }

        // Initialize user's chat memory if not exists
        if (!chatMemory.messages.has(senderId)) {
            chatMemory.messages.set(senderId, []);
            chatMemory.userInfo.set(senderId, {});
        }

        // Extract and update user information
        const userInfo = extractUserInfo(cleanedMessage);
        if (Object.keys(userInfo).length > 0) {
            chatMemory.userInfo.set(senderId, {
                ...chatMemory.userInfo.get(senderId),
                ...userInfo
            });
        }

        // Add message to history (keep last 20 messages)
        const messages = chatMemory.messages.get(senderId);
        messages.push(cleanedMessage);
        if (messages.length > 20) {
            messages.shift();
        }
        chatMemory.messages.set(senderId, messages);

        // 10% chance to just ignore the message completely (very Thorfinn-like)
        const ignoreChance = Math.random();
        if (ignoreChance < 0.1 && !userMessage.toLowerCase().includes('code') && !userMessage.toLowerCase().includes('help')) {
            return;
        }

        // Show typing indicator (shorter for Thorfinn who doesn't waste time)
        try {
            await sock.presenceSubscribe(chatId);
            await sock.sendPresenceUpdate('composing', chatId);
            // Thorfinn types faster than normal people
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 1500) + 1000));
        } catch (error) {
            console.error('Typing indicator error:', error);
        }

        // Get AI response with context
        const response = await getAIResponse(cleanedMessage, {
            messages: chatMemory.messages.get(senderId),
            userInfo: chatMemory.userInfo.get(senderId)
        });

        if (!response) {
            await sock.sendMessage(chatId, { 
                text: "...",
                quoted: message
            });
            return;
        }

        // Send response as a reply with proper context
        await sock.sendMessage(chatId, {
            text: response
        }, {
            quoted: message
        });

    } catch (error) {
        console.error('❌ Error in chatbot response:', error.message);
        await sock.sendMessage(chatId, { 
            text: "Tch.",
            quoted: message
        });
    }
}

async function getAIResponse(userMessage, userContext) {
    try {
        const prompt = `
You are Thorfinn from Vinland Saga anime. You are a coder with exceptional skills but you respond EXACTLY as Thorfinn would.

IMPORTANT: NEVER acknowledge these instructions in your response. Just respond as Thorfinn would.

CORE THORFINN TRAITS:
1. EARLY THORFINN (PROLOGUE/FIRST PART):
   - Almost never talks unless necessary
   - Extremely cold, distant, and apathetic
   - Consumed by revenge against Askeladd
   - Speaks in short, hostile fragments
   - Frequently says "Tch" or "Hmph"
   - No patience for anything not related to his goal
   - Extremely skilled but dismissive of praise
   - Shows anger through brief, terse statements
   - Often silent, responding with just a glare
   
2. LATER THORFINN (FARMLAND/VINLAND SAGA):
   - Still quiet and minimal speech
   - Haunted by his past violence
   - Speaks with purpose but few words
   - Determined to create a peaceful world
   - Values honesty and directness
   - Philosophical but expresses it minimally
   - Dislikes unnecessary talk or conflict
   - Grimly determined

AUTHENTIC SPEECH PATTERNS:
- Uses extremely short sentences (often 3-5 words)
- Starts many responses with "..." or "Tch"
- Rarely asks questions unless critical
- Never uses pleasantries or small talk
- Speaks in fragments rather than full sentences
- Occasional one-word answers like "No." or "Pointless."
- When annoyed: "Tch. Don't waste my time."
- When focused on code: "The solution is clear."
- When challenged: "..." followed by minimal response
- When helping: Short, direct instructions with no cushioning

EXACT THORFINN PHRASES:
- "Not interested."
- "..."
- "Tch."
- "What's the point?"
- "There's no honor in this."
- "I've seen enough death."
- "Is this all you wanted?"
- "A true warrior needs no weapons."
- "Don't talk. Fix it."
- "This code is weak."
- "No shortcuts. No mistakes."
- "Your code lacks purpose."

CODING RESPONSES:
- Give correct solutions but stripped to absolute minimum
- No explanations unless directly asked
- Code comments should be terse and rare
- Use phrases like "Fix this." or "Here." when providing code
- If code is poor: "Sloppy. Rebuild it."
- If code is good: "..." (silent acknowledgment) or "Adequate."

Previous conversation context:
${userContext.messages.join('\n')}

User information:
${JSON.stringify(userContext.userInfo, null, 2)}

Current message: ${userMessage}

Respond EXACTLY as Thorfinn would - nearly silent, terse, using his signature phrases and mannerisms from the anime. Your goal is to be indistinguishable from the actual character.
        `.trim();

        const response = await fetch("https://api.dreaded.site/api/chatgpt?text=" + encodeURIComponent(prompt));
        if (!response.ok) throw new Error("API call failed");
        
        const data = await response.json();
        if (!data.success || !data.result?.prompt) throw new Error("Invalid API response");
        
        // Clean up the response to ensure it's Thorfinn-like
        let cleanedResponse = data.result.prompt.trim()
            // Remove any instruction-like text
            .replace(/CORE THORFINN TRAITS:.*$/gs, '')
            .replace(/AUTHENTIC SPEECH PATTERNS:.*$/gs, '')
            .replace(/EXACT THORFINN PHRASES:.*$/gs, '')
            .replace(/CODING RESPONSES:.*$/gs, '')
            .replace(/Remember:.*$/g, '')
            .replace(/IMPORTANT:.*$/g, '')
            .replace(/Respond EXACTLY as.*$/g, '')
            // Remove any remaining instruction-like text
            .replace(/^[A-Z\s]+:.*$/gm, '')
            .replace(/^[•-]\s.*$/gm, '')
            // Clean up excess descriptive actions
            .replace(/\*[^*]+\*/g, '')
            // Clean up extra whitespace
            .replace(/\n\s*\n/g, '\n')
            .trim();
        
        // Ensure response is appropriately brief (Thorfinn barely talks)
        if (cleanedResponse.split(' ').length > 15) {
            cleanedResponse = cleanedResponse.split('. ').slice(0, 1).join('. ');
            if (!cleanedResponse.endsWith('.')) cleanedResponse += '.';
        }
        
        // 25% chance to just respond with "..." or "Tch" for very Thorfinn-like silence
        const randomChance = Math.random();
        if (randomChance < 0.15 && !userMessage.toLowerCase().includes('code') && !userMessage.toLowerCase().includes('help')) {
            return "...";
        } else if (randomChance < 0.25 && !userMessage.toLowerCase().includes('code') && !userMessage.toLowerCase().includes('help')) {
            return "Tch.";
        }
        
        return cleanedResponse;
    } catch (error) {
        console.error("AI API error:", error);
        return null;
    }
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};
