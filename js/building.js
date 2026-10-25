/**
 * Avelora — Строительство (building.js)
 *
 * Каталог построек и строительных блоков доступен в любой локации (кнопка «Строить» в микроменю / клавиша B).
 * Возведение построек разрешено только в локациях с `building: { area: {x, z, hx, hz} }` («Домашний лагерь»).
 * Вне лагеря кнопки размещения неактивны, что позволяет игроку свободно сверяться со стоимостью материалов.
 *
 * Группы в меню (аккордеон):
 *   • Производство: Пильня (верстак досок), Кузня (ковка).
 *   • Строительство дома: Пол, Стена, Стена с дверью, Стена с окном, Скатная крыша, Крыльцо со ступенями.
 *   • Хранение: Дощатый склад (36 ячеек).
 *
 * Строительство дома:
 *   • Модульная сетка: блок 2.0 × 2.0 м, высота стен 2.4 м.
 *   • Автоматическое примагничивание (snapping) к смежным блокам пола, стен, крыши и дверных проемов.
 *   • Непрерывное строительство: после установки блока призрак остается активным для быстрой сборки.
 *   • Клавиша G: выравнивание по модульной сетке и поворот на кратные 90°.
 *   • Интеграция с terrain (addPlatform) — герой ходит по полу и ступеням, клики мыши попадают в настил.
 *   • Прозрачность стен и крыши (wallOp / roofOp) при нахождении героя внутри или приближении камеры.
 *   • Интерактивный режим сноса прямо в мире (выбор курсором в 3D) с возвратом 100% затраченных материалов.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Размеры и константы
    // ------------------------------------------------------------------
    const HX = 2.3, HZ = 2.5;          // половины размеров склада
    const RAMP_L = 1.6, RAMP_HX = 1.25; // трап перед входом склада
    const EAVE_X = HX + 0.45, EAVE_Y = 2.5, RIDGE_Y = 3.7;
    const CHEST_LZ = -1.95;            // сундук-хранилище у задней стены склада
    const TILE_U = 1.0, TILE_V = 0.5;  // размер тайла текстуры дерева
    const WALL_FADE = 0.22;            // прозрачность стен, когда герой внутри
    const FREE_BUILD = /[?&]freebuild=1/.test(location.search);

    // Пильня и кузня
    const SX = 1.9, SZ = 1.5;
    const CRAFT_RADIUS = 4.2;

    // Модуль дома из блоков
    const BLOCK_MOD = 2.0;             // базовый шаг сетки блоков, м
    const BLOCK_HMOD = 1.0;            // половина модуля
    const WALL_H = 2.4;                // высота стен
    const WALL_TH = 0.16;              // толщина стены

    // Группы меню
    const GROUPS = [
        { key: 'production', title: 'Производство' },
        { key: 'blocks', title: 'Строительство дома' },
        { key: 'storage', title: 'Хранение' }
    ];

    const TYPES = {
        // --- Производство ---
        sawmill: {
            id: 'sawmill',
            group: 'production',
            kind: 'station',
            station: 'sawmill',
            name: 'Пильня',
            desc: 'Открытый навес с козлами и двуручной пилой. Рядом с ней из брёвен делают доски: откройте сумку → «Создание». Для постройки доски не нужны.',
            cost: [{ item: 'log', count: 8 }, { item: 'branch', count: 4 }, { item: 'stone', count: 4 }],
            mesh: 'woodshed',
            craftRadius: 5.0,
            sep: 5.2,
            fp: { hx: 2.5, hz: 2.5, front: 0, eaveX: 2.6, ridgeY: 3.2 },
            rects: [
                { x0: -2.2, x1: 2.2, z0: -2.0, z1: -0.4 },
                { x0: 1.1, x1: 2.3, z0: -0.4, z1: 1.9 },
                { x0: -1.7, x1: -0.55, z0: 0.1, z1: 1.2 }
            ],
            icon: '<path d="M6 16 24 7l18 9"/><path d="M10 15v26M38 15v26"/><path d="M8 33h32"/><path d="M13 33l4 8M35 33l-4 8"/><path d="M6 28h36" stroke-width="3.5"/><path d="M25 14v18M23 14h4" stroke-width="1.6"/>'
        },
        forge: {
            id: 'forge',
            group: 'production',
            kind: 'station',
            station: 'forge',
            name: 'Кузня',
            desc: 'Открытая кузня под навесом: каменный горн с трубой, наковальня, бадья для закалки, верстак. Рядом с ней можно ковать (рецепты со станцией «кузня»).',
            cost: [{ item: 'stone', count: 14 }, { item: 'iron_ore', count: 6 }, { item: 'log', count: 4 }, { item: 'plank', count: 6 }],
            mesh: 'smithy',
            rects: [
                { x0: -2.7, x1: 2.7, z0: -2.25, z1: -0.55 },
                { x0: -3.25, x1: -1.35, z0: -1.4, z1: 1.2 },
                { x0: 1.8, x1: 2.9, z0: -1.0, z1: 2.2 },
                { x0: -0.85, x1: 0.05, z0: 1.1, z1: 2.0 }
            ],
            craftRadius: 5.2,
            sep: 5.0,
            fp: { hx: 3.0, hz: 2.45, front: 0.6, eaveX: 3.1, ridgeY: 4.2 },
            icon: '<path d="M6 18 24 8l18 10"/><path d="M9 18v22M39 18v22"/><path d="M15 40V26h18v14"/><path d="M19 26v-8h10v8"/><path d="M21 33h6" stroke-width="3"/><path d="M12 40h24"/>'
        },

        // --- Строительство дома ---
        block_floor: {
            id: 'block_floor',
            group: 'blocks',
            kind: 'block',
            blockType: 'floor',
            name: 'Пол',
            desc: 'Модульный деревянный настил 2×2 м на брусьях и сваях. Служит основанием для комнат любой конфигурации.',
            cost: [{ item: 'plank', count: 4 }],
            fp: { hx: BLOCK_HMOD, hz: BLOCK_HMOD, front: 0, eaveX: BLOCK_HMOD, ridgeY: 0.2 },
            rects: [],
            icon: '<path d="M4 14l20-8 20 8-20 8z"/><path d="M4 22l20 8 20-8"/><path d="M4 30l20 8 20-8"/><path d="M4 14v16M24 22v16M44 14v16"/>'
        },
        block_wall: {
            id: 'block_wall',
            group: 'blocks',
            kind: 'block',
            blockType: 'wall',
            name: 'Стена',
            desc: 'Бревенчатая стена 2×2.4 м. Защищает от непогоды, при входе героя внутрь становится полупрозрачной.',
            cost: [{ item: 'plank', count: 4 }, { item: 'log', count: 1 }],
            fp: { hx: BLOCK_HMOD, hz: 0.16, front: 0, eaveX: BLOCK_HMOD, ridgeY: WALL_H },
            rects: [{ x0: -BLOCK_HMOD, x1: BLOCK_HMOD, z0: -0.2, z1: 0.2 }],
            icon: '<rect x="6" y="8" width="36" height="32" rx="2"/><path d="M6 16h36M6 24h36M6 32h36M18 8v8M30 8v8M12 16v8M24 16v8M36 16v8M18 24v8M30 24v8M12 32v8M24 32v8M36 32v8"/>'
        },
        block_door: {
            id: 'block_door',
            group: 'blocks',
            kind: 'block',
            blockType: 'door',
            name: 'Стена с дверью',
            desc: 'Стена 2×2.4 м с дверным косяком и открытым проемом шириной 0.9 м. Проход всегда свободен.',
            cost: [{ item: 'plank', count: 4 }, { item: 'log', count: 2 }],
            fp: { hx: BLOCK_HMOD, hz: 0.16, front: 0, eaveX: BLOCK_HMOD, ridgeY: WALL_H },
            rects: [
                { x0: -BLOCK_HMOD, x1: -0.45, z0: -0.2, z1: 0.2 },
                { x0: 0.45, x1: BLOCK_HMOD, z0: -0.2, z1: 0.2 }
            ],
            icon: '<path d="M6 8h36v32H6z"/><path d="M15 40V16h18v24"/><circle cx="28" cy="28" r="1.5" fill="#efcf7a"/>'
        },
        block_window: {
            id: 'block_window',
            group: 'blocks',
            kind: 'block',
            blockType: 'window',
            name: 'Стена с окном',
            desc: 'Стена 2×2.4 м с окном в деревянной раме. Пропускает свет и открывает красивый обзор.',
            cost: [{ item: 'plank', count: 4 }, { item: 'branch', count: 2 }],
            fp: { hx: BLOCK_HMOD, hz: 0.16, front: 0, eaveX: BLOCK_HMOD, ridgeY: WALL_H },
            rects: [{ x0: -BLOCK_HMOD, x1: BLOCK_HMOD, z0: -0.2, z1: 0.2 }],
            icon: '<rect x="6" y="8" width="36" height="32" rx="2"/><rect x="14" y="16" width="20" height="16" rx="1"/><path d="M24 16v16M14 24h20"/>'
        },
        block_roof: {
            id: 'block_roof',
            group: 'blocks',
            kind: 'block',
            blockType: 'roof',
            name: 'Скат крыши',
            desc: 'Кровельный наклонный скат 2.4×2.2 м со стропилами. Можно стыковать ярусами выше для больших домов.',
            cost: [{ item: 'plank', count: 4 }, { item: 'branch', count: 2 }],
            fp: { hx: BLOCK_HMOD, hz: 1.1, front: 0, eaveX: BLOCK_HMOD, ridgeY: 1.2 },
            rects: [],
            icon: '<path d="M4 32 24 12l20 20"/><path d="M10 26l14-14 14 14"/><path d="M24 12v26"/>'
        },
        block_roof_flat: {
            id: 'block_roof_flat',
            group: 'blocks',
            kind: 'block',
            blockType: 'roof_flat',
            name: 'Плоская крыша / Потолок',
            desc: 'Горизонтальное перекрытие 2.4×2.4 м. Служит потолком, полом 2 этажа или плоской крышей для домов любой ширины (3, 6, 9 блоков).',
            cost: [{ item: 'plank', count: 4 }, { item: 'log', count: 1 }],
            fp: { hx: BLOCK_HMOD, hz: BLOCK_HMOD, front: 0, eaveX: BLOCK_HMOD, ridgeY: 0.2 },
            rects: [],
            icon: '<rect x="6" y="12" width="36" height="6" rx="1"/><path d="M10 18v16M24 18v16M38 18v16M6 34h36"/>'
        },
        block_roof_ridge: {
            id: 'block_roof_ridge',
            group: 'blocks',
            kind: 'block',
            blockType: 'roof_ridge',
            name: 'Конёк крыши (Центральный)',
            desc: 'Двускатная вершина 2.4×2.4 м с коньковым брусом по центру. Венчает середину дома при нечётной ширине (3, 5, 7 блоков).',
            cost: [{ item: 'plank', count: 5 }, { item: 'log', count: 2 }],
            fp: { hx: BLOCK_HMOD, hz: BLOCK_HMOD, front: 0, eaveX: BLOCK_HMOD, ridgeY: 0.9 },
            rects: [],
            icon: '<path d="M4 34 24 14l20 20"/><circle cx="24" cy="14" r="2.5" fill="#efcf7a"/><path d="M8 28l16-12 16 12"/>'
        },
        block_gable_rect: {
            id: 'block_gable_rect',
            group: 'blocks',
            kind: 'block',
            blockType: 'gable_rect',
            name: 'Стена фронтона (Прямоугольная)',
            desc: 'Прямоугольная деревянная стена 2.4×1.0 м. Поднимает центральную стену дома до уровня верхушек скатов.',
            cost: [{ item: 'plank', count: 3 }, { item: 'log', count: 1 }],
            fp: { hx: BLOCK_HMOD, hz: 0.16, front: 0, eaveX: BLOCK_HMOD, ridgeY: 1.0 },
            rects: [{ x0: -BLOCK_HMOD, x1: BLOCK_HMOD, z0: -0.2, z1: 0.2 }],
            icon: '<rect x="6" y="16" width="36" height="20" rx="1"/><path d="M6 22h36M6 28h36M18 16v20M30 16v20"/>'
        },
        block_gable: {
            id: 'block_gable',
            group: 'blocks',
            kind: 'block',
            blockType: 'gable',
            name: 'Фронтон наклонный',
            desc: 'Наклонная бревенчатая стенка 2.4×1.0 м под скат крыши. Поворот (клавиша R) меняет сторону уклона.',
            cost: [{ item: 'plank', count: 3 }, { item: 'branch', count: 2 }],
            fp: { hx: BLOCK_HMOD, hz: 0.16, front: 0, eaveX: BLOCK_HMOD, ridgeY: 1.0 },
            rects: [{ x0: -BLOCK_HMOD, x1: BLOCK_HMOD, z0: -0.2, z1: 0.2 }],
            icon: '<path d="M6 18v20h36L6 18z"/><path d="M6 32h36M6 26h24M6 20h12"/>'
        },
        block_gable_peak: {
            id: 'block_gable_peak',
            group: 'blocks',
            kind: 'block',
            blockType: 'gable_peak',
            name: 'Фронтон треугольный (Пик)',
            desc: 'Треугольный пик 2.4×0.65 м. Закрывает торец дома под центральным коньком.',
            cost: [{ item: 'plank', count: 3 }, { item: 'branch', count: 2 }],
            fp: { hx: BLOCK_HMOD, hz: 0.16, front: 0, eaveX: BLOCK_HMOD, ridgeY: 0.7 },
            rects: [{ x0: -BLOCK_HMOD, x1: BLOCK_HMOD, z0: -0.2, z1: 0.2 }],
            icon: '<path d="M6 38h36L24 18z"/><path d="M12 32h24M18 26h12"/>'
        },
        block_stairs: {
            id: 'block_stairs',
            group: 'blocks',
            kind: 'block',
            blockType: 'stairs',
            name: 'Крыльцо со ступенями',
            desc: 'Деревянный наклонный вход 1.2×1.6 м со ступенями. Обеспечивает удобный подъем на пол дома с земли.',
            cost: [{ item: 'plank', count: 3 }, { item: 'log', count: 1 }],
            fp: { hx: 0.6, hz: 0.8, front: 0, eaveX: 0.6, ridgeY: 0.6 },
            rects: [],
            icon: '<path d="M6 38h8v-8h8v-8h8v-8h8"/><path d="M6 38v-8l24-24h8v32z" opacity="0.3"/>'
        },

        // --- Хранение ---
        storage: {
            id: 'storage',
            group: 'storage',
            kind: 'deck',
            name: 'Дощатый склад',
            slots: 36,
            desc: 'Просторный сарай на помосте из досок — в него можно зайти. У задней стены большой сундук-хранилище на 36 ячеек.',
            cost: [{ item: 'plank', count: 16 }, { item: 'log', count: 4 }],
            sep: 5.2,
            fp: { hx: HX, hz: HZ, front: RAMP_L, eaveX: EAVE_X, ridgeY: RIDGE_Y },
            icon: '<path d="M5 22 24 8l19 14"/><path d="M9 21v17h30V21"/><path d="M5 38h38"/><path d="M15 38V27h18v11"/><path d="M15 31h18"/><path d="M19 27v11M24 27v11M29 27v11" stroke-width="1.2"/>'
        }
    };

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ------------------------------------------------------------------
    // Текстуры дерева и камня
    // ------------------------------------------------------------------
    function makeWoodTexture() {
        const S = 256;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const g = c.getContext('2d');
        const rnd = mulberry32(7741);
        for (let y = 0; y < S; y++) {
            const w = Math.sin(y * 0.21) * 0.5 + Math.sin(y * 0.057 + 1.3) * 0.5 + Math.sin(y * 0.9) * 0.15;
            const v = 0.80 + w * 0.09 + (rnd() - 0.5) * 0.09;
            g.fillStyle = `rgb(${Math.round(v * 255)},${Math.round(v * 0.94 * 255)},${Math.round(v * 0.85 * 255)})`;
            g.fillRect(0, y, S, 1);
        }
        const streak = (x, y, len, a, lw) => {
            for (const ox of [0, -S]) {
                g.strokeStyle = `rgba(58,38,22,${a})`;
                g.lineWidth = lw;
                g.beginPath();
                g.moveTo(x + ox, y);
                g.bezierCurveTo(x + ox + len * 0.3, y + (rnd() - 0.5) * 4, x + ox + len * 0.7, y + (rnd() - 0.5) * 4, x + ox + len, y + (rnd() - 0.5) * 3);
                g.stroke();
            }
        };
        for (let i = 0; i < 280; i++) streak(rnd() * S, rnd() * S, 30 + rnd() * 140, 0.05 + rnd() * 0.12, 0.6 + rnd() * 1.2);
        for (let k = 0; k < 3; k++) {
            const x = rnd() * S, y = 30 + rnd() * (S - 60);
            for (const ox of [0, -S]) {
                const gr = g.createRadialGradient(x + ox, y, 1, x + ox, y, 9);
                gr.addColorStop(0, 'rgba(70,44,26,0.55)');
                gr.addColorStop(1, 'rgba(70,44,26,0)');
                g.fillStyle = gr;
                g.beginPath(); g.ellipse(x + ox, y, 14, 6, 0, 0, Math.PI * 2); g.fill();
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        return tex;
    }

    function makeStoneTexture() {
        const S = 256;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const g = c.getContext('2d');
        const rnd = mulberry32(5513);
        g.fillStyle = '#5b5a58'; g.fillRect(0, 0, S, S);
        const rows = 4, rh = S / rows;
        for (let r = 0; r < rows; r++) {
            let x = -(rnd() * 40);
            while (x < S) {
                const w = 50 + rnd() * 50, v = 150 + Math.floor(rnd() * 70);
                g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
                g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
                for (let k = 0; k < 40; k++) { const q = (rnd() - 0.5) * 36; g.fillStyle = `rgba(${q > 0 ? 255 : 0},${q > 0 ? 255 : 0},${q > 0 ? 255 : 0},0.05)`; g.fillRect(x + rnd() * w, r * rh + rnd() * rh, 3 + rnd() * 8, 2 + rnd() * 5); }
                x += w;
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        if (THREE.sRGBEncoding && !tex.colorSpace) tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = 4;
        return tex;
    }

    // ------------------------------------------------------------------
    // Мелкие помощники для слияния досок в один меш
    // ------------------------------------------------------------------
    const FACES = [
        { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
        { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
        { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
        { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
        { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
        { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] }
    ];
    const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const _v = new THREE.Vector3();
    const _nv = new THREE.Vector3();

    function makeBuf() { return { pos: [], nor: [], uv: [], col: [] }; }

    function mat(px, py, pz, rx, ry, rz) {
        const m = new THREE.Matrix4();
        m.makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'XYZ'));
        m.setPosition(px, py, pz);
        return m;
    }
    function child(parent, px, py, pz, rx, ry, rz) {
        return new THREE.Matrix4().multiplyMatrices(parent, mat(px, py, pz, rx, ry, rz));
    }

    function pushQuad(buf, pts, nrm, uvs, col) {
        const idx = [0, 1, 2, 0, 2, 3];
        for (let k = 0; k < 6; k++) {
            const i = idx[k];
            buf.pos.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
            buf.nor.push(nrm.x, nrm.y, nrm.z);
            buf.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
            buf.col.push(col[0], col[1], col[2]);
        }
    }

    function pushBox(buf, sx, sy, sz, mat4, col, rnd) {
        const ga = sx >= sy && sx >= sz ? 0 : (sy >= sz ? 1 : 2);
        const u0 = rnd ? rnd() : 0, v0 = rnd ? rnd() : 0;
        for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const hn = Math.abs(F.n[0] * sx + F.n[1] * sy + F.n[2] * sz) / 2;
            const ha = Math.abs(F.a[0] * sx + F.a[1] * sy + F.a[2] * sz) / 2;
            const hb = Math.abs(F.b[0] * sx + F.b[1] * sy + F.b[2] * sz) / 2;
            const axA = F.a[0] ? 0 : (F.a[1] ? 1 : 2);
            const axB = F.b[0] ? 0 : (F.b[1] ? 1 : 2);
            _nv.set(F.n[0], F.n[1], F.n[2]).transformDirection(mat4);
            const nrm = { x: _nv.x, y: _nv.y, z: _nv.z };
            const pts = [], uvs = [];
            for (let c = 0; c < 4; c++) {
                const sa = CORNERS[c][0], sb = CORNERS[c][1];
                _v.set(
                    F.n[0] * hn + F.a[0] * sa * ha + F.b[0] * sb * hb,
                    F.n[1] * hn + F.a[1] * sa * ha + F.b[1] * sb * hb,
                    F.n[2] * hn + F.a[2] * sa * ha + F.b[2] * sb * hb
                ).applyMatrix4(mat4);
                pts.push(_v.x, _v.y, _v.z);
                const ua = (sa + 1) * ha, vb = (sb + 1) * hb;
                let u, v;
                if (axA === ga) { u = ua; v = vb; } else if (axB === ga) { u = vb; v = ua; } else { u = ua; v = vb; }
                uvs.push(u / TILE_U + u0, v / TILE_V + v0);
            }
            pushQuad(buf, pts, nrm, uvs, col);
        }
    }

    function pushCyl(buf, r0, r1, h, seg, mat4, col, rnd) {
        const u0 = rnd ? rnd() : 0;
        for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
            const pts = [];
            const P = [[c0 * r0, 0, s0 * r0], [c0 * r1, h, s0 * r1], [c1 * r1, h, s1 * r1], [c1 * r0, 0, s1 * r0]];
            P.forEach(p => { _v.set(p[0], p[1], p[2]).applyMatrix4(mat4); pts.push(_v.x, _v.y, _v.z); });
            const am = (a0 + a1) / 2;
            _nv.set(Math.cos(am), (r0 - r1) / Math.max(h, 0.01), Math.sin(am)).transformDirection(mat4);
            const uw = (Math.PI * 2 * r0) / seg / TILE_U;
            pushQuad(buf, pts, { x: _nv.x, y: _nv.y, z: _nv.z },
                [u0 + i * uw, 0, u0 + i * uw, h / TILE_V, u0 + (i + 1) * uw, h / TILE_V, u0 + (i + 1) * uw, 0], col);
        }
        _nv.set(0, 1, 0).transformDirection(mat4);
        for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
            const P = [[0, h, 0], [Math.cos(a1) * r1, h, Math.sin(a1) * r1], [Math.cos(a0) * r1, h, Math.sin(a0) * r1], [0, h, 0]];
            const pts = [];
            P.forEach(p => { _v.set(p[0], p[1], p[2]).applyMatrix4(mat4); pts.push(_v.x, _v.y, _v.z); });
            pushQuad(buf, pts, { x: _nv.x, y: _nv.y, z: _nv.z }, [0.5, 0.5, 0.6, 0.6, 0.4, 0.6, 0.5, 0.5], col);
        }
    }

    function bufToMesh(buf, material, name) {
        if (!buf.pos.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    // ------------------------------------------------------------------
    // Процедурные блоки дома
    // ------------------------------------------------------------------
    function buildBlock(def, p, mats, rnd) {
        const B = { frame: makeBuf(), floor: makeBuf(), wall: makeBuf(), roof: makeBuf(), furn: makeBuf() };
        const WOOD = [0.62, 0.49, 0.33], DARK = [0.36, 0.27, 0.18], LOG = [0.44, 0.33, 0.22];
        const ROOF = [0.50, 0.40, 0.29], ROOFD = [0.24, 0.19, 0.14];
        const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
        const kv = () => 0.86 + rnd() * 0.28;
        const box = (buf, sx, sy, sz, px, py, pz, col, rx, ry, rz) => pushBox(buf, sx, sy, sz, mat(px, py, pz, rx, ry, rz), col, rnd);

        const bType = def.blockType || 'floor';
        const drop = Math.max(0.35, (p && p.drop) || 0.45);

        if (bType === 'floor') {
            const nBoards = 9;
            const bW = (2 * BLOCK_HMOD) / nBoards;
            for (let i = 0; i < nBoards; i++) {
                box(B.floor, 2 * BLOCK_HMOD - 0.04, 0.12, bW - 0.025, 0, -0.06, -BLOCK_HMOD + bW * (i + 0.5), sh(WOOD, kv()));
            }
            [-1, 1].forEach(s => {
                box(B.frame, 2 * BLOCK_HMOD, 0.16, 0.18, 0, -0.20, s * (BLOCK_HMOD - 0.09), sh(DARK, 1));
                box(B.frame, 0.18, 0.16, 2 * BLOCK_HMOD - 0.36, s * (BLOCK_HMOD - 0.09), -0.20, 0, sh(DARK, 1));
            });
            const postH = drop + 0.2;
            [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
                box(B.frame, 0.18, postH, 0.18, sx * (BLOCK_HMOD - 0.1), -0.2 - postH / 2 + 0.08, sz * (BLOCK_HMOD - 0.1), sh(LOG, kv()));
            }));

        } else if (bType === 'wall') {
            [-1, 1].forEach(s => box(B.frame, 0.16, WALL_H, 0.16, s * (BLOCK_HMOD - 0.08), WALL_H / 2, 0, sh(LOG, kv())));
            box(B.frame, 2 * BLOCK_HMOD - 0.32, 0.16, 0.15, 0, 0.08, 0, sh(DARK, 1));
            box(B.frame, 2 * BLOCK_HMOD, 0.16, 0.16, 0, WALL_H - 0.08, 0, sh(LOG, 1));
            const nRows = 11, rH = (WALL_H - 0.32) / nRows;
            for (let i = 0; i < nRows; i++) {
                box(B.wall, 2 * BLOCK_HMOD - 0.32, rH - 0.02, 0.13, 0, 0.16 + rH * (i + 0.5), 0, sh(WOOD, kv()));
            }

        } else if (bType === 'door') {
            [-1, 1].forEach(s => box(B.frame, 0.16, WALL_H, 0.16, s * (BLOCK_HMOD - 0.08), WALL_H / 2, 0, sh(LOG, kv())));
            [-1, 1].forEach(s => box(B.frame, 0.12, 2.08, 0.15, s * 0.46, 1.04, 0, sh(DARK, 1.1)));
            box(B.frame, 1.04, 0.14, 0.16, 0, 2.12, 0, sh(DARK, 1.15));
            box(B.frame, 2 * BLOCK_HMOD, 0.16, 0.16, 0, WALL_H - 0.08, 0, sh(LOG, 1));
            box(B.wall, 0.92, 0.16, 0.13, 0, 2.27, 0, sh(WOOD, kv()));
            const sideW = BLOCK_HMOD - 0.52;
            const nRows = 11, rH = (WALL_H - 0.32) / nRows;
            [-1, 1].forEach(s => {
                box(B.frame, sideW, 0.16, 0.14, s * (BLOCK_HMOD - sideW / 2 - 0.08), 0.08, 0, sh(DARK, 1));
                for (let i = 0; i < nRows; i++) {
                    box(B.wall, sideW, rH - 0.02, 0.13, s * (BLOCK_HMOD - sideW / 2 - 0.08), 0.16 + rH * (i + 0.5), 0, sh(WOOD, kv()));
                }
            });

        } else if (bType === 'window') {
            [-1, 1].forEach(s => box(B.frame, 0.16, WALL_H, 0.16, s * (BLOCK_HMOD - 0.08), WALL_H / 2, 0, sh(LOG, kv())));
            box(B.frame, 2 * BLOCK_HMOD, 0.16, 0.16, 0, WALL_H - 0.08, 0, sh(LOG, 1));
            box(B.wall, 2 * BLOCK_HMOD - 0.32, 0.88, 0.13, 0, 0.44, 0, sh(WOOD, kv()));
            box(B.wall, 2 * BLOCK_HMOD - 0.32, 0.50, 0.13, 0, 2.07, 0, sh(WOOD, kv()));
            const winW = 0.92;
            const sideW = (2 * BLOCK_HMOD - 0.32 - winW) / 2;
            [-1, 1].forEach(s => {
                box(B.wall, sideW, 0.92, 0.13, s * (BLOCK_HMOD - sideW / 2 - 0.16), 1.36, 0, sh(WOOD, kv()));
            });
            box(B.furn, winW + 0.08, 0.06, 0.18, 0, 0.89, 0, sh(DARK, 1.2));
            box(B.furn, winW + 0.04, 0.05, 0.16, 0, 1.83, 0, sh(DARK, 1.1));
            [-1, 1].forEach(s => box(B.furn, 0.05, 0.92, 0.16, s * (winW / 2), 1.36, 0, sh(DARK, 1.1)));
            box(B.furn, 0.035, 0.90, 0.04, 0, 1.36, 0, sh(DARK, 1));
            box(B.furn, winW - 0.04, 0.035, 0.04, 0, 1.36, 0, sh(DARK, 1));

        } else if (bType === 'roof') {
            // Скат крыши 2.4х2.4 м по проекции, подъем ровно на 1.0 м, угол 22.62°
            const ang = 0.3948; // Math.atan2(1.0, 2.4)
            const slopeLen = 2.60;
            const eaveOverhang = 0.15;
            const totalSlope = slopeLen + eaveOverhang;
            const S = mat(0, 0.50 - Math.sin(ang) * (eaveOverhang / 2), Math.cos(ang) * (eaveOverhang / 2), ang, 0, 0);

            pushBox(B.roof, 2 * BLOCK_HMOD, 0.05, totalSlope, S, sh(ROOFD, 1), rnd);

            const nPlanks = 9, step = totalSlope / nPlanks;
            for (let i = 0; i < nPlanks; i++) {
                const offZ = -totalSlope / 2 + step * (i + 0.5);
                pushBox(B.roof, 2 * BLOCK_HMOD + 0.04, 0.04, step - 0.02, child(S, 0, 0.045, offZ, 0, 0, 0), sh(ROOF, kv()), rnd);
            }
            [-BLOCK_HMOD + 0.15, 0, BLOCK_HMOD - 0.15].forEach(x => {
                pushBox(B.frame, 0.12, 0.14, totalSlope, child(S, x, -0.09, 0, 0, 0, 0), sh(DARK, 1), rnd);
            });
            pushBox(B.frame, 2 * BLOCK_HMOD + 0.06, 0.12, 0.05, child(S, 0, 0.01, totalSlope / 2, 0, 0, 0), sh(LOG, 1), rnd);

        } else if (bType === 'roof_flat') {
            // Плоская крыша / Потолочное перекрытие ровно 2.4х2.4 м
            [-BLOCK_HMOD + 0.12, 0, BLOCK_HMOD - 0.12].forEach(x => {
                box(B.frame, 0.16, 0.18, 2 * BLOCK_HMOD, x, -0.09, 0, sh(DARK, 1));
            });
            [-1, 1].forEach(s => {
                box(B.frame, 2 * BLOCK_HMOD, 0.14, 0.14, 0, -0.07, s * (BLOCK_HMOD - 0.08), sh(DARK, 1));
            });
            const nBoards = 9;
            const bW = (2 * BLOCK_HMOD) / nBoards;
            for (let i = 0; i < nBoards; i++) {
                box(B.roof, 2 * BLOCK_HMOD - 0.04, 0.08, bW - 0.02, 0, 0.04, -BLOCK_HMOD + bW * (i + 0.5), sh(WOOD, kv()));
            }

        } else if (bType === 'roof_ridge') {
            // Центральный двускатный конёк с нахлёстом (overlap) поверх скатов
            const rAng = 0.3948; // 22.62 градуса
            const halfSlope = 1.48; // с нахлёстом 15 см поверх боковых скатов!
            const S_neg = mat(0, 0.23, -0.60, -rAng, 0, 0);
            const S_pos = mat(0, 0.23, 0.60, rAng, 0, 0);

            pushBox(B.roof, 2 * BLOCK_HMOD, 0.05, halfSlope, S_neg, sh(ROOFD, 1), rnd);
            pushBox(B.roof, 2 * BLOCK_HMOD, 0.05, halfSlope, S_pos, sh(ROOFD, 1), rnd);

            const nP = 5, st = halfSlope / nP;
            for (let i = 0; i < nP; i++) {
                const offZ = -halfSlope / 2 + st * (i + 0.5);
                pushBox(B.roof, 2 * BLOCK_HMOD + 0.04, 0.04, st - 0.02, child(S_neg, 0, 0.045, offZ, 0, 0, 0), sh(ROOF, kv()), rnd);
                pushBox(B.roof, 2 * BLOCK_HMOD + 0.04, 0.04, st - 0.02, child(S_pos, 0, 0.045, offZ, 0, 0, 0), sh(ROOF, kv()), rnd);
            }
            // Коньковый брус на вершине (z = 0, y = 0.52)
            box(B.roof, 2 * BLOCK_HMOD + 0.12, 0.14, 0.15, 0, 0.52, 0, sh(LOG, 1));
            // Внутренние стропила
            [-BLOCK_HMOD + 0.15, 0, BLOCK_HMOD - 0.15].forEach(x => {
                pushBox(B.frame, 0.10, 0.10, halfSlope, child(S_neg, x, -0.07, 0, 0, 0, 0), sh(DARK, 1), rnd);
                pushBox(B.frame, 0.10, 0.10, halfSlope, child(S_pos, x, -0.07, 0, 0, 0, 0), sh(DARK, 1), rnd);
            });

        } else if (bType === 'gable_rect') {
            // Стена фронтона прямоугольная 2.4х1.0 м (поднимает центральную стену)
            const nRows = 5, rH = 1.0 / nRows;
            [-1, 1].forEach(s => box(B.frame, 0.16, 1.0, 0.16, s * (BLOCK_HMOD - 0.08), 0.5, 0, sh(LOG, kv())));
            box(B.frame, 2 * BLOCK_HMOD - 0.32, 0.14, 0.14, 0, 0.07, 0, sh(DARK, 1));
            box(B.frame, 2 * BLOCK_HMOD, 0.14, 0.14, 0, 1.0 - 0.07, 0, sh(LOG, 1));
            for (let i = 0; i < nRows; i++) {
                box(B.wall, 2 * BLOCK_HMOD - 0.32, rH - 0.02, 0.13, 0, rH * (i + 0.5), 0, sh(WOOD, kv()));
            }

        } else if (bType === 'gable') {
            // Фронтон наклонный: спуск от конька (x = -1.2, y = 1.0) к краю крыши (x = +1.2, y = 0)
            // При повороте на 180 градусов зеркально встает на противоположный скат
            const maxH = 1.0;
            const nRows = 7, rH = maxH / nRows;
            // Высокий столб у центра/конька (-1.2)
            box(B.frame, 0.16, maxH, 0.16, -BLOCK_HMOD + 0.08, maxH / 2, 0, sh(LOG, kv()));
            // Нижний опорный брус по всей ширине стены (y = 0.05)
            box(B.frame, 2 * BLOCK_HMOD, 0.10, 0.14, 0, 0.05, 0, sh(DARK, 1));
            // Горизонтальные доски: внизу полная ширина (2.4м), кверху сужаются к коньку
            for (let i = 0; i < nRows; i++) {
                const py = rH * (i + 0.5);
                const frac = 1.0 - (i + 0.5) / nRows;
                const len = 2 * BLOCK_HMOD * frac;
                const px = -BLOCK_HMOD + len / 2;
                box(B.wall, Math.max(0.12, len), rH - 0.02, 0.13, px, py, 0, sh(WOOD, kv()));
            }
            // Наклонная балка стропилы от (-1.2, 1.0) к (+1.2, 0.0)
            const hyp = 2.60;
            const aGable = -0.3948;
            pushBox(B.frame, hyp + 0.06, 0.14, 0.16, mat(0, maxH / 2, 0, 0, 0, aGable), sh(DARK, 1), rnd);

        } else if (bType === 'gable_peak') {
            // Фронтон треугольный пик 2.4х0.50 м под конёк
            const peakH = 0.50;
            const nRows = 5, rH = peakH / nRows;
            box(B.frame, 2 * BLOCK_HMOD, 0.10, 0.14, 0, 0.05, 0, sh(DARK, 1));
            for (let i = 0; i < nRows; i++) {
                const py = rH * (i + 0.5);
                const frac = 1 - (i + 0.5) / nRows;
                const len = 2 * BLOCK_HMOD * frac;
                box(B.wall, Math.max(0.15, len), rH - 0.02, 0.13, 0, py, 0, sh(WOOD, kv()));
            }
            const halfHyp = 1.30;
            const aGable = 0.3948;
            pushBox(B.frame, halfHyp + 0.04, 0.12, 0.16, mat(BLOCK_HMOD / 2, peakH / 2, 0, 0, 0, -aGable), sh(DARK, 1), rnd);
            pushBox(B.frame, halfHyp + 0.04, 0.12, 0.16, mat(-BLOCK_HMOD / 2, peakH / 2, 0, 0, 0, aGable), sh(DARK, 1), rnd);

        } else if (bType === 'stairs') {
            const stW = 1.2, stL = 1.6;
            const nSteps = 5;
            const stepRise = 0.10, stepRun = stL / nSteps;
            for (let i = 0; i < nSteps; i++) {
                const py = -stepRise * (nSteps - 1 - i);
                const pz = -stL / 2 + stepRun * (i + 0.5);
                box(B.floor, stW, stepRise + 0.02, stepRun + 0.04, 0, py - stepRise / 2, pz, sh(WOOD, kv()));
            }
            [-1, 1].forEach(s => {
                box(B.frame, 0.10, 0.18, Math.hypot(stL, nSteps * stepRise), s * (stW / 2 + 0.05), -0.25, 0, sh(LOG, 1), Math.atan2(nSteps * stepRise, stL), 0, 0);
            });
        }

        const group = new THREE.Group();
        group.name = 'building:' + def.id;
        const meshes = {
            frame: bufToMesh(B.frame, mats.solid, 'frame'),
            floor: bufToMesh(B.floor, mats.solid, 'floor'),
            furn: bufToMesh(B.furn, mats.solid, 'furniture'),
            wall: bufToMesh(B.wall, mats.wall, 'wall'),
            roof: bufToMesh(B.roof, mats.roof, 'roof')
        };
        Object.keys(meshes).forEach(k => { if (meshes[k]) group.add(meshes[k]); });
        return { group, meshes, slopeLen: 0, roofW: 0, th: 0, rampLen: 0, rampAngle: 0 };
    }

    // ------------------------------------------------------------------
    // Модель склада (storage)
    // ------------------------------------------------------------------
    function buildStorage(p, mats, rnd) {
        const B = { frame: makeBuf(), floor: makeBuf(), wall: makeBuf(), roof: makeBuf(), furn: makeBuf() };
        const WOOD = [0.60, 0.47, 0.31], DARK = [0.36, 0.27, 0.18], LOG = [0.42, 0.31, 0.20];
        const ROOF = [0.50, 0.40, 0.29], ROOFD = [0.24, 0.19, 0.14], IRON = [0.12, 0.12, 0.13], GOLD = [0.78, 0.60, 0.2];
        const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
        const kv = () => 0.84 + rnd() * 0.3;
        const box = (buf, sx, sy, sz, px, py, pz, col, rx, ry, rz) => pushBox(buf, sx, sy, sz, mat(px, py, pz, rx, ry, rz), col, rnd);
        const drop = Math.max(0.35, p.drop);

        const nP = 15, stepZ = (2 * HZ) / nP;
        for (let i = 0; i < nP; i++) {
            box(B.floor, 2 * HX - 0.04, 0.12, stepZ - 0.03, 0, -0.06, -HZ + stepZ * (i + 0.5), sh(WOOD, kv()));
        }
        [-1.7, 0, 1.7].forEach(x => box(B.frame, 0.16, 0.2, 2 * HZ - 0.2, x, -0.22, 0, sh(DARK, 1)));
        [-1, 1].forEach(s => box(B.frame, 0.24, 0.24, 2 * HZ + 0.04, s * (HX - 0.10), -0.24, 0, sh(LOG, kv())));
        [-1, 1].forEach(s => box(B.frame, 2 * HX - 0.4, 0.24, 0.26, 0, -0.24, s * (HZ - 0.10), sh(LOG, kv())));
        const skH = drop + 0.1 - 0.12, skY = -0.12 - skH / 2;
        [-1, 1].forEach(s => {
            box(B.frame, 0.05, skH, 2 * HZ - 0.1, s * (HX - 0.03), skY, 0, sh(DARK, 0.9));
            box(B.frame, 2 * HX - 0.1, skH, 0.05, 0, skY, s * (HZ - 0.03), sh(DARK, 0.9));
        });

        const postH = EAVE_Y + drop + 0.1 - 0.05, postY = (EAVE_Y - drop - 0.1) / 2 - 0.025;
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
            box(B.frame, 0.24, postH, 0.24, sx * (HX - 0.12), postY, sz * (HZ - 0.12), sh(LOG, kv()));
        }));
        [-1, 1].forEach(s => {
            for (let i = 0; i < 6; i++) box(B.frame, 0.1, 0.19, 2 * HZ - 0.48, s * (HX - 0.1), 0.1 + i * 0.2, 0, sh(WOOD, kv()));
            box(B.frame, 0.18, 0.12, 2 * HZ - 0.24, s * (HX - 0.1), 1.28, 0, sh(WOOD, 1.05));
            box(B.frame, 0.16, EAVE_Y, 0.16, s * (HX - 0.08), EAVE_Y / 2, 0, sh(LOG, kv()));
            box(B.frame, 0.22, 0.16, 2 * HZ + 0.1, s * (HX - 0.12), EAVE_Y - 0.02, 0, sh(LOG, kv()));
        });
        box(B.frame, 2 * HX + 0.1, 0.2, 0.24, 0, EAVE_Y - 0.1, HZ - 0.08, sh(LOG, 1));
        [-1.6, 0, 1.6].forEach(z => box(B.frame, 2 * HX - 0.2, 0.14, 0.14, 0, EAVE_Y + 0.08, z, sh(DARK, 1)));
        [-1, 1].forEach(s => box(B.frame, 0.12, 0.9, 0.1, s * (HX - 0.36), EAVE_Y - 0.55, HZ - 0.1, sh(LOG, 0.95), 0, 0, s * 0.7));

        for (let i = 0; i < 12; i++) box(B.wall, 2 * HX - 0.46, 0.19, 0.1, 0, 0.1 + i * 0.2, -HZ + 0.1, sh(WOOD, kv()));

        const rise = RIDGE_Y - EAVE_Y, slopeLen = Math.hypot(EAVE_X, rise), th = Math.atan2(rise, EAVE_X);
        const roofW = 2 * HZ + 0.9;
        const nB = 18, zStep = roofW / nB;
        [-1, 1].forEach(s => {
            const S = mat(s * EAVE_X / 2, (EAVE_Y + RIDGE_Y) / 2 + 0.06, 0, 0, 0, -s * th);
            pushBox(B.roof, slopeLen + 0.1, 0.06, roofW, S, sh(ROOFD, 1), rnd);
            for (let i = 0; i < nB; i++) {
                pushBox(B.roof, slopeLen + 0.1, 0.05, zStep - 0.035, child(S, 0, 0.055, -roofW / 2 + zStep * (i + 0.5), 0, 0, 0), sh(ROOF, kv()), rnd);
            }
        });
        box(B.roof, 0.22, 0.22, roofW + 0.05, 0, RIDGE_Y + 0.1, 0, sh(LOG, 0.9), 0, 0, Math.PI / 4);
        const nG = 20, gw = (2 * HX) / nG;
        for (let i = 0; i < nG; i++) {
            const x = -HX + (i + 0.5) * gw;
            const h = rise * (1 - Math.abs(x) / EAVE_X) - 0.04;
            if (h < 0.1) continue;
            box(B.roof, gw - 0.025, h, 0.08, x, EAVE_Y + h / 2 - 0.02, HZ - 0.06, sh(WOOD, kv()));
            box(B.roof, gw - 0.025, h, 0.08, x, EAVE_Y + h / 2 - 0.02, -HZ + 0.06, sh(WOOD, kv()));
        }

        const rampLen = Math.hypot(RAMP_L, p.rampDrop), rampAngle = Math.atan2(p.rampDrop, RAMP_L);
        const R = mat(0, 0, HZ - 0.02, rampAngle, 0, 0);
        const nR = Math.max(3, Math.round(rampLen / 0.31)), rStep = rampLen / nR;
        for (let i = 0; i < nR; i++) {
            pushBox(B.floor, 2 * RAMP_HX, 0.08, rStep - 0.03, child(R, 0, -0.04, rStep * (i + 0.5), 0, 0, 0), sh(WOOD, kv()), rnd);
            if (i % 2 === 1) pushBox(B.floor, 2 * RAMP_HX - 0.1, 0.03, 0.05, child(R, 0, 0.012, rStep * (i + 0.5), 0, 0, 0), sh(DARK, 1), rnd);
        }
        [-1, 1].forEach(s => pushBox(B.frame, 0.14, 0.2, rampLen, child(R, s * (RAMP_HX - 0.07), -0.17, rampLen / 2, 0, 0, 0), sh(LOG, kv()), rnd));

        const crate = (x, y, z, s, ry) => {
            box(B.furn, s, s, s, x, y + s / 2, z, sh(WOOD, kv() * 0.95), 0, ry || 0, 0);
            box(B.furn, s + 0.02, 0.04, s + 0.02, x, y + 0.05 + 0.02, z, sh(DARK, 1), 0, ry || 0, 0);
            box(B.furn, s + 0.02, 0.04, s + 0.02, x, y + s - 0.05, z, sh(DARK, 1), 0, ry || 0, 0);
        };
        const sack = (x, y, z, r, h, col) => pushCyl(B.furn, r, r * 0.55, h, 8, mat(x, y, z, 0, rnd() * 3, 0), col, rnd);
        const barrel = (x, z) => {
            pushCyl(B.furn, 0.3, 0.3, 0.82, 12, mat(x, 0, z, 0, 0, 0), sh(WOOD, 0.9), rnd);
            [0.14, 0.62].forEach(y => pushCyl(B.furn, 0.315, 0.315, 0.05, 12, mat(x, y, z, 0, 0, 0), IRON, rnd));
        };
        const shelf = (cx) => {
            const z0 = -HZ + 0.35, w = 1.2, d = 0.5;
            [-1, 1].forEach(sx => [-1, 1].forEach(sz => box(B.furn, 0.07, 1.8, 0.07, cx + sx * (w / 2 - 0.04), 0.9, z0 + sz * (d / 2 - 0.04), sh(LOG, kv()))));
            [0.5, 1.0, 1.5].forEach(y => box(B.furn, w, 0.04, d, cx, y, z0, sh(WOOD, kv())));
        };
        shelf(-1.55); shelf(1.55);
        crate(-1.9, 0.52, -HZ + 0.35, 0.38, 0.2); crate(-1.35, 0.52, -HZ + 0.35, 0.36, -0.15);
        sack(-1.85, 1.02, -HZ + 0.35, 0.17, 0.36, [0.78, 0.7, 0.55]); sack(-1.5, 1.02, -HZ + 0.35, 0.16, 0.32, [0.72, 0.64, 0.5]);
        crate(-1.6, 1.52, -HZ + 0.35, 0.34, 0.1);
        sack(1.25, 0.52, -HZ + 0.35, 0.17, 0.36, [0.76, 0.68, 0.52]); sack(1.6, 0.52, -HZ + 0.35, 0.18, 0.4, [0.8, 0.72, 0.56]);
        crate(1.9, 1.02, -HZ + 0.35, 0.38, -0.2); crate(1.4, 1.02, -HZ + 0.35, 0.34, 0.25);
        crate(1.6, 1.52, -HZ + 0.35, 0.36, 0);
        crate(-1.75, 0, -1.62, 0.42, 0.25); crate(-1.3, 0, -1.58, 0.4, -0.1); crate(-1.65, 0.42, -1.6, 0.36, 0.5);
        barrel(1.15, -1.6); barrel(1.82, -1.55);

        const cz = CHEST_LZ;
        const CHESTW = [0.50, 0.30, 0.17];
        box(B.furn, 1.5, 0.5, 0.8, 0, 0.25, cz, sh(CHESTW, 1.0));
        box(B.furn, 1.5, 0.16, 0.8, 0, 0.58, cz, sh(CHESTW, 1.12));
        box(B.furn, 1.5, 0.08, 0.6, 0, 0.7, cz, sh(CHESTW, 1.18));
        [-0.55, 0, 0.55].forEach(x => box(B.furn, 0.1, 0.8, 0.85, x, 0.38, cz, IRON));
        box(B.furn, 1.56, 0.06, 0.86, 0, 0.5, cz, IRON);
        box(B.furn, 0.16, 0.22, 0.05, 0, 0.5, cz + 0.43, GOLD);
        box(B.furn, 1.1, 0.28, 0.05, 0, 1.55, -HZ + 0.17, sh(DARK, 1.1));
        box(B.furn, 1.0, 0.18, 0.02, 0, 1.55, -HZ + 0.2, sh(WOOD, 1.15));

        const group = new THREE.Group();
        group.name = 'building:storage';
        const meshes = {
            frame: bufToMesh(B.frame, mats.solid, 'frame'),
            floor: bufToMesh(B.floor, mats.solid, 'floor'),
            furn: bufToMesh(B.furn, mats.solid, 'furniture'),
            wall: bufToMesh(B.wall, mats.wall, 'wall'),
            roof: bufToMesh(B.roof, mats.roof, 'roof')
        };
        Object.keys(meshes).forEach(k => { if (meshes[k]) group.add(meshes[k]); });
        return { group, meshes, slopeLen, roofW, th, rampLen, rampAngle };
    }

    // ------------------------------------------------------------------
    // Брёвна для пильни
    // ------------------------------------------------------------------
    const LOG_L = 1.313, LOG_CY = 0.127;
    const _q = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _vx = new THREE.Vector3(1, 0, 0);
    const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _sc = new THREE.Vector3();
    const _M = new THREE.Matrix4(), _T = new THREE.Matrix4(), _F = new THREE.Matrix4(), _NM = new THREE.Matrix3(), _pv = new THREE.Vector3(), _nv2 = new THREE.Vector3();

    function prepareLogTemplate(done) {
        const It = window.AveloraItems;
        const def = It && It.get && It.get('log');
        if (!def || !def.modelKey || !It.parseModel) { done(null); return; }
        It.parseModel(def.modelKey, (scene) => {
            if (!scene) { done(null); return; }
            const tpl = { variants: [] };
            It.splitVariants(scene).forEach(v => {
                v.updateMatrixWorld(true);
                const parts = [];
                v.traverse(o => { if (o.isMesh && o.geometry && o.material) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
                if (parts.length) tpl.variants.push(parts);
            });
            done(tpl.variants.length ? tpl : null);
        });
    }

    function disposeLogTemplate(tpl) {
        if (!tpl) return;
        tpl.variants.forEach(parts => parts.forEach(p => {
            if (p.geo) p.geo.dispose();
            [].concat(p.mat).forEach(m => {
                ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach(k => { if (m[k]) m[k].dispose(); });
                m.dispose();
            });
        }));
    }

    function makeLogBaker(tpl, matOverride) {
        const buckets = new Map();
        return {
            add(p0, p1, th, variant, flip) {
                _p0.set(p0[0], p0[1], p0[2]); _p1.set(p1[0], p1[1], p1[2]);
                _d.subVectors(_p1, _p0);
                const len = _d.length();
                if (len < 0.01) return;
                _d.multiplyScalar(1 / len);
                _q.setFromUnitVectors(_vx, _d);
                _c.addVectors(_p0, _p1).multiplyScalar(0.5);
                _sc.set(len / LOG_L, th, th);
                _M.compose(_c, _q, _sc);
                if (flip) { _qf.setFromAxisAngle(_vx, Math.PI); _F.makeRotationFromQuaternion(_qf); _M.multiply(_F); }
                _T.makeTranslation(0, -LOG_CY, 0);
                _M.multiply(_T);
                const vi = ((variant % tpl.variants.length) + tpl.variants.length) % tpl.variants.length;
                tpl.variants[vi].forEach(part => {
                    const mat = matOverride || part.mat;
                    const key = vi + '_' + (matOverride ? 'g' : mat.uuid);
                    let bk = buckets.get(key);
                    if (!bk) { bk = { mat, pos: [], nor: [], uv: [], idx: [], n: 0 }; buckets.set(key, bk); }
                    const full = new THREE.Matrix4().multiplyMatrices(_M, part.m);
                    _NM.getNormalMatrix(full);
                    const g = part.geo, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
                    for (let i = 0; i < pa.count; i++) {
                        _pv.fromBufferAttribute(pa, i).applyMatrix4(full);
                        bk.pos.push(_pv.x, _pv.y, _pv.z);
                        if (na) { _nv2.fromBufferAttribute(na, i).applyMatrix3(_NM).normalize(); bk.nor.push(_nv2.x, _nv2.y, _nv2.z); } else bk.nor.push(0, 1, 0);
                        if (ua) bk.uv.push(ua.getX(i), ua.getY(i)); else bk.uv.push(0, 0);
                    }
                    if (g.index) { for (let i = 0; i < g.index.count; i++) bk.idx.push(g.index.getX(i) + bk.n); }
                    else { for (let i = 0; i < pa.count; i++) bk.idx.push(i + bk.n); }
                    bk.n += pa.count;
                });
            },
            meshes() {
                const out = [];
                buckets.forEach(bk => {
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
                    geo.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nor, 3));
                    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
                    geo.setIndex(bk.idx);
                    geo.computeBoundingSphere();
                    const m = new THREE.Mesh(geo, bk.mat);
                    m.name = 'logs'; m.castShadow = true; m.receiveShadow = true;
                    out.push(m);
                });
                return out;
            }
        };
    }

    // ------------------------------------------------------------------
    // Модель пильни и кузни
    // ------------------------------------------------------------------
    function buildSawmill(p, mats, rnd) {
        const FORGE = !!(p && p.forge);
        const B = { frame: makeBuf(), floor: makeBuf(), wall: makeBuf(), roof: makeBuf(), furn: makeBuf(), stone: makeBuf(), glow: makeBuf() };
        const WOOD = [0.62, 0.49, 0.33], PALE = [0.80, 0.68, 0.48], DARK = [0.36, 0.27, 0.18], LOG = [0.42, 0.31, 0.20];
        const ROOF = [0.48, 0.38, 0.27], ROOFD = [0.24, 0.19, 0.14];
        const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
        const kv = () => 0.84 + rnd() * 0.3;
        const box = (buf, sx, sy, sz, px, py, pz, col, rx, ry, rz) => pushBox(buf, sx, sy, sz, mat(px, py, pz, rx, ry, rz), col, rnd);
        const baker = mats.logTpl ? makeLogBaker(mats.logTpl, mats.logMat) : null;
        let lv = 0;
        const lg = (p0, p1, th) => {
            if (baker) { baker.add(p0, p1, th, lv++ + Math.floor(rnd() * 3), rnd() < 0.5); return; }
            _p0.set(p0[0], p0[1], p0[2]); _p1.set(p1[0], p1[1], p1[2]);
            const len = _p0.distanceTo(_p1);
            _d.subVectors(_p1, _p0).normalize();
            _q.setFromUnitVectors(_vx, _d);
            const M4 = new THREE.Matrix4().compose(_c.addVectors(_p0, _p1).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
            pushBox(B.frame, len, 0.26 * th, 0.28 * th, M4, sh(LOG, kv()), rnd);
        };

        const PX = SX - 0.17, PZ = SZ - 0.17;
        const FRONT_Y = 2.8, BACK_Y = 2.2;
        const MID = (FRONT_Y + BACK_Y) / 2;
        const topAt = (z) => MID + (z / PZ) * (FRONT_Y - BACK_Y) / 2;
        const ANG = Math.atan2(BACK_Y - FRONT_Y, 2 * PZ);

        const PXB = SX - 0.12, PZB = SZ - 0.12;
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
            const top = topAt(sz * PZ);
            box(B.frame, 0.24, top + 0.6 - 0.14, 0.24, sx * PXB, (top - 0.14 - 0.6) / 2, sz * PZB, sh(LOG, kv()));
        }));
        const SLOPE_LEN = (2 * PZ + 0.6) / Math.cos(ANG);
        [-1, 1].forEach(sx => box(B.frame, 0.2, 0.2, SLOPE_LEN, sx * PXB, MID - 0.1, 0, sh(LOG, kv()), ANG, 0, 0));
        [-1, 1].forEach(sz => box(sz > 0 ? B.roof : B.frame, 2 * SX + 0.2, 0.2, 0.22, 0, topAt(sz * PZ) + 0.09, sz * PZ, sh(LOG, kv())));
        [-1, 1].forEach(sx => box(B.frame, 0.22, 0.36, 2 * PZB - 0.2, sx * PXB, -0.12, -0.1, sh(LOG, kv() * 0.85)));
        box(B.frame, 2 * PXB - 0.1, 0.36, 0.22, 0, -0.12, -PZB, sh(LOG, kv() * 0.85));

        {
            const run = 2 * SZ + 0.6, len = run / Math.cos(ANG) + 0.05;
            const W = 2 * SX + 0.6;
            const S = mat(0, MID + 0.2, 0, ANG, 0, 0);
            pushBox(B.roof, W, 0.06, len, S, sh(ROOFD, 1), rnd);
            const nB = 12, step = len / nB;
            for (let i = 0; i < nB; i++) {
                pushBox(B.roof, W, 0.05, step - 0.035, child(S, 0, 0.055, -len / 2 + step * (i + 0.5), 0, 0, 0), sh(ROOF, kv()), rnd);
            }
            pushBox(B.roof, W + 0.04, 0.14, 0.16, child(S, 0, 0.1, len / 2 - 0.05, 0, 0, 0), sh(LOG, 0.9), rnd);
        }

        if (!FORGE) {
            const trestle = (x) => {
                box(B.furn, 0.16, 0.16, 0.95, x, 0.93, 0, sh(DARK, 1.1));
                [-1, 1].forEach(s => box(B.furn, 0.14, 0.95, 0.14, x, 0.45, s * 0.34, sh(LOG, kv()), -s * 0.32, 0, 0));
                box(B.furn, 0.09, 0.09, 0.62, x, 0.38, 0, sh(WOOD, 1));
            };
            trestle(-1.15); trestle(1.15);
            lg([-1.6, 1.145, 0], [1.6, 1.145, 0.02], 1.15);
            for (let i = 0; i < 9; i++) {
                const a = rnd() * Math.PI * 2, d = 0.15 + rnd() * 0.7;
                box(B.furn, 0.08 + rnd() * 0.1, 0.03, 0.05 + rnd() * 0.06, 0.1 + Math.cos(a) * d * 1.6, 0.03, Math.sin(a) * d * 0.9 + 0.1, sh(PALE, 0.8 + rnd() * 0.3), 0, rnd() * 3, 0);
            }
            lg([-1.85, 0.13, -0.92], [-0.45, 0.13, -0.97], 1.0);
            lg([-1.85, 0.13, -0.6], [-0.45, 0.13, -0.58], 1.0);
            lg([-1.8, 0.34, -0.76], [-0.5, 0.34, -0.78], 0.95);
            for (let i = 0; i < 9; i++) {
                box(B.furn, 1.2, 0.05, 0.3, 1.2, 0.2 + i * 0.065, -0.92, sh(PALE, 0.88 + rnd() * 0.18), 0, (rnd() - 0.5) * 0.04, 0);
                if (i % 3 === 0) box(B.furn, 0.1, 0.04, 0.34, 1.2 + (i % 2 ? 0.4 : -0.4), 0.17 + i * 0.065 - 0.02, -0.92, sh(DARK, 1));
            }
            [-0.45, 0.45].forEach(x => box(B.furn, 0.1, 0.18, 0.34, 1.2 + x * 1.1, 0.09, -0.92, sh(DARK, 1)));
            lg([-1.2, 0.0, 1.0], [-1.2, 0.5, 1.0], 1.15);
        } else {
            const STONE = [0.80, 0.78, 0.74], STONED = [0.58, 0.57, 0.55], SOOT = [0.20, 0.19, 0.19], IRON = [0.34, 0.35, 0.39];
            const sb = (sx, sy, sz, px, py, pz, col, ry, rx, rz) => pushBox(B.stone, sx, sy, sz, mat(px, py, pz, rx, ry, rz), col, rnd);
            const gb = (sx, sy, sz, px, py, pz, col, ry) => pushBox(B.glow, sx, sy, sz, mat(px, py, pz, 0, ry || 0, 0), col, rnd);
            const LEATHER = [0.40, 0.25, 0.15];
            sb(2 * SX - 0.5, 2.0, 0.32, 0, 1.0, -SZ + 0.2, sh(STONE, 0.95));
            sb(2 * SX - 0.5, 0.14, 0.4, 0, 2.02, -SZ + 0.2, sh(STONED, 1));
            sb(1.8, 0.85, 0.9, 0, 0.425, -0.78, sh(STONE, 1));
            sb(1.9, 0.1, 1.0, 0, 0.9, -0.78, sh(STONED, 1));
            sb(1.0, 0.14, 0.12, 0, 1.0, -0.45, sh(STONE, 0.9));
            [-1, 1].forEach(sx => sb(0.12, 0.14, 0.62, sx * 0.56, 1.0, -0.78, sh(STONE, 0.9)));
            gb(0.96, 0.06, 0.56, 0, 0.96, -0.8, [1.0, 0.42, 0.08]);
            for (let i = 0; i < 9; i++) {
                const hot = rnd() < 0.55;
                gb(0.1 + rnd() * 0.12, 0.07 + rnd() * 0.05, 0.1 + rnd() * 0.1, (rnd() - 0.5) * 0.8, 1.0 + rnd() * 0.04, -0.8 + (rnd() - 0.5) * 0.4, hot ? [1.0, 0.72, 0.22] : [0.85, 0.28, 0.05], rnd() * 3);
            }
            for (let i = 0; i < 5; i++) sb(0.12 + rnd() * 0.08, 0.06, 0.1 + rnd() * 0.06, (rnd() - 0.5) * 0.9, 0.99, -0.62 + rnd() * 0.12, sh(SOOT, 0.7 + rnd() * 0.4), rnd() * 3);
            [-1, 1].forEach(sx => sb(0.22, 0.6, 0.5, sx * 0.68, 1.25, -0.9, sh(STONE, 0.95)));
            sb(1.6, 0.14, 0.9, 0, 1.6, -0.92, sh(STONED, 1));
            sb(1.2, 0.5, 0.6, 0, 1.92, -1.05, sh(STONE, 0.95));
            sb(0.8, 0.5, 0.5, 0, 2.4, -1.1, sh(STONE, 0.95));
            sb(0.56, 1.3, 0.44, 0, 3.3, -1.12, sh(STONE, 0.9));
            sb(0.7, 0.1, 0.56, 0, 4.0, -1.12, sh(STONED, 1));
            pushCyl(B.furn, 0.3, 0.27, 0.5, 10, mat(0, 0, 0.2, 0, 0, 0), sh(LOG, 1.05), rnd);
            sb(0.40, 0.08, 0.26, 0, 0.54, 0.2, sh(IRON, 1));
            sb(0.20, 0.14, 0.18, 0, 0.65, 0.2, sh(IRON, 1.05));
            sb(0.66, 0.11, 0.28, 0, 0.775, 0.2, sh(IRON, 1.15));
            sb(0.2, 0.07, 0.17, 0.42, 0.78, 0.2, sh(IRON, 1.15));
            sb(0.12, 0.05, 0.1, 0.55, 0.775, 0.2, sh(IRON, 1.15));
            gb(0.30, 0.03, 0.05, -0.12, 0.84, 0.17, [1.0, 0.36, 0.08], 0.2);
            box(B.furn, 0.42, 0.04, 0.04, 0.12, 0.85, 0.37, sh(WOOD, 0.9), 0, 0.5, 0);
            sb(0.13, 0.08, 0.08, 0.28, 0.86, 0.31, sh(IRON, 1.1), 0.5);
            box(B.furn, 0.56, 0.06, 0.8, -1.35, 0.5, -0.75, sh(WOOD, 1));
            box(B.furn, 0.56, 0.06, 0.8, -1.35, 0.82, -0.7, sh(WOOD, 1.05), 0, 0, 0.0);
            box(B.furn, 0.5, 0.32, 0.7, -1.35, 0.66, -0.73, sh(LEATHER, 1), 0, 0, 0);
            sb(0.7, 0.07, 0.07, -1.0, 0.62, -0.75, sh(IRON, 1));
            box(B.furn, 0.08, 0.5, 0.08, -1.35, 0.25, -0.5, sh(LOG, 1)); box(B.furn, 0.08, 0.5, 0.08, -1.35, 0.25, -1.0, sh(LOG, 1));
            box(B.furn, 0.04, 0.5, 0.04, -1.35, 1.1, -0.2, sh(WOOD, 0.8), 0.5, 0, 0);
            box(B.furn, 0.96, 0.4, 0.06, 1.32, 0.2, 0.24, sh(WOOD, 0.9)); box(B.furn, 0.96, 0.4, 0.06, 1.32, 0.2, 0.68, sh(WOOD, 0.9));
            [-1, 1].forEach(s => box(B.furn, 0.06, 0.4, 0.5, 1.32 + s * 0.45, 0.2, 0.46, sh(WOOD, 0.85)));
            box(B.furn, 0.9, 0.05, 0.5, 1.32, 0.04, 0.46, sh(DARK, 1));
            sb(0.84, 0.02, 0.38, 1.32, 0.32, 0.46, [0.22, 0.38, 0.5]);
            [-0.3, 0.3].forEach(dx => box(B.furn, 0.04, 0.05, 0.5, 1.32 + dx, 0.42, 0.46, sh(IRON, 1)));
            box(B.furn, 0.9, 0.07, 0.5, 1.4, 0.8, -1.0, sh(WOOD, 1));
            [-1, 1].forEach(s => box(B.furn, 0.09, 0.8, 0.09, 1.4 + s * 0.38, 0.4, -1.0, sh(LOG, 1)));
            for (let i = 0; i < 4; i++) sb(0.3, 0.06, 0.13, 1.2 + (i % 2) * 0.05, 0.87 + i * 0.065, -1.0, sh(IRON, 0.9 + i * 0.07), (i % 2) * 0.1);
            sb(0.04, 0.5, 0.04, 1.62, 0.87, -0.9, sh(IRON, 1), 0, 0, 1.3);
            [-1.55, -1.3, -1.05].forEach((x, i) => { sb(0.05, 0.5 - i * 0.06, 0.03, x, 1.45, -1.28, sh(IRON, 1)); sb(0.12, 0.09, 0.05, x, 1.2 - i * 0.03, -1.28, sh(IRON, 1.1)); });
            for (let i = 0; i < 14; i++) sb(0.1 + rnd() * 0.12, 0.08 + rnd() * 0.08, 0.1 + rnd() * 0.1, -1.55 + (rnd() - 0.5) * 0.6, 0.05 + rnd() * 0.12, 0.85 + (rnd() - 0.5) * 0.5, sh(SOOT, 0.6 + rnd() * 0.6), rnd() * 3);
            lg([-1.8, 0.13, 0.35], [-0.95, 0.13, 0.33], 0.8);
            lg([-1.8, 0.13, 0.05], [-0.95, 0.13, 0.04], 0.8);
            lg([-1.75, 0.32, 0.2], [-1.0, 0.32, 0.19], 0.75);
        }

        const group = new THREE.Group();
        group.name = FORGE ? 'building:forge' : 'building:sawmill';
        const meshes = {
            frame: bufToMesh(B.frame, mats.solid, 'frame'),
            floor: bufToMesh(B.floor, mats.solid, 'floor'),
            furn: bufToMesh(B.furn, mats.solid, 'furniture'),
            wall: null,
            roof: bufToMesh(B.roof, mats.roof, 'roof')
        };
        Object.keys(meshes).forEach(k => { if (meshes[k]) group.add(meshes[k]); });
        if (B.stone.pos.length) { const m = bufToMesh(B.stone, mats.stone || mats.solid, 'stone'); group.add(m); }
        if (B.glow.pos.length) { const m = bufToMesh(B.glow, mats.glow || mats.solid, 'glow'); m.castShadow = false; m.receiveShadow = false; group.add(m); }
        if (baker) baker.meshes().forEach(m => group.add(m));
        return { group, meshes, slopeLen: 0, roofW: 0, th: 0, rampLen: 0, rampAngle: 0 };
    }

    function buildModel(def, p, mats, rnd) {
        if (def.kind === 'block') {
            return buildBlock(def, p, mats, rnd);
        }
        if (def.mesh) {
            const group = new THREE.Group();
            group.name = 'building:' + def.id;
            if (mats.attachMesh) mats.attachMesh(group, def);
            return { group, meshes: {}, slopeLen: 0, roofW: 0, th: 0, rampLen: 0, rampAngle: 0 };
        }
        return def.kind === 'station' ? buildSawmill({ forge: def.id === 'forge' }, mats, rnd) : buildStorage(p, mats, rnd);
    }

    // ------------------------------------------------------------------
    // Интерфейс
    // ------------------------------------------------------------------
    const UI = {
        mgr: null, built: false, panelOpen: false, openGroup: 'blocks',
        els: {}, cardRefs: {},

        build() {
            if (this.built) return;
            this.built = true;
            const E = this.els;
            E.btn = document.getElementById('build-btn');

            const panel = document.createElement('div');
            panel.id = 'build-panel';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-hidden', 'true');
            panel.innerHTML = `
                <div class="inventory-header">
                    <div class="inventory-title">Строительство</div>
                    <button type="button" id="build-close" title="Закрыть" aria-label="Закрыть">×</button>
                </div>
                <div id="build-scroll">
                    <div class="build-section">Каталог проектов</div>
                    <div id="build-accordion"></div>
                    <div class="build-hint" id="build-hint-text">Возводить постройки можно только на территории домашнего лагеря. Перед установкой выберите место: R — поворот, G — выравнивание по сетке, ЛКМ / Enter — построить, Esc — отмена. Клавиша B — открыть/закрыть меню.</div>
                </div>
                <div class="build-bottom-actions">
                    <button type="button" id="build-move-btn" class="build-move-btn" title="Перемещение построек и блоков прямо в мире">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="5 9 2 12 5 15"></polyline>
                            <polyline points="9 5 12 2 15 5"></polyline>
                            <polyline points="15 19 12 22 9 19"></polyline>
                            <polyline points="19 9 22 12 19 15"></polyline>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <line x1="12" y1="2" x2="12" y2="22"></line>
                        </svg>
                        <span>Режим перемещения</span>
                    </button>
                    <button type="button" id="build-demolish-btn" class="build-demolish-btn" title="Снос построек и блоков прямо в мире">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
                        </svg>
                        <span>Режим сноса</span>
                    </button>
                </div>`;
            (document.getElementById('game-ui') || document.body).appendChild(panel);
            E.panel = panel;
            E.accordion = panel.querySelector('#build-accordion');
            E.hintText = panel.querySelector('#build-hint-text');
            E.moveBtn = panel.querySelector('#build-move-btn');
            E.demolishBtn = panel.querySelector('#build-demolish-btn');

            panel.querySelector('#build-close').addEventListener('click', (e) => { e.stopPropagation(); this.closePanel(); });
            panel.addEventListener('click', (e) => e.stopPropagation());

            E.moveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr) this.mgr.startMovingMode();
            });

            E.demolishBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr) this.mgr.startDemolishing();
            });

            // Нижняя панель действий (размещение / снос)
            const bar = document.createElement('div');
            bar.id = 'build-bar';
            bar.innerHTML = `
                <div id="build-bar-title"></div>
                <div id="build-bar-status"></div>
                <div class="build-bar-btns">
                    <button type="button" id="build-rot" title="Повернуть (R)">⟳ Повернуть</button>
                    <button type="button" id="build-align" title="Выровнять по сетке (G)">⊞ По сетке</button>
                    <button type="button" id="build-ok" title="Построить (ЛКМ / Enter)">✔ Построить</button>
                    <button type="button" id="build-move-confirm" class="btn-move-confirm" style="display:none;">✔ Переместить</button>
                    <button type="button" id="build-move-unselect" style="display:none;">Отмена выбора</button>
                    <button type="button" id="build-demolish-confirm" class="btn-demolish-confirm" style="display:none;">✔ Снести</button>
                    <button type="button" id="build-demolish-unselect" style="display:none;">Отмена выбора</button>
                    <button type="button" id="build-cancel" title="Отмена (Esc)">✖ Отмена</button>
                </div>`;
            (document.getElementById('game-ui') || document.body).appendChild(bar);
            E.bar = bar;
            E.barTitle = bar.querySelector('#build-bar-title');
            E.barStatus = bar.querySelector('#build-bar-status');
            E.btnRot = bar.querySelector('#build-rot');
            E.btnAlign = bar.querySelector('#build-align');
            E.btnOk = bar.querySelector('#build-ok');
            E.btnConfirmMove = bar.querySelector('#build-move-confirm');
            E.btnUnselectMove = bar.querySelector('#build-move-unselect');
            E.btnConfirmDemolish = bar.querySelector('#build-demolish-confirm');
            E.btnUnselectDemolish = bar.querySelector('#build-demolish-unselect');
            E.btnCancel = bar.querySelector('#build-cancel');

            bar.addEventListener('click', (e) => e.stopPropagation());
            E.btnConfirmMove.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr && this.mgr.moving) this.mgr.confirmMove();
            });
            E.btnUnselectMove.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr && this.mgr.moving) this.mgr.unselectMove();
            });
            E.btnRot.addEventListener('click', (e) => { e.stopPropagation(); if (this.mgr) this.mgr.rotateBy(Math.PI / 2); });
            E.btnAlign.addEventListener('click', (e) => { e.stopPropagation(); if (this.mgr) this.mgr.alignGrid(); });
            E.btnOk.addEventListener('click', (e) => { e.stopPropagation(); if (this.mgr) this.mgr.commit(); });
            E.btnConfirmDemolish.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr && this.mgr.demolishing) this.mgr.confirmDemolish();
            });
            E.btnUnselectDemolish.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr && this.mgr.demolishing) this.mgr.unselectDemolish();
            });
            E.btnCancel.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.mgr) {
                    if (this.mgr.placing) {
                        const wasMove = !!this.mgr.placing.moveRec;
                        this.mgr.cancelPlacing();
                        if (!wasMove) this.openPanel();
                    }
                    else if (this.mgr.moving) this.mgr.cancelMovingMode();
                    else if (this.mgr.demolishing) this.mgr.cancelDemolishing();
                }
            });

            if (E.btn) {
                E.btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.mgr && this.mgr.game.ui && this.mgr.game.ui.closeMicroMenu) this.mgr.game.ui.closeMicroMenu();
                    if (this.mgr && this.mgr.canOpen()) this.togglePanel();
                });
            }

            window.addEventListener('keydown', (e) => {
                const m = this.mgr;
                if (!m) return;
                const t = e.target;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                if (e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    if (m.canOpen()) this.togglePanel();
                } else if (e.code === 'KeyG' && m.placing && !e.repeat) {
                    m.alignGrid();
                } else if (e.code === 'KeyR' && m.placing && !e.repeat) {
                    m.rotateBy(e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
                } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && m.placing && !e.repeat) {
                    e.preventDefault();
                    m.commit();
                }
            });
            window.addEventListener('keyup', (e) => { if (e.code === 'KeyR' && this.mgr) this.mgr.keyRotate = 0; });
            window.addEventListener('blur', () => { if (this.mgr) this.mgr.keyRotate = 0; });
            window.addEventListener('pointermove', (e) => {
                const m = this.mgr;
                if (!m || (!m.placing && !m.demolishing && !m.moving) || e.pointerType === 'touch') return;
                const sel = window.AVELORA_UI_SELECTOR;
                if (sel && e.target && e.target.closest && e.target.closest(sel)) return;
                m.pointerTo(e.clientX, e.clientY);
            });

            this.buildDOMAccordion();
        },

        buildDOMAccordion() {
            const E = this.els;
            E.accordion.innerHTML = '';
            this.cardRefs = {};

            const byGroup = {};
            GROUPS.forEach(g => { byGroup[g.key] = []; });
            Object.keys(TYPES).forEach(id => {
                const def = TYPES[id];
                const gk = (def && def.group && byGroup[def.group]) ? def.group : 'blocks';
                byGroup[gk].push(def);
            });

            GROUPS.forEach(g => {
                const list = byGroup[g.key] || [];
                if (!list.length) return;

                const sec = document.createElement('div');
                sec.className = 'skill-group' + (this.openGroup === g.key ? ' open' : '');

                const head = document.createElement('button');
                head.type = 'button';
                head.className = 'skill-group-head';
                head.setAttribute('aria-expanded', this.openGroup === g.key ? 'true' : 'false');
                head.innerHTML = `<span class="skill-group-chev">▸</span><span class="skill-group-title">${g.title}</span><span class="skill-group-count">${list.length}</span>`;

                head.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = sec.classList.contains('open');
                    this.openGroup = isOpen ? null : g.key;
                    E.accordion.querySelectorAll('.skill-group').forEach(s => {
                        s.classList.remove('open');
                        s.querySelector('.skill-group-head').setAttribute('aria-expanded', 'false');
                    });
                    if (!isOpen) {
                        sec.classList.add('open');
                        head.setAttribute('aria-expanded', 'true');
                    }
                });

                const body = document.createElement('div');
                body.className = 'skill-group-body';

                list.forEach(def => {
                    const card = document.createElement('div');
                    card.className = 'build-card';
                    const isStationary = def.kind !== 'block';
                    card.innerHTML = `
                        <div class="build-card-icon"><svg viewBox="0 0 48 48" fill="none" stroke="#efcf7a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${def.icon || ''}</svg></div>
                        <div class="build-card-body">
                            <div class="build-card-name">${def.name}</div>
                            <div class="build-card-desc">${def.desc}</div>
                            <div class="build-cost" data-cost-for="${def.id}"></div>
                            <div class="build-card-foot">
                                <button type="button" class="build-go" data-btn-for="${def.id}">Разместить</button>
                                ${isStationary ? `<div class="build-placed-count" data-placed-for="${def.id}">Построено: 0</div>` : ''}
                            </div>
                        </div>`;

                    const btn = card.querySelector('.build-go');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const m = this.mgr;
                        if (!m) return;
                        if (!m.canBuildHere()) {
                            m.warn('Строить можно только в домашнем лагере');
                            return;
                        }
                        // Для модульного строительства меню элементов НЕ закрываем
                        if (def.kind !== 'block') {
                            this.closePanel();
                        }
                        m.startPlacing(def.id);
                    });

                    this.cardRefs[def.id] = {
                        card,
                        btn,
                        costEl: card.querySelector('.build-cost'),
                        def
                    };

                    body.appendChild(card);
                });

                sec.append(head, body);
                E.accordion.appendChild(sec);
            });
        },

        attach(mgr) {
            this.build();
            this.mgr = mgr;
            this.closePanel();
            this.showBar(false);
            if (this.els.btn) this.els.btn.style.display = '';
        },

        detach(mgr) {
            if (this.mgr !== mgr) return;
            this.mgr = null;
            this.closePanel();
            this.showBar(false);
        },

        togglePanel() { if (this.panelOpen) this.closePanel(); else this.openPanel(); },

        openPanel() {
            if (!this.mgr || !this.mgr.canOpen()) return;
            if (this.mgr.placing) this.mgr.cancelPlacing();
            if (this.mgr.moving) this.mgr.cancelMovingMode();
            if (this.mgr.demolishing) this.mgr.cancelDemolishing();
            this.panelOpen = true;
            this.els.panel.classList.add('open');
            this.els.panel.setAttribute('aria-hidden', 'false');
            if (this.els.btn) this.els.btn.classList.add('active');
            this.updateCosts();
        },

        closePanel() {
            this.panelOpen = false;
            if (!this.els.panel) return;
            this.els.panel.classList.remove('open');
            this.els.panel.setAttribute('aria-hidden', 'true');
            if (this.els.btn) this.els.btn.classList.remove('active');
        },

        showBar(on, mode) {
            if (!this.els.bar) return;
            this.els.bar.classList.toggle('open', !!on);
            if (on) {
                const isDemolish = mode === 'demolish';
                const isMove = mode === 'move';
                const isInteract = isDemolish || isMove;
                this.els.btnRot.style.display = isInteract ? 'none' : '';
                this.els.btnAlign.style.display = isInteract ? 'none' : '';
                this.els.btnOk.style.display = isInteract ? 'none' : '';
                this.els.btnConfirmDemolish.style.display = 'none';
                this.els.btnUnselectDemolish.style.display = 'none';
                this.els.btnConfirmMove.style.display = 'none';
                this.els.btnUnselectMove.style.display = 'none';
                this.els.btnCancel.textContent = isDemolish ? '✖ Выйти из сноса (Esc)' : (isMove ? '✖ Выйти из перемещения (Esc)' : '✖ Отмена (Esc)');
            }
        },

        setMoveSelection(inst, canMove, reason) {
            if (!this.els.bar) return;
            if (!inst) {
                this.els.btnConfirmMove.style.display = 'none';
                this.els.btnUnselectMove.style.display = 'none';
                this.els.barTitle.textContent = 'Режим перемещения';
                this.setStatus(false, 'Нажмите на постройку или блок для перемещения');
                return;
            }
            this.els.barTitle.textContent = `Перемещение: ${inst.def.name} №${inst.uid}`;
            if (!canMove) {
                this.setStatus(false, reason || 'Нельзя переместить');
                this.els.btnConfirmMove.style.display = 'none';
                this.els.btnUnselectMove.style.display = '';
            } else {
                this.setStatus(true, 'Нажмите Переместить, чтобы выбрать новое место');
                this.els.btnConfirmMove.style.display = '';
                this.els.btnConfirmMove.disabled = false;
                this.els.btnConfirmMove.textContent = `✔ Переместить ${inst.def.name}`;
                this.els.btnUnselectMove.style.display = '';
            }
        },

        setDemolishSelection(inst, returnCost, canDemolish, reason) {
            if (!this.els.bar) return;
            if (!inst) {
                this.els.btnConfirmDemolish.style.display = 'none';
                this.els.btnUnselectDemolish.style.display = 'none';
                this.els.barTitle.textContent = 'Режим сноса';
                this.setStatus(false, 'Нажмите на постройку или блок для выбора');
                return;
            }
            this.els.barTitle.textContent = `Снос: ${inst.def.name} №${inst.uid}`;
            if (!canDemolish) {
                this.setStatus(false, reason || 'Нельзя снести');
                this.els.btnConfirmDemolish.style.display = 'none';
                this.els.btnUnselectDemolish.style.display = '';
            } else {
                this.setStatus(true, `Вернёт: ${returnCost}`);
                this.els.btnConfirmDemolish.style.display = '';
                this.els.btnConfirmDemolish.disabled = false;
                this.els.btnConfirmDemolish.textContent = `✔ Снести ${inst.def.name}`;
                this.els.btnUnselectDemolish.style.display = '';
            }
        },

        setStatus(ok, text) {
            if (!this.els.barStatus) return;
            this.els.barStatus.textContent = text;
            this.els.barStatus.className = ok ? 'ok' : 'bad';
        },

        /** Обновляет только цифры ресурсов и доступность кнопок без пересоздания DOM */
        updateCosts() {
            const m = this.mgr;
            if (!m || !this.panelOpen) return;
            const st = m.game.gameState;
            const Items = window.AveloraItems;
            const canBuildLoc = m.canBuildHere();

            if (this.els.hintText) {
                this.els.hintText.textContent = canBuildLoc
                    ? 'Возводить постройки можно на территории лагеря. Выберите место: R — повернуть, G — по сетке (модуль 2 м), ЛКМ — построить, Esc — отмена.'
                    : 'Вне домашнего лагеря доступен просмотр каталога и цен. Возводить постройки и собирать дом можно только в домашнем лагере.';
            }

            if (this.els.moveBtn) {
                this.els.moveBtn.disabled = !canBuildLoc;
                this.els.moveBtn.title = canBuildLoc ? 'Перемещение построек и блоков прямо в мире' : 'Перемещение доступно только в домашнем лагере';
            }
            if (this.els.demolishBtn) {
                this.els.demolishBtn.disabled = !canBuildLoc;
                this.els.demolishBtn.title = canBuildLoc ? 'Снос построек и блоков прямо в мире' : 'Снос доступен только в домашнем лагере';
            }

            Object.keys(this.cardRefs).forEach(id => {
                const ref = this.cardRefs[id];
                const def = ref.def;
                let hasMaterials = true;

                const costHtml = def.cost.map(c => {
                    const it = Items ? Items.get(c.item) : null;
                    const have = st ? st.inventory.count(c.item) : 0;
                    const okc = FREE_BUILD || have >= c.count;
                    if (!okc) hasMaterials = false;
                    return `<span class="${okc ? 'ok' : 'bad'}">${it ? it.name : c.item} ${have}/${c.count}</span>`;
                }).join('');

                ref.costEl.innerHTML = FREE_BUILD ? '<span class="ok">Бесплатно (тест)</span>' : costHtml;

                const allowPlace = canBuildLoc && (FREE_BUILD || hasMaterials);
                ref.btn.disabled = !allowPlace;
                if (!canBuildLoc) ref.btn.title = 'Строительство разрешено только в домашнем лагере';
                else if (!hasMaterials) ref.btn.title = 'Не хватает материалов';
                else ref.btn.title = 'Разместить';

                if (def.kind !== 'block') {
                    const countEl = ref.card.querySelector(`[data-placed-for="${def.id}"]`);
                    if (countEl) {
                        const cnt = (m.instances || []).filter(inst => inst.type === def.id).length;
                        countEl.textContent = `Построено: ${cnt}`;
                        countEl.classList.toggle('has', cnt > 0);
                    }
                }
            });
        }
    };

    // ------------------------------------------------------------------
    // Менеджер построек одной локации
    // ------------------------------------------------------------------
    class AveloraBuilding {
        constructor(game, location) {
            this.game = game;
            this.location = location;
            this.cfg = (location && location.building) || null;
            this.terrain = game.terrain;
            this.pathfinder = game.pathfinder;
            this.root = game.locationRoot;
            this.instances = [];
            this.floorProxies = [];
            this.placing = null;
            this.demolishing = false;
            this.moving = false;
            this.hoveredInst = null;
            this.keyRotate = 0;
            this.disposed = false;
            this._ray = new THREE.Raycaster();
            this._ndc = new THREE.Vector2();
            this._uiT = 0;
            this._proxyMat = new THREE.MeshBasicMaterial({ visible: false });
            this.tex = null;
            this.demolishBox = null;
            this.moveBox = null;

            UI.attach(this);
            if (!this.cfg) return;

            this.tex = makeWoodTexture();
            this.mats = {
                solid: new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, roughness: 0.92, metalness: 0 }),
                wall: new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, roughness: 0.92, metalness: 0, transparent: true }),
                roof: new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, roughness: 0.92, metalness: 0, transparent: true }),
                stone: new THREE.MeshStandardMaterial({ map: makeStoneTexture(), vertexColors: true, roughness: 0.95, metalness: 0 }),
                glow: new THREE.MeshBasicMaterial({ vertexColors: true })
            };
            this.logTpl = null;
            prepareLogTemplate((tpl) => {
                if (this.disposed) { disposeLogTemplate(tpl); return; }
                this.logTpl = tpl;
                this.mats.logTpl = tpl;
                const st = game.gameState;
                if (st) st.buildingsOf(location.id).forEach(b => { try { this.spawn(b); } catch (err) { console.error('[Avelora] building spawn failed', b, err); } });
                (this.cfg.fixed || []).forEach((b, i) => { try { this.spawn({ uid: -(i + 1), type: b.type, x: b.x, z: b.z, r: b.r || 0, fixed: true }); } catch (err) { console.error('[Avelora] fixed building failed', b, err); } });
            });
        }

        canOpen() {
            const g = this.game;
            return !!(g && g.isReady && !g.isPaused && !g.isTransitioning && g.gameState && !(g.combat && g.combat.isDead));
        }

        canBuildHere() {
            return !!(this.cfg && this.cfg.area);
        }

        canUse() {
            return this.canBuildHere() && this.canOpen();
        }

        warn(text) { if (this.game.ui) this.game.ui.floatText(text, 'warn'); }

        toWorld(x, z, r, lx, lz) {
            const c = Math.cos(r), s = Math.sin(r);
            return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
        }

        fit(x, z, r, def) {
            const T = this.terrain;
            if (!T) return { mn: 0.85, mx: 0.85, rmn: 0.85, rmx: 0.85, deckY: 0.85, drop: 0.4, endY: 0.85, gEnd: 0.85 };

            if (def && def.kind === 'block') {
                const hx = (def.fp && def.fp.hx) || BLOCK_HMOD;
                const hz = (def.fp && def.fp.hz) || BLOCK_HMOD;
                let smn = Infinity, smx = -Infinity;
                const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]];
                corners.forEach(c => {
                    const w = this.toWorld(x, z, r, c[0], c[1]);
                    const h = T.getRawHeightAt(w.x, w.z);
                    if (h < smn) smn = h;
                    if (h > smx) smx = h;
                });
                const deckY = smx + 0.15;
                return { mn: smn, mx: smx, rmn: smn, rmx: smx, deckY, drop: deckY - smn + 0.25, endY: smn, gEnd: smn };
            }

            if (def && def.kind === 'station') {
                let smn = Infinity, smx = -Infinity;
                for (let i = 0; i <= 4; i++) {
                    for (let j = 0; j <= 4; j++) {
                        const fx = def.fp ? def.fp.hx : SX, fz = def.fp ? def.fp.hz : SZ;
                        const w = this.toWorld(x, z, r, -fx + i * fx / 2, -fz + j * fz / 2);
                        const h = T.getRawHeightAt(w.x, w.z);
                        if (h < smn) smn = h;
                        if (h > smx) smx = h;
                    }
                }
                return { mn: smn, mx: smx, rmn: smn, rmx: smx, deckY: smx - 0.04, drop: 0, endY: smx, gEnd: smx };
            }

            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i <= 4; i++) {
                for (let j = 0; j <= 4; j++) {
                    const w = this.toWorld(x, z, r, -HX + i * HX / 2, -HZ + j * HZ / 2);
                    const h = T.getRawHeightAt(w.x, w.z);
                    if (h < mn) mn = h;
                    if (h > mx) mx = h;
                }
            }
            let rmn = Infinity, rmx = -Infinity;
            for (let i = 0; i <= 2; i++) {
                for (let j = 1; j <= 3; j++) {
                    const w = this.toWorld(x, z, r, -RAMP_HX + i * RAMP_HX, HZ + RAMP_L * j / 3);
                    const h = T.getRawHeightAt(w.x, w.z);
                    if (h < rmn) rmn = h;
                    if (h > rmx) rmx = h;
                }
            }
            const e = this.toWorld(x, z, r, 0, HZ + RAMP_L);
            const gEnd = T.getRawHeightAt(e.x, e.z);
            const deckY = mx + 0.30;
            return { mn, mx, rmn: Math.min(rmn, mn), rmx: Math.max(rmx, mx), deckY, drop: deckY - mn + 0.15, endY: gEnd - 0.12, gEnd };
        }

        validate(def, x, z, r, forceY) {
            const fail = (reason) => ({ ok: false, reason });
            if (!this.canBuildHere()) return fail('Строительство разрешено только в домашнем лагере');

            const area = this.cfg && this.cfg.area;
            const F = def.fp || { hx: 1, hz: 1, front: 0 };
            const hx = F.hx, hz = F.hz, front = F.front || 0;
            const isBlock = def.kind === 'block';

            if (area) {
                const corners = [[-hx, -hz], [hx, -hz], [-hx, hz + front], [hx, hz + front]];
                for (const c of corners) {
                    const w = this.toWorld(x, z, r, c[0], c[1]);
                    if (Math.abs(w.x - area.x) > area.hx || Math.abs(w.z - area.z) > area.hz) return fail('Слишком далеко от лагеря — стройте ближе');
                }
            }
            const f = this.fit(x, z, r, def);
            if (forceY !== undefined) f.deckY = forceY;

            if (f.mn < 0.2) return fail('Здесь слишком сыро — берег или вода');

            if (def.kind === 'station') {
                if (f.mx - f.mn > 0.30) return fail('Слишком неровная земля — нужна ровная площадка');
            } else if (!isBlock) {
                if (f.rmx - f.rmn > 0.55) return fail('Слишком неровная земля');
                if ((f.deckY - f.gEnd) / RAMP_L > 0.42) return fail('Слишком крутой въезд на помост');
            } else {
                if (forceY === undefined && f.mx - f.mn > 1.3) return fail('Слишком крутой склон для блока');
            }

            const ch = this.game.character;
            if (ch) {
                const dx = ch.position.x - x, dz = ch.position.z - z;
                const c = Math.cos(r), s = Math.sin(r);
                const lx = dx * c - dz * s, lz = dx * s + dz * c;
                if (def.blockType === 'wall' && Math.abs(lx) <= hx + 0.3 && Math.abs(lz) <= hz + 0.3) {
                    return fail('Вы стоите в зоне стены — отойдите');
                }
            }

            for (const inst of this.instances) {
                const dx = x - inst.x, dz = z - inst.z;
                const dist = Math.hypot(dx, dz);
                if (dist < 0.25 && inst.type === def.id) return fail('Здесь уже установлена такая постройка');
                if (!isBlock && inst.def.kind !== 'block') {
                    const G = inst.fp, pc = inst.platform.cos, ps = inst.platform.sin;
                    const mg = 0.6;
                    for (let i = -hx; i <= hx + 1e-6; i += 0.5) {
                        for (let j = -hz; j <= hz + front + 1e-6; j += 0.5) {
                            const wx = x + i * Math.cos(r) + j * Math.sin(r), wz = z - i * Math.sin(r) + j * Math.cos(r);
                            const dxi = wx - inst.x, dzi = wz - inst.z;
                            const lxi = dxi * pc - dzi * ps, lzi = dxi * ps + dzi * pc;
                            if (Math.abs(lxi) <= G.hx + mg && lzi >= -G.hz - mg && lzi <= G.hz + (G.front || 0) + mg) {
                                return fail('Слишком близко к другой постройке');
                            }
                        }
                    }
                }
            }

            return { ok: true, reason: 'Можно строить', fit: f };
        }

        spawn(b) {
            const def = TYPES[b.type];
            if (!def) return null;
            if (def.kind === 'block') return this.spawnBlock(b, def);
            if (def.kind === 'station') return this.spawnStation(b, def);

            const f = this.fit(b.x, b.z, b.r, def);
            const rampDrop = Math.max(0.05, f.deckY - f.endY);
            const rnd = mulberry32(((b.uid * 2654435761) ^ Math.round(b.x * 100) ^ Math.round(b.z * 7919)) >>> 0);
            const model = buildStorage({ drop: f.drop, rampDrop }, this.mats, rnd);
            if (model.meshes.wall) model.meshes.wall.material = this.mats.wall.clone();
            if (model.meshes.roof) model.meshes.roof.material = this.mats.roof.clone();
            const g = model.group;
            g.position.set(b.x, f.deckY, b.z);
            g.rotation.y = b.r;
            this.root.add(g);

            const platform = {
                id: 'building:' + b.uid, x: b.x, z: b.z, cos: Math.cos(b.r), sin: Math.sin(b.r),
                hx: HX, hz: HZ, y: f.deckY, rampLen: RAMP_L, rampHx: RAMP_HX, endY: f.endY,
                reach2: Math.pow(Math.hypot(HX, HZ + RAMP_L) + 0.8, 2)
            };
            this.terrain.addPlatform(platform);

            const pm = this._proxyMat;
            const addBox = (parent, sx, sy, sz, px, py, pz, rx, ry, rz) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), pm);
                m.position.set(px, py, pz);
                m.rotation.set(rx || 0, ry || 0, rz || 0);
                parent.add(m);
                return m;
            };
            const low = new THREE.Group(); low.name = 'cam-low'; g.add(low);
            const shell = new THREE.Group(); shell.name = 'cam-shell'; g.add(shell);
            const deckBox = addBox(low, 2 * HX, 0.5, 2 * HZ, 0, -0.25, 0);
            const rampBox = addBox(low, 2 * RAMP_HX, 0.1, model.rampLen, 0, 0, 0);
            {
                const R = mat(0, 0, HZ - 0.02, model.rampAngle, 0, 0);
                const cpos = new THREE.Vector3(0, -0.05, model.rampLen / 2).applyMatrix4(R);
                rampBox.position.copy(cpos);
                rampBox.rotation.set(model.rampAngle, 0, 0);
            }
            [-1, 1].forEach(s => addBox(shell, 0.14, 1.28, 2 * HZ, s * (HX - 0.1), 0.64, 0));
            addBox(shell, 2 * HX, EAVE_Y, 0.14, 0, EAVE_Y / 2, -HZ + 0.1);
            addBox(shell, 2 * HX, RIDGE_Y, 0.1, 0, RIDGE_Y / 2, HZ);
            [-1, 1].forEach(s => addBox(shell, 0.1, EAVE_Y - 1.28, 2 * HZ, s * HX, (1.28 + EAVE_Y) / 2, 0));
            [-1, 1].forEach(s => {
                addBox(shell, model.slopeLen + 0.1, 0.14, model.roofW, s * EAVE_X / 2, (EAVE_Y + RIDGE_Y) / 2 + 0.07, 0, 0, 0, -s * model.th);
            });
            this.floorProxies.push(deckBox, rampBox);

            const chestW = this.toWorld(b.x, b.z, b.r, 0, CHEST_LZ);
            const hit = addBox(g, 4.4, 1.9, 1.2, 0, 0.95, -HZ + 0.6);
            const inst = {
                uid: b.uid, type: b.type, x: b.x, z: b.z, r: b.r, def, fit: f,
                group: g, model, platform, low, shell, hit, deckBox, rampBox,
                cells: [], shellOn: false, wallOp: 1, roofOp: 1, inside: false, rec: null, fp: def.fp
            };
            this.blockCells(inst);
            const ap = this.toWorld(b.x, b.z, b.r, 0, -0.7);
            const acc = this.pathfinder.findNearestWalkableWorld(ap.x, ap.z, 8) || this.toWorld(b.x, b.z, b.r, 0, HZ + 0.8);
            const cos = platform.cos, sin = platform.sin;
            const rec = {
                id: 'building:' + b.uid, prop: 'building', x: chestW.x, z: chestW.z, r: 0.8, h: 1.2, s: 1, rotY: b.r,
                blocks: false, object: g, proxy: hit,
                container: { slots: def.slots, title: 'Склад' },
                access: { x: acc.x, z: acc.z }, reach: 2.9,
                distanceTo: (pos) => {
                    const dx = pos.x - b.x, dz = pos.z - b.z;
                    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
                    if (Math.abs(lx) > HX || lz < -HZ + 1.1) return Infinity;
                    return Math.hypot(pos.x - chestW.x, pos.z - chestW.z);
                }
            };
            inst.rec = rec;
            hit.userData.containerId = rec.id;
            const wo = this.game.worldObjects;
            if (wo) wo.registerContainer(rec, hit);
            if (window.AveloraHitDebug) window.AveloraHitDebug.attach(hit, 'container');

            this.game.addCameraBlocker(low);
            this.instances.push(inst);
            this.updateShell(inst, 0, true);
            return inst;
        }

        spawnStation(b, def) {
            const f = this.fit(b.x, b.z, b.r, def);
            const rnd = mulberry32(((b.uid * 2654435761) ^ Math.round(b.x * 100) ^ Math.round(b.z * 7919)) >>> 0);
            const isForge = def.id === 'forge' && !def.mesh;
            const model = def.mesh
                ? buildModel(def, {}, Object.assign({}, this.mats, { attachMesh: (g, d) => this.attachMesh(g, d, null) }), rnd)
                : buildSawmill({ forge: isForge }, this.mats, rnd);
            if (model.meshes.roof) model.meshes.roof.material = this.mats.roof.clone();
            const g = model.group;
            g.position.set(b.x, f.deckY, b.z);
            g.rotation.y = b.r;
            this.root.add(g);

            const pm = this._proxyMat;
            const addBox = (parent, sx, sy, sz, px, py, pz, rx, ry, rz) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), pm);
                m.position.set(px, py, pz);
                m.rotation.set(rx || 0, ry || 0, rz || 0);
                parent.add(m);
                return m;
            };
            const low = new THREE.Group(); low.name = 'cam-low'; g.add(low);
            const shell = new THREE.Group(); shell.name = 'cam-shell'; g.add(shell);

            if (!def.mesh) {
                if (isForge) {
                    addBox(shell, 3.4, 2.0, 0.4, 0, 1.0, -1.3);
                    addBox(shell, 1.9, 0.95, 1.0, 0, 0.47, -0.78);
                    addBox(shell, 0.9, 0.85, 0.5, 0.1, 0.42, 0.2);
                    addBox(shell, 1.0, 0.45, 0.55, 1.32, 0.22, 0.46);
                    addBox(shell, 0.7, 0.9, 0.9, -1.35, 0.45, -0.73);
                    addBox(shell, 1.0, 0.9, 0.6, 1.4, 0.45, -1.0);
                } else {
                    addBox(shell, 3.8, 1.25, 0.8, 0, 0.62, 0);
                    addBox(shell, 1.5, 0.9, 1.0, -1.0, 0.45, -0.95);
                    addBox(shell, 1.3, 0.8, 0.45, 1.2, 0.4, -1.0);
                    addBox(shell, 0.6, 0.7, 0.6, -1.2, 0.35, 1.0);
                }
                const ang = -Math.atan2(0.6, 2 * (SZ - 0.17));
                addBox(shell, 2 * SX + 0.6, 0.16, (2 * SZ + 0.6) / Math.cos(ang), 0, 2.72, 0, ang, 0, 0);
            }

            const inst = {
                uid: b.uid, type: b.type, x: b.x, z: b.z, r: b.r, def, fit: f,
                group: g, model, platform: { id: 'building:' + b.uid, cos: Math.cos(b.r), sin: Math.sin(b.r) }, low, shell,
                hit: null, deckBox: null, rampBox: null,
                cells: [], shellOn: false, wallOp: 1, roofOp: 1, inside: false, rec: null, fp: def.fp
            };
            if (isForge) {
                const light = new THREE.PointLight(0xff8a3a, 1.6, 9, 2);
                light.position.set(0, 1.35, -0.2);
                g.add(light);
                inst.light = light;
            }
            this.blockCells(inst);
            this.game.addCameraBlocker(low);
            this.instances.push(inst);
            this.updateShell(inst, 0, true);
            return inst;
        }

        spawnBlock(b, def) {
            const f = this.fit(b.x, b.z, b.r, def);
            if (b.y !== undefined && Number.isFinite(b.y)) f.deckY = b.y;

            const rnd = mulberry32(((b.uid * 2654435761) ^ Math.round(b.x * 100) ^ Math.round(b.z * 7919)) >>> 0);
            const model = buildBlock(def, { drop: f.drop }, this.mats, rnd);
            if (model.meshes.wall) model.meshes.wall.material = this.mats.wall.clone();
            if (model.meshes.roof) model.meshes.roof.material = this.mats.roof.clone();

            const g = model.group;
            g.position.set(b.x, f.deckY, b.z);
            g.rotation.y = b.r;
            this.root.add(g);

            const pm = this._proxyMat;
            const addBox = (parent, sx, sy, sz, px, py, pz, rx, ry, rz) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), pm);
                m.position.set(px, py, pz);
                m.rotation.set(rx || 0, ry || 0, rz || 0);
                parent.add(m);
                return m;
            };

            const low = new THREE.Group(); low.name = 'cam-low'; g.add(low);
            const shell = new THREE.Group(); shell.name = 'cam-shell'; g.add(shell);
            let deckBox = null, rampBox = null;
            let platform = null;

            if (def.blockType === 'floor') {
                platform = {
                    id: 'building:' + b.uid, x: b.x, z: b.z, cos: Math.cos(b.r), sin: Math.sin(b.r),
                    hx: BLOCK_HMOD, hz: BLOCK_HMOD, y: f.deckY, rampLen: 0, rampHx: 0, endY: f.deckY,
                    reach2: 2.2 * 2.2
                };
                this.terrain.addPlatform(platform);
                deckBox = addBox(low, 2 * BLOCK_HMOD, 0.3, 2 * BLOCK_HMOD, 0, -0.15, 0);
                this.floorProxies.push(deckBox);
            } else if (def.blockType === 'stairs') {
                platform = {
                    id: 'building:' + b.uid, x: b.x, z: b.z, cos: Math.cos(b.r), sin: Math.sin(b.r),
                    hx: 0.6, hz: 0.8, y: f.deckY, rampLen: 1.6, rampHx: 0.6, endY: f.deckY - 0.5,
                    reach2: 2.5 * 2.5
                };
                this.terrain.addPlatform(platform);
                rampBox = addBox(low, 1.2, 0.4, 1.6, 0, -0.2, 0);
                this.floorProxies.push(rampBox);
            } else if (def.blockType === 'roof_flat') {
                platform = {
                    id: 'building:' + b.uid, x: b.x, z: b.z, cos: Math.cos(b.r), sin: Math.sin(b.r),
                    hx: BLOCK_HMOD, hz: BLOCK_HMOD, y: f.deckY, rampLen: 0, rampHx: 0, endY: f.deckY,
                    reach2: 2.2 * 2.2
                };
                this.terrain.addPlatform(platform);
                deckBox = addBox(low, 2 * BLOCK_HMOD, 0.2, 2 * BLOCK_HMOD, 0, -0.1, 0);
                this.floorProxies.push(deckBox);
                addBox(shell, 2 * BLOCK_HMOD, 0.18, 2 * BLOCK_HMOD, 0, -0.09, 0);
            } else if (def.blockType === 'wall' || def.blockType === 'window') {
                addBox(shell, 2 * BLOCK_HMOD, WALL_H, WALL_TH, 0, WALL_H / 2, 0);
            } else if (def.blockType === 'door') {
                addBox(shell, 0.5, WALL_H, WALL_TH, -0.75, WALL_H / 2, 0);
                addBox(shell, 0.5, WALL_H, WALL_TH, 0.75, WALL_H / 2, 0);
                addBox(shell, 1.0, 0.3, WALL_TH, 0, WALL_H - 0.15, 0);
            } else if (def.blockType === 'roof') {
                const ang = 0.3948, slopeLen = 2.60, eaveOverhang = 0.15, totalSlope = slopeLen + eaveOverhang;
                addBox(shell, 2 * BLOCK_HMOD, 0.14, totalSlope, 0, 0.50 - Math.sin(ang) * (eaveOverhang / 2), Math.cos(ang) * (eaveOverhang / 2), ang, 0, 0);
            } else if (def.blockType === 'roof_ridge') {
                addBox(shell, 2 * BLOCK_HMOD, 0.3, 2 * BLOCK_HMOD, 0, 0.45, 0);
            } else if (def.blockType === 'gable' || def.blockType === 'gable_rect') {
                addBox(shell, 2 * BLOCK_HMOD, 1.0, 0.16, 0, 0.5, 0);
            } else if (def.blockType === 'gable_peak') {
                addBox(shell, 2 * BLOCK_HMOD, 0.7, 0.16, 0, 0.35, 0);
            }

            const inst = {
                uid: b.uid, type: b.type, x: b.x, z: b.z, y: f.deckY, r: b.r, def, fit: f,
                group: g, model, platform: platform || { id: 'building:' + b.uid, cos: Math.cos(b.r), sin: Math.sin(b.r) },
                low, shell, deckBox, rampBox,
                cells: [], shellOn: false, wallOp: 1, roofOp: 1, inside: false, rec: null, fp: def.fp
            };

            this.blockCells(inst);
            this.game.addCameraBlocker(low);
            this.game.addCameraBlocker(shell);
            inst.shellOn = true;
            this.instances.push(inst);
            this.updateShell(inst, 0, true);
            return inst;
        }

        attachMesh(group, def, override) {
            const wo = this.game.worldObjects;
            const pdef = ((window.GAME_CONTENT || {}).props || {})[def.mesh];
            if (!wo || !pdef) return;
            const run = () => wo.loadTemplates('props', def.mesh, pdef).then(vars => {
                if (this.disposed || !vars || !vars.length) return;
                const obj = vars[0].clone();
                obj.position.set(0, -0.02, 0);
                if (override) obj.traverse(o => { if (o.isMesh) { o.material = override; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; } });
                group.add(obj);
                if (!override && this.game.addCameraBlocker) this.game.addCameraBlocker(obj);
            });
            if (window.AveloraAssets && pdef.modelKey) window.AveloraAssets.ensure(pdef.modelKey).then(run); else run();
        }

        stationNear(stationId, pos) {
            const p = pos || (this.game.character && this.game.character.position);
            if (!p) return null;
            let best = null, bd = Infinity;
            for (const inst of this.instances) {
                if (inst.def.station !== stationId) continue;
                const d = Math.hypot(p.x - inst.x, p.z - inst.z);
                if (d <= (inst.def.craftRadius || CRAFT_RADIUS) && d < bd) { bd = d; best = inst; }
            }
            return best;
        }

        blockCells(inst) {
            const pf = this.pathfinder;
            if (!pf || !inst.def.rects || !inst.def.rects.length) return;
            const c = inst.platform.cos, s = inst.platform.sin;
            const rects = inst.def.rects;
            const reach = Math.hypot(inst.fp.hx, inst.fp.hz) + 0.8;
            const g0 = pf.worldToGrid(inst.x - reach, inst.z - reach), g1 = pf.worldToGrid(inst.x + reach, inst.z + reach);
            const ext = 0.5 * pf.cellWidth * (Math.abs(c) + Math.abs(s));
            for (let gz = g0.z; gz <= g1.z; gz++) {
                for (let gx = g0.x; gx <= g1.x; gx++) {
                    const w = pf.gridToWorld(gx, gz);
                    const dx = w.x - inst.x, dz = w.z - inst.z;
                    const lx = dx * c - dz * s, lz = dx * s + dz * c;
                    let blocked = false;
                    for (let k = 0; k < rects.length && !blocked; k++) {
                        const R = rects[k];
                        if (lx + ext > R.x0 && lx - ext < R.x1 && lz + ext > R.z0 && lz - ext < R.z1) blocked = true;
                    }
                    if (!blocked) continue;
                    const idx = pf.getIndex(gx, gz);
                    if (pf.grid[idx] === 0) { pf.grid[idx] = 1; inst.cells.push(idx); }
                }
            }
        }

        unblockCells(inst) {
            const pf = this.pathfinder;
            if (!pf) return;
            inst.cells.forEach(i => { pf.grid[i] = 0; });
            inst.cells.length = 0;
        }

        updateShell(inst, delta, force) {
            const g = this.game;

            // Для модульных блоков дома (kind === 'block') камера работает как в данже:
            // стены и крыша всегда 100% твёрдые и непрозрачные, а камера блокируется ими и удерживается внутри
            if (inst.def.kind === 'block') {
                inst.inside = false;
                inst.wallOp = 1;
                inst.roofOp = 1;
                if (!inst.shellOn) {
                    inst.shellOn = true;
                    g.addCameraBlocker(inst.shell);
                }
                const m = inst.model.meshes;
                if (m.wall) {
                    m.wall.visible = true;
                    m.wall.material.opacity = 1;
                    m.wall.material.depthWrite = true;
                }
                if (m.roof) {
                    m.roof.visible = true;
                    m.roof.material.opacity = 1;
                    m.roof.material.depthWrite = true;
                }
                return;
            }

            const ch = g.character;
            const pl = inst.platform;
            let inside = inst.inside;
            if (ch && g.viewMode !== 'first') {
                const dx = ch.position.x - inst.x, dz = ch.position.z - inst.z;
                const lx = dx * pl.cos - dz * pl.sin, lz = dx * pl.sin + dz * pl.cos;
                const F = inst.fp, fhx = F.hx, fhz = F.hz;
                let heroIn = false;
                const stn = inst.def.kind === 'station';
                const zFront = stn ? fhz : fhz + 0.1, zFrontOut = stn ? fhz + 0.35 : fhz + 0.7;
                if (!inst.heroIn) heroIn = Math.abs(lx) < fhx - 0.05 && lz > -fhz && lz < zFront;
                else heroIn = !(Math.abs(lx) > fhx + 0.3 || lz < -fhz - 0.3 || lz > zFrontOut);
                inst.heroIn = heroIn;

                let camIn = false;
                let cp = g.camera && g.camera.position;
                if (cp) {
                    const cx = cp.x - inst.x, cz = cp.z - inst.z;
                    const clx = cx * pl.cos - cz * pl.sin, clz = cx * pl.sin + cz * pl.cos;
                    camIn = Math.abs(clx) < fhx + 1.0 && Math.abs(clz) < fhz + 1.0 && cp.y < (inst.fit.deckY + (F.ridgeY || 2.5) + 0.5);
                }
                inst.camIn = camIn;
                inside = heroIn || camIn;
            } else { inside = false; inst.heroIn = false; inst.camIn = false; }
            inst.inside = inside;

            const isBuilding = !!(this.placing || UI.panelOpen || this.demolishing || this.moving);
            const wT = inside ? WALL_FADE : 1;
            // Для склада и крафтовых навесов крыша становится полупрозрачной для удобства обзора сундука сверху
            const rT = isBuilding ? 1 : (inside ? 0.28 : 1);
            const k = force ? 1 : Math.min(1, (delta || 0) * 4);
            inst.wallOp += (wT - inst.wallOp) * k;
            inst.roofOp += (rT - inst.roofOp) * k;
            if (Math.abs(inst.wallOp - wT) < 0.01) inst.wallOp = wT;
            if (Math.abs(inst.roofOp - rT) < 0.01) inst.roofOp = rT;
            const m = inst.model.meshes;
            if (m.wall) {
                m.wall.visible = inst.wallOp > 0.02;
                m.wall.material.opacity = inst.wallOp;
                m.wall.material.depthWrite = inst.wallOp > 0.98;
            }
            if (m.roof) {
                m.roof.visible = true;
                m.roof.material.opacity = inst.roofOp;
                m.roof.material.depthWrite = inst.roofOp > 0.95;
            }

            const wantBlock = !inside;
            if (wantBlock !== inst.shellOn) {
                inst.shellOn = wantBlock;
                const arr = g.cameraBlockers || (g.cameraBlockers = []);
                const i = arr.indexOf(inst.shell);
                if (wantBlock && i < 0) g.addCameraBlocker(inst.shell);
                else if (!wantBlock && i >= 0) arr.splice(i, 1);
            }
        }

        // -------------------- Размещение и автопривязка --------------------
        startPlacing(typeId, moveRec) {
            if (!this.canOpen()) return;
            if (!this.canBuildHere()) {
                this.warn('Строить можно только в домашнем лагере');
                return;
            }
            const def = TYPES[typeId];
            if (!def) return;
            this.cancelPlacing();
            if (this.demolishing) this.cancelDemolishing();
            if (this.moving) this.cancelMovingMode();

            const ch = this.game.character;
            const a = this.game.cameraAngle || 0;
            const x0 = ch ? ch.position.x - Math.sin(a) * 5 : 0, z0 = ch ? ch.position.z - Math.cos(a) * 5 : 0;
            const gm = new THREE.MeshBasicMaterial({ color: 0x66e07a, transparent: true, opacity: 0.5, depthWrite: false });
            const rnd = mulberry32(99);
            const ghost = buildModel(def, { drop: 0.5, rampDrop: 0.3 }, { solid: gm, wall: gm, roof: gm, stone: gm, glow: gm, logTpl: this.logTpl, logMat: gm, attachMesh: (g, d) => this.attachMesh(g, d, gm) }, rnd);
            ghost.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; } });
            this.root.add(ghost.group);

            this.placing = {
                def, ghost, mat: gm, moveRec: moveRec || null,
                x: moveRec ? moveRec.x : Math.round(x0 * 2) / 2,
                z: moveRec ? moveRec.z : Math.round(z0 * 2) / 2,
                y: moveRec && moveRec.y !== undefined ? moveRec.y : undefined,
                r: moveRec ? moveRec.r : Math.round(a / (Math.PI / 2)) * (Math.PI / 2),
                _flipGable: false,
                ok: false, reason: '', dirty: true
            };
            UI.els.barTitle.textContent = `${moveRec ? 'Перемещение' : 'Размещение'}: ${def.name}`;
            UI.showBar(true, 'place');
            this.refreshGhost();
        }

        alignGrid() {
            const pl = this.placing;
            if (!pl) return;
            const step = pl.def.kind === 'block' ? (pl.def.blockType === 'floor' ? BLOCK_MOD : BLOCK_HMOD) : 1.0;
            pl.x = Math.round(pl.x / step) * step;
            pl.z = Math.round(pl.z / step) * step;

            const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            let best = dirs[0], minDiff = Infinity;
            dirs.forEach(d => {
                const diff = Math.abs(Math.atan2(Math.sin(pl.r - d), Math.cos(pl.r - d)));
                if (diff < minDiff) { minDiff = diff; best = d; }
            });
            const idx = dirs.indexOf(best);
            if (pl.def.blockType === 'gable') {
                pl._flipGable = !pl._flipGable;
                pl.r += Math.PI;
                pl.r = Math.atan2(Math.sin(pl.r), Math.cos(pl.r));
            } else {
                pl.r = dirs[(idx + 1) % 4];
            }
            pl.dirty = true;
            if (this.game.ui) this.game.ui.floatText('Выровнено по сетке', 'info');
        }

        cancelPlacing() {
            const pl = this.placing;
            if (!pl) return;
            this.placing = null;
            this.keyRotate = 0;
            this.root.remove(pl.ghost.group);
            pl.ghost.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            pl.mat.dispose();
            UI.showBar(false);
            if (pl.moveRec && !pl.committed && !this.disposed) {
                try { this.spawn(pl.moveRec); } catch (err) { console.error('[Avelora] building restore failed', err); }
            }
        }

        rotateBy(d) {
            if (this.placing) {
                const bType = this.placing.def.blockType;
                if (bType === 'gable') {
                    this.placing._flipGable = !this.placing._flipGable;
                    this.placing.r += Math.PI;
                } else {
                    this.placing.r += d;
                }
                this.placing.r = Math.atan2(Math.sin(this.placing.r), Math.cos(this.placing.r));
                this.placing.dirty = true;
                this.refreshGhost();
            }
        }

        groundAt(nx, ny, planeY) {
            const cam = this.game.camera;
            if (!cam || !this.terrain) return null;
            this._ndc.set(nx, ny);
            this._ray.setFromCamera(this._ndc, cam);
            const o = this._ray.ray.origin, d = this._ray.ray.direction;
            if (d.y > -0.02) return null;

            if (planeY !== undefined && Number.isFinite(planeY)) {
                const t = (planeY - o.y) / d.y;
                if (t > 0) {
                    return { x: o.x + d.x * t, z: o.z + d.z * t };
                }
            }

            let h = 0.85, x = 0, z = 0;
            for (let i = 0; i < 4; i++) {
                const t = (h - o.y) / d.y;
                x = o.x + d.x * t; z = o.z + d.z * t;
                h = this.terrain.getRawHeightAt(x, z);
            }
            return { x, z };
        }

        snapToNeighbors(pl, targetX, targetZ) {
            const isBlock = pl.def.kind === 'block';
            if (!isBlock) return { x: targetX, z: targetZ, y: undefined, r: pl.r };

            let bestDist = 2.8;
            let snappedX = targetX, snappedZ = targetZ;
            let snappedY = undefined;
            let snappedR = undefined;
            
            let found = false;

            const bType = pl.def.blockType;
            const isWallLike = (t) => t === 'wall' || t === 'door' || t === 'window' || t === 'gable' || t === 'gable_rect';
            const isFloorLike = (t) => t === 'floor' || t === 'roof_flat';

            const pickBestRot = (baseR, rOffsets) => {
                let bestR = baseR + rOffsets[0], minDiff = Infinity;
                for (const ro of rOffsets) {
                    const candidate = baseR + ro;
                    const diff = Math.abs(Math.atan2(Math.sin(candidate - pl.r), Math.cos(candidate - pl.r)));
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestR = candidate;
                    }
                }
                return bestR;
            };

            for (const inst of this.instances) {
                if (inst.def.kind !== 'block') continue;
                const dx = targetX - inst.x, dz = targetZ - inst.z;
                const d = Math.hypot(dx, dz);
                if (d > 4.6) continue;

                const c = Math.cos(inst.r), s = Math.sin(inst.r);
                const lx = dx * c - dz * s, lz = dx * s + dz * c;
                const instY = inst.fit ? inst.fit.deckY : (inst.y || 0);

                // --- 1. РАЗМЕЩАЕМ ПОЛ (floor) ---
                if (bType === 'floor') {
                    if (inst.def.blockType === 'floor') {
                        const snapOffsets = [
                            [BLOCK_MOD, 0], [-BLOCK_MOD, 0], [0, BLOCK_MOD], [0, -BLOCK_MOD]
                        ];
                        for (const [ox, oz] of snapOffsets) {
                            const dOff = Math.hypot(lx - ox, lz - oz);
                            if (dOff < 1.4 && dOff < bestDist) {
                                bestDist = dOff;
                                snappedX = Math.round((inst.x + ox * c + oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - ox * s + oz * c) * 100) / 100;
                                snappedY = instY;
                                
                                found = true;
                            }
                        }
                    } else if (isWallLike(inst.def.blockType)) {
                        const floorOffsets = [[0, BLOCK_HMOD], [0, -BLOCK_HMOD]];
                        for (const [ox, oz] of floorOffsets) {
                            const dOff = Math.hypot(lx - ox, lz - oz);
                            if (dOff < 1.3 && dOff < bestDist) {
                                bestDist = dOff;
                                snappedX = Math.round((inst.x + ox * c + oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - ox * s + oz * c) * 100) / 100;
                                snappedY = instY;
                                
                                found = true;
                            }
                        }
                    }
                }

                // --- 2. РАЗМЕЩАЕМ СТЕНЫ И ФРОНТОНЫ ---
                else if (isWallLike(bType)) {
                    const isGable = bType === 'gable' || bType === 'gable_rect' || bType === 'gable_peak';
                    if (isGable) {
                        // Фронтоны садятся строго на верхушку стены 1 этажа или на прямоугольный фронтон
                        if (inst.def.blockType === 'wall' || inst.def.blockType === 'door' || inst.def.blockType === 'window') {
                            if (d < 1.8 && d < bestDist) {
                                bestDist = d;
                                snappedX = inst.x;
                                snappedZ = inst.z;
                                snappedY = instY + WALL_H;
                                if (bType === 'gable') {
                                    // Ищем скат крыши рядом для автоматического согласования стороны уклона
                                    let roofInst = null, minRoofD = Infinity;
                                    for (const o of this.instances) {
                                        if (o.def.blockType === 'roof') {
                                            const dr = Math.hypot(inst.x - o.x, inst.z - o.z);
                                            if (dr < 2.0 && dr < minRoofD) { minRoofD = dr; roofInst = o; }
                                        }
                                    }
                                    if (roofInst) {
                                        let bestR = (Math.sin(roofInst.r - inst.r) > 0) ? inst.r : (inst.r + Math.PI);
                                        if (pl._flipGable) bestR += Math.PI;
                                        snappedR = Math.atan2(Math.sin(bestR), Math.cos(bestR));
                                    } else {
                                        let bestR = pickBestRot(inst.r, [0, Math.PI]);
                                        if (pl._flipGable) bestR += Math.PI;
                                        snappedR = Math.atan2(Math.sin(bestR), Math.cos(bestR));
                                    }
                                } else {
                                    snappedR = pickBestRot(inst.r, [0, Math.PI]);
                                }
                                found = true;
                            }
                        } else if (inst.def.blockType === 'gable_rect') {
                            if (d < 1.8 && d < bestDist) {
                                bestDist = d;
                                snappedX = inst.x;
                                snappedZ = inst.z;
                                snappedY = instY + 1.0;
                                snappedR = pickBestRot(inst.r, [0, Math.PI]);
                                found = true;
                            }
                        } else if (inst.def.blockType === 'roof') {
                            // Курсор наведен на крышу — ищем стену под ней
                            let wallUnder = null, minWallD = Infinity;
                            for (const o of this.instances) {
                                if (o.def.blockType === 'wall' || o.def.blockType === 'door' || o.def.blockType === 'window' || o.def.blockType === 'gable_rect') {
                                    const dw = Math.hypot(inst.x - o.x, inst.z - o.z);
                                    if (dw < 1.8 && dw < minWallD) { minWallD = dw; wallUnder = o; }
                                }
                            }
                            if (wallUnder && d < 1.8 && d < bestDist) {
                                bestDist = d;
                                snappedX = wallUnder.x;
                                snappedZ = wallUnder.z;
                                const wY = wallUnder.fit ? wallUnder.fit.deckY : (wallUnder.y || 0);
                                snappedY = wY + (wallUnder.def.blockType === 'gable_rect' ? 1.0 : WALL_H);
                                if (bType === 'gable') {
                                    let bestR = (Math.sin(inst.r - wallUnder.r) > 0) ? wallUnder.r : (wallUnder.r + Math.PI);
                                    if (pl._flipGable) bestR += Math.PI;
                                    snappedR = Math.atan2(Math.sin(bestR), Math.cos(bestR));
                                } else {
                                    snappedR = pickBestRot(wallUnder.r, [0, Math.PI]);
                                }
                                found = true;
                            }
                        } else if (inst.def.blockType === 'gable' || inst.def.blockType === 'gable_peak') {
                            const sideSockets = [
                                { ox: BLOCK_MOD, oz: 0 },
                                { ox: -BLOCK_MOD, oz: 0 }
                            ];
                            for (const sock of sideSockets) {
                                const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                                if (dSock < 1.5 && dSock < bestDist) {
                                    bestDist = dSock;
                                    snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                    snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                    snappedY = instY;
                                    snappedR = pickBestRot(inst.r, [0, Math.PI]);
                                    found = true;
                                }
                            }
                        }
                    } else if (isFloorLike(inst.def.blockType)) {
                        const wallEdges = [
                            { ox: 0, oz: BLOCK_HMOD },
                            { ox: 0, oz: -BLOCK_HMOD },
                            { ox: BLOCK_HMOD, oz: 0 },
                            { ox: -BLOCK_HMOD, oz: 0 }
                        ];
                        for (const edge of wallEdges) {
                            const dEdge = Math.hypot(lx - edge.ox, lz - edge.oz);
                            if (dEdge < 1.4 && dEdge < bestDist) {
                                bestDist = dEdge;
                                snappedX = Math.round((inst.x + edge.ox * c + edge.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - edge.ox * s + edge.oz * c) * 100) / 100;
                                snappedY = instY;
                                if (edge.rOff !== undefined) snappedR = inst.r + edge.rOff;
                                found = true;
                            }
                        }
                    } else if (isWallLike(inst.def.blockType)) {
                        const wallSockets = [
                            { ox: BLOCK_MOD, oz: 0 },
                            { ox: -BLOCK_MOD, oz: 0 },
                            { ox: BLOCK_HMOD, oz: BLOCK_HMOD },
                            { ox: BLOCK_HMOD, oz: -BLOCK_HMOD },
                            { ox: -BLOCK_HMOD, oz: BLOCK_HMOD },
                            { ox: -BLOCK_HMOD, oz: -BLOCK_HMOD }
                        ];
                        for (const sock of wallSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.4 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY;
                                if (sock.rOff !== undefined) snappedR = inst.r + sock.rOff;
                                found = true;
                            }
                        }
                    }
                }

                // --- 3. РАЗМЕЩАЕМ ПЛОСКУЮ КРЫШУ / ПЕРЕКРЫТИЕ (roof_flat) ---
                else if (bType === 'roof_flat') {
                    if (inst.def.blockType === 'roof') {
                        const flatRoofSockets = [
                            { ox: 0, oz: -BLOCK_MOD, yOff: 1.0, rOff: 0 }
                        ];
                        for (const sock of flatRoofSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.8 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY + sock.yOff;
                                
                                found = true;
                            }
                        }
                    } else if (inst.def.blockType === 'gable_rect') {
                        const flatSockets = [[0, BLOCK_HMOD], [0, -BLOCK_HMOD]];
                        for (const [ox, oz] of flatSockets) {
                            const dOff = Math.hypot(lx - ox, lz - oz);
                            if (dOff < 1.4 && dOff < bestDist) {
                                bestDist = dOff;
                                snappedX = Math.round((inst.x + ox * c + oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - ox * s + oz * c) * 100) / 100;
                                snappedY = instY + 1.0;
                                
                                found = true;
                            }
                        }
                    } else if (inst.def.blockType === 'floor') {
                        if (d < 1.8 && d < bestDist) {
                            bestDist = d;
                            snappedX = inst.x;
                            snappedZ = inst.z;
                            snappedY = instY + WALL_H;
                            
                            found = true;
                        }
                    } else if (isWallLike(inst.def.blockType)) {
                        const flatSockets = [[0, BLOCK_HMOD], [0, -BLOCK_HMOD]];
                        for (const [ox, oz] of flatSockets) {
                            const dOff = Math.hypot(lx - ox, lz - oz);
                            if (dOff < 1.4 && dOff < bestDist) {
                                bestDist = dOff;
                                snappedX = Math.round((inst.x + ox * c + oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - ox * s + oz * c) * 100) / 100;
                                snappedY = instY + WALL_H;
                                
                                found = true;
                            }
                        }
                    } else if (inst.def.blockType === 'roof_flat') {
                        const snapOffsets = [
                            [BLOCK_MOD, 0], [-BLOCK_MOD, 0], [0, BLOCK_MOD], [0, -BLOCK_MOD]
                        ];
                        for (const [ox, oz] of snapOffsets) {
                            const dOff = Math.hypot(lx - ox, lz - oz);
                            if (dOff < 1.4 && dOff < bestDist) {
                                bestDist = dOff;
                                snappedX = Math.round((inst.x + ox * c + oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - ox * s + oz * c) * 100) / 100;
                                snappedY = instY;
                                
                                found = true;
                            }
                        }
                    }
                }

                // --- 4. РАЗМЕЩАЕМ СКАТ КРЫШИ (roof) ---
                else if (bType === 'roof') {
                    if (isFloorLike(inst.def.blockType)) {
                        const targetY = inst.def.blockType === 'floor' ? (instY + WALL_H) : instY;
                        if (d < 1.8 && d < bestDist) {
                            bestDist = d;
                            snappedX = inst.x;
                            snappedZ = inst.z;
                            snappedY = targetY;
                            
                            found = true;
                        }
                    } else if (isWallLike(inst.def.blockType)) {
                        const roofWallSockets = [
                            { ox: 0, oz: BLOCK_HMOD, rOffs: [0, Math.PI] },
                            { ox: 0, oz: -BLOCK_HMOD, rOffs: [0, Math.PI] }
                        ];
                        for (const sock of roofWallSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.5 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY + WALL_H;
                                if (sock.rOffs) snappedR = pickBestRot(inst.r, sock.rOffs);
                                found = true;
                            }
                        }
                    } else if (inst.def.blockType === 'roof') {
                        const roofSockets = [
                            { ox: BLOCK_MOD, oz: 0, yOff: 0, rOffs: [0] },
                            { ox: -BLOCK_MOD, oz: 0, yOff: 0, rOffs: [0] },
                            { ox: 0, oz: -BLOCK_MOD, yOff: 0, rOffs: [Math.PI] },
                            { ox: 0, oz: -BLOCK_MOD, yOff: 1.0, rOffs: [0] },
                            { ox: 0, oz: BLOCK_MOD, yOff: -1.0, rOffs: [0] }
                        ];
                        for (const sock of roofSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.6 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY + (sock.yOff || 0);
                                if (sock.rOffs) snappedR = pickBestRot(inst.r, sock.rOffs);
                                found = true;
                            }
                        }
                    }
                }

                // --- 5. РАЗМЕЩАЕМ ЦЕНТРАЛЬНЫЙ КОНЁК (roof_ridge) ---
                else if (bType === 'roof_ridge') {
                    // К верхнему краю ската: плотная посадка внахлёст поверх скатов (yOff: 0.90)
                    if (inst.def.blockType === 'roof') {
                        const ridgeSockets = [
                            { ox: 0, oz: -BLOCK_MOD, yOff: 0.90, rOffs: [0, Math.PI] }
                        ];
                        for (const sock of ridgeSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.8 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY + sock.yOff;
                                if (sock.rOffs) snappedR = pickBestRot(inst.r, sock.rOffs);
                                found = true;
                            }
                        }
                    } else if (inst.def.blockType === 'gable_rect') {
                        const ridgeSockets = [
                            { ox: 0, oz: BLOCK_HMOD, rOffs: [0, Math.PI / 2] },
                            { ox: 0, oz: -BLOCK_HMOD, rOffs: [0, Math.PI / 2] }
                        ];
                        for (const sock of ridgeSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.5 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY + 1.0;
                                
                                found = true;
                            }
                        }
                    } else if (isFloorLike(inst.def.blockType)) {
                        const targetY = inst.def.blockType === 'floor' ? (instY + WALL_H) : instY;
                        if (d < 1.8 && d < bestDist) {
                            bestDist = d;
                            snappedX = inst.x;
                            snappedZ = inst.z;
                            snappedY = targetY;
                            
                            found = true;
                        }
                    } else if (inst.def.blockType === 'roof_ridge') {
                        const ridgeSockets = [
                            { ox: BLOCK_MOD, oz: 0, rOffs: [0] },
                            { ox: -BLOCK_MOD, oz: 0, rOffs: [0] }
                        ];
                        for (const sock of ridgeSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.5 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY;
                                
                                found = true;
                            }
                        }
                    }
                }

                // --- 6. РАЗМЕЩАЕМ ФРОНТОН-ПИК (gable_peak) ---
                else if (bType === 'gable_peak') {
                    if (inst.def.blockType === 'gable_rect') {
                        if (d < 1.2 && d < bestDist) {
                            bestDist = d;
                            snappedX = inst.x;
                            snappedZ = inst.z;
                            snappedY = instY + 1.0;
                            
                            found = true;
                        }
                    } else if (isWallLike(inst.def.blockType)) {
                        if (d < 1.2 && d < bestDist) {
                            bestDist = d;
                            snappedX = inst.x;
                            snappedZ = inst.z;
                            snappedY = instY + WALL_H;
                            
                            found = true;
                        }
                    } else if (inst.def.blockType === 'roof_ridge') {
                        const peakSockets = [
                            { ox: BLOCK_HMOD, oz: 0, rOffs: [Math.PI / 2] },
                            { ox: -BLOCK_HMOD, oz: 0, rOffs: [-Math.PI / 2] }
                        ];
                        for (const sock of peakSockets) {
                            const dSock = Math.hypot(lx - sock.ox, lz - sock.oz);
                            if (dSock < 1.4 && dSock < bestDist) {
                                bestDist = dSock;
                                snappedX = Math.round((inst.x + sock.ox * c + sock.oz * s) * 100) / 100;
                                snappedZ = Math.round((inst.z - sock.ox * s + sock.oz * c) * 100) / 100;
                                snappedY = instY;
                                
                                found = true;
                            }
                        }
                    }
                }

                // --- 7. РАЗМЕЩАЕМ ЛЕСТНИЦУ (stairs) ---
                else if (bType === 'stairs' && isFloorLike(inst.def.blockType)) {
                    const stairEdges = [
                        { ox: 0, oz: BLOCK_HMOD + 0.8, rOff: 0 },
                        { ox: 0, oz: -BLOCK_HMOD - 0.8, rOff: Math.PI },
                        { ox: BLOCK_HMOD + 0.8, oz: 0, rOff: -Math.PI / 2 },
                        { ox: -BLOCK_HMOD - 0.8, oz: 0, rOff: Math.PI / 2 }
                    ];
                    for (const edge of stairEdges) {
                        const dEdge = Math.hypot(lx - edge.ox, lz - edge.oz);
                        if (dEdge < 1.2 && dEdge < bestDist) {
                            bestDist = dEdge;
                            snappedX = Math.round((inst.x + edge.ox * c + edge.oz * s) * 100) / 100;
                            snappedZ = Math.round((inst.z - edge.ox * s + edge.oz * c) * 100) / 100;
                            snappedY = instY;
                            
                            found = true;
                        }
                    }
                }
            }

            return found
                ? { x: snappedX, z: snappedZ, y: snappedY, r: (snappedR !== undefined ? snappedR : pl.r) }
                : { x: targetX, z: targetZ, y: undefined, r: pl.r };
        }

        pointerTo(cx, cy) {
            const cam = this.game.camera;
            if (!cam) return;
            const ndcX = (cx / window.innerWidth) * 2 - 1;
            const ndcY = -(cy / window.innerHeight) * 2 + 1;
            this._ndc.set(ndcX, ndcY);

            // Обработка наведения в режиме сноса и перемещения
            if (this.demolishing) {
                this.updateDemolishHover();
                return;
            }
            if (this.moving) {
                this.updateMoveHover();
                return;
            }

            // Обработка размещения
            const pl = this.placing;
            if (!pl) return;

            // Если размещаем кровельные блоки или фронтоны, поднимаем плоскость прицеливания луча
            const bType = pl.def.blockType;
            let targetPlaneY = undefined;
            if (bType === 'roof' || bType === 'roof_flat' || bType === 'roof_ridge' || bType === 'gable' || bType === 'gable_rect' || bType === 'gable_peak') {
                let sumY = 0, countY = 0;
                for (const inst of this.instances) {
                    if (inst.def.kind === 'block') {
                        sumY += (inst.y || 0);
                        countY++;
                    }
                }
                const baseY = countY > 0 ? (sumY / countY) : 0;
                targetPlaneY = baseY + WALL_H;
            }

            const p = this.groundAt(ndcX, ndcY, targetPlaneY);
            if (!p) return;

            const rawX = Math.round(p.x * 4) / 4, rawZ = Math.round(p.z * 4) / 4;
            const snapped = this.snapToNeighbors(pl, rawX, rawZ);

            let changed = false;
            if (snapped.x !== pl.x || snapped.z !== pl.z) {
                pl.x = snapped.x;
                pl.z = snapped.z;
                changed = true;
            }
            if (snapped.y !== undefined && snapped.y !== pl.y) {
                pl.y = snapped.y;
                changed = true;
            }
            if (snapped.r !== undefined) {
                const diff = Math.abs(Math.atan2(Math.sin(snapped.r - pl.r), Math.cos(snapped.r - pl.r)));
                if (diff > 0.01) {
                    pl.r = snapped.r;
                    changed = true;
                }
            }
            if (changed) pl.dirty = true;
        }

        handleWorldClick(e) {
            if (this.moving) {
                if (e.clientX !== undefined) this.pointerTo(e.clientX, e.clientY);
                const hit = this.findInstanceUnderCursor();
                if (hit) {
                    this.selectForMove(hit);
                } else if (!this.selectedInst) {
                    this.unselectMove();
                }
                return true;
            }
            if (this.demolishing) {
                if (e.clientX !== undefined) this.pointerTo(e.clientX, e.clientY);
                const hit = this.findInstanceUnderCursor();
                if (hit) {
                    this.selectForDemolish(hit);
                } else if (!this.selectedInst) {
                    this.unselectDemolish();
                }
                return true;
            }

            if (!this.placing) return false;
            if (e.aimCenter) this.pointerTo(window.innerWidth / 2, window.innerHeight / 2);
            else if (e.clientX !== undefined) this.pointerTo(e.clientX, e.clientY);
            const mouse = e.pointerType === 'mouse' || e.pointerType === 'pen';
            this.refreshGhost();
            if (mouse) this.commit();
            return true;
        }

        refreshGhost() {
            const pl = this.placing;
            if (!pl) return;
            pl.dirty = false;
            const v = this.validate(pl.def, pl.x, pl.z, pl.r, pl.y);
            const f = v.fit || this.fit(pl.x, pl.z, pl.r, pl.def);
            if (pl.y !== undefined) f.deckY = pl.y;

            pl.ok = v.ok; pl.reason = v.reason;
            const g = pl.ghost.group;
            g.position.set(pl.x, f.deckY, pl.z);
            g.rotation.y = pl.r;
            pl.mat.color.setHex(v.ok ? 0x66e07a : 0xe0605a);

            let costOk = true;
            if (v.ok && !FREE_BUILD && !pl.moveRec) {
                const st = this.game.gameState;
                for (const c of pl.def.cost) if (!st || st.inventory.count(c.item) < c.count) costOk = false;
            }
            UI.setStatus(v.ok && costOk, v.ok ? (costOk ? 'Можно строить' : 'Не хватает материалов') : v.reason);
        }

        commit() {
            const pl = this.placing;
            if (!pl) return;
            const st = this.game.gameState;
            if (!st) return;
            this.refreshGhost();
            if (!pl.ok) { this.warn(pl.reason); return; }

            const placedDef = pl.def;

            if (pl.moveRec) {
                const rec = pl.moveRec;
                rec.x = Math.round(pl.x * 100) / 100;
                rec.z = Math.round(pl.z * 100) / 100;
                if (pl.y !== undefined) rec.y = Math.round(pl.y * 100) / 100;
                rec.r = Math.round(pl.r * 1000) / 1000;
                st.save();
                pl.committed = true;
                this.cancelPlacing();
                this.spawn(rec);
                if (this.game.ui) this.game.ui.floatText(`Перемещено: ${placedDef.name}`, 'gain');
                return;
            }

            if (!FREE_BUILD) {
                for (const c of placedDef.cost) {
                    if (st.inventory.count(c.item) < c.count) { this.warn('Не хватает материалов'); return; }
                }
                placedDef.cost.forEach(c => st.inventory.remove(c.item, c.count));
            }

            const b = st.addBuilding(this.location.id, placedDef.id, pl.x, pl.z, pl.r, pl.y);
            this.spawn(b);
            window.dispatchEvent(new CustomEvent('game:questUpdated'));
            if (this.game.ui && this.game.ui.updateQuestsProgress) this.game.ui.updateQuestsProgress();
            if (this.game.ui && this.game.ui.dialog && this.game.ui.dialog.updateTracker) this.game.ui.dialog.updateTracker();
            if (this.game.hero && this.game.hero.addXp) {
                this.game.hero.addXp(25);
            }

            this.cancelPlacing();
            if (this.game.ui) {
                this.game.ui.floatText(`Построено: ${placedDef.name}`, 'gain');
                if (this.game.ui.pulseInventory) this.game.ui.pulseInventory();
            }
            UI.openPanel();
        }

        // -------------------- ИНТЕРАКТИВНЫЙ РЕЖИМ ПЕРЕМЕЩЕНИЯ --------------------
        startMovingMode() {
            if (!this.canOpen()) return;
            if (!this.canBuildHere()) {
                this.warn('Перемещение разрешено только в домашнем лагере');
                return;
            }
            this.cancelPlacing();
            if (this.demolishing) this.cancelDemolishing();
            UI.closePanel();
            this.moving = true;
            this.selectedInst = null;
            this.hoveredInst = null;
            document.body.classList.add('build-move-mode');

            if (!this.moveBox) {
                const geo = new THREE.BoxGeometry(1, 1, 1);
                const mat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.38, depthWrite: false });
                const mesh = new THREE.Mesh(geo, mat);
                const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x93c5fd, linewidth: 2 }));
                mesh.add(edges);
                mesh.renderOrder = 6;
                this.moveBox = mesh;
            }
            this.moveBox.visible = false;
            this.root.add(this.moveBox);

            UI.showBar(true, 'move');
            UI.setMoveSelection(null);
        }

        cancelMovingMode(keepPlacing) {
            if (!this.moving) return;
            this.moving = false;
            this.selectedInst = null;
            this.hoveredInst = null;
            document.body.classList.remove('build-move-mode', 'has-hover');
            if (this.moveBox) {
                this.moveBox.visible = false;
                if (this.moveBox.parent) this.moveBox.parent.remove(this.moveBox);
            }
            if (!keepPlacing) UI.showBar(false);
        }

        unselectMove() {
            this.selectedInst = null;
            if (this.moveBox) this.moveBox.visible = false;
            UI.setMoveSelection(null);
            this.updateMoveHover();
        }

        selectForMove(inst) {
            if (!inst) return;
            this.selectedInst = inst;
            this.hoveredInst = inst;

            const box = this.moveBox;
            if (box) {
                const F = inst.fp || { hx: 1, hz: 1, ridgeY: 2.0 };
                const sx = F.hx * 2 + 0.1, sz = (F.hz + (F.front || 0)) * 2 + 0.1;
                const sy = Math.max(0.6, F.ridgeY || 2.4);
                box.scale.set(sx, sy, sz);
                box.position.set(inst.x, inst.fit ? inst.fit.deckY + sy / 2 : (inst.y || 0) + sy / 2, inst.z);
                box.rotation.y = inst.r || 0;
                box.visible = true;
            }

            const st = this.game.gameState;
            const rec = st ? st.buildingsOf(this.location.id).find(b => b.uid === inst.uid) : null;
            const canMove = !!rec && !inst.fixed;
            const reason = canMove ? '' : 'Это фиксированное строение нельзя переместить';

            UI.setMoveSelection(inst, canMove, reason);
        }

        confirmMove() {
            if (!this.selectedInst) return;
            const inst = this.selectedInst;
            const st = this.game.gameState;
            const rec = st ? st.buildingsOf(this.location.id).find(b => b.uid === inst.uid) : null;
            if (!rec || inst.fixed) {
                this.warn('Это строение нельзя переместить');
                return;
            }

            const typeId = inst.def.id;
            this.removeInstance(inst);
            this.cancelMovingMode(true);
            this.startPlacing(typeId, rec);
            if (this.game.ui) this.game.ui.floatText('Перемещение: выберите новое место', 'info');
        }

        updateMoveHover() {
            if (!this.moving) return;
            const hitInst = this.findInstanceUnderCursor();
            document.body.classList.toggle('has-hover', !!hitInst);

            if (this.selectedInst) return;

            this.hoveredInst = hitInst;
            if (hitInst) {
                const box = this.moveBox;
                if (box) {
                    const F = hitInst.fp || { hx: 1, hz: 1, ridgeY: 2.0 };
                    const sx = F.hx * 2 + 0.1, sz = (F.hz + (F.front || 0)) * 2 + 0.1;
                    const sy = Math.max(0.6, F.ridgeY || 2.4);
                    box.scale.set(sx, sy, sz);
                    box.position.set(hitInst.x, hitInst.fit ? hitInst.fit.deckY + sy / 2 : (hitInst.y || 0) + sy / 2, hitInst.z);
                    box.rotation.y = hitInst.r || 0;
                    box.visible = true;
                }
                UI.els.barTitle.textContent = `Выбор: ${hitInst.def.name} №${hitInst.uid}`;
                UI.setStatus(true, 'Нажмите для выбора перемещения');
            } else {
                if (this.moveBox) this.moveBox.visible = false;
                UI.els.barTitle.textContent = 'Режим перемещения';
                UI.setStatus(false, 'Нажмите на постройку или блок для перемещения');
            }
        }

        // -------------------- ИНТЕРАКТИВНЫЙ РЕЖИМ СНОСА --------------------
        startDemolishing() {
            if (!this.canOpen()) return;
            if (!this.canBuildHere()) {
                this.warn('Снос разрешен только в домашнем лагере');
                return;
            }
            this.cancelPlacing();
            if (this.moving) this.cancelMovingMode();
            UI.closePanel();
            this.demolishing = true;
            this.selectedInst = null;
            this.hoveredInst = null;
            document.body.classList.add('build-demolish-mode');

            if (!this.demolishBox) {
                const geo = new THREE.BoxGeometry(1, 1, 1);
                const mat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.38, depthWrite: false });
                const mesh = new THREE.Mesh(geo, mat);
                const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xff7777, linewidth: 2 }));
                mesh.add(edges);
                mesh.renderOrder = 6;
                this.demolishBox = mesh;
            }
            this.demolishBox.visible = false;
            this.root.add(this.demolishBox);

            UI.showBar(true, 'demolish');
            UI.setDemolishSelection(null);
        }

        cancelDemolishing() {
            if (!this.demolishing) return;
            this.demolishing = false;
            this.selectedInst = null;
            this.hoveredInst = null;
            document.body.classList.remove('build-demolish-mode', 'has-hover');
            if (this.demolishBox) {
                this.demolishBox.visible = false;
                if (this.demolishBox.parent) this.demolishBox.parent.remove(this.demolishBox);
            }
            UI.showBar(false);
        }

        unselectDemolish() {
            this.selectedInst = null;
            if (this.demolishBox) this.demolishBox.visible = false;
            UI.setDemolishSelection(null);
            this.updateDemolishHover();
        }

        selectForDemolish(inst) {
            if (!inst) return;
            this.selectedInst = inst;
            this.hoveredInst = inst;

            const box = this.demolishBox;
            if (box) {
                const F = inst.fp || { hx: 1, hz: 1, ridgeY: 2.0 };
                const sx = F.hx * 2 + 0.1, sz = (F.hz + (F.front || 0)) * 2 + 0.1;
                const sy = Math.max(0.6, F.ridgeY || 2.4);
                box.scale.set(sx, sy, sz);
                box.position.set(inst.x, inst.fit ? inst.fit.deckY + sy / 2 : (inst.y || 0) + sy / 2, inst.z);
                box.rotation.y = inst.r || 0;
                box.visible = true;
            }

            const Items = window.AveloraItems;
            const returnCost = (inst.def.cost || []).map(c => {
                const it = Items ? Items.get(c.item) : null;
                return `${c.count} ${it ? it.name : c.item}`;
            }).join(', ');

            // Проверка пустоты склада/сундука
            const st = this.game.gameState;
            const isStorage = inst.def.id === 'storage' || !!inst.rec;
            let canDemolish = true;
            let reason = '';

            if (isStorage) {
                const used = this.storageUsed(inst);
                if (used.used > 0) {
                    canDemolish = false;
                    reason = `⚠ Склад не пуст (${used.used}/${used.total} яч.)! Сначала заберите все вещи.`;
                }
            }

            UI.setDemolishSelection(inst, returnCost, canDemolish, reason);
        }

        confirmDemolish() {
            if (!this.selectedInst) return;
            const inst = this.selectedInst;
            const uid = inst.uid;
            this.selectedInst = null;
            if (this.demolishBox) this.demolishBox.visible = false;
            UI.setDemolishSelection(null);
            this.demolish(uid);
        }

        findInstanceUnderCursor() {
            const cam = this.game.camera;
            if (!cam) return null;
            this._ray.setFromCamera(this._ndc, cam);

            const candidates = [];
            this.instances.forEach(inst => {
                if (inst.group) {
                    inst.group.traverse(o => {
                        if (o.isMesh && o.visible) {
                            o.userData.ownerInst = inst;
                            candidates.push(o);
                        }
                    });
                }
            });

            const hits = this._ray.intersectObjects(candidates, false);
            if (hits.length > 0) {
                for (const h of hits) {
                    if (h.object && h.object.userData && h.object.userData.ownerInst) {
                        return h.object.userData.ownerInst;
                    }
                }
            }
            return null;
        }

        updateDemolishHover() {
            if (!this.demolishing) return;
            const hitInst = this.findInstanceUnderCursor();
            document.body.classList.toggle('has-hover', !!hitInst);

            // Если объект уже зафиксирован кликом (выбран для сноса), подсветка не соскакивает
            if (this.selectedInst) return;

            this.hoveredInst = hitInst;
            if (hitInst) {
                const box = this.demolishBox;
                if (box) {
                    const F = hitInst.fp || { hx: 1, hz: 1, ridgeY: 2.0 };
                    const sx = F.hx * 2 + 0.1, sz = (F.hz + (F.front || 0)) * 2 + 0.1;
                    const sy = Math.max(0.6, F.ridgeY || 2.4);
                    box.scale.set(sx, sy, sz);
                    box.position.set(hitInst.x, hitInst.fit ? hitInst.fit.deckY + sy / 2 : (hitInst.y || 0) + sy / 2, hitInst.z);
                    box.rotation.y = hitInst.r || 0;
                    box.visible = true;
                }
                const Items = window.AveloraItems;
                const returnCost = (hitInst.def.cost || []).map(c => {
                    const it = Items ? Items.get(c.item) : null;
                    return `${c.count} ${it ? it.name : c.item}`;
                }).join(', ');
                UI.els.barTitle.textContent = `Выбор: ${hitInst.def.name} №${hitInst.uid}`;
                UI.setStatus(true, `Нажмите для выбора сноса (вернёт: ${returnCost})`);
            } else {
                if (this.demolishBox) this.demolishBox.visible = false;
                UI.els.barTitle.textContent = 'Режим сноса';
                UI.setStatus(false, 'Нажмите на постройку или блок для выбора');
            }
        }

        demolish(uid) {
            const st = this.game.gameState;
            const inst = this.instances.find(i => i.uid === uid);
            if (!st || !inst) return false;
            const key = inst.rec ? `${this.location.id}/${inst.rec.id}` : null;
            if (key && !st.chestInventory(key, inst.def.slots).isEmpty()) {
                this.warn('Сначала опустошите склад');
                return false;
            }

            for (const c of inst.def.cost) {
                if (st.inventory.spaceFor(c.item) < c.count) {
                    this.warn('В сумке нет места для материалов');
                    return false;
                }
            }
            const wo = this.game.worldObjects;
            if (wo && inst.rec) wo.unregisterContainer(inst.rec.id);
            inst.def.cost.forEach(c => st.inventory.add(c.item, c.count));
            if (key) st.dropChest(key);
            st.removeBuilding(this.location.id, uid);
            this.removeInstance(inst);

            const Items = window.AveloraItems;
            const returnCost = (inst.def.cost || []).map(c => {
                const it = Items ? Items.get(c.item) : null;
                return `+${c.count} ${it ? it.name : c.item}`;
            }).join(', ');

            if (this.game.ui) {
                this.game.ui.floatText(`Снесено: ${inst.def.name} (${returnCost})`, 'info');
                if (this.game.ui.pulseInventory) this.game.ui.pulseInventory();
            }
            return true;
        }

        removeInstance(inst) {
            const arr = this.game.cameraBlockers || [];
            [inst.low, inst.shell].forEach(o => { if (o) { const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1); } });
            if (inst.deckBox) this.floorProxies = this.floorProxies.filter(m => m !== inst.deckBox);
            if (inst.rampBox) this.floorProxies = this.floorProxies.filter(m => m !== inst.rampBox);
            if (inst.platform && inst.platform.hx !== undefined) this.terrain.removePlatform(inst.platform.id);
            this.unblockCells(inst);
            this.root.remove(inst.group);
            inst.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
            if (inst.model.meshes.wall && inst.model.meshes.wall.material) inst.model.meshes.wall.material.dispose();
            if (inst.model.meshes.roof && inst.model.meshes.roof.material) inst.model.meshes.roof.material.dispose();
            this.instances = this.instances.filter(i => i !== inst);
        }

        pickFloor(raycaster) {
            if (!this.floorProxies.length) return null;
            const hits = raycaster.intersectObjects(this.floorProxies, false);
            return hits.length ? hits[0] : null;
        }

        update(delta) {
            if (!this.cfg) return;
            for (let i = 0; i < this.instances.length; i++) this.updateShell(this.instances[i], delta, false);
            this._fT = (this._fT || 0) + delta;
            const ft = this._fT, fl = 0.8 + 0.12 * Math.sin(ft * 9.1) + 0.08 * Math.sin(ft * 23.7 + 1.3);
            if (this.mats && this.mats.glow) this.mats.glow.color.setScalar(fl);
            for (let i = 0; i < this.instances.length; i++) { const L = this.instances[i].light; if (L) L.intensity = 1.6 * fl; }

            this._stT = (this._stT || 0) - delta;
            if (this._stT <= 0) {
                this._stT = 0.3;
                const key = Object.keys(TYPES).filter(k => TYPES[k].kind === 'station').map(k => {
                    const n = this.stationNear(TYPES[k].station);
                    return n ? n.uid : 0;
                }).join(',');
                if (key !== this._stKey) {
                    this._stKey = key;
                    const ui = this.game.ui;
                    if (ui && ui.currentTab === 'craft' && ui.renderCrafting) ui.renderCrafting();
                }
            }

            const pl = this.placing;
            if (pl) {
                // keyRotate handled discrete in onKeyDown
                const ch = this.game.character;
                if (ch) {
                    const mv = Math.hypot(ch.position.x - (pl._hx || 0), ch.position.z - (pl._hz || 0));
                    if (mv > 0.15) { pl._hx = ch.position.x; pl._hz = ch.position.z; pl.dirty = true; }
                }
                if (pl.dirty) this.refreshGhost();
            }

            if (UI.panelOpen && UI.mgr === this) {
                this._uiT -= delta;
                if (this._uiT <= 0) {
                    this._uiT = 0.4;
                    UI.updateCosts();
                }
            }
        }

        onEscape() {
            if (this.placing) {
                const wasMove = !!this.placing.moveRec;
                this.cancelPlacing();
                if (!wasMove) UI.openPanel();
                return true;
            }
            if (this.moving) {
                if (this.selectedInst) this.unselectMove();
                else this.cancelMovingMode();
                return true;
            }
            if (this.demolishing) {
                if (this.selectedInst) this.unselectDemolish();
                else this.cancelDemolishing();
                return true;
            }
            if (UI.panelOpen) { UI.closePanel(); return true; }
            return false;
        }

        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            this.cancelPlacing();
            this.cancelDemolishing();
            if (this.moveBox) {
                this.moveBox.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
                this.moveBox = null;
            }
            if (this.demolishBox) {
                this.demolishBox.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
                this.demolishBox = null;
            }
            UI.detach(this);
            disposeLogTemplate(this.logTpl);
            this.logTpl = null;
            this.instances.length = 0;
            this.floorProxies.length = 0;
        }
    }

    window.AveloraBuilding = AveloraBuilding;
    window.AveloraBuildingTypes = TYPES;
})();
