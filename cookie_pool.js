/**
 * Stok cookie Muse.
 * Dibaca sekali saat proses nyala: cookie-muse-1 ... cookie-muse-N.
 * Semua yang ada disimpan di memori.
 * Setiap cookie dicek sehat satu kali. Yang gagal dibuang dari memori.
 * Redis tidak dibaca lagi setelah itu. Key Redis tidak dihapus.
 */
const path = require('path');
const muse = require('./platforms/muse');

const WAIT_MS = 10 * 60 * 1000;

let deps = {};
let folder = null;
let memory = [];
let bootDone = false;
let booting = false;
let taking = false;
let antre = 0;

function setDeps(d) { deps = d || {}; }

function maxCookies() {
    return deps.MAX_COOKIES || parseInt(process.env.MAX_COOKIES || '10', 10);
}

function maxParallel() {
    return deps.MAX_PARALLEL || parseInt(process.env.MAX_PARALLEL || '6', 10);
}

function listText() {
    return memory.map((x) => x.index).join(', ') || '-';
}

function snapshot() {
    return {
        bootDone,
        max: maxCookies(),
        list: memory.map((x) => x.index),
        busy: memory.filter((x) => x.pakai > 0).map((x) => `${x.index}x${x.pakai}`),
    };
}

function formatItem(raw, index) {
    const cookies = muse.normalisasiCookies(raw);
    if (!cookies.length) return null;
    return {
        id: `cookie-muse-${index}`,
        index,
        cookies,
        pakai: 0,
    };
}

async function bacaSemuaSekali() {
    const max = maxCookies();
    const ketemu = [];
    for (let i = 1; i <= max; i++) {
        const key = `cookie-muse-${i}`;
        let raw = null;
        try {
            raw = await deps.redis.get(key);
        } catch (e) {
            console.log(`[CEK] ${key} gagal dibaca: ${e.message}`);
            continue;
        }
        if (raw == null || raw === '') {
            console.log(`[CEK] ${key} tidak ada — lewati`);
            continue;
        }
        const item = formatItem(raw, i);
        if (!item) {
            console.log(`[CEK] ${key} format tidak dikenali — lewati`);
            continue;
        }
        ketemu.push(item);
        console.log(`[CEK] ${key} masuk memori (${item.cookies.length} cookie browser)`);
    }
    return ketemu;
}

async function checkOnce(item) {
    let browser = null;
    let context = null;
    let page = null;
    try {
        const launched = await deps.launchGatewayBrowser();
        browser = launched.browser;
        context = await browser.newContext({ acceptDownloads: true });
        await context.addCookies(item.cookies);
        page = await context.newPage();
        await muse.persiapkanHalaman(page, folder, { cookieId: item.id, skipShots: true });
        return true;
    } catch (e) {
        if (page && folder) await muse.simpanJejakGagal(page, folder);
        throw e;
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

async function cekSatu(item) {
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            console.log(`[CEK] #${item.index} percobaan ${attempt}/2`);
            await checkOnce(item);
            console.log(`[CEK] #${item.index} SEHAT`);
            return true;
        } catch (e) {
            last = e;
            console.log(`[CEK] #${item.index} gagal: ${e.message}`);
            if (/COOKIE_INVALID/.test(e.message || '')) break;
        }
    }
    console.log(`[CEK] #${item.index} dibuang dari memori (${last ? last.message : 'gagal'})`);
    return false;
}

async function start(folderHasil) {
    if (booting || bootDone) return;
    booting = true;
    folder = folderHasil;
    try {
        const semua = await bacaSemuaSekali();
        console.log(`[CEK] ${semua.length} cookie dibaca sekali. Cek sehat mulai. Redis tidak dibaca lagi.`);
        const sehat = [];
        for (const item of semua) {
            if (await cekSatu(item)) sehat.push(item);
        }
        memory = sehat;
        bootDone = true;
        console.log(`[CEK] selesai. Sehat ${memory.length}: ${listText()}`);
    } catch (e) {
        bootDone = true;
        console.error(`[CEK] boot gagal: ${e.message}`);
    } finally {
        booting = false;
    }
}

function aktif() {
    return typeof deps.getActive === 'function' ? deps.getActive() : 0;
}

function pilihCookie() {
    if (!memory.length) return null;
    return memory.slice().sort((a, b) => a.pakai - b.pakai || a.index - b.index)[0];
}

async function takeNext(deadlineMs) {
    const mulai = Date.now();
    let lastLog = 0;
    let masukAntre = false;
    try {
        while (Date.now() - mulai < WAIT_MS) {
            if (deadlineMs && Date.now() >= deadlineMs) {
                throw new Error('TIMEOUT_5MENIT: tugas belum selesai dalam 5 menit');
            }
            if (bootDone && memory.length === 0) {
                throw new Error('[CEK] tidak ada cookie Muse sehat di memori');
            }
            const slotPenuh = aktif() >= maxParallel();
            if (!taking && bootDone && !slotPenuh && memory.length) {
                const item = pilihCookie();
                taking = true;
                item.pakai += 1;
                try {
                    if (deps.reserveWorker) deps.reserveWorker();
                } catch (e) {
                    item.pakai = Math.max(0, item.pakai - 1);
                    taking = false;
                    throw e;
                }
                taking = false;
                console.log(`[CEK] pakai #${item.index} bersama=${item.pakai} | slot ${aktif()}/${maxParallel()} | antre ${antre} | sehat ${listText()}`);
                return item;
            }
            if (!masukAntre) {
                masukAntre = true;
                antre += 1;
            }
            const now = Date.now();
            if (now - lastLog > 8000) {
                lastLog = now;
                if (!bootDone) console.log(`[ANTRI] ${antre} tugas menunggu cek cookie selesai`);
                else console.log(`[ANTRI] ${antre} tugas menunggu | slot ${aktif()}/${maxParallel()}`);
            }
            await new Promise((r) => setTimeout(r, 400));
        }
        throw new Error('[CEK] menunggu slot lebih dari 20 menit');
    } finally {
        if (masukAntre) antre = Math.max(0, antre - 1);
    }
}

function selesai(item, opts = {}) {
    if (item) {
        item.pakai = Math.max(0, (item.pakai || 1) - 1);
        if (opts.mati) {
            memory = memory.filter((x) => x.index !== item.index);
            console.log(`[CEK] #${item.index} dibuang dari memori (${opts.alasan || 'tidak sehat'})`);
        }
    }
    if (deps.releaseWorker) deps.releaseWorker();
}

function releaseWorker() {
    if (deps.releaseWorker) deps.releaseWorker();
}

module.exports = { setDeps, start, takeNext, selesai, releaseWorker, snapshot };
