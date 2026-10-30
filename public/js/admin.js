'use strict';

/* ================================================================
   安妤鱼 · admin
   ================================================================ */

const MOODS = {
  happy: { emoji: '😄', label: '开心' },
  sweet: { emoji: '🥰', label: '甜蜜' },
  calm: { emoji: '😌', label: '平静' },
  miss: { emoji: '🌙', label: '想念' },
  tired: { emoji: '😪', label: '疲惫' },
  sad: { emoji: '😢', label: '难过' },
  angry: { emoji: '😠', label: '小情绪' },
};

const SECTIONS = {
  overview: { title: '概览', eyebrow: 'OUR PRIVATE SPACE' },
  settings: { title: '站点设置', eyebrow: 'MAKE IT OURS' },
  photos: { title: '首页照片', eyebrow: 'LIGHT & MEMORY' },
  records: { title: '生活记录', eyebrow: 'WRITE IT DOWN' },
  moods: { title: '心情记录', eyebrow: 'HOW ARE YOU' },
};

const state = {
  data: null,
  section: 'overview',
  pending: [],
  photoFile: null,
  photoPreviewUrl: null,
  editingRecordId: null,
  editingMood: null,
  moodChoice: '',
  recorder: null,
  mediaStream: null,
  audioChunks: [],
  recordTimer: null,
  recordStartedAt: 0,
  confirmResolver: null,
  initializedMoodForm: false,
};

const $ = (id) => document.getElementById(id);
const pad = (value) => String(value).padStart(2, '0');

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TODAY = localDateString();

function parseDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return new Date(NaN);
  return new Date(year, month - 1, day);
}

function formatDateCN(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatDateShort(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return `${date.getMonth() + 1}.${pad(date.getDate())}`;
}

function weekdayCN(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
}

function relativeDay(value) {
  const diff = Math.round((parseDate(TODAY).getTime() - parseDate(value).getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return weekdayCN(value);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function truncate(value, length = 100) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function moodOf(id) {
  return MOODS[id] || null;
}

function showToast(message, type = 'success') {
  const toast = $('adminToast');
  toast.textContent = message;
  toast.classList.toggle('is-error', type === 'error');
  toast.classList.add('is-show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('is-show'), 3400);
}

/* ---------------- API ---------------- */

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  } catch {
    throw new Error('网络连接失败，请检查网站服务是否启动。');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (response.status === 401) {
    showLogin();
    throw new Error('登录已过期，请重新登录。');
  }
  if (!response.ok) throw new Error(data?.error || '操作失败，请稍后再试。');
  return data;
}

async function loadAdmin() {
  const data = await api('/api/admin/bootstrap');
  state.data = data;
  $('loginScreen').hidden = true;
  $('adminApp').hidden = false;
  document.title = `${data.settings.siteTitle} · 后台`;
  fillSettingsForm();
  renderAll();
  initMoodForm();
  openFromHash();
  window.setTimeout(() => $('adminApp').classList.add('is-ready'), 20);
}

function showLogin() {
  $('adminApp').hidden = true;
  $('loginScreen').hidden = false;
  $('loginPassword').focus();
  stopTracks();
  clearPendingFiles();
}

function openFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'new-record') {
    go('records', { reset: true });
    window.setTimeout(() => $('recordTitle').focus(), 350);
    return;
  }
  if (hash === 'mood') {
    go('moods');
    return;
  }
  if (SECTIONS[hash]) go(hash);
}

/* ---------------- login ---------------- */

function setupLogin() {
  $('passwordToggle').addEventListener('click', () => {
    const input = $('loginPassword');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    $('passwordToggle').setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
    $('passwordToggle').classList.toggle('is-visible', !visible);
    input.focus();
  });

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('loginPassword').value;
    const error = $('loginError');
    error.textContent = '';
    if (!password) {
      error.textContent = '先输入我们的暗号吧。';
      return;
    }
    const button = $('loginSubmit');
    button.disabled = true;
    button.classList.add('is-loading');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        error.textContent = data.error || '登录失败，请再试一次。';
        $('loginPassword').select();
        return;
      }
      $('loginForm').reset();
      await loadAdmin();
    } catch {
      error.textContent = '连接不上服务器，请稍后再试。';
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  });
}

function setupLogout() {
  $('logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* show login regardless */
    }
    showLogin();
    $('loginPassword').value = '';
    showToast('已退出登录');
  });
}

/* ---------------- navigation ---------------- */

