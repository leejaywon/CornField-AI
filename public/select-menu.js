// Keep the native select as the form/data source; render its menu in the app theme.
let active = null;
let nextId = 0;
const labels = { qualityFilter: 'Quality', sortSelect: 'Sort videos', tagSortSelect: 'Sort tags' };

function enhance(select) {
  if (select.dataset.themed || select.multiple) return;
  select.dataset.themed = 'true';
  const wrapper = document.createElement('div');
  wrapper.className = 'select-menu';
  select.before(wrapper);
  wrapper.append(select);
  select.hidden = true;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-menu-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const labelNode = select.labels?.[0]?.cloneNode(true);
  labelNode?.querySelectorAll('select, .select-menu').forEach((node) => node.remove());
  const label = labels[select.id] || labelNode?.textContent.trim() || 'Choose option';
  const menu = document.createElement('div');
  menu.id = `select-menu-${++nextId}`;
  menu.className = 'select-menu-options';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', label);
  menu.setAttribute('popover', 'manual');
  trigger.setAttribute('aria-controls', menu.id);
  wrapper.append(trigger, menu);
  let index = 0;
  let prefix = '';
  let lastTyped = 0;
  const sync = () => {
    trigger.textContent = select.selectedOptions[0]?.textContent || 'Choose option';
    trigger.setAttribute('aria-label', `${label}: ${trigger.textContent}`);
    trigger.disabled = select.disabled;
  };
  // Existing settings and filters set .value directly without emitting change.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', { configurable: true, get() { return descriptor.get.call(this); }, set(value) { descriptor.set.call(this, value); sync(); } });
  const close = () => {
    if (menu.matches(':popover-open')) menu.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    if (active?.select === select) active = null;
  };
  const highlight = () => {
    [...menu.children].forEach((option, i) => option.classList.toggle('is-highlighted', i === index));
    const option = menu.children[index];
    if (option) {
      trigger.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  };
  const choose = (i) => {
    if (!select.options[i] || select.options[i].disabled) return;
    select.selectedIndex = i;
    sync();
    close();
    trigger.focus();
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const open = () => {
    active?.close();
    menu.replaceChildren();
    [...select.options].forEach((option, i) => {
      const item = document.createElement('div');
      item.id = `${menu.id}-${i}`;
      item.className = 'select-menu-option';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(option.disabled));
      item.textContent = option.textContent;
      item.addEventListener('pointerdown', (event) => event.preventDefault());
      item.addEventListener('click', () => choose(i));
      menu.append(item);
    });
    index = Math.max(0, select.selectedIndex);
    menu.showPopover();
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < Math.min(menu.scrollHeight, 280) && above > below;
    menu.style.maxHeight = `${Math.max(60, Math.min(320, upward ? above : below))}px`;
    menu.style.width = `${Math.min(Math.max(rect.width, 210), window.innerWidth - 24)}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${upward ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6}px`;
    trigger.setAttribute('aria-expanded', 'true');
    active = { select, wrapper, menu, close };
    highlight();
  };
  trigger.addEventListener('click', () => active?.select === select ? close() : open());
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active?.select === select) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') { close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (active?.select !== select) { open(); return; }
      if (event.key === 'Enter' || event.key === ' ') { choose(index); return; }
      const enabled = [...select.options].map((option, i) => option.disabled ? -1 : i).filter((i) => i >= 0);
      const current = enabled.indexOf(index);
      index = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[Math.max(0, Math.min(enabled.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))];
      highlight();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (active?.select !== select) open();
      prefix = Date.now() - lastTyped > 700 ? event.key : prefix + event.key;
      lastTyped = Date.now();
      const match = [...select.options].findIndex((option) => !option.disabled && option.textContent.toLowerCase().startsWith(prefix.toLowerCase()));
      if (match >= 0) { index = match; highlight(); }
    }
  });
  select.addEventListener('change', sync);
  select.form?.addEventListener('reset', () => setTimeout(sync, 0));
  sync();
}

function refresh() {
  if (active && !active.select.isConnected) active.close();
  document.querySelectorAll('select:not([data-themed])').forEach(enhance);
}
new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
document.addEventListener('pointerdown', (event) => {
  if (active && !active.wrapper.contains(event.target)) active.close();
});
document.addEventListener('focusin', (event) => {
  if (active && !active.wrapper.contains(event.target)) active.close();
});
window.addEventListener('resize', () => active?.close());
document.addEventListener('scroll', (event) => {
  if (active && !active.menu.contains(event.target)) active.close();
}, true);
refresh();
