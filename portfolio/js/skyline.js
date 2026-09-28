// Hero scene: a rainy neon night from Angkor Wat to Hong Kong's harbour, drawn on canvas.
// Geometry follows the profile banner (scripts/build_assets.py): a 1200x480 scene with the
// shoreline at y=400. Static layers are painted once per resize; each frame only composites
// them and adds the moving parts (rain, plane, beams, blinking windows, fireworks).

const C = {
  void: '#08031A', ink: '#F6F3FF', volt: '#FCEE0A', magenta: '#FF2E88', cyan: '#19E6FF',
  violet: '#A974FF', acid: '#3CFFA4', orange: '#FF8A1F', red: '#FF3B5C',
  sil: '#0A0418', silBack: '#1D1044',
};
const WINDOW_LIGHTS = ['#FFE66B', '#FFE66B', '#FFF4B8', '#8CF3FF', '#FF8CC6', '#C8A8FF'];
const SW = 1200, SH = 480, GROUND = 400;
const KH = [165, 226], HK = [1015, 150];
const ROUTE = [[165, 226], [300, 30], [880, 20], [1015, 150]]; // cubic bezier

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, a, b) => a + r() * (b - a);
const int = (r, a, b) => Math.floor(between(r, a, b + 1));
const pick = (r, list) => list[Math.floor(r() * list.length)];

function bezier(t, p = ROUTE) {
  const u = 1 - t;
  const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
  const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
  return [x, y];
}

// ------------------------------------------------------------ scene description (built once)

function towerPath(ctx, x, base, w, h) {
  const steps = [[x - w / 2, base], [x - w / 2, base - .14 * h], [x - .42 * w, base - .14 * h],
    [x - .42 * w, base - .26 * h], [x - .35 * w, base - .26 * h], [x - .35 * w, base - .36 * h]];
  ctx.moveTo(...steps[0]);
  steps.slice(1).forEach(p => ctx.lineTo(...p));
  ctx.bezierCurveTo(x - .37 * w, base - .62 * h, x - .15 * w, base - .86 * h, x, base - h);
  ctx.bezierCurveTo(x + .15 * w, base - .86 * h, x + .37 * w, base - .62 * h, x + .35 * w, base - .36 * h);
  [...steps].reverse().forEach(([px, py]) => ctx.lineTo(2 * x - px, py));
  ctx.closePath();
}
const ANGKOR_TOWERS = [[70, 362, 36, 64], [260, 362, 36, 64], [112, 358, 44, 88], [218, 358, 44, 88], [165, 356, 58, 124]];

function templePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(20, 400); ctx.lineTo(20, 388); ctx.lineTo(36, 388); ctx.lineTo(36, 377); ctx.lineTo(52, 377);
  ctx.lineTo(52, 366); ctx.lineTo(278, 366); ctx.lineTo(278, 377); ctx.lineTo(294, 377); ctx.lineTo(294, 388);
  ctx.lineTo(310, 388); ctx.lineTo(310, 400); ctx.closePath();
  ctx.rect(48, 356, 234, 10);
  ANGKOR_TOWERS.forEach(t => towerPath(ctx, ...t));
}

