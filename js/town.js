/**
 * town.js — процедурные здания «города» (AveloraTown). Ни одной модели: форма строится кодом из коробок и цилиндров,
 * камень и мрамор рисуются на canvas при запуске (периодические текстуры 512 px на 2 м, плюс bump-карта у камня).
 *
 * Зачем так: вся геометрия здания склеивается в несколько Mesh (по одному на материал) в мировых координатах,
 * поэтому здание = 2–5 вызовов отрисовки и пара тысяч треугольников, а материалы/текстуры общие для всех зданий.
 *
 * Конфиг локации (world_data.js):
 *   town: { level: [x, z],              // точка, по высоте которой выравнивается земля под зданиями (обычно край дороги)
 *           buildings: [ { id, type: 'stoneHouse' | 'marbleTemple', x, z, r, ...параметры } ] }
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

    let SHARED = null;
    function sharedMaterials() {
        if (SHARED) { SHARED.refs++; return SHARED; }
        const T = { stone: makeStoneTex(), marble: makeMarbleTex(), wood: makeWoodTex(), slate: makeSlateTex() };
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
                flame: new THREE.MeshBasicMaterial({ color: 0xffc064, vertexColors: true })
            }
        };
        return SHARED;
    }
    function releaseMaterials() {
        if (!SHARED) return;
        if (--SHARED.refs > 0) return;
        Object.values(SHARED.mats).forEach(m => m.dispose());
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
        const rects = [rect(-W / 2 - 0.3, W / 2 + 0.3, -D / 2 - 0.3, D / 2 + 0.3), rect(-1.15, 1.15, FR, FR + 1.05)];

        // цоколь и тело
        B.box('stone', 0, -0.025, 0, W + 0.4, 1.15, D + 0.4, { t: [0.74, 0.74, 0.76], jit: 0.0 });          // от -0.6 до 0.55
        B.box('stone', 0, (0.55 + H) / 2, 0, W, H - 0.55, D, { t: [1.0, 1.0, 1.03] });
        // тёмный деревянный пояс и каменный карниз
        B.box('wood', 0, H - 0.2, 0, W + 0.14, 0.24, D + 0.14, { t: [0.8, 0.8, 0.8] });
        B.box('stone', 0, H + 0.12, 0, W + 0.5, 0.26, D + 0.5, { t: [0.84, 0.84, 0.88] });
        // двускатная сланцевая крыша, конёк вдоль X
        const a = 0.64, tan = Math.tan(a), ovh = 0.55, yW = H + 0.25, run = D / 2 + ovh;
        const yE = yW + 0.05 - ovh * tan, yR = yW + 0.05 + (D / 2) * tan, len = run / Math.cos(a) + 0.12, wr = W + 1.1;
        const zc = run / 2, yc = (yE + yR) / 2 + 0.11;
        B.box('slate', 0, yc, zc, wr, 0.2, len, { rx: a, bottom: true, uv: 1.0 });
        B.box('slate', 0, yc, -zc, wr, 0.2, len, { rx: -a, bottom: true, uv: 1.0 });
        B.box('wood', 0, yR + 0.17, 0, wr + 0.08, 0.16, 0.42, { t: [0.7, 0.7, 0.7] });                       // коньковый брус
        // фронтоны (торцы) из камня
        for (const sx of [-1, 1]) B.prism('stone', 'x', sx * (W / 2 - 0.25), yW - 0.02, D / 2, (D / 2) * tan + 0.02, 0.5, { t: [0.95, 0.95, 0.98] });
        // дымоход
        const chX = -W / 2 + 1.5, chZ = -D / 2 + 1.25, chTop = yR + 0.7;
        B.box('stone', chX, (H - 0.3 + chTop) / 2, chZ, 0.95, chTop - H + 0.3, 0.95, { t: [0.82, 0.82, 0.85], uv: 1.0 });
        B.box('stone', chX, chTop + 0.1, chZ, 1.2, 0.2, 1.2, { t: [0.7, 0.7, 0.72] });
        B.box('dark', chX, chTop + 0.22, chZ, 0.72, 0.06, 0.72, {});
        rects.push(rect(chX - 0.5, chX + 0.5, chZ - 0.5, chZ + 0.5));

        // дверь у фасада: крыльцо, косяк, перемычка с замковым камнем, створка с полосами и ручками
        const dy = 0.55;
        B.box('stone', 0, 0.25, FR + 0.55, 2.2, 0.5, 0.9, { t: [0.86, 0.86, 0.9] });
        for (const sx of [-1, 1]) B.box('stone', sx * 0.98, dy + 1.3, FR + 0.1, 0.36, 2.6, 0.4, { t: [0.82, 0.82, 0.86], ou: 0.4 });
        B.box('stone', 0, dy + 2.62, FR + 0.1, 2.5, 0.38, 0.46, { t: [0.8, 0.8, 0.84] });
        B.box('stone', 0, dy + 2.62, FR + 0.36, 0.5, 0.42, 0.06, { t: [0.98, 0.98, 1.0] });
        B.box('wood', 0, dy + 1.15, FR + 0.03, 1.5, 2.3, 0.14, { uv: 1.0 });
        for (const yy of [0.5, 1.8]) B.box('dark', 0, dy + yy, FR + 0.11, 1.52, 0.09, 0.03, {});
        for (const sx of [-1, 1]) B.box('gold', sx * 0.16, dy + 1.1, FR + 0.12, 0.07, 0.07, 0.05, {});

        // окна: подоконник, перемычка, рама, стекло, переплёт, ставни
        const win = (fr, y) => B.frame(fr, () => {
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
        B.box('wood', 1.55, 3.0, FR + 0.22, 0.09, 0.09, 0.46, { t: 0.7 });
        B.box('dark', 1.55, 3.28, FR + 0.43, 0.24, 0.05, 0.24, {});
        B.box('flame', 1.55, 3.08, FR + 0.43, 0.17, 0.3, 0.17, {});
        return { rects, platform: null, w: W, d: D, h: yR + 1.2 };
    }

    // ------------------------------------------------------------------ белый мраморный храм (греческий периптер)
    function buildMarbleTemple(B, cfg) {
        const HX = cfg.HX || 3.9, HZ = cfg.HZ || 5.0, y0 = 0.45, rect = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
        const rects = [];
        // стилобат: фундамент и три ступени (верх последней — пол на y0)
        B.box('marble', 0, -0.3, 0, 2 * HX + 1.7, 0.6, 2 * HZ + 1.7, { t: 0.9 });
        B.box('marble', 0, 0.075, 0, 2 * HX + 1.6, 0.15, 2 * HZ + 1.6, { t: 0.98, bottom: false });
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
        B.cyl('marble', 0, y0, 0.0, 0.16, 0.34, 0.75, 14, {});
        B.cyl('marble', 0, y0 + 0.75, 0.0, 0.46, 0.34, 0.16, 16, {});
        rects.push(rect(-0.8, 0.8, zB + 0.35, zB + 1.75), rect(-0.4, 0.4, -0.4, 0.4));

        const stylo = { hx: HX, hz: HZ, y: y0, rampLen: 0.8 };
        return { rects, platform: stylo, w: 2 * HX + 1.6, d: 2 * HZ + 1.6, h: yRg + 0.5 };
    }

    const TYPES = { stoneHouse: buildStoneHouse, marbleTemple: buildMarbleTemple };
    const CAMERA_BLOCK = { stoneHouse: ['stone', 'slate', 'wood'], marbleTemple: ['marble'] };

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
                const dims = b.type === 'marbleTemple' ? Math.hypot((b.HX || 3.9) + 0.8, (b.HZ || 5.0) + 0.8) : Math.hypot((b.W || 8.2) / 2 + 1, (b.D || 6.2) / 2 + 1);
                const fs = { x: b.x, z: b.z, radius: dims + 0.5, blend: 5.0 };
                if (cfg.level) fs.hFrom = cfg.level;
                t.flatSpots.push(fs);
                loc.clearings.push({ x: b.x, z: b.z, radius: dims + 1.5 });
                loc.noFerns.push({ x: b.x, z: b.z, rx: dims + 2, rz: dims + 2 });
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
                const m = buf.mesh(this.shared.mats[name]);
                m.name = name; group.add(m); meshes.push(m);
                this.stats.triangles += buf.tris();
            }
            this.root.add(group);
            this.stats.meshes += meshes.length; this.stats.buildings++;
            if (game.addCameraBlocker) for (const m of meshes) if (blockers.includes(m.name)) game.addCameraBlocker(m);

            const rec = { id: b.id, x: b.x, z: b.z, r, y: gy, cos: Math.cos(r), sin: Math.sin(r), group, meshes, info };
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
    AveloraTown._internals = { Builder, TYPES, sharedMaterials, buildStoneHouse, buildMarbleTemple };
    window.AveloraTown = AveloraTown;
})();
