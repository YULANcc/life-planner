/* 生活规划台 — 逻辑（纯前端，数据存本地 localStorage） */
'use strict';

/* ========== 常量 ========== */
const LS_KEY = 'lifeplanner.v1';

const SLOTS = [
  { key: 'morning', label: '早' },
  { key: 'afternoon', label: '午' },
  { key: 'evening', label: '晚' }
];
const SLOT_LABEL = { morning: '早', afternoon: '午', evening: '晚' };
const SLOT_ORDER = { morning: 0, afternoon: 1, evening: 2 };
const WD_CN = ['一', '二', '三', '四', '五', '六', '日'];
const FMT_MD_LONG = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const FMT_MD_SHORT = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const FMT_MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const DOW_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const DEFAULT_TYPES = [
  { key: 'learning', label: '学习型', color: '#4C6EF5' },
  { key: 'explore', label: '探索型', color: '#0FA68C' },
  { key: 'experience', label: '体验型', color: '#E8813F' }
];

/* 内置类型色：统一覆盖，避免旧数据残留上一版配色 */
const TYPE_COLORS = { learning: '#4C6EF5', explore: '#0FA68C', experience: '#E8813F' };

/* 图表与状态色，与 styles.css 中的变量保持一致 */
const CHART = {
  ok: '#1F8A5B',
  okBar: '#2FA36B',
  half: '#D99A2B',
  halfBar: '#E0B45F',
  skip: '#CBD5E0',
  vital: '#5B4EE9',
  track: '#E4E9EF'
};

/* ========== 小工具 ========== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9);
const p2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/* ========== 状态 ========== */
function defaultState() {
  return {
    v: 1,
    goals: [],
    tasks: [],
    schedule: [],
    settings: {
      types: DEFAULT_TYPES.map(t => ({ ...t })),
      budget: { morning: 3, afternoon: 3, evening: 2 },
      seenGuide: false
    }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    const types = ((s.settings && s.settings.types) || d.settings.types).map(t =>
      TYPE_COLORS[t.key] ? Object.assign({}, t, { color: TYPE_COLORS[t.key] }) : t);
    return {
      v: 1,
      goals: s.goals || [],
      tasks: s.tasks || [],
      schedule: s.schedule || [],
      settings: {
        types: types,
        budget: Object.assign({}, d.settings.budget, (s.settings && s.settings.budget) || {}),
        seenGuide: !!(s.settings && s.settings.seenGuide)
      }
    };
  } catch (e) {
    return defaultState();
  }
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { console.warn('保存失败', e); }
}

let state = loadState();
const ui = { tab: 'plan', weekStart: mondayOf(new Date()), mobileDay: null };

/* ========== 查询助手 ========== */
const goalById = id => state.goals.find(g => g.id === id);
const taskById = id => state.tasks.find(t => t.id === id);
const typeOf = key => state.settings.types.find(t => t.key === key)
  || { key: key || 'other', label: '未分类', color: '#6b7280' };
const energyOf = s => {
  const t = taskById(s.taskId);
  if (!t) return 0;
  return (s.mode === 'mini' ? t.mini : t.full).energy;
};
const dayBudget = () => SLOTS.reduce((a, s) => a + (state.settings.budget[s.key] || 0), 0);
const weekDates = ws => Array.from({ length: 7 }, (_, i) => ymd(addDays(ws, i)));
const parseYmd = s => {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
};
const weekRangeLabel = ws =>
  FMT_MD_LONG.format(ws) + ' – ' + FMT_MD_LONG.format(addDays(ws, 6));

/* ========== 排期生成 ========== */
function taskOnDay(t, wd) {
  const r = t.repeat || { mode: 'daily' };
  if (r.mode === 'daily') return true;
  if (r.mode === 'weekdays') return wd <= 5;
  if (r.mode === 'custom') return (r.days || []).indexOf(wd) >= 0;
  return true;
}

/* 选时段：先看偏好，再看剩余容量；都放不下就返回 null（填满就停） */
function pickSlotByLoad(t, load, cap, energy) {
  const keys = SLOTS.map(x => x.key);
  const order = (t.slotPref && t.slotPref !== 'any')
    ? [t.slotPref].concat(keys.filter(k => k !== t.slotPref))
    : keys.slice().sort((a, b) => (load[a] || 0) - (load[b] || 0));
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if ((load[k] || 0) + energy <= (cap[k] || 0)) return k;
  }
  return null;
}

function generateWeek(weekStart, opts) {
  opts = opts || {};
  const start = ymd(weekStart), end = ymd(addDays(weekStart, 6));
  // 清掉本周未打卡的安排，保留已打卡记录
  state.schedule = state.schedule.filter(s => s.date < start || s.date > end || s.result);

  const cap = state.settings.budget;
  let dropped = 0;

  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const date = ymd(d);
    const wd = i + 1;
    const used = {};
    const load = { morning: 0, afternoon: 0, evening: 0 };

    state.schedule.filter(s => s.date === date).forEach(x => {
      used[x.taskId] = true;
      load[x.slot] = (load[x.slot] || 0) + energyOf(x);
    });

    // state.tasks 的顺序 = 用户在规划台拖出来的顺序
    state.tasks.forEach(t => {
      if (!taskOnDay(t, wd)) return;
      if (used[t.id]) return;
      const e = t.full.energy;
      const slot = pickSlotByLoad(t, load, cap, e);
      if (!slot) { if (!opts.randomResults) dropped++; return; }

      const item = { id: uid(), date: date, slot: slot, taskId: t.id, mode: 'full', result: null };
      state.schedule.push(item);
      used[t.id] = true;
      load[slot] += e;
      if (opts.randomResults) {
        const r = Math.random();
        if (r < 0.72) { item.result = 'done'; if (Math.random() < 0.25) item.mode = 'mini'; }
        else if (r < 0.86) { item.result = 'partial'; }
        else { item.result = 'skip'; }
      }
    });
  }
  save();
  return { dropped: dropped };
}

