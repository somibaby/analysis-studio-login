"""Server-side analyses.

Two groups:
  * BIG  - the core analyses re-implemented with SciPy/statsmodels so very large
           worksheets are processed on the server instead of the browser.
  * NEW  - tests that need SciPy and only run here (Mann-Whitney, Kruskal-Wallis,
           chi-square, two-way ANOVA, Tukey, Box-Cox, Weibull).

Every analysis returns the same shape the browser uses for its own results:
  {tables: [{head, rows}], charts: [chart spec], notes: [str], verdict, vcls}
"""
import math
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm
from statsmodels.stats.diagnostic import normal_ad
from statsmodels.stats.multicomp import pairwise_tukeyhsd

from .charts import ticks, thin, hist_spec, box_spec, scatter_spec, ctrl_spec, prob_spec

COL = {"basic": "#6D4AFF", "reg": "#2EC4B6", "anova": "#FF5C5C", "qual": "#FFB800", "graph": "#1E8CFF", "adv": "#F2557A"}


class AnalysisError(Exception):
    pass


class Ctx:
    def __init__(self, cols, dec=4, alpha=0.05):
        # cols: {"3": {"name": "...", "vals": [...]}}
        self.cols = {int(k): v for k, v in (cols or {}).items()}
        self.dec = int(dec)
        self.alpha = float(alpha)

    def name(self, i):
        c = self.cols.get(int(i)) or {}
        return c.get("name") or f"C{int(i) + 1}"

    def raw(self, i):
        vals = (self.cols.get(int(i)) or {}).get("vals") or []
        n = len(vals)
        while n > 0 and str(vals[n - 1] if vals[n - 1] is not None else "").strip() == "":
            n -= 1
        return [("" if v is None else str(v)).strip() for v in vals[:n]]

    def series(self, i):
        s = pd.Series(self.raw(i), dtype="object").str.replace(",", "", regex=False)
        return pd.to_numeric(s.replace("", np.nan), errors="coerce")

    def num(self, i, need=1):
        a = self.series(i).dropna().to_numpy(float)
        a = a[np.isfinite(a)]
        if len(a) < need:
            raise AnalysisError(f"{self.name(i)} needs at least {need} numeric values (found {len(a)}).")
        return a

    def missing(self, i):
        return len(self.raw(i)) - len(self.num(i, 0))

    def frame(self, idx):
        n = max(len(self.raw(i)) for i in idx)
        data = {}
        for i in idx:
            r = self.raw(i)
            data[i] = r + [""] * (n - len(r))
        return pd.DataFrame(data)

    def f(self, x):
        if x is None:
            return "*"
        try:
            x = float(x)
        except (TypeError, ValueError):
            return str(x)
        if not math.isfinite(x):
            return "*"
        d = self.dec
        if abs(x) >= 1e7 or (abs(x) < 10 ** (-d) and x != 0):
            return f"{x:.3e}"
        return f"{x:.{d}f}"

    @staticmethod
    def fp(p):
        if p is None or not math.isfinite(p):
            return "*"
        return "< 0.001" if p < 0.001 else f"{p:.3f}"

    def sig(self, p, yes, no):
        ps = self.fp(p)
        ps = ps if ps.startswith("<") else "= " + ps
        if p < self.alpha:
            return {"verdict": f"p {ps} < α = {self.alpha} → {yes}", "vcls": "bad"}
        return {"verdict": f"p {ps} ≥ α = {self.alpha} → {no}", "vcls": "good"}


def T(head, rows):
    return {"head": head, "rows": [[str(v) for v in r] for r in rows]}


def _conf(opt):
    try:
        v = float(opt.get("conf", 95))
    except (TypeError, ValueError):
        v = float("nan")
    if not (0 < v < 100):
        raise AnalysisError("Confidence level must be between 0 and 100.")
    return v


def _q(a, p):
    return float(np.quantile(a, p, method="weibull"))  # Minitab's (n+1)p quartiles


# ---------------------------------------------------------------- core (BIG)

def a_desc(c, sel, opt):
    rows, groups = [], []
    for i in sel["vars"]:
        a = c.num(i)
        n = len(a)
        groups.append({"name": c.name(i), "a": a})
        sd = a.std(ddof=1) if n > 1 else float("nan")
        rows.append([c.name(i), n, c.missing(i), c.f(a.mean()), c.f(sd / math.sqrt(n)), c.f(sd), c.f(a.min()),
                     c.f(_q(a, .25)), c.f(_q(a, .5)), c.f(_q(a, .75)), c.f(a.max())])
    return {"tables": [T(["Variable", "N", "N*", "Mean", "SE Mean", "StDev", "Minimum", "Q1", "Median", "Q3", "Maximum"], rows)],
            "charts": [box_spec(groups, title="Boxplot", c1=COL["basic"])], "notes": ["Computed on the server. N* counts blank or non-numeric cells."]}


