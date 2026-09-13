/**
 * Verifies the "我先说" opener button:
 *   - it appears only before the session has any turns
 *   - it is reachable and tappable on desktop and phone viewports
 *   - tapping it calls the opener without the user typing anything
 *   - the input row still lays out correctly with and without it
 */
const { chromium } = require('@playwright/test');

const EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.REPRO_BASE || 'http://localhost:5199';

const VIEWPORTS = [
    { name: 'desktop 1440x900', width: 1440, height: 900 },
    { name: 'phone 390x844', width: 390, height: 844 },
    { name: 'small 360x640', width: 360, height: 640 }
];

(async () => {
    const browser = await chromium.launch({ executablePath: EXECUTABLE });
    let failures = 0;

    for (const vp of VIEWPORTS) {
        const page = await browser.newPage({
            viewport: { width: vp.width, height: vp.height },
            hasTouch: true, isMobile: vp.width < 500
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.addStyleTag({ url: `${BASE}/styles/routes/room.css` });
        await page.waitForTimeout(400);

        const out = await page.evaluate(async () => {
            const steps = [];
            const problems = [];
            const vue = await import('/@id/vue');
            const panelMod = await import('/components/room/RoomChatPanel.vue');

            // Reactive so the panel's computed re-evaluates, like the real app.
            const turns = vue.ref(0);
            let opened = 0;
            const state = vue.ref({ visible: false, status: 'idle', message: '', detail: '', entry: null });
            const chat = {
                messages: { value: [] }, input: { value: '' }, sending: { value: false },
                ttsState: { value: { messageId: '', status: 'idle' } },
                imageAttachment: { value: null }, messageListRef: { value: null },
                characterName: { value: 'Aoi' }, endChatState: state,
                sessionTurnCount: () => turns.value,
                attachImage: () => {}, clearImage: () => {}, send: () => {}, playTTS: () => {}, onDrop: () => {},
                startConversation: () => { opened += 1; },
                openEndChatDialog: () => {}, closeEndChatDialog: () => {},
                confirmEndChat: () => {}, confirmEndChatWithoutDiary: () => {},
                dismissDiaryText: () => {}, exportDiaryArchive: () => {}
            };

            const host = document.createElement('div');
            host.className = 'room-shell';
            host.style.cssText = 'position:absolute;inset:0;';
            document.body.appendChild(host);
            const app = vue.createApp({
                render: () => vue.h(panelMod.default, { chat, panelStyle: { top: '0', left: '0' } })
            });
            app.mount(host);
            await new Promise((r) => setTimeout(r, 200));

            // --- before any turn: button must be present and hittable ---
            const btn = host.querySelector('#startChatBtn');
            steps.push('opener present before any turn = ' + Boolean(btn));
            if (!btn) {
                problems.push('opener button missing before the session starts');
            } else {
                steps.push('opener title = ' + JSON.stringify(btn.getAttribute('title')));
                steps.push('opener label = ' + JSON.stringify(btn.textContent.trim()));
                const r = btn.getBoundingClientRect();
                steps.push('opener rect = ' + [r.left, r.top, r.width, r.height].map(Math.round).join(','));
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const hit = document.elementFromPoint(cx, cy);
                const ok = Boolean(hit && (hit === btn || btn.contains(hit)));
                steps.push('opener hittable = ' + ok + (ok ? '' : ' occludedBy=' + (hit ? (hit.id || hit.className || hit.tagName) : 'null')));
                if (!ok) problems.push('opener not hittable');
                if (r.width < 20 || r.height < 20) problems.push('opener too small to tap: ' + Math.round(r.width) + 'x' + Math.round(r.height));

                // Is it left of the text input?
                const input = host.querySelector('#chatInput');
                if (input) {
                    const ir = input.getBoundingClientRect();
                    const isLeft = r.right <= ir.left + 2;
                    steps.push('opener sits left of the input = ' + isLeft);
                    if (!isLeft) problems.push('opener is not left of the input');
                    steps.push('input width = ' + Math.round(ir.width) + 'px');
                    if (ir.width < 60) problems.push('input squeezed to ' + Math.round(ir.width) + 'px');
                }

                btn.click();
                steps.push('startConversation calls = ' + opened);
                if (opened !== 1) problems.push('tapping the opener did not start the conversation');
            }

            // --- after a turn: button must disappear and layout must hold ---
            turns.value = 2;
            await new Promise((r) => setTimeout(r, 150));
            const gone = !host.querySelector('#startChatBtn');
            steps.push('opener hidden after turns = ' + gone);
            if (!gone) problems.push('opener still shown after the session started');

            const inputAfter = host.querySelector('#chatInput');
            const sendAfter = host.querySelector('#sendChatBtn');
            if (inputAfter && sendAfter) {
                const ir = inputAfter.getBoundingClientRect();
                const sr = sendAfter.getBoundingClientRect();
                steps.push('after hiding, input width = ' + Math.round(ir.width) + 'px');
                steps.push('after hiding, input left of send = ' + (ir.right <= sr.left + 2));
                if (ir.width < 60) problems.push('input collapsed after the opener hid: ' + Math.round(ir.width));
                if (!(ir.right <= sr.left + 2)) problems.push('send button misaligned after the opener hid');
                // No leftover empty column on the left.
                const attach = host.querySelector('#attachImageBtn');
                if (attach) {
                    const ar = attach.getBoundingClientRect();
                    const row = host.querySelector('.chat-input-row').getBoundingClientRect();
                    steps.push('row left padding gap = ' + Math.round(ar.left - row.left) + 'px');
                    if (ar.left - row.left > 40) problems.push('empty gap left behind by the hidden opener');
                }
            }

            app.unmount();
            return { steps, problems };
        });

        console.log('=== ' + vp.name + ' ===');
        out.steps.forEach((s) => console.log('  ' + s));
        if (out.problems.length) {
            console.log('  PROBLEMS:');
            out.problems.forEach((p) => console.log('    - ' + p));
            failures += out.problems.length;
        } else {
            console.log('  OK');
        }
        if (errors.length) console.log('  page errors: ' + errors.join(' | '));
        await page.close();
    }

    await browser.close();
    console.log('\n' + (failures ? failures + ' PROBLEM(S)' : 'ALL OPENER CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
