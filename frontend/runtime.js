/* Tiny runtime: renders the studio's {{hole}} / sc-if / sc-for template with Preact */
const { h, render: preactRender, Component: PreactComponent } = preact;
const TPL_ROOT = document.getElementById('tpl').content.firstElementChild;
const HOLE = /\{\{([^}]+)\}\}/g, WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
const EVMAP = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onscroll: 'onScroll', onpaste: 'onPaste', onkeydown: 'onKeyDown', onfocus: 'onFocus', onsubmit: 'onSubmit' };
function tplLookup(path, scope) {
  path = path.trim();
  if (path === 'true') return true; if (path === 'false') return false; if (path === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
  const parts = path.split('.'); let v, found = false;
  for (let s = scope; s; s = s.parent) { if (s.vars && Object.prototype.hasOwnProperty.call(s.vars, parts[0])) { v = s.vars[parts[0]]; found = true; break; } }
  if (!found) return undefined;
  for (let i = 1; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
  return v;
}
function tplStr(raw, scope) { return raw.replace(HOLE, (_, p) => { const v = tplLookup(p, scope); return v == null ? '' : String(v); }); }
function tplAttr(raw, scope) { const m = raw.match(WHOLE); if (m) return tplLookup(m[1], scope); return raw.indexOf('{{') < 0 ? raw : tplStr(raw, scope); }
function tplKids(node, scope) {
  const out = [];
  node.childNodes.forEach(n => { const r = tplBuild(n, scope); if (r == null) return; if (Array.isArray(r)) out.push(...r); else out.push(r); });
  return out;
}
function tplBuild(n, scope) {
  if (n.nodeType === 3) { const t = n.nodeValue; if (/\n/.test(t) && /^\s*$/.test(t)) return null; return t.indexOf('{{') < 0 ? t : tplStr(t, scope); }
  if (n.nodeType !== 1) return null;
  const tag = n.localName;
  if (tag === 'sc-if') return tplAttr(n.getAttribute('value') || '', scope) ? tplKids(n, scope) : null;
  if (tag === 'sc-for') {
    const list = tplAttr(n.getAttribute('list') || '', scope) || [], as = n.getAttribute('as') || 'item', out = [];
    list.forEach((it, i) => out.push(...tplKids(n, { vars: { [as]: it, $index: i }, parent: scope })));
    return out;
  }
  const props = {};
  for (const a of n.attributes) {
    let name = a.name; if (name.indexOf('hint-') === 0) continue;
    const ln = name.toLowerCase();
    if (EVMAP[ln]) { name = EVMAP[ln]; if (name === 'onChange' && ((tag === 'input' && (n.getAttribute('type') || 'text') !== 'file') || tag === 'textarea')) name = 'onInput'; }
    props[name] = tplAttr(a.value, scope);
  }
  return h(tag, props, ...tplKids(n, scope));
}
class DCLogic extends PreactComponent {
  render() { return tplBuild(TPL_ROOT, { vars: this.renderVals() }); }
}
