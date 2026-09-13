/**
 * Verifies the in-room persona picker against the real archive: all persona
 * types are offered and choosing one switches what the room uses.
 */
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const EXECUTABLE = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.REPRO_BASE || 'http://localhost:5199';
// Optional: point at a real exported archive to run this against live data.
// Kept out of the source so no personal paths or file names are committed.
const ARCHIVE = process.env.ROOM_ARCHIVE_PATH || '';

(async () => {
    if (!ARCHIVE || !fs.existsSync(ARCHIVE)) {
        console.log('ROOM_ARCHIVE_PATH not set (or file missing), skipping');
        return;
    }
    const archiveText = fs.readFileSync(ARCHIVE, 'utf8');

    const browser = await chromium.launch({ executablePath: EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.addStyleTag({ url: `${BASE}/styles/routes/room.css` });
    await page.waitForTimeout(400);

    const out = await page.evaluate(async (text) => {
        const steps = [];
        const problems = [];

        localStorage.setItem('roomDiaryArchive:guest', text);

        const vue = await import('/@id/vue');
        const diaryMod = await import('/composables/room/useRoomDiary.js');
        const panelMod = await import('/components/room/RoomDiaryPanel.vue');

        const diary = diaryMod.useRoomDiary();
        steps.push('personas exposed = ' + diary.personas.value.length);
        steps.push('active persona = ' + JSON.stringify(diary.activePersona.value));

        const host = document.createElement('div');
        host.className = 'room-shell';
        host.style.cssText = 'position:absolute;inset:0;';
        document.body.appendChild(host);
        const app = vue.createApp({
            render: () => vue.h(panelMod.default, { diary, panelStyle: { top: '0', left: '0' } })
        });
        app.mount(host);
        await new Promise((r) => setTimeout(r, 250));

        const picker = host.querySelector('.diary-persona-picker select');
        steps.push('picker rendered = ' + Boolean(picker));
        if (!picker) {
            problems.push('persona picker not rendered');
            app.unmount();
            return { steps, problems };
        }

        const options = Array.from(picker.options).map((o) => ({ value: o.value, text: o.textContent.trim() }));
        steps.push('option count = ' + options.length);
        options.forEach((o) => steps.push('   ' + o.value + '  ->  ' + o.text));

        if (options.length < 10) problems.push('expected 10 persona options, got ' + options.length);
        for (const id of ['sister-null', 'sister-dilei', 'sister-tutor', 'sister-kemonomimi', 'sister-kemonomimi-cat']) {
            if (!options.some((o) => o.value === id)) problems.push('missing option ' + id);
        }
        if (new Set(options.map((o) => o.text)).size !== options.length) {
            problems.push('option labels are not unique');
        }

        // Switch and confirm the room would follow.
        picker.value = 'sister-kemonomimi-cat';
        picker.dispatchEvent(new Event('change'));
        await new Promise((r) => setTimeout(r, 250));

        steps.push('after switch, activePersona = ' + JSON.stringify(diary.activePersona.value));
        steps.push('after switch, personaName   = ' + JSON.stringify(diary.personaName.value));
        steps.push('notice = ' + JSON.stringify(diary.notice.value));

        if (diary.activePersona.value !== 'sister-kemonomimi-cat') {
            problems.push('switching did not take effect');
        }
        const stored = JSON.parse(localStorage.getItem('roomDiaryArchive:guest') || '{}');
        steps.push('persisted activePersonaId = ' + JSON.stringify(stored.data?.activePersonaId));
        if (stored.data?.activePersonaId !== 'sister-kemonomimi-cat') {
            problems.push('selection was not persisted');
        }

        // The persona actually used must be the chosen one.
        const used = diaryMod.useRoomDiary().activePersona.value;
        steps.push('reloaded active persona = ' + JSON.stringify(used));
        if (used !== 'sister-kemonomimi-cat') problems.push('selection did not survive a reload');

        app.unmount();
        return { steps, problems };
    }, archiveText);

    console.log('=== in-room persona picker ===');
    out.steps.forEach((s) => console.log('  ' + s));
    if (out.problems.length) {
        console.log('  PROBLEMS:');
        out.problems.forEach((p) => console.log('    - ' + p));
    }
    if (errors.length) console.log('  page errors: ' + errors.slice(0, 3).join(' | '));

    await browser.close();
    process.exit(out.problems.length ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