/* 把界面上的顺序写回数据（拖动排序后调用） */
function commitOrder() {
  const gEls = $$('#goalList > .goal-group');
  if (gEls.length) {
    const ids = gEls.map(el => el.dataset.gid);
    state.goals.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }
  const ordered = [];
  gEls.forEach(gEl => {
    const box = gEl.querySelector('.tasks');
    if (!box) return;
    const gid = gEl.dataset.gid;
    $$('.trow', box).forEach(tEl => {
      const t = taskById(tEl.dataset.tid);
      if (!t) return;
      t.goalId = gid;          // 拖到别的目标下就等于改了归属
      ordered.push(t);
    });
  });
  if (ordered.length) {
    state.tasks.forEach(t => { if (ordered.indexOf(t) < 0) ordered.push(t); });
    state.tasks = ordered;
  }
}

/* ========== 外壳 ========== */
/* 当前视图同步到 URL，刷新后还在同一页 */
function syncUrl() {
  try {
    const q = new URLSearchParams(location.search);
    if (ui.tab === 'plan') q.delete('tab'); else q.set('tab', ui.tab);
    const qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  } catch (e) { /* file:// 下可能受限，忽略 */ }
}

function render() {
  if (['plan', 'week', 'review'].indexOf(ui.tab) < 0) ui.tab = 'plan';
  $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === ui.tab));
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + ui.tab));
  const meta = $('#mastMeta');
  if (meta) meta.textContent = FMT_MONTH_YEAR.format(new Date()) + ' \u00b7 Weekly Edition';
  if (ui.tab === 'plan') renderPlan();
  if (ui.tab === 'week') renderWeek();
  if (ui.tab === 'review') renderReview();
}

/* ========== 渲染：规划台 ========== */
function renderPlan() {
  const wrap = $('#goalList');
  const emptyEl = $('#planEmpty');
  if (!state.goals.length) {
    wrap.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  wrap.innerHTML = state.goals.map(g => {
    const ty = typeOf(g.type);
    const tasks = state.tasks.filter(t => t.goalId === g.id);
    const rows = tasks.map(t => {
      const rep = repeatLabel(t.repeat);
      const slot = t.slotPref === 'any' ? '不限时段' : SLOT_LABEL[t.slotPref] + '间';
      return '<div class="trow" data-tid="' + t.id + '">' +
        '<button class="handle" data-drag="task" aria-label="拖动排序">≡</button>' +
        '<span class="tname">' + esc(t.title) + '</span>' +
        '<span class="pills">' +
        '<span class="pill"><em>完整</em>' + t.full.minutes + ' 分<i>精力 ' + t.full.energy + '</i></span>' +
        '<span class="pill"><em>简版</em>' + t.mini.minutes + ' 分<i>精力 ' + t.mini.energy + '</i></span>' +
        '<span class="pill">' + rep + '</span>' +
        '<span class="pill">' + slot + '</span>' +
        '</span>' +
        '<span class="spacer"></span>' +
        '<button class="xbtn" data-goal="' + g.id + '" data-task-edit="' + t.id + '">编辑</button>' +
        '<button class="xbtn" data-task-del="' + t.id + '">删除</button>' +
        '</div>';
    }).join('');
    return '<div class="goal-group" data-gid="' + g.id + '">' +
      '<div class="goal-head">' +
      '<button class="handle" data-drag="goal" aria-label="拖动排序">≡</button>' +
      '<span class="goal-dot" style="background:' + ty.color + '"></span>' +
      '<span class="goal-title">' + esc(g.title) + '</span>' +
      '<span class="goal-type">' + esc(ty.label) + '</span>' +
      (g.horizon ? '<span class="goal-horizon">· ' + esc(g.horizon) + '</span>' : '') +
      '<span class="spacer"></span>' +
      '<button class="btn ghost sm" data-task-add="' + g.id + '">+ 任务</button>' +
      '<button class="xbtn" data-goal-edit="' + g.id + '">编辑</button>' +
      '<button class="xbtn" data-goal-del="' + g.id + '">删除</button>' +
      '</div>' +
      '<div class="tasks">' + (rows || '<div class="empty" style="padding:14px">这个目标还没有拆出任务</div>') + '</div>' +
      '</div>';
  }).join('');
}

function repeatLabel(r) {
  r = r || { mode: 'daily' };
  if (r.mode === 'daily') return '每天';
  if (r.mode === 'weekdays') return '工作日';
  const days = (r.days || []).slice().sort((a, b) => a - b).map(d => '周' + WD_CN[d - 1]).join('');
  return days || '未设';
}

/* ========== 渲染：本周 ========== */
function weekNavHTML() {
  return '<div class="week-nav">' +
    '<button class="btn ghost icon" data-weeknav="prev" aria-label="上一周">\u2039</button>' +
    '<button class="btn ghost icon" data-weeknav="next" aria-label="下一周">\u203a</button>' +
    '<button class="btn ghost sm" data-weeknav="today">回到本周</button>' +
    '</div>';
}

function renderWeek() {
  const ws = ui.weekStart;
  const today = ymd(new Date());
  const grid = $('#weekGrid');
  const dates = weekDates(ws);
  const todayIdx = dates.indexOf(today);

  if (ui.mobileDay == null || ui.mobileDay < 0 || ui.mobileDay > 6) {
    ui.mobileDay = todayIdx >= 0 ? todayIdx : 0;
  }

  $('#weekPageHead').innerHTML =
    '<h2 class="page-title">This Week</h2>' +
    '<p class="page-sub">' + weekRangeLabel(ws) + '。打卡只有三个按钮：完成 / 一半 / 跳过，不写感受。</p>' +
    '<div class="week-legend">' +
    '<span class="cap">卡片左侧色条 = 任务类型</span>' +
    state.settings.types.map(ty =>
      '<span><em style="background:' + ty.color + '"></em>' + esc(ty.label) + '</span>').join('') +
    '</div>' +
    '<div class="row">' + weekNavHTML() + '<div class="spacer"></div>' +
    '<button class="btn ghost" id="btnTired">今天没电</button>' +
    '<button class="btn primary" id="btnGenerate">生成本周排期</button>' +
    '</div>';

  $('#dayPicker').innerHTML = dates.map((date, i) => {
    const d = addDays(ws, i);
    const cls = [i === ui.mobileDay ? 'is-on' : '', date === today ? 'is-today' : ''].filter(Boolean).join(' ');
    return '<button data-day="' + i + '" class="' + cls + '" aria-pressed="' + (i === ui.mobileDay) + '">' +
      '<b>' + DOW_EN[i] + '</b>' + FMT_MD_SHORT.format(d) + '</button>';
  }).join('');

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), date = ymd(d);
    const items = state.schedule.filter(s => s.date === date);
    const totalE = items.reduce((a, s) => a + energyOf(s), 0);
    const cap = dayBudget();
    const pct = cap ? Math.min(100, Math.round(totalE / cap * 100)) : 0;

    html += '<div class="wcol' + (date === today ? ' is-today' : '') +
      (i === ui.mobileDay ? ' is-shown' : '') + '">' +
      '<div class="wcol-head">' +
      '<div class="dow">' + DOW_EN[i] +
      (date === today ? '<span class="today-tag">Today</span>' : '') + '</div>' +
      '<div class="dt">' + FMT_MD_SHORT.format(d) + '</div>' +
      '<div class="energy">' +
      '<span class="energy-track" aria-hidden="true"><i class="energy-fill' + (totalE > cap ? ' over' : '') +
      '" style="transform:scaleX(' + (pct / 100) + ')"></i></span>' +
      '<span class="energy-num" aria-label="当天精力 ' + totalE + ' 点，预算 ' + cap + ' 点">' +
      totalE + '/' + cap + '</span>' +
      '</div></div>';

    SLOTS.forEach(sl => {
      const arr = items.filter(s => s.slot === sl.key);
      const used = arr.reduce((a, s) => a + energyOf(s), 0);
      const bud = state.settings.budget[sl.key] || 0;
      html += '<div class="slot">' +
        '<div class="slot-head' + (used > bud ? ' over' : '') + '">' +
        '<span class="slot-name">' + sl.label + '</span>' +
        '<span class="cnt">' + used + '/' + bud +
        '<button class="addbtn" data-add="1" data-date="' + date + '" data-slot="' + sl.key +
        '" aria-label="在' + FMT_MD_SHORT.format(d) + ' ' + sl.label + '间添加安排">+</button>' +
        '</span></div>' +
        '<div class="slot-body">' + arr.map(taskCardHTML).join('') + '</div>' +
        '</div>';
    });
    html += '</div>';
  }
  grid.innerHTML = html;
}

