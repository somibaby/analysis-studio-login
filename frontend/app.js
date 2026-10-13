/* Analysis Studio — app logic: statistics engine, worksheet, sync and server features. */
(function () {
const ROWH = 30, CW = 112, RNW = 52, VIS = 44;
const KEY = 'analysis-studio-web-v1';
const CFG = window.STUDIO_CONFIG || {};
const SB = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const API = String(CFG.API_URL || '').replace(/\/+$/, '');
const BIG_ROWS = +CFG.BIG_ROWS || 20000;
const SERVER_IDS = new Set(['desc', 't1', 't2', 'tp', 'norm', 'corr', 'fit', 'mreg', 'anova', 'var2', 'imr', 'cap', 'hist', 'scatter', 'box']);
const PCOL = ['#6D4AFF','#00857C','#D93A40','#1F7AE0','#C2410C','#9333EA','#0E7490'];
const CHC = ['#6D4AFF','#2EC4B6','#FF5C5C','#FFB800','#1E8CFF','#F2557A','#8BD450'];
const CATS = {
  basic:{name:'Basic Statistics', short:'Basic Stats', color:'#6D4AFF', ink:'#fff', chart:'#6D4AFF', blurb:'Descriptives, t-tests, normality, correlation'},
  reg:{name:'Regression', short:'Regression', color:'#00857C', ink:'#fff', chart:'#2EC4B6', blurb:'Fitted line plots and multiple regression'},
  anova:{name:'ANOVA', short:'ANOVA', color:'#D93A40', ink:'#fff', chart:'#FF5C5C', blurb:'Compare means and variances across groups'},
  qual:{name:'Quality Tools', short:'Quality', color:'#FFB800', ink:'#17132E', chart:'#FFB800', blurb:'Control charts, capability and Pareto'},
  graph:{name:'Graphs', short:'Graphs', color:'#1F7AE0', ink:'#fff', chart:'#1E8CFF', blurb:'Histograms, scatterplots, boxplots, time series'},
  adv:{name:'Advanced', short:'Advanced', color:'#C8336A', ink:'#fff', chart:'#F2557A', blurb:'Nonparametric, chi-square, 2-way ANOVA, Tukey, Box-Cox, Weibull'},
  data:{name:'Data', short:'Data', color:'#17132E', ink:'#fff', chart:'#17132E', blurb:'Samples, import and export'}
};

/* ---------- maths ---------- */
const ST = (() => {
  const sum = a => { let s = 0; for (const x of a) s += x; return s; };
  const mean = a => sum(a) / a.length;
  const variance = a => { const m = mean(a); let s = 0; for (const x of a) s += (x - m) * (x - m); return s / (a.length - 1); };
  const sd = a => Math.sqrt(variance(a));
  const min = a => { let m = Infinity; for (const x of a) if (x < m) m = x; return m; };
  const max = a => { let m = -Infinity; for (const x of a) if (x > m) m = x; return m; };
  const sorted = a => a.slice().sort((x, y) => x - y);
  const quant = (a, p) => { const s = sorted(a), n = s.length; if (!n) return NaN; const h = (n + 1) * p; if (h <= 1) return s[0]; if (h >= n) return s[n - 1]; const lo = Math.floor(h); return s[lo - 1] + (h - lo) * (s[lo] - s[lo - 1]); };
  const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
  const npdf = z => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const ninv = p => {
    const a = [-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
    const b = [-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
    const c = [-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
    const d = [7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
    const pl = 0.02425; let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q = p - 0.5; r = q * q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  };
  const lgamma = x => {
    const g = 7, c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1; let s = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) s += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
  };
  const betacf = (x, a, b) => {
    const FP = 1e-300; let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FP) d = FP; d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break;
    }
    return h;
  };
  const ibeta = (x, a, b) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(x, a, b) / a : 1 - bt * betacf(1 - x, b, a) / b;
  };
  const tp2 = (t, df) => ibeta(df / (df + t * t), df / 2, 0.5);
  const tinv = (p2, df) => { let lo = 0, hi = 1000; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (tp2(m, df) > p2) lo = m; else hi = m; } return (lo + hi) / 2; };
  const fup = (F, d1, d2) => F <= 0 ? 1 : ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2);
  const inv = M => {
    const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      if (Math.abs(A[p][i]) < 1e-12) throw new Error('Predictors are collinear — remove a duplicate or constant column.');
      [A[i], A[p]] = [A[p], A[i]]; const v = A[i][i]; for (let j = 0; j < 2 * n; j++) A[i][j] /= v;
      for (let k = 0; k < n; k++) if (k !== i) { const f = A[k][i]; for (let j = 0; j < 2 * n; j++) A[k][j] -= f * A[i][j]; }
    }
    return A.map(r => r.slice(n));
  };
  return { sum, mean, variance, sd, min, max, sorted, quant, ncdf, npdf, ninv, tp2, tinv, fup, inv };
})();

const ticks = (lo, hi, n) => {
  n = n || 5; if (!(hi > lo)) { const c = lo || 0; lo = c - 1; hi = c + 1; }
  const step0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const t = []; for (let v = a; v <= b + step * 1e-6; v += step) t.push({ v: +v.toFixed(10), label: (+v.toFixed(10)).toFixed(Math.min(dec, 6)) });
  return { lo: a, hi: b, ticks: t };
};

const mkChart = o => {
  const W = 640, H = 300, L = o.L || 62, R = o.R || 20, T = 22, B = 48;
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const px = x => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R);
  const py = y => H - B - (y - y0) / ((y1 - y0) || 1) * (H - T - B);
  const f = n => (Math.round(n * 10) / 10).toString();
  const ok = p => Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const rects = a => (a || []).map(b => { const xa = px(b.x0), xb = px(b.x1), ya = py(b.y1), yb = py(b.y0); return `M${f(xa)},${f(Math.min(ya, yb))}H${f(xb)}V${f(Math.max(ya, yb))}H${f(xa)}Z`; }).join('');
  const lines = a => (a || []).map(pl => pl.filter(ok).map((p, i) => (i ? 'L' : 'M') + f(px(p[0])) + ',' + f(py(p[1]))).join('')).join('');
  const dots = (a, r) => { r = r || 3.6; return (a || []).filter(ok).map(p => { const x = px(p[0]), y = py(p[1]); return `M${f(x - r)},${f(y)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`; }).join(''); };
  const refs = a => (a || []).map(r => r.y != null ? `M${L},${f(py(r.y))}H${W - R}` : `M${f(px(r.x))},${T}V${H - B}`).join('');
  const P = v => +(v).toFixed(2);
  const labels = [];
  (o.xTicks || []).forEach(t => { if (t.v >= x0 - 1e-9 && t.v <= x1 + 1e-9) labels.push({ text: t.label, x: P(px(t.v) / W * 100), y: P((H - B + 8) / H * 100), cls: 'tk tx' }); });
  (o.yTicks || []).forEach(t => { if (t.v >= y0 - 1e-9 && t.v <= y1 + 1e-9) labels.push({ text: t.label, x: P((L - 8) / W * 100), y: P(py(t.v) / H * 100), cls: 'tk ty' }); });
  (o.rTicks || []).forEach(t => labels.push({ text: t.label, x: P((W - R + 8) / W * 100), y: P(py(t.v) / H * 100), cls: 'tk tyr' }));
  const refLab = (arr, cls) => (arr || []).forEach(r => { if (!r.label) return; if (r.y != null) labels.push({ text: r.label, x: P((W - R - 4) / W * 100), y: P(py(r.y) / H * 100), cls }); else labels.push({ text: r.label, x: P(px(r.x) / W * 100), y: P(T / H * 100), cls: 'tk txr' }); });
  refLab(o.ref, 'tk tr'); refLab(o.ref2, 'tk tr2');
  if (o.xl) labels.push({ text: o.xl, x: P((L + (W - R)) / 2 / W * 100), y: 100, cls: 'tk axl' });
  if (o.yl) labels.push({ text: o.yl, x: 1.6, y: P((T + (H - B)) / 2 / H * 100), cls: 'tk ayl' });
  const grid = (o.yTicks || []).filter(t => t.v >= y0 && t.v <= y1).map(t => `M${L},${f(py(t.v))}H${W - R}`).join('');
  const c1 = o.c1 || '#6D4AFF';
  return {
    title: o.title || '', grid, axis: `M${L},${T}V${H - B}H${W - R}`,
    bars: rects(o.bars), bars2: rects(o.bars2), area: o.area ? lines([o.area]) + 'Z' : '',
    line: lines(o.line), line2: lines(o.line2), dots: dots(o.dots, o.r), dots2: dots(o.dots2, 4.6),
    ref: refs(o.ref), ref2: refs(o.ref2), labels,
    bc: o.bc || c1, b2c: o.b2c || '#FFB800', lc: o.lc || c1, l2c: o.l2c || '#FFB800', dc: o.dc || c1
  };
};

const histData = (a, bins) => {
  const lo = ST.min(a), hi = ST.max(a);
  const k = Math.max(1, Math.min(60, bins || Math.max(5, Math.min(25, Math.ceil(Math.log2(a.length) + 1)))));
  const w = (hi - lo) / k || 1, counts = Array(k).fill(0);
  a.forEach(v => { let i = Math.floor((v - lo) / w); if (i >= k) i = k - 1; if (i < 0) i = 0; counts[i]++; });
  return { lo, w, k, counts };
};

const histChart = (a, o) => {
  const h = histData(a, o.bins), m = ST.mean(a), s = a.length > 1 ? ST.sd(a) : 0;
  let xlo = h.lo, xhi = h.lo + h.w * h.k;
  (o.xs || []).forEach(v => { if (Number.isFinite(v)) { xlo = Math.min(xlo, v); xhi = Math.max(xhi, v); } });
  const pad = (xhi - xlo) * 0.05 || 1, xt = ticks(xlo - pad, xhi + pad, 6);
  const curve = (mu, sg) => { const c = []; if (!(sg > 0)) return c; for (let i = 0; i <= 90; i++) { const x = xt.lo + (xt.hi - xt.lo) * i / 90; c.push([x, a.length * h.w * ST.npdf((x - mu) / sg) / sg]); } return c; };
  const c1 = o.normal ? curve(m, o.sigma || s) : [], c2 = o.sigma2 ? curve(m, o.sigma2) : [];
  const ymax = Math.max(ST.max(h.counts), ...c1.map(p => p[1]), ...c2.map(p => p[1]));
  const yt = ticks(0, ymax * 1.1, 5);
  return mkChart({
    title: o.title, x: [xt.lo, xt.hi], y: [0, yt.hi], xTicks: xt.ticks, yTicks: yt.ticks,
    bars: h.counts.map((c, i) => ({ x0: h.lo + i * h.w + h.w * 0.04, x1: h.lo + (i + 1) * h.w - h.w * 0.04, y0: 0, y1: c })),
    line: [c1], line2: [c2], ref: o.ref, ref2: o.ref2, xl: o.xl, yl: 'Frequency', c1: o.c1, lc: '#17132E', l2c: '#FF5C5C'
  });
};

const boxChart = (groups, o) => {
  const all = [].concat(...groups.map(g => g.a)); const lo = ST.min(all), hi = ST.max(all), pad = (hi - lo) * 0.08 || 1;
  const yt = ticks(lo - pad, hi + pad, 5);
  const bars = [], med = [], wh = [], out = [], mns = [];
  groups.forEach((g, i) => {
    const x = i + 1, s = ST.sorted(g.a), q1 = ST.quant(s, 0.25), q2 = ST.quant(s, 0.5), q3 = ST.quant(s, 0.75), iqr = q3 - q1, lf = q1 - 1.5 * iqr, uf = q3 + 1.5 * iqr;
    const inr = s.filter(v => v >= lf && v <= uf), wl = inr.length ? inr[0] : q1, wu = inr.length ? inr[inr.length - 1] : q3, bw = 0.22;
    bars.push({ x0: x - bw, x1: x + bw, y0: q1, y1: q3 }); med.push([[x - bw, q2], [x + bw, q2]]);
    wh.push([[x, q3], [x, wu]], [[x - 0.08, wu], [x + 0.08, wu]], [[x, q1], [x, wl]], [[x - 0.08, wl], [x + 0.08, wl]]);
    s.forEach(v => { if (v < lf || v > uf) out.push([x, v]); }); mns.push([x, ST.mean(s)]);
  });
  return mkChart({ title: o.title, x: [0.4, groups.length + 0.6], y: [yt.lo, yt.hi], yTicks: yt.ticks, xTicks: groups.map((g, i) => ({ v: i + 1, label: g.name.length > 14 ? g.name.slice(0, 13) + '…' : g.name })), bars, line: wh, line2: med, dots: mns, dots2: out, c1: o.c1, lc: '#7A7496', l2c: '#FFB800', dc: '#17132E', r: 3, yl: o.yl });
};

