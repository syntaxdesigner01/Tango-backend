#!/usr/bin/env node
/**
 * Tango API Docs Generator
 * ─────────────────────────
 * Parses convex/*.ts files and regenerates:
 *   - docs/index.html  (Storybook-style full API reference)
 *   - docs/swagger.json (OpenAPI 3.0 for HTTP endpoints)
 *
 * Usage:
 *   node docs/generate.js
 *
 * How it works:
 *   1. Reads every convex/*.ts file (skips _generated/, schema.ts, crons.ts, auth.config.ts)
 *   2. Extracts exported function name, type (query/mutation/action/internal*), and args
 *   3. Reads schema.ts to extract table definitions
 *   4. Reads http.ts to extract HTTP route paths and methods
 *   5. Rewrites docs/index.html and docs/swagger.json from embedded templates
 *
 * Adding a new function:
 *   Just write the Convex function normally. Run `node docs/generate.js` (or `npm run docs`)
 *   and the docs will be regenerated automatically.
 *
 * Adding JSDoc descriptions:
 *   Place a JSDoc comment directly above `export const myFn = query({...})`:
 *
 *     /** Returns all tasks for the user. *\/
 *     export const list = query({ ... })
 *
 *   The first line of the JSDoc will appear as the function description in the docs.
 */

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const CONVEX_DIR = path.join(__dirname, '..', 'convex');
const DOCS_DIR   = __dirname;

const SKIP_FILES = new Set([
  'schema.ts',
  'crons.ts',
  'auth.config.ts',
  'auth.ts',
  'http.ts',
]);

const CONVEX_DEPLOYMENT = 'https://acrobatic-bison-425.eu-west-1.convex.site';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the first JSDoc comment immediately before `export const name =` */
function extractJsdoc(src, exportIndex) {
  const before = src.slice(0, exportIndex);
  const match = before.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/);
  if (!match) return '';
  // Return first sentence / line
  return match[1]
    .replace(/\n\s*\*\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\.\s/)[0]
    .replace(/\*\//g, '')
    .trim();
}

/**
 * Parse args block from a Convex function definition.
 * Extracts top-level keys and their validator types from `args: { ... }`.
 * Returns array of { name, type, required }.
 */
function parseArgs(src, funcStart) {
  // Find `args: {` after the function start
  const argsMatch = src.slice(funcStart).match(/\bargs\s*:\s*\{/);
  if (!argsMatch) return [];

  const start = funcStart + argsMatch.index + argsMatch[0].length;
  let depth = 1, i = start;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  const argsBody = src.slice(start, i - 1);

  // Match `key: v.something(...)` or `key: v.optional(...)` at top level
  const argRe = /(\w+)\s*:\s*(v\.[^\n,}]+)/g;
  const results = [];
  let m;
  while ((m = argRe.exec(argsBody)) !== null) {
    const name = m[1];
    const rawType = m[2].trim().replace(/,$/, '');
    const optional = rawType.startsWith('v.optional(');
    // Simplify validator to readable type
    const type = simplifyValidator(rawType);
    results.push({ name, type, required: !optional });
  }
  return results;
}

