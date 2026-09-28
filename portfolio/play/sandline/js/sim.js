/* ===========================================================================
   SANDLINE — simulation core
   ---------------------------------------------------------------------------
   Characters (player + bots), AABB swept movement with step-up, hitscan
   combat with three-zone hitboxes and damage falloff, and the bot brain.
   Ports of SandlineCharacter.cpp / SandlineBot.cpp / SandlineGameMode.cpp.

   Rendering, input and the HUD live in game.js; this module is pure state so
   the rules stay readable in one place.
   =========================================================================== */
(function (root) {
  'use strict';

  var S = root.SANDLINE;
  var CFG = S.CFG;
  var Arena = S.Arena;
  var Nav = S.Nav;

  var Sim = S.Sim = {};

  /* ===================================================================== *
   * Small maths helpers                                                   *
   * ===================================================================== */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }
  function normAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Smooth organic drift in roughly [-1, 1] — stands in for FMath::PerlinNoise1D. */
  function makeNoise1D(seed) {
    var r = mulberry32(seed);
    var amp = [], frq = [], pha = [];
    for (var i = 0; i < 3; i++) {
      amp.push(0.45 + r() * 0.55);
      frq.push(0.25 + r() * 0.85);
      pha.push(r() * Math.PI * 2);
    }
    return function (x) {
      var v = 0;
      for (var i = 0; i < 3; i++) v += amp[i] * Math.sin(x * frq[i] + pha[i]);
      return v / 1.75;
    };
  }

  /* ===================================================================== *
   * Ray vs vertical capsule (iq's formulation)                            *
   * ===================================================================== */
  function rayCapsule(ro, rd, a, b, r, maxT) {
    var bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    var oax = ro[0] - a[0], oay = ro[1] - a[1], oaz = ro[2] - a[2];

    var baba = bax * bax + bay * bay + baz * baz;
    if (baba < 1e-8) return -1;

    var bard = bax * rd[0] + bay * rd[1] + baz * rd[2];
    var baoa = bax * oax + bay * oay + baz * oaz;
    var rdoa = rd[0] * oax + rd[1] * oay + rd[2] * oaz;
    var oaoa = oax * oax + oay * oay + oaz * oaz;

    var A = baba - bard * bard;
    var B = baba * rdoa - baoa * bard;
    var C = baba * oaoa - baoa * baoa - r * r * baba;
    var h = B * B - A * C;

    if (h >= 0 && Math.abs(A) > 1e-9) {
      var t = (-B - Math.sqrt(h)) / A;
      var y = baoa + t * bard;
      if (y > 0 && y < baba && t > 0 && t < maxT) return t;

      var ocx, ocy, ocz;
      if (y <= 0) { ocx = oax; ocy = oay; ocz = oaz; }
      else { ocx = ro[0] - b[0]; ocy = ro[1] - b[1]; ocz = ro[2] - b[2]; }

      var B2 = rd[0] * ocx + rd[1] * ocy + rd[2] * ocz;
      var C2 = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      var h2 = B2 * B2 - C2;
      if (h2 > 0) {
        var t2 = -B2 - Math.sqrt(h2);
        if (t2 > 0 && t2 < maxT) return t2;
      }
    }
    return -1;
  }

  /* ===================================================================== *
   * Character                                                             *
   * ===================================================================== */

  var nextId = 1;

  Sim.chars = [];
  Sim.player = null;
  Sim.events = [];          // drained by the presentation layer each frame

  function emit(e) { Sim.events.push(e); }

  function makeChar(opts) {
    var w = S.WEAPONS;
    var ch = {
      id: nextId++,
      name: opts.name,
      team: opts.team,
      isBot: !!opts.isBot,
      alive: true,
      pos: [0, 0, 0],
      vel: [0, 0, 0],
      yaw: opts.yaw || 0,
      pitch: 0,
      health: CFG.MAX_HEALTH,
      armor: CFG.MAX_ARMOR,
      onGround: false,
      crouching: false,
      sprinting: false,
      aiming: false,
      current: 0,
      mags: w.map(function (x) { return x.mag; }),
      reserves: w.map(function (x) { return x.reserve; }),
      bloom: 0,
      fireTimer: 0,
      reloadTimer: 0,
      recoilPitch: 0,
      recoilYaw: 0,
      lastDamageFrom: null,
      lastDamageTime: -99,
      kills: 0,
      deaths: 0,
      // Individual score. Team modes tally into Sim.match.blueScore/redScore
      // instead; free-for-all and gun game rank individuals, so they need a
      // per-character number to sort on.
      score: 0,
      // Gun Game ladder position. Unused outside that mode.
      rung: 0,
      respawnAt: 0,
      // bot brain
      state: 'patrol',
      target: null,
      path: null,
      pathAge: 0,
      reactTimer: 0,
      strafeDir: 1,
      strafeTimer: 0,
      stuckTimer: 0,
      lastPos: [0, 0, 0],
      aimYaw: opts.yaw || 0,
      aimPitch: 0,
      noiseYaw: makeNoise1D(1000 + nextId),
      noisePitch: makeNoise1D(2000 + nextId),
      noiseTimer: 0,
      fireHold: 0,
      goal: null,
      view: null,
      // Objective play (Domination): the zone this bot is committed to, how
      // long since it last reconsidered, and the sweep it holds while standing
      // on an objective. All unused in modes that have no zones.
      objective: null,
      objectiveAge: 0,
      scanBase: null,
      scanPhase: 0,
      // When the last enemy sighting happened (sim seconds). The sighting is
      // only worth chasing for a few seconds — see chooseBotGoal.
      lastSeenTime: -99
    };
    ch.aimYaw = ch.yaw;
    return ch;
  }

  Sim.getSpreadDeg = function (ch) {
    var w = S.WEAPONS[ch.current];
    var base = ch.aiming ? w.adsSpreadDeg : w.spreadDeg;

    var moving = Math.sqrt(ch.vel[0] * ch.vel[0] + ch.vel[2] * ch.vel[2]) > 40;
    if (moving) base *= w.moveSpreadPenalty;
    if (ch.crouching) base *= 0.7;
    if (!ch.onGround) base *= 2.4;

    return base + ch.bloom;
  };

  /* ===================================================================== *
   * Movement — swept AABB, one axis at a time, with step-up               *
   * ===================================================================== */

  var EPS = 0.01;

  function halfExtents(ch) {
    var hh = ch.crouching ? CFG.CROUCH_HALF : CFG.CAPSULE_HALF;
    return [CFG.CAPSULE_RADIUS, hh, CFG.CAPSULE_RADIUS];
  }

  /** AABB centre for a character standing with feet at pos. */
  function centreOf(ch) {
    var he = halfExtents(ch);
    return [ch.pos[0], ch.pos[1] + he[1], ch.pos[2]];
  }

  /** Largest legal travel along `axis` from centre, before hitting anything. */
  function sweepAxis(centre, he, delta, axis) {
    if (delta === 0) return 0;
    var allowed = delta;
    var cols = Arena.colliders;

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];

      // must overlap on the two axes we are not moving along
      var ox = centre[0] - he[0] < c.max[0] && centre[0] + he[0] > c.min[0];
      var oy = centre[1] - he[1] < c.max[1] && centre[1] + he[1] > c.min[1];
      var oz = centre[2] - he[2] < c.max[2] && centre[2] + he[2] > c.min[2];

      if (axis === 0 && !(oy && oz)) continue;
      if (axis === 1 && !(ox && oz)) continue;
      if (axis === 2 && !(ox && oy)) continue;

      if (delta > 0) {
        var lim = c.min[axis] - (centre[axis] + he[axis]) - EPS;
        if (lim >= -EPS && lim < allowed) allowed = lim;
      } else {
        var lim2 = c.max[axis] - (centre[axis] - he[axis]) + EPS;
        if (lim2 <= EPS && lim2 > allowed) allowed = lim2;
      }
    }
    return allowed;
  }

  function overlapping(centre, he) {
    var cols = Arena.colliders;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (centre[0] - he[0] < c.max[0] && centre[0] + he[0] > c.min[0] &&
          centre[1] - he[1] < c.max[1] && centre[1] + he[1] > c.min[1] &&
          centre[2] - he[2] < c.max[2] && centre[2] + he[2] > c.min[2]) return true;
    }
    return false;
  }

  function moveCharacter(ch, dx, dy, dz) {
    var he = halfExtents(ch);
    var c = centreOf(ch);

    /* ---- vertical first, so we know whether we are grounded -------- */
    var allowY = sweepAxis(c, he, dy, 1);
    c[1] += allowY;
    var blockedY = Math.abs(allowY - dy) > 1e-4;

    if (dy <= 0 && blockedY) { ch.onGround = true; ch.vel[1] = 0; }
    else if (dy > 0 && blockedY) { ch.vel[1] = 0; }
    else { ch.onGround = false; }

    /* ---- horizontal, with one step-up retry ------------------------ */
    function horizontal(fromCentre, ax, delta) {
      var he2 = halfExtents(ch);
      var start = [fromCentre[0], fromCentre[1], fromCentre[2]];
      var got = sweepAxis(start, he2, delta, ax);
      if (Math.abs(got) >= Math.abs(delta) - 1e-3) {
        return { moved: got, lift: 0 };
      }
      // Try to step over the obstruction.
      var he3 = halfExtents(ch);
      var up = sweepAxis(start, he3, CFG.MAX_STEP_UP, 1);
      if (up > 1.5) {
        var lifted = [start[0], start[1] + up, start[2]];
        var got2 = sweepAxis(lifted, he3, delta, ax);
        if (Math.abs(got2) > Math.abs(got) + 1e-3) {
          return { moved: got2, lift: up };
        }
      }
      return { moved: got, lift: 0 };
    }

    var resX = horizontal(c, 0, dx);
    c[0] += resX.moved;
    c[1] += resX.lift;

    var resZ = horizontal(c, 2, dz);
    c[2] += resZ.moved;
    c[1] += resZ.lift;

    if (resX.lift > 0 || resZ.lift > 0) {
      ch.onGround = true;
      if (ch.vel[1] < 0) ch.vel[1] = 0;
    }

    ch.pos[0] = c[0];
    ch.pos[1] = c[1] - he[1];
    ch.pos[2] = c[2];

    // Safety net: if we somehow ended up inside geometry, push straight up.
    var guard = 0;
    while (overlapping(centreOf(ch), halfExtents(ch)) && guard++ < 40) {
      ch.pos[1] += 12;
    }
  }

  function applyMovement(ch, dt, wishX, wishZ, wantJump, wantSprint, wantCrouch) {
    // --- crouch (no standing up under a ceiling) --------------------
    if (wantCrouch !== ch.crouching) {
      if (!wantCrouch) {
        // can we stand?
        var he = [CFG.CAPSULE_RADIUS, CFG.CAPSULE_HALF, CFG.CAPSULE_RADIUS];
        var c = [ch.pos[0], ch.pos[1] + CFG.CAPSULE_HALF, ch.pos[2]];
        if (!overlapping(c, he)) ch.crouching = false;
      } else {
        ch.crouching = true;
      }
    }

    var w = S.WEAPONS[ch.current];
    var speed = CFG.WALK_SPEED * w.moveSpeedMult;
    if (ch.crouching) speed *= CFG.CROUCH_MULT;
    else if (wantSprint && !ch.aiming) { speed *= CFG.SPRINT_MULT; ch.sprinting = true; }
    else ch.sprinting = false;

    var len = Math.sqrt(wishX * wishX + wishZ * wishZ);
    if (len > 1e-4) { wishX /= len; wishZ /= len; } else { wishX = 0; wishZ = 0; }

    // --- gravity ----------------------------------------------------
    ch.vel[1] -= CFG.GRAVITY * dt;
    if (wantJump && ch.onGround) { ch.vel[1] = CFG.JUMP_VELOCITY; ch.onGround = false; }

    // --- acceleration (ground friction, limited air control) ---------
    if (ch.onGround) {
      var sp = Math.sqrt(ch.vel[0] * ch.vel[0] + ch.vel[2] * ch.vel[2]);
      if (sp > 0) {
        var drop = sp * CFG.FRICTION * dt;
        var k = Math.max(0, sp - drop) / sp;
        ch.vel[0] *= k; ch.vel[2] *= k;
      }
    }

    var accel = ch.onGround ? CFG.GROUND_ACCEL : CFG.AIR_ACCEL;
    if (len > 1e-4) {
      var add;
      if (ch.onGround) {
        // Quake-style: accelerate along the wish direction up to `speed`.
        add = speed - (ch.vel[0] * wishX + ch.vel[2] * wishZ);
      } else {
        // In the air, accelerate against the *magnitude* of the current
        // horizontal velocity, not its projection.  Projecting lets a
        // turning player pump their own speed up indefinitely (bunny-hop
        // strafing); measuring the magnitude means air movement can only
        // ever reach the walk speed, never exceed it.  This is what makes
        // the near-zero air control in the design doc actually hold.
        var hs = Math.sqrt(ch.vel[0] * ch.vel[0] + ch.vel[2] * ch.vel[2]);
        add = speed - hs;
      }
      if (add > 0) {
        var a = Math.min(accel * dt * speed, add);
        ch.vel[0] += wishX * a;
        ch.vel[2] += wishZ * a;
      }
    }

    moveCharacter(ch, ch.vel[0] * dt, ch.vel[1] * dt, ch.vel[2] * dt);
  }

  /* ===================================================================== *
   * Damage                                                                *
   * ===================================================================== */

  Sim.applyDamage = function (victim, attacker, amount, zone, weaponName) {
    if (!victim.alive) return;

    // armour soaks half of incoming damage until it runs out
    var toArmor = Math.min(victim.armor, amount * 0.5);
    victim.armor -= toArmor;
    victim.health -= (amount - toArmor);

    victim.lastDamageFrom = attacker ? attacker.id : null;
    victim.lastDamageTime = Sim.now;

    if (victim === Sim.player && attacker) {
      emit({ type: 'damage', fromYaw: attacker.yaw, from: attacker.pos.slice() });
    }

    if (victim.health <= 0) {
      victim.health = 0;
      victim.alive = false;
      victim.deaths++;
      victim.respawnAt = Sim.now + CFG.RESPAWN_DELAY;
      if (attacker && attacker !== victim) attacker.kills++;

      emit({
        type: 'kill',
        // Ids as well as names: the scoring tally and the Gun Game ladder have
        // to resolve the actual characters, not just print who died.
        killerId: attacker ? attacker.id : 0,
        victimId: victim.id,
        killer: attacker ? attacker.name : 'WORLD',
        killerTeam: attacker ? attacker.team : 0,
        victim: victim.name,
        victimTeam: victim.team,
        weapon: weaponName || '—',
        headshot: zone === 'head',
        playerInvolved: (attacker === Sim.player) || (victim === Sim.player)
      });
    } else if (victim === Sim.player) {
      emit({ type: 'playerHurt' });
    }
  };

  /* ===================================================================== *
   * Firing                                                                *
   * ===================================================================== */

  function forwardFrom(yaw, pitch) {
    var cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }
  function rightFrom(yaw) { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }
  function upFrom(fwd) {
    // fwd x right gives up
    return [0, 1, 0];
  }

  function coneDir(fwd, right, up, deg) {
    var rad = deg2rad(deg);
    if (rad <= 1e-6) return fwd.slice();
    var ang = Math.random() * Math.PI * 2;
    var r = Math.sqrt(Math.random()) * Math.tan(rad);
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var d = [
      fwd[0] + (right[0] * ca + up[0] * sa) * r,
      fwd[1] + (right[1] * ca + up[1] * sa) * r,
      fwd[2] + (right[2] * ca + up[2] * sa) * r
    ];
    var l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  /** Nearest character hit by a ray, ignoring teammates of `shooter`. */
  function traceCharacters(ro, rd, maxT, shooter) {
    var best = null;
    for (var i = 0; i < Sim.chars.length; i++) {
      var ch = Sim.chars[i];
      if (!ch.alive || ch === shooter) continue;
      if (shooter && ch.team === shooter.team) continue;   // friendly fire off

      var feetY = ch.pos[1];
      var topY = feetY + (ch.crouching ? CFG.CROUCH_HALF * 2 : CFG.CAPSULE_HALF * 2);
      var a = [ch.pos[0], feetY + CFG.CAPSULE_RADIUS, ch.pos[2]];
      var b = [ch.pos[0], topY - CFG.CAPSULE_RADIUS, ch.pos[2]];

      var t = rayCapsule(ro, rd, a, b, CFG.CAPSULE_RADIUS, maxT);
      if (t > 0 && (!best || t < best.t)) {
        best = { t: t, ch: ch, feetY: feetY };
      }
    }
    return best;
  }

  function fireOneShot(ch) {
    var w = S.WEAPONS[ch.current];
    var spread = Sim.getSpreadDeg(ch);

    var yaw = ch.yaw + ch.recoilYaw;
    var pitch = clamp(ch.pitch + ch.recoilPitch, -1.55, 1.55);
    var fwd = forwardFrom(yaw, pitch);
    var right = rightFrom(yaw);
    var up = [0, 1, 0];

    var ro = [ch.pos[0], ch.pos[1] + (ch.crouching ? CFG.EYE_HEIGHT * 0.72 : CFG.EYE_HEIGHT) + CFG.CAPSULE_HALF, ch.pos[2]];
    if (ch.isBot) ro = [ch.pos[0], ch.pos[1] + 150, ch.pos[2]];

    var anyHit = false;
    var anyKill = false;

    for (var p = 0; p < w.pellets; p++) {
      var dir = w.pellets > 1
        ? coneDir(fwd, right, up, spread + w.pelletConeDeg)
        : coneDir(fwd, right, up, spread);

      var worldHit = Arena.raycast(ro, dir, CFG.MAX_TRACE);
      var charHit = traceCharacters(ro, dir, worldHit ? worldHit.t : CFG.MAX_TRACE, ch);

      if (!charHit) continue;

      var victim = charHit.ch;
      var dist = charHit.t;

      // damage falloff
      var mult = 1;
      if (dist > w.falloffStart) {
        mult = dist >= w.falloffEnd
          ? w.falloffMin
          : lerp(1, w.falloffMin, (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart));
      }

      // hit zone from impact height above the victim's feet
      var hitY = ro[1] + dir[1] * charHit.t;
      var localZ = hitY - charHit.feetY;
      var zone = 'body';
      var zoneMult = 1;
      if (localZ >= CFG.HEAD_ZONE_Z) { zone = 'head'; zoneMult = w.headshotMult; }
      else if (localZ <= CFG.LEG_ZONE_Z) { zone = 'leg'; zoneMult = w.limbMult; }

      var dmg = w.damage * mult * zoneMult;
      var wasAlive = victim.alive;

      Sim.applyDamage(victim, ch, dmg, zone, w.name);

      anyHit = true;
      if (wasAlive && !victim.alive) anyKill = true;

      if (ch === Sim.player) {
        emit({ type: 'hit', zone: zone, kill: wasAlive && !victim.alive });
      }
    }

    if (ch === Sim.player) {
      emit({ type: 'shot', weapon: w.name, hit: anyHit, kill: anyKill });
    }

    // recoil + bloom
    ch.recoilPitch += deg2rad(w.verticalKick);
    ch.recoilYaw += deg2rad((Math.random() * 2 - 1) * w.horizontalKick);
    ch.bloom += w.shotSpreadPerShot;
  }

  function tryFire(ch) {
    if (!ch.alive || ch.reloading() || ch.fireTimer > 0) return false;
    var w = S.WEAPONS[ch.current];
    if (ch.mags[ch.current] <= 0) {
      if (ch === Sim.player) emit({ type: 'dryfire' });
      ch.fireTimer = 0.35;
      return false;
    }

    ch.mags[ch.current]--;
    ch.fireTimer = 60 / w.rpm;
    fireOneShot(ch);

    if (ch.mags[ch.current] <= 0 && ch === Sim.player) emit({ type: 'magEmpty' });
    return true;
  }

  function startReload(ch) {
    var w = S.WEAPONS[ch.current];
    if (ch.reloading()) return;
    if (ch.mags[ch.current] >= w.mag) return;
    if (ch.reserves[ch.current] <= 0) return;
    ch.reloadTimer = w.reloadTime;
    if (ch === Sim.player) emit({ type: 'reloadStart', time: w.reloadTime });
  }

  function finishReload(ch) {
    var w = S.WEAPONS[ch.current];
    var need = w.mag - ch.mags[ch.current];
    var take = Math.min(need, ch.reserves[ch.current]);
    ch.mags[ch.current] += take;
    ch.reserves[ch.current] -= take;
    if (ch === Sim.player) emit({ type: 'reloadEnd' });
  }

  // reloading is a method so the sim reads naturally
  function reloadingFn() { return this.reloadTimer > 0; }
  Sim.reloadingFn = reloadingFn;

  function selectWeapon(ch, idx) {
    if (idx < 0 || idx >= S.WEAPONS.length) return;
    if (idx === ch.current) return;
    // Gun Game pins the weapon to the ladder rung, so manual switching is off.
    if (Sim.mode.ladder) return;
    ch.current = idx;
    ch.reloadTimer = 0;
    ch.bloom = 0;
    ch.fireTimer = 0.25;
    if (ch === Sim.player) emit({ type: 'weaponSwitch', weapon: S.WEAPONS[idx].name });
  }

  Sim.selectWeapon = selectWeapon;

  /* ===================================================================== *
   * Bot brain                                                             *
   * ===================================================================== */

  var B = CFG.BOT;

  function botCanSee(bot, other) {
    if (!other.alive) return false;

    var eye = [bot.pos[0], bot.pos[1] + 150, bot.pos[2]];
    var aimAt = [other.pos[0], other.pos[1] + (other.crouching ? 70 : 110), other.pos[2]];

    var dx = aimAt[0] - eye[0], dy = aimAt[1] - eye[1], dz = aimAt[2] - eye[2];
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > B.VIEW_DISTANCE || dist < 1) return false;

    // inside the vision cone?
    var fwd = forwardFrom(bot.yaw, bot.pitch);
    var dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / dist;
    if (dot < Math.cos(deg2rad(B.FOV_HALF_ANGLE))) return false;

    // clear line of sight?
    return !Arena.occluded(eye[0], eye[1], eye[2], aimAt[0], aimAt[1], aimAt[2]);
  }

  function botPickTarget(bot) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < Sim.chars.length; i++) {
      var o = Sim.chars[i];
      if (o === bot || o.team === bot.team) continue;
      if (!botCanSee(bot, o)) continue;
      var dx = o.pos[0] - bot.pos[0], dz = o.pos[2] - bot.pos[2];
      var d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  function botGoal(bot) {
    // Where to wander when nothing is visible: bias toward the middle of the
    // map but keep some spread so the team does not stack up.
    var r = mulberry32(bot.id * 7919 + Math.floor(Sim.now * 0.25));
    var gx = (r() * 2 - 1) * 2600;
    var gz = (r() * 2 - 1) * 2600;
    if (bot.team === S.TEAM.RED) gx -= 400; else gx += 400;
    return [gx, gz];
  }

  function botRepath(bot, tx, tz) {
    bot.path = Nav.findPath(bot.pos[0], bot.pos[2], tx, tz);
    bot.pathAge = 0;
    if (bot.path && bot.path.length) bot.pathIndex = 0;
  }

  /* --------------------------------------------------------------------- *
   * Objectives                                                            *
   * --------------------------------------------------------------------- *
     A zone is captured by standing in it, so a bot that walks off to keep
     its preferred range is a bot that is not playing the mode. Objective
     play is therefore two decisions: which zone is worth standing on, and
     staying there once you are on it.

     `botGoal` (above) is the old "wander somewhere central" fallback and is
     still what Team Deathmatch and Free For All use, where there is nothing
     to hold and a fight is the whole objective.
   * --------------------------------------------------------------------- */

  /* How often a bot reconsiders which zone it wants, in seconds. Long enough
     that a squad does not oscillate between zones; short enough that it
     reacts to a capture or a zone going contested. */
  var ZONE_REEVALUATE = 2.5;

  function dist2D(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* Stable per-(bot, zone) noise in [0, 1) — deterministic tie-breaks so two
     bots standing on the same spot do not flip-flop between two equal zones. */
  function hash2(a, b) {
    var h = (a * 73856093) ^ (b * 19349663);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function zoneKey(zone) {
    var c = zone.name.charCodeAt(0);
    return isNaN(c) ? 0 : c;
  }

  /** Alive enemies standing inside a zone. */
  function enemiesInsideZone(bot, zone) {
    var n = 0;
    for (var i = 0; i < Sim.chars.length; i++) {
      var c = Sim.chars[i];
      if (!c.alive || c === bot || c.team === bot.team) continue;
      if (dist2D(c.pos[0], c.pos[2], zone.pos[0], zone.pos[2]) <= zone.radius) n++;
    }
    return n;
  }

  /** How badly does this bot's team want this zone, right now? */
  function zonePriority(bot, zone) {
    var team = bot.team;
    var need;
    if (zone.owner === team) {
      // Already ours: a small garrison is right, and everyone else should be
      // attacking. It only becomes urgent under pressure.
      need = 0.45;
      if (zone.capturing && zone.capturing !== team) need += 3.2;   // enemy capping it
      if (enemiesInsideZone(bot, zone) > 0) need += 2.2;            // enemy standing in it
    } else if (zone.owner === 0) {
      need = 2.2;                                                   // neutral: take it
    } else {
      need = 2.7;                                                   // enemy-held: contest
    }

    // Spread: a zone a squadmate is already committed to is worth less, so a
    // five-bot team naturally covers two or three zones instead of stacking
    // on one and losing the other two for free.
    for (var i = 0; i < Sim.chars.length; i++) {
      var c = Sim.chars[i];
      if (c === bot || !c.isBot || !c.alive) continue;
      if (c.team !== team || c.objective !== zone) continue;
      need -= 1.3;
    }

    // Prefer the near zone, all else equal — a long walk is a lost zone.
    need -= dist2D(bot.pos[0], bot.pos[2], zone.pos[0], zone.pos[2]) / 9000;

    // Deterministic tie-break.
    need += hash2(bot.id, zoneKey(zone)) * 0.15;
    return need;
  }

  /** The zone this bot should be working, or null when the mode has none. */
  function pickZoneObjective(bot) {
    var zones = Sim.match.zones;
    if (!zones || !zones.length) return null;
    var best = null, bestScore = -1e9;
    for (var i = 0; i < zones.length; i++) {
      var s = zonePriority(bot, zones[i]);
      if (s > bestScore) { bestScore = s; best = zones[i]; }
    }
    return best;
  }

  /** Where inside a zone this bot should stand. The small per-bot fan-out
      keeps a squad off one exact point instead of piling onto it. */
  function zoneStandPoint(bot, zone) {
    var a = hash2(bot.id, zoneKey(zone) + 17) * Math.PI * 2;
    var r = zone.radius * (0.15 + hash2(bot.id + 3, zoneKey(zone)) * 0.35);
    return [zone.pos[0] + Math.cos(a) * r, zone.pos[2] + Math.sin(a) * r];
  }

  /* Where a bot with nothing in sight should head. `null` means "hold" — an
     objective bot that is already standing on its zone. */
  function chooseBotGoal(bot) {
    // A recent sighting is worth a short push before settling back onto the
    // objective. This used to be gated on `pathAge < 4`, but re-planning
    // happens at `pathAge > 2.2`, so the gate was always satisfied at the
    // moment of the decision and the bot stayed pinned to a sighting that
    // could be minutes old. Freshness belongs to the clock, not the path.
    var CHASE_SECONDS = 3.0;
    if (bot.lastSeen && (Sim.now - bot.lastSeenTime) < CHASE_SECONDS) {
      return bot.lastSeen;
    }

    if (Sim.mode.zones) {
      var zone = bot.objective;
      if (!zone) return botGoal(bot);          // never leave a bot goal-less
      if (dist2D(bot.pos[0], bot.pos[2], zone.pos[0], zone.pos[2]) <= zone.radius * 0.9) {
        return null;                           // in position: hold it
      }
      return zoneStandPoint(bot, zone);
    }

    // No objectives in this mode: keep the original wander.
    return botGoal(bot);
  }

  /* Pull back toward the objective centre when a bot is out near the edge of
     its zone. The wish vector is normalised before use, so this reorients
     rather than accelerates: an objective bot cannot be baited out of the
     zone by an enemy standing just outside it. */
  function zoneHoldPull(bot, zone) {
    if (!zone) return null;
    var dx = bot.pos[0] - zone.pos[0], dz = bot.pos[2] - zone.pos[2];
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > zone.radius * 1.15) return null;          // still travelling: path rules
    var inner = zone.radius * 0.5;
    if (d <= inner) return null;                      // comfortably central
    var over = Math.min(1, (d - inner) / (zone.radius - inner));
    var n = d || 1;
    return [(-dx / n) * over * 1.9, (-dz / n) * over * 1.9];
  }

  function botUpdate(bot, dt) {
    if (!bot.alive) return;

    bot.pathAge += dt;
    bot.objectiveAge += dt;
    bot.strafeTimer -= dt;
    bot.noiseTimer += dt;

    /* ---- perception at 4 Hz ---------------------------------------- */
    bot.perceptionTimer = (bot.perceptionTimer || 0) - dt;
    if (bot.perceptionTimer <= 0) {
      bot.perceptionTimer = 1 / B.PERCEPTION_HZ;
      var seen = botPickTarget(bot);
      if (seen) {
        if (bot.target !== seen) bot.reactTimer = B.REACTION_TIME;
        bot.target = seen;
        bot.state = 'engage';
        bot.lastSeen = [seen.pos[0], seen.pos[2]];
        bot.lastSeenTime = Sim.now;
      } else {
        if (bot.target) {
          bot.target = null;
          bot.state = 'reposition';
        }
      }
    }

    /* ---- objective commitment --------------------------------------- *
     * Re-picked on a timer, so a squad spreads across the zones and then
     * stops caring: the pick is only re-run every ZONE_REEVALUATE seconds,
     * and a zone that is still the best answer keeps being chosen.
     * `holding` is true when the bot is inside its zone, which is the only
     * state in which a zone can actually be captured.
     * ------------------------------------------------------------------ */
    var objectiveZone = null;
    var holding = false;
    if (Sim.mode.zones) {
      if (!bot.objective || bot.objectiveAge >= ZONE_REEVALUATE ||
          Sim.match.zones.indexOf(bot.objective) < 0) {
        bot.objective = pickZoneObjective(bot);
        bot.objectiveAge = 0;
      }
      objectiveZone = bot.objective;
      if (objectiveZone) {
        holding = dist2D(bot.pos[0], bot.pos[2],
                         objectiveZone.pos[0], objectiveZone.pos[2]) <= objectiveZone.radius;
      }
    } else {
      bot.objective = null;
    }
    if (!holding) { bot.scanBase = null; }

    /* ---- aim ------------------------------------------------------- */
    var aimAtYaw = bot.yaw, aimAtPitch = 0;

    if (bot.target && bot.target.alive) {
      var t = bot.target;
      var eye = [bot.pos[0], bot.pos[1] + 150, bot.pos[2]];
      var tgt = [t.pos[0], t.pos[1] + (t.crouching ? 70 : 110), t.pos[2]];

      var dx = tgt[0] - eye[0], dy = tgt[1] - eye[1], dz = tgt[2] - eye[2];
      var dist = Math.sqrt(dx * dx + dz * dz);

      // lead the aim a touch toward the target's velocity
      var lead = clamp(dist / 12000, 0, 0.22);
      var px = tgt[0] + t.vel[0] * lead;
      var pz = tgt[2] + t.vel[2] * lead;
      var py = tgt[1] + (Math.random() * 2 - 1) * 14;

      aimAtYaw = Math.atan2(-(px - eye[0]), -(pz - eye[2]));
      aimAtPitch = Math.atan2(py - eye[1], Math.sqrt((px - eye[0]) * (px - eye[0]) + (pz - eye[2]) * (pz - eye[2])));

      // persistent organic drift, scaled by how hard the shot is
      var hardness = clamp(dist / B.VIEW_DISTANCE, 0.25, 1.0);
      var errYaw = bot.noiseYaw(Sim.now * 1.7 + bot.id) * deg2rad(B.AIM_ERROR_DEGREES) * hardness;
      var errPitch = bot.noisePitch(Sim.now * 1.9 + bot.id * 3) * deg2rad(B.AIM_ERROR_DEGREES) * 0.7 * hardness;

      aimAtYaw += errYaw;
      aimAtPitch += errPitch;
    } else if (bot.path && bot.path.length) {
      var wp = bot.path[Math.min(bot.pathIndex || 0, bot.path.length - 1)];
      aimAtYaw = Math.atan2(-(wp[0] - bot.pos[0]), -(wp[1] - bot.pos[2]));
      aimAtPitch = 0;
    } else if (holding) {
      // Nothing in sight while holding an objective: sweep the approaches,
      // anchored to the heading the bot arrived on so it scans instead of
      // spinning. A 65-degree cone staring one way is a blind spot otherwise.
      if (bot.scanBase === null) { bot.scanBase = bot.yaw; }
      bot.scanPhase += dt * 0.8;
      aimAtYaw = bot.scanBase + Math.sin(bot.scanPhase) * 0.35;
      aimAtPitch = 0;
    }

    // turn-rate limiting (AIM_SMOOTHING) — bots cannot snap
    // Bots also compensate for their own muzzle climb the way a player pulls
    // down; without that their shots walk upward off the target.
    var dy = normAngle(aimAtYaw - bot.yaw);
    var dp = (aimAtPitch - bot.recoilPitch) - bot.pitch;
    var maxStep = B.AIM_SMOOTHING * dt;
    bot.yaw = normAngle(bot.yaw + clamp(dy, -maxStep, maxStep));
    bot.pitch = clamp(bot.pitch + clamp(dp, -maxStep, maxStep), -0.9, 0.9);

    bot.reactTimer = Math.max(0, bot.reactTimer - dt);

    /* ---- trigger discipline ---------------------------------------- */
    var shouldFire = false;
    if (bot.target && bot.target.alive && bot.reactTimer <= 0) {
      var aimErrDeg = Math.abs(rad2deg(normAngle(aimAtYaw - bot.yaw)));
      if (aimErrDeg < B.FIRE_ACCURACY_GATE) shouldFire = true;
    }

    var w = S.WEAPONS[bot.current];
    if (shouldFire) {
      if (bot.mags[bot.current] <= 0) startReload(bot);
      else if (w.automatic || bot.fireHold <= 0) { tryFire(bot); bot.fireHold = 0.12; }
      else tryFire(bot);
    }
    bot.fireHold = Math.max(0, bot.fireHold - dt);
    if (!shouldFire && bot.mags[bot.current] < w.mag * 0.4 && bot.target === null) startReload(bot);

    /* ---- movement -------------------------------------------------- */
    var wishX = 0, wishZ = 0;
    var wantJump = false;
    var wantSprint = false;

    if (bot.state === 'engage' && bot.target) {
      var t2 = bot.target;
      var toX = t2.pos[0] - bot.pos[0];
      var toZ = t2.pos[2] - bot.pos[2];
      var d2 = Math.sqrt(toX * toX + toZ * toZ) || 1;
      var fx = toX / d2, fz = toZ / d2;

      // hold preferred range
      if (d2 > B.PREFERRED_RANGE * 1.25) { wishX += fx; wishZ += fz; wantSprint = true; }
      else if (d2 < B.PREFERRED_RANGE * 0.65) { wishX -= fx; wishZ -= fz; }

      // strafe perpendicular to the target
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = B.STRAFE_PERIOD * (0.7 + Math.random() * 0.8);
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      wishX += -fz * bot.strafeDir * 0.85;
      wishZ += fx * bot.strafeDir * 0.85;
    } else if (holding) {
      // Standing on the objective is the job. A zone only flips while one
      // team is inside it uncontested, so walking off to hold range would
      // concede it. The pull below keeps the bot from drifting off the edge.
      wishX = 0; wishZ = 0;
    } else {
      // patrol / reposition along the path
      var needGoal = !bot.goal || bot.pathAge > 2.2;
      if (needGoal) {
        var g = chooseBotGoal(bot);
        if (g) {
          bot.goal = g;
          botRepath(bot, g[0], g[1]);
        } else {
          // Nothing to walk to: drop the path so the bot stands rather than
          // re-planning to the same cell every frame.
          bot.goal = null;
          bot.path = null;
        }
      }

      if (bot.path && bot.path.length) {
        var wi = bot.pathIndex || 0;
        while (wi < bot.path.length) {
          var p = bot.path[wi];
          var ddx = p[0] - bot.pos[0], ddz = p[1] - bot.pos[2];
          // Advance past a waypoint only when we are really on it. This was
          // 320 cm against 200 cm cells, so the radius spanned more than a
          // whole cell: a bot approaching a corner could skip the waypoint
          // that turned it away from the obstacle and drive straight into it,
          // which is how objective bots ended up pinned against the spawn
          // blocks instead of walking around them.
          if (ddx * ddx + ddz * ddz < 120 * 120) { wi++; continue; }
          break;
        }
        bot.pathIndex = wi;

        if (wi >= bot.path.length) {
          bot.path = null;
          bot.goal = null;
          bot.lastSeen = null;
        } else {
          var p2 = bot.path[wi];
          var vx = p2[0] - bot.pos[0], vz = p2[1] - bot.pos[2];
          var vl = Math.sqrt(vx * vx + vz * vz) || 1;
          wishX = vx / vl; wishZ = vz / vl;
          wantSprint = true;
        }
      }
    }

    // Objective pull: applied only once the bot is at its zone, so it never
    // fights the path on the way there.
    var pull = zoneHoldPull(bot, objectiveZone);
    if (pull) { wishX += pull[0]; wishZ += pull[1]; }

    // --- stuck detection: nudge sideways if we stop making progress ---
    var movedX = bot.pos[0] - bot.lastPos[0];
    var movedZ = bot.pos[2] - bot.lastPos[2];
    if (holding && !bot.target) {
      // Holding an objective with nothing in sight is deliberate stillness,
      // not a stuck bot: the sideways nudge and the hop would break the hold
      // and throw the zone away.
      bot.stuckTimer = 0;
    } else if (movedX * movedX + movedZ * movedZ < 4) {
      bot.stuckTimer += dt;
      if (bot.stuckTimer > 0.6) {
        wishX += (Math.random() * 2 - 1) * 1.4;
        wishZ += (Math.random() * 2 - 1) * 1.4;
        bot.path = null; bot.goal = null;
        if (bot.stuckTimer > 1.8) { wantJump = true; bot.stuckTimer = 0; }
      }
    } else {
      bot.stuckTimer = 0;
    }
    bot.lastPos[0] = bot.pos[0];
    bot.lastPos[1] = bot.pos[1];
    bot.lastPos[2] = bot.pos[2];

    bot.aiming = false;
    applyMovement(bot, dt, wishX, wishZ, wantJump, wantSprint, false);
  }

  /* ===================================================================== *
   * Spawning                                                              *
   * ===================================================================== */

  function spawnPoints(ch) {
    // Team modes spawn on their own line. Free-for-all has no safe side, so
    // both lines are candidates and the proximity scoring in pickSpawn below
    // does the work of keeping a spawn away from the fight.
    if (!Sim.mode.teams) { return S.SPAWNS.blue.concat(S.SPAWNS.red); }
    return ch.team === S.TEAM.BLUE ? S.SPAWNS.blue : S.SPAWNS.red;
  }

  function pickSpawn(ch) {
    var pts = spawnPoints(ch);
    // The best candidate always wins, even when the line is busy.
    //
    // This used to start at -1 with the crowding penalty unbounded below it,
    // so on a full spawn line every candidate could score below the threshold,
    // pickSpawn returned null, and the caller dropped the character at the map
    // centre. Two combatants per team therefore spawned stacked on each other
    // in the middle of the map — which is also inside Domination's zone B, so
    // every match began with a free capture. Spawning a pawn on a crowded line
    // is a small problem; spawning four of them on one point is not.
    var best = null, bestScore = -Infinity;

    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var score = Math.random() * 900;
      for (var j = 0; j < Sim.chars.length; j++) {
        var o = Sim.chars[j];
        if (!o.alive || o === ch) continue;
        var dx = o.pos[0] - p[0], dz = o.pos[2] - p[2];
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < 900) {
          // Weighted hard toward zero distance. A flat (900 - d) penalty made
          // "standing on a team-mate" and "standing between two of them" score
          // the same on a 450 cm-spaced line, so the last pawn to spawn picked
          // at random instead of choosing the empty point.
          var w = (900 - d) / 900;
          score -= 900 * w * w;
        }
      }
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  function respawn(ch) {
    var p = pickSpawn(ch) || spawnPoints(ch)[0] || [0, 200, 0];
    ch.pos = [p[0], p[1], p[2]];
    ch.vel = [0, 0, 0];
    ch.health = CFG.MAX_HEALTH;
    ch.armor = CFG.MAX_ARMOR;
    ch.alive = true;
    ch.crouching = false;
    ch.onGround = false;
    ch.bloom = 0;
    ch.recoilPitch = 0;
    ch.recoilYaw = 0;
    ch.reloadTimer = 0;
    ch.fireTimer = 0;

    for (var i = 0; i < S.WEAPONS.length; i++) {
      ch.mags[i] = S.WEAPONS[i].mag;
      ch.reserves[i] = S.WEAPONS[i].reserve;
    }

    // Gun Game pins the weapon to the current rung, on respawn as well as on
    // promotion — otherwise dying would silently hand you a free weapon choice.
    applyModeWeapon(ch);

    // face the centre of the map
    ch.yaw = Math.atan2(-(0 - ch.pos[0]), -(0 - ch.pos[2]));
    ch.pitch = 0;
    ch.aimYaw = ch.yaw;

    if (ch.isBot) {
      ch.state = 'patrol';
      ch.target = null;
      ch.path = null;
      ch.goal = null;
      ch.lastSeen = null;
      ch.lastSeenTime = -99;
      ch.stuckTimer = 0;
      ch.lastPos = ch.pos.slice();
      ch.perceptionTimer = 0;
      // Re-pick the objective from the new spawn: the zone that was right
      // from the old position may not be the nearest one now.
      ch.objective = null;
      ch.objectiveAge = 99;
      ch.scanBase = null;
    }

    if (ch === Sim.player) emit({ type: 'respawn' });
  }

  Sim.respawn = respawn;

  /* ===================================================================== *
   * Match                                                                 *
   * ===================================================================== */

  Sim.match = {
    mode: S.DEFAULT_MODE,
    modeName: S.modeById(S.DEFAULT_MODE).name,
    teams: true,
    blueScore: 0,
    redScore: 0,
    timeLeft: CFG.ROUND_TIME,
    over: false,
    winner: 0,
    winnerName: '',
    killfeed: [],
    restartTimer: 0,
    // Domination only: live ownership and capture state, one entry per zone.
    zones: []
  };

  /* The active mode object. Everything downstream reads its rules from here
     rather than from CFG, so adding a mode is a data change, not a code change. */
  Sim.mode = S.modeById(S.DEFAULT_MODE);

  function addKillFeed(entry) {
    var kf = Sim.match.killfeed;
    kf.unshift(entry);
    while (kf.length > CFG.KILLFEED_MAX) kf.pop();
  }

  Sim.now = 0;

  /* ===================================================================== *
   * Bootstrap                                                             *
   * ===================================================================== */

  var BOT_NAMES_BLUE = ['KESTREL', 'HALO', 'VULCAN', 'JUNO'];
  var BOT_NAMES_RED  = ['RAVEN', 'COBALT', 'TALON', 'MAGPIE', 'ONYX'];
  var BOT_NAMES_FFA  = ['KESTREL', 'HALO', 'VULCAN', 'JUNO', 'RAVEN',
                        'COBALT', 'TALON', 'MAGPIE', 'ONYX'];

  /* Free-for-all gives every character its own team id from here up. Team ids
     are opaque integers, so the friendly-fire guard and the bot target filter
     keep working with no special case: nobody shares a team with anybody. */
  var FFA_TEAM_BASE = 10;

  /* Gun Game forces the weapon from the ladder rung. Returns null in modes
     where the combatant picks their own weapon. */
  function weaponForRung(ch) {
    var ladder = Sim.mode.ladder;
    if (!ladder) { return null; }
    return ladder[Math.min(ch.rung, ladder.length - 1)];
  }

  function applyModeWeapon(ch) {
    var forced = weaponForRung(ch);
    if (forced === null || forced === undefined) { return; }
    ch.current = forced;
    for (var i = 0; i < S.WEAPONS.length; i++) {
      ch.mags[i] = S.WEAPONS[i].mag;
      ch.reserves[i] = S.WEAPONS[i].reserve;
    }
  }

  Sim.init = function (modeId) {
    var mode = S.modeById(modeId || (Sim.mode && Sim.mode.id) || S.DEFAULT_MODE);
    Sim.mode = mode;

    Sim.chars.length = 0;
    Sim.events.length = 0;
    nextId = 1;
    Sim.now = 0;

    var m = Sim.match;
    m.mode = mode.id;
    m.modeName = mode.name;
    m.teams = !!mode.teams;
    m.blueScore = 0;
    m.redScore = 0;
    m.timeLeft = mode.timeLimit;
    m.over = false;
    m.winner = 0;
    m.winnerName = '';
    m.killfeed.length = 0;
    m.restartTimer = 0;

    // Domination: fresh neutral capture state. Ownership from a previous match
    // has to be discarded or a rematch starts half-captured.
    m.zones = [];
    if (mode.zones) {
      m.zones = mode.zones.map(function (z) {
        return {
          name: z.name, pos: z.pos.slice(), radius: mode.zoneRadius,
          owner: 0,        // 0 = neutral, else S.TEAM.*
          progress: 0,     // 0..1 toward `capturing`
          capturing: 0     // team making progress, 0 = none
        };
      });
    }

    // --- roster ------------------------------------------------------
    if (mode.teams) {
      var player = makeChar({ name: 'YOU', team: S.TEAM.BLUE, isBot: false });
      player.isPlayer = true;
      Sim.player = player;
      Sim.chars.push(player);

      for (var i = 0; i < CFG.BOTS_PER_TEAM - 1; i++) {
        Sim.chars.push(makeChar({ name: BOT_NAMES_BLUE[i], team: S.TEAM.BLUE, isBot: true }));
      }
      for (var j = 0; j < CFG.BOTS_PER_TEAM; j++) {
        Sim.chars.push(makeChar({ name: BOT_NAMES_RED[j], team: S.TEAM.RED, isBot: true }));
      }
    } else {
      var solo = makeChar({ name: 'YOU', team: FFA_TEAM_BASE, isBot: false });
      solo.isPlayer = true;
      Sim.player = solo;
      Sim.chars.push(solo);

      for (var k = 0; k < BOT_NAMES_FFA.length; k++) {
        Sim.chars.push(makeChar({
          name: BOT_NAMES_FFA[k], team: FFA_TEAM_BASE + 1 + k, isBot: true
        }));
      }
    }

    // --- weapons -----------------------------------------------------
    Sim.chars.forEach(function (c) {
      if (mode.ladder) {
        c.rung = 0;
        applyModeWeapon(c);
      } else if (c.isBot) {
        // Bots never take the sniper — it makes them oppressive, not fun.
        c.current = [0, 1, 3][Math.floor(Math.random() * 3)];
      } else {
        c.current = 0;
      }
    });

    Sim.chars.forEach(function (c) { respawn(c); });

    return Sim;
  };

  Sim.reset = function () { return Sim.init(); };

  /* ===================================================================== *
   * Mode helpers                                                          *
   * ===================================================================== */

  function charById(id) {
    for (var i = 0; i < Sim.chars.length; i++) {
      if (Sim.chars[i].id === id) { return Sim.chars[i]; }
    }
    return null;
  }

  /* Gun Game ladder movement. A rung equal to ladder.length means the ladder is
     cleared, which is how that mode is won. */
  function promoteRung(ch) {
    var ladder = Sim.mode.ladder;
    if (!ladder || ch.rung >= ladder.length) { return; }
    ch.rung++;
    applyModeWeapon(ch);
    if (ch === Sim.player) {
      emit({ type: 'promoted', rung: ch.rung, max: ladder.length,
             weapon: S.WEAPONS[ch.current].name });
    }
  }

  function demoteRung(ch) {
    var ladder = Sim.mode.ladder;
    if (!ladder || ch.rung <= 0) { return; }
    ch.rung--;
    applyModeWeapon(ch);
    if (ch === Sim.player) {
      emit({ type: 'demoted', rung: ch.rung, weapon: S.WEAPONS[ch.current].name });
    }
  }

  /* Who is winning an individual-scored mode. Gun Game ranks on ladder rung
     first and kills second; free-for-all ranks on kills alone. */
  function leadingChar() {
    var best = null;
    for (var i = 0; i < Sim.chars.length; i++) {
      var c = Sim.chars[i];
      if (!best) { best = c; continue; }
      if (Sim.mode.ladder) {
        if (c.rung > best.rung || (c.rung === best.rung && c.score > best.score)) { best = c; }
      } else if (c.score > best.score) {
        best = c;
      }
    }
    return best;
  }

  /* Domination: capture and score.
     A zone is taken by standing in it while no enemy is; both sides present
     freezes progress rather than trading it. Owned zones tick score for their
     owner. Kills deliberately award no team points in this mode — the zones are
     the entire objective. */
  function updateDomination(dt) {
    var mode = Sim.mode;
    if (!mode.zones) { return; }
    var m = Sim.match;

    for (var z = 0; z < m.zones.length; z++) {
      var zone = m.zones[z];
      var present = {};

      for (var i = 0; i < Sim.chars.length; i++) {
        var c = Sim.chars[i];
        if (!c.alive) { continue; }
        var dx = c.pos[0] - zone.pos[0];
        var dz = c.pos[2] - zone.pos[2];
        if (dx * dx + dz * dz > zone.radius * zone.radius) { continue; }
        present[c.team] = (present[c.team] || 0) + 1;
      }

      var teams = Object.keys(present);
      var contested = teams.length > 1;
      var only = (!contested && teams.length === 1) ? Number(teams[0]) : 0;

      if (contested) {
        zone.capturing = 0;                      // frozen: nobody gains
      } else if (only && only !== zone.owner) {
        if (zone.capturing !== only) { zone.capturing = only; zone.progress = 0; }
        zone.progress += dt / mode.captureSeconds;
        if (zone.progress >= 1) {
          zone.owner = only;
          zone.progress = 0;
          zone.capturing = 0;
          emit({ type: 'zoneCaptured', zone: zone.name, team: only });
        }
      } else {
        zone.capturing = 0;                      // abandoned, or already ours
        if (zone.progress > 0) {
          zone.progress = Math.max(0, zone.progress - dt / mode.captureSeconds);
        }
      }
    }

    var owned = {};
    for (var q = 0; q < m.zones.length; q++) {
      if (m.zones[q].owner) { owned[m.zones[q].owner] = (owned[m.zones[q].owner] || 0) + 1; }
    }
    m.blueScore += (owned[S.TEAM.BLUE] || 0) * mode.scorePerZonePerSecond * dt;
    m.redScore  += (owned[S.TEAM.RED]  || 0) * mode.scorePerZonePerSecond * dt;
  }

  /* ===================================================================== *
   * Frame update                                                          *
   * ===================================================================== */

  Sim.update = function (dt, input) {
    Sim.now += dt;

    /* Events belong to exactly one frame.
     *
     * The presentation layer reads this buffer after update() returns and is
     * supposed to clear it. Relying on that was a mistake: if the drain is
     * ever missed, two things break at once. The scoring tally below re-counts
     * every 'kill' event it finds, so stale kills are scored again on every
     * subsequent frame and the match ends almost immediately; and the array
     * grows without bound. Clearing here makes the frame self-contained, so a
     * missed drain can only ever cost presentation, never correctness.
     */
    Sim.events.length = 0;

    var m = Sim.match;

    /* ---- per-character upkeep -------------------------------------- *
     * Timers, spread recovery and recoil recovery must run for EVERY
     * character, not just the player. Skipping bots here is a silent
     * killer: their bloom and their accumulated recoil both grow without
     * bound, and after a few seconds of sustained fire they are spraying
     * at the sky and landing nothing.
     * ------------------------------------------------------------------ */
    for (var u = 0; u < Sim.chars.length; u++) {
      var uc = Sim.chars[u];
      uc.fireTimer = Math.max(0, uc.fireTimer - dt);

      if (uc.reloadTimer > 0) {
        uc.reloadTimer -= dt;
        if (uc.reloadTimer <= 0) finishReload(uc);
      }

      var uw = S.WEAPONS[uc.current];
      uc.bloom = Math.max(0, uc.bloom - uw.spreadRecoveryPerSec * dt);

      var rec = 6.5 * dt;
      if (uc.recoilPitch > 0) uc.recoilPitch = Math.max(0, uc.recoilPitch - rec * 1.15);
      else uc.recoilPitch = Math.min(0, uc.recoilPitch + rec);
      uc.recoilYaw -= clamp(uc.recoilYaw, -rec * 1.4, rec * 1.4);
    }

    /* ---- clock + win condition ------------------------------------- */
    if (!m.over) {
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) {
        m.timeLeft = 0;
        m.over = true;
        if (m.teams) {
          m.winner = m.blueScore > m.redScore ? S.TEAM.BLUE
                   : m.redScore > m.blueScore ? S.TEAM.RED : 0;
          m.winnerName = '';
        } else {
          // Individual modes: whoever leads when the whistle goes.
          var leader = leadingChar();
          m.winner = leader ? leader.team : 0;
          m.winnerName = leader ? leader.name : '';
        }
        emit({ type: 'matchOver', winner: m.winner, winnerName: m.winnerName });
      }
    } else {
      m.restartTimer += dt;
    }

    /* ---- player ---------------------------------------------------- */
    var p = Sim.player;
    if (p) {
      if (p.alive) {
        if (input.switchTo !== null && input.switchTo !== undefined) {
          selectWeapon(p, input.switchTo);
          input.switchTo = null;
        }
        if (input.reload) startReload(p);

        p.aiming = input.ads && !p.sprinting;

        var w = S.WEAPONS[p.current];
        if (input.fire) {
          if (w.automatic) tryFire(p);
          else if (input.firePressed) tryFire(p);
        }

        // movement in world space
        var sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
        var wishX = (-sy * input.forward) + (cy * input.right);
        var wishZ = (-cy * input.forward) + (-sy * input.right);

        applyMovement(p, dt, wishX, wishZ, input.jump, input.sprint, input.crouch);
      } else {
        p.bloom = Math.max(0, p.bloom - S.WEAPONS[p.current].spreadRecoveryPerSec * dt);
        if (Sim.now >= p.respawnAt) respawn(p);
      }
    }

    /* ---- bots ------------------------------------------------------ */
    for (var i = 0; i < Sim.chars.length; i++) {
      var c = Sim.chars[i];
      if (!c.isBot) continue;

      if (c.alive) {
        botUpdate(c, dt);
      } else if (Sim.now >= c.respawnAt) {
        respawn(c);
      }
    }

    /* ---- kill events -> feed, individual scores, ladder ------------- */
    // Tallied here from this frame's events, so the killfeed and the
    // scoreboard can never drift apart.
    for (var e = 0; e < Sim.events.length; e++) {
      var ev = Sim.events[e];
      if (ev.type !== 'kill') continue;

      addKillFeed({
        killer: ev.killer, killerTeam: ev.killerTeam,
        victim: ev.victim, victimTeam: ev.victimTeam,
        weapon: ev.weapon, headshot: ev.headshot, time: Sim.now
      });

      var killer = ev.killerId ? charById(ev.killerId) : null;
      var victim = ev.victimId ? charById(ev.victimId) : null;

      // An individual score is meaningful in every mode: it drives the
      // free-for-all and Gun Game standings, and the end-of-match board
      // everywhere else.
      if (killer && killer !== victim) { killer.score++; }

      // Team modes score frags — except Domination, where the zones are the
      // only source of points.
      if (m.teams && !Sim.mode.zones) {
        if (ev.killerTeam === S.TEAM.BLUE) m.blueScore++;
        else if (ev.killerTeam === S.TEAM.RED) m.redScore++;
      }

      // Gun Game: promote the killer, and demote the victim when they were
      // killed by someone on a lower rung (DT_GunGameLadder.csv).
      if (Sim.mode.ladder && killer && victim && killer !== victim) {
        var killerRung = killer.rung;      // captured before promotion
        promoteRung(killer);
        if (victim.rung > killerRung) { demoteRung(victim); }
      }
    }

    /* ---- objective scoring (Domination) ---------------------------- */
    updateDomination(dt);

    /* ---- win conditions -------------------------------------------- */
    var limit = Sim.mode.scoreLimit;

    if (!m.over && m.teams && limit > 0
        && (m.blueScore >= limit || m.redScore >= limit)) {
      m.over = true;
      m.winner = m.blueScore >= limit ? S.TEAM.BLUE : S.TEAM.RED;
      m.winnerName = '';
      emit({ type: 'matchOver', winner: m.winner, winnerName: m.winnerName });
    }

    // Free-for-all and Gun Game are won by an individual, not by a team.
    if (!m.over && !m.teams) {
      var champ = leadingChar();
      var done = Sim.mode.ladder
        ? (champ && champ.rung >= Sim.mode.ladder.length)
        : (champ && champ.score >= limit);
      if (done) {
        m.over = true;
        m.winner = champ.team;
        m.winnerName = champ.name;
        emit({ type: 'matchOver', winner: m.winner, winnerName: champ.name });
      }
    }

    // prune the killfeed
    for (var k = m.killfeed.length - 1; k >= 0; k--) {
      if (Sim.now - m.killfeed[k].time > CFG.KILLFEED_LIFE) m.killfeed.splice(k, 1);
    }
  };

  Sim.forwardFrom = forwardFrom;
  Sim.halfExtents = halfExtents;
  Sim.rayCapsule = rayCapsule;
  Sim.botCanSee = botCanSee;

  /* Individual standings, best first. Team modes use this for the end-of-match
     board; the individual modes use it for the live leaderboard. */
  Sim.standings = function () {
    var list = Sim.chars.slice();
    var ladder = Sim.mode.ladder;
    list.sort(function (a, b) {
      if (ladder) {
        if (b.rung !== a.rung) { return b.rung - a.rung; }
        return b.score - a.score;
      }
      return b.score - a.score;
    });
    return list;
  };

  /* Length of the Gun Game ladder, or 0 in modes that do not have one. */
  Sim.ladderLength = function () {
    return Sim.mode.ladder ? Sim.mode.ladder.length : 0;
  };

  /* reloading is queried as a function on characters */
  Object.defineProperty(Object.prototype, 'reloading', {
    value: function () { return this.reloadTimer > 0; },
    enumerable: false, writable: true, configurable: true
  });

})(window);
