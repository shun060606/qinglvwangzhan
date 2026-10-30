'use strict';

/* ================================================================
   安妤鱼 · public journal
   ================================================================ */

const MOODS = {
  happy: { emoji: '😄', label: '开心', hint: '像今天这样的好天气，要和你一起浪费。' },
  sweet: { emoji: '🥰', label: '甜蜜', hint: '心里像藏了一颗化开的糖。' },
  calm: { emoji: '😌', label: '平静', hint: '没有什么大事发生，你在就很好。' },
  miss: { emoji: '🌙', label: '想念', hint: '今晚的月亮，替我看了你一眼。' },
  tired: { emoji: '😪', label: '疲惫', hint: '累了就靠一会儿吧，我在。' },
  sad: { emoji: '😢', label: '难过', hint: '不用急着振作，我陪你待一会儿。' },
  angry: { emoji: '😠', label: '小情绪', hint: '就算生气，也还是想和你和好。' },
};

const state = {
  data: null,
  filter: 'all',
  visibleRecords: 8,
  visibleGallery: 9,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  selectedMoodDate: null,
  galleryItems: [],
  lightboxItems: [],
  lightboxIndex: 0,
  heroIndex: 0,
  heroTimer: null,
  lastFocus: null,
  revealObserver: null,
  moodMap: new Map(),
  statsAnimated: false,
};

const $ = (id) => document.getElementById(id);
const pad = (value) => String(value).padStart(2, '0');
const todayString = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function parseDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return new Date(NaN);
  return new Date(year, month - 1, day);
}

