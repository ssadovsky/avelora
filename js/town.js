/**
 * town.js — процедурные здания «города» (AveloraTown). Ни одной модели: форма строится кодом из коробок и цилиндров,
 * камень и мрамор рисуются на canvas при запуске (периодические текстуры 512 px на 2 м, плюс bump-карта у камня).
 *
 * Зачем так: вся геометрия здания склеивается в несколько Mesh (по одному на материал) в мировых координатах,
 * поэтому здание = 2–5 вызовов отрисовки и пара тысяч треугольников, а материалы/текстуры общие для всех зданий.
 *
 * Конфиг локации (world_data.js):
 *   town: { level: [x, z],              // точка, по высоте которой выравнивается земля под зданиями (обычно край дороги)
 *           buildings: [ { id, type: 'stoneHouse' | 'marbleTemple' | 'tavern' | 'runeGate', x, z, r, ...параметры } ] }
 * Система координат здания: локальный +Z — фасад (вход), r — поворот вокруг Y как у mesh.rotation.y
 * (фасад смотрит в мире на (sin r, cos r)).
 *
 * Коллизия: прямоугольники блокируют клетки сетки проходимости (как building.js blockCells), у храма ещё
 * платформа стилобата (ходимый настил со ступенями спереди, terrain.addPlatform).
 */
