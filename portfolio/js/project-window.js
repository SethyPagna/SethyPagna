export function createProjectWindow({ overlay, window: panel, dock, onClose }) {
  let minimized = false;
  const background = [...document.querySelectorAll('body > header, body > main, body > footer, body > section, body > .skip')];
  const previousInert = new Map();

  function lockBackground(locked) {
    for (const element of background) {
      if (locked) {
        if (!previousInert.has(element)) previousInert.set(element, element.inert);
        element.inert = true;
      } else {
        element.inert = previousInert.get(element) ?? false;
      }
    }
    if (!locked) previousInert.clear();
    document.body.classList.toggle('locked', locked);
  }

  function show(title) {
    minimized = false;
    dock.hidden = true;
    dock.querySelector('#dock-title').textContent = title;
    overlay.hidden = false;
    overlay.classList.add('open');
    lockBackground(true);
    panel.focus();
  }

  function minimize() {
    minimized = true;
    overlay.hidden = true;
    overlay.classList.remove('open');
    lockBackground(false);
    dock.hidden = false;
    dock.querySelector('#restore-project').focus();
  }

  function restore() {
    show(dock.querySelector('#dock-title').textContent);
  }

  function close() {
    minimized = false;
    overlay.hidden = true;
    overlay.classList.remove('open');
    dock.hidden = true;
    lockBackground(false);
    panel.classList.remove('windowed', 'playing');
  }

  function toggleSize(button) {
    const windowed = panel.classList.toggle('windowed');
    button.setAttribute('aria-label', windowed ? 'Maximize project' : 'Restore window size');
    button.textContent = windowed ? '□' : '▣';
    button.title = windowed ? 'Maximize' : 'Restore window size';
  }

  dock.querySelector('#restore-project').addEventListener('click', restore);
  dock.querySelector('#close-minimized').addEventListener('click', onClose);

  return { show, minimize, restore, close, toggleSize, isVisible: () => !overlay.hidden && !minimized };
}
