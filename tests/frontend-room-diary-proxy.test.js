/**
 * Diary generation over the restricted backend bridge.
 *
 * When a provider refuses browser connections (CORS) the user must enable the
 * proxy; diary generation has to follow the same path instead of refusing.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const source = (p) => fs.readFileSync(path.join(rootDir, p), 'utf8');
const strip = (code) => code
    .replace(/^import [\s\S]*?from '[^']*';$/gm, '')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export async function /gm, 'async function ')
    .replace(/^export \{[\s\S]*?\};?$/gm, '');

const GOOD_DIARY = '今天把窗台那盆薄荷搬到了有光的地方，叶子朝着太阳转过去了。';
const TURNS = [
    { role: 'user', content: '今天好累' },
    { role: 'assistant', content: '那先坐下吧' }
];

function load({ useProxy, authResponse, directResponse }) {
    const store = new Map();
    store.set('roomLLMSettings', JSON.stringify({
        apiUrl: 'https://api.deepseek.com/chat/completions',
        apiKey: 'sk-test',
        model: 'deepseek-flash',
        useProxy
    }));

    const calls = { auth: [], direct: [] };

    const ctx = {
        console, Date, JSON, Number, String, Math, Object, Array, Boolean, URL, Promise, RegExp, Set, Map,
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k)
        },
        window: { location: { origin: 'https://example.test' }, setTimeout: () => 0 },
        getSession: () => null,
        crypto: { randomUUID: () => 'uuid' },
        Blob: function Blob() {},
        // Stubs for the shared API client that the module imports.
        authHeaders: (extra = {}) => ({ ...extra }),
        parseResponse: async (response) => response.json(),
        authFetch: async (url, options) => {
            calls.auth.push({ url, options });
            return authResponse();
        },
        fetch: async (url, options) => {
            calls.direct.push({ url, options });
            return directResponse();
        }
    };

    const code = [
        strip(source('src/frontend/services/room/roomStorage.js')),
        strip(source('src/frontend/services/room/localOllamaTransport.js')),
        strip(source('src/frontend/services/room/roomDiaryArchive.js')),
        strip(source('src/frontend/services/room/roomDiaryGeneration.js')),
        'globalThis.__g = { generateDiaryEntry, diarySettings };'
    ].join('\n');

    vm.runInNewContext(code, ctx, { filename: 'diaryProxy.js' });
    return { api: ctx.__g, calls };
}

function proxyOk(reply = GOOD_DIARY) {
    return () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { reply } }) });
}
function proxyFail(message) {
    return () => ({ ok: false, status: 502, json: async () => ({ success: false, message }) });
}
function directOk(reply = GOOD_DIARY) {
    return () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }] }) });
}

describe('diary generation with the CORS proxy', () => {
    it('relays through /api/chat instead of refusing', async () => {
        const { api, calls } = load({ useProxy: true, authResponse: proxyOk(), directResponse: directOk() });

        const result = await api.generateDiaryEntry(TURNS, {
            persona: { id: 'p', data: { name: 'Aoi', description: '书店店员', personality: '安静', scenario: '', creator_notes: '' } },
            fetchImpl: async () => { throw new Error('direct fetch must not be used in proxy mode'); }
        });

        assert.equal(result.content, GOOD_DIARY);
        assert.equal(calls.auth.length, 1, 'exactly one bridge request');
        assert.equal(calls.auth[0].url, '/api/chat');
        assert.equal(calls.direct.length, 0, 'no direct provider request');

        const body = JSON.parse(calls.auth[0].options.body);
        assert.equal(body.apiUrl, 'https://api.deepseek.com/chat/completions');
        assert.equal(body.model, 'deepseek-flash');
        assert.equal(body.apiKey, 'sk-test');
        assert.deepEqual(body.conversation, [], 'the bridge takes a single message');
        assert.match(body.message, /对话开始/);
        assert.match(body.systemPrompt, /你是「Aoi」/);
    });

    it('still saves the composed diary body', async () => {
        const { api } = load({ useProxy: true, authResponse: proxyOk(), directResponse: directOk() });
        const result = await api.generateDiaryEntry(TURNS, { now: new Date(2026, 8, 12, 21, 0, 0) });
        assert.match(result.body, /^【日记】\n\n/);
        assert.match(result.body, /【日记书写时间为2026年9月12日21点】$/);
        assert.equal(result.conversationLength, 2);
    });

    it('surfaces the bridge error message', async () => {
        const { api } = load({ useProxy: true, authResponse: proxyFail('不支持的 LLM API 端点'), directResponse: directOk() });
        await assert.rejects(
            api.generateDiaryEntry(TURNS),
            /不支持的 LLM API 端点/
        );
    });

    it('rejects an empty bridge reply instead of saving a blank diary', async () => {
        const { api } = load({ useProxy: true, authResponse: proxyOk('   '), directResponse: directOk() });
        await assert.rejects(api.generateDiaryEntry(TURNS), /没有返回内容/);
    });

    it('does not use the bridge when the proxy is off', async () => {
        const { api, calls } = load({ useProxy: false, authResponse: proxyOk(), directResponse: directOk() });

        const result = await api.generateDiaryEntry(TURNS, {
            fetchImpl: async (url, options) => {
                calls.direct.push({ url, options });
                return directOk()();
            }
        });

        assert.equal(result.content, GOOD_DIARY);
        assert.equal(calls.auth.length, 0, 'no bridge request when direct mode is on');
        assert.equal(calls.direct.length, 1);
        assert.equal(calls.direct[0].url, 'https://api.deepseek.com/chat/completions');
    });

    it('no longer ships the "proxy unsupported" refusal', () => {
        const code = source('src/frontend/services/room/roomDiaryGeneration.js');
        assert.doesNotMatch(code, /服务器代理模式暂不支持生成日记/);
        assert.match(code, /async function generateDiaryViaProxy\(/);
        assert.match(code, /authFetch\('\/api\/chat'/);
    });
});
