/* Riwaq: a local-first Arabic Markdown reader. No account or API keys needed. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arabicNumber = value => new Intl.NumberFormat('ar-u-nu-arab', {maximumFractionDigits:0}).format(value);
const normalize = value => value.normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase();
const paths = {
  book:'<path d="M12 5c-3-2-7-2-10-1v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 1Z"/><path d="M12 5v16"/>',
  library:'<path d="M4 4v16M8 4v16M3 7h6M3 17h6M13 4l-2 1 5 15 5-2-5-15-3 1ZM13 8l5-2m-3 10 5-2"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  note:'<path d="M12 4H4v16h16v-8M11 13l1-4 8-8 3 3-8 8-4 1Z"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  left:'<path d="m14 6-6 6 6 6M8 12h13"/>',
  right:'<path d="m10 6 6 6-6 6M16 12H3"/>',
  chevron:'<path d="m14 7-5 5 5 5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  leaf:'<path d="M19 3C8 2 3 6 4 13c1 6 8 7 12 3 3-3 3-8 3-13Z"/><path d="M4 21 15 9"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface,#fff)"/><circle cx="16" cy="17" r="3" fill="var(--surface,#fff)"/>',
  moon:'<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  heart:'<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 0 9 8 15 8-6 12-11 8-15Z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.book}</svg>`;
const iconButton = (name, label, action, extra = '') => `<button class="icon-button ${extra}" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const brand = () => `<div class="brand"><span class="brand-mark">${icon('book')}</span><div><span class="brand-name">رِواق</span></div></div>`;

const defaults = {favorites:[], positions:{}, bookmarks:[], notes:[], lastBook:null, settings:{theme:'paper',font:'amiri',size:25,line:2.15,width:740,goal:15}, reading:{}, dark:false};
let state;
try {
  const saved = JSON.parse(localStorage.getItem('riwaq-state') || '{}');
  state = {...defaults, ...saved, settings:{...defaults.settings,...saved.settings}};
  for (const key of ['favorites','bookmarks','notes']) if (!Array.isArray(state[key])) state[key] = [];
  for (const key of ['positions','reading']) if (!state[key] || typeof state[key] !== 'object') state[key] = {};
  if (!['paper','white','night'].includes(state.settings.theme)) state.settings.theme = 'paper';
  state.settings.size = Math.max(20, Math.min(34, Number(state.settings.size) || 25));
  state.settings.goal = Math.max(5, Math.min(60, Number(state.settings.goal) || 15));
} catch { state = structuredClone(defaults); }
let catalog = [], imported = [], books = [], db, currentBook = null, currentMarkdown = '', currentChapters = [], currentChapter = 0;
let view = 'library', category = 'الكل', query = '', listView = false, toastTimer, searchTimer, saveTimer;
let focusMode = false, readerPosition = 0, selectedQuote = '', lastActivity = Date.now(), lastReadingTick = Date.now();
let currentAnchors = [], lastKnownAnchor = null;
const MAX_IMPORTED_BOOK_BYTES = 50 * 1024 * 1024;
const markdownCache = new Map();
let storageWarning = false;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 3200);
}
function saveState() {
  try {localStorage.setItem('riwaq-state', JSON.stringify(state));}
  catch {if (!storageWarning) {toast('تعذّر حفظ البيانات. تأكد من إتاحة التخزين في متصفحك.'); storageWarning = true;}}
}
function today() {return new Date().toLocaleDateString('en-CA');}
function readMinutes() {return Math.floor((state.reading[today()] || 0) / 60);}
function personalBooks() {return books.filter(book => state.favorites.includes(book.id) || state.positions[book.id] || book.imported);}
function findBook(id) {return books.find(book => book.id === id);}

async function openDatabase() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('riwaq-books', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('books', {keyPath:'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbOperation(method, value) {
  if (!db) throw new Error('Storage unavailable');
  return new Promise((resolve,reject) => {
    const transaction = db.transaction('books', method === 'getAll' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('books');
    const request = value === undefined ? store[method]() : store[method](value);
    let result;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted'));
  });
}

function coverArt(book) {
  if (book.id === 'kalila') return `<svg class="cover-art" viewBox="0 0 120 100" fill="none" aria-hidden="true"><path d="M18 80V43a42 42 0 0 1 84 0v37" stroke="currentColor" opacity=".45"/><path d="M60 81V40m0 23C40 63 30 48 34 36c17 1 26 12 26 27Zm0-10c20 0 30-15 26-27-17 1-26 12-26 27Z" stroke="currentColor" stroke-width="1.2"/><path d="M21 69c6-15 21-17 30-7-2 11-8 14-16 10l-8 9 1-12-7 0Zm78 0c-6-15-21-17-30-7 2 11 8 14 16 10l8 9-1-12 7 0Z" fill="currentColor" opacity=".85"/><circle cx="33" cy="63" r="1.5" fill="#275449"/><circle cx="87" cy="63" r="1.5" fill="#275449"/><path d="M12 85h96m-91 5h86" stroke="currentColor" opacity=".6"/><path d="m60 12 3 5-3 5-3-5 3-5Z" fill="currentColor"/></svg>`;
  if (book.id === 'hayy') return `<svg class="cover-art" viewBox="0 0 120 100" fill="none" aria-hidden="true"><circle cx="60" cy="43" r="30" stroke="currentColor"/><circle cx="60" cy="43" r="24" stroke="currentColor" opacity=".3"/><path d="M8 79c24-18 63-18 104 0M9 86c36-9 69-10 101 0" stroke="currentColor"/><path d="M70 75 65 39M65 39c-13-20-31-11-36-6 13-1 24 1 36 6Zm0 0c10-23 29-19 37-15-16 4-26 7-37 15Zm0 0c-20-11-33 0-34 8 11-6 23-8 34-8Zm0 0c18-11 32 2 33 9-13-7-23-10-33-9ZM65 39c-2-16-13-22-18-21 6 6 12 13 18 21Z" fill="currentColor" opacity=".85"/><path d="M41 9h38m-30-5h22" stroke="currentColor" opacity=".5"/></svg>`;
  if (book.id === 'munqidh') return `<svg class="cover-art" viewBox="0 0 120 100" fill="none" aria-hidden="true"><path d="M16 92V40a44 44 0 0 1 88 0v52H16Z" stroke="currentColor"/><path d="M26 92V42a34 34 0 0 1 68 0v50M37 92V44a23 23 0 0 1 46 0v48M48 92V46a12 12 0 0 1 24 0v46" stroke="currentColor" opacity=".7"/><path d="M9 92h102M60 10v72" stroke="currentColor" opacity=".3"/><path d="m60 22 4 6-4 6-4-6 4-6Z" fill="currentColor"/></svg>`;
  return `<svg class="cover-art" viewBox="0 0 120 100" fill="none" aria-hidden="true"><path d="M22 86V42a38 38 0 0 1 76 0v44H22Z" stroke="currentColor" opacity=".5"/><path d="M60 82V22m0 19C40 41 33 29 33 23c15 0 27 6 27 18Zm0 16c20 0 27-12 27-18-15 0-27 6-27 18Zm0 16C40 73 33 61 33 55c15 0 27 6 27 18Zm0-37c13-5 14-18 10-24-10 7-13 15-10 24Z" stroke="currentColor"/><path d="M38 90h44M44 95h32" stroke="currentColor" opacity=".6"/></svg>`;
}
function cover(book, extra = '') {
  return `<div class="book-cover ${escapeHtml(book.color || 'forest')} ${book.imported ? 'imported' : ''} ${extra}" aria-hidden="true"><span class="cover-kicker">${book.imported ? 'من مكتبتك' : 'من عيون التراث'}</span><span class="cover-title ${book.id !== 'kalila' && book.title.length > 10 ? 'long' : ''}">${escapeHtml(book.title)}</span>${coverArt(book)}<span class="cover-author">${escapeHtml(book.author)}</span></div>`;
}
function sidebar() {
  const items = [['library','library','المكتبة'],['my','book','مكتبتي'],['bookmarks','bookmark','علامات القراءة'],['notes','note','اقتباساتي وملاحظاتي']];
  const minutes = readMinutes(), goal = state.settings.goal;
  return `<aside class="sidebar" aria-label="القائمة الرئيسية">${brand()}<span class="brand-caption" style="text-align:center;margin-top:-34px;margin-bottom:43px">مساحة للقراءة، ومتّسع للفكر</span><p class="nav-label">مساحتك الخاصة</p><nav class="nav-items">${items.map(([id,image,label]) => `<button class="nav-item ${view === id ? 'active' : ''}" data-action="nav" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${icon(image)}<span>${label}</span>${id === 'my' && personalBooks().length ? `<span class="nav-count">${arabicNumber(personalBooks().length)}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-separator"></div><button class="nav-item" data-action="settings">${icon('settings')}<span>تفضيلات القراءة</span></button><div class="goal-card"><div class="goal-top">${icon('leaf')}<span>قليلٌ كل يوم، كثيرٌ مع الوقت</span></div><p>امنح نفسك لحظة هادئة.<br>هدفك اليومي ${arabicNumber(goal)} دقيقة من القراءة.</p><div class="goal-numbers"><span>قراءة اليوم</span><span class="goal-value">${arabicNumber(minutes)} / ${arabicNumber(goal)} دقيقة</span></div><div class="progress-track"><span class="goal-progress" style="width:${Math.min(100,minutes / goal * 100)}%"></span></div></div><div class="sidebar-foot"><div class="avatar">ق</div><div><strong>قارئ رِواق</strong><small>مكتبتك، على جهازك</small></div>${iconButton('settings','تفضيلات القراءة','settings')}</div></aside>`;
}
const labels = {library:['المكتبة','حكايات وأفكار تستحق أن تُقرأ.'],my:['مكتبتي','كتبك المحفوظة، وكل ما بدأت قراءته.'],bookmarks:['علامات القراءة','لأن بعض الصفحات تستحق العودة إليها.'],notes:['اقتباساتي وملاحظاتي','كلمات بقيت معك، وأفكار ولدت بين السطور.']};

function renderLibrary() {
  currentBook = null;
  currentAnchors = [];lastKnownAnchor = null;
  document.body.classList.toggle('app-night', state.dark);
  const [title, subtitle] = labels[view];
  document.title = `${title} — رِواق`;
  $('#app').innerHTML = `${sidebar()}<button class="mobile-backdrop" data-action="close-sidebar" aria-label="إغلاق القائمة"></button><div class="shell"><header class="topbar">${iconButton('menu','فتح القائمة','menu','mobile-menu')}<div class="breadcrumb"><span>رِواق</span>${icon('chevron')}<strong>${title}</strong></div><div class="topbar-tools"><label class="search-box">${icon('search')}<input id="library-search" type="search" placeholder="ابحث عن كتاب أو مؤلف…" aria-label="ابحث عن كتاب أو مؤلف" value="${escapeHtml(query)}"><kbd>⌘ K</kbd></label>${iconButton(state.dark ? 'sun' : 'moon',state.dark ? 'المظهر الفاتح' : 'المظهر الداكن','dark')}</div></header><main class="content" id="main-content"><div class="page-heading"><div><h1>${view === 'library' ? 'أهلًا بك في رِواق' : title}</h1><p>${subtitle}</p></div>${view === 'library' || view === 'my' ? `<button class="secondary-button" data-action="import">${icon('plus')}<span>أضف كتابك</span></button>` : ''}</div>${view === 'library' ? hero() + featured() : ''}${view === 'library' || view === 'my' ? `<section id="shelf"><div class="section-title"><h2>${view === 'library' ? 'مختارات من المكتبة' : 'كتبك، في مكان واحد'}</h2><span id="book-count"></span></div><div class="filter-bar">${['الكل','أدب','فلسفة','فكر'].map(label => `<button class="filter-button ${category === label ? 'active' : ''}" data-action="filter" data-category="${label}" aria-pressed="${category === label}">${label}</button>`).join('')}<div class="view-switch" aria-label="طريقة عرض الكتب"><button data-action="grid" class="${!listView ? 'active' : ''}" aria-label="عرض شبكي" aria-pressed="${!listView}">${icon('grid')}</button><button data-action="list" class="${listView ? 'active' : ''}" aria-label="عرض قائمة" aria-pressed="${listView}">${icon('list')}</button></div></div><div id="book-grid" class="book-grid ${listView ? 'list-view' : ''}"></div></section>` : `<div id="annotations" class="annotation-list"></div>`}${view === 'library' ? `<div class="quote-banner"><span class="quote-mark">”</span><p>بالأدب تعمرُ القلوبُ، وبالعلمِ تستحكمُ الأحلامُ.</p><small>عبد الله بن المقفع · الأدب الصغير</small></div>` : ''}<footer class="library-footer"><span>${icon('book')}رِواق · صُمم للقراءة، لا للتشتت</span><span>كتب عربية. تجربة هادئة. بلا إعلانات.</span><span>${icon('leaf')}بعض الوقت لك</span></footer></main></div>`;
  if (view === 'library' || view === 'my') renderShelf(); else renderAnnotations();
}
function hero() {
  return `<section class="hero" aria-label="مرحبًا بك في رواق"><div class="hero-copy"><div class="eyebrow">${icon('spark')}مساحة صغيرة، لعوالم واسعة</div><h2>لكل كتاب عالم.<br><span>ولك هنا مكان.</span></h2><p>ابتعد قليلًا عن صخب اليوم، واقترب من كتاب.<br>قراءة عربية، كما ينبغي أن تكون.</p><button class="hero-link" data-action="explore">اكتشف مكتبتك${icon('left')}</button></div><img class="hero-art" src="assets/reading-room.svg" alt="رسم كتب ونبتة بألوان هادئة"><span class="hero-small-note">${icon('leaf')}على مهل، وعلى مزاجك</span></section>`;
}
function featured() {
  const book = findBook(state.lastBook) || books[0];
  if (!book) return '';
  const progress = Math.round((state.positions[book.id]?.ratio || 0) * 100);
  return `<section aria-label="${state.lastBook ? 'تابع القراءة' : 'كتاب البداية'}"><div class="section-title"><h2>${icon(state.lastBook ? 'book' : 'spark')}${state.lastBook ? 'بينك وبين الكتاب، سطر جديد' : 'رحلتك تبدأ من هنا'}</h2><span>${state.lastBook ? 'عد إلى عالمك' : 'اختيار رِواق'}</span></div><div class="featured"><div class="featured-cover">${cover(book)}</div><div class="featured-info"><div class="tiny-label">${icon('spark')}${state.lastBook ? 'نكمل من حيث توقفت' : 'كتاب يستحق وقتك'}</div><h3>${escapeHtml(book.title)}</h3><p class="featured-author">${escapeHtml(book.author)}</p>${state.lastBook ? `<div class="featured-progress"><span>قرأت ${arabicNumber(progress)}٪</span><div class="progress-track"><span style="width:${progress}%"></span></div></div>` : `<p class="featured-description">${escapeHtml(book.subtitle)}</p>`}</div><div class="featured-action"><button class="primary-button" data-action="read" data-id="${escapeHtml(book.id)}">${state.lastBook ? 'متابعة القراءة' : 'ابدأ القراءة'}${icon('left')}</button>${iconButton('info','عن الكتاب','featured-info')}</div></div></section>`;
}
function bookCard(book, index) {
  const saved = state.favorites.includes(book.id);
  return `<article class="book-card" style="animation-delay:${index * 45}ms"><div class="book-stage ${escapeHtml(book.color)}" role="button" tabindex="0" data-action="details" data-id="${escapeHtml(book.id)}" aria-label="عن كتاب ${escapeHtml(book.title)}">${cover(book)}</div><button class="save-book ${saved ? 'saved' : ''}" data-action="save-book" data-id="${escapeHtml(book.id)}" aria-label="${saved ? 'إزالة من' : 'إضافة إلى'} مكتبتي: ${escapeHtml(book.title)}" aria-pressed="${saved}" title="${saved ? 'إزالة من مكتبتي' : 'إضافة إلى مكتبتي'}">${icon('bookmark')}</button><div class="book-meta"><button class="book-title" data-action="details" data-id="${escapeHtml(book.id)}">${escapeHtml(book.title)}</button><p class="book-author">${escapeHtml(book.author)}</p><div class="book-bottom"><span class="category-badge">${escapeHtml(book.category)}</span><span class="reading-time">${icon('clock')}${arabicNumber(book.minutes)} دقيقة قراءة</span></div></div></article>`;
}
function renderShelf() {
  let selected = view === 'my' ? personalBooks() : books;
  selected = selected.filter(book => (category === 'الكل' || book.category === category) && normalize(`${book.title} ${book.author}`).includes(normalize(query)));
  $('#book-count').textContent = `${arabicNumber(selected.length)} كتب · بصيغة Markdown`;
  $('#book-grid').className = `book-grid ${listView ? 'list-view' : ''}`;
  $('#book-grid').innerHTML = selected.length ? selected.map(bookCard).join('') : `<div class="empty-state">${icon(query ? 'search' : 'book')}<h2>${query || category !== 'الكل' ? 'لم نجد كتابًا بهذه المواصفات' : 'مكتبتك تنتظر أول كتاب'}</h2><p>${query || category !== 'الكل' ? 'جرّب اسمًا آخر، أو تصفّح جميع الكتب.' : 'احفظ كتابًا من المكتبة، أو أضف ملف Markdown من جهازك.'}</p><button class="secondary-button" data-action="reset-filters">${query || category !== 'الكل' ? 'عرض جميع الكتب' : 'اكتشف المكتبة'}${icon('left')}</button></div>`;
}
function renderAnnotations() {
  const notesView = view === 'notes';
  const entries = (notesView ? state.notes : state.bookmarks).filter(entry => findBook(entry.bookId)).filter(entry => {
    const book = findBook(entry.bookId);
    return normalize(`${book.title} ${book.author} ${entry.quote || ''} ${entry.text || ''} ${entry.chapter}`).includes(normalize(query));
  }).slice().reverse();
  $('#annotations').innerHTML = entries.length ? entries.map(entry => {
    const book = findBook(entry.bookId);
    return `<article class="annotation-card">${icon(notesView ? 'note' : 'bookmark')}<div class="annotation-body"><h3>${escapeHtml(book.title)}</h3><small>${escapeHtml(entry.chapter || 'بداية الكتاب')} · ${arabicNumber(Math.round(entry.ratio * 100))}٪</small>${notesView ? `<blockquote>${escapeHtml(entry.quote)}</blockquote>${entry.text ? `<p>${escapeHtml(entry.text)}</p>` : ''}` : ''}<button class="text-link" data-action="annotation-open" data-id="${escapeHtml(entry.id)}">العودة إلى هذا الموضع${icon('left')}</button></div><button class="delete-button" data-action="annotation-delete" data-id="${escapeHtml(entry.id)}" aria-label="حذف ${notesView ? 'الاقتباس' : 'العلامة'}">${icon('trash')}</button></article>`;
  }).join('') : `<div class="empty-state">${icon(notesView ? 'note' : 'bookmark')}<h2>${query ? 'لا توجد نتائج' : notesView ? 'احتفظ بالكلمات التي تعني لك' : 'اترك لنفسك علامة'}</h2><p>${query ? 'جرّب البحث بكلمات مختلفة.' : notesView ? 'حدّد نصًا أثناء القراءة، ثم احفظه مع ملاحظتك.' : 'اضغط أيقونة العلامة داخل القارئ لتحفظ موضعًا وتعود إليه لاحقًا.'}</p><button class="secondary-button" data-action="nav" data-view="library">اذهب إلى المكتبة${icon('left')}</button></div>`;
}
function setView(newView) {
  if (!labels[newView]) return;
  if (currentBook) savePosition();
  ++loadSequence;
  view = newView; category = 'الكل'; query = ''; focusMode = false;
  document.body.classList.remove('sidebar-open');
  history.pushState(null,'',location.pathname);
  renderLibrary();window.scrollTo(0,0);
}

function openModal(title, body) {
  const dialog = $('#modal');
  dialog.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2>${iconButton('close','إغلاق','close-modal')}</div><div class="modal-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}
function showDetails(id) {
  const book = findBook(id); if (!book) return;
  openModal('بين دفّتي الكتاب', `<div class="detail-hero">${cover(book)}<div><span class="category-badge">${escapeHtml(book.category)}</span><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author)}</p><span class="reading-time">${icon('clock')}${arabicNumber(book.minutes)} دقيقة · ${arabicNumber(book.words)} كلمة</span></div></div><p class="detail-description">${escapeHtml(book.description)}</p><div class="detail-actions"><button class="primary-button" data-action="read" data-id="${escapeHtml(id)}">${state.positions[id] ? 'متابعة القراءة' : 'ابدأ القراءة'}${icon('left')}</button><button class="secondary-button" data-action="download" data-id="${escapeHtml(id)}">${icon('download')}تحميل Markdown</button>${book.imported ? `<button class="secondary-button" data-action="delete-import" data-id="${escapeHtml(id)}">${icon('trash')}حذف الكتاب</button>` : ''}</div><div class="source-note">${book.imported ? 'ملفك الخاص، محفوظ محليًا على هذا المتصفح. لا نرفعه إلى أي خادم.' : `نص عربي من <a href="${escapeHtml(book.source)}" target="_blank" rel="noopener noreferrer">ويكي مصدر</a>، أُعيد تنسيقه للقراءة بصيغة Markdown.<br>نسخة النص وفق ترخيص <a href="${escapeHtml(book.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(book.license)}</a>. ${escapeHtml(book.editionNote)}`}</div>`);
}
async function markdownFor(book) {
  if (markdownCache.has(book.id)) return markdownCache.get(book.id);
  const text = book.imported ? book.markdown : await fetch(book.file).then(response => {if (!response.ok) throw new Error('Book unavailable');return response.text();});
  markdownCache.set(book.id,text); return text;
}
async function downloadBook(id) {
  const book = findBook(id); if (!book) return;
  try {
    const markdown = await markdownFor(book);
    const attribution = book.imported ? '' : `\n\n---\n\nالمصدر: ${book.source}\n\nالترخيص: ${book.license} (${book.licenseUrl})\n\nإعادة تنسيق Markdown: رِواق. ${book.editionNote}\n`;
    const url = URL.createObjectURL(new Blob([markdown + attribution],{type:'text/markdown;charset=utf-8'}));
    const link = document.createElement('a'); link.href=url; link.download=`${book.title}.md`;link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    toast('كتابك جاهز، بصيغة Markdown.');
  } catch {toast('تعذّر تحميل الكتاب. جرّب مرة أخرى.');}
}
function captureAnchor() {
  const scroller = $('.reader-scroll');
  if (!scroller || !currentAnchors.length) return null;
  const top = scroller.getBoundingClientRect().top;
  const index = currentAnchors.findIndex(node => node.getBoundingClientRect().bottom > top + 1);
  if (index < 0) return null;
  const rect = currentAnchors[index].getBoundingClientRect();
  return {index,fraction:Math.max(0,(top - rect.top) / Math.max(1,rect.height)),lead:Math.max(0,rect.top - top)};
}
function restoreAnchor(anchor) {
  const scroller = $('.reader-scroll');
  const node = currentAnchors[anchor?.index];
  if (!scroller || !node || !Number.isFinite(anchor.fraction)) return false;
  const rect = node.getBoundingClientRect();
  scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top + anchor.fraction * rect.height - (anchor.lead || 0);
  return true;
}
function applyReadingSettings(preservePosition = true) {
  const anchor = currentBook && preservePosition ? captureAnchor() : null;
  const root = document.documentElement;
  const settings = state.settings;
  root.style.setProperty('--reader-size', `${settings.size}px`);
  root.style.setProperty('--reader-line', Number(settings.line) || 2.15);
  root.style.setProperty('--reader-width', `${Number(settings.width) || 740}px`);
  root.style.setProperty('--reader-font', settings.font === 'noto' ? '"Noto Arabic", sans-serif' : 'Amiri, serif');
  const shell = $('.reader-shell');
  if (shell) {shell.classList.remove('theme-night','theme-paper','theme-white');shell.classList.add(`theme-${settings.theme}`);}
  if (anchor) requestAnimationFrame(() => {if (currentBook) {restoreAnchor(anchor);onReaderScroll();}});
}
function showSettings() {
  const settings = state.settings;
  openModal('القراءة، على مزاجك', `<div class="settings-group"><label>لون الصفحة</label><div class="segmented">${[['white','أبيض','#fff'],['paper','ورقي','#f9f5eb'],['night','ليلي','#222b27']].map(([id,label,color]) => `<button data-action="setting" data-key="theme" data-value="${id}" class="${settings.theme === id ? 'selected' : ''}" aria-pressed="${settings.theme === id}"><span class="theme-swatch" style="background:${color}"></span>${label}</button>`).join('')}</div></div><div class="settings-group"><label>الخط العربي</label><div class="segmented"><button data-action="setting" data-key="font" data-value="amiri" class="${settings.font === 'amiri' ? 'selected' : ''}" style="font-family:Amiri;font-size:20px" aria-pressed="${settings.font === 'amiri'}">الأميري</button><button data-action="setting" data-key="font" data-value="noto" class="${settings.font === 'noto' ? 'selected' : ''}" aria-pressed="${settings.font === 'noto'}">نوتو نسخ عربي</button></div></div><div class="settings-group"><label>حجم الخط</label><div class="font-controls"><button class="icon-button" data-action="font-size" data-delta="2" aria-label="تكبير الخط" ${settings.size >= 34 ? 'disabled' : ''}>${icon('plus')}</button><output>${arabicNumber(settings.size)}</output><button class="icon-button" data-action="font-size" data-delta="-2" aria-label="تصغير الخط" ${settings.size <= 20 ? 'disabled' : ''}><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button></div></div><div class="settings-group"><label for="line-spacing">تباعد الأسطر</label><select id="line-spacing" data-setting="line">${[[1.8,'متقارب'],[2.15,'مريح'],[2.5,'واسع']].map(([value,label]) => `<option value="${value}" ${Number(settings.line) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="settings-group"><label for="reading-width">عرض النص</label><select id="reading-width" data-setting="width"><option value="740" ${Number(settings.width) === 740 ? 'selected' : ''}>مريح للعين</option><option value="940" ${Number(settings.width) === 940 ? 'selected' : ''}>واسع</option></select></div><div class="settings-group"><label for="daily-goal">هدف القراءة اليومي</label><select id="daily-goal" data-setting="goal">${[5,10,15,30,60].map(value => `<option value="${value}" ${settings.goal === value ? 'selected' : ''}>${arabicNumber(value)} دقيقة</option>`).join('')}</select></div><p class="settings-foot">تُحفظ تفضيلاتك تلقائيًا على جهازك. يعتمد وقت القراءة على نشاطك في القارئ، ويتوقف عند ترك الصفحة أو عدم التفاعل.</p>`);
}
let loadSequence = 0;
async function openReader(id, ratioOverride, updateHistory = true) {
  const book = findBook(id); if (!book) return;
  const sequence = ++loadSequence;
  if (currentBook) savePosition();
  try {
    const markdown = await markdownFor(book);
    if (sequence !== loadSequence) return;
    $('#modal').close();
    document.body.classList.remove('app-night','sidebar-open');
    currentBook = book; currentMarkdown = markdown; currentChapter = 0;focusMode = false;
    state.lastBook = id;
    if (!state.positions[id]) state.positions[id] = {ratio:0,updated:Date.now()};
    saveState();
    lastActivity = Date.now();lastReadingTick = Date.now();
    document.title = `${book.title} — رِواق`;
    if (updateHistory) history.pushState(null,'',`#read/${encodeURIComponent(id)}`);
    const html = DOMPurify.sanitize(marked.parse(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'')), {FORBID_TAGS:['style','form','input','button','iframe','object','embed',...(book.imported ? ['img','video','audio','source'] : [])],FORBID_ATTR:['style'],ADD_ATTR:[]});
    $('#app').innerHTML = `<div class="reader-shell theme-${state.settings.theme}"><header class="reader-header"><div class="reader-brand">${brand()}<button class="back-library" data-action="nav" data-view="library">${icon('right')}<span>المكتبة</span></button></div><div class="reader-book-name">${escapeHtml(book.title)}<small>${escapeHtml(book.author)}</small></div><div class="reader-tools">${iconButton('list','فهرس الكتاب','toc')}${iconButton('search','البحث في الكتاب','reader-search')}${iconButton('bookmark','حفظ علامة القراءة','reader-bookmark')}${iconButton('settings','تفضيلات القراءة','settings')}${iconButton('focus','وضع التركيز','focus','focus-tool')}</div></header><div class="reader-main"><button class="mobile-backdrop" data-action="toc-close" aria-label="إغلاق الفهرس"></button><aside class="toc-panel" aria-label="فهرس الكتاب"><div class="toc-title"><strong>فهرس الكتاب</strong>${iconButton('close','إغلاق الفهرس','toc-close')}</div>${cover(book)}<h2 class="toc-book-title">${escapeHtml(book.title)}</h2><p class="toc-subtitle">${arabicNumber(book.minutes)} دقيقة من عوالم أخرى</p><nav class="toc-links"></nav></aside><div class="reader-scroll" id="main-content" tabindex="0" aria-label="نص الكتاب"><article class="reader-article" lang="ar" dir="rtl">${html}<p class="reader-end">تمّت هذه الرحلة، وبقي أثرها.</p><div class="reader-source">${book.imported ? '<p>كتابك الخاص · محفوظ محليًا على جهازك.</p>' : `<p>المصدر: <a href="${escapeHtml(book.source)}" target="_blank" rel="noopener noreferrer">ويكي مصدر</a> · <a href="${escapeHtml(book.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(book.license)}</a></p><p>${escapeHtml(book.editionNote)}</p>`}<button class="text-link" data-action="download" data-id="${escapeHtml(id)}">${icon('download')}تحميل نسخة Markdown</button></div></article></div></div><footer class="reader-bottom"><button data-action="previous-chapter">${icon('right')}المقطع السابق</button><span class="reader-chapter-label"></span><div class="reader-progress"><span class="reader-percent">٠٪</span><div class="progress-track"><span class="reader-progress-fill" style="width:0%"></span></div></div><button data-action="next-chapter">المقطع التالي${icon('left')}</button></footer><button class="selection-button" data-action="save-quote" hidden>${icon('note')}احفظ اقتباسًا</button></div>`;
    // Disable images in imported files: Markdown stays local and cannot track readers.
    if (book.imported) $$('.reader-article img').forEach(image => image.replaceWith(document.createTextNode(image.alt || '[صورة]')));
    $$('.reader-article a').forEach(link => {link.target='_blank';link.rel='noopener noreferrer';});
    currentChapters = $$('.reader-article h2, .reader-article h3');
    if (!currentChapters.length) currentChapters = [$('.reader-article h1') || $('.reader-article p')].filter(Boolean);
    currentChapters.forEach((heading,index) => heading.id=`chapter-${index}`);
    currentAnchors = $$('.reader-article h1, .reader-article h2, .reader-article h3, .reader-article h4, .reader-article p, .reader-article li');
    $('.toc-links').innerHTML = currentChapters.map((heading,index) => `<button class="toc-link" data-action="chapter" data-index="${index}"><span>${arabicNumber(index + 1).padStart(2,'٠')}</span>${escapeHtml(heading.textContent)}</button>`).join('');
    applyReadingSettings(false);
    const scroller = $('.reader-scroll');
    scroller.addEventListener('scroll', onReaderScroll, {passive:true});
    const position = typeof ratioOverride === 'number' ? {ratio:ratioOverride} : ratioOverride || state.positions[id] || {ratio:0};
    await document.fonts.ready;
    if (sequence !== loadSequence || currentBook?.id !== id) return;
    requestAnimationFrame(() => {if (currentBook?.id === id && sequence === loadSequence) {if (!restoreAnchor(position.anchor)) scroller.scrollTop=Math.max(0,Math.min(1,position.ratio || 0)) * (scroller.scrollHeight - scroller.clientHeight);onReaderScroll();}});
  } catch (error) {console.error('Unable to open book',error);toast('تعذّر فتح الكتاب. تأكد من اتصالك، ثم حاول مجددًا.');}
}
function savePosition() {
  if (!currentBook || !$('.reader-scroll')) return;
  const scroller = $('.reader-scroll');
  state.positions[currentBook.id] = {ratio:Math.max(0,Math.min(1,scroller.scrollTop / Math.max(1,scroller.scrollHeight - scroller.clientHeight))),anchor:captureAnchor(),updated:Date.now(),chapter:currentChapters[currentChapter]?.textContent || ''};
  saveState();
}
function onReaderScroll() {
  const scroller = $('.reader-scroll'); if (!scroller || !currentBook) return;
  readerPosition = Math.max(0,Math.min(1,scroller.scrollTop / Math.max(1,scroller.scrollHeight - scroller.clientHeight)));
  lastKnownAnchor = captureAnchor();
  const top = scroller.getBoundingClientRect().top;
  currentChapter = 0;
  currentChapters.forEach((heading,index) => {if (heading.getBoundingClientRect().top <= top + 145) currentChapter = index;});
  $$('.toc-link').forEach((link,index) => {link.classList.toggle('active',index === currentChapter);link.setAttribute('aria-current',index === currentChapter ? 'location' : 'false');});
  $('.reader-percent').textContent=`${arabicNumber(Math.round(readerPosition * 100))}٪`;
  $('.reader-progress-fill').style.width=`${readerPosition * 100}%`;
  $('.reader-chapter-label').textContent=currentChapters[currentChapter]?.textContent || currentBook.title;
  $('[data-action="previous-chapter"]').disabled=currentChapter <= 0;
  $('[data-action="next-chapter"]').disabled=currentChapter >= currentChapters.length - 1;
  updateBookmarkButton();
  clearTimeout(saveTimer);saveTimer=setTimeout(savePosition,350);
  lastActivity=Date.now();
  refreshSelection();
}
function gotoChapter(index) {
  const heading=currentChapters[index];if (!heading) return;
  heading.scrollIntoView({block:'start',behavior:'auto'});
  $('.reader-shell').classList.remove('reader-toc-open');
  onReaderScroll();
}
function nearbyBookmark() {
  const anchor = lastKnownAnchor;
  return state.bookmarks.find(entry => entry.bookId === currentBook?.id && (entry.anchor && anchor ? entry.anchor.index === anchor.index && Math.abs(entry.anchor.fraction - anchor.fraction) < .03 : Math.abs(entry.ratio - readerPosition) < .008));
}
function updateBookmarkButton() {
  const button=$('[data-action="reader-bookmark"]');if (!button) return;
  const active=!!nearbyBookmark();button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',active ? 'إزالة علامة القراءة' : 'حفظ علامة القراءة');
}
function toggleBookmark() {
  if (!currentBook) return;
  const existing=nearbyBookmark();
  if (existing) {state.bookmarks=state.bookmarks.filter(entry => entry.id !== existing.id);toast('أُزيلت علامة القراءة.');}
  else {state.bookmarks.push({id:crypto.randomUUID(),bookId:currentBook.id,ratio:readerPosition,anchor:captureAnchor(),chapter:currentChapters[currentChapter]?.textContent || currentBook.title,created:Date.now()});toast('حُفظ الموضع. يمكنك العودة إليه من علامات القراءة.');}
  saveState();updateBookmarkButton();
}
function showBookSearch() {
  openModal('ابحث بين السطور', `<label class="search-box modal-search">${icon('search')}<input id="book-search" type="search" placeholder="كلمة أو عبارة من الكتاب…" aria-label="البحث داخل الكتاب"></label><div class="search-results"><p class="settings-foot">ابحث في نص الكتاب. لا حاجة لمطابقة التشكيل أو الهمزات.</p></div>`);
  $('#book-search').focus();
}
function searchWithinBook(value) {
  const resultArea=$('.search-results');if (!resultArea) return;
  if (value.trim().length < 2) {resultArea.innerHTML='<p class="settings-foot">اكتب حرفين على الأقل للبحث.</p>';return;}
  const nodes=$$('.reader-article p, .reader-article h2, .reader-article h3').filter(node => !node.closest('.reader-source'));
  const results=[];
  const term=normalize(value);
  for (let index=0;index<nodes.length;index++) {
    const text=nodes[index].textContent;
    const at=normalize(text).indexOf(term);
    if (at >= 0) {results.push({index,text:text.slice(Math.max(0,at - 60),at + 140)});if (results.length >= 50) break;}
  }
  resultArea.innerHTML=results.length ? `<p class="settings-foot">${arabicNumber(results.length)} ${results.length >= 50 ? 'نتيجة أولى' : 'نتيجة'}</p>` + results.map(result => `<button class="search-result" data-action="search-jump" data-index="${result.index}"><small>انتقل إلى النص</small>${escapeHtml(result.text)}…</button>`).join('') : '<p class="settings-foot">لم نجد هذه العبارة. جرّب كلمة مختلفة.</p>';
}
function showQuoteModal() {
  if (!currentBook || !selectedQuote) return;
  $('.selection-button').hidden=true;
  openModal('كلمات تستحق أن تبقى', `<blockquote class="selected-quote">${escapeHtml(selectedQuote)}</blockquote><label class="field-label" for="quote-note">ملاحظتك (اختياري)</label><textarea id="quote-note" class="note-input" placeholder="بماذا ألهمتك هذه الكلمات؟" maxlength="4000"></textarea><button class="primary-button" data-action="confirm-quote">${icon('check')}احفظ في اقتباساتي</button>`);
}

async function importBook(file) {
  if (!file) return;
  if (!/\.(md|markdown)$/i.test(file.name)) {toast('اختر ملف Markdown بامتداد .md، وليس PDF.');return;}
  if (file.size > MAX_IMPORTED_BOOK_BYTES) {toast('الحد الأقصى لملف Markdown هو ٥٠ ميغابايت.');return;}
  try {
    const markdown=await file.text();
    const letters=markdown.match(/\p{L}/gu) || [];
    const arabic=markdown.match(/[\u0621-\u064A\u066E-\u06D3]/g) || [];
    if (arabic.length < 20 || arabic.length / Math.max(1,letters.length) < .3) {toast('رِواق للكتب العربية. اختر كتابًا يحتوي على نص عربي.');return;}
    const heading=markdown.match(/^#\s+(.+)$/m)?.[1];
    const title=(heading || file.name.replace(/\.(md|markdown)$/i,'')).replace(/[*_`]/g,'').slice(0,100);
    const words=markdown.split(/\s+/).length;
    const book={id:`local-${crypto.randomUUID()}`,title,author:'من مكتبتك الخاصة',category:'أدب',color:['forest','terracotta','blue','ochre'][imported.length % 4],subtitle:'كتابك الخاص، في مساحة هادئة',description:'أضفته من جهازك. يمكنك قراءته وتخصيص مظهره وحفظ الاقتباسات، تمامًا مثل أي كتاب في رِواق.',words,minutes:Math.max(1,Math.round(words / 180)),markdown,imported:true};
    await dbOperation('put',book);
    imported.push(book);books=[...catalog,...imported];state.favorites.push(book.id);saveState();
    view='my';query='';category='الكل';renderLibrary();showDetails(book.id);toast('أُضيف كتابك. محفوظ على جهازك فقط.');
  } catch (error) {console.error('Import failed',error);toast('تعذّر حفظ الكتاب. تأكد من إتاحة التخزين ومساحة الجهاز.');}
  finally {$('#import-file').value='';}
}

document.addEventListener('click', async event => {
  const button=event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const {action,id}=button.dataset;
  lastActivity=Date.now();
  switch (action) {
    case 'retry-startup': location.reload();break;
    case 'nav': setView(button.dataset.view);break;
    case 'menu': document.body.classList.toggle('sidebar-open');break;
    case 'close-sidebar': document.body.classList.remove('sidebar-open');break;
    case 'explore': $('#shelf')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});break;
    case 'import': $('#import-file').click();break;
    case 'filter': category=button.dataset.category;$$('.filter-button').forEach(item => {item.classList.toggle('active',item.dataset.category === category);item.setAttribute('aria-pressed',String(item.dataset.category === category));});renderShelf();break;
    case 'grid': case 'list': listView=action === 'list';$$('.view-switch button').forEach(item => {item.classList.toggle('active',item.dataset.action === action);item.setAttribute('aria-pressed',String(item.dataset.action === action));});renderShelf();break;
    case 'reset-filters': if (view === 'my' && !personalBooks().length) setView('library');else {category='الكل';query='';renderLibrary();}break;
    case 'details': showDetails(id);break;
    case 'featured-info': showDetails((findBook(state.lastBook) || books[0])?.id);break;
    case 'read': button.disabled=true;await openReader(id);button.disabled=false;break;
    case 'download': await downloadBook(id);break;
    case 'save-book': {
      const saved=state.favorites.includes(id);state.favorites=saved ? state.favorites.filter(item => item !== id) : [...state.favorites,id];saveState();renderLibrary();toast(saved ? 'أُزيل الكتاب من محفوظاتك.' : 'أُضيف الكتاب إلى مكتبتك.');break;
    }
    case 'dark': state.dark=!state.dark;saveState();renderLibrary();break;
    case 'settings': showSettings();break;
    case 'close-modal': $('#modal').close();break;
    case 'setting': state.settings[button.dataset.key]=button.dataset.value;saveState();applyReadingSettings();showSettings();break;
    case 'font-size': state.settings.size=Math.max(20,Math.min(34,state.settings.size + Number(button.dataset.delta)));saveState();applyReadingSettings();showSettings();break;
    case 'toc': $('.reader-shell').classList.toggle('reader-toc-open');if (innerWidth > 760) {focusMode=false;$('.reader-shell').classList.remove('reader-focus');const toc=$('.toc-panel');toc.hidden=!toc.hidden;}break;
    case 'toc-close': $('.reader-shell').classList.remove('reader-toc-open');break;
    case 'chapter': gotoChapter(Number(button.dataset.index));break;
    case 'previous-chapter': gotoChapter(currentChapter - 1);break;
    case 'next-chapter': gotoChapter(currentChapter + 1);break;
    case 'focus': focusMode=!focusMode;$('.reader-shell').classList.toggle('reader-focus',focusMode);button.classList.toggle('active',focusMode);button.setAttribute('aria-pressed',String(focusMode));break;
    case 'reader-bookmark': toggleBookmark();break;
    case 'reader-search': showBookSearch();break;
    case 'search-jump': {
      const nodes=$$('.reader-article p, .reader-article h2, .reader-article h3').filter(node => !node.closest('.reader-source'));
      const node=nodes[Number(button.dataset.index)];if (!node) break;
      $('#modal').close();$$('.search-hit').forEach(item => item.classList.remove('search-hit'));node.classList.add('search-hit');node.scrollIntoView({block:'center'});break;
    }
    case 'save-quote': showQuoteModal();break;
    case 'confirm-quote': {
      if (!currentBook || !selectedQuote) break;
      state.notes.push({id:crypto.randomUUID(),bookId:currentBook.id,ratio:readerPosition,anchor:captureAnchor(),chapter:currentChapters[currentChapter]?.textContent || currentBook.title,quote:selectedQuote,text:$('#quote-note').value.trim(),created:Date.now()});saveState();$('#modal').close();window.getSelection()?.removeAllRanges();selectedQuote='';toast('حُفظت الكلمات في اقتباساتك.');break;
    }
    case 'annotation-open': {const entry=[...state.bookmarks,...state.notes].find(item => item.id === id);if (entry) await openReader(entry.bookId,entry);break;}
    case 'annotation-delete': state.bookmarks=state.bookmarks.filter(entry => entry.id !== id);state.notes=state.notes.filter(entry => entry.id !== id);saveState();renderAnnotations();toast('تم الحذف.');break;
    case 'delete-import': {
      const book=findBook(id);if (!book?.imported) break;
      openModal('حذف الكتاب من جهازك؟',`<p style="margin-bottom:20px">سيُحذف «${escapeHtml(book.title)}» مع علاماته واقتباساته من هذا المتصفح.</p><div class="detail-actions"><button class="primary-button" data-action="confirm-delete-import" data-id="${escapeHtml(id)}">حذف الكتاب</button><button class="secondary-button" data-action="details" data-id="${escapeHtml(id)}">احتفظ به</button></div>`);break;
    }
    case 'confirm-delete-import': {
      try {await dbOperation('delete',id);imported=imported.filter(book => book.id !== id);books=[...catalog,...imported];state.favorites=state.favorites.filter(item => item !== id);state.bookmarks=state.bookmarks.filter(entry => entry.bookId !== id);state.notes=state.notes.filter(entry => entry.bookId !== id);delete state.positions[id];if (state.lastBook === id) state.lastBook=null;saveState();$('#modal').close();renderLibrary();toast('حُذف الكتاب من جهازك.');}catch {toast('تعذّر الحذف. حاول مرة أخرى.');}break;
    }
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'library-search') {query=event.target.value;if (view === 'library' || view === 'my') renderShelf();else renderAnnotations();}
  if (event.target.id === 'book-search') {clearTimeout(searchTimer);searchTimer=setTimeout(() => searchWithinBook(event.target.value),180);}
});
document.addEventListener('change',event => {
  const setting=event.target.dataset.setting;
  if (setting) {state.settings[setting]=Number(event.target.value);saveState();applyReadingSettings();if (!currentBook) {const y=window.scrollY;renderLibrary();window.scrollTo(0,y);}}
  if (event.target.id === 'import-file') importBook(event.target.files[0]);
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {event.preventDefault();if (currentBook) showBookSearch();else $('#library-search')?.focus();}
  if (event.key === 'Escape') {document.body.classList.remove('sidebar-open');$('.reader-shell')?.classList.remove('reader-toc-open');}
  if (event.key === 'Enter' || event.key === ' ') {const target=event.target.closest('[role="button"]');if (target) {event.preventDefault();target.click();}}
  if (currentBook && !$('#modal').open && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) {
    if (event.key === 'ArrowLeft') {event.preventDefault();$('.reader-scroll').scrollBy(0,$('.reader-scroll').clientHeight * .8);}
    if (event.key === 'ArrowRight') {event.preventDefault();$('.reader-scroll').scrollBy(0,-$('.reader-scroll').clientHeight * .8);}
  }
  lastActivity=Date.now();
});
$('#modal').addEventListener('click',event => {
  if (event.target !== $('#modal')) return;
  const rect=$('#modal').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('#modal').close();
});
function refreshSelection() {
  const button=$('.selection-button');if (!button) return;
  if ($('#modal').open) {button.hidden=true;return;}
  const selection=window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {button.hidden=true;return;}
  const range=selection.getRangeAt(0), article=$('.reader-article');
  if (!article?.contains(range.startContainer) || !article.contains(range.endContainer)) {button.hidden=true;return;}
  const text=selection.toString().trim();
  if (text.length < 3 || text.length > 3000) {button.hidden=true;return;}
  selectedQuote=text;
  const rect=range.getBoundingClientRect();
  button.style.left=`${Math.max(12,Math.min(innerWidth - 175,rect.left + rect.width / 2 - 75))}px`;
  button.style.top=`${Math.max(75,Math.min(innerHeight - 110,rect.bottom + 8))}px`;
  button.hidden=false;
}
document.addEventListener('selectionchange',refreshSelection);
// Keep the selection while clicking its floating action.
document.addEventListener('pointerdown',event => {if (event.target.closest('.selection-button')) event.preventDefault();lastActivity=Date.now();});
document.addEventListener('visibilitychange',() => {if (document.hidden) savePosition();lastReadingTick=Date.now();});
window.addEventListener('pagehide',savePosition);
window.addEventListener('resize',() => {
  const anchor = lastKnownAnchor;
  if (currentBook && anchor) requestAnimationFrame(() => {if (currentBook) {restoreAnchor(anchor);onReaderScroll();}});
});
window.addEventListener('popstate',async () => {
  const id=location.hash.match(/^#read\/(.+)$/)?.[1];
  if (id && findBook(decodeURIComponent(id))) await openReader(decodeURIComponent(id),undefined,false);
  else {savePosition();++loadSequence;view='library';renderLibrary();}
});
setInterval(() => {
  const now=Date.now(), elapsed=Math.min(5,(now - lastReadingTick) / 1000);lastReadingTick=now;
  if (!currentBook || document.hidden || $('#modal').open || now - lastActivity > 60000) return;
  state.reading[today()]=(state.reading[today()] || 0) + elapsed;
  // Keep a bounded local history.
  const days=Object.keys(state.reading).sort();if (days.length > 90) days.slice(0,-90).forEach(day => delete state.reading[day]);
  saveState();
},5000);

async function init() {
  try {
    const response=await fetch('books/catalog.json');if (!response.ok) throw new Error('Catalog unavailable');
    catalog=await response.json();
    try {db=await openDatabase();imported=await dbOperation('getAll');}catch {toast('التخزين المحلي غير متاح. يمكنك قراءة المكتبة، لكن لا يمكن إضافة كتب.');}
    books=[...catalog,...imported];renderLibrary();
    const id=location.hash.match(/^#read\/(.+)$/)?.[1];
    if (id && findBook(decodeURIComponent(id))) await openReader(decodeURIComponent(id),undefined,false);
  } catch (error) {
    console.error('Startup failed',error);
    $('#app').innerHTML=`<main class="initial-loader"><span>رِواق</span><p>تعذّر فتح المكتبة. شغّل التطبيق عبر خادم ويب، ثم أعد المحاولة.</p><p><button class="secondary-button" data-action="retry-startup">إعادة المحاولة</button></p></main>`;
  }
}
init();
