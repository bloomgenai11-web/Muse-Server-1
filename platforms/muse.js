const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const THREAD_NEW = 'https://muse.ai/thread/new';

function keSameSite(v) {
    const s = String(v || '').toLowerCase();
    if (s === 'strict') return 'Strict';
    if (s === 'none' || s === 'no_restriction') return 'None';
    return 'Lax';
}

function jadiCookiePlaywright(c) {
    if (!c || !c.name) return null;
    const out = {
        name: String(c.name),
        value: String(c.value ?? ''),
        domain: c.domain || '.muse.ai',
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: !!c.httpOnly,
        sameSite: keSameSite(c.sameSite),
    };
    if (!c.session && c.expirationDate != null) {
        const exp = Number(c.expirationDate);
        if (Number.isFinite(exp) && exp > 0) out.expires = Math.floor(exp);
    }
    return out;
}

function normalisasiCookies(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (Array.isArray(data)) return data.map(jadiCookiePlaywright).filter(Boolean);
    if (data && typeof data === 'object') {
        return Object.entries(data).map(([name, value]) => jadiCookiePlaywright({
            name,
            value,
            domain: '.muse.ai',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'Lax',
        })).filter(Boolean);
    }
    return [];
}

function namaHasil(jejak, i) {
    const j = jejak || {};
    const bersih = (s) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
    if (j.sesi == null && !j.jenis) return `muse_IMG_${Date.now()}_${i + 1}.png`;
    const sesi = j.sesi != null ? `s${j.sesi}` : 's0';
    const jenis = bersih(j.jenis) || 'gambar';
    const giliran = bersih(j.giliran) || 'na';
    return `${sesi}_${jenis}_${giliran}_MUSE_${Date.now()}_${i + 1}.png`;
}

