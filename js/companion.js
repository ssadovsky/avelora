/**
 * companion.js — проводница героя: Вейра, наставница лучников, ведёт героя к порталу в Рунные земли.
 *
 * Сюжет: диалог Вейры «Что ты знаешь о ездовых животных?» → «Отведи меня» (действие `companion_escort`).
 * Режимы актёра:
 *   lead   — она идёт к выходу локации (портал в Рунные земли), герой сам идёт за ней (автопилот героя).
 *            Если игрок кликнет или пойдёт сам (мышь/WASD/действие), управление возвращается героя, она идёт домой.
 *            Пока ведёт, стреляет по нападающим зверям (залп с уроном по области); ждёт героя, если он отстал.
 *   bye    — остановилась за несколько метров до портала, диалог-прощание (узел `farewell`).
 *   return — идёт обратно на своё место у полигона; когда дошла, актёр убирается, статичная Вейра снова видна.
 * В сохранение ничего не пишется: перезагрузка или смена локации прерывает сопровождение, Вейра на своём месте.
 *
 * Актёр создаётся по запросу (main.js: new AveloraCompanion(game, loc), update(delta), dispose()),
 * клик/подсветка/диалог идут через worldObjects.registerContainer, как у обычного NPC.
 * Конфиг CFG ниже.
 */
