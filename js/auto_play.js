/**
 * Avelora Auto-Play System (js/auto_play.js)
 * Fully Data-Driven, autonomous gameplay assistant:
 * 1. Auto-Combat: Smart skill rotation & configurable range (BDM style).
 * 2. Auto-Gather: Autonomous herb foraging, wood logging, ore mining & loot collection.
 * 3. Auto-Quest: Full autonomous lifecycle (Find -> Accept -> Hunt/Gather -> Turn In -> Next Quest).
 */
(function() {
    'use strict';

    class AveloraAutoPlay {
        constructor(game) {
            this.game = game;
            this.combatEnabled = false;
            this.questEnabled = false;
            this.gatherEnabled = false;

            this.gatherConfig = this.loadGatherConfig();
            this.gatherRadius = this.loadGatherRadius();
            this.gatherAnchor = null; // запоминается только в сессии во время включенного автосбора
            this.combatRadius = this.loadCombatRadius();
            this.combatAttackNeutrals = this.loadCombatNeutrals();
            this.combatUseDefense = this.loadCombatDefense();
            this.combatAnchor = null; // запоминается только в сессии во время включенного автобоя

            // Combat throttling & state
            this._combatTimer = 0;

            // Quest throttling & state
            this._questTimer = 0;
            this._manualMovePauseUntil = 0;
            this._lastNavPoint = null;
            this._nextPathTime = 0;
            this._dialogCooldown = 0;

            // Gather throttling & state
            this._gatherTimer = 0;
            this._lastGatherMsgTime = 0;
            this._unreachableObjects = new Map();
            this._currentGatherTarget = null;
            this._gatherTargetStartTime = 0;

            // Cache DOM elements
            this.combatBtn = null;
            this.combatChevron = null;
            this.combatPopup = null;

            this.gatherBtn = null;
            this.gatherChevron = null;
            this.gatherPopup = null;

            this.questBtn = null;

            this.initUI();
            this.initHotkeys();
        }

        loadGatherConfig() {
            try {
                const saved = localStorage.getItem('avelora_autogather_cfg');
                if (saved) return Object.assign({ herb: true, wood: true, ore: true, loot: true }, JSON.parse(saved));
            } catch (_) {}
            return { herb: true, wood: true, ore: true, loot: true };
        }

        saveGatherConfig() {
            try {
                localStorage.setItem('avelora_autogather_cfg', JSON.stringify(this.gatherConfig));
            } catch (_) {}
        }

        loadGatherRadius() {
            try {
                const saved = localStorage.getItem('avelora_autogather_radius');
                if (saved !== null) {
                    const r = Number(saved);
                    if ((Number.isFinite(r) && r > 0) || r === Infinity) return r;
                }
            } catch (_) {}
            return 30.0;
        }

        saveGatherRadius(r) {
            this.gatherRadius = Number(r);
            try {
                localStorage.setItem('avelora_autogather_radius', String(this.gatherRadius));
            } catch (_) {}
        }

        loadCombatRadius() {
            try {
                const saved = localStorage.getItem('avelora_autocombat_radius');
                if (saved !== null) {
                    const r = Number(saved);
                    if (Number.isFinite(r) || r === Infinity) return r;
                }
            } catch (_) {}
            return 18.0;
        }

        saveCombatRadius(r) {
            this.combatRadius = Number(r);
            try {
                localStorage.setItem('avelora_autocombat_radius', String(this.combatRadius));
            } catch (_) {}
        }

        loadCombatNeutrals() {
            try {
                const saved = localStorage.getItem('avelora_autocombat_neutrals');
                return saved === 'true';
            } catch (_) {}
            return false;
        }

        saveCombatNeutrals(val) {
            this.combatAttackNeutrals = !!val;
            try {
                localStorage.setItem('avelora_autocombat_neutrals', String(this.combatAttackNeutrals));
            } catch (_) {}
        }

        loadCombatDefense() {
            try {
                const saved = localStorage.getItem('avelora_autocombat_defense');
                if (saved !== null) return saved === 'true';
            } catch (_) {}
            return true;
        }

        saveCombatDefense(val) {
            this.combatUseDefense = !!val;
            try {
                localStorage.setItem('avelora_autocombat_defense', String(this.combatUseDefense));
            } catch (_) {}
        }

        // ---------------------------------------------------------------------
        // UI & Hotkeys
        // ---------------------------------------------------------------------
        initUI() {
            this.combatBtn = document.getElementById('auto-combat-btn');
            this.combatChevron = document.getElementById('auto-combat-chevron');
            this.combatPopup = document.getElementById('auto-combat-popup');

            this.gatherBtn = document.getElementById('auto-gather-btn');
            this.gatherChevron = document.getElementById('auto-gather-chevron');
            this.gatherPopup = document.getElementById('auto-gather-popup');

            this.questBtn = document.getElementById('auto-quest-btn');
            const dock = document.getElementById('auto-actions-dock');

            const absorbPointer = (e) => {
                e.stopPropagation();
                window.__avelora_just_ui_tap = performance.now();
            };

            const targets = [
                dock,
                this.combatBtn, this.combatChevron, this.combatPopup,
                this.gatherBtn, this.gatherChevron, this.gatherPopup,
                this.questBtn
            ].filter(Boolean);
            const eventsToAbsorb = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'];

            targets.forEach(el => {
                eventsToAbsorb.forEach(evt => {
                    el.addEventListener(evt, absorbPointer, { passive: false });
                });
            });

            if (this.combatBtn) {
                this.combatBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.__avelora_just_ui_tap = performance.now();
                    this.toggleCombat();
                });
            }

            if (this.gatherBtn) {
                this.gatherBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.__avelora_just_ui_tap = performance.now();
                    this.toggleGather();
                });
            }

            if (this.questBtn) {
                this.questBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.__avelora_just_ui_tap = performance.now();
                    this.toggleQuest();
                });
            }

            // Dropdown Chevron Popups (BDM style)
            const closeAllPopups = () => {
                if (this.combatPopup) this.combatPopup.style.display = 'none';
                if (this.combatChevron) this.combatChevron.classList.remove('open');
                if (this.gatherPopup) this.gatherPopup.style.display = 'none';
                if (this.gatherChevron) this.gatherChevron.classList.remove('open');
            };

            if (this.combatChevron && this.combatPopup) {
                this.combatChevron.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.__avelora_just_ui_tap = performance.now();
                    const isOpen = this.combatPopup.style.display !== 'none';
                    closeAllPopups();
                    if (!isOpen) {
                        this.combatPopup.style.display = 'flex';
                        this.combatChevron.classList.add('open');
                    }
                });
            }

            if (this.gatherChevron && this.gatherPopup) {
                this.gatherChevron.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.__avelora_just_ui_tap = performance.now();
                    const isOpen = this.gatherPopup.style.display !== 'none';
                    closeAllPopups();
                    if (!isOpen) {
                        this.gatherPopup.style.display = 'flex';
                        this.gatherChevron.classList.add('open');
                    }
                });
            }

            // Close buttons on popups
            const setupCloseBtn = (popup, chevron) => {
                if (!popup) return;
                const closeBtn = popup.querySelector('.auto-popup-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.__avelora_just_ui_tap = performance.now();
                        popup.style.display = 'none';
                        if (chevron) chevron.classList.remove('open');
                    });
                }
            };
            setupCloseBtn(this.combatPopup, this.combatChevron);
            setupCloseBtn(this.gatherPopup, this.gatherChevron);

            document.addEventListener('pointerdown', (e) => {
                if (dock && !dock.contains(e.target)) {
                    closeAllPopups();
                }
            });

            // Gather config checkboxes
            const syncCheckbox = (id, key) => {
                const el = document.getElementById(id);
                if (el) {
                    el.checked = !!this.gatherConfig[key];
                    el.addEventListener('change', () => {
                        this.gatherConfig[key] = el.checked;
                        this.saveGatherConfig();
                        const labels = { herb: 'Трава', wood: 'Дерево', ore: 'Камень', loot: 'Добыча' };
                        if (this.game.ui && this.game.ui.floatText) {
                            this.game.ui.floatText(`${labels[key] || key}: ${el.checked ? 'ВКЛ' : 'ВЫКЛ'}`, el.checked ? 'good' : 'info');
                        }
                    });
                }
            };
            syncCheckbox('auto-gather-herb', 'herb');
            syncCheckbox('auto-gather-wood', 'wood');
            syncCheckbox('auto-gather-ore', 'ore');
            syncCheckbox('auto-gather-loot', 'loot');

            // Gather radius radio options
            if (this.gatherPopup) {
                const opts = this.gatherPopup.querySelectorAll('[data-gather-radius]');
                opts.forEach(btn => {
                    const r = Number(btn.getAttribute('data-gather-radius'));
                    btn.classList.toggle('active', r === this.gatherRadius);
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.__avelora_just_ui_tap = performance.now();
                        this.saveGatherRadius(r);
                        opts.forEach(b => b.classList.toggle('active', b === btn));
                        const label = !Number.isFinite(r) ? 'Вся локация' : `${r} м`;
                        if (this.game.ui && this.game.ui.floatText) {
                            this.game.ui.floatText(`Дистанция сбора: ${label}`, 'good');
                        }
                        closeAllPopups();
                    });
                });
            }

            // Combat attack neutrals checkbox
            const neutralsEl = document.getElementById('auto-combat-neutrals');
            if (neutralsEl) {
                neutralsEl.checked = !!this.combatAttackNeutrals;
                neutralsEl.addEventListener('change', () => {
                    this.saveCombatNeutrals(neutralsEl.checked);
                    if (this.game.ui && this.game.ui.floatText) {
                        this.game.ui.floatText(`Нейтральные: ${neutralsEl.checked ? 'ВКЛ' : 'ВЫКЛ'}`, neutralsEl.checked ? 'good' : 'info');
                    }
                });
            }

            // Combat defense skills checkbox
            const defenseEl = document.getElementById('auto-combat-defense');
            if (defenseEl) {
                defenseEl.checked = !!this.combatUseDefense;
                defenseEl.addEventListener('change', () => {
                    this.saveCombatDefense(defenseEl.checked);
                    if (this.game.ui && this.game.ui.floatText) {
                        this.game.ui.floatText(`Защитные скилы: ${defenseEl.checked ? 'ВКЛ' : 'ВЫКЛ'}`, defenseEl.checked ? 'good' : 'info');
                    }
                });
            }

            // Combat radius radio options
            if (this.combatPopup) {
                const opts = this.combatPopup.querySelectorAll('[data-radius]');
                opts.forEach(btn => {
                    const r = Number(btn.getAttribute('data-radius'));
                    btn.classList.toggle('active', r === this.combatRadius);
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.__avelora_just_ui_tap = performance.now();
                        this.saveCombatRadius(r);
                        opts.forEach(b => b.classList.toggle('active', b === btn));
                        const label = !Number.isFinite(r) ? 'Вся локация' : (r === 0 ? 'На месте' : `${r} м`);
                        if (this.game.ui && this.game.ui.floatText) {
                            this.game.ui.floatText(`Дистанция боя: ${label}`, 'good');
                        }
                        closeAllPopups();
                    });
                });
            }
        }

        initHotkeys() {
            window.addEventListener('keydown', (e) => {
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
                const g = this.game;
                if (!g || !g.isReady || g.isPaused) return;

                if (e.code === 'KeyZ') { // Z key - Auto Combat
                    e.preventDefault();
                    this.toggleCombat();
                } else if (e.code === 'KeyX') { // X key - Auto Quest
                    e.preventDefault();
                    this.toggleQuest();
                } else if (e.code === 'BracketRight' || e.key === ']' || e.key === 'ъ' || e.key === 'Ъ') { // ] key - Auto Gather
                    e.preventDefault();
                    this.toggleGather();
                }
            });
        }

        toggleGather(force) {
            const c = this.game.character;
            this.gatherEnabled = (force !== undefined) ? !!force : !this.gatherEnabled;
            if (this.gatherBtn) {
                this.gatherBtn.classList.toggle('active', this.gatherEnabled);
                const stateSpan = this.gatherBtn.querySelector('.auto-action-state');
                if (stateSpan) stateSpan.textContent = this.gatherEnabled ? 'ВКЛ' : 'ВЫКЛ';
            }
            if (this.gatherEnabled) {
                if (c && c.position) {
                    this.gatherAnchor = { x: c.position.x, z: c.position.z };
                }
            } else {
                this.gatherAnchor = null;
                this._currentGatherTarget = null;
                if (c && c.isMoving && !this.questEnabled && !this.combatEnabled) c.stopMovement();
                if (this.game.combat && this.game.combat.engagement) {
                    const k = this.game.combat.engagement.kind;
                    if (k === 'trees' || k === 'ores' || k === 'gather') {
                        this.game.combat.cancel();
                    }
                }
                if (this.game.worldObjects && this.game.worldObjects.cancelPending) {
                    this.game.worldObjects.cancelPending();
                }
            }
            if (this.game.ui && this.game.ui.floatText) {
                const radLabel = !Number.isFinite(this.gatherRadius) ? 'Вся локация' : `${this.gatherRadius}м`;
                const label = this.gatherEnabled ? `Автосбор (${radLabel}): ВКЛ` : 'Автосбор: ВЫКЛ';
                this.game.ui.floatText(label, this.gatherEnabled ? 'good' : 'info');
            }
        }

        toggleCombat(force) {
            this.combatEnabled = (force !== undefined) ? !!force : !this.combatEnabled;
            if (this.combatEnabled) {
                const c = this.game.character;
                if (c && c.position) {
                    this.combatAnchor = { x: c.position.x, z: c.position.z };
                }
            } else {
                this.combatAnchor = null;
                if (this.game.combat) this.game.combat.clearTarget();
                const c = this.game.character;
                if (c && c.isMoving && !this.questEnabled && !this.gatherEnabled) c.stopMovement();
            }
            if (this.combatBtn) {
                this.combatBtn.classList.toggle('active', this.combatEnabled);
                const stateSpan = this.combatBtn.querySelector('.auto-action-state');
                if (stateSpan) stateSpan.textContent = this.combatEnabled ? 'ВКЛ' : 'ВЫКЛ';
            }
            if (this.game.ui && this.game.ui.floatText) {
                const radLabel = !Number.isFinite(this.combatRadius) ? 'Вся локация' : (this.combatRadius === 0 ? 'На месте' : `${this.combatRadius}м`);
                const label = this.combatEnabled ? `Автобой (${radLabel}): ВКЛ` : 'Автобой: ВЫКЛ';
                this.game.ui.floatText(label, this.combatEnabled ? 'good' : 'info');
            }
        }

        toggleQuest(force) {
            this.questEnabled = (force !== undefined) ? !!force : !this.questEnabled;
            if (this.questBtn) {
                this.questBtn.classList.toggle('active', this.questEnabled);
                const stateSpan = this.questBtn.querySelector('.auto-action-state');
                if (stateSpan) stateSpan.textContent = this.questEnabled ? 'ВКЛ' : 'ВЫКЛ';
            }
            if (!this.questEnabled) {
                // Stop any active navigation
                if (this.game.character && this.game.character.isMoving) {
                    this.game.character.stopMovement();
                }
            }
            if (this.game.ui && this.game.ui.floatText) {
                this.game.ui.floatText(this.questEnabled ? 'Автоквест: ВКЛ' : 'Автоквест: ВЫКЛ', this.questEnabled ? 'good' : 'info');
            }
        }

        /** Called when user touches joystick, WASD or arrows to give manual control */
        onManualMove() {
            this._lastManualAt = Date.now();
            this._manualMovePauseUntil = this._lastManualAt + 3500;
            if (this.combatEnabled) {
                const c = this.game.character;
                if (c && c.position) {
                    this.combatAnchor = { x: c.position.x, z: c.position.z };
                }
            }
        }

        // ---------------------------------------------------------------------
        // Main Loop Update
        // ---------------------------------------------------------------------
        update(delta) {
            const g = this.game;
            if (!g.isReady || g.isPaused || g.isTransitioning || !g.character) return;
            if (g.combat && g.combat.isDead) {
                if (this.combatEnabled) this.toggleCombat(false);
                if (this.questEnabled) this.toggleQuest(false);
                if (this.gatherEnabled) this.toggleGather(false);
                return;
            }

            // Hero starts a portal / recall by himself: the autopilot gets out of the way
            if ((this.questEnabled || this.gatherEnabled) && g.skills && g.skills.channel) {
                if (this.questEnabled) this.toggleQuest(false);
                if (this.gatherEnabled) this.toggleGather(false);
                return;
            }

            if (this.combatEnabled) this.updateCombat(delta);
            if (this.gatherEnabled) this.updateGather(delta);
            if (this.questEnabled) this.updateQuest(delta);
        }

        /** Enough mana for the skill (same cost formula the skill system pays). */
        canAfford(def) {
            const hero = this.game.hero;
            if (!hero) return true;
            const cost = typeof hero.skillManaCost === 'function' ? hero.skillManaCost(def) : (def.mana || 0);
            return !(cost > 0) || hero.mana + 1e-6 >= cost;
        }

        /**
         * Is this fight dangerous enough to spend a defensive buff?
         * Yes when: the hero is already hurt, the enemy is elite/boss, or the enemies around hit hard
         * enough to take a big bite of the current HP in a few blows. A lone weaker mob is not a reason.
         */
        isUnderThreat(tgt) {
            const g = this.game, cr = g.creatures, combat = g.combat, c = g.character;
            if (!combat || !cr || !c) return false;
            if (combat.hp < combat.maxHp * 0.6) return true;
            const foes = (cr.list || []).filter(rec => cr.isAlive(rec) && (rec.aggro || rec === tgt) && Math.hypot(rec.x - c.position.x, rec.z - c.position.z) <= 12.0);
            if (foes.some(rec => rec.rank && rec.rank !== 'normal')) return true;
            const pressure = foes.reduce((sum, rec) => {
                const d = rec.scaledDamage || [0, 0];
                return sum + (d[0] + d[1]) / 2;
            }, 0);
            return pressure * 5 >= combat.hp;   // about 5 blows from everyone together would kill
        }

        /** Id of the location the hero is in now (game.location is an object). */
        curLocId() {
            const l = this.game.location;
            return (l && l.id) || (typeof l === 'string' ? l : null);
        }

        // ---------------------------------------------------------------------
        // Skills Resolver
        // ---------------------------------------------------------------------
        getAvailableSkills() {
            const g = this.game;
            const skills = g.skills;
            const st = g.gameState;
            if (!skills) return [];

            const list = [];
            const seen = new Set();
            const charCfg = g.currentCharacterConfig || {};
            const classId = (st && st.classId) || charCfg.id || 'mage';

            // Навыки, которые персонаж РЕАЛЬНО изучил и может использовать в игре
            try {
                const classSkills = skills.forCharacter ? skills.forCharacter(classId) : [];
                for (const def of classSkills) {
                    if (def && !seen.has(def.id)) {
                        seen.add(def.id);
                        list.push(def);
                    }
                }
            } catch (_) {}

            // Навыки на хотбаре (только если они выучены персонажем)
            if (st && st.hotbar) {
                for (const slot of st.hotbar) {
                    if (slot && slot.type === 'skill' && !seen.has(slot.id)) {
                        if (!skills.hasSkill || skills.hasSkill(classId, slot.id)) {
                            seen.add(slot.id);
                            const def = skills.get(slot.id);
                            if (def) list.push(def);
                        }
                    }
                }
            }

            return list;
        }

        // ---------------------------------------------------------------------
        // 1. AUTO-COMBAT ENGINE
        // ---------------------------------------------------------------------
        updateCombat(delta, customTarget = null) {
            const g = this.game;
            const ui = g.ui;
            if (ui && ((ui.isDialogOpen && ui.isDialogOpen()) || (ui.isChestOpen && ui.isChestOpen()))) return;

            this._combatTimer -= delta;
            if (this._combatTimer > 0) return;
            this._combatTimer = 0.15; // Evaluate combat decisions every 150ms

            // The player is steering by hand: never fight his controls
            if (!customTarget && Date.now() - (this._lastManualAt || 0) < 1200) return;

            const cr = g.creatures;
            const c = g.character;
            const skills = g.skills;
            const combat = g.combat;
            const hero = g.hero;
            if (!cr || !c || !combat) return;

            // Anchor point where auto-combat was activated (in-memory only)
            if (!this.combatAnchor && c.position) {
                this.combatAnchor = { x: c.position.x, z: c.position.z };
            }
            const anchor = this.combatAnchor || { x: c.position.x, z: c.position.z };

            // Target Validation
            let tgt = customTarget || combat.selectedTarget;
            if (tgt && (!cr.isAlive(tgt) || tgt.state === 'return')) {
                combat.clearTarget();
                tgt = null;
            }

            // Target Acquisition:
            if (!tgt) {
                // Priority 1: Enemies currently aggressive/attacking the player
                const attackers = (cr.list || []).filter(rec => cr.isAlive(rec) && rec.aggro && (rec.state === 'chase' || rec.state === 'attack'));
                if (attackers.length > 0) {
                    attackers.sort((a, b) => {
                        const losA = skills ? skills.hasLineOfSight(c.position, a) : true;
                        const losB = skills ? skills.hasLineOfSight(c.position, b) : true;
                        if (losA !== losB) return losA ? -1 : 1;
                        return Math.hypot(a.x - c.position.x, a.z - c.position.z) - Math.hypot(b.x - c.position.x, b.z - c.position.z);
                    });
                    tgt = attackers[0];
                    combat.selectTarget(tgt);
                } else {
                    // Priority 2: If hunting specific quest target within anchor range
                    const huntType = this.getHuntCreatureType();
                    if (huntType) {
                        const huntCandidates = (cr.list || []).filter(rec => cr.isAlive(rec) && rec.type === huntType && Math.hypot(rec.x - anchor.x, rec.z - anchor.z) <= Math.max(24.0, this.combatRadius));
                        if (huntCandidates.length > 0) {
                            huntCandidates.sort((a, b) => Math.hypot(a.x - c.position.x, a.z - c.position.z) - Math.hypot(b.x - c.position.x, b.z - c.position.z));
                            tgt = huntCandidates[0];
                            combat.selectTarget(tgt);
                        }
                    }
                    // Priority 3: Aggressive enemies (or neutral/yellow mobs) strictly within combatRadius FROM THE START ANCHOR
                    if (!tgt) {
                        const maxDist = this.combatRadius > 0 ? this.combatRadius : 4.0;
                        const hostiles = (cr.list || []).filter(rec => {
                            if (!cr.isAlive(rec) || !rec.def) return false;
                            const isAggro = rec.def.behavior === 'aggressive';
                            const isNeutral = !isAggro && rec.def.behavior !== 'friendly' && rec.def.behavior !== 'npc';
                            const canTarget = isAggro || (this.combatAttackNeutrals && isNeutral);
                            if (!canTarget) return false;
                            // Считаем дистанцию строго ОТ СТАРТОВОГО ЯКОРЯ (anchor)
                            const distFromAnchor = Math.hypot(rec.x - anchor.x, rec.z - anchor.z);
                            return distFromAnchor <= maxDist;
                        });
                        if (hostiles.length > 0) {
                            hostiles.sort((a, b) => {
                                const losA = skills ? skills.hasLineOfSight(c.position, a) : true;
                                const losB = skills ? skills.hasLineOfSight(c.position, b) : true;
                                if (losA !== losB) return losA ? -1 : 1;
                                return Math.hypot(a.x - c.position.x, a.z - c.position.z) - Math.hypot(b.x - c.position.x, b.z - c.position.z);
                            });
                            tgt = hostiles[0];
                            combat.selectTarget(tgt);
                        }
                    }
                }
            }

            // If no target around in anchor radius -> Return to start anchor!
            if (!tgt) {
                if (this.combatRadius > 0 && Number.isFinite(this.combatRadius) && !this.questEnabled && !this.gatherEnabled) {
                    const distToAnchor = Math.hypot(anchor.x - c.position.x, anchor.z - c.position.z);
                    if (distToAnchor > 2.5) {
                        // Return smoothly to the starting point
                        this.navigateTowards(anchor.x, anchor.z);
                        return;
                    }
                }
                if (c.isMoving && !this.questEnabled && !this.gatherEnabled) {
                    c.stopMovement();
                }
                return;
            }

            const dist = Math.hypot(tgt.x - c.position.x, tgt.z - c.position.z);
            const allSkills = this.getAvailableSkills();
            const w = combat.weapon ? combat.weapon() : null;
            const isRangedWeapon = !!(w && (w.style === 'bow' || w.style === 'staff'));
            // Есть ли дальнобойные заклинания, готовые к касту прямо сейчас?
            const hasReadyRangedSpell = allSkills.some(s => (s.type === 'projectile' || s.type === 'strike' || s.type === 'rain') && skills.cooldownRemaining(s.id) === 0 && this.canAfford(s));
            // Дистанционный режим активен ТОЛЬКО если в руках дальнобойное оружие (посох/лук) ЛИБО готово заклинание дальнего боя
            const isRanged = isRangedWeapon || hasReadyRangedSpell;
            const targetHitR = (tgt.def && tgt.def.hitRadius) || 0.4;

            // Динамический расчет комфортной дистанции:
            // У посоха и боевых заклинаний дальность 20м (у лука 22м). Держим дистанцию ~18.5м (с запасом 1.5м на движение моба).
            let rangedDist = 18.5;
            if (isRangedWeapon && w && w.range) {
                rangedDist = Math.max(rangedDist, w.range - 1.5);
            }
            if (hasReadyRangedSpell) {
                const readySpells = allSkills.filter(s => (s.type === 'projectile' || s.type === 'strike' || s.type === 'rain') && skills.cooldownRemaining(s.id) === 0 && this.canAfford(s));
                const maxRange = Math.max(...readySpells.map(s => s.range || 20));
                rangedDist = Math.max(rangedDist, maxRange - 1.5);
            }

            // Для дальнего боя (посох/лук или готовые спеллы) держим ~18.5м, для ближнего боя — сближаемся вплотную
            const effectiveAttackRange = isRanged ? rangedDist : Math.max(1.6, ((w && w.range) || 1.2) + targetHitR);
            const hasLoS = skills ? skills.hasLineOfSight(c.position, tgt) : true;

            // If target is farther than effective attack distance OR line of sight is obstructed (walls, logs, boulders):
            if (dist > effectiveAttackRange || !hasLoS) {
                // If "На месте" (0m) mode: hero never chases targets
                if (this.combatRadius === 0) {
                    if (c.isMoving && !this.questEnabled && !this.gatherEnabled) c.stopMovement();
                    return;
                }

                // If target moved beyond the anchor combat radius with margin: drop target and return
                const distFromAnchor = Math.hypot(tgt.x - anchor.x, tgt.z - anchor.z);
                if (Number.isFinite(this.combatRadius) && distFromAnchor > this.combatRadius + 5.0) {
                    combat.clearTarget();
                    tgt = null;
                    return;
                }

                // Move towards target until within attack distance!
                this.navigateTowards(tgt.x, tgt.z);
                return;
            }

            // Target is within attack reach: halt walking to begin casting/attacking
            if (c.isMoving && !this.questEnabled && !this.gatherEnabled) {
                c.stopMovement();
            }

            // Smoothly turn to face the target when casting/fighting
            if (c.faceTowards) {
                c.faceTowards(tgt.x, tgt.z);
            }

            // Wait if currently casting or channeling
            if (skills && (skills.casting || skills.channel)) return;

            // 1. Defensive Buff / Shield (Metadata: s.type === 'buff' or 'defense')
            if (this.combatUseDefense) {
                const buffSkill = allSkills.find(s => (s.type === 'buff' || s.type === 'defense' || s.isDefense) && skills.cooldownRemaining(s.id) === 0 && this.canAfford(s));
                if (buffSkill && hero && this.isUnderThreat(tgt)) {
                    const buffId = (buffSkill.buff && buffSkill.buff.id) ? buffSkill.buff.id : buffSkill.id;
                    if (!hero.hasEffect(buffId)) {
                        if (skills.activate(buffSkill.id) === 'ok') return;
                    }
                }
            }

            // 2. Crowd Control / AoE: type nova (around hero) / rain (on the target area).
            const foes = (cr.list || []).filter(rec => cr.isAlive(rec) && (rec.aggro || rec === tgt));
            const around = (x, z, r) => foes.filter(rec => Math.hypot(rec.x - x, rec.z - z) <= r).length;
            for (const s of allSkills) {
                if (skills.cooldownRemaining(s.id) > 0 || !this.canAfford(s)) continue;
                if (s.type === 'nova') {
                    const novaR = (s.vfx && s.vfx.impactRadius) || s.impactRadius || s.radius || 10.0;
                    const countAround = around(c.position.x, c.position.z, novaR);
                    const isThreatClose = dist <= Math.min(5.0, novaR);
                    // Активируем нову (Огненную волну), если рядом 2+ врага ИЛИ цель подобралась в упор (<= 5м)
                    if (countAround >= 2 || isThreatClose) {
                        if (skills.activate(s.id) === 'ok') return;
                    }
                } else if (s.type === 'rain' && dist <= ((s.range || 20) + 1.5) && around(tgt.x, tgt.z, s.radius || 5.0) >= 3) {
                    if (skills.activate(s.id) === 'ok') return;
                }
            }

            // Movement skills (blink / dash) are deliberately NOT used by autobattle:
            // they jump along the hero's facing, i.e. straight into the enemy he is looking at.

            // 4. Single-target attacks (projectile / strike / melee), longest cooldown first:
            //    the shortest-cooldown spell naturally becomes the filler.
            const attacks = allSkills.filter(s => (s.type === 'strike' || s.type === 'projectile' || s.type === 'melee') && dist <= ((s.range || 20) + 1.5));
            attacks.sort((a, b) => (b.cooldown || 0) - (a.cooldown || 0));
            for (const attack of attacks) {
                if (skills.cooldownRemaining(attack.id) === 0 && this.canAfford(attack)) {
                    if (skills.activate(attack.id) === 'ok') return;
                }
            }

            // 5. Nothing to cast right now: plain weapon attack (or bare hands).
            if (!isRangedWeapon) {
                // Если в руках НЕ посох и НЕ лук (кулаки, меч, топор, кинжал):
                // Персонаж подходит вплотную и бьет кулаками / оружием!
                combat.performBasicAttack();
                return;
            }
            // Ranged hero (с посохом или луком): стреляет автоатакой с дистанции оружия
            const reach = (w && w.range) || 20;
            const edge = dist - ((tgt.def && tgt.def.hitRadius) || 0.4);
            const eng = combat.engagement;
            if (edge <= reach && !(eng && eng.rec === tgt)) combat.attackCreature(tgt);
        }

        // ---------------------------------------------------------------------
        // 2. AUTO-GATHER ENGINE (Gather / Mining / Logging / Drops)
        // ---------------------------------------------------------------------
        updateGather(delta) {
            const g = this.game;
            const ui = g.ui;
            if (ui && ((ui.isDialogOpen && ui.isDialogOpen()) || (ui.isChestOpen && ui.isChestOpen()))) return;

            // Player is steering manually: pause autopilot
            if (Date.now() - (this._lastManualAt || 0) < 1200) return;

            this._gatherTimer -= delta;
            if (this._gatherTimer > 0) return;
            this._gatherTimer = 0.2; // Evaluate decisions every 200ms

            const c = g.character;
            const combat = g.combat;
            const wo = g.worldObjects;
            const harvest = g.harvest;
            const st = g.gameState;
            if (!c || !combat) return;

            const now = Date.now();

            // Starting origin (anchor) and range limit
            if (!this.gatherAnchor && c.position) {
                this.gatherAnchor = { x: c.position.x, z: c.position.z };
            }
            const anchor = this.gatherAnchor || { x: c.position.x, z: c.position.z };
            const maxRadius = this.gatherRadius || 30.0;

            // Clean expired unreachable items
            if (this._unreachableObjects.size > 0) {
                for (const [id, until] of this._unreachableObjects.entries()) {
                    if (now >= until) this._unreachableObjects.delete(id);
                }
            }

            // Priority: If under active monster attack and auto-combat is ON, let combat handle defense
            const cr = g.creatures;
            if (cr && this.combatEnabled) {
                const attackers = (cr.list || []).filter(rec => cr.isAlive(rec) && rec.aggro && (rec.state === 'chase' || rec.state === 'attack'));
                if (attackers.length > 0) return;
            }

            // TREE FELLING CHECK: If a tree is currently falling within 8m, WAIT for it to land and drop loot!
            if (harvest && harvest.falling && harvest.falling.length > 0) {
                const nearbyFalling = harvest.falling.find(f => {
                    const d = Math.hypot(f.entry.x - c.position.x, f.entry.z - c.position.z);
                    return d < 8.0 && !f.landed;
                });
                if (nearbyFalling) {
                    if (c.isMoving) c.stopMovement();
                    return; // Pause 0.5-1.4s so we collect drops right under our feet!
                }
            }

            // Verify current active target
            if (this._currentGatherTarget) {
                const tgt = this._currentGatherTarget;
                const dist = Math.hypot(tgt.x - c.position.x, tgt.z - c.position.z);
                const reach = tgt.reach || 1.8;

                const isHarvestEngaged = combat.engagement && (combat.engagement.id === tgt.id || (tgt.type === 'pile' && combat.engagement.kind === 'gather'));
                const isWalkingToPile = tgt.type === 'pile' && wo && wo.pendingPileId === tgt.id;

                if (isHarvestEngaged || (isWalkingToPile && c.isMoving)) {
                    if (now - this._gatherTargetStartTime > 14000) {
                        this._unreachableObjects.set(tgt.id, now + 120000);
                        if (combat.engagement) combat.cancel();
                        if (wo && wo.cancelPending) wo.cancelPending();
                        if (c.isMoving) c.stopMovement();
                        this._currentGatherTarget = null;
                    }
                    return;
                }

                if (!c.isMoving && !isHarvestEngaged && !isWalkingToPile) {
                    if (dist > reach + 0.4) {
                        this._unreachableObjects.set(tgt.id, now + 120000);
                        if (combat.engagement) combat.cancel();
                        if (wo && wo.cancelPending) wo.cancelPending();
                        this._currentGatherTarget = null;
                    }
                }
            }

            if (combat.engagement) {
                const k = combat.engagement.kind;
                if (k === 'trees' || k === 'ores' || k === 'gather') return;
            }
            if (wo && wo.pendingPileId) return;

            this._currentGatherTarget = null;

            // Check inventory capacity
            const inv = st && st.inventory;
            const hasEmptyCells = inv ? inv.cells.some(cell => cell === null) : false;

            const px = c.position.x, pz = c.position.z;

            // -------------------------------------------------------------
            // PRIORITY 1: Ground loot / drops (piles)
            // -------------------------------------------------------------
            const pileCandidates = [];
            if (this.gatherConfig.loot && wo && wo.piles) {
                for (const [pileId, pile] of wo.piles.entries()) {
                    if (!pile || pile.remaining <= 0) continue;
                    if (this._unreachableObjects.has(pileId)) continue;

                    // Must be within gather radius from the starting anchor
                    const distFromAnchor = Math.hypot(pile.data.x - anchor.x, pile.data.z - anchor.z);
                    if (distFromAnchor > maxRadius) continue;

                    // Does the item fit into the bag?
                    if (inv && inv.spaceFor(pile.def.id) <= 0) continue;

                    const distFromPlayer = Math.hypot(pile.data.x - px, pile.data.z - pz);
                    pileCandidates.push({
                        type: 'pile',
                        pile,
                        id: pileId,
                        x: pile.data.x,
                        z: pile.data.z,
                        reach: 1.6,
                        dist: distFromPlayer,
                        rawDist: distFromPlayer
                    });
                }
            }

            // If there is ANY collectable loot on the ground within radius, pick it up first!
            if (pileCandidates.length > 0) {
                pileCandidates.sort((a, b) => a.dist - b.dist);
                const bestPile = this.findReachableGatherCandidate(pileCandidates, c);
                if (bestPile) {
                    this._currentGatherTarget = bestPile;
                    this._gatherTargetStartTime = now;
                    wo.requestPickup(bestPile.pile);
                    return;
                }
            }

            // -------------------------------------------------------------
            // PRIORITY 2: Resource nodes (trees, ores, ferns)
            // -------------------------------------------------------------
            const env = g.environment;
            const nodeCandidates = [];
            let anyNodeInRadius = false;
            let bagBlockedNodes = 0;

            if (env && env.objects && harvest) {
                for (const [objId, entry] of env.objects.entries()) {
                    if (!entry || entry.visible === false) continue;
                    if (this._unreachableObjects.has(objId)) continue;

                    const node = harvest.nodeFor(entry.kind);
                    if (!node) continue;

                    // Must be within gather radius from the starting anchor
                    const distFromAnchor = Math.hypot(entry.x - anchor.x, entry.z - anchor.z);
                    if (distFromAnchor > maxRadius) continue;

                    const s = entry.s || 1;
                    let reach = 1.8;
                    let canHarvestThis = false;

                    // 1. Herbs / Ferns
                    if (node.tool === 'gather' || entry.kind === 'ferns') {
                        if (!this.gatherConfig.herb) continue;
                        anyNodeInRadius = true;
                        if (!hasEmptyCells && inv && inv.spaceFor('fern') <= 0) {
                            bagBlockedNodes++;
                            continue;
                        }
                        reach = Math.max(1.3, 0.45 * s + 0.6);
                        canHarvestThis = true;
                    }
                    // 2. Ore / Stone
                    else if (node.tool === 'mine' || entry.kind === 'ores') {
                        if (!this.gatherConfig.ore) continue;
                        if (!harvest.hasTool(node) && !harvest.findToolInBag('mine')) continue;
                        anyNodeInRadius = true;
                        if (!hasEmptyCells && inv && inv.spaceFor('stone') <= 0) {
                            bagBlockedNodes++;
                            continue;
                        }
                        reach = Math.max(1.3, 0.6 * s + 0.9);
                        canHarvestThis = true;
                    }
                    // 3. Trees / Wood
                    else if (node.tool === 'chop' || entry.kind === 'trees') {
                        if (!this.gatherConfig.wood) continue;
                        if (!harvest.hasTool(node) && !harvest.findToolInBag('chop')) continue;
                        anyNodeInRadius = true;
                        if (!hasEmptyCells && inv && inv.spaceFor('log') <= 0) {
                            bagBlockedNodes++;
                            continue;
                        }
                        reach = Math.max(1.6, 0.8 * s + 0.95 - 0.3 * s);
                        canHarvestThis = true;
                    }

                    if (!canHarvestThis) continue;

                    const distFromPlayer = Math.hypot(entry.x - px, entry.z - pz);
                    nodeCandidates.push({
                        type: 'node',
                        entry,
                        node,
                        id: objId,
                        x: entry.x,
                        z: entry.z,
                        reach,
                        dist: distFromPlayer,
                        rawDist: distFromPlayer
                    });
                }
            }

            // Pick closest reachable resource node
            if (nodeCandidates.length > 0) {
                nodeCandidates.sort((a, b) => a.dist - b.dist);
                const bestNode = this.findReachableGatherCandidate(nodeCandidates, c);
                if (bestNode) {
                    this._currentGatherTarget = bestNode;
                    this._gatherTargetStartTime = now;
                    harvest.request(bestNode.entry);
                    return;
                }
            }

            // BAG FULL GUARD: If resources exist in radius but ALL are blocked because bag cannot hold their drops:
            if (anyNodeInRadius && bagBlockedNodes > 0 && nodeCandidates.length === 0 && pileCandidates.length === 0) {
                if (now - this._lastGatherMsgTime > 4000) {
                    this._lastGatherMsgTime = now;
                    if (ui && ui.floatText) {
                        ui.floatText('Сумка полна — автосбор остановлен', 'warn');
                    }
                    this.toggleGather(false); // Stop immediately instead of leaving loot behind!
                }
                return;
            }

            // NO TARGETS IN RADIUS: Return to starting anchor point and wait for respawns (if radius is finite)
            const distToAnchor = Math.hypot(anchor.x - px, anchor.z - pz);
            if (Number.isFinite(this.gatherRadius) && distToAnchor > 3.0) {
                this.navigateTowards(anchor.x, anchor.z);
            } else {
                if (c.isMoving && !this.questEnabled && !this.combatEnabled) {
                    c.stopMovement();
                }
            }
        }

        findReachableGatherCandidate(candidates, c) {
            const now = Date.now();
            for (let i = 0; i < candidates.length; i++) {
                const cand = candidates[i];
                if (this.game.pathfinder && cand.rawDist > cand.reach + 0.3) {
                    const path = this.game.pathfinder.findPath(c.position, { x: cand.x, z: cand.z });
                    if (!path || path.length === 0) {
                        this._unreachableObjects.set(cand.id, now + 120000);
                        continue;
                    }
                    const endPt = path[path.length - 1];
                    const endDist = Math.hypot(endPt.x - cand.x, endPt.z - cand.z);
                    if (endDist > cand.reach + 0.8) {
                        this._unreachableObjects.set(cand.id, now + 120000);
                        continue;
                    }
                }
                return cand;
            }
            return null;
        }
        // ---------------------------------------------------------------------
        // 3. AUTO-QUEST ENGINE
        // ---------------------------------------------------------------------
        updateQuest(delta) {
            const g = this.game;
            const st = g.gameState;
            if (!st) return;

            // User steering override: if user manually moves, pause auto-navigation
            if (Date.now() < this._manualMovePauseUntil) return;

            this._questTimer -= delta;
            if (this._questTimer > 0) return;
            this._questTimer = 0.20; // Check quest progress every 200ms

            const gc = window.GAME_CONTENT;
            const allQuests = (gc && gc.quests) || {};

            // 1. Find currently active quest
            let activeQuestDef = null;
            for (const [qid, status] of Object.entries(st.quests || {})) {
                if (status === 'active' && allQuests[qid]) {
                    activeQuestDef = allQuests[qid];
                    break;
                }
            }

            // 2. If NO active quest: find and accept the next available quest!
            if (!activeQuestDef) {
                activeQuestDef = this.findNextEligibleQuest();
                if (!activeQuestDef) {
                    // All quests are finished!
                    this.toggleQuest(false);
                    if (g.ui && g.ui.floatText) g.ui.floatText('Все доступные задания выполнены!', 'good');
                    return;
                }
                this.executeTakeQuest(activeQuestDef);
                return;
            }

            // 3. We have an active quest: check if ready to turn in
            const ready = this.isQuestReady(activeQuestDef);
            if (ready) {
                this.executeTurnInQuest(activeQuestDef);
            } else {
                this.executeQuestObjective(activeQuestDef, delta);
            }
        }

        /** Checks if active quest objectives are fulfilled using dialog.js questProgress */
        isQuestReady(qDef) {
            const ui = this.game.ui;
            if (ui && ui.dialog && typeof ui.dialog.questProgress === 'function') {
                const prog = ui.dialog.questProgress(qDef);
                return !!(prog && prog.ready);
            }
            // Fallback manual check
            const st = this.game.gameState;
            if (!st || !qDef || !qDef.objective) return false;
            const obj = qDef.objective;
            if (obj.type === 'kill') {
                return (st.questKills && st.questKills[qDef.id]) >= (obj.count || 1);
            } else if (obj.type === 'gather' || obj.type === 'collect') {
                return (st.inventory ? st.inventory.count(obj.item) : 0) >= (obj.count || 1);
            }
            return false;
        }

        /** Returns the creature type needed for current active kill quest (or null) */
        getHuntCreatureType() {
            const st = this.game.gameState;
            const allQuests = (window.GAME_CONTENT && window.GAME_CONTENT.quests) || {};
            for (const [qid, status] of Object.entries(st.quests || {})) {
                if (status === 'active' && allQuests[qid]) {
                    const qDef = allQuests[qid];
                    if (qDef.objective && qDef.objective.type === 'kill' && !this.isQuestReady(qDef)) {
                        return qDef.objective.creature;
                    }
                }
            }
            return null;
        }

        /** Moves to NPC, opens dialog, and accepts quest */
        executeTakeQuest(qDef) {
            const giverId = qDef.giver;
            const npcInfo = this.findNpcLocation(giverId);
            if (!npcInfo) return;

            const g = this.game;
            // If NPC is on another location, path to exit portal
            if (npcInfo.locId !== this.curLocId()) {
                this.navigateToLocation(npcInfo.locId);
                return;
            }

            const c = g.character;
            const dist = Math.hypot(npcInfo.x - c.position.x, npcInfo.z - c.position.z);
            if (dist > 3.4) {
                // Navigate to an approach point 1.6m from NPC so target is outside obstacle
                const angle = Math.atan2(c.position.z - npcInfo.z, c.position.x - npcInfo.x);
                const ax = npcInfo.x + Math.cos(angle) * 1.6;
                const az = npcInfo.z + Math.sin(angle) * 1.6;
                this.navigateTowards(ax, az);
            } else {
                c.stopMovement();
                c.faceTowards(npcInfo.x, npcInfo.z);
                this.interactNpc(giverId, 'questAccept', qDef.id);
            }
        }

        /** Moves to NPC, opens dialog, and turns in quest */
        executeTurnInQuest(qDef) {
            const turnInNpcId = qDef.turnInNpc || qDef.giver;
            const npcInfo = this.findNpcLocation(turnInNpcId);
            if (!npcInfo) return;

            const g = this.game;
            if (npcInfo.locId !== this.curLocId()) {
                this.navigateToLocation(npcInfo.locId);
                return;
            }

            const c = g.character;
            const dist = Math.hypot(npcInfo.x - c.position.x, npcInfo.z - c.position.z);
            if (dist > 3.4) {
                const angle = Math.atan2(c.position.z - npcInfo.z, c.position.x - npcInfo.x);
                const ax = npcInfo.x + Math.cos(angle) * 1.6;
                const az = npcInfo.z + Math.sin(angle) * 1.6;
                this.navigateTowards(ax, az);
            } else {
                c.stopMovement();
                c.faceTowards(npcInfo.x, npcInfo.z);
                this.interactNpc(turnInNpcId, 'questTurnIn', qDef.id);
            }
        }

        /** Executes quest objectives (kill or gather) */
        executeQuestObjective(qDef, delta) {
            const obj = qDef.objective;
            const g = this.game;
            const c = g.character;

            if (obj.type === 'kill') {
                const cr = g.creatures;
                // Find nearest alive target of needed type
                const aliveList = (cr.list || []).filter(rec => cr.isAlive(rec) && rec.type === obj.creature);
                if (aliveList.length > 0) {
                    aliveList.sort((a, b) => Math.hypot(a.x - c.position.x, a.z - c.position.z) - Math.hypot(b.x - c.position.x, b.z - c.position.z));
                    const targetMob = aliveList[0];
                    const dist = Math.hypot(targetMob.x - c.position.x, targetMob.z - c.position.z);

                    if (dist > 14.0) {
                        this.navigateTowards(targetMob.x, targetMob.z);
                    } else {
                        // In spell range: stop and engage via combat rotation!
                        c.stopMovement();
                        g.combat.selectTarget(targetMob);
                        this.updateCombat(delta, targetMob);
                    }
                } else {
                    // No live creature of this type here -> walk to their grounds (maybe via another location)
                    const spawnPos = this.findCreatureSpawnPosition(obj.creature);
                    if (spawnPos) {
                        this.navigateTowards(spawnPos.x, spawnPos.z);
                    } else {
                        const loc = this.findCreatureLocation(obj.creature);
                        if (loc && loc !== this.curLocId()) this.navigateToLocation(loc);
                    }
                }
            } else if (obj.type === 'gather' || obj.type === 'collect') {
                // Objective: gather or collect item for quest
                const needItem = obj.item;
                const env = g.environment, harvest = g.harvest, wo = g.worldObjects;
                const px = c.position.x, pz = c.position.z;

                // Priority 1: Ground drop piles with needed item
                let bestTarget = null, bestDist = Infinity;
                if (wo && wo.piles) {
                    for (const [pileId, pile] of wo.piles.entries()) {
                        if (!pile || pile.remaining <= 0 || pile.def.id !== needItem) continue;
                        const dist = Math.hypot(pile.data.x - px, pile.data.z - pz);
                        if (dist < bestDist) { bestDist = dist; bestTarget = { type: 'pile', pile }; }
                    }
                }
                // Priority 2: Resource nodes that drop needed item
                if (!bestTarget && env && env.objects && harvest) {
                    for (const [id, entry] of env.objects.entries()) {
                        if (!entry || entry.visible === false) continue;
                        const node = harvest.nodeFor(entry.kind);
                        if (!node) continue;
                        const drops = node.drops || [];
                        if (drops.some(d => d.item === needItem)) {
                            const dist = Math.hypot(entry.x - px, entry.z - pz);
                            if (dist < bestDist) { bestDist = dist; bestTarget = { type: 'node', entry }; }
                        }
                    }
                }

                if (bestTarget) {
                    if (bestTarget.type === 'pile') wo.requestPickup(bestTarget.pile);
                    else harvest.request(bestTarget.entry);
                } else {
                    this.toggleQuest(false);
                    if (g.ui && g.ui.floatText) g.ui.floatText('Автоквест: «' + qDef.name + '» не найдены ресурсы рядом', 'warn');
                }
            } else {
                this.toggleQuest(false);
                if (g.ui && g.ui.floatText) g.ui.floatText('Автоквест: «' + qDef.name + '» нужно выполнить вручную', 'warn');
            }
        }

        /** Interacts with NPC dialog to accept or complete a quest */
        interactNpc(npcId, action, questId) {
            const now = Date.now();
            if (now < this._dialogCooldown) return;
            this._dialogCooldown = now + 800;

            const g = this.game;
            const ui = g.ui;
            const dialog = ui && ui.dialog;
            const npcObj = this.findNpcInstance(npcId);

            if (action === 'questAccept') {
                if (dialog) {
                    if (!dialog.panel || !dialog.panel.classList.contains('open')) {
                        if (npcObj) ui.openDialog(npcObj);
                    }
                    dialog.choose({ action: 'questAccept', quest: questId });
                }
                // Direct guarantee: activate quest in gameState so the hero proceeds immediately
                if (g.gameState && g.gameState.questStatus(questId) !== 'active') {
                    g.gameState.startQuest(questId);
                    if (ui && ui.floatText) ui.floatText('Новое задание', 'good');
                    if (dialog && dialog.updateTracker) dialog.updateTracker();
                }
                if (dialog && dialog.close) {
                    setTimeout(() => dialog.close(), 350);
                }
            } else if (action === 'questTurnIn') {
                if (dialog) {
                    if (!dialog.panel || !dialog.panel.classList.contains('open')) {
                        if (npcObj) ui.openDialog(npcObj);
                    }
                    dialog.choose({ action: 'questTurnIn', quest: questId });
                    setTimeout(() => {
                        if (dialog.mode === 'reward') dialog.choose({ action: 'close' });
                        else dialog.close();
                    }, 400);
                }
            }
        }

        // ---------------------------------------------------------------------
        // 3. NAVIGATION & DATA LOOKUPS
        // ---------------------------------------------------------------------
        navigateTowards(tx, tz) {
            const g = this.game;
            const c = g.character;
            if (!c || !g.pathfinder) return;

            const now = Date.now();
            if (this._lastNavPoint && Math.hypot(this._lastNavPoint.x - tx, this._lastNavPoint.z - tz) < 2.5 && now < this._nextPathTime) {
                return;
            }
            this._nextPathTime = now + 1200;
            this._lastNavPoint = { x: tx, z: tz };

            const path = g.pathfinder.findPath(c.position, { x: tx, z: tz });
            if (path && path.length > 0) {
                c.setPath(path);
            }
        }

        /** First exit of the current location on the shortest route to targetLoc (BFS over LOCATIONS[*].exits). */
        navigateToLocation(targetLoc) {
            const locs = window.LOCATIONS || {};
            const from = this.curLocId();
            if (!from || !locs[from] || from === targetLoc) return;
            const prev = { [from]: null };
            const queue = [from];
            while (queue.length) {
                const cur = queue.shift();
                if (cur === targetLoc) break;
                for (const ex of ((locs[cur] && locs[cur].exits) || [])) {
                    if (ex.to && !(ex.to in prev) && locs[ex.to]) { prev[ex.to] = { from: cur, ex }; queue.push(ex.to); }
                }
            }
            if (!(targetLoc in prev)) return;
            let step = prev[targetLoc];
            while (step && step.from !== from) step = prev[step.from];
            if (step && step.ex) this.navigateTowards(step.ex.x, step.ex.z);
        }

        findNpcLocation(npcId) {
            const locs = window.LOCATIONS || {};
            const gc = window.GAME_CONTENT;
            for (const [locId, locDef] of Object.entries(locs)) {
                for (const p of (locDef.props || [])) {
                    const propDef = gc && gc.props && gc.props[p.prop];
                    if (propDef && propDef.npc === npcId) {
                        return { locId, x: p.x, z: p.z, propId: p.id };
                    }
                }
            }
            return null;
        }

        findNpcInstance(npcId) {
            const wo = this.game.worldObjects;
            if (wo && wo.props) {
                for (const p of wo.props) {
                    if (p.npc && p.npc.id === npcId) return p.npc;
                }
            }
            return (window.GAME_CONTENT && window.GAME_CONTENT.npcs && window.GAME_CONTENT.npcs[npcId]) || null;
        }

        findCreatureSpawnPosition(type) {
            const locDef = window.LOCATIONS && window.LOCATIONS[this.curLocId()];
            const match = locDef && (locDef.creatures || []).find(sp => sp.type === type);
            return match ? { x: match.x, z: match.z } : null;
        }

        /** Location id whose creature list contains the type (current location first). */
        findCreatureLocation(type) {
            const locs = window.LOCATIONS || {};
            const cur = this.curLocId();
            if (locs[cur] && (locs[cur].creatures || []).some(sp => sp.type === type)) return cur;
            for (const [id, def] of Object.entries(locs)) {
                if ((def.creatures || []).some(sp => sp.type === type)) return id;
            }
            return null;
        }

        findNextEligibleQuest() {
            const st = this.game.gameState;
            const gc = window.GAME_CONTENT;
            const allQuests = (gc && gc.quests) || {};
            const curLoc = this.curLocId();
            const dialog = this.game.ui && this.game.ui.dialog;

            const candidates = [];
            for (const [qid, q] of Object.entries(allQuests)) {
                if (st.quests && (st.quests[qid] === 'done' || st.quests[qid] === 'active')) continue;

                // Use dialog's questAvailable logic (handles both array and string requires)
                const available = dialog ? dialog.questAvailable(q) : this._checkRequires(q, st);
                if (!available) continue;

                const npcLoc = this.findNpcLocation(q.giver);
                candidates.push({ qid, def: q, npcLoc });
            }

            if (candidates.length === 0) return null;

            // Sort: 1) Same location first, 2) Lowest level
            candidates.sort((a, b) => {
                const aSameLoc = (a.npcLoc && a.npcLoc.locId === curLoc) ? 0 : 1;
                const bSameLoc = (b.npcLoc && b.npcLoc.locId === curLoc) ? 0 : 1;
                if (aSameLoc !== bSameLoc) return aSameLoc - bSameLoc;
                return (a.def.level || 1) - (b.def.level || 1);
            });

            return candidates[0].def;
        }

        _checkRequires(q, st) {
            if (!q.requires) return true;
            if (Array.isArray(q.requires)) {
                return q.requires.every(req => st.questStatus(req) === 'done');
            }
            return st.questStatus(q.requires) === 'done';
        }
    }

    window.AveloraAutoPlay = AveloraAutoPlay;
})();
