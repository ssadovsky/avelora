/**
 * lava.js — лавовые реки локации (terrain.lavaRivers / terrain.lavaPools в world_data.js).
 *
 * Что делает:
 *  1) bake(): по ломаным из world_data строит плавные извилистые русла и запекает их ОДИН раз при загрузке локации
 *     в текстуру поля расстояний (R — расстояние до кромки лавы со знаком, G/B — направление течения).
 *     Шейдер земли (terrain.js, groundSet 'burnt') читает её одной выборкой: лава, корка берега, светящиеся трещины,
 *     тёплый отсвет на земле. Циклов по отрезкам в пикселе нет — нагрузка на GPU не растёт с числом рек.
 *  2) dh(x, z): небольшой рельеф — русло чуть утоплено, по берегам наплывы застывшей корки (terrain.getRawHeightAt).
 *  3) createFX(): искры над лавой и дым/жар — два THREE.Points (2 вызова отрисовки), вся анимация в вершинном шейдере.
 *
 * Формат world_data:
 *   lavaRivers: [{ w: 3.2, meander: 1.6, seed: 1, from: 0.5, to: 1.0, points: [[x, z], ...] }]
 *       w — средняя ширина (м); meander — боковые изгибы (м); from/to — доля ширины в начале/конце (0 = сходит на нет);
 *       точки идут ПО ТЕЧЕНИЮ (от истока к устью).
 *   lavaPools:  [{ x, z, r }] — лавовые озёра.
 *   lavaPits:   [{ x, z, rx, rz, depth, wall, lip, flow: [dx, dz] }] — разлом: яма с лавой на дне (rx/rz — полуоси зеркала лавы,
 *       wall — ширина склона, depth — глубина, lip — вздыбленная кромка, flow — куда течёт лава на дне).
 *   lavaCrust:  [{ points: [[x, z], ...], soft: 3 }] — многоугольник сплошной застывшей корки (текстура как есть: серо-синий базальт
 *       с огненными швами), без рельефа; у рек их собственная кромка остаётся. Пишется в альфа-канал поля.
 *   lavaCracks: [{ x, z, rx, rz }] — пятно растрескавшейся корки с огненными швами БЕЗ расплава и без рельефа (ходить можно ровно).
 */