function go(section, options = {}) {
  if (!SECTIONS[section]) return;
  state.section = section;
  document.querySelectorAll('.admin-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== section;
  });
  document.querySelectorAll('.admin-nav button, .admin-mobile-nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === section);
  });
  $('pageTitle').textContent = SECTIONS[section].title;
  const eyebrow = document.querySelector('.topbar-eyebrow');
  if (eyebrow) eyebrow.textContent = SECTIONS[section].eyebrow;
  window.history.replaceState(null, '', `#${section}`);
  if (section === 'records' && options.reset) resetComposer();
  if (section === 'records' && options.focusComposer) {
    $('composerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => $('recordContent').focus(), 400);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function setupNavigation() {
  document.querySelectorAll('.admin-nav button, .admin-mobile-nav button').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.section));
  });
  document.querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.goto;
      if (section === 'records' && button.dataset.newRecord === 'true') {
        resetComposer();
        go('records', { focusComposer: true });
      } else {
        go(section);
      }
    });
  });
}

/* ---------------- overview ---------------- */

function renderAll() {
  renderOverview();
  renderPhotos();
  renderRecords();
  renderMoods();
  $('todayDate').textContent = `${formatDateCN(TODAY)} · ${weekdayCN(TODAY)}`;
  const settings = state.data.settings;
  document.title = `${settings.siteTitle} · 后台`;
  $('passwordAlert').hidden = !state.data.passwordIsDefault;
}

function renderOverview() {
  if (!state.data) return;
  const { settings, stats, records, moods } = state.data;
  $('welcomeName').textContent = `${settings.partnerA} & ${settings.partnerB}`;
  $('welcomeSubtitle').textContent = settings.heroSubtitle || '今天也把平凡的小事，留一点在这里吧。';
  document.querySelectorAll('[data-stat]').forEach((node) => {
    const key = node.dataset.stat;
    node.textContent = String(stats[key] ?? 0);
  });
  $('passwordAlert').hidden = !state.data.passwordIsDefault;

  const recent = $('overviewRecent');
  recent.textContent = '';
  if (!records.length) {
    const empty = el('div', 'mini-empty');
    empty.appendChild(el('p', '', '这里还安安静静的。'));
    empty.appendChild(el('span', '', '写下第一条记录，让故事有个开头。'));
    recent.appendChild(empty);
  } else {
    records.slice(0, 3).forEach((record) => {
      const item = el('button', 'mini-record');
      item.type = 'button';
      item.addEventListener('click', () => editRecord(record.id));
      const date = el('span', 'mini-record-date');
      date.appendChild(el('strong', '', String(parseDate(record.date).getDate()).padStart(2, '0')));
      date.appendChild(el('small', '', formatDateShort(record.date)));
      item.appendChild(date);
      const main = el('span', 'mini-record-main');
      const title = record.title || truncate(record.content, 28) || '一段没有文字的日常';
      main.appendChild(el('strong', '', title));
      main.appendChild(el('small', '', `${relativeDay(record.date)} · ${record.content ? truncate(record.content, 34) : '只有画面，也很珍贵'}`));
      item.appendChild(main);
      const mood = moodOf(record.mood);
      item.appendChild(el('span', 'mini-mood', mood ? mood.emoji : '·'));
      recent.appendChild(item);
    });
  }

  const recentMood = $('overviewMood');
  recentMood.textContent = '';
  if (!moods.length) {
    recentMood.appendChild(el('p', 'mini-empty-note', '还没有心情记录，今天想记下什么呢？'));
  } else {
    const latest = moods.slice(0, 3);
    for (const mood of latest) {
      const meta = moodOf(mood.mood);
      const row = el('div', 'mood-mini-row');
      row.appendChild(el('span', 'mood-mini-emoji', meta ? meta.emoji : '·'));
      const main = el('div', 'mood-mini-main');
      main.appendChild(el('strong', '', meta ? meta.label : '心情'));
      main.appendChild(el('small', '', `${formatDateCN(mood.date)}${mood.note ? ` · ${truncate(mood.note, 24)}` : ''}`));
      row.appendChild(main);
      row.appendChild(el('span', 'mood-mini-date', formatDateShort(mood.date)));
      recentMood.appendChild(row);
    }
  }
}

/* ---------------- settings ---------------- */

function fillSettingsForm() {
  const form = $('settingsForm');
  for (const [key, value] of Object.entries(state.data.settings)) {
    const field = form.elements.namedItem(key);
    if (field) field.value = value ?? '';
  }
}

function setupSettings() {
  $('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {};
    for (const name of ['siteTitle', 'partnerA', 'partnerB', 'startDate', 'heroEyebrow', 'heroSubtitle', 'heroQuote', 'footerNote']) {
      payload[name] = form.elements.namedItem(name)?.value ?? '';
    }
    if (!payload.siteTitle.trim()) return showToast('网站名称不能为空', 'error');
    if (!payload.startDate) return showToast('请选择恋爱开始日期', 'error');
    const button = $('settingsSave');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      const result = await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.data.settings = result.settings;
      state.data.stats = result.stats;
      renderOverview();
      document.title = `${result.settings.siteTitle} · 后台`;
      showToast('设置已保存，首页已经更新啦');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = '保存设置';
    }
  });

  $('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = $('currentPassword').value;
    const newPassword = $('newPassword').value;
    const confirmPassword = $('confirmPassword').value;
    if (newPassword.length < 6) return showToast('新密码至少需要 6 位', 'error');
    if (newPassword !== confirmPassword) return showToast('两次输入的新密码不一致', 'error');
    const button = $('passwordSave');
    button.disabled = true;
    button.textContent = '更新中…';
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      $('passwordForm').reset();
      showLogin();
      showToast('密码已更新，请用新密码重新登录');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = '更新密码';
    }
  });
}

