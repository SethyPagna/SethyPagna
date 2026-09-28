// Split-flap text: each tile cycles through characters before settling, like an airport board.

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+&';

export function flapRow(el, text, { width = text.length, delay = 0, reduced = false } = {}) {
  el.textContent = '';
  el.setAttribute('aria-label', text);
  const target = text.toUpperCase().padEnd(width, ' ').slice(0, width);
  const tiles = [...target].map(ch => {
    const t = document.createElement('span');
    t.className = 'flap';
    t.setAttribute('aria-hidden', 'true');
    t.textContent = ch === ' ' ? '' : ch;
    t.dataset.final = ch;
    el.appendChild(t);
    return t;
  });
  if (reduced) return Promise.resolve();
  return new Promise(resolve => {
    let done = 0;
    tiles.forEach((tile, i) => {
      const final = tile.dataset.final;
      if (final === ' ') { tile.textContent = ''; if (++done === tiles.length) resolve(); return; }
      const spins = 6 + Math.floor(Math.random() * 10) + i;
      let n = 0;
      tile.textContent = '';
      const tick = () => {
        if (n++ >= spins) {
          tile.textContent = final; tile.classList.remove('spin');
          if (++done === tiles.length) resolve();
          return;
        }
        tile.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
        tile.classList.remove('spin'); void tile.offsetWidth; tile.classList.add('spin');
        setTimeout(tick, 42 + Math.random() * 30);
      };
      setTimeout(tick, delay + i * 18);
    });
  });
}