function formatDateDot(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function formatDateCN(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function weekdayCN(value) {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
}

function relativeDay(value) {
  const today = parseDate(todayString()).getTime();
  const target = parseDate(value).getTime();
  const diff = Math.round((today - target) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return weekdayCN(value);
}

function escapeSelector(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2-2 5 5', 'M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'],
    audio: ['M12 15V5', 'M8 12v-2', 'M16 14V8', 'M4 13v-2', 'M20 12v-2', 'M8 20h8'],
    video: ['M4 6h11v12H4z', 'M15 10l5-3v10l-5-3'],
    text: ['M5 6h14', 'M12 6v12', 'M8 18h8'],
    heart: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z'],
    play: ['M8 5v14l11-7z'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
    chevronLeft: ['M15 18l-6-6 6-6'],
    chevronRight: ['M9 6l6 6-6 6'],
  };
  const list = paths[name] || [];
  for (const d of list) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    if (name === 'heart' || name === 'play') {
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('stroke', 'none');
    } else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.4');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(path);
  }
  return svg;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('is-show'), 3200);
}

/* ---------------- data ---------------- */

async function loadSite() {
  const response = await fetch('/api/home', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取我们的故事');
  const data = await response.json();
  state.data = data;
  state.moodMap = new Map(data.moods.map((mood) => [mood.date, mood]));
  state.galleryItems = collectGallery(data);
  state.lightboxItems = state.galleryItems.slice();
  return data;
}

function collectGallery(data) {
  const items = [];
  const seen = new Set();
  for (const photo of data.photos.gallery || []) {
    if (!photo.url || seen.has(photo.url)) continue;
    seen.add(photo.url);
    items.push({
      url: photo.url,
      caption: photo.caption || '光影集',
      date: '',
      source: 'gallery',
    });
  }
  for (const record of data.records || []) {
    for (const media of record.media || []) {
      if (media.type !== 'image' || !media.url || seen.has(media.url)) continue;
      seen.add(media.url);
      items.push({
        url: media.url,
        caption: record.title || `${formatDateDot(record.date)} 的日常`,
        date: record.date,
        source: 'record',
      });
    }
  }
  return items;
}

function applySiteSettings(data) {
  const { site, stats } = data;
  document.title = `${site.siteTitle} · 我们的恋爱小屋`;
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', `${site.siteTitle} · ${site.heroSubtitle}`);

  const textIds = {
    brandName: site.siteTitle,
    heroTitle: site.siteTitle,
    heroEyebrow: site.heroEyebrow,
    partnerA: site.partnerA,
    partnerB: site.partnerB,
    heroSubtitle: site.heroSubtitle,
    heroQuote: site.heroQuote,
    signatureA: site.partnerA,
    signatureB: site.partnerB,
    footerTitle: site.siteTitle,
    footerNote: site.footerNote,
    closingNames: `${site.partnerA} & ${site.partnerB}`,
    footerNames: `${site.partnerA} & ${site.partnerB}`,
  };
  for (const [id, value] of Object.entries(textIds)) {
    const node = $(id);
    if (node) node.textContent = value || '';
  }

  const heroTitle = $('heroTitle');
  const titleLength = [...String(site.siteTitle || '')].length;
  heroTitle.classList.toggle('is-long', titleLength > 6);
  heroTitle.classList.toggle('is-very-long', titleLength > 10);

  $('startDateText').textContent = formatDateDot(site.startDate);
  $('heroSince').textContent = String(parseDate(site.startDate).getFullYear() || '');
  $('closingDate').textContent = `${parseDate(site.startDate).getFullYear() || ''} — FOREVER`;
  $('footerYear').textContent = String(new Date().getFullYear());
  $('menuDate').textContent = formatDateDot(todayString());
  $('statDays').dataset.count = String(stats.daysTogether);
  $('statRecords').dataset.count = String(stats.recordCount);
  $('statPhotos').dataset.count = String(stats.photoCount);

  const names = `${site.partnerA} & ${site.partnerB}`;
  document.querySelector('.hero-names').setAttribute('aria-label', names);
}

/* ---------------- love clock ---------------- */

let clockTimer = null;

function startLoveClock() {
  const startDate = state.data?.site?.startDate;
  if (!startDate) return;
  const start = parseDate(startDate);
  if (Number.isNaN(start.getTime())) return;

  const update = () => {
    const now = new Date();
    const raw = now.getTime() - start.getTime();
    const totalDays = Math.floor(raw / 86400000) + 1;
    const remainder = Math.max(0, raw % 86400000);
    const hours = Math.floor(remainder / 3600000);
    const minutes = Math.floor((remainder % 3600000) / 60000);
    const seconds = Math.floor((remainder % 60000) / 1000);
    $('loveDays').textContent = String(Math.max(1, totalDays));
    $('clockHours').textContent = pad(hours);
    $('clockMinutes').textContent = pad(minutes);
    $('clockSeconds').textContent = pad(seconds);

    if (!state.statsAnimated) {
      const statDays = $('statDays');
      const daysTarget = Math.max(1, totalDays);
      if (statDays.textContent === '0' || statDays.dataset.count === '0') statDays.dataset.count = String(daysTarget);
    }
  };

  update();
  window.clearInterval(clockTimer);
  clockTimer = window.setInterval(update, 1000);
}

/* ---------------- hero slideshow ---------------- */

function renderHero(photos) {
  const container = $('heroSlides');
  const dots = $('heroDots');
  container.textContent = '';
  dots.textContent = '';
  const slides = photos && photos.length ? photos : [{
    url: '/assets/hero-default.jpg',
    caption: '在后台换上属于你们的照片',
    isDefault: true,
  }];
  state.heroIndex = 0;

  slides.forEach((photo, index) => {
    const slide = el('div', `hero-slide${index === 0 ? ' is-active' : ''}`);
    slide.style.backgroundImage = `url("${String(photo.url).replace(/"/g, '%22')}")`;
    slide.setAttribute('role', 'img');
    slide.setAttribute('aria-label', photo.caption || `首页照片 ${index + 1}`);
    container.appendChild(slide);

    if (slides.length > 1) {
      const dot = el('button', index === 0 ? 'is-active' : '');
      dot.type = 'button';
      dot.setAttribute('aria-label', `查看第 ${index + 1} 张首页照片`);
      dot.addEventListener('click', () => {
        showHeroSlide(index);
        restartHeroTimer();
      });
      dots.appendChild(dot);
    }
  });

  $('heroCredit').textContent = slides[0].caption && !slides[0].isDefault ? `PHOTO · ${slides[0].caption}` : '';
  window.clearInterval(state.heroTimer);
  if (slides.length > 1) {
    state.heroTimer = window.setInterval(() => {
      if (!document.hidden) showHeroSlide((state.heroIndex + 1) % slides.length);
    }, 7000);
  }
}

function showHeroSlide(index) {
  const slides = Array.from(document.querySelectorAll('.hero-slide'));
  const dots = Array.from(document.querySelectorAll('#heroDots button'));
  if (!slides.length) return;
  state.heroIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, i) => slide.classList.toggle('is-active', i === state.heroIndex));
  dots.forEach((dot, i) => dot.classList.toggle('is-active', i === state.heroIndex));
  const photos = state.data?.photos?.hero || [];
  const photo = photos[state.heroIndex];
  $('heroCredit').textContent = photo && photo.caption && !photo.isDefault ? `PHOTO · ${photo.caption}` : '';
}

