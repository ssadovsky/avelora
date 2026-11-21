/**
 * Avelora — Playable Character Catalog
 *
 * Single source of truth for the 3 selectable characters: character-select
 * screen (main.js), the save system (save.js, keyed by `id`) and the
 * character controller (character.js, which reads `modelKey`/`animMap`/etc)
 * all read from here.
 *
 * animMap maps the controller's LOGICAL animation names ('idle', 'run') to
 * the actual clip names baked into that character's .glb — these differ per
 * character because each was rigged/animated separately in Mixamo.
 * `idleFallback: 'run'` means: if the 'idle' clip isn't present (e.g. Arissa
 * before her Idle animation was added), freeze on the first frame of the
 * 'run' clip instead of having no pose at all.
 *
 * `scale` compensates for models that weren't exported at the soldier's
 * real-world scale (1.0 = same as the soldier). Arissa/AzureArchmage came
 * from Meshy AI image-to-3D + Mixamo/FBX2glTF conversion, which does NOT
 * guarantee real-world scale like the soldier's purpose-built rig does.
 * AzureArchmage's export in particular measured ~1/95 scale (bone-chain
 * forward-kinematics height ~0.0185 units vs. the ~1.76 the other two
 * characters stand at) — 95.0 here is a computed correction, not a guess,
 * but still worth eyeballing in-game against the soldier/terrain.
 *
 * `facingOffset` (radians, default 0) corrects character.js's shared
 * heading formula (tuned for the soldier's own rig, whose local forward is
 * -Z) for a model whose rig faces the opposite way. Measured via forward
 * kinematics on the LeftFoot->LeftToeBase bone direction in each model's
 * bind pose: the soldier's toe points -Z, but Arissa's and AzureArchmage's
 * (both Mixamo mixamorig: rigs, unlike the soldier's custom one) point
 * +Z — so without this they walked/ran backwards (facing away from their
 * own direction of travel) whenever the player clicked to move.
 *
 * `handGrip` (optional) places a hand-held item (axe, staff — items with
 * `use.type: 'equip'`) in the right-hand bone: `position` in METERS and
 * `rotation` (Euler XYZ, radians), both in the hand bone's own frame. Item
 * models have their origin at the grip and the shaft along +Y (blade toward +X);
 * character.js setHandItem() cancels the bone's world scale so the item stays
 * real-size. Each rig's hand frame differs, so the values were derived per rig
 * from its idle pose: shaft through the fist toward the thumb side, tipped ~35°
 * down along the fingers, blade edge facing the character's forward direction;
 * position = ~8.5 cm from the wrist along the fingers (the middle of the fist).
 *
 * `maxHp` (default 100): health pool (combat.js; not persisted — full on load).
 * `swing` (optional): per-rig multipliers for the procedural melee swing
 * overlay (character.js SWING_KEYS) — { arm, forearm, spine, hand }, 1 = as
 * authored. The curve works in the character's world frame, so rigs only need
 * this if their idle pose makes the default look off.
 */