function buildScene(seed = 11) {
  const r = rng(seed);
  const back = [], mid = [], signs = [], windows = [], blinkers = [], streaks = [];

  const addWindows = (x, w, top, density, dim, bottom = GROUND - 4) => {
    const cols = Math.max(1, Math.floor((w - 2) / 6));
    const left = x + (w - cols * 6) / 2 + 1.5;
    for (let y = Math.floor(top) + 5; y < bottom - 3; y += 8) {
      for (let c = 0; c < cols; c++) {
        if (r() >= density) continue;
        const win = { x: left + c * 6, y, color: pick(r, WINDOW_LIGHTS), alpha: dim ? .35 : .85 };
        if (!dim && r() < .08) blinkers.push({ ...win, phase: r() * 7, speed: between(r, .6, 1.4) });
        else windows.push(win);
      }
    }
  };

  let x = 556;
  while (x < 1200) {
    const w = int(r, 18, 34);
    const h = x > 990 ? int(r, 95, 196) : int(r, 40, 108);
    back.push([x, GROUND - h, w, h]);
    addWindows(x, w, GROUND - h, .12, true);
    x += w + int(r, -4, 6);
  }

  const palms = [[30, 96, 3], [322, 84, -2], [352, 108, 4], [432, 100, -3], [512, 88, 3]].map(([px, h, lean]) => ({
    x: px, h, lean, fronds: Array.from({ length: 20 }, (_, i) => {
      const a = i / 20 * 6.2832 + between(r, -.1, .1);
      return [a, between(r, 12, 17) * (a > .3 && a < 2.8 ? .75 : 1)];
    }),
  }));

  const special = { 4: [C.magenta, '理大'], 11: [C.volt, '茶'] };
  x = 556;
  let index = 0;
  while (x < 978) {
    const w = int(r, 22, 36), h = int(r, 40, 96), top = GROUND - h;
    mid.push({ x, top, w, h, cap: r() < .5, mast: r() < .35 });
    addWindows(x + 2, w - 4, top + 4, .3, false);
    if (special[index] || r() < .25) {
      const [color, glyphs] = special[index] || [pick(r, [C.magenta, C.cyan, C.volt, C.acid]), ''];
      const sh = glyphs ? 30 : int(r, 20, 34);
      const st = top + int(r, 8, Math.max(9, h - sh - 14));
      signs.push({ x: x + w - 7, top: st, h: sh, color, glyphs, phase: r() * 10 });
      streaks.push({ x: x + w, len: int(r, 30, 60), color, width: 6, phase: r() * 3 });
    }
    for (let k = 0, n = int(r, 1, 2); k < n; k++) {
      streaks.push({ x: x + between(r, 3, w - 3), len: int(r, 18, 50), color: pick(r, WINDOW_LIGHTS), width: 2, phase: r() * 3 });
    }
    x += w + pick(r, [0, 1, 2, 3]);
    index++;
  }
  for (let rx = 996; rx < 1200; rx += 7) {
    streaks.push({ x: rx, len: int(r, 25, 70), color: pick(r, [C.cyan, C.magenta, C.volt]), width: 2, phase: r() * 3 });
  }
  // Plaza and neighbour windows
  addWindows(1106, 36, 238, .35, false);
  addWindows(1152, 26, 276, .3, false);

  const stars = Array.from({ length: 150 }, () => ({
    x: r(), y: Math.pow(r(), 1.6), size: pick(r, [.6, .8, 1, 1, 1.3, 1.6]), phase: r() * 6, speed: between(r, .5, 1.6),
  }));
  return { back, mid, palms, signs, windows, blinkers, streaks, stars };
}

// ------------------------------------------------------------ painters (scene coordinates)

function paintBack(ctx, scene) {
  ctx.fillStyle = '#160A36';
  ctx.beginPath();
  ctx.moveTo(780, 400); ctx.quadraticCurveTo(870, 306, 960, 330); ctx.quadraticCurveTo(1050, 262, 1130, 292);
  ctx.quadraticCurveTo(1172, 282, 1200, 290); ctx.lineTo(1200, 400); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.silBack;
  scene.back.forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));
  scene.windows.filter(w => w.alpha < .5).forEach(w => {
    ctx.globalAlpha = w.alpha; ctx.fillStyle = w.color; ctx.fillRect(w.x, w.y, 3, 4);
  });
  ctx.globalAlpha = 1;
}

const IFC = [[994, 400], [994, 178], [998, 178], [998, 172], [1003, 172], [1003, 168], [1027, 168], [1027, 172], [1032, 172], [1032, 178], [1036, 178], [1036, 400]];
const BOC = [[1046, 400], [1046, 262], [1070, 204], [1094, 236], [1094, 400]];
const PLAZA = [[1104, 400], [1104, 232], [1124, 210], [1144, 232], [1144, 400]];
const poly = (ctx, pts) => { ctx.moveTo(...pts[0]); pts.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); };