function restartHeroTimer() {
  const photos = state.data?.photos?.hero || [];
  window.clearInterval(state.heroTimer);
  if (photos.length > 1) {
    state.heroTimer = window.setInterval(() => {
      if (!document.hidden) showHeroSlide((state.heroIndex + 1) % photos.length);
    }, 7000);
  }
}

/* ---------------- records ---------------- */

function recordTypes(record) {
  const types = new Set();
  if (record.content || record.title) types.add('text');
  for (const media of record.media || []) types.add(media.type);
  return types;
}

function filteredRecords() {
  const records = state.data?.records || [];
  if (state.filter === 'all') return records;
  return records.filter((record) => {
    const types = recordTypes(record);
    if (state.filter === 'text') {
      return types.has('text') && !types.has('image') && !types.has('audio') && !types.has('video');
    }
    return types.has(state.filter);
  });
}

function renderTimeline() {
  const container = $('timeline');
  const loadMore = $('loadMore');
  const records = filteredRecords();
  container.textContent = '';
  loadMore.hidden = true;

  if (!records.length) {
    const empty = el('div', 'timeline-empty');
    empty.appendChild(el('span', 'empty-heart', '♡'));
    empty.appendChild(el('h3', '', state.data?.records?.length ? '这一种方式还没有记录' : '故事刚刚开始'));
    empty.appendChild(el('p', '', state.data?.records?.length
      ? '换一个分类看看，或者去后台写下新的这一刻。'
      : '去后台写下第一句话、放上第一张照片，或录下此刻的声音吧。'));
    const link = el('a', 'btn btn-outline', '去记录');
    link.href = '/admin#new-record';
    empty.appendChild(link);
    container.appendChild(empty);
    return;
  }

  const slice = records.slice(0, state.visibleRecords);
  slice.forEach((record, index) => {
    container.appendChild(buildTimelineItem(record, index));
  });

  if (records.length > slice.length) {
    loadMore.hidden = false;
    loadMore.textContent = `再看一些日子（还有 ${records.length - slice.length} 条）`;
  }
}