def a_t1(c, sel, opt):
    a = c.num(sel["x"], 2)
    try:
        mu = float(opt.get("mu", 0))
    except ValueError:
        raise AnalysisError("Enter a hypothesized mean.")
    cl = _conf(opt)
    n, m, s = len(a), a.mean(), a.std(ddof=1)
    se = s / math.sqrt(n)
    t, p = stats.ttest_1samp(a, mu)
    tc = stats.t.ppf(1 - (1 - cl / 100) / 2, n - 1)
    out = {"tables": [T(["Variable", "N", "Mean", "StDev", "SE Mean", f"{cl:g}% CI for μ", "T", "P"],
                        [[c.name(sel["x"]), n, c.f(m), c.f(s), c.f(se), f"({c.f(m - tc * se)}, {c.f(m + tc * se)})", c.f(t), c.fp(p)]])],
           "charts": [hist_spec(a, title=f"Histogram of {c.name(sel['x'])} with H₀", c1=COL["basic"], xs=[mu], ref=[{"x": mu, "label": f"H₀ μ={mu:g}"}], ref2=[{"x": float(m)}], xl=c.name(sel["x"]))],
           "notes": [f"H₀: μ = {mu:g}   H₁: μ ≠ {mu:g}"]}
    out.update(c.sig(p, f"the mean differs from {mu:g}", f"no evidence the mean differs from {mu:g}"))
    return out


def a_t2(c, sel, opt):
    a, b = c.num(sel["x"], 2), c.num(sel["y"], 2)
    cl = _conf(opt)
    res = stats.ttest_ind(a, b, equal_var=False)
    v1, v2, n1, n2 = a.var(ddof=1), b.var(ddof=1), len(a), len(b)
    se = math.sqrt(v1 / n1 + v2 / n2)
    df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
    tc = stats.t.ppf(1 - (1 - cl / 100) / 2, df)
    d = a.mean() - b.mean()
    out = {"tables": [T(["Sample", "N", "Mean", "StDev", "SE Mean"], [[c.name(sel["x"]), n1, c.f(a.mean()), c.f(math.sqrt(v1)), c.f(math.sqrt(v1 / n1))],
                                                                       [c.name(sel["y"]), n2, c.f(b.mean()), c.f(math.sqrt(v2)), c.f(math.sqrt(v2 / n2))]]),
                      T(["Difference", f"{cl:g}% CI", "T", "DF", "P"], [[c.f(d), f"({c.f(d - tc * se)}, {c.f(d + tc * se)})", c.f(res.statistic), int(df), c.fp(res.pvalue)]])],
           "charts": [box_spec([{"name": c.name(sel["x"]), "a": a}, {"name": c.name(sel["y"]), "a": b}], title="Boxplot of samples", c1=COL["basic"])],
           "notes": ["Welch test — equal variances not assumed. H₀: μ₁ − μ₂ = 0"]}
    out.update(c.sig(res.pvalue, "the two means differ", "no evidence the means differ"))
    return out


def a_tp(c, sel, opt):
    df = c.frame([sel["x"], sel["y"]]).apply(lambda s: pd.to_numeric(s.str.replace(",", "", regex=False).replace("", np.nan), errors="coerce")).dropna()
    if len(df) < 2:
        raise AnalysisError("Paired data needs at least 2 complete rows.")
    cl = _conf(opt)
    x, y = df[sel["x"]].to_numpy(), df[sel["y"]].to_numpy()
    d = x - y
    n, m, s = len(d), d.mean(), d.std(ddof=1)
    se = s / math.sqrt(n)
    t, p = stats.ttest_rel(x, y)
    tc = stats.t.ppf(1 - (1 - cl / 100) / 2, n - 1)
    out = {"tables": [T(["Sample", "N", "Mean", "StDev", "SE Mean"], [[c.name(sel["x"]), n, c.f(x.mean()), c.f(x.std(ddof=1)), c.f(x.std(ddof=1) / math.sqrt(n))],
                                                                       [c.name(sel["y"]), n, c.f(y.mean()), c.f(y.std(ddof=1)), c.f(y.std(ddof=1) / math.sqrt(n))],
                                                                       ["Difference", n, c.f(m), c.f(s), c.f(se)]]),
                      T([f"{cl:g}% CI for μ diff", "T", "P"], [[f"({c.f(m - tc * se)}, {c.f(m + tc * se)})", c.f(t), c.fp(p)]])],
           "charts": [hist_spec(d, title="Histogram of differences", c1=COL["basic"], xs=[0], ref=[{"x": 0, "label": "H₀ = 0"}], xl="Difference")],
           "notes": ["Only rows with numbers in both columns are paired."]}
    out.update(c.sig(p, "there is a real mean difference", "no evidence of a mean difference"))
    return out


def a_norm(c, sel, opt):
    a = c.num(sel["x"], 8)
    ad, p = normal_ad(a)
    out = {"tables": [T(["Variable", "N", "Mean", "StDev", "AD", "P"], [[c.name(sel["x"]), len(a), c.f(a.mean()), c.f(a.std(ddof=1)), c.f(ad), "< 0.005" if p < 0.005 else f"{p:.3f}"]])],
           "charts": [prob_spec(a, title=f"Probability plot of {c.name(sel['x'])} — Normal", c1=COL["basic"], xl=c.name(sel["x"]))],
           "notes": ["H₀: data follow a normal distribution."]}
    out.update(c.sig(p, "data are NOT normal", "consistent with a normal distribution"))
    return out