function taskCardHTML(s) {
  const t = taskById(s.taskId);
  if (!t) return '';
  const g = goalById(t.goalId);
  const ty = typeOf(g ? g.type : null);
  const use = s.mode === 'mini' ? t.mini : t.full;
  const cls = s.result ? ' is-' + s.result : '';
  return '<div class="task' + cls + '" style="--tc:' + ty.color + '" data-sid="' + s.id + '">' +
    '<button class="task-del" data-act="del" aria-label="把「' + esc(t.title) + '」从这天移除">×</button>' +
    '<div class="task-goal">' + esc(g ? g.title : '未归属') + '</div>' +
    '<div class="task-title">' + esc(t.title) + '</div>' +
    '<div class="task-meta">' +
    '<span class="tm-time">' + use.minutes + ' 分</span>' +
    '<button class="chip" data-act="ver" aria-label="切换完整版或简版，当前' +
    (s.mode === 'mini' ? '简版' : '完整版') + '">' +
    (s.mode === 'mini' ? '简版' : '完整') + '</button>' +
    '<span class="tm-energy">精力 ' + use.energy + '</span>' +
    '</div>' +
    '<div class="task-btns">' +
    '<button data-act="done" aria-label="标记完成">✓</button>' +
    '<button data-act="partial" aria-label="标记做了一半">½</button>' +
    '<button data-act="skip" aria-label="标记跳过">✕</button>' +
    '<button data-act="move" title="挪到别的日子或时段" aria-label="挪到别的日子或时段">⇄</button>' +
    '</div>' +
    '</div>';
}

/* ========== 渲染：复盘 ========== */
function collectWeek(ws) {
  const dates = weekDates(ws);
  const items = state.schedule.filter(s => dates.indexOf(s.date) >= 0);
  const done = items.filter(s => s.result === 'done').length;
  const part = items.filter(s => s.result === 'partial').length;
  const skip = items.filter(s => s.result === 'skip').length;
  const pend = items.length - done - part - skip;
  const rate = items.length ? Math.round((done + part * 0.5) / items.length * 100) : 0;
  const spent = items.filter(s => s.result === 'done' || s.result === 'partial')
    .reduce((a, s) => a + energyOf(s), 0);
  const miniUsed = items.filter(s => s.result && s.mode === 'mini').length;
  const finished = done + part;
  return { dates, items, done, part, skip, pend, rate, spent, miniUsed, finished };
}