function buildTimelineItem(record) {
  const article = el('article', 'timeline-item reveal is-visible');
  const date = parseDate(record.date);
  const dateBox = el('div', 'timeline-date');
  dateBox.appendChild(el('span', 'date-day', Number.isNaN(date.getTime()) ? '—' : String(date.getDate()).padStart(2, '0')));
  dateBox.appendChild(el('span', 'date-month', Number.isNaN(date.getTime()) ? record.date : `${date.getFullYear()}.${pad(date.getMonth() + 1)}`));
  dateBox.appendChild(el('span', 'date-week', relativeDay(record.date)));
  dateBox.setAttribute('aria-label', formatDateCN(record.date));
  article.appendChild(dateBox);

  const card = el('div', 'timeline-card');

  const top = el('div', 'record-topline');
  if (record.mood && MOODS[record.mood]) {
    const mood = MOODS[record.mood];
    const pill = el('span', 'mood-pill');
    const emoji = el('span', '', mood.emoji);
    pill.append(emoji, document.createTextNode(mood.label));
    top.appendChild(pill);
  } else {
    top.appendChild(el('span'));
  }

  const kinds = el('div', 'record-kind');
  const types = recordTypes(record);
  if (types.has('text')) kinds.appendChild(icon('text'));
  if (types.has('image')) kinds.appendChild(icon('image'));
  if (types.has('audio')) kinds.appendChild(icon('audio'));
  if (types.has('video')) kinds.appendChild(icon('video'));
  top.appendChild(kinds);
  card.appendChild(top);

  if (record.title) card.appendChild(el('h3', 'record-title', record.title));
  if (record.content) card.appendChild(el('p', 'record-text', record.content));

  if (record.media && record.media.length) {
    card.appendChild(buildRecordMedia(record));
  }

  article.appendChild(card);
  return article;
}

