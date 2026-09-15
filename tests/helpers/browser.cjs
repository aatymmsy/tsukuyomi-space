/**
 * Shared Chromium launcher for the browser-driven checks in this folder.
 *
 * These scripts are local verification tools: they are deliberately NOT part of
 * `npm test`, because CI installs Playwright's Chromium only before `test:e2e`
 * and GitHub runners have no Windows Chrome at all.
 *
 * Resolution order:
 *   1. CHROME_PATH  — explicit override
 *   2. Playwright's bundled Chromium (what `npx playwright install` provides)
 *   3. A system Chrome/Edge, only if it actually exists on this machine
 *
 * Throws a clear, actionable message instead of failing deep inside launch().
 */
const fs = require('node:fs');

const WINDOWS_CANDIDATES = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const UNIX_CANDIDATES = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
];

/** Playwright's own download location, keyed by platform. */
function playwrightChromiumPath() {
    const { chromium } = require('@playwright/test');
    try {
        const path = chromium.executablePath();
        return path && fs.existsSync(path) ? path : '';
    } catch (_) {
        return '';
    }
}

function resolveExecutable() {
    const override = String(process.env.CHROME_PATH || '').trim();
    if (override) {
        if (!fs.existsSync(override)) {
            throw new Error(`CHROME_PATH is set but does not exist: ${override}`);
        }
        return override;
    }

    const bundled = playwrightChromiumPath();
    if (bundled) return bundled;

    const candidates = process.platform === 'win32' ? WINDOWS_CANDIDATES : UNIX_CANDIDATES;
    const system = candidates.find((item) => fs.existsSync(item));
    if (system) return system;

    throw new Error(
        'No Chromium found. Run `npx playwright install chromium`, '
        + 'or set CHROME_PATH to a browser executable.'
    );
}

/**
 * Launches Chromium without hardcoding a platform-specific path.
 * Returns { browser, executablePath }.
 */
async function launchChromium(options = {}) {
    const { chromium } = require('@playwright/test');
    const executablePath = resolveExecutable();
    const browser = await chromium.launch({ executablePath, ...options });
    return { browser, executablePath };
}

module.exports = { launchChromium, resolveExecutable };