window.CHARACTER_CATALOG = [
    {
        id: 'mage',
        name: 'Маг',
        className: 'Маг',
        icon: '🔮',
        // Экран создания персонажа: подпись под героем, иконки навыков и варианты пола.
        // Пол — вариант внешности внутри класса (classId остаётся 'mage'). locked — «скоро»:
        // в меню виден (preview — другая модель только для витрины), создать пока нельзя.
        tagline: 'Стихийная магия',
        orbit: ['#ff7a1a', '#6ec8ff', '#ffe14a'],   // цвета парящих огней вокруг героя (стихии)
        previewSkills: ['spark', 'fireball', 'ice_arrow', 'lightning_strike'],
        genders: [
            { id: 'male', label: 'Мужской', title: 'Маг', name: 'Маг', icon: 'cs_male' },
            { id: 'female', label: 'Женский', title: 'Чародейка', name: 'Чародейка', icon: 'cs_female',
              // витрина меню: настоящая модель Чародейки (лицом к камере), в игре — overrides поверх конфига мага
              preview: { modelKey: 'sorceress', faceAngle: 0, scale: 1.05, idle: 'Idle' },
              overrides: {
                  modelKey: 'sorceress',
                  portrait: 'heroPortrait_sorceress',     // иконка героя в HUD и в списке слотов
                  noNavyLift: true,                       // у мага осветляется тёмно-синяя ткань; у Чародейки свой цвет
                  scale: 1.05,
                  facingOffset: Math.PI,
                  animMap: { idle: 'Idle', run: 'Running', greeting: 'Greeting', cast: 'Cast', unarmed: 'Boxing' },   // unarmed — удар кулаком, играется только когда в руке ничего нет
                  // хват посоха: пальцы правой кисти сжимаются костями (поза из бокса ×0.5), только пока в руке предмет; без него кисть открытая.
                  // staffGrip — точка и ось посоха в системе кисти (центр кольца свёрнутых пальцев); считалось по рендеру вдоль оси (temp_work/rig/sorceress)
                  gripFingers: {"RightHandThumb1": [0.3563, -0.7995, 0.0513, 0.4808], "RightHandThumb2": [-0.0733, 0.0468, 0.1339, 0.9872], "RightHandThumb3": [-0.0837, -0.0175, 0.2633, 0.9609], "RightHandMiddle1": [0.1889, -0.8082, 0.3282, 0.451], "RightHandMiddle2": [0.3856, -0.0371, 0.0002, 0.9219], "RightHandMiddle3": [0.2078, -0.0932, -0.0606, 0.9718], "RightHandPinky1": [0.1584, -0.7717, 0.3239, 0.524], "RightHandPinky2": [0.3544, 0.038, -0.0708, 0.9317], "RightHandPinky3": [0.5389, 0.003, 0.0065, 0.8424]},
                  staffGrip: { position: [-0.008, 0.080, -0.014], axis: [-0.2, 0.14, 0.97] },
                  // платье: верхом ноги почти вместе, колени вперёд (иначе подол рвётся на две половины)
                  // торс у чародейки длиннее (плечи на 12 см выше от бёдер), чем у мага, а руки короче: руки опущены ниже, чтобы кисти были на той же высоте над сёдлом
                  riderPose: { thigh: [0.82, 0.2, -0.54], shin: [0.04, 0.1, -1.0], foot: [0.9, 0.08, -0.4], upperArm: [0.30, 0.14, -0.95], forearm: [0.74, -0.20, -0.64], lean: 6, gallopLean: 7 }
              } }
        ],
        portrait: 'heroPortrait_mage',
        modelKey: 'azureArchmage',
        // Rebuilt from lib/mage/'s fresh Idle/Running/Walking/Sitting/Salute
        // exports (merged, root-motion-stripped on Running/Walking, decimated
        // ~183k -> 29,388 tris via gltf-transform simplify). Real clips now
        // exist for all of these, so idleFallback is no longer needed.
        // 'greeting' plays once after IDLE_GREETING_DELAY (character.js) of
        // standing still, then returns to idle.
        // ПРИМЕЧАНИЕ: attack намеренно не указываем в animMap, чтобы для ударов и рубки
        // использовался процедурный взмах оружием startSwing (рубка вперед-вниз лезвием),
        // а не карате-удар рукой/ногой из сырого клипа Meshy AI.
        animMap: { idle: 'Idle', run: 'Running', greeting: 'Greeting', cast: 'Cast' },
        hasTravelerGear: false,
        // Новый молодой боевой маг на родном Meshy AI biped скелете
        scale: 1.05,
        facingOffset: Math.PI,
        channelHoldTime: 0.4,   // 'Cast' clip: рука поднята на 0.38 с — на этой позе держим её при долгих заклинаниях (home_recall)
        maxHp: 90,
        // Топор ориентирован лезвием вперед и вниз (Y = 1.5708 rad = 90 deg)
        handGrip: { position: [0.0, 0.08, 0.0], rotation: [0.0, 1.5708, 0.0] },
        // Посох в кулаке (пальцы правой кисти загнуты в самой модели, temp_work/mage_grip/fist.py): точка хвата (м) и ось древка в системе кости кисти.
        // Посох всегда вертикален с наклоном вперёд (character.js applyCarryUpright); при пересборке модели мага заново прогнать fist.py.
        staffGrip: { position: [-0.0259, 0.0797, -0.0203], axis: [-0.617, 0.0, 0.7869] }
    },
    {
        id: 'archer',
        name: 'Лучница',
        className: 'Лучница',
        icon: '🏹',
        tagline: 'Дальний бой',
        orbit: ['#7be36b', '#ff7a1a', '#6ec8ff'],
        previewSkills: ['arrow', 'fire_arrow', 'ice_arrow', 'blink'],
        genders: [
            { id: 'male', label: 'Мужской', title: 'Лучник', name: 'Лучник', icon: 'cs_male2', locked: true },
            { id: 'female', label: 'Женский', title: 'Лучница', name: 'Лучница', icon: 'cs_archer' }
        ],
        portrait: 'heroPortrait_archer',
        modelKey: 'arissa',
        // 'Idle' will exist once we add it (see lib/3d/README.md); until then
        // idleFallback freezes on the first frame of 'Fast Run'.
        animMap: { idle: 'Idle', run: 'Fast Run' },
        idleFallback: 'run',
        hasTravelerGear: false,
        hideNodes: [],
        scale: 1.0,
        facingOffset: Math.PI,
        maxHp: 100,
        handGrip: { position: [0.022, 0.082, -0.004], rotation: [1.482, 0.4, -1.121] }
    },
    {
        id: 'warrior',
        disabled: true,
        hidden: true,           // временно скрыт из интерфейса
        name: 'Воин',
        className: 'Странствующий страж',
        icon: '⚔️',
        portrait: 'heroPortrait_warrior',
        modelKey: 'soldier',
        animMap: { idle: 'Idle', run: 'Run' },
        idleFallback: 'run',
        hasTravelerGear: true,   // cloak + staff cosmetic attachment (soldier reskin only)
        hideNodes: ['vanguard_visor'],
        scale: 1.0,
        maxHp: 120,
        handGrip: { position: [-0.002, 0.083, 0.018], rotation: [1.436, -0.504, 1.15] }
    }
];

/** Вариант пола класса: по id, иначе первый доступный. */
window.getCharacterGender = function (cfg, genderId) {
    const list = (cfg && cfg.genders) || [];
    return list.find(g => g.id === genderId) || list.find(g => !g.locked) || list[0] || null;
};

// Конфиг героя с учётом пола: overrides выбранного варианта (например, Чародейка) поверх базового класса.
window.resolveCharacterConfig = function (cfg, genderId) {
    if (!cfg) return cfg;
    const g = window.getCharacterGender(cfg, genderId);
    return (g && g.overrides) ? Object.assign({}, cfg, g.overrides) : cfg;
};

window.getCharacterConfig = function (id) {
    return window.CHARACTER_CATALOG.find(c => c.id === id) || null;
};
