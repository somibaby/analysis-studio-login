"""Chart specs in the exact shape the frontend's mkChart() expects.

The server never draws pictures: it returns domains, ticks and marks, and the
browser turns them into SVG with the same renderer the local analyses use.
"""
import math
import numpy as np
from scipy import stats

MAX_POINTS = 3000  # dots/line points sent to the browser per chart


def ticks(lo, hi, n=5):
    if not (hi > lo):
        c = lo or 0.0
        lo, hi = c - 1, c + 1
    step0 = (hi - lo) / n
    mag = 10 ** math.floor(math.log10(step0))
    r = step0 / mag
    step = (1 if r < 1.5 else 2 if r < 3 else 5 if r < 7 else 10) * mag
    a = math.floor(lo / step + 1e-9) * step
    b = math.ceil(hi / step - 1e-9) * step
    dec = max(0, -math.floor(math.log10(step) + 1e-9))
    out, v = [], a
    while v <= b + step * 1e-6:
        vv = round(v, 10)
        out.append({"v": vv, "label": f"{vv:.{min(dec, 6)}f}"})
        v += step
    return {"lo": a, "hi": b, "ticks": out}


def thin(points, limit=MAX_POINTS):
    """Evenly subsample a list of points so the browser stays fast."""
    if len(points) <= limit:
        return points
    idx = np.linspace(0, len(points) - 1, limit).astype(int)
    return [points[i] for i in idx]


def _f(v):
    return float(v)


def hist_spec(a, *, title, c1, xl="", bins=0, normal=False, sigma=None, sigma2=None, xs=(), ref=None, ref2=None):
    a = np.asarray(a, float)
    lo, hi = float(a.min()), float(a.max())
    k = int(bins) if bins and bins > 0 else max(5, min(25, math.ceil(math.log2(len(a)) + 1)))
    k = max(1, min(60, k))
    w = (hi - lo) / k or 1.0
    counts, _ = np.histogram(a, bins=k, range=(lo, lo + w * k))
    xlo, xhi = lo, lo + w * k
    for v in xs:
        if v is not None and math.isfinite(v):
            xlo, xhi = min(xlo, v), max(xhi, v)
    pad = (xhi - xlo) * 0.05 or 1.0
    xt = ticks(xlo - pad, xhi + pad, 6)
    m = float(a.mean())
    s = float(a.std(ddof=1)) if len(a) > 1 else 0.0

    def curve(sg):
        if not sg or sg <= 0:
            return []
        xsp = np.linspace(xt["lo"], xt["hi"], 91)
        return [[_f(x), _f(len(a) * w * stats.norm.pdf((x - m) / sg) / sg)] for x in xsp]

    c1v = curve(sigma or s) if normal else []
    c2v = curve(sigma2) if sigma2 else []
    ymax = max([int(counts.max())] + [p[1] for p in c1v] + [p[1] for p in c2v])
    yt = ticks(0, ymax * 1.1, 5)
    return {
        "title": title, "x": [xt["lo"], xt["hi"]], "y": [0, yt["hi"]], "xTicks": xt["ticks"], "yTicks": yt["ticks"],
        "bars": [{"x0": lo + i * w + w * 0.04, "x1": lo + (i + 1) * w - w * 0.04, "y0": 0, "y1": int(c)} for i, c in enumerate(counts)],
        "line": [c1v], "line2": [c2v], "ref": ref or [], "ref2": ref2 or [], "xl": xl, "yl": "Frequency",
        "c1": c1, "lc": "#17132E", "l2c": "#FF5C5C",
    }


