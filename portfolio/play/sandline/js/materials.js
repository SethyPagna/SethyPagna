/*
 * SANDLINE — procedural material and geometry library.
 *
 * The first version of this build drew the entire world with
 * MeshLambertMaterial on scaled unit boxes. Flat untextured colour, razor
 * edges, no roughness, no small-scale detail: everything read as a block.
 *
 * This module supplies the two things that fix that:
 *
 *   1. A texture library generated on a canvas at load time. Albedo plus a
 *      bump map for concrete, painted steel, weathered metal, rubber, fabric
 *      and hazard markings. Nothing is loaded from disk — same rule as the
 *      rest of the build.
 *
 *   2. A chamfered box geometry. A bevel is the single highest-value change
 *      for a box world: it gives every edge a highlight that separates it from
 *      the face next to it, which is what stops a wall reading as a flat slab.
 *
 * Everything here is deterministic. A seeded generator means the arena looks
 * identical on every load, so screenshots are comparable and a visual
 * regression is actually visible.
 */

window.SANDLINE = window.SANDLINE || {};

(function (root) {
  'use strict';

  var S = root.SANDLINE;
  var MAT = {};

  /* ===================================================================== *
   * Deterministic randomness                                              *
   * ===================================================================== */

  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      // xorshift32 — cheap, and good enough for texture noise
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  function newCanvas(size) {
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }

  /* Radial blobs drawn nine times, offset by the canvas size, so the pattern
     wraps. Without this every tile seam shows as a visible grid line, which is
     exactly the artefact we are trying to remove. */
  function tileableBlobs(ctx, size, rnd, count, rMin, rMax, rgb, aMin, aMax) {
    for (var i = 0; i < count; i++) {
      var x = rnd() * size;
      var y = rnd() * size;
      var r = rMin + rnd() * (rMax - rMin);
      var a = aMin + rnd() * (aMax - aMin);
      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          var px = x + ox * size;
          var py = y + oy * size;
          var g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
          g.addColorStop(1, 'rgba(' + rgb + ',0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function speckle(ctx, size, rnd, count, maxAlpha) {
    for (var i = 0; i < count; i++) {
      var x = rnd() * size, y = rnd() * size;
      var v = Math.floor(rnd() * 255);
      ctx.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (rnd() * maxAlpha) + ')';
      ctx.fillRect(x, y, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
  }

  function finish(cv, repeat, srgb) {
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat || 1, repeat || 1);
    t.anisotropy = 4;
    if (srgb) { t.colorSpace = THREE.SRGBColorSpace; }
    return t;
  }

  /* ===================================================================== *
   * Textures                                                              *
   * ===================================================================== */

  /* Concrete: mottled grey, pour stains, aggregate speckle, a few hairline
     cracks. Stretch-tolerant — there is no strong directional pattern, so a
     box that is 40x longer than it is tall still reads as concrete.

     The base is deliberately bright. These maps are multiplied by the arena's
     vertex tint, so a mid-grey base darkens every surface twice — which is
     what made the first pass look muddy. Keeping the albedo near white turns
     it into a detail layer and lets the palette carry the colour. */
  function concreteMaps() {
    var size = 512;
    var rnd = makeRng(0x51a1d);
    var cv = newCanvas(size);
    var ctx = cv.getContext('2d');

    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(0, 0, size, size);

    tileableBlobs(ctx, size, rnd, 90, 40, 170, '236,238,242', 0.14, 0.38);
    tileableBlobs(ctx, size, rnd, 70, 30, 130, '132,136,142', 0.12, 0.32);
    speckle(ctx, size, rnd, 5200, 0.16);

    // hairline cracks
    ctx.strokeStyle = 'rgba(104,108,114,0.26)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 14; i++) {
      var x = rnd() * size, y = rnd() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (var k = 0; k < 6; k++) {
        x += (rnd() - 0.5) * 90;
        y += (rnd() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // bump: reuse the grain, it is what gives the surface its tooth
    var bumpCv = newCanvas(size);
    var bctx = bumpCv.getContext('2d');
    var rnd2 = makeRng(0x51a1d);
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);
    tileableBlobs(bctx, size, rnd2, 90, 40, 170, '200,200,200', 0.10, 0.30);
    tileableBlobs(bctx, size, rnd2, 70, 30, 130, '70,70,70', 0.10, 0.26);
    speckle(bctx, size, rnd2, 5200, 0.30);

    return { map: finish(cv, 1, true), bumpMap: finish(bumpCv, 1, false) };
  }

  /* Painted steel: panel seams, rivet rows, scuffs down to bare metal and rust
     bleed at the seams. Used for shipping containers and anything that should
     read as fabricated. Also neutral-bright, for the same reason as concrete —
     the container colour arrives as a vertex tint. */
  function paintedSteelMaps(baseHex, seed) {
    var size = 512;
    var rnd = makeRng(seed);
    var cv = newCanvas(size);
    var ctx = cv.getContext('2d');

    ctx.fillStyle = baseHex || '#a2a6ac';
    ctx.fillRect(0, 0, size, size);

    tileableBlobs(ctx, size, rnd, 55, 50, 190, '255,255,255', 0.06, 0.16);
    tileableBlobs(ctx, size, rnd, 60, 40, 150, '90,92,98', 0.06, 0.18);

    // vertical panel seams with a dark groove and a lit lip
    var panels = 4;
    var pw = size / panels;
    for (var p = 1; p < panels; p++) {
      var x = p * pw;
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(x - 2, 0, 4, size);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 2, 0, 2, size);
    }

    // rivet rows following the seams
    for (var r = 0; r < panels + 1; r++) {
      var rx = r * pw;
      for (var y = 12; y < size; y += 26) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.arc(rx, y, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.arc(rx + 0.9, y + 0.9, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // scuffs and rust bleed
    speckle(ctx, size, rnd, 2600, 0.13);
    for (var i = 0; i < 22; i++) {
      var sx = rnd() * size, sy = rnd() * size;
      ctx.fillStyle = 'rgba(120,72,38,' + (0.06 + rnd() * 0.16) + ')';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 4 + rnd() * 22, 3 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    var bumpCv = newCanvas(size);
    var bctx = bumpCv.getContext('2d');
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);
    for (var p2 = 1; p2 < panels; p2++) {
      bctx.fillStyle = 'rgba(0,0,0,0.55)';
      bctx.fillRect(p2 * pw - 2, 0, 4, size);
    }
    for (var r2 = 0; r2 < panels + 1; r2++) {
      for (var y2 = 12; y2 < size; y2 += 26) {
        bctx.fillStyle = 'rgba(255,255,255,0.5)';
        bctx.beginPath();
        bctx.arc(r2 * pw, y2, 2.1, 0, Math.PI * 2);
        bctx.fill();
      }
    }
    speckle(bctx, size, makeRng(seed), 2600, 0.25);

    return { map: finish(cv, 1, true), bumpMap: finish(bumpCv, 1, false) };
  }

  /* Weathered metal: bare, scratched, oil-stained. Railings, pipes, ladders,
     anything structural that was never painted. */
  function weatheredMetalMaps() {
    var size = 512;
    var rnd = makeRng(0x9e3b1);
    var cv = newCanvas(size);
    var ctx = cv.getContext('2d');

    ctx.fillStyle = '#8a8d92';
    ctx.fillRect(0, 0, size, size);

    tileableBlobs(ctx, size, rnd, 80, 20, 120, '210,212,216', 0.06, 0.20);
    tileableBlobs(ctx, size, rnd, 70, 20, 110, '40,42,46', 0.06, 0.22);

    // brushed streaks
    for (var i = 0; i < 320; i++) {
      var y = rnd() * size;
      var v = rnd() < 0.5 ? '255,255,255' : '0,0,0';
      ctx.strokeStyle = 'rgba(' + v + ',' + (rnd() * 0.10) + ')';
      ctx.lineWidth = 0.6 + rnd() * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rnd() - 0.5) * 6);
      ctx.stroke();
    }

    speckle(ctx, size, rnd, 3400, 0.14);

    return { map: finish(cv, 1, true), bumpMap: finish(cv, 1, false) };
  }

  /* Hazard stripes. Diagonal, high contrast, deliberately separate from the
     tiling surfaces so it reads as a painted marking rather than texture. */
  function hazardTexture() {
    var size = 256;
    var cv = newCanvas(size);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#d8a326';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#1d1f24';
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.translate(-size, -size);
    for (var x = 0; x < size * 2; x += 64) {
      ctx.fillRect(x, 0, 32, size * 2);
    }
    ctx.restore();

    // wear the paint back so it does not look printed on
    var rnd = makeRng(0x4a17);
    speckle(ctx, size, rnd, 1400, 0.20);
    return finish(cv, 1, true);
  }

  /* Stencilled signage plate. */
  function signTexture(text, bg, fg) {
    var w = 512, h = 128;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    ctx.fillStyle = bg || '#1b1e23';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg || '#c9d2dd';
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.fillStyle = fg || '#c9d2dd';
    ctx.font = 'bold 52px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);

    var rnd = makeRng(text.length * 7919 + 13);
    speckle(ctx, h, rnd, 300, 0.10);
    return finish(cv, 1, true);
  }

  /* Fabric: a woven pattern for uniforms and gear. */
  function fabricMaps(baseHex, seed) {
    var size = 256;
    var rnd = makeRng(seed);
    var cv = newCanvas(size);
    var ctx = cv.getContext('2d');

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.16;
    for (var y = 0; y < size; y += 3) {
      ctx.fillStyle = y % 6 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(0, y, size, 1);
    }
    for (var x = 0; x < size; x += 3) {
      ctx.fillStyle = x % 6 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(x, 0, 1, size);
    }
    ctx.globalAlpha = 1;

    tileableBlobs(ctx, size, rnd, 30, 20, 90, '0,0,0', 0.03, 0.10);
    speckle(ctx, size, rnd, 1200, 0.10);

    return { map: finish(cv, 1, true), bumpMap: finish(cv, 1, false) };
  }

  /* ===================================================================== *
   * Materials                                                             *
   * ===================================================================== */

  var cache = {};

  /* Every material this module hands out, so quality can be changed globally
     without walking the scene graph. */
  var allMaterials = [];

  function standard(opts) {
    var m = new THREE.MeshStandardMaterial(opts);
    allMaterials.push(m);
    return m;
  }

  /* Bump mapping is the most expensive thing in these materials and the least
     important — dropping it costs almost nothing visually and buys a lot of
     frame time on a machine without a GPU. */
  MAT.setBumpEnabled = function (on) {
    for (var i = 0; i < allMaterials.length; i++) {
      var m = allMaterials[i];
      if (m.userData.__bump === undefined) { m.userData.__bump = m.bumpMap || null; }
      var want = on ? m.userData.__bump : null;
      if (m.bumpMap !== want) { m.bumpMap = want; m.needsUpdate = true; }
    }
  };

  MAT.concrete = function () {
    if (cache.concrete) { return cache.concrete; }
    var m = concreteMaps();
    cache.concrete = standard({
      map: m.map, bumpMap: m.bumpMap, bumpScale: 0.035,
      roughness: 0.94, metalness: 0.02, vertexColors: true
    });
    return cache.concrete;
  };

  MAT.paintedSteel = function (baseHex, seed) {
    var key = 'steel' + baseHex + '_' + seed;
    if (cache[key]) { return cache[key]; }
    var m = paintedSteelMaps(baseHex, seed);
    cache[key] = standard({
      map: m.map, bumpMap: m.bumpMap, bumpScale: 0.05,
      roughness: 0.62, metalness: 0.30, vertexColors: true
    });
    return cache[key];
  };

  MAT.weatheredMetal = function () {
    if (cache.metal) { return cache.metal; }
    var m = weatheredMetalMaps();
    cache.metal = standard({
      map: m.map, bumpMap: m.bumpMap, bumpScale: 0.03,
      roughness: 0.45, metalness: 0.75
    });
    return cache.metal;
  };

  MAT.fabric = function (baseHex, seed) {
    var key = 'fab' + baseHex + '_' + seed;
    if (cache[key]) { return cache[key]; }
    var m = fabricMaps(baseHex, seed);
    cache[key] = standard({
      map: m.map, bumpMap: m.bumpMap, bumpScale: 0.02,
      roughness: 0.88, metalness: 0.02
    });
    return cache[key];
  };

  MAT.rubber = function (tint) {
    return standard({
      color: tint === undefined ? 0x1a1c20 : tint,
      roughness: 0.97, metalness: 0.0
    });
  };

  MAT.polymer = function (tint, roughness) {
    return standard({
      color: tint === undefined ? 0x2b2f36 : tint,
      roughness: roughness === undefined ? 0.72 : roughness,
      metalness: 0.06
    });
  };

  MAT.hazard = function () {
    if (cache.hazard) { return cache.hazard; }
    var tex = hazardTexture();
    // One stripe period per ~1.2 m of surface. Geometry UVs arrive in world
    // units over 512, so this multiplies out to roughly that spacing whatever
    // size the marked object happens to be.
    tex.repeat.set(4.3, 4.3);
    cache.hazard = standard({
      map: tex, roughness: 0.8, metalness: 0.05,
      side: THREE.DoubleSide
    });
    return cache.hazard;
  };

  MAT.sign = function (text, bg, fg) {
    var key = 'sign' + text;
    if (cache[key]) { return cache[key]; }
    cache[key] = standard({
      map: signTexture(text, bg, fg), roughness: 0.7, metalness: 0.1,
      side: THREE.DoubleSide
    });
    return cache[key];
  };

  /* Glowing accent — team bands, helmet lights, objective markers. Kept
     unlit so it stays legible in shadow, which is the whole point of a
     team-colour marker. */
  MAT.accent = function (rgb) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
      emissive: new THREE.Color(rgb[0] * 0.55, rgb[1] * 0.55, rgb[2] * 0.55),
      roughness: 0.45, metalness: 0.0
    });
  };

  /* ===================================================================== *
   * Chamfered box geometry                                                *
   * ===================================================================== */

  /* Builds a box whose edges and corners are cut back, as a non-indexed
     BufferGeometry with flat normals.
   *
   * The construction is explicit rather than clever. For a corner at sign
   * (sx, sy, sz) there are three cut points, one per axis, each pulled in by
   * `chamfer` on the two axes it is not named after:
   *
   *   Px = (sx*hx, sy*(hy-c), sz*(hz-c))
   *   Py = (sx*(hx-c), sy*hy, sz*(hz-c))
   *   Pz = (sx*(hx-c), sy*(hy-c), sz*hz)
   *
   * The six faces are quads of the matching cut points, the twelve edges are
   * quads joining two cut points from adjacent faces, and the eight corners are
   * triangles over all three. Winding is fixed up afterwards by comparing each
   * polygon's normal against the direction from the centre, so I do not have to
   * get the vertex order right by hand.
   */
  MAT.bevelBoxGeometry = function (hx, hy, hz, chamfer) {
    var c = Math.min(chamfer, Math.min(hx, Math.min(hy, hz)) * 0.45);
    var polys = [];
    var sx, sy, sz;

    function Px(a, b, d) { return [a * hx, b * (hy - c), d * (hz - c)]; }
    function Py(a, b, d) { return [a * (hx - c), b * hy, d * (hz - c)]; }
    function Pz(a, b, d) { return [a * (hx - c), b * (hy - c), d * hz]; }

    // six faces
    polys.push([Px(1, -1, -1), Px(1, -1, 1), Px(1, 1, 1), Px(1, 1, -1)]);      // +X
    polys.push([Px(-1, -1, -1), Px(-1, 1, -1), Px(-1, 1, 1), Px(-1, -1, 1)]);  // -X
    polys.push([Py(-1, 1, -1), Py(-1, 1, 1), Py(1, 1, 1), Py(1, 1, -1)]);      // +Y
    polys.push([Py(-1, -1, -1), Py(1, -1, -1), Py(1, -1, 1), Py(-1, -1, 1)]);  // -Y
    polys.push([Pz(-1, -1, 1), Pz(1, -1, 1), Pz(1, 1, 1), Pz(-1, 1, 1)]);      // +Z
    polys.push([Pz(-1, -1, -1), Pz(-1, 1, -1), Pz(1, 1, -1), Pz(1, -1, -1)]);  // -Z

    // twelve edge quads: pick two axes, fix the third at +/-1
    var axes = [
      { a: 'x', b: 'y', third: 'z' },
      { a: 'x', b: 'z', third: 'y' },
      { a: 'y', b: 'z', third: 'x' }
    ];
    var A = { x: Px, y: Py, z: Pz };

    for (var ai = 0; ai < axes.length; ai++) {
      var ax = axes[ai];
      for (var t = -1; t <= 1; t += 2) {
        for (var u = -1; u <= 1; u += 2) {
          // edge between face +ax.a and face +ax.b, at third = t, along the
          // remaining axis u
          var pa = A[ax.a], pb = A[ax.b];
          var v = [];
          if (ax.a === 'x' && ax.b === 'y') {
            v = [pa(t, 1, -1), pa(t, 1, 1), pb(1, t, 1), pb(1, t, -1)];
          } else if (ax.a === 'x' && ax.b === 'z') {
            v = [pa(t, -1, 1), pa(t, 1, 1), pb(1, 1, t), pb(1, -1, t)];
          } else {
            v = [pa(-1, t, 1), pa(1, t, 1), pb(1, 1, t), pb(-1, 1, t)];
          }
          polys.push(v);
        }
      }
    }

    // eight corner triangles
    for (sx = -1; sx <= 1; sx += 2) {
      for (sy = -1; sy <= 1; sy += 2) {
        for (sz = -1; sz <= 1; sz += 2) {
          polys.push([Px(sx, sy, sz), Py(sx, sy, sz), Pz(sx, sy, sz)]);
        }
      }
    }

    // ---- triangulate, fix winding, emit flat normals + planar UVs ------
    var pos = [], nrm = [], uvs = [];
    var cx = 0, cy = 0, cz = 0;

    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function norm(a) {
      var l = Math.sqrt(dot(a, a)) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    }

    for (var pi = 0; pi < polys.length; pi++) {
      var poly = polys[pi];
      cx = 0; cy = 0; cz = 0;
      for (var k = 0; k < poly.length; k++) {
        cx += poly[k][0]; cy += poly[k][1]; cz += poly[k][2];
      }
      cx /= poly.length; cy /= poly.length; cz /= poly.length;

      var n = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
      // point it away from the centre
      if (dot(n, [cx, cy, cz]) < 0) {
        n = [-n[0], -n[1], -n[2]];
        poly = poly.slice().reverse();
      }

      // planar UV: project on whichever plane this face is most aligned with
      var ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      var iu, iv;
      if (ax >= ay && ax >= az) { iu = 2; iv = 1; }
      else if (ay >= az) { iu = 0; iv = 2; }
      else { iu = 0; iv = 1; }

      function push(p) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(n[0], n[1], n[2]);
        uvs.push(p[iu], p[iv]);
      }

      for (var f = 1; f < poly.length - 1; f++) {
        push(poly[0]);
        push(poly[f]);
        push(poly[f + 1]);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeBoundingSphere();
    return geo;
  };

  /* Unit chamfered box (half extents 0.5) so it can be scaled by an instance
     matrix exactly like the BoxGeometry it replaces. */
  MAT.unitBevelBox = function (chamfer) {
    var key = 'unitbevel' + chamfer;
    if (cache[key]) { return cache[key]; }
    cache[key] = MAT.bevelBoxGeometry(0.5, 0.5, 0.5, chamfer);
    return cache[key];
  };

  /* ===================================================================== *
   * Geometry assembly                                                     *
   * ===================================================================== */

  /* Bake a flat colour into a geometry as a vertex-colour attribute.
     `scale` lifts the arena's linear-light palette (0.16 .. 0.52) into
     something that reads as an albedo multiplier rather than near-black. */
  MAT.tintGeometry = function (geo, rgb, scale) {
    var m = scale === undefined ? 2.6 : scale;
    var n = geo.attributes.position.count;
    var arr = new Float32Array(n * 3);
    var r = Math.min(1, rgb[0] * m), g = Math.min(1, rgb[1] * m), b = Math.min(1, rgb[2] * m);
    for (var i = 0; i < n; i++) {
      arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    return geo;
  };

  /* Concatenate geometries that share the same attribute layout.

     three.js ships BufferGeometryUtils in the examples bundle, which this
     build does not vendor, and the arena is better off as a handful of merged
     meshes than as several hundred draw calls. Every geometry that goes
     through here is non-indexed with position / normal / uv / color, so a
     straight array join is all that is needed. */
  MAT.mergeGeometries = function (geos) {
    var total = 0;
    var i, g;
    for (i = 0; i < geos.length; i++) { total += geos[i].attributes.position.count; }

    var pos = new Float32Array(total * 3);
    var nrm = new Float32Array(total * 3);
    var uv = new Float32Array(total * 2);
    var col = new Float32Array(total * 3);

    var po = 0, no = 0, uo = 0, co = 0;
    for (i = 0; i < geos.length; i++) {
      g = geos[i];
      pos.set(g.attributes.position.array, po); po += g.attributes.position.array.length;
      nrm.set(g.attributes.normal.array, no);   no += g.attributes.normal.array.length;
      if (g.attributes.uv) { uv.set(g.attributes.uv.array, uo); }
      uo += g.attributes.position.count * 2;
      if (g.attributes.color) { col.set(g.attributes.color.array, co); }
      co += g.attributes.position.count * 3;
    }

    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  };

  /* Translate a geometry in place — used to place each arena box before it is
     merged, so the merged mesh needs no per-box transform at draw time. */
  MAT.translateGeometry = function (geo, x, y, z) {
    var a = geo.attributes.position.array;
    for (var i = 0; i < a.length; i += 3) {
      a[i] += x; a[i + 1] += y; a[i + 2] += z;
    }
    geo.attributes.position.needsUpdate = true;
    return geo;
  };

  S.MAT = MAT;

})(window);
