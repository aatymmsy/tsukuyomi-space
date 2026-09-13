/**
 * Time and recent-diary context injection.
 *
 * The character must know the real date/time and remember what it recently
 * wrote, so both are built into the per-turn prompt context.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const source = (p) => fs.readFileSync(path.join(rootDir, p), 'utf8');
const chatSrc = () => source('src/frontend/composables/room/useRoomChat.js');

function loadContextHelpers(archive) {
    const code = chatSrc();
    const start = code.indexOf('const RECENT_DIARY_LIMIT');
    const end = code.indexOf('async function buildRoomContext');
    assert.ok(start > 0 && end > start, 'context helpers must be locatable');

    const helpers = code.slice(start, end).replace(/^export function /gm, 'function ');
    const ctx = {
        String, Array, Object, JSON, Number, Math, Boolean, Date, RegExp,
        readDiaryArchive: () => archive
    };
    vm.runInNewContext(
        `${helpers}\nglobalThis.__c = { currentTimeContext, recentDiaryContext, RECENT_DIARY_LIMIT, RECENT_DIARY_ENTRY_CHARS, RECENT_DIARY_TOTAL_CHARS };`,
        ctx,
        { filename: 'roomContextHelpers.js' }
    );
    return ctx.__c;
}

function diaryArchive(count, { bodyChars = 40 } = {}) {
    return {
        slotId: 1,
        data: {
            gameData: { characterStats: { affection: 100, trust: 50 } },
            diary: Array.from({ length: count }, (_, i) => ({
                diaryId: `d${i}`,
                timestamp: 1700000000000 + i * 86400000,
                date: `2026/9/${i + 1}`,
                time: `${String(9 + (i % 12)).padStart(2, '0')}:00:00`,
                affection: 100 + i,
                content: `【日记】\n\n第 ${i + 1} 篇：${'内容'.repeat(bodyChars / 2)}\n\n【日记书写时间为2026年9月${i + 1}日】`
            })),
            settings: {},
            prompts: {},
            other: {}
        }
    };
}

describe('current time context', () => {
    it('states the full date, weekday and time of day', () => {
        const c = loadContextHelpers(diaryArchive(0));
        // 2026-09-12 is a Saturday.
        const text = c.currentTimeContext(new Date(2026, 8, 12, 14, 5, 0));

        assert.match(text, /【当前时间】/);
        assert.match(text, /2026年9月12日/);
        assert.match(text, /星期六/);
        assert.match(text, /14:05/);
        assert.match(text, /下午/);
        assert.match(text, /以它为准/);
    });

    it('labels each part of the day correctly', () => {
        const c = loadContextHelpers(diaryArchive(0));
        const phaseAt = (hour) => {
            const text = c.currentTimeContext(new Date(2026, 8, 12, hour, 0, 0));
            return text.match(/（(.+?)）/)[1];
        };
        assert.equal(phaseAt(2), '凌晨');
        assert.equal(phaseAt(6), '清晨');
        assert.equal(phaseAt(9), '上午');
        assert.equal(phaseAt(12), '中午');
        assert.equal(phaseAt(15), '下午');
        assert.equal(phaseAt(18), '傍晚');
        assert.equal(phaseAt(21), '晚上');
        assert.equal(phaseAt(23), '深夜');
    });

    it('pads single-digit minutes and handles an invalid date', () => {
        const c = loadContextHelpers(diaryArchive(0));
        assert.match(c.currentTimeContext(new Date(2026, 0, 3, 7, 4, 0)), /07:04/);
        assert.match(c.currentTimeContext(new Date('nonsense')), /年/);
        assert.match(c.currentTimeContext(undefined), /年/);
    });
});

describe('recent diary context', () => {
    it('feeds the last ten entries, newest last', () => {
        const c = loadContextHelpers(diaryArchive(25));
        const text = c.recentDiaryContext();

        assert.match(text, /【你最近写过的日记】/);
        // Entries 16..25 are the most recent ten.
        assert.doesNotMatch(text, /第 15 篇/);
        assert.match(text, /第 16 篇/);
        assert.match(text, /第 25 篇/);

        const first = text.indexOf('第 16 篇');
        const last = text.indexOf('第 25 篇');
        assert.ok(first > -1 && last > first, 'entries must be in chronological order');

        const count = (text.match(/第 \d+ 篇/g) || []).length;
        assert.equal(count, c.RECENT_DIARY_LIMIT);
    });

    it('strips the 【日记】 wrapper and the timestamp footer to save tokens', () => {
        const c = loadContextHelpers(diaryArchive(3));
        const text = c.recentDiaryContext();

        assert.doesNotMatch(text, /【日记书写时间为/);
        assert.doesNotMatch(text, /【日记】\n/);
        assert.match(text, /第 1 篇/);
    });

    it('includes each entry date so the model can place events in time', () => {
        const c = loadContextHelpers(diaryArchive(3));
        const text = c.recentDiaryContext();
        assert.match(text, /2026\/9\/3/);
    });

    it('returns nothing when there are no diaries', () => {
        for (const empty of [diaryArchive(0), { data: {} }, {}, null, undefined]) {
            const c = loadContextHelpers(empty);
            assert.equal(c.recentDiaryContext(), '');
        }
    });

    it('caps a single long entry', () => {
        const c = loadContextHelpers(diaryArchive(1, { bodyChars: 5000 }));
        const text = c.recentDiaryContext();
        // Blocks are "date time\nbody", separated by a blank line.
        const block = text.split('\n\n').pop();
        const body = block.split('\n').slice(1).join('\n');
        assert.ok(body.length <= c.RECENT_DIARY_ENTRY_CHARS + 2, 'entry must be truncated, got ' + body.length);
        assert.match(body, /…$/);
    });

    it('caps the total size so the prompt cannot blow up', () => {
        const c = loadContextHelpers(diaryArchive(0));
        const big = loadContextHelpers(diaryArchive(10, { bodyChars: c.RECENT_DIARY_ENTRY_CHARS }));
        const text = big.recentDiaryContext();
        // Header plus the bounded blocks stays within the documented budget.
        assert.ok(text.length <= big.RECENT_DIARY_TOTAL_CHARS + 400, 'total must stay bounded, got ' + text.length);
    });

    it('honours an explicit limit', () => {
        const c = loadContextHelpers(diaryArchive(20));
        const text = c.recentDiaryContext(undefined, { limit: 3 });
        assert.equal((text.match(/第 \d+ 篇/g) || []).length, 3);
        assert.match(text, /第 20 篇/);
    });
});

describe('context wiring', () => {
    it('injects both time and recent diaries into the room context', () => {
        const code = chatSrc();
        const start = code.indexOf('async function buildRoomContext');
        const body = code.slice(start, start + 700);

        assert.match(body, /const context = \[[\s\S]*?currentTimeContext\(\),[\s\S]*?recentDiaryContext\(\),[\s\S]*?readKnowledgeContext\(message\)/);
        assert.match(code, /export function currentTimeContext\(now = new Date\(\)\)/);
        assert.match(code, /export function recentDiaryContext\(archive = readDiaryArchive\(\)/);
        assert.match(code, /const RECENT_DIARY_LIMIT = 10;/);
    });

    it('only asks the model not to recite diaries when it was not asked', () => {
        const c = loadContextHelpers(diaryArchive(2));
        assert.match(c.recentDiaryContext(), /除非对方问起，不要整段复述/);
    });
});