def box_spec(groups, *, title, c1, yl=""):
    allv = np.concatenate([np.asarray(g["a"], float) for g in groups])
    lo, hi = float(allv.min()), float(allv.max())
    pad = (hi - lo) * 0.08 or 1.0
    yt = ticks(lo - pad, hi + pad, 5)
    bars, med, wh, out, mns = [], [], [], [], []
    for i, g in enumerate(groups):
        x = i + 1
        s = np.sort(np.asarray(g["a"], float))
        q1, q2, q3 = (float(np.quantile(s, q, method="weibull")) for q in (0.25, 0.5, 0.75))
        iqr = q3 - q1
        lf, uf = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        inr = s[(s >= lf) & (s <= uf)]
        wl = float(inr[0]) if len(inr) else q1
        wu = float(inr[-1]) if len(inr) else q3
        bw = 0.22
        bars.append({"x0": x - bw, "x1": x + bw, "y0": q1, "y1": q3})
        med.append([[x - bw, q2], [x + bw, q2]])
        wh += [[[x, q3], [x, wu]], [[x - 0.08, wu], [x + 0.08, wu]], [[x, q1], [x, wl]], [[x - 0.08, wl], [x + 0.08, wl]]]
        outl = s[(s < lf) | (s > uf)]
        out += [[x, float(v)] for v in thin(list(outl), 400)]
        mns.append([x, float(s.mean())])
    names = [g["name"] if len(g["name"]) <= 14 else g["name"][:13] + "…" for g in groups]
    return {
        "title": title, "x": [0.4, len(groups) + 0.6], "y": [yt["lo"], yt["hi"]], "yTicks": yt["ticks"],
        "xTicks": [{"v": i + 1, "label": n} for i, n in enumerate(names)],
        "bars": bars, "line": wh, "line2": med, "dots": mns, "dots2": out,
        "c1": c1, "lc": "#7A7496", "l2c": "#FFB800", "dc": "#17132E", "r": 3, "yl": yl,
    }


def scatter_spec(x, y, *, title, c1, xl="", yl="", line=None, ref2=None):
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    px = (x.max() - x.min()) * 0.06 or 1.0
    py = (y.max() - y.min()) * 0.08 or 1.0
    xt = ticks(float(x.min() - px), float(x.max() + px), 6)
    yt = ticks(float(y.min() - py), float(y.max() + py), 5)
    pts = thin([[float(a), float(b)] for a, b in zip(x, y)])
    return {
        "title": title, "x": [xt["lo"], xt["hi"]], "y": [yt["lo"], yt["hi"]], "xTicks": xt["ticks"], "yTicks": yt["ticks"],
        "dots": pts, "line": [line] if line else [], "ref2": ref2 or [], "xl": xl, "yl": yl,
        "c1": c1, "lc": "#17132E", "dc": c1,
    }


def ctrl_spec(vals, cl, ucl, lcl, *, title, c1, cl_name, f, yl="", xl="Observation"):
    vals = np.asarray(vals, float)
    n = len(vals)
    pts = [[i + 1, float(v)] for i, v in enumerate(vals)]
    ooc = [p for p in pts if p[1] > ucl + 1e-12 or p[1] < lcl - 1e-12]
    lo, hi = min(float(vals.min()), lcl), max(float(vals.max()), ucl)
    pad = (hi - lo) * 0.12 or 1.0
    yt = ticks(lo - pad, hi + pad, 5)
    xt = ticks(1, max(2, n), 8)
    shown = thin(pts)
    spec = {
        "title": title, "x": [0, n + 1], "y": [yt["lo"], yt["hi"]], "yTicks": yt["ticks"],
        "xTicks": [t for t in xt["ticks"] if t["v"] >= 1], "line": [shown], "dots": shown if n <= 400 else [],
        "dots2": thin(ooc, 500), "ref": [{"y": ucl, "label": "UCL=" + f(ucl)}, {"y": lcl, "label": "LCL=" + f(lcl)}],
        "ref2": [{"y": cl, "label": f"{cl_name}=" + f(cl)}], "xl": xl, "yl": yl, "c1": c1, "r": 3.2,
    }
    return spec, ooc


def prob_spec(a, *, title, c1, xl=""):
    a = np.sort(np.asarray(a, float))
    n = len(a)
    m, s = float(a.mean()), float(a.std(ddof=1))
    z = stats.norm.ppf((np.arange(1, n + 1) - 0.3) / (n + 0.4))
    zr, zh = float(z[0]), float(z[-1])
    lo, hi = min(float(a[0]), m + s * zr), max(float(a[-1]), m + s * zh)
    pad = (hi - lo) * 0.05
    xt = ticks(lo - pad, hi + pad, 6)
    yT = [{"v": float(stats.norm.ppf(q / 100)), "label": str(q)} for q in (1, 5, 10, 20, 30, 50, 70, 80, 90, 95, 99)]
    yT = [t for t in yT if zr - 0.4 <= t["v"] <= zh + 0.4]
    return {
        "title": title, "x": [xt["lo"], xt["hi"]], "y": [zr - 0.3, zh + 0.3], "xTicks": xt["ticks"], "yTicks": yT,
        "dots": thin([[float(v), float(q)] for v, q in zip(a, z)]),
        "line": [[[m + s * (zr - 0.3), zr - 0.3], [m + s * (zh + 0.3), zh + 0.3]]],
        "c1": c1, "lc": "#FF5C5C", "xl": xl, "yl": "Percent",
    }