def a_corr(c, sel, opt):
    v = sel["vars"]
    if len(v) < 2:
        raise AnalysisError("Pick at least two variables.")
    df = c.frame(v).apply(lambda s: pd.to_numeric(s.str.replace(",", "", regex=False).replace("", np.nan), errors="coerce"))
    rows = []
    for i in v:
        rr, pr = [c.name(i)], [" p-value"]
        for j in v:
            if i == j:
                rr.append("1"); pr.append(""); continue
            pair = df[[i, j]].dropna()
            if len(pair) < 3:
                rr.append("*"); pr.append("*"); continue
            r, p = stats.pearsonr(pair[i], pair[j])
            rr.append(f"{r:.3f}"); pr.append(c.fp(p))
        rows += [rr, pr]
    pair = df[[v[1], v[0]]].dropna()
    return {"tables": [T([""] + [c.name(i) for i in v], rows)],
            "charts": [scatter_spec(pair[v[1]], pair[v[0]], title=f"{c.name(v[0])} vs {c.name(v[1])}", c1=COL["basic"], xl=c.name(v[1]), yl=c.name(v[0]))] if len(pair) > 1 else [],
            "notes": ["Pearson correlation; p-value tests H₀: ρ = 0. Computed on the server."]}


def _ols(c, y_i, x_idx):
    df = c.frame([y_i] + list(x_idx)).apply(lambda s: pd.to_numeric(s.str.replace(",", "", regex=False).replace("", np.nan), errors="coerce")).dropna()
    if len(df) <= len(x_idx) + 2:
        raise AnalysisError(f"Need more complete rows than {len(x_idx) + 2} (found {len(df)}).")
    X = sm.add_constant(df[list(x_idx)].to_numpy(), has_constant="add")
    model = sm.OLS(df[y_i].to_numpy(), X).fit()
    return df, model


def _reg_tables(c, model, names):
    n, k = int(model.nobs), int(model.df_model)
    coef = [[nm, c.f(b), c.f(se), c.f(t), c.fp(p)] for nm, b, se, t, p in zip(names, model.params, model.bse, model.tvalues, model.pvalues)]
    sst = model.centered_tss
    return [T(["Term", "Coef", "SE Coef", "T", "P"], coef),
            T(["S", "R-sq", "R-sq(adj)", "N"], [[c.f(math.sqrt(model.mse_resid)), f"{model.rsquared * 100:.2f}%", f"{model.rsquared_adj * 100:.2f}%", n]]),
            T(["Source", "DF", "SS", "MS", "F", "P"], [["Regression", k, c.f(model.ess), c.f(model.ess / k), c.f(model.fvalue), c.fp(model.f_pvalue)],
                                                       ["Error", int(model.df_resid), c.f(model.ssr), c.f(model.mse_resid), "", ""],
                                                       ["Total", n - 1, c.f(sst), "", "", ""]])]


def a_fit(c, sel, opt):
    df, model = _ols(c, sel["y"], [sel["x"]])
    x = df[sel["x"]].to_numpy()
    b0, b1 = model.params
    xl, xh = float(x.min()), float(x.max())
    out = {"tables": _reg_tables(c, model, ["Constant", c.name(sel["x"])]),
           "charts": [scatter_spec(x, df[sel["y"]], title="Fitted line plot", c1=COL["reg"], line=[[xl, b0 + b1 * xl], [xh, b0 + b1 * xh]], xl=c.name(sel["x"]), yl=c.name(sel["y"])),
                      scatter_spec(model.fittedvalues, model.resid, title="Residuals versus fits", c1="#6D4AFF", ref2=[{"y": 0}], xl="Fitted value", yl="Residual")],
           "notes": [f"Regression equation: {c.name(sel['y'])} = {c.f(b0)} {'−' if b1 < 0 else '+'} {c.f(abs(b1))} × {c.name(sel['x'])}"]}
    out.update(c.sig(model.f_pvalue, f"{c.name(sel['x'])} significantly predicts {c.name(sel['y'])}", "the linear relationship is not significant"))
    return out


def a_mreg(c, sel, opt):
    xs = [i for i in sel["xs"] if i != sel["y"]]
    if not xs:
        raise AnalysisError("Pick at least one predictor different from the response.")
    df, model = _ols(c, sel["y"], xs)
    names = ["Constant"] + [c.name(i) for i in xs]
    eq = c.f(model.params[0]) + "".join(f" {'−' if b < 0 else '+'} {c.f(abs(b))} {nm}" for b, nm in zip(model.params[1:], names[1:]))
    out = {"tables": _reg_tables(c, model, names),
           "charts": [scatter_spec(model.fittedvalues, model.resid, title="Residuals versus fits", c1=COL["reg"], ref2=[{"y": 0}], xl="Fitted value", yl="Residual"),
                      hist_spec(model.resid, title="Histogram of residuals", c1="#6D4AFF", normal=True, xl="Residual")],
           "notes": [f"{c.name(sel['y'])} = {eq}"]}
    out.update(c.sig(model.f_pvalue, "the model explains significant variation", "the model is not significant overall"))
    return out


