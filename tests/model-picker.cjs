/**
 * Confirms the LLM model picker actually offers the DeepSeek V4.1 Flash ids,
 * which is what the user could not find before.
 */
const { chromium } = require('@playwright/test');

const EXECUTABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.REPRO_BASE || 'http://localhost:5199';

(async () => {
    const browser = await chromium.launch({ executablePath: EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.addStyleTag({ url: `${BASE}/styles/routes/room-settings.css` }).catch(() => {});
    await page.waitForTimeout(400);

    const out = await page.evaluate(async () => {
        const steps = [];
        const problems = [];

        // Pretend the user already configured DeepSeek.
        localStorage.setItem('roomLLMSettings', JSON.stringify({
            apiUrl: 'https://api.deepseek.com/chat/completions',
            apiKey: 'sk-test',
            model: 'deepseek-flash',
            useProxy: false,
            visionMode: 'auto'
        }));

        const vue = await import('/@id/vue');
        const pageMod = await import('/pages/RoomSettingsPage.vue');

        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;inset:0;';
        document.body.appendChild(host);

        let app;
        try {
            app = vue.createApp({
                render: () => vue.h(pageMod.default, { user: null, onGo: () => {} })
            });
            app.mount(host);
        } catch (e) {
            problems.push('mount failed: ' + e.message);
            return { steps, problems };
        }
        await new Promise((r) => setTimeout(r, 700));

        // The "同步模型列表" select is the picker the user complained about.
        const selects = Array.from(host.querySelectorAll('select'));
        let picker = null;
        for (const s of selects) {
            const txt = Array.from(s.options).map((o) => o.textContent).join(' ');
            if (txt.includes('deepseek') || txt.includes('选择已同步模型')) { picker = s; break; }
        }

        steps.push('selects found = ' + selects.length);
        if (!picker) {
            problems.push('model picker select not found');
            app.unmount();
            return { steps, problems };
        }

        const options = Array.from(picker.options).map((o) => ({
            value: o.value,
            text: o.textContent.trim()
        }));
        steps.push('option count = ' + options.length);
        options.slice(0, 12).forEach((o) => steps.push('  value=' + JSON.stringify(o.value) + ' text=' + JSON.stringify(o.text)));

        const values = options.map((o) => o.value);
        const texts = options.map((o) => o.text).join(' | ');

        if (!values.includes('deepseek-flash')) problems.push('deepseek-flash is not selectable');
        else steps.push('deepseek-flash IS selectable');

        if (!/deepseek-flash/.test(texts)) problems.push('deepseek-flash is not visible in the option text');
        else steps.push('deepseek-flash IS visible in the list text');

        // The provider label alone must not be the only thing shown.
        const onlyProviderLabel = options.some((o) => o.text === 'DeepSeek');
        if (onlyProviderLabel) problems.push('an option still shows only the provider label "DeepSeek"');

        // Selecting it must set the model field.
        const modelInput = Array.from(host.querySelectorAll('input[type="text"]'))
            .find((i) => i.getAttribute('list') === 'llmSyncedModels');
        steps.push('model text input found = ' + Boolean(modelInput));
        if (modelInput) {
            steps.push('current model field value = ' + JSON.stringify(modelInput.value));
            picker.value = 'deepseek-flash';
            picker.dispatchEvent(new Event('change'));
            await new Promise((r) => setTimeout(r, 200));
            steps.push('after selecting, model field = ' + JSON.stringify(modelInput.value));
            if (modelInput.value !== 'deepseek-flash') problems.push('selecting deepseek-flash did not apply');
        }

        steps.push('current provider label shown = ' + (host.textContent.match(/当前识别供应商：(\w+)/) || [])[1]);

        app.unmount();
        return { steps, problems };
    });

    console.log('=== model picker ===');
    out.steps.forEach((s) => console.log('  ' + s));
    if (out.problems.length) {
        console.log('  PROBLEMS:');
        out.problems.forEach((p) => console.log('    - ' + p));
    }
    if (errors.length) console.log('  page errors: ' + errors.slice(0, 3).join(' | '));

    // --- SiliconFlow must still be recognised as itself ---
    const silicon = await page.evaluate(async () => {
        localStorage.setItem('roomLLMSettings', JSON.stringify({
            apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
            apiKey: 'sk-test',
            model: 'deepseek-ai/DeepSeek-V3',
            useProxy: false, visionMode: 'auto'
        }));
        const vue = await import('/@id/vue');
        const pageMod = await import('/pages/RoomSettingsPage.vue');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const app = vue.createApp({ render: () => vue.h(pageMod.default, { user: null, onGo: () => {} }) });
        app.mount(host);
        await new Promise((r) => setTimeout(r, 700));

        const selects = Array.from(host.querySelectorAll('select'));
        let picker = null;
        for (const s of selects) {
            const txt = Array.from(s.options).map((o) => o.textContent).join(' ');
            if (txt.includes('选择已同步模型')) { picker = s; break; }
        }
        const provider = (host.textContent.match(/当前识别供应商：(\w+)/) || [])[1];
        const values = picker ? Array.from(picker.options).map((o) => o.value) : [];
        const texts = picker ? Array.from(picker.options).map((o) => o.textContent.trim()) : [];
        app.unmount();
        return { provider, values, texts };
    });

    console.log('\n=== siliconflow detection ===');
    console.log('  provider = ' + silicon.provider);
    console.log('  options  = ' + JSON.stringify(silicon.texts));
    const siliconProblems = [];
    if (silicon.provider !== 'siliconflow') {
        siliconProblems.push('SiliconFlow misdetected as "' + silicon.provider + '"');
    }
    if (!silicon.values.includes('deepseek-ai/DeepSeek-V3')) {
        siliconProblems.push('SiliconFlow preset model missing from its own picker');
    }
    if (silicon.texts.some((t) => t.startsWith('SiliconFlow ·') && t.includes('api.deepseek.com'))) {
        siliconProblems.push('DeepSeek preset leaked into the SiliconFlow picker');
    }
    if (siliconProblems.length) {
        siliconProblems.forEach((p) => console.log('    - ' + p));
    } else {
        console.log('  OK');
    }

    await browser.close();
    process.exit((out.problems.length + siliconProblems.length) ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
