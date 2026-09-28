/* ===========================================================================
   SANDLINE — presentation layer
   ---------------------------------------------------------------------------
   Renderer, procedural character + weapon models, mouse/keyboard input, the
   canvas HUD and the main loop.  Reads state from SANDLINE.Sim; owns nothing
   that affects the rules.
   =========================================================================== */
(function (root) {
  'use strict';

  var S = root.SANDLINE;
  var CFG = S.CFG;
  var Sim = S.Sim;
  var Arena = S.Arena;
  var Nav = S.Nav;

  var app = document.getElementById('app');
  var hudCanvas = document.getElementById('hud');
  var hud = hudCanvas.getContext('2d');

  /* ===================================================================== *
   * Procedural audio — every sound is synthesised, no asset files         *
   * ===================================================================== */
  var Sound = (function () {
    var ctx = null, master = null, noise = null;

    function ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);

      // one second of white noise, reused by everything
      var len = ctx.sampleRate;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }

    function noiseBurst(dur, freq, q, gain, decay) {
      var src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = freq;
      bp.Q.value = q || 1;
      var g = ctx.createGain();
      var t = ctx.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.02);
      return bp;
    }

    function tone(freq, dur, gain, type, slideTo) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      var t = ctx.currentTime;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    return {
      unlock: ensure,
      shot: function (cls, dist) {
        if (!ensure()) return;
        var att = dist ? Math.max(0.08, 1 - dist / 9000) : 1;
        if (cls === 'SNIPER') {
          noiseBurst(0.30, 2600, 1.2, 0.85 * att, 0.26);
          tone(140, 0.18, 0.35 * att, 'sawtooth', 48);
        } else if (cls === 'SHOTGUN') {
          noiseBurst(0.28, 1500, 0.8, 0.80 * att, 0.24);
          tone(90, 0.20, 0.32 * att, 'square', 40);
        } else if (cls === 'SMG') {
          noiseBurst(0.09, 3400, 0.9, 0.44 * att, 0.07);
          tone(210, 0.05, 0.16 * att, 'square', 90);
        } else {
          noiseBurst(0.13, 2800, 1.0, 0.55 * att, 0.11);
          tone(170, 0.07, 0.20 * att, 'square', 70);
        }
      },
      impact: function (dist) {
        if (!ensure()) return;
        var att = Math.max(0.05, 1 - (dist || 0) / 12000);
        noiseBurst(0.05, 5200, 0.6, 0.30 * att, 0.04);
      },
      hitmarker: function (kill) {
        if (!ensure()) return;
        tone(kill ? 1750 : 1250, 0.055, 0.24, 'square');
        if (kill) tone(2350, 0.09, 0.20, 'square');
      },
      hurt: function () {
        if (!ensure()) return;
        noiseBurst(0.20, 420, 0.7, 0.55, 0.18);
        tone(110, 0.16, 0.26, 'sine', 60);
      },
      reloadStart: function () {
        if (!ensure()) return;
        noiseBurst(0.05, 3000, 1.4, 0.30, 0.045);
      },
      reloadEnd: function () {
        if (!ensure()) return;
        noiseBurst(0.06, 2400, 1.6, 0.34, 0.05);
        tone(620, 0.05, 0.14, 'square');
      },
      empty: function () {
        if (!ensure()) return;
        noiseBurst(0.04, 6000, 2.0, 0.28, 0.035);
      },
      footstep: function () {
        if (!ensure()) return;
        noiseBurst(0.07, 700, 0.6, 0.14, 0.06);
      },
      spawn: function () {
        if (!ensure()) return;
        tone(440, 0.10, 0.18, 'sine', 880);
      },
      matchEnd: function () {
        if (!ensure()) return;
        tone(330, 0.5, 0.26, 'sine', 165);
        tone(220, 0.7, 0.20, 'sine', 110);
      }
    };
  })();

  /* ===================================================================== *
   * Renderer / scene                                                      *
   * ===================================================================== */
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.5));
  renderer.setSize(root.innerWidth, root.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  app.insertBefore(renderer.domElement, hudCanvas);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(CFG.FOV, root.innerWidth / root.innerHeight, CFG.NEAR, CFG.FAR);
  camera.rotation.order = 'YXZ';

  Arena.buildEnvironment(scene);
  Arena.build(scene);
  Nav.build();
  Sim.init();

  /* ===================================================================== *
   * Character visuals                                                     *
   * ===================================================================== */
  /* ------------------------------------------------------------------ *
   * Operator body parts                                                 *
   *                                                                     *
   * The first build was a capsule, a sphere and a box, all MeshLambert  *
   * in near-black — which is why the operators read as featureless      *
   * silhouettes. These are chamfered boxes at real proportions, sized   *
   * in centimetres against a 176 cm body.                               *
   * ------------------------------------------------------------------ */

  function bbox(w, h, d, c) {
    var ch = c === undefined ? Math.min(1.8, Math.min(w, Math.min(h, d)) * 0.3) : c;
    return S.MAT.bevelBoxGeometry(w / 2, h / 2, d / 2, ch);
  }

  var BODY = {
    boot:       bbox(15, 13, 30, 2),
    shin:       bbox(17, 40, 19, 2),
    thigh:      bbox(21, 42, 23, 2.5),
    pelvis:     bbox(42, 21, 27, 3),
    chest:      bbox(45, 46, 29, 3.5),
    yoke:       bbox(56, 17, 31, 3),
    pack:       bbox(30, 36, 15, 3),
    neck:       bbox(13, 11, 13, 1.5),
    head:       bbox(21, 25, 23, 3),
    helmet:     bbox(26, 15, 28, 3),
    brim:       bbox(28, 4, 30, 1),
    visor:      bbox(19, 7, 4, 1),
    upperArm:   bbox(15, 36, 17, 2.5),
    forearm:    bbox(14, 32, 16, 2.5),
    hand:       bbox(12, 11, 15, 2),
    band:       bbox(27, 5, 29, 1),
    patch:      bbox(7, 8, 13, 1.5),
    mag:        bbox(9, 22, 15, 1.5)
  };

  var GEO = {
    flash: new THREE.PlaneGeometry(26, 26)
  };

  /* Merge a list of { geo, x, y, z } into one geometry so a whole limb is a
     single draw call. Without this a ten-man match costs 240 draw calls for
     body parts alone.

     The clone is load-bearing: BODY.* are shared between every operator, and
     translateGeometry mutates in place. Without the copy each operator added
     its offsets to the same geometry and the bodies drifted apart a little more
     with every character built. */
  function mergeParts(list) {
    var geos = list.map(function (p) {
      var g = p.geo.clone();
      S.MAT.tintGeometry(g, [1, 1, 1], 1);
      return S.MAT.translateGeometry(g, p.x, p.y, p.z);
    });
    return S.MAT.mergeGeometries(geos);
  }

  /* Accent colour for any team id. BLUE and RED use their team colour;
     free-for-all hands every character its own id, and those need a distinct
     hue or ten operators are visually indistinguishable. */
  function accentRgb(team) {
    if (team === S.TEAM.BLUE || team === S.TEAM.RED) { return S.teamColour(team); }
    var c = new THREE.Color().setHSL(((team * 47) % 360) / 360, 0.55, 0.58);
    return [c.r, c.g, c.b];
  }

  function accentHex(team) {
    if (team === S.TEAM.BLUE || team === S.TEAM.RED) { return S.teamHex(team); }
    var c = new THREE.Color().setHSL(((team * 47) % 360) / 360, 0.55, 0.62);
    return '#' + c.getHexString();
  }

  /* Operator materials.
   *
   * Cloth, gear and metal are shared across every operator — a fabric texture
   * per team would mean ten identical canvases — and only the accent varies,
   * because that is the part that has to identify the team at range. */
  var SHARED = {};

  function operatorMaterials(team) {
    if (!SHARED.cloth) {
      SHARED.cloth = S.MAT.fabric('#464d56', 0x7f31);
      SHARED.gear = S.MAT.polymer(0x1f2329, 0.78);
      SHARED.metal = S.MAT.weatheredMetal();
    }
    if (!SHARED['accent' + team]) {
      SHARED['accent' + team] = S.MAT.accent(accentRgb(team));
    }
    return {
      cloth: SHARED.cloth,
      gear: SHARED.gear,
      metal: SHARED.metal,
      accent: SHARED['accent' + team]
    };
  }

  /* Cached per team id. This has to tolerate arbitrary ids rather than indexing
     a two-entry table: free-for-all ids run up to 19, and MATS[10].body threw
     the moment a non-team mode was started. */
  var MATS = {};
  function materialFor(team) {
    if (!MATS[team]) { MATS[team] = operatorMaterials(team); }
    return MATS[team];
  }

  /* The operator model.
   *
   * Hierarchy is chosen so the existing animation still works unchanged: the
   * torso group sits at chest height (y = 132) and pitches, the legs hang off
   * the root so they stay planted, and the gun and muzzle flash keep their
   * original local offsets so tracers still leave the barrel. */
  function buildCharacterView(ch) {
    var mats = materialFor(ch.team);
    var group = new THREE.Group();

    var torso = new THREE.Group();
    torso.position.y = 132;
    group.add(torso);

    // ---- legs: pivoted at the hip so they can swing -------------------
    var legPivotY = 95;
    var legs = [];
    [-1, 1].forEach(function (side) {
      var leg = new THREE.Group();
      leg.position.set(side * 11.5, legPivotY, 0);
      group.add(leg);

      var geo = mergeParts([
        { geo: BODY.thigh, x: 0, y: 74 - legPivotY, z: 0 },
        { geo: BODY.shin,  x: 0, y: 32 - legPivotY, z: 0 },
        { geo: BODY.boot,  x: 0, y: 7 - legPivotY, z: 3 }
      ]);
      var m = new THREE.Mesh(geo, mats.cloth);
      m.castShadow = true;
      leg.add(m);
      legs.push(leg);
    });

    // ---- torso, head and arms: one merged mesh plus accent trim -------
    var torsoGeo = mergeParts([
      { geo: BODY.pelvis, x: 0, y: 102 - 132, z: 0 },
      { geo: BODY.chest,  x: 0, y: 132 - 132, z: 0 },
      { geo: BODY.yoke,   x: 0, y: 150 - 132, z: 0 },
      { geo: BODY.pack,   x: 0, y: 136 - 132, z: 17 },
      { geo: BODY.neck,   x: 0, y: 158 - 132, z: 0 },
      { geo: BODY.head,   x: 0, y: 172 - 132, z: 0 },
      { geo: BODY.upperArm, x: -30, y: 141 - 132, z: 0 },
      { geo: BODY.upperArm, x:  30, y: 141 - 132, z: 0 },
      { geo: BODY.forearm,  x: -29, y: 116 - 132, z: -5 },
      { geo: BODY.forearm,  x:  29, y: 116 - 132, z: -5 },
      { geo: BODY.hand,     x: -26, y: 100 - 132, z: -16 },
      { geo: BODY.hand,     x:  26, y: 100 - 132, z: -16 }
    ]);
    var torsoMesh = new THREE.Mesh(torsoGeo, mats.cloth);
    torsoMesh.castShadow = true;
    torso.add(torsoMesh);

    // gear over the cloth: helmet, visor, vest webbing
    var gearGeo = mergeParts([
      { geo: BODY.helmet, x: 0, y: 181 - 132, z: 0 },
      { geo: BODY.brim,   x: 0, y: 175 - 132, z: -4 },
      { geo: BODY.visor,  x: 0, y: 169 - 132, z: -13 },
      { geo: BODY.mag,    x: -14, y: 112 - 132, z: -12 },
      { geo: BODY.mag,    x:  14, y: 112 - 132, z: -12 }
    ]);
    var gearMesh = new THREE.Mesh(gearGeo, mats.gear);
    gearMesh.castShadow = true;
    torso.add(gearMesh);

    // team accent: helmet band, shoulder patches, an armband. This is what
    // makes friend-or-foe legible at distance, so it stays emissive.
    var accentGeo = mergeParts([
      { geo: BODY.band,  x: 0, y: 183 - 132, z: 0 },
      { geo: BODY.patch, x: -28, y: 152 - 132, z: 0 },
      { geo: BODY.patch, x:  28, y: 152 - 132, z: 0 },
      { geo: BODY.patch, x: -30, y: 124 - 132, z: -3 }
    ]);
    var accentMesh = new THREE.Mesh(accentGeo, mats.accent);
    torso.add(accentMesh);

    // ---- weapon ------------------------------------------------------
    var gunGeo = mergeParts([
      { geo: bbox(7, 9, 40, 1.5),  x: 0,  y: 0,    z: -12 },
      { geo: bbox(6, 6, 26, 1.5),  x: 0,  y: 1,    z: -38 },
      { geo: bbox(4, 4, 16, 1),    x: 0,  y: 2,    z: -56 },
      { geo: bbox(7, 16, 12, 1.5), x: 0,  y: -11,  z: -6 },
      { geo: bbox(6, 12, 8, 1.5),  x: 0,  y: -10,  z: 5 },
      { geo: bbox(6, 8, 20, 1.5),  x: 0,  y: 0,    z: 17 }
    ]);
    var gun = new THREE.Mesh(gunGeo, mats.metal);
    gun.position.set(16, -8, -26);
    gun.castShadow = true;
    torso.add(gun);

    var flash = new THREE.Mesh(GEO.flash, new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    flash.position.set(16, -6, -60);
    flash.visible = false;
    torso.add(flash);

    scene.add(group);

    ch.view = {
      group: group, torso: torso, gun: gun, flash: flash,
      legL: legs[0], legR: legs[1],
      walk: 0, flashTimer: 0, deadTilt: 0
    };
    return ch.view;
  }

  Sim.chars.forEach(buildCharacterView);

  /* ===================================================================== *
   * First-person weapon model                                             *
   * ===================================================================== */

  /* The viewmodel gets its own light rig, attached to the camera.
     A weapon held 50 cm from the eye is lit by whatever the scene lighting
     happens to do at that spot, which meant it went black the moment the
     player stood in shadow — and it was the largest thing on screen. This
     keeps it readable everywhere without touching the world lighting. */
  var VIEWMAT = {
    body: new THREE.MeshStandardMaterial({ color: 0x3c4149, roughness: 0.62, metalness: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.72, metalness: 0.18 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.34, metalness: 0.82 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x14324a, roughness: 0.12, metalness: 0.30,
      emissive: 0x0a2233, emissiveIntensity: 1
    })
  };

  function buildGun(id) {
    var g = new THREE.Group();
    var muzzleZ = -40;

    function part(w, h, d, x, y, z, mat) {
      var m = new THREE.Mesh(S.MAT.bevelBoxGeometry(w / 2, h / 2, d / 2, Math.min(0.8, Math.min(w, Math.min(h, d)) * 0.22)), mat || VIEWMAT.dark);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    }

    if (id === 0) {                    // Vanguard — assault rifle
      part(7, 9, 40, 0, 0, -12, VIEWMAT.body);          // receiver
      part(5, 2, 30, 0, 6, -16);                        // top rail
      part(6, 6, 26, 0, 1, -40, VIEWMAT.body);          // handguard
      part(6.4, 1.6, 10, 0, 1, -34);                    // vent slot
      part(6.4, 1.6, 10, 0, 1, -46);                    // vent slot
      part(3.4, 3.4, 20, 0, 2, -62, VIEWMAT.steel);     // barrel
      part(5, 5, 8, 0, 2, -74, VIEWMAT.steel);          // muzzle brake
      part(4, 4, 5, 0, 5, -54, VIEWMAT.steel);          // gas block
      part(2, 7, 2, 0, 8, -52);                         // front sight post
      part(6, 16, 12, 0, -12, -8);                      // magazine
      part(5, 12, 7, 0, -11, 6);                        // pistol grip
      part(5, 1.6, 9, 0, -7, 3);                        // trigger guard
      part(6, 8, 20, 0, -1, 18, VIEWMAT.body);          // stock
      part(6, 10, 4, 0, -1, 28);                        // butt pad
      part(3, 2, 8, -4, 4, -2, VIEWMAT.steel);          // charging handle
      part(5, 5, 13, 0, 9, -6);                         // optic body
      part(4.4, 4.4, 1.4, 0, 9, -12.4, VIEWMAT.glass);  // objective lens
      muzzleZ = -78;
    } else if (id === 1) {             // Whisper — SMG
      part(7, 9, 30, 0, 0, -10, VIEWMAT.body);
      part(4, 2, 18, 0, 6, -12);
      part(5, 5, 14, 0, 1, -30, VIEWMAT.body);
      part(3, 3, 14, 0, 2, -42, VIEWMAT.steel);
      part(6, 6, 18, 0, 2, -56, VIEWMAT.body);          // suppressor
      part(5, 18, 10, 0, -14, -5);                      // long magazine
      part(5, 12, 7, 0, -11, 6);
      part(4.6, 1.4, 8, 0, -7, 3);
      part(5, 6, 11, 0, 0, 14, VIEWMAT.body);           // folded stock
      part(4, 4, 9, 0, 8, -8);
      part(3.6, 3.6, 1.2, 0, 8, -12.6, VIEWMAT.glass);
      muzzleZ = -65;
    } else if (id === 2) {             // Apex — bolt-action sniper
      part(7, 9, 46, 0, 0, -16, VIEWMAT.body);
      part(3.4, 3.4, 40, 0, 2, -62, VIEWMAT.steel);
      part(6, 6, 10, 0, 2, -85, VIEWMAT.steel);         // muzzle brake
      part(5, 5, 26, 0, 10, -20);                       // scope tube
      part(6, 6, 8, 0, 10, -37, VIEWMAT.steel);         // objective bell
      part(5.4, 5.4, 7, 0, 10, -6);                     // eyepiece
      part(4.6, 4.6, 1.4, 0, 10, -41.4, VIEWMAT.glass);
      part(4, 5, 4, 0, 6, -26);                         // mount
      part(4, 5, 4, 0, 6, -14);                         // mount
      part(4, 3, 12, -4, 3, -8, VIEWMAT.steel);         // bolt handle
      part(5, 12, 10, 0, -10, -8);
      part(4, 11, 6, 0, -10, 6);
      part(5, 9, 24, 0, -1, 20, VIEWMAT.body);
      part(5, 4, 14, 0, 5, 18);                         // cheek riser
      muzzleZ = -91;
    } else {                           // Breaker — pump shotgun
      part(7, 10, 36, 0, 0, -12, VIEWMAT.body);
      part(5, 5, 34, 0, 3, -44, VIEWMAT.steel);         // barrel
      part(4, 4, 30, 0, -1, -42, VIEWMAT.steel);        // tube magazine
      part(7, 7, 16, 0, 0, -34, VIEWMAT.body);          // pump
      part(7.4, 1.6, 4, 0, 0, -30);                     // pump rib
      part(7.4, 1.6, 4, 0, 0, -38);                     // pump rib
      part(3, 4, 3, 0, 6, -58);                         // bead sight
      part(6, 8, 22, 0, -1, 18, VIEWMAT.body);          // stock
      part(6, 10, 4, 0, -1, 28);
      part(5, 11, 7, 0, -10, 6);
      part(4.6, 1.6, 8, 0, -6, 3);
      muzzleZ = -62;
    }

    g.userData.muzzleZ = muzzleZ;
    return g;
  }

  var vmRoot = new THREE.Group();
  camera.add(vmRoot);
  scene.add(camera);

  /* Weapon lighting, parented to the camera so it follows the view.
     Two lights only: a key from up and to the right of the eye, and a cool
     fill from below-left so the underside of the receiver does not go to
     black. Both are in camera space, so the weapon looks the same in a
     sunlit yard and in a doorway. */
  (function () {
    var key = new THREE.DirectionalLight(0xfff4e2, 2.2);
    key.position.set(0.55, 0.9, 0.35);
    key.target.position.set(0, -0.1, -1);
    camera.add(key);
    camera.add(key.target);

    var rim = new THREE.DirectionalLight(0xa8c4ff, 0.95);
    rim.position.set(-0.7, -0.35, 0.5);
    rim.target.position.set(0, -0.1, -1);
    camera.add(rim);
    camera.add(rim.target);
  })();

  var gunModels = S.WEAPONS.map(buildGun);
  gunModels.forEach(function (m) { m.visible = false; vmRoot.add(m); });

  var muzzleFlash = new THREE.Mesh(GEO.flash, new THREE.MeshBasicMaterial({
    color: 0xffe0b0, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  muzzleFlash.scale.set(1.4, 1.4, 1.4);
  vmRoot.add(muzzleFlash);

  // --- tracers -------------------------------------------------------
  var tracers = [];
  for (var ti = 0; ti < 14; ti++) {
    var tm = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0.85, depthWrite: false })
    );
    tm.visible = false;
    scene.add(tm);
    tracers.push({ mesh: tm, life: 0 });
  }
  var tracerCursor = 0;

  function spawnTracer(from, to) {
    var t = tracers[tracerCursor++ % tracers.length];
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1) return;
    t.mesh.position.set(from[0] + dx / 2, from[1] + dy / 2, from[2] + dz / 2);
    t.mesh.lookAt(to[0], to[1], to[2]);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = 0.055;
  }

  /* ===================================================================== *
   * Input                                                                 *
   * ===================================================================== */
  var input = {
    forward: 0, right: 0, jump: false, crouch: false, sprint: false,
    fire: false, firePressed: false, ads: false, reload: false, switchTo: null
  };

  var keys = Object.create(null);
  var locked = false;
  var started = false;
  var paused = false;
  var scoreboardHeld = false;

  /* Pointer lock is not always granted. A host that embeds the game in an
     iframe without `allow="pointer-lock"` gets a pointerlockerror, and then the
     mousemove handler used to bail out on `!locked` and the mouse silently did
     nothing at all. Track the refusal so a fallback can take over instead. */
  var lockState = 'unknown';        // 'unknown' | 'locked' | 'denied'
  var pointerX = 0, pointerY = 0;   // cursor position in canvas space
  var pointerSeen = false;

  var SENS = 0.0021;
  // Fallback look: cursor distance from centre drives a turn rate, so the view
  // can be turned forever without pointer lock and without hitting an edge.
  var STEER_SENS = 3.4;             // rad/s at full deflection
  var STEER_DEADZONE = 0.12;        // fraction of the half-width ignored
  var yaw = 0, pitch = 0;

  var menuEl = document.getElementById('menu');
  var pauseEl = document.getElementById('pause');
  var pauseBody = document.getElementById('pauseBody');
  var bootEl = document.getElementById('boot');
  var lookHintEl = document.getElementById('lookHint');
  var btnPlay = document.getElementById('btnPlay');
  var btnResume = document.getElementById('btnResume');
  var btnRestart = document.getElementById('btnRestart');

  /* ------------------------------------------------------------------ *
   * Mode selection                                                      *
   * ------------------------------------------------------------------ *
     The list is generated from S.MODES, so the menu can never advertise a mode
     the simulation does not implement. Modes that are specified but not built
     stay visible and disabled, with their status shown honestly rather than
     quietly omitted.
   * ------------------------------------------------------------------ */

  var modeListEl = document.getElementById('modeList');
  var modeBlurbEl = document.getElementById('modeBlurb');
  var selectedModeId = S.DEFAULT_MODE;

  function refreshModeList() {
    if (!modeListEl) return;
    modeListEl.innerHTML = '';

    S.MODES.forEach(function (mode) {
      var row = document.createElement('div');
      row.className = 'mode' + (mode.playable ? ' pick' : ' dead');
      if (mode.playable && mode.id === selectedModeId) { row.className += ' sel live'; }
      row.setAttribute('data-mode', mode.id);
      row.setAttribute('data-playable', mode.playable ? '1' : '0');
      if (mode.playable) {
        row.addEventListener('click', function () { selectMode(mode.id); });
      }

      var nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = mode.name;

      var st = document.createElement('span');
      st.className = 'st';
      st.textContent = mode.playable
        ? (mode.id === selectedModeId ? 'SELECTED' : 'PLAYABLE')
        : mode.status;

      row.appendChild(nm);
      row.appendChild(st);
      modeListEl.appendChild(row);
    });

    if (modeBlurbEl) { modeBlurbEl.textContent = S.modeById(selectedModeId).blurb || ''; }
  }

  function selectMode(id) {
    var mode = S.modeById(id);
    if (!mode.playable) { return; }
    selectedModeId = mode.id;
    refreshModeList();
  }

  /* Start the currently selected mode. Shared by the deploy button and the
     debug entry point so both take exactly the same path — a harness that
     switched modes by some other route would be testing code the player never
     runs.
     Rebuilding the character views matters: Sim.init() creates brand-new
     character objects, so the previous match's meshes would linger as ghosts. */
  function startSelectedMode() {
    if (Sim.mode.id !== selectedModeId) {
      Sim.init(selectedModeId);
      clearCharacterViews();
      Sim.chars.forEach(buildCharacterView);
      yaw = Sim.player.yaw;
      pitch = 0;
      killFeedUi.length = 0;
      hitMarkerTimer = 0;
      damageIndicatorTimer = 0;
      modeNoticeTimer = 0;
    }
    started = true;
    menuEl.classList.add('hide');
  }

  function lockPointer() {
    var el = renderer.domElement;
    if (!el.requestPointerLock) { lockState = 'denied'; showLookHint(); return; }
    // Chrome returns a promise; Firefox returns undefined. A refusal is
    // reported through pointerlockerror as well, so handle both.
    var r = el.requestPointerLock();
    if (r && r.catch) { r.catch(function () { onLockDenied(); }); }
  }

  function onLockDenied() {
    if (lockState === 'locked') { return; }
    lockState = 'denied';
    showLookHint();
  }

  /* Says what is wrong rather than leaving the player to guess why the mouse
     does nothing. Removed as soon as a real lock is acquired. */
  function showLookHint() {
    if (!lookHintEl) { return; }
    lookHintEl.classList.remove('hide');
  }
  function hideLookHint() {
    if (!lookHintEl) { return; }
    lookHintEl.classList.add('hide');
  }

  btnPlay.addEventListener('click', function () {
    Sound.unlock();
    startSelectedMode();
    lockPointer();
  });

  btnResume.addEventListener('click', function () {
    pauseEl.classList.add('hide');
    paused = false;
    lockPointer();
  });

  btnRestart.addEventListener('click', function () {
    restartMatch();
    pauseEl.classList.add('hide');
    paused = false;
    lockPointer();
  });

  renderer.domElement.addEventListener('click', function () {
    if (started && !locked && !paused) lockPointer();
  });

  document.addEventListener('pointerlockchange', function () {
    locked = (document.pointerLockElement === renderer.domElement);
    if (locked) {
      lockState = 'locked';
      hideLookHint();
    }
    if (!locked && started && lockState !== 'denied') {
      paused = true;
      pauseBody.textContent = Sim.match.over
        ? 'Match complete. ' + describeScore()
        : 'Match suspended — ' + describeScore();
      pauseEl.classList.remove('hide');
      input.fire = false;
      input.forward = 0;
      input.right = 0;
      keys = Object.create(null);
    }
  });

  document.addEventListener('pointerlockerror', onLockDenied);

  document.addEventListener('mousemove', function (e) {
    // Track the cursor unconditionally: the fallback look needs it even when
    // pointer lock was refused.
    var rect = renderer.domElement.getBoundingClientRect();
    pointerX = e.clientX - rect.left;
    pointerY = e.clientY - rect.top;
    pointerSeen = true;

    if (!locked) return;
    var fovScale = (camera.fov / CFG.FOV);
    var sens = SENS * fovScale;
    yaw = yaw - e.movementX * sens;
    pitch = Math.max(-1.54, Math.min(1.54, pitch - e.movementY * sens));
  });

  /* Fallback look, applied per frame rather than per event.
     The cursor's offset from the centre of the canvas acts as a steering input:
     centred means "hold still", pushed to the edge means "keep turning". That
     turns forever without pointer lock, which a raw-delta fallback cannot do —
     the cursor would simply hit the window edge and stop. */
  function applyFallbackLook(dt) {
    if (lockState !== 'denied' || !pointerSeen) { return; }

    var rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) { return; }

    var nx = (pointerX / rect.width) * 2 - 1;
    var ny = (pointerY / rect.height) * 2 - 1;

    function curve(v) {
      var a = Math.abs(v);
      if (a <= STEER_DEADZONE) { return 0; }
      var t = (a - STEER_DEADZONE) / (1 - STEER_DEADZONE);
      return (v < 0 ? -1 : 1) * t * t;      // squared: fine control near centre
    }

    var sx = curve(nx), sy = curve(ny);
    if (sx === 0 && sy === 0) { return; }

    yaw -= sx * STEER_SENS * dt;
    pitch = Math.max(-1.54, Math.min(1.54, pitch - sy * STEER_SENS * 0.7 * dt));
  }

  document.addEventListener('mousedown', function (e) {
    // Buttons work under pointer lock and in fallback mode. In fallback the
    // cursor steers by position rather than by dragging, so a click does not
    // disturb the aim and firing stays usable.
    if (!locked && lockState !== 'denied') return;
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
    if (e.button === 2) input.ads = true;
  });

  document.addEventListener('mouseup', function (e) {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.ads = false;
  });

  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('keydown', function (e) {
    var k = e.code;
    if (keys[k]) return;           // ignore auto-repeat for edge-triggered keys
    keys[k] = true;

    if (k === 'Tab') e.preventDefault();
    if (k === 'KeyR') input.reload = true;
    if (k === 'Digit1') input.switchTo = 0;
    if (k === 'Digit2') input.switchTo = 1;
    if (k === 'Digit3') input.switchTo = 2;
    if (k === 'Digit4') input.switchTo = 3;
    if (k === 'Tab') scoreboardHeld = true;
  });

  document.addEventListener('keyup', function (e) {
    keys[e.code] = false;
    if (e.code === 'Tab') scoreboardHeld = false;
  });

  function pollKeys() {
    input.forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    input.right = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    input.jump = !!keys['Space'];
    input.crouch = !!(keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']);
    input.sprint = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  }

  /* ===================================================================== *
   * Match control                                                         *
   * ===================================================================== */
  function describeScore() {
    var m = Sim.match;
    if (m.teams) {
      // Domination score accrues continuously; floor it for display.
      return 'BLUE ' + Math.floor(m.blueScore) + ' — ' + Math.floor(m.redScore) + ' RED';
    }
    // Individual modes have no team line to show, so the summary is the top three.
    var board = Sim.standings().slice(0, 3);
    return board.map(function (c) {
      return c.name + ' ' + (Sim.mode.ladder ? (c.rung + '/' + Sim.ladderLength()) : c.score);
    }).join('   ·   ');
  }

  function clearCharacterViews() {
    // Sim.reset() replaces Sim.chars with brand-new objects, so without this
    // the previous match's meshes stay in the scene forever as ghosts standing
    // at their last positions.
    for (var i = 0; i < Sim.chars.length; i++) {
      var v = Sim.chars[i].view;
      if (v && v.group && v.group.parent) v.group.parent.remove(v.group);
    }
  }

  function restartMatch() {
    clearCharacterViews();
    Sim.reset();
    Sim.chars.forEach(buildCharacterView);
    yaw = Sim.player.yaw;
    pitch = 0;
    killFeedUi.length = 0;
    hitMarkerTimer = 0;
    damageIndicatorTimer = 0;
    Sound.spawn();
  }

  /* ===================================================================== *
   * HUD state                                                             *
   * ===================================================================== */
  var killFeedUi = [];
  var hitMarkerTimer = 0;
  var hitMarkerKill = false;
  var damageIndicatorTimer = 0;
  var damageIndicatorAngle = 0;

  // Transient objective notice: zone captured, rung gained or lost.
  var modeNotice = '';
  var modeNoticeTimer = 0;
  var modeNoticeColour = '#e9eef5';
  var lastHealth = CFG.MAX_HEALTH;
  var damageFlash = 0;
  var footstepTimer = 0;
  var fps = 0;

  /* Objective feedback shared by the zone-capture and ladder events. */
  function setModeNotice(text, colour) {
    modeNotice = text;
    modeNoticeColour = colour || '#e9eef5';
    modeNoticeTimer = 2.6;
  }

  function drainEvents() {
    var p = Sim.player;
    for (var i = 0; i < Sim.events.length; i++) {
      var e = Sim.events[i];
      switch (e.type) {
        case 'shot':
          Sound.shot(S.WEAPONS[p.current].class, 0);
          muzzleFlashTimer = 0.045;
          // tracer from the muzzle toward whatever is in front
          (function () {
            var fwd = Sim.forwardFrom(p.yaw + p.recoilYaw, Math.max(-1.55, Math.min(1.55, p.pitch + p.recoilPitch)));
            var ro = [p.pos[0], p.pos[1] + CFG.EYE_HEIGHT + CFG.CAPSULE_HALF, p.pos[2]];
            var wh = Arena.raycast(ro, fwd, CFG.MAX_TRACE);
            var end = wh ? wh.point : [ro[0] + fwd[0] * 12000, ro[1] + fwd[1] * 12000, ro[2] + fwd[2] * 12000];
            var start = [ro[0] + fwd[0] * 60 - 18, ro[1] + fwd[1] * 60 - 14, ro[2] + fwd[2] * 60];
            spawnTracer(start, end);
            if (wh) Sound.impact(wh.t);
          })();
          break;
        case 'hit':
          hitMarkerTimer = 0.30;
          hitMarkerKill = e.kill;
          Sound.hitmarker(e.kill);
          break;
        case 'damage':
          damageIndicatorTimer = 1.1;
          (function () {
            var fwd = Sim.forwardFrom(p.yaw, 0);
            var dx = e.from[0] - p.pos[0], dz = e.from[2] - p.pos[2];
            var l = Math.sqrt(dx * dx + dz * dz) || 1;
            var ux = dx / l, uz = dz / l;
            var dot = fwd[0] * ux + fwd[2] * uz;
            var cross = fwd[0] * uz - fwd[2] * ux;
            damageIndicatorAngle = Math.atan2(cross, dot);
          })();
          damageFlash = 0.5;
          Sound.hurt();
          break;
        case 'kill':
          killFeedUi.unshift({ text: e, time: Sim.now });
          while (killFeedUi.length > CFG.KILLFEED_MAX) killFeedUi.pop();
          if (e.playerInvolved) Sound.hitmarker(true);
          break;
        case 'reloadStart':
          Sound.reloadStart();
          break;
        case 'reloadEnd':
          Sound.reloadEnd();
          break;
        case 'dryfire':
        case 'magEmpty':
          Sound.empty();
          break;
        case 'respawn':
          Sound.spawn();
          break;
        case 'matchOver':
          Sound.matchEnd();
          break;
        case 'zoneCaptured':
          Sound.unlock();
          setModeNotice(
            (e.team === S.TEAM.BLUE ? 'BLUE' : 'RED') + ' CAPTURED ' + e.zone,
            e.team === S.TEAM.BLUE ? '#4ea1ff' : '#ff5c5c');
          break;
        case 'promoted':
          Sound.hitmarker(true);
          setModeNotice('PROMOTED  ·  ' + e.weapon + '  ' + e.rung + '/' + e.max, '#ffb347');
          break;
        case 'demoted':
          Sound.empty();
          setModeNotice('DEMOTED  ·  ' + e.weapon + '  ' + e.rung + '/' + e.max, '#ff5c5c');
          break;
      }
    }
    Sim.events.length = 0;

    // prune UI killfeed
    for (var k = killFeedUi.length - 1; k >= 0; k--) {
      if (Sim.now - killFeedUi[k].time > CFG.KILLFEED_LIFE) killFeedUi.splice(k, 1);
    }
  }

  var muzzleFlashTimer = 0;

  /* ===================================================================== *
   * HUD drawing                                                           *
   * ===================================================================== */
  var FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  function drawCrosshair(W, H) {
    var p = Sim.player;
    var cx = W / 2, cy = H / 2;

    if (!p.alive) return;

    var w = S.WEAPONS[p.current];
    var scoped = p.aiming && w.class === 'SNIPER';
    if (scoped) { drawScope(W, H); return; }

    var spread = Sim.getSpreadDeg(p);
    var gap = 6 + spread * 14;
    var len = 9;
    var thick = 1.6;

    var alpha = p.aiming ? 0.95 : 0.78;
    hud.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
    hud.lineWidth = thick;
    hud.beginPath();
    hud.moveTo(cx - gap - len, cy); hud.lineTo(cx - gap, cy);
    hud.moveTo(cx + gap, cy);       hud.lineTo(cx + gap + len, cy);
    hud.moveTo(cx, cy - gap - len); hud.lineTo(cx, cy - gap);
    hud.moveTo(cx, cy + gap);       hud.lineTo(cx, cy + gap + len);
    hud.stroke();

    hud.fillStyle = 'rgba(255,255,255,0.9)';
    hud.fillRect(cx - 1, cy - 1, 2, 2);
  }

  function drawScope(W, H) {
    var cx = W / 2, cy = H / 2;
    var r = Math.min(W, H) * 0.40;

    hud.save();
    hud.fillStyle = 'rgba(0,0,0,0.94)';
    hud.beginPath();
    hud.rect(0, 0, W, H);
    hud.arc(cx, cy, r, 0, Math.PI * 2, true);
    hud.fill();

    hud.strokeStyle = 'rgba(0,0,0,0.9)';
    hud.lineWidth = 3;
    hud.beginPath(); hud.arc(cx, cy, r, 0, Math.PI * 2); hud.stroke();

    hud.strokeStyle = 'rgba(12,14,16,0.95)';
    hud.lineWidth = 1.4;
    hud.beginPath();
    hud.moveTo(cx - r, cy); hud.lineTo(cx + r, cy);
    hud.moveTo(cx, cy - r); hud.lineTo(cx, cy + r);
    hud.stroke();

    // mil-dot ladder
    hud.fillStyle = 'rgba(12,14,16,0.95)';
    for (var i = 1; i <= 5; i++) {
      var y = cy + i * (r / 7);
      hud.fillRect(cx - 5, y - 1, 10, 2);
    }
    hud.beginPath(); hud.arc(cx, cy, 2.2, 0, Math.PI * 2); hud.fill();
    hud.restore();
  }

  function drawHitMarker(W, H) {
    if (hitMarkerTimer <= 0) return;
    var a = Math.min(1, hitMarkerTimer / 0.30);
    var cx = W / 2, cy = H / 2;
    var r0 = 9, r1 = 17;

    hud.strokeStyle = hitMarkerKill
      ? 'rgba(255,90,90,' + a + ')'
      : 'rgba(255,255,255,' + a + ')';
    hud.lineWidth = 2.4;
    hud.beginPath();
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
      hud.moveTo(cx + d[0] * r0 * 0.75, cy + d[1] * r0 * 0.75);
      hud.lineTo(cx + d[0] * r1, cy + d[1] * r1);
    });
    hud.stroke();
  }

  function drawDamageDirection(W, H) {
    if (damageIndicatorTimer <= 0) return;
    var a = Math.min(1, damageIndicatorTimer / 1.1);
    var cx = W / 2, cy = H / 2;
    var R = Math.min(W, H) * 0.17;

    hud.save();
    hud.translate(cx, cy);
    hud.rotate(damageIndicatorAngle);
    hud.strokeStyle = 'rgba(255,70,70,' + (a * 0.9) + ')';
    hud.lineWidth = 4;
    hud.beginPath();
    hud.arc(0, 0, R, -Math.PI / 2 - 0.34, -Math.PI / 2 + 0.34);
    hud.stroke();
    hud.restore();
  }

  function bar(x, y, w, h, frac, fill, back) {
    hud.fillStyle = back;
    hud.fillRect(x, y, w, h);
    hud.fillStyle = fill;
    hud.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    hud.strokeStyle = 'rgba(255,255,255,0.22)';
    hud.lineWidth = 1;
    hud.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawVitals(W, H) {
    var p = Sim.player;
    var x = 30, y = H - 96;

    hud.font = '600 11px ' + FONT;
    hud.textAlign = 'left';
    hud.textBaseline = 'alphabetic';

    hud.fillStyle = 'rgba(150,162,176,0.9)';
    hud.fillText('HEALTH', x, y - 8);
    hud.fillStyle = 'rgba(150,162,176,0.9)';
    hud.fillText('ARMOUR', x + 200, y - 8);

    var hpFrac = p.health / CFG.MAX_HEALTH;
    var hpCol = hpFrac > 0.6 ? '#5fd07a' : hpFrac > 0.3 ? '#ffb347' : '#ff5c5c';
    bar(x, y, 170, 12, hpFrac, hpCol, 'rgba(0,0,0,0.5)');
    bar(x + 200, y, 170, 12, p.armor / CFG.MAX_ARMOR, '#6fb6ff', 'rgba(0,0,0,0.5)');

    hud.font = '700 22px ' + FONT;
    hud.fillStyle = '#e9eef5';
    hud.fillText(String(Math.ceil(p.health)), x + 6, y + 34);
    hud.font = '700 16px ' + FONT;
    hud.fillStyle = 'rgba(200,212,226,0.85)';
    hud.fillText(String(Math.ceil(p.armor)), x + 206, y + 34);

    if (!p.alive) {
      var t = Math.max(0, p.respawnAt - Sim.now);
      hud.textAlign = 'center';
      hud.font = '700 15px ' + FONT;
      hud.fillStyle = '#ff6b6b';
      hud.fillText('ELIMINATED', W / 2, H / 2 - 44);
      hud.font = '600 12px ' + FONT;
      hud.fillStyle = 'rgba(230,236,244,0.85)';
      hud.fillText('respawning in ' + t.toFixed(1) + 's', W / 2, H / 2 - 22);
    }
  }

  function drawAmmo(W, H) {
    var p = Sim.player;
    var w = S.WEAPONS[p.current];
    var x = W - 30;

    hud.textAlign = 'right';
    hud.textBaseline = 'alphabetic';

    hud.font = '600 11px ' + FONT;
    hud.fillStyle = 'rgba(150,162,176,0.9)';
    hud.fillText(w.class, x, H - 104);
    hud.font = '700 15px ' + FONT;
    hud.fillStyle = '#e9eef5';
    hud.fillText(w.name.toUpperCase(), x, H - 84);

    var mag = p.mags[p.current];
    var res = p.reserves[p.current];

    hud.font = '700 40px ' + FONT;
    hud.fillStyle = mag === 0 ? '#ff5c5c' : (mag <= w.mag * 0.25 ? '#ffb347' : '#e9eef5');
    var magTxt = String(mag);
    hud.fillText(magTxt, x, H - 38);

    var magW = hud.measureText(magTxt).width;
    hud.font = '600 17px ' + FONT;
    hud.fillStyle = 'rgba(150,162,176,0.95)';
    hud.fillText('/ ' + res, x, H - 38);

    if (p.reloadTimer > 0) {
      var frac = 1 - (p.reloadTimer / w.reloadTime);
      bar(x - 170, H - 28, 170, 6, frac, '#ffb347', 'rgba(0,0,0,0.5)');
      hud.font = '600 10px ' + FONT;
      hud.fillStyle = 'rgba(255,179,71,0.95)';
      hud.fillText('RELOADING', x, H - 34);
    } else if (mag === 0) {
      hud.font = '600 11px ' + FONT;
      hud.fillStyle = '#ff5c5c';
      hud.fillText('PRESS R TO RELOAD', x, H - 34);
    }
  }

  function drawWeaponList(W, H) {
    var p = Sim.player;
    var x = W - 30;
    var y = H - 130;

    hud.textAlign = 'right';
    hud.textBaseline = 'alphabetic';
    hud.font = '600 11px ' + FONT;

    for (var i = S.WEAPONS.length - 1; i >= 0; i--) {
      var sel = (i === p.current);
      hud.fillStyle = sel ? '#ffb347' : 'rgba(150,162,176,0.55)';
      var label = (i + 1) + '  ' + S.WEAPONS[i].short;
      if (sel) label += '  ◄';
      hud.fillText(label, x, y - (S.WEAPONS.length - 1 - i) * 16);
    }
  }

  /* One-line "what wins this match" caption under the clock. */
  function modeSubtitle(mode) {
    var name = mode.name.toUpperCase();
    if (mode.ladder) { return name + '  ·  CLEAR ' + mode.ladder.length + ' RUNGS'; }
    if (mode.zones)  { return name + '  ·  HOLD ZONES  ·  FIRST TO ' + mode.scoreLimit; }
    return name + '  ·  FIRST TO ' + mode.scoreLimit + ' ' + mode.scoreLabel;
  }

  function drawTopBar(W) {
    var m = Sim.match;
    var mode = Sim.mode;
    var cx = W / 2;

    hud.textAlign = 'center';
    hud.textBaseline = 'alphabetic';

    // clock
    var t = Math.max(0, Math.ceil(m.timeLeft));
    var mm = Math.floor(t / 60);
    var ss = t % 60;
    var clock = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;

    hud.fillStyle = 'rgba(6,9,13,0.72)';
    hud.fillRect(cx - 150, 14, 300, 46);
    hud.strokeStyle = 'rgba(255,255,255,0.14)';
    hud.lineWidth = 1;
    hud.strokeRect(cx - 149.5, 14.5, 299, 45);

    if (m.teams) {
      // ---- team scoreboard ------------------------------------------
      // Domination accrues score continuously, so floor it for display.
      var blue = Math.floor(m.blueScore);
      var red = Math.floor(m.redScore);

      hud.font = '700 12px ' + FONT;
      hud.fillStyle = '#4ea1ff';
      hud.textAlign = 'left';
      hud.fillText('BLUE', cx - 134, 34);
      hud.font = '700 26px ' + FONT;
      hud.fillStyle = blue >= red ? '#e9eef5' : 'rgba(180,190,202,0.75)';
      hud.fillText(String(blue), cx - 134, 55);

      hud.font = '700 12px ' + FONT;
      hud.fillStyle = '#ff5c5c';
      hud.textAlign = 'right';
      hud.fillText('RED', cx + 134, 34);
      hud.font = '700 26px ' + FONT;
      hud.fillStyle = red >= blue ? '#e9eef5' : 'rgba(180,190,202,0.75)';
      hud.fillText(String(red), cx + 134, 55);
    } else {
      // ---- individual scoreboard: the leader, then you ----------------
      var board = Sim.standings();
      var leader = board[0];
      var readout = function (c) {
        if (!c) { return '—'; }
        return mode.ladder ? (c.rung + '/' + Sim.ladderLength()) : String(c.score);
      };

      hud.font = '700 12px ' + FONT;
      hud.fillStyle = 'rgba(150,162,176,0.9)';
      hud.textAlign = 'left';
      hud.fillText('LEADER', cx - 134, 34);
      hud.font = '700 16px ' + FONT;
      hud.fillStyle = '#ffb347';
      hud.fillText(leader ? (leader.name + '  ' + readout(leader)) : '—', cx - 134, 55);

      hud.font = '700 12px ' + FONT;
      hud.fillStyle = 'rgba(150,162,176,0.9)';
      hud.textAlign = 'right';
      hud.fillText('YOU', cx + 134, 34);
      hud.font = '700 16px ' + FONT;
      hud.fillStyle = '#e9eef5';
      hud.fillText(readout(Sim.player), cx + 134, 55);
    }

    hud.textAlign = 'center';
    hud.font = '700 20px ' + FONT;
    hud.fillStyle = m.timeLeft < 60 ? '#ffb347' : '#e9eef5';
    hud.fillText(clock, cx, 48);

    hud.font = '600 9px ' + FONT;
    hud.fillStyle = 'rgba(150,162,176,0.85)';
    hud.fillText(modeSubtitle(mode), cx, 74);
  }

  function drawKillFeed(W) {
    var x = W - 30;
    var y = 34;

    hud.textAlign = 'right';
    hud.textBaseline = 'alphabetic';
    hud.font = '600 12px ' + FONT;

    for (var i = 0; i < killFeedUi.length; i++) {
      var item = killFeedUi[i];
      var age = Sim.now - item.time;
      var a = age > CFG.KILLFEED_LIFE - 1.2
        ? Math.max(0, (CFG.KILLFEED_LIFE - age) / 1.2)
        : 1;

      var e = item.text;
      var kName = e.killer;
      var vName = e.victim;

      hud.globalAlpha = a;

      hud.textAlign = 'right';
      hud.fillStyle = 'rgba(6,9,13,0.62)';
      var textW = hud.measureText(kName + '  ▸  ' + vName + '   [' + e.weapon + ']').width + 20;
      hud.fillRect(x - textW, y - 14, textW, 20);

      var cursor = x - 10;
      hud.fillStyle = 'rgba(150,162,176,0.85)';
      hud.fillText('[' + e.weapon + ']', cursor, y);
      cursor -= hud.measureText('[' + e.weapon + ']').width + 10;

      // accentHex, not teamHex: in free-for-all there is no team colour to use,
      // so each operator shows its own accent instead of all reading as RED.
      hud.fillStyle = accentHex(e.victimTeam);
      hud.fillText(vName, cursor, y);
      cursor -= hud.measureText(vName).width + 8;

      hud.fillStyle = 'rgba(200,210,222,0.7)';
      hud.fillText(e.headshot ? '⌖' : '▸', cursor, y);
      cursor -= hud.measureText(e.headshot ? '⌖' : '▸').width + 8;

      hud.fillStyle = accentHex(e.killerTeam);
      hud.fillText(kName, cursor, y);

      hud.globalAlpha = 1;
      y += 22;
    }
  }

  function drawScoreboard(W, H) {
    var m = Sim.match;
    var mode = Sim.mode;

    hud.fillStyle = 'rgba(5,7,10,0.86)';
    hud.fillRect(0, 0, W, H);

    var cw = Math.min(920, W - 80);
    var x0 = (W - cw) / 2;
    var y0 = Math.max(70, H / 2 - 260);

    hud.textAlign = 'left';
    hud.textBaseline = 'alphabetic';
    hud.font = '700 22px ' + FONT;
    hud.fillStyle = '#e9eef5';
    hud.fillText('SANDLINE  ·  ' + mode.name.toUpperCase(), x0, y0 - 22);

    hud.font = '600 12px ' + FONT;
    hud.fillStyle = 'rgba(150,162,176,0.9)';
    hud.textAlign = 'right';
    hud.fillText(modeSubtitle(mode) + '   ·   ' + describeScore(), x0 + cw, y0 - 22);

    if (m.teams) {
      var colW = (cw - 24) / 2;
      drawTeamRoster(x0, y0, colW, S.TEAM.BLUE, Math.floor(m.blueScore));
      drawTeamRoster(x0 + colW + 24, y0, colW, S.TEAM.RED, Math.floor(m.redScore));
    } else {
      drawIndividualBoard(x0, y0, cw, mode);
    }
  }

  /* Free-for-all and Gun Game board: one ranked list, everyone against
     everyone. Gun Game shows the ladder rung because the rung, not the frag
     count, is what wins that mode. */
  function drawIndividualBoard(x, y, w, mode) {
    hud.textAlign = 'left';
    hud.font = '600 10px ' + FONT;
    hud.fillStyle = 'rgba(140,152,166,0.9)';
    hud.fillText('#', x, y + 40);
    hud.fillText('OPERATOR', x + 30, y + 40);
    hud.textAlign = 'right';
    if (mode.ladder) { hud.fillText('RUNG', x + w - 116, y + 40); }
    hud.fillText('K', x + w - 46, y + 40);
    hud.fillText('D', x + w, y + 40);

    hud.strokeStyle = 'rgba(255,255,255,0.16)';
    hud.lineWidth = 1;
    hud.beginPath();
    hud.moveTo(x, y + 48); hud.lineTo(x + w, y + 48);
    hud.stroke();

    var board = Sim.standings();
    for (var i = 0; i < board.length; i++) {
      var c = board[i];
      var ry = y + 68 + i * 22;
      var isMe = (c === Sim.player);

      hud.textAlign = 'left';
      hud.font = (isMe ? '700' : '600') + ' 12px ' + FONT;
      hud.fillStyle = c.alive ? 'rgba(233,238,245,0.95)' : 'rgba(233,238,245,0.40)';
      hud.fillText(String(i + 1), x, ry);
      hud.fillText((isMe ? '▸ ' : '  ') + c.name, x + 30, ry);

      hud.textAlign = 'right';
      if (mode.ladder) {
        hud.fillStyle = '#ffb347';
        hud.fillText(c.rung + '/' + Sim.ladderLength(), x + w - 116, ry);
      }
      hud.fillStyle = 'rgba(233,238,245,' + (c.alive ? 0.9 : 0.35) + ')';
      hud.fillText(String(c.kills), x + w - 46, ry);
      hud.fillText(String(c.deaths), x + w, ry);
    }
  }

  function drawTeamRoster(x, y, w, team, score) {
    hud.textAlign = 'left';
    hud.font = '700 13px ' + FONT;
    hud.fillStyle = S.teamHex(team);
    hud.fillText(S.teamName(team), x, y + 14);

    hud.textAlign = 'right';
    hud.font = '700 20px ' + FONT;
    hud.fillText(String(score), x + w, y + 14);

    hud.strokeStyle = 'rgba(255,255,255,0.16)';
    hud.lineWidth = 1;
    hud.beginPath();
    hud.moveTo(x, y + 24); hud.lineTo(x + w, y + 24);
    hud.stroke();

    hud.font = '600 10px ' + FONT;
    hud.fillStyle = 'rgba(140,152,166,0.9)';
    hud.textAlign = 'left';
    hud.fillText('OPERATOR', x, y + 40);
    hud.textAlign = 'right';
    hud.fillText('K', x + w - 46, y + 40);
    hud.fillText('D', x + w, y + 40);

    var rows = Sim.chars.filter(function (c) { return c.team === team; });
    rows.sort(function (a, b) { return b.kills - a.kills || a.deaths - b.deaths; });

    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      var ry = y + 60 + i * 22;

      hud.fillStyle = c.alive ? 'rgba(233,238,245,0.95)' : 'rgba(233,238,245,0.40)';
      hud.textAlign = 'left';
      hud.font = (c === Sim.player ? '700' : '600') + ' 12px ' + FONT;
      hud.fillText((c === Sim.player ? '▸ ' : '  ') + c.name, x, ry);

      hud.textAlign = 'right';
      hud.fillStyle = 'rgba(233,238,245,' + (c.alive ? 0.9 : 0.35) + ')';
      hud.fillText(String(c.kills), x + w - 46, ry);
      hud.fillText(String(c.deaths), x + w, ry);
    }
  }

  function drawBanner(W, H) {
    var m = Sim.match;
    if (!m.over) return;

    hud.fillStyle = 'rgba(5,7,10,0.55)';
    hud.fillRect(0, H / 2 - 96, W, 192);

    hud.textAlign = 'center';
    hud.textBaseline = 'alphabetic';

    var label, colour;
    if (m.teams) {
      label = m.winner === S.TEAM.BLUE ? 'BLUE TEAM WINS'
            : m.winner === S.TEAM.RED ? 'RED TEAM WINS'
            : 'DRAW';
      colour = m.winner ? S.teamHex(m.winner) : '#e9eef5';
    } else if (m.winnerName) {
      // Individual modes are won by a person, so name them rather than a team.
      label = m.winnerName + ' WINS';
      colour = '#ffb347';
    } else {
      label = 'DRAW';
      colour = '#e9eef5';
    }

    hud.font = '700 44px ' + FONT;
    hud.fillStyle = colour;
    hud.fillText(label, W / 2, H / 2 - 14);

    hud.font = '600 13px ' + FONT;
    hud.fillStyle = 'rgba(220,228,238,0.85)';
    hud.fillText(describeScore(), W / 2, H / 2 + 18);

    var left = Math.max(0, CFG.MATCH_RESTART_DELAY - m.restartTimer);
    hud.font = '600 11px ' + FONT;
    hud.fillStyle = 'rgba(150,162,176,0.9)';
    hud.fillText('next match in ' + left.toFixed(0) + 's   ·   Esc for the menu', W / 2, H / 2 + 48);
  }

  function drawDamageFlash(W, H) {
    if (damageFlash <= 0) return;
    hud.fillStyle = 'rgba(190,30,30,' + (damageFlash * 0.30) + ')';
    hud.fillRect(0, 0, W, H);
  }

  function drawStatus(W, H) {
    hud.textAlign = 'left';
    hud.textBaseline = 'alphabetic';
    hud.font = '600 10px ' + FONT;
    hud.fillStyle = 'rgba(120,132,146,0.75)';
    hud.fillText('SANDLINE 0.1  ·  ' + fps.toFixed(0) + ' fps  ·  Tab: scoreboard' +
      (quality < 3 ? '  ·  quality ' + quality + '/3 (auto)' : ''), 30, H - 14);
  }

  /* Domination: A / B / C pills showing ownership and capture progress, with
     the ownership count underneath. Sits under the top bar. */
  function drawZones(W) {
    var zones = Sim.match.zones;
    if (!zones || !zones.length) return;

    var boxW = 62, gap = 8;
    var total = zones.length * boxW + (zones.length - 1) * gap;
    var x = (W - total) / 2;
    var y = 92;

    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var bx = x + i * (boxW + gap);
      var owner = z.owner === S.TEAM.BLUE ? '#4ea1ff'
                : z.owner === S.TEAM.RED ? '#ff5c5c'
                : 'rgba(150,162,176,0.55)';

      hud.fillStyle = 'rgba(6,9,13,0.72)';
      hud.fillRect(bx, y, boxW, 34);
      hud.strokeStyle = owner;
      hud.lineWidth = z.owner ? 2 : 1;
      hud.strokeRect(bx + 0.5, y + 0.5, boxW - 1, 33);

      hud.textAlign = 'center';
      hud.font = '700 16px ' + FONT;
      hud.fillStyle = owner;
      hud.fillText(z.name, bx + boxW / 2, y + 22);

      // capture progress along the bottom edge
      if (z.progress > 0) {
        hud.fillStyle = z.capturing === S.TEAM.BLUE ? '#4ea1ff' : '#ff5c5c';
        hud.fillRect(bx + 1, y + 30, (boxW - 2) * Math.min(1, z.progress), 3);
      }
    }

    var b = 0, r = 0;
    for (var q = 0; q < zones.length; q++) {
      if (zones[q].owner === S.TEAM.BLUE) b++;
      else if (zones[q].owner === S.TEAM.RED) r++;
    }

    hud.textAlign = 'center';
    hud.font = '600 9px ' + FONT;
    hud.fillStyle = 'rgba(150,162,176,0.85)';
    hud.fillText('BLUE ' + b + '   ·   RED ' + r, W / 2, y + 48);
  }

  /* Transient objective message: zone captures and ladder changes. */
  function drawModeNotice(W) {
    if (modeNoticeTimer <= 0 || !modeNotice) return;
    hud.textAlign = 'center';
    hud.font = '700 14px ' + FONT;
    hud.fillStyle = modeNoticeColour;
    hud.globalAlpha = Math.min(1, modeNoticeTimer / 0.6);
    hud.fillText(modeNotice, W / 2, Sim.mode.zones ? 172 : 108);
    hud.globalAlpha = 1;
  }

  function drawHUD() {
    var W = hudCanvas.clientWidth || root.innerWidth;
    var H = hudCanvas.clientHeight || root.innerHeight;

    // Re-apply the device-pixel-ratio transform to match resize(). Resetting
    // to identity here would draw the entire HUD at 1/dpr scale in the
    // top-left corner on any HiDPI display — which is most laptops running at
    // 125-150% scaling.
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    hud.setTransform(dpr, 0, 0, dpr, 0, 0);
    hud.clearRect(0, 0, W, H);

    if (!started) return;

    drawDamageFlash(W, H);

    if (scoreboardHeld) {
      drawScoreboard(W, H);
      return;
    }

    drawCrosshair(W, H);
    drawDamageDirection(W, H);
    drawHitMarker(W, H);
    drawVitals(W, H);
    drawAmmo(W, H);
    drawWeaponList(W, H);
    drawTopBar(W);
    drawZones(W);
    drawModeNotice(W);
    drawKillFeed(W);
    drawBanner(W, H);
    drawStatus(W, H);
  }

  /* ===================================================================== *
   * Per-frame visual sync                                                 *
   * ===================================================================== */
  var EYE = CFG.EYE_HEIGHT + CFG.CAPSULE_HALF;   // 152 cm
  var bobPhase = 0;
  var vmRecoil = 0;
  var vmSwayX = 0, vmSwayY = 0;
  var adsBlend = 0;

  function syncCharacters(dt) {
    for (var i = 0; i < Sim.chars.length; i++) {
      var ch = Sim.chars[i];
      var v = ch.view;
      if (!v) continue;

      v.group.position.set(ch.pos[0], ch.pos[1], ch.pos[2]);

      if (ch.alive) {
        v.deadTilt = 0;                 // reset so the next death animates again
        v.group.rotation.set(0, 0, 0);
        v.group.rotation.y = ch.yaw;
        v.torso.rotation.x = -ch.pitch;
        var targetScale = ch.crouching ? 0.62 : 1;
        v.group.scale.y += (targetScale - v.group.scale.y) * Math.min(1, dt * 12);

        // bots turn their gun toward their aim; the player's model is hidden
        v.gun.rotation.x = 0;

        // Walk cycle. Legs swing with ground speed, so an operator crossing
        // the yard reads as walking rather than sliding. Airborne legs tuck.
        var speed = Math.sqrt(ch.vel[0] * ch.vel[0] + ch.vel[2] * ch.vel[2]);
        if (ch.onGround) {
          v.walk += dt * (2.2 + speed * 0.055);
          var swing = Math.min(1, speed / CFG.WALK_SPEED) * 0.62;
          if (v.legL) { v.legL.rotation.x = Math.sin(v.walk) * swing; }
          if (v.legR) { v.legR.rotation.x = -Math.sin(v.walk) * swing; }
        } else {
          if (v.legL) { v.legL.rotation.x += (-0.35 - v.legL.rotation.x) * Math.min(1, dt * 6); }
          if (v.legR) { v.legR.rotation.x += (0.18 - v.legR.rotation.x) * Math.min(1, dt * 6); }
        }
      } else {
        // fall over
        v.deadTilt = Math.min(1, v.deadTilt + dt * 4);
        v.group.rotation.z = -v.deadTilt * Math.PI * 0.5;
        v.group.position.y = ch.pos[1] + v.deadTilt * 20;
        if (v.legL) { v.legL.rotation.x += (0.5 - v.legL.rotation.x) * Math.min(1, dt * 5); }
        if (v.legR) { v.legR.rotation.x += (-0.3 - v.legR.rotation.x) * Math.min(1, dt * 5); }
      }

      if (v.flashTimer > 0) {
        v.flashTimer -= dt;
        v.flash.visible = v.flashTimer > 0;
      }

      // the player never sees their own body
      v.group.visible = (ch !== Sim.player) && (ch.alive || v.deadTilt < 1.01);
      if (ch === Sim.player) v.group.visible = false;
    }
  }

  function syncPlayerCamera(dt) {
    var p = Sim.player;

    // aim = mouse + accumulated recoil
    var aimPitch = Math.max(-1.54, Math.min(1.54, pitch + p.recoilPitch));
    var aimYaw = yaw + p.recoilYaw;

    p.yaw = aimYaw;
    p.pitch = aimPitch;

    // head bob while grounded and moving
    var sp = Math.sqrt(p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2]);
    if (p.onGround && sp > 60) {
      bobPhase += dt * (p.sprinting ? 13 : 9);
    } else {
      bobPhase += dt * 2;
    }
    var bobAmt = p.onGround ? Math.min(1, sp / CFG.WALK_SPEED) * (p.sprinting ? 2.6 : 1.8) : 0;

    camera.position.set(
      p.pos[0] + Math.cos(bobPhase * 0.5) * bobAmt * 0.5,
      p.pos[1] + (p.crouching ? EYE * 0.72 : EYE) + Math.sin(bobPhase) * bobAmt,
      p.pos[2]
    );
    camera.rotation.y = aimYaw;
    camera.rotation.x = aimPitch;
    camera.rotation.z = Math.cos(bobPhase * 0.5) * bobAmt * 0.006;

    // --- field of view -----------------------------------------------
    var w = S.WEAPONS[p.current];
    var targetFov = p.aiming ? w.adsZoomFov : CFG.FOV;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();

    // --- viewmodel -----------------------------------------------------
    var scoped = p.aiming && w.class === 'SNIPER';
    adsBlend += ((p.aiming ? 1 : 0) - adsBlend) * Math.min(1, dt * 12);

    gunModels.forEach(function (m, i) { m.visible = (i === p.current) && !scoped; });

    var hipX = 24, hipY = -24, hipZ = -46;
    var adsX = 0, adsY = -11, adsZ = -30;
    var px = hipX + (adsX - hipX) * adsBlend;
    var py = hipY + (adsY - hipY) * adsBlend;
    var pz = hipZ + (adsZ - hipZ) * adsBlend;

    // sway from mouse motion + bob
    vmSwayX += ((-p.recoilYaw * 22) - vmSwayX) * Math.min(1, dt * 10);
    vmSwayY += ((p.recoilPitch * 26) - vmSwayY) * Math.min(1, dt * 10);

    vmRoot.position.set(
      px + Math.cos(bobPhase * 0.5) * bobAmt * 0.9 + vmSwayX * (1 - adsBlend),
      py + Math.sin(bobPhase * 1.0) * bobAmt * 0.6 + vmSwayY * (1 - adsBlend),
      pz + vmRecoil
    );
    vmRoot.rotation.x = -p.recoilPitch * 0.9 * (1 - adsBlend * 0.6);
    vmRoot.rotation.y = -p.recoilYaw * 0.5 * (1 - adsBlend);

    // muzzle flash on the viewmodel
    var gun = gunModels[p.current];
    muzzleFlash.visible = muzzleFlashTimer > 0;
    if (muzzleFlash.visible) {
      muzzleFlash.position.set(vmRoot.position.x + 0, vmRoot.position.y + 1, vmRoot.position.z + gun.userData.muzzleZ - 4);
      muzzleFlash.position.set(0, 1, gun.userData.muzzleZ - 4);
      muzzleFlash.rotation.z = Math.random() * Math.PI;
    }
    muzzleFlashTimer = Math.max(0, muzzleFlashTimer - dt);

    vmRecoil *= Math.max(0, 1 - dt * 12);
  }

  function decayHud(dt) {
    hitMarkerTimer = Math.max(0, hitMarkerTimer - dt);
    damageIndicatorTimer = Math.max(0, damageIndicatorTimer - dt);
    damageFlash = Math.max(0, damageFlash - dt * 2.2);
    modeNoticeTimer = Math.max(0, modeNoticeTimer - dt);

    // footsteps
    var p = Sim.player;
    var sp = Math.sqrt(p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2]);
    if (p.alive && p.onGround && sp > 90) {
      footstepTimer -= dt * (sp / CFG.WALK_SPEED);
      if (footstepTimer <= 0) {
        footstepTimer = p.sprinting ? 0.30 : 0.44;
        Sound.footstep();
      }
    } else {
      footstepTimer = 0.1;
    }
  }

  /* ===================================================================== *
   * Resize                                                                *
   * ===================================================================== */
  function resize() {
    var W = root.innerWidth, H = root.innerHeight;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();

    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    hudCanvas.width = Math.floor(W * dpr);
    hudCanvas.height = Math.floor(H * dpr);
    hudCanvas.style.width = W + 'px';
    hudCanvas.style.height = H + 'px';
    hud.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  root.addEventListener('resize', resize);

  /* ===================================================================== *
   * Main loop                                                             *
   * ===================================================================== */
  var lastT = performance.now();
  var fpsAccum = 0, fpsFrames = 0;
  var restartDone = false;

  /* ===================================================================== *
   * Adaptive quality                                                      *
   *                                                                       *
   * The build is comfortable on a GPU and unplayable without one. That    *
   * matters more than it sounds: a machine rendering this at 3 fps does   *
   * not merely look bad, it feels broken — the mouse appears not to work  *
   * because the view does not move until a third of a second later.       *
   *                                                                       *
   * So quality steps down on its own when frames get expensive, and back  *
   * up when they stop being expensive. Steps are deliberately far apart   *
   * and the recovery threshold is high, so it settles instead of          *
   * oscillating between levels.                                           *
   * ===================================================================== */

  var QUALITY_PIXEL_RATIO = [0.65, 0.9, 1.25, 2.0];
  var quality = 3;
  var qualityTimer = 0;
  var qualityHold = 1.5;          // settle time after a change

  function applyQuality(level) {
    if (level === quality) { return; }
    quality = level;

    var dpr = QUALITY_PIXEL_RATIO[level];
    var cap = Math.min(root.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(Math.min(dpr, cap));

    renderer.shadowMap.enabled = (level >= 3);
    S.MAT.setBumpEnabled(level >= 2);

    // Toggling shadows or a map changes the shader permutation, so every
    // material has to be recompiled once.
    scene.traverse(function (o) {
      if (o.material) {
        if (Array.isArray(o.material)) { o.material.forEach(function (m) { m.needsUpdate = true; }); }
        else { o.material.needsUpdate = true; }
      }
    });

    resize();
    qualityHold = 1.5;
  }

  function tuneQuality(dt) {
    qualityHold -= dt;
    if (qualityHold > 0) { return; }
    qualityTimer += dt;
    if (qualityTimer < 2.0) { return; }
    qualityTimer = 0;

    if (fps > 0 && fps < 26 && quality > 0) { applyQuality(quality - 1); }
    else if (fps > 52 && quality < 3) { applyQuality(quality + 1); }
  }

  function frame(now) {
    requestAnimationFrame(frame);

    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 1 / 60;

    fpsAccum += dt; fpsFrames++;
    if (fpsAccum >= 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

    if (started) { tuneQuality(dt); }

    if (started && !paused) {
      pollKeys();

      applyFallbackLook(dt);

      if (Sim.player.alive) {
        Sim.player.aiming = input.ads;
      }

      Sim.update(dt, input);

      // Consume this frame's simulation events: muzzle flash, tracers,
      // hitmarkers, damage direction, killfeed entries and the audio cues all
      // hang off this call. Without it the game runs silently and blind.
      drainEvents();

      input.firePressed = false;
      input.reload = false;

      // bot muzzle flashes
      for (var i = 0; i < Sim.chars.length; i++) {
        var c = Sim.chars[i];
        if (!c.isBot || !c.view) continue;
        if (c.fireTimer > (60 / S.WEAPONS[c.current].rpm) - dt - 0.001 && c.alive) {
          c.view.flashTimer = 0.045;
        }
      }

      syncPlayerCamera(dt);
      syncCharacters(dt);
      decayHud(dt);

      // tracers
      for (var t = 0; t < tracers.length; t++) {
        if (tracers[t].life > 0) {
          tracers[t].life -= dt;
          tracers[t].mesh.material.opacity = Math.max(0, tracers[t].life / 0.055) * 0.85;
          if (tracers[t].life <= 0) tracers[t].mesh.visible = false;
        }
      }

      // auto-restart after the final whistle
      if (Sim.match.over && Sim.match.restartTimer > CFG.MATCH_RESTART_DELAY && !restartDone) {
        restartDone = true;
        restartMatch();
      }
      if (!Sim.match.over) restartDone = false;
    }

    renderer.render(scene, camera);

    /* Diagnostic capture. The drawing buffer is not preserved, so readPixels
       from outside a frame returns nothing but zeros — the buffer has already
       been presented and cleared. Anything that wants to measure what was
       actually drawn has to sample here, inside the frame. Off unless a
       harness asks for it. */
    if (root.__capturePixels) {
      var glc = renderer.getContext();
      var cw = glc.drawingBufferWidth, chh = glc.drawingBufferHeight;
      var buf = new Uint8Array(cw * chh * 4);
      glc.readPixels(0, 0, cw, chh, glc.RGBA, glc.UNSIGNED_BYTE, buf);
      root.__lastPixels = { w: cw, h: chh, data: buf };
    }
    drawHUD();
  }

  /* ===================================================================== *
   * Go                                                                    *
   * ===================================================================== */
  resize();

  // First frame of camera state
  yaw = Sim.player.yaw;
  pitch = 0;
  Sim.player.yaw = yaw;

  bootEl.classList.add('hide');
  refreshModeList();
  requestAnimationFrame(frame);

  // expose for debugging from the console
  root.SANDLINE.game = {
    scene: scene, camera: camera, renderer: renderer,
    restart: restartMatch, sound: Sound,
    // mode selection, so a harness can drive the menu the way a player does
    selectMode: selectMode,
    selectedModeId: function () { return selectedModeId; },
    startMode: function (id) { selectMode(id); startSelectedMode(); return Sim.mode.id; },
    modes: S.MODES,
    // Input state. Mouse look has no other observable surface from outside the
    // page, so without this a broken mousemove handler is invisible to a test.
    input: input,
    debugInput: function () { return input; },
    look: function () { return { yaw: yaw, pitch: pitch, locked: locked, paused: paused }; },
    // Material inspection, so a diagnostic can report what the renderer is
    // actually being asked to draw rather than what the source appears to say.
    materialsFor: function (team) { return materialFor(team); },
    bodyParts: function () { return Object.keys(BODY); },
    quality: function () { return quality; },
    fps: function () { return fps; },
    setQuality: applyQuality,
    // The look angle is owned by this module, not by Sim.player — syncPlayerCamera
    // copies it *onto* the player every frame. Writing Sim.player.yaw from outside
    // is silently overwritten, so anything that needs to frame a view (a visual
    // harness, a screenshot tool) has to come through here.
    setLook: function (y, p) {
      yaw = y;
      if (p !== undefined) { pitch = Math.max(-1.54, Math.min(1.54, p)); }
      return { yaw: yaw, pitch: pitch };
    }
  };

})(window);