function renderReview() {
  const ws = ui.weekStart;
  const st = collectWeek(ws);
  const cap = dayBudget() * 7;
  const body = $('#reviewBody');

  $('#reviewPageHead').innerHTML =
    '<h2 class="page-title">Weekly Review</h2>' +
    '<p class="page-sub">' + weekRangeLabel(ws) + '。只看结果，不做感受记录。记不住指标含义就点右上角的 ?。</p>' +
    '<div class="row">' + weekNavHTML() + '</div>';

  if (!st.items.length) {
    body.innerHTML = '<div class="empty"><b>这一周还没有排期</b>' +
      '先去 Plan 建好目标，或到 Week 点一次「生成本周排期」。</div>';
    return;
  }

  // 类型分布（按实际完成）
  const byType = {};
  st.items.filter(s => s.result === 'done' || s.result === 'partial').forEach(s => {
    const t = taskById(s.taskId); if (!t) return;
    const g = goalById(t.goalId);
    const k = g ? g.type : 'other';
    byType[k] = (byType[k] || 0) + 1;
  });
  const typeDist = state.settings.types.map(ty => ({
    key: ty.key, label: ty.label, color: ty.color, count: byType[ty.key] || 0
  }));
  const typeTotal = typeDist.reduce((a, x) => a + x.count, 0);

  // 按目标
  const byGoal = state.goals.map(g => {
    const tids = state.tasks.filter(t => t.goalId === g.id).map(t => t.id);
    const its = st.items.filter(s => tids.indexOf(s.taskId) >= 0);
    const d = its.filter(s => s.result === 'done').length;
    const pp = its.filter(s => s.result === 'partial').length;
    return {
      title: g.title, color: typeOf(g.type).color, total: its.length,
      rate: its.length ? Math.round((d + pp * 0.5) / its.length * 100) : 0
    };
  }).filter(x => x.total > 0);

  // 按时段
  const bySlot = SLOTS.map(sl => {
    const its = st.items.filter(s => s.slot === sl.key);
    const d = its.filter(s => s.result === 'done').length;
    const pp = its.filter(s => s.result === 'partial').length;
    return {
      label: sl.label, total: its.length,
      rate: its.length ? Math.round((d + pp * 0.5) / its.length * 100) : 0
    };
  });

  // 按天
  const perDay = st.dates.map((date, i) => {
    const its = st.items.filter(s => s.date === date);
    return {
      label: '周' + WD_CN[i],
      done: its.filter(s => s.result === 'done').length,
      part: its.filter(s => s.result === 'partial').length,
      skip: its.filter(s => s.result === 'skip').length,
      spent: its.filter(s => s.result === 'done' || s.result === 'partial')
        .reduce((a, s) => a + energyOf(s), 0)
    };
  });
  const maxDay = Math.max(1, ...perDay.map(d => d.done + d.part + d.skip));

  // 洞察
  const tips = buildInsights(st, typeDist, typeTotal, bySlot, byGoal);

  body.innerHTML =
    '<div class="review-top">' +
    statCard('Completion', '完成率', st.rate + '%',
      '完成算 1 分，一半算 0.5 分。本周完成 ' + st.done + '，一半 ' + st.part + '，跳过 ' + st.skip + '，未动 ' + st.pend) +
    statCard('Finished', '完成件数', String(st.finished), '共排 ' + st.items.length + ' 件') +
    statCard('Energy Used', '精力消耗', st.spent + ' / ' + cap,
      '占全部预算 ' + (cap ? Math.round(st.spent / cap * 100) : 0) + '%，越接近 100% 说明排得越满') +
    statCard('Mini Saves', '简版救场', st.miniUsed + ' 次',
      '靠简版完成的次数。这个数不为零是好事，说明降级机制在起作用') +
    '</div>' +

    '<div class="insight"><div class="k"><b>Notes</b><s>本周观察</s></div><ul>' +
    tips.map(t => '<li>' + t + '</li>').join('') + '</ul></div>' +

    '<div class="panels">' +
    '<div class="panel"><h3>By Type</h3><div class="cn">类型配比（本周实际完成的事）</div>' +
    typeStackHTML(typeDist, typeTotal) +
    '<div class="legend">' + typeDist.map(x =>
      '<span><em style="background:' + x.color + '"></em>' + esc(x.label) + ' ' + x.count + '</span>').join('') +
    '</div></div>' +

    '<div class="panel"><h3>By Goal</h3><div class="cn">各目标推进</div>' +
    (byGoal.length ? byGoal.map(g => barRow(g.title, g.rate, g.color)).join('') : '<div class="muted-note">本周没有目标下的排期</div>') +
    '</div>' +

    '<div class="panel"><h3>Daily</h3><div class="cn">每日完成情况</div>' +
    '<div class="vgroups">' + perDay.map(d => {
      const dn = d.done / maxDay * 100, pt = d.part / maxDay * 100, sk = d.skip / maxDay * 100;
      return '<div class="vgroup">' +
        '<i style="height:' + dn + '%;background:' + CHART.okBar + '"></i>' +
        '<i style="height:' + pt + '%;background:' + CHART.halfBar + '"></i>' +
        '<i style="height:' + sk + '%;background:' + CHART.skip + '"></i>' +
        '</div>';
    }).join('') + '</div>' +
    '<div class="vlabels">' + perDay.map(d => '<span>' + d.label + '</span>').join('') + '</div>' +
    '<div class="legend" style="margin-top:12px"><span><em style="background:' + CHART.okBar + '"></em>完成</span>' +
    '<span><em style="background:' + CHART.halfBar + '"></em>一半</span><span><em style="background:' + CHART.skip + '"></em>跳过</span></div>' +
    '</div>' +

    '<div class="panel"><h3>By Time of Day</h3><div class="cn">时段完成率</div>' +
    bySlot.map(s => barRow(s.label + '间', s.rate, CHART.vital)).join('') +
    '<div class="muted-note">哪个时段长期挂零，就说明那个时段不适合放任务。</div>' +
    '</div>' +

    '<div class="panel full"><h3>Energy Balance</h3><div class="cn">精力收支（每天）</div>' +
    '<div class="vgroups">' + perDay.map(d => {
      const sp = Math.min(100, d.spent / Math.max(1, dayBudget()) * 100);
      return '<div class="vgroup">' +
        '<i style="height:' + sp + '%;background:' + CHART.vital + '"></i>' +
        '<i style="height:100%;background:' + CHART.track + '"></i>' +
        '</div>';
    }).join('') + '</div>' +
    '<div class="vlabels">' + perDay.map(d => '<span>' + d.label + '</span>').join('') + '</div>' +
    '<div class="legend" style="margin-top:12px"><span><em style="background:' + CHART.vital + '"></em>实际消耗</span>' +
    '<span><em style="background:' + CHART.track + '"></em>每日预算 ' + dayBudget() + ' 点</span></div>' +
    '</div>' +

    '</div>';
}

