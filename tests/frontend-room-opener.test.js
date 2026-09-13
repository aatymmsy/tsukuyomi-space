/**
 * "我先说" opener and the DeepSeek V4.1 Flash model id.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const source = (p) => fs.readFileSync(path.join(rootDir, p), 'utf8');
const chatSrc = () => source('src/frontend/composables/room/useRoomChat.js');
const panelSrc = () => source('src/frontend/components/room/RoomChatPanel.vue');

describe('DeepSeek V4.1 Flash', () => {
    it('uses the documented model id for V4.1 Flash', () => {
        const settings = source('src/frontend/pages/RoomSettingsPage.vue');
        // Per the DeepSeek changelog the V4.1 Flash model is called `deepseek-flash`.
        assert.match(settings, /deepseek: \{ label: 'DeepSeek', apiUrl: 'https:\/\/api\.deepseek\.com\/chat\/completions', model: 'deepseek-flash' \}/);
        assert.doesNotMatch(settings, /model: 'deepseek-v4-flash'/);
    });

    it('recommends current DeepSeek models', () => {
        const settings = source('src/frontend/pages/RoomSettingsPage.vue');
        assert.match(settings, /deepseek: \['deepseek-flash', 'deepseek-v4-pro'/);
    });

    it('keeps the chat-completions endpoint the changelog says is unchanged', () => {
        const settings = source('src/frontend/pages/RoomSettingsPage.vue');
        assert.match(settings, /apiUrl: 'https:\/\/api\.deepseek\.com\/chat\/completions'/);
        // The backend must still allow that host and path.
        const llm = source('backend/services/llm.js');
        assert.match(llm, /hostname: 'api\.deepseek\.com', path: \/\^\\\/\(\?:v1\\\/\)\?chat\\\/completions\\\/\?\$\//);
    });
});

describe('room chat opener', () => {
    it('exposes startConversation from the composable', () => {
        assert.match(chatSrc(), /async function startConversation\(\)/);
        assert.match(chatSrc(), /^\s*startConversation,$/m);
    });

    it('only runs before anything has been said, and never while busy', () => {
        const code = chatSrc();
        const body = code.slice(code.indexOf('async function startConversation()'));
        assert.match(body.slice(0, 400), /if \(sending\.value\) return null;/);
        assert.match(body.slice(0, 400), /if \(sessionTurnCount\(\) > 0\) return null;/);
    });

    it('never stores the instruction as a user message', () => {
        const code = chatSrc();
        const start = code.indexOf('async function startConversation()');
        const body = code.slice(start, code.indexOf('async function remember('));

        // No user bubble is added and no memory turn is written.
        assert.doesNotMatch(body, /addMessage\('user'/);
        assert.doesNotMatch(body, /saveRoomConversationTurn/);
        assert.doesNotMatch(body, /remember\(/);
        // Only the character's own line is kept.
        assert.match(body, /addMessage\('assistant', reply/);
        assert.match(body, /writeRoomConversation\(\[\.\.\.readRoomConversation\(\), \{ role: 'assistant', content: reply \}\]\)/);
    });

    it('tells the model to open the conversation without repeating the instruction', () => {
        const body = chatSrc().slice(chatSrc().indexOf('async function startConversation()'));
        assert.match(body, /现在由你先开口/);
        assert.match(body, /不要复述或提及这条指令本身/);
    });

    it('shares one request path with send() instead of duplicating it', () => {
        const code = chatSrc();
        assert.match(code, /async function requestRoomReply\(\{ message, image = null, settings \}\)/);
        // send() must go through the shared helper too.
        const sendBody = code.slice(code.indexOf('async function send()'), code.indexOf('async function startConversation()'));
        assert.match(sendBody, /await requestRoomReply\(\{ message, image, settings \}\)/);
        // The old inline request block must be gone from send().
        assert.doesNotMatch(sendBody, /fetchWithLocalOllamaGuidance\(apiUrl/);
    });

    it('reports a failure instead of leaving a pending bubble behind', () => {
        const body = chatSrc().slice(chatSrc().indexOf('async function startConversation()'));
        assert.match(body, /开场失败：/);
        assert.match(body, /messages\.value = messages\.value\.filter\(\(item\) => item\.id !== typingId\)/);
    });
});

describe('opener button', () => {
    it('is rendered left of the input and only before the first turn', () => {
        const panel = panelSrc();
        assert.match(panel, /id="startChatBtn"/);
        assert.match(panel, /v-if="!sessionTurns"/);
        assert.match(panel, /title="我先说"/);
        assert.match(panel, /aria-label="我先说"/);
        assert.match(panel, /@click="chat\.startConversation\(\)"/);

        // It must sit between the file input and the attach button.
        const row = panel.slice(panel.indexOf('class="chat-input-row"'));
        const order = ['chatImageInput', 'startChatBtn', 'attachImageBtn', 'chatInput', 'sendChatBtn']
            .map((id) => row.indexOf(id));
        assert.ok(order.every((i) => i > -1), 'all row controls must exist');
        for (let i = 1; i < order.length; i += 1) {
            assert.ok(order[i] > order[i - 1], 'controls must be in order: ' + order.join(','));
        }
    });

    it('keeps a tappable size and cannot be squeezed by flex', () => {
        const css = source('assets/css/vue/pages/room.css');
        const block = css.slice(css.indexOf('.chat-opener-btn {'), css.indexOf('.chat-opener-btn {') + 420);
        assert.match(block, /flex: 0 0 auto;/);
        assert.match(block, /min-width: 64px;/);
        // The row is flex so hiding the opener leaves no empty column.
        const rowBlock = css.slice(css.indexOf('.chat-input-row {'), css.indexOf('.chat-input-row {') + 200);
        assert.match(rowBlock, /display: flex;/);
        assert.doesNotMatch(rowBlock, /grid-template-columns/);
    });

    it('collapses to an icon-only button on phones', () => {
        const responsive = source('src/frontend/styles/responsive.css');
        const idx = responsive.indexOf('.room-shell .room-chat-panel .chat-opener-btn');
        assert.ok(idx > -1, 'mobile opener rule must exist');
        const block = responsive.slice(idx, idx + 400);
        assert.match(block, /width: 2\.55rem;/);
        assert.match(block, /clip: rect\(0, 0, 0, 0\)/);
    });
});