(function () {
    const PX = 3;              // пикселей текстуры на метр
    const SD_IN = 4.0;         // кодируемая глубина внутрь русла (м)
    const SD_RANGE = 16.0;     // весь кодируемый диапазон (м): от -4 до +12
    const SD_FAR = SD_RANGE - SD_IN;

    const time = { value: 0 };   // общее время для шейдера земли и частиц (обновляет terrain.mesh.onBeforeRender)

    function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
    function noise1(t, seed) {
        const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
        return hash(i + seed * 57.0) * (1 - u) + hash(i + 1 + seed * 57.0) * u;
    }
    function ss(a, b, v) { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); }

    /** Ломаная → плавная кривая (Catmull-Rom) с шагом ~1 м, боковыми изгибами и переменной шириной. */
    function buildRiver(r, idx) {
        const P = r.points, seed = (r.seed !== undefined ? r.seed : idx + 1);
        const raw = [];
        for (let i = 0; i + 1 < P.length; i++) {
            const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
            const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            const n = Math.max(2, Math.ceil(len));
            for (let k = 0; k < n; k++) {
                const t = k / n, t2 = t * t, t3 = t2 * t;
                raw.push([
                    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
                ]);
            }
        }
        raw.push([P[P.length - 1][0], P[P.length - 1][1]]);
        const N = raw.length, out = [];
        const A = (r.meander !== undefined) ? r.meander : 1.5;
        const w = r.w || 3.0, kFrom = (r.from !== undefined) ? r.from : 0.55, kTo = (r.to !== undefined) ? r.to : 1.0;
        let s = 0;
        for (let i = 0; i < N; i++) {
            const a = raw[Math.max(0, i - 1)], b = raw[Math.min(N - 1, i + 1)];
            let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
            if (i > 0) s += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
            const u = i / (N - 1);
            const endFade = ss(0, 7, i) * ss(0, 7, N - 1 - i);   // у концов изгибов нет: русла сходятся точно в заданных точках
            const off = A * endFade * ((noise1(s * 0.085, seed) - 0.5) * 2.0 + (noise1(s * 0.26, seed + 9) - 0.5) * 0.7);
            const hw = 0.5 * w * (kFrom + (kTo - kFrom) * u) * (0.78 + 0.5 * noise1(s * 0.12, seed + 21));
            out.push({ x: raw[i][0] - tz * off, z: raw[i][1] + tx * off, hw });
        }
        return out;
    }

    function bake(locTerrain, sizeX, sizeZ) {
        const rivers = locTerrain.lavaRivers || [], pools = locTerrain.lavaPools || [], cracks = locTerrain.lavaCracks || [], pits = locTerrain.lavaPits || [], crusts = locTerrain.lavaCrust || [];
        if (!rivers.length && !pools.length && !cracks.length && !pits.length && !crusts.length) return null;
        const minX = -sizeX / 2, minZ = -sizeZ / 2;
        const W = Math.min(2048, Math.round(sizeX * PX)), H = Math.min(2048, Math.round(sizeZ * PX));
        const sx = sizeX / W, sz = sizeZ / H;
        const sd = new Float32Array(W * H).fill(SD_FAR), dX = new Float32Array(W * H), dZ = new Float32Array(W * H);
        const curves = rivers.map(buildRiver);
        const R = SD_FAR;
        curves.forEach(c => {
            for (let q = 0; q + 1 < c.length; q++) {
                const a = c[q], b = c[q + 1];
                const abx = b.x - a.x, abz = b.z - a.z, ab2 = Math.max(abx * abx + abz * abz, 1e-4), al = Math.sqrt(ab2);
                const fx = abx / al, fz = abz / al, hwM = Math.max(a.hw, b.hw);
                const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R - hwM - minX) / sx)), i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x) + R + hwM - minX) / sx));
                const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - R - hwM - minZ) / sz)), j1 = Math.min(H - 1, Math.ceil((Math.max(a.z, b.z) + R + hwM - minZ) / sz));
                for (let j = j0; j <= j1; j++) {
                    const pz = minZ + (j + 0.5) * sz;
                    for (let i = i0; i <= i1; i++) {
                        const px = minX + (i + 0.5) * sx;
                        let t = ((px - a.x) * abx + (pz - a.z) * abz) / ab2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
                        const ex = px - (a.x + abx * t), ez = pz - (a.z + abz * t);
                        const v = Math.sqrt(ex * ex + ez * ez) - (a.hw + (b.hw - a.hw) * t);
                        const k = j * W + i;
                        if (v < sd[k]) { sd[k] = v; dX[k] = fx; dZ[k] = fz; }
                    }
                }
            }
        });
        pools.forEach((p, pi) => {
            const rr = p.r + R + 2;
            const i0 = Math.max(0, Math.floor((p.x - rr - minX) / sx)), i1 = Math.min(W - 1, Math.ceil((p.x + rr - minX) / sx));
            const j0 = Math.max(0, Math.floor((p.z - rr - minZ) / sz)), j1 = Math.min(H - 1, Math.ceil((p.z + rr - minZ) / sz));
            for (let j = j0; j <= j1; j++) {
                const pz = minZ + (j + 0.5) * sz;
                for (let i = i0; i <= i1; i++) {
                    const px = minX + (i + 0.5) * sx, ex = px - p.x, ez = pz - p.z, d = Math.hypot(ex, ez) || 1e-3;
                    const ang = Math.atan2(ez, ex);
                    const lobes = 1.0 + 0.10 * Math.sin(ang * 2.0 + pi * 1.7) + 0.06 * Math.sin(ang * 3.0 + pi * 4.1) + 0.03 * Math.sin(ang * 7.0 + pi);
                    const v = d - p.r * lobes;
                    const k = j * W + i;
                    if (v < sd[k]) { sd[k] = v; dX[k] = Math.cos(pi * 2.1 + 0.7) * 0.22; dZ[k] = Math.sin(pi * 2.1 + 0.7) * 0.22; }   // в озере — медленный дрейф корки в одну сторону
                }
            }
        });
        // разломы: зеркало лавы на дне ямы + склоны; рельеф ямы хранится отдельно (extra), чтобы не зависеть от профиля рек
        const extra = new Float32Array(W * H);
        pits.forEach((p, pi) => {
            const rx = p.rx || 3, rz = p.rz || 5, wall = p.wall || 2.4, depth = p.depth || 2.0, lip = (p.lip !== undefined) ? p.lip : 0.22;
            const fl = p.flow || [0, -0.5], rmin = Math.min(rx, rz), rm = Math.max(rx, rz) + wall + R + 3;
            const i0 = Math.max(0, Math.floor((p.x - rm - minX) / sx)), i1 = Math.min(W - 1, Math.ceil((p.x + rm - minX) / sx));
            const j0 = Math.max(0, Math.floor((p.z - rm - minZ) / sz)), j1 = Math.min(H - 1, Math.ceil((p.z + rm - minZ) / sz));
            for (let j = j0; j <= j1; j++) {
                const pz = minZ + (j + 0.5) * sz;
                for (let i = i0; i <= i1; i++) {
                    const px = minX + (i + 0.5) * sx, ex = (px - p.x) / rx, ez = (pz - p.z) / rz;
                    const ang = Math.atan2(ez, ex);
                    // рваный контур: крупные выступы + мелкие зубцы
                    const lobes = 1.0 + 0.13 * Math.sin(ang * 3.0 + pi * 2.3 + 0.6) + 0.09 * Math.sin(ang * 5.0 + 1.9) + 0.06 * Math.sin(ang * 11.0 + 0.4) + 0.04 * Math.sin(ang * 17.0 + 2.2);
                    const kk = Math.hypot(ex, ez) || 1e-3;
                    const v = (kk - lobes) / kk * Math.hypot(px - p.x, pz - p.z);   // расстояние до контура в метрах по любому направлению (а не сжатое вдоль длинной оси)
                    const k = j * W + i;
                    if (v < sd[k]) { sd[k] = v; dX[k] = fl[0]; dZ[k] = fl[1]; }
                    if (v < wall + 2.2) {
                        const t = Math.max(0, v) / wall;
                        // склон с уступом посередине (намёк на ступени), выше — вздыбленная кромка
                        const down = -depth * (1.0 - (0.55 * ss(0.0, 0.42, t) + 0.45 * ss(0.58, 1.0, t)));
                        const e = (v - wall - 0.5) / 0.75;
                        const hh = down + lip * Math.exp(-e * e) * (0.6 + 0.8 * noise1(ang * 2.2 + 40, pi + 3));
                        if (hh < extra[k] || extra[k] === 0) extra[k] = hh;
                    }
                }
            }
        });
        // пятна трещин: расстояние держится около 1 м от «кромки» — шейдер рисует корку и швы, но не расплав
        const flat = new Uint8Array(W * H);
        const CRACK_SD = 1.05;
        cracks.forEach((p, pi) => {
            const rx = p.rx || p.r || 4, rz = p.rz || p.r || 4, rm = Math.max(rx, rz) + R;
            const i0 = Math.max(0, Math.floor((p.x - rm - minX) / sx)), i1 = Math.min(W - 1, Math.ceil((p.x + rm - minX) / sx));
            const j0 = Math.max(0, Math.floor((p.z - rm - minZ) / sz)), j1 = Math.min(H - 1, Math.ceil((p.z + rm - minZ) / sz));
            for (let j = j0; j <= j1; j++) {
                const pz = minZ + (j + 0.5) * sz;
                for (let i = i0; i <= i1; i++) {
                    const px = minX + (i + 0.5) * sx, ex = (px - p.x) / rx, ez = (pz - p.z) / rz;
                    const ang = Math.atan2(ez, ex);
                    const lobes = 1.0 + 0.14 * Math.sin(ang * 3.0 + pi * 2.3) + 0.08 * Math.sin(ang * 5.0 + pi * 1.1);
                    const v = CRACK_SD + Math.max(0, (Math.hypot(ex, ez) - lobes) * Math.min(rx, rz));
                    const k = j * W + i;
                    if (v < sd[k]) { sd[k] = v; flat[k] = 1; }
                }
            }
        });
        // поля застывшей корки: маска 0..1 (мягкий край шириной soft м внутрь многоугольника)
        const crustM = new Float32Array(W * H);
        crusts.forEach(c => {
            const P = c.points || [], n = P.length, soft = c.soft || 3.0;
            if (n < 3) return;
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
            P.forEach(q => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); });
            const i0 = Math.max(0, Math.floor((x0 - minX) / sx)), i1 = Math.min(W - 1, Math.ceil((x1 - minX) / sx));
            const j0 = Math.max(0, Math.floor((z0 - minZ) / sz)), j1 = Math.min(H - 1, Math.ceil((z1 - minZ) / sz));
            for (let j = j0; j <= j1; j++) {
                const pz = minZ + (j + 0.5) * sz;
                for (let i = i0; i <= i1; i++) {
                    const px = minX + (i + 0.5) * sx;
                    let inside = false, dmin = Infinity;
                    for (let a = 0, b = n - 1; a < n; b = a++) {
                        const ax = P[a][0], az = P[a][1], bx = P[b][0], bz = P[b][1];
                        if ((az > pz) !== (bz > pz) && px < (bx - ax) * (pz - az) / (bz - az) + ax) inside = !inside;
                        const ex = bx - ax, ez = bz - az; let t = ((px - ax) * ex + (pz - az) * ez) / Math.max(ex * ex + ez * ez, 1e-6); t = t < 0 ? 0 : (t > 1 ? 1 : t);
                        const d = Math.hypot(px - (ax + ex * t), pz - (az + ez * t)); if (d < dmin) dmin = d;
                    }
                    if (inside) { const m = Math.min(1, dmin / soft), k = j * W + i; if (m > crustM[k]) crustM[k] = m; }
                }
            }
        });
        const data = new Uint8Array(W * H * 4);
        for (let k = 0; k < W * H; k++) {
            data[k * 4] = Math.round(Math.min(1, Math.max(0, (sd[k] + SD_IN) / SD_RANGE)) * 255);
            data[k * 4 + 1] = Math.round((dX[k] * 0.5 + 0.5) * 255);
            data[k * 4 + 2] = Math.round((dZ[k] * 0.5 + 0.5) * 255);
            data[k * 4 + 3] = Math.round(crustM[k] * 255);   // A — маска поля корки (lavaCrust)
        }
        const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
        tex.premultiplyAlpha = false;
        tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;

        const field = {
            texture: tex, rect: new THREE.Vector4(minX, minZ, 1 / sizeX, 1 / sizeZ), W, H, sd, curves, pools,
            /** расстояние до кромки лавы, м (отрицательное — внутри русла); билинейно */
            sdAt(x, z) {
                const u = (x - minX) / sx - 0.5, v = (z - minZ) / sz - 0.5;
                if (u < 0 || v < 0 || u >= W - 1 || v >= H - 1) return SD_FAR;
                const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * W + i;
                return (sd[k] * (1 - fu) + sd[k + 1] * fu) * (1 - fv) + (sd[k + W] * (1 - fu) + sd[k + W + 1] * fu) * fv;
            },
            /** добавка к высоте земли: русло утоплено, по берегам — валики застывшей корки */
            dh(x, z) {
                {   // разлом: свой рельеф (билинейно)
                    const u = (x - minX) / sx - 0.5, v = (z - minZ) / sz - 0.5;
                    if (u >= 0 && v >= 0 && u < W - 1 && v < H - 1) {
                        const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * W + i;
                        const e = (extra[k] * (1 - fu) + extra[k + 1] * fu) * (1 - fv) + (extra[k + W] * (1 - fu) + extra[k + W + 1] * fu) * fv;
                        if (e !== 0) return e;
                    }
                }
                const d = this.sdAt(x, z);
                if (d > 3.6) return 0;
                const fi = Math.round((x - minX) / sx - 0.5), fj = Math.round((z - minZ) / sz - 0.5);
                if (fi >= 0 && fj >= 0 && fi < W && fj < H && flat[fj * W + fi]) return 0;   // пятна трещин — без рельефа
                // пологий профиль (маунт и существа не «клюют носом»): валик 7 см шириной ~3 м, дно утоплено на 12 см плавно за 2+ м
                const e = (d - 1.0) / 1.3;
                return 0.07 * Math.exp(-e * e) - 0.12 * ss(0.8, -1.6, d);
            },
            /** true внутри разлома (склон и дно): для навигации — туда нельзя */
            blocked(x, z) {
                const i = Math.round((x - minX) / sx - 0.5), j = Math.round((z - minZ) / sz - 0.5);
                return i >= 0 && j >= 0 && i < W && j < H && extra[j * W + i] < -0.12;
            },
            /** случайные точки на лаве (для частиц): [x, z, глубина] */
            samplePoints(n, seed) {
                const out = []; let tries = 0, s = seed || 1;
                const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
                const inside = [];
                for (let k = 0; k < W * H; k += 7) if (sd[k] < -0.35) inside.push(k);
                if (!inside.length) return out;
                while (out.length < n && tries++ < n * 4) {
                    const k = inside[(rnd() * inside.length) | 0];
                    out.push([minX + ((k % W) + rnd()) * sx, minZ + (((k / W) | 0) + rnd()) * sz, -sd[k]]);
                }
                return out;
            },
            dispose() { tex.dispose(); }
        };
        return field;
    }

    /** Искры и дым над лавой. parent — корень локации; terrain — для высоты земли. */
    function createFX(parent, field, terrain) {
        const low = !!(window.GFX && window.GFX.mobile);
        const nEmb = low ? 260 : 620, nSmk = low ? 50 : 130;
        const scale = { value: 600 };
        const objs = [];

        // --- искры ---
        {
            const pts = field.samplePoints(nEmb, 7);
            const pos = new Float32Array(pts.length * 3), seedA = new Float32Array(pts.length * 4);
            pts.forEach((p, i) => {
                pos[i * 3] = p[0]; pos[i * 3 + 1] = terrain.getHeightAt(p[0], p[1], null) + 0.05; pos[i * 3 + 2] = p[1];
                seedA[i * 4] = hash(i * 1.37 + 3);                    // фаза
                seedA[i * 4 + 1] = 0.10 + 0.16 * hash(i * 2.11 + 5);  // скорость цикла (1/с)
                seedA[i * 4 + 2] = 1.6 + 4.6 * hash(i * 3.71 + 8);    // высота подъёма (м)
                seedA[i * 4 + 3] = 0.05 + 0.08 * hash(i * 5.03 + 1);  // размер (м)
            });
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
            const m = new THREE.ShaderMaterial({
                uniforms: { uTime: time, uScale: scale },
                vertexShader: `
                    attribute vec4 aSeed; uniform float uTime; uniform float uScale; varying float vA; varying float vT;
                    void main() {
                        float t = fract(uTime * aSeed.y + aSeed.x);
                        vec3 p = position;
                        float w = aSeed.x * 40.0;
                        p.y += t * aSeed.z;
                        p.x += (sin(t * 7.0 + w) * 0.35 + t * 0.9) * t * 1.6;
                        p.z += cos(t * 5.3 + w * 1.7) * 0.45 * t * 1.6;
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_Position = projectionMatrix * mv;
                        float px = aSeed.w * uScale / max(0.5, -mv.z);
                        gl_PointSize = clamp(px, 1.6, 14.0);
                        float flick = 0.65 + 0.35 * sin(uTime * (9.0 + aSeed.x * 11.0) + w);
                        vA = sin(3.14159 * t) * flick * clamp(px / 1.6, 0.25, 1.0) * (1.0 - smoothstep(110.0, 170.0, -mv.z));
                        vT = t;
                    }`,
                fragmentShader: `
                    varying float vA; varying float vT;
                    void main() {
                        vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0;
                        float a = (1.0 - smoothstep(0.0, 1.0, d)) * vA;
                        vec3 col = mix(vec3(1.0, 0.72, 0.28), vec3(1.0, 0.22, 0.03), smoothstep(0.1, 0.8, vT));
                        gl_FragColor = vec4(col * a * 1.6, 1.0);
                    }`,
                blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
            });
            const o = new THREE.Points(g, m); o.frustumCulled = false; o.renderOrder = 6; objs.push(o);
        }

        // --- дым и жар ---
        {
            const pts = field.samplePoints(nSmk, 23);
            const pos = new Float32Array(pts.length * 3), seedA = new Float32Array(pts.length * 4);
            pts.forEach((p, i) => {
                pos[i * 3] = p[0]; pos[i * 3 + 1] = terrain.getHeightAt(p[0], p[1], null) + 0.4; pos[i * 3 + 2] = p[1];
                seedA[i * 4] = hash(i * 1.91 + 13);
                seedA[i * 4 + 1] = 0.050 + 0.035 * hash(i * 2.77 + 2);
                seedA[i * 4 + 2] = 5.0 + 5.0 * hash(i * 3.13 + 6);
                seedA[i * 4 + 3] = 3.2 + 3.4 * hash(i * 4.41 + 4);
            });
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
            const m = new THREE.ShaderMaterial({
                uniforms: { uTime: time, uScale: scale },
                vertexShader: `
                    attribute vec4 aSeed; uniform float uTime; uniform float uScale; varying float vA; varying float vT; varying float vR;
                    void main() {
                        float t = fract(uTime * aSeed.y + aSeed.x);
                        vec3 p = position;
                        float w = aSeed.x * 31.0;
                        p.y += t * aSeed.z;
                        p.x += t * 2.6 + sin(t * 3.0 + w) * 0.7;
                        p.z += cos(t * 2.3 + w) * 0.7;
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_Position = projectionMatrix * mv;
                        gl_PointSize = min(aSeed.w * (0.55 + 0.9 * t) * uScale / max(1.0, -mv.z), 260.0);
                        vA = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.45, 1.0, t)) * exp(mv.z * 0.011) * smoothstep(2.5, 7.0, -mv.z);
                        vT = t; vR = w;
                    }`,
                fragmentShader: `
                    varying float vA; varying float vT; varying float vR;
                    void main() {
                        vec2 c = gl_PointCoord - 0.5;
                        float cs = cos(vR), sn = sin(vR); c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
                        float d = length(c) * 2.0;
                        float puff = (1.0 - smoothstep(0.15, 1.0, d)) * (0.75 + 0.25 * sin(c.x * 9.0 + vR) * sin(c.y * 7.0 - vR));
                        vec3 col = mix(vec3(0.80, 0.28, 0.08), vec3(0.22, 0.17, 0.16), smoothstep(0.0, 0.42, vT));   // снизу подсвечен лавой
                        gl_FragColor = vec4(col, puff * vA * 0.36);
                    }`,
                blending: THREE.NormalBlending, depthWrite: false, transparent: true
            });
            const o = new THREE.Points(g, m); o.frustumCulled = false; o.renderOrder = 5; objs.push(o);
        }

        objs.forEach(o => parent.add(o));
        objs[0].onBeforeRender = (renderer, scene, camera) => {
            const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
            scale.value = h * 0.5 / Math.tan((camera.fov || 50) * Math.PI / 360);
        };
        return {
            objects: objs,
            dispose() { objs.forEach(o => { if (o.parent) o.parent.remove(o); o.geometry.dispose(); o.material.dispose(); }); }
        };
    }

    window.AveloraLava = { bake, createFX, time };
})();