def a_anova(c, sel, opt):
    if len(sel["vars"]) < 2:
        raise AnalysisError("Pick at least two columns (one per group).")
    g = [{"name": c.name(i), "a": c.num(i, 2)} for i in sel["vars"]]
    F, p = stats.f_oneway(*[x["a"] for x in g])
    allv = np.concatenate([x["a"] for x in g])
    N, k, gm = len(allv), len(g), allv.mean()
    ssb = sum(len(x["a"]) * (x["a"].mean() - gm) ** 2 for x in g)
    ssw = sum(((x["a"] - x["a"].mean()) ** 2).sum() for x in g)
    dfb, dfw = k - 1, N - k
    sp = math.sqrt(ssw / dfw)
    tc = stats.t.ppf(0.975, dfw)
    lv = [[x["name"], len(x["a"]), c.f(x["a"].mean()), c.f(x["a"].std(ddof=1)),
           f"({c.f(x['a'].mean() - tc * sp / math.sqrt(len(x['a'])))}, {c.f(x['a'].mean() + tc * sp / math.sqrt(len(x['a'])))})"] for x in g]
    out = {"tables": [T(["Source", "DF", "SS", "MS", "F", "P"], [["Factor", dfb, c.f(ssb), c.f(ssb / dfb), c.f(F), c.fp(p)], ["Error", dfw, c.f(ssw), c.f(ssw / dfw), "", ""], ["Total", N - 1, c.f(ssb + ssw), "", "", ""]]),
                      T(["Level", "N", "Mean", "StDev", "95% CI (pooled)"], lv),
                      T(["S (pooled)", "R-sq"], [[c.f(sp), f"{ssb / (ssb + ssw) * 100:.2f}%"]])],
           "charts": [box_spec(g, title="Boxplot by group (● = mean)", c1=COL["anova"])],
           "notes": ["H₀: all group means are equal. Columns are treated as unstacked groups."]}
    out.update(c.sig(p, "at least one group mean differs", "no evidence the group means differ"))
    return out


def a_var2(c, sel, opt):
    a, b = c.num(sel["x"], 2), c.num(sel["y"], 2)
    v1, v2 = a.var(ddof=1), b.var(ddof=1)
    F = v1 / v2
    up = stats.f.sf(F, len(a) - 1, len(b) - 1)
    p = min(1.0, 2 * min(up, 1 - up))
    lev = stats.levene(a, b, center="median")
    out = {"tables": [T(["Sample", "N", "StDev", "Variance"], [[c.name(sel["x"]), len(a), c.f(math.sqrt(v1)), c.f(v1)], [c.name(sel["y"]), len(b), c.f(math.sqrt(v2)), c.f(v2)]]),
                      T(["Test", "Statistic", "P"], [["F-test (normal)", c.f(F), c.fp(p)], ["Levene (any distribution)", c.f(lev.statistic), c.fp(lev.pvalue)]])],
           "charts": [box_spec([{"name": c.name(sel["x"]), "a": a}, {"name": c.name(sel["y"]), "a": b}], title="Boxplot of samples", c1=COL["anova"])],
           "notes": ["H₀: σ₁ = σ₂. Levene's test is robust when data are not normal."]}
    out.update(c.sig(p, "the variances differ", "no evidence the variances differ"))
    return out


def a_imr(c, sel, opt):
    a = c.num(sel["x"], 3)
    mr = np.abs(np.diff(a))
    mrb, m = mr.mean(), a.mean()
    sw = mrb / 1.128
    I, ooc_i = ctrl_spec(a, m, m + 3 * sw, m - 3 * sw, title=f"I chart of {c.name(sel['x'])}", c1=COL["qual"], cl_name="X̄", f=c.f, yl="Individual value")
    M, ooc_m = ctrl_spec(mr, mrb, 3.267 * mrb, 0, title="Moving range chart", c1="#6D4AFF", cl_name="M̄R", f=c.f, yl="Moving range")
    k = len(ooc_i) + len(ooc_m)
    first = ", ".join(str(p[0]) for p in ooc_i[:30]) + (" …" if len(ooc_i) > 30 else "")
    return {"verdict": f"{k} point(s) beyond control limits → process shows special-cause variation" if k else "All points within control limits → process looks stable",
            "vcls": "bad" if k else "good",
            "tables": [T(["Chart", "Center", "UCL", "LCL", "Points out"], [["Individuals", c.f(m), c.f(m + 3 * sw), c.f(m - 3 * sw), len(ooc_i)], ["Moving range", c.f(mrb), c.f(3.267 * mrb), c.f(0), len(ooc_m)]])],
            "charts": [I, M],
            "notes": [f"Within-subgroup σ = M̄R / 1.128 = {c.f(sw)}." + (f" Out-of-control observations: {first}." if ooc_i else "")]}


def _spec(opt, key):
    v = str(opt.get(key, "")).strip()
    if v == "":
        return float("nan")
    try:
        return float(v)
    except ValueError:
        raise AnalysisError(f"{key.upper()} must be a number.")


