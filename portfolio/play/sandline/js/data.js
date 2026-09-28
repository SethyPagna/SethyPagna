/* ===========================================================================
   SANDLINE — shared game data
   ---------------------------------------------------------------------------
   Every number in this file is a direct port of the Unreal Engine 5.8 C++
   sources in ../SandlineUE/Source/Sandline/ :

     FWeaponStats  <-  SandlineWeapons.cpp   (BuildCatalogue)
     arena boxes   <-  SandlineArenaBuilder.cpp (SandlineArena::Build)
     spawn points  <-  SandlineArenaBuilder.cpp (SandlineArena::GetSpawnPoints)

   Units are Unreal's: centimetres. three.js uses Y-up, Unreal uses Z-up, so
   the helper bx() below swaps the axes on the way in and everything downstream
   is plain three.js coordinates.
   =========================================================================== */
(function (root) {
  'use strict';

  var S = root.SANDLINE = root.SANDLINE || {};

  /* ------------------------------------------------------------------ *
   * Tunables                                                            *
   * ------------------------------------------------------------------ */
  S.CFG = {
    // -- world ---------------------------------------------------------
    ARENA_HALF: 4000,          // 80 m x 80 m playfield
    PERIMETER_T: 60,

    // -- pawn ----------------------------------------------------------
    CAPSULE_RADIUS: 38,
    CAPSULE_HALF: 88,          // 176 cm tall
    EYE_HEIGHT: 64,            // camera offset above capsule centre (=152 cm eye)
    WALK_SPEED: 600,           // cm/s
    SPRINT_MULT: 1.5,
    CROUCH_MULT: 0.5,
    JUMP_VELOCITY: 420,
    GRAVITY: 980 * 1.35,
    AIR_CONTROL: 0.05,
    MAX_STEP_UP: 62,           // clears the 50 cm platform ramps + 57.5 cm roof stairs
    GROUND_ACCEL: 14,
    AIR_ACCEL: 1.6,
    FRICTION: 9,
    CROUCH_HALF: 52,

    // -- combat --------------------------------------------------------
    MAX_HEALTH: 100,
    MAX_ARMOR: 100,
    MAX_TRACE: 30000,
    HEAD_ZONE_Z: 150,          // impact >= 150 cm above feet  -> head
    LEG_ZONE_Z: 62,            // impact <=  62 cm above feet  -> legs

    // -- match ---------------------------------------------------------
    SCORE_LIMIT: 50,
    ROUND_TIME: 600,           // seconds
    RESPAWN_DELAY: 3.0,
    BOTS_PER_TEAM: 5,
    MATCH_RESTART_DELAY: 10.0,
    KILLFEED_MAX: 6,
    KILLFEED_LIFE: 7.0,

    // -- bot brain (mirrors SandlineBot.h) ------------------------------
    BOT: {
      VIEW_DISTANCE: 7500,
      FOV_HALF_ANGLE: 65,
      PREFERRED_RANGE: 1900,
      REACTION_TIME: 0.32,
      AIM_ERROR_DEGREES: 2.2,
      AIM_SMOOTHING: 5.5,
      PERCEPTION_HZ: 4,
      FIRE_ACCURACY_GATE: 7.0, // only squeeze the trigger under this aim error
      MAX_BLOOM: 1.2,          // bots stop firing above this so spread recovers
      STRAFE_PERIOD: 1.1
    },

    // -- renderer ------------------------------------------------------
    FOV: 90,
    ADS_FOV_SNIPER: 20,
    NEAR: 4,
    FAR: 26000
  };

  /* ------------------------------------------------------------------ *
   * Weapons — port of SandlineWeapons.cpp                              *
   * ------------------------------------------------------------------ */
  S.WEAPONS = [
    {
      id: 0, name: 'Vanguard', short: 'VGD', class: 'ASSAULT',
      damage: 36, rpm: 600, mag: 30, reserve: 90, reloadTime: 2.45,
      spreadDeg: 0.35, adsSpreadDeg: 0.05, moveSpreadPenalty: 3.0,
      shotSpreadPerShot: 0.18, spreadRecoveryPerSec: 2.5,
      verticalKick: 1.10, horizontalKick: 0.42,
      falloffStart: 3000, falloffEnd: 7000, falloffMin: 0.60,
      headshotMult: 4.0, limbMult: 0.75,
      automatic: true, pellets: 1, pelletConeDeg: 0, adsZoomFov: 55, moveSpeedMult: 0.95
    },
    {
      id: 1, name: 'Whisper', short: 'WSP', class: 'SMG',
      damage: 26, rpm: 850, mag: 30, reserve: 90, reloadTime: 2.10,
      spreadDeg: 0.55, adsSpreadDeg: 0.15, moveSpreadPenalty: 2.2,
      shotSpreadPerShot: 0.14, spreadRecoveryPerSec: 3.5,
      verticalKick: 0.68, horizontalKick: 0.48,
      falloffStart: 1800, falloffEnd: 4000, falloffMin: 0.60,
      headshotMult: 3.2, limbMult: 0.75,
      automatic: true, pellets: 1, pelletConeDeg: 0, adsZoomFov: 60, moveSpeedMult: 1.00
    },
    {
      id: 2, name: 'Apex', short: 'APX', class: 'SNIPER',
      damage: 115, rpm: 41, mag: 5, reserve: 25, reloadTime: 3.60,
      spreadDeg: 4.50, adsSpreadDeg: 0.00, moveSpreadPenalty: 6.0,
      shotSpreadPerShot: 0.0, spreadRecoveryPerSec: 8.0,
      verticalKick: 3.20, horizontalKick: 0.20,
      falloffStart: 5000, falloffEnd: 12000, falloffMin: 0.87,
      headshotMult: 4.0, limbMult: 0.95,
      automatic: false, pellets: 1, pelletConeDeg: 0, adsZoomFov: 20, moveSpeedMult: 0.82
    },
    {
      id: 3, name: 'Breaker', short: 'BRK', class: 'SHOTGUN',
      damage: 12, rpm: 68, mag: 8, reserve: 32, reloadTime: 3.40,
      spreadDeg: 4.50, adsSpreadDeg: 3.20, moveSpreadPenalty: 1.8,
      shotSpreadPerShot: 0.10, spreadRecoveryPerSec: 2.0,
      verticalKick: 2.60, horizontalKick: 0.85,
      falloffStart: 800, falloffEnd: 2000, falloffMin: 0.42,
      headshotMult: 4.0, limbMult: 1.00,
      automatic: false, pellets: 9, pelletConeDeg: 4.5, adsZoomFov: 60, moveSpeedMult: 0.94
    }
  ];

  S.weaponById = function (id) { return S.WEAPONS[id] || S.WEAPONS[0]; };

  /* ------------------------------------------------------------------ *
   * Arena                                                              *
   * ------------------------------------------------------------------ */

  // Linear-light colours lifted straight from SandlineArenaBuilder.cpp.
  var COL = {
    floor:    [0.20, 0.21, 0.23],
    wall:     [0.34, 0.35, 0.38],
    building: [0.44, 0.39, 0.33],
    crate:    [0.42, 0.30, 0.17],
    barrier:  [0.52, 0.51, 0.47],
    platform: [0.28, 0.30, 0.34],
    rust:     [0.46, 0.24, 0.16],
    teal:     [0.16, 0.34, 0.34],
    olive:    [0.30, 0.34, 0.20]
  };
  S.COLORS = COL;

  function scaleCol(c, m) { return [c[0] * m, c[1] * m, c[2] * m]; }

  /* Deterministic PRNG modelled on Unreal's FRandomStream so the crate
     scatter here looks like the scatter the C++ build produces. */
  function FRandomStream(seed) { this.seed = seed | 0; }
  FRandomStream.prototype.unsignedInt = function () {
    this.seed = (Math.imul(this.seed, 196314165) + 907633515) | 0;
    return this.seed;
  };
  FRandomStream.prototype.fraction = function () {
    var s = (this.unsignedInt() >>> 9) | 0x40000000;   // -> [0x40000000, 0x7FFFFFFF]
    return (s - 0x40000000) / 0x40000000;              // -> [0, 1)
  };
  FRandomStream.prototype.range = function (lo, hi) {
    return lo + Math.floor(this.fraction() * (hi - lo + 1));
  };
  FRandomStream.prototype.frange = function (lo, hi) {
    return lo + this.fraction() * (hi - lo);
  };

  var BOXES = [];

  /* bx(ueX, ueY, ueZ, sizeX, sizeY, sizeZ, colour) — Unreal axes in. */
  function bx(x, y, z, sx, sy, sz, col) {
    BOXES.push({ c: [x, z, y], s: [sx, sz, sy], col: col });
  }

  function buildArena() {
    BOXES.length = 0;
    var H = S.CFG.ARENA_HALF;
    var T = S.CFG.PERIMETER_T;

    // ---- floor ------------------------------------------------------
    bx(0, 0, -15, H * 2, H * 2, 30, COL.floor);

    // ---- perimeter --------------------------------------------------
    bx(0,  H, 260, H * 2, T, 520, COL.wall);
    bx(0, -H, 260, H * 2, T, 520, COL.wall);
    bx( H, 0, 260, T, H * 2, 520, COL.wall);
    bx(-H, 0, 260, T, H * 2, 520, COL.wall);

    // ---- central building -------------------------------------------
    (function () {
      var BH = 800, WH = 210, WT = 40, HT = 420, Door = 240;
      var segLen = BH - Door * 0.5;          // 680
      var segOff = Door * 0.5 + segLen * 0.5; // 460

      [1, -1].forEach(function (sign) {
        var Y = sign * BH;
        bx(-segOff, Y, WH, segLen, WT, HT, COL.building);
        bx( segOff, Y, WH, segLen, WT, HT, COL.building);
      });
      [1, -1].forEach(function (sign) {
        var X = sign * BH;
        bx(X, -segOff, WH, WT, segLen, HT, COL.building);
        bx(X,  segOff, WH, WT, segLen, HT, COL.building);
      });

      // interior divider
      bx(0, -BH * 0.45, WH * 0.9, 700, 30, 300, COL.building);

      // roof slab
      bx(0, 0, HT + 20, BH * 2 + WT, BH * 2 + WT, 40, COL.building);

      // external roof stairs — 8 blocks, 57.5 cm each
      for (var i = 0; i < 8; i++) {
        var stepH = (HT + 40) / 8;
        bx(-BH - 130, -260 + i * 90, stepH * (i + 0.5), 260, 90, stepH, COL.platform);
      }

      // parapet
      bx(0,  BH + 20, HT + 90, BH * 2, 40, 100, COL.wall);
      bx(0, -BH - 20, HT + 90, BH * 2, 40, 100, COL.wall);
      bx( BH + 20, 0, HT + 90, 40, BH * 2, 100, COL.wall);
      bx(-BH - 20, 0, HT + 90, 40, BH * 2, 100, COL.wall);
    })();

    // ---- container stacks -------------------------------------------
    [
      { p: [-2100,  1400], col: COL.rust  },
      { p: [-2100, -1400], col: COL.teal  },
      { p: [ 2100,  1400], col: COL.olive },
      { p: [ 2100, -1400], col: COL.rust  },
      { p: [    0,  2500], col: COL.teal  },
      { p: [    0, -2500], col: COL.olive }
    ].forEach(function (st) {
      var px = st.p[0], py = st.p[1];
      bx(px, py, 130, 610, 244, 260, st.col);
      bx(px, py, 390, 610, 244, 260, scaleCol(st.col, 0.85));
      bx(px + 380, py + 320, 60, 120, 120, 120, COL.crate);
    });

    // ---- crate clusters ---------------------------------------------
    (function () {
      var rng = new FRandomStream(20260921);
      var centres = [
        [-2900,  2400], [ 2900,  2400],
        [-2900, -2400], [ 2900, -2400],
        [-1200,   900], [ 1200,  -900],
        [  600,  1800], [ -600, -1800]
      ];
      centres.forEach(function (c) {
        var count = rng.range(3, 5);
        for (var i = 0; i < count; i++) {
          var ox = rng.frange(-260, 260);
          var oy = rng.frange(-260, 260);
          var sz = rng.frange(100, 150);
          var tint = rng.frange(0.85, 1.15);
          bx(c[0] + ox, c[1] + oy, sz * 0.5, sz, sz, sz, scaleCol(COL.crate, tint));
        }
      });
    })();

    // ---- low barriers ------------------------------------------------
    [
      [-1500,  2400], [ 1500,  2400],
      [-1500, -2400], [ 1500, -2400],
      [ 2400,   700], [-2400,  -700],
      [  700,   700], [ -700,  -700]
    ].forEach(function (p) {
      bx(p[0], p[1], 58, 520, 90, 116, COL.barrier);
    });

    // ---- elevated platforms -----------------------------------------
    [[-3100, 0], [3100, 0]].forEach(function (p) {
      var px = p[0], py = p[1];
      bx(px, py, 300, 900, 500, 40, COL.platform);                  // deck
      [[-380, -200], [380, -200], [-380, 200], [380, 200]].forEach(function (l) {
        bx(px + l[0], py + l[1], 140, 60, 60, 280, COL.platform);   // legs
      });
      for (var i = 0; i < 6; i++) {
        bx(px, py - 430 - i * 110, 25 + i * 50, 400, 110, 50, COL.platform); // ramp
      }
      bx(px, py + 240, 360, 900, 30, 90, COL.wall);                 // railing
    });

    // ---- spawn flank blocks ------------------------------------------
    [[-3550, -900], [-3550, 900], [3550, -900], [3550, 900]].forEach(function (p) {
      bx(p[0], p[1], 110, 90, 700, 220, COL.barrier);
    });

    return BOXES;
  }

  S.ARENA_BOXES = buildArena();

  /* Spawn lines — SandlineArena::GetSpawnPoints
     X = +/-3700 keeps the whole capsule clear of the elevated platforms
     (which reach out to +/-3550) and the spawn flank blocks (+/-3550).
     Feet sit exactly on the floor plane at y = 0. */
  (function () {
    var yaws = [-900, -450, 0, 450, 900];
    S.SPAWNS = {
      blue: yaws.map(function (y) { return [-3700, 0, y]; }),   // three.js: x, y(up), z
      red:  yaws.map(function (y) { return [ 3700, 0, y]; })
    };
  })();

  /* ------------------------------------------------------------------ *
   * Team helpers                                                        *
   * ------------------------------------------------------------------ */
  S.TEAM = { NONE: 0, BLUE: 1, RED: 2 };
  S.teamName = function (t) { return t === S.TEAM.BLUE ? 'BLUE' : t === S.TEAM.RED ? 'RED' : '—'; };
  S.teamColour = function (t) {
    return t === S.TEAM.BLUE ? [0.22, 0.50, 1.00] : [1.00, 0.28, 0.28];
  };
  S.teamHex = function (t) { return t === S.TEAM.BLUE ? '#4ea1ff' : '#ff5c5c'; };

  /* ------------------------------------------------------------------ *
   * Game modes                                                          *
   * ------------------------------------------------------------------ *
     One source of truth for the menu, the simulation and the HUD. sim.js
     reads `teams`, `scoreLimit`, `timeLimit`, `respawnDelay` and the
     mode-specific blocks from here — nothing downstream may hardcode TDM.

     Positions are three.js coordinates [x, y(up), z], i.e. Unreal (x, y)
     with y/z swapped, the same convention bx() uses above.
   * ------------------------------------------------------------------ */

  S.MODES = [
    {
      id: 'tdm', name: 'Team Deathmatch', short: 'TDM',
      playable: true, teams: true,
      scoreLimit: 50, timeLimit: 600, respawnDelay: 3.0,
      scoreLabel: 'FRAGS',
      blurb: 'Five versus five. First team to 50 frags, or the highest score when the clock expires.'
    },
    {
      id: 'ffa', name: 'Free For All', short: 'FFA',
      playable: true, teams: false,
      scoreLimit: 30, timeLimit: 600, respawnDelay: 2.5,
      scoreLabel: 'KILLS',
      blurb: 'Ten operators, no allies. Everyone is an enemy. First to 30 kills.'
    },
    {
      id: 'dom', name: 'Domination', short: 'DOM',
      playable: true, teams: true,
      scoreLimit: 200, timeLimit: 600, respawnDelay: 3.0,
      scoreLabel: 'POINTS',
      blurb: 'Hold A, B and C. Every zone your team owns ticks score.',
      // A generous radius relative to cover spacing, so a zone is takeable
      // without standing in the open. Zone B sits inside the centre building.
      zoneRadius: 380,
      captureSeconds: 5.0,
      scorePerZonePerSecond: 1.0,
      zones: [
        { name: 'A', pos: [-2100, 0, 0] },
        { name: 'B', pos: [0, 0, 0] },
        { name: 'C', pos: [2100, 0, 0] }
      ]
    },
    {
      id: 'gun', name: 'Gun Game', short: 'GUN',
      playable: true, teams: false,
      scoreLimit: 0,          // the ladder decides the match, not a frag count
      timeLimit: 600, respawnDelay: 2.0,
      scoreLabel: 'RUNG',
      blurb: 'Every kill upgrades your weapon. First to clear the last rung wins.',
      // Ascending difficulty over the weapons that are actually implemented,
      // following DT_GunGameLadder.csv's ordering (rifle -> SMG -> shotgun ->
      // sniper). The CSV's full 20-rung ladder needs the full catalogue.
      ladder: [0, 1, 3, 2]
    },

    /* Specified in the design documents, not implemented in this build.
       They appear in the menu, visibly disabled, with an honest status. */
    { id: 'bomb', name: 'Bomb Defusal',     short: 'BOMB', playable: false, status: 'SPEC ONLY' },
    { id: 'sd',   name: 'Search & Destroy', short: 'S&D',  playable: false, status: 'SPEC ONLY' },
    { id: 'br',   name: 'Battle Royale',    short: 'BR',   playable: false, status: 'SPEC ONLY' },
    { id: 'ext',  name: 'Extraction',       short: 'EXT',  playable: false, status: 'SPEC ONLY' }
  ];

  S.DEFAULT_MODE = 'tdm';

  S.modeById = function (id) {
    for (var i = 0; i < S.MODES.length; i++) {
      if (S.MODES[i].id === id) { return S.MODES[i]; }
    }
    return S.modeById(S.DEFAULT_MODE);
  };

  S.playableModes = function () {
    return S.MODES.filter(function (m) { return m.playable; });
  };

})(window);
