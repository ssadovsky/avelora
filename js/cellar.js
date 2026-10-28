/**
 * AVELORA — Подвал / нижний этаж внутри обычной локации (AveloraCellar), 2026-10-28
 *
 * Не отдельная локация и не портал: спуск (лестница в открытой траншее → туннель → зал и боковые комнаты)
 * лежит ПОД землёй той же локации, а над ним можно строить как обычно. Весь модуль привязан к одной точке
 * {x, z, r} (начало лестницы, +Z модуля — направление спуска) и описывается блоком `cellars` в world_data.js:
 * сдвинуть = поменять x/z/r, расширить = добавить комнату в `rooms` (attach к стене другой комнаты).
 *
 * Как это работает (кратко):
 *  - Высота: terrain.addLevel({floorAt}) — у точки может быть несколько высот пола (земля / лестница / зал);
 *    герой берёт ту, что ближе к его текущей высоте (так уже работают платформы дома). Открытая траншея
 *    (первые `open` метров лестницы) — всегда лестница: в земле вырезано окно (terrain.holes).
 *  - Навигация: две сетки (поверхность / подвал). Когда герой уходит в туннель, pathfinder.grid подменяется.
 *  - Камера: пока герой рядом, луч камеры проверяется analytic-объёмом (туннель, комнаты, траншея) вместо рельефа.
 *  - Клик по полу: cellar.pickFloor — луч считается по ступеням и полам комнат, а не по земле над ними.
 *  - Свет: без PointLight (новый источник перекомпилирует все материалы): огонь AveloraFire + приглушённый
 *    hemi/sun, пока герой внизу.
 *  - Сохранение: x/z/r как раньше; высоты в сохранении нет, поэтому загрузка «внизу» ставит героя над залом на землю.
 */