def a_cap(c, sel, opt):
    a = c.num(sel["x"], 5)
    L, U = _spec(opt, "lsl"), _spec(opt, "usl")
    if not math.isfinite(L) and not math.isfinite(U):
        raise AnalysisError("Enter at least one spec limit (LSL or USL).")
    if math.isfinite(L) and math.isfinite(U) and L >= U:
        raise AnalysisError("LSL must be below USL.")
    n, m, so = len(a), a.mean(), a.std(ddof=1)
    sw = np.abs(np.diff(a)).mean() / 1.128

    def idx(s):
        cpu = (U - m) / (3 * s) if math.isfinite(U) else float("nan")
        cpl = (m - L) / (3 * s) if math.isfinite(L) else float("nan")
        cp = (U - L) / (6 * s) if math.isfinite(U) and math.isfinite(L) else float("nan")
        cpk = min(v for v in (cpu, cpl) if math.isfinite(v))
        return cp, cpl, cpu, cpk

    W, O = idx(sw), idx(so)
    obs = int(((a < L) if math.isfinite(L) else np.zeros(n, bool)).sum() + ((a > U) if math.isfinite(U) else np.zeros(n, bool)).sum())
    exp = ((stats.norm.cdf((L - m) / so) if math.isfinite(L) else 0) + (stats.norm.sf((U - m) / so) if math.isfinite(U) else 0)) * 1e6
    refs = ([{"x": L, "label": "LSL"}] if math.isfinite(L) else []) + ([{"x": U, "label": "USL"}] if math.isfinite(U) else [])
    fmt = lambda v: f"{v:.2f}" if math.isfinite(v) else "*"
    cpk = W[3]
    return {"verdict": f"Cpk = {cpk:.2f} → " + ("capable (≥ 1.33)" if cpk >= 1.33 else "marginal (1.00–1.33)" if cpk >= 1 else "not capable (< 1.00)"),
            "vcls": "good" if cpk >= 1.33 else "bad",
            "tables": [T(["", "LSL", "USL", "N", "Mean", "StDev (within)", "StDev (overall)"], [["Process", c.f(L) if math.isfinite(L) else "*", c.f(U) if math.isfinite(U) else "*", n, c.f(m), c.f(sw), c.f(so)]]),
                       T(["Index", "Cp", "CPL", "CPU", "Cpk"], [["Within"] + [fmt(v) for v in W], ["Overall (Pp)"] + [fmt(v) for v in O]]),
                       T(["Performance", "PPM total"], [["Observed", f"{round(obs / n * 1e6):,}"], ["Expected overall", f"{round(exp):,}"]])],
            "charts": [hist_spec(a, title=f"Capability histogram of {c.name(sel['x'])}", c1=COL["qual"], normal=True, sigma=sw, sigma2=so, xs=[L, U], ref=refs, xl=c.name(sel["x"]))],
            "notes": ["Black curve = within (short-term) fit, coral curve = overall fit. Computed on the server."]}


def a_hist(c, sel, opt):
    a = c.num(sel["x"], 2)
    try:
        bins = int(opt.get("bins") or 0)
    except ValueError:
        bins = 0
    return {"tables": [T(["Variable", "N", "Mean", "StDev", "Min", "Max"], [[c.name(sel["x"]), len(a), c.f(a.mean()), c.f(a.std(ddof=1)), c.f(a.min()), c.f(a.max())]])],
            "charts": [hist_spec(a, title=f"Histogram of {c.name(sel['x'])}", c1=COL["graph"], normal=True, bins=bins, xl=c.name(sel["x"]))],
            "notes": ["Black curve: fitted normal distribution."]}


def a_scatter(c, sel, opt):
    df = c.frame([sel["x"], sel["y"]]).apply(lambda s: pd.to_numeric(s.str.replace(",", "", regex=False).replace("", np.nan), errors="coerce")).dropna()
    if len(df) < 2:
        raise AnalysisError("Need at least 2 complete X/Y pairs.")
    note = [f"Showing a sample of {3000:,} of {len(df):,} points."] if len(df) > 3000 else []
    return {"tables": [T(["Pairs", "Mean X", "Mean Y"], [[len(df), c.f(df[sel['x']].mean()), c.f(df[sel['y']].mean())]])],
            "charts": [scatter_spec(df[sel["x"]], df[sel["y"]], title=f"Scatterplot of {c.name(sel['y'])} vs {c.name(sel['x'])}", c1=COL["graph"], xl=c.name(sel["x"]), yl=c.name(sel["y"]))],
            "notes": note}


def a_box(c, sel, opt):
    g = [{"name": c.name(i), "a": c.num(i)} for i in sel["vars"]]
    rows = [[x["name"], c.f(_q(x["a"], .25)), c.f(_q(x["a"], .5)), c.f(_q(x["a"], .75)), c.f(_q(x["a"], .75) - _q(x["a"], .25))] for x in g]
    return {"tables": [T(["Variable", "Q1", "Median", "Q3", "IQR"], rows)], "charts": [box_spec(g, title="Boxplot (● mean, red = outliers)", c1=COL["graph"])],
            "notes": ["Whiskers reach 1.5 × IQR; points beyond are flagged red."]}


# ---------------------------------------------------------------- new tests

