/**
 * AVELORA — Храм Стихий (AveloraTemple), подземный храм с ровными стенами.
 * Тот же интерфейс, что у AveloraDungeon: constructor(scene, cfg, terrain, pathfinder), update(), dispose(),
 * constrainCamera(cam, head), flareBraziers().
 *
 * Планировка — список прямоугольников cfg.rooms [{id, x0, z0, x1, z1, h, theme}] (залы, коридоры, проёмы).
 * Всё остальное строится из растра 0.5 м: проходимая клетка = внутри любого прямоугольника. Стены — границы
 * проходимых клеток (слитые отрезки), перепады потолка — ступенчатые «надбровья», пол и потолок — слитые полосы.
 * Навигационная сетка пишется напрямую. Колонны (cfg.rooms[].cols) и жаровни — непроходимые круги.
 * Тема (theme) задаёт текстуру камня и цвет света: hub | water | fire | air | stone | boss | door.
 */
(function () {
    'use strict';
    const CELL = 0.5;
    const THEMES = {
        hub:   { base: [96, 86, 72],   mortar: [26, 22, 18],  tint: 0xffb866, accent: '#d9b25a', rune: '#e8c46a', glyph: [200, 170, 110] },
        water: { base: [66, 84, 94],   mortar: [14, 24, 32],  tint: 0x4fb4ff, accent: '#4fa8e8', rune: '#7fd4ff', glyph: [120, 190, 230] },
        fire:  { base: [88, 56, 46],   mortar: [40, 12, 6],   tint: 0xff6a2a, accent: '#e8541e', rune: '#ff9a4a', glyph: [240, 130, 60] },
        air:   { base: [186, 182, 170], mortar: [84, 86, 90], tint: 0xcfe8ff, accent: '#bfe3ff', rune: '#eaf6ff', glyph: [225, 240, 255] },
        stone: { base: [104, 84, 60],  mortar: [24, 18, 12],  tint: 0xd9a35a, accent: '#b5834a', rune: '#e0b070', glyph: [215, 170, 100] },
        boss:  { base: [62, 56, 70],   mortar: [14, 12, 20],  tint: 0xb78cff, accent: '#a678ff', rune: '#d4b8ff', glyph: [190, 150, 255] }
    };
    THEMES.magma    = { base: [58, 40, 36],  mortar: [16, 6, 4],  tint: 0xff5a1e, accent: '#e8541e', rune: '#ff9a4a', glyph: [240, 120, 50] };
    THEMES.obsidian = { base: [42, 38, 54],  mortar: [8, 6, 14],  tint: 0xff7a44, accent: '#a07aff', rune: '#d0b0ff', glyph: [170, 130, 240] };
    THEMES.door = THEMES.hub;
    const THEME_IDS = ['hub', 'water', 'fire', 'air', 'stone', 'boss', 'magma', 'obsidian'];

    function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

    // ------------------------------------------------------------------ canvas textures (colour + height map)
    function cv2(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
    function toTex(c, srgb) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
    const rgb = (c, j, v) => { v = v || 1; return `rgb(${Math.max(0, Math.min(255, c[0] * v + j)) | 0},${Math.max(0, Math.min(255, c[1] * v + j)) | 0},${Math.max(0, Math.min(255, c[2] * v + j)) | 0})`; };

    /** chipped polygon for one block (corners nibbled) */
    function blockPath(g, x, y, w, h, R, chip) {
        const c = () => R() * chip;
        g.beginPath();
        g.moveTo(x + c(), y + c()); g.lineTo(x + w * 0.5 + (R() - 0.5) * 4, y + R() * 1.5); g.lineTo(x + w - c(), y + c());
        g.lineTo(x + w - R() * 1.5, y + h * 0.5 + (R() - 0.5) * 4); g.lineTo(x + w - c(), y + h - c());
        g.lineTo(x + w * 0.5 + (R() - 0.5) * 4, y + h - R() * 1.5); g.lineTo(x + c(), y + h - c()); g.lineTo(x + R() * 1.5, y + h * 0.5 + (R() - 0.5) * 4);
        g.closePath();
    }
    function weather(g, x, y, w, h, R, th, amount) {
        for (let n = 0; n < 7 * amount; n++) {                         // stains / lichen splotches
            const px = x + R() * w, py = y + R() * h, r = 8 + R() * 30, a = 0.04 + R() * 0.09, dark = R() < 0.7;
            const gr = g.createRadialGradient(px, py, 0, px, py, r);
            gr.addColorStop(0, dark ? `rgba(8,6,4,${a})` : `rgba(210,200,170,${a * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
        }
        for (let n = 0; n < 5 * amount; n++) {                         // vertical water streaks
            const px = x + R() * w; g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.05})`; g.fillRect(px, y + R() * h * 0.3, 1 + R() * 3, h * (0.3 + R() * 0.7));
        }
        for (let n = 0; n < 26; n++) { g.fillStyle = R() < 0.5 ? 'rgba(90,60,30,0.05)' : 'rgba(255,240,205,0.05)'; g.fillRect(x + R() * w, y + R() * h, 3 + R() * 9, 2 + R() * 5); }   // soft grain, no black dots
    }
    function crack(g, x, y, R, len, col) {
        g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y);
        let cx = x, cy = y;
        for (let q = 0; q < len; q++) { cx += (R() - 0.5) * 16; cy += 6 + R() * 12; g.lineTo(cx, cy); }
        g.stroke();
    }

    /** irregular ashlar masonry: rows of different heights, blocks of different widths, chipped, weathered, with a bump map */
    function masonry(th, seed, S, opts) {
        opts = opts || {};
        const [c, g] = cv2(S, S), [hc, hg] = cv2(S / 2, S / 2), R = rng(seed), k = (S / 2) / S;
        const dark = opts.dark || 1.2;
        g.fillStyle = rgb(th.mortar, 0); g.fillRect(0, 0, S, S);
        hg.fillStyle = '#303030'; hg.fillRect(0, 0, S / 2, S / 2);
        // row heights
        const rows = []; let sum = 0;
        while (sum < S) { const h = Math.round(S * (opts.rowMin || 0.2) + R() * S * (opts.rowVar || 0.12)); rows.push(h); sum += h; }
        rows[rows.length - 1] -= (sum - S);
        let y = 0;
        rows.forEach(rh => {
            let x = -R() * S * 0.3;
            while (x < S) {
                const bw = Math.round(S * (opts.wMin || 0.28) + R() * S * (opts.wVar || 0.28));
                const j = (R() - 0.5) * 34, tone = dark * (0.82 + R() * 0.32);
                for (const ox of [0, -S, S]) {
                    const bx = x + ox, bwid = bw - 5, bhei = rh - 5;
                    if (bx + bwid < 0 || bx > S) continue;
                    blockPath(g, bx + 2.5, y + 2.5, bwid, bhei, R, 5);
                    g.fillStyle = rgb(th.base, j, tone); g.fill();
                    const gr = g.createLinearGradient(bx, y, bx + bwid * 0.4, y + bhei);
                    gr.addColorStop(0, 'rgba(255,235,200,0.12)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.26)');
                    g.fillStyle = gr; g.fill();
                    g.save(); g.clip(); weather(g, bx, y, bwid, bhei, R, th, opts.weather || 1); if (R() < 0.3) crack(g, bx + R() * bwid, y + 4, R, 4, 'rgba(0,0,0,0.42)'); g.restore();
                    // height: block raised, chiselled border lowered
                    hg.fillStyle = '#d0d0d0'; hg.fillRect((bx + 3) * k, (y + 3) * k, (bwid - 2) * k, (bhei - 2) * k);
                    hg.fillStyle = '#ececec'; hg.fillRect((bx + 7) * k, (y + 7) * k, (bwid - 10) * k, (bhei - 10) * k);
                }
                x += bw;
            }
            y += rh;
        });
        if (th === THEMES.fire && !opts.noGlow) {                      // glowing seams
            g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,80,20,0.3)'; g.lineWidth = 2;
            let yy = 0; rows.forEach(rh => { g.beginPath(); g.moveTo(0, yy + 1); g.lineTo(S, yy + 1); g.stroke(); yy += rh; });
            g.globalCompositeOperation = 'source-over';
        }
        return [c, hc];
    }

    /** wall tile with one tall carved panel: 768x896 (3 m wide, stretched over the whole wall height) */
    function panelWall(th, seed) {
        const W = 768, H = 896, [c, g] = cv2(W, H), [hc, hg] = cv2(W / 2, H / 2), k = 0.5;
        const [mc, mh] = masonry(th, seed, 512);
        for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) { g.drawImage(mc, ix * 512 - 128, iy * 512 - 64); hg.drawImage(mh, (ix * 512 - 128) / 2, (iy * 512 - 64) / 2); }
            const pw = W * 0.5, ph = H * 0.93, px = (W - pw) / 2, py = (H - ph) / 2, gl = th.glyph;
            const lite = `rgba(${Math.min(255, gl[0] + 30)},${Math.min(255, gl[1] + 30)},${Math.min(255, gl[2] + 30)},0.9)`;
            const arch = (x0, y0, w, h) => { g.beginPath(); g.moveTo(x0, y0 + h); g.lineTo(x0, y0 + w / 2); g.arc(x0 + w / 2, y0 + w / 2, w / 2, Math.PI, 0); g.lineTo(x0 + w, y0 + h); g.closePath(); };
            const harch = (x0, y0, w, h) => { hg.beginPath(); hg.moveTo(x0 * k, (y0 + h) * k); hg.lineTo(x0 * k, (y0 + w / 2) * k); hg.arc((x0 + w / 2) * k, (y0 + w / 2) * k, w / 2 * k, Math.PI, 0); hg.lineTo((x0 + w) * k, (y0 + h) * k); hg.closePath(); };
            arch(px - 8, py - 8, pw + 16, ph + 16); g.fillStyle = rgb(th.base, 0, 1.12); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3; g.stroke();   // outer frame
            harch(px - 8, py - 8, pw + 16, ph + 16); hg.fillStyle = '#f2f2f2'; hg.fill();
            arch(px + 14, py + 14, pw - 28, ph - 28); g.fillStyle = rgb(th.base, 0, 0.62); g.fill();           // recessed field
            const fg = g.createLinearGradient(px, py, px + pw, py + ph); fg.addColorStop(0, 'rgba(0,0,0,0.38)'); fg.addColorStop(0.5, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,0.18)');
            g.fillStyle = fg; g.fill();
            harch(px + 14, py + 14, pw - 28, ph - 28); hg.fillStyle = '#505050'; hg.fill();
            const cx = W / 2, cy = py + ph * 0.42;
            const carve = (fn) => { for (const [ox, oy, col, hh] of [[2.5, 2.5, 'rgba(0,0,0,0.6)', '#181818'], [0, 0, lite, '#f6f6f6']]) { g.save(); g.translate(ox, oy); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 4; g.lineCap = 'round'; fn(g); g.restore(); hg.save(); hg.scale(k, k); hg.translate(ox, oy); hg.strokeStyle = hh; hg.fillStyle = hh; hg.lineWidth = 4; hg.lineCap = 'round'; fn(hg); hg.restore(); } };
            carve(q => {
                q.beginPath(); q.arc(cx, cy, 46, 0, 7); q.stroke(); q.beginPath(); q.arc(cx, cy, 30, 0, 7); q.stroke();
                for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; q.beginPath(); q.moveTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50); q.lineTo(cx + Math.cos(a) * 66, cy + Math.sin(a) * 66); q.stroke(); }
                q.beginPath(); q.moveTo(cx, cy - 22); q.lineTo(cx + 16, cy); q.lineTo(cx, cy + 22); q.lineTo(cx - 16, cy); q.closePath(); q.stroke();
                q.beginPath(); q.moveTo(cx - 56, py + ph * 0.72); q.lineTo(cx + 56, py + ph * 0.72); q.moveTo(cx - 40, py + ph * 0.78); q.lineTo(cx + 40, py + ph * 0.78); q.stroke();
                for (let i = -2; i <= 2; i++) { q.beginPath(); q.moveTo(cx + i * 22, py + ph * 0.84); q.lineTo(cx + i * 22, py + ph * 0.92 - Math.abs(i) * 4); q.stroke(); }
            });
                return [c, hc];
    }

    /** big worn floor slabs laid like brick (2 m slabs on a 4 m tile) with cracks, wear and dirt */
    function floorSlabs(th, seed, S) {
        const [c, g] = cv2(S, S), [hc, hg] = cv2(S / 2, S / 2), R = rng(seed), k = 0.5;
        g.fillStyle = rgb(th.mortar, 0); g.fillRect(0, 0, S, S); hg.fillStyle = '#282828'; hg.fillRect(0, 0, S / 2, S / 2);
        const sh = S / 2;
        for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) {
            const off = r ? sh / 2 : 0, x = q * sh + off, y = r * sh;
            for (const ox of [0, -S, S]) {
                const bx = x + ox; if (bx + sh < 0 || bx > S) continue;
                const j = (R() - 0.5) * 26;
                blockPath(g, bx + 3, y + 3, sh - 6, sh - 6, R, 7);
                g.fillStyle = rgb(th.base, j, 0.86 + R() * 0.2); g.fill();
                g.save(); g.clip();
                const wn = g.createRadialGradient(bx + sh / 2, y + sh / 2, 4, bx + sh / 2, y + sh / 2, sh * 0.7);   // worn centre
                wn.addColorStop(0, 'rgba(210,195,165,0.16)'); wn.addColorStop(1, 'rgba(0,0,0,0.3)');
                g.fillStyle = wn; g.fillRect(bx, y, sh, sh);
                weather(g, bx, y, sh, sh, R, th, 1.4);
                if (R() < 0.7) crack(g, bx + R() * sh, y + 4, R, 8, 'rgba(0,0,0,0.5)');
                g.restore();
                hg.fillStyle = '#c8c8c8'; hg.fillRect((bx + 4) * k, (y + 4) * k, (sh - 8) * k, (sh - 8) * k);
            }
        }
        return [c, hc];
    }

    function ceilingCoffers(th, seed, S) {
        const [c, g] = cv2(S, S), [hc, hg] = cv2(S / 2, S / 2), R = rng(seed);
        g.fillStyle = rgb(th.base, 0, 0.42); g.fillRect(0, 0, S, S); hg.fillStyle = '#e0e0e0'; hg.fillRect(0, 0, S / 2, S / 2);
        const m = S * 0.12;
        g.fillStyle = rgb(th.base, 0, 0.26); g.fillRect(m, m, S - 2 * m, S - 2 * m);
        g.strokeStyle = rgb(th.base, 0, 0.62); g.lineWidth = 4; g.strokeRect(m, m, S - 2 * m, S - 2 * m);
        hg.fillStyle = '#505050'; hg.fillRect(m / 2, m / 2, (S - 2 * m) / 2, (S - 2 * m) / 2);
        weather(g, 0, 0, S, S, R, th, 1.6);
        const d = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.7); d.addColorStop(0, 'rgba(0,0,0,0)'); d.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = d; g.fillRect(0, 0, S, S);
        return [c, hc];
    }

    /** low massive plinth blocks (0.9 m high: 512x230 px = 2 m wide) */
    function plinthTex(th, seed) {
        const S = 512, W = S, H = 230, [c, g] = cv2(W, H), [hc, hg] = cv2(W / 2, H / 2), R = rng(seed);
        g.fillStyle = rgb(th.mortar, 0); g.fillRect(0, 0, W, H); hg.fillStyle = '#282828'; hg.fillRect(0, 0, W / 2, H / 2);
        let x = -R() * 80;
        while (x < W) {
            const bw = 190 + R() * 160, j = (R() - 0.5) * 22;
            for (const ox of [0, -W, W]) {
                const bx = x + ox; if (bx + bw < 0 || bx > W) continue;
                blockPath(g, bx + 3, 3, bw - 6, H - 8, R, 6); g.fillStyle = rgb(th.base, j, 0.62 + R() * 0.12); g.fill();
                g.save(); g.clip(); weather(g, bx, 0, bw, H, R, th, 1.2);
                g.fillStyle = 'rgba(255,235,200,0.14)'; g.fillRect(bx, 0, bw, 10);               // moulded top edge
                g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(bx, 12, bw, 4);
                g.restore();
                hg.fillStyle = '#c0c0c0'; hg.fillRect((bx + 4) / 2, 4 / 2, (bw - 8) / 2, (H - 8) / 2);
                hg.fillStyle = '#f0f0f0'; hg.fillRect((bx + 4) / 2, 4 / 2, (bw - 8) / 2, 5);
            }
            x += bw;
        }
        return [c, hc];
    }

    /** carved frieze band (2 m x 1 m = 512 x 256) with a theme motif, drawn as relief (dark shadow + light stroke) */
    function friezeTex(themeId, th, seed) {
        const W = 512, H = 256, [c, g] = cv2(W, H), [hc, hg] = cv2(W / 2, H / 2), R = rng(seed);
        g.fillStyle = rgb(th.base, 0, 0.55); g.fillRect(0, 0, W, H); hg.fillStyle = '#707070'; hg.fillRect(0, 0, W / 2, H / 2);
        weather(g, 0, 0, W, H, R, th, 1.2);
        const gl = th.glyph, lite = `rgba(${gl[0]},${gl[1]},${gl[2]},0.85)`, shade = 'rgba(0,0,0,0.65)';
        const carve = (fn) => { for (const [ox, oy, col, hh] of [[2.5, 2.5, shade, '#101010'], [0, 0, lite, '#f4f4f4']]) { g.save(); g.translate(ox, oy); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 5; g.lineCap = g.lineJoin = 'round'; fn(g, 1); g.restore(); hg.save(); hg.scale(0.5, 0.5); hg.translate(ox, oy); hg.strokeStyle = hh; hg.fillStyle = hh; hg.lineWidth = 5; hg.lineCap = hg.lineJoin = 'round'; fn(hg, 1); hg.restore(); } };
        // mouldings top and bottom
        carve((q) => { q.lineWidth = 4; q.beginPath(); q.moveTo(0, 20); q.lineTo(W, 20); q.moveTo(0, 32); q.lineTo(W, 32); q.moveTo(0, H - 20); q.lineTo(W, H - 20); q.moveTo(0, H - 32); q.lineTo(W, H - 32); q.stroke(); });
        const cy = H / 2;
        const motifs = {
            hub: (q) => { for (let i = 0; i < 4; i++) { const x = 64 + i * 128; q.beginPath(); q.arc(x, cy, 46, 0, 7); q.stroke(); q.beginPath(); const up = i % 2 === 0; q.moveTo(x, cy + (up ? -28 : 28)); q.lineTo(x + 25, cy + (up ? 20 : -20)); q.lineTo(x - 25, cy + (up ? 20 : -20)); q.closePath(); q.stroke(); if (i > 1) { q.beginPath(); q.moveTo(x - 20, cy + 2); q.lineTo(x + 20, cy + 2); q.stroke(); } } },
            water: (q) => { q.lineWidth = 6; for (const dy of [-26, 6, 38]) { q.beginPath(); for (let x = 0; x <= W; x += 8) { const y = cy + dy + Math.sin(x / 512 * Math.PI * 8) * 14; x ? q.lineTo(x, y) : q.moveTo(x, y); } q.stroke(); } },
            fire: (q) => { for (let i = 0; i < 8; i++) { const x = 32 + i * 64; q.beginPath(); q.moveTo(x, cy + 50); q.bezierCurveTo(x - 34, cy + 10, x + 6, cy - 14, x - 4, cy - 54); q.bezierCurveTo(x + 40, cy - 20, x + 34, cy + 20, x, cy + 50); q.stroke(); } },
            air: (q) => { for (let i = 0; i < 4; i++) { const x = 64 + i * 128; q.beginPath(); for (let a = 0; a < 11; a += 0.2) { const r = 5 + a * 4.2; const px = x + Math.cos(a) * r, py = cy + Math.sin(a) * r * 0.9; a ? q.lineTo(px, py) : q.moveTo(px, py); } q.stroke(); } },
            stone: (q) => { q.lineWidth = 6; q.beginPath(); const s = 28; for (let i = 0; i < 9; i++) { const x = i * 64; q.moveTo(x, cy + s); q.lineTo(x, cy - s); q.lineTo(x + 40, cy - s); q.lineTo(x + 40, cy + 6); q.lineTo(x + 16, cy + 6); q.lineTo(x + 16, cy - 14); q.lineTo(x + 28, cy - 14); } q.stroke(); },
            boss: (q) => { for (let i = 0; i < 4; i++) { const x = 64 + i * 128; q.beginPath(); q.arc(x, cy, 34, 0, 7); q.stroke(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; q.beginPath(); q.moveTo(x + Math.cos(a) * 34, cy + Math.sin(a) * 34); q.lineTo(x + Math.cos(a) * 56, cy + Math.sin(a) * 56); q.stroke(); } q.beginPath(); q.arc(x, cy, 8, 0, 7); q.fill(); } }
        };
        carve(motifs[themeId] || motifs.hub);
        return [c, hc];
    }

    function columnTex(th, seed) {
        const S = 256, [c, g] = cv2(S, S), [hc, hg] = cv2(S / 2, S / 2), R = rng(seed);
        g.fillStyle = rgb(th.base, 0, 0.9); g.fillRect(0, 0, S, S); hg.fillStyle = '#d0d0d0'; hg.fillRect(0, 0, S / 2, S / 2);
        const fl = 16;
        for (let i = 0; i < fl; i++) {                                  // flutes: dark groove + highlight
            const x = i * S / fl, w = S / fl;
            const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.18, 'rgba(0,0,0,0.05)'); gr.addColorStop(0.6, 'rgba(255,235,200,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
            g.fillStyle = gr; g.fillRect(x, 0, w, S);
            const hgr = hg.createLinearGradient(x / 2, 0, (x + w) / 2, 0); hgr.addColorStop(0, '#202020'); hgr.addColorStop(0.5, '#f0f0f0'); hgr.addColorStop(1, '#202020');
            hg.fillStyle = hgr; hg.fillRect(x / 2, 0, w / 2, S / 2);
        }
        weather(g, 0, 0, S, S, R, th, 1.2);
        return [c, hc];
    }

    function woodTex(seed) {
        const S = 128, [c, g] = cv2(S, S), R = rng(seed);
        g.fillStyle = 'rgb(58,44,32)'; g.fillRect(0, 0, S, S);
        for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${R() < 0.5 ? '20,12,6' : '110,84,56'},${0.12 + R() * 0.2})`; g.lineWidth = 1 + R() * 2; const y = R() * S; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + (R() - 0.5) * 8, S * 0.6, y + (R() - 0.5) * 8, S, y + (R() - 0.5) * 6); g.stroke(); }
        return c;
    }

    function runeRingTexture(color) {
        const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
        const g = c.getContext('2d'); g.translate(S / 2, S / 2);
        g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round';
        const ring = (r, w, a) => { g.globalAlpha = a; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
        ring(240, 6, 0.9); ring(228, 2, 0.6); ring(150, 4, 0.8); ring(140, 2, 0.5); ring(60, 3, 0.8);
        g.globalAlpha = 0.85;
        for (let i = 0; i < 32; i++) {                      // rune ticks between the outer rings
            const a = i / 32 * Math.PI * 2; g.save(); g.rotate(a); g.lineWidth = 3;
            g.beginPath(); g.moveTo(0, -184); g.lineTo(0, -(205 + (i % 3) * 8)); g.stroke();
            if (i % 2) { g.beginPath(); g.moveTo(-7, -192); g.lineTo(7, -200); g.stroke(); }
            g.restore();
        }
        g.lineWidth = 3;                                    // 4-pointed star inside
        for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * Math.PI / 2); g.beginPath(); g.moveTo(0, -140); g.lineTo(18, -60); g.lineTo(0, -20); g.lineTo(-18, -60); g.closePath(); g.stroke(); g.restore(); }
        g.globalAlpha = 1;
        const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
        return t;
    }

    /** inlaid floor medallion: sandstone disc, dark and gold bands, compass star, rune ticks (opaque decal, round) */
    function medallionTexture(th) {
        const S = 1024, [c, g] = cv2(S, S), R = rng(77); g.translate(S / 2, S / 2);
        const gl = th.glyph, gold = `rgb(${Math.min(255, gl[0] + 25)},${Math.min(255, gl[1] + 20)},${Math.min(255, gl[2])})`;
        const disc = (r, col) => { g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); };
        const band = (r, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
        disc(506, rgb(th.mortar, 0, 0.8)); disc(496, rgb(th.base, 0, 0.78)); band(470, 10, rgb(th.mortar, 0, 1.2)); band(452, 5, gold);
        disc(440, rgb(th.base, 4, 0.95));
        for (let i = 0; i < 48; i++) { g.save(); g.rotate(i / 48 * Math.PI * 2); g.strokeStyle = i % 4 ? rgb(th.mortar, 0, 1.4) : gold; g.lineWidth = i % 4 ? 5 : 7; g.beginPath(); g.moveTo(0, -392); g.lineTo(0, -(414 + (i % 2) * 10)); g.stroke(); g.restore(); }
        band(372, 8, rgb(th.mortar, 0, 1.2)); band(356, 4, gold); band(250, 6, rgb(th.mortar, 0, 1.2)); band(238, 3, gold);
        disc(228, rgb(th.base, 0, 0.7));
        for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4); const L = i % 2 ? 190 : 330, W = i % 2 ? 26 : 40;
            g.beginPath(); g.moveTo(0, -L); g.lineTo(W, -60); g.lineTo(0, -10); g.lineTo(-W, -60); g.closePath();
            g.fillStyle = i % 2 ? rgb(th.mortar, 0, 1.3) : gold; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3; g.stroke(); g.restore(); }
        disc(46, rgb(th.mortar, 0, 1.2)); band(46, 6, gold);
        const sh = g.createRadialGradient(0, 0, 100, 0, 0, 510); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.28)'); g.fillStyle = sh; disc(510, sh);
        for (let n = 0; n < 160; n++) { g.fillStyle = R() < 0.5 ? 'rgba(60,40,20,0.05)' : 'rgba(255,235,200,0.05)'; const a = R() * 6.28, r = Math.sqrt(R()) * 500; g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 8 + R() * 20, 4 + R() * 10); }
        const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
    }

    /** hanging banner cloth with border, theme emblem and swallow-tail (alpha-cut) */
    function bannerTex(themeId, th) {
        const W = 128, H = 320, [c, g] = cv2(W, H);
        const cloth = { hub: '#7a1f1a', fire: '#8a2410', water: '#1d4f7a', air: '#8fa6bd', stone: '#7a5a1e', boss: '#3f2a63', magma: '#5a1208', obsidian: '#2a1f3a' }[themeId] || '#7a1f1a';
        const gl = th.glyph, gold = `rgb(${Math.min(255, gl[0] + 30)},${Math.min(255, gl[1] + 20)},${Math.min(255, gl[2])})`;
        g.beginPath(); g.moveTo(4, 0); g.lineTo(W - 4, 0); g.lineTo(W - 4, H - 4); g.lineTo(W / 2, H - 52); g.lineTo(4, H - 4); g.closePath();
        g.fillStyle = cloth; g.fill(); g.save(); g.clip();
        for (let x = 0; x < W; x += 3) { g.fillStyle = `rgba(0,0,0,${0.03 + (x % 9 === 0 ? 0.05 : 0)})`; g.fillRect(x, 0, 1, H); }
        const sh = g.createLinearGradient(0, 0, 0, H); sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = sh; g.fillRect(0, 0, W, H);
        g.strokeStyle = gold; g.lineWidth = 5; g.beginPath(); g.moveTo(11, 8); g.lineTo(W - 11, 8); g.lineTo(W - 11, H - 14); g.lineTo(W / 2, H - 62); g.lineTo(11, H - 14); g.closePath(); g.stroke();
        g.lineWidth = 3; g.strokeStyle = gold; g.fillStyle = gold;
        g.beginPath(); g.arc(W / 2, 112, 34, 0, 7); g.stroke(); g.beginPath(); g.arc(W / 2, 112, 22, 0, 7); g.stroke();
        g.beginPath(); g.moveTo(W / 2, 80); g.lineTo(W / 2 + 12, 112); g.lineTo(W / 2, 144); g.lineTo(W / 2 - 12, 112); g.closePath(); g.fill();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * 38, 112 + Math.sin(a) * 38); g.lineTo(W / 2 + Math.cos(a) * 50, 112 + Math.sin(a) * 50); g.stroke(); }
        g.beginPath(); g.moveTo(26, 196); g.lineTo(W - 26, 196); g.moveTo(34, 210); g.lineTo(W - 34, 210); g.stroke();
        for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(W / 2 - 22 + i * 22, 224); g.lineTo(W / 2 - 22 + i * 22, 246 - (i === 1 ? 0 : 8)); g.stroke(); }
        g.restore();
        const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
    }

    function glowTexture() {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        [[0, 1], [0.3, 0.55], [0.65, 0.15], [1, 0]].forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    // ------------------------------------------------------------------ geometry accumulator
    class Acc {
        constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
        /** quad p0..p3 (counter-clockwise seen from the side the normal n points to); uv in metres/2 */
        quad(p0, p1, p2, p3, n, uvs) {
            const b = this.pos.length / 3;
            [p0, p1, p2, p3].forEach((p, i) => { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uvs[i][0], uvs[i][1]); });
            // winding check against the requested normal
            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
            const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
            if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
            else this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        }
        geometry() {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
            g.setIndex(this.idx);
            return g;
        }
    }

    class AveloraTemple {
        constructor(scene, config = {}, terrain = null, pathfinder = null) {
            this.scene = scene; this.config = config; this.terrain = terrain; this.pathfinder = pathfinder;
            this.group = new THREE.Group(); this.group.name = `temple:${config.id || 'temple'}`;
            this.scene.add(this.group);
            this.fires = []; this.lights = []; this.flames = []; this.geometries = []; this.materials = []; this.textures = [];
            this.pillars = [];                 // [x, z, r] — collision + camera blockers
            this.disposed = false;
            this.glowTex = glowTexture(); this.textures.push(this.glowTex);
            this._rasterize();
            this._buildShell();
            this._buildDoorFrames();
            this._buildRooms();
            this._buildSeal();
            this._registerColliders();
        }

        // -------------------------------------------------------------- raster
        _rasterize() {
            const rooms = this.config.rooms || [];
            let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
            rooms.forEach(r => { x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1); z1 = Math.max(z1, r.z1); });
            this.ox = Math.floor(x0 / CELL) * CELL - CELL; this.oz = Math.floor(z0 / CELL) * CELL - CELL;
            this.nx = Math.ceil((x1 - this.ox) / CELL) + 2; this.nz = Math.ceil((z1 - this.oz) / CELL) + 2;
            this.H = new Float32Array(this.nx * this.nz);          // ceiling height, 0 = solid
            this.T = new Uint8Array(this.nx * this.nz);            // theme index + 1
            const order = rooms.map((r, i) => i).sort((a, b) => ((rooms[a].theme === 'door') - (rooms[b].theme === 'door')) || a - b);
            order.forEach(ri => {
                const r = rooms[ri], ti = Math.max(0, THEME_IDS.indexOf(r.theme === 'door' ? 'hub' : r.theme)) + 1;
                const i0 = Math.round((r.x0 - this.ox) / CELL), i1 = Math.round((r.x1 - this.ox) / CELL);
                const j0 = Math.round((r.z0 - this.oz) / CELL), j1 = Math.round((r.z1 - this.oz) / CELL);
                for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
                    const k = j * this.nx + i;
                    if (r.theme === 'door' && this.H[k]) { this.H[k] = Math.max(this.H[k], r.h); continue; }
                    if (!this.H[k]) this.T[k] = ti;
                    this.H[k] = Math.max(this.H[k], r.h);
                }
            });
        }
        _k(i, j) { return j * this.nx + i; }
        _cellAt(x, z) { const i = Math.floor((x - this.ox) / CELL), j = Math.floor((z - this.oz) / CELL); return (i < 0 || j < 0 || i >= this.nx || j >= this.nz) ? -1 : j * this.nx + i; }
        heightAt(x, z) { const k = this._cellAt(x, z); return k < 0 ? 0 : this.H[k]; }

        // -------------------------------------------------------------- shell (floor / ceiling / walls)
        _tex(pair, bump) {
            const t = toTex(pair[0]); this.textures.push(t);
            const o = { map: t }; 
            if (pair[1]) { const h = toTex(pair[1]); this.textures.push(h); o.bumpMap = h; o.bumpScale = bump || 1.6; }
            return o;
        }
        _themeMats(ti) {
            this._mats = this._mats || {};
            if (this._mats[ti]) return this._mats[ti];
            const id = THEME_IDS[ti - 1] || 'hub', th = THEMES[id];
            const mk = (pair, rough, bump) => { const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: rough, metalness: 0.0 }, this._tex(pair, bump))); this.materials.push(m); return m; };
            return (this._mats[ti] = {
                wall: mk(masonry(th, 11 + ti, 512), 0.95, 2.2),
                wallP: mk(panelWall(th, 11 + ti), 0.95, 2.2),
                plinth: mk(plinthTex(th, 21 + ti), 0.95, 2.0),
                frieze: mk(friezeTex(id, th, 41 + ti), 0.9, 2.6),
                floor: mk(floorSlabs(th, 31 + ti, 512), 0.85, 1.8),
                ceil: mk(ceilingCoffers(th, 51 + ti, 256), 0.97, 2.0)
            });
        }

        _buildShell() {
            const nx = this.nx, nz = this.nz, H = this.H, T = this.T;
            const acc = {};                                      // `${ti}:${kind}` -> Acc
            const A = (ti, kind) => acc[ti + ':' + kind] || (acc[ti + ':' + kind] = new Acc());
            const X = i => this.ox + i * CELL, Z = j => this.oz + j * CELL;
            // floor + ceiling, merged along x
            for (let j = 0; j < nz; j++) {
                let i = 0;
                while (i < nx) {
                    const k = this._k(i, j);
                    if (!H[k]) { i++; continue; }
                    let e = i + 1;
                    while (e < nx && H[this._k(e, j)] === H[k] && T[this._k(e, j)] === T[k]) e++;
                    const xa = X(i), xb = X(e), za = Z(j), zb = Z(j + 1), h = H[k], ti = T[k];
                    A(ti, 'floor').quad([xa, 0, za], [xb, 0, za], [xb, 0, zb], [xa, 0, zb], [0, 1, 0], [[xa / 4, za / 4], [xb / 4, za / 4], [xb / 4, zb / 4], [xa / 4, zb / 4]]);
                    A(ti, 'ceil').quad([xa, h, za], [xb, h, za], [xb, h, zb], [xa, h, zb], [0, -1, 0], [[xa / 2, za / 2], [xb / 2, za / 2], [xb / 2, zb / 2], [xa / 2, zb / 2]]);
                    i = e;
                }
            }
            // walls on X-edges (faces looking along ±z), merged along x
            const wallRun = (alongX) => {
                const n1 = alongX ? nz : nx, n2 = alongX ? nx : nz;
                for (let a = 0; a < n1 - 1; a++) {            // edge between line a and a+1
                    let b = 0;
                    while (b < n2) {
                        const ka = alongX ? this._k(b, a) : this._k(a, b), kb = alongX ? this._k(b, a + 1) : this._k(a + 1, b);
                        const ha = H[ka], hb = H[kb];
                        if (ha === hb) { b++; continue; }                                                // solid/solid or open at the same height
                        // face: toward the taller open side (or the only open side)
                        const toB = hb > ha, lo = Math.min(ha, hb), hi = Math.max(ha, hb), ti = T[toB ? kb : ka];
                        let e = b + 1;
                        while (e < n2) {
                            const ka2 = alongX ? this._k(e, a) : this._k(a, e), kb2 = alongX ? this._k(e, a + 1) : this._k(a + 1, e);
                            if (H[ka2] === ha && H[kb2] === hb && T[toB ? kb2 : ka2] === ti) e++; else break;
                        }
                        const s0 = (alongX ? X(b) : Z(b)), s1 = (alongX ? X(e) : Z(e)), pl = (alongX ? Z(a + 1) : X(a + 1));
                        const len0 = s0 / 2, len1 = s1 / 2;
                        const n = alongX ? [0, 0, toB ? 1 : -1] : [toB ? 1 : -1, 0, 0];
                        const P = (s, y) => alongX ? [s, y, pl] : [pl, y, s];
                        const PLH = 0.9, FRH = 1.0;                       // plinth at the floor, carved frieze under the ceiling
                        const zone = (y0, y1, kind, v0, v1) => { if (y1 - y0 < 0.01) return; A(ti, kind).quad(P(s0, y0), P(s1, y0), P(s1, y1), P(s0, y1), n, (kind === 'wallP' ? [[0, v0], [un, v0], [un, v1], [0, v1]] : [[len0, v0], [len1, v0], [len1, v1], [len0, v1]])); };
                        const un = Math.max(1, Math.round((s1 - s0) / 3));                // целое число панелей на отрезок стены: узор не режется
                        const yPl = Math.min(hi, PLH), yFr = Math.max(lo, PLH, hi - FRH);
                        if (lo < yPl) zone(lo, yPl, 'plinth', lo / PLH, yPl / PLH);
                        const wy0 = Math.max(lo, PLH), wy1 = hi - FRH;
                        if (wy1 > wy0) { const wh = (hi - FRH) - PLH, PH = wh > 6.6 ? 5.6 : wh, wtop = PLH + PH;   // высокий зал: панель как в хабах, выше неё простая кладка
                            if (s1 - s0 < 1.9) zone(wy0, wy1, 'wall', wy0 / 2, wy1 / 2);   // узкий простенок: простая кладка без панели
                            else {
                                const pb = Math.min(wy1, wtop); if (pb > wy0) zone(wy0, pb, 'wallP', (wy0 - PLH) / PH, (pb - PLH) / PH);
                                const a2 = Math.max(wy0, wtop); if (wy1 > a2) zone(a2, wy1, 'wall', a2 / 2, wy1 / 2);
                            } }
                        if (hi > yFr) zone(yFr, hi, 'frieze', (yFr - (hi - FRH)) / FRH, 1);
                        b = e;
                    }
                }
            };
            wallRun(true); wallRun(false);
            Object.keys(acc).forEach(key => {
                const [ti, kind] = key.split(':'), geo = acc[key].geometry();
                this.geometries.push(geo);
                const m = new THREE.Mesh(geo, this._themeMats(+ti)[kind]);
                m.receiveShadow = false; this.group.add(m);
            });
        }

        // -------------------------------------------------------------- door frames
        /** BoxGeometry whose UVs follow the surface in metres (texture tiles 2 m) so stone blocks keep their scale */
        _uvBox(w, h, d, ox, oy, oz) {
            const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
            for (let i = 0; i < p.count; i++) {
                const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
                const x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i) + oz;
                if (ax >= ay && ax >= az) uv.setXY(i, z / 2, y / 2); else if (ay >= az) uv.setXY(i, x / 2, z / 2); else uv.setXY(i, x / 2, y / 2);
            }
            return g;
        }
        _stoneBox(w, h, d, x, y, z, mat) {
            const g = this._uvBox(w, h, d, x, y, z); this.geometries.push(g);
            const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); this.group.add(o); return o;
        }
        _buildDoorFrames() {
            const hubM = this._themeMats(1);
            const mat = hubM.plinth, mw = hubM.wall;
            const box = (w, h, d, x, y, z, m) => this._stoneBox(w, h, d, x, y, z, m || mat);
            (this.config.doors || []).forEach(d => {
                const ax = d.axis === 'x', w = d.w || 5;                       // axis 'x': wall normal along x
                // height = ceiling of the LOWER side of the opening, so the lintel sits flush under the passage ceiling
                const sample = (o) => this.heightAt(d.x + (ax ? o : 0), d.z + (ax ? 0 : o));
                const hs = [sample(-1.2), sample(1.2), sample(-2.2), sample(2.2)].filter(v => v > 0);
                const H = hs.length ? Math.min.apply(null, hs) : 4.2;
                const IN = 0.07, T = 0.8, half = w / 2 - IN;                    // inner faces 7 cm proud of the opening edge
                const yB = 0.5, yC = H - 0.95, yL = H - 0.7;                    // base top / capital bottom / lintel bottom
                for (const s of [-1, 1]) {
                    const c = half + T / 2;
                    const px = ax ? d.x : d.x + s * c, pz = ax ? d.z + s * c : d.z;
                    const ox = ax ? d.x : d.x + s * (c + 0.15), oz = ax ? d.z + s * (c + 0.15) : d.z;   // base / capital grow outward only
                    const sz = (a, b2) => ax ? [a, 0, b2] : [b2, 0, a];                                 // (along-normal, along-wall) -> (x, y, z) sizes
                    const [bx, , bz] = sz(1.0, T), [gx, , gz] = sz(1.2, T + 0.3);
                    box(bx, yC - yB, bz, px, (yB + yC) / 2, pz, mw);                                     // shaft: starts above the base, ends under the capital
                    box(gx, yB, gz, ox, yB / 2, oz, mat);                                                // base
                    this.blockers = this.blockers || []; this.blockers.push([ox - gx / 2 - 0.12, ox + gx / 2 + 0.12, oz - gz / 2 - 0.12, oz + gz / 2 + 0.12]);   // пилястра непроходима (герой не залезает в текстуры)
                    box(gx, 0.25, gz, ox, (yC + yL) / 2, oz, mat);                                       // capital
                }
                const lw = w + 2 * T + 0.5;
                if (ax) box(1.1, 0.7, lw, d.x, H - 0.35, d.z, mat); else box(lw, 0.7, 1.1, d.x, H - 0.35, d.z, mat);   // lintel, flush with the ceiling
            });
        }

        // -------------------------------------------------------------- room dressing
        _buildRooms() {
            const rooms = this.config.rooms || [];
            const doors = this.config.doors || [];
            const nearDoor = (x, z, r) => doors.some(d => Math.abs(d.x - x) < (d.axis === 'x' ? 2.2 : (d.w || 5) / 2 + 1.5 + r) && Math.abs(d.z - z) < (d.axis === 'x' ? (d.w || 5) / 2 + 1.5 + r : 2.2));
            rooms.forEach(r => {
                if (r.theme === 'door') return;
                const th = THEMES[r.theme] || THEMES.hub, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
                // rune ring on the floor
                if (r.ring) {
                    const mt = medallionTexture(th); this.textures.push(mt);
                    const mm = new THREE.MeshStandardMaterial({ map: mt, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); this.materials.push(mm);
                    const mg = new THREE.PlaneGeometry(r.ring * 2, r.ring * 2).rotateX(-Math.PI / 2); this.geometries.push(mg);
                    const mo = new THREE.Mesh(mg, mm); mo.position.set(cx, 0.02, cz); mo.renderOrder = 2; this.group.add(mo);
                    const t = runeRingTexture(th.rune); this.textures.push(t);
                    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
                    this.materials.push(m);
                    const g = new THREE.PlaneGeometry(r.ring * 2, r.ring * 2).rotateX(-Math.PI / 2); this.geometries.push(g);
                    const o = new THREE.Mesh(g, m); o.position.set(cx, 0.03, cz); o.renderOrder = 3; this.group.add(o);
                    this.rings = this.rings || []; this.rings.push(m);
                }
                // thick fluted columns at explicit positions (r.cols = [[x, z], ...]), never in a passage
                if (Array.isArray(r.cols)) r.cols.forEach(c => this._column(c[0], c[1], r.h, th, r.colR || 0.85, r.theme));
                // ceiling beams (dark wood, ends buried in the walls)
                if (r.beams) {
                    if (!this._beamMat) { const wt = new THREE.CanvasTexture(woodTex(5)); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; this.textures.push(wt); this._beamMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.9 }); this.materials.push(this._beamMat); }
                    const long = (r.x1 - r.x0) >= (r.z1 - r.z0);
                    for (let a = (long ? r.x0 : r.z0) + 3; a < (long ? r.x1 : r.z1) - 1; a += (r.beams === true ? 6 : r.beams)) {
                        const len = (long ? r.z1 - r.z0 : r.x1 - r.x0) + 0.4;
                        this._stoneBox(long ? 0.8 : len, 0.7, long ? len : 0.8, long ? a : cx, r.h - 0.33, long ? cz : a, this._beamMat);
                    }
                }
                // braziers / flames at the corners (coloured per theme) + one light per room
                (r.flames || []).forEach(f => this._flame(f[0], f[1], th, r.theme === 'fire' || r.theme === 'hub'));
                (r.lights || []).forEach(l => this._light(l[0], l[1], l[2], th.tint, l[3] || 1.3, l[4] || 16));
                (r.props || []).forEach(p => this._prop(p, th, r));
                this._dress(r, th, nearDoor);
            });
        }

        /** wall torches (every 6 m) and banners (between them) along the long walls of big rooms */
        _dress(r, th, nearDoor) {
            const w = r.x1 - r.x0, d = r.z1 - r.z0;
            if (Math.min(w, d) < 9 || r.theme === 'door') return;
            const long = w >= d, len = long ? w : d, big = Math.min(w, d) >= 12;
            const walls = long ? [[r.z0, 1], [r.z1, -1]] : [[r.x0, 1], [r.x1, -1]];
            const tid = r.theme;
            if (!this._banMats) this._banMats = {};
            if (big && !this._banMats[tid]) {
                const t = bannerTex(tid, th); this.textures.push(t);
                const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5 }); this.materials.push(m); this._banMats[tid] = m;
            }
            if (!this._torchSp) {
                this._torchMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffa648, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); this.materials.push(this._torchMat);
                this._torchCore = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }); this.materials.push(this._torchCore);
                this._torchSp = true;
            }
            const iron = this._ironMat || (this._ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.7 }));
            const rodMat = iron;
            walls.forEach(([pl, dir]) => {
                for (let a = 3; a < len - 2; a += 3) {
                    const pos = (long ? r.x0 : r.z0) + a, odd = Math.round(a / 3) % 2;
                    const x = long ? pos : pl + dir * 0.0, z = long ? pl : pos;
                    const wx = long ? pos : pl, wz = long ? pl : pos, nx = long ? 0 : dir, nz = long ? dir : 0;
                    if (nearDoor(wx, wz, 1.4) || (nearDoor(wx + nx * 2, wz + nz * 2, 0.6))) continue;
                    if (odd === 0) {                                              // torch
                        const g1 = new THREE.BoxGeometry(long ? 0.14 : 0.34, 0.5, long ? 0.34 : 0.14); this.geometries.push(g1);
                        const br = new THREE.Mesh(g1, iron); br.position.set(wx + nx * 0.18, 2.35, wz + nz * 0.18); this.group.add(br);
                        const g2 = new THREE.CylinderGeometry(0.15, 0.07, 0.28, 8); this.geometries.push(g2);
                        const cup = new THREE.Mesh(g2, iron); cup.position.set(wx + nx * 0.36, 2.72, wz + nz * 0.36); this.group.add(cup);
                        const sp = new THREE.Sprite(this._torchMat); sp.scale.set(0.9, 1.3, 1); sp.position.set(wx + nx * 0.36, 3.15, wz + nz * 0.36); this.group.add(sp);
                        const core = new THREE.Sprite(this._torchCore); core.scale.set(0.3, 0.5, 1); core.position.set(wx + nx * 0.36, 2.98, wz + nz * 0.36); this.group.add(core);
                        this.torches = this.torches || []; this.torches.push({ sp, core, seed: Math.random() * 10 });
                    } else if (big) {                                              // banner
                        const bh = 3.6, bw = 1.3, top = r.h - 1.15;
                        const g3 = new THREE.PlaneGeometry(bw, bh); this.geometries.push(g3);
                        const bm = new THREE.Mesh(g3, this._banMats[tid]);
                        bm.position.set(wx + nx * 0.07, top - bh / 2, wz + nz * 0.07); bm.rotation.y = long ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2); this.group.add(bm);
                        const g4 = new THREE.CylinderGeometry(0.045, 0.045, bw + 0.3, 6); this.geometries.push(g4);
                        const rod = new THREE.Mesh(g4, rodMat); rod.rotation.z = long ? Math.PI / 2 : 0; rod.rotation.x = long ? 0 : Math.PI / 2;
                        rod.position.set(wx + nx * 0.09, top + 0.02, wz + nz * 0.09); this.group.add(rod);
                    }
                }
            });
        }

        _column(x, z, h, th, R, themeId) {
            const ti = THEME_IDS.indexOf(themeId) + 1 || 1, key = 'col' + ti;
            if (!this._colMats) this._colMats = {};
            if (!this._colMats[key]) { const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9 }, this._tex(columnTex(THEMES[themeId] || THEMES.hub, 70 + ti), 2.4))); this.materials.push(m); this._colMats[key] = m; }
            const shaft = this._colMats[key], stone = this._themeMats(ti).plinth;
            const add = (g, y, m) => { this.geometries.push(g); const o = new THREE.Mesh(g, m); o.position.set(x, y, z); this.group.add(o); };
            const bw = R * 2.5, bh = 0.5, cap = 0.45;
            const sh = h - bh - cap - 0.5;
            this._stoneBox(bw, bh, bw, x, bh / 2, z, stone);                                              // plinth
            add(new THREE.CylinderGeometry(R * 0.86, R, sh, 20, 1), bh + sh / 2, shaft);                  // fluted shaft (slight taper)
            add(new THREE.CylinderGeometry(R * 1.12, R * 0.9, 0.3, 20), bh + sh + 0.15, stone);           // echinus
            this._stoneBox(bw * 1.05, cap, bw * 1.05, x, bh + sh + 0.3 + cap / 2, z, stone);              // abacus
            this._stoneBox(bw * 1.25, 0.35, bw * 1.25, x, h - 0.175, z, stone);                           // architrave block against the ceiling
            this.pillars.push([x, z, R * 1.15]);
        }

        /** постоянный свет комнаты: без мерцания и без переключения источников (яркость не меняется при входе в проход) */
        _light(x, y, z, color, intensity, dist) {
            const l = new THREE.PointLight(color, intensity, dist, 2.0); l.position.set(x, y, z); this.group.add(l);
            this.lights.push({ light: l, baseIntensity: intensity });
        }

        _flame(x, z, th, useRealFire) {
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.9, 10), this._ironMat || (this._ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.7 })));
            this.geometries.push(base.geometry); this.materials.push(this._ironMat);
            base.position.set(x, 0.45, z); this.group.add(base);
            const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.2, 12), this._ironMat); this.geometries.push(bowl.geometry);
            bowl.position.set(x, 1.0, z); this.group.add(bowl);
            this.pillars.push([x, z, 0.5]);
            if (useRealFire && window.AveloraFire) {
                const f = new window.AveloraFire(this.group, { x, y: 1.1, z, size: 0.5, seed: (x * 7 + z * 13) | 0 }); f._wx = x; f._wz = z; this.fires.push(f);
            } else {
                const mat = new THREE.SpriteMaterial({ map: this.glowTex, color: th.tint, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); this.materials.push(mat);
                const sp = new THREE.Sprite(mat); sp.scale.set(1.6, 2.0, 1); sp.position.set(x, 1.7, z); this.group.add(sp);
                const core = new THREE.Sprite(mat.clone()); core.material.color.setHex(0xffffff); core.material.opacity = 0.7; this.materials.push(core.material);
                core.scale.set(0.5, 0.8, 1); core.position.set(x, 1.45, z); this.group.add(core);
                this.flames.push({ sp, core, seed: Math.random() * 10, y: 1.7 });
            }
        }

        /** extra dressing by type: 'pool' (water), 'lava' (fire), 'dais' (boss), 'obelisk' */
        _prop(p, th, r) {
            if (p.type !== 'pool' && p.type !== 'lava') return;
            const lava = p.type === 'lava', ti = THEME_IDS.indexOf(r.theme) + 1, stone = this._themeMats(ti).plinth;
            const [c, g] = cv2(256, 256), R = rng(lava ? 5 : 9);
            if (lava) {
                g.fillStyle = '#3a1408'; g.fillRect(0, 0, 256, 256);
                for (let n = 0; n < 26; n++) { g.strokeStyle = `rgba(255,${110 + (R() * 90) | 0},20,${0.55 + R() * 0.4})`; g.lineWidth = 2 + R() * 5; g.beginPath(); let x = R() * 256, y = R() * 256; g.moveTo(x, y); for (let q = 0; q < 6; q++) { x += (R() - 0.5) * 90; y += (R() - 0.5) * 90; g.lineTo(x, y); } g.stroke(); }
                for (let n = 0; n < 30; n++) { g.fillStyle = `rgba(30,8,2,${0.35 + R() * 0.3})`; const w = 14 + R() * 40; g.fillRect(R() * 256, R() * 256, w, 8 + R() * 22); }
            } else {
                const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#2d7fb0'); gr.addColorStop(1, '#1d5f8c'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
                for (let n = 0; n < 22; n++) { g.strokeStyle = `rgba(190,235,255,${0.12 + R() * 0.22})`; g.lineWidth = 2; g.beginPath(); const x = R() * 256, y = R() * 256, rr = 10 + R() * 40; g.ellipse(x, y, rr, rr * 0.5, 0, 0, 7); g.stroke(); }
            }
            const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Math.max(1, p.w / 3), Math.max(1, p.d / 3)); this.textures.push(t);
            const m = lava ? new THREE.MeshBasicMaterial({ map: t }) : new THREE.MeshStandardMaterial({ map: t, roughness: 0.2, metalness: 0.1, emissive: 0x0a3050, emissiveMap: t, emissiveIntensity: 0.5 });
            this.materials.push(m);
            const g1 = new THREE.PlaneGeometry(p.w, p.d).rotateX(-Math.PI / 2); this.geometries.push(g1);
            const o = new THREE.Mesh(g1, m); o.position.set(p.x, 0.34, p.z); this.group.add(o);
            this.scrollTex = this.scrollTex || []; this.scrollTex.push({ t, lava });
            // каменный бортик-чаша (0.4 м шириной, 0.45 м высотой) — непроходимый
            const rw = 0.45, rh = 0.45;
            this._stoneBox(p.w + rw * 2, rh, rw, p.x, rh / 2, p.z + p.d / 2 + rw / 2, stone);
            this._stoneBox(p.w + rw * 2, rh, rw, p.x, rh / 2, p.z - p.d / 2 - rw / 2, stone);
            this._stoneBox(rw, rh, p.d, p.x + p.w / 2 + rw / 2, rh / 2, p.z, stone);
            this._stoneBox(rw, rh, p.d, p.x - p.w / 2 - rw / 2, rh / 2, p.z, stone);
            this._stoneBox(p.w, 0.3, p.d, p.x, 0.15, p.z, stone);                                  // подушка под водой/лавой
            this.blockers = this.blockers || []; this.blockers.push([p.x - p.w / 2 - rw - 0.2, p.x + p.w / 2 + rw + 0.2, p.z - p.d / 2 - rw - 0.2, p.z + p.d / 2 + rw + 0.2]);
        }

        /** печать врат босса: мерцающая завеса в проёме + 4 знака хранителей; гаснет и открывает проход, когда все хранители убиты */
        _buildSeal() {
            const sc = this.config.seal; if (!sc) return;
            const w = sc.w || 4.8, h = sc.h || 4.3, z = sc.z;
            const [c, g] = cv2(256, 256), R = rng(33);
            const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(120,70,255,0.0)'); gr.addColorStop(0.5, 'rgba(150,100,255,0.55)'); gr.addColorStop(1, 'rgba(120,70,255,0.0)');
            g.fillStyle = 'rgba(70,40,160,0.55)'; g.fillRect(0, 0, 256, 256);
            for (let n = 0; n < 60; n++) { g.strokeStyle = `rgba(${170 + (R() * 70) | 0},${140 + (R() * 80) | 0},255,${0.15 + R() * 0.35})`; g.lineWidth = 1 + R() * 4; const x = R() * 256; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (R() - 0.5) * 80, 85, x + (R() - 0.5) * 80, 170, x + (R() - 0.5) * 40, 256); g.stroke(); }
            g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
            const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; this.textures.push(t);
            const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }); this.materials.push(mat);
            const geo = new THREE.PlaneGeometry(w, h); this.geometries.push(geo);
            const veil = new THREE.Mesh(geo, mat); veil.position.set(sc.x || 0, h / 2, z); veil.renderOrder = 4; this.group.add(veil);
            const cols = sc.colors || [0xff6a2a, 0x4fb4ff, 0xe6f6ff, 0xe0a040];
            this.sealGlyphs = [];
            this.seal = { veil, mat, tex: t, open: false, fade: 1, rect: [(sc.x || 0) - w / 2 - 0.1, (sc.x || 0) + w / 2 + 0.1, z - 0.3, z + 0.3] };
            this.blockers = this.blockers || []; this.blockers.push(this.seal.rect);
            this._light((sc.x || 0), 2.4, z - 1.2, 0x9a78ff, 1.1, 9);
        }
        /** flags[i] — i-й хранитель убит (вызывается из main.js); все убиты → печать гаснет, проход открыт */
        setGuardians(flags) {
            if (!this.seal || this.disposed) return;
            const first = !this._sealInit; this._sealInit = true;
            this.sealGlyphs.forEach((gl, i) => { gl.m.color.setHex(flags[i] ? gl.col : 0x555566); });
            const all = flags.length > 0 && flags.every(Boolean);
            if (all && !this.seal.open) {
                this.seal.open = true; if (first) this.seal.fade = 0;
                const i = this.blockers.indexOf(this.seal.rect); if (i >= 0) this.blockers.splice(i, 1);
                this._registerColliders();
            }
        }

        flareBraziers() { /* hook for boss intro */ }

        // -------------------------------------------------------------- walkability / collision
        _walkCell(x, z) { const k = this._cellAt(x, z); return k >= 0 && this.H[k] > 0; }
        _isWalkPoint(x, z) {
            if (!this._walkCell(x, z)) return false;
            for (let i = 0; i < this.pillars.length; i++) { const p = this.pillars[i]; if (Math.hypot(x - p[0], z - p[1]) < p[2] + 0.1) return false; }
            if (this.blockers) for (let i = 0; i < this.blockers.length; i++) { const b = this.blockers[i]; if (x > b[0] && x < b[1] && z > b[2] && z < b[3]) return false; }
            return true;
        }
        _registerColliders() {
            const pf = this.pathfinder;
            if (!pf || !pf.grid) return;
            const cw = pf.cellWidth, ch = pf.cellHeight, ox = Math.max(cw * 0.32, 0.92), oz = Math.max(ch * 0.32, 0.92);   // отступ центра клетки от стен ~0.9 м → игрок не ближе ~0.5 м
            for (let gz = 0; gz < pf.gridSizeZ; gz++) for (let gx = 0; gx < pf.gridSizeX; gx++) {
                const p = pf.gridToWorld(gx, gz);
                const ok = this._isWalkPoint(p.x, p.z) && this._isWalkPoint(p.x - ox, p.z - oz) && this._isWalkPoint(p.x + ox, p.z - oz)
                    && this._isWalkPoint(p.x - ox, p.z + oz) && this._isWalkPoint(p.x + ox, p.z + oz)
                    && this._isWalkPoint(p.x - ox, p.z) && this._isWalkPoint(p.x + ox, p.z) && this._isWalkPoint(p.x, p.z - oz) && this._isWalkPoint(p.x, p.z + oz);
                pf.grid[pf.getIndex(gx, gz)] = ok ? 0 : 1;
            }
        }

        // -------------------------------------------------------------- camera
        _camValid(x, y, z) {
            const k = this._cellAt(x, z); if (k < 0 || !this.H[k]) return false;
            if (y < 0.6 || y > this.H[k] - 0.4) return false;
            // keep half a metre off the walls: all four neighbours inside
            for (const [dx, dz] of [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55], [0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]]) { if (!this._walkCell(x + dx, z + dz)) return false; }
            if (this.blockers) for (let i = 0; i < this.blockers.length; i++) { const b = this.blockers[i]; if (x > b[0] - 0.4 && x < b[1] + 0.4 && z > b[2] - 0.4 && z < b[3] + 0.4) return false; }
            for (let i = 0; i < this.pillars.length; i++) { const p = this.pillars[i]; if (y < 12 && Math.hypot(x - p[0], z - p[1]) < p[2] + 0.2) return false; }
            return true;
        }
        _camReach(head, dx, dy, dz, r) {
            let best = 0;
            for (let i = 1; i <= 20; i++) { const t = i / 20; if (this._camValid(head.x + dx * r * t, head.y + dy * r * t, head.z + dz * r * t)) best = t; else break; }
            return best * r;
        }
        constrainCamera(cam, head) {
            const vx = cam.x - head.x, vy = cam.y - head.y, vz = cam.z - head.z;
            const r = Math.hypot(vx, vy, vz) || 1;
            if (this._camReach(head, vx / r, vy / r, vz / r, r) >= r - 0.01) return cam;
            const yaw0 = Math.atan2(vx, vz), pit0 = Math.asin(Math.max(-1, Math.min(1, vy / r)));
            const dyaws = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1], dpits = [0, 0.14, 0.28, 0.42, 0.56];
            let bestScore = -1e9, bestD = null, bestIdx = -1, k = 0;
            for (let yi = 0; yi < dyaws.length; yi++) for (let pi = 0; pi < dpits.length; pi++, k++) {
                const yaw = yaw0 + dyaws[yi], pit = Math.min(1.25, pit0 + dpits[pi]), cp = Math.cos(pit);
                const dx = Math.sin(yaw) * cp, dy = Math.sin(pit), dz = Math.cos(yaw) * cp, reach = this._camReach(head, dx, dy, dz, r);
                const score = reach - 3.0 * Math.abs(dyaws[yi]) - 2.2 * dpits[pi] + (k === this._lastCamCand ? 0.5 : 0);
                if (score > bestScore) { bestScore = score; bestD = [dx, dy, dz, reach]; bestIdx = k; }
            }
            this._lastCamCand = bestIdx;
            const reach = Math.max(0.9, bestD[3]);
            cam.x = head.x + bestD[0] * reach; cam.y = head.y + bestD[1] * reach; cam.z = head.z + bestD[2] * reach;
            return cam;
        }

        // -------------------------------------------------------------- per frame
        update(delta, time, heroPos) {
            if (this.disposed) return;
            const now = time || 0;
            for (let i = 0; i < this.fires.length; i++) {
                const f = this.fires[i];
                if (heroPos && f._wx !== undefined) { const dx = f._wx - heroPos.x, dz = f._wz - heroPos.z; if (dx * dx + dz * dz > 1600) continue; }
                f.update(delta);
            }
            for (let i = 0; i < this.flames.length; i++) {
                const f = this.flames[i], k = 1 + 0.12 * Math.sin(now * 8 + f.seed) + 0.06 * Math.sin(now * 17 + f.seed * 3);
                f.sp.scale.set(1.6 * k, 2.0 * (2 - k), 1); f.core.scale.set(0.5, 0.8 * k, 1);
            }
            if (this.torches) for (let i = 0; i < this.torches.length; i++) { const f = this.torches[i], k = 1 + 0.14 * Math.sin(now * 9 + f.seed) + 0.07 * Math.sin(now * 19 + f.seed * 3); f.sp.scale.set(0.9 * k, 1.3 * (2 - k), 1); f.core.scale.set(0.3, 0.5 * k, 1); }
            if (this.seal) {
                const sl = this.seal;
                if (sl.open && sl.fade > 0) sl.fade = Math.max(0, sl.fade - (delta || 0.016) / 1.5);
                sl.mat.opacity = 0.9 * sl.fade * (0.85 + 0.15 * Math.sin(now * 3)); sl.veil.visible = sl.fade > 0.001;
                sl.tex.offset.y = (now * 0.12) % 1; sl.tex.offset.x = Math.sin(now * 0.7) * 0.05;
            }
            if (this.scrollTex) for (let i = 0; i < this.scrollTex.length; i++) { const e = this.scrollTex[i]; e.t.offset.x = (now * (e.lava ? 0.012 : 0.03)) % 1; e.t.offset.y = (now * (e.lava ? 0.008 : 0.02)) % 1; }
            if (this.rings) { const o = 0.7 + 0.15 * Math.sin(now * 1.6); this.rings.forEach(m => { m.opacity = o * 0.55; }); }
        }

        dispose() {
            this.disposed = true;
            if (this.group.parent) this.group.parent.remove(this.group);
            this.fires.forEach(f => f.dispose()); this.fires.length = 0;
            this.geometries.forEach(g => g.dispose()); this.geometries.length = 0;
            this.materials.forEach(m => m.dispose()); this.materials.length = 0;
            this.textures.forEach(t => t.dispose()); this.textures.length = 0;
        }
    }

    window.AveloraTemple = AveloraTemple;
})();