function statCard(en, cn, v, s) {
  return '<div class="stat">' +
    '<div class="k"><b>' + en + '</b><s>' + cn + '</s></div>' +
    '<div class="v">' + v + '</div>' +
    '<div class="s">' + s + '</div>' +
    '</div>';
}

/* 引导弹窗 */
function openGuide() {
  const d = $('#dlgGuide');
  if (d && !d.open) d.showModal();
}

function maybeShowGuide() {
  const q = new URLSearchParams(location.search);
  if (state.settings.seenGuide) return;
  if (state.goals.length) return;
  if (q.get('seed') === '1' || q.get('selftest') === '1' || q.get('noguide') === '1') return;
  openGuide();
}

function doSeed(ask) {
  if (ask && state.goals.length && !confirm('载入示例会替换掉当前所有数据，继续？')) return false;
  seedData();
  state.settings.seenGuide = true;
  save(); render();
  return true;
}

function barRow(label, rate, color) {
  return '<div class="bar-row"><span class="lab">' + esc(label) + '</span>' +
    '<span class="bar-track"><i style="width:' + rate + '%;background:' + color + '"></i></span>' +
    '<span class="num">' + rate + '%</span></div>';
}

function typeStackHTML(typeDist, total) {
  if (!total) return '<div class="stack"></div>';
  return '<div class="stack">' + typeDist.map(x => {
    if (!x.count) return '';
    const w = x.count / total * 100;
    return '<i style="width:' + w + '%;background:' + x.color + '">' + (w > 12 ? Math.round(w) + '%' : '') + '</i>';
  }).join('') + '</div>';
}

function buildInsights(st, typeDist, typeTotal, bySlot, byGoal) {
  const out = [];
  if (st.rate >= 80) out.push('完成率 ' + st.rate + '%，节奏很稳，下周可以只加一点点量。');
  else if (st.rate < 45) out.push('完成率只有 ' + st.rate + '%，排得大概率偏多了，下周建议压到每天 2 件以内。');
  else out.push('完成率 ' + st.rate + '%，属于可持续区间，不用急着加量。');

  if (typeTotal) {
    const sorted = typeDist.slice().sort((a, b) => b.count - a.count);
    const top = sorted[0];
    if (top.count / typeTotal >= 0.6 && typeTotal >= 3) {
      out.push('本周 ' + Math.round(top.count / typeTotal * 100) + '% 的完成项都压在「' + top.label + '」，配比偏了一些。');
    }
    const zero = sorted.filter(x => x.count === 0);
    if (zero.length && typeTotal >= 3) {
      out.push('「' + zero.map(z => z.label).join('」「') + '」本周一次都没做，下周建议至少排 2 次。');
    }
  } else {
    out.push('本周还没有任何打卡记录，先随手勾几个再看趋势。');
  }

  const done = bySlot.filter(s => s.total >= 2).sort((a, b) => b.rate - a.rate);
  if (done.length >= 2) {
    const hi = done[0], lo = done[done.length - 1];
    if (hi.rate - lo.rate >= 30) {
      out.push(hi.label + '间完成率 ' + hi.rate + '%，' + lo.label + '间只有 ' + lo.rate +
        '%。高精力的事尽量排到' + hi.label + '间。');
    }
  }

  if (st.miniUsed >= 2) {
    out.push('本周有 ' + st.miniUsed + ' 次是靠简版完成，简版这条安全网在起作用，继续保持。');
  }
  const stuck = byGoal.filter(g => g.rate === 0);
  if (stuck.length) {
    out.push('「' + stuck.map(g => g.title).join('」「') + '」整周没推进，要么拆得更小，要么先放一放。');
  }
  return out.slice(0, 5);
}

/* ========== 弹窗：目标 ========== */
let editingGoalId = null;

