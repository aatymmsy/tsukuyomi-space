/**
 * Drives the diary panel's per-row delete control against the real archive and
 * confirms exactly one entry disappears, with the confirmation gate honoured.
 */
const { launchChromium } = require('./helpers/browser.cjs');
const fs = require('node:fs');

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

    const { browser } = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Auto-accept the confirmation, and record that it was asked.
    let confirmAsked = 0;
    page.on('dialog', async (dialog) => {
        confirmAsked += 1;
        await dialog.accept();
    });

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
        const startCount = diary.entries.value.length;
        steps.push('entries at start = ' + startCount);

        const host = document.createElement('div');
        host.className = 'room-shell';
        host.style.cssText = 'position:absolute;inset:0;';
        document.body.appendChild(host);
        const app = vue.createApp({
            render: () => vue.h(panelMod.default, { diary, panelStyle: { top: '0', left: '0' } })
        });
        app.mount(host);
        await new Promise((r) => setTimeout(r, 250));

        const rows = host.querySelectorAll('.diary-list-item');
        steps.push('rendered rows = ' + rows.length);
        const buttons = host.querySelectorAll('.diary-list-delete');
        steps.push('rendered delete buttons = ' + buttons.length);
        if (buttons.length !== rows.length) problems.push('every row needs a delete button');

        // Remember which entry the third row is, then delete it.
        const targetRow = rows[2];
        const targetDate = targetRow ? targetRow.querySelector('.diary-list-date').textContent.trim() : '';
        const targetTime = targetRow ? targetRow.querySelector('.diary-list-time').textContent.trim() : '';
        steps.push('deleting row 3 = ' + targetDate + ' ' + targetTime);

        const del = targetRow ? targetRow.querySelector('.diary-list-delete') : null;
        if (!del) {
            problems.push('delete button missing on the target row');
        } else {
            del.click();
            await new Promise((r) => setTimeout(r, 300));

            const after = diary.entries.value.length;
            steps.push('entries after delete = ' + after);
            steps.push('notice = ' + JSON.stringify(diary.notice.value));
            if (after !== startCount - 1) problems.push(`expected ${startCount - 1} entries, got ${after}`);

            const stored = JSON.parse(localStorage.getItem('roomDiaryArchive:guest') || '{}');
            steps.push('persisted entries = ' + (stored.data?.diary?.length ?? 'n/a'));
            if ((stored.data?.diary?.length ?? -1) !== after) problems.push('deletion was not persisted');

            // Personas and slot must be untouched.
            const personas = diary.personas.value.length;
            steps.push('personas after delete = ' + personas);
            if (personas < 10) problems.push('persona list was damaged by the delete');

            // Clicking delete must not also re-select the row (stop propagation).
            steps.push('selection after delete = ' + JSON.stringify(diary.selectedId.value));
        }

        // The detail-view delete button must exist too.
        const detailDel = host.querySelector('.diary-detail-delete');
        steps.push('detail delete button = ' + Boolean(detailDel));

        app.unmount();
        return { steps, problems };
    }, archiveText);

    console.log('=== diary delete in the panel ===');
    out.steps.forEach((s) => console.log('  ' + s));
    console.log('  confirmation dialogs shown = ' + confirmAsked);
    if (confirmAsked === 0) out.problems.push('no confirmation was requested');
    if (out.problems.length) {
        console.log('  PROBLEMS:');
        out.problems.forEach((p) => console.log('    - ' + p));
    }
    if (errors.length) console.log('  page errors: ' + errors.slice(0, 3).join(' | '));

    await browser.close();
    process.exit(out.problems.length ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