(function () {
    'use strict';

    const TEX_M = 2.0;            // сколько метров покрывает одна текстура
    const TS = 512;               // размер текстуры, px

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const clamp255 = (v) => v < 0 ? 0 : (v > 255 ? 255 : v);

    // ------------------------------------------------------------------ периодический шум (для бесшовных текстур)
    function makeNoise(seed, n) {
        const r = mulberry32(seed), g = new Float32Array(n * n);
        for (let i = 0; i < g.length; i++) g[i] = r();
        return function (x, y) {          // x, y в [0,1), период 1
            const fx = x * n, fy = y * n, x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
            const xa = ((x0 % n) + n) % n, xb = (xa + 1) % n, ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;
            const a = g[ya * n + xa], b = g[ya * n + xb], c = g[yb * n + xa], d = g[yb * n + xb];
            return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        };
    }
    function makeFbm(seed) {
        const ns = [makeNoise(seed, 4), makeNoise(seed + 1, 8), makeNoise(seed + 2, 16), makeNoise(seed + 3, 32)];
        return (x, y) => (ns[0](x, y) * 0.5 + ns[1](x, y) * 0.28 + ns[2](x, y) * 0.15 + ns[3](x, y) * 0.07);
    }

    function newCanvas() { const c = document.createElement('canvas'); c.width = c.height = TS; return c; }
    function toTexture(canvas, srgb) {
        const t = new THREE.CanvasTexture(canvas);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (srgb) {
            if (THREE.SRGBColorSpace !== undefined && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
            else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
        }
        t.anisotropy = 4;
        return t;
    }
    function pixelPass(canvas, fn) {
        const g = canvas.getContext('2d'), im = g.getImageData(0, 0, TS, TS), d = im.data;
        for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
            const i = (y * TS + x) * 4, o = fn(x, y, d[i], d[i + 1], d[i + 2]);
            d[i] = clamp255(o[0]); d[i + 1] = clamp255(o[1]); d[i + 2] = clamp255(o[2]);
        }
        g.putImageData(im, 0, 0);
    }

    // ------------------------------------------------------------------ текстуры
    /** Крупный серый тёсаный камень («Штормград»): 4 ряда по 0.5 м, блоки 0.6–1.4 м, тёмный раствор, bump по швам. */
    function makeStoneTex() {
        const rnd = mulberry32(1013), fbm = makeFbm(50), c = newCanvas(), g = c.getContext('2d');
        const hc = newCanvas(), hg = hc.getContext('2d');
        g.fillStyle = '#3b3c40'; g.fillRect(0, 0, TS, TS);
        hg.fillStyle = '#000'; hg.fillRect(0, 0, TS, TS);
        const rows = 4, rh = TS / rows;
        for (let r = 0; r < rows; r++) {
            const ws = []; let sum = 0;
            while (sum < TS * 0.92) { const w = 150 + rnd() * 190; ws.push(w); sum += w; }
            const k = TS / sum; let x = rnd() * TS;
            for (const w0 of ws) {
                const w = w0 * k, v = 120 + rnd() * 42, tint = rnd();
                const col = `rgb(${Math.round(v + (tint < 0.3 ? 8 : 0))},${Math.round(v + 1)},${Math.round(v + 6 + (tint > 0.7 ? 6 : 0))})`;
                const hv = 150 + Math.round(rnd() * 70);
                for (const off of [0, -TS]) {
                    const bx = x + off, by = r * rh;
                    if (bx > TS || bx + w < 0) continue;
                    g.fillStyle = col; g.fillRect(bx + 3, by + 3, w - 6, rh - 6);
                    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(bx + 3, by + 3, w - 6, 3);      // скол сверху
                    g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(bx + 3, by + rh - 7, w - 6, 4);       // тень снизу
                    hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fillRect(bx + 4, by + 4, w - 8, rh - 8);
                }
                x = (x + w) % TS;
            }
        }
        pixelPass(c, (px, py, r, gg, b) => {
            const n = fbm(px / TS, py / TS), s = (rnd() - 0.5) * 16, kk = 0.80 + 0.42 * n;
            return [r * kk + s, gg * kk + s, b * kk + s + 2];
        });
        const bc = newCanvas(), bg = bc.getContext('2d');
        if ('filter' in bg) bg.filter = 'blur(1.6px)';
        bg.drawImage(hc, 0, 0);
        return { map: toTexture(c, true), bump: toTexture(bc, false) };
    }

    /** Белый мрамор: тёплая белизна, серо-голубые и редкие золотистые прожилки, швы плит 1 м × 0.5 м. */
    function makeMarbleTex() {
        const f1 = makeFbm(200), f2 = makeFbm(300), f3 = makeFbm(400), c = newCanvas(), g = c.getContext('2d');
        g.fillStyle = '#efede8'; g.fillRect(0, 0, TS, TS);
        pixelPass(c, (px, py) => {
            const u = px / TS, v = py / TS;
            let L = 238 + (f3(u, v) - 0.5) * 16;
            const ph1 = 2 * u + 1 * v + 1.5 * f1(u, v), vein1 = Math.pow(1 - Math.abs(Math.sin(Math.PI * ph1)), 20);
            const ph2 = 5 * u - 3 * v + 2.2 * f2(u, v), vein2 = Math.pow(1 - Math.abs(Math.sin(Math.PI * ph2)), 28);
            let r = L + 2, gg = L, b = L - 4;
            r += (118 - r) * vein1 * 0.5; gg += (128 - gg) * vein1 * 0.5; b += (146 - b) * vein1 * 0.5;
            r += (176 - r) * vein2 * 0.22; gg += (156 - gg) * vein2 * 0.22; b += (110 - b) * vein2 * 0.22;
            const row = Math.floor(py / (TS / 4)), jx = ((px + (row & 1) * (TS / 2)) % (TS / 2)), jy = py % (TS / 4);
            if (jx < 2 || jy < 2) { r *= 0.88; gg *= 0.88; b *= 0.89; }
            return [r, gg, b];
        });
        return { map: toTexture(c, true), bump: null };
    }

    /** Тёмное дерево: вертикальные доски 0.25 м, волокна. */
    function makeWoodTex() {
        const rnd = mulberry32(555), fbm = makeFbm(600), c = newCanvas(), g = c.getContext('2d');
        const n = 8, pw = TS / n;
        for (let i = 0; i < n; i++) {
            const v = 70 + rnd() * 36;
            g.fillStyle = `rgb(${Math.round(v + 38)},${Math.round(v + 14)},${Math.round(v - 14)})`; g.fillRect(i * pw, 0, pw, TS);
            g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * pw, 0, 2, TS);
        }
        pixelPass(c, (px, py, r, gg, b) => {
            const grain = fbm(((px * 2) % TS) / TS, ((py / 16) % TS) / TS), kk = 0.72 + 0.5 * grain;
            return [r * kk, gg * kk, b * kk];
        });
        return { map: toTexture(c, true), bump: null };
    }

    /** Сине-серая сланцевая черепица (Штормград): ряды по 0.25 м со сдвигом. */
    function makeSlateTex() {
        const rnd = mulberry32(777), fbm = makeFbm(800), c = newCanvas(), g = c.getContext('2d');
        const hc = newCanvas(), hg = hc.getContext('2d');
        g.fillStyle = '#1d2530'; g.fillRect(0, 0, TS, TS);
        hg.fillStyle = '#000'; hg.fillRect(0, 0, TS, TS);
        const rows = 8, rh = TS / rows, tw = 64;
        for (let r = 0; r < rows; r++) {
            const off = (r & 1) * (tw / 2);
            for (let i = -1; i <= TS / tw; i++) {
                const x = i * tw + off, v = 62 + rnd() * 30;
                g.fillStyle = `rgb(${Math.round(v * 0.85)},${Math.round(v * 1.0)},${Math.round(v * 1.28)})`;
                g.fillRect(x + 1, r * rh, tw - 2, rh - 2);
                g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 1, r * rh + rh - 8, tw - 2, 6);
                hg.fillStyle = `rgb(${150 + Math.round(rnd() * 60)},0,0)`; hg.fillRect(x + 2, r * rh, tw - 4, rh - 4);
            }
        }
        pixelPass(c, (px, py, r, gg, b) => { const kk = 0.82 + 0.4 * fbm(px / TS, py / TS), s = (rnd() - 0.5) * 8; return [r * kk + s, gg * kk + s, b * kk + s]; });
        const him = hg.getImageData(0, 0, TS, TS), hd = him.data;
        for (let i = 0; i < hd.length; i += 4) { hd[i + 1] = hd[i + 2] = hd[i]; }
        hg.putImageData(him, 0, 0);
        const bc = newCanvas(), bg = bc.getContext('2d');
        if ('filter' in bg) bg.filter = 'blur(1.2px)';
        bg.drawImage(hc, 0, 0);
        return { map: toTexture(c, true), bump: toTexture(bc, false) };
    }

    /** Светлая штукатурка (второй этаж таверны): тёплая кость, лёгкая неровность. */
    function makePlasterTex() {
        const f = makeFbm(900), rnd = mulberry32(901), c = newCanvas(), g = c.getContext('2d');
        g.fillStyle = '#d9ceb4'; g.fillRect(0, 0, TS, TS);
        pixelPass(c, (px, py, r, gg, b) => { const k = 0.88 + 0.22 * f(px / TS, py / TS), s = (rnd() - 0.5) * 9; return [r * k + s, gg * k + s, b * k + s - 1]; });
        return { map: toTexture(c, true), bump: null };
    }

    /** Тёплые доски настила: горизонтальные ряды по 0.25 м со стыками внахлёст. */
    function makeDeckTex() {
        const rnd = mulberry32(321), fbm = makeFbm(330), c = newCanvas(), g = c.getContext('2d');
        const rows = 8, rh = TS / rows;
        g.fillStyle = '#2b1d12'; g.fillRect(0, 0, TS, TS);
        for (let r = 0; r < rows; r++) {
            let x = -rnd() * 200;
            while (x < TS) {
                const w = 170 + rnd() * 230, v = 118 + rnd() * 44;
                for (const off of [0, TS]) {
                    g.fillStyle = `rgb(${Math.round(v + 44)},${Math.round(v * 0.74 + 20)},${Math.round(v * 0.42 + 6)})`;
                    g.fillRect(x - off + 2, r * rh + 2, w - 4, rh - 4);
                    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x - off, r * rh, 2, rh);
                }
                x += w;
            }
            g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, r * rh, TS, 2);
        }
        pixelPass(c, (px, py, r, gg, b) => { const kk = 0.78 + 0.45 * fbm(px / TS, ((py * 8) % TS) / TS); return [r * kk, gg * kk, b * kk]; });
        return { map: toTexture(c, true), bump: null };
    }

    /** Вывеска таверны: тёмная доска, золотая рамка, надпись. Рисуется в canvas 512×192. */
    function makeSignTex() {
        const c = document.createElement('canvas'); c.width = 512; c.height = 192;
        const g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 0, 0, 192); gr.addColorStop(0, '#4b2f1a'); gr.addColorStop(1, '#2f1c0f');
        g.fillStyle = gr; g.fillRect(0, 0, 512, 192);
        for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 32 * i + 31, 512, 2); }
        g.strokeStyle = '#d9ad45'; g.lineWidth = 7; g.strokeRect(10, 10, 492, 172);
        g.strokeStyle = 'rgba(217,173,69,0.55)'; g.lineWidth = 2; g.strokeRect(22, 22, 468, 148);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#e8c76a'; g.font = 'bold 34px Georgia, "Times New Roman", serif'; g.fillText('✦  ТАВЕРНА  ✦', 256, 52);
        g.fillStyle = '#f3dc92'; g.font = 'bold 66px Georgia, "Times New Roman", serif'; g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 6;
        g.fillText('Рунный Кубок', 256, 116);
        const t = new THREE.CanvasTexture(c);
        if (THREE.SRGBColorSpace !== undefined && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
        t.anisotropy = 4;
        return { map: t, bump: null };
    }

    let SHARED = null;
    // ------------------------------------------------------------------ загон (конюшня): жердевая ограда с открытым проходом
    // W — вдоль x, D — вдоль z; проход шириной G в передней стороне (+z), без ворот. Стиль — тёмное тёсаное дерево, как у Meshy-построек.
    function buildCorral(B, cfg) {
        const W = cfg.W || 14, D = cfg.D || 11, G = cfg.gate || 3.6, STEP = cfg.step || 2.4, H = 1.45;
        const rects = [], WT = [1.0, 0.78, 0.58], WD = [0.82, 0.62, 0.45];
        const post = (x, z, h, s) => {
            const lean = (B.rnd() - 0.5) * 0.05;
            B.box('wood', x, h / 2 - 0.15, z, s, h + 0.3, s, { t: WD, jit: 0.15, rz: lean, rx: (B.rnd() - 0.5) * 0.04 });
            B.box('wood', x, h + 0.06, z, s + 0.08, 0.1, s + 0.08, { t: WT, jit: 0.1 });        // шапка столба
        };
        // одна сторона ограды от (x0,z0) до (x1,z1): столбы через ~STEP, три жерди с лёгким прогибом
        const side = (x0, z0, x1, z1) => {
            const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / STEP)), ang = Math.atan2(z1 - z0, x1 - x0);
            for (let i = 0; i <= n; i++) post(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, H, 0.22);
            for (let i = 0; i < n; i++) {
                const ax = x0 + (x1 - x0) * i / n, az = z0 + (z1 - z0) * i / n, bx = x0 + (x1 - x0) * (i + 1) / n, bz = z0 + (z1 - z0) * (i + 1) / n;
                for (const y of [0.42, 0.82, 1.22]) {
                    const sag = (B.rnd() - 0.5) * 0.06;
                    B.box('wood', (ax + bx) / 2, y + sag, (az + bz) / 2, L / n + 0.12, 0.13, 0.1, { t: WT, jit: 0.18, ry: -ang, rz: (B.rnd() - 0.5) * 0.03 });
                }
            }
            const th = 0.25;   // непроходимая полоса вдоль ограды
            rects.push({ x0: Math.min(x0, x1) - th, x1: Math.max(x0, x1) + th, z0: Math.min(z0, z1) - th, z1: Math.max(z0, z1) + th });
        };
        const hw = W / 2, hd = D / 2, g = G / 2;
        side(-hw, -hd, hw, -hd);                 // задняя
        side(-hw, -hd, -hw, hd); side(hw, -hd, hw, hd);   // боковые
        side(-hw, hd, -g, hd); side(g, hd, hw, hd);         // передняя с проходом
        return { rects, platform: null, w: W, d: D, h: 1.6 };
    }

    function sharedMaterials() {
        if (SHARED) { SHARED.refs++; return SHARED; }
        const T = { stone: makeStoneTex(), marble: makeMarbleTex(), wood: makeWoodTex(), slate: makeSlateTex(), plaster: makePlasterTex(), deck: makeDeckTex(), sign: makeSignTex() };
        const std = (map, bump, o) => new THREE.MeshStandardMaterial(Object.assign({ map, bumpMap: bump || null, bumpScale: bump ? 2.2 : 0, roughness: 0.92, metalness: 0, vertexColors: true }, o || {}));
        SHARED = {
            refs: 1, tex: T,
            mats: {
                stone: std(T.stone.map, T.stone.bump),
                marble: std(T.marble.map, null, { roughness: 0.38, color: 0xd8d6d0 }),
                wood: std(T.wood.map, null, { roughness: 0.85 }),
                slate: std(T.slate.map, T.slate.bump, { roughness: 0.8 }),
                glass: new THREE.MeshStandardMaterial({ color: 0x24384c, roughness: 0.15, metalness: 0, emissive: 0x0b1622, vertexColors: true }),
                gold: new THREE.MeshStandardMaterial({ color: 0xe0b84a, roughness: 0.45, metalness: 0, emissive: 0x3a2a05, vertexColors: true }),
                dark: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9, metalness: 0, vertexColors: true }),
                flame: new THREE.MeshBasicMaterial({ color: 0xffc064, vertexColors: true }),
                plaster: std(T.plaster.map, null, { roughness: 0.95 }),
                deck: std(T.deck.map, null, { roughness: 0.85 }),
                cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.DoubleSide }),
                rune: new THREE.MeshBasicMaterial({ color: 0x6be3c0, vertexColors: true }),
                sign: new THREE.MeshStandardMaterial({ map: T.sign.map, roughness: 0.8, metalness: 0, vertexColors: true })
            }
        };
        // текстуры из Meshy-коттеджа (build_assets: townMeshStone/Plinth/Window) для домов с meshTex: true; без них — обычный камень
        const A = (window.GAME_ASSETS && window.GAME_ASSETS.textures) || {}, M = SHARED.mats;
        const imgTex = (key, ry, clampV) => {
            if (!A[key]) return null;
            const t = new THREE.TextureLoader().load(A[key]);
            t.wrapS = THREE.RepeatWrapping; t.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
            if (ry) t.repeat.set(1, ry);
            if (THREE.SRGBColorSpace !== undefined && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
            else if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
            t.anisotropy = 4; T['img_' + key] = { map: t };
            return t;
        };
        const ms = imgTex('townMeshStone'), mp = imgTex('townMeshPlinth', 6.29), mw = imgTex('townMeshWindow', 0, true), md = imgTex('townMeshDoor', 0, true), mb = imgTex('townMeshBeam', 6.125);
        M.mstone = ms ? std(ms, null, { roughness: 0.92 }) : M.stone;
        M.mplinth = mp ? std(mp, null, { roughness: 0.9 }) : M.stone;
        M.mbeam = mb ? std(mb, null, { roughness: 0.85 }) : M.wood;
        M.mdoor = md ? new THREE.MeshStandardMaterial({ map: md, roughness: 0.8, metalness: 0, vertexColors: true, emissive: 0x2a1806, emissiveMap: md, emissiveIntensity: 0.25 }) : M.wood;
        M.mwin = mw ? new THREE.MeshStandardMaterial({ map: mw, roughness: 0.8, metalness: 0, vertexColors: true, emissive: 0x3a2508, emissiveMap: mw, emissiveIntensity: 0.35 }) : M.glass;
        return SHARED;
        return SHARED;
    }
    function releaseMaterials() {
        if (!SHARED) return;
        if (--SHARED.refs > 0) return;
        new Set(Object.values(SHARED.mats)).forEach(m => m.dispose());
        Object.values(SHARED.tex).forEach(t => { if (t.map) t.map.dispose(); if (t.bump) t.bump.dispose(); });
        SHARED = null;
    }

    // ------------------------------------------------------------------ сборщик геометрии
    class Buf {
        constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
        vert(x, y, z, nx, ny, nz, u, v, r, g, b) {
            this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v); this.c.push(r, g, b);
            return this.p.length / 3 - 1;
        }
        tris() { return this.i.length / 3; }
        mesh(mat) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
            geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
            geo.setIndex(this.i);
            geo.computeBoundingSphere();
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = true; m.receiveShadow = true;
            return m;
        }
    }

    const FACES = [   // [нормаль, 4 угла (знаки hx,hy,hz) против часовой снаружи, ось u, ось v] — u/v: [индекс оси, знак]
        { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], u: [2, -1], w: [1, 1] },
        { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], u: [2, 1], w: [1, 1] },
        { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], u: [0, 1], w: [2, -1], top: true },
        { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], u: [0, 1], w: [2, 1], bottom: true },
        { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], u: [0, 1], w: [1, 1] },
        { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], u: [0, -1], w: [1, 1] }
    ];

    /** Здание: набор буферов по материалам + преобразование «локальные координаты → мир» (поворот r, сдвиг x, y, z). */
    class Builder {
        constructor(x, y, z, r, seed) {
            this.x = x; this.y = y; this.z = z; this.r = r; this.cs = Math.cos(r); this.sn = Math.sin(r);
            this.bufs = {}; this.rnd = mulberry32(seed || 1); this.fr = null;
        }
        buf(name) { return this.bufs[name] || (this.bufs[name] = new Buf()); }
        /** Локальная система внутри здания: {x, z, yaw} — точки (lx, lz) поворачиваются на yaw и сдвигаются. */
        frame(fr, fn) { const old = this.fr; this.fr = fr; fn(); this.fr = old; }
        T(lx, ly, lz) {
            let X = lx, Z = lz;
            const f = this.fr;
            if (f) { const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0); X = lx * c + lz * s + (f.x || 0); Z = -lx * s + lz * c + (f.z || 0); }
            return [X * this.cs + Z * this.sn + this.x, ly + this.y, -X * this.sn + Z * this.cs + this.z];
        }
        N(nx, ny, nz) {
            let X = nx, Z = nz;
            const f = this.fr;
            if (f) { const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0); X = nx * c + nz * s; Z = -nx * s + nz * c; }
            return [X * this.cs + Z * this.sn, ny, -X * this.sn + Z * this.cs];
        }
        tint(o) {
            const t = o && o.t !== undefined ? o.t : 1, j = (o && o.jit) ? 1 + (this.rnd() - 0.5) * o.jit : 1;
            return Array.isArray(t) ? [t[0] * j, t[1] * j, t[2] * j] : [t * j, t * j, t * j];
        }

        /** Коробка с центром (cx,cy,cz), размерами (sx,sy,sz), поворотом o.rx/ry/rz (Euler YXZ) вокруг центра. */
        box(mat, cx, cy, cz, sx, sy, sz, o) {
            o = o || {};
            const b = this.buf(mat), hx = sx / 2, hy = sy / 2, hz = sz / 2, col = this.tint(o);
            const rot = (o.rx || o.ry || o.rz) ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')) : null;
            const us = (o.uv || 1) / TEX_M, ox = o.ou || 0, oy = o.ov || 0, h3 = [hx, hy, hz], c3 = [cx, cy, cz];
            const vec = new THREE.Vector3();
            for (const F of FACES) {
                if (F.bottom && !o.bottom) continue;
                const idx = [];
                for (const s of F.v) {
                    const lx = s[0] * hx, ly = s[1] * hy, lz = s[2] * hz, loc = [lx, ly, lz];
                    const u = ((c3[F.u[0]] + loc[F.u[0]]) * F.u[1]) * us + ox, v = ((c3[F.w[0]] + loc[F.w[0]]) * F.w[1]) * us + oy;
                    let px = lx, py = ly, pz = lz, nx = F.n[0], ny = F.n[1], nz = F.n[2];
                    if (rot) {
                        vec.set(lx, ly, lz).applyMatrix4(rot); px = vec.x; py = vec.y; pz = vec.z;
                        vec.set(nx, ny, nz).transformDirection(rot); nx = vec.x; ny = vec.y; nz = vec.z;
                    }
                    const P = this.T(px + cx, py + cy, pz + cz), Nn = this.N(nx, ny, nz);
                    idx.push(b.vert(P[0], P[1], P[2], Nn[0], Nn[1], Nn[2], u, v, col[0], col[1], col[2]));
                }
                b.i.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
            }
        }

        /** Выпуклый многоугольник (точки в локальных координатах); n — внешняя нормаль (нужна для порядка обхода и UV). */
        poly(mat, pts, n, o) {
            o = o || {};
            const b = this.buf(mat), col = this.tint(o), us = (o.uv || 1) / TEX_M;
            const a = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
            const c = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
            const g = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
            const P = (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= 0) ? pts : pts.slice().reverse();
            const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
            const Nn = this.N(n[0], n[1], n[2]), idx = [];
            for (const p of P) {
                let u, v;
                if (ax >= ay && ax >= az) { u = p[2]; v = p[1]; } else if (ay >= az) { u = p[0]; v = p[2]; } else { u = p[0]; v = p[1]; }
                const W = this.T(p[0], p[1], p[2]);
                idx.push(b.vert(W[0], W[1], W[2], Nn[0], Nn[1], Nn[2], u * us, v * us, col[0], col[1], col[2]));
            }
            for (let k = 1; k < idx.length - 1; k++) b.i.push(idx[0], idx[k], idx[k + 1]);
        }

        /** Треугольная призма (фронтон): axis 'x' — треугольник в плоскости YZ, выдавлен по X; 'z' — в XY, выдавлен по Z.
         *  a — координата центра по оси выдавливания, y0 — основание, hb — половина основания, h — высота, th — толщина. */
        prism(mat, axis, a, y0, hb, h, th, o) {
            const t2 = th / 2, L = Math.hypot(hb, h);
            if (axis === 'x') {
                const A = a + t2, B = a - t2;
                this.poly(mat, [[A, y0, -hb], [A, y0, hb], [A, y0 + h, 0]], [1, 0, 0], o);
                this.poly(mat, [[B, y0, -hb], [B, y0, hb], [B, y0 + h, 0]], [-1, 0, 0], o);
                this.poly(mat, [[B, y0, -hb], [A, y0, -hb], [A, y0 + h, 0], [B, y0 + h, 0]], [0, hb / L, -h / L], o);
                this.poly(mat, [[B, y0, hb], [A, y0, hb], [A, y0 + h, 0], [B, y0 + h, 0]], [0, hb / L, h / L], o);
            } else {
                const A = a + t2, B = a - t2;
                this.poly(mat, [[-hb, y0, A], [hb, y0, A], [0, y0 + h, A]], [0, 0, 1], o);
                this.poly(mat, [[-hb, y0, B], [hb, y0, B], [0, y0 + h, B]], [0, 0, -1], o);
                this.poly(mat, [[-hb, y0, B], [-hb, y0, A], [0, y0 + h, A], [0, y0 + h, B]], [-h / L, hb / L, 0], o);
                this.poly(mat, [[hb, y0, B], [hb, y0, A], [0, y0 + h, A], [0, y0 + h, B]], [h / L, hb / L, 0], o);
            }
        }

        /** Плоская табличка (текстура на всю поверхность, uv 0–1), лицом на +Z текущей рамки. */
        sign(mat, cx, cy, cz, w, h) {
            const b = this.buf(mat), Nn = this.N(0, 0, 1), hx = w / 2, hy = h / 2, idx = [];
            for (const [sx, sy, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
                const P = this.T(cx + sx * hx, cy + sy * hy, cz);
                idx.push(b.vert(P[0], P[1], P[2], Nn[0], Nn[1], Nn[2], u, v, 1, 1, 1));
            }
            b.i.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
        }

        /** Вертикальный усечённый цилиндр; o.rings — колец по высоте, o.flute — желобки (колонна), o.ent — энтазис. */
        cyl(mat, cx, y0, cz, rB, rT, h, segs, o) {
            o = o || {};
            const b = this.buf(mat), col = this.tint(o), rings = o.rings || 1, us = (o.uv || 1) / TEX_M, slope = (rB - rT) / h;
            const base = [];
            for (let k = 0; k <= rings; k++) {
                const t = k / rings, y = y0 + t * h;
                let rr = rB + (rT - rB) * t;
                if (o.ent) rr *= 1 + o.ent * Math.sin(Math.PI * t);
                for (let i = 0; i <= segs; i++) {
                    const th = (i % segs) / segs * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
                    const fr = o.flute ? ((i % 3 === 0) ? 1 : 0.935) : 1;
                    const nl = Math.hypot(1, slope), P = this.T(cx + cs * rr * fr, y, cz + sn * rr * fr), Nn = this.N(cs / nl, slope / nl, sn / nl);
                    base.push(b.vert(P[0], P[1], P[2], Nn[0], Nn[1], Nn[2], (i / segs) * (2 * Math.PI * rB) * us, y * us, col[0], col[1], col[2]));
                }
            }
            const row = segs + 1;
            for (let k = 0; k < rings; k++) for (let i = 0; i < segs; i++) {
                const a = k * row + i, bb = a + 1, c = a + row + 1, d = a + row;
                b.i.push(base[a], base[d], base[c], base[a], base[c], base[bb]);
            }
        }
    }

    // ------------------------------------------------------------------ серый дом в стиле Штормграда
    function buildStoneHouse(B, cfg) {
        const W = cfg.W || 8.2, D = cfg.D || 6.2, H = cfg.H || 3.5, FR = D / 2;
        const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
        const MT = !!cfg.meshTex, ST = MT ? 'mstone' : 'stone', PL = MT ? 'mplinth' : 'stone';   // meshTex: камень/цоколь/окна из Meshy-коттеджа
        const rects = [rect(-W / 2 - 0.3, W / 2 + 0.3, -D / 2 - 0.3, D / 2 + 0.3), cfg.meshTex ? rect(-1.05, 1.05, FR, FR + 0.75) : rect(-1.15, 1.15, FR, FR + 1.05)];

        // цоколь и тело
        B.box(PL, 0, -0.025, 0, W + 0.4, 1.15, D + 0.4, MT ? { uv: 0.303 } : { t: [0.74, 0.74, 0.76], jit: 0.0 });          // от -0.6 до 0.55
        B.box(ST, 0, (0.55 + H) / 2, 0, W, H - 0.55, D, MT ? { uv: 0.851 } : { t: [1.0, 1.0, 1.03] });
        // тёмный деревянный пояс и каменный карниз
        if (MT) B.box('mbeam', 0, H - 0.2, 0, W + 0.14, 0.24, D + 0.14, { uv: 1.36, ov: -(H - 0.32) * 0.68, bottom: true });   // брус из Meshy-коттеджа (как перемычки окон/двери), с низом
        else B.box('wood', 0, H - 0.2, 0, W + 0.14, 0.24, D + 0.14, { t: [0.8, 0.8, 0.8] });
        if (MT) B.box(PL, 0, H + 0.08, 0, W + 0.5, 0.18, D + 0.14, { uv: 0.303, bottom: true });   // карниз ниже ската: по фасаду не выступает сквозь тонкую крышу (была серая полоса)
        else B.box('stone', 0, H + 0.12, 0, W + 0.5, 0.26, D + 0.5, { t: [0.84, 0.84, 0.88] });
        // двускатная сланцевая крыша, конёк вдоль X
        const a = 0.64, tan = Math.tan(a), ovh = 0.55, yW = H + 0.25, run = D / 2 + ovh;
        const yE = yW + 0.05 - ovh * tan, yR = yW + 0.05 + (D / 2) * tan, len = run / Math.cos(a) + 0.12, wr = W + 1.1;
        const RT = MT ? 0.1 : 0.2, zc = run / 2, yc = (yE + yR) / 2 + (MT ? -0.01 : 0.11);   // meshTex: тонкая крыша, низ ровно на карнизе и фронтонах
        B.box('slate', 0, yc, zc, wr, RT, len, { rx: a, bottom: true, uv: 1.0 });
        B.box('slate', 0, yc, -zc, wr, RT, len, { rx: -a, bottom: true, uv: 1.0 });
        B.box('wood', 0, yR + (MT ? 0.06 : 0.17), 0, wr + 0.08, 0.16, 0.42, { t: [0.7, 0.7, 0.7] });                       // коньковый брус
        // фронтоны (торцы) из камня
        for (const sx of [-1, 1]) B.prism(ST, 'x', sx * (W / 2 - 0.25), yW - 0.02, D / 2, (D / 2) * tan + 0.02, 0.5, MT ? { uv: 0.851 } : { t: [0.95, 0.95, 0.98] });
        if (MT) B.prism(PL, 'x', 0, H + 0.2, D / 2 + 0.03, (D / 2 + 0.03) * tan, W - 0.1, { uv: 0.303 });   // сплошной чердак под крышей: щели под скатами нет, внутренности не видны
        // дымоход
        const chX = -W / 2 + 1.5, chZ = -D / 2 + 1.25, chTop = yR + 0.7;
        if (!MT) {   // meshTex: без печной трубы
            B.box('stone', chX, (H - 0.3 + chTop) / 2, chZ, 0.95, chTop - H + 0.3, 0.95, { t: [0.82, 0.82, 0.85], uv: 1.0 });
            B.box('stone', chX, chTop + 0.1, chZ, 1.2, 0.2, 1.2, { t: [0.7, 0.7, 0.72] });
            B.box('dark', chX, chTop + 0.22, chZ, 0.72, 0.06, 0.72, {});
            rects.push(rect(chX - 0.5, chX + 0.5, chZ - 0.5, chZ + 0.5));
        }

        // дверь у фасада: крыльцо, косяк, перемычка с замковым камнем, створка с полосами и ручками
        const dy = 0.55;
        if (MT) {   // meshTex: дверь-картинка из Meshy-коттеджа (рама, створка, фонарь) и две каменные ступени
            B.sign('mdoor', 0, dy + 1.13, FR + 0.02, 1.98, 2.27);
            B.box(PL, 0, dy / 2, FR + 0.17, 2.0, dy, 0.34, { uv: 0.303 });
            B.box(PL, 0, dy / 4, FR + 0.52, 2.0, dy / 2, 0.36, { uv: 0.303 });
        } else {
            B.box(PL, 0, 0.25, FR + 0.55, 2.2, 0.5, 0.9, MT ? { uv: 0.303 } : { t: [0.86, 0.86, 0.9] });
            for (const sx of [-1, 1]) B.box(PL, sx * 0.98, dy + 1.3, FR + 0.1, 0.36, 2.6, 0.4, MT ? { uv: 0.303, ou: 0.4 } : { t: [0.82, 0.82, 0.86], ou: 0.4 });
            B.box(PL, 0, dy + 2.62, FR + 0.1, 2.5, 0.38, 0.46, MT ? { uv: 0.303 } : { t: [0.8, 0.8, 0.84] });
            B.box('stone', 0, dy + 2.62, FR + 0.36, 0.5, 0.42, 0.06, { t: [0.98, 0.98, 1.0] });
            B.box('wood', 0, dy + 1.15, FR + 0.03, 1.5, 2.3, 0.14, { uv: 1.0 });
            for (const yy of [0.5, 1.8]) B.box('dark', 0, dy + yy, FR + 0.11, 1.52, 0.09, 0.03, {});
            for (const sx of [-1, 1]) B.box('gold', sx * 0.16, dy + 1.1, FR + 0.12, 0.07, 0.07, 0.05, {});
        }

        // окна: подоконник, перемычка, рама, стекло, переплёт, ставни
        const win = (fr, y) => B.frame(fr, () => {
            if (MT) { B.sign('mwin', 0, y - 0.05, 0.02, 2.3, 1.87); return; }   // окно-картинка из Meshy-коттеджа (рама, ставни, цветочный ящик)
            B.box('stone', 0, y - 0.8, 0.16, 1.55, 0.15, 0.42, { t: [0.84, 0.84, 0.88] });
            B.box('stone', 0, y + 0.8, 0.12, 1.6, 0.24, 0.34, { t: [0.82, 0.82, 0.86] });
            for (const sx of [-1, 1]) B.box('wood', sx * 0.58, y, 0.07, 0.1, 1.46, 0.14, { t: 0.8 });
            for (const sy of [-1, 1]) B.box('wood', 0, y + sy * 0.68, 0.07, 1.26, 0.1, 0.14, { t: 0.8 });
            B.box('glass', 0, y, 0.03, 1.06, 1.26, 0.04, {});
            B.box('wood', 0, y, 0.08, 0.05, 1.26, 0.06, { t: 0.7 });
            B.box('wood', 0, y, 0.08, 1.06, 0.05, 0.06, { t: 0.7 });
            for (const sx of [-1, 1]) B.box('wood', sx * 0.93, y, 0.06, 0.44, 1.34, 0.07, { t: [0.62, 0.7, 0.8], ou: sx * 0.3 });
        });
        win({ x: -2.7, z: FR, yaw: 0 }, 2.05); win({ x: 2.7, z: FR, yaw: 0 }, 2.05);
        win({ x: W / 2, z: 0, yaw: Math.PI / 2 }, 2.05); win({ x: -W / 2, z: 0, yaw: -Math.PI / 2 }, 2.05);
        win({ x: -1.8, z: -FR, yaw: Math.PI }, 2.05); win({ x: 1.8, z: -FR, yaw: Math.PI }, 2.05);

        // фонарь над дверью, бочка и ящики
        if (!MT) {
            B.box('wood', 1.55, 3.0, FR + 0.22, 0.09, 0.09, 0.46, { t: 0.7 });
            B.box('dark', 1.55, 3.28, FR + 0.43, 0.24, 0.05, 0.24, {});
            B.box('flame', 1.55, 3.08, FR + 0.43, 0.17, 0.3, 0.17, {});
        }
        return { rects, platform: null, w: W, d: D, h: yR + 1.2 };
    }

    // ------------------------------------------------------------------ белый мраморный храм (греческий периптер)
    function buildMarbleTemple(B, cfg) {
        const HX = cfg.HX || 3.9, HZ = cfg.HZ || 5.0, y0 = 0.45, rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
        const rects = [];
        // стилобат: фундамент и три ступени (верх последней — пол на y0)
        B.box('marble', 0, -0.225, 0, 2 * HX + 1.6, 0.75, 2 * HZ + 1.6, { t: 0.95 });   // нижняя ступень уходит под землю одним куском: стык граней ровно на уровне земли мерцал со всех сторон
        B.box('marble', 0, 0.225, 0, 2 * HX + 0.8, 0.15, 2 * HZ + 0.8, { t: 1.0 });
        B.box('marble', 0, 0.375, 0, 2 * HX, 0.15, 2 * HZ, { t: 1.02 });
        // колонны: 4 по фасаду и тылу, по 3 на боках между угловыми
        const colX = [-3.0, -1.0, 1.0, 3.0], colZ = [-4.4, 4.4], sideZ = [-2.2, 0, 2.2];
        const col = (x, z) => {
            B.cyl('marble', x, y0, z, 0.44, 0.40, 0.12, 16, { t: 0.95 });
            B.cyl('marble', x, y0 + 0.12, z, 0.38, 0.36, 0.10, 16, { t: 1.0 });
            B.cyl('marble', x, y0 + 0.22, z, 0.35, 0.29, 3.2, 36, { flute: true, rings: 4, ent: 0.03, t: 1.0 });
            B.cyl('marble', x, y0 + 3.42, z, 0.30, 0.43, 0.2, 16, { t: 0.97 });
            B.box('marble', x, y0 + 3.7, z, 0.9, 0.16, 0.9, { t: 1.0 });
            rects.push(rect(x - 0.2, x + 0.2, z - 0.2, z + 0.2));
        };
        for (const z of colZ) for (const x of colX) col(x, z);
        for (const x of [-3.0, 3.0]) for (const z of sideZ) col(x, z);

        // антаблемент: архитрав, фриз с триглифами, карниз
        const yA = y0 + 3.78, hxE = 3.55, hzE = 4.95;
        B.box('marble', 0, yA + 0.275, hzE - 0.25, 2 * hxE, 0.55, 0.5, { t: 0.98 }); B.box('marble', 0, yA + 0.275, -hzE + 0.25, 2 * hxE, 0.55, 0.5, { t: 0.98 });
        for (const sx of [-1, 1]) B.box('marble', sx * (hxE - 0.25), yA + 0.275, 0, 0.5, 0.55, 2 * hzE - 1.0, { t: 0.98 });
        const yF = yA + 0.55;
        B.box('marble', 0, yF + 0.3, hzE - 0.25, 2 * hxE - 0.1, 0.6, 0.3, { t: 0.96 }); B.box('marble', 0, yF + 0.3, -hzE + 0.25, 2 * hxE - 0.1, 0.6, 0.3, { t: 0.96 });
        for (const sx of [-1, 1]) B.box('marble', sx * (hxE - 0.25), yF + 0.3, 0, 0.3, 0.6, 2 * hzE - 0.6, { t: 0.96 });
        const trig = (x, z, yaw) => B.frame({ x, z, yaw }, () => {
            B.box('marble', 0, yF + 0.3, 0.1, 0.26, 0.56, 0.07, { t: 1.02 });
            for (const gx of [-0.05, 0.05]) B.box('dark', gx, yF + 0.3, 0.14, 0.025, 0.46, 0.02, {});
        });
        for (let x = -3.3; x <= 3.31; x += 0.55) { trig(x, hzE - 0.1, 0); trig(x, -hzE + 0.1, Math.PI); }
        for (let z = -4.2; z <= 4.21; z += 0.55) { trig(hxE - 0.1, z, Math.PI / 2); trig(-hxE + 0.1, z, -Math.PI / 2); }
        const yC = yF + 0.6;
        B.box('marble', 0, yC + 0.12, 0, 2 * hxE + 0.6, 0.24, 2 * hzE + 0.6, { t: 1.03, bottom: true });
        const yB = yC + 0.24;

        // фронтоны, крыша (мрамор), акротерии
        const bhw = hxE + 0.25, ph = 0.95, ang = Math.atan2(ph, bhw), tan = ph / bhw;
        for (const sz of [-1, 1]) {
            B.prism('marble', 'z', sz * (hzE - 0.12), yB, bhw - 0.05, ph - 0.03, 0.3, { t: 0.96 });
            for (const sx of [-1, 1]) B.box('marble', sx * bhw / 2, yB + ph / 2 + 0.07, sz * (hzE + 0.02), bhw / Math.cos(ang) + 0.06, 0.2, 0.5, { rz: -sx * ang, t: 1.04 });
        }
        const yEv = yB + 0.02, yRg = yEv + (bhw + 0.1) * tan, rl = 2 * hzE + 0.7, rw = (bhw + 0.1) / Math.cos(ang) + 0.1;
        for (const sx of [-1, 1]) B.box('marble', sx * (bhw + 0.1) / 2, (yEv + yRg) / 2 + 0.08, 0, rw, 0.16, rl, { rz: -sx * ang, t: [0.93, 0.95, 1.0], bottom: true, uv: 1.0 });
        B.box('marble', 0, yRg + 0.16, 0, 0.42, 0.2, rl, { t: 1.04 });

        // целла: стены, дверной проём 2.2 м, фризовая надстройка под крышей
        const cx = 1.7, wt = 0.4, cTop = yB + 0.42, zF = 2.6, zB = -3.6, dh = 1.1;
        B.box('marble', 0, (y0 + cTop) / 2, zB - wt / 2, 2 * cx + 0.0, cTop - y0, wt, { t: 0.99 });
        for (const sx of [-1, 1]) B.box('marble', sx * (cx - wt / 2), (y0 + cTop) / 2, (zF + zB) / 2 - wt / 2, wt, cTop - y0, zF - zB - wt, { t: 0.99, ou: sx * 0.3 });
        for (const sx of [-1, 1]) B.box('marble', sx * (dh + (cx - dh) / 2), (y0 + cTop) / 2, zF - wt / 2, cx - dh, cTop - y0, wt, { t: 1.0 });
        B.box('marble', 0, y0 + 2.9 + (cTop - y0 - 2.9) / 2, zF - wt / 2, 2 * dh, cTop - y0 - 2.9, wt, { t: 1.0 });
        B.prism('marble', 'z', zF - wt / 2, cTop, cx, 0.46, wt, { t: 0.96 }); B.prism('marble', 'z', zB + wt / 2, cTop, cx, 0.46, wt, { t: 0.96 });
        rects.push(rect(-cx, cx, zB - 0.02, zB + wt), rect(-cx, -cx + wt, zB, zF), rect(cx - wt, cx, zB, zF),
            rect(-cx, -dh, zF - wt, zF), rect(dh, cx, zF - wt, zF));
        // внутри: постамент со статуей-амфорой и жаровня
        B.box('marble', 0, y0 + 0.45, zB + 1.05, 1.3, 0.9, 1.3, { t: 1.03 });
        B.box('marble', 0, y0 + 0.95, zB + 1.05, 1.6, 0.1, 1.6, { t: 1.04 });
        B.cyl('marble', 0, y0 + 1.0, zB + 1.05, 0.25, 0.4, 0.7, 14, { rings: 2, ent: 0.15 });
        B.cyl('marble', 0, y0 + 1.7, zB + 1.05, 0.4, 0.2, 0.28, 14, {});
        B.cyl('marble', 0, y0 + 1.98, zB + 1.05, 0.2, 0.2, 0.5, 12, {});
        rects.push(rect(-0.8, 0.8, zB + 0.35, zB + 1.75));

        const stylo = { hx: HX, hz: HZ, y: y0, rampLen: 0.8 };
        return { rects, platform: stylo, w: 2 * HX + 1.6, d: 2 * HZ + 1.6, h: yRg + 0.5 };
    }

    // ------------------------------------------------------------------ большая таверна «Рунный Кубок» (летняя терраса, сцена, танцпол)
    // Локальные координаты: начало — середина передней стены зала, +Z — фасад и терраса, дорога впереди. Высоты — от земли.
    // Зал 16×8 (x ±8, z −8…0) с настоящим входом; второй этаж — фахверк на штукатурке; терраса 19×17.4 с перилами,
    // столиками под зонтами, сценой (на ступень выше) и шахматным танцполом с руническим кругом.
    function buildTavern(B, cfg) {
        const HW = 8, y0 = 0.4, Y1 = 4.0, Y2 = 7.2, XD = -2.5, DG = 1.35, DX = 9.5, ZF = 9.4, ZB = -8, WT = 0.5;
        const SX0 = 2.0, SX1 = 8.0, SZ0 = 0.0, SZ1 = 4.0, SY = 0.85;       // сцена
        const DF = { x0: 0.5, x1: 9.1, z0: 5.1, z1: 8.9 };                  // танцпол
        const TAU = Math.PI * 2, rects = [];
        const rect = (x0, x1, z0, z1) => rects.push({ x0, x1, z0, z1 });
        const pick = (a) => a[Math.floor(B.rnd() * a.length) % a.length];
        const disc = (mat, cx, y, cz, r, segs, o) => {
            const pts = [];
            for (let i = 0; i < segs; i++) { const a = i / segs * TAU; pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); }
            B.poly(mat, pts, [0, 1, 0], o);
        };
        // двускатная крыша с коньком вдоль Z (крыльцо, слуховые окна): yr — высота линии ската на оси, hs — полуширина с вылетом
        const gableZ = (mat, cx, yr, hs, a, z0, z1) => {
            const tan = Math.tan(a), len = hs / Math.cos(a) + 0.1, zc = (z0 + z1) / 2, zl = Math.abs(z1 - z0);
            for (const sx of [-1, 1]) B.box(mat, cx + sx * hs / 2, yr - (hs / 2) * tan + 0.1, zc, len, 0.14, zl, { rz: -sx * a, bottom: true, uv: 1.0 });
        };
        // отрезок «проволоки» между двумя точками
        const wire = (ax, ay, az, bx, by, bz, th) => {
            const dx = bx - ax, dy = by - ay, dz = bz - az, hd = Math.hypot(dx, dz), L = Math.hypot(hd, dy);
            B.box('dark', (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, th, th, L, { rx: -Math.atan2(dy, hd), ry: Math.atan2(dx, dz), t: 0.6 });
        };
        const bulbs = (xa, za, xb, zb, yTop, sag) => {
            const n = Math.max(2, Math.round(Math.hypot(xb - xa, zb - za) / 0.5));
            let px = xa, py = yTop, pz = za;
            for (let i = 1; i <= n; i++) {
                const t = i / n, x = xa + (xb - xa) * t, z = za + (zb - za) * t, y = yTop - sag * 4 * t * (1 - t);
                wire(px, py, pz, x, y, z, 0.025); px = x; py = y; pz = z;
                if (i < n) B.box('flame', x, y - 0.1, z, 0.13, 0.17, 0.13, {});
            }
        };

        // ---------------------------------------------------------------- основание и настил
        B.box('stone', 0, -0.15, (ZF + ZB) / 2, 2 * DX + 0.8, 0.9, ZF - ZB + 0.8, { t: [0.74, 0.74, 0.76] });     // цоколь: от −0.6 до 0.3
        B.box('deck', 0, 0.35, (ZF + ZB) / 2, 2 * DX + 0.4, 0.1, ZF - ZB + 0.4, { uv: 1.0 });                    // настил: верх на y0
        // ступени у входа
        const sx0 = XD - 1.6, sx1 = XD + 1.6;
        B.box('stone', XD, 0.04, ZF + 0.225, sx1 - sx0, 0.46, 0.9, { t: [0.86, 0.86, 0.9] });
        B.box('stone', XD, -0.04, ZF + 0.675 + 0.225, sx1 - sx0, 0.3, 0.9, { t: [0.82, 0.82, 0.86] });

        // ---------------------------------------------------------------- стены зала (первый этаж, камень)
        const yb = -0.3, ym = (yb + Y1) / 2, hh = Y1 - yb;
        B.box('stone', 0, ym, ZB + WT / 2, 2 * HW, hh, WT, { t: [0.97, 0.97, 1.0] });
        for (const sx of [-1, 1]) B.box('stone', sx * (HW - WT / 2), ym, ZB / 2, WT, hh, -ZB - 2 * WT, { t: [0.97, 0.97, 1.0], ou: sx * 0.3 });   // между задней и передней стенами: углы не перекрываются (иначе мерцание)
        const xl = XD - DG, xr = XD + DG;
        B.box('stone', (-HW + xl) / 2, ym, -WT / 2, xl + HW, hh, WT, { t: [0.97, 0.97, 1.0] });
        B.box('stone', (xr + HW) / 2, ym, -WT / 2, HW - xr, hh, WT, { t: [0.97, 0.97, 1.0] });
        B.box('stone', XD, (y0 + 2.95 + Y1) / 2, -WT / 2, 2 * DG, Y1 - y0 - 2.95, WT, { t: [0.9, 0.9, 0.94] });
        // вход: косяки, перемычка, лампы
        for (const sx of [-1, 1]) B.box('wood', XD + sx * (DG - 0.08), y0 + 1.5, 0.05, 0.22, 3.0, 0.2, { t: 0.85 });
        B.box('wood', XD, y0 + 2.92, 0.06, 2 * DG + 0.1, 0.26, 0.22, { t: 0.8 });
        B.box('stone', XD, y0 + 3.2, 0.08, 2 * DG + 0.5, 0.18, 0.28, { t: [0.8, 0.8, 0.84] });
        for (const sx of [-1, 1]) {
            B.box('dark', XD + sx * (DG + 0.55), y0 + 2.45, 0.2, 0.24, 0.05, 0.24, {});
            B.box('flame', XD + sx * (DG + 0.55), y0 + 2.27, 0.2, 0.16, 0.3, 0.16, {});
        }

        // ---------------------------------------------------------------- второй этаж: штукатурка, пояс, фахверк
        B.box('wood', 0, Y1 - 0.12, -4, 2 * HW + 0.5, 0.3, 8.5, { t: 0.8, bottom: true });
        B.box('plaster', 0, (Y1 + Y2) / 2, -4, 2 * HW + 0.3, Y2 - Y1, 8.3, { uv: 1.0 });
        B.box('wood', 0, Y2 + 0.05, -4, 2 * HW + 0.5, 0.3, 8.5, { t: 0.8, bottom: true });
        // потолок зала и балки
        B.box('wood', 0, Y1 - 0.05, -3.75, 2 * HW - 0.5, 0.1, 7.5, { t: 0.55, bottom: true, uv: 1.0 });
        for (const z of [-1.4, -3.4, -5.4, -7.1]) B.box('wood', 0, Y1 - 0.26, z, 2 * HW - 0.5, 0.3, 0.3, { t: 0.7, bottom: true });
        B.box('wood', 0, Y1 - 0.26, -4, 0.3, 0.3, 7.5, { t: 0.7, bottom: true });
        // внутренняя облицовка стен: светлее и теплее (в зале нет источников света — имитация тепла ламп и камина)
        {
            const LT = [1.75, 1.6, 1.4], zi = ZB + WT + 0.02, hl = Y1 - y0 - 0.1, yl = (y0 + Y1) / 2, xi = HW - WT - 0.04;
            B.box('stone', 0, yl, zi, 2 * xi, hl, 0.04, { t: LT });
            for (const sx of [-1, 1]) B.box('stone', sx * (HW - WT - 0.02), yl, -4.02, 0.04, hl, 6.96, { t: LT });
            B.box('stone', (-xi + xl) / 2, yl, -WT - 0.02, xl + xi, hl, 0.04, { t: LT });
            B.box('stone', (xr + xi) / 2, yl, -WT - 0.02, xi - xr, hl, 0.04, { t: LT });
        }

        const win = (fr, y, th, shut) => B.frame(fr, () => {
            B.box('stone', 0, y - 0.8, 0.16, 1.55, 0.15, 0.42, { t: [0.84, 0.84, 0.88] });
            B.box('stone', 0, y + 0.8, 0.12, 1.6, 0.24, 0.34, { t: [0.82, 0.82, 0.86] });
            for (const sx of [-1, 1]) B.box('wood', sx * 0.58, y, 0.07, 0.1, 1.46, 0.14, { t: 0.8 });
            for (const sy of [-1, 1]) B.box('wood', 0, y + sy * 0.68, 0.07, 1.26, 0.1, 0.14, { t: 0.8 });
            B.box('glass', 0, y, -(th + 0.02) / 2, 1.06, 1.26, th + 0.1, {});
            B.box('wood', 0, y, 0.08, 0.05, 1.26, 0.06, { t: 0.7 });
            B.box('wood', 0, y, 0.08, 1.06, 0.05, 0.06, { t: 0.7 });
            if (th > 0.2) {      // внутренний наличник
                for (const sx of [-1, 1]) B.box('wood', sx * 0.58, y, -th - 0.02, 0.1, 1.46, 0.1, { t: 0.8 });
                for (const sy of [-1, 1]) B.box('wood', 0, y + sy * 0.68, -th - 0.02, 1.26, 0.1, 0.1, { t: 0.8 });
                B.box('wood', 0, y - 0.74, -th + 0.06, 1.4, 0.07, 0.24, { t: 0.7 });
            }
            if (shut) for (const sx of [-1, 1]) B.box('wood', sx * 0.93, y, 0.06, 0.44, 1.34, 0.07, { t: [0.55, 0.64, 0.78], ou: sx * 0.3 });
        });
        // положение рамки на стене: off — выступ наружу, lx — смещение вдоль стены (по локальному x рамки)
        const WALLS = {
            front: { fx: 0, fz: 0, yaw: 0, len: 2 * HW },
            right: { fx: HW, fz: -4, yaw: Math.PI / 2, len: 8 },
            back: { fx: 0, fz: ZB, yaw: Math.PI, len: 2 * HW },
            left: { fx: -HW, fz: -4, yaw: -Math.PI / 2, len: 8 }
        };
        const wf = (k, off, lx) => {
            const W = WALLS[k], c = Math.cos(W.yaw), s = Math.sin(W.yaw);
            return { x: W.fx + lx * c + off * s, z: W.fz - lx * s + off * c, yaw: W.yaw };
        };
        const WIN1 = { front: [-6.0, 0.6], right: [-2.5, 2.5], left: [-2.5, 2.5], back: [1.5, -6.5] };
        const SIGNX = 5.0;   // вывеска на стене над навесом сцены (x 3.25…6.75); на её прежнем месте (XD) — окно
        const WIN2 = { front: [-6.2, XD, 0.5], right: [-2.5, 2.5], left: [-2.5, 2.5], back: [-5.5, -1.8, 1.8, 5.5] };
        for (const k of Object.keys(WALLS)) {
            for (const x of WIN1[k]) win(wf(k, 0, x), y0 + 1.95, WT, true);
            for (const x of WIN2[k]) win(wf(k, 0.15, x), 5.9, 0, true);
        }
        // фахверк второго этажа: стойки, раскосы, обвязка
        const ymid = (Y1 + Y2) / 2, hF = Y2 - Y1 - 0.5;
        for (const k of Object.keys(WALLS)) {
            const L = WALLS[k].len, n = Math.round(L / 2.0), cell = L / n, wins = k === 'front' ? WIN2[k].concat([SIGNX - 0.8, SIGNX + 0.8]) : WIN2[k];   // у вывески стоек и раскосов нет
            B.frame(wf(k, 0.15, 0), () => {
                for (let i = 0; i <= n; i++) {
                    const px = -L / 2 + i * cell;
                    if (i > 0 && i < n && wins.some(w => Math.abs(w - px) < 1.2)) continue;
                    B.box('wood', px, ymid, 0.05, (i === 0 || i === n) ? 0.34 : 0.2, hF, 0.1, { t: 0.75 });
                }
                for (let i = 0; i < n; i++) {
                    const cx = -L / 2 + (i + 0.5) * cell;
                    if (wins.some(w => Math.abs(w - cx) < 1.6) || !(i === 0 || i === n - 1 || i % 3 === 1)) continue;
                    const ang = Math.atan2(cell - 0.2, hF), len = Math.hypot(cell - 0.2, hF);
                    B.box('wood', cx, ymid, 0.04, 0.14, len, 0.08, { rz: (i % 2 ? 1 : -1) * ang, t: 0.75 });
                }
            });
        }
        // вывеска на стене над навесом сцены
        B.frame({ x: 0, z: 0, yaw: 0 }, () => {
            B.sign('sign', SIGNX, 5.85, 0.16, 3.5, 1.31);
            for (const sy of [-1, 1]) B.box('wood', SIGNX, 5.85 + sy * 0.69, 0.17, 3.7, 0.1, 0.12, { t: 0.8 });
            for (const sx of [-1, 1]) B.box('wood', SIGNX + sx * 1.8, 5.85, 0.17, 0.1, 1.3, 0.12, { t: 0.8 });
        });

        // ---------------------------------------------------------------- крыша зала (сланец, как у соседнего дома), фронтоны, дымоход, слуховые окна
        const ra = 0.62, rt = Math.tan(ra), ovh = 0.65, yW = Y2 + 0.2, hbR = 4.15;
        const runR = hbR + ovh, yE = yW + 0.05 - ovh * rt, yR = yW + 0.05 + hbR * rt, lenR = runR / Math.cos(ra) + 0.12, zcR = runR / 2, ycR = (yE + yR) / 2 + 0.11, wr = 2 * HW + 1.5;
        B.frame({ x: 0, z: -4, yaw: 0 }, () => {
            B.box('slate', 0, ycR, zcR, wr, 0.2, lenR, { rx: ra, bottom: true });
            B.box('slate', 0, ycR, -zcR, wr, 0.2, lenR, { rx: -ra, bottom: true });
            B.box('wood', 0, yR + 0.17, 0, wr + 0.08, 0.16, 0.42, { t: 0.7 });
        });
        B.frame({ x: 0, z: -4, yaw: 0 }, () => {
            for (const sx of [-1, 1]) B.prism('plaster', 'x', sx * HW, Y2 + 0.15, hbR, hbR * rt + 0.02, 0.34, { uv: 1.0 });   // фронтоны по торцам зала
        });
        for (const sx of [1, -1]) {     // фахверк фронтона
            B.frame({ x: sx * (HW + 0.17), z: -4, yaw: sx * Math.PI / 2 }, () => {
                B.box('wood', 0, Y2 + 0.15 + 1.3, 0.04, 0.18, 2.6, 0.1, { t: 0.75 });
                B.box('wood', 0, Y2 + 0.15 + 1.1, 0.04, 5.4, 0.14, 0.1, { t: 0.75 });
                for (const px of [-2.4, 2.4]) B.box('wood', px, Y2 + 0.15 + 0.6, 0.04, 0.16, 1.2, 0.1, { t: 0.75 });
                for (const sg of [-1, 1]) B.box('wood', sg * 1.3, Y2 + 0.15 + 0.55, 0.04, 0.13, 1.4, 0.08, { rz: sg * 0.78, t: 0.75 });
            });
        }
        // дымоход у задней стены над камином
        {
            const cx = 4.0, top = yR + 1.1;
            B.box('stone', cx, (yb + top) / 2, ZB - 0.45, 2.0, top - yb, 0.9, { t: [0.82, 0.82, 0.85], uv: 1.0 });
            B.box('stone', cx, top + 0.1, ZB - 0.45, 2.3, 0.2, 1.2, { t: [0.7, 0.7, 0.72] });
            B.box('dark', cx - 0.45, top + 0.24, ZB - 0.45, 0.6, 0.08, 0.6, {});
            B.box('dark', cx + 0.45, top + 0.24, ZB - 0.45, 0.6, 0.08, 0.6, {});
            rect(cx - 1.1, cx + 1.1, ZB - 0.95, ZB);
        }
        // слуховые окна: 2 спереди, 2 сзади
        const dormer = (dx, zw, yaw) => B.frame({ x: dx, z: zw, yaw }, () => {
            const zf = -1.0, zr = -3.15, w = 1.7, yb2 = 7.9, yt = 9.15, a2 = 0.62, t2 = Math.tan(a2), hs = w / 2 + 0.22;
            B.box('plaster', 0, (yb2 + yt) / 2, (zf + zr) / 2, w, yt - yb2, zf - zr, { uv: 1.0 });
            B.box('glass', 0, 8.72, zf + 0.02, 0.62, 0.58, 0.04, {});
            for (const sx of [-1, 1]) B.box('wood', sx * 0.36, 8.72, zf + 0.04, 0.09, 0.72, 0.1, { t: 0.8 });
            for (const sy of [-1, 1]) B.box('wood', 0, 8.72 + sy * 0.33, zf + 0.04, 0.8, 0.09, 0.1, { t: 0.8 });
            B.box('wood', 0, 8.72, zf + 0.06, 0.05, 0.6, 0.06, { t: 0.7 });
            B.prism('plaster', 'z', zf - 0.02, yt, w / 2, (w / 2) * t2 + 0.02, 0.14, { uv: 1.0 });
            gableZ('slate', 0, yt + (w / 2) * t2, hs, a2, zf + 0.3, zr);
            B.box('wood', 0, yt + (w / 2) * t2 + 0.15, (zf + 0.3 + zr) / 2, 0.16, 0.12, zf + 0.3 - zr, { t: 0.7 });
        });
        dormer(-5.5, 0, 0); dormer(5.5, 0, 0); dormer(-5.5, ZB, Math.PI); dormer(5.5, ZB, Math.PI);

        // ---------------------------------------------------------------- крыльцо над входом
        {
            const pa = 0.55, ptn = Math.tan(pa), hbP = 2.1, ovp = 0.45, yPl = 3.7;
            const yrP = yPl + hbP * ptn;
            for (const sx of [-1, 1]) {
                B.box('stone', XD + sx * 1.9, y0 + 0.18, 3.1, 0.55, 0.36, 0.55, { t: [0.8, 0.8, 0.84] });
                B.box('wood', XD + sx * 1.9, 2.13, 3.1, 0.3, 2.74, 0.3, { t: 0.8 });
                B.box('wood', XD + sx * 1.9, 3.45, 1.55, 0.22, 0.24, 3.2, { t: 0.75 });
                B.box('wood', XD + sx * 1.35, y0 + 2.6, 3.1, 0.08, 0.5, 0.08, { rz: sx * 0.9, t: 0.8 });
                rect(XD + sx * 1.9 - 0.25, XD + sx * 1.9 + 0.25, 2.85, 3.35);
            }
            B.box('wood', XD, 3.45, 3.1, 4.1, 0.26, 0.26, { t: 0.75 });
            gableZ('slate', XD, yrP + 0.05, hbP + ovp, pa, 0.05, 3.6);
            B.box('wood', XD, yrP + 0.2, 1.85, 0.2, 0.12, 3.6, { t: 0.7 });
            B.frame({ x: XD, z: 0, yaw: 0 }, () => B.prism('wood', 'z', 3.4, yPl - 0.1, hbP - 0.05, (hbP - 0.05) * ptn, 0.12, { t: 0.7 }));
            B.box('dark', XD, 3.1, 3.1, 0.1, 0.5, 0.1, {});      // подвес лампы
            B.box('dark', XD, 2.8, 3.1, 0.3, 0.05, 0.3, {});
            B.box('flame', XD, 2.65, 3.1, 0.2, 0.32, 0.2, {});
        }

        // ---------------------------------------------------------------- сцена (пустая, вплотную к стене; под танцовщиц)
        {
            const cxs = (SX0 + SX1) / 2, wS = SX1 - SX0, dS = SZ1 - SZ0, czs = (SZ0 + SZ1) / 2;
            B.box('wood', cxs, (0.3 + SY - 0.05) / 2, czs, wS, SY - 0.05 - 0.3, dS, { t: 0.62 });
            B.box('deck', cxs, SY - 0.025, czs, wS, 0.05, dS, { t: [1.12, 1.1, 1.05], uv: 1.0 });
            B.box('wood', cxs, 0.48, SZ1 + 0.225, wS, 0.36, 0.45, { t: 0.7 });          // ступени сцены (верх 0.66 и 0.52)
            B.box('wood', cxs, 0.41, SZ1 + 0.675, wS, 0.22, 0.45, { t: 0.78 });
            // навес и колонны
            const ya = 4.95, yf = 4.5, zA = 0.2, zFd = 4.65, sl = Math.atan2(ya - yf, zFd - zA);
            B.box('slate', cxs, (ya + yf) / 2 + 0.1, (zA + zFd) / 2, wS + 0.9, 0.14, Math.hypot(zFd - zA, ya - yf) + 0.1, { rx: sl, bottom: true });
            B.box('wood', cxs, yf - 0.03, zFd - 0.03, wS + 0.9, 0.26, 0.12, { t: 0.7 });
            for (const sx of [SX0 + 0.15, SX1 - 0.15]) {
                B.cyl('wood', sx, SY, 3.7, 0.22, 0.2, 3.45, 10, { rings: 1, t: 0.8 });
                B.box('wood', sx, SY + 0.1, 3.7, 0.5, 0.2, 0.5, { t: 0.7 });
                B.box('wood', sx, 4.3, 3.7, 0.5, 0.18, 0.5, { t: 0.7 });
                rect(sx - 0.28, sx + 0.28, 3.42, 3.98);
            }
            B.box('wood', cxs, 4.35, 3.7, wS + 0.1, 0.3, 0.3, { t: 0.7 });
            for (const sx of [-1, 1]) B.box('wood', cxs + sx * (wS / 2 - 0.9), 4.0, 3.7, 0.12, 0.8, 0.12, { rz: sx * 0.75, t: 0.7 });   // подкосы
        }

        // ---------------------------------------------------------------- танцпол и рунический круг
        {
            const w = DF.x1 - DF.x0, d = DF.z1 - DF.z0, cx = (DF.x0 + DF.x1) / 2, cz = (DF.z0 + DF.z1) / 2;
            B.box('marble', cx, y0 + 0.006, cz, w, 0.012, d, { t: 0.92 });
            const nx = 10, nz = 4, tw = w / nx, td = d / nz;
            for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if ((i + j) % 2 === 0)
                B.box('dark', DF.x0 + (i + 0.5) * tw, y0 + 0.011, DF.z0 + (j + 0.5) * td, tw - 0.03, 0.022, td - 0.03, { t: 0.55 });
            const rc = [cx, cz];
            disc('rune', rc[0], y0 + 0.03, rc[1], 1.6, 40);
            disc('dark', rc[0], y0 + 0.034, rc[1], 1.5, 40, { t: 0.4 });
            disc('rune', rc[0], y0 + 0.038, rc[1], 1.1, 40);
            disc('dark', rc[0], y0 + 0.042, rc[1], 1.0, 40, { t: 0.4 });
            disc('rune', rc[0], y0 + 0.046, rc[1], 0.28, 20);
            for (let k = 0; k < 8; k++) {      // руны между кольцами: ромбики
                const a = k / 8 * TAU, px = rc[0] + Math.cos(a) * 1.3, pz = rc[1] + Math.sin(a) * 1.3, c = Math.cos(a), s = Math.sin(a);
                B.poly('rune', [[px + c * 0.14, y0 + 0.05, pz + s * 0.14], [px - s * 0.06, y0 + 0.05, pz + c * 0.06], [px - c * 0.14, y0 + 0.05, pz - s * 0.14], [px + s * 0.06, y0 + 0.05, pz - c * 0.06]], [0, 1, 0], {});
            }
        }

        // ---------------------------------------------------------------- перила, фонарные столбы, гирлянды
        const rail = (x0, z0, x1, z1) => {
            const alongX = Math.abs(z1 - z0) < 1e-6, len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), n = Math.max(1, Math.round(len / 3));
            const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
            B.box('wood_p', cx, y0 + 1.0, cz, alongX ? len : 0.16, 0.1, alongX ? 0.16 : len, { t: 0.95 });
            B.box('wood_p', cx, y0 + 0.42, cz, alongX ? len : 0.08, 0.07, alongX ? 0.08 : len, { t: 0.85 });
            const nb = Math.max(2, Math.round(len / 0.55));
            for (let i = 1; i < nb; i++) { const t = i / nb; B.box('wood_p', x0 + (x1 - x0) * t, y0 + 0.48, z0 + (z1 - z0) * t, 0.06, 0.95, 0.06, { t: 0.9 }); }
            for (let i = 0; i <= n; i++) {
                const t = i / n, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
                B.box('wood_p', px, y0 + 0.57, pz, 0.18, 1.14, 0.18, { t: 0.75 });
                B.box('wood_p', px, y0 + 1.17, pz, 0.26, 0.06, 0.26, { t: 0.7 });
            }
        };
        const RX = DX - 0.2, RF = ZF - 0.2, RB = ZB + 0.2;
        rail(RX, RB, RX, RF); rail(-RX, RB, -RX, RF);
        rail(-RX, RF, XD - 1.6, RF); rail(XD + 1.6, RF, RX, RF);
        rail(HW + 0.3, RB, RX, RB); rail(-RX, RB, -HW - 0.3, RB);
        rect(DX - 0.45, DX, ZB, ZF); rect(-DX, -DX + 0.45, ZB, ZF);
        rect(-DX, XD - 1.6, ZF - 0.45, ZF); rect(XD + 1.6, DX, ZF - 0.45, ZF);
        rect(HW, DX, ZB, ZB + 0.45); rect(-DX, -HW, ZB, ZB + 0.45);

        const lamp = (x, z) => {
            B.box('wood_p', x, y0 + 1.7, z, 0.2, 3.4, 0.2, { t: 0.7 });
            B.box('wood_p', x, y0 + 3.45, z, 0.32, 0.1, 0.32, { t: 0.7 });
            B.box('dark', x, y0 + 3.22, z + 0.0, 0.34, 0.05, 0.34, {});
            B.box('flame', x, y0 + 3.0, z, 0.22, 0.34, 0.22, {});
            rect(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
        };
        const lampPts = [[-RX, RF], [RX, RF], [-RX, 1.8], [RX, 1.8], [-RX, 5.0], [RX, 5.0]];
        for (const [x, z] of lampPts) lamp(x, z);
        const yLine = y0 + 3.15;
        bulbs(-RX, RF, RX, RF, yLine, 0.55);
        bulbs(-RX, RF, -RX, 1.8, yLine, 0.4);
        bulbs(RX, RF, RX, 1.8, yLine, 0.4);
        bulbs(-RX, 1.8, -HW + 0.3, 0.5, yLine, 0.2);
        // гирлянда через танцпол — между столбами по краям
        bulbs(-RX, 5.0, RX, 5.0, y0 + 3.25, 0.65);

        // ---------------------------------------------------------------- мебель террасы
        const table = (x, z, r, n, a0) => {
            B.cyl('wood_p', x, y0 + 0.72, z, r, r, 0.08, 16, { t: 1.0 });
            disc('wood_p', x, y0 + 0.8, z, r, 16, { t: 1.05 });
            B.cyl('wood_p', x, y0, z, 0.14, 0.1, 0.72, 8, { t: 0.8 });
            B.box('wood_p', x, y0 + 0.04, z, 0.7, 0.08, 0.7, { t: 0.8 });
            for (let i = 0; i < n; i++) {
                const a = a0 + i / n * TAU, sx = x + Math.cos(a) * (r + 0.4), sz = z + Math.sin(a) * (r + 0.4);
                B.cyl('wood_p', sx, y0, sz, 0.25, 0.22, 0.5, 8, { t: 0.85 });
                disc('wood_p', sx, y0 + 0.5, sz, 0.22, 8, { t: 0.9 });
            }
            rect(x - 1.25, x + 1.25, z - 1.25, z + 1.25);
        };
        const parasol = (x, z, col) => {
            B.cyl('wood_p', x, y0, z, 0.05, 0.05, 2.75, 6, { t: 0.9 });
            B.cyl('cloth', x, y0 + 2.3, z, 2.0, 0.05, 0.7, 12, { t: col });
            B.cyl('cloth', x, y0 + 2.18, z, 2.06, 2.0, 0.12, 12, { t: [col[0] * 0.78, col[1] * 0.78, col[2] * 0.78] });
            B.box('gold', x, y0 + 3.04, z, 0.08, 0.14, 0.08, {});
        };
        const TT = [[-7.9, 2.4, [0.82, 0.2, 0.17]], [-7.9, 6.0, [0.9, 0.78, 0.5]], [-5.35, 4.2, [0.15, 0.3, 0.62]], [-5.35, 7.6, [0.82, 0.2, 0.17]]];
        for (const [x, z] of TT) table(x, z, 0.8, 4, (x + z) * 0.3);   // зонтики убраны
        const barrel = (x, z, h, r) => {
            B.cyl('wood_p', x, y0, z, r, r, h, 12, { rings: 4, ent: 0.12, t: 0.9 });
            disc('wood_p', x, y0 + h, z, r, 12, { t: 0.8 });
            for (const t of [0.18, 0.5, 0.82]) { const rr = r * (1 + 0.12 * Math.sin(Math.PI * t)) + 0.015; B.cyl('dark', x, y0 + t * h - 0.03, z, rr, rr, 0.06, 12, { t: 0.7 }); }
        };
        const crate = (x, z, s, ry) => B.box('wood_p', x, y0 + s / 2, z, s, s, s, { ry, t: 0.95 });
        barrel(-8.7, 0.8, 0.95, 0.42); barrel(-8.7, 1.7, 0.95, 0.42);
        // цветочные ящики под передними окнами
        for (const x of WIN1.front) {
            B.box('wood_p', x, y0 + 0.7, 0.28, 1.5, 0.28, 0.32, { t: 0.9 });
            B.box('cloth_p', x, y0 + 0.91, 0.28, 1.4, 0.18, 0.28, { t: [0.18, 0.4, 0.14] });
            for (let i = 0; i < 7; i++) B.box('cloth_p', x - 0.6 + i * 0.2, y0 + 1.05 + (i % 2) * 0.05, 0.28 + ((i * 7) % 3 - 1) * 0.05, 0.11, 0.1, 0.11, { t: pick([[0.95, 0.35, 0.55], [0.98, 0.85, 0.3], [0.7, 0.45, 0.95], [0.95, 0.95, 0.95]]) });
        }

        // ---------------------------------------------------------------- интерьер зала
        {
            // стойка и полки
            B.box('wood_p', -5.2, y0 + 0.55, -4.3, 4.4, 1.1, 0.9, { t: 0.85 });
            B.box('wood_p', -5.2, y0 + 1.13, -4.3, 4.7, 0.1, 1.2, { t: 0.6 });
            for (const x of [-6.7, -5.4, -4.1]) { B.cyl('wood_p', x, y0, -3.35, 0.24, 0.21, 0.72, 8, { t: 0.8 }); disc('wood_p', x, y0 + 0.72, -3.35, 0.24, 8, { t: 0.8 }); }
            const cols = [[0.75, 0.2, 0.15], [0.2, 0.55, 0.25], [0.2, 0.35, 0.7], [0.85, 0.7, 0.25], [0.5, 0.2, 0.55]];
            for (let k = 0; k < 3; k++) {
                const y = y0 + 1.15 + k * 0.78;
                B.box('wood_p', -5.4, y, -7.28, 4.3, 0.07, 0.38, { t: 0.8 });
                for (let i = 0; i < 10; i++) B.box('cloth_p', -7.1 + i * 0.42 + (k % 2) * 0.1, y + 0.18, -7.28, 0.12, 0.3, 0.12, { t: pick(cols) });
            }
            for (const x of [-7.55 + 0.25, -3.25]) B.box('wood_p', x, y0 + 1.7, -7.28, 0.1, 2.3, 0.4, { t: 0.7 });
            barrel(-7.1, -5.6, 1.0, 0.45); barrel(-7.1, -6.5, 1.0, 0.45);
            rect(-7.5, -3.0, -7.5, -6.8); rect(-7.5, -2.95, -4.95, -3.1);
            // камин
            B.box('stone', 4.0, (y0 + Y1) / 2, -7.2, 3.0, Y1 - y0, 0.6, { t: [0.78, 0.78, 0.82], uv: 1.0 });
            B.box('dark', 4.0, y0 + 0.62, -6.88, 1.5, 1.05, 0.06, { t: 0.35 });
            B.box('flame', 4.0, y0 + 0.36, -6.84, 0.9, 0.4, 0.05, {});
            B.box('flame', 3.75, y0 + 0.72, -6.84, 0.4, 0.5, 0.05, {});
            B.box('wood', 4.0, y0 + 1.5, -6.78, 3.3, 0.14, 0.34, { t: 0.7 });
            B.box('cloth_p', 4.0, y0 + 0.016, -5.9, 2.4, 0.032, 1.4, { t: [0.5, 0.13, 0.1] });
            rect(2.4, 5.6, -7.5, -6.45);
            // столы в зале
            table(1.2, -3.3, 0.8, 4, 0.2); table(5.2, -3.7, 0.8, 4, 0.9); table(0.9, -6.2, 0.8, 3, 1.5);
            // колёса-люстры
            for (const [x, z] of [[-0.2, -3.4], [5.0, -5.2], [-4.6, -2.2]]) {
                const yw = Y1 - 1.35;
                B.box('dark', x, (Y1 + yw) / 2 - 0.1, z, 0.04, Y1 - yw - 0.1, 0.04, { t: 0.6 });
                for (let k = 0; k < 4; k++) B.box('wood_p', x, yw, z, 1.9, 0.08, 0.1, { ry: k * Math.PI / 4, t: 0.7 });
                for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B.box('flame', x + Math.cos(a) * 0.93, yw + 0.14, z - Math.sin(a) * 0.93, 0.07, 0.17, 0.07, {}); }
            }
            // знамёна и бочки у входа
            B.box('cloth_p', HW - 0.28, y0 + 2.1, -3.5, 0.06, 1.9, 1.0, { t: [0.12, 0.25, 0.6] });
            B.box('gold', HW - 0.31, y0 + 2.1, -3.5, 0.03, 0.4, 0.4, { ry: 0, rx: 0.78 });
            B.box('cloth_p', -HW + 0.28, y0 + 2.1, -3.5, 0.06, 1.9, 1.0, { t: [0.12, 0.25, 0.6] });
            barrel(7.0, -1.0, 0.95, 0.42); barrel(7.0, -1.9, 0.95, 0.42); rect(6.4, 7.6, -2.4, -0.5);
        }

        // ---------------------------------------------------------------- стены в коллизии
        rect(-HW - 0.1, HW + 0.1, ZB, ZB + WT + 0.05);
        rect(-HW - 0.1, -HW + WT + 0.05, ZB, 0.1); rect(HW - WT - 0.05, HW + 0.1, ZB, 0.1);
        rect(-HW - 0.1, XD - DG, -WT - 0.05, 0.1); rect(XD + DG, HW + 0.1, -WT - 0.05, 0.1);

        const platforms = [
            { cx: 0, cz: (ZF + ZB) / 2, hx: DX, hz: (ZF - ZB) / 2, y: y0, rampLen: 0.02, rampHx: 0, endY: 0 },                       // настил
            { cx: XD, cz: ZF - 0.25, hx: 1.6, hz: 0.25, y: y0, rampLen: 0.9, rampHx: 1.6, endY: 0 },                                 // ступени у входа
            { cx: (SX0 + SX1) / 2, cz: (SZ0 + SZ1) / 2, hx: (SX1 - SX0) / 2, hz: (SZ1 - SZ0) / 2, y: SY, rampLen: 0.9, rampHx: (SX1 - SX0) / 2, endY: y0 }   // сцена
        ];
        return { rects, platforms, platform: null, w: 2 * DX + 0.8, d: ZF - ZB + 0.8, h: yR + 1.5 };
    }

    // ------------------------------------------------------------------ «Рунные врата»: тёмная часовня-привратница над входом в подвал
    // Нава (дом над траншеей) с готической аркой на фасаде, контрфорсами, светящимися рунными окнами и колокольной башней сзади.
    // Начало координат — центр нефа: фасад (+Z) смотрит на дорогу, спуск подвала идёт от z=+4 (верх лестницы) к -z, туннель — под башней.
    function buildRuneGate(B, cfg) {
        const HO = 3.8, HI = 3.0, ZF = 7.0, YB = -0.4, YE = 5.0, TZ = -9.7;
        const rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
        const DK = [0.56, 0.58, 0.67], ST = [0.66, 0.68, 0.77], LT = [0.82, 0.84, 0.93];
        const rn = (k) => ({ t: [0.42 * k, 0.9 * k, 0.78 * k] });
        const rects = [rect(HI, HO + 0.75, -ZF - 0.15, ZF + 0.15), rect(-HO - 0.75, -HI, -ZF - 0.15, ZF + 0.15),
                       rect(2.75, HI, 6.2, 7.1), rect(-HI, -2.75, 6.2, 7.1), rect(-HI, HI, -7.1, -6.2), rect(-3.2, 3.2, -12.9, -6.5)];
        const pyr = (mat, cx, y, cz, s, h, o) => {
            const L = Math.hypot(s, h), a = s / L, b = h / L;
            B.poly(mat, [[cx - s, y, cz + s], [cx + s, y, cz + s], [cx, y + h, cz]], [0, a, b], o);
            B.poly(mat, [[cx - s, y, cz - s], [cx + s, y, cz - s], [cx, y + h, cz]], [0, a, -b], o);
            B.poly(mat, [[cx + s, y, cz - s], [cx + s, y, cz + s], [cx, y + h, cz]], [b, a, 0], o);
            B.poly(mat, [[cx - s, y, cz - s], [cx - s, y, cz + s], [cx, y + h, cz]], [-b, a, 0], o);
        };

        // боковые стены с цоколем и карнизом (между ними — траншея подвала, её парапет упирается в стены изнутри)
        for (const s of [-1, 1]) {
            B.box('stone', s * 3.4, (YB + YE) / 2, 0, 0.8, YE - YB, 2 * ZF, { t: DK });
            B.box('stone', s * 3.95, 0.05, 0, 0.5, 1.0, 2 * ZF + 0.3, { t: ST });
            B.box('stone', s * 3.575, YE + 0.12, 0, 1.15, 0.26, 2 * ZF + 0.5, { t: LT });
        }
        // фасадная и задняя стены (чуть утоплены относительно торцов боковых — без совпадающих плоскостей)
        const fz = ZF - 0.35;                       // центр толщины 0.7
        const wallTop = YE + 0.3;
        for (const s of [-1, 1]) B.box('stone', s * 3.0, (YB + wallTop) / 2, fz - 0.02, 0.4, wallTop - YB, 0.7, { t: DK });   // пилястры проёма (x 2.8…3.2)
        B.box('stone', 0, (4.3 + wallTop) / 2, fz - 0.02, 6.4, wallTop - 4.3, 0.7, { t: DK });                             // над проёмом
        B.box('stone', 0, (YB + wallTop) / 2, -fz + 0.02, 6.4, wallTop - YB, 0.7, { t: DK });                              // задняя стена
        // двускатная крыша с коньком вдоль Z, зелёно-синий сланец
        const a = 0.72, tan = Math.tan(a), ovh = 0.6, yW = YE + 0.25, run = HO + ovh;
        const yE = yW + 0.05 - ovh * tan, yR = yW + 0.05 + HO * tan, len = run / Math.cos(a) + 0.12, wr = 2 * ZF + 1.1;
        const xc = run / 2, yc = (yE + yR) / 2 + 0.11, sl = { rz: 0, bottom: true, uv: 1.0, t: [0.72, 0.95, 0.92] };
        B.box('slate', xc, yc, 0, len, 0.2, wr, Object.assign({}, sl, { rz: -a }));
        B.box('slate', -xc, yc, 0, len, 0.2, wr, Object.assign({}, sl, { rz: a }));
        B.box('wood', 0, yR + 0.17, 0, 0.42, 0.16, wr + 0.08, { t: 0.7 });
        for (const z of [fz - 0.02, -fz + 0.02]) B.prism('stone', 'z', z, yW - 0.02, HO, HO * tan + 0.02, 0.7, { t: DK });
        // стропильные балки и подвесные рунные лампы под крышей
        for (const z of [5.3, 1.9, -1.5, -4.9]) {
            B.box('wood', 0, YE - 0.15, z, 2 * HI + 0.4, 0.3, 0.34, { t: 0.75 });
            B.box('dark', 0, YE - 0.75, z, 0.04, 0.9, 0.04, {});
            B.box('rune', 0, YE - 1.35, z, 0.3, 0.3, 0.3, Object.assign({ rx: 0.785, rz: 0.785 }, rn(1)));
        }

        // готическая арка на фасаде: ряд клиньев + пилястры, руны в замках, сигил в тимпане
        const AR = 3.075, N = 13, zf = ZF + 0.08;
        for (let i = 0; i < N; i++) {
            const th = Math.PI * (i + 0.5) / N, cx = AR * Math.cos(th), cy = 4.3 + AR * Math.sin(th);
            B.box('stone', cx, cy, zf, 0.58, 0.8, 0.28, { rz: th - Math.PI / 2, t: i % 2 ? LT : ST });
            if (i % 2) B.box('rune', cx * 0.93, 4.3 + (AR - 0.08) * Math.sin(th), zf + 0.15, 0.1, 0.34, 0.03, Object.assign({ rz: th - Math.PI / 2 }, rn(1)));
        }
        B.box('gold', 0, 4.3 + AR + 0.55, zf + 0.04, 0.34, 0.34, 0.12, { rz: Math.PI / 4 });
        for (const s of [-1, 1]) {
            B.box('stone', s * AR, 1.95, zf, 0.58, 4.7, 0.28, { t: ST });
            B.box('stone', s * AR, -0.1, zf + 0.05, 0.78, 0.4, 0.4, { t: DK });
            B.box('stone', s * AR, 4.3, zf + 0.05, 0.74, 0.16, 0.36, { t: LT });
        }
        for (let i = 0; i < 8; i++) {       // рунное кольцо в тимпане
            const th = Math.PI * 2 * i / 8;
            B.box('rune', Math.cos(th) * 1.0, 6.0 + Math.sin(th) * 1.0, ZF - 0.03, 0.1, 0.46, 0.05, Object.assign({ rz: th - Math.PI / 2 }, rn(1)));
        }
        B.box('gold', 0, 6.0, ZF - 0.02, 0.5, 0.5, 0.07, { rz: Math.PI / 4 });
        B.box('rune', 0, 6.0, ZF - 0.03, 0.08, 1.7, 0.05, rn(0.8)); B.box('rune', 0, 6.0, ZF - 0.03, 1.7, 0.08, 0.05, rn(0.8));
        for (const s of [-1, 1]) {          // фонари в проёме
            B.box('dark', s * 2.35, 4.1, ZF + 0.05, 0.04, 0.4, 0.04, {});
            B.box('dark', s * 2.35, 3.52, ZF + 0.05, 0.3, 0.06, 0.3, {});
            B.box('flame', s * 2.35, 3.72, ZF + 0.05, 0.17, 0.3, 0.17, {});
            B.box('dark', s * 2.35, 3.92, ZF + 0.05, 0.32, 0.06, 0.32, {});
        }
        // бра с огнём на внутренних стенах (над парапетом траншеи)
        for (const z of [5.4, 2.2, -1.0, -4.2]) for (const s of [-1, 1]) {
            B.box('dark', s * 2.88, 2.35, z, 0.24, 0.1, 0.24, {});
            B.box('flame', s * 2.88, 2.55, z, 0.15, 0.28, 0.15, {});
        }

        // высокие рунные окна между контрфорсами
        const win = (fr) => B.frame(fr, () => {
            B.box('stone', 0, 1.2, 0.2, 1.3, 0.16, 0.4, { t: LT });
            B.box('stone', 0, 4.62, 0.14, 1.45, 0.24, 0.3, { t: LT });
            for (const sx of [-1, 1]) B.box('stone', sx * 0.58, 2.9, 0.13, 0.2, 3.3, 0.28, { t: LT });
            B.box('rune', 0, 2.9, 0.06, 0.8, 3.1, 0.08, rn(0.78));
            B.box('dark', 0, 2.9, 0.12, 0.07, 3.1, 0.05, {}); B.box('dark', 0, 2.0, 0.12, 0.8, 0.06, 0.05, {}); B.box('dark', 0, 3.8, 0.12, 0.8, 0.06, 0.05, {});
        });
        for (const z of [4.4, 0.4, -3.6]) { win({ x: HO, z, yaw: Math.PI / 2 }); win({ x: -HO, z, yaw: -Math.PI / 2 }); }
        // контрфорсы
        for (const z of [6.45, 2.4, -1.6, -5.6]) for (const s of [-1, 1]) {
            B.box('stone', s * 4.15, 1.85, z, 0.7, 4.5, 0.8, { t: ST });
            B.box('stone', s * 4.1, 4.3, z, 0.55, 0.5, 0.66, { t: LT });
            B.box('stone', s * 3.98, 4.7, z, 0.34, 0.3, 0.5, { t: LT });
        }

        // колокольня: основание, рунный пояс, бойницы, звонница с колоколом, шпиль
        B.box('stone', 0, 0.05, TZ - 0.05, 6.3, 1.0, 6.3, { t: ST });
        B.box('stone', 0, (YB + 9.4) / 2, TZ, 5.8, 9.8, 5.8, { t: DK });
        B.box('stone', 0, 6.6, TZ, 6.2, 0.3, 6.2, { t: LT });
        B.box('stone', 0, 9.55, TZ, 6.3, 0.3, 6.3, { t: LT });
        for (const s of [-1, 1]) {
            B.box('rune', s * 2.9, 8.1, TZ, 0.1, 0.2, 5.0, rn(1));
            for (const y of [3.4, 5.3]) {
                B.box('stone', s * 2.93, y, TZ, 0.12, 1.8, 0.62, { t: LT });
                B.box('rune', s * 3.0, y, TZ, 0.1, 1.45, 0.34, rn(0.8));
            }
        }
        B.box('rune', 0, 8.1, TZ - 2.9, 5.0, 0.2, 0.1, rn(1));
        for (const x of [-1.2, 1.2]) { B.box('stone', x, 4.4, TZ - 2.93, 0.62, 1.8, 0.12, { t: LT }); B.box('rune', x, 4.4, TZ - 3.0, 0.34, 1.45, 0.1, rn(0.8)); }
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('stone', sx * 2.5, 11.2, TZ + sz * 2.5, 0.7, 3.0, 0.7, { t: ST });
        for (const s of [-1, 1]) {
            B.box('stone', s * 2.5, 10.15, TZ, 0.5, 0.9, 4.3, { t: DK });
            B.box('stone', 0, 10.15, TZ + s * 2.5, 4.3, 0.9, 0.5, { t: DK });
        }
        B.box('stone', 0, 12.9, TZ, 6.3, 0.4, 6.3, { t: LT });
        B.box('wood', 0, 12.45, TZ, 0.3, 0.3, 5.0, { t: 0.7 });
        B.cyl('gold', 0, 11.2, TZ, 0.72, 0.3, 1.2, 12, {});
        B.box('dark', 0, 11.1, TZ, 0.1, 0.5, 0.1, {});
        pyr('slate', 0, 13.1, TZ, 3.15, 4.8, { t: [0.72, 0.95, 0.92], uv: 1.0 });
        B.poly('wood', [[-3.1, 13.09, TZ - 3.1], [3.1, 13.09, TZ - 3.1], [3.1, 13.09, TZ + 3.1], [-3.1, 13.09, TZ + 3.1]], [0, -1, 0], { t: 0.7 });
        B.box('gold', 0, 18.3, TZ, 0.18, 0.9, 0.18, {});
        B.box('rune', 0, 19.0, TZ, 0.3, 0.3, 0.3, Object.assign({ rx: 0.785, rz: 0.785 }, rn(1)));

        // рунные обелиски по сторонам подъезда
        for (const s of [-1, 1]) {
            const ox = s * 4.9, oz = 8.3;
            B.box('stone', ox, 0.35, oz, 1.1, 1.1, 1.1, { t: DK });
            B.box('stone', ox, 2.5, oz, 0.7, 3.3, 0.7, { t: ST });
            pyr('stone', ox, 4.15, oz, 0.35, 0.7, { t: LT });
            B.box('rune', ox, 2.5, oz + 0.37, 0.14, 2.2, 0.04, rn(1));
            B.box('rune', ox - s * 0.37, 2.5, oz, 0.04, 2.2, 0.14, rn(1));
            B.box('gold', ox, 5.1, oz, 0.16, 0.16, 0.16, { rx: 0.785, rz: 0.785 });
            rects.push(rect(ox - 0.8, ox + 0.8, oz - 0.8, oz + 0.8));
        }
        return { rects, platform: null, w: 2 * HO + 2, d: 2 * ZF + 6, h: 19.5 };
    }

    const TYPES = { stoneHouse: buildStoneHouse, marbleTemple: buildMarbleTemple, tavern: buildTavern, runeGate: buildRuneGate, corral: buildCorral };
    const CAMERA_BLOCK = { stoneHouse: ['stone', 'slate', 'wood', 'mstone', 'mplinth', 'mbeam'], marbleTemple: ['marble'], tavern: ['stone', 'plaster', 'slate', 'wood'], runeGate: ['stone', 'slate', 'wood'], corral: [] };

    // ------------------------------------------------------------------ менеджер локации
    class AveloraTown {
        constructor(game, cfg) {
            this.game = game; this.cfg = cfg; this.disposed = false;
            this.root = new THREE.Group(); this.root.name = 'town';
            game.locationRoot.add(this.root);
            this.shared = sharedMaterials();
            this.items = []; this.platformIds = [];
            this.stats = { buildings: 0, meshes: 0, triangles: 0 };
            for (const b of (cfg.buildings || [])) { try { this.add(b); } catch (e) { console.error('[Avelora] town building failed', b, e); } }
            AveloraTown.lastStats = this.stats;
        }

        /** До создания рельефа: ровная площадка (по высоте level) и чистая от травы поляна под каждым зданием. */
        static prepareLocation(loc) {
            const cfg = loc && loc.town;
            if (!cfg || cfg._prepared) return;
            cfg._prepared = true;
            const t = loc.terrain = loc.terrain || {};
            t.flatSpots = t.flatSpots || []; loc.clearings = loc.clearings || []; loc.noFerns = loc.noFerns || [];
            for (const b of (cfg.buildings || [])) {
                let dims, cx = b.x, cz = b.z;
                if (b.type === 'tavern') { dims = 13.6; cx += 0.7 * Math.sin(b.r || 0); cz += 0.7 * Math.cos(b.r || 0); }   // терраса смещена вперёд от начала здания
                else dims = b.type === 'marbleTemple' ? Math.hypot((b.HX || 3.9) + 0.8, (b.HZ || 5.0) + 0.8) : Math.hypot((b.W || 8.2) / 2 + 1, (b.D || 6.2) / 2 + 1);
                if (b.type === 'corral') dims = Math.hypot((b.W || 14) / 2 + 1, (b.D || 11) / 2 + 1);
                if (b.type === 'runeGate') dims = 12;     // площадку выравнивает плаза подвала (cellar.js), здесь только чистим траву
                else {
                    const fs = { x: cx, z: cz, radius: dims + 0.5, blend: 5.0 };
                    if (cfg.level) fs.hFrom = cfg.level;
                    t.flatSpots.push(fs);
                }
                loc.clearings.push({ x: cx, z: cz, radius: dims + 1.5 });
                loc.noFerns.push({ x: cx, z: cz, rx: dims + 2, rz: dims + 2 });
            }
        }

        add(b) {
            const game = this.game, terrain = game.terrain, build = TYPES[b.type];
            if (!build) return;
            const gy = terrain.getRawHeightAt(b.x, b.z), r = b.r || 0;
            const B = new Builder(b.x, gy, b.z, r, b.seed || 11);
            const info = build(B, b), blockers = CAMERA_BLOCK[b.type] || [];
            const group = new THREE.Group(); group.name = 'town:' + (b.id || b.type);
            const meshes = [];
            for (const name of Object.keys(B.bufs)) {
                const buf = B.bufs[name];
                if (!buf.i.length) continue;
                const m = buf.mesh(this.shared.mats[name] || this.shared.mats[name.split('_')[0]]);
                m.name = name; group.add(m); meshes.push(m);
                if (name.startsWith('cloth')) m.receiveShadow = false;       // тонкая ткань: муар от теневой карты не нужен
                if (name === 'flame' || name === 'rune') m.castShadow = false;
                this.stats.triangles += buf.tris();
            }
            this.root.add(group);
            this.stats.meshes += meshes.length; this.stats.buildings++;
            if (game.addCameraBlocker) for (const m of meshes) if (blockers.includes(m.name)) game.addCameraBlocker(m);

            const rec = { id: b.id, x: b.x, z: b.z, r, y: gy, cos: Math.cos(r), sin: Math.sin(r), group, meshes, info };
            if (info.platforms) {      // несколько настилов со смещением от начала здания (таверна: терраса, ступени, сцена)
                info.platforms.forEach((p, i) => {
                    const id = 'town:' + (b.id || b.type) + ':' + i;
                    terrain.addPlatform({ id, x: b.x + p.cx * rec.cos + p.cz * rec.sin, z: b.z - p.cx * rec.sin + p.cz * rec.cos, cos: rec.cos, sin: rec.sin, hx: p.hx, hz: p.hz, y: gy + p.y, rampLen: p.rampLen, rampHx: p.rampHx, endY: gy + p.endY, reach2: Math.pow(Math.hypot(p.hx, p.hz) + p.rampLen + 1.5, 2) });
                    this.platformIds.push(id);
                });
            }
            if (info.platform) {
                const p = info.platform, id = 'town:' + (b.id || b.type);
                const plat = { id, x: b.x, z: b.z, cos: rec.cos, sin: rec.sin, hx: p.hx, hz: p.hz, y: gy + p.y, rampLen: p.rampLen, rampHx: p.hx, endY: gy, reach2: Math.pow(Math.hypot(p.hx, p.hz) + p.rampLen + 1.5, 2) };
                terrain.addPlatform(plat); this.platformIds.push(id);
            }
            const pf = game.pathfinder;
            if (pf) for (const R of info.rects) this.blockRect(pf, rec, R);
            this.items.push(rec);
        }

        blockRect(pf, b, R) {
            const reach = Math.hypot(Math.max(Math.abs(R.x0), Math.abs(R.x1)), Math.max(Math.abs(R.z0), Math.abs(R.z1))) + 1.2;
            const g0 = pf.worldToGrid(b.x - reach, b.z - reach), g1 = pf.worldToGrid(b.x + reach, b.z + reach);
            const ext = 0.5 * pf.cellWidth * (Math.abs(b.cos) + Math.abs(b.sin));
            for (let gz = g0.z; gz <= g1.z; gz++) for (let gx = g0.x; gx <= g1.x; gx++) {
                const w = pf.gridToWorld(gx, gz), dx = w.x - b.x, dz = w.z - b.z;
                const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
                if (lx + ext > R.x0 && lx - ext < R.x1 && lz + ext > R.z0 && lz - ext < R.z1) {
                    const idx = pf.getIndex(gx, gz);
                    if (idx >= 0 && idx < pf.grid.length) pf.grid[idx] = 1;
                }
            }
        }

        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            const terrain = this.game.terrain;
            if (terrain && terrain.removePlatform) for (const id of this.platformIds) terrain.removePlatform(id);
            this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            if (this.root.parent) this.root.parent.remove(this.root);
            releaseMaterials();
        }
    }

    // для headless-теста без игры
    AveloraTown._internals = { Builder, TYPES, sharedMaterials, buildStoneHouse, buildMarbleTemple, buildTavern, buildRuneGate };
    window.AveloraTown = AveloraTown;
})();