/* ---------------- photos ---------------- */

function renderPhotos() {
  if (!state.data) return;
  const heroReal = state.data.photos.hero.filter((photo) => !photo.isDefault);
  renderPhotoGroup($('heroPhotoList'), heroReal, 'hero');
  renderPhotoGroup($('galleryPhotoList'), state.data.photos.gallery, 'gallery');
  $('heroPhotoCount').textContent = String(heroReal.length);
  $('galleryPhotoCount').textContent = String(state.data.photos.gallery.length);
}

function renderPhotoGroup(container, photos, category) {
  container.textContent = '';
  if (!photos.length) {
    const empty = el('div', 'managed-empty');
    empty.appendChild(el('span', '', category === 'hero' ? '🖼️' : '📷'));
    empty.appendChild(el('p', '', category === 'hero' ? '还没有上传首页轮播照' : '光影集还是空的'));
    empty.appendChild(el('small', '', category === 'hero'
      ? '现在首页显示的是一张默认风景插画，上传照片后就会替换。'
      : '上传照片，或先写一条带照片的生活记录。'));
    container.appendChild(empty);
    return;
  }

  photos.forEach((photo, index) => {
    const card = el('article', 'managed-photo');
    const thumb = el('div', 'managed-photo-thumb');
    const img = el('img');
    img.src = photo.url;
    img.alt = photo.caption || '已上传照片';
    img.loading = 'lazy';
    thumb.appendChild(img);
    card.appendChild(thumb);

    const info = el('div', 'managed-photo-info');
    const caption = el('input', 'caption-input');
    caption.type = 'text';
    caption.maxLength = 80;
    caption.value = photo.caption || '';
    caption.placeholder = '给照片写一句说明';
    caption.setAttribute('aria-label', '照片说明');
    info.appendChild(caption);

    const meta = el('p', 'managed-photo-meta');
    meta.textContent = `${category === 'hero' ? '首页轮播' : '光影集'} · 第 ${index + 1} 张`;
    info.appendChild(meta);

    const actions = el('div', 'managed-photo-actions');
    const saveCaption = el('button', 'mini-btn', '保存文字');
    saveCaption.type = 'button';
    saveCaption.addEventListener('click', async () => {
      try {
        const result = await api(`/api/admin/photos/${photo.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ caption: caption.value.trim() }),
        });
        state.data.photos = result.photos;
        renderPhotos();
        showToast('照片说明已更新');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    const moveUp = el('button', 'mini-btn icon-only', '↑');
    moveUp.type = 'button';
    moveUp.title = '向前移动';
    moveUp.setAttribute('aria-label', '向前移动');
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', () => movePhoto(photo.id, 'up'));

    const moveDown = el('button', 'mini-btn icon-only', '↓');
    moveDown.type = 'button';
    moveDown.title = '向后移动';
    moveDown.setAttribute('aria-label', '向后移动');
    moveDown.disabled = index === photos.length - 1;
    moveDown.addEventListener('click', () => movePhoto(photo.id, 'down'));

    const switchCategory = el('button', 'mini-btn', category === 'hero' ? '移到光影集' : '设为首页轮播');
    switchCategory.type = 'button';
    switchCategory.addEventListener('click', async () => {
      try {
        const next = category === 'hero' ? 'gallery' : 'hero';
        const result = await api(`/api/admin/photos/${photo.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ category: next, caption: caption.value.trim() }),
        });
        state.data.photos = result.photos;
        renderPhotos();
        showToast(next === 'hero' ? '已设为首页轮播照' : '已移到光影集');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    const remove = el('button', 'mini-btn danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: '删除这张照片吗？',
        text: '照片会从网站上移除，删除后无法恢复。',
      });
      if (!confirmed) return;
      try {
        const result = await api(`/api/admin/photos/${photo.id}`, { method: 'DELETE' });
        state.data.photos = result.photos;
        renderPhotos();
        showToast('照片已删除');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });

    actions.append(saveCaption, moveUp, moveDown, switchCategory, remove);
    info.appendChild(actions);
    card.appendChild(info);
    container.appendChild(card);
  });
}

