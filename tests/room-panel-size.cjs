/**
 * Measures the resized chat panel against the Live2D stage, so the "bigger but
 * still leaves room for the model" requirement is verified rather than assumed.
 */
const { launchChromium } = require('./helpers/browser.cjs');

const BASE = process.env.REPRO_BASE || 'http://localhost:5199';

const VIEWPORTS = [
    { name: 'desktop 1920x1080', width: 1920, height: 1080 },
    { name: 'desktop 1600x900', width: 1600, height: 900 },
    { name: 'laptop 1366x768', width: 1366, height: 768 },
    { name: 'laptop 1280x720', width: 1280, height: 720 },
    { name: 'phone 390x844', width: 390, height: 844 }
];

(async () => {
    const { browser } = await launchChromium();
    let failures = 0;

    for (const vp of VIEWPORTS) {
        const page = await browser.newPage({
            viewport: { width: vp.width, height: vp.height },
            hasTouch: vp.width < 500, isMobile: vp.width < 500
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.addStyleTag({ url: `${BASE}/styles/routes/room.css` });
        await page.waitForTimeout(400);

        const out = await page.evaluate(async () => {
            const vue = await import('/@id/vue');
            const panelMod = await import('/components/room/RoomChatPanel.vue');

            const messages = Array.from({ length: 8 }, (_, i) => ({
                id: 'm' + i,
                role: i % 2 ? 'assistant' : 'user',
                content: '第 ' + (i + 1) + ' 条消息。',
                createdAt: Date.now() - i * 1000
            }));
            const state = vue.ref({ visible: false, status: 'idle', message: '', detail: '', entry: null });
            const chat = {
                messages: { value: messages }, input: { value: '' }, sending: { value: false },
                ttsState: { value: { messageId: '', status: 'idle' } },
                imageAttachment: { value: null }, messageListRef: { value: null },
                characterName: { value: 'Aoi' }, endChatState: state,
                sessionTurnCount: () => messages.length,
                attachImage: () => {}, clearImage: () => {}, send: () => {}, playTTS: () => {}, onDrop: () => {},
                startConversation: () => {}, openEndChatDialog: () => {}, closeEndChatDialog: () => {},
                confirmEndChat: () => {}, confirmEndChatWithoutDiary: () => {},
                dismissDiaryText: () => {}, exportDiaryArchive: () => {}
            };

            // Mirror the real RoomPage skeleton: a stage plus the chat panel.
            const host = document.createElement('div');
            host.className = 'room-page';
            host.style.cssText = 'position:fixed;inset:0;';
            const stage = document.createElement('div');
            stage.className = 'room-live2d-container';
            stage.id = 'stage';
            host.appendChild(stage);
            const mount = document.createElement('div');
            host.appendChild(mount);
            document.body.appendChild(host);

            const app = vue.createApp({
                render: () => vue.h(panelMod.default, { chat, panelStyle: { top: '12.3rem', right: '1.2rem' } })
            });
            app.mount(mount);
            await new Promise((r) => setTimeout(r, 250));

            const panel = host.querySelector('.room-chat-panel');
            const body = host.querySelector('.chat-body');
            const stageEl = host.querySelector('#stage');
            const inputRow = host.querySelector('.chat-input-row');
            const pr = panel.getBoundingClientRect();
            const br = body.getBoundingClientRect();
            const sr = stageEl.getBoundingClientRect();
            const ir = inputRow ? inputRow.getBoundingClientRect() : null;

            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // The character stands at the centre of the stage, so the panel's
            // left edge must stay right of the viewport centre line.
            const centre = vw / 2;
            const clearance = pr.left - centre;

            app.unmount();
            return {
                vw, vh,
                panel: { left: Math.round(pr.left), right: Math.round(pr.right), top: Math.round(pr.top), bottom: Math.round(pr.bottom), w: Math.round(pr.width), h: Math.round(pr.height) },
                bodyHeight: Math.round(br.height),
                inputRow: ir ? { top: Math.round(ir.top), bottom: Math.round(ir.bottom), w: Math.round(ir.width) } : null,
                stage: { left: Math.round(sr.left), right: Math.round(sr.right), w: Math.round(sr.width) },
                clearance: Math.round(clearance),
                clearancePct: +(clearance / vw * 100).toFixed(1),
                panelWidthPct: +(pr.width / vw * 100).toFixed(1),
                fitsVertically: pr.bottom <= vh + 1 && pr.top >= 0
            };
        });

        const isPhone = out.vw < 900;
        const problems = [];
        if (!out.fitsVertically) problems.push(`panel bottom ${out.panel.bottom} exceeds viewport ${out.vh}`);

        if (isPhone) {
            // Phones stack the layout; the input must simply stay reachable.
            if (out.inputRow && out.inputRow.bottom > out.vh + 1) {
                problems.push(`input row bottom ${out.inputRow.bottom} is off-screen`);
            }
        } else {
            // Desktop: bigger, but never over the character standing at centre.
            if (out.clearance < out.vw * 0.06) {
                problems.push(`panel crosses the centre line (clearance ${out.clearance}px)`);
            }
            if (out.panel.w < 416) problems.push(`panel narrower than 26rem (${out.panel.w}px)`);
            if (out.bodyHeight < 400) problems.push(`chat body only ${out.bodyHeight}px tall`);
        }

        console.log(`=== ${vp.name} ===`);
        console.log(`  panel ${out.panel.w}x${out.panel.h} at (${out.panel.left},${out.panel.top}) -> (${out.panel.right},${out.panel.bottom})  ${out.panelWidthPct}% wide`);
        console.log(`  chat body height = ${out.bodyHeight}px`);
        console.log(`  clearance right of centre = ${out.clearance}px (${out.clearancePct}%)`);
        if (out.inputRow) console.log(`  input row ${out.inputRow.w}px wide, bottom ${out.inputRow.bottom} (viewport ${out.vh})`);
        console.log(`  fits vertically = ${out.fitsVertically}`);
        if (problems.length) {
            problems.forEach((p) => console.log('    - ' + p));
            failures += problems.length;
        } else {
            console.log('  OK');
        }
        if (errors.length) console.log('  page errors: ' + errors.slice(0, 2).join(' | '));
        await page.close();
    }

    await browser.close();
    console.log('\n' + (failures ? failures + ' PROBLEM(S)' : 'ALL PANEL SIZE CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