(function () {
    'use strict';

    const CFG = {
        archer_mentor: {
            npc: 'archer_mentor',
            home: { loc: 'forestEdge', propId: 'forestEdge.archer_mentor' },
            exitTo: 'runeLands',          // ведёт к выходу этой локации (портал); останавливается за stopDist метров до него
            stopDist: 4.8,
            flag: 'veyra_escort',         // временный флаг (в сохранение не пишем): пока актёр жив, пункт «Отведи меня» скрыт
            bow: 'elven_bow',
            // те же хват и поза лука, что у героя-лучника Изумрудного рига (characters.js: handGrip, items hold.emeraldRanger)
            handGrip: { position: [-0.026, 0.085, -0.005], rotation: [-0.2468, 1.1758, 1.277] },
            shot: { cooldown: 2.4, range: 20, heroRange: 24, aoe: 5.5, windup: 0.55, arrowSpeed: 46 },
            leadSpeed: 4.8, walkSpeed: 4.6, walkAnimScale: 1.15, waitFar: 7.5, waitNear: 4.2, heroGap: 2.0, lostDist: 45, lostTime: 15
        }
    };

    const _Y = new THREE.Vector3(0, 1, 0);

    function normAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

    class AveloraCompanion {
        constructor(game, loc) {
            this.game = game;
            this.loc = loc;
            this.disposed = false;
            this.actors = [];
            this.arrows = [];
            this.myPath = null;       // путь, который выдали герою мы (отличие = игрок взял управление)
            this.lastHeroPath = -99;
            this.heroSpeed = null;    // { set }: героя на время пути притормаживаем до её скорости (не убегает вперёд, меньше стоп-старта)
            this.clock = 0;
            this.graceT = 0;
            Object.keys(CFG).forEach(id => this.setFlag(id, false));   // устаревший флаг из сохранения
        }

        setFlag(id, v) {
            const st = this.game.gameState;
            if (st && st.questFlags) st.questFlags[CFG[id].flag] = !!v;   // без save(): флаг временный
        }

        actorOf(id) { return this.actors.find(a => a.id === id) || null; }

        /** Действие диалога `companion_escort`. */
        beginEscort(id) {
            const c = CFG[id];
            if (!c || this.disposed || this.loc.id !== c.home.loc || this.actorOf(id)) return;
            const wo = this.game.worldObjects;
            const rec = wo && wo.props.find(r => r.id === c.home.propId);
            if (!rec || !rec.model) return;
            const ex = (this.loc.exits || []).find(e => e.to === c.exitTo);
            if (!ex) return;
            const home = { x: rec.x, z: rec.z, yaw: rec.model.rotation.y, rec };
            rec.model.visible = false;   // статичная Вейра на время пути скрыта
            const j = wo.containerProxies.indexOf(rec.proxy);
            if (j >= 0) wo.containerProxies.splice(j, 1);
            this.setFlag(id, true);
            this.capHeroSpeed(c);
            if (this.game.character.isMoving) this.game.character.stopMovement();
            this.myPath = null;
            this.graceT = 0.8;
            this.spawn(id, { x: rec.x, z: rec.z, yaw: home.yaw }, home, ex);
        }

        // -------------------------------------------------------- создание актёра
        spawn(id, pos, home, ex) {
            const c = CFG[id];
            const npc = window.GAME_CONTENT && window.GAME_CONTENT.npcs && window.GAME_CONTENT.npcs[c.npc];
            const fail = () => { this.restoreStatic(home); this.setFlag(id, false); };
            if (!npc || !npc.modelKey) { fail(); return; }
            const run = () => {
                if (this.disposed) return;
                const buffer = window.LakesideEnvironment && window.LakesideEnvironment.getModelBuffer(npc.modelKey);
                if (!buffer) { fail(); return; }
                new THREE.GLTFLoader().parse(buffer, '', gltf => {
                    if (this.disposed) return;
                    try { this.build(id, pos, home, ex, gltf, npc); } catch (e) { console.warn('[Avelora] companion build failed', e); fail(); }
                }, err => { console.warn('[Avelora] companion model failed', err); fail(); });
            };
            if (window.AveloraAssets) window.AveloraAssets.ensure(npc.modelKey).then(run); else run();
        }

        build(id, pos, home, ex, gltf, npc) {
            const g = this.game, c = CFG[id], wo = g.worldObjects;
            if (!wo || !g.terrain) return;
            const model = gltf.scene;
            if (window.AveloraColor) window.AveloraColor.srgb(model);
            const box = new THREE.Box3().setFromObject(model);
            const target = npc.height || 1.75;
            const k = target / Math.max(0.01, box.max.y - box.min.y);
            model.scale.setScalar(k);
            model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
            model.position.y = -box.min.y * k;
            const holder = new THREE.Group();
            holder.name = 'companion:' + id;
            holder.add(model);
            wo.root.add(holder);

            const mixer = new THREE.AnimationMixer(model);
            const actions = {};
            (gltf.animations || []).forEach(cl => { actions[cl.name] = mixer.clipAction(cl); });

            const rec = {
                id: 'companion:' + id, prop: 'companion', x: pos.x, z: pos.z, s: 1, rotY: pos.yaw, r: 0.5, h: target, object: null,
                blocks: false, npc, def: null, model: holder
            };
            const HC = (window.AVELORA_HIT && window.AVELORA_HIT.container) || { minRadius: 0.6, minHeight: 0.9 };
            const rr = Math.max(HC.minRadius, rec.r);
            const pg = new THREE.CylinderGeometry(rr, rr, Math.max(HC.minHeight, target), 10, 1);
            pg.translate(0, Math.max(HC.minHeight, target) / 2, 0);
            const proxy = new THREE.Mesh(pg, window.AveloraWorldObjects.proxyMaterial());
            proxy.userData.containerId = rec.id;
            wo.root.add(proxy);
            rec.proxy = proxy;
            wo.registerContainer(rec, proxy);

            const a = {
                id, cfg: c, npc, rec, holder, model, mixer, actions, proxy, mode: 'lead', x: pos.x, z: pos.z, yaw: pos.yaw,
                home, exit: { x: ex.x, z: ex.z },
                cur: '', animLock: 0, path: null, pathIdx: 0, lastPath: -99, pathGoal: { x: 1e9, z: 1e9 },
                shotCd: 1.5, shot: null, talkWas: false, switchT: 0, bowHolder: null, t: 0,
                waiting: false, lostT: 0, byeOpened: false, done: false
            };
            holder.position.set(pos.x, g.terrain.getHeightAt(pos.x, pos.z), pos.z);
            holder.rotation.y = pos.yaw;
            this.actors.push(a);
            this.play(a, 'Idle', 0);
            if (c.bow) this.attachBow(a);
        }

        attachBow(a) {
            const items = window.AveloraItems, c = a.cfg;
            const def = items && items.get(c.bow);
            if (!def) return;
            items.parseModel(def.modelKey, scene => {
                if (this.disposed || !this.actors.includes(a)) return;
                const variants = items.splitVariants(scene);
                let obj = variants[0] || items.makeFallback('held', c.bow);
                items.setShadows(obj, true, false);
                const hold = def.hold && def.hold.emeraldRanger;
                if (hold && hold.rotation) {
                    const gr = new THREE.Group(); gr.add(obj);
                    gr.rotation.set(hold.rotation[0] || 0, hold.rotation[1] || 0, hold.rotation[2] || 0);
                    obj = gr;
                }
                let bone = null;
                a.model.traverse(o => { if (o.isBone && /RightHand$/.test(o.name)) bone = o; });
                if (!bone) return;
                a.model.updateMatrixWorld(true);
                const ws = new THREE.Vector3(); bone.getWorldScale(ws);
                const h = new THREE.Group(); h.name = 'companion-bow'; h.add(obj);
                h.scale.set(1 / (ws.x || 1), 1 / (ws.y || 1), 1 / (ws.z || 1));
                const gp = c.handGrip.position, gr = c.handGrip.rotation;
                h.position.set(gp[0] / (ws.x || 1), gp[1] / (ws.y || 1), gp[2] / (ws.z || 1));
                h.rotation.set(gr[0], gr[1], gr[2]);
                bone.add(h);
                a.bowHolder = h;
                h.visible = a.mode === 'lead' || a.mode === 'bye';
            });
        }

        play(a, name, fade) {
            const act = a.actions[name];
            if (!act || a.cur === name) return;
            const prev = a.actions[a.cur];
            act.reset(); act.setLoop(THREE.LoopRepeat, Infinity); act.clampWhenFinished = false;
            act.timeScale = name === 'Walking' ? (a.cfg.walkAnimScale || 1) : 1;
            act.play();
            if (prev && fade > 0) act.crossFadeFrom(prev, fade, false); else if (prev) prev.stop();
            a.cur = name;
        }

        // -------------------------------------------------------- движение
        stepToward(a, tx, tz, speed, dt) {
            const g = this.game, pf = g.pathfinder;
            let dx = tx - a.x, dz = tz - a.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.05) return true;
            let sx = tx, sz = tz;
            const los = !pf || pf.hasLineOfSightWorld(a.x, a.z, tx, tz);
            if (!los) {
                const now = this.clock;
                if (!a.path || (now - a.lastPath > 0.8 && Math.hypot(tx - a.pathGoal.x, tz - a.pathGoal.z) > 1.2) || now - a.lastPath > 4) {
                    a.path = pf.findPath({ x: a.x, z: a.z }, new THREE.Vector3(tx, 0, tz));
                    a.pathIdx = 0; a.lastPath = now; a.pathGoal.x = tx; a.pathGoal.z = tz;
                }
                const p = a.path;
                while (p && a.pathIdx < p.length && Math.hypot(p[a.pathIdx].x - a.x, p[a.pathIdx].z - a.z) < 0.35) a.pathIdx++;
                if (p && a.pathIdx < p.length) { sx = p[a.pathIdx].x; sz = p[a.pathIdx].z; }
                else if (p && p.length === 0) return true;   // пути нет — остаётся на месте
            } else a.path = null;
            dx = sx - a.x; dz = sz - a.z;
            const d = Math.hypot(dx, dz);
            if (d < 1e-4) return false;
            const step = Math.min(d, speed * dt);
            const nx = a.x + dx / d * step, nz = a.z + dz / d * step;
            if (!pf || pf.isWalkableWorld(nx, nz) || !pf.isWalkableWorld(a.x, a.z)) { a.x = nx; a.z = nz; }
            else a.lastPath = -99;   // упёрлась — пересчитать путь
            const want = Math.atan2(dx, dz);
            a.yaw += normAngle(want - a.yaw) * Math.min(1, dt * 9);
            return false;
        }

        /** true, если за 2.5 с расстояние до цели не сократилось хотя бы на 0.4 м (застряла). */
        stuck(a, d, dt) {
            if (!a.prog || d < a.prog.d - 0.4) { a.prog = { d, t: 0 }; return false; }
            a.prog.t += dt;
            return a.prog.t > 2.5;
        }

        faceTo(a, x, z, dt, rate) {
            const want = Math.atan2(x - a.x, z - a.z);
            a.yaw += normAngle(want - a.yaw) * Math.min(1, dt * (rate || 8));
        }

        // -------------------------------------------------------- бой (только пока она ведёт)
        findTarget(a) {
            const g = this.game, cr = g.creatures, hero = g.character.position, sc = a.cfg.shot;
            if (!cr || !cr.list) return null;
            let best = null, bd = 1e9;
            for (let i = 0; i < cr.list.length; i++) {
                const r = cr.list[i];
                if (!cr.isTargetable(r) || !r.aggro) continue;
                if (r.rank === 'boss' || r.rank === 'elite') continue;
                if (Math.hypot(r.x - hero.x, r.z - hero.z) > sc.heroRange) continue;
                const da = Math.hypot(r.x - a.x, r.z - a.z);
                if (da > sc.range || da >= bd) continue;
                best = r; bd = da;
            }
            return best;
        }

        fireArrow(a, rec) {
            const g = this.game, wo = g.worldObjects;
            if (!wo) return;
            const from = new THREE.Vector3(a.x + Math.sin(a.yaw) * 0.4, g.terrain.getHeightAt(a.x, a.z) + 1.35, a.z + Math.cos(a.yaw) * 0.4);
            const to = new THREE.Vector3(rec.x, (rec.y || 0) + (rec.height || 1) * 0.5, rec.z);
            const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
            const grp = new THREE.Group();
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), new THREE.MeshBasicMaterial({ color: 0xe9ddb0 }));
            const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), new THREE.MeshBasicMaterial({ color: 0xbfe8ff }));
            head.position.y = 0.55;
            const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x9be36b, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
            grp.add(shaft, head, glow);
            grp.quaternion.setFromUnitVectors(_Y, dir);
            grp.position.copy(from);
            wo.root.add(grp);
            this.arrows.push({ grp, dir, left: len, speed: a.cfg.shot.arrowSpeed, to, cfgShot: a.cfg.shot });
        }

        impact(arrow) {
            const g = this.game, cr = g.creatures, p = arrow.to, R = arrow.cfgShot.aoe;
            try {   // эффект: взрыв стрелы + кольцо вспышек по радиусу залпа
                const sk = g.skills, def = sk && sk.get('arrow_rain');
                if (def && sk.spawnImpact) {
                    const col = new THREE.Color(0x9be36b);
                    sk.spawnImpact(def, p, col, true);
                    for (let i = 0; i < 6; i++) {
                        const an = i / 6 * Math.PI * 2, rr = R * 0.6;
                        const qx = p.x + Math.cos(an) * rr, qz = p.z + Math.sin(an) * rr;
                        sk.spawnImpact(def, new THREE.Vector3(qx, g.terrain.getHeightAt(qx, qz) + 0.1, qz), col, true);
                    }
                }
            } catch (e) { /* эффект необязателен */ }
            if (!cr || !cr.list) return;
            for (let i = 0; i < cr.list.length; i++) {
                const r = cr.list[i];
                if (!cr.isTargetable(r)) continue;
                if (r.rank === 'boss' || r.rank === 'elite') continue;
                if (Math.hypot(r.x - p.x, r.z - p.z) > R) continue;
                cr.damage(r, Math.max(9999, r.hp * 2), 'companion');
            }
        }

        // -------------------------------------------------------- автопилот героя
        /** Игрок взял управление (клик, WASD, действие) → герой свободен, она идёт домой. */
        playerTookOver(hero) {
            if (this.graceT > 0) return false;                               // сразу после старта герой ещё может дотаптывать прежний путь
            if (hero.isMoving && hero.path !== this.myPath) return true;      // чужой путь (клик), WASD или переход к цели
            if (hero.isCasting) return true;                                  // игрок применил умение
            return false;
        }

        driveHero(a, dt) {
            const g = this.game, hero = g.character, pf = g.pathfinder;
            if (g.isTransitioning || !pf) return;
            if (this.playerTookOver(hero)) { this.release(a); return; }
            this.capHeroSpeed(a.cfg);
            const dx = a.x - hero.position.x, dz = a.z - hero.position.z, d = Math.hypot(dx, dz);
            const near = a.cfg.heroGap + 0.4, far = a.cfg.heroGap + 2.2;   // гистерезис: остановился у неё, снова пошёл, когда она ушла на ~4 м
            const going = hero.isMoving && hero.path === this.myPath;
            if (d > (going ? near : far)) {
                if (!going || this.clock - this.lastHeroPath > 0.5) {
                    const k = (d - a.cfg.heroGap) / (d || 1);   // точка в heroGap от неё по линии к герою
                    const tx = hero.position.x + dx * k, tz = hero.position.z + dz * k;
                    let wp = pf.findPath(hero.position, new THREE.Vector3(tx, 0, tz));
                    if (wp && wp.length) wp = this.trimPath(wp, hero.position.x, hero.position.z, tx, tz);
                    if (wp && wp.length) {
                        if (!going) { this.myPath = wp; hero.setPath(wp); }
                        else {   // герой уже бежит: подменяем точки пути на месте, без нового setPath (иначе анимация бега перезапускается — дрожь)
                            const arr = this.myPath; arr.length = 0;
                            for (let i = 0; i < wp.length; i++) arr.push(wp[i]);
                            hero.currentWaypointIdx = 0;
                        }
                    }
                    this.lastHeroPath = this.clock;
                }
            } else if (going) {
                hero.stopMovement();
                this.myPath = null;
            }
        }

        /** Герой (в том числе верхом: 8.5 м/с) идёт её скоростью: иначе он обгоняет, останавливается, снова трогается (стоп-старт, наклон седока и дрожь скакуна). Скакун при спешивании/посадке сам ставит moveSpeed. */
        capHeroSpeed(c) {
            const hh = this.game.character;
            if (hh.moveSpeed > c.leadSpeed) {
                if (!this.heroSpeed) this.heroSpeed = { orig: hh.moveSpeed, set: c.leadSpeed };
                else this.heroSpeed.orig = Math.max(this.heroSpeed.orig, hh.moveSpeed);
                this.heroSpeed.set = c.leadSpeed;
                hh.moveSpeed = c.leadSpeed;
            }
        }

        /** Из пути убираем первые точки рядом с героем и позади него: иначе он на каждой подмене разворачивается к точке за спиной. */
        trimPath(wp, hx, hz, tx, tz) {
            const fx = tx - hx, fz = tz - hz, out = [];
            for (let i = 0; i < wp.length; i++) {
                const p = wp[i], ddx = p.x - hx, ddz = p.z - hz, dd = Math.hypot(ddx, ddz);
                if (i < wp.length - 1 && (dd < 1.1 || (dd < 3 && ddx * fx + ddz * fz < 0))) continue;
                out.push(p);
            }
            return out.length ? out : [wp[wp.length - 1]];
        }

        restoreHeroSpeed() {
            const hs = this.heroSpeed, hero = this.game.character;
            this.heroSpeed = null;
            if (hs && hero && hero.moveSpeed === hs.set) hero.moveSpeed = hs.orig;   // скакун сам поменял скорость — не трогаем
        }

        release(a) {
            this.myPath = null;
            this.restoreHeroSpeed();
            if (a.mode === 'lead' || a.mode === 'bye') { a.mode = 'return'; a.prog = null; a.shot = null; a.waiting = false; a.path = null; a.animLock = 0; a.switchT = 0; if (a.bowHolder) a.bowHolder.visible = false; }
        }

        // -------------------------------------------------------- кадр
        update(delta) {
            if (this.disposed) return;
            const dt = Math.min(delta || 0, 0.1);
            if (!dt) return;
            this.clock += dt;
            if (this.graceT > 0) this.graceT -= dt;
            for (let i = this.actors.length - 1; i >= 0; i--) {
                const a = this.actors[i];
                this.updateActor(a, dt);
                if (a.done) this.finish(a);
            }
            for (let i = this.arrows.length - 1; i >= 0; i--) {
                const ar = this.arrows[i], step = ar.speed * dt;
                if (step >= ar.left) {
                    ar.grp.parent && ar.grp.parent.remove(ar.grp);
                    this.arrows.splice(i, 1);
                    this.impact(ar);
                } else { ar.grp.position.addScaledVector(ar.dir, step); ar.left -= step; }
            }
        }

        updateActor(a, dt) {
            const g = this.game, c = a.cfg, hero = g.character.position;
            a.t += dt;
            const dlg = g.ui && g.ui.dialog;
            const dlgOpen = !!(dlg && dlg.isOpen && dlg.isOpen());
            const talking = dlgOpen && dlg.npc === a.npc;
            const dh = Math.hypot(hero.x - a.x, hero.z - a.z);
            let moving = false;

            if (a.mode === 'bye' && a.byeOpened && !talking) this.release(a);   // попрощались (диалог закрыт) → домой

            if (talking) {
                this.faceTo(a, hero.x, hero.z, dt, 6);
                if (!a.talkWas && a.mode !== 'bye' && a.actions.Agree_Gesture) {
                    this.play(a, 'Agree_Gesture', 0.2);
                    a.animLock = Math.min(2.6, a.actions.Agree_Gesture.getClip().duration);
                }
                a.shot = null;
            } else {
                if (a.animLock > 0) a.animLock -= dt;
                if (a.mode === 'lead') {
                    this.driveHero(a, dt);
                    if (a.mode === 'lead') {   // driveHero мог вернуть управление
                        const dEx = Math.hypot(a.exit.x - a.x, a.exit.z - a.z);
                        a.shotCd -= dt;
                        if (dh > c.lostDist) { a.lostT += dt; if (a.lostT > c.lostTime) this.release(a); } else a.lostT = 0;
                        if (a.shot) {
                            a.shot.t += dt;
                            this.faceTo(a, a.shot.rec.x, a.shot.rec.z, dt, 14);
                            if (!a.shot.fired && a.shot.t >= c.shot.windup) {
                                a.shot.fired = true;
                                if (g.creatures && g.creatures.isAlive(a.shot.rec)) this.fireArrow(a, a.shot.rec);
                            }
                            if (a.shot.t >= c.shot.windup + 0.45) a.shot = null;
                        } else if (a.shotCd <= 0) {
                            const tg = this.findTarget(a);
                            if (tg) { a.shot = { rec: tg, t: 0, fired: false }; a.shotCd = c.shot.cooldown; this.play(a, 'Alert', 0.15); a.animLock = 0; }
                        }
                        if (!a.shot) {
                            if (dEx <= c.stopDist) {
                                a.mode = 'bye'; a.waiting = false;
                            } else {
                                if (dh > c.waitFar) a.waiting = true; else if (dh < c.waitNear) a.waiting = false;
                                if (a.waiting) this.faceTo(a, hero.x, hero.z, dt, 5);
                                else {
                                    const r = this.stepToward(a, a.exit.x, a.exit.z, c.leadSpeed, dt);
                                    moving = !r;
                                    // упёрлась в площадку портала (дальше пути нет или 2.5 с без продвижения) — считается пришедшей
                                    if (r || this.stuck(a, dEx, dt)) { a.mode = 'bye'; a.waiting = false; moving = false; }
                                }
                            }
                        }
                    }
                } else if (a.mode === 'bye') {
                    this.driveHero(a, dt);
                    this.faceTo(a, hero.x, hero.z, dt, 5);
                    if (!a.byeOpened && a.mode === 'bye' && dh < 4.2 && !dlgOpen && g.ui && g.ui.openDialog) {
                        a.byeOpened = true;
                        if (g.character.isMoving) g.character.stopMovement();
                        this.myPath = null;
                        g.ui.openDialog(a.npc);
                        if (g.ui.dialog) { g.ui.dialog.nodeId = 'farewell'; g.ui.dialog.render(); }
                        this.play(a, 'Agree_Gesture', 0.2);
                        a.animLock = Math.min(2.6, a.actions.Agree_Gesture.getClip().duration);
                    }
                } else if (a.mode === 'return') {
                    const hm = a.home, dHome = Math.hypot(a.x - hm.x, a.z - hm.z);
                    a.slowWalk = false;
                    if (dHome > 2.0) {
                        const r = this.stepToward(a, hm.x, hm.z, c.leadSpeed, dt);
                        moving = !r;
                        // дом может лежать внутри собственной коллизии или за препятствием: нет пути или нет продвижения → встаёт на место
                        if (r || this.stuck(a, dHome, dt)) { a.x = hm.x; a.z = hm.z; a.prog = null; }
                    } else if (dHome > 0.12) {
                        // последние метры без проверки проходимости (точка дома стоит в коллизии своего пропа), шагом
                        const step = Math.min(dHome, 2.2 * dt);
                        a.x += (hm.x - a.x) / dHome * step; a.z += (hm.z - a.z) / dHome * step;
                        a.yaw += normAngle(Math.atan2(hm.x - a.x, hm.z - a.z) - a.yaw) * Math.min(1, dt * 9);
                        moving = true; a.slowWalk = true;
                    } else {
                        a.yaw += normAngle(hm.yaw - a.yaw) * Math.min(1, dt * 5);
                        if (Math.abs(normAngle(hm.yaw - a.yaw)) < 0.08) a.done = true;
                    }
                }
            }
            a.talkWas = talking;

            // анимация: движение сразу отменяет жест (иначе она «скользит» в позе приветствия/прощания), в пути бежит, домой идёт шагом
            if (!talking && !a.shot) {
                if (moving) a.animLock = 0;
                if (a.animLock <= 0) {
                    a.switchT -= dt;
                    const want = moving ? (a.slowWalk ? 'Walking' : 'Running') : 'Idle';   // бег в пути и по дороге домой; шаг только на последних метрах (скорость 2.2 м/с под клип Walking)
                    if (want !== a.cur && (a.switchT <= 0 || (moving && a.cur === 'Agree_Gesture'))) { this.play(a, want, 0.2); a.switchT = 0.3; }
                }
            }
            a.mixer.update(dt);

            const y = g.terrain.getHeightAt(a.x, a.z);
            a.holder.position.set(a.x, y, a.z);
            a.holder.rotation.y = a.yaw;
            a.rec.x = a.x; a.rec.z = a.z; a.rec.rotY = a.yaw;
            a.proxy.position.set(a.x, y, a.z);
        }

        /** Дошла домой: актёр убирается, статичная Вейра снова на месте. */
        finish(a) {
            const i = this.actors.indexOf(a);
            if (i >= 0) this.actors.splice(i, 1);
            const wo = this.game.worldObjects;
            try { a.mixer.stopAllAction(); } catch (e) { /* уже убрано */ }
            if (wo) wo.unregisterContainer(a.rec.id);
            if (a.holder.parent) a.holder.parent.remove(a.holder);
            this.restoreStatic(a.home);
            this.setFlag(a.id, false);
            this.restoreHeroSpeed();
        }

        restoreStatic(home) {
            const wo = this.game.worldObjects;
            if (!wo || !home || !home.rec) return;
            const rec = home.rec;
            if (rec.model) rec.model.visible = true;
            if (rec.proxy && wo.containerProxies.indexOf(rec.proxy) < 0) wo.containerProxies.push(rec.proxy);
        }

        dispose() {
            this.disposed = true;
            this.restoreHeroSpeed();
            Object.keys(CFG).forEach(id => this.setFlag(id, false));
            this.arrows.forEach(ar => ar.grp.parent && ar.grp.parent.remove(ar.grp));
            this.arrows.length = 0;
            this.actors.forEach(a => { try { a.mixer.stopAllAction(); } catch (e) { /* уже убрано */ } });
            this.actors.length = 0;
        }
    }

    window.AveloraCompanion = AveloraCompanion;
})();