const scatterChart = (pts, o) => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const px = (ST.max(xs) - ST.min(xs)) * 0.06 || 1, py = (ST.max(ys) - ST.min(ys)) * 0.08 || 1;
  const xt = ticks(ST.min(xs) - px, ST.max(xs) + px, 6), yt = ticks(ST.min(ys) - py, ST.max(ys) + py, 5);
  return mkChart({ title: o.title, x: [xt.lo, xt.hi], y: [yt.lo, yt.hi], xTicks: xt.ticks, yTicks: yt.ticks, dots: pts, line: o.line ? [o.line] : [], ref2: o.ref2, xl: o.xl, yl: o.yl, c1: o.c1, lc: '#17132E', dc: o.c1 });
};

const ctrlChart = (vals, cl, ucl, lcl, o) => {
  const n = vals.length, pts = vals.map((v, i) => [i + 1, v]), ooc = pts.filter(p => p[1] > ucl + 1e-12 || p[1] < lcl - 1e-12);
  const lo = Math.min(ST.min(vals), lcl), hi = Math.max(ST.max(vals), ucl), pad = (hi - lo) * 0.12 || 1;
  const yt = ticks(lo - pad, hi + pad, 5), xt = ticks(1, Math.max(2, n), 8);
  return { chart: mkChart({ title: o.title, x: [0, n + 1], y: [yt.lo, yt.hi], yTicks: yt.ticks, xTicks: xt.ticks.filter(t => t.v >= 1), line: [pts], dots: pts, dots2: ooc,
    ref: [{ y: ucl, label: 'UCL=' + o.f(ucl) }, { y: lcl, label: 'LCL=' + o.f(lcl) }], ref2: [{ y: cl, label: o.clName + '=' + o.f(cl) }], xl: o.xl || 'Observation', yl: o.yl, c1: o.c1, r: 3.2 }), ooc };
};

/* ---------- samples ---------- */
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = r => () => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const SAMPLES = [
  { key: 'panel', name: 'Composite Panel QC', color: '#FFB800', desc: 'Thickness, cure temperature, pressure and shift — 60 panels', make: () => {
    const r = rng(11), g = gauss(r), n = 60, T = [], P = [], th = [], sh = [];
    for (let i = 0; i < n; i++) { const t = 180 + 2.5 * g(), p = 6.9 + 0.15 * g(); T.push(t.toFixed(1)); P.push(p.toFixed(2)); th.push((2.5 + 0.004 * (t - 180) - 0.02 * (p - 6.9) + 0.018 * g()).toFixed(3)); sh.push(['A', 'B', 'C'][i % 3]); }
    return [{ name: 'Thickness', vals: th }, { name: 'Cure Temp', vals: T }, { name: 'Pressure', vals: P }, { name: 'Shift', vals: sh }];
  } },
  { key: 'sales', name: 'Ad Spend vs Sales', color: '#2EC4B6', desc: 'Monthly ad spend, web visits and sales — 40 months', make: () => {
    const r = rng(7), g = gauss(r), sp = [], vi = [], sa = [];
    for (let i = 0; i < 40; i++) { const s = 5 + 45 * r(), v = 800 + 60 * s + 250 * g(); sp.push(s.toFixed(1)); vi.push(Math.round(v) + ''); sa.push((20 + 2.4 * s + 0.012 * v + 9 * g()).toFixed(1)); }
    return [{ name: 'Ad Spend', vals: sp }, { name: 'Visits', vals: vi }, { name: 'Sales', vals: sa }];
  } },
  { key: 'supplier', name: 'Supplier Strength', color: '#FF5C5C', desc: 'Tensile strength from three suppliers — 20 each', make: () => {
    const r = rng(23), g = gauss(r), mk = (m, s) => Array.from({ length: 20 }, () => (m + s * g()).toFixed(1));
    return [{ name: 'Supplier A', vals: mk(52, 3) }, { name: 'Supplier B', vals: mk(55.5, 3.2) }, { name: 'Supplier C', vals: mk(50.5, 2.8) }];
  } },
  { key: 'defects', name: 'Defect Log', color: '#1E8CFF', desc: 'Defect type and repair minutes — 120 records', make: () => {
    const r = rng(5), g = gauss(r), types = [['Voids', 34], ['Delamination', 22], ['Porosity', 17], ['Dry spots', 11], ['Wrinkles', 9], ['Scratches', 7]], tot = 100, d = [], m = [];
    for (let i = 0; i < 120; i++) { let u = r() * tot, k = 0; while (u > types[k][1]) { u -= types[k][1]; k++; } d.push(types[k][0]); m.push(Math.max(5, 25 + 8 * k + 6 * g()).toFixed(0)); }
    return [{ name: 'Defect', vals: d }, { name: 'Repair Min', vals: m }];
  } }
];

/* ---------- analyses ---------- */
const OPT = (key, label, def, ph) => ({ key, label, def, ph: ph || '' });
const ANALYSES = [
  { id: 'desc', cat: 'basic', abbr: 'Σ', name: 'Descriptive Statistics', desc: 'N, mean, StDev, quartiles', slots: [{ key: 'vars', label: 'Variables', multi: true }], opts: [] },
  { id: 't1', cat: 'basic', abbr: '1t', name: '1-Sample t', desc: 'Test a mean against a target', slots: [{ key: 'x', label: 'Sample' }], opts: [OPT('mu', 'Hypothesized mean', '0'), OPT('conf', 'Confidence level %', '95')] },
  { id: 't2', cat: 'basic', abbr: '2t', name: '2-Sample t', desc: 'Compare two independent means', slots: [{ key: 'x', label: 'Sample 1' }, { key: 'y', label: 'Sample 2' }], opts: [OPT('conf', 'Confidence level %', '95')] },
  { id: 'tp', cat: 'basic', abbr: 'Pt', name: 'Paired t', desc: 'Before/after on the same units', slots: [{ key: 'x', label: 'Sample 1' }, { key: 'y', label: 'Sample 2' }], opts: [OPT('conf', 'Confidence level %', '95')] },
  { id: 'norm', cat: 'basic', abbr: 'AD', name: 'Normality Test', desc: 'Anderson–Darling + probability plot', slots: [{ key: 'x', label: 'Variable' }], opts: [] },
  { id: 'corr', cat: 'basic', abbr: 'r', name: 'Correlation', desc: 'Pearson r matrix with p-values', slots: [{ key: 'vars', label: 'Variables (2 or more)', multi: true }], opts: [] },
  { id: 'fit', cat: 'reg', abbr: 'y=x', name: 'Fitted Line Plot', desc: 'Simple linear regression', slots: [{ key: 'y', label: 'Response (Y)' }, { key: 'x', label: 'Predictor (X)' }], opts: [] },
  { id: 'mreg', cat: 'reg', abbr: 'βk', name: 'Multiple Regression', desc: 'One response, many predictors', slots: [{ key: 'y', label: 'Response (Y)' }, { key: 'xs', label: 'Predictors', multi: true }], opts: [] },
  { id: 'anova', cat: 'anova', abbr: 'F', name: 'One-Way ANOVA', desc: 'Compare means of 2+ columns', slots: [{ key: 'vars', label: 'Responses (one column per group)', multi: true }], opts: [] },
  { id: 'var2', cat: 'anova', abbr: 's²', name: '2 Variances', desc: 'F-test for equal spread', slots: [{ key: 'x', label: 'Sample 1' }, { key: 'y', label: 'Sample 2' }], opts: [] },
  { id: 'imr', cat: 'qual', abbr: 'I-MR', name: 'I-MR Chart', desc: 'Individuals & moving range', slots: [{ key: 'x', label: 'Variable' }], opts: [] },
  { id: 'xbar', cat: 'qual', abbr: 'X̄-R', name: 'Xbar-R Chart', desc: 'Subgroup means & ranges', slots: [{ key: 'x', label: 'Variable (in time order)' }], opts: [OPT('n', 'Subgroup size (2–10)', '5')] },
  { id: 'cap', cat: 'qual', abbr: 'Cpk', name: 'Process Capability', desc: 'Cp, Cpk, Pp, Ppk, PPM', slots: [{ key: 'x', label: 'Variable' }], opts: [OPT('lsl', 'Lower spec (LSL)', '', 'optional'), OPT('usl', 'Upper spec (USL)', '', 'optional')] },
  { id: 'six', cat: 'qual', abbr: '6P', name: 'Capability Sixpack', desc: 'Six-panel capability report', slots: [{ key: 'x', label: 'Variable (in time order)' }], opts: [OPT('lsl', 'Lower spec (LSL)', '', 'optional'), OPT('usl', 'Upper spec (USL)', '', 'optional')] },
  { id: 'pareto', cat: 'qual', abbr: '80/20', name: 'Pareto Chart', desc: 'Rank defects by frequency', slots: [{ key: 'cat', label: 'Defect / category column' }, { key: 'cnt', label: 'Counts column (optional)', optional: true }], opts: [] },
  { id: 'hist', cat: 'graph', abbr: 'Hist', name: 'Histogram', desc: 'Distribution with normal fit', slots: [{ key: 'x', label: 'Variable' }], opts: [OPT('bins', 'Number of bins', '', 'auto')] },
  { id: 'scatter', cat: 'graph', abbr: '∴', name: 'Scatterplot', desc: 'Y versus X', slots: [{ key: 'y', label: 'Y variable' }, { key: 'x', label: 'X variable' }], opts: [] },
  { id: 'box', cat: 'graph', abbr: 'Box', name: 'Boxplot', desc: 'Compare spreads side by side', slots: [{ key: 'vars', label: 'Variables', multi: true }], opts: [] },
  { id: 'ts', cat: 'graph', abbr: 'TS', name: 'Time Series Plot', desc: 'Values in run order', slots: [{ key: 'x', label: 'Variable' }], opts: [] },
  { id: 'mw', cat: 'adv', server: true, abbr: 'MW', name: 'Mann-Whitney', desc: 'Compare 2 medians, no normality needed', slots: [{ key: 'x', label: 'Sample 1' }, { key: 'y', label: 'Sample 2' }], opts: [] },
  { id: 'kw', cat: 'adv', server: true, abbr: 'KW', name: 'Kruskal-Wallis', desc: 'Compare 3+ medians', slots: [{ key: 'vars', label: 'Groups (one column each)', multi: true }], opts: [] },
  { id: 'chi', cat: 'adv', server: true, abbr: 'χ²', name: 'Chi-Square Association', desc: 'Are two categories related?', slots: [{ key: 'a', label: 'Category column 1' }, { key: 'b', label: 'Category column 2' }], opts: [] },
  { id: 'anova2', cat: 'adv', server: true, abbr: '2F', name: 'Two-Way ANOVA', desc: 'Two factors + interaction', slots: [{ key: 'y', label: 'Response' }, { key: 'a', label: 'Factor A' }, { key: 'b', label: 'Factor B' }], opts: [] },
  { id: 'tukey', cat: 'adv', server: true, abbr: 'HSD', name: 'Tukey Comparisons', desc: 'Which group means differ?', slots: [{ key: 'vars', label: 'Groups (one column each)', multi: true }], opts: [] },
  { id: 'boxcox', cat: 'adv', server: true, abbr: 'λ', name: 'Box-Cox Transform', desc: 'Make skewed data normal', slots: [{ key: 'x', label: 'Variable (all > 0)' }], opts: [] },
  { id: 'weibull', cat: 'adv', server: true, abbr: 'β', name: 'Weibull Reliability', desc: 'Life data: β, η, B10', slots: [{ key: 'x', label: 'Failure times (all > 0)' }], opts: [] }
];
const XBC = { 2: [1.880, 0, 3.267, 1.128], 3: [1.023, 0, 2.574, 1.693], 4: [0.729, 0, 2.282, 2.059], 5: [0.577, 0, 2.114, 2.326], 6: [0.483, 0, 2.004, 2.534], 7: [0.419, 0.076, 1.924, 2.704], 8: [0.373, 0.136, 1.864, 2.847], 9: [0.337, 0.184, 1.816, 2.970], 10: [0.308, 0.223, 1.777, 3.078] };

const parseNum = v => { if (v == null) return NaN; const s = String(v).trim().replace(/,/g, ''); if (s === '') return NaN; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
const colLen = col => { const v = (col && col.vals) || []; let n = v.length; while (n > 0 && String(v[n - 1] == null ? '' : v[n - 1]).trim() === '') n--; return n; };
const csvParse = text => {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
};
const uid = () => Math.random().toString(36).slice(2, 9);
const ago = t => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString(); };
const mkProject = (name, cols, color) => ({ id: uid(), name, cols: cols || [], outputs: [], updated: Date.now(), color: color || PCOL[Math.floor(Math.random() * PCOL.length)] });