/** Convert a Convex validator string to a human-readable type. */
function simplifyValidator(v) {
  return v
    .replace(/v\.optional\((.+)\)$/, '$1?')
    .replace(/v\.id\(["'](\w+)["']\)/, 'Id<"$1">')
    .replace(/v\.string\(\)/, 'string')
    .replace(/v\.number\(\)/, 'number')
    .replace(/v\.boolean\(\)/, 'boolean')
    .replace(/v\.array\((.+)\)/, '$1[]')
    .replace(/v\.union\((.+)\)/, 'union')
    .replace(/v\.literal\(["'](.+)["']\)/, '"$1"')
    .replace(/paginationOptsValidator/, 'PaginationOptions')
    .trim();
}

/** Determine badge class from function type string. */
function badgeClass(type) {
  if (type.startsWith('internal')) return 'badge-internal';
  if (type === 'query')    return 'badge-query';
  if (type === 'mutation') return 'badge-mutation';
  if (type === 'action')   return 'badge-action';
  return 'badge-internal';
}

/** Sidebar badge letter. */
function badgeLetter(type) {
  if (type.startsWith('internal')) return 'I';
  if (type === 'query')    return 'Q';
  if (type === 'mutation') return 'M';
  if (type === 'action')   return 'A';
  return 'I';
}

/** Human-readable label for a function type. */
function typeLabel(type) {
  const labels = {
    query:             'query',
    mutation:          'mutation',
    action:            'action',
    internalQuery:     'internal query',
    internalMutation:  'internal mutation',
    internalAction:    'internal action',
  };
  return labels[type] || type;
}

// ── Parse Convex Files ────────────────────────────────────────────────────────

function parseConvexFiles() {
  const modules = {}; // { moduleName: [ { name, type, args, description } ] }

  const files = fs.readdirSync(CONVEX_DIR).filter(f => {
    if (!f.endsWith('.ts')) return false;
    if (f.startsWith('_')) return false;
    if (SKIP_FILES.has(f)) return false;
    return true;
  });

  for (const file of files) {
    const moduleName = file.replace(/\.ts$/, '');
    const src = fs.readFileSync(path.join(CONVEX_DIR, file), 'utf8');
    const fns = [];

    // Match `export const <name> = (query|mutation|action|internalQuery|internalMutation|internalAction)(`
    const fnRe = /export\s+const\s+(\w+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;
    let match;
    while ((match = fnRe.exec(src)) !== null) {
      const name    = match[1];
      const type    = match[2];
      const idx     = match.index;
      const desc    = extractJsdoc(src, idx);
      const args    = parseArgs(src, idx);

      fns.push({ name, type, args, description: desc });
    }

    if (fns.length > 0) {
      modules[moduleName] = fns;
    }
  }

  return modules;
}

// ── Parse HTTP Routes ─────────────────────────────────────────────────────────

function parseHttpRoutes() {
  const src = fs.readFileSync(path.join(CONVEX_DIR, 'http.ts'), 'utf8');
  const routes = [];
  const re = /http\.route\s*\(\s*\{[^}]*path\s*:\s*["']([^"']+)["'][^}]*method\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.push({ path: m[1], method: m[2].toUpperCase() });
  }
  return routes;
}

// ── Parse Schema ──────────────────────────────────────────────────────────────

function parseSchema() {
  const src = fs.readFileSync(path.join(CONVEX_DIR, 'schema.ts'), 'utf8');
  const tables = {};

  // Match `tableName: defineTable({...})`
  const tableRe = /(\w+)\s*:\s*defineTable\s*\(/g;
  let m;
  while ((m = tableRe.exec(src)) !== null) {
    const tableName = m[1];
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    // Find matching paren
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const body = src.slice(start, i - 1);

    // Extract fields from v.object({ ... }) or top-level
    const fields = [];
    const fieldRe = /(\w+)\s*:\s*(v\.[^\n,}(]+(?:\([^)]*\))?)/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      // Skip 'kind' in union types (already complex)
      fields.push({
        name: fm[1],
        type: simplifyValidator(fm[2].trim()),
        optional: fm[2].includes('v.optional('),
      });
    }

    tables[tableName] = fields;
  }

  return tables;
}

// ── HTML Generation ───────────────────────────────────────────────────────────

/** Convert a simplified type string to a sensible JSON placeholder value. */
function typeToJsonValue(type) {
  const t = type.replace(/\?$/, '').trim();
  if (t === 'string')  return '""';
  if (t === 'number')  return '0';
  if (t === 'boolean') return 'false';
  if (t === 'PaginationOptions') return '{ "numItems": 10, "cursor": null }';
  if (t.startsWith('Id<')) {
    const table = t.match(/Id<"(\w+)">/)?.[1] || 'table';
    return `"<${table}_id>"`;
  }
  if (t.endsWith('[]')) return '[]';
  if (t === 'union') return '"<value>"';
  return 'null';
}

/** Build a pretty JSON object string from an args array. */
function generateJsonExample(args) {
  if (!args || args.length === 0) return null;
  const lines = args.map(a => {
    const value = typeToJsonValue(a.type);
    const optional = !a.required ? '  // optional' : '';
    return `  "${a.name}": ${value}${optional ? optional : ''}`;
  });
  return `{\n${lines.join(',\n')}\n}`;
}

function generateArgsTable(args) {
  if (!args || args.length === 0) {
    return '<div class="no-args">No arguments</div>';
  }
  const rows = args.map(a => `
            <tr>
              <td class="arg-name">${a.name}</td>
              <td class="arg-type">${escapeHtml(a.type)}</td>
              <td><span class="${a.required ? 'pill-required' : 'pill-optional'}">${a.required ? 'required' : 'optional'}</span></td>
              <td></td>
            </tr>`).join('');
  return `
          <div class="args-label">Arguments</div>
          <table class="args">
            <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
            <tbody>${rows}
            </tbody>
          </table>`;
}

function generateFunctionCard(moduleName, fn) {
  const anchorId = `${moduleName}-${fn.name}`;
  const badge = badgeClass(fn.type);
  const label = typeLabel(fn.type);
  const apiRef = fn.type.startsWith('internal')
    ? `internal.${moduleName}.${fn.name}`
    : `api.${moduleName}.${fn.name}`;

  const exampleArgs = fn.args.length > 0
    ? `{ ${fn.args.slice(0, 2).map(a => `${a.name}: …`).join(', ')} }`
    : '';

  const exampleCall = fn.type.startsWith('internal')
    ? `const result = await ctx.runQuery(${apiRef}, ${exampleArgs || '{}'});`
    : fn.type === 'query'
    ? `const data = useQuery(${apiRef}${fn.args.length > 0 ? `, ${exampleArgs}` : ''});`
    : `const fn = useMutation(${apiRef});\nawait fn(${exampleArgs || ''});`;

  const jsonExample = generateJsonExample(fn.args);
  const jsonBlock = jsonExample
    ? `<div class="code-label" style="margin-top:14px;">Body / Arguments</div>
        <div class="code-wrap"><pre><code class="language-json">${escapeHtml(jsonExample)}</code></pre></div>`
    : '';

  return `
    <div class="card" id="${anchorId}">
      <div class="card-header">
        <span class="badge ${badge}">${label}</span>
        <h3>${moduleName}.${fn.name}</h3>
      </div>
      <div class="card-body">
        ${fn.description ? `<p class="fn-desc">${escapeHtml(fn.description)}</p>` : ''}
        ${generateArgsTable(fn.args)}
        ${jsonBlock}
        <div class="code-label" style="margin-top:14px;">Example</div>
        <div class="code-wrap"><pre><code class="language-typescript">${escapeHtml(exampleCall)}</code></pre></div>
      </div>
    </div>`;
}

function generateSidebarSection(moduleName, fns) {
  const items = fns.map(fn => {
    const letter = badgeLetter(fn.type);
    const fnBadgeClass = `fn-badge-${letter.toLowerCase()}`;
    return `    <a class="sidebar-link" href="#${moduleName}-${fn.name}">${fn.name} <span class="fn-badge ${fnBadgeClass}">${letter}</span></a>`;
  }).join('\n');

  const label = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  return `
  <div class="sidebar-section">
    <div class="sidebar-section-label">${label}</div>
${items}
  </div>`;
}

function generateHttpCard(route) {
  const anchorId = `http-${route.path.replace(/\//g, '-').replace(/^-/, '')}`;
  const badgeClass = route.method === 'GET' ? 'badge-get' : 'badge-post';
  return `
    <div class="card" id="${anchorId}">
      <div class="card-header">
        <span class="badge ${badgeClass}">${route.method}</span>
        <h3>${route.path}</h3>
      </div>
      <div class="card-body">
        <p class="fn-desc">See <a href="swagger.html" style="color:var(--accent2)">Swagger UI</a> for full documentation and interactive testing.</p>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Swagger JSON Generation ───────────────────────────────────────────────────

function generateSwaggerJson(routes) {
  const paths = {};

  for (const route of routes) {
    const p = route.path;
    const method = route.method.toLowerCase();
    if (!paths[p]) paths[p] = {};
    paths[p][method] = {
      summary: `${route.method} ${p}`,
      description: `Auto-generated from convex/http.ts`,
      operationId: `${method}_${p.replace(/\//g, '_').replace(/^_/, '')}`,
      tags: ['HTTP'],
      responses: {
        '200': { description: 'Success' },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Tango Backend HTTP API',
      version: '1.0.0',
      description: 'HTTP endpoints exposed by the Tango Convex backend. Auto-generated by docs/generate.js.',
    },
    servers: [{ url: CONVEX_DEPLOYMENT, description: 'Production' }],
    paths,
  };
}

// ── Build HTML ────────────────────────────────────────────────────────────────

function buildIndexHtml(modules, httpRoutes) {
  // Sidebar
  const sidebarSections = Object.entries(modules)
    .map(([name, fns]) => generateSidebarSection(name, fns))
    .join('\n');

  // Module sections
  const moduleSections = Object.entries(modules).map(([moduleName, fns]) => {
    const label = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    const cards = fns.map(fn => generateFunctionCard(moduleName, fn)).join('\n');
    return `
  <div class="section-divider"></div>
  <div class="section" id="${moduleName}">
    <div class="section-title">${label}</div>
    <div class="section-desc">Auto-generated from <code>convex/${moduleName}.ts</code></div>
    ${cards}
  </div>`;
  }).join('\n');

  // Auth section (hardcoded — convexAuth exports aren't standard query/mutation)
  const authSidebarSection = `
  <div class="sidebar-section">
    <div class="sidebar-section-label">Auth</div>
    <a class="sidebar-link" href="#auth-signIn">signIn <span class="fn-badge fn-badge-m">M</span></a>
    <a class="sidebar-link" href="#auth-signOut">signOut <span class="fn-badge fn-badge-m">M</span></a>
  </div>`;

  const authSection = `
  <div class="section-divider"></div>
  <div class="section" id="auth">
    <div class="section-title">Auth</div>
    <div class="section-desc">
      Authentication via <code>@convex-dev/auth</code> with a Password provider.
      Users must be pre-created by an admin (<code>users.addToCompany</code>) before they can sign in.
      Use the exported <code>signIn</code> / <code>signOut</code> mutations from <code>convex/auth.ts</code>.
    </div>

    <div class="card" id="auth-signIn">
      <div class="card-header">
        <span class="badge badge-mutation">mutation</span>
        <h3>auth.signIn</h3>
      </div>
      <div class="card-body">
        <p class="fn-desc">Signs a user in with their email and staffId as the password. On success the session is established and subsequent queries/mutations run as that user.</p>
        <div class="args-label">Arguments</div>
        <table class="args">
          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td class="arg-name">provider</td><td class="arg-type">string</td><td><span class="pill-required">required</span></td><td>Must be <code>"password"</code></td></tr>
            <tr><td class="arg-name">params.flow</td><td class="arg-type">string</td><td><span class="pill-required">required</span></td><td>Must be <code>"signIn"</code> for existing users</td></tr>
            <tr><td class="arg-name">params.email</td><td class="arg-type">string</td><td><span class="pill-required">required</span></td><td>User's email address</td></tr>
            <tr><td class="arg-name">params.password</td><td class="arg-type">string</td><td><span class="pill-required">required</span></td><td>The user's <code>staffId</code> (generated by admin on account creation)</td></tr>
          </tbody>
        </table>
        <div class="code-label" style="margin-top:14px;">Body / Arguments</div>
        <div class="code-wrap"><pre><code class="language-json">{
  "provider": "password",
  "params": {
    "flow": "signIn",
    "email": "",
    "password": ""
  }
}</code></pre></div>
        <div class="code-label" style="margin-top:14px;">Example</div>
        <div class="code-wrap"><pre><code class="language-typescript">import { useAuthActions } from "@convex-dev/auth/react";

const { signIn } = useAuthActions();
await signIn("password", { email: "jane@acme.com", password: staffId });</code></pre></div>
      </div>
    </div>

    <div class="card" id="auth-signOut">
      <div class="card-header">
        <span class="badge badge-mutation">mutation</span>
        <h3>auth.signOut</h3>
      </div>
      <div class="card-body">
        <p class="fn-desc">Ends the current session and clears the auth token. No arguments required.</p>
        <div class="no-args">No arguments</div>
        <div class="code-label">Example</div>
        <div class="code-wrap"><pre><code class="language-typescript">import { useAuthActions } from "@convex-dev/auth/react";

const { signOut } = useAuthActions();
await signOut();</code></pre></div>
      </div>
    </div>
  </div>`;

  // HTTP section
  const httpCards = httpRoutes.map(r => generateHttpCard(r)).join('\n');
  const httpSection = `
  <div class="section-divider"></div>
  <div class="section" id="httpEndpoints">
    <div class="section-title">HTTP Endpoints</div>
    <div class="section-desc">
      Standard HTTP routes at <code>${CONVEX_DEPLOYMENT}</code>.
      See <a href="swagger.html" style="color:var(--accent2)">Swagger UI ↗</a> for interactive testing.
    </div>
    ${httpCards}
  </div>`;

  const totalFns = Object.values(modules).reduce((s, fns) => s + fns.length, 0);
  const totalModules = Object.keys(modules).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tango API Docs</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --sidebar-w: 260px; --sidebar-bg: #1a1a2e; --sidebar-hover: #16213e;
      --sidebar-active: #0f3460; --accent: #a78bfa; --accent2: #7c3aed;
      --bg: #f8f8fb; --card-bg: #ffffff; --border: #e4e4f0;
      --text: #1e1e2e; --text-muted: #6b7280;
      --badge-query: #3b82f6; --badge-mutation: #10b981; --badge-action: #f59e0b;
      --badge-internal: #6b7280; --badge-http: #8b5cf6;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
    }
    body { font-family: var(--font); background: var(--bg); color: var(--text); display: flex; min-height: 100vh; }
    #sidebar { width: var(--sidebar-w); height: 100vh; background: var(--sidebar-bg); color: #c9d1d9; position: fixed; top: 0; left: 0; overflow-y: auto; display: flex; flex-direction: column; z-index: 100; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
    #sidebar::-webkit-scrollbar { width: 4px; }
    #sidebar::-webkit-scrollbar-track { background: transparent; }
    #sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
    #sidebar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
    .sidebar-brand { padding: 20px 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .sidebar-brand h1 { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    .sidebar-brand p { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; }
    .sidebar-section { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .sidebar-section-label { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: rgba(255,255,255,0.3); padding: 10px 20px 4px; }
    .sidebar-link { display: flex; align-items: center; gap: 8px; padding: 7px 20px; font-size: 13px; color: rgba(255,255,255,0.65); text-decoration: none; cursor: pointer; transition: background 0.15s, color 0.15s; border-left: 3px solid transparent; }
    .sidebar-link:hover { background: var(--sidebar-hover); color: #fff; }
    .sidebar-link.active { background: var(--sidebar-active); color: #fff; border-left-color: var(--accent); }
    .fn-badge { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: auto; flex-shrink: 0; color: #fff; }
    .fn-badge-q { background: var(--badge-query); }
    .fn-badge-m { background: var(--badge-mutation); }
    .fn-badge-a { background: var(--badge-action); color: #1a1a2e; }
    .fn-badge-i { background: var(--badge-internal); }
    .sidebar-footer { margin-top: auto; padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); }
    .sidebar-footer a { display: block; font-size: 12px; color: var(--accent); text-decoration: none; padding: 4px 0; }
    .sidebar-footer a:hover { text-decoration: underline; }
    #main { margin-left: var(--sidebar-w); flex: 1; padding: 0; }
    .section { padding: 40px 40px 20px; max-width: 960px; }
    .section-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .section-desc { font-size: 14px; color: var(--text-muted); margin-bottom: 28px; line-height: 1.6; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
    .card-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; background: #fafafa; }
    .card-header h3 { font-size: 15px; font-weight: 600; font-family: var(--mono); }
    .card-body { padding: 20px; }
    .badge { font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; color: #fff; flex-shrink: 0; }
    .badge-query    { background: var(--badge-query); }
    .badge-mutation { background: var(--badge-mutation); }
    .badge-action   { background: var(--badge-action); color: #1a1a2e; }
    .badge-internal { background: var(--badge-internal); }
    .badge-http     { background: var(--badge-http); }
    .badge-get      { background: #10b981; }
    .badge-post     { background: var(--badge-action); color: #1a1a2e; }
    .fn-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.6; }
    .args-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px; }
    table.args { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
    table.args thead th { text-align: left; padding: 7px 12px; background: #f4f4f8; border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); }
    table.args tbody td { padding: 8px 12px; border-bottom: 1px solid #f0f0f5; vertical-align: top; }
    table.args tbody tr:last-child td { border-bottom: none; }
    .arg-name { font-family: var(--mono); font-size: 12px; color: #5b21b6; font-weight: 600; }
    .arg-type { font-family: var(--mono); font-size: 12px; color: var(--badge-query); }
    .pill-required { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; background: #fee2e2; color: #b91c1c; font-weight: 600; }
    .pill-optional { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; background: #f0fdf4; color: #166534; font-weight: 600; }
    .no-args { font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 16px; }
    .code-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px; }
    .code-wrap { border-radius: 8px; overflow: hidden; font-size: 12.5px; line-height: 1.55; }
    .code-wrap pre { margin: 0; }
    .code-wrap code { font-family: var(--mono) !important; }
    .section-divider { height: 1px; background: var(--border); margin: 10px 40px; }
    .overview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; margin-bottom: 28px; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
    .stat-card .stat-num { font-size: 28px; font-weight: 700; color: var(--accent2); }
    .stat-card .stat-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .generated-notice { font-size: 11px; color: var(--text-muted); margin-top: 8px; }
    .generated-notice code { font-family: var(--mono); background: #f0f0f8; padding: 1px 4px; border-radius: 3px; }
  </style>
</head>
<body>
<nav id="sidebar">
  <div class="sidebar-brand">
    <h1>Tango</h1>
    <p>Backend API Reference · Auto-generated</p>
  </div>
  <div class="sidebar-section">
    <div class="sidebar-section-label">Getting Started</div>
    <a class="sidebar-link active" href="#overview">Overview</a>
  </div>
${authSidebarSection}
${sidebarSections}
  <div class="sidebar-section">
    <div class="sidebar-section-label">HTTP</div>
    <a class="sidebar-link" href="#httpEndpoints">HTTP Endpoints</a>
  </div>
  <div class="sidebar-footer">
    <a href="swagger.html">↗ Swagger UI (HTTP)</a>
    <a href="swagger.json">↗ swagger.json</a>
  </div>
</nav>
<main id="main">
  <div class="section" id="overview">
    <div class="section-title">Tango Backend</div>
    <div class="section-desc">
      Convex-powered backend for team task management and daily reporting.
      <div class="generated-notice">Generated by <code>node docs/generate.js</code> · Re-run after adding functions.</div>
    </div>
    <div class="overview-grid">
      <div class="stat-card"><div class="stat-num">${totalFns}</div><div class="stat-label">Total functions</div></div>
      <div class="stat-card"><div class="stat-num">${totalModules}</div><div class="stat-label">Modules</div></div>
      <div class="stat-card"><div class="stat-num">${httpRoutes.length}</div><div class="stat-label">HTTP endpoints</div></div>
    </div>
  </div>
${authSection}
${moduleSections}
${httpSection}
  <div style="height:60px;"></div>
</main>
<script>
  hljs.highlightAll();
  const links = document.querySelectorAll('.sidebar-link[href^="#"]');
  const ids = Array.from(links).map(l => l.getAttribute('href').slice(1));
  function onScroll() {
    let current = ids[0];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 120) current = id;
    }
    links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + current));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const t = document.getElementById(link.getAttribute('href').slice(1));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
<\/script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('Tango Docs Generator');
  console.log('────────────────────');

  console.log('Parsing Convex functions…');
  const modules = parseConvexFiles();
  const totalFns = Object.values(modules).reduce((s, fns) => s + fns.length, 0);
  console.log(`  Found ${totalFns} functions across ${Object.keys(modules).length} modules:`);
  for (const [name, fns] of Object.entries(modules)) {
    console.log(`    ${name}: ${fns.map(f => f.name).join(', ')}`);
  }

  console.log('\nParsing HTTP routes…');
  const httpRoutes = parseHttpRoutes();
  console.log(`  Found ${httpRoutes.length} routes: ${httpRoutes.map(r => `${r.method} ${r.path}`).join(', ')}`);

  console.log('\nGenerating docs/index.html…');
  const html = buildIndexHtml(modules, httpRoutes);
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), html, 'utf8');
  console.log('  ✓ docs/index.html');

  console.log('\nGenerating docs/swagger.json…');
  // Keep the detailed hand-crafted swagger.json if it exists and has rich descriptions
  // But regenerate the routes section to stay in sync with http.ts
  const swaggerPath = path.join(DOCS_DIR, 'swagger.json');
  let swagger;
  try {
    swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
    // Update servers in case deployment URL changed
    swagger.servers = [{ url: CONVEX_DEPLOYMENT, description: 'Production' }];
    // Add any new routes that aren't already documented
    for (const route of httpRoutes) {
      const method = route.method.toLowerCase();
      if (!swagger.paths[route.path]) {
        swagger.paths[route.path] = {};
      }
      if (!swagger.paths[route.path][method]) {
        swagger.paths[route.path][method] = {
          summary: `${route.method} ${route.path}`,
          description: 'Auto-generated from convex/http.ts — add details manually.',
          operationId: `${method}_${route.path.replace(/\//g, '_').replace(/^_/, '')}`,
          tags: ['HTTP'],
          responses: { '200': { description: 'Success' } },
        };
        console.log(`  + Added new route: ${route.method} ${route.path}`);
      }
    }
  } catch {
    // swagger.json doesn't exist or is invalid — generate fresh
    swagger = generateSwaggerJson(httpRoutes);
  }
  fs.writeFileSync(swaggerPath, JSON.stringify(swagger, null, 2), 'utf8');
  console.log('  ✓ docs/swagger.json');

  console.log('\nDone. Open docs/index.html in your browser.');
}

main();