def a_mw(c, sel, opt):
    a, b = c.num(sel["x"], 2), c.num(sel["y"], 2)
    res = stats.mannwhitneyu(a, b, alternative="two-sided")
    d = np.subtract.outer(a, b).ravel() if len(a) * len(b) <= 4_000_000 else None
    hl = float(np.median(d)) if d is not None else float("nan")
    out = {"tables": [T(["Sample", "N", "Median"], [[c.name(sel["x"]), len(a), c.f(np.median(a))], [c.name(sel["y"]), len(b), c.f(np.median(b))]]),
                      T(["Estimate (η₁ − η₂)", "U", "P"], [[c.f(hl), c.f(res.statistic), c.fp(res.pvalue)]])],
           "charts": [box_spec([{"name": c.name(sel["x"]), "a": a}, {"name": c.name(sel["y"]), "a": b}], title="Boxplot of samples", c1=COL["adv"])],
           "notes": ["Nonparametric alternative to the 2-sample t-test. H₀: the two populations have the same distribution (equal medians)."]}
    out.update(c.sig(res.pvalue, "the medians differ", "no evidence the medians differ"))
    return out


def a_kw(c, sel, opt):
    if len(sel["vars"]) < 2:
        raise AnalysisError("Pick at least two columns (one per group).")
    g = [{"name": c.name(i), "a": c.num(i, 2)} for i in sel["vars"]]
    H, p = stats.kruskal(*[x["a"] for x in g])
    ranks = stats.rankdata(np.concatenate([x["a"] for x in g]))
    N, rbar = len(ranks), (len(ranks) + 1) / 2
    rows, k = [], 0
    for x in g:
        n = len(x["a"])
        mr = ranks[k:k + n].mean()
        z = (mr - rbar) / math.sqrt((N + 1) / 12 * (N / n - 1))  # Minitab's Z for each group
        rows.append([x["name"], n, c.f(np.median(x["a"])), c.f(mr), f"{z:.2f}"])
        k += n
    out = {"tables": [T(["Group", "N", "Median", "Mean rank", "Z"], rows), T(["H", "DF", "P"], [[c.f(H), len(g) - 1, c.fp(p)]])],
           "charts": [box_spec(g, title="Boxplot by group", c1=COL["adv"])],
           "notes": ["Nonparametric alternative to one-way ANOVA. H₀: all groups have the same median."]}
    out.update(c.sig(p, "at least one median differs", "no evidence the medians differ"))
    return out


def a_chi(c, sel, opt):
    df = c.frame([sel["a"], sel["b"]])
    df = df[(df[sel["a"]] != "") & (df[sel["b"]] != "")]
    if len(df) < 2:
        raise AnalysisError("Need rows with values in both columns.")
    tab = pd.crosstab(df[sel["a"]], df[sel["b"]])
    if tab.shape[0] < 2 or tab.shape[1] < 2:
        raise AnalysisError("Each column needs at least two different categories.")
    if tab.shape[0] > 30 or tab.shape[1] > 30:
        raise AnalysisError("Too many categories (max 30 per column) — is this a numeric column?")
    chi2, p, dof, exp = stats.chi2_contingency(tab.to_numpy())
    head = [f"{c.name(sel['a'])} \\ {c.name(sel['b'])}"] + [str(x) for x in tab.columns] + ["All"]
    rows = []
    for r, (lvl, row) in enumerate(tab.iterrows()):
        rows.append([str(lvl)] + [f"{int(v)} ({exp[r][j]:.1f})" for j, v in enumerate(row)] + [int(row.sum())])
    rows.append(["All"] + [int(v) for v in tab.sum(0)] + [int(tab.to_numpy().sum())])
    low = int((exp < 5).sum())
    notes = ["Cells show observed (expected) counts. H₀: the two variables are independent."]
    if low:
        notes.append(f"{low} cell(s) have expected count below 5 — the p-value may be unreliable.")
    out = {"tables": [T(head, rows), T(["Chi-square", "DF", "P"], [[c.f(chi2), dof, c.fp(p)]])], "charts": [], "notes": notes}
    out.update(c.sig(p, "the variables are associated", "no evidence of association"))
    return out