function paintFront(ctx, scene) {
  // temple: warm rim first, then the silhouette on top
  ctx.save();
  ctx.shadowColor = C.orange; ctx.shadowBlur = 10;
  templePath(ctx);
  ctx.strokeStyle = 'rgba(255,138,31,.75)'; ctx.lineWidth = 2.6; ctx.stroke();
  ctx.restore();
  templePath(ctx); ctx.fillStyle = C.sil; ctx.fill();
  ctx.strokeStyle = 'rgba(252,238,10,.3)'; ctx.lineWidth = 1;
  ANGKOR_TOWERS.slice(2).forEach(([x, base, w, h]) => {
    [.46, .56, .66, .76].forEach(f => {
      const half = .36 * w * (1 - Math.pow((f - .36) / .64, 1.5));
      ctx.beginPath(); ctx.moveTo(x - half, base - f * h); ctx.lineTo(x + half, base - f * h); ctx.stroke();
    });
  });

  // sugar palms
  ctx.strokeStyle = C.sil; ctx.fillStyle = C.sil; ctx.lineCap = 'round';
  scene.palms.forEach(p => {
    const tx = p.x + p.lean, ty = GROUND - p.h;
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(p.x, GROUND); ctx.quadraticCurveTo(p.x + p.lean * .2, GROUND - p.h * .6, tx, ty); ctx.stroke();
    ctx.lineWidth = 2.2;
    p.fronds.forEach(([a, len]) => {
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + len * Math.cos(a), ty + len * Math.sin(a)); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(tx, ty, 5, 0, 7); ctx.fill();
  });

  // stilt houses
  [378, 456].forEach(x => {
    ctx.fillStyle = C.sil;
    [3, 14, 25, 36].forEach(dx => ctx.fillRect(x + dx, 382, 2, 18));
    ctx.fillRect(x, 366, 40, 17);
    ctx.beginPath(); ctx.moveTo(x - 7, 367); ctx.lineTo(x + 20, 349); ctx.lineTo(x + 47, 367); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.shadowColor = C.volt; ctx.shadowBlur = 8; ctx.fillStyle = C.volt;
    ctx.fillRect(x + 16, 370, 8, 7); ctx.restore();
  });

  // Kowloon-side blocks
  ctx.fillStyle = C.sil;
  scene.mid.forEach(b => {
    ctx.fillRect(b.x, b.top, b.w, b.h);
    if (b.cap) ctx.fillRect(b.x + 4, b.top - 7, 9, 7);
    if (b.mast) ctx.fillRect(b.x + b.w - 5.8, b.top - 13, 1.6, 13);
  });

  // Hong Kong towers with cyan rim light
  ctx.save();
  ctx.shadowColor = C.cyan; ctx.shadowBlur = 8; ctx.strokeStyle = 'rgba(25,230,255,.55)'; ctx.lineWidth = 2.2;
  [IFC, BOC, PLAZA].forEach(t => { ctx.beginPath(); poly(ctx, t); ctx.stroke(); });
  ctx.restore();
  ctx.fillStyle = C.sil;
  [IFC, BOC, PLAZA, [[1152, 400], [1152, 272], [1178, 272], [1178, 400]], [[1184, 400], [1184, 304], [1200, 304], [1200, 400]]]
    .forEach(t => { ctx.beginPath(); poly(ctx, t); ctx.fill(); });
  ctx.strokeStyle = C.sil; ctx.lineWidth = 2.4;
  [1004, 1011, 1019, 1026].forEach(x => { ctx.beginPath(); ctx.moveTo(x, 168); ctx.lineTo(x, 157); ctx.stroke(); });
  ctx.lineWidth = 2;
  [[1066, 204, 28], [1074, 204, 24], [1124, 210, 24], [1165, 272, 18]].forEach(([x, y, h]) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  });
}

