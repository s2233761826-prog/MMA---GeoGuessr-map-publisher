// ==UserScript==
// @name         MMA -> GeoGuessr map publisher
// @namespace    mma-geoguessr
// @version      1.0.1
// @match        https://map-making.app/*
// @match        https://www.geoguessr.com/map-maker*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_GG_URL = 'https://www.geoguessr.com/map-maker';

  const STORE_KEY_NAME = 'mma_pending_json_name';
  const STORE_KEY_GO = 'mma_should_import_to_gg';
  const STORE_KEY_DONE = 'mma_import_done';

  let lastTagText = null;
  let lastSelectionCount = null;

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').trim();
  }

  function cleanTagText(text, countHint = null) {
    let t = (text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';

    const count = (countHint || '').toString().replace(/[^\d]/g, '');

    t = t.replace(/\b\d[\d,]*\s+locations\s+selected\b/ig, '').trim();
    t = t.replace(/^[-—–－\s]+|[-—–－\s]+$/g, '').trim();

    if (count) {
      t = t.replace(new RegExp(`([\\s\\-—–－_/,:;])${count}$`), '');
      if (t.endsWith(count)) {
        const prefix = t.slice(0, -count.length);
        if (prefix && /[A-Za-z\u4e00-\u9fff]/.test(prefix) && !/^\d+$/.test(prefix)) {
          t = prefix;
        }
      }
    }

    t = t.replace(/^[-—–－\s]+|[-—–－\s]+$/g, '').trim();
    return t;
  }

  function safeFilename(name) {
    return (name || 'selected_tag')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function all(selector = '*', root = document) {
    return [...root.querySelectorAll(selector)];
  }

  function isMMA() {
    return location.hostname === 'map-making.app';
  }

  function isGG() {
    return location.hostname === 'www.geoguessr.com' && location.pathname.startsWith('/map-maker');
  }

  function onCreatePage() {
    return location.pathname === '/map-maker';
  }

  function onEditorPage() {
    return /^\/map-maker\/[^/]+/.test(location.pathname);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function hardClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus(); } catch {}

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy
        }));
      } catch {}
    }

    try { el.click(); } catch {}
    return true;
  }

  function findContextMenu() {
    return all('div, ul, button').find(el => {
      const t = el.innerText || '';
      return t.includes('Remove from all') && t.includes('Rename in selection');
    }) || null;
  }

  function addImportButton(menu) {
    if (!menu || menu.querySelector('.gg-import-btn')) return;

    const btn = document.createElement('div');
    btn.className = 'gg-import-btn';
    btn.textContent = 'Import to GeoGuessr';
    btn.style.padding = '10px 12px';
    btn.style.cursor = 'pointer';
    btn.style.background = '#2d7ef7';
    btn.style.color = '#fff';
    btn.style.marginTop = '6px';
    btn.style.borderRadius = '6px';
    btn.style.userSelect = 'none';

    menu.appendChild(btn);
  }

  function clickByExactText(txt) {
    const el = all('button, div, span').find(x => textOf(x) === txt && isVisible(x));
    if (el) return hardClick(el);
    return false;
  }

  function findExportDialog() {
    return all('div').find(el => {
      const t = textOf(el);
      return isVisible(el)
        && t.includes('Export everything')
        && t.includes('Export selection')
        && t.includes('Download');
    }) || null;
  }

  function getExportRadios(dialog) {
    if (!dialog) return [];
    return [...dialog.querySelectorAll('input[type="radio"]')].filter(isVisible);
  }

  function getSelectionRow(dialog) {
    if (!dialog) return null;

    const exact = all('label, div, span, p', dialog).find(el =>
      isVisible(el) && /^Export selection\s*\(/i.test(textOf(el))
    );
    if (exact) {
      return exact.closest('label') || exact.parentElement || exact;
    }

    return null;
  }

  function getEverythingRow(dialog) {
    if (!dialog) return null;

    const exact = all('label, div, span, p', dialog).find(el =>
      isVisible(el) && /^Export everything/i.test(textOf(el))
    );
    if (exact) {
      return exact.closest('label') || exact.parentElement || exact;
    }

    return null;
  }

  function selectionLooksChosen(dialog) {
    const radios = getExportRadios(dialog);
    const everythingRadio = radios[0] || null;
    const selectionRadio = radios[1] || null;

    if (selectionRadio && selectionRadio.checked && !(everythingRadio && everythingRadio.checked)) {
      return true;
    }

    const selectionRow = getSelectionRow(dialog);
    const everythingRow = getEverythingRow(dialog);

    const sText = selectionRow ? textOf(selectionRow) : '';
    const eText = everythingRow ? textOf(everythingRow) : '';

    if (sText && !eText) return true;
    return false;
  }

  async function chooseExportSelectionReal() {
    const dialog = findExportDialog();
    if (!dialog) return false;

    const selectionRow = getSelectionRow(dialog);
    const radios = getExportRadios(dialog);
    const selectionRadio = radios[1] || null;

    // 先尽量像真人一样点文字那一行
    if (selectionRow) {
      hardClick(selectionRow);
      await sleep(180);
      hardClick(selectionRow);
      await sleep(180);
    }

    // 再补点第二个 radio
    if (selectionRadio) {
      hardClick(selectionRadio);
      await sleep(180);
      hardClick(selectionRadio);
      await sleep(180);
    }

    return selectionLooksChosen(dialog);
  }

  async function ensureSelectionLocked() {
    for (let i = 0; i < 5; i++) {
      const ok = await chooseExportSelectionReal();
      if (ok) return true;
      await sleep(220);
    }
    return false;
  }

  function setExportFilename(name) {
    const dialog = findExportDialog();
    if (!dialog) return false;

    const input = dialog.querySelector('input[type="text"]');
    if (!input) return false;

    const finalName = safeFilename(name);
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = descriptor && descriptor.set;

    input.focus();
    if (setter) setter.call(input, finalName);
    else input.value = finalName;

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function clickDownloadInExportDialog() {
    const dialog = findExportDialog();
    if (!dialog) return false;

    const btn = all('button, div[role="button"], span', dialog)
      .find(el => isVisible(el) && textOf(el) === 'Download');

    if (!btn) return false;
    return hardClick(btn.closest('button') || btn);
  }

function extractTagFromContextTarget(target) {
  const candidates = [];
  let el = target;

  function pushCandidate(raw) {
    const txt = (raw || '').replace(/\s+/g, ' ').trim();
    if (!txt) return;

    const m = txt.match(/(\d[\d,]*)\s+locations\s+selected/i);
    if (m && !lastSelectionCount) lastSelectionCount = m[1].replace(/[^\d]/g, '');

    candidates.push(txt);

    // 额外抓：如果文本里包着一层很多破折号，提取中间内容
    // 例如 ----------------gen4---------------- -> gen4
    const wrapped = txt.match(/[-—–－]{2,}\s*([^—–－-][\s\S]*?[^—–－-])\s*[-—–－]{2,}/);
    if (wrapped && wrapped[1]) {
      candidates.push(wrapped[1].trim());
    }
  }

  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    pushCandidate(el.innerText || '');
  }

  const cleaned = candidates
    .map(t => cleanTagText(t, lastSelectionCount))
    .filter(t =>
      t &&
      t.length <= 40 &&
      !t.includes('Remove from') &&
      !t.includes('Rename in') &&
      t.toLowerCase() !== 'selected_tag'
    );

  return cleaned[0] || 'selected_tag';
}

  function getReviewFilenameFromPage() {
    const label = all('div, span, p, strong, b').find(el => textOf(el) === 'Click to add:');
    if (!label) return cleanTagText(lastTagText || 'selected_tag', lastSelectionCount);

    const chips = [];
    const row = label.previousElementSibling;

    if (row) {
      const directTexts = [...row.childNodes]
        .map(n => (n.textContent || '').trim())
        .filter(Boolean);
      directTexts.forEach(t => chips.push(t));

      all('*', row)
        .map(el => textOf(el))
        .filter(Boolean)
        .forEach(t => chips.push(t));
    }

    const cleaned = [];
    for (const t of chips) {
      const c = cleanTagText(t, lastSelectionCount);
      if (!c) continue;
      if (c.length > 40) continue;
      if (c === 'Click to add:') continue;
      if (!cleaned.includes(c)) cleaned.push(c);
    }

    if (cleaned.length) return cleaned.join(' + ');
    return cleanTagText(lastTagText || 'selected_tag', lastSelectionCount);
  }

  async function runMMAFlow() {
    GM_setValue(STORE_KEY_GO, '1');
    GM_setValue(STORE_KEY_DONE, '0');

    if (!clickByExactText('Review selected locations')) {
      alert('没找到 Review selected locations 按钮。');
      return;
    }

    await sleep(900);

    const tagName = getReviewFilenameFromPage();

    if (!clickByExactText('Export')) {
      alert('进入 review 后没找到 Export 按钮。');
      return;
    }

    await sleep(500);

    const locked1 = await ensureSelectionLocked();
    if (!locked1) {
      alert('没能真正切到 Export selection。');
      return;
    }

    await sleep(200);

    const dialog = findExportDialog();
    const input = dialog ? dialog.querySelector('input[type="text"]') : null;
    const defaultName = input ? safeFilename(input.value || '') : '';

    const mapName = defaultName
      ? (defaultName.toLowerCase().endsWith(tagName.toLowerCase()) ? defaultName : `${defaultName} ${tagName}`)
      : tagName;

    GM_setValue(STORE_KEY_NAME, mapName);

    setExportFilename(mapName);
    await sleep(200);

    // 点 Download 前再锁一次，防止假切换
    const locked2 = await ensureSelectionLocked();
    if (!locked2) {
      alert('点 Download 前，Export selection 没锁住。');
      return;
    }

    await sleep(120);

    const ok = clickDownloadInExportDialog();
    if (!ok) {
      alert('没找到 Download 按钮。');
      return;
    }

    // 你手动点 Save；保存框关掉后，当前页自动跳 GG
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const focused = document.hasFocus();
      const enoughTimePassed = Date.now() - startedAt > 1200;

      if (focused && enoughTimePassed) {
        clearInterval(timer);
        location.href = TARGET_GG_URL;
      }
    }, 400);
  }

  function findNewMapNameInput() {
    return all('input').find(el => {
      const ph = (el.placeholder || '').toLowerCase();
      return ph.includes('map name');
    }) || null;
  }

  function setReactInputValue(input, value) {
    if (!input) return false;

    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = descriptor && descriptor.set;

    input.focus();

    if (setter) setter.call(input, value);
    else input.value = value;

    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText'
      }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  async function fillMapName(name) {
    const input = findNewMapNameInput();
    if (!input) return false;

    setReactInputValue(input, '');
    await sleep(80);
    setReactInputValue(input, name);
    await sleep(200);
    return true;
  }

  function findHandpickedButton() {
    return document.querySelector('button[class*="new-map-dialog_card"]')
      || all('button').find(el => textOf(el).toLowerCase().includes('handpicked locations'))
      || null;
  }

  function findCreateMapButton() {
    return document.querySelector('button[data-qa="create-map"]')
      || document.querySelector('button[class*="variantPrimary"]')
      || all('button').find(el => textOf(el).trim().toLowerCase() === 'create map')
      || null;
  }

  function isCreateMapEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if ((btn.className || '').includes('button_disabled')) return false;
    return true;
  }

  async function waitUntilCreateEnabled(maxMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const btn = findCreateMapButton();
      if (isCreateMapEnabled(btn)) return btn;
      await sleep(250);
    }
    return null;
  }

  async function createMapFlow() {
    const mapName = GM_getValue(STORE_KEY_NAME, 'selected_tag');

    await fillMapName(mapName);
    await sleep(250);

    const handpickedBtn = findHandpickedButton();
    if (handpickedBtn) {
      hardClick(handpickedBtn);
      await sleep(500);
    }

    const enabledBtn = await waitUntilCreateEnabled(10000);
    if (!enabledBtn) {
      alert('GG: CREATE MAP 一直没有变成可点击');
      return false;
    }

    hardClick(enabledBtn);

    for (let i = 0; i < 24; i++) {
      if (onEditorPage()) return true;
      await sleep(500);
    }

    return false;
  }

  function findPublishButtonElement() {
    const node = all('button, div[role="button"], a, span').find(el =>
      textOf(el).toLowerCase().includes('publish locations')
    );
    return node ? (node.closest('button') || node) : null;
  }

  function findMoreButtonNearPublish() {
    const publishBtn = findPublishButtonElement();
    if (!publishBtn) return null;

    const pr = publishBtn.getBoundingClientRect();

    const candidates = all('button').filter(btn => {
      if (btn === publishBtn) return false;
      const r = btn.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      if (r.top < pr.top - 20 || r.top > pr.bottom + 20) return false;
      if (r.right > pr.left + 10) return false;
      if (pr.left - r.right > 180) return false;
      if (r.width > 80 || r.height > 80) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const da = pr.left - a.getBoundingClientRect().right;
      const db = pr.left - b.getBoundingClientRect().right;
      return da - db;
    });

    return candidates[0] || null;
  }

  function findImportJsonMenuItem() {
    return all('button, div, span, a, li').find(el => {
      const txt = textOf(el);
      return isVisible(el) && txt === 'Import JSON file';
    }) || null;
  }

  function findModalImportButton() {
    return all('button, div, span').find(el => {
      const txt = textOf(el);
      return isVisible(el) && txt === 'IMPORT JSON FILE';
    }) || null;
  }

  async function editorImportHelper() {
    for (let tries = 0; tries < 20; tries++) {
      let importItem = findImportJsonMenuItem();

      if (!importItem) {
        const moreBtn = findMoreButtonNearPublish();
        if (moreBtn) {
          hardClick(moreBtn);
          await sleep(700);
          importItem = findImportJsonMenuItem();
        }
      }

      if (importItem) {
        hardClick(importItem);
        await sleep(700);

        const modalImport = findModalImportButton();
        if (modalImport) {
          hardClick(modalImport);
          GM_setValue(STORE_KEY_DONE, '1');
          GM_setValue(STORE_KEY_GO, '0');
          return true;
        }
      }

      await sleep(600);
    }

    alert('GG: 已进入编辑页，但没有自动打开文件选择框');
    return false;
  }

  async function runGGStateMachine() {
    if (window.__mmaGGStateMachineRunning) return;
    window.__mmaGGStateMachineRunning = true;

    while (true) {
      const shouldGo = GM_getValue(STORE_KEY_GO, '0');
      const done = GM_getValue(STORE_KEY_DONE, '0');

      if (shouldGo !== '1' || done === '1') {
        await sleep(700);
        continue;
      }

      if (onCreatePage()) {
        const ok = await createMapFlow();
        if (!ok) {
          await sleep(700);
          continue;
        }
      }

      if (onEditorPage()) {
        const ok = await editorImportHelper();
        if (!ok) {
          await sleep(700);
          continue;
        }
      }

      await sleep(700);
    }
  }

  if (isMMA()) {
    document.addEventListener('contextmenu', (e) => {
      lastTagText = extractTagFromContextTarget(e.target);

      setTimeout(() => {
        const menu = findContextMenu();
        if (menu) addImportButton(menu);
      }, 120);
    }, true);

    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.gg-import-btn');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();
      runMMAFlow();
    }, true);
  }

  if (isGG()) {
    runGGStateMachine();
  }
})();