def a_anova2(c, sel, opt):
    yi, ai, bi = sel["y"], sel["a"], sel["b"]
    df = c.frame([yi, ai, bi])
    df.columns = ["y", "A", "B"]
    df["y"] = pd.to_numeric(df["y"].str.replace(",", "", regex=False).replace("", np.nan), errors="coerce")
    df = df.dropna()
    df = df[(df["A"] != "") & (df["B"] != "")]
    if df["A"].nunique() < 2 or df["B"].nunique() < 2:
        raise AnalysisError("Each factor needs at least two levels.")
    if len(df) <= df["A"].nunique() * df["B"].nunique():
        raise AnalysisError("Need replicates: more rows than factor-level combinations.")
    model = smf.ols("y ~ C(A) * C(B)", data=df).fit()
    tab = anova_lm(model, typ=2)
    na, nb = c.name(ai), c.name(bi)
    label = {"C(A)": na, "C(B)": nb, "C(A):C(B)": f"{na}×{nb}", "Residual": "Error"}
    rows = []
    for src, r in tab.iterrows():
        ms = r["sum_sq"] / r["df"]
        rows.append([label.get(src, src), int(r["df"]), c.f(r["sum_sq"]), c.f(ms), c.f(r["F"]) if math.isfinite(r["F"]) else "", c.fp(r["PR(>F)"]) if math.isfinite(r["PR(>F)"]) else ""])
    rows.append(["Total", int(tab["df"].sum()), c.f(tab["sum_sq"].sum()), "", "", ""])
    charts = []
    for col, nm, colr in (("A", na, COL["adv"]), ("B", nb, "#6D4AFF")):
        means = df.groupby(col)["y"].mean()
        lv = list(means.index)
        lo, hi = float(means.min()), float(means.max())
        pad = (hi - lo) * 0.2 or 1
        yt = ticks(lo - pad, hi + pad, 5)
        pts = [[i + 1, float(v)] for i, v in enumerate(means)]
        charts.append({"title": f"Main effect of {nm}", "x": [0.5, len(lv) + 0.5], "y": [yt["lo"], yt["hi"]], "yTicks": yt["ticks"],
                       "xTicks": [{"v": i + 1, "label": str(l)[:10]} for i, l in enumerate(lv)], "line": [pts], "dots": pts,
                       "ref2": [{"y": float(df["y"].mean())}], "c1": colr, "xl": nm, "yl": f"Mean of {c.name(yi)}"})
    p_int = tab.loc["C(A):C(B)", "PR(>F)"]
    sig_terms = [label[s] for s in ("C(A)", "C(B)", "C(A):C(B)") if tab.loc[s, "PR(>F)"] < c.alpha]
    return {"verdict": ("Significant: " + ", ".join(sig_terms) if sig_terms else "No significant effects") + f" (α = {c.alpha})",
            "vcls": "bad" if sig_terms else "good",
            "tables": [T(["Source", "DF", "SS", "MS", "F", "P"], rows), T(["S", "R-sq", "R-sq(adj)"], [[c.f(math.sqrt(model.mse_resid)), f"{model.rsquared * 100:.2f}%", f"{model.rsquared_adj * 100:.2f}%"]])],
            "charts": charts,
            "notes": ["Stacked data: one response column plus two factor (category) columns. Type II sums of squares.",
                      "If the interaction is significant, interpret the main effects with care." if p_int < c.alpha else "Interaction not significant — main effects can be read on their own."]}


def a_tukey(c, sel, opt):
    if len(sel["vars"]) < 2:
        raise AnalysisError("Pick at least two columns (one per group).")
    g = [{"name": c.name(i), "a": c.num(i, 2)} for i in sel["vars"]]
    endog = np.concatenate([x["a"] for x in g])
    groups = np.concatenate([[x["name"]] * len(x["a"]) for x in g])
    res = pairwise_tukeyhsd(endog, groups, alpha=c.alpha)
    data = res.summary().data[1:]
    rows = [[f"{r[1]} − {r[0]}", c.f(r[2]), c.f(r[4]), c.f(r[5]), c.fp(float(r[3])), "Yes" if r[6] else "No"] for r in data]
    lo = min(float(r[4]) for r in data)
    hi = max(float(r[5]) for r in data)
    lo, hi = min(lo, 0), max(hi, 0)
    pad = (hi - lo) * 0.08 or 1
    xt = ticks(lo - pad, hi + pad, 6)
    k = len(data)
    chart = {"title": f"Tukey simultaneous {100 * (1 - c.alpha):g}% CIs (difference of means)", "x": [xt["lo"], xt["hi"]], "y": [0.4, k + 0.6], "L": 130,
             "xTicks": xt["ticks"], "yTicks": [{"v": k - i, "label": (f"{r[1]}−{r[0]}")[:18]} for i, r in enumerate(data)],
             "bars": [{"x0": float(r[4]), "x1": float(r[5]), "y0": k - i - 0.12, "y1": k - i + 0.12} for i, r in enumerate(data)],
             "dots": [[float(r[2]), k - i] for i, r in enumerate(data)], "ref2": [{"x": 0}], "c1": COL["adv"], "dc": "#17132E", "r": 4.5}
    F, p = stats.f_oneway(*[x["a"] for x in g])
    nsig = sum(1 for r in data if r[6])
    ps = c.fp(p) if c.fp(p).startswith("<") else "= " + c.fp(p)
    return {"verdict": f"{nsig} of {k} pairs differ significantly (ANOVA p {ps})", "vcls": "bad" if nsig else "good",
            "tables": [T(["Level", "N", "Mean", "StDev"], [[x["name"], len(x["a"]), c.f(x["a"].mean()), c.f(x["a"].std(ddof=1))] for x in g]),
                       T(["Pair", "Diff of means", "Lower", "Upper", "Adj. P", "Significant"], rows)],
            "charts": [chart], "notes": ["Intervals that do not cross zero indicate a significant difference between those two means."]}


