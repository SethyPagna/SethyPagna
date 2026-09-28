/* ===========================================================================
   SANDLINE — arena construction, world raycasting, navigation grid
   ---------------------------------------------------------------------------
   Port of SandlineArenaBuilder.cpp plus the runtime systems the C++ build got
   from the engine for free (collision queries, navmesh).  Here we build our
   own: an AABB collider set for hit resolution, a slab-method raycaster for
   hitscan, and a coarse grid + A* so bots path around cover.
   =========================================================================== */
(function (root) {
  'use strict';

  var S = root.SANDLINE = root.SANDLINE || {};
  var CFG = S.CFG;

  var Arena = S.Arena = {};
  var Nav = S.Nav = {};

  /* ===================================================================== *
   * Environment — sky, sun, ambient, haze                                 *
   * ===================================================================== */

  Arena.buildEnvironment = function (scene) {
    // --- sky dome: simple vertical gradient ---------------------------
    var skyGeo = new THREE.SphereGeometry(20000, 32, 20);
    var skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        cTop:     { value: new THREE.Color(0.055, 0.115, 0.235) },
        cHorizon: { value: new THREE.Color(0.640, 0.560, 0.440) },
        cBottom:  { value: new THREE.Color(0.100, 0.105, 0.115) }
      },
      vertexShader: [
        'varying vec3 vPos;',
        'void main(){ vPos = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 cTop; uniform vec3 cHorizon; uniform vec3 cBottom;',
        'varying vec3 vPos;',
        'void main(){',
        '  float h = normalize(vPos).y;',
        '  vec3 c = mix(cHorizon, cTop, clamp(h, 0.0, 1.0));',
        '  c = mix(c, cBottom, clamp(-h * 1.6, 0.0, 1.0));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
      ].join('\n')
    });
    var sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    scene.add(sky);

    /* Fog tuned to the sky colour. The first version started at 70 m in an
       80 m arena, so it never had any effect and the yard had no depth cue at
       all. Starting it at 25 m means distant stacks soften and the far wall
       reads as far away. */
    scene.fog = new THREE.Fog(0x9c9482, 2500, 15000);

    /* Key light: the sun (UE rotator -46 pitch / -38 yaw).
       Intensities came down when the albedo went up. They were set high to
       drag near-black surfaces up to mid-grey; against a realistic albedo the
       same numbers blow the whole scene out. */
    var sun = new THREE.DirectionalLight(0xfff2dc, 1.30);
    sun.position.set(-4379, 5752, 3422);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera;
    sc.left = -6200; sc.right = 6200; sc.top = 6200; sc.bottom = -6200;
    sc.near = 200; sc.far = 26000;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 2.5;
    scene.add(sun);
    scene.add(sun.target);

    // --- cool fill from the opposite quarter --------------------------
    var fill = new THREE.DirectionalLight(0xb8ccff, 0.30);
    fill.position.set(3600, 4200, -6100);
    scene.add(fill);

    // --- sky bounce ---------------------------------------------------
    // The ground colour matters more than it looks: it is the only thing
    // lighting downward-facing surfaces, and with the previous near-black
    // value the underside of the roof slab and every overhang crushed to pure
    // black, which read as holes in the world rather than as shadow.
    scene.add(new THREE.HemisphereLight(0x9fb6d8, 0x59544c, 0.62));

    return { sun: sun, fill: fill, sky: sky };
  };

  function makeFloorGridTexture() {
    var N = 512;
    var cv = document.createElement('canvas');
    cv.width = cv.height = N;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, N, N);

    g.strokeStyle = 'rgba(255,255,255,0.30)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, N - 2, N - 2);

    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var p = (N / 4) * i;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, N); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(N, p); g.stroke();
    }

    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 20);          // one tile per 4 m
    tex.anisotropy = 8;
    return tex;
  }

  /* ===================================================================== *
   * Geometry                                                              *
   * ===================================================================== */

  Arena.colliders = [];   // [{ min:[x,y,z], max:[x,y,z] }]

  /* Which surface a box gets.
   *
   * The palette in data.js already encodes this — rust / teal / olive / crate
   * are fabricated steel, everything else is structure. Matching on the exact
   * palette values keeps this out of the data file, so the box list and the
   * collision set stay exactly as the Unreal build defines them.
   */
  function boxSurface(col) {
    var C = S.COLORS;
    function is(c) {
      return Math.abs(col[0] - c[0]) < 1e-6 &&
             Math.abs(col[1] - c[1]) < 1e-6 &&
             Math.abs(col[2] - c[2]) < 1e-6;
    }
    if (is(C.rust) || is(C.teal) || is(C.olive) || is(C.crate)) { return 'steel'; }
    return 'concrete';
  }

  /* Builds one merged, world-space mesh per surface class.
   *
   * The previous version scaled a single unit box through an instance matrix,
   * which meant the chamfer and the texture UVs were stretched by whatever
   * aspect ratio the box happened to have — an 800 x 40 x 800 wall got a 48 cm
   * bevel on its vertical edges and a 2 cm one on its horizontals, and the
   * panel texture smeared along it. Generating each box at its true size gives
   * a uniform bevel and a texture that tiles at a constant world scale.
   *
   * Collision is untouched: the collider list is rebuilt from the same box
   * data as before.
   */
  function buildSurface(scene, boxes, surface, material) {
    var geos = [];
    var count = 0;

    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (boxSurface(b.col) !== surface) { continue; }

      var hx = b.s[0] / 2, hy = b.s[1] / 2, hz = b.s[2] / 2;
      // A constant 3 cm chamfer regardless of size — small enough not to open
      // gaps where boxes meet, large enough to catch a highlight.
      var chamfer = Math.min(3.0, Math.min(hx, Math.min(hy, hz)) * 0.4);
      if (chamfer < 0.35) { chamfer = 0; }

      var g = chamfer > 0
        ? S.MAT.bevelBoxGeometry(hx, hy, hz, chamfer)
        : new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);

      // UVs come out in world units, so one texture tile covers a fixed
      // distance on every surface in the arena.
      var uv = g.attributes.uv;
      if (uv) {
        for (var u = 0; u < uv.array.length; u++) { uv.array[u] *= 1 / 512; }
      }

      S.MAT.tintGeometry(g, b.col, 1.0);
      S.MAT.translateGeometry(g, b.c[0], b.c[1], b.c[2]);
      geos.push(g);
      count++;
    }

    if (!count) { return null; }

    var merged = S.MAT.mergeGeometries(geos);
    var mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'arena_' + surface;
    scene.add(mesh);
    return mesh;
  }

  /* ===================================================================== *
   * Detail props                                                          *
   *                                                                       *
   * Bevels and textures fix the small scale; this fixes the middle. A      *
   * shipping container is a flat slab of colour two metres from your eye,  *
   * and what makes it read as a real object is the trim, the hazard band,  *
   * the stencil and the corner castings — not more pixels on the slab.     *
   *                                                                       *
   * None of this collides. It is decoration only: the collider list is     *
   * built from the box data and nothing here touches it.                   *
   * ===================================================================== */

  function DetailBuilder() {
    this.buckets = {};
  }
  DetailBuilder.prototype.add = function (key, geo, x, y, z) {
    // Same world-units-to-tiles conversion the arena surfaces get. Without it
    // a 6 m hazard band carries UVs of 0..600 and the texture repeats hundreds
    // of times across it, which reads as noise rather than as stripes.
    var uv = geo.attributes.uv;
    if (uv) {
      for (var i = 0; i < uv.array.length; i++) { uv.array[i] *= 1 / 512; }
    }
    S.MAT.tintGeometry(geo, [1, 1, 1], 1);
    S.MAT.translateGeometry(geo, x, y, z);
    (this.buckets[key] = this.buckets[key] || []).push(geo);
  };
  DetailBuilder.prototype.finish = function (scene, materials) {
    var self = this;
    Object.keys(this.buckets).forEach(function (key) {
      var mat = materials[key];
      if (!mat) { return; }
      var mesh = new THREE.Mesh(S.MAT.mergeGeometries(self.buckets[key]), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = 'detail_' + key;
      scene.add(mesh);
    });
  };

  function box3(w, h, d, c) {
    var ch = c === undefined ? Math.min(1.5, Math.min(w, Math.min(h, d)) * 0.3) : c;
    return S.MAT.bevelBoxGeometry(w / 2, h / 2, d / 2, ch);
  }

  /* A run of railing: posts plus two horizontal rails, from (x0,z0) to (x1,z1)
     at height `y`. Used on the elevated decks and the roof parapet. */
  DetailBuilder.prototype.railing = function (x0, z0, x1, z1, y, h) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 60) { return; }
    var ang = Math.atan2(dx, dz);          // rotation about Y
    var posts = Math.max(2, Math.round(len / 170));
    var i;

    for (i = 0; i <= posts; i++) {
      var t = i / posts;
      var px = x0 + dx * t, pz = z0 + dz * t;
      this.add('metal', box3(7, h, 7, 1), px, y + h / 2, pz);
    }
    // two rails, placed as thin boxes rotated to match the run
    [h * 0.96, h * 0.52].forEach(function (ry) {
      var g = box3(6, 6, len, 1);
      g.rotateY(ang);
      var mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      this.add('metal', g, mx, y + ry, mz);
    }, this);
  };

  /* Vertical pipe with a couple of brackets, running up a wall face. */
  DetailBuilder.prototype.pipe = function (x, z, yBottom, yTop, radius) {
    var h = yTop - yBottom;
    if (h < 60) { return; }
    var r = radius || 9;
    var g = new THREE.CylinderGeometry(r, r, h, 10, 1);
    g.rotateX(0);
    this.add('metal', g, x, yBottom + h / 2, z);

    for (var y = yBottom + 120; y < yTop - 40; y += 320) {
      this.add('metal', box3(26, 10, 26, 1), x, y, z);
    }
  };

  Arena.buildDetail = function (scene, boxes) {
    var D = new DetailBuilder();
    var C = S.COLORS;
    var i, b;

    function isCol(c, col) {
      return Math.abs(col[0] - c[0]) < 1e-6 &&
             Math.abs(col[1] - c[1]) < 1e-6 &&
             Math.abs(col[2] - c[2]) < 1e-6;
    }

    var signTexts = ['SANDLINE', 'HAZARD', 'A-01', 'KEEP CLEAR'];
    var signIndex = 0;

    for (i = 0; i < boxes.length; i++) {
      b = boxes[i];
      var hx = b.s[0] / 2, hy = b.s[1] / 2, hz = b.s[2] / 2;
      var base = b.c[1] - hy;
      var top = b.c[1] + hy;
      var footArea = b.s[0] * b.s[2];

      // ---- hazard band around the foot of anything fabricated ---------
      if (isCol(C.rust, b.col) || isCol(C.teal, b.col) || isCol(C.olive, b.col)) {
        // Slightly oversized so it sits proud of the container face instead of
        // z-fighting with it.
        D.add('hazard', box3(b.s[0] + 3, 26, b.s[2] + 3, 1), b.c[0], base + 15, b.c[2]);

        // corner castings, the eight blocks a container is actually lifted by
        [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (s) {
          D.add('metal', box3(26, 26, 26, 2),
            b.c[0] + s[0] * (hx - 8), top - 13, b.c[2] + s[1] * (hz - 8));
        });
      }

      // ---- stencilled plate on the biggest visible face ----------------
      if ((isCol(C.rust, b.col) || isCol(C.teal, b.col) || isCol(C.olive, b.col)) &&
          b.s[0] > 300 && b.s[2] > 180 && (i % 2 === 0)) {
        var sg = new THREE.PlaneGeometry(150, 38);
        var key = 'sign' + signIndex;
        signIndex = (signIndex + 1) % signTexts.length;
        D.add('s' + signIndex, sg, b.c[0], base + b.s[1] * 0.62, b.c[2] + hz + 1.5);
      }

      // ---- railings around the elevated decks -------------------------
      if (isCol(C.platform, b.col) && footArea > 90000 && b.s[1] > 20) {
        var inset = 14;
        D.railing(b.c[0] - hx + inset, b.c[2] - hz + inset,
                  b.c[0] + hx - inset, b.c[2] - hz + inset, top, 96);
        D.railing(b.c[0] - hx + inset, b.c[2] + hz - inset,
                  b.c[0] + hx - inset, b.c[2] + hz - inset, top, 96);
      }

      // ---- roof clutter on the centre building ------------------------
      if (isCol(C.building, b.col) && b.s[0] > 1000 && b.s[1] < 80) {
        // this is the roof slab
        var vents = [
          [-620, -520], [420, -700], [700, 480], [-380, 640], [120, -180]
        ];
        vents.forEach(function (v, k) {
          D.add('metal', box3(150, 70, 150, 3), b.c[0] + v[0], top + 35, b.c[2] + v[1]);
          D.add('metal', box3(96, 24, 96, 2), b.c[0] + v[0], top + 82, b.c[2] + v[1]);
          if (k === 0) {
            // a mast, so the roofline is not a flat line
            D.add('metal', box3(16, 520, 16, 2), b.c[0] + v[0], top + 330, b.c[2] + v[1]);
            D.add('metal', box3(120, 12, 12, 1), b.c[0] + v[0], top + 520, b.c[2] + v[1]);
            D.add('metal', box3(80, 12, 12, 1), b.c[0] + v[0], top + 470, b.c[2] + v[1]);
          }
        });
      }
    }

    // ---- pipes up the outside of the centre building ------------------
    [-1, 1].forEach(function (sx) {
      D.pipe(sx * 826, -300, 0, 400, 10);
      D.pipe(sx * 826, 300, 0, 400, 10);
    });
    [-1, 1].forEach(function (sz) {
      D.pipe(-300, sz * 826, 0, 400, 10);
      D.pipe(300, sz * 826, 0, 400, 10);
    });

    // ---- painted floor markings --------------------------------------
    [[-1400, 0], [1400, 0]].forEach(function (p) {
      var g = new THREE.PlaneGeometry(90, 5200);
      g.rotateX(-Math.PI / 2);
      D.add('hazard', g, p[0], 2, p[1]);
    });

    var materials = {
      metal: S.MAT.weatheredMetal(),
      hazard: S.MAT.hazard()
    };
    signTexts.forEach(function (t, k) {
      materials['s' + (k + 1)] = S.MAT.sign(t);
    });

    D.finish(scene, materials);
    return D.buckets;
  };

  Arena.build = function (scene) {
    var boxes = S.ARENA_BOXES;

    // --- the world, as a few merged meshes -----------------------------
    var built = [
      buildSurface(scene, boxes, 'concrete', S.MAT.concrete()),
      buildSurface(scene, boxes, 'steel', S.MAT.paintedSteel(null, 0x2f41))
    ].filter(Boolean);

    // --- colliders, straight from the box data -------------------------
    var colliders = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      colliders.push({
        min: [b.c[0] - b.s[0] / 2, b.c[1] - b.s[1] / 2, b.c[2] - b.s[2] / 2],
        max: [b.c[0] + b.s[0] / 2, b.c[1] + b.s[1] / 2, b.c[2] + b.s[2] / 2]
      });
    }
    Arena.colliders = colliders;

    // --- decoration: railings, hazard bands, stencils, pipes, vents ----
    Arena.buildDetail(scene, boxes);

    // --- painted floor grid (motion reference) ------------------------
    var gridMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshBasicMaterial({
        map: makeFloorGridTexture(),
        transparent: true,
        opacity: 0.30,
        depthWrite: false
      })
    );
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.y = 0.6;
    scene.add(gridMesh);

    // --- centre-line team markers, so spawns read at a glance ---------
    [[-1, 0x4ea1ff], [1, 0xff5c5c]].forEach(function (t) {
      var marker = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 3000),
        new THREE.MeshBasicMaterial({
          color: t[1], transparent: true, opacity: 0.22, depthWrite: false
        })
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(t[0] * 3300, 0.8, 0);
      scene.add(marker);
    });

    return built;
  };

  /* ===================================================================== *
   * World raycast — slab method against the collider set                  *
   * ===================================================================== */

  var _tmpN = [0, 0, 0];

  Arena.raycast = function (ro, rd, maxT) {
    var cols = Arena.colliders;
    var bestT = maxT;
    var bestAxis = -1;
    var bestSign = 0;

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var tmin = 0, tmax = bestT;
      var axis = -1, sign = 0;
      var ok = true;

      for (var a = 0; a < 3; a++) {
        var d = rd[a];
        var mn = c.min[a], mx = c.max[a];
        if (Math.abs(d) < 1e-9) {
          if (ro[a] < mn || ro[a] > mx) { ok = false; break; }
        } else {
          var inv = 1 / d;
          var t1 = (mn - ro[a]) * inv;
          var t2 = (mx - ro[a]) * inv;
          var s = -1;
          if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
          if (t2 < tmax) { tmax = t2; }
          if (tmin > tmax) { ok = false; break; }
        }
      }

      if (ok && tmin < bestT && tmin > 0) {
        bestT = tmin; bestAxis = axis; bestSign = sign;
      }
    }

    if (bestAxis < 0) return null;

    _tmpN[0] = 0; _tmpN[1] = 0; _tmpN[2] = 0;
    _tmpN[bestAxis] = bestSign;

    return {
      t: bestT,
      point: [ro[0] + rd[0] * bestT, ro[1] + rd[1] * bestT, ro[2] + rd[2] * bestT],
      normal: [_tmpN[0], _tmpN[1], _tmpN[2]]
    };
  };

  /** Cheap boolean occlusion test — used by bot line-of-sight. */
  Arena.occluded = function (ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return false;
    var rd = [dx / len, dy / len, dz / len];
    var hit = Arena.raycast([ax, ay, az], rd, len - 1);
    return !!hit;
  };

  /* ===================================================================== *
   * Navigation grid — 40 x 40 cells of 2 m, A* with 8-way movement        *
   * ===================================================================== */

  // 100 cm cells. A 2 m grid cannot represent this arena: the centre building
  // has 40 cm walls and 240 cm doorways, and blocking whole cells at 2 m
  // resolution seals the doorways (each doorway is narrower than the cell that
  // straddles it), leaving the interior unreachable — which also made
  // Domination's centre zone impossible for bots to take. At 1 m the doorway
  // spans two free cells while the wall still blocks its own.
  var CELL = 100;
  var N = (CFG.ARENA_HALF * 2) / CELL;   // 80
  Nav.CELL = CELL;
  Nav.N = N;

  Nav.walkable = new Uint8Array(N * N);
  Nav.blockedByHeight = new Uint8Array(N * N);

  Nav.idx = function (i, j) { return j * N + i; };

  Nav.cellOf = function (x, z) {
    var i = Math.floor((x + CFG.ARENA_HALF) / CELL);
    var j = Math.floor((z + CFG.ARENA_HALF) / CELL);
    if (i < 0) i = 0; if (i >= N) i = N - 1;
    if (j < 0) j = 0; if (j >= N) j = N - 1;
    return [i, j];
  };

  Nav.centreOf = function (i, j) {
    return [
      -CFG.ARENA_HALF + (i + 0.5) * CELL,
      -CFG.ARENA_HALF + (j + 0.5) * CELL
    ];
  };

  Nav.build = function () {
    Nav.walkable.fill(1);

    var step = CFG.MAX_STEP_UP;
    var headroom = 190;

    Arena.colliders.forEach(function (c) {
      // Anything we can neither step onto nor walk under blocks the cell.
      if (!(c.max[1] > step && c.min[1] < headroom)) return;

      var i0 = Math.floor((c.min[0] + CFG.ARENA_HALF) / CELL);
      var i1 = Math.floor((c.max[0] + CFG.ARENA_HALF) / CELL);
      var j0 = Math.floor((c.min[2] + CFG.ARENA_HALF) / CELL);
      var j1 = Math.floor((c.max[2] + CFG.ARENA_HALF) / CELL);

      if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      if (i1 >= N) i1 = N - 1; if (j1 >= N) j1 = N - 1;

      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) Nav.walkable[Nav.idx(i, j)] = 0;
      }
    });

    return Nav;
  };

  Nav.isWalkableCell = function (i, j) {
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return Nav.walkable[Nav.idx(i, j)] === 1;
  };

  Nav.isWalkableAt = function (x, z) {
    var c = Nav.cellOf(x, z);
    return Nav.isWalkableCell(c[0], c[1]);
  };

  /** Spiral out from a point until a walkable cell is found. */
  Nav.nearestWalkable = function (x, z) {
    var c = Nav.cellOf(x, z);
    if (Nav.isWalkableCell(c[0], c[1])) return c;
    for (var r = 1; r < 26; r++) {
      for (var dj = -r; dj <= r; dj++) {
        for (var di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (Nav.isWalkableCell(c[0] + di, c[1] + dj)) return [c[0] + di, c[1] + dj];
        }
      }
    }
    return c;
  };

  /** Straight-line walkability between two world points (grid-sampled). */
  Nav.lineWalkable = function (ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var len = Math.sqrt(dx * dx + dz * dz);
    var steps = Math.max(2, Math.ceil(len / (CELL * 0.4)));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      if (!Nav.isWalkableAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  };

  /* --- binary heap --------------------------------------------------- */
  function Heap() { this.a = []; }
  Heap.prototype.push = function (node, f) {
    var a = this.a;
    a.push({ n: node, f: f });
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a;
    var top = a[0];
    var last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.a.length; };

  var SQ2 = Math.SQRT2;
  var DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]
  ];

  var gScore = new Float32Array(N * N);
  var cameFrom = new Int32Array(N * N);
  var stamp = new Int32Array(N * N);
  var visitTag = 0;

  /**
   * A* from world (sx,sz) to world (tx,tz).
   * Returns an array of [x,z] world waypoints, or null when unreachable.
   */
  Nav.findPath = function (sx, sz, tx, tz) {
    var start = Nav.nearestWalkable(sx, sz);
    var goal = Nav.nearestWalkable(tx, tz);

    var si = Nav.idx(start[0], start[1]);
    var gi = Nav.idx(goal[0], goal[1]);
    if (si === gi) return null;

    visitTag++;
    var open = new Heap();

    function h(i, j) {
      var dx = Math.abs(i - goal[0]);
      var dz = Math.abs(j - goal[1]);
      // octile distance
      return (dx + dz) + (SQ2 - 2) * Math.min(dx, dz);
    }

    gScore[si] = 0;
    cameFrom[si] = -1;
    stamp[si] = visitTag;
    open.push(si, h(start[0], start[1]));

    var guard = 0;
    while (open.size() > 0) {
      // Generous: decrease-key pushes duplicates onto the heap, so a long path
      // legitimately pops far more nodes than the grid holds.
      if (++guard > 40000) break;
      var cur = open.pop().n;
      if (cur === gi) break;

      var ci = cur % N;
      var cj = (cur - ci) / N;

      for (var d = 0; d < DIRS.length; d++) {
        var ni = ci + DIRS[d][0];
        var nj = cj + DIRS[d][1];
        if (!Nav.isWalkableCell(ni, nj)) continue;

        // no cutting diagonally through a corner
        if (DIRS[d][0] && DIRS[d][1]) {
          if (!Nav.isWalkableCell(ci + DIRS[d][0], cj)) continue;
          if (!Nav.isWalkableCell(ci, cj + DIRS[d][1])) continue;
        }

        var nIdx = Nav.idx(ni, nj);
        var tentative = gScore[cur] + DIRS[d][2];

        if (stamp[nIdx] !== visitTag) {
          stamp[nIdx] = visitTag;
          gScore[nIdx] = tentative;
          cameFrom[nIdx] = cur;
          open.push(nIdx, tentative + h(ni, nj));
        } else if (tentative < gScore[nIdx]) {
          gScore[nIdx] = tentative;
          cameFrom[nIdx] = cur;
          open.push(nIdx, tentative + h(ni, nj));
        }
      }
    }

    if (stamp[gi] !== visitTag) return null;

    // reconstruct
    var raw = [];
    var node = gi;
    var guard2 = 0;
    while (node !== -1 && guard2++ < 8000) {
      var ii = node % N;
      var jj = (node - ii) / N;
      raw.push(Nav.centreOf(ii, jj));
      node = cameFrom[node];
    }
    raw.reverse();

    // string-pull: skip waypoints we can walk straight past
    var out = [];
    var anchorX = sx, anchorZ = sz;
    var k = 0;
    while (k < raw.length) {
      var best = k;
      for (var m = raw.length - 1; m >= k; m--) {
        if (Nav.lineWalkable(anchorX, anchorZ, raw[m][0], raw[m][1])) { best = m; break; }
      }
      out.push(raw[best]);
      anchorX = raw[best][0];
      anchorZ = raw[best][1];
      k = best + 1;
    }

    return out.length ? out : null;
  };

  /* ===================================================================== *
   * Weapon spawn / pick-up pads (visual only in this build)               *
   * ===================================================================== */
  Arena.spawnPadPositions = [
    [-1600, 0, 0], [1600, 0, 0], [0, 0, 1600], [0, 0, -1600]
  ];

})(window);