async function movePhoto(id, direction) {
  try {
    const result = await api(`/api/admin/photos/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    });
    state.data.photos = result.photos;
    renderPhotos();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function setupPhotoUpload() {
  const fileInput = $('photoFile');
  const drop = $('photoDrop');

  const acceptFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast('这里只能上传照片', 'error');
    if (file.size > 150 * 1024 * 1024) return showToast('照片不能超过 150MB', 'error');
    clearPhotoSelection();
    state.photoFile = file;
    $('photoFileName').textContent = `${file.name} · ${formatSize(file.size)}`;
    state.photoPreviewUrl = URL.createObjectURL(file);
    const preview = el('img', 'photo-preview');
    preview.src = state.photoPreviewUrl;
    preview.alt = '待上传照片预览';
    drop.appendChild(preview);
    drop.classList.add('has-file');
  };

  fileInput.addEventListener('change', () => acceptFile(fileInput.files?.[0]));

  for (const eventName of ['dragenter', 'dragover']) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragging');
    });
  }
  drop.addEventListener('drop', (event) => acceptFile(event.dataTransfer?.files?.[0]));

  $('photoForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = state.photoFile || fileInput.files?.[0];
    if (!file) return showToast('先选择一张照片吧', 'error');
    const formData = new FormData();
    formData.append('photo', file, file.name);
    formData.append('category', $('photoCategory').value);
    formData.append('caption', $('photoCaption').value.trim());
    const button = $('photoSubmit');
    button.disabled = true;
    button.textContent = '上传中…';
    try {
      const result = await api('/api/admin/photos', { method: 'POST', body: formData });
      state.data.photos = result.photos;
      renderPhotos();
      clearPhotoSelection();
      fileInput.value = '';
      $('photoCaption').value = '';
      showToast('照片已上传，首页已经换新啦');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3h16v-3"/></svg>上传照片';
    }
  });
}

function clearPhotoSelection() {
  state.photoFile = null;
  if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
  state.photoPreviewUrl = null;
  $('photoFileName').textContent = '还没有选择照片';
  const preview = document.querySelector('.photo-preview');
  if (preview) preview.remove();
  $('photoDrop').classList.remove('has-file');
}

/* ---------------- records ---------------- */

function renderMoodPicker(container, selected, large = false) {
  container.textContent = '';
  for (const [id, mood] of Object.entries(MOODS)) {
    const button = el('button', `mood-choice${large ? ' large' : ''}${selected === id ? ' is-selected' : ''}`);
    button.type = 'button';
    button.dataset.mood = id;
    button.setAttribute('aria-pressed', selected === id ? 'true' : 'false');
    button.appendChild(el('span', 'mood-choice-emoji', mood.emoji));
    button.appendChild(el('span', 'mood-choice-label', mood.label));
    button.addEventListener('click', () => {
      state.moodChoice = id;
      renderMoodPicker(container, id, large);
    });
    container.appendChild(button);
  }
}

function setupMoodPicker() {
  state.moodChoice = '';
  renderRecordMoodPicker('');
  renderMoodPicker($('moodChoices'), '', true);
}

function renderRecordMoodPicker(selected) {
  const container = $('moodPicker');
  container.textContent = '';
  for (const [id, mood] of Object.entries(MOODS)) {
    const button = el('button', `mood-choice${selected === id ? ' is-selected' : ''}`);
    button.type = 'button';
    button.dataset.mood = id;
    button.setAttribute('aria-pressed', selected === id ? 'true' : 'false');
    button.appendChild(el('span', 'mood-choice-emoji', mood.emoji));
    button.appendChild(el('span', 'mood-choice-label', mood.label));
    button.addEventListener('click', () => {
      $('recordMood').value = id;
      renderRecordMoodPicker(id);
    });
    container.appendChild(button);
  }
}

function resetComposer() {
  $('recordForm').reset();
  $('recordId').value = '';
  $('recordMood').value = '';
  $('recordDate').value = TODAY;
  $('recordDate').max = TODAY;
  state.editingRecordId = null;
  clearPendingFiles();
  $('composerTitle').textContent = '写一条生活记录';
  $('composerHint').textContent = '文字、照片、录音、视频，想把这一刻留成什么样都可以。';
  $('recordSubmitText').textContent = '保存这一刻';
  $('recordCancel').hidden = true;
  $('existingMedia').hidden = true;
  $('existingMedia').textContent = '';
  renderRecordMoodPicker('');
  updateAttachCounter();
}

function editRecord(id) {
  const record = state.data?.records?.find((item) => item.id === id);
  if (!record) return;
  state.editingRecordId = record.id;
  $('recordId').value = record.id;
  $('recordDate').value = record.date;
  $('recordTitle').value = record.title || '';
  $('recordContent').value = record.content || '';
  $('recordMood').value = record.mood || '';
  $('composerTitle').textContent = '编辑这条记录';
  $('composerHint').textContent = '修改文字和心情；已保存的照片、语音和视频可以在下方单独删除。';
  $('recordSubmitText').textContent = '保存修改';
  $('recordCancel').hidden = false;
  renderRecordMoodPicker(record.mood || '');
  clearPendingFiles();
  renderExistingMedia(record);
  go('records');
  window.setTimeout(() => {
    $('composerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('recordTitle').focus();
  }, 120);
}

function renderExistingMedia(record) {
  const container = $('existingMedia');
  container.textContent = '';
  const media = record.media || [];
  if (!media.length || !state.editingRecordId) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const head = el('p', 'existing-head', `已保存的附件 · ${media.length}`);
  container.appendChild(head);
  for (const item of media) {
    const row = el('div', 'existing-item');
    const preview = el('div', 'existing-preview');
    if (item.type === 'image') {
      const img = el('img');
      img.src = item.url;
      img.alt = '已保存照片';
      preview.appendChild(img);
    } else if (item.type === 'audio') {
      const audio = el('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = item.url;
      preview.appendChild(audio);
    } else if (item.type === 'video') {
      const video = el('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = item.url;
      preview.appendChild(video);
    }
    row.appendChild(preview);
    const label = el('span', 'existing-name', item.originalName || (item.type === 'audio' ? '一段语音' : '一个附件'));
    row.appendChild(label);
    const remove = el('button', 'mini-btn danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: '删除这个附件吗？',
        text: '附件会从这条记录和网站上永久移除。',
      });
      if (!confirmed) return;
      try {
        const result = await api(`/api/admin/media/${item.id}`, { method: 'DELETE' });
        const recordIndex = state.data.records.findIndex((entry) => entry.id === result.record.id);
        if (recordIndex >= 0) state.data.records[recordIndex] = result.record;
        renderExistingMedia(result.record);
        renderRecords();
        showToast('附件已删除');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    row.appendChild(remove);
    container.appendChild(row);
  }
  updateAttachCounter();
}

function addFiles(fileList) {
  if (!fileList) return;
  const files = Array.from(fileList);
  for (const file of files) {
    if (state.pending.length >= 12) {
      showToast('一次最多添加 12 个附件', 'error');
      break;
    }
    const type = (file.type || '').split('/')[0];
    if (!['image', 'audio', 'video'].includes(type)) {
      showToast(`「${file.name}」不是支持的照片、音频或视频`, 'error');
      continue;
    }
    if (file.size > 150 * 1024 * 1024) {
      showToast(`「${file.name}」超过了 150MB`, 'error');
      continue;
    }
    state.pending.push({ file, type, url: URL.createObjectURL(file) });
  }
  renderPendingFiles();
}

function renderPendingFiles() {
  const container = $('pendingFiles');
  container.textContent = '';
  state.pending.forEach((item, index) => {
    const row = el('div', 'pending-item');
    const preview = el('div', 'pending-preview');
    if (item.type === 'image') {
      const img = el('img');
      img.src = item.url;
      img.alt = '待上传照片';
      preview.appendChild(img);
    } else if (item.type === 'audio') {
      const audio = el('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = item.url;
      preview.appendChild(audio);
    } else if (item.type === 'video') {
      const video = el('video');
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.src = item.url;
      preview.appendChild(video);
    }
    row.appendChild(preview);
    const meta = el('div', 'pending-meta');
    meta.appendChild(el('strong', '', item.file.name));
    meta.appendChild(el('small', '', `${item.type === 'image' ? '照片' : item.type === 'audio' ? '语音' : '视频'} · ${formatSize(item.file.size)}`));
    row.appendChild(meta);
    const remove = el('button', 'pending-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除这个附件');
    remove.addEventListener('click', () => {
      URL.revokeObjectURL(item.url);
      state.pending.splice(index, 1);
      renderPendingFiles();
    });
    row.appendChild(remove);
    container.appendChild(row);
  });
  updateAttachCounter();
}

function updateAttachCounter() {
  const count = state.pending.length + (state.editingRecordId
    ? (state.data?.records?.find((record) => record.id === state.editingRecordId)?.media?.length || 0)
    : 0);
  $('attachCounter').textContent = `${state.pending.length} / 12 个新附件`;
  $('attachCounter').title = state.editingRecordId ? `这条记录已有 ${count - state.pending.length} 个已保存附件` : '';
}

function clearPendingFiles() {
  for (const item of state.pending) URL.revokeObjectURL(item.url);
  state.pending = [];
  renderPendingFiles();
}

function setupRecordForm() {
  $('recordDate').value = TODAY;
  $('recordDate').max = TODAY;
  $('recordMood').value = '';
  renderRecordMoodPicker('');

  $('pickMediaBtn').addEventListener('click', () => $('mediaInput').click());
  $('pickAudioBtn').addEventListener('click', () => $('audioInput').click());
  $('mediaInput').addEventListener('change', (event) => {
    addFiles(event.target.files);
    event.target.value = '';
  });
  $('audioInput').addEventListener('change', (event) => {
    addFiles(event.target.files);
    event.target.value = '';
  });

  $('newRecordBtn').addEventListener('click', () => {
    resetComposer();
    go('records', { focusComposer: true });
  });
  $('recordCancel').addEventListener('click', () => {
    resetComposer();
    go('records');
  });

  $('recordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.recorder && state.recorder.state !== 'inactive') {
      showToast('先点一下「停止录音」，把声音收好再保存', 'error');
      return;
    }
    const date = $('recordDate').value;
    const title = $('recordTitle').value.trim();
    const content = $('recordContent').value.trim();
    const mood = $('recordMood').value;
    const editing = Boolean(state.editingRecordId);
    const existingCount = editing
      ? (state.data.records.find((record) => record.id === state.editingRecordId)?.media?.length || 0)
      : 0;
    if (!date) return showToast('请选择记录日期', 'error');
    if (!editing && !title && !content && !state.pending.length) {
      return showToast('写点什么，或加一张照片、一段声音吧', 'error');
    }
    if (editing && !title && !content && !state.pending.length && !existingCount) {
      return showToast('这条记录还是空的，写点什么吧', 'error');
    }

    const button = $('recordSubmit');
    button.disabled = true;
    const oldLabel = $('recordSubmitText').textContent;
    $('recordSubmitText').textContent = '保存中…';

    try {
      if (editing) {
        await api(`/api/admin/records/${state.editingRecordId}`, {
          method: 'PATCH',
          body: JSON.stringify({ date, title, content, mood }),
        });
        if (state.pending.length) {
          const formData = new FormData();
          formData.append('date', date);
          for (const item of state.pending) formData.append('media', item.file, item.file.name);
          await api(`/api/admin/records/${state.editingRecordId}/media`, { method: 'POST', body: formData });
        }
      } else {
        const formData = new FormData();
        formData.append('date', date);
        formData.append('title', title);
        formData.append('content', content);
        formData.append('mood', mood);
        for (const item of state.pending) formData.append('media', item.file, item.file.name);
        await api('/api/admin/records', { method: 'POST', body: formData });
      }

      clearPendingFiles();
      await refreshData();
      resetComposer();
      go('records');
      showToast(editing ? '记录已经更新' : '这一刻已经收好啦');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      $('recordSubmitText').textContent = oldLabel;
    }
  });
}

function renderRecords() {
  const container = $('recordList');
  container.textContent = '';
  const records = state.data?.records || [];
  $('recordCount').textContent = String(records.length);
  if (!records.length) {
    const empty = el('div', 'managed-empty large');
    empty.appendChild(el('span', '', '✎'));
    empty.appendChild(el('p', '', '还没有生活记录'));
    empty.appendChild(el('small', '', '写下第一句话，或者放上第一张照片。'));
    container.appendChild(empty);
    return;
  }

  records.forEach((record) => {
    const row = el('article', 'record-row');
    const date = el('div', 'record-row-date');
    date.appendChild(el('strong', '', String(parseDate(record.date).getDate()).padStart(2, '0')));
    date.appendChild(el('span', '', `${parseDate(record.date).getFullYear()}.${pad(parseDate(record.date).getMonth() + 1)}`));
    date.appendChild(el('small', '', relativeDay(record.date)));
    row.appendChild(date);

    const main = el('div', 'record-row-main');
    const head = el('div', 'record-row-head');
    const title = el('h4', '', record.title || '无题的小日常');
    head.appendChild(title);
    const mood = moodOf(record.mood);
    if (mood) head.appendChild(el('span', 'mood-pill-small', `${mood.emoji} ${mood.label}`));
    row.appendChild(main).appendChild(head);

    if (record.content) main.appendChild(el('p', 'record-row-text', truncate(record.content, 150)));

    const meta = el('div', 'record-row-meta');
    const imageCount = (record.media || []).filter((item) => item.type === 'image').length;
    const audioCount = (record.media || []).filter((item) => item.type === 'audio').length;
    const videoCount = (record.media || []).filter((item) => item.type === 'video').length;
    if (imageCount) meta.appendChild(el('span', '', `📷 ${imageCount} 张照片`));
    if (audioCount) meta.appendChild(el('span', '', `🎙 ${audioCount} 段语音`));
    if (videoCount) meta.appendChild(el('span', '', `🎬 ${videoCount} 段视频`));
    if (!imageCount && !audioCount && !videoCount) meta.appendChild(el('span', '', '纯文字'));
    main.appendChild(meta);

    const images = (record.media || []).filter((item) => item.type === 'image').slice(0, 4);
    if (images.length) {
      const thumbs = el('div', 'record-row-thumbs');
      for (const image of images) {
        const img = el('img');
        img.src = image.url;
        img.alt = '记录照片';
        img.loading = 'lazy';
        img.addEventListener('click', () => window.open(image.url, '_blank', 'noopener'));
        thumbs.appendChild(img);
      }
      main.appendChild(thumbs);
    }

    const actions = el('div', 'record-row-actions');
    const edit = el('button', 'mini-btn', '编辑');
    edit.type = 'button';
    edit.addEventListener('click', () => editRecord(record.id));
    const remove = el('button', 'mini-btn danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: '删除这条记录吗？',
        text: '记录里的文字、照片、语音和视频都会一起删除，无法恢复。',
      });
      if (!confirmed) return;
      try {
        await api(`/api/admin/records/${record.id}`, { method: 'DELETE' });
        if (state.editingRecordId === record.id) resetComposer();
        await refreshData();
        showToast('记录已删除');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    actions.append(edit, remove);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

/* ---------------- audio recorder ---------------- */

function setupRecorder() {
  const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!supported) {
    $('audioRecordBtn').disabled = true;
    $('audioHint').textContent = '这个浏览器不支持直接录音，可以点「上传语音」添加录音文件。';
    return;
  }
  $('audioRecordBtn').addEventListener('click', async () => {
    if (state.recorder && state.recorder.state !== 'inactive') {
      stopRecording();
      return;
    }
    await startRecording();
  });
}

async function startRecording() {
  if (state.pending.length >= 12) {
    showToast('附件已经有 12 个了，先删掉几个再录吧', 'error');
    return;
  }
  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    const message = error?.name === 'NotAllowedError'
      ? '麦克风权限被拒绝了。请在浏览器设置里允许麦克风，或改用「上传语音」。'
      : error?.name === 'NotFoundError'
        ? '没有找到可用的麦克风，可以改用「上传语音」。'
        : '当前环境无法录音。手机通过 http 访问时浏览器会限制麦克风，请改用「上传语音」。';
    $('audioHint').textContent = message;
    showToast(message, 'error');
    return;
  }

  let mimeType = '';
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (window.MediaRecorder.isTypeSupported?.(candidate)) {
      mimeType = candidate;
      break;
    }
  }

  try {
    state.recorder = new MediaRecorder(state.mediaStream, mimeType ? { mimeType } : undefined);
  } catch {
    state.recorder = new MediaRecorder(state.mediaStream);
  }
  state.audioChunks = [];
  state.recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) state.audioChunks.push(event.data);
  });
  state.recorder.addEventListener('stop', () => {
    const type = state.recorder?.mimeType || mimeType || 'audio/webm';
    const blob = new Blob(state.audioChunks, { type });
    const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const filename = `语音-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
    const file = new File([blob], filename, { type });
    if (file.size > 0) addFiles([file]);
    cleanupRecorderUi();
  });
  state.recorder.start();
  state.recordStartedAt = Date.now();
  $('recorderStrip').hidden = false;
  $('audioRecordBtn').classList.add('is-recording');
  $('audioRecordLabel').textContent = '停止录音';
  $('audioHint').textContent = '正在录音，再点一次「停止录音」就会保存到下方的附件里。';
  window.clearInterval(state.recordTimer);
  state.recordTimer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.recordStartedAt) / 1000);
    $('audioRecordTime').textContent = `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}`;
    if (elapsed >= 300) stopRecording();
  }, 250);
}