function openGoalDialog(goal) {
  editingGoalId = goal ? goal.id : null;
  $('#dlgGoalTitle').textContent = goal ? '编辑目标' : '新目标';
  $('#goalTitle').value = goal ? goal.title : '';
  $('#goalHorizon').value = goal ? (goal.horizon || '') : '';
  const sel = $('#goalType');
  sel.innerHTML = state.settings.types.map(t =>
    '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('');
  sel.value = goal ? goal.type : state.settings.types[0].key;
  $('#dlgGoal').showModal();
  setTimeout(() => $('#goalTitle').focus(), 30);
}

/* ========== 弹窗：任务 ========== */
let editingTaskId = null;
let taskGoalId = null;
let customDays = [];

function openTaskDialog(goalId, task) {
  editingTaskId = task ? task.id : null;
  taskGoalId = goalId;
  $('#dlgTaskTitle').textContent = task ? '编辑任务' : '新任务（属于：' + (goalById(goalId) || {}).title + '）';
  $('#taskTitle').value = task ? task.title : '';
  $('#taskFullMin').value = task ? task.full.minutes : 30;
  $('#taskFullEnergy').value = task ? task.full.energy : 3;
  $('#taskMiniMin').value = task ? task.mini.minutes : 8;
  $('#taskMiniEnergy').value = task ? task.mini.energy : 1;
  const r = (task && task.repeat) || { mode: 'daily' };
  $('#taskRepeat').value = r.mode;
  customDays = (r.days || [1, 3, 5]).slice();
  $('#taskSlot').value = (task && task.slotPref) || 'any';
  renderDays();
  $('#taskDaysWrap').hidden = r.mode !== 'custom';
  $('#dlgTask').showModal();
  setTimeout(() => $('#taskTitle').focus(), 30);
}

function renderDays() {
  $('#taskDays').innerHTML = WD_CN.map((w, i) => {
    const n = i + 1;
    return '<button type="button" data-day="' + n + '" class="' + (customDays.indexOf(n) >= 0 ? 'on' : '') + '">周' + w + '</button>';
  }).join('');
}

/* ========== 弹窗：移动安排 ========== */
let movingId = null;
let movingSlot = 'morning';

function openMove(sid) {
  const s = state.schedule.find(x => x.id === sid);
  if (!s) return;
  const t = taskById(s.taskId);
  movingId = sid;
  movingSlot = s.slot;
  $('#moveTaskName').textContent = '把「' + (t ? t.title : '这件事') + '」挪到别的日子或时段';
  $('#moveDate').value = s.date;
  renderMoveSeg();
  $('#dlgMove').showModal();
}

function renderMoveSeg() {
  $$('#moveSlot button').forEach(b => {
    const on = b.dataset.slot === movingSlot;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/* ========== 弹窗：添加安排 ========== */
let pickTarget = null;

function openPick(date, slot) {
  pickTarget = { date, slot };
  const usedIds = state.schedule.filter(s => s.date === date).map(s => s.taskId);
  const list = state.tasks.slice().sort((a, b) => {
    const ga = (goalById(a.goalId) || {}).title || '';
    const gb = (goalById(b.goalId) || {}).title || '';
    return ga.localeCompare(gb, 'zh');
  });
  $('#pickList').innerHTML = list.length ? list.map(t => {
    const g = goalById(t.goalId);
    const ty = typeOf(g ? g.type : null);
    const dup = usedIds.indexOf(t.id) >= 0 ? '（已在这天）' : '';
    return '<button data-pick="' + t.id + '"' + (usedIds.indexOf(t.id) >= 0 ? ' disabled style="opacity:.45"' : '') + '>' +
      '<span style="color:' + ty.color + '">●</span> ' + esc(t.title) +
      '<span class="pm">' + esc(g ? g.title : '') + ' · 完整 ' + t.full.minutes + '分 · 简版 ' + t.mini.minutes + '分 ' + dup + '</span>' +
      '</button>';
  }).join('') : '<div class="empty">还没有任务，先去规划台拆任务。</div>';
  $('#dlgPick').showModal();
}

/* ========== 弹窗：设置 ========== */
let draftTypes = [];

function openSettings() {
  draftTypes = state.settings.types.map(t => ({ ...t }));
  $('#budMorning').value = state.settings.budget.morning;
  $('#budAfternoon').value = state.settings.budget.afternoon;
  $('#budEvening').value = state.settings.budget.evening;
  $('#newTypeName').value = '';
  renderTypeList();
  $('#dlgSettings').showModal();
}

function renderTypeList() {
  $('#typeList').innerHTML = draftTypes.map((t, i) => {
    const inUse = state.goals.filter(g => g.type === t.key).length;
    return '<div class="type-row">' +
      '<em style="background:' + t.color + '"></em>' +
      '<span>' + esc(t.label) + '</span>' +
      '<span style="color:var(--mute);font-size:11.5px">' + (inUse ? '用于 ' + inUse + ' 个目标' : '未使用') + '</span>' +
      '<span class="spacer"></span>' +
      (draftTypes.length > 1 ? '<button class="xbtn" data-typedel="' + i + '">删除</button>' : '') +
      '</div>';
  }).join('');
}

/* ========== 事件绑定 ========== */
function bind() {
  // 标签切换
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (!b) return;
    ui.tab = b.dataset.tab;
    syncUrl();
    save(); render();
    window.scrollTo(0, 0);
  });

  // 周导航（两个视图共用）
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-weeknav]');
    if (!b) return;
    const a = b.dataset.weeknav;
    if (a === 'prev') ui.weekStart = addDays(ui.weekStart, -7);
    if (a === 'next') ui.weekStart = addDays(ui.weekStart, 7);
    if (a === 'today') ui.weekStart = mondayOf(new Date());
    render();
  });

  // 规划台
  $('#btnAddGoal').addEventListener('click', () => openGoalDialog(null));
  $('#goalList').addEventListener('click', e => {
    const t = e.target;
    if (t.dataset.taskAdd) { openTaskDialog(t.dataset.taskAdd, null); return; }
    if (t.dataset.taskEdit) {
      const task = taskById(t.dataset.taskEdit);
      if (task) openTaskDialog(task.goalId, task);
      return;
    }
    if (t.dataset.taskDel) {
      const id = t.dataset.taskDel;
      if (!confirm('删除这个任务？它的排期也会一起删掉。')) return;
      state.tasks = state.tasks.filter(x => x.id !== id);
      state.schedule = state.schedule.filter(s => s.taskId !== id);
      save(); render(); return;
    }
    if (t.dataset.goalEdit) { openGoalDialog(goalById(t.dataset.goalEdit)); return; }
    if (t.dataset.goalDel) {
      const id = t.dataset.goalDel;
      if (!confirm('删除这个目标？它下面的任务和排期也会一起删除。')) return;
      const tids = state.tasks.filter(x => x.goalId === id).map(x => x.id);
      state.tasks = state.tasks.filter(x => x.goalId !== id);
      state.schedule = state.schedule.filter(s => tids.indexOf(s.taskId) < 0);
      state.goals = state.goals.filter(g => g.id !== id);
      save(); render(); return;
    }
  });

  // 本周：打卡 / 版本 / 删除 / 添加
  $('#weekGrid').addEventListener('click', e => {
    const addBtn = e.target.closest('[data-add]');
    if (addBtn) { openPick(addBtn.dataset.date, addBtn.dataset.slot); return; }
    const card = e.target.closest('.task');
    if (!card) return;
    const s = state.schedule.find(x => x.id === card.dataset.sid);
    if (!s) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'move') { openMove(s.id); return; }
    if (act === 'del') state.schedule = state.schedule.filter(x => x.id !== s.id);
    else if (act === 'ver') s.mode = s.mode === 'mini' ? 'full' : 'mini';
    else if (act) s.result = (s.result === act) ? null : act;
    save(); render();
  });

  // 页头 / 日期条里的按钮（每次重绘都会重建，所以走委托）
  document.addEventListener('click', e => {
    if (e.target.closest('#btnGenerate')) {
      if (!state.tasks.length) { alert('还没有任务。先去 Plan 建一个目标，再往下拆任务。'); return; }
      const res = generateWeek(ui.weekStart);
      render();
      if (res.dropped) {
        alert('已按你在 Plan 里排的顺序铺好这一周。有 ' + res.dropped +
          ' 件因为超出精力预算装不下，没有排进去——可以减少几件，或者到设置里调大预算。');
      } else {
        alert('已按你在 Plan 里排的顺序铺好这一周，全部装得下。已经打过卡的记录不会被覆盖。');
      }
      return;
    }
    if (e.target.closest('#btnTired')) {
      const today = ymd(new Date());
      const todays = state.schedule.filter(s => s.date === today && !s.result);
      if (!todays.length) { alert('今天没有还没完成的安排。'); return; }
      todays.forEach(x => { x.mode = 'mini'; });
      save(); render();
      alert('今天剩下的 ' + todays.length + ' 件已全部换成简版，做完就算完成。');
      return;
    }
    const dayBtn = e.target.closest('#dayPicker [data-day]');
    if (dayBtn) {
      ui.mobileDay = Number(dayBtn.dataset.day);
      renderWeek();
    }
  });

  // 拖动排序（鼠标和触摸都用 pointer 事件）
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-drag]');
    if (!handle) return;
    const row = handle.dataset.drag === 'goal'
      ? handle.closest('.goal-group')
      : handle.closest('.trow');
    if (!row) return;
    drag = { el: row, kind: handle.dataset.drag };
    row.classList.add('is-dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.preventDefault();
  });

  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const y = e.clientY;

    if (drag.kind === 'goal') {
      const list = $('#goalList');
      const items = [].slice.call(list.querySelectorAll(':scope > .goal-group')).filter(x => x !== drag.el);
      let target = null;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { target = items[i]; break; }
      }
      if (target) list.insertBefore(drag.el, target);
      else list.appendChild(drag.el);
      return;
    }

    // 任务行：指针停在哪一组，就挪进那一组（跨目标拖动 = 同时改归属和顺序）
    const under = document.elementFromPoint(e.clientX, y);
    const group = under && under.closest ? under.closest('.goal-group') : null;
    const box = (group && group.querySelector('.tasks')) || drag.el.parentElement;
    if (!box) return;
    const items = [].slice.call(box.querySelectorAll(':scope > .trow')).filter(x => x !== drag.el);
    let target = null;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { target = items[i]; break; }
    }
    if (target) box.insertBefore(drag.el, target);
    else box.appendChild(drag.el);
  });

  const endDrag = () => {
    if (!drag) return;
    drag.el.classList.remove('is-dragging');
    drag = null;
    commitOrder();
    save();
    render();
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // 使用说明
  $('#btnHelp').addEventListener('click', openGuide);
  $('#guideSeed').addEventListener('click', () => {
    doSeed(false);
    const d = $('#dlgGuide');
    if (d) d.close();
  });

  // 顶栏工具
  $('#btnSeed').addEventListener('click', () => {
    if (!doSeed(true)) return;
    alert('已载入示例：4 个目标 + 5 个任务，并生成了上周（含模拟打卡）和本周的排期。到 Review 看看效果。');
  });
  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'life-planner-' + ymd(new Date()) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (!data || typeof data !== 'object') throw new Error('格式不对');
        state = {
          v: 1,
          goals: data.goals || [],
          tasks: data.tasks || [],
          schedule: data.schedule || [],
          settings: {
            types: (data.settings && data.settings.types) || defaultState().settings.types,
            budget: Object.assign({}, defaultState().settings.budget, (data.settings && data.settings.budget) || {})
          }
        };
        save(); render();
        alert('导入成功。');
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    rd.readAsText(f);
    e.target.value = '';
  });

  // 目标弹窗
  $('#goalSave').addEventListener('click', () => {
    const title = $('#goalTitle').value.trim();
    if (!title) { alert('给目标起个名字'); return; }
    const payload = { title, type: $('#goalType').value, horizon: $('#goalHorizon').value.trim() };
    if (editingGoalId) Object.assign(goalById(editingGoalId), payload);
    else state.goals.push(Object.assign({ id: uid() }, payload));
    save(); render(); $('#dlgGoal').close();
  });

  // 任务弹窗
  $('#taskRepeat').addEventListener('change', e => {
    $('#taskDaysWrap').hidden = e.target.value !== 'custom';
  });
  $('#taskDays').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const n = Number(b.dataset.day);
    const i = customDays.indexOf(n);
    if (i >= 0) customDays.splice(i, 1); else customDays.push(n);
    renderDays();
  });
  $('#taskSave').addEventListener('click', () => {
    const title = $('#taskTitle').value.trim();
    if (!title) { alert('给任务起个名字'); return; }
    const mode = $('#taskRepeat').value;
    if (mode === 'custom' && !customDays.length) { alert('自定义重复至少要选一天'); return; }
    const payload = {
      title,
      goalId: taskGoalId,
      full: { minutes: clamp(Number($('#taskFullMin').value) || 30, 1, 600), energy: clamp(Number($('#taskFullEnergy').value) || 1, 1, 5) },
      mini: { minutes: clamp(Number($('#taskMiniMin').value) || 5, 1, 600), energy: clamp(Number($('#taskMiniEnergy').value) || 1, 1, 5) },
      repeat: { mode, days: mode === 'custom' ? customDays.slice().sort((a, b) => a - b) : [] },
      slotPref: $('#taskSlot').value
    };
    if (editingTaskId) Object.assign(taskById(editingTaskId), payload);
    else state.tasks.push(Object.assign({ id: uid() }, payload));
    save(); render(); $('#dlgTask').close();
  });

  // 移动安排
  $('#moveSlot').addEventListener('click', e => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    movingSlot = b.dataset.slot;
    renderMoveSeg();
  });
  $('#moveSave').addEventListener('click', () => {
    const s = state.schedule.find(x => x.id === movingId);
    const date = $('#moveDate').value;
    if (!s || !date) { alert('选一个日期。'); return; }
    s.date = date;
    s.slot = movingSlot;
    const inWeek = weekDates(ui.weekStart).indexOf(date) >= 0;
    save(); render();
    $('#dlgMove').close();
    if (!inWeek) {
      ui.weekStart = mondayOf(parseYmd(date));
      render();
      alert('已挪到 ' + FMT_MD_LONG.format(parseYmd(date)) + '，顺便帮你切到那一周了。');
    }
  });

  // 添加安排弹窗
  $('#pickList').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b || !pickTarget) return;
    state.schedule.push({
      id: uid(), date: pickTarget.date, slot: pickTarget.slot,
      taskId: b.dataset.pick, mode: 'full', result: null
    });
    save(); render(); $('#dlgPick').close();
  });

  // 设置
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnAddType').addEventListener('click', () => {
    const name = $('#newTypeName').value.trim();
    if (!name) { alert('给类型起个名字'); return; }
    draftTypes.push({ key: 'c' + uid(), label: name, color: $('#newTypeColor').value });
    $('#newTypeName').value = '';
    renderTypeList();
  });
  $('#typeList').addEventListener('click', e => {
    const b = e.target.closest('[data-typedel]');
    if (!b) return;
    const i = Number(b.dataset.typedel);
    const t = draftTypes[i];
    const inUse = state.goals.filter(g => g.type === t.key).length;
    if (inUse) { alert('「' + t.label + '」还有 ' + inUse + ' 个目标在用，先把它们改成别的类型。'); return; }
    draftTypes.splice(i, 1);
    renderTypeList();
  });
  $('#settingsSave').addEventListener('click', () => {
    state.settings.types = draftTypes.slice();
    state.settings.budget = {
      morning: clamp(Number($('#budMorning').value) || 1, 1, 30),
      afternoon: clamp(Number($('#budAfternoon').value) || 1, 1, 30),
      evening: clamp(Number($('#budEvening').value) || 1, 1, 30)
    };
    save(); render(); $('#dlgSettings').close();
  });

  // 弹窗关闭按钮
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (!c) return;
    const d = c.closest('dialog');
    if (!d) return;
    if (d.id === 'dlgGuide' && !state.settings.seenGuide) {
      state.settings.seenGuide = true;
      save();
    }
    d.close();
  });
}

