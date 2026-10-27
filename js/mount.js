/**
 * Avelora — Mounts System (AveloraMountManager)
 *
 * Handles summoning, riding, animation synchronization, terrain adaptation,
 * speed buff, dismounting on combat/damage and resource cleanup.
 */
(function () {
    'use strict';

    function parallelTraverse(a, b, cb) {
        cb(a, b);
        for (let i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], cb);
    }

    function cloneSkinned(source) {
        const srcOf = new Map(), cloneOf = new Map();
        const clone = source.clone();
        parallelTraverse(source, clone, (s, c) => { srcOf.set(c, s); cloneOf.set(s, c); });
        clone.traverse(node => {
            if (!node.isSkinnedMesh) return;
            const src = srcOf.get(node);
            const bones = src.skeleton.bones.map(b => cloneOf.get(b));
            node.skeleton = new THREE.Skeleton(bones, src.skeleton.boneInverses);
            node.bind(node.skeleton, src.bindMatrix);
        });
        return clone;
    }

    function findClip(clips, name) {
        const lower = name.toLowerCase();
        return clips.find(c => c.name === name)
            || clips.find(c => c.name.toLowerCase().endsWith('|' + lower))
            || clips.find(c => c.name.toLowerCase() === lower)
            || null;
    }

    class AveloraMountManager {
        constructor(game) {
            this.game = game;
            this.isMounted = false;
            this.activeMount = null;     // { group, mixer, actions, currentAnim, def, tiltX, tiltZ, tiltY }
            this.templates = {};         // creatureId -> Promise<{ scene, clips }>
            this.normalSpeed = 4.8;
            this.summoning = null;       // { def, t, total }
            this._v1 = new THREE.Vector3();

            window.addEventListener('game:playerDamaged', () => {
                if (this.isMounted) this.dismount('damage');
                if (this.summoning) this.cancelSummon();
            });

            // Travelling between ordinary locations keeps the rider in the saddle (the mount lives in the
            // scene root, not in locationRoot, so it survives the rebuild); dungeons are on foot only.
            window.addEventListener('game:location', () => {
                if (this.summoning) this.cancelSummon();
                if (this.isMounted && AveloraMountManager.isNoMountLocation(this.game.location)) this.dismount('dungeon');
            });
        }

        /** Dungeons (and any location with `noMount: true`) forbid riding. */
        static isNoMountLocation(loc) {
            return !!(loc && (loc.isDungeon || loc.dungeon || loc.noMount));
        }

        /** main.js changeLocation(): called before the old location is torn down. */
        beforeLocationChange(target) {
            if (this.summoning) this.cancelSummon();
            if (this.isMounted && AveloraMountManager.isNoMountLocation(target)) this.dismount('dungeon');
        }

        /** Loads and caches the base creature GLB template */
        loadTemplate(creatureId) {
            if (this.templates[creatureId]) return this.templates[creatureId];
            const modelKey = `creatures/${creatureId}`;

            const assetReady = (window.AveloraAssets)
                ? window.AveloraAssets.ensure(modelKey)
                : Promise.resolve(true);

            this.templates[creatureId] = assetReady.then(() => new Promise((resolve) => {
                let buffer = window.LakesideEnvironment
                    ? window.LakesideEnvironment.getModelBuffer(modelKey)
                    : null;

                if (!buffer && window.GAME_ASSETS && window.GAME_ASSETS.models && window.GAME_ASSETS.models[modelKey]) {
                    const b64 = window.GAME_ASSETS.models[modelKey];
                    const bin = window.atob(b64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    buffer = bytes.buffer;
                }

                if (!buffer) {
                    console.error(`[AveloraMount] no model buffer for "${modelKey}"`);
                    resolve(null);
                    return;
                }

                const loader = new THREE.GLTFLoader();
                loader.parse(buffer, '', (gltf) => {
                    const scene = gltf.scene;
                    scene.traverse(o => {
                        if (o.isMesh) {
                            o.castShadow = true;
                            o.receiveShadow = true;
                        }
                    });
                    resolve({ scene, clips: gltf.animations || [] });
                }, (err) => {
                    console.error(`[AveloraMount] failed to parse "${modelKey}"`, err);
                    resolve(null);
                });
            }));

            return this.templates[creatureId];
        }

        /** Called when skill with type "mount" is activated on the hotbar */
        activate(skillDef) {
            const g = this.game;
            const c = g.character;
            if (!c || !g.terrain) return 'unavailable';

            // Already mounted on this or any mount -> toggle dismount
            if (this.isMounted) {
                this.dismount('manual');
                return 'ok';
            }

            if (this.summoning) {
                this.cancelSummon();
                return 'busy';
            }

            if (g.combat && g.combat.isDead) return 'unavailable';
            if (AveloraMountManager.isNoMountLocation(g.location)) {
                if (g.ui && g.ui.floatText) g.ui.floatText('В подземелье верховое животное не призвать', 'warn');
                return 'unavailable';
            }

            const castTime = Math.max(0, skillDef.castTime || 0);
            if (castTime > 0) {
                if (c.isMoving) c.stopMovement();
                this.summoning = { def: skillDef, t: castTime, total: castTime };
                if (c.playCast) c.playCast(castTime);
                if (g.ui && g.ui.floatText) g.ui.floatText('Призыв верхового животного...', 'info');
                return 'ok';
            }

            this.completeSummon(skillDef);
            return 'ok';
        }

        cancelSummon() {
            if (!this.summoning) return;
            this.summoning = null;
            if (this.game.ui && this.game.ui.floatText) {
                this.game.ui.floatText('Призыв прерван', 'warn');
            }
        }

        completeSummon(skillDef) {
            const g = this.game;
            const c = g.character;
            if (!c || !g.scene || !g.terrain) return;

            const creatureId = skillDef.mountCreature || 'wolf';
            this.loadTemplate(creatureId).then(tpl => {
                if (!tpl || !tpl.scene) {
                    if (g.ui && g.ui.floatText) g.ui.floatText('Не удалось призвать животное', 'warn');
                    return;
                }

                if (this.isMounted) this.dismount('replace');

                const model = cloneSkinned(tpl.scene);
                const scale = skillDef.mountScale || 1.45;
                model.scale.setScalar(scale);

                const group = new THREE.Group();
                group.name = `mount:${creatureId}`;
                group.add(model);

                // Setup animation mixer for the mount
                let mixer = null;
                const actions = {};
                if (tpl.clips.length) {
                    mixer = new THREE.AnimationMixer(model);
                    ['Idle', 'Run', 'Walk'].forEach(name => {
                        const clip = findClip(tpl.clips, name);
                        if (!clip) return;
                        const act = mixer.clipAction(clip);
                        act.setEffectiveWeight(1);
                        actions[name] = act;
                    });
                }

                const idleAct = actions.Idle;
                if (idleAct) idleAct.play();

                const yaw = c.currentRotation + Math.PI;   // creature models face +Z
                const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
                const seatOffset = skillDef.seatForward !== undefined ? skillDef.seatForward : 0.45;
                const mx = c.position.x + fwdX * seatOffset;
                const mz = c.position.z + fwdZ * seatOffset;
                const groundY = g.terrain.getHeightAt(mx, mz);
                group.position.set(mx, groundY, mz);
                group.rotation.y = yaw;
                g.scene.add(group);

                const m = {
                    group,
                    model,
                    mixer,
                    actions,
                    currentAnim: 'Idle',
                    def: skillDef,
                    creatureId,
                    tiltX: 0,
                    tiltZ: 0,
                    tiltY: 0,
                    seat: null
                };
                if (mixer) mixer.update(0);
                m.seat = this.calibrateSeat(m, c, skillDef);
                this.activeMount = m;

                this.isMounted = true;
                c.isMounted = true;
                c.mountPoseW = 0;          // character.js blends the rider pose in
                c.isCasting = false;
                c.isGreeting = false;
                if (c.fadeToLogical) c.fadeToLogical('idle', 0.2);
                c.mountRideHeight = skillDef.rideHeight || 0.62;

                // Speed buff: normal 4.8 m/s -> 8.5 m/s (+75% movement speed)
                const bonus = skillDef.speedBonus !== undefined ? skillDef.speedBonus : 3.7;
                c.moveSpeed = this.normalSpeed + bonus;

                if (g.ui && g.ui.floatText) {
                    g.ui.floatText('Верхом на лютоволке!', 'loot');
                }

                // Trigger small arrival poof / sparkles
                this.spawnSummonVfx(c.position.x, groundY, c.position.z);
            });
        }

        dismount(reason = 'manual') {
            if (!this.isMounted && !this.activeMount) return;

            const g = this.game;
            const c = g.character;

            if (this.activeMount && this.activeMount.group) {
                if (this.activeMount.group.parent) {
                    this.activeMount.group.parent.remove(this.activeMount.group);
                }
                if (this.activeMount.mixer) {
                    this.activeMount.mixer.stopAllAction();
                }
            }

            this.activeMount = null;
            this.isMounted = false;

            if (c) {
                c.isMounted = false;
                c.mountSaddleY = undefined;
                c.mountPoseW = 0;
                if (c.mesh) c.mesh.rotation.set(0, c.currentRotation + (c.facingOffset || 0), 0);
                c.moveSpeed = this.normalSpeed;
                // Instantly snap back to ground height
                const groundY = g.terrain ? g.terrain.getHeightAt(c.position.x, c.position.z) : c.position.y;
                c.position.y = groundY + (c._stepUpY || 0);
                if (c.mesh) c.mesh.position.y = c.position.y;
            }

            if (g.ui && g.ui.floatText) {
                if (reason === 'damage') {
                    g.ui.floatText('Спешивание (получен урон)', 'warn');
                } else if (reason === 'dungeon') {
                    g.ui.floatText('В подземелье — пешком', 'info');
                } else if (reason === 'manual') {
                    g.ui.floatText('Спешивание', 'info');
                }
            }
        }

        spawnSummonVfx(x, y, z) {
            const g = this.game;
            if (!g.skills || !g.skills.addSpark) return;
            if (g.skills.ensureResources) g.skills.ensureResources();   // VFX pools are created lazily
            const count = 18;
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2;
                const sp = 2.0 + Math.random() * 1.5;
                g.skills.addSpark(
                    x, y + 0.3, z,
                    Math.cos(a) * sp, 1.2 + Math.random() * 1.5, Math.sin(a) * sp,
                    0.6, 0.12, '#64d2ff', 0.2
                );
            }
        }

        update(delta) {
            // Handle summoning cast
            if (this.summoning) {
                const c = this.game.character;
                if (c && c.isMoving) {
                    this.cancelSummon();
                    return;
                }
                this.summoning.t -= delta;
                if (this.summoning.t <= 0) {
                    const def = this.summoning.def;
                    this.summoning = null;
                    this.completeSummon(def);
                }
            }

            if (!this.isMounted || !this.activeMount) return;

            const g = this.game;
            const c = g.character;
            const m = this.activeMount;
            if (!c || !m.group || !g.terrain) return;

            // The wolf walks under the hero: hero position + seatForward ahead, facing the hero's heading
            const yaw = c.currentRotation + Math.PI;   // creature models face +Z
            const seatOffset = m.def.seatForward !== undefined ? m.def.seatForward : 0.45;
            const mx = c.position.x + Math.sin(yaw) * seatOffset;
            const mz = c.position.z + Math.cos(yaw) * seatOffset;
            const groundY = g.terrain.getHeightAt(mx, mz);
            m.group.position.set(mx, groundY + m.tiltY, mz);
            m.group.rotation.y = yaw;

            // Align mount body to terrain slope (tilt pitch & roll)
            this.alignMountToTerrain(m, delta);

            // Animation state: Run when moving, Idle when stopped
            const targetAnim = c.isMoving ? 'Run' : 'Idle';
            if (m.currentAnim !== targetAnim && m.actions[targetAnim]) {
                const prev = m.actions[m.currentAnim];
                const next = m.actions[targetAnim];
                if (prev) prev.fadeOut(0.18);
                if (next) next.reset().fadeIn(0.18).play();
                m.currentAnim = targetAnim;
            }
            if (m.mixer) {
                m.mixer.timeScale = m.currentAnim === 'Run' ? (m.def.runAnimSpeed || 1.15) : 1.0;
                m.mixer.update(delta);
            }

            // Rider sits on the wolf's back bones: follows breathing, gallop and slope
            if (m.seat && c.mesh) this.seatRider(m, c, delta);
            else {
                c.position.y = groundY + (m.def.rideHeight || 0.65);
                if (c.mesh) c.mesh.position.y = c.position.y;
            }
        }

        /**
         * Saddle socket. The seat point (rider's hips at the tuned rideHeight / seatForward) is stored in
         * the local space of the two wolf spine bones around it; every frame it is read back from the
         * animated bones, and the rider's whole mesh is turned by the same rotation as that piece of spine.
         */
        calibrateSeat(m, c, def) {
            if (!c.mesh) return null;
            const names = def.seatBones || ['spine_0', 'spine_1', 'spine_2'];
            const bones = [];
            m.model.traverse(o => { if (o.isBone && names.indexOf(o.name) >= 0) bones.push(o); });
            const hips = c.mountBones && c.mountBones.hips;
            if (!bones.length || !hips) return null;

            m.group.updateMatrixWorld(true);
            const yaw = m.group.rotation.y;
            const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            const rideH = def.rideHeight || 0.65;
            const seatF = def.seatForward !== undefined ? def.seatForward : 0.45;

            // rider rest root on flat ground, hips offset in the rider's yaw frame
            const root = m.group.position.clone().addScaledVector(fwd, -seatF);
            root.y += rideH;
            c.mesh.rotation.set(0, c.currentRotation + (c.facingOffset || 0), 0);
            c.mesh.position.copy(root);
            c.mesh.updateMatrixWorld(true);
            const hipsW = hips.getWorldPosition(new THREE.Vector3());
            const hipsOff = hipsW.clone().sub(root).applyQuaternion(c.mesh.quaternion.clone().invert());

            // the two bones that bracket the seat along the wolf's length
            const proj = b => b.getWorldPosition(new THREE.Vector3()).sub(m.group.position).dot(fwd);
            const tH = hipsW.clone().sub(m.group.position).dot(fwd);
            bones.sort((a, b) => proj(a) - proj(b));
            let b0 = bones[0], b1 = bones[0], w = 0;
            for (let i = 0; i < bones.length - 1; i++) {
                const ta = proj(bones[i]), tb = proj(bones[i + 1]);
                if (tH >= ta && tH <= tb) { b0 = bones[i]; b1 = bones[i + 1]; w = (tH - ta) / Math.max(1e-6, tb - ta); break; }
            }
            if (tH > proj(bones[bones.length - 1])) { b0 = b1 = bones[bones.length - 1]; w = 0; }

            const gq = m.group.getWorldQuaternion(new THREE.Quaternion()).invert();
            const mk = bone => ({
                bone,
                local: bone.worldToLocal(hipsW.clone()),
                qRel: gq.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
            });
            return {
                a: mk(b0), b: mk(b1), w, hipsOff,
                follow: def.riderFollow !== undefined ? def.riderFollow : 0.9,
                upright: def.riderUpright !== undefined ? def.riderUpright : 0.5,
                _p0: new THREE.Vector3(), _p1: new THREE.Vector3(),
                _q0: new THREE.Quaternion(), _q1: new THREE.Quaternion(), _qg: new THREE.Quaternion(),
                _qy: new THREE.Quaternion(), _qd: new THREE.Quaternion(), _qi: new THREE.Quaternion(),
                _e: new THREE.Euler()
            };
        }

        seatRider(m, c, delta) {
            const st = m.seat;
            m.group.updateMatrixWorld(true);
            const gq = m.group.getWorldQuaternion(st._qg);

            // seat point from the animated spine
            const p0 = st.a.bone.localToWorld(st._p0.copy(st.a.local));
            const p1 = st.b.bone.localToWorld(st._p1.copy(st.b.local));
            p0.lerp(p1, st.w);

            // rotation of that piece of spine relative to its rest pose (world): D = Q_now * (G * Q_rel)^-1
            const dOf = (s, out) => {
                s.bone.getWorldQuaternion(out);
                const ref = st._qd.copy(gq).multiply(s.qRel).invert();
                return out.multiply(ref);
            };
            const d0 = dOf(st.a, st._q0), d1 = dOf(st.b, st._q1);
            d0.slerp(d1, st.w);
            d0.slerp(st._qi.identity(), 1 - st.follow);   // d0 = rider tilt

            // rider mesh: tilt * own yaw; hips land on the seat point
            st._qy.setFromEuler(st._e.set(0, c.currentRotation + (c.facingOffset || 0), 0));
            c.mesh.quaternion.copy(d0).multiply(st._qy);
            const off = st._p1.copy(st.hipsOff).applyQuaternion(c.mesh.quaternion);
            c.mesh.position.copy(p0).sub(off);
            c.position.y = c.mesh.position.y;

            // torso stays a bit more upright than the wolf's back (legs and pelvis follow it fully)
            const sp = c.mountBones && c.mountBones.spine;
            if (sp && st.upright > 0 && c.rotateBoneWorldQ) {
                c.mesh.updateMatrixWorld(true);
                const inv = st._q1.copy(d0).invert();
                st._qi.identity().slerp(inv, st.upright * (c.mountPoseW || 1));
                c.rotateBoneWorldQ(sp, st._qi);
            }
        }

        /** Smoothly tilts mount along terrain slope under paws */
        alignMountToTerrain(m, delta) {
            const ter = this.game.terrain;
            const pos = m.group.position;
            const yaw = m.group.rotation.y;

            const span = 0.85; // distance between front and hind paws
            const halfW = 0.35; // half width between left and right paws
            const sinY = Math.sin(yaw), cosY = Math.cos(yaw);

            // Front & hind paw offsets in world coords
            const fx = pos.x + sinY * span, fz = pos.z + cosY * span;
            const hx = pos.x - sinY * span, hz = pos.z - cosY * span;

            const hFL = ter.getHeightAt(fx - cosY * halfW, fz + sinY * halfW);
            const hFR = ter.getHeightAt(fx + cosY * halfW, fz - sinY * halfW);
            const hHL = ter.getHeightAt(hx - cosY * halfW, hz + sinY * halfW);
            const hHR = ter.getHeightAt(hx + cosY * halfW, hz - sinY * halfW);

            const pitch = -Math.atan2((hFL + hFR) * 0.5 - (hHL + hHR) * 0.5, span * 2.0);
            const roll = Math.atan2((hHR + hFR) * 0.5 - (hHL + hFL) * 0.5, halfW * 2.0);

            const rate = Math.min(1.0, 10.0 * delta);
            m.tiltX = THREE.MathUtils.lerp(m.tiltX, pitch, rate);
            m.tiltZ = THREE.MathUtils.lerp(m.tiltZ, roll, rate);

            m.model.rotation.order = 'YXZ';
            m.model.rotation.x = m.tiltX;
            m.model.rotation.z = m.tiltZ;
        }
    }

    window.AveloraMountManager = AveloraMountManager;
})();
