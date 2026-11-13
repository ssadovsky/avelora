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
            this._buildRock();
            this._buildLava();
            this._buildShafts();
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
            this._pillars = [[-14, -40, 1.3], [-4, -24, 1.1], [8, -38, 1.2], [16, -22, 1.4], [-22, -30, 1.0], [22, -32, 1.0], [2, -12, 0.9],
                [24, 30, 1.2], [48, 44, 1.1], [-20, 90, 1.3], [-28, 102, 1.0], [-12, 98, 0.9],
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
            const pos = new Float32Array(nV * 6), col = new Float32Array(nV * 6), glow = new Float32Array(nV * 2);
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
                glow[k] = Math.max(glow[k], SH[k] * 0.55); glow[j] = Math.max(glow[j], SH[k] * 0.95);   // свет из пролома на стенах трубы и пятном на полу
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
                    .replace('#include <common>', '#include <common>\nattribute float aGlow; varying vec3 vCavePos; varying vec3 vCaveNor; varying float vGlow;')
                    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCavePos = (modelMatrix * vec4(transformed, 1.0)).xyz; vCaveNor = normalize(mat3(modelMatrix) * objectNormal); vGlow = aGlow;');
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', '#include <common>\nuniform float uDepthsTime; varying vec3 vCavePos; varying vec3 vCaveNor; varying float vGlow;')
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
                        totalEmissiveRadiance += vec3(1.0, 0.30, 0.06) * vGlow * (0.62 + 0.08 * sin(uDepthsTime * 0.9 + vCavePos.x * 0.07)) * (0.25 + diffuseColor.r * 1.6);`);
            };
            mat.customProgramCacheKey = () => 'avelora_depths_rock_v1';
            this.materials.push(mat);
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
                vertexShader: 'varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
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
                    add(new THREE.CylinderGeometry(1.25, 1.7, HT - this.LAVA_Y, 14, 1, true), this._fallMaterial(false), x, (HT + this.LAVA_Y) / 2, z);
                } else {
                    // струя лавы из пролома до самой лужи: круглая, слегка расширяется книзу
                    add(new THREE.CylinderGeometry(0.40, 0.62, HT - this.LAVA_Y, 12, 1, true), this._fallMaterial(false), q[5], (HT + this.LAVA_Y) / 2, q[6]);
                }
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
            return !!q && q.s < -0.75 && q.L > 1.0 && q.P > 0.75 && q.F < 0.3 && q.F > -0.2;
        }

        _registerColliders() {
            const pf = this.pathfinder;
            if (!pf || !pf.grid) return;
            const cw = pf.cellWidth, ch = pf.cellHeight;
            for (let gz = 0; gz < pf.gridSizeZ; gz++) for (let gx = 0; gx < pf.gridSizeX; gx++) {
                const p = pf.gridToWorld(gx, gz), ox = cw * 0.32, oz = ch * 0.32;
                const ok = this._isWalkPoint(p.x, p.z) && this._isWalkPoint(p.x - ox, p.z - oz) && this._isWalkPoint(p.x + ox, p.z - oz)
                    && this._isWalkPoint(p.x - ox, p.z + oz) && this._isWalkPoint(p.x + ox, p.z + oz);
                pf.grid[pf.getIndex(gx, gz)] = ok ? 0 : 1;
            }
        }

        // ---------- камера: не входит в породу, свод и лаву ----------
        _camValid(x, y, z) {
            const q = this._sample(x, z);
            return !!q && q.s < -0.2 && y > Math.max(q.F, this.LAVA_Y) + 0.6 && y < q.C - 0.6;
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