/* ========== 示例数据 ========== */
function seedData() {
  state = defaultState();
  const [L, E, X] = state.settings.types.map(t => t.key);
  const g1 = { id: uid(), title: '学韩语', type: L, horizon: '12 周' };
  const g2 = { id: uid(), title: '读完一本书', type: E, horizon: '6 周' };
  const g3 = { id: uid(), title: '浏览行业新闻', type: L, horizon: '长期' };
  const g4 = { id: uid(), title: '创作练习', type: X, horizon: '长期' };
  state.goals.push(g1, g2, g3, g4);
  state.tasks.push(
    { id: uid(), goalId: g1.id, title: '背 20 个单词', full: { minutes: 30, energy: 3 }, mini: { minutes: 8, energy: 1 }, repeat: { mode: 'weekdays', days: [] }, slotPref: 'morning' },
    { id: uid(), goalId: g1.id, title: '听力练习', full: { minutes: 20, energy: 2 }, mini: { minutes: 10, energy: 1 }, repeat: { mode: 'custom', days: [1, 3, 5] }, slotPref: 'evening' },
    { id: uid(), goalId: g2.id, title: '读 20 页', full: { minutes: 40, energy: 2 }, mini: { minutes: 10, energy: 1 }, repeat: { mode: 'daily', days: [] }, slotPref: 'evening' },
    { id: uid(), goalId: g3.id, title: '扫 3 条行业新闻', full: { minutes: 15, energy: 1 }, mini: { minutes: 5, energy: 1 }, repeat: { mode: 'daily', days: [] }, slotPref: 'afternoon' },
    { id: uid(), goalId: g4.id, title: '写一段', full: { minutes: 40, energy: 3 }, mini: { minutes: 15, energy: 2 }, repeat: { mode: 'custom', days: [2, 4, 6] }, slotPref: 'any' }
  );
  const thisMon = mondayOf(new Date());
  generateWeek(addDays(thisMon, -7), { randomResults: true });
  generateWeek(thisMon, {});
}