async function sedotNative(urlTarget, destPath, context) {
    const cookiesArray = await context.cookies();
    const cookieStr = cookiesArray.map((c) => `${c.name}=${c.value}`).join('; ');
    return new Promise((resolve, reject) => {
        const lib = urlTarget.startsWith('https') ? https : http;
        const req = lib.get(urlTarget, {
            headers: {
                Cookie: cookieStr,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
                Referer: 'https://muse.ai/',
            },
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                sedotNative(res.headers.location, destPath, context).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode === 200 || res.statusCode === 206) {
                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(true); });
                return;
            }
            reject(new Error(`HTTP Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout unduh')); });
    });
}

async function bacaSinyal(page) {
    return page.evaluate(() => {
        const policy = document.documentElement.getAttribute('data-hatch-initial-trace-policy') || '';
        const login = !!document.querySelector('[data-pel-click="logged_out_login_click"], [data-pel-click="login_contact_continue_click"]');
        const composer = !!document.querySelector('[data-testid="hatch-composer-placeholder-overlay"], [data-hatch-composer-action-slot]');
        return { policy, login, composer, url: location.href };
    });
}

function halamanPindah(err) {
    const m = (err && err.message) ? err.message : String(err || '');
    return /Execution context was destroyed|most likely because of a navigation|Target closed/i.test(m);
}

function sesiMati(s) {
    if (!s) return false;
    if (s.policy === 'hatch.login') return true;
    if (s.login) return true;
    if (!s.composer) {
        try {
            const u = new URL(s.url);
            if (u.hostname.endsWith('muse.ai') && (u.pathname === '/' || u.pathname === '')) return true;
        } catch (e) { /* abaikan */ }
    }
    return false;
}

async function tungguSesiValid(page, timeoutMs = 45000) {
    console.log('[MUSE] cek sesi (login = cookie tidak sehat)...');
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
        let s = null;
        try {
            s = await bacaSinyal(page);
        } catch (e) {
            if (halamanPindah(e)) {
                await page.waitForTimeout(600);
                continue;
            }
            throw e;
        }
        last = s;
        if (sesiMati(s)) {
            throw new Error('COOKIE_INVALID: halaman login Muse (' + (s.policy || s.url) + ')');
        }
        if (s.composer && /\/thread\//.test(s.url || '')) return s;
        await page.waitForTimeout(700);
    }
    if (last && sesiMati(last)) throw new Error('COOKIE_INVALID: halaman login Muse');
    throw new Error('SESI_TIMEOUT: composer Muse tidak muncul');
}

async function persiapkanHalaman(page, folderHasil, options = {}) {
    const id = (options && options.cookieId) || '-';
    console.log(`[MUSE] buka ${THREAD_NEW} cookie=${id}`);
    await page.goto(THREAD_NEW, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const s = await tungguSesiValid(page, 45000);
    console.log(`[MUSE] sesi hidup ${s.url}`);
    return s;
}

async function uploadFiles(page, files) {
    if (!files.length) return;
    const root = page.locator('[data-hatch-composer-root="true"]').first();
    await root.waitFor({ state: 'visible', timeout: 20000 });
    await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach((input) => {
            input.removeAttribute('accept');
            input.removeAttribute('capture');
        });
    });
    const inputs = await root.locator('input[type="file"]').all();
    const cadangan = inputs.length ? inputs : await page.locator('input[type="file"]').all();
    console.log(`[MUSE] input file di composer=${inputs.length} dipakai=${cadangan.length}`);
    if (!cadangan.length) throw new Error('UPLOAD_GAGAL: input file tidak ada');

    const awal = await root.evaluate((el) => ({
        media: el.querySelectorAll('[data-hatch-media-protection-border]').length,
        buttons: el.querySelectorAll('button').length,
    }));
    const nempel = () => root.evaluate((el, sebelum) => {
        const adaBlob = Array.from(el.querySelectorAll('img')).some((img) => String(img.currentSrc || img.src || '').startsWith('blob:'));
        const media = el.querySelectorAll('[data-hatch-media-protection-border]').length > sebelum.media;
        const tombolBaru = el.querySelectorAll('button').length > sebelum.buttons;
        return adaBlob || media || tombolBaru;
    }, awal);

    for (let upaya = 1; upaya <= 3; upaya++) {
        let terpasang = false;
        const daftar = await root.locator('input[type="file"]').all();
        const pakai = daftar.length ? daftar : cadangan;
        for (const input of pakai) {
            try {
                await input.setInputFiles(files);
                terpasang = true;
                break;
            } catch (e) {
                console.log(`[MUSE] setInputFiles upaya ${upaya}: ${e.message}`);
            }
        }
        if (!terpasang) continue;
        const batas = Date.now() + 5000;
        while (Date.now() < batas) {
            if (await nempel()) {
                console.log(`[MUSE] lampiran nempel ${files.length} upaya=${upaya}`);
                return;
            }
            await page.waitForTimeout(200);
        }
        console.log(`[MUSE] lampiran belum kelihatan, ulang upaya ${upaya}/3`);
    }
    throw new Error('UPLOAD_GAGAL: lampiran tidak muncul di composer');
}

async function isiPrompt(page, prompt) {
    const box = page.locator('[data-hatch-composer-root="true"] textarea, textarea').last();
    await box.waitFor({ state: 'visible', timeout: 20000 });
    await box.focus();
    await box.fill(prompt);
    await page.waitForTimeout(200);
}

async function buktiTerkirim(page, prompt) {
    return page.evaluate((teks) => {
        const path = location.pathname || '';
        const pindah = /\/thread\/(?!new$)[^/]+/.test(path);
        const sibuk = !!document.querySelector('[data-testid="hatch-composer-stop-button"], [data-testid="hatch-chat-typing-indicator"], [data-hatch-composer-action="stop"]');
        const root = document.querySelector('[data-hatch-composer-root="true"]') || document;
        const ta = root.querySelector('textarea');
        const isi = ta ? String(ta.value || '') : '';
        const potong = teks ? String(teks).slice(0, 24) : '';
        const draft = !!(potong && isi.includes(potong));
        const lampiran = !!root.querySelector('[data-hatch-media-protection-border], img[src^="blob:"]');
        return { pindah, sibuk, draft, lampiran, url: location.href };
    }, prompt || '');
}

async function simpanHtmlLangkah(page, folderHasil, nama) {
    if (!page || !folderHasil) return '';
    const stamp = Date.now();
    const file = path.join(folderHasil, `send_${nama}_${stamp}.html`);
    let info = {};
    try {
        info = await page.evaluate(() => {
            const b = document.querySelector('[data-pel-click="chat_send_message"]');
            const r = b ? b.getBoundingClientRect() : null;
            let hit = null;
            if (r && r.width > 0) {
                const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                if (el) {
                    hit = {
                        tag: el.tagName,
                        aria: el.getAttribute('aria-label'),
                        pel: el.getAttribute('data-pel-click'),
                        cls: String(el.className || '').slice(0, 180),
                    };
                }
            }
            return {
                url: location.href,
                disabled: b ? !!b.disabled : null,
                aria: b ? b.getAttribute('aria-label') : null,
                rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
                hit,
            };
        });
    } catch (e) {
        info = { error: e.message };
    }
    const body = await page.content();
    fs.writeFileSync(file, `<!-- ${JSON.stringify(info)} -->\n${body}`);
    console.log(`[MUSE] html ${path.basename(file)} hit=${info.hit ? (info.hit.aria || info.hit.tag) : '-'}`);
    return file;
}

async function klikKirim(page, prompt, folderHasil) {
    await page.waitForSelector('[data-pel-click="chat_send_message"], [data-hatch-composer-action="send"] button', { timeout: 15000 });
    const box = page.locator('[data-hatch-composer-root="true"] textarea, textarea').last();
    const btn = page.locator('[data-pel-click="chat_send_message"]').first();
    const urutan = ['dom', 'klik', 'enter'];
    for (const cara of urutan) {
        await simpanHtmlLangkah(page, folderHasil, `sebelum_${cara}`);
        let galat = '';
        if (cara === 'dom') {
            const ada = await page.evaluate(() => {
                const b = document.querySelector('[data-pel-click="chat_send_message"]');
                if (!b) return false;
                b.click();
                return true;
            });
            if (!ada) galat = 'tombol kirim tidak ada';
        } else if (cara === 'klik') {
            try {
                await btn.click({ timeout: 3000 });
            } catch (e) {
                galat = e.message.split('\n')[0];
                console.log(`[MUSE] klik: ${galat}`);
            }
        } else {
            await box.focus().catch(() => {});
            await box.press('Enter').catch((e) => { galat = e.message; console.log(`[MUSE] enter: ${e.message}`); });
        }
        const batas = Date.now() + 2500;
        let s = null;
        while (Date.now() < batas) {
            s = await buktiTerkirim(page, prompt);
            if (s.pindah || s.sibuk || (!s.draft && !s.lampiran)) {
                console.log(`[MUSE] terkirim cara=${cara} url=${s.url}`);
                return;
            }
            await page.waitForTimeout(200);
        }
        await simpanHtmlLangkah(page, folderHasil, `sesudah_${cara}`);
        console.log(`[MUSE] kirim ${cara} gagal${galat ? ': ' + galat : ''} url=${s ? s.url : '-'}`);
    }
    throw new Error('KIRIM_GAGAL: pesan masih di composer');
}

async function tungguGambar(page, timeoutMs) {
    const t0 = Date.now();
    let pernahSibuk = false;
    while (Date.now() - t0 < timeoutMs) {
        const info = await page.evaluate(() => {
            const sibuk = !!document.querySelector('[data-testid="hatch-composer-stop-button"], [data-testid="hatch-chat-typing-indicator"]');
            const nodes = Array.from(document.querySelectorAll('[data-testid="hatch-chat-attachment-presentation-image"]'));
            const images = [];
            for (const node of nodes) {
                const button = node.querySelector('button');
                const img = node.querySelector('img');
                const busy = !!(button && button.getAttribute('aria-busy') === 'true');
                const src = img ? (img.currentSrc || img.src || '') : '';
                const label = (button && (button.getAttribute('aria-label') || button.getAttribute('title'))) || '';
                if (!busy && src) images.push({ src, label });
            }
            return { sibuk, images };
        }).catch((e) => {
            if (halamanPindah(e)) return { sibuk: true, images: [] };
            throw e;
        });
        if (info.sibuk) pernahSibuk = true;
        const generated = info.images.filter((x) => /generated image/i.test(x.label));
        const pilih = generated.length ? generated : info.images;
        if (pilih.length && !info.sibuk && (pernahSibuk || generated.length)) {
            return pilih.map((x) => x.src);
        }
        await page.waitForTimeout(400);
    }
    throw new Error('TIMEOUT: Muse tidak menghasilkan gambar');
}

async function simpanGambar(page, context, url, dest) {
    if (/^blob:|^data:/i.test(url)) {
        const dataUrl = await page.evaluate(async (u) => {
            if (String(u).startsWith('data:')) return u;
            const r = await fetch(u);
            if (!r.ok) throw new Error('fetch ' + r.status);
            const blob = await r.blob();
            return await new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
                fr.onerror = () => reject(new Error('FileReader'));
                fr.readAsDataURL(blob);
            });
        }, url);
        const m = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/);
        if (!m || !m[1]) throw new Error('blob bukan base64');
        fs.writeFileSync(dest, Buffer.from(m[1], 'base64'));
        return;
    }
    await sedotNative(url, dest, context);
}

async function simpanJejakGagal(page, folderHasil) {
    if (!page || !folderHasil) return;
    const stamp = Date.now();
    const png = path.join(folderHasil, `fail_muse_${stamp}.png`);
    const html = path.join(folderHasil, `fail_muse_${stamp}.html`);
    await page.screenshot({ path: png, fullPage: true }).catch(() => {});
    try {
        const url = page.url();
        const body = await page.content();
        fs.writeFileSync(html, `<!-- url=${url} -->\n${body}`);
        console.log(`[MUSE] jejak gagal ${path.basename(png)} ${path.basename(html)} url=${url}`);
    } catch (e) {
        console.log(`[MUSE] screenshot gagal ${path.basename(png)} html tidak tersimpan: ${e.message}`);
    }
}

async function eksekusiMuse(tipeTugas, promptTeks, isThinkingMode, fileInputData, folderHasil, context, options = {}) {
    const page = await context.newPage();
    try {
        await persiapkanHalaman(page, folderHasil, options);
        const files = (fileInputData || []).filter((f) => f && fs.existsSync(f));
        const prompt = String(promptTeks || '').trim();
        if (!prompt && !files.length) throw new Error('PROMPT_KOSONG');
        console.log(`[MUSE] cookie=${(options && options.cookieId) || '-'} file=${files.length} prompt=${prompt ? 'ada' : 'kosong'}`);
        if (files.length) await uploadFiles(page, files);
        if (prompt) await isiPrompt(page, prompt);
        await klikKirim(page, prompt, folderHasil);
        const urls = await tungguGambar(page, 4 * 60 * 1000);
        const saved = [];
        for (let i = 0; i < urls.length; i++) {
            const name = namaHasil(options && options.jejak, i);
            const dest = path.join(folderHasil, name);
            try {
                await simpanGambar(page, context, urls[i], dest);
                if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
                    saved.push(name);
                    console.log(`[MUSE] tersimpan ${name} byte=${fs.statSync(dest).size}`);
                }
            } catch (e) {
                console.log(`[MUSE] gagal unduh gambar: ${e.message}`);
            }
        }
        if (!saved.length) throw new Error('UNDUH_GAGAL: gambar Muse tidak tersimpan');
        return { text: '', files: saved };
    } catch (e) {
        await simpanJejakGagal(page, folderHasil);
        throw e;
    } finally {
        await page.close().catch(() => {});
    }
}

module.exports = {
    eksekusiMuse,
    persiapkanHalaman,
    normalisasiCookies,
    simpanJejakGagal,
    THREAD_NEW,
};
