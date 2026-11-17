/**
 * Avelora — погода локации (AveloraWeather): снегопад и позёмка.
 *
 * Включается полем локации в world_data.js:
 *   weather: { type: 'snow', density: 1.0, fall: 1.5, wind: [1.8, 0.6], drift: true }
 *     density — множитель числа снежинок, fall — скорость падения (м/с), wind — снос [x, z] (м/с),
 *     drift — позёмка: низкие быстрые струйки снега у земли.
 * Частицы живут в коробке вокруг героя и «заворачиваются» по её границам в вершинном шейдере, поэтому
 * на кадр — только запись нескольких uniform, без выделений памяти. Время копится из delta (на паузе замирает).
 * Всё лежит под game.locationRoot: teardownLocation() освобождает геометрию и материалы вместе с локацией.
 */
(function () {
    'use strict';

    const VERT = `
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform float uFall; uniform float uPx; uniform float uGround;
        attribute vec3 aSeed; attribute float aSize;
        varying float vA;
        void main() {
            vec3 p = aSeed * uBox;
            float k = 0.65 + 0.7 * fract(aSeed.x * 17.3 + aSeed.z * 5.1);
            p.y -= uTime * uFall * k;
            p.xz += uWind * uTime * (0.7 + 0.6 * aSeed.y);
            p.x += sin(uTime * (0.6 + aSeed.z) + aSeed.y * 40.0) * 0.35;
            p.z += cos(uTime * (0.5 + aSeed.x) + aSeed.z * 31.0) * 0.35;
            vec3 c = vec3(uCenter.x, uGround, uCenter.z);
            p = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5 + c;
            p.y += uBox.y * 0.5 - 1.0;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = -mv.z;
            gl_PointSize = clamp(aSize * uPx / max(d, 0.1), 1.0, 6.0);
            vec2 e = abs((p.xz - c.xz) / (uBox.xz * 0.5));
            vA = (1.0 - smoothstep(0.72, 1.0, max(e.x, e.y))) * smoothstep(0.6, 2.2, d);
        }`;
    const FRAG = `
        uniform vec3 uColor; uniform float uAlpha;
        varying float vA;
        void main() {
            vec2 q = gl_PointCoord - 0.5;
            float a = (1.0 - smoothstep(0.18, 0.5, length(q))) * vA * uAlpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
        }`;
    // позёмка: низкий слой, сильный снос, частицы вытянуты размером и полупрозрачны
    const VERT_DRIFT = `
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform float uPx; uniform float uGround;
        attribute vec3 aSeed; attribute float aSize;
        varying float vA;
        void main() {
            vec3 p = aSeed * uBox;
            float gust = 0.6 + 0.4 * sin(uTime * 0.35 + aSeed.x * 6.0);
            p.xz += uWind * uTime * (2.6 + 1.8 * aSeed.y) * gust;
            p.y = (0.04 + aSeed.y * aSeed.y * 0.55) + 0.06 * sin(uTime * 3.0 + aSeed.z * 50.0);
            vec3 c = vec3(uCenter.x, 0.0, uCenter.z);
            p.xz = mod(p.xz - c.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + c.xz;
            p.y += uGround;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = -mv.z;
            gl_PointSize = clamp(aSize * uPx / max(d, 0.1), 1.0, 9.0);
            vec2 e = abs((p.xz - c.xz) / (uBox.xz * 0.5));
            float band = 0.5 + 0.5 * sin(dot(p.xz, vec2(0.21, -0.13)) + uTime * 0.6);
            vA = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.y))) * smoothstep(0.8, 3.0, d) * smoothstep(0.25, 0.75, band) * gust;
        }`;

    class AveloraWeather {
        constructor(root, cfg, opts) {
            this.root = root;
            this.cfg = cfg || {};
            this.time = 0;
            this.layers = [];
            if (this.cfg.type !== 'snow' || !window.THREE) return;
            const low = !!(opts && opts.low);
            const dens = (this.cfg.density !== undefined ? this.cfg.density : 1.0) * (low ? 0.45 : 1.0);
            const wind = this.cfg.wind || [1.8, 0.6];
            const fall = this.cfg.fall !== undefined ? this.cfg.fall : 1.5;
            this.layers.push(this._make(Math.round(3600 * dens), new THREE.Vector3(48, 24, 48), VERT, FRAG,
                { uFall: { value: fall }, uAlpha: { value: 0.92 } }, wind, [0.022, 0.055], 11));
            if (this.cfg.drift !== false) {
                this.layers.push(this._make(Math.round(1500 * dens), new THREE.Vector3(34, 1, 34), VERT_DRIFT, FRAG,
                    { uAlpha: { value: 0.42 } }, wind, [0.05, 0.13], 23));
            }
        }

        _make(n, box, vert, frag, extra, wind, sizeRange, seed) {
            let a = seed >>> 0;
            const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
            const seeds = new Float32Array(n * 3), sizes = new Float32Array(n), pos = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                seeds[i * 3] = rnd(); seeds[i * 3 + 1] = rnd(); seeds[i * 3 + 2] = rnd();
                sizes[i] = sizeRange[0] + (sizeRange[1] - sizeRange[0]) * rnd() * rnd();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
            const uniforms = Object.assign({
                uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: box },
                uWind: { value: new THREE.Vector2(wind[0], wind[1]) }, uPx: { value: 600 }, uGround: { value: 0 },
                uColor: { value: new THREE.Color(0xf4f8ff) }
            }, extra);
            const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: false });
            const pts = new THREE.Points(geo, mat);
            pts.frustumCulled = false;
            pts.renderOrder = 5;
            pts.name = 'weather';
            this.root.add(pts);
            return pts;
        }

        /** center — позиция героя (THREE.Vector3 или null); camera/renderer — для размера снежинок в пикселях. */
        update(delta, camera, center, renderer) {
            if (!this.layers.length) return;
            this.time += delta;
            let px = 600;
            if (camera && renderer && renderer.domElement) {
                const h = renderer.domElement.height || 720;
                px = h * 0.5 / Math.tan((camera.fov || 50) * Math.PI / 360);
            }
            for (let i = 0; i < this.layers.length; i++) {
                const u = this.layers[i].material.uniforms;
                u.uTime.value = this.time;
                u.uPx.value = px;
                if (center) { u.uCenter.value.set(center.x, center.y, center.z); u.uGround.value = center.y; }
            }
        }

        dispose() {
            this.layers.forEach(p => { if (p.parent) p.parent.remove(p); p.geometry.dispose(); p.material.dispose(); });
            this.layers = [];
        }
    }

    window.AveloraWeather = AveloraWeather;
})();