function paintLights(ctx, scene) {
  scene.windows.filter(w => w.alpha > .5).forEach(w => {
    ctx.globalAlpha = w.alpha; ctx.fillStyle = w.color; ctx.fillRect(w.x, w.y, 3, 4);
  });
  ctx.globalAlpha = 1;
  // IFC fins, Bank of China lattice, Central Plaza crown
  ctx.strokeStyle = 'rgba(158,235,255,.2)'; ctx.lineWidth = 1;
  for (let x = 999; x < 1034; x += 5) { ctx.beginPath(); ctx.moveTo(x, 182); ctx.lineTo(x, 398); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,46,136,.5)';
  ctx.beginPath();
  [[1046, 300, 1094, 338], [1094, 300, 1046, 338], [1046, 338, 1094, 376], [1094, 338, 1046, 376], [1046, 262, 1094, 300], [1070, 204, 1070, 400]]
    .forEach(([a, b, c, d]) => { ctx.moveTo(a, b); ctx.lineTo(c, d); });
  ctx.stroke();
  ctx.save(); ctx.shadowColor = C.volt; ctx.shadowBlur = 10; ctx.fillStyle = C.volt; ctx.globalAlpha = .9;
  ctx.beginPath(); poly(ctx, [[1104, 232], [1124, 210], [1144, 232]]); ctx.fill(); ctx.restore();
}

function paintSign(ctx, s, on) {
  ctx.save();
  ctx.globalAlpha = on;
  ctx.shadowColor = s.color; ctx.shadowBlur = 8;
  ctx.fillStyle = '#0B0620'; ctx.strokeStyle = s.color; ctx.lineWidth = 1.6;
  ctx.fillRect(s.x, s.top, 14, s.h); ctx.strokeRect(s.x, s.top, 14, s.h);
  ctx.fillStyle = s.color;
  if (s.glyphs) {
    ctx.font = '700 10.5px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    [...s.glyphs].forEach((g, i) => ctx.fillText(g, s.x + 7, s.top + 12 + i * 12));
  } else {
    for (let i = 0; i < Math.floor(s.h / 7) - 1; i++) ctx.fillRect(s.x + 4, s.top + 5 + i * 7, 6, 3);
  }
  ctx.restore();
}