function stopRecording() {
  if (!state.recorder || state.recorder.state === 'inactive') return;
  try {
    state.recorder.stop();
  } catch {
    cleanupRecorderUi();
  }
}

function cleanupRecorderUi() {
  window.clearInterval(state.recordTimer);
  state.recordTimer = null;
  if (state.mediaStream) {
    for (const track of state.mediaStream.getTracks()) track.stop();
    state.mediaStream = null;
  }
  state.recorder = null;
  $('recorderStrip').hidden = true;
  $('audioRecordTime').textContent = '00:00';
  $('audioRecordBtn').classList.remove('is-recording');
  $('audioRecordLabel').textContent = '直接录音';
  $('audioHint').textContent = '直接录音需要浏览器麦克风权限；手机上如果无法录音，也可以点「上传语音」。';
}

function stopTracks() {
  if (state.mediaStream) {
    for (const track of state.mediaStream.getTracks()) track.stop();
    state.mediaStream = null;
  }
  if (state.recorder && state.recorder.state !== 'inactive') {
    try {
      state.recorder.stop();
    } catch {
      /* ignore */
    }
  }
  state.recorder = null;
  window.clearInterval(state.recordTimer);
}

/* ---------------- moods ---------------- */

function initMoodForm() {
  $('moodDate').value = TODAY;
  $('moodDate').max = TODAY;
  const todayMood = state.data.moods.find((mood) => mood.date === TODAY);
  if (todayMood) {
    state.moodChoice = todayMood.mood;
    $('moodNote').value = todayMood.note || '';
    renderMoodPicker($('moodChoices'), todayMood.mood, true);
  }
  state.initializedMoodForm = true;
}