/* ========== 启动 ========== */
function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab');
  if (tab && ['plan', 'week', 'review'].indexOf(tab) >= 0) ui.tab = tab;
  if (q.get('week') === 'last') ui.weekStart = addDays(mondayOf(new Date()), -7);
  if (q.get('reset') === '1') { state = defaultState(); save(); }
  if (q.get('seed') === '1' && !state.goals.length) seedData();
}

/* 布局自检：加 ?selftest=1 时把关键尺寸写进 DOM，便于回归检查 */
function runSelfTest() {
  const box = el => el ? Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height) : 'none';
  const out = {
    tab: ui.tab,
    grid: box($('.week-grid')),
    cols: $$('.week-grid .wcol').length,
    col: box($('.week-grid .wcol')),
    cards: $$('.task').length,
    card: box($('.task')),
    stats: $$('.stat').length,
    stack: box($('.stack')),
    stackSeg: $$('.stack i').map(x => Math.round(x.getBoundingClientRect().width)),
    vgroups: $$('.vgroup').length,
    barRows: $$('.bar-row').length,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 30),
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    overflowW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    h1: $$('h1').length,
    skipLink: !!$('.skip'),
    labelsBound: $$('label[for]').length,
    iconBtnsNoLabel: $$('button').filter(b =>
      !b.textContent.trim() && !b.getAttribute('aria-label')).length
  };

  // 交互冒烟：模拟点一次「完成」，确认状态和视图都跟着变
  const target = $('.task .task-btns button[data-act="done"]');
  if (target) {
    const sid = target.closest('.task').dataset.sid;
    target.click();
    const item = state.schedule.find(x => x.id === sid);
    out.simResult = item ? item.result : 'missing';
    const card = $('.task[data-sid="' + sid + '"]');
    out.simCardClass = card ? card.className : 'none';
  }

  const pre = document.createElement('pre');
  pre.id = 'selftest';
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
}

bind();
applyUrlParams();
render();
maybeShowGuide();
if (new URLSearchParams(location.search).get('selftest') === '1') runSelfTest();
