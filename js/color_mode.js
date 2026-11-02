/**
 * Avelora — два цветовых режима материалов (2026-11-01).
 *
 * СТАРЫЙ режим (по умолчанию для всего, что было в игре до Рунных земель):
 *   renderer.outputEncoding = Linear, цвет на экран идёт «как есть». Под него подобраны
 *   освещение, текстуры (подъём тёмных тонов у кузни, танцовщиц, листвы) и шейдеры земли/неба/воды.
 *
 * sRGB режим (для новых мешей, NPC, мобов, мешей Рунных земель):
 *   материал получает define AV_SRGB, и в конце фрагментного шейдера итоговый цвет
 *   переводится в sRGB (ровно то, что делает renderer.outputEncoding = sRGBEncoding).
 *   GLTFLoader уже считает baseColor-карты sRGB, поэтому такие модели выглядят как в просмотрщике
 *   Meshy и НЕ требуют осветления текстур.
 *
 * Использование: AveloraColor.srgb(object3D) — после того, как у объекта появились его
 * окончательные материалы (после material.clone() define теряется — вызывать после клона).
 *
 * Новые GLB-пропсы получают sRGB автоматически: старый режим только у id из LEGACY_PROPS ниже.
 */
(function () {
    'use strict';
    if (typeof THREE === 'undefined') return;

    // Яркость sRGB-объектов (множитель на итоговый линейный цвет перед кодированием). Свет локаций подобран под старый
    // тёмный режим, поэтому sRGB-меши без поправки выходят ярче. Подбор: ?sg=0.7 в адресной строке (1 = без поправки).
    let GAIN = 0.8;
    try { const v = parseFloat(new URLSearchParams(location.search).get('sg')); if (isFinite(v) && v > 0) GAIN = v; } catch (e) {}

    const chunk = THREE.ShaderChunk;
    if (chunk && chunk.encodings_fragment && chunk.encodings_fragment.indexOf('AV_SRGB') < 0) {
        chunk.encodings_fragment += '\n#ifdef AV_SRGB\n\tgl_FragColor.rgb *= AV_GAIN;\n\tgl_FragColor = LinearTosRGB( gl_FragColor );\n#endif';
    }

    // Пропсы, существовавшие до Рунных земель (старый режим). Всё, чего тут нет, — sRGB.
    const LEGACY_PROPS = new Set([
        'bush', 'stump', 'campfire', 'chest', 'fallen_log', 'bone_pile', 'drying_rack',
        'elemental_altar_air', 'elemental_altar_fire', 'elemental_altar_stone', 'elemental_altar_water',
        'elemental_obelisk', 'hermit_hut', 'lizard_banner', 'lizard_tent', 'lizard_totem', 'waystone',
        'lizard_barricade', 'lizard_drum', 'anvil', 'cottage', 'gazebo', 'grass_tuft', 'violet_flowerbed',
        'smithy', 'stone_pass', 'woodshed', 'twinstone_pass',
        'sawmill'   // = модель props/woodshed (отдельный id для построек), старый режим
    ]);

    function mark(m, gain = GAIN) {
        if (!m || (m.defines && m.defines.AV_SRGB !== undefined)) return;
        m.defines = Object.assign({}, m.defines, { AV_SRGB: '', AV_GAIN: gain.toFixed(3) });
        m.needsUpdate = true;
    }

    // AzureArchmage has one atlas/material for skin, gold trim and navy cloth.
    // Lift navy base-color texels by hue (not brightness), so the robe pattern keeps its contrast.
    function liftNavyFabric(root, factor = 3.0) {
        if (!root) return root;
        const apply = m => {
            if (!m || m.userData.aveloraNavyFabricLift) return;
            m.userData.aveloraNavyFabricLift = factor;
            const previousCompile = m.onBeforeCompile;
            m.onBeforeCompile = function (shader, renderer) {
                if (previousCompile) previousCompile.call(this, shader, renderer);
                const token = '#include <map_fragment>';
                if (!shader.fragmentShader.includes(token)) return;
                const boost = Number(factor).toFixed(2);
                shader.fragmentShader = shader.fragmentShader.replace(token, `${token}
                    float avNavyRG = max(diffuseColor.r, diffuseColor.g);
                    float avNavyRatio = diffuseColor.b / max(avNavyRG, 0.003);
                    float avNavyMask = smoothstep(1.35, 2.15, avNavyRatio);
                    diffuseColor.rgb *= mix(1.0, ${boost}, avNavyMask);`);
            };
            const previousKey = m.customProgramCacheKey;
            m.customProgramCacheKey = function () {
                return `${previousKey ? previousKey.call(this) : ''}|avelora-navy-fabric-${factor}`;
            };
            m.needsUpdate = true;
        };
        if (root.isMaterial) apply(root);
        else root.traverse(o => {
            if (!o.material) return;
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(apply);
        });
        return root;
    }

    window.AveloraColor = {
        gain: GAIN,
        LEGACY_PROPS,
        isLegacyProp(id) { return LEGACY_PROPS.has(id); },
        srgbMaterial: mark,
        srgb(root, gain = GAIN) {
            if (!root) return root;
            if (root.isMaterial) { mark(root, gain); return root; }
            root.traverse(o => {
                if (!o.material) return;
                (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mark(m, gain));
            });
            return root;
        },
        liftNavyFabric
    };
})();
