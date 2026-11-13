/**
 * depths.js — «Недра вулкана»: природные пещеры (dungeon.kind === 'depths').
 *
 * Никаких коробок-залов: всё подземелье — одно поле расстояний s(x, z) по сетке (ходы + залы + колонны),
 * из него строятся пол F и свод C одним мешем (тот же приём, что у пещеры «Древних катакомб», dungeon.js),
 * но крупнее: залы 40–55 м, своды до 26 м. У каждой части свой потолок (4-е число в точках ходов и залов).
 * Лава — одна плоскость ниже пола: там, где пол «проваливается» (реки, озёра), её видно; идти по ней нельзя.
 * Свет лавы на камне запечён в вершины (aGlow) — источников света для этого не нужно.
 *
 * Интерфейс для main.js / skills.js — как у AveloraDungeon: update(), dispose(), constrainCamera(), _isWalkPoint().
 * Герой ходит по y = 0 (terrain flat/hidden), поэтому проходимый пол держится у нуля.
 */
(function () {
    const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

    class AveloraDepths {
        constructor(scene, config = {}, terrain = null, pathfinder = null) {
            this.scene = scene; this.config = config; this.terrain = terrain; this.pathfinder = pathfinder;
            this.group = new THREE.Group();
            this.group.name = `depths:${config.id || 'volcano'}`;
            this.scene.add(this.group);
            this.geometries = []; this.materials = []; this.textures = [];
            this.time = { value: 0 };
            this._layout();
            this._buildFields();
            this._planCrystals();
            this._buildRock();
            this._buildLava();
            this._buildShafts();
            this._buildBasalt();
            this._buildCrystals();
            this._buildNest();
            this._buildSeal();
            this._buildFX();
            this._registerColliders();
        }

        // ---------- шум ----------
        _hash(ix, iz) { const s = Math.sin(ix * 127.1 + iz * 311.7 + 41.7) * 43758.5453; return s - Math.floor(s); }
        _vnoise(x, z) {
            const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
            const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
            const a = this._hash(ix, iz), b = this._hash(ix + 1, iz), c = this._hash(ix, iz + 1), d = this._hash(ix + 1, iz + 1);
            return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
        }
        _fbm(x, z) { return (this._vnoise(x, z) * 0.55 + this._vnoise(x * 2.03 + 7.1, z * 2.03 + 3.7) * 0.3 + this._vnoise(x * 4.1 + 1.3, z * 4.1 + 9.2) * 0.15) * 2 - 1; }
        _catmull(pts, step) {
            const out = [], n = pts.length;
            for (let i = 0; i < n - 1; i++) {
                const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
                const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
                for (let j = 0; j < k; j++) {
                    const t = j / k, t2 = t * t, t3 = t2 * t;
                    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
                    const o = [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
                    for (let q = 2; q < p1.length; q++) o.push(p1[q] + (p2[q] - p1[q]) * t);
                    out.push(o);
                }
            }
            out.push(pts[n - 1].slice());
            return out;
        }

        // ---------- план подземелья ----------
        _layout() {
            // Всё задано в «черновых» координатах и растягивается в K раз (T): так масштаб подземелья меняется одной цифрой.
            const K = 1.3, ZO = -13;
            const T = (p, rk) => { const o = p.slice(); o[0] *= K; o[1] = o[1] * K + ZO; if (rk) o[2] *= rk; return o; };
            // Ходы: [x, z, радиус, высота свода]. Герой идёт на +z. Радиусы ходов заданы уже в метрах (широкие: 7–9 м).
            const throat = [[0, -106, 6.5, 10], [0, -98, 7.0, 11], [7, -88, 6.5, 10], [-5, -77, 7.0, 11], [5, -66, 7.0, 11], [0, -56, 8.0, 14], [0, -50, 10.0, 18]];   // «Горло»
            const toFall = [[4, -8, 9.0, 16], [10, 2, 8.0, 13], [18, 12, 8.0, 13], [24, 20, 9.5, 17]];
            const toGeode = [[20, 56, 8.5, 14], [8, 62, 7.5, 12], [-6, 60, 7.5, 12], [-16, 58, 8.5, 14]];
            const toNest = [[-38, 66, 8.0, 13], [-40, 76, 7.5, 12], [-34, 84, 8.5, 15]];
            const toSeal = [[-6, 104, 8.5, 15], [4, 108, 8.5, 15], [12, 110, 9.0, 16], [22, 110, 10.0, 18]];
            this._paths = [throat, toFall, toGeode, toNest, toSeal].map(p => this._catmull(p.map(q => T(q)), 1.0));
            // Залы: [x, z, радиус, высота свода] (радиус растягивается вместе с планом)
            this._blobs = [
                // «Столпы»
                [-12, -34, 18, 26], [12, -30, 19, 28], [0, -20, 16, 24], [-22, -24, 10, 18], [24, -38, 10, 18],
                // «Огнепад»: зал с лавовым озером
                [36, 36, 22, 28], [26, 46, 14, 20], [46, 24, 12, 20],
                // «Жеода»
                [-28, 56, 14, 17], [-34, 50, 9, 14],
                // «Гнездовье»
                [-22, 96, 19, 22], [-12, 104, 12, 17], [-32, 102, 10, 15],
                // зал главного босса: самый большой (~70 м), свод 32 м
                [44, 112, 21, 32], [56, 104, 14, 26], [36, 122, 13, 24], [58, 122, 12, 24], [27, 103, 9, 20]   // последний — расширение у входа в зал босса
            ].map(q => T(q, K));
            // Столпы — тонкие колонны от пола до свода: [x, z, радиус в метрах]
            // «Столпы»: вместо гладких колонн — пучки шестигранных базальтовых столбов [x, z, радиус пучка] (см. _buildBasalt)
            this._basaltSpots = [[-14, -40, 2.1], [-4, -24, 1.8], [8, -38, 1.9], [16, -22, 2.2], [-22, -30, 1.6], [22, -32, 1.6], [2, -12, 1.5]].map(q => T(q));
            this._basaltHall = T([0, -28]);
            this._geode = T([-29, 55]);   // центр зала «Жеода»
            this._nest = T([-22, 96]);    // центр зала «Гнездовье»
            this._seal = T([44, 112]);    // центр зала босса: Печать
            this._pillars = [[24, 30, 1.2], [48, 44, 1.1], [-20, 90, 1.3], [-28, 102, 1.0], [-12, 98, 0.9],
                [54, 96, 1.3], [58, 116, 1.4], [38, 124, 1.2]].map(q => T(q));
            // Лава: реки [x, z, полуширина] и озёра [x, z, радиус]
            this._lavaRivers = [this._catmull([[-34, -30, 2.2], [-20, -33, 2.6], [-6, -29, 2.4], [8, -31, 2.8], [22, -27, 2.4], [36, -34, 2.2]].map(q => T(q, K)), 1.0)];
            this._lavaLakes = [[40, 38, 13.5], [30, 46, 6.0], [-24, 108, 5.0],
                [63, 113, 3.6], [40, 94, 2.8], [47, 129, 3.2], [58, 97, 2.6]].map(q => T(q, K));
            { const e = T([0, -103]); this._lavaPuddles = [[e[0] + 6.4, e[1] - 2.4, 1.7]]; }   // лужица под струёй лавы у входа (ровный контур, без шума)   // последние четыре — лавовые чаши по краям зала босса (свет)
            // Естественные мосты через лаву (пол не проваливается): отрезок [x0, z0, x1, z1, полуширина]
            this._bridges = [[1 * K, -38 * K + ZO, 1 * K, -22 * K + ZO, 4.0]];
            this.entrance = T([0, -99]);
            // Проломы в своде: [x, z, радиус, высота верха, вид]. 'rift' — вход под разломом (свет сверху, струя лавы по стене),
            // 'fall' — огнепад: лава из разлома падает в озеро.
            const eS = T([0, -103]), fS = T([40, 38]);
            // у входа: пролом шире и сдвинут вбок, струя лавы — в стороне от кольца выхода (кольцо стоит на ровном полу)
            this._shafts = [[eS[0] + 2.6, eS[1] - 0.6, 6.2, 36, 'rift', eS[0] + 6.4, eS[1] - 2.4], [fS[0], fS[1], 3.4, 46, 'fall']];
            this._blobs.push([eS[0] + 2.0, eS[1], 10.5, 13]);   // входная камера
            this.LAVA_Y = -0.85;
        }

        _lavaSd(x, z) {
            let d = 1e9;
            for (const R of this._lavaRivers) for (let i = 0; i < R.length; i++) { const v = Math.hypot(x - R[i][0], z - R[i][1]) - R[i][2]; if (v < d) d = v; }
            for (const L of this._lavaLakes) { const v = Math.hypot(x - L[0], z - L[1]) - L[2]; if (v < d) d = v; }
            d += 0.9 * this._fbm(x * 0.16 + 3, z * 0.16 + 8);
            for (const L of this._lavaPuddles) { const v = Math.hypot(x - L[0], z - L[1]) - L[2]; if (v < d) d = v; }
            for (const B of this._bridges) {
                const ex = B[2] - B[0], ez = B[3] - B[1]; let t = ((x - B[0]) * ex + (z - B[1]) * ez) / (ex * ex + ez * ez); t = t < 0 ? 0 : (t > 1 ? 1 : t);
                const v = B[4] + 0.5 * this._fbm(x * 0.4, z * 0.4) - Math.hypot(x - (B[0] + ex * t), z - (B[1] + ez * t)); if (v > d) d = v;
            }
            return d;
        }

        // s < 0 — пустота; возвращает [s, высота свода]
        _sdf(x, z) {
            let d = 1e9, c = 8;
            for (const P of this._paths) for (let i = 0; i < P.length; i++) {
                const v = Math.hypot(x - P[i][0], z - P[i][1]) - P[i][2];
                if (v < d) { d = v; c = P[i][3]; }
            }
            for (const B of this._blobs) {
                const v = Math.hypot(x - B[0], z - B[1]) - B[2];
                const h = Math.max(4.0 - Math.abs(d - v), 0) / 4.0;
                if (v < d) c = B[3];
                d = Math.min(d, v) - h * h * 1.0;
            }
            d += 1.5 * this._fbm(x * 0.075 + 11, z * 0.075) + 0.55 * this._fbm(x * 0.24, z * 0.24 + 4);
            return [d, c];
        }

        _buildFields() {
            const H = 0.7, X0 = -86, X1 = 106, Z0 = -164, Z1 = 170;
            const NX = Math.round((X1 - X0) / H) + 1, NZ = Math.round((Z1 - Z0) / H) + 1, N = NX * NZ;
            const S = new Float32Array(N), CH = new Float32Array(N), F = new Float32Array(N), C = new Float32Array(N), L = new Float32Array(N), PD = new Float32Array(N).fill(99), SH = new Float32Array(N);
            for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
                const r = this._sdf(X0 + ix * H, Z0 + iz * H), k = iz * NX + ix;
                S[k] = r[0]; CH[k] = r[1];
            }
            // высота свода сглаживается, чтобы между залом и ходом не было ступени
            const tmp = new Float32Array(N), R = 5;
            for (let pass = 0; pass < 2; pass++) {
                for (let iz = 0; iz < NZ; iz++) { let acc = 0, n = 0; for (let ix = 0; ix < NX; ix++) { acc += CH[iz * NX + ix]; n++; if (ix >= 2 * R + 1) { acc -= CH[iz * NX + ix - 2 * R - 1]; n--; } if (ix >= R) tmp[iz * NX + ix - R] = acc / n; } for (let ix = NX - R; ix < NX; ix++) tmp[iz * NX + ix] = CH[iz * NX + ix]; }
                for (let ix = 0; ix < NX; ix++) { let acc = 0, n = 0; for (let iz = 0; iz < NZ; iz++) { acc += tmp[iz * NX + ix]; n++; if (iz >= 2 * R + 1) { acc -= tmp[(iz - 2 * R - 1) * NX + ix]; n--; } if (iz >= R) CH[(iz - R) * NX + ix] = acc / n; } }
            }
            const SC = 2.4;
            for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
                const x = X0 + ix * H, z = Z0 + iz * H, k = iz * NX + ix, s = S[k], cH = CH[k];
                // Высота, на которой низ стены встречает верх: гуляет вдоль стены, а не идёт по линейке
                const HE = Math.max(2.6, Math.min(11.0, 0.36 * cH * (0.72 + 0.62 * this._vnoise(x * 0.045 + 31, z * 0.045 + 7))));
                // Сечение без шва: низ стены — четверть эллипса (у пола полого, у стыка отвесно), свод — купол, который у стыка тоже отвесный.
                // Раньше обе поверхности подходили к стыку горизонтально (smoothstep) и смыкались клином — отсюда «бутерброд» с полосой склейки.
                const tl = Math.max(0, Math.min(1, (s + 0.5) / (SC + 0.5)));
                const t = 1.0 - Math.sqrt(Math.max(0, 1.0 - tl * tl));
                const w = 1.0 - tl;
                const ls = this._lavaSd(x, z); L[k] = ls;
                let f = HE * t + 0.7 * this._fbm(x * 0.33 + 3, z * 0.33) * tl * w + 0.025 * this._fbm(x * 1.3, z * 1.3 + 8) * (1 - tl) - 0.012;
                f -= 2.0 * sm(0.7, -0.9, ls) * (1 - tl);                           // русло лавы
                const arch = Math.max(3.0, 0.55 * cH);
                const u = Math.max(0, Math.min(1, (s + arch) / (SC + arch)));
                const deep = Math.sqrt(Math.max(0, 1.0 - u * u));
                let c = HE + (cH - HE) * deep + 1.0 * this._fbm(x * 0.11 + 5, z * 0.11 + 2) * (1 - u) * deep
                    - 0.5 * Math.pow(Math.abs(this._fbm(x * 0.42 + 9, z * 0.42)), 1.6) * (1 - u) * Math.min(1, cH / 12);   // лёгкие наплывы свода
                for (const q of this._shafts) {   // пролом: свод уходит вверх отвесной трубой
                    const d = Math.hypot(x - q[0], z - q[1]) + 0.5 * this._fbm(x * 0.5 + 2, z * 0.5);
                    if (d < q[2] + 3.5) {
                        if (d < q[2]) c += (q[3] - c) * sm(q[2], q[2] - 2.4, d);
                        SH[k] = Math.max(SH[k], sm(q[2] + 3.5, q[2] - 1.5, d));
                    }
                }
                if (c < f + 0.05) c = f + 0.05;
                if (s >= SC) { f = HE; c = HE; }
                else {
                    // тонкие колонны: пол и свод сходятся к середине высоты только у самой оси (узкий раструб ~1 м), места почти не занимают
                    let dp = 99;
                    for (const P of this._pillars) { const v = Math.hypot(x - P[0], z - P[1]) - P[2] + 0.18 * this._fbm(x * 0.9, z * 0.9); if (v < dp) dp = v; }
                    PD[k] = dp;
                    if (dp < 1.3) { const tp = Math.pow(sm(1.3, 0.0, dp), 2.4), mid = f + (c - f) * 0.5; f += (mid - f) * tp; c -= (c - mid) * tp; }
                }
                F[k] = f; C[k] = c;
            }
            this.cave = { X0, Z0, H, NX, NZ, S, F, C, L, PD, SH, SC };
        }

        _buildRock() {
            const { X0, Z0, H, NX, NZ, S, F, C, L, SH, SC } = this.cave, nV = NX * NZ;
            const pos = new Float32Array(nV * 6), col = new Float32Array(nV * 6), glow = new Float32Array(nV * 2), cool = new Float32Array(nV * 2);
            for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
                const k = iz * NX + ix, j = nV + k, x = X0 + ix * H, z = Z0 + iz * H;
                const shade = 0.60 + 0.30 * this._vnoise(x * 0.5, z * 0.5) + 0.14 * this._vnoise(x * 1.9 + 5, z * 1.9);
                pos[k * 3] = x; pos[k * 3 + 1] = F[k]; pos[k * 3 + 2] = z;
                pos[j * 3] = x; pos[j * 3 + 1] = C[k]; pos[j * 3 + 2] = z;
                // один тон для низа и верха стены (раньше пол и свод красились по-разному — стена делилась пополам)
                for (const q of [k, j]) { col[q * 3] = 0.72 * shade; col[q * 3 + 1] = 0.66 * shade; col[q * 3 + 2] = 0.66 * shade; }
                const near = Math.exp(-Math.max(L[k], 0) / 5.5);
                glow[k] = near * Math.exp(-Math.max(F[k], 0) / 12.0) * (L[k] < 0.4 ? 0.5 : 1.0);   // само дно под лавой подсвечивать незачем
                glow[j] = near * Math.exp(-Math.max(C[k], 0) / 12.0);
                glow[k] = Math.max(glow[k], SH[k] * 0.55); glow[j] = Math.max(glow[j], SH[k] * 0.95);
                if (Math.abs(x - this._geode[0]) < 40 && Math.abs(z - this._geode[1]) < 40) { cool[k] = this._coolAt(x, F[k], z); cool[j] = this._coolAt(x, C[k], z); }   // свет из пролома на стенах трубы и пятном на полу
            }
            const idx = [];
            for (let iz = 0; iz < NZ - 1; iz++) for (let ix = 0; ix < NX - 1; ix++) {
                const a = iz * NX + ix, b = a + 1, c = a + NX, d = c + 1;
                if (Math.min(S[a], S[b], S[c], S[d]) >= SC) continue;
                idx.push(a, c, b, b, c, d, nV + a, nV + b, nV + c, nV + b, nV + d, nV + c);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
            geo.setAttribute('aCool', new THREE.BufferAttribute(cool, 1));
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
            geo.computeVertexNormals();
            this.geometries.push(geo);
            this.triangles = idx.length / 3;

            const assets = (window.GAME_ASSETS && window.GAME_ASSETS.textures) || {};
            const src = assets.rockDiff || assets.burntCrackDiff;
            const map = src ? new THREE.TextureLoader().load(src) : null;
            if (map) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = (window.GFX && window.GFX.aniso) || 8; this.textures.push(map); }
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map, vertexColors: true, roughness: 0.94, metalness: 0.02 });
            const time = this.time;
            mat.onBeforeCompile = (shader) => {
                shader.uniforms.uDepthsTime = time;
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', '#include <common>\nattribute float aGlow; attribute float aCool; varying vec3 vCavePos; varying vec3 vCaveNor; varying float vGlow; varying float vCool;')
                    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCavePos = (modelMatrix * vec4(transformed, 1.0)).xyz; vCaveNor = normalize(mat3(modelMatrix) * objectNormal); vGlow = aGlow; vCool = aCool;');
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', '#include <common>\nuniform float uDepthsTime; varying vec3 vCavePos; varying vec3 vCaveNor; varying float vGlow; varying float vCool;')
                    .replace('#include <map_fragment>', `
                        #ifdef USE_MAP
                        vec3 cbw = pow(abs(normalize(vCaveNor)), vec3(4.0)); cbw /= (cbw.x + cbw.y + cbw.z);
                        // два масштаба: крупные пласты породы + мелкая фактура (на 20-метровых стенах одна плитка читалась бы обоями)
                        vec4 ct = texture2D(map, vCavePos.zy * 0.085) * cbw.x + texture2D(map, vCavePos.xz * 0.085) * cbw.y + texture2D(map, vCavePos.xy * 0.085) * cbw.z;
                        vec4 cd = texture2D(map, vCavePos.zy * 0.31) * cbw.x + texture2D(map, vCavePos.xz * 0.31) * cbw.y + texture2D(map, vCavePos.xy * 0.31) * cbw.z;
                        vec3 rock = vec3(dot(ct.rgb, vec3(0.33)) * 0.9 + (dot(cd.rgb, vec3(0.33)) - 0.35) * 0.9);   // только яркость: исходная текстура рыжая, а здесь нужен серый базальт
                        // горизонтальные пласты базальта
                        float strata = 0.94 + 0.06 * sin(vCavePos.y * 1.9 + sin(vCavePos.x * 0.11 + vCavePos.z * 0.09) * 3.0);
                        diffuseColor.rgb *= clamp(rock, 0.0, 1.4) * strata * vec3(0.50, 0.47, 0.49) * 1.35;   // тёмный серый базальт: тепло даёт только лава
                        #endif`)
                    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                        totalEmissiveRadiance += vec3(1.0, 0.30, 0.06) * vGlow * (0.62 + 0.08 * sin(uDepthsTime * 0.9 + vCavePos.x * 0.07)) * (0.25 + diffuseColor.r * 1.6);
                        totalEmissiveRadiance += vec3(0.30, 0.36, 1.0) * vCool * (0.34 + 0.05 * sin(uDepthsTime * 1.3 + vCavePos.z * 0.2)) * (0.2 + diffuseColor.r * 1.8);   // холодный свет кристаллов «Жеоды»`);
            };
            mat.customProgramCacheKey = () => 'avelora_depths_rock_v2';
            this.materials.push(mat);
            this.rockMat = mat;
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = 'depths_rock';
            mesh.frustumCulled = false;
            this.group.add(mesh);
        }

        _buildLava() {
            const { X0, Z0, H, NX, NZ } = this.cave;
            const w = (NX - 1) * H, d = (NZ - 1) * H;
            const geo = new THREE.PlaneGeometry(w, d, 1, 1);
            geo.rotateX(-Math.PI / 2);
            this.geometries.push(geo);
            const assets = (window.GAME_ASSETS && window.GAME_ASSETS.textures) || {};
            const tex = assets.burntLavaDiff ? new THREE.TextureLoader().load(assets.burntLavaDiff) : null;
            if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; this.textures.push(tex); }
            const fog = this.scene.parent && this.scene.parent.fog ? this.scene.parent.fog : null;
            const mat = new THREE.ShaderMaterial({
                uniforms: { uTex: { value: tex }, uTime: this.time, uFogColor: { value: new THREE.Color(0x1a0a06) }, uFogDensity: { value: 0.012 } },
                vertexShader: `varying vec3 vW; varying float vDepth;
                    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mv = viewMatrix * wp; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
                fragmentShader: `uniform sampler2D uTex; uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity; varying vec3 vW; varying float vDepth;
                    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                    float n(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y); }
                    void main() {
                        vec2 g = vW.xz;
                        float ph = uTime * 0.06, p0 = fract(ph), p1 = fract(ph + 0.5);
                        vec2 fl = vec2(2.6, 1.1);
                        vec3 tA = texture2D(uTex, (g - fl * p0) * 0.2).rgb, tB = texture2D(uTex, (g - fl * p1) * 0.2 + vec2(0.43, 0.27)).rgb;
                        vec3 tt = mix(tA, tB, abs(1.0 - 2.0 * p0));
                        float th = clamp((tt.r - tt.b - 0.08) * 2.4, 0.0, 1.0);
                        float tv = n(g * 0.22 - uTime * 0.05) * 0.65 + n(g * 0.7 + uTime * 0.07) * 0.35;
                        float T = clamp((0.42 + th * 0.6 + tv * 0.5 - (1.0 - th) * (1.0 - tv) * 0.4) * (0.86 + 0.14 * sin(uTime * 0.9 + tv * 9.0)), 0.0, 1.0);
                        vec3 hot = mix(vec3(0.50, 0.04, 0.0), vec3(1.0, 0.33, 0.03), smoothstep(0.12, 0.55, T));
                        hot = mix(hot, vec3(1.0, 0.64, 0.17), smoothstep(0.62, 1.0, T));
                        vec3 crust = vec3(dot(tt, vec3(0.3, 0.59, 0.11))) * vec3(0.34, 0.24, 0.22);
                        float molten = smoothstep(0.10, 0.42, T);
                        vec3 col = mix(crust, hot * (0.6 + 2.0 * T), molten);
                        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
                        gl_FragColor = vec4(mix(col, uFogColor, fogF * 0.7), 1.0);
                        #include <tonemapping_fragment>
                        #include <encodings_fragment>
                    }`
            });
            this.materials.push(mat);
            this.lavaMat = mat;
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(X0 + w / 2, this.LAVA_Y, Z0 + d / 2);
            mesh.name = 'depths_lava';
            mesh.frustumCulled = false;
            this.group.add(mesh);
        }

        // ---------- проломы: свет сверху, струя лавы, огнепад ----------
        _fallMaterial(edgeFade) {
            const tex = this.lavaMat.uniforms.uTex.value;
            const m = new THREE.ShaderMaterial({
                uniforms: { uTex: { value: tex }, uTime: this.time, uEdge: { value: edgeFade ? 1.0 : 0.0 } },
                vertexShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
                    void main() { vUv = uv; vec3 p = position;
                        // струя «дышит»: толщина гуляет по высоте и бежит вниз — контур не как у трубы
                        float a = atan(p.x, p.z);
                        p.xz *= 1.0 + 0.16 * sin(p.y * 0.33 + uTime * 2.2) + 0.10 * sin(p.y * 0.9 + uTime * 3.4 + a * 3.0) + 0.06 * sin(a * 5.0 - uTime * 1.7);
                        vec4 wp = modelMatrix * vec4(p, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
                fragmentShader: `uniform sampler2D uTex; uniform float uTime; uniform float uEdge; varying vec2 vUv; varying vec3 vW;
                    void main() {
                        // лава течёт вниз: два слоя с разной скоростью, вытянутые по вертикали
                        vec3 a = texture2D(uTex, vec2(vUv.x * 1.3, vW.y * 0.045 + uTime * 0.55)).rgb;
                        vec3 b = texture2D(uTex, vec2(vUv.x * 2.1 + 0.37, vW.y * 0.07 + uTime * 0.85)).rgb;
                        float h = clamp((max(a.r - a.b, b.r - b.b) - 0.05) * 2.2, 0.0, 1.0);
                        float T = clamp(0.55 + h * 0.6 - (1.0 - h) * 0.25 * dot(a, vec3(0.33)), 0.0, 1.0);
                        vec3 hot = mix(vec3(0.75, 0.10, 0.0), vec3(1.0, 0.38, 0.04), smoothstep(0.2, 0.6, T));
                        hot = mix(hot, vec3(1.0, 0.70, 0.22), smoothstep(0.65, 1.0, T));
                        float al = mix(1.0, smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x), uEdge);
                        gl_FragColor = vec4(hot * (0.9 + 1.7 * T), al);
                        #include <tonemapping_fragment>
                        #include <encodings_fragment>
                    }`,
                transparent: !!edgeFade, depthWrite: !edgeFade, side: THREE.DoubleSide
            });
            this.materials.push(m);
            return m;
        }

        _buildShafts() {
            const add = (geo, mat, x, y, z) => { this.geometries.push(geo); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.frustumCulled = false; this.group.add(m); return m; };
            // общий материал светящейся «крышки» пролома и столба света
            const capMat = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                fragmentShader: `uniform float uTime; varying vec2 vUv;
                    void main() { float r = length(vUv - 0.5) * 2.0; float g = (1.0 - smoothstep(0.1, 1.0, r)) * (0.85 + 0.15 * sin(uTime * 0.8));
                        gl_FragColor = vec4(vec3(1.0, 0.36, 0.08) * (0.25 + 2.2 * g), 1.0);
                        #include <tonemapping_fragment>
                        #include <encodings_fragment>
                    }`, side: THREE.DoubleSide
            });
            const beamMat = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                fragmentShader: `uniform float uTime; varying vec2 vUv;
                    void main() { float a = pow(vUv.y, 1.6) * 0.20 * (0.8 + 0.2 * sin(uTime * 0.6 + vUv.x * 18.0));
                        gl_FragColor = vec4(vec3(1.0, 0.40, 0.12) * a, 1.0); }`,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
            });
            this.materials.push(capMat, beamMat);
            for (const q of this._shafts) {
                const [x, z, R, HT, kind] = q;
                // «крышка» пролома — расплав над головой (дно лавового озера разлома): видно, откуда льётся лава
                const cap = new THREE.CircleGeometry(R + 1.5, 24); cap.rotateX(Math.PI / 2);
                add(cap, this.lavaMat, x, HT - 0.4, z);
                // столб света от пролома до пола (слабый, аддитивный, одна труба)
                add(new THREE.CylinderGeometry(R * 0.55, R * 0.95, HT, 20, 1, true), beamMat, x, HT / 2, z).renderOrder = 4;
                if (kind === 'fall') {
                    // огнепад: колонна падающей лавы из пролома в озеро
                    add(new THREE.CylinderGeometry(1.25, 1.9, HT - this.LAVA_Y, 16, 40, true), this._fallMaterial(false), x, (HT + this.LAVA_Y) / 2, z);
                    // зарево на озере у подножия
                    const gd = new THREE.CircleGeometry(9.0, 28); gd.rotateX(-Math.PI / 2);
                    add(gd, this._glowDiscMat(), x, this.LAVA_Y + 0.07, z).renderOrder = 2;
                    this._splashAt = [x, z];
                } else {
                    // струя лавы из пролома до самой лужи: круглая, слегка расширяется книзу
                    add(new THREE.CylinderGeometry(0.40, 0.62, HT - this.LAVA_Y, 12, 30, true), this._fallMaterial(false), q[5], (HT + this.LAVA_Y) / 2, q[6]);
                }
            }
        }

        // ---------- базальтовые шестигранники и сталактиты (один меш, материал породы) ----------
        _buildBasalt() {
            const P = [], N = [], C = [], G = [], I = [];
            let seed = 777; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const glowAt = (L, y) => Math.exp(-Math.max(L, 0) / 5.5) * Math.exp(-Math.max(y, 0) / 12.0);
            const vert = (x, y, z, nx, ny, nz, sh, L) => { P.push(x, y, z); N.push(nx, ny, nz); C.push(0.60 * sh, 0.56 * sh, 0.58 * sh); G.push(glowAt(L, y)); return P.length / 3 - 1; };
            // шестигранная призма: 6 граней с плоскими нормалями + крышка
            const prism = (cx, cz, r, y0, y1, sh, L, rot) => {
                for (let i = 0; i < 6; i++) {
                    const a0 = rot + i * Math.PI / 3, a1 = a0 + Math.PI / 3, am = a0 + Math.PI / 6;
                    const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
                    const nx = Math.cos(am), nz = Math.sin(am), fs = sh * (0.86 + 0.14 * ((i * 37) % 5) / 4);
                    const a = vert(x0, y0, z0, nx, 0, nz, fs * 0.8, L), b = vert(x1, y0, z1, nx, 0, nz, fs * 0.8, L), c = vert(x1, y1, z1, nx, 0, nz, fs, L), d = vert(x0, y1, z0, nx, 0, nz, fs, L);
                    I.push(a, c, b, a, d, c);
                }
                const o = vert(cx, y1, cz, 0, 1, 0, sh * 1.12, L);
                for (let i = 0; i < 6; i++) {
                    const a0 = rot + i * Math.PI / 3, a1 = a0 + Math.PI / 3;
                    const a = vert(cx + Math.cos(a0) * r, y1, cz + Math.sin(a0) * r, 0, 1, 0, sh * 1.05, L), b = vert(cx + Math.cos(a1) * r, y1, cz + Math.sin(a1) * r, 0, 1, 0, sh * 1.05, L);
                    I.push(o, b, a);
                }
            };
            // пучок столбов на шестиугольной решётке: в середине — до свода, по краям — обломанные ступени
            this._basalt = this._basalt || [];
            const cluster = (cx, cz, Rc, tallTo) => {
                const r = 0.46, w = r * Math.sqrt(3), n = Math.ceil((Rc + 1.8) / w);
                for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
                    const x = cx + (i + (j & 1) * 0.5) * w, z = cz + j * w * 0.866, d = Math.hypot(x - cx, z - cz);
                    if (d > Rc + 1.5) continue;
                    const q = this._sample(x, z); if (!q || q.s > -0.3 || q.L < 0.8) continue;
                    const sh = 0.78 + 0.34 * rnd();
                    let y1;
                    if (d < Rc * (0.75 + 0.3 * rnd())) y1 = tallTo ? Math.min(q.C + 0.6, q.F + tallTo * (0.7 + 0.5 * rnd())) : q.C + 0.6;
                    else { const k = (d - Rc * 0.75) / 1.6; if (rnd() < 0.35 + 0.5 * k) continue; y1 = q.F + Math.max(0.25, (2.8 - 3.2 * k) * (0.4 + 0.9 * rnd())); }
                    prism(x, z, r * 1.02, q.F - 0.4, y1, sh, q.L, Math.PI / 6);
                }
                this._basalt.push([cx, cz, Rc + 1.35]);   // вместе со ступенями: герой не встаёт внутрь обломков
            };
            for (const b of this._basaltSpots) cluster(b[0], b[1], b[2], 0);
            // «органные трубы» у стен зала: идём от центра зала наружу до стены и ставим пучок неполной высоты
            for (let a = 0; a < 12; a++) {
                const ang = a / 12 * Math.PI * 2 + 0.2, dx = Math.cos(ang), dz = Math.sin(ang);
                let hit = null;
                for (let d = 8; d < 52; d += 0.7) { const q = this._sample(this._basaltHall[0] + dx * d, this._basaltHall[1] + dz * d); if (!q) break; if (q.s > -2.2) { hit = [this._basaltHall[0] + dx * d, this._basaltHall[1] + dz * d, q.L]; break; } }
                if (hit && hit[2] > 4.0) cluster(hit[0], hit[1], 2.2 + 1.4 * rnd(), 7 + 9 * rnd());
            }
            // сталактиты на сводах больших залов: неровные конусы
            const { X0, Z0, H, NX, NZ, S, C: CC, L: LL, SH } = this.cave;
            const cand = []; for (let k = 0; k < NX * NZ; k += 5) if (S[k] < -4.5 && CC[k] > 10 && SH[k] < 0.01) cand.push(k);
            const nSt = Math.min(cand.length, 320);
            for (let t = 0; t < nSt; t++) {
                const k = cand[(rnd() * cand.length) | 0], x = X0 + ((k % NX) + rnd()) * H, z = Z0 + (((k / NX) | 0) + rnd()) * H;
                const q = this._sample(x, z); if (!q) continue;
                const len = (1.2 + 4.2 * rnd() * rnd()) * Math.min(1.4, q.C / 16), rad = 0.22 + 0.11 * len, sh = 0.8 + 0.3 * rnd(), seg = 7, yT = q.C + 0.5, ph = rnd() * 6.28;
                const ring = (y, rr) => { const o = []; for (let i = 0; i < seg; i++) { const a = ph + i / seg * 6.283, w2 = 1 + 0.22 * Math.sin(a * 3 + ph); o.push(vert(x + Math.cos(a) * rr * w2, y, z + Math.sin(a) * rr * w2, Math.cos(a), -0.25, Math.sin(a), sh, q.L)); } return o; };
                const r0 = ring(yT, rad), r1 = ring(yT - len * 0.45, rad * 0.5), tip = vert(x + 0.1 * Math.sin(ph), yT - len, z + 0.1 * Math.cos(ph), 0, -1, 0, sh * 0.85, q.L);
                for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; I.push(r0[i], r0[j], r1[j], r0[i], r1[j], r1[i], r1[i], r1[j], tip); }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
            geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
            geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
            geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(G), 1));
            geo.setAttribute('aCool', new THREE.BufferAttribute(new Float32Array(G.length), 1));
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
            this.geometries.push(geo);
            this.detailTriangles = I.length / 3;
            const mesh = new THREE.Mesh(geo, this.rockMat); mesh.name = 'depths_basalt'; mesh.frustumCulled = false;
            this.group.add(mesh);
        }

        // ---------- «Жеода»: друзы кристаллов ----------
        _planCrystals() {
            // друза: { x, y, z, n: [nx, ny, nz] (куда растёт), size, hue (0 — холодные сине-фиолетовые, 1 — огненные), count }
            this._crystals = []; this._basalt = this._basalt || [];
            let seed = 4242; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const gx = this._geode[0], gz = this._geode[1];
            // исполинская друза в центре зала
            { const q = this._sample(gx + 2, gz + 1); if (q) { this._crystals.push({ x: gx + 2, y: q.F - 0.3, z: gz + 1, n: [0, 1, 0], size: 7.5, hue: 0, count: 11 }); this._basalt.push([gx + 2, gz + 1, 2.6]); } }
            let tries = 0;
            while (this._crystals.length < 46 && tries++ < 900) {
                const a = rnd() * 6.283, d = 4 + rnd() * 24, x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d, q = this._sample(x, z);
                if (!q || q.s > -0.6 || q.L < 2) continue;
                const hue = rnd() < 0.22 ? 1 : 0;
                if (q.s > -3.2) {            // у стены: растёт от стены внутрь и вверх
                    const e = 0.7, sx = (this._sample(x + e, z) || q).s - (this._sample(x - e, z) || q).s, sz = (this._sample(x, z + e) || q).s - (this._sample(x, z - e) || q).s, l = Math.hypot(sx, sz) || 1;
                    // якорь — на самой стене: идём от точки наружу (в породу), пока пол-стена не поднимется до нужной высоты
                    const yT = 0.6 + rnd() * 4.5, gxn = sx / l, gzn = sz / l; let ax = x, az = z, ok = false;
                    for (let st = 0; st < 30; st++) { const w = this._sample(ax, az); if (!w) break; if (w.F >= yT || w.C <= yT + 0.3) { ok = true; break; } ax += gxn * 0.3; az += gzn * 0.3; }
                    if (!ok) continue;
                    this._crystals.push({ x: ax + gxn * 0.25, y: yT, z: az + gzn * 0.25, n: [-gxn * 0.8, 0.6, -gzn * 0.8], size: 1.4 + 2.4 * rnd(), hue, count: 5 + (rnd() * 4 | 0) });
                } else if (rnd() < 0.45) {   // на своде: растёт вниз
                    this._crystals.push({ x, y: q.C + 0.45, z, n: [0, -1, 0], size: 1.6 + 3.0 * rnd(), hue, count: 5 + (rnd() * 4 | 0), tight: true });
                } else if (rnd() < 0.35) {   // на полу посреди зала (редко, чтобы не мешать ходить)
                    this._crystals.push({ x, y: q.F - 0.2, z, n: [0, 1, 0], size: 1.2 + 1.6 * rnd(), hue, count: 6 }); this._basalt.push([x, z, 0.9]);
                }
            }
        }

        _coolAt(x, y, z) {
            let v = 0;
            for (const c of this._crystals) { if (c.hue) continue; const d = Math.hypot(x - c.x, (y - c.y) * 0.7, z - c.z); v += Math.exp(-d / (1.5 + c.size * 0.55)) * (0.30 + c.size * 0.10); }
            return Math.min(1, v);
        }

        _buildCrystals() {
            const P = [], N = [], C = [], T = [], I = [];
            let seed = 9191; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const one = (bx, by, bz, ax, ay, az, len, rad, col) => {
                // базис вокруг оси кристалла
                let ux = ay, uy = -ax, uz = 0; if (Math.abs(ax) + Math.abs(ay) < 0.2) { ux = 1; uy = 0; uz = 0; }
                let l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
                const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux, ph = rnd() * 6.28, body = len * (0.62 + 0.16 * rnd());
                const pt = (i, h, r) => { const a = ph + i * Math.PI / 3, c = Math.cos(a) * r, s2 = Math.sin(a) * r; return [bx + ux * c + vx * s2 + ax * h, by + uy * c + vy * s2 + ay * h, bz + uz * c + vz * s2 + az * h]; };
                const push = (p, n, t) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); C.push(col[0], col[1], col[2]); T.push(t); return P.length / 3 - 1; };
                const tip = [bx + ax * len, by + ay * len, bz + az * len];
                for (let i = 0; i < 6; i++) {
                    const am = ph + (i + 0.5) * Math.PI / 3, c = Math.cos(am), s2 = Math.sin(am), n = [ux * c + vx * s2, uy * c + vy * s2, uz * c + vz * s2];
                    const a = push(pt(i, -0.3, rad), n, 0), b = push(pt(i + 1, -0.3, rad), n, 0), c2 = push(pt(i + 1, body, rad * 0.86), n, body / len), d = push(pt(i, body, rad * 0.86), n, body / len);
                    I.push(a, b, c2, a, c2, d);
                    const nt = [n[0] * 0.8 + ax * 0.6, n[1] * 0.8 + ay * 0.6, n[2] * 0.8 + az * 0.6];
                    const e = push(pt(i, body, rad * 0.86), nt, body / len), f = push(pt(i + 1, body, rad * 0.86), nt, body / len), g = push(tip, nt, 1);
                    I.push(e, f, g);
                }
            };
            for (const c of this._crystals) {
                const col = c.hue ? [1.0, 0.36, 0.10] : (rnd() < 0.5 ? [0.34, 0.42, 1.0] : [0.58, 0.36, 1.0]);
                for (let i = 0; i < c.count; i++) {
                    const main = i === 0, spread = main ? 0.12 : 0.75;
                    let ax = c.n[0] + (rnd() - 0.5) * 2 * spread, ay = c.n[1] + (rnd() - 0.5) * 2 * spread * 0.6, az = c.n[2] + (rnd() - 0.5) * 2 * spread;
                    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
                    const len = c.size * (main ? 1.0 : 0.3 + 0.55 * rnd()), off = main ? 0 : c.size * (c.tight ? 0.05 : 0.16);
                    one(c.x + (rnd() - 0.5) * 2 * off, c.y, c.z + (rnd() - 0.5) * 2 * off, ax, ay, az, len, len * (0.085 + 0.04 * rnd()) + 0.05, col);
                }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
            geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
            geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
            geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(T), 1));
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
            this.geometries.push(geo);
            const mat = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: `attribute vec3 color; attribute float aT; varying vec3 vC; varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vW;
                    void main() { vC = color; vT = aT; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
                fragmentShader: `uniform float uTime; varying vec3 vC; varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vW;
                    void main() {
                        vec3 n = normalize(vN); float fr = pow(1.0 - abs(dot(n, normalize(vV))), 2.2);
                        float pulse = 0.82 + 0.18 * sin(uTime * 1.3 + vW.x * 0.35 + vW.z * 0.27);
                        float facet = 0.72 + 0.28 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.45))));     // грани читаются по-разному
                        vec3 col = vC * (0.16 + 1.25 * pow(vT, 1.4)) * facet * pulse + vC * fr * 0.8 + vec3(1.0) * (pow(vT, 7.0) * 0.22 + fr * fr * 0.10);
                        gl_FragColor = vec4(col * 1.15, 1.0);
                        #include <tonemapping_fragment>
                        #include <encodings_fragment>
                    }`
            });
            this.materials.push(mat);
            const mesh = new THREE.Mesh(geo, mat); mesh.name = 'depths_crystals'; mesh.frustumCulled = false; this.group.add(mesh);
            this.crystalTriangles = I.length / 3;
        }

        // ---------- «Гнездовье»: остов древнего дракона и кладки ----------
        _buildNest() {
            const P = [], N = [], C = [], I = [];
            let seed = 3131; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            // трубка вдоль ломаной с переменным радиусом (кость): pts [[x, y, z], ...], rad(u)
            const tube = (pts, rad, seg, tone) => {
                const rings = [];
                for (let i = 0; i < pts.length; i++) {
                    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
                    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
                    let ux = -tz, uy = 0, uz = tx; let ul = Math.hypot(ux, uz); if (ul < 0.05) { ux = 1; uz = 0; ul = 1; } ux /= ul; uz /= ul;
                    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux, r = rad(i / (pts.length - 1)), ring = [];
                    for (let k = 0; k < seg; k++) {
                        const an = k / seg * 6.283, c = Math.cos(an), s2 = Math.sin(an), nx = ux * c + vx * s2, ny = uy * c + vy * s2, nz = uz * c + vz * s2;
                        const sh = tone * (0.86 + 0.14 * Math.sin(i * 1.7 + k));
                        P.push(pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r); N.push(nx, ny, nz); C.push(0.86 * sh, 0.80 * sh, 0.68 * sh); ring.push(P.length / 3 - 1);
                    }
                    rings.push(ring);
                }
                for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < seg; k++) { const j = (k + 1) % seg; I.push(rings[i][k], rings[i + 1][k], rings[i + 1][j], rings[i][k], rings[i + 1][j], rings[i][j]); }
            };
            // хребет: от стены (шея уходит в породу — черепа не видно) через зал к хвосту у пола; дракон лежит на брюхе, рёбра — арки до пола
            const gx = this._nest[0], gz = this._nest[1];
            let ax = gx - 17.5, az = gz - 8, bx = gx + 17, bz = gz + 10.5;
            const dl = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / dl, dz = (bz - az) / dl, lx = -dz, lz = dx;
            for (let st = 0; st < 40; st++) { const q = this._sample(ax, az); if (!q || q.s > -0.3) break; ax -= dx * 0.6; az -= dz * 0.6; }   // шею — до стены
            const L = Math.hypot(bx - ax, bz - az);
            const spineH = v => 0.35 + 6.4 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, 0.16 + 0.84 * v) )), 0.75) * (1 - 0.25 * v);
            const sp = v => { const d = v * L, wob = Math.sin(v * 5.0) * 1.3; return [ax + dx * d + lx * wob, spineH(v), az + dz * d + lz * wob]; };
            const spine = []; for (let i = 0; i <= 60; i++) spine.push(sp(i / 60));
            tube(spine, u => 0.46 * (1 - 0.72 * u) + 0.05, 8, 1.0);
            this._basalt = this._basalt || [];
            for (let i = 0; i <= 60; i++) {
                const v = i / 60, p = spine[i];
                // остистые отростки вдоль хребта
                if (i % 2 === 0 && v > 0.03 && v < 0.93) { const hgt = (0.7 + 1.3 * Math.sin(Math.PI * v)) * (0.8 + 0.4 * rnd()); tube([[p[0], p[1], p[2]], [p[0] - dx * 0.15, p[1] + hgt * 0.6, p[2] - dz * 0.15], [p[0] - dx * 0.4, p[1] + hgt, p[2] - dz * 0.4]], u => 0.15 * (1 - 0.8 * u) + 0.02, 5, 0.95); }
                // рёбра парами: от хребта вниз двумя арками до пола
                if (i % 4 === 0 && v > 0.14 && v < 0.70) {
                    const k = Math.sin(Math.PI * (v - 0.10) / 0.64), W = 2.2 + 3.6 * Math.pow(Math.max(0, k), 0.6), h = p[1], broken = rnd() < 0.18 ? 0.45 + 0.3 * rnd() : 1.0;
                    for (const side of [-1, 1]) {
                        const rib = [], n = 12, m = Math.max(3, Math.round(n * (side > 0 ? broken : 1.0)));
                        for (let j = 0; j <= m; j++) { const u = j / n, off = W * Math.sin(u * 2.0) / Math.sin(1.6), y = h * (1 - Math.pow(u, 1.7)) - 0.35 * u; rib.push([p[0] + lx * off * side + dx * 1.3 * u, y, p[2] + lz * off * side + dz * 1.3 * u]); }
                        tube(rib, u => 0.24 * (1 - 0.62 * u) + 0.03, 6, 0.92 + 0.12 * rnd());
                        for (const rp of rib) if (rp[1] < 1.9) this._basalt.push([rp[0], rp[2], 0.0]);   // основание ребра — препятствие (между рёбрами ~2,7 м, пройти можно)
                    }
                }
                if (p[1] < 1.6 && i % 3 === 0) this._basalt.push([p[0], p[2], 0.7]);   // хвост у самого пола — препятствие
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
            geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
            geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
            this.geometries.push(geo);
            const boneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.0, emissive: 0x2a1408, emissiveIntensity: 0.55 });
            this.materials.push(boneMat);
            const bones = new THREE.Mesh(geo, boneMat); bones.name = 'depths_bones'; bones.frustumCulled = false; this.group.add(bones);

            // кладки: гнёзда из яиц с тлеющими прожилками
            const eggGeo = new THREE.SphereGeometry(1, 14, 10); this.geometries.push(eggGeo);
            const eggMat = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vPh;
                    void main() { vP = position; vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vPh = wp.x * 1.7 + wp.z * 2.3; gl_Position = projectionMatrix * viewMatrix * wp; }`,
                fragmentShader: `uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vPh;
                    float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
                    float n3(vec3 p) { vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
                        return mix(mix(mix(h(i), h(i + vec3(1, 0, 0)), u.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), u.x), u.y), mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), u.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), u.x), u.y), u.z); }
                    void main() {
                        vec3 n = normalize(vN); float lit = 0.35 + 0.65 * max(0.0, dot(n, normalize(vec3(0.3, 0.9, 0.3))));
                        float v = abs(n3(vP * 3.1 + vPh) - 0.5) + abs(n3(vP * 6.3 - vPh) - 0.5) * 0.5;      // прожилки
                        float vein = 1.0 - smoothstep(0.02, 0.10, v);
                        float beat = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(uTime * 1.6 + vPh), 3.0);              // «сердцебиение»
                        vec3 shell = mix(vec3(0.10, 0.08, 0.08), vec3(0.30, 0.20, 0.16), n3(vP * 9.0)) * lit;
                        float fr = pow(1.0 - abs(dot(n, normalize(vV))), 3.0);
                        gl_FragColor = vec4(shell + vec3(1.0, 0.36, 0.06) * (vein * 1.9 * beat + fr * 0.25 * beat), 1.0);
                        #include <tonemapping_fragment>
                        #include <encodings_fragment>
                    }`
            });
            this.materials.push(eggMat);
            const nests = [];
            let tries = 0;
            while (nests.length < 6 && tries++ < 400) {
                const a = rnd() * 6.283, d = 9 + rnd() * 15, x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d, q = this._sample(x, z);
                if (!q || q.s > -3.5 || q.s < -9.5 || q.L < 4 || q.P < 3 || this._inBasalt(x, z, 2.5)) continue;   // ближе к стенам, не на проходе
                if (nests.some(n => Math.hypot(n[0] - x, n[1] - z) < 8)) continue;
                nests.push([x, z, q.F]); this._basalt.push([x, z, 1.7]);
            }
            const eggs = [];
            for (const n of nests) { const cnt = 4 + (rnd() * 4 | 0); for (let i = 0; i < cnt; i++) { const a = rnd() * 6.283, d = i === 0 ? 0 : 0.55 + rnd() * 0.75; eggs.push([n[0] + Math.cos(a) * d, n[2], n[1] + Math.sin(a) * d, 0.42 + 0.14 * rnd(), rnd() * 6.283, (rnd() - 0.5) * 0.5]); } }
            const inst = new THREE.InstancedMesh(eggGeo, eggMat, eggs.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
            eggs.forEach((e, i) => { E.set(e[5], e[4], e[5] * 0.7); Q.setFromEuler(E); M.compose(new THREE.Vector3(e[0], e[1] + e[3] * 1.15, e[2]), Q, new THREE.Vector3(e[3], e[3] * 1.38, e[3])); inst.setMatrixAt(i, M); });
            inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false; inst.name = 'depths_eggs'; this.group.add(inst);
            // обломки костей вокруг гнёзд
            const P0 = P.length;
            this.nestCount = nests.length; this.eggCount = eggs.length;
        }

        // ---------- зал босса: Печать (единственное рукотворное место недр) ----------
        _buildSeal() {
            const cx = this._seal[0], cz = this._seal[1];
            const add = (geo, mat, x, y, z) => { this.geometries.push(geo); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.frustumCulled = false; this.group.add(m); return m; };
            // 1) Печать на полу: гномьи круги и руны, расколотые — из трещин бьёт жар Сердца
            const disc = new THREE.CircleGeometry(12.5, 64); disc.rotateX(-Math.PI / 2);
            const sealMat = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                fragmentShader: `uniform float uTime; varying vec2 vP;
                    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                    float n(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y); }
                    void main() {
                        float r = length(vP), a = atan(vP.y, vP.x);
                        // концентрические кольца
                        float rings = max(max(1.0 - smoothstep(0.05, 0.13, abs(r - 11.6)), 1.0 - smoothstep(0.04, 0.10, abs(r - 10.4))), max(1.0 - smoothstep(0.04, 0.10, abs(r - 6.2)), 1.0 - smoothstep(0.03, 0.08, abs(r - 2.6))));
                        // пояс рун между кольцами: угловые ячейки со случайными штрихами
                        float cell = floor(a / 6.2832 * 36.0), fa = fract(a / 6.2832 * 36.0), fr = (r - 10.55) / 0.9;
                        float glyph = step(0.0, fr) * step(fr, 1.0) * step(0.18, fa) * step(fa, 0.82) * step(0.45, h(vec2(cell, floor(fr * 3.0) + floor(fa * 3.0) * 7.0)));
                        // восемь лучей к столпам и внутренняя звезда
                        float sa = abs(fract(a / 6.2832 * 8.0 + 0.5) - 0.5);
                        float rays = (1.0 - smoothstep(0.004, 0.012, sa * r / 8.0)) * step(2.6, r) * step(r, 10.4);
                        float star = (1.0 - smoothstep(0.03, 0.09, abs(r * cos(sa * 6.2832 / 8.0 * 2.0) - 4.4))) * step(r, 6.2);
                        float lines = clamp(rings + glyph * 0.9 + rays * 0.8 + star * 0.7, 0.0, 1.0);
                        // расколы: печать вскрыта — рваные трещины от центра
                        vec2 q = vP + vec2(n(vP * 0.35), n(vP * 0.35 + 7.0)) * 3.0;
                        float crack = 1.0 - smoothstep(0.0, 0.035, abs(n(q * 0.42) - 0.5));
                        crack *= smoothstep(12.4, 9.0, r) * (0.35 + 0.65 * smoothstep(8.0, 1.0, r));
                        float pulse = 0.75 + 0.25 * sin(uTime * 1.4 - r * 0.5);
                        float edge = smoothstep(12.5, 11.9, r);
                        vec3 col = vec3(0.30, 0.48, 1.0) * lines * 0.85 * (0.75 + 0.25 * sin(uTime * 0.7 + cell)) + vec3(1.0, 0.36, 0.06) * crack * 2.4 * pulse + vec3(1.0, 0.30, 0.05) * exp(-r * 0.45) * 0.9 * pulse;
                        gl_FragColor = vec4(col * edge, 1.0);
                    }`,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
            });
            this.materials.push(sealMat);
            add(disc, sealMat, cx, 0.06, cz).renderOrder = 2;

            // 2) Восемь гномьих столпов вокруг печати: тёсаный камень с рунными жилами; два расколоты и повалены
            const stone = new THREE.MeshStandardMaterial({ color: 0x4a4448, roughness: 0.9, metalness: 0.05 });
            const assets = (window.GAME_ASSETS && window.GAME_ASSETS.textures) || {};
            if (assets.stoneTrailDiff || assets.rockDiff) { const t = new THREE.TextureLoader().load(assets.stoneTrailDiff || assets.rockDiff); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4); stone.map = t; this.textures.push(t); }
            const rune = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: 'varying vec3 vW; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
                fragmentShader: `uniform float uTime; varying vec3 vW;
                    float h(float p) { return fract(sin(p * 127.1) * 43758.5453); }
                    void main() { float seg = floor(vW.y * 1.6), on = step(0.3, h(seg + floor(vW.x + vW.z) * 3.0)); float gap = step(0.12, fract(vW.y * 1.6));
                        float p = 0.6 + 0.4 * sin(uTime * 1.1 - vW.y * 0.6);
                        gl_FragColor = vec4(vec3(0.30, 0.50, 1.0) * on * gap * p * 1.8, 1.0);
                        #include <tonemapping_fragment>
                        #include <encodings_fragment>
                    }`
            });
            this.materials.push(stone, rune);
            const pillarGeo = new THREE.CylinderGeometry(0.95, 1.3, 1, 4, 1); pillarGeo.rotateY(Math.PI / 4);      // четырёхгранный сужающийся столп (высота 1, растягивается)
            const capGeo = new THREE.CylinderGeometry(1.25, 1.05, 0.8, 4, 1); capGeo.rotateY(Math.PI / 4);
            const baseGeo = new THREE.CylinderGeometry(1.5, 1.75, 0.9, 4, 1); baseGeo.rotateY(Math.PI / 4);
            const stripGeo = new THREE.BoxGeometry(0.16, 1, 0.04);
            this.geometries.push(pillarGeo, capGeo, baseGeo, stripGeo);
            const R = 15.5;
            for (let i = 0; i < 8; i++) {
                const a = i / 8 * Math.PI * 2 + Math.PI / 8, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R, q = this._sample(x, z);
                if (!q || q.s > -1.5 || q.L < 2.0) continue;
                const broken = (i === 2 || i === 5), Hh = broken ? 3.2 + i * 0.3 : 10.5;
                const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -a + Math.PI / 2; this.group.add(g);
                const mk = (geo, mat, y, sy) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; if (sy) m.scale.y = sy; g.add(m); return m; };
                mk(baseGeo, stone, 0.35, 0);
                mk(pillarGeo, stone, 0.8 + Hh / 2, Hh);
                if (!broken) mk(capGeo, stone, 0.8 + Hh + 0.4, 0);
                // рунная жила на грани, обращённой к печати
                const st = new THREE.Mesh(stripGeo, rune); st.scale.y = Hh * 0.82; st.position.set(0, 0.8 + Hh * 0.5, -1.16); st.rotation.x = -0.033; g.add(st);
                if (broken) {   // отколотая верхняя часть лежит рядом
                    const top = new THREE.Mesh(pillarGeo, stone); top.scale.set(0.9, 6.0, 0.9); top.rotation.z = Math.PI / 2 - 0.12; top.rotation.y = 0.5 + i; top.position.set(2.6, 0.95, 2.2 + (i % 2)); g.add(top);
                    this._basalt.push([x + Math.cos(-g.rotation.y) * 2.6, z + Math.sin(-g.rotation.y) * 2.6, 2.4]);
                }
                this._basalt.push([x, z, 1.5]);
            }
            this.bossSpawn = { x: cx, z: cz };
        }

        _inBasalt(x, z, m) { const B = this._basalt || []; for (let i = 0; i < B.length; i++) { const dx = x - B[i][0], dz = z - B[i][1], r = B[i][2] + m; if (dx * dx + dz * dz < r * r) return true; } return false; }

        _glowDiscMat() {
            const m = new THREE.ShaderMaterial({
                uniforms: { uTime: this.time },
                vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                fragmentShader: `uniform float uTime; varying vec2 vUv;
                    void main() { float r = length(vUv - 0.5) * 2.0; float g = pow(1.0 - clamp(r, 0.0, 1.0), 2.2) * (0.85 + 0.15 * sin(uTime * 3.1));
                        gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * g * 0.9, 1.0); }`,
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
            });
            this.materials.push(m); return m;
        }

        // ---------- искры, дымка, брызги (3 вызова отрисовки, вся анимация в вершинном шейдере) ----------
        _buildFX() {
            const { X0, Z0, H, NX, NZ, S, L } = this.cave;
            const low = !!(window.GFX && window.GFX.mobile);
            const scale = { value: 600 };
            let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const cells = [];
            for (let k = 0; k < NX * NZ; k += 3) if (L[k] < -0.6 && S[k] < -1.0) cells.push(k);
            const pick = (n) => { const o = []; for (let i = 0; i < n && cells.length; i++) { const k = cells[(rnd() * cells.length) | 0]; o.push([X0 + ((k % NX) + rnd()) * H, Z0 + (((k / NX) | 0) + rnd()) * H]); } return o; };
            const mk = (pts, y0, seedFn, vs, fs, blending, order) => {
                const pos = new Float32Array(pts.length * 3), sd = new Float32Array(pts.length * 4);
                pts.forEach((p, i) => { pos[i * 3] = p[0]; pos[i * 3 + 1] = y0; pos[i * 3 + 2] = p[1]; const q = seedFn(i); sd[i * 4] = q[0]; sd[i * 4 + 1] = q[1]; sd[i * 4 + 2] = q[2]; sd[i * 4 + 3] = q[3]; });
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
                const m = new THREE.ShaderMaterial({ uniforms: { uTime: this.time, uScale: scale }, vertexShader: vs, fragmentShader: fs, blending, depthWrite: false, transparent: true });
                this.geometries.push(g); this.materials.push(m);
                const o = new THREE.Points(g, m); o.frustumCulled = false; o.renderOrder = order; this.group.add(o); return o;
            };
            const emberFS = `varying float vA; varying float vT;
                void main() { vec2 c = gl_PointCoord - 0.5; float a = (1.0 - smoothstep(0.0, 1.0, dot(c, c) * 4.0)) * vA;
                    gl_FragColor = vec4(mix(vec3(1.0, 0.72, 0.28), vec3(1.0, 0.22, 0.03), smoothstep(0.1, 0.8, vT)) * a * 1.6, 1.0); }`;
            // искры над всей лавой
            const first = mk(pick(low ? 220 : 520), this.LAVA_Y + 0.1, () => [rnd(), 0.09 + 0.15 * rnd(), 2.0 + 6.0 * rnd(), 0.05 + 0.08 * rnd()], `
                attribute vec4 aSeed; uniform float uTime; uniform float uScale; varying float vA; varying float vT;
                void main() { float t = fract(uTime * aSeed.y + aSeed.x); vec3 p = position; float w = aSeed.x * 40.0;
                    p.y += t * aSeed.z; p.x += sin(t * 7.0 + w) * 0.5 * t * 1.6; p.z += cos(t * 5.3 + w * 1.7) * 0.5 * t * 1.6;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
                    float px = aSeed.w * uScale / max(0.5, -mv.z); gl_PointSize = clamp(px, 1.6, 14.0);
                    vA = sin(3.14159 * t) * (0.65 + 0.35 * sin(uTime * (9.0 + aSeed.x * 11.0) + w)) * clamp(px / 1.6, 0.25, 1.0) * (1.0 - smoothstep(90.0, 140.0, -mv.z)); vT = t; }`,
                emberFS, THREE.AdditiveBlending, 6);
            first.onBeforeRender = (renderer, scene, camera) => { scale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.5 / Math.tan((camera.fov || 50) * Math.PI / 360); };
            // жаркая дымка над лавой
            mk(pick(low ? 40 : 100), this.LAVA_Y + 0.5, () => [rnd(), 0.045 + 0.035 * rnd(), 6.0 + 7.0 * rnd(), 3.5 + 3.5 * rnd()], `
                attribute vec4 aSeed; uniform float uTime; uniform float uScale; varying float vA; varying float vT; varying float vR;
                void main() { float t = fract(uTime * aSeed.y + aSeed.x); vec3 p = position; float w = aSeed.x * 31.0;
                    p.y += t * aSeed.z; p.x += sin(t * 3.0 + w) * 0.8; p.z += cos(t * 2.3 + w) * 0.8;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
                    gl_PointSize = min(aSeed.w * (0.55 + 0.9 * t) * uScale / max(1.0, -mv.z), 260.0);
                    vA = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.45, 1.0, t)) * exp(mv.z * 0.012) * smoothstep(2.5, 7.0, -mv.z); vT = t; vR = w; }`, `
                varying float vA; varying float vT; varying float vR;
                void main() { vec2 c = gl_PointCoord - 0.5; float cs = cos(vR), sn = sin(vR); c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
                    float puff = (1.0 - smoothstep(0.15, 1.0, length(c) * 2.0)) * (0.75 + 0.25 * sin(c.x * 9.0 + vR) * sin(c.y * 7.0 - vR));
                    gl_FragColor = vec4(mix(vec3(0.85, 0.30, 0.08), vec3(0.20, 0.15, 0.14), smoothstep(0.0, 0.45, vT)), puff * vA * 0.30); }`,
                THREE.NormalBlending, 5);
            // брызги у подножия огнепада: фонтан из центра по дуге
            if (this._splashAt) {
                const n = low ? 70 : 160, pts = []; for (let i = 0; i < n; i++) pts.push(this._splashAt);
                mk(pts, this.LAVA_Y + 0.15, () => [rnd(), 0.45 + 0.5 * rnd(), 1.5 + 4.5 * rnd(), 0.08 + 0.10 * rnd()], `
                    attribute vec4 aSeed; uniform float uTime; uniform float uScale; varying float vA; varying float vT;
                    void main() { float t = fract(uTime * aSeed.y + aSeed.x); float a = aSeed.x * 97.0; float r = 1.2 + t * (1.5 + aSeed.z);
                        vec3 p = position + vec3(cos(a) * r, 4.0 * aSeed.z * t * (1.0 - t), sin(a) * r);
                        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
                        float px = aSeed.w * uScale / max(0.5, -mv.z); gl_PointSize = clamp(px, 1.6, 18.0);
                        vA = (1.0 - t) * clamp(px / 1.6, 0.25, 1.0); vT = t * 0.7; }`,
                    emberFS, THREE.AdditiveBlending, 6);
            }
        }

        // ---------- выборка полей ----------
        _sample(x, z) {
            const c = this.cave, fx = (x - c.X0) / c.H, fz = (z - c.Z0) / c.H;
            if (fx < 0 || fz < 0 || fx >= c.NX - 1 || fz >= c.NZ - 1) return null;
            const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, k = iz * c.NX + ix;
            const bl = (A) => (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + c.NX] * (1 - tx) + A[k + c.NX + 1] * tx) * tz;
            return { s: bl(c.S), F: bl(c.F), C: bl(c.C), L: bl(c.L), P: bl(c.PD) };
        }

        _isWalkPoint(x, z) {
            const q = this._sample(x, z);
            // Идти можно везде, где пол ещё ровный на вид (не поднялся в стену) и есть высота над головой — граница совпадает с видимым подножием стены.
            // (Раньше стояло «не ближе 0.75 м к стене по полю расстояний»: у выступов это давало невидимую преграду за 1.5–2 м до стены.)
            return !!q && q.s < 1.2 && q.F < 0.16 && q.F > -0.2 && q.C - q.F > 2.3 && q.L > 0.75 && q.P > 0.75 && !this._inBasalt(x, z, 0.45);
        }

        _registerColliders() {
            const pf = this.pathfinder;
            if (!pf || !pf.grid) return;
            const cw = pf.cellWidth, ch = pf.cellHeight;
            for (let gz = 0; gz < pf.gridSizeZ; gz++) for (let gx = 0; gx < pf.gridSizeX; gx++) {
                const p = pf.gridToWorld(gx, gz), ox = cw * 0.22, oz = ch * 0.22;
                const ok = this._isWalkPoint(p.x, p.z) && this._isWalkPoint(p.x - ox, p.z - oz) && this._isWalkPoint(p.x + ox, p.z - oz)
                    && this._isWalkPoint(p.x - ox, p.z + oz) && this._isWalkPoint(p.x + ox, p.z + oz);
                pf.grid[pf.getIndex(gx, gz)] = ok ? 0 : 1;
            }
        }

        // ---------- камера: не входит в породу, свод и лаву ----------
        _camValid(x, y, z) {
            const q = this._sample(x, z);
            return !!q && q.s < -0.2 && y > Math.max(q.F, this.LAVA_Y) + 0.6 && y < q.C - 0.6 && !this._inBasalt(x, z, 0.3);
        }
        _camReach(head, dx, dy, dz, r) {
            let best = 0;
            for (let i = 1; i <= 24; i++) { const t = i / 24; if (this._camValid(head.x + dx * r * t, head.y + dy * r * t, head.z + dz * r * t)) best = t; else break; }
            return best * r;
        }
        constrainCamera(cam, head) {
            const vx = cam.x - head.x, vy = cam.y - head.y, vz = cam.z - head.z, r = Math.hypot(vx, vy, vz) || 1;
            if (this._camReach(head, vx / r, vy / r, vz / r, r) >= r - 0.01) return cam;
            const yaw0 = Math.atan2(vx, vz), pit0 = Math.asin(Math.max(-1, Math.min(1, vy / r)));
            const dyaws = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1], dpits = [0, 0.14, 0.28, 0.42, 0.56];
            let bestScore = -1e9, bestD = null, bestIdx = -1, k = 0;
            for (let yi = 0; yi < dyaws.length; yi++) for (let pi = 0; pi < dpits.length; pi++, k++) {
                const yaw = yaw0 + dyaws[yi], pit = Math.min(1.25, pit0 + dpits[pi]), cp = Math.cos(pit);
                const dx = Math.sin(yaw) * cp, dy = Math.sin(pit), dz = Math.cos(yaw) * cp;
                const reach = this._camReach(head, dx, dy, dz, r);
                const score = reach - 3.0 * Math.abs(dyaws[yi]) - 2.2 * dpits[pi] + (k === this._lastCamCand ? 0.5 : 0);
                if (score > bestScore) { bestScore = score; bestD = [dx, dy, dz, reach]; bestIdx = k; }
            }
            this._lastCamCand = bestIdx;
            const reach = Math.max(0.9, bestD[3]);
            cam.x = head.x + bestD[0] * reach; cam.y = head.y + bestD[1] * reach; cam.z = head.z + bestD[2] * reach;
            return cam;
        }

        update(delta) {
            this.time.value += delta;   // игровое время: на паузе лава замирает
            if (this.lavaMat) {
                const sc = this.scene; let f = null, o = sc; while (o && !f) { f = o.fog || null; o = o.parent; }
                if (f) { this.lavaMat.uniforms.uFogColor.value.copy(f.color); if (f.density !== undefined) this.lavaMat.uniforms.uFogDensity.value = f.density; }
            }
        }

        dispose() {
            if (this.group.parent) this.group.parent.remove(this.group);
            this.geometries.forEach(g => g.dispose());
            this.materials.forEach(m => m.dispose());
            this.textures.forEach(t => t.dispose());
            this.geometries = []; this.materials = []; this.textures = [];
        }
    }

    window.AveloraDepths = AveloraDepths;
})();