function setupMoodForm() {
  $('moodDate').addEventListener('change', () => {
    const existing = state.data.moods.find((mood) => mood.date === $('moodDate').value);
    if (existing) {
      state.moodChoice = existing.mood;
      $('moodNote').value = existing.note || '';
      renderMoodPicker($('moodChoices'), existing.mood, true);
    } else {
      state.moodChoice = '';
      $('moodNote').value = '';
      renderMoodPicker($('moodChoices'), '', true);
    }
  });

  $('moodForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const date = $('moodDate').value;
    if (!date) return showToast('请选择日期', 'error');
    if (!state.moodChoice) return showToast('先选一种今天的心情吧', 'error');
    const button = $('moodSubmit');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      await api('/api/admin/moods', {
        method: 'POST',
        body: JSON.stringify({ date, mood: state.moodChoice, note: $('moodNote').value.trim() }),
      });
      await refreshData();
      showToast('心情已经记下啦');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = '保存心情';
    }
  });
}

function renderMoods() {
  const container = $('moodList');
  container.textContent = '';
  const moods = state.data?.moods || [];
  $('moodCount').textContent = String(moods.length);
  if (!moods.length) {
    const empty = el('div', 'managed-empty large');
    empty.appendChild(el('span', '', '☁️'));
    empty.appendChild(el('p', '', '心情本还是空白的'));
    empty.appendChild(el('small', '', '今天是什么天气？记下来吧。'));
    container.appendChild(empty);
    return;
  }

  moods.forEach((mood) => {
    const meta = moodOf(mood.mood);
    const row = el('div', 'mood-history-row');
    row.appendChild(el('span', 'mood-history-emoji', meta ? meta.emoji : '·'));
    const main = el('div', 'mood-history-main');
    const title = el('strong', '', meta ? meta.label : '心情');
    main.appendChild(title);
    main.appendChild(el('span', '', formatDateCN(mood.date)));
    if (mood.note) main.appendChild(el('p', '', mood.note));
    row.appendChild(main);
    const actions = el('div', 'mood-history-actions');
    const edit = el('button', 'mini-btn', '编辑');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      $('moodDate').value = mood.date;
      state.moodChoice = mood.mood;
      $('moodNote').value = mood.note || '';
      renderMoodPicker($('moodChoices'), mood.mood, true);
      $('moodDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => $('moodNote').focus(), 350);
    });
    const remove = el('button', 'mini-btn danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: '删除这一天的心情吗？',
        text: `${formatDateCN(mood.date)} 的心情记录会被移除。`,
      });
      if (!confirmed) return;
      try {
        await api(`/api/admin/moods/${mood.id}`, { method: 'DELETE' });
        await refreshData();
        showToast('心情记录已删除');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
    actions.append(edit, remove);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

/* ---------------- refresh ---------------- */

async function refreshData() {
  const data = await api('/api/admin/bootstrap');
  state.data = data;
  renderOverview();
  renderPhotos();
  renderRecords();
  renderMoods();
  $('passwordAlert').hidden = !data.passwordIsDefault;
  return data;
}

/* ---------------- confirm ---------------- */

function confirmAction({ title = '确认删除吗？', text = '删除后就找不回来了。', okText = '确认删除' } = {}) {
  const modal = $('confirmModal');
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmOk').textContent = okText;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('is-open'));
  $('confirmCancel').focus();
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  const modal = $('confirmModal');
  modal.classList.remove('is-open');
  window.setTimeout(() => { modal.hidden = true; }, 180);
  if (state.confirmResolver) {
    const resolve = state.confirmResolver;
    state.confirmResolver = null;
    resolve(result);
  }
}

function setupConfirm() {
  $('confirmCancel').addEventListener('click', () => closeConfirm(false));
  $('confirmOk').addEventListener('click', () => closeConfirm(true));
  $('confirmModal').addEventListener('click', (event) => {
    if (event.target === $('confirmModal')) closeConfirm(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('confirmModal').hidden) closeConfirm(false);
  });
}

/* ---------------- init ---------------- */

function setupCommon() {
  window.addEventListener('beforeunload', stopTracks);
  window.addEventListener('hashchange', () => {
    if (!state.data) return;
    const hash = window.location.hash.replace('#', '');
    if (hash === 'new-record') {
      resetComposer();
      go('records', { focusComposer: true });
    } else if (hash === 'mood') {
      go('moods');
    } else if (SECTIONS[hash] && hash !== state.section) {
      go(hash);
    }
  });
}

async function init() {
  $('loginScreen').hidden = false;
  setupLogin();
  setupLogout();
  setupNavigation();
  setupSettings();
  setupPhotoUpload();
  setupMoodPicker();
  setupRecordForm();
  setupRecorder();
  setupMoodForm();
  setupConfirm();
  setupCommon();
  $('todayDate').textContent = `${formatDateCN(TODAY)} · ${weekdayCN(TODAY)}`;

  try {
    const status = await fetch('/api/auth/status', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const data = await status.json().catch(() => ({}));
    if (data.authenticated) {
      try {
        await loadAdmin();
      } catch (error) {
        $('loginError').textContent = error.message || '后台数据加载失败，请刷新重试。';
        $('loginPassword').focus();
      }
    } else {
      $('loginPassword').focus();
    }
  } catch {
    $('loginError').textContent = '连接不上服务器，请确认网站已经启动。';
  }
}

init();