function buildRecordMedia(record) {
  const grid = el('div', 'record-media');
  const media = record.media || [];
  grid.classList.add(`media-count-${Math.min(media.length, 3)}`);
  const images = media.filter((item) => item.type === 'image');

  images.forEach((item, index) => {
    const button = el('button', 'media-image');
    button.type = 'button';
    button.setAttribute('aria-label', `查看照片 ${record.title || formatDateCN(record.date)}`);
    const img = el('img');
    img.src = item.url;
    img.alt = record.title ? `${record.title} · 照片 ${index + 1}` : `${formatDateCN(record.date)} 的生活照片`;
    img.loading = 'lazy';
    img.decoding = 'async';
    button.appendChild(img);
    button.addEventListener('click', () => openLightbox(item.url));
    grid.appendChild(button);
  });

  for (const item of media.filter((entry) => entry.type === 'audio')) {
    const box = el('div', 'audio-box');
    const audioIcon = el('span', 'audio-icon');
    audioIcon.appendChild(icon('audio'));
    box.appendChild(audioIcon);
    const audio = el('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = item.url;
    audio.setAttribute('aria-label', item.originalName || '生活录音');
    box.appendChild(audio);
    grid.appendChild(box);
  }

  for (const item of media.filter((entry) => entry.type === 'video')) {
    const wrapper = el('div', 'record-video');
    const video = el('video');
    video.controls = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = item.url;
    video.setAttribute('aria-label', item.originalName || '生活视频');
    wrapper.appendChild(video);
    const meta = el('div', 'video-meta');
    meta.appendChild(el('p', 'video-label', item.originalName || '一段生活的画面'));
    const download = el('a', 'video-download', '下载视频');
    download.href = item.url;
    download.download = item.originalName || 'our-video';
    meta.appendChild(download);
    wrapper.appendChild(meta);
    grid.appendChild(wrapper);
  }

  return grid;
}

/* ---------------- moods ---------------- */

function renderMoods() {
  const moods = state.data?.moods || [];
  const today = state.moodMap.get(todayString());
  const todayEmoji = $('todayMoodEmoji');
  const todayTitle = $('todayMoodTitle');
  const todayNote = $('todayMoodNote');

  if (today && MOODS[today.mood]) {
    const mood = MOODS[today.mood];
    todayEmoji.textContent = mood.emoji;
    todayTitle.textContent = `今天是「${mood.label}」的一天`;
    todayNote.textContent = today.note || mood.hint;
  } else {
    todayEmoji.textContent = '☁️';
    todayTitle.textContent = '今天还没有记录';
    todayNote.textContent = '去写下今天的心情吧，晴天或雨天都值得被记住。';
  }

  $('moodCountLabel').textContent = `共 ${moods.length} 天`;

  const counts = {};
  for (const mood of moods) {
    if (!MOODS[mood.mood]) continue;
    counts[mood.mood] = (counts[mood.mood] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(counts));
  const bars = $('moodBars');
  bars.textContent = '';
  for (const [id, mood] of Object.entries(MOODS)) {
    const count = counts[id] || 0;
    const row = el('div', 'mood-bar');
    row.appendChild(el('span', '', mood.emoji));
    row.appendChild(el('span', '', mood.label));
    const track = el('span', 'mood-bar-track');
    const fill = el('span', 'mood-bar-fill');
    fill.style.width = `${Math.round((count / max) * 100)}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('em', '', String(count)));
    bars.appendChild(row);
  }

  renderCalendar();
}

function renderCalendar() {
  const grid = $('calendarGrid');
  const detail = $('calendarDetail');
  grid.textContent = '';
  const year = state.calendarYear;
  const month = state.calendarMonth;
  $('calendarTitle').textContent = `${year} 年 ${month + 1} 月`;

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const today = todayString();

  for (let i = 0; i < offset; i += 1) {
    const blank = el('span', 'calendar-day is-empty');
    blank.setAttribute('aria-hidden', 'true');
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateString = `${year}-${pad(month + 1)}-${pad(day)}`;
    const mood = state.moodMap.get(dateString);
    const button = el('button', 'calendar-day');
    button.type = 'button';
    button.dataset.date = dateString;
    if (mood && MOODS[mood.mood]) button.classList.add('has-mood');
    if (dateString === today) button.classList.add('is-today');
    if (dateString === state.selectedMoodDate) button.classList.add('is-selected');
    button.setAttribute('aria-label', `${formatDateCN(dateString)}${mood && MOODS[mood.mood] ? `，心情${MOODS[mood.mood].label}` : '，没有心情记录'}`);
    button.appendChild(el('span', 'day-num', String(day)));
    if (mood && MOODS[mood.mood]) button.appendChild(el('span', 'day-mood', MOODS[mood.mood].emoji));
    button.addEventListener('click', () => selectMoodDate(dateString));
    grid.appendChild(button);
  }

  updateCalendarDetail();
  updateCalendarButtons();
}

function selectMoodDate(dateString) {
  state.selectedMoodDate = dateString;
  document.querySelectorAll('.calendar-day').forEach((node) => {
    node.classList.toggle('is-selected', node.dataset.date === dateString);
  });
  updateCalendarDetail();
}

function updateCalendarDetail() {
  const detail = $('calendarDetail');
  const emoji = $('calendarDetailEmoji');
  const title = $('calendarDetailTitle');
  const text = $('calendarDetailText');
  const mood = state.selectedMoodDate ? state.moodMap.get(state.selectedMoodDate) : null;

  if (!state.selectedMoodDate) {
    emoji.textContent = '♡';
    title.textContent = '点一点有颜色的日子';
    text.textContent = '看看那天的心情和悄悄话。';
    return;
  }

  title.textContent = formatDateCN(state.selectedMoodDate);
  if (mood && MOODS[mood.mood]) {
    emoji.textContent = MOODS[mood.mood].emoji;
    text.textContent = mood.note || `那天的心情是「${MOODS[mood.mood].label}」。`;
  } else {
    emoji.textContent = '·';
    text.textContent = '这一天还没有心情记录。';
  }
}

function updateCalendarButtons() {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const viewMonth = new Date(state.calendarYear, state.calendarMonth, 1);
  const startDate = parseDate(state.data?.site?.startDate || todayString());
  const minMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  $('calendarNext').disabled = viewMonth >= currentMonth;
  $('calendarPrev').disabled = viewMonth <= minMonth;
  $('calendarNext').style.opacity = $('calendarNext').disabled ? '0.3' : '';
  $('calendarPrev').style.opacity = $('calendarPrev').disabled ? '0.3' : '';
}

function moveCalendar(delta) {
  const date = new Date(state.calendarYear, state.calendarMonth + delta, 1);
  state.calendarYear = date.getFullYear();
  state.calendarMonth = date.getMonth();
  state.selectedMoodDate = null;
  renderCalendar();
}

/* ---------------- gallery ---------------- */

function renderGallery() {
  const wall = $('galleryWall');
  const oldMore = document.querySelector('.gallery-more');
  if (oldMore) oldMore.remove();
  wall.textContent = '';
  const items = state.galleryItems;
  if (!items.length) {
    const empty = el('div', 'gallery-empty');
    empty.appendChild(el('p', '', '还没有收藏照片'));
    empty.appendChild(el('span', '', '去后台的「首页照片」里，放进你们喜欢的光影吧。'));
    wall.appendChild(empty);
    return;
  }

  const slice = items.slice(0, state.visibleGallery);
  slice.forEach((item, index) => {
    const button = el('button', 'gallery-item');
    button.type = 'button';
    button.setAttribute('aria-label', `查看照片：${item.caption}`);
    const img = el('img');
    img.src = item.url;
    img.alt = item.caption || '我们的照片';
    img.loading = 'lazy';
    img.decoding = 'async';
    button.appendChild(img);
    if (item.caption) button.appendChild(el('span', 'gallery-caption', item.caption));
    button.addEventListener('click', () => openLightbox(item.url));
    wall.appendChild(button);
  });

  if (items.length > slice.length) {
    const more = el('div', 'gallery-more');
    const button = el('button', '', `展开更多照片（${items.length - slice.length}）`);
    button.type = 'button';
    button.addEventListener('click', () => {
      state.visibleGallery += 6;
      renderGallery();
    });
    more.appendChild(button);
    wall.after(more);
  }
}

/* ---------------- lightbox ---------------- */

function openLightbox(url) {
  if (!url) return;
  const items = state.galleryItems.length ? state.galleryItems : state.lightboxItems;
  const index = items.findIndex((item) => item.url === url);
  state.lightboxItems = items;
  state.lightboxIndex = index >= 0 ? index : 0;
  state.lastFocus = document.activeElement;
  renderLightbox();
  const box = $('lightbox');
  box.classList.add('is-open');
  box.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lightbox-open');
  $('lightboxClose').focus();
}

function renderLightbox() {
  const items = state.lightboxItems;
  const item = items[state.lightboxIndex];
  if (!item) return;
  const img = $('lightboxImage');
  img.src = item.url;
  img.alt = item.caption || '照片';
  $('lightboxCaption').textContent = item.caption || '';
  const hasMultiple = items.length > 1;
  $('lightboxPrev').hidden = !hasMultiple;
  $('lightboxNext').hidden = !hasMultiple;
}

function moveLightbox(delta) {
  if (state.lightboxItems.length < 2) return;
  state.lightboxIndex = (state.lightboxIndex + delta + state.lightboxItems.length) % state.lightboxItems.length;
  renderLightbox();
}

function closeLightbox() {
  const box = $('lightbox');
  if (!box.classList.contains('is-open')) return;
  box.classList.remove('is-open');
  box.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('lightbox-open');
  if (state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus();
}

/* ---------------- stats ---------------- */

function animateNumber(node, target, duration = 1200) {
  const start = performance.now();
  const from = 0;
  const to = Math.max(0, Number(target) || 0);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = String(to);
    return;
  }
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = String(Math.round(from + (to - from) * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupStats() {
  if (state.statsAnimated) return;
  const nodes = Array.from(document.querySelectorAll('[data-count]'));
  if (!nodes.length) return;
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    if (!visible) return;
    state.statsAnimated = true;
    observer.disconnect();
    for (const node of nodes) animateNumber(node, node.dataset.count || 0);
  }, { threshold: 0.4 });
  const section = document.querySelector('.story-stats');
  if (section) observer.observe(section);
}

/* ---------------- reveal / nav ---------------- */

function setupReveal() {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach((node) => node.classList.add('is-visible'));
    return;
  }
  state.revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      state.revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.1, rootMargin: '0px 0px -7% 0px' });
  document.querySelectorAll('.reveal:not(.is-visible)').forEach((node) => state.revealObserver.observe(node));
}

function setupHeader() {
  const header = $('siteHeader');
  const backTop = $('backTop');
  const update = () => {
    const scrolled = window.scrollY > 60;
    header.classList.toggle('is-scrolled', scrolled);
    backTop.classList.toggle('is-visible', window.scrollY > 720);
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  const navLinks = Array.from(document.querySelectorAll('.desktop-nav a'));
  const sections = ['home', 'story', 'moods', 'moments', 'gallery']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
      }
    }, { rootMargin: '-42% 0px -50% 0px', threshold: 0 });
    sections.forEach((section) => observer.observe(section));
  }
}

function setupMobileMenu() {
  const toggle = $('menuToggle');
  const menu = $('mobileMenu');
  const open = () => {
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
    const first = menu.querySelector('a');
    if (first) window.setTimeout(() => first.focus(), 150);
  };
  const close = () => {
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  };
  toggle.addEventListener('click', () => {
    if (menu.classList.contains('is-open')) close();
    else open();
  });
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) close();
  });
}

/* ---------------- events ---------------- */

function setupEvents() {
  $('recordFilters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    state.visibleRecords = 8;
    document.querySelectorAll('#recordFilters button').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
    });
    renderTimeline();
  });

  $('loadMore').addEventListener('click', () => {
    state.visibleRecords += 8;
    renderTimeline();
    const items = document.querySelectorAll('.timeline-item');
    const last = items[items.length - 1];
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('calendarPrev').addEventListener('click', () => {
    if (!$('calendarPrev').disabled) moveCalendar(-1);
  });
  $('calendarNext').addEventListener('click', () => {
    if (!$('calendarNext').disabled) moveCalendar(1);
  });

  $('lightboxClose').addEventListener('click', closeLightbox);
  $('lightboxPrev').addEventListener('click', () => moveLightbox(-1));
  $('lightboxNext').addEventListener('click', () => moveLightbox(1));
  $('lightbox').addEventListener('click', (event) => {
    if (event.target === $('lightbox') || event.target.tagName === 'FIGURE') closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (!$('lightbox').classList.contains('is-open')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') moveLightbox(-1);
    if (event.key === 'ArrowRight') moveLightbox(1);
  });

  let touchStartX = null;
  $('lightbox').addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
  }, { passive: true });
  $('lightbox').addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX;
    const diff = endX - touchStartX;
    if (Math.abs(diff) > 48) moveLightbox(diff > 0 ? -1 : 1);
    touchStartX = null;
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restartHeroTimer();
  });
}

/* ---------------- init ---------------- */

async function init() {
  setupHeader();
  setupMobileMenu();
  setupReveal();

  const loaderStarted = performance.now();
  try {
    const data = await loadSite();
    applySiteSettings(data);
    renderHero(data.photos.hero);
    renderMoods();
    renderTimeline();
    renderGallery();
    startLoveClock();
    setupStats();
    setupEvents();
    setupReveal();
  } catch (error) {
    console.error(error);
    const timeline = $('timeline');
    timeline.textContent = '';
    const empty = el('div', 'timeline-empty');
    empty.appendChild(el('span', 'empty-heart', '♡'));
    empty.appendChild(el('h3', '', '故事暂时没有连上'));
    empty.appendChild(el('p', '', '请确认网站服务已经启动，然后刷新这一页。'));
    const retry = el('button', 'btn btn-outline', '重新加载');
    retry.type = 'button';
    retry.addEventListener('click', () => window.location.reload());
    empty.appendChild(retry);
    timeline.appendChild(empty);
    showToast('加载失败，请刷新重试');
  } finally {
    const elapsed = performance.now() - loaderStarted;
    window.setTimeout(() => {
      $('pageLoader').classList.add('is-done');
      document.body.classList.add('is-ready');
    }, Math.max(0, 650 - elapsed));
  }
}

init();