def a_boxcox(c, sel, opt):
    a = c.num(sel["x"], 8)
    if (a <= 0).any():
        raise AnalysisError("Box-Cox needs all values > 0. Add a constant to shift the data first.")
    t, lam, ci = stats.boxcox(a, alpha=0.05)
    rounded = min((-2, -1, -0.5, 0, 0.5, 1, 2), key=lambda r: abs(r - lam))
    tr = np.log(a) if rounded == 0 else (a ** rounded - 1) / rounded if rounded != 1 else a
    p0 = normal_ad(a)[1]
    p1 = normal_ad(tr)[1]
    names = {-2: "1/Y²", -1: "1/Y", -0.5: "1/√Y", 0: "ln(Y)", 0.5: "√Y", 1: "Y (no transform)", 2: "Y²"}
    return {"verdict": f"Best λ = {lam:.3f} → use {names[rounded]}", "vcls": "info",
            "tables": [T(["Estimate λ", "95% CI", "Rounded λ", "Transform"], [[f"{lam:.3f}", f"({ci[0]:.3f}, {ci[1]:.3f})", f"{rounded:g}", names[rounded]]]),
                       T(["Data", "AD normality P"], [["Original", "< 0.005" if p0 < 0.005 else f"{p0:.3f}"], ["Transformed (rounded λ)", "< 0.005" if p1 < 0.005 else f"{p1:.3f}"]])],
            "charts": [hist_spec(a, title=f"Original {c.name(sel['x'])}", c1="#6D4AFF", normal=True, xl=c.name(sel["x"])),
                       prob_spec(tr, title=f"Probability plot of {names[rounded]}", c1=COL["adv"], xl="Transformed value")],
            "notes": ["Box-Cox finds the power transform that makes data closest to normal — useful before capability analysis or t-tests on skewed data."]}


def a_weibull(c, sel, opt):
    a = c.num(sel["x"], 5)
    if (a <= 0).any():
        raise AnalysisError("Weibull analysis needs all values > 0 (e.g. failure times).")
    shape, _, scale = stats.weibull_min.fit(a, floc=0)
    dist = stats.weibull_min(shape, 0, scale)
    ks = stats.kstest(a, dist.cdf)
    b10 = scale * (-math.log(0.9)) ** (1 / shape)
    s = np.sort(a)
    n = len(s)
    F = (np.arange(1, n + 1) - 0.3) / (n + 0.4)
    yv = np.log(-np.log(1 - F))
    xv = np.log(s)
    xt = ticks(float(xv.min()), float(xv.max()), 6)
    yt = [{"v": float(math.log(-math.log(1 - q / 100))), "label": str(q)} for q in (1, 2, 5, 10, 20, 30, 50, 70, 90, 99)]
    yt = [t for t in yt if yv.min() - 0.6 <= t["v"] <= yv.max() + 0.6]
    line = [[x, shape * (x - math.log(scale))] for x in (xt["lo"], xt["hi"])]
    prob = {"title": "Weibull probability plot", "x": [xt["lo"], xt["hi"]], "y": [float(yv.min()) - 0.4, float(yv.max()) + 0.4],
            "xTicks": [{"v": t["v"], "label": f"{math.exp(t['v']):.3g}"} for t in xt["ticks"]], "yTicks": yt,
            "dots": thin([[float(x), float(y)] for x, y in zip(xv, yv)]), "line": [line], "c1": COL["adv"], "lc": "#17132E", "xl": c.name(sel["x"]) + " (log scale)", "yl": "Percent failed"}
    hist = hist_spec(a, title="Histogram with fitted Weibull", c1="#6D4AFF", xl=c.name(sel["x"]))
    w = (s[-1] - s[0]) / max(1, len(hist["bars"])) or 1
    xs = np.linspace(hist["x"][0], hist["x"][1], 91)
    hist["line"] = [[[float(x), float(n * w * dist.pdf(x))] for x in xs if x > 0]]
    return {"verdict": f"Shape β = {shape:.3f} → " + ("early-life failures (β < 1)" if shape < 0.95 else "random failures (β ≈ 1)" if shape <= 1.05 else "wear-out failures (β > 1)"), "vcls": "info",
            "tables": [T(["Shape β", "Scale η", "Mean (MTTF)", "Median", "B10 life", "N"], [[f"{shape:.4f}", c.f(scale), c.f(dist.mean()), c.f(dist.median()), c.f(b10), n]]),
                       T(["Goodness of fit", "Statistic", "P"], [["Kolmogorov–Smirnov", f"{ks.statistic:.4f}", c.fp(ks.pvalue)]])],
            "charts": [prob, hist],
            "notes": ["2-parameter Weibull fitted by maximum likelihood. B10 = time by which 10% of units are expected to fail. All values are treated as failures (no censoring)."]}


ANALYSES = {
    "desc": a_desc, "t1": a_t1, "t2": a_t2, "tp": a_tp, "norm": a_norm, "corr": a_corr, "fit": a_fit, "mreg": a_mreg,
    "anova": a_anova, "var2": a_var2, "imr": a_imr, "cap": a_cap, "hist": a_hist, "scatter": a_scatter, "box": a_box,
    "mw": a_mw, "kw": a_kw, "chi": a_chi, "anova2": a_anova2, "tukey": a_tukey, "boxcox": a_boxcox, "weibull": a_weibull,
}


def run(aid, cols, sel, opt, dec=4, alpha=0.05):
    fn = ANALYSES.get(aid)
    if not fn:
        raise AnalysisError(f"Unknown analysis '{aid}'.")
    c = Ctx(cols, dec, alpha)
    try:
        out = fn(c, sel or {}, opt or {})
    except AnalysisError:
        raise
    except (KeyError, TypeError) as e:
        raise AnalysisError(f"Missing or invalid selection ({e}).")
    except (ValueError, ZeroDivisionError, np.linalg.LinAlgError) as e:
        raise AnalysisError(f"Could not compute: {e}")
    out.setdefault("charts", [])
    out.setdefault("notes", [])
    out.setdefault("verdict", "")
    out.setdefault("vcls", "info")
    return out