function paintStreaks(ctx, scene) {
  scene.streaks.forEach(s => {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.globalAlpha = s.width > 3 ? .35 : .28;
    ctx.setLineDash(s.width > 3 ? [5, 4] : [3, 4]);
    ctx.beginPath(); ctx.moveTo(s.x, 404); ctx.lineTo(s.x, 404 + s.len); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

const PLANE = new Path2D('M13 0L4 -2.2L-1 -9H-4L-1.5 -2.2H-7L-9 -5H-11L-10 0L-11 5H-9L-7 2.2H-1.5L-4 9H-1L4 2.2Z');

// ------------------------------------------------------------ runtime

export function mountSkyline(canvas, { reduced = false, onFirework } = {}) {
  const ctx = canvas.getContext('2d');
  const scene = buildScene();
  const layers = {};
  let W = 0, H = 0, dpr = 1, s = 1, ox = 0, oy = 0, panRange = 0;
  let pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let running = false, visible = true, raf = 0, last = 0, t0 = performance.now();
  let drops = [], sparks = [], rockets = [];

  function layer(paint, pad = 0) {
    const c = document.createElement('canvas');
    c.width = Math.ceil((SW + pad * 2) * s * dpr); c.height = Math.ceil(SH * s * dpr);
    const g = c.getContext('2d');
    g.setTransform(s * dpr, 0, 0, s * dpr, pad * s * dpr, 0);
    paint(g);
    return c;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width); H = Math.max(1, rect.height);
    s = Math.max(W / SW, (H * (W < 700 ? .5 : .56)) / SH);
    dpr = Math.min(window.devicePixelRatio || 1, 2, 4096 / (SW * s));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    panRange = Math.max(0, SW * s - W);
    ox = -panRange / 2; oy = H - SH * s;
    layers.back = layer(g => paintBack(g, scene));
    layers.front = layer(g => { paintFront(g, scene); paintLights(g, scene); });
    layers.streaks = layer(g => paintStreaks(g, scene));
    // crescent moon sprite with its glow baked in
    const moon = document.createElement('canvas'), m2 = Math.ceil(120 * s * dpr);
    moon.width = moon.height = m2;
    const mc = moon.getContext('2d');
    mc.translate(m2 / 2, m2 / 2); mc.scale(s * dpr, s * dpr);
    mc.fillStyle = C.volt; mc.beginPath(); mc.arc(0, 0, 22, 0, 7); mc.fill();
    mc.globalCompositeOperation = 'destination-out';
    mc.beginPath(); mc.arc(11, -7, 19, 0, 7); mc.fill();
    const lit = document.createElement('canvas'); lit.width = lit.height = m2;
    const lc = lit.getContext('2d');
    lc.shadowColor = C.volt; lc.shadowBlur = 26 * s * dpr; lc.drawImage(moon, 0, 0); lc.shadowBlur = 0; lc.drawImage(moon, 0, 0);
    layers.moon = lit;
    // mirrored copy of the city for the harbour
    const m = document.createElement('canvas');
    m.width = layers.front.width; m.height = Math.ceil(80 * s * dpr);
    const mg = m.getContext('2d');
    mg.translate(0, GROUND * s * dpr); mg.scale(1, -1);
    mg.globalAlpha = .42; mg.drawImage(layers.back, 0, 0); mg.drawImage(layers.front, 0, 0);
    layers.mirror = m;
    const count = Math.round(Math.min(220, W * H / 7000));
    drops = Array.from({ length: count }, () => newDrop(true));
    draw(performance.now());
  }

  function newDrop(anywhere) {
    return { x: Math.random() * (W + 80), y: anywhere ? Math.random() * H : -30, len: 10 + Math.random() * 14, v: 520 + Math.random() * 380 };
  }

  function toScreen(x, y, depth = 1) {
    return [ox + x * s + pointer.x * depth, oy + y * s + pointer.y * depth * .5];
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    const dt = Math.min(.05, (now - last) / 1000 || .016);
    last = now;
    pointer.x += (pointer.tx - pointer.x) * .06; pointer.y += (pointer.ty - pointer.y) * .06;
    if (panRange > 0) ox = -panRange / 2 - Math.sin(t * .09) * panRange / 2 * (reduced ? 0 : 1);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, oy + GROUND * s);
    sky.addColorStop(0, '#04010C'); sky.addColorStop(.45, '#12042E'); sky.addColorStop(.75, '#2E0A4E'); sky.addColorStop(1, '#62105A');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const glow = (x, y, rx, color, a) => {
      const [gx, gy] = toScreen(x, y, .2);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rx * s);
      g.addColorStop(0, color.replace(')', `,${a})`).replace('rgb', 'rgba')); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    };
    glow(600, GROUND, 760, 'rgb(255,46,136)', .3);
    glow(1060, GROUND - 60, 260, 'rgb(25,230,255)', .18);
    glow(165, GROUND - 20, 250, 'rgb(255,138,31)', .26);

    // stars
    ctx.fillStyle = '#fff';
    const starTop = Math.max(0, oy + GROUND * s * .72);
    scene.stars.forEach(st => {
      ctx.globalAlpha = reduced ? .7 : .25 + .75 * Math.abs(Math.sin(t * st.speed + st.phase));
      ctx.fillRect(st.x * W + pointer.x * .1, st.y * starTop, st.size, st.size);
    });
    ctx.globalAlpha = 1;

    // moon
    const [mx, my] = toScreen(1110, 68, .15);
    const moon = layers.moon;
    ctx.drawImage(moon, mx - moon.width / dpr / 2, my - moon.height / dpr / 2, moon.width / dpr, moon.height / dpr);

    // searchlights
    [[1015, 170, C.cyan, 10, 0], [1124, 210, C.magenta, 13, 5]].forEach(([bx, by, color, period, off]) => {
      const [sx, sy] = toScreen(bx, by, .6);
      const angle = reduced ? -.1 : -.23 * (1 - Math.cos(((t + off) / period) * Math.PI * 2)) + .08;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(angle);
      const g = ctx.createLinearGradient(0, 0, 0, -sy - 40);
      g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(35 * s, -sy - 60); ctx.lineTo(85 * s, -sy - 60); ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    // city
    const [bx0, by0] = toScreen(0, 0, .35);
    ctx.drawImage(layers.back, bx0, by0, SW * s, SH * s);
    const [fx0, fy0] = toScreen(0, 0, .6);
    ctx.drawImage(layers.front, fx0, fy0, SW * s, SH * s);

    // blinking windows, flickering signs, beacons
    ctx.save(); ctx.translate(fx0, fy0); ctx.scale(s, s);
    scene.blinkers.forEach(w => {
      const on = reduced ? 1 : (Math.sin(t * w.speed + w.phase) > -.2 ? 1 : 0);
      if (!on) return;
      ctx.globalAlpha = w.alpha; ctx.fillStyle = w.color; ctx.fillRect(w.x, w.y, 3, 4);
    });
    ctx.globalAlpha = 1;
    scene.signs.forEach(sg => {
      const k = (t * 1.3 + sg.phase) % 9;
      const on = reduced ? 1 : (k > 8.2 && k < 8.5) || (k > 8.65 && k < 8.75) ? .25 : 1;
      paintSign(ctx, sg, on);
    });
    [[1015, 156, 0], [1066, 176, .6], [1074, 180, 1.1], [1124, 186, .3]].forEach(([x, y, d]) => {
      ctx.globalAlpha = reduced ? 1 : Math.max(.15, Math.sin((t + d) * 2.4));
      ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 7); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // harbour
    const seaTop = fy0 + GROUND * s;
    const sea = ctx.createLinearGradient(0, seaTop, 0, H);
    sea.addColorStop(0, '#170836'); sea.addColorStop(1, '#030008');
    ctx.fillStyle = sea; ctx.fillRect(0, seaTop, W, H - seaTop);
    const mirror = layers.mirror, rows = 40, rowH = mirror.height / rows;
    for (let i = 0; i < rows; i++) {
      const wobble = reduced ? 0 : Math.sin(t * 1.6 + i * .7) * (1.5 + i * .12) * s;
      ctx.drawImage(mirror, 0, i * rowH, mirror.width, rowH, fx0 + wobble, seaTop + (i * rowH) / dpr, SW * s, rowH / dpr + .5);
    }
    ctx.globalAlpha = reduced ? 1 : .75 + .25 * Math.sin(t * 2.1);
    ctx.drawImage(layers.streaks, fx0, fy0, SW * s, SH * s);
    ctx.globalAlpha = 1;
    const shore = ctx.createLinearGradient(fx0, 0, fx0 + SW * s, 0);
    shore.addColorStop(0, 'rgba(255,138,31,.75)'); shore.addColorStop(.5, 'rgba(255,46,136,.45)'); shore.addColorStop(1, 'rgba(25,230,255,.85)');
    ctx.fillStyle = shore; ctx.fillRect(0, seaTop, W, 1.6);

    // ferry crossing the harbour
    const fxp = 1260 - ((t / 48 + .6) % 1) * 1480;
    ctx.save(); ctx.translate(fx0 + fxp * s, fy0 + 426 * s); ctx.scale(s, s);
    ctx.fillStyle = C.sil; ctx.strokeStyle = '#34206E';
    ctx.beginPath(); poly(ctx, [[0, 0], [62, 0], [55, 9], [7, 9]]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5B1250'; ctx.fillRect(10, -10, 42, 10);
    ctx.fillStyle = '#EDE6FF'; ctx.fillRect(14, -16, 34, 6);
    ctx.fillStyle = C.volt; for (let i = 0; i < 5; i++) ctx.fillRect(14 + i * 7, -7, 4, 4);
    ctx.restore();

    // flight route KH -> HK
    ctx.save(); ctx.translate(...toScreen(0, 0, .6)); ctx.scale(s, s);
    ctx.setLineDash([2, 9]); ctx.lineDashOffset = reduced ? 0 : -t * 16;
    ctx.strokeStyle = 'rgba(252,238,10,.8)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...ROUTE[0]); ctx.bezierCurveTo(...ROUTE[1], ...ROUTE[2], ...ROUTE[3]); ctx.stroke();
    ctx.setLineDash([]);
    [[KH, C.orange], [HK, C.cyan]].forEach(([[x, y], color], i) => {
      const k = reduced ? 0 : ((t / 2.4) + i * .5) % 1;
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 7 * (.4 + k * 1.8), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    });
    ctx.font = '700 13px "Chakra Petch", sans-serif'; ctx.textBaseline = 'middle';
    [[KH, 'KH', C.orange, -1], [HK, 'HK', C.cyan, 1]].forEach(([[x, y], label, color, side]) => {
      const bx = side < 0 ? x - 52 : x + 19, by = y - 41;
      ctx.fillStyle = color;
      ctx.beginPath(); poly(ctx, [[bx, by], [bx + 33, by], [bx + 33, by + 16], [bx + 27, by + 22], [bx, by + 22]]); ctx.fill();
      ctx.fillStyle = C.void; ctx.fillText(label, bx + 7, by + 11.5);
    });
    const p = reduced ? .55 : (t / 12) % 1;
    const [px, py] = bezier(p), [qx, qy] = bezier(Math.min(1, p + .01));
    ctx.globalAlpha = p < .06 ? p / .06 : p > .92 ? (1 - p) / .08 : 1;
    ctx.translate(px, py); ctx.rotate(Math.atan2(qy - py, qx - px));
    ctx.shadowColor = C.volt; ctx.shadowBlur = 12; ctx.fillStyle = C.ink; ctx.fill(PLANE);
    ctx.fillStyle = (Math.floor(t * 2) % 2) ? C.red : C.ink; ctx.fillRect(-2, -1, 2, 2);
    ctx.restore();

    // rain
    if (!reduced) {
      ctx.strokeStyle = 'rgba(183,198,255,.34)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      ctx.beginPath();
      drops.forEach((d, i) => {
        d.y += d.v * dt; d.x -= d.v * dt * .28;
        if (d.y > H + 20 || d.x < -40) drops[i] = newDrop(false);
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * .28, d.y + d.len);
      });
      ctx.stroke();
    }

    // fireworks over the harbour
    rockets = rockets.filter(rk => {
      rk.y += rk.vy * dt; rk.vy += 260 * dt;
      ctx.fillStyle = rk.color; ctx.fillRect(rk.x, rk.y, 2, 6);
      if (rk.vy > -40) { burst(rk.x, rk.y, rk.color); return false; }
      return true;
    });
    ctx.globalCompositeOperation = 'lighter';
    sparks = sparks.filter(sp => {
      sp.life -= dt; if (sp.life <= 0) return false;
      sp.vx *= .985; sp.vy = sp.vy * .985 + 60 * dt;
      sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      ctx.globalAlpha = Math.min(1, sp.life / sp.max * 1.4);
      ctx.fillStyle = sp.color; ctx.fillRect(sp.x, sp.y, 2.2, 2.2);
      return true;
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function burst(x, y, color) {
    const palette = [color, C.ink, color === C.volt ? C.magenta : C.volt];
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 170;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 + Math.random() * .8, max: 1.8, color: palette[i % 3] });
    }
    onFirework?.();
  }

  function launch(x, y) {
    const color = pick(Math.random, [C.magenta, C.cyan, C.volt, C.acid, C.violet, C.orange]);
    if (reduced) { burst(x, y, color); draw(performance.now()); return; }
    const startY = Math.min(H, oy + GROUND * s);
    rockets.push({ x, y: startY, vy: -Math.sqrt(2 * 260 * Math.max(40, startY - y)), color });
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (running || reduced || !visible || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  window.addEventListener('pointermove', e => {
    if (reduced) return;
    pointer.tx = (e.clientX / window.innerWidth - .5) * -24;
    pointer.ty = (e.clientY / window.innerHeight - .5) * -12;
  }, { passive: true });

  resize();
  start();
  return { launch, redraw: () => draw(performance.now()) };
}