class Component extends DCLogic {
  constructor(props) {
    super(props);
    const s = SAMPLES[0];
    this.embedded = !!(props && props.frameH);
    this.state = { screen: (props && props.startScreen) || 'home', projects: [Object.assign(mkProject(s.name, s.make(), '#C2410C'), { pristine: true })], cur: 0, sel: { r: 0, c: 0 }, rowStart: 0, rowCap: 300, colCap: 14,
      tab: 'basic', split: 'split', dlg: null, theme: 'day', dec: 4, alpha: 0.05, toast: null, sync: { mode: 'connecting', who: '' },
      auth: { show: false, mode: 'signin', email: '', pass: '', msg: '', bad: false, busy: false, user: null }, srv: { ok: null, waking: false }, rep: { email: '', frequency: 'off', busy: false } };
    this.dirty = new Set(); this.gone = new Set(); this.remote = {}; this.fresh = true;
  }
  componentDidMount() {
    try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.projects) && d.projects.length) { this.fresh = false; this.setState({ projects: d.projects, cur: Math.min(d.cur || 0, d.projects.length - 1), theme: d.theme || 'day', dec: d.dec || 4, alpha: d.alpha || 0.05 }); } } } catch (e) {}
    this.checkServer();
    if (!SB) { this.setState({ sync: { mode: 'local', who: '' } }); return; }
    SB.auth.getSession().then(({ data }) => {
      const s = data && data.session;
      if (s) this.startCloud(s.user);
      else { let skip = false; try { skip = localStorage.getItem(KEY + ':local') === '1'; } catch (e) {} this.setState({ sync: { mode: 'local', who: '' }, auth: Object.assign({}, this.state.auth, { show: !skip }) }); }
    });
    SB.auth.onAuthStateChange((evt, session) => {
      if (session && session.user && (!this.uid || this.uid !== session.user.id)) this.startCloud(session.user);
      if (evt === 'SIGNED_OUT') this.stopCloud();
    });
    this._onFocus = () => { if (this.uid) this.loadAll(); };
    window.addEventListener('focus', this._onFocus); window.addEventListener('online', this._onFocus);
  }
  componentDidUpdate(pp, ps) {
    clearTimeout(this._sv);
    this._sv = setTimeout(() => { try { const { projects, cur, theme, dec, alpha } = this.state; localStorage.setItem(KEY, JSON.stringify({ projects, cur, theme, dec, alpha })); } catch (e) {} }, 400);
    if (ps && ps.projects !== this.state.projects && this.state.projects !== this._remoteArr) {
      const prev = {}, now = {};
      ps.projects.forEach(p => { prev[p.id] = p; });
      this.state.projects.forEach(p => { now[p.id] = p; if (prev[p.id] !== p) this.dirty.add(p.id); });
      Object.keys(prev).forEach(id => { if (!now[id]) { this.gone.add(id); this.dirty.delete(id); } });
      this.scheduleFlush();
    }
  }
  componentWillUnmount() { clearTimeout(this._sv); clearTimeout(this._tt); clearTimeout(this._fl); if (this._chan) SB.removeChannel(this._chan); if (this._onFocus) { window.removeEventListener('focus', this._onFocus); window.removeEventListener('online', this._onFocus); } }

  /* ---------- analysis server (Python / FastAPI on Render) ---------- */
  serverReady() { return !!API && this.state.srv.ok === true; }
  async checkServer() {
    if (!API) { this.setState({ srv: { ok: false, waking: false } }); return; }
    this.setState({ srv: { ok: null, waking: true } });
    for (let i = 0; i < 6; i++) {
      try { const r = await fetch(API + '/health', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); this.setState({ srv: { ok: true, waking: false, reports: !!j.reports } }); return; } } catch (e) {}
      await new Promise(res => setTimeout(res, 10000));
    }
    this.setState({ srv: { ok: false, waking: false } });
  }
  async api(path, opts) {
    opts = opts || {};
    if (!SB) throw new Error('Sign-in is not configured for this site.');
    const { data } = await SB.auth.getSession(); const tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('Sign in to use the analysis server.');
    let r; try { r = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + tok }) })); }
    catch (e) { throw new Error('Could not reach the analysis server — it may be waking up, try again in 30 s.'); }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && (typeof j.detail === 'string' ? j.detail : 'Request was rejected')) || ('Server error ' + r.status));
    return j;
  }
  wantServer(def, d) {
    if (def.server) return true;
    if (!SERVER_IDS.has(def.id) || !this.serverReady() || !this.uid) return false;
    const p = this.proj(), idx = [].concat(...Object.values(d.sel).map(v => (Array.isArray(v) ? v : v == null ? [] : [v])));
    return Math.max(0, ...idx.map(i => colLen(p.cols[i]))) >= BIG_ROWS;
  }
  async runServer(def, d) {
    if (!API) return this.say('This test needs the analysis server, which is not set up for this site.');
    if (!this.uid) { this.setState({ auth: Object.assign({}, this.state.auth, { show: true }) }); return this.say('Sign in to run tests on the server'); }
    const p = this.proj(), idx = [].concat(...Object.values(d.sel).map(v => (Array.isArray(v) ? v : v == null ? [] : [v]))), cols = {};
    idx.forEach(i => { const c = p.cols[i] || { name: '', vals: [] }; cols[i] = { name: c.name || 'C' + (i + 1), vals: c.vals.slice(0, colLen(c)) }; });
    this.setState({ dlg: Object.assign({}, d, { busy: true }) }); this.say(this.state.srv.ok ? 'Running on the server…' : 'Waking the server — first run can take ~30 s…');
    try {
      const res = await this.api('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: def.id, cols, sel: d.sel, opt: d.opt, dec: this.state.dec, alpha: this.state.alpha }) });
      res.charts = (res.charts || []).map(mkChart);
      if (!def.server) res.notes = (res.notes || []).concat(['Large worksheet — computed on the analysis server.']);
      this.addOutput(def, res);
    } catch (e) {
      if (!def.server) { try { const res = this.analyze(def, d.sel, d.opt); this.addOutput(def, res); return; } catch (e2) { this.setState({ dlg: Object.assign({}, d, { busy: false }) }); return this.say(e2.message); } }
      this.setState({ dlg: Object.assign({}, d, { busy: false }) }); this.say(e.message);
    }
  }
  async importExcel(file) {
    if (!API) return this.say('Excel import needs the analysis server — save the sheet as CSV instead.');
    if (!this.uid) { this.setState({ auth: Object.assign({}, this.state.auth, { show: true }) }); return this.say('Sign in to import Excel files'); }
    this.say('Reading workbook…');
    try {
      const fd = new FormData(); fd.append('file', file);
      const j = await this.api('/import/excel', { method: 'POST', body: fd });
      const base = file.name.replace(/\.[^.]+$/, ''), added = j.sheets.map(s => mkProject(j.sheets.length > 1 ? `${base} — ${s.name}` : base, s.cols));
      const projects = this.state.projects.concat(added);
      this.setState({ projects, cur: projects.length - 1, screen: 'ws', sel: { r: 0, c: 0 }, rowStart: 0 });
      this.say(`Imported ${added.length} sheet${added.length > 1 ? 's' : ''} as project${added.length > 1 ? 's' : ''}`);
    } catch (e) { this.say(e.message); }
  }

  /* ---------- accounts + cloud sync (Supabase) ---------- */
  setSync(mode) { if (this.state.sync.mode !== mode) this.setState({ sync: Object.assign({}, this.state.sync, { mode }) }); }
  async startCloud(user) {
    this.uid = user.id; this._gotRemote = false; this.remote = {};
    this.setState({ sync: { mode: 'connecting', who: user.email || '' }, auth: Object.assign({}, this.state.auth, { show: false, user: { email: user.email || '' }, pass: '', msg: '' }) });
    if (this._chan) SB.removeChannel(this._chan);
    this._chan = SB.channel('projects-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'projects', filter: 'user_id=eq.' + user.id }, pl => this.fetchOne(pl.new && pl.new.id))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: 'user_id=eq.' + user.id }, pl => this.fetchOne(pl.new && pl.new.id))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'projects' }, pl => { const o = pl.old || {}; if (o.user_id === this.uid && this.remote[o.id]) { delete this.remote[o.id]; this.onRemote(); } })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.setSync('offline'); });
    await this.loadAll();
    this.loadReport();
  }
  stopCloud() {
    if (this._chan) SB.removeChannel(this._chan); this._chan = null; this.uid = null; this.col = null;
    this.setState({ sync: { mode: 'local', who: '' }, auth: Object.assign({}, this.state.auth, { user: null }) });
  }
  async loadAll() {
    if (!this.uid) return;
    const { data, error } = await SB.from('projects').select('id,name,color,cols,updated').eq('user_id', this.uid);
    if (error) { this.setSync('offline'); return; }
    this.remote = {}; (data || []).forEach(r => { this.remote[r.id] = r; });
    this._gotRemote = true; this.onRemote();
  }
  async fetchOne(id) {
    if (!id || !this.uid) return;
    const { data } = await SB.from('projects').select('id,name,color,cols,updated').eq('user_id', this.uid).eq('id', id).maybeSingle();
    if (data) { this.remote[id] = data; this.onRemote(); }
  }
  onRemote() {
    const remote = this.remote || {}, hasRemote = Object.keys(remote).length > 0, out = [];
    this.state.projects.forEach(lp => {
      if (lp.pristine && this.fresh && hasRemote) { this.dirty.delete(lp.id); return; }
      const r = remote[lp.id];
      if (r) {
        if (this.dirty.has(lp.id) || (lp.updated || 0) >= (r.updated || 0)) { out.push(lp.synced ? lp : Object.assign({}, lp, { synced: true })); if ((lp.updated || 0) > (r.updated || 0)) this.dirty.add(lp.id); }
        else out.push(Object.assign({}, lp, { name: r.name, color: r.color, cols: r.cols || [], updated: r.updated, synced: true, pristine: false }));
      } else if (lp.synced && !this.dirty.has(lp.id)) { /* deleted on another device */ }
      else { out.push(lp); this.dirty.add(lp.id); }
    });
    Object.keys(remote).forEach(id => { if (!out.some(p => p.id === id) && !this.gone.has(id)) { const r = remote[id]; out.push({ id, name: r.name, color: r.color, cols: r.cols || [], updated: r.updated, outputs: [], synced: true }); } });
    this.fresh = false;
    if (!out.length) { const s = SAMPLES[0], np = mkProject(s.name, s.make(), '#C2410C'); out.push(np); this.dirty.add(np.id); }
    const curId = (this.state.projects[this.state.cur] || {}).id; let cur = out.findIndex(p => p.id === curId); if (cur < 0) cur = 0;
    this._remoteArr = out;
    this.setState({ projects: out, cur, sync: Object.assign({}, this.state.sync, { mode: this.dirty.size || this.gone.size ? 'saving' : 'synced' }) });
    this.scheduleFlush();
  }
  scheduleFlush() {
    if (!this.uid || !this._gotRemote) return;
    clearTimeout(this._fl);
    if (!this.dirty.size && !this.gone.size) return;
    this.setSync('saving');
    this._fl = setTimeout(() => this.flush(), 900);
  }
  async flush() {
    if (this._flushing) { this._again = true; return; }
    this._flushing = true;
    const ids = Array.from(this.dirty), gone = Array.from(this.gone); this.dirty.clear(); this.gone.clear();
    let failed = false;
    for (const id of gone) { const { error } = await SB.from('projects').delete().eq('user_id', this.uid).eq('id', id); if (error) { failed = true; this.gone.add(id); } else delete this.remote[id]; }
    const rows = ids.map(id => this.state.projects.find(x => x.id === id)).filter(Boolean)
      .map(p => ({ user_id: this.uid, id: p.id, name: p.name || '', color: p.color || '#6D4AFF', cols: p.cols || [], updated: p.updated || Date.now() }));
    for (const row of rows) {
      const { error } = await SB.from('projects').upsert(row, { onConflict: 'user_id,id' });
      if (error) { failed = true; this.dirty.add(row.id); } else this.remote[row.id] = row;
    }
    this._flushing = false;
    if (this._again) { this._again = false; return this.flush(); }
    if (failed) { this.setSync('offline'); clearTimeout(this._fl); this._fl = setTimeout(() => this.flush(), 6000); }
    else this.setSync(this.dirty.size || this.gone.size ? 'saving' : 'synced');
  }
  async syncPin(o, p) {
    if (!this.uid) return;
    if (o.pinned) await SB.from('pins').upsert({ user_id: this.uid, id: o.id, project_id: p.id, project_name: p.name || '', title: o.title, cat: o.cat, verdict: o.verdict || '', vcls: o.vcls || 'info', tables: o.tables || [], notes: o.notes || [], created: o.time || Date.now() }, { onConflict: 'user_id,id' });
    else await SB.from('pins').delete().eq('user_id', this.uid).eq('id', o.id);
  }
  async loadReport() {
    if (!this.uid) return;
    const { data } = await SB.from('report_settings').select('email,frequency').eq('user_id', this.uid).maybeSingle();
    this.setState({ rep: { email: (data && data.email) || (this.state.auth.user && this.state.auth.user.email) || '', frequency: (data && data.frequency) || 'off', busy: false } });
  }
  async saveReport() {
    const r = this.state.rep;
    if (r.frequency !== 'off' && !/^\S+@\S+\.\S+$/.test(r.email)) return this.say('Enter a valid email address');
    const { error } = await SB.from('report_settings').upsert({ user_id: this.uid, email: r.email, frequency: r.frequency }, { onConflict: 'user_id' });
    this.say(error ? 'Could not save — try again' : r.frequency === 'off' ? 'Scheduled reports turned off' : `Reports will be emailed ${r.frequency}`);
  }
  async testReport() {
    await this.saveReport();
    this.setState({ rep: Object.assign({}, this.state.rep, { busy: true }) }); this.say('Building your report…');
    try { const j = await this.api('/reports/test', { method: 'POST' }); this.say(`Report sent to ${j.sent_to} (${j.pins} pinned result${j.pins === 1 ? '' : 's'})`); }
    catch (e) { this.say(e.message); }
    this.setState({ rep: Object.assign({}, this.state.rep, { busy: false }) });
  }
  async authSubmit(kind) {
    const a = this.state.auth, set = o => this.setState({ auth: Object.assign({}, this.state.auth, o) });
    if (!/^\S+@\S+\.\S+$/.test(a.email)) return set({ msg: 'Enter your email address.', bad: true });
    set({ busy: true, msg: '' });
    let res;
    if (kind === 'magic') res = await SB.auth.signInWithOtp({ email: a.email, options: { emailRedirectTo: location.origin + location.pathname } });
    else if (a.mode === 'signup') { if ((a.pass || '').length < 6) return set({ busy: false, msg: 'Use at least 6 characters for the password.', bad: true }); res = await SB.auth.signUp({ email: a.email, password: a.pass, options: { emailRedirectTo: location.origin + location.pathname } }); }
    else res = await SB.auth.signInWithPassword({ email: a.email, password: a.pass });
    if (res.error) return set({ busy: false, msg: res.error.message, bad: true });
    if (kind === 'magic') return set({ busy: false, msg: 'Check your inbox for a sign-in link.', bad: false });
    if (a.mode === 'signup' && !(res.data && res.data.session)) return set({ busy: false, msg: 'Account created — confirm the email we sent, then sign in.', bad: false, mode: 'signin' });
    set({ busy: false });
    try { localStorage.removeItem(KEY + ':local'); } catch (e) {}
  }
  cloudVals() {
    const a = this.state.auth, srv = this.state.srv, r = this.state.rep, signedIn = !!(a.user && this.uid), set = o => this.setState({ auth: Object.assign({}, this.state.auth, o) });
    return {
      auth: { show: !!(SB && a.show), title: a.mode === 'signup' ? 'Create your account' : 'Sign in to Analysis Studio', email: a.email, pass: a.pass,
        hasMsg: !!a.msg, msg: a.msg, msgCls: a.bad ? 'verdict bad' : 'verdict good', submitLabel: a.busy ? 'Please wait…' : a.mode === 'signup' ? 'Create account' : 'Sign in',
        toggleLabel: a.mode === 'signup' ? 'I have an account' : 'Create an account', passAuto: a.mode === 'signup' ? 'new-password' : 'current-password',
        setEmail: e => set({ email: e.target.value }), setPass: e => set({ pass: e.target.value }),
        submit: e => { if (e && e.preventDefault) e.preventDefault(); this.authSubmit('password'); }, magic: () => this.authSubmit('magic'),
        toggle: () => set({ mode: a.mode === 'signup' ? 'signin' : 'signup', msg: '' }),
        skip: () => { try { localStorage.setItem(KEY + ':local', '1'); } catch (e) {} set({ show: false }); } },
      acct: { signedIn, canSignIn: !!SB && !signedIn, line: !SB ? 'Accounts are not set up for this site — everything is saved on this device.' : signedIn ? 'Signed in as ' + a.user.email : 'Not signed in — projects are saved on this device only.',
        signOut: async () => { await SB.auth.signOut(); this.say('Signed out'); }, signIn: () => set({ show: true, msg: '' }) },
      srv: { big: BIG_ROWS.toLocaleString(), color: srv.ok ? '#2EE6C8' : srv.waking ? '#FFB800' : '#A9A3C9', text: !API ? 'Not set up for this site' : srv.ok ? 'Online' : srv.waking ? 'Waking up…' : 'Offline — reload the page to retry' },
      rep: { enabled: signedIn && !!API, disabled: !(signedIn && !!API), why: !API ? 'Needs the analysis server.' : 'Sign in to schedule reports.', email: r.email,
        setEmail: e => this.setState({ rep: Object.assign({}, this.state.rep, { email: e.target.value }) }),
        freqs: ['off', 'weekly', 'monthly'].map(f => ({ label: f.charAt(0).toUpperCase() + f.slice(1), cls: r.frequency === f ? 'on' : '', pick: () => this.setState({ rep: Object.assign({}, this.state.rep, { frequency: f }) }) })),
        save: () => this.saveReport(), test: () => this.testReport(), testLabel: r.busy ? 'Sending…' : 'Send test now' }
    };
  }
  syncView() {
    const s = this.state.sync, who = s.who ? ' · ' + s.who : '';
    return ({
      local: { color: '#A9A3C9', text: 'Saved on this device only', short: 'This device' },
      connecting: { color: '#FFB800', text: 'Connecting to cloud…', short: 'Connecting' },
      saving: { color: '#FFB800', text: 'Saving to cloud…' + who, short: 'Saving…' },
      synced: { color: '#2EE6C8', text: 'Synced' + who, short: 'Synced' },
      offline: { color: '#FF5C5C', text: 'Offline — will retry', short: 'Offline' }
    })[s.mode] || { color: '#A9A3C9', text: 'Saved on this device only', short: 'This device' };
  }

  say(text) { clearTimeout(this._tt); this.setState({ toast: text }); this._tt = setTimeout(() => this.setState({ toast: null }), 2600); }
  proj() { return this.state.projects[this.state.cur]; }
  upd(fn, extra) {
    const projects = this.state.projects.slice(), p = Object.assign({}, projects[this.state.cur]);
    p.cols = p.cols.slice(); p.pristine = false; fn(p); p.updated = Date.now(); projects[this.state.cur] = p;
    this.setState(Object.assign({ projects }, extra || {}));
  }
  setIn(p, r, c, v) {
    while (p.cols.length <= c) p.cols.push({ name: '', vals: [] });
    const col = { name: p.cols[c].name, vals: p.cols[c].vals.slice() };
    while (col.vals.length <= r) col.vals.push('');
    col.vals[r] = v; p.cols[c] = col;
  }
  addProject(p, msg) {
    const projects = this.state.projects.concat([p]);
    this.setState({ projects, cur: projects.length - 1, screen: 'ws', sel: { r: 0, c: 0 }, rowStart: 0 });
    this.say(msg || 'Project created');
  }
  fmt(x) {
    if (x == null || (typeof x === 'number' && !Number.isFinite(x))) return '*';
    if (typeof x !== 'number') return String(x);
    const d = this.state.dec; if (Math.abs(x) >= 1e7 || (Math.abs(x) < Math.pow(10, -d) && x !== 0)) return x.toExponential(3);
    return x.toFixed(d);
  }
  fp(p) { return !Number.isFinite(p) ? '*' : p < 0.001 ? '< 0.001' : p.toFixed(3); }

  exportCsv() {
    const p = this.proj(), cols = p.cols.filter(c => colLen(c) > 0 || c.name);
    if (!cols.length) return this.say('Nothing to export yet');
    const n = Math.max(...cols.map(colLen)), esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [cols.map((c, i) => esc(c.name || 'C' + (i + 1))).join(',')];
    for (let r = 0; r < n; r++) lines.push(cols.map(c => esc(c.vals[r])).join(','));
    try {
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), a = document.createElement('a');
      a.href = url; a.download = (p.name || 'worksheet').replace(/[^\w\- ]+/g, '').trim() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000); this.say('CSV exported');
    } catch (e) { this.say('Export was blocked by the browser'); }
  }
  importFile(e) {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    if (/\.xls[xm]$/i.test(file.name)) { e.target.value = ''; return this.importExcel(file); }
    const rd = new FileReader();
    rd.onload = () => {
      const rows = csvParse(String(rd.result || '')); if (!rows.length) return this.say('That file looks empty');
      const head = rows[0], hasHead = head.some(h => h.trim() !== '' && !Number.isFinite(parseNum(h)));
      const body = hasHead ? rows.slice(1) : rows, w = Math.max(...rows.map(r => r.length));
      const cols = Array.from({ length: w }, (_, j) => ({ name: hasHead ? (head[j] || '').trim() : '', vals: body.map(r => (r[j] == null ? '' : r[j].trim())) }));
      this.addProject(mkProject(file.name.replace(/\.[^.]+$/, ''), cols), `Imported ${body.length} rows × ${w} columns`);
    };
    rd.readAsText(file); e.target.value = '';
  }
  pasteBlock(e) {
    const dt = e.clipboardData || window.clipboardData; if (!dt) return;
    const txt = dt.getData('text'); if (!txt || !/[\t\n]/.test(txt.replace(/\n+$/, ''))) return;
    e.preventDefault();
    let rows = txt.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
    let { r, c } = this.state.sel; let names = null;
    if (r === 0 && rows.length > 1 && rows[0].every(v => v.trim() === '' || !Number.isFinite(parseNum(v))) && rows[1].some(v => Number.isFinite(parseNum(v)))) { names = rows[0]; rows = rows.slice(1); }
    this.upd(p => {
      rows.forEach((row, i) => row.forEach((v, j) => this.setIn(p, r + i, c + j, v.trim())));
      if (names) names.forEach((nm, j) => { this.setIn(p, 0, c + j, p.cols[c + j] ? (p.cols[c + j].vals[0] || '') : ''); p.cols[c + j] = Object.assign({}, p.cols[c + j], { name: nm.trim() }); });
    }, { colCap: Math.max(this.state.colCap, c + Math.max(...rows.map(x => x.length)) + 4) });
    this.say(`Pasted ${rows.length} rows${names ? ' with column names' : ''}`);
  }
  focusCell(r, c, wrap) {
    if (!wrap) return; this.setState({ sel: { r, c } });
    const find = () => wrap.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    const el = find(); if (el) { el.focus(); return; }
    wrap.scrollTop = Math.max(0, (r - 8) * ROWH); setTimeout(() => { const e2 = find(); if (e2) e2.focus(); }, 60);
  }

  /* ---- analysis engine ---- */
  ctx() {
    const p = this.proj(), self = this;
    const col = i => p.cols[i] || { name: '', vals: [] };
    const name = i => col(i).name || 'C' + (i + 1);
    const num = i => { const n = colLen(col(i)), out = []; for (let k = 0; k < n; k++) { const v = parseNum(col(i).vals[k]); if (Number.isFinite(v)) out.push(v); } return out; };
    const missing = i => colLen(col(i)) - num(i).length;
    const pair = (i, j) => { const n = Math.max(colLen(col(i)), colLen(col(j))), a = [], b = []; for (let k = 0; k < n; k++) { const x = parseNum(col(i).vals[k]), y = parseNum(col(j).vals[k]); if (Number.isFinite(x) && Number.isFinite(y)) { a.push(x); b.push(y); } } return [a, b]; };
    const need = (a, n, nm) => { if (a.length < n) throw new Error(`${nm} needs at least ${n} numeric values (found ${a.length}).`); return a; };
    return { p, col, name, num, missing, pair, need, f: x => self.fmt(x), fp: x => self.fp(x), alpha: this.state.alpha };
  }
  analyze(def, sel, opt) {
    const c = this.ctx(), f = c.f, fp = c.fp, A = c.alpha, cc = CATS[def.cat].chart;
    const T = (head, rows) => ({ head, rows });
    const sig = (p, yes, no) => p < A ? { verdict: `p ${fp(p).charAt(0) === '<' ? fp(p) : '= ' + fp(p)} < α = ${A} → ${yes}`, vcls: 'bad' } : { verdict: `p ${fp(p).charAt(0) === '<' ? fp(p) : '= ' + fp(p)} ≥ α = ${A} → ${no}`, vcls: 'good' };
    const conf = () => { const v = parseFloat(opt.conf); if (!(v > 0 && v < 100)) throw new Error('Confidence level must be between 0 and 100.'); return v; };
    switch (def.id) {
      case 'desc': {
        const rows = [], groups = [];
        sel.vars.forEach(i => { const a = c.need(c.num(i), 1, c.name(i)), n = a.length; groups.push({ name: c.name(i), a });
          rows.push([c.name(i), n, c.missing(i), f(ST.mean(a)), f(n > 1 ? ST.sd(a) / Math.sqrt(n) : NaN), f(n > 1 ? ST.sd(a) : NaN), f(ST.min(a)), f(ST.quant(a, 0.25)), f(ST.quant(a, 0.5)), f(ST.quant(a, 0.75)), f(ST.max(a))]); });
        return { tables: [T(['Variable', 'N', 'N*', 'Mean', 'SE Mean', 'StDev', 'Minimum', 'Q1', 'Median', 'Q3', 'Maximum'], rows)], charts: [boxChart(groups, { title: 'Boxplot', c1: cc })], notes: ['N* counts blank or non-numeric cells.'] };
      }
      case 't1': {
        const a = c.need(c.num(sel.x), 2, c.name(sel.x)), mu = parseFloat(opt.mu); if (!Number.isFinite(mu)) throw new Error('Enter a hypothesized mean.');
        const cl = conf(), n = a.length, m = ST.mean(a), s = ST.sd(a), se = s / Math.sqrt(n), df = n - 1, t = (m - mu) / se, p = ST.tp2(Math.abs(t), df), tc = ST.tinv(1 - cl / 100, df);
        return Object.assign({ tables: [T(['Variable', 'N', 'Mean', 'StDev', 'SE Mean', `${cl}% CI for μ`, 'T', 'P'], [[c.name(sel.x), n, f(m), f(s), f(se), `(${f(m - tc * se)}, ${f(m + tc * se)})`, f(t), fp(p)]])],
          charts: [histChart(a, { title: `Histogram of ${c.name(sel.x)} with H₀`, c1: cc, xs: [mu], ref: [{ x: mu, label: 'H₀ μ=' + mu }], ref2: [{ x: m }], xl: c.name(sel.x) })],
          notes: [`H₀: μ = ${mu}   H₁: μ ≠ ${mu}`] }, sig(p, `the mean differs from ${mu}`, `no evidence the mean differs from ${mu}`));
      }
      case 't2': {
        const a = c.need(c.num(sel.x), 2, c.name(sel.x)), b = c.need(c.num(sel.y), 2, c.name(sel.y)), cl = conf();
        const n1 = a.length, n2 = b.length, m1 = ST.mean(a), m2 = ST.mean(b), v1 = ST.variance(a), v2 = ST.variance(b), se = Math.sqrt(v1 / n1 + v2 / n2);
        const df = Math.pow(v1 / n1 + v2 / n2, 2) / (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1)), t = (m1 - m2) / se, p = ST.tp2(Math.abs(t), df), tc = ST.tinv(1 - cl / 100, df), d = m1 - m2;
        return Object.assign({ tables: [T(['Sample', 'N', 'Mean', 'StDev', 'SE Mean'], [[c.name(sel.x), n1, f(m1), f(Math.sqrt(v1)), f(Math.sqrt(v1 / n1))], [c.name(sel.y), n2, f(m2), f(Math.sqrt(v2)), f(Math.sqrt(v2 / n2))]]),
          T(['Difference', `${cl}% CI`, 'T', 'DF', 'P'], [[f(d), `(${f(d - tc * se)}, ${f(d + tc * se)})`, f(t), Math.floor(df), fp(p)]])],
          charts: [boxChart([{ name: c.name(sel.x), a }, { name: c.name(sel.y), a: b }], { title: 'Boxplot of samples', c1: cc })], notes: ['Welch test — equal variances not assumed. H₀: μ₁ − μ₂ = 0'] }, sig(p, 'the two means differ', 'no evidence the means differ'));
      }
      case 'tp': {
        const pr = c.pair(sel.x, sel.y), d = c.need(pr[0].map((v, i) => v - pr[1][i]), 2, 'Paired data'), cl = conf();
        const n = d.length, m = ST.mean(d), s = ST.sd(d), se = s / Math.sqrt(n), t = m / se, p = ST.tp2(Math.abs(t), n - 1), tc = ST.tinv(1 - cl / 100, n - 1);
        return Object.assign({ tables: [T(['Sample', 'N', 'Mean', 'StDev', 'SE Mean'], [[c.name(sel.x), n, f(ST.mean(pr[0])), f(ST.sd(pr[0])), f(ST.sd(pr[0]) / Math.sqrt(n))], [c.name(sel.y), n, f(ST.mean(pr[1])), f(ST.sd(pr[1])), f(ST.sd(pr[1]) / Math.sqrt(n))], ['Difference', n, f(m), f(s), f(se)]]),
          T([`${cl}% CI for μ diff`, 'T', 'P'], [[`(${f(m - tc * se)}, ${f(m + tc * se)})`, f(t), fp(p)]])],
          charts: [histChart(d, { title: 'Histogram of differences', c1: cc, xs: [0], ref: [{ x: 0, label: 'H₀ = 0' }], xl: 'Difference' })], notes: ['Only rows with numbers in both columns are paired.'] }, sig(p, 'there is a real mean difference', 'no evidence of a mean difference'));
      }
      case 'norm': {
        const a = c.need(c.num(sel.x), 8, c.name(sel.x)), n = a.length, m = ST.mean(a), s = ST.sd(a), z = ST.sorted(a).map(v => (v - m) / s);
        let S = 0; for (let i = 0; i < n; i++) { const F1 = Math.min(Math.max(ST.ncdf(z[i]), 1e-15), 1 - 1e-15), F2 = Math.min(Math.max(ST.ncdf(z[n - 1 - i]), 1e-15), 1 - 1e-15); S += (2 * i + 1) * (Math.log(F1) + Math.log(1 - F2)); }
        const A2 = -n - S / n, As = A2 * (1 + 0.75 / n + 2.25 / (n * n));
        let p = As < 0.2 ? 1 - Math.exp(-13.436 + 101.14 * As - 223.73 * As * As) : As < 0.34 ? 1 - Math.exp(-8.318 + 42.796 * As - 59.938 * As * As) : As < 0.6 ? Math.exp(0.9177 - 4.279 * As - 1.38 * As * As) : Math.exp(1.2937 - 5.709 * As + 0.0186 * As * As);
        p = Math.min(1, Math.max(0, p));
        const srt = ST.sorted(a), pts = srt.map((v, i) => [v, ST.ninv((i + 1 - 0.3) / (n + 0.4))]), zr = ST.ninv(0.5 / (n + 0.4)), zh = -zr;
        const lo = Math.min(srt[0], m + s * zr), hi = Math.max(srt[n - 1], m + s * zh), pad = (hi - lo) * 0.05, xt = ticks(lo - pad, hi + pad, 6);
        const yT = [1, 5, 10, 20, 30, 50, 70, 80, 90, 95, 99].map(q => ({ v: ST.ninv(q / 100), label: q + '' })).filter(t => t.v >= zr - 0.4 && t.v <= zh + 0.4);
        const ch = mkChart({ title: `Probability plot of ${c.name(sel.x)} — Normal`, x: [xt.lo, xt.hi], y: [zr - 0.3, zh + 0.3], xTicks: xt.ticks, yTicks: yT, dots: pts, line: [[[m + s * (zr - 0.3), zr - 0.3], [m + s * (zh + 0.3), zh + 0.3]]], c1: cc, lc: '#FF5C5C', xl: c.name(sel.x), yl: 'Percent' });
        return Object.assign({ tables: [T(['Variable', 'N', 'Mean', 'StDev', 'AD', 'P'], [[c.name(sel.x), n, f(m), f(s), f(A2), p < 0.005 ? '< 0.005' : p.toFixed(3)]])], charts: [ch], notes: ['H₀: data follow a normal distribution.'] }, sig(p, 'data are NOT normal', 'consistent with a normal distribution'));
      }
      case 'corr': {
        if (sel.vars.length < 2) throw new Error('Pick at least two variables.');
        const head = [''].concat(sel.vars.map(c.name)), rows = [];
        sel.vars.forEach(i => { const rr = [c.name(i)], pr = [' p-value']; sel.vars.forEach(j => { if (i === j) { rr.push('1'); pr.push(''); return; } const [a, b] = c.pair(i, j), n = a.length; if (n < 3) { rr.push('*'); pr.push('*'); return; } const ma = ST.mean(a), mb = ST.mean(b); let sab = 0, saa = 0, sbb = 0; for (let k = 0; k < n; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) ** 2; sbb += (b[k] - mb) ** 2; } const r = sab / Math.sqrt(saa * sbb), t = r * Math.sqrt((n - 2) / Math.max(1e-15, 1 - r * r)); rr.push(r.toFixed(3)); pr.push(fp(ST.tp2(Math.abs(t), n - 2))); }); rows.push(rr, pr); });
        const [a, b] = c.pair(sel.vars[1], sel.vars[0]);
        return { tables: [T(head, rows)], charts: a.length > 1 ? [scatterChart(a.map((v, k) => [v, b[k]]), { title: `${c.name(sel.vars[0])} vs ${c.name(sel.vars[1])}`, c1: cc, xl: c.name(sel.vars[1]), yl: c.name(sel.vars[0]) })] : [], notes: ['Pearson correlation; p-value tests H₀: ρ = 0. |r| near 1 = strong linear relationship.'] };
      }
      case 'fit': {
        const [x, y] = c.pair(sel.x, sel.y); c.need(x, 3, 'Paired X/Y');
        const n = x.length, mx = ST.mean(x), my = ST.mean(y); let sxx = 0, sxy = 0, syy = 0; for (let k = 0; k < n; k++) { sxx += (x[k] - mx) ** 2; sxy += (x[k] - mx) * (y[k] - my); syy += (y[k] - my) ** 2; }
        if (sxx === 0) throw new Error('The predictor is constant.');
        const b1 = sxy / sxx, b0 = my - b1 * mx, sse = y.reduce((s, v, k) => s + (v - b0 - b1 * x[k]) ** 2, 0), ssr = syy - sse, mse = sse / (n - 2), S = Math.sqrt(mse);
        const r2 = ssr / syy, r2a = 1 - (1 - r2) * (n - 1) / (n - 2), se1 = S / Math.sqrt(sxx), se0 = S * Math.sqrt(1 / n + mx * mx / sxx), t1 = b1 / se1, t0 = b0 / se0, F = ssr / mse, pF = ST.fup(F, 1, n - 2);
        const xl = ST.min(x), xh = ST.max(x), fits = x.map(v => b0 + b1 * v), res = y.map((v, k) => v - fits[k]);
        return Object.assign({ tables: [T(['Term', 'Coef', 'SE Coef', 'T', 'P'], [['Constant', f(b0), f(se0), f(t0), fp(ST.tp2(Math.abs(t0), n - 2))], [c.name(sel.x), f(b1), f(se1), f(t1), fp(ST.tp2(Math.abs(t1), n - 2))]]),
          T(['S', 'R-sq', 'R-sq(adj)'], [[f(S), (r2 * 100).toFixed(2) + '%', (r2a * 100).toFixed(2) + '%']]),
          T(['Source', 'DF', 'SS', 'MS', 'F', 'P'], [['Regression', 1, f(ssr), f(ssr), f(F), fp(pF)], ['Error', n - 2, f(sse), f(mse), '', ''], ['Total', n - 1, f(syy), '', '', '']])],
          charts: [scatterChart(x.map((v, k) => [v, y[k]]), { title: 'Fitted line plot', c1: cc, line: [[xl, b0 + b1 * xl], [xh, b0 + b1 * xh]], xl: c.name(sel.x), yl: c.name(sel.y) }),
            scatterChart(fits.map((v, k) => [v, res[k]]), { title: 'Residuals versus fits', c1: '#6D4AFF', ref2: [{ y: 0 }], xl: 'Fitted value', yl: 'Residual' })],
          notes: [`Regression equation: ${c.name(sel.y)} = ${f(b0)} ${b1 < 0 ? '−' : '+'} ${f(Math.abs(b1))} × ${c.name(sel.x)}`] }, sig(pF, `${c.name(sel.x)} significantly predicts ${c.name(sel.y)}`, 'the linear relationship is not significant'));
      }
      case 'mreg': {
        const xs = sel.xs.filter(i => i !== sel.y); if (!xs.length) throw new Error('Pick at least one predictor different from the response.');
        const idx = [sel.y].concat(xs), N = Math.max(...idx.map(i => colLen(c.col(i)))), X = [], Y = [];
        for (let k = 0; k < N; k++) { const vals = idx.map(i => parseNum(c.col(i).vals[k])); if (vals.every(Number.isFinite)) { Y.push(vals[0]); X.push([1].concat(vals.slice(1))); } }
        const n = Y.length, pk = xs.length + 1; if (n <= pk + 1) throw new Error(`Need more complete rows than ${pk + 1} (found ${n}).`);
        const XtX = Array.from({ length: pk }, (_, i) => Array.from({ length: pk }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
        const Xty = Array.from({ length: pk }, (_, i) => X.reduce((s, r, k) => s + r[i] * Y[k], 0)), Inv = ST.inv(XtX), beta = Inv.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
        const fits = X.map(r => r.reduce((s, v, j) => s + v * beta[j], 0)), res = Y.map((v, k) => v - fits[k]), my = ST.mean(Y);
        const sse = res.reduce((s, v) => s + v * v, 0), sst = Y.reduce((s, v) => s + (v - my) ** 2, 0), ssr = sst - sse, dfe = n - pk, mse = sse / dfe, F = (ssr / (pk - 1)) / mse, pF = ST.fup(F, pk - 1, dfe);
        const r2 = ssr / sst, r2a = 1 - (1 - r2) * (n - 1) / dfe, names = ['Constant'].concat(xs.map(c.name));
        const coef = beta.map((b, j) => { const se = Math.sqrt(mse * Inv[j][j]), t = b / se; return [names[j], f(b), f(se), f(t), fp(ST.tp2(Math.abs(t), dfe))]; });
        return Object.assign({ tables: [T(['Term', 'Coef', 'SE Coef', 'T', 'P'], coef), T(['S', 'R-sq', 'R-sq(adj)', 'N'], [[f(Math.sqrt(mse)), (r2 * 100).toFixed(2) + '%', (r2a * 100).toFixed(2) + '%', n]]),
          T(['Source', 'DF', 'SS', 'MS', 'F', 'P'], [['Regression', pk - 1, f(ssr), f(ssr / (pk - 1)), f(F), fp(pF)], ['Error', dfe, f(sse), f(mse), '', ''], ['Total', n - 1, f(sst), '', '', '']])],
          charts: [scatterChart(fits.map((v, k) => [v, res[k]]), { title: 'Residuals versus fits', c1: cc, ref2: [{ y: 0 }], xl: 'Fitted value', yl: 'Residual' }), histChart(res, { title: 'Histogram of residuals', c1: '#6D4AFF', normal: true, xl: 'Residual' })],
          notes: [`${c.name(sel.y)} = ${beta.map((b, j) => (j ? (b < 0 ? ' − ' : ' + ') + f(Math.abs(b)) + ' ' + names[j] : f(b))).join('')}`] }, sig(pF, 'the model explains significant variation', 'the model is not significant overall'));
      }
      case 'anova': {
        if (sel.vars.length < 2) throw new Error('Pick at least two columns (one per group).');
        const g = sel.vars.map(i => ({ name: c.name(i), a: c.need(c.num(i), 2, c.name(i)) })), all = [].concat(...g.map(x => x.a)), N = all.length, k = g.length, gm = ST.mean(all);
        const ssb = g.reduce((s, x) => s + x.a.length * (ST.mean(x.a) - gm) ** 2, 0), ssw = g.reduce((s, x) => s + x.a.reduce((t, v) => t + (v - ST.mean(x.a)) ** 2, 0), 0);
        const dfb = k - 1, dfw = N - k, msb = ssb / dfb, msw = ssw / dfw, F = msb / msw, p = ST.fup(F, dfb, dfw), sp = Math.sqrt(msw), tc = ST.tinv(0.05, dfw);
        return Object.assign({ tables: [T(['Source', 'DF', 'SS', 'MS', 'F', 'P'], [['Factor', dfb, f(ssb), f(msb), f(F), fp(p)], ['Error', dfw, f(ssw), f(msw), '', ''], ['Total', N - 1, f(ssb + ssw), '', '', '']]),
          T(['Level', 'N', 'Mean', 'StDev', '95% CI (pooled)'], g.map(x => { const m = ST.mean(x.a), h = tc * sp / Math.sqrt(x.a.length); return [x.name, x.a.length, f(m), f(ST.sd(x.a)), `(${f(m - h)}, ${f(m + h)})`]; })),
          T(['S (pooled)', 'R-sq'], [[f(sp), (ssb / (ssb + ssw) * 100).toFixed(2) + '%']])],
          charts: [boxChart(g, { title: 'Boxplot by group (● = mean)', c1: cc })], notes: ['H₀: all group means are equal. Columns are treated as unstacked groups.'] }, sig(p, 'at least one group mean differs', 'no evidence the group means differ'));
      }
      case 'var2': {
        const a = c.need(c.num(sel.x), 2, c.name(sel.x)), b = c.need(c.num(sel.y), 2, c.name(sel.y)), v1 = ST.variance(a), v2 = ST.variance(b), F = v1 / v2, up = ST.fup(F, a.length - 1, b.length - 1), p = Math.min(1, 2 * Math.min(up, 1 - up));
        return Object.assign({ tables: [T(['Sample', 'N', 'StDev', 'Variance'], [[c.name(sel.x), a.length, f(Math.sqrt(v1)), f(v1)], [c.name(sel.y), b.length, f(Math.sqrt(v2)), f(v2)]]), T(['Ratio σ₁²/σ₂²', 'F', 'DF1', 'DF2', 'P'], [[f(F), f(F), a.length - 1, b.length - 1, fp(p)]])],
          charts: [boxChart([{ name: c.name(sel.x), a }, { name: c.name(sel.y), a: b }], { title: 'Boxplot of samples', c1: cc })], notes: ['F-test assumes normal data. H₀: σ₁ = σ₂'] }, sig(p, 'the variances differ', 'no evidence the variances differ'));
      }
      case 'imr': {
        const a = c.need(c.num(sel.x), 3, c.name(sel.x)), mr = a.slice(1).map((v, i) => Math.abs(v - a[i])), mrb = ST.mean(mr), m = ST.mean(a), sw = mrb / 1.128;
        const I = ctrlChart(a, m, m + 3 * sw, m - 3 * sw, { title: `I chart of ${c.name(sel.x)}`, f, clName: 'X̄', c1: cc, yl: 'Individual value' });
        const M = ctrlChart(mr, mrb, 3.267 * mrb, 0, { title: 'Moving range chart', f, clName: 'M̄R', c1: '#6D4AFF', yl: 'Moving range' });
        M.chart.labels.forEach(l => { if (l.cls === 'tk tx') l.text = String(+l.text + 1); });
        const nI = I.ooc.length, nM = M.ooc.length;
        return { verdict: nI + nM ? `${nI + nM} point(s) beyond control limits → process shows special-cause variation` : 'All points within control limits → process looks stable', vcls: nI + nM ? 'bad' : 'good',
          tables: [T(['Chart', 'Center', 'UCL', 'LCL', 'Points out'], [['Individuals', f(m), f(m + 3 * sw), f(m - 3 * sw), nI], ['Moving range', f(mrb), f(3.267 * mrb), f(0), nM]])], charts: [I.chart, M.chart],
          notes: [`Within-subgroup σ estimated as M̄R / 1.128 = ${f(sw)}. ${nI ? 'Out-of-control observations: ' + I.ooc.map(p => p[0]).join(', ') + '.' : ''}`] };
      }
      case 'xbar': {
        const a = c.need(c.num(sel.x), 4, c.name(sel.x)), n = parseInt(opt.n, 10); if (!XBC[n]) throw new Error('Subgroup size must be between 2 and 10.');
        const k = Math.floor(a.length / n); if (k < 2) throw new Error(`Need at least ${2 * n} values for subgroups of ${n}.`);
        const xb = [], R = []; for (let i = 0; i < k; i++) { const s = a.slice(i * n, i * n + n); xb.push(ST.mean(s)); R.push(ST.max(s) - ST.min(s)); }
        const [A2, D3, D4, d2] = XBC[n], xbb = ST.mean(xb), rb = ST.mean(R);
        const X = ctrlChart(xb, xbb, xbb + A2 * rb, xbb - A2 * rb, { title: `Xbar chart of ${c.name(sel.x)}`, f, clName: 'X̿', c1: cc, xl: 'Subgroup', yl: 'Sample mean' });
        const Rc = ctrlChart(R, rb, D4 * rb, D3 * rb, { title: 'R chart', f, clName: 'R̄', c1: '#6D4AFF', xl: 'Subgroup', yl: 'Sample range' });
        const out = X.ooc.length + Rc.ooc.length;
        return { verdict: out ? `${out} subgroup(s) beyond control limits → investigate special causes` : 'All subgroups within limits → process in statistical control', vcls: out ? 'bad' : 'good',
          tables: [T(['Chart', 'Center', 'UCL', 'LCL'], [['Xbar', f(xbb), f(xbb + A2 * rb), f(xbb - A2 * rb)], ['Range', f(rb), f(D4 * rb), f(D3 * rb)]]), T(['Subgroups', 'Size', 'σ within (R̄/d₂)', 'Unused values'], [[k, n, f(rb / d2), a.length - k * n]])], charts: [X.chart, Rc.chart], notes: ['Values are grouped consecutively in worksheet order.'] };
      }
      case 'cap': {
        const a = c.need(c.num(sel.x), 5, c.name(sel.x)), L = opt.lsl === '' ? NaN : parseFloat(opt.lsl), U = opt.usl === '' ? NaN : parseFloat(opt.usl);
        if (!Number.isFinite(L) && !Number.isFinite(U)) throw new Error('Enter at least one spec limit (LSL or USL).');
        if (Number.isFinite(L) && Number.isFinite(U) && L >= U) throw new Error('LSL must be below USL.');
        const n = a.length, m = ST.mean(a), so = ST.sd(a), mr = a.slice(1).map((v, i) => Math.abs(v - a[i])), sw = ST.mean(mr) / 1.128;
        const idx = (s) => { const cpu = Number.isFinite(U) ? (U - m) / (3 * s) : NaN, cpl = Number.isFinite(L) ? (m - L) / (3 * s) : NaN; return { cp: Number.isFinite(U) && Number.isFinite(L) ? (U - L) / (6 * s) : NaN, cpu, cpl, cpk: Math.min(Number.isFinite(cpu) ? cpu : Infinity, Number.isFinite(cpl) ? cpl : Infinity) }; };
        const W = idx(sw), O = idx(so), obs = a.filter(v => (Number.isFinite(L) && v < L) || (Number.isFinite(U) && v > U)).length;
        const exp = ((Number.isFinite(L) ? ST.ncdf((L - m) / so) : 0) + (Number.isFinite(U) ? 1 - ST.ncdf((U - m) / so) : 0)) * 1e6;
        const refs = []; if (Number.isFinite(L)) refs.push({ x: L, label: 'LSL' }); if (Number.isFinite(U)) refs.push({ x: U, label: 'USL' });
        const good = W.cpk >= 1.33;
        return { verdict: `Cpk = ${W.cpk.toFixed(2)} → ${W.cpk >= 1.33 ? 'capable (≥ 1.33)' : W.cpk >= 1 ? 'marginal (1.00–1.33)' : 'not capable (< 1.00)'}`, vcls: good ? 'good' : 'bad',
          tables: [T(['', 'LSL', 'USL', 'N', 'Mean', 'StDev (within)', 'StDev (overall)'], [['Process', Number.isFinite(L) ? f(L) : '*', Number.isFinite(U) ? f(U) : '*', n, f(m), f(sw), f(so)]]),
            T(['Index', 'Cp', 'CPL', 'CPU', 'Cpk'], [['Within', ...[W.cp, W.cpl, W.cpu, W.cpk].map(v => Number.isFinite(v) ? v.toFixed(2) : '*')], ['Overall (Pp)', ...[O.cp, O.cpl, O.cpu, O.cpk].map(v => Number.isFinite(v) ? v.toFixed(2) : '*')]]),
            T(['Performance', 'PPM total'], [['Observed', Math.round(obs / n * 1e6).toLocaleString()], ['Expected overall', Math.round(exp).toLocaleString()]])],
          charts: [histChart(a, { title: `Capability histogram of ${c.name(sel.x)}`, c1: cc, normal: true, sigma: sw, sigma2: so, xs: [L, U], ref: refs, xl: c.name(sel.x) })],
          notes: ['Black curve = within (short-term) fit, coral curve = overall fit. Within σ uses M̄R / 1.128.'] };
      }
      case 'six': {
        const a = c.need(c.num(sel.x), 8, c.name(sel.x));
        const I = this.analyze({ id: 'imr', cat: 'qual' }, sel, opt), C = this.analyze({ id: 'cap', cat: 'qual' }, sel, opt), N = this.analyze({ id: 'norm', cat: 'qual' }, sel, opt);
        const L = opt.lsl === '' ? NaN : parseFloat(opt.lsl), U = opt.usl === '' ? NaN : parseFloat(opt.usl);
        const m = ST.mean(a), so = ST.sd(a), sw = ST.mean(a.slice(1).map((v, i) => Math.abs(v - a[i]))) / 1.128;
        /* last 25 observations */
        const off = Math.max(0, a.length - 25), last = a.slice(off).map((v, i) => [off + i + 1, v]);
        const lp = (ST.max(last.map(p => p[1])) - ST.min(last.map(p => p[1]))) * 0.12 || 1, lyt = ticks(ST.min(last.map(p => p[1])) - lp, ST.max(last.map(p => p[1])) + lp, 5), lxt = ticks(off + 1, a.length, 6);
        const lastCh = mkChart({ title: 'Last 25 observations', x: [off, a.length + 1], y: [lyt.lo, lyt.hi], xTicks: lxt.ticks.filter(t => t.v > off), yTicks: lyt.ticks, line: [last], dots: last, ref2: [{ y: m, label: 'Mean' }], c1: '#1E8CFF', r: 3.4, xl: 'Observation', yl: 'Value' });
        /* capability plot: within, overall, specs as intervals */
        const rowsI = [{ y: 3, lo: m - 3 * sw, hi: m + 3 * sw }, { y: 2, lo: m - 3 * so, hi: m + 3 * so }];
        const sLo = Number.isFinite(L) ? L : m - 3 * so, sHi = Number.isFinite(U) ? U : m + 3 * so;
        const all = [rowsI[0].lo, rowsI[0].hi, rowsI[1].lo, rowsI[1].hi, sLo, sHi], pad = (ST.max(all) - ST.min(all)) * 0.08, xt = ticks(ST.min(all) - pad, ST.max(all) + pad, 6);
        const capCh = mkChart({ title: 'Capability plot', x: [xt.lo, xt.hi], y: [0.4, 3.6], xTicks: xt.ticks, yTicks: [{ v: 3, label: 'Within' }, { v: 2, label: 'Overall' }, { v: 1, label: 'Specs' }], L: 70,
          bars: rowsI.map(r => ({ x0: r.lo, x1: r.hi, y0: r.y - 0.16, y1: r.y + 0.16 })), bars2: [{ x0: sLo, x1: sHi, y0: 0.84, y1: 1.16 }],
          dots: rowsI.map(r => [m, r.y]), ref: [Number.isFinite(L) ? { x: L, label: 'LSL' } : null, Number.isFinite(U) ? { x: U, label: 'USL' } : null].filter(Boolean),
          c1: '#FFB800', b2c: '#D93A40', dc: '#17132E', r: 4.5 });
        const charts = [I.charts[0], I.charts[1], lastCh, C.charts[0], N.charts[0], capCh];
        const nt = N.tables[0].rows[0];
        return { verdict: `${C.verdict}  ·  ${I.vcls === 'bad' ? 'not in control' : 'in control'}  ·  normality p = ${nt[5]}`, vcls: C.vcls === 'good' && I.vcls === 'good' && N.vcls === 'good' ? 'good' : 'bad',
          tables: C.tables.slice(0, 2), charts,
          notes: ['Read it like Minitab: check stability first (I and MR charts, last 25), then normality (probability plot), then capability (histogram, capability plot).', ...(I.notes || [])] };
      }
      case 'pareto': {
        const catc = c.col(sel.cat), n = colLen(catc), agg = {};
        for (let k = 0; k < n; k++) { const key = String(catc.vals[k] == null ? '' : catc.vals[k]).trim(); if (!key) continue; const w = sel.cnt != null ? parseNum(c.col(sel.cnt).vals[k]) : 1; if (!Number.isFinite(w)) continue; agg[key] = (agg[key] || 0) + w; }
        let items = Object.entries(agg).sort((x, y) => y[1] - x[1]); if (!items.length) throw new Error('No categories found.');
        if (items.length > 12) { const rest = items.slice(11).reduce((s, x) => s + x[1], 0); items = items.slice(0, 11).concat([['Other', rest]]); }
        const tot = items.reduce((s, x) => s + x[1], 0); let cum = 0; const line = [], rows = [];
        items.forEach((it, i) => { cum += it[1]; line.push([i + 1, cum]); rows.push([it[0], f2(it[1]), (it[1] / tot * 100).toFixed(1) + '%', (cum / tot * 100).toFixed(1) + '%']); });
        function f2(v) { return Number.isInteger(v) ? String(v) : f(v); }
        const yt = ticks(0, tot, 5);
        const ch = mkChart({ title: `Pareto chart of ${c.name(sel.cat)}`, x: [0.4, items.length + 0.6], y: [0, tot], R: 52, yTicks: yt.ticks.filter(t => t.v <= tot), rTicks: [0, 25, 50, 75, 100].map(q => ({ v: tot * q / 100, label: q + '%' })),
          xTicks: items.map((it, i) => ({ v: i + 1, label: it[0].length > 9 ? it[0].slice(0, 8) + '…' : it[0] })), bars: items.map((it, i) => ({ x0: i + 0.62, x1: i + 1.38, y0: 0, y1: it[1] })), line: [line], dots: line, c1: cc, lc: '#17132E', dc: '#17132E', ref: [{ y: tot * 0.8, label: '80%' }], yl: 'Count' });
        const k80 = line.findIndex(p => p[1] >= tot * 0.8) + 1;
        return { verdict: `${k80} of ${items.length} categories cause 80% of the total — start there`, vcls: 'info', tables: [T(['Category', 'Count', 'Percent', 'Cum %'], rows)], charts: [ch], notes: [sel.cnt != null ? `Counts summed from ${c.name(sel.cnt)}.` : 'Counts are occurrences of each category.'] };
      }
      case 'hist': {
        const a = c.need(c.num(sel.x), 2, c.name(sel.x)), bins = parseInt(opt.bins, 10);
        return { tables: [T(['Variable', 'N', 'Mean', 'StDev', 'Min', 'Max'], [[c.name(sel.x), a.length, f(ST.mean(a)), f(ST.sd(a)), f(ST.min(a)), f(ST.max(a))]])], charts: [histChart(a, { title: `Histogram of ${c.name(sel.x)}`, c1: cc, normal: true, bins: bins > 0 ? bins : 0, xl: c.name(sel.x) })], notes: ['Black curve: fitted normal distribution.'] };
      }
      case 'scatter': {
        const [x, y] = c.pair(sel.x, sel.y); c.need(x, 2, 'Paired X/Y');
        return { tables: [T(['Pairs', 'Mean X', 'Mean Y'], [[x.length, f(ST.mean(x)), f(ST.mean(y))]])], charts: [scatterChart(x.map((v, k) => [v, y[k]]), { title: `Scatterplot of ${c.name(sel.y)} vs ${c.name(sel.x)}`, c1: cc, xl: c.name(sel.x), yl: c.name(sel.y) })], notes: [] };
      }
      case 'box': {
        const g = sel.vars.map(i => ({ name: c.name(i), a: c.need(c.num(i), 1, c.name(i)) }));
        return { tables: [T(['Variable', 'Q1', 'Median', 'Q3', 'IQR'], g.map(x => [x.name, f(ST.quant(x.a, 0.25)), f(ST.quant(x.a, 0.5)), f(ST.quant(x.a, 0.75)), f(ST.quant(x.a, 0.75) - ST.quant(x.a, 0.25))]))], charts: [boxChart(g, { title: 'Boxplot (● mean, red = outliers)', c1: cc })], notes: ['Whiskers reach 1.5 × IQR; points beyond are flagged red.'] };
      }
      case 'ts': {
        const a = c.need(c.num(sel.x), 2, c.name(sel.x)), m = ST.mean(a), pts = a.map((v, i) => [i + 1, v]), pad = (ST.max(a) - ST.min(a)) * 0.1 || 1, yt = ticks(ST.min(a) - pad, ST.max(a) + pad, 5), xt = ticks(1, a.length, 8);
        return { tables: [], charts: [mkChart({ title: `Time series plot of ${c.name(sel.x)}`, x: [0, a.length + 1], y: [yt.lo, yt.hi], xTicks: xt.ticks.filter(t => t.v >= 1), yTicks: yt.ticks, line: [pts], dots: pts, ref2: [{ y: m, label: 'Mean=' + f(m) }], c1: cc, r: 3, xl: 'Index', yl: c.name(sel.x) })], notes: [] };
      }
    }
    throw new Error('Unknown analysis');
  }
  openDialog(def) {
    const sel = {}, p = this.proj(), used = p.cols.map((c, i) => (colLen(c) > 0 ? i : -1)).filter(i => i >= 0), sc = this.state.sel.c;
    let k = 0; const pickNext = () => { const v = used.length ? used[Math.min(k, used.length - 1)] : null; k++; return v; };
    def.slots.forEach(s => { if (s.optional) { sel[s.key] = null; return; } if (s.multi) sel[s.key] = used.length ? [used.includes(sc) ? sc : used[0]] : []; else sel[s.key] = pickNext(); });
    const opt = {}; def.opts.forEach(o => { opt[o.key] = o.def; });
    if (def.id === 'mreg' && used.length > 1) sel.xs = used.filter(i => i !== sel.y).slice(0, 3);
    if (['corr', 'anova', 'box', 'kw', 'tukey'].includes(def.id)) sel.vars = used.filter(i => this.ctx().num(i).length > 0).slice(0, 3);
    this.setState({ dlg: { id: def.id, sel, opt } });
  }
  runDialog() {
    const d = this.state.dlg, def = ANALYSES.find(a => a.id === d.id);
    for (const s of def.slots) { const v = d.sel[s.key]; if (!s.optional && (v == null || (s.multi && !v.length))) return this.say(`Choose: ${s.label}`); }
    if (d.busy) return;
    if (this.wantServer(def, d)) return this.runServer(def, d);
    let res; try { res = this.analyze(def, d.sel, d.opt); } catch (e) { return this.say(e.message || 'Could not run that analysis'); }
    this.addOutput(def, res);
  }
  addOutput(def, res) {
    const out = { id: uid(), aid: def.id, cat: def.cat, title: def.name, time: Date.now(), pinned: false, tables: res.tables || [], charts: res.charts || [], notes: (res.notes || []).filter(Boolean), verdict: res.verdict || '', vcls: res.vcls || 'info' };
    this.upd(p => { p.outputs = [out].concat(p.outputs || []).slice(0, 60); }, { dlg: null, split: this.state.split === 'grid' ? 'split' : this.state.split });
    this.say(`${def.name} complete`);
  }
  togglePin(pi, oid) {
    const projects = this.state.projects.slice(), p = Object.assign({}, projects[pi]);
    p.outputs = p.outputs.map(o => (o.id === oid ? Object.assign({}, o, { pinned: !o.pinned }) : o)); projects[pi] = p; this.setState({ projects });
    const o = p.outputs.find(x => x.id === oid); if (o) this.syncPin(o, p).catch(() => {});
  }
  viewOut(o, pi, projName) {
    const C = CATS[o.cat] || CATS.basic;
    return { color: C.color, ink: C.ink, cat: C.short, title: o.title, time: ago(o.time), project: projName, hasVerdict: !!o.verdict, verdict: o.verdict, verdictCls: 'verdict ' + (o.vcls || 'info'),
      tables: (o.tables || []).map(t => ({ n: t.head.length, cells: t.head.map((h, j) => ({ t: h, cls: 'th' + (j === 0 ? ' c0' : '') })).concat([].concat(...t.rows.map(r => r.map((v, j) => ({ t: String(v), cls: j === 0 ? 'c0' : '' }))))) })),
      hasCharts: !!(o.charts && o.charts.length), charts: o.charts || [], notes: (o.notes || []).map(t => ({ t })),
      pinCls: o.pinned ? 'iconbtn on' : 'iconbtn', pin: () => this.togglePin(pi, o.id),
      remove: () => { this.upd(p => { p.outputs = p.outputs.filter(x => x.id !== o.id); }); } };
  }

  renderVals() {
    const st = this.state, p = this.proj(), cur = st.cur;
    const go = {}; ['home', 'ws', 'overview', 'dash', 'projects', 'settings'].forEach(k => { go[k] = () => this.setState({ screen: k, dlg: null }); });
    const nav = {}, is = {}; ['home', 'ws', 'overview', 'dash', 'projects', 'settings'].forEach(k => { nav[k] = st.screen === k ? 'nav on' : 'nav'; is[k] = st.screen === k; });
    const used = p.cols.map((c, i) => ({ c, i, n: colLen(c) })).filter(x => x.n > 0);
    const rowsN = used.length ? Math.max(...used.map(x => x.n)) : 0;
    const projMeta = q => { const u = q.cols.filter(c => colLen(c) > 0); return `${u.length} columns · ${u.length ? Math.max(...u.map(colLen)) : 0} rows · ${(q.outputs || []).length} results · ${ago(q.updated)}`; };

    /* home */
    const modules = ['basic', 'reg', 'anova', 'qual', 'graph', 'adv'].map(k => ({ name: CATS[k].name, color: CATS[k].color, ink: CATS[k].ink, blurb: CATS[k].blurb, count: ANALYSES.filter(a => a.cat === k).length + ' tools', open: () => this.setState({ screen: 'ws', tab: k }) }));
    const recent = st.projects.map((q, i) => ({ q, i })).sort((a, b) => b.q.updated - a.q.updated).slice(0, 4).map(({ q, i }) => ({ name: q.name, color: q.color, initial: (q.name || '?').trim().charAt(0).toUpperCase() || '?', meta: projMeta(q), open: () => this.setState({ cur: i, screen: 'ws', rowStart: 0 }) }));
    const samples = SAMPLES.map(s => ({ name: s.name, desc: s.desc, color: s.color, load: () => this.addProject(mkProject(s.name, s.make()), `Loaded “${s.name}”`) }));

    /* workspace */
    const tabs = ['basic', 'reg', 'anova', 'qual', 'graph', 'adv', 'data'].map(k => ({ name: CATS[k].name, color: CATS[k].color, cls: st.tab === k ? 'tab on' : 'tab', pick: () => this.setState({ tab: k }) }));
    let tools;
    if (st.tab === 'data') {
      tools = SAMPLES.map(s => ({ name: s.name, desc: 'Load as new project', abbr: 'DS', color: s.color, ink: '#17132E', pick: () => this.addProject(mkProject(s.name, s.make()), `Loaded “${s.name}”`) }))
        .concat([{ name: 'Export CSV', desc: 'Download this worksheet', abbr: 'CSV', color: '#17132E', ink: '#fff', pick: () => this.exportCsv() }, { name: 'Add 10 columns', desc: 'Grid also grows as you scroll', abbr: '+C', color: '#6D4AFF', ink: '#fff', pick: () => this.setState({ colCap: st.colCap + 10 }) }]);
    } else {
      tools = ANALYSES.filter(a => a.cat === st.tab).map(a => ({ name: a.name, desc: a.server && !API ? 'Needs the analysis server' : a.desc, abbr: a.abbr, color: CATS[a.cat].color, ink: CATS[a.cat].ink, pick: () => this.openDialog(a) }));
    }
    const outputs = (p.outputs || []).map(o => this.viewOut(o, cur, p.name));
    const start = Math.max(0, st.rowStart - 6), rowCap = Math.max(st.rowCap, rowsN + 100), end = Math.min(rowCap, start + VIS);
    const colCap = Math.max(st.colCap, p.cols.length + 4);
    const headCols = Array.from({ length: colCap }, (_, c) => ({ c, id: 'C' + (c + 1), name: (p.cols[c] && p.cols[c].name) || '', aria: `Name of column C${c + 1}`, cls: st.sel.c === c ? 'hc on' : 'hc', pick: () => this.setState({ sel: { r: st.sel.r, c } }) }));
    const textCol = Array.from({ length: colCap }, (_, c) => { const col = p.cols[c]; if (!col) return false; const n = Math.min(colLen(col), 30); let t = 0, k = 0; for (let r = 0; r < n; r++) { const v = String(col.vals[r] == null ? '' : col.vals[r]).trim(); if (v) { k++; if (!Number.isFinite(parseNum(v))) t++; } } return k > 0 && t / k > 0.5; });
    const gridRows = [];
    for (let r = start; r < end; r++) {
      const cells = [];
      for (let c = 0; c < colCap; c++) { const col = p.cols[c], v = col && col.vals[r] != null ? col.vals[r] : ''; cells.push({ r, c, v, aria: `C${c + 1} row ${r + 1}`, cls: 'cell' + (textCol[c] ? ' txt' : '') + (st.sel.c === c ? ' colon' : '') }); }
      gridRows.push({ n: r + 1, cells });
    }
    const selCol = p.cols[st.sel.c];

    /* overview */
    const ovList = used.map(({ c, i, n }) => {
      const nums = []; for (let k = 0; k < n; k++) { const v = parseNum(c.vals[k]); if (Number.isFinite(v)) nums.push(v); }
      const numeric = nums.length >= n * 0.5, color = CHC[i % CHC.length];
      let hist = [], stats;
      if (numeric && nums.length) {
        const h = histData(nums, 14), mx = ST.max(h.counts); hist = h.counts.map(v => ({ h: Math.max(3, Math.round(v / mx * 100)) }));
        stats = [['N', nums.length], ['Missing', n - nums.length], ['Mean', this.fmt(ST.mean(nums))], ['StDev', nums.length > 1 ? this.fmt(ST.sd(nums)) : '*'], ['Min', this.fmt(ST.min(nums))], ['Max', this.fmt(ST.max(nums))]];
      } else {
        const cnt = {}; for (let k = 0; k < n; k++) { const v = String(c.vals[k] == null ? '' : c.vals[k]).trim(); if (v) cnt[v] = (cnt[v] || 0) + 1; }
        const ent = Object.entries(cnt).sort((a, b) => b[1] - a[1]), mx = ent.length ? ent[0][1] : 1; hist = ent.slice(0, 14).map(e => ({ h: Math.max(3, Math.round(e[1] / mx * 100)) }));
        stats = [['N', ent.reduce((s, e) => s + e[1], 0)], ['Unique', ent.length], ['Top', ent.length ? ent[0][0] : '*'], ['Top count', ent.length ? ent[0][1] : 0], ['Blank', n - ent.reduce((s, e) => s + e[1], 0)], ['Column', 'C' + (i + 1)]];
      }
      return { name: c.name || 'C' + (i + 1), color, type: numeric ? 'Numeric' : 'Text', badgeBg: numeric ? '#ECE7FF' : '#FFF1C7', badgeInk: numeric ? '#3A1FB0' : '#6B4A00', hist, stats: stats.map(s => ({ k: s[0], v: String(s[1]) })), numeric, nums: nums.length, miss: numeric ? n - nums.length : 0 };
    });
    const ov = { cols: used.length, numCols: ovList.filter(x => x.numeric).length, txtCols: ovList.filter(x => !x.numeric).length, rows: rowsN, cells: ovList.filter(x => x.numeric).reduce((s, x) => s + x.nums, 0).toLocaleString(), missing: ovList.reduce((s, x) => s + x.miss, 0), none: !used.length, list: ovList };

    /* dashboard */
    const allOuts = []; st.projects.forEach((q, pi) => (q.outputs || []).forEach(o => allOuts.push({ o, pi, pn: q.name })));
    allOuts.sort((a, b) => b.o.time - a.o.time);
    const pins = allOuts.filter(x => x.o.pinned).map(x => this.viewOut(x.o, x.pi, x.pn));
    const usageCounts = ['basic', 'reg', 'anova', 'qual', 'graph', 'adv'].map(k => ({ k, n: allOuts.filter(x => x.o.cat === k).length })), umax = Math.max(1, ...usageCounts.map(u => u.n));
    const lastCap = allOuts.find(x => x.o.aid === 'cap');
    const cpkM = lastCap && /Cpk = ([\d.\-]+)/.exec(lastCap.o.verdict || '');
    const db = { projects: st.projects.length, runs: allOuts.length, pinned: pins.length, cpk: cpkM ? cpkM[1] : '—', cpkNote: lastCap ? `${lastCap.pn} · ${ago(lastCap.o.time)}` : 'run Process Capability',
      usage: usageCounts.map(u => ({ name: CATS[u.k].short, color: CATS[u.k].chart, n: u.n, w: Math.round(u.n / umax * 100) })),
      activity: allOuts.slice(0, 6).map(x => { const C = CATS[x.o.cat] || CATS.basic; return { color: C.color, ink: C.ink, cat: C.short, title: x.o.title, project: x.pn, time: ago(x.o.time) }; }),
      noActivity: !allOuts.length, noPins: !pins.length, pins };

    /* projects */
    const plist = st.projects.map((q, i) => ({ name: q.name, color: q.color, initial: (q.name || '?').trim().charAt(0).toUpperCase() || '?', meta: projMeta(q), isCur: i === cur,
      rename: e => { const projects = st.projects.slice(); projects[i] = Object.assign({}, q, { name: e.target.value }); this.setState({ projects }); },
      open: () => this.setState({ cur: i, screen: 'ws', rowStart: 0, sel: { r: 0, c: 0 } }),
      dup: () => { const cp = JSON.parse(JSON.stringify(q)); cp.id = uid(); cp.name = q.name + ' (copy)'; cp.updated = Date.now(); this.setState({ projects: st.projects.concat([cp]) }); this.say('Project duplicated'); },
      del: () => { if (st.projects.length === 1) return this.say('Keep at least one project'); const projects = st.projects.filter((_, j) => j !== i); this.setState({ projects, cur: Math.min(cur > i ? cur - 1 : cur === i ? 0 : cur, projects.length - 1) }); this.say(`Deleted “${q.name}”`); } }));

    /* dialog */
    let dlg = { open: false };
    if (st.dlg) {
      const def = ANALYSES.find(a => a.id === st.dlg.id), C = CATS[def.cat], d = st.dlg;
      const setSel = (key, v) => this.setState({ dlg: Object.assign({}, d, { sel: Object.assign({}, d.sel, { [key]: v }) }) });
      dlg = { open: true, name: def.name, desc: def.desc, cat: C.name, color: C.color, ink: C.ink, noCols: !used.length,
        slots: def.slots.map(s => ({ label: s.label, hint: s.multi ? 'pick one or more' : s.optional ? 'optional' : 'pick one',
          chips: used.map(({ c, i }) => { const on = s.multi ? (d.sel[s.key] || []).includes(i) : d.sel[s.key] === i;
            return { label: `C${i + 1}${c.name ? ' · ' + c.name : ''}`, cls: on ? 'chip on' : 'chip', pick: () => { if (s.multi) { const cur2 = d.sel[s.key] || []; setSel(s.key, on ? cur2.filter(x => x !== i) : cur2.concat([i])); } else setSel(s.key, on && s.optional ? null : i); } }; }) })),
        opts: def.opts.map(o => ({ label: o.label, ph: o.ph, v: d.opt[o.key], change: e => this.setState({ dlg: Object.assign({}, d, { opt: Object.assign({}, d.opt, { [o.key]: e.target.value }) }) }) })),
        close: () => this.setState({ dlg: null }), run: () => this.runDialog(), runLabel: d.busy ? 'Running…' : def.server ? 'Run on server' : 'Run analysis' };
    }

    const setDec = v => () => this.setState({ dec: v }), setA = v => () => this.setState({ alpha: v });
    return {
      appCls: 'app ' + (st.theme === 'night' ? 'night' : 'day'), go, nav, is,
      appH: '100dvh', sync: this.syncView(), ...this.cloudVals(),
      cur: { name: p.name, meta: `${used.length} cols · ${rowsN} rows` },
      newProject: () => this.addProject(mkProject('Untitled project', []), 'New project ready — start typing'),
      onFile: e => this.importFile(e), exportCsv: () => this.exportCsv(),
      toolCount: ANALYSES.length, modules, recent, samples,
      renameCur: e => { const v = e.target.value; this.upd(q => { q.name = v; }); },
      splitCls: { split: st.split === 'split' ? 'on' : '', session: st.split === 'session' ? 'on' : '', grid: st.split === 'grid' ? 'on' : '' },
      setSplit: { split: () => this.setState({ split: 'split' }), session: () => this.setState({ split: 'session' }), grid: () => this.setState({ split: 'grid' }) },
      sessCls: 'session sess-' + st.split, sheetCls: 'sheet sheet-' + st.split,
      tabs, tools, outputs, noOutputs: !outputs.length,
      selRef: `C${st.sel.c + 1}${selCol && selCol.name ? ' ' + selCol.name : ''} · R${st.sel.r + 1}`,
      selVal: selCol && selCol.vals[st.sel.r] != null ? selCol.vals[st.sel.r] : '',
      onBarChange: e => { const v = e.target.value, { r, c } = st.sel; this.upd(q => this.setIn(q, r, c, v)); },
      clearSheet: () => { this.upd(q => { q.cols = []; }); this.say('Sheet cleared'); },
      gridInfo: `${rowsN} rows used · showing ${start + 1}–${end}`,
      gridW: RNW + colCap * CW, padTop: start * ROWH, padBot: Math.max(0, (rowCap - end) * ROWH), headCols, gridRows,
      onGridScroll: e => { const el = e.currentTarget, s = el.scrollTop, up = {}; const rs = Math.floor(s / ROWH); if (Math.abs(rs - this.state.rowStart) >= 4) up.rowStart = rs;
        if (s + el.clientHeight > this.state.rowCap * ROWH - 600) up.rowCap = this.state.rowCap + 500;
        if (el.scrollLeft + el.clientWidth > (RNW + this.state.colCap * CW) - 240) up.colCap = this.state.colCap + 8;
        if (Object.keys(up).length) this.setState(up); },
      onPaste: e => this.pasteBlock(e),
      onCell: e => { const r = +e.target.dataset.r, c = +e.target.dataset.c, v = e.target.value; this.upd(q => this.setIn(q, r, c, v)); },
      onCellFocus: e => { const r = +e.target.dataset.r, c = +e.target.dataset.c; if (st.sel.r !== r || st.sel.c !== c) this.setState({ sel: { r, c } }); try { e.target.select(); } catch (x) {} },
      onCellKey: e => { const t = e.target, r = +t.dataset.r, c = +t.dataset.c; let nr = r, nc = c;
        if (e.key === 'Enter' || e.key === 'ArrowDown') nr = r + 1; else if (e.key === 'ArrowUp') nr = Math.max(0, r - 1);
        else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) nc = c + 1; else if (e.key === 'ArrowLeft' && t.selectionStart === 0) nc = Math.max(0, c - 1); else return;
        e.preventDefault(); this.focusCell(nr, nc, t.closest('.gridwrap')); },
      renameCol: e => { const c = +e.target.dataset.c, v = e.target.value; this.upd(q => { while (q.cols.length <= c) q.cols.push({ name: '', vals: [] }); q.cols[c] = Object.assign({}, q.cols[c], { name: v }); }); },
      ov, db, plist, dlg,
      set: { day: st.theme === 'day' ? 'on' : '', night: st.theme === 'night' ? 'on' : '', setDay: () => this.setState({ theme: 'day' }), setNight: () => this.setState({ theme: 'night' }),
        decs: [2, 3, 4, 5, 6].map(v => ({ label: String(v), cls: st.dec === v ? 'on' : '', pick: setDec(v) })),
        alphas: [0.01, 0.05, 0.1].map(v => ({ label: String(v), cls: st.alpha === v ? 'on' : '', pick: setA(v) })) },
      resetAll: () => { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + ':local'); } catch (e) {} location.reload(); },
      toast: { show: !!st.toast, text: st.toast || '' }
    };
  }
}

preactRender(h(Component, {}), document.getElementById('root'));
})();