(function () {
    'use strict';

    const T = 0.6;   // толщина стен подвала, м

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // ------------------------------------------------------------------
    //  Нормализация конфига (чистые данные, без THREE): общая для prepareLocation и экземпляра
    // ------------------------------------------------------------------
    function norm(cfg) {
        if (cfg._n) return cfg._n;
        const st = Object.assign({ width: 4.0, len: 14.0, drop: 6.2, open: 8.0, height: 2.9 }, cfg.stair || {});
        const n = { cfg, x: cfg.x || 0, z: cfg.z || 0, r: cfg.r || 0, hw: st.width / 2, L: st.len, D: st.drop, open: st.open, H: st.height };
        n.cos = Math.cos(n.r); n.sin = Math.sin(n.r);
        const rooms = [], by = {};
        const defs = (cfg.rooms && cfg.rooms.length) ? cfg.rooms : [{ id: 'hall', w: 30, d: 30, h: 8 }];
        for (const d of defs) {
            const R = { id: d.id, h: d.h || 4.0, doors: [], skip: null, props: d.props !== false, clutter: d.clutter === true, pillars: d.pillars, label: d.label };
            if (!d.attach) {
                const cx = d.cx || 0;
                R.x0 = cx - d.w / 2; R.x1 = cx + d.w / 2;
                R.z0 = (d.z0 !== undefined) ? d.z0 : n.L + T; R.z1 = R.z0 + d.d;
                if (R.x0 < -n.hw && R.x1 > n.hw && rooms.length === 0) R.doors.push({ side: '-z', c: 0, w: n.hw * 2, h: n.H });   // выход лестницы в первую комнату
            } else {
                const P = by[d.attach.room], a = d.attach;
                if (!P) throw new Error('cellar: нет комнаты ' + a.room);
                const dw = a.w || 3.4, dh = Math.min(a.h || 3.0, d.h || 4.0, P.h);
                const pcz = (P.z0 + P.z1) / 2, pcx = (P.x0 + P.x1) / 2, c = a.c || 0;
                if (a.side === '+x') { R.x0 = P.x1 + T; R.x1 = R.x0 + d.w; R.z0 = pcz + c - d.d / 2; R.z1 = R.z0 + d.d; P.doors.push({ side: '+x', c: pcz + c, w: dw, h: dh }); R.skip = '-x'; }
                else if (a.side === '-x') { R.x1 = P.x0 - T; R.x0 = R.x1 - d.w; R.z0 = pcz + c - d.d / 2; R.z1 = R.z0 + d.d; P.doors.push({ side: '-x', c: pcz + c, w: dw, h: dh }); R.skip = '+x'; }
                else if (a.side === '+z') { R.z0 = P.z1 + T; R.z1 = R.z0 + d.d; R.x0 = pcx + c - d.w / 2; R.x1 = R.x0 + d.w; P.doors.push({ side: '+z', c: pcx + c, w: dw, h: dh }); R.skip = '-z'; }
                else { R.z1 = P.z0 - T; R.z0 = R.z1 - d.d; R.x0 = pcx + c - d.w / 2; R.x1 = R.x0 + d.w; P.doors.push({ side: '-z', c: pcx + c, w: dw, h: dh }); R.skip = '+z'; }
            }
            rooms.push(R); by[R.id] = R;
        }
        n.rooms = rooms;
        // границы всего модуля (локальные), с запасом
        let x0 = -n.hw - 2, x1 = n.hw + 2, z0 = -2, z1 = n.L + 2;
        for (const R of rooms) { x0 = Math.min(x0, R.x0 - T - 1); x1 = Math.max(x1, R.x1 + T + 1); z1 = Math.max(z1, R.z1 + T + 1); z0 = Math.min(z0, R.z0 - T - 1); }
        n.bounds = { x0, x1, z0: Math.min(z0, -2), z1 };
        // всё, что стоит на поверхности, тоже входит в «зону модуля» для рельефа/камеры (для горизонтальной проверки достаточно подвала)
        n.toWorld = (lx, lz) => ({ x: n.x + lx * n.cos + lz * n.sin, z: n.z - lx * n.sin + lz * n.cos });
        n.toLocal = (x, z) => { const dx = x - n.x, dz = z - n.z; return { lx: dx * n.cos - dz * n.sin, lz: dx * n.sin + dz * n.cos }; };
        cfg._n = n;
        return n;
    }

    function doorRect(R, d) {
        const hw = d.w / 2;
        if (d.side === '+x') return { x0: R.x1 - 0.01, x1: R.x1 + T + 0.01, z0: d.c - hw, z1: d.c + hw };
        if (d.side === '-x') return { x0: R.x0 - T - 0.01, x1: R.x0 + 0.01, z0: d.c - hw, z1: d.c + hw };
        if (d.side === '+z') return { x0: d.c - hw, x1: d.c + hw, z0: R.z1 - 0.01, z1: R.z1 + T + 0.01 };
        return { x0: d.c - hw, x1: d.c + hw, z0: R.z0 - T - 0.01, z1: R.z0 + 0.01 };
    }

    class AveloraCellar {
        /** Вызывается ДО построения рельефа: добавляет в terrain локации ровную площадку, окно под траншею и чистые зоны. */
        static prepareLocation(loc) {
            if (!loc || !loc.cellars) return;
            const t = loc.terrain = loc.terrain || {};
            for (const cfg of loc.cellars) {
                if (cfg._prepared) continue;
                cfg._prepared = true;
                const n = norm(cfg), plaza = cfg.plaza || {};
                const c = n.toWorld(0, plaza.lz !== undefined ? plaza.lz : 6);
                t.flatSpots = t.flatSpots || [];
                t.flatSpots.push({ x: c.x, z: c.z, radius: plaza.radius || 20, blend: plaza.blend || 10 });
                const hc = n.toWorld(0, (n.open + 0.25) / 2);
                t.holes = t.holes || [];
                t.holes.push({ x: hc.x, z: hc.z, r: n.r, hx: n.hw + 0.3, hz: (n.open + 0.25) / 2 });
                // зал(ы) под землёй: ровная земля над ними на той же высоте, что и площадь (hFrom), чтобы потолок нигде не вылез из земли
                for (const R of n.rooms) {
                    const rc = n.toWorld((R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2), rad = Math.hypot(R.x1 - R.x0, R.z1 - R.z0) / 2 + T + 1.5;
                    t.flatSpots.push({ x: rc.x, z: rc.z, radius: rad, blend: 8, hFrom: [c.x, c.z] });
                    loc.clearings = loc.clearings || []; loc.clearings.push({ x: rc.x, z: rc.z, radius: rad });
                    loc.noFerns = loc.noFerns || []; loc.noFerns.push({ x: rc.x, z: rc.z, rx: rad + 4, rz: rad + 4 });
                }
                loc.clearings = loc.clearings || [];
                loc.clearings.push({ x: c.x, z: c.z, radius: (plaza.radius || 20) - 2 });
                loc.noFerns = loc.noFerns || [];
                loc.noFerns.push({ x: c.x, z: c.z, rx: (plaza.radius || 20), rz: (plaza.radius || 20) });
            }
        }

        constructor(game, cfg) {
            this.game = game; this.cfg = cfg;
            this.n = norm(cfg);
            this.terrain = game.terrain; this.pf = game.pathfinder;
            this.geos = []; this.mats = []; this.texs = []; this.fires = [];
            this.floorMeshes = [];
            this.underBlocks = []; this.surfBlocks = [];
            this.below = false; this.dark = 0;
            this.disposed = false;
            const n = this.n;
            // высота земли в площадке (она ровная — flatSpot из prepareLocation)
            const c0 = n.toWorld(0, 4);
            this.y0 = this.terrain._baseHeightAt(c0.x, c0.z);
            this.F = this.y0 - n.D;           // пол подвала
            this.group = new THREE.Group();
            this.group.name = 'cellar:' + (cfg.id || 'cellar');
            this.group.position.set(n.x, 0, n.z);
            this.group.rotation.y = n.r;
            game.locationRoot.add(this.group);

            this._materials();
            this._buildStair();
            for (const R of n.rooms) this._buildRoom(R);
            this._buildSurface();
            this._buildNav();

            this.level = { floorAt: (x, z, ref, h) => this.floorAt(x, z, ref, h) };
            this.terrain.addLevel(this.level);
            const g = game;
            this._base = { h: g.hemiLight ? g.hemiLight.intensity : 1, s: g.sunLight ? g.sunLight.intensity : 1,
                hc: g.hemiLight ? g.hemiLight.color.clone() : null };
        }

        ramp(lz) { const n = this.n; return this.y0 - n.D * clamp(lz / n.L, 0, 1); }

        // ---------------------------------------------------------------- высота пола
        floorAt(x, z, ref, h) {
            const n = this.n, b = n.bounds;
            const dx = x - n.x, dz = z - n.z;
            const lx = dx * n.cos - dz * n.sin, lz = dx * n.sin + dz * n.cos;
            if (lx < b.x0 || lx > b.x1 || lz < b.z0 || lz > b.z1) return NaN;
            if (Math.abs(lx) <= n.hw && lz >= 0 && lz <= n.open + 0.2) return this.ramp(lz);   // открытая траншея: всегда лестница
            if (!(ref === ref) || ref === undefined) return NaN;
            let y = NaN;
            if (Math.abs(lx) <= n.hw && lz > n.open && lz <= n.L + 0.01) y = this.ramp(lz);
            else if (this._inRooms(lx, lz, 0)) y = this.F;
            if (y === y && Math.abs(y - ref) < Math.abs(h - ref)) return y;
            return NaN;
        }

        _inRooms(lx, lz, m) {
            const rooms = this.n.rooms;
            for (let i = 0; i < rooms.length; i++) {
                const R = rooms[i];
                if (lx >= R.x0 + m && lx <= R.x1 - m && lz >= R.z0 + m && lz <= R.z1 - m) return true;
                for (let k = 0; k < R.doors.length; k++) {
                    const q = doorRect(R, R.doors[k]);
                    const along = (R.doors[k].side === '+x' || R.doors[k].side === '-x');
                    const mm = m > 0 ? m * 0.7 : 0;
                    if (lx >= q.x0 - (along ? m : -mm) && lx <= q.x1 + (along ? m : -mm) && lz >= q.z0 - (along ? -mm : m) && lz <= q.z1 + (along ? -mm : m)) return true;
                }
            }
            return false;
        }

        // ---------------------------------------------------------------- материалы
        _tex(src, rep) {
            if (!src) return null;
            const t = new THREE.TextureLoader().load(src);
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            if (rep) t.repeat.set(rep, rep);
            this.texs.push(t);
            return t;
        }
        _mat(o) { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; }

        _materials() {
            const a = (window.GAME_ASSETS && window.GAME_ASSETS.textures) || {};
            const rock = this._tex(a.rockDiff), nor = this._tex(a.rockNor || a.beachNor), stone = this._tex(a.stoneTrailDiff || a.rockDiff);
            this.wallMat = this._mat({ color: 0x8d9096, map: rock, normalMap: nor, roughness: 0.9, metalness: 0.03, side: THREE.DoubleSide });
            this.floorMat = this._mat({ color: 0x7a7c82, map: stone, normalMap: nor, roughness: 0.84, metalness: 0.02 });
            this.stepMat = this._mat({ color: 0x9a9a9c, map: stone, normalMap: nor, roughness: 0.82, metalness: 0.02 });
            this.darkMat = this._mat({ color: 0x5f6268, map: rock, normalMap: nor, roughness: 0.92, metalness: 0.03 });
            this.townMat = this._mat({ color: 0xcfcbc0, map: rock, normalMap: nor, roughness: 0.88, metalness: 0.02 });
            this.roofMat = this._mat({ color: 0x3f628f, map: rock, roughness: 0.7, metalness: 0.05 });
            this.woodMat = this._mat({ color: 0x4d3825, roughness: 0.9, metalness: 0.0 });
            this.ironMat = this._mat({ color: 0x25272b, roughness: 0.5, metalness: 0.8 });
            this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffd58a }); this.mats.push(this.glowMat);
            this.waterMat = this._mat({ color: 0x3b6f8f, roughness: 0.15, metalness: 0.2, emissive: 0x0b1d2a });
            // знамя: синее, золотой знак
            const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
            const g = cv.getContext('2d');
            g.fillStyle = '#1c3d78'; g.fillRect(0, 0, 128, 256);
            g.strokeStyle = '#d9b457'; g.lineWidth = 6; g.strokeRect(6, 6, 116, 244);
            g.fillStyle = '#d9b457'; g.beginPath(); g.arc(64, 100, 34, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#1c3d78'; g.beginPath(); g.arc(64, 100, 24, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#d9b457'; g.fillRect(58, 70, 12, 60); g.fillRect(34, 94, 60, 12);
            g.beginPath(); g.moveTo(14, 214); g.lineTo(64, 240); g.lineTo(114, 214); g.lineTo(114, 224); g.lineTo(64, 250); g.lineTo(14, 224); g.fill();
            const bt = new THREE.CanvasTexture(cv); this.texs.push(bt);
            this.bannerMat = this._mat({ map: bt, roughness: 0.9, side: THREE.DoubleSide });
        }

        // ---------------------------------------------------------------- помощники геометрии
        _box(w, h, d, mat, tile) {
            tile = tile || 3.0;
            const g = new THREE.BoxGeometry(w, h, d);
            const uv = g.attributes.uv;
            for (let f = 0; f < 6; f++) {
                const su = (f < 2 ? d : w) / tile, sv = (f < 2 ? h : (f < 4 ? d : h)) / tile;
                for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv); }
            }
            this.geos.push(g);
            return new THREE.Mesh(g, mat);
        }
        _put(mesh, x, y, z, parent) { mesh.position.set(x, y, z); (parent || this.group).add(mesh); return mesh; }
        _boxAt(x0, x1, y0, y1, z0, z1, mat, parent, tile) {
            const m = this._box(x1 - x0, y1 - y0, z1 - z0, mat, tile);
            return this._put(m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, parent);
        }
        _cyl(rt, rb, h, seg, mat, x, y, z, parent) {
            const g = new THREE.CylinderGeometry(rt, rb, h, seg); this.geos.push(g);
            return this._put(new THREE.Mesh(g, mat), x, y, z, parent);
        }
        _fire(x, y, z, size) {
            if (!window.AveloraFire) return null;
            const holder = new THREE.Group(); holder.position.set(x, y, z); this.group.add(holder);
            const f = new window.AveloraFire(holder, { x: 0, y: 0, z: 0, size });
            f._wx = this.n.toWorld(x, z).x; f._wz = this.n.toWorld(x, z).z;
            this.fires.push(f);
            return f;
        }
        _sconce(x, y, z, dirX, dirZ) {   // кованый светец у стены + пламя
            const hold = new THREE.Group(); hold.position.set(x, y, z); this.group.add(hold);
            const plate = this._box(0.22, 0.5, 0.22, this.ironMat, 1); hold.add(plate);
            const cup = this._cyl(0.13, 0.08, 0.2, 8, this.ironMat, dirX * 0.3, -0.05, dirZ * 0.3, hold);
            const head = this._cyl(0.05, 0.06, 0.28, 7, this.woodMat, dirX * 0.3, 0.12, dirZ * 0.3, hold);
            this._fire(x + dirX * 0.3, y + 0.3, z + dirZ * 0.3, 0.42);
        }

        // ---------------------------------------------------------------- лестница, траншея, туннель
        _buildStair() {
            const n = this.n, y0 = this.y0, hw = n.hw, L = n.L, D = n.D, H = n.H, open = n.open;
            // ступени: видимые, герой идёт по плавной линии ramp (разница ≤ 0.12 м)
            const steps = Math.round(L / 0.56), run = L / steps;
            for (let i = 0; i < steps; i++) {
                const top = this.ramp((i + 0.5) * run);
                const m = this._boxAt(-hw, hw, top - 0.7, top, i * run, (i + 1) * run + 0.01, this.stepMat, null, 2.0);
                this.floorMeshes.push(m);
            }
            // боковые стены траншеи и туннеля: призма (lz, y) выдавлена по x
            const slabTop = lz => this.ramp(lz) + H + 0.4;
            const pts = [[0, y0 - 0.5], [L, this.F - 0.5], [L, slabTop(L)], [open + 0.5, slabTop(open + 0.5)], [open + 0.5, y0 + 0.55], [0, y0 + 0.55]];
            const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
            const geo = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false });
            geo.rotateY(-Math.PI / 2);   // (lz→z, выдавливание → -x)
            const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
            this.geos.push(geo);
            const wr = new THREE.Mesh(geo, this.wallMat); wr.position.set(hw + T, 0, 0); this.group.add(wr);
            const wl = new THREE.Mesh(geo, this.wallMat); wl.position.set(-hw, 0, 0); this.group.add(wl);
            // перемычка над входом в туннель + плита потолка туннеля
            this._boxAt(-hw - T + 0.05, hw + T - 0.05, this.ramp(open) + H, y0 + 0.5, open, open + 0.45, this.darkMat);   // чуть уже и ниже стен: общие плоскости с торцами/верхом стен мерцали
            const len = (L - open) / Math.cos(Math.atan2(D, L)), ang = Math.atan2(D, L), mid = (open + L) / 2;
            const roof = this._box(hw * 2 + T * 2 - 0.1, 0.4, len, this.darkMat, 3.0);
            roof.position.set(0, this.ramp(mid) + H + 0.2, mid); roof.rotation.x = ang; this.group.add(roof);
            // факелы у входа в туннель
            this._sconce(-hw + 0.1, this.ramp(open) + 1.9, open - 0.35, 1, 0);
            this._sconce(hw - 0.1, this.ramp(open) + 1.9, open - 0.35, -1, 0);
            this._sconce(-hw + 0.1, this.ramp(open + 3) + 1.9, open + 3, 1, 0);
            this._sconce(hw - 0.1, this.ramp(open + 3) + 1.9, open + 3, -1, 0);
        }

        // ---------------------------------------------------------------- комната: пол, стены с проёмами, потолок, наполнение
        _wallRun(alongX, a0, a1, c0, c1, yb, yt, doors, mat) {
            // стена вдоль x (alongX=true: диапазон a по lx, c по lz) или вдоль z
            const list = doors.slice().sort((p, q) => p.c - q.c);
            const seg = (s0, s1, y0, y1) => {
                if (s1 - s0 < 0.02) return;
                if (alongX) this._boxAt(s0, s1, y0, y1, c0, c1, mat); else this._boxAt(c0, c1, y0, y1, s0, s1, mat);
            };
            let cur = a0;
            for (const d of list) {
                seg(cur, d.c - d.w / 2, yb, yt);
                seg(d.c - d.w / 2, d.c + d.w / 2, this.F + d.h, yt);   // перемычка над проёмом
                cur = d.c + d.w / 2;
            }
            seg(cur, a1, yb, yt);
        }

        _buildRoom(R) {
            const F = this.F, yb = F - 0.5, yt = F + R.h + 0.4, n = this.n;
            // пол (верхняя грань — для клика) и потолок
            const fl = this._boxAt(R.x0 - T, R.x1 + T, yb, F, R.z0 - T, R.z1 + T, this.floorMat, null, 2.5); this.floorMeshes.push(fl);
            this._boxAt(R.x0 - T, R.x1 + T, F + R.h, yt, R.z0 - T, R.z1 + T, this.darkMat);
            const dd = side => R.doors.filter(d => d.side === side);
            if (R.skip !== '-z') this._wallRun(true, R.x0 - T, R.x1 + T, R.z0 - T, R.z0, yb, yt, dd('-z'), this.wallMat);
            if (R.skip !== '+z') this._wallRun(true, R.x0 - T, R.x1 + T, R.z1, R.z1 + T, yb, yt, dd('+z'), this.wallMat);
            if (R.skip !== '-x') this._wallRun(false, R.z0, R.z1, R.x0 - T, R.x0, yb, yt, dd('-x'), this.wallMat);
            if (R.skip !== '+x') this._wallRun(false, R.z0, R.z1, R.x1, R.x1 + T, yb, yt, dd('+x'), this.wallMat);
            if (!R.props) return;
            const rnd = mulberry32(R.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
            const w = R.x1 - R.x0, d = R.z1 - R.z0, cx = (R.x0 + R.x1) / 2;
            const big = w >= 12 && d >= 12;
            if (big) {
                // два ряда колонн по длине зала, на каждой колонне — светец
                const cols = Math.max(2, Math.round(d / 5));
                for (let i = 0; i < cols; i++) {
                    const lz = R.z0 + d * (i + 1) / (cols + 1);
                    for (const sx of [-1, 1]) {
                        const lx = cx + sx * (w / 2 - 4.2);
                        const pr = R.h > 6.5 ? 0.85 : 0.62; this._cyl(pr, pr + 0.1, R.h, 14, this.darkMat, lx, F + R.h / 2, lz);
                        this._boxAt(lx - 0.9, lx + 0.9, F, F + 0.4, lz - 0.9, lz + 0.9, this.darkMat);
                        this._boxAt(lx - 0.9, lx + 0.9, F + R.h - 0.4, F + R.h, lz - 0.9, lz + 0.9, this.darkMat);
                        this.underBlocks.push({ lx, lz, r: 1.05 });
                        if ((i + (sx > 0 ? 1 : 0)) % 2 === 0) this._sconce(lx - sx * (R.h > 6.5 ? 0.85 : 0.62), F + 2.6, lz, -sx, 0);
                    }
                }
                // руническое кольцо на полу
                this._runeCircle(cx, F + 0.03, R.z0 + d * 0.5, Math.min(w, d) * 0.3);
                // алтарь на возвышении в дальнем конце
                const az = R.z1 - 1.8;   // вплотную к дальней стене: щель между алтарём и стеной была непроходимой ловушкой
                this._boxAt(cx - 4, cx + 4, F, F + 0.35, az - 1.8, az + 1.8, this.darkMat, null, 2);
                this._boxAt(cx - 1.3, cx + 1.3, F + 0.35, F + 1.25, az - 0.6, az + 0.6, this.wallMat, null, 2);
                this.underBlocks.push({ rect: true, x0: cx - 4, x1: cx + 4, z0: az - 1.8, z1: R.z1 + 0.1 });
                this._fire(cx - 3.2, F + 0.35 + 0.9, az, 0.55); this._fire(cx + 3.2, F + 0.35 + 0.9, az, 0.55);
                this._cyl(0.35, 0.3, 0.9, 8, this.ironMat, cx - 3.2, F + 0.8, az); this._cyl(0.35, 0.3, 0.9, 8, this.ironMat, cx + 3.2, F + 0.8, az);
                if (R.clutter) {   // упавшая колонна (по умолчанию убрана; включить: clutter: true у комнаты)
                    const fc = this._cyl(0.55, 0.55, 4.4, 10, this.darkMat, cx + 2.0, F + 0.5, R.z0 + 4.5); fc.rotation.z = Math.PI / 2; fc.rotation.y = 0.5;
                    this.underBlocks.push({ lx: cx + 2.0, lz: R.z0 + 4.5, r: 1.6 });
                }
            }
            // бочки, ящики, обломки вдоль стен
            const nProps = R.clutter ? (big ? 14 : 8) : 0;   // бочки/ящики/камни вдоль стен — только если clutter: true
            for (let i = 0; i < nProps; i++) {
                const side = rnd() < 0.5 ? -1 : 1;
                const lx = big ? cx + side * (w / 2 - 0.9 - rnd() * 1.1) : R.x0 + 1.0 + rnd() * (w - 2.0);
                const lz = R.z0 + 1.0 + rnd() * (d - 2.0);
                if (big && Math.abs(lz - (R.z0 + d * 0.5)) < 0.1) continue;
                const k = rnd();
                if (k < 0.4) {   // бочка
                    this._cyl(0.38, 0.36, 0.95, 10, this.woodMat, lx, F + 0.475, lz);
                    this._cyl(0.395, 0.395, 0.06, 10, this.ironMat, lx, F + 0.25, lz); this._cyl(0.395, 0.395, 0.06, 10, this.ironMat, lx, F + 0.7, lz);
                    this.underBlocks.push({ lx, lz, r: 0.6 });
                } else if (k < 0.7) {   // ящик
                    const s = 0.7 + rnd() * 0.3, b = this._box(s, s, s, this.woodMat, 1.0); b.position.set(lx, F + s / 2, lz); b.rotation.y = rnd() * 3; this.group.add(b);
                    this.underBlocks.push({ lx, lz, r: s * 0.8 });
                } else {   // обломок камня
                    const g = new THREE.DodecahedronGeometry(0.35 + rnd() * 0.45, 0); this.geos.push(g);
                    const m = new THREE.Mesh(g, this.darkMat); m.position.set(lx, F + 0.25, lz); m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); m.scale.y = 0.7; this.group.add(m);
                    this.underBlocks.push({ lx, lz, r: 0.7 });
                }
            }
            if (!big && R.skip) {   // завал в дальней стене маленькой комнаты — место для будущего продолжения подвала
                const far = (R.skip === '-x') ? { x: R.x1 - 0.6, z: (R.z0 + R.z1) / 2 } : (R.skip === '+x') ? { x: R.x0 + 0.6, z: (R.z0 + R.z1) / 2 } : { x: cx, z: R.z1 - 0.6 };
                for (let i = 0; i < 9; i++) {
                    const g = new THREE.DodecahedronGeometry(0.4 + rnd() * 0.5, 0); this.geos.push(g);
                    const m = new THREE.Mesh(g, this.darkMat);
                    m.position.set(far.x + (rnd() - 0.5) * 1.6, F + 0.3 + rnd() * 0.9, far.z + (rnd() - 0.5) * 2.4); m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); this.group.add(m);
                }
                this.underBlocks.push({ lx: far.x, lz: far.z, r: 1.6 });
                this._sconce(cx, F + 2.0, (R.skip === '-z') ? R.z0 + 0.1 : R.z0 + 0.15, 0, 1);
            } else if (!big) {
                this._sconce(cx, F + 2.0, R.z0 + 0.15, 0, 1);
            }
        }

        _runeCircle(cx, y, cz, rad) {
            const cv = document.createElement('canvas'); cv.width = cv.height = 512;
            const g = cv.getContext('2d'); g.translate(256, 256);
            g.strokeStyle = '#7ffff0'; g.shadowColor = '#3ad8c8'; g.shadowBlur = 12; g.lineWidth = 5;
            for (const r of [236, 200, 120]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
            g.lineWidth = 4;
            const rnd = mulberry32(99);
            for (let i = 0; i < 24; i++) {   // руны между кольцами
                const a = i / 24 * Math.PI * 2; g.save(); g.rotate(a); g.translate(0, -218);
                g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 14);
                const k = (rnd() * 3) | 0; if (k === 0) { g.moveTo(-9, -6); g.lineTo(9, 6); } else if (k === 1) { g.moveTo(-9, 6); g.lineTo(0, -4); g.lineTo(9, 6); } else { g.moveTo(-8, 0); g.lineTo(8, 0); }
                g.stroke(); g.restore();
            }
            g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; const x = Math.cos(a) * 118, y2 = Math.sin(a) * 118; if (i) g.lineTo(x, y2); else g.moveTo(x, y2); } g.closePath(); g.stroke();
            g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; const x = Math.cos(a) * 118, y2 = Math.sin(a) * 118; if (i) g.lineTo(x, y2); else g.moveTo(x, y2); } g.closePath(); g.stroke();
            const t = new THREE.CanvasTexture(cv); this.texs.push(t);
            const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }); this.mats.push(m);
            this.runeMat = m;
            const geo = new THREE.PlaneGeometry(rad * 2, rad * 2); geo.rotateX(-Math.PI / 2); this.geos.push(geo);
            this._put(new THREE.Mesh(geo, m), cx, y, cz);
        }

        // ---------------------------------------------------------------- поверхность: вход, дома, фонтан (необязательно, cfg.surface)
        _buildSurface() {
            const n = this.n, y0 = this.y0, hw = n.hw;
            // арка-вход, знамёна и жаровни убраны: над подвалом только траншея; дома/фонтан — по необходимости из cfg.surface
            for (const it of (this.cfg.surface || [])) {
                if (it.type === 'house' || it.type === 'tower') this._house(it);
                else if (it.type === 'fountain') this._fountain(it);
            }
        }

        _house(it) {
            const y0 = this.y0, w = it.w || 6, d = it.d || 6, h = it.h || 3.6, tower = it.type === 'tower';
            const grp = new THREE.Group(); grp.position.set(it.lx, 0, it.lz); grp.rotation.y = it.rot || 0; this.group.add(grp);
            const base = y0 + 0.35;
            this._boxAt(-w / 2 - 0.2, w / 2 + 0.2, y0 - 0.8, base, -d / 2 - 0.2, d / 2 + 0.2, this.darkMat, grp, 2);
            const wallM = this._boxAt(-w / 2, w / 2, base, base + h, -d / 2, d / 2, this.townMat, grp, 2.5); wallM.castShadow = true;
            // тёмные балки на углах и поясах
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._boxAt(sx * w / 2 - 0.15 + (sx > 0 ? 0.04 : -0.04), sx * w / 2 + 0.15 + (sx > 0 ? 0.04 : -0.04), base, base + h, sz * d / 2 - 0.15 + (sz > 0 ? 0.04 : -0.04), sz * d / 2 + 0.15 + (sz > 0 ? 0.04 : -0.04), this.woodMat, grp, 1);
            this._boxAt(-w / 2 - 0.06, w / 2 + 0.06, base + h * 0.52, base + h * 0.52 + 0.2, -d / 2 - 0.06, d / 2 + 0.06, this.woodMat, grp, 1);
            this._boxAt(-w / 2 - 0.08, w / 2 + 0.08, base + h - 0.2, base + h, -d / 2 - 0.08, d / 2 + 0.08, this.woodMat, grp, 1);
            if (!tower) {   // дверь и окна на фасаде (+z)
                this._boxAt(-0.55, 0.55, base, base + 2.1, d / 2 - 0.02, d / 2 + 0.1, this.woodMat, grp, 1);
                this._boxAt(-0.8, 0.8, base - 0.15, base, d / 2, d / 2 + 0.6, this.darkMat, grp, 1);
            }
            const nw = Math.max(1, Math.floor(w / 3));
            for (let i = 0; i < nw; i++) {
                const wx = (i - (nw - 1) / 2) * (w / (nw + 0.5)) + (nw === 1 ? w * 0.28 : 0);
                if (!tower && Math.abs(wx) < 1.1) continue;
                for (const wy of tower ? [h * 0.35, h * 0.7] : [h * 0.62]) {
                    this._boxAt(wx - 0.5, wx + 0.5, base + wy - 0.55, base + wy + 0.55, d / 2 - 0.02, d / 2 + 0.08, this.woodMat, grp, 1);
                    this._boxAt(wx - 0.38, wx + 0.38, base + wy - 0.43, base + wy + 0.43, d / 2 + 0.05, d / 2 + 0.12, this.glowMat, grp, 1);
                }
            }
            // крыша: башня — четырёхгранная пирамида, дом — двускатная
            const top = base + h;
            if (tower) {
                const g = new THREE.ConeGeometry(Math.max(w, d) * 0.78, 3.6, 4); g.rotateY(Math.PI / 4); this.geos.push(g);
                const m = new THREE.Mesh(g, this.roofMat); m.position.set(0, top + 1.8, 0); m.castShadow = true; grp.add(m);
                this._cyl(0.06, 0.06, 1.6, 6, this.ironMat, 0, top + 4.2, 0, grp);
            } else {
                const rise = w * 0.32, ang = Math.atan2(rise, w / 2), sl = Math.hypot(w / 2 + 0.45, rise + 0.1);
                for (const sx of [-1, 1]) {
                    const r = this._box(sl, 0.2, d + 0.9, this.roofMat, 2.5);
                    r.position.set(sx * (w / 4 + 0.1), top + rise / 2 + 0.05, 0); r.rotation.z = -sx * ang; r.castShadow = true; grp.add(r);
                }
                const tri = new THREE.Shape(); tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, rise);
                const gg = new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false }); gg.translate(0, 0, -d / 2);
                const uv = gg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
                this.geos.push(gg); const gm = new THREE.Mesh(gg, this.townMat); gm.position.set(0, top, 0); grp.add(gm);
                this._boxAt(w * 0.3 - 0.3, w * 0.3 + 0.3, top, top + rise + 0.9, -d * 0.25 - 0.3, -d * 0.25 + 0.3, this.darkMat, grp, 1.5);
            }
            this.surfBlocks.push({ rect: true, lx: it.lx, lz: it.lz, rot: it.rot || 0, hw: w / 2 + 0.4, hd: d / 2 + 0.4 });
        }

        _fountain(it) {
            const y0 = this.y0, g = new THREE.Group(); g.position.set(it.lx, 0, it.lz); this.group.add(g);
            this._cyl(2.7, 2.9, 0.8, 24, this.townMat, 0, y0 + 0.4, 0, g);
            const w = this._cyl(2.35, 2.35, 0.05, 24, this.waterMat, 0, y0 + 0.62, 0, g);
            this._cyl(0.55, 0.7, 1.9, 12, this.townMat, 0, y0 + 1.5, 0, g);
            this._cyl(1.1, 0.5, 0.35, 16, this.townMat, 0, y0 + 2.6, 0, g);
            this._cyl(0.18, 0.4, 0.9, 8, this.townMat, 0, y0 + 3.1, 0, g);
            this.surfBlocks.push({ c: true, lx: it.lx, lz: it.lz, r: 3.3 });
        }

        // ---------------------------------------------------------------- навигация (две сетки)
        _buildNav() {
            const pf = this.pf, n = this.n;
            if (!pf || !pf.grid) return;
            const S = pf.grid, U = new Uint8Array(S.length).fill(1), b = n.bounds;
            const hw = n.hw;
            const surfRange = { x0: Math.min(b.x0, -30), x1: Math.max(b.x1, 30), z0: Math.min(b.z0, -40), z1: b.z1 };
            for (let gz = 0; gz < pf.gridSizeZ; gz++) {
                for (let gx = 0; gx < pf.gridSizeX; gx++) {
                    const p = pf.gridToWorld(gx, gz), q = n.toLocal(p.x, p.z), lx = q.lx, lz = q.lz;
                    if (lx < surfRange.x0 || lx > surfRange.x1 || lz < surfRange.z0 || lz > surfRange.z1) continue;
                    const idx = pf.getIndex(gx, gz);
                    // ПОДВАЛ
                    if (lx >= b.x0 && lx <= b.x1 && lz >= b.z0 && lz <= b.z1) {
                        let ok = (Math.abs(lx) <= hw - 0.35 && lz >= -0.3 && lz <= n.L + 0.2) || this._inRooms(lx, lz, 0.5);
                        if (ok) for (const o of this.underBlocks) {
                            if (o.rect) { if (lx > o.x0 && lx < o.x1 && lz > o.z0 && lz < o.z1) { ok = false; break; } }
                            else if (Math.hypot(lx - o.lx, lz - o.lz) < o.r + 0.35) { ok = false; break; }
                        }
                        U[idx] = ok ? 0 : 1;
                    }
                    // ПОВЕРХНОСТЬ: траншея проходима, парапеты и перемычка — стены
                    if (lz >= -0.7 && lz <= n.open - 0.3 && Math.abs(lx) < hw - 0.3) S[idx] = 0;   // траншея проходима до туннеля, дальше — перемычка/стена
                    else if (lz >= -0.1 && lz <= n.open + 0.9 && Math.abs(lx) <= hw + T + 0.5) S[idx] = 1;
                    for (const o of this.surfBlocks) {
                        if (o.c) { if (Math.hypot(lx - o.lx, lz - o.lz) < o.r + 0.4) S[idx] = 1; }
                        else {
                            const cs = Math.cos(o.rot), sn = Math.sin(o.rot), dx = lx - o.lx, dz = lz - o.lz;
                            if (Math.abs(dx * cs - dz * sn) < o.hw && Math.abs(dx * sn + dz * cs) < o.hd) S[idx] = 1;
                        }
                    }
                }
            }
            pf._gridS = S; pf._gridU = U;
            // Прямоугольные препятствия (алтарь): сетка (клетка 0.75 м) даёт слишком грубый и несимметричный отступ,
            // поэтому точный отступ держат круглые препятствия по периметру (непрерывное выталкивание героя), только для подвала
            if (pf.obstacles) for (const o of this.underBlocks) {
                if (!o.rect) continue;
                const R = 0.2, step = 0.25, put = (lx, lz) => { const w = n.toWorld(lx, lz); pf.obstacles.push({ x: w.x, z: w.z, r: R, under: this.cfg.id }); };
                for (let lx = o.x0; lx <= o.x1 + 1e-6; lx += step) put(lx, o.z0);
                for (let lz = o.z0; lz <= o.z1 + 1e-6; lz += step) { put(o.x0, lz); put(o.x1, lz); }
            }
        }

        // ---------------------------------------------------------------- каждый кадр: состояние «внизу», свет, огонь
        update(delta, hero) {
            if (this.disposed || !hero) return;
            const n = this.n, q = n.toLocal(hero.x, hero.z), lx = q.lx, lz = q.lz;
            let want = this.below;
            const inStair = Math.abs(lx) <= n.hw + 0.2 && lz >= 0 && lz <= n.L + 0.5;
            const inUnder = inStair || this._inRooms(lx, lz, 0);
            // «внизу» (сетка навигации подвала): как только герой спустился по ступеням (y заметно ниже земли)
            if (!this.below) { if (inUnder && hero.y < this.y0 - 0.3 && (!inStair || lz > 0.8)) want = true; }
            else if (!inUnder || (inStair && lz < 0.3) || hero.y > this.y0 - 0.1) want = false;
            if (want !== this.below) {
                this.below = want;
                const pf = this.pf;
                if (pf && pf._gridS) pf.grid = want ? pf._gridU : pf._gridS;
            }
            if (this.terrain) this.terrain.defaultRef = this.below ? hero.y : undefined;
            if (this.pending) this._continuePending(hero, lz, inStair);   // getHeightAt без refY (скилы, снаряды) берёт этаж героя
            // под крышей (туннель, комнаты) — тёмно; в открытой траншее небо видно, свет не меняем
            const covered = this.below && (!inStair || lz > n.open + 0.3);
            // камера разворачивается вдоль коридора один раз при входе в траншею/туннель (потом игрок крутит как хочет)
            const inCorr = this.below && inStair && lz > 1.0;
            // свет: внизу солнца нет, а hemi приглушён и тёплый
            const target = covered ? 1 : 0;
            this.dark += clamp(target - this.dark, -delta * 2.2, delta * 2.2);
            const g = this.game;
            if (g.hemiLight && this._base) {
                g.hemiLight.intensity = this._base.h * (1 - 0.5 * this.dark);
                if (this._base.hc) g.hemiLight.color.copy(this._base.hc).lerp(this._warm || (this._warm = new THREE.Color(0xc9a27a)), 0.5 * this.dark);
            }
            if (g.sunLight && this._base) g.sunLight.intensity = this._base.s * (1 - this.dark);
            for (let i = 0; i < this.fires.length; i++) {
                const f = this.fires[i], dx = f._wx - hero.x, dz = f._wz - hero.z;
                if (dx * dx + dz * dz > 2500) continue;
                f.update(delta);
            }
            if (this.runeMat) this.runeMat.opacity = 0.62 + 0.2 * Math.sin((g.gameTime || 0) * 1.6);
        }

        // ---------------------------------------------------------------- камера
        near(x, z) {
            const q = this.n.toLocal(x, z), b = this.n.bounds;
            return q.lx >= b.x0 - 3 && q.lx <= b.x1 + 3 && q.lz >= b.z0 - 3 && q.lz <= b.z1 + 3;
        }
        /** Допустима ли точка камеры: внутри объёма подвала/траншеи или над землёй. */
        camOk(x, y, z) {
            const n = this.n, q = n.toLocal(x, z), lx = q.lx, lz = q.lz;
            if (Math.abs(lx) <= n.hw - 0.15 && lz >= 0 && lz <= n.open && y >= this.ramp(lz) + 0.3) return true;   // траншея открыта сверху
            if (Math.abs(lx) <= n.hw - 0.15 && lz > n.open && lz <= n.L) { const r = this.ramp(lz); if (y >= r + 0.25 && y <= r + n.H - 0.25) return true; }
            for (const R of n.rooms) {
                if (lx >= R.x0 + 0.3 && lx <= R.x1 - 0.3 && lz >= R.z0 + 0.3 && lz <= R.z1 - 0.3 && y >= this.F + 0.3 && y <= this.F + R.h - 0.3) return true;
                for (const d of R.doors) {
                    const dq = doorRect(R, d);
                    if (lx >= dq.x0 && lx <= dq.x1 && lz >= dq.z0 && lz <= dq.z1 && y >= this.F + 0.3 && y <= this.F + d.h - 0.25) return true;
                }
            }
            return y >= this.terrain._baseHeightAt(x, z) + 0.5;
        }

        // ---------------------------------------------------------------- клик по полу
        /** Загрузка сохранения «внизу»: ставит героя на пол подвала / ступени (в сохранении только id подвала и x/z). */
        restoreHero(ch) {
            const n = this.n, p = ch.position, q = n.toLocal(p.x, p.z);
            if (Math.abs(q.lx) <= n.hw + 0.2 && q.lz >= 0 && q.lz <= n.L + 0.01) p.y = this.ramp(q.lz);
            else if (this._inRooms(q.lx, q.lz, 0)) p.y = this.F;
            else return false;
            this.update(0, p);
            return true;
        }

        /** Путь к точке (tx,tz) с учётом этажей: если моб/цель на другом этаже, идём к лестнице, дальше достраивает update(). Без подвалов — обычный findPath. */
        static route(game, from, tx, tz, targetUnder) {
            const pf = game.pathfinder, l = game.cellars;
            const T = new THREE.Vector3(tx, 0, tz);
            if (l && l.length) {
                for (let i = 0; i < l.length; i++) {
                    const cl = l[i], q = cl.n.toLocal(tx, tz);
                    const near = cl.below || targetUnder === cl.cfg.id;
                    if (!near) continue;
                    const tb = targetUnder === cl.cfg.id;
                    if (cl.below && !tb) { cl.pending = { x: tx, z: tz, t: game.gameTime || 0, mode: 'up' }; const w = cl.n.toWorld(0, 0.2); return pf.findPath(from, new THREE.Vector3(w.x, 0, w.z)); }
                    if (!cl.below && tb) { cl.pending = { x: tx, z: tz, t: game.gameTime || 0, mode: 'down' }; const w = cl.n.toWorld(0, cl.n.open - 0.5); return pf.findPath(from, new THREE.Vector3(w.x, 0, w.z)); }
                    cl.pending = null;
                }
            }
            return pf.findPath(from, T);
        }

        /** Клик по карте, пока герой и цель на разных этажах: идём к лестнице (waypoint), потом update() достраивает путь до цели. Возвращает точку или null. */
        routeClick(pt, onFloor) {
            const n = this.n, gt = this.game.gameTime || 0;
            this.pending = null;
            const q = n.toLocal(pt.x, pt.z);
            if (this.below && !onFloor) {            // цель на земле, герой внизу: сначала наверх по лестнице
                this.pending = { x: pt.x, z: pt.z, t: gt, mode: 'up' };
                return n.toWorld(0, 0.2);
            }
            if (!this.below && onFloor && q.lz > n.open + 0.5) {   // цель на полу туннеля/зала, герой наверху: сначала вниз по ступеням
                this.pending = { x: pt.x, z: pt.z, t: gt, mode: 'down' };
                return n.toWorld(0, n.open - 0.5);
            }
            return null;
        }

        _continuePending(hero, lz, inStair) {
            const P = this.pending, pf = this.pf, g = this.game;
            if (!P) return;
            if ((g.gameTime || 0) - P.t > 45) { this.pending = null; return; }
            let go = false, keep = null;
            if (P.mode === 'up') { go = !this.below || (inStair && lz < 1.0); if (go && pf._gridS) { keep = pf.grid; pf.grid = pf._gridS; } }
            else go = this.below && lz > this.n.open - 1.5;
            if (!go) return;
            const path = pf.findPath(hero, new THREE.Vector3(P.x, 0, P.z));
            if (keep) pf.grid = keep;
            this.pending = null;
            if (path && path.length) g.character.setPath(path);
        }

        pickFloor(raycaster, terrainHit) {
            if (!this.floorMeshes.length) return null;
            const hits = raycaster.intersectObjects(this.floorMeshes, false);
            if (!hits.length) return null;
            const f = hits[0];
            if (!terrainHit) return f;
            if (f.distance < terrainHit.distance) return f;
            const q = this.n.toLocal(terrainHit.point.x, terrainHit.point.z);
            if (Math.abs(q.lx) <= this.n.hw + 0.3 && q.lz >= -0.2 && q.lz <= this.n.open + 0.3) return f;   // окно в земле
            return null;
        }

        dispose() {
            this.disposed = true;
            this.pending = null;
            if (this.terrain) this.terrain.defaultRef = undefined;
            const g = this.game;
            if (this.terrain && this.level) this.terrain.removeLevel(this.level);
            if (this.pf && this.pf._gridS) { this.pf.grid = this.pf._gridS; }
            if (g.hemiLight && this._base) { g.hemiLight.intensity = this._base.h; if (this._base.hc) g.hemiLight.color.copy(this._base.hc); }
            if (g.sunLight && this._base) g.sunLight.intensity = this._base.s;
            if (this.group.parent) this.group.parent.remove(this.group);
            this.fires.forEach(f => f.dispose()); this.fires.length = 0;
            this.geos.forEach(x => x.dispose()); this.mats.forEach(x => x.dispose()); this.texs.forEach(x => x.dispose());
            this.geos.length = this.mats.length = this.texs.length = 0;
        }
    }

    window.AveloraCellar = AveloraCellar;
})();
