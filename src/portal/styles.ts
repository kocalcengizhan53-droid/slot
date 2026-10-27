/**
 * The portal's one stylesheet, inlined into every page so the first paint needs no second
 * request. Dark is the brand; light follows the system or the toggle. Code panels stay dark
 * in both, as they do in most API docs, so a snippet looks the same wherever it is pasted from.
 */

const LIGHT = `
  --bg: #f7f6f2; --bg-2: #efede6; --panel: #ffffff; --panel-2: #f9f8f4; --line: #e3e0d6; --line-2: #d3cfc2;
  --ink: #15161a; --ink-2: #3a3e48; --mute: #5c6170; --accent: #8a5b00; --accent-soft: #fbefd3;
  --b-ok: #0f6b31; --b-bad: #b42318; --b-rp: #6941c6;
  --ok: #0f6b31; --bad: #b42318; --hold: #6941c6; --info: #175cd3; --glow: 0 0 0 transparent;
  color-scheme: light;`;

export const STYLES = /* css */ `
@font-face { font-family: "Geist"; src: url(/fonts/geist-5.3.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Geist Mono"; src: url(/fonts/geist-mono-5.3.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
:root {
  --bg: #0a0b0e; --bg-2: #0e1015; --panel: #12141a; --panel-2: #171a21; --line: #22252e; --line-2: #2f3340;
  --ink: #eceef3; --ink-2: #b7bcc9; --mute: #8e94a3; --accent: #f6c453; --accent-soft: #2a2312;
  --ok: #4ade80; --bad: #f87171; --hold: #b69cff; --info: #7cc4ff; --glow: 0 0 24px #f6c45333;
  --code-bg: #0c0e12; --code-line: #1f232c; --code-ink: #d5d9e2; --code-mute: #7d8494;
  --amber: #f6c453; --amber-ink: #1b1505;
  --b-ok: #4ade80; --b-bad: #fca5a5; --b-rp: #c9a8ff;
  --sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --radius: 12px; --ease: cubic-bezier(.2,.7,.2,1);
  color-scheme: dark;
}
:root[data-theme="light"] { ${LIGHT} }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ${LIGHT} } }

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 var(--sans); font-feature-settings: "ss01"; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
a { color: inherit; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
::selection { background: #f6c45355; }
code, kbd, pre, .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
p code, li code, td code, dd code { font-size: .86em; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: .1em .35em; }
h1, h2, h3, h4 { line-height: 1.15; letter-spacing: -0.02em; margin: 0; text-wrap: balance; }
h1 { font-size: clamp(2.2rem, 5.4vw, 3.9rem); font-weight: 650; letter-spacing: -0.035em; }
h2 { font-size: clamp(1.45rem, 3vw, 2rem); font-weight: 620; }
h3 { font-size: 1.12rem; font-weight: 600; }
p { margin: 0; }
.skip { position: absolute; left: 12px; top: -48px; background: var(--accent); color: var(--amber-ink); padding: 8px 12px; border-radius: 8px; z-index: 50; font-weight: 600; }
.skip:focus { top: 12px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-left)); }
.eyebrow { font: 600 .72rem/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--mute); }
.lede { color: var(--ink-2); font-size: clamp(1.02rem, 1.6vw, 1.2rem); max-width: 60ch; }
.muted { color: var(--mute); }
.small { font-size: .86rem; }

/* header */
.top { position: sticky; top: 0; z-index: 20; background: color-mix(in oklab, var(--bg) 82%, transparent); backdrop-filter: blur(14px) saturate(1.4); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; gap: 18px; height: 60px; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 650; letter-spacing: -0.02em; font-size: 1.05rem; text-decoration: none; flex: none; }
.brand svg { width: 26px; height: 26px; }
.nav { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; min-width: 0; flex: 1; }
.nav::-webkit-scrollbar { display: none; }
.nav a { padding: 7px 11px; border-radius: 8px; color: var(--ink-2); text-decoration: none; white-space: nowrap; font-size: .92rem; }
.nav a:hover { color: var(--ink); background: var(--panel-2); }
.nav a[aria-current="page"] { color: var(--ink); background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line); }
.top-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.status-pill { display: inline-flex; align-items: center; gap: 8px; font: 500 .78rem/1 var(--mono); color: var(--ink-2); border: 1px solid var(--line); border-radius: 999px; padding: 7px 11px; text-decoration: none; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 0 #4ade8066; animation: pulse 2.4s var(--ease) infinite; flex: none; }
.dot.warn { background: var(--accent); }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 #4ade8066; } 70% { box-shadow: 0 0 0 8px #4ade8000; } 100% { box-shadow: 0 0 0 0 #4ade8000; } }
.icon-btn { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; border: 1px solid var(--line); background: transparent; color: var(--ink-2); cursor: pointer; }
.icon-btn:hover { color: var(--ink); background: var(--panel-2); }
.icon-btn svg { width: 17px; height: 17px; }
@media (max-width: 760px) { .status-pill .label { display: none; } .top .wrap { gap: 8px 10px; flex-wrap: wrap; height: auto; padding-top: 10px; } .top-actions { margin-left: auto; } .nav { order: 3; flex-basis: 100%; margin: 0 -6px; padding-bottom: 8px; } html { scroll-padding-top: 116px; } }

/* buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 0 18px; border-radius: 999px; font: 600 .95rem/1 var(--sans); border: 1px solid transparent; cursor: pointer; text-decoration: none; transition: transform .15s var(--ease), background .15s, box-shadow .2s; }
.btn:active { transform: scale(.97); }
.btn.primary { background: var(--amber); color: var(--amber-ink); box-shadow: var(--glow); }
.btn.primary:hover { background: #ffd36e; }
.btn.ghost { background: transparent; color: var(--ink); border-color: var(--line-2); }
.btn.ghost:hover { background: var(--panel-2); }
.btn.sm { min-height: 34px; padding: 0 13px; font-size: .86rem; }
.btn[disabled] { opacity: .45; cursor: not-allowed; transform: none; }
.btn .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; display: none; }
.btn[aria-busy="true"] .spin { display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

/* hero */
.hero { position: relative; padding: clamp(40px, 7vw, 88px) 0 40px; overflow: hidden; }
.hero::before { content: ""; position: absolute; inset: -20% -10% auto; height: 620px; background: radial-gradient(50% 60% at 70% 30%, #f6c45318, transparent 70%), radial-gradient(40% 50% at 15% 10%, #7cc4ff12, transparent 70%); pointer-events: none; }
.hero-grid { position: relative; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 56px); align-items: center; }
@media (max-width: 960px) { .hero-grid { grid-template-columns: minmax(0, 1fr); } }
.hero h1 em { font-style: normal; color: var(--accent); }
.hero .ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
.hero .facts { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 26px; color: var(--mute); font: .8rem/1.4 var(--mono); }
.hero .facts span::before { content: "▪ "; color: var(--accent); }

/* the race */
.race { position: relative; background: linear-gradient(180deg, var(--panel), var(--bg-2)); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 40px 80px -40px #000c; }
.race-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.race-head b { font-size: .95rem; }
.race-slot { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; }
.race-slot .cal { width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font: 650 .78rem/1.1 var(--mono); text-align: center; }
.race-slot .cap { font: 600 .8rem/1 var(--mono); padding: 6px 9px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--ink-2); white-space: nowrap; }
.race-slot .cap.taken { color: var(--ok); border-color: #2d6b45; background: #4ade8014; }
.lanes { display: grid; gap: 8px; }
.lane { position: relative; display: grid; grid-template-columns: 70px minmax(36px, 1fr) auto; gap: 10px; align-items: center; height: 34px; font: .78rem/1 var(--mono); color: var(--mute); }
.lane .who { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lane .track { position: relative; height: 2px; background: var(--line); border-radius: 2px; overflow: visible; }
.lane .pkt { position: absolute; top: -4px; left: 0; width: 10px; height: 10px; border-radius: 50%; background: var(--ink-2); transform: translateX(0); opacity: 0; }
.lane .res { justify-self: end; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); white-space: nowrap; opacity: .35; transition: opacity .2s; }
.lane.ok .res { color: var(--ok); border-color: #2d6b45; background: #4ade8012; opacity: 1; }
.lane.no .res { color: var(--bad); border-color: #6b2d2d; background: #f8717110; opacity: 1; }
.lane.ok .pkt { background: var(--ok); box-shadow: 0 0 12px var(--ok); }
.lane.no .pkt { background: var(--bad); }
.race[data-mode="idle"] .lane .pkt { animation: fly 3.6s var(--ease) infinite; animation-delay: calc(var(--i) * 90ms); }
.race[data-mode="idle"] .lane .res { animation: reveal 3.6s steps(1) infinite; animation-delay: calc(var(--i) * 90ms); }
@keyframes fly { 0% { left: 0; opacity: 0; } 8% { opacity: 1; } 42% { left: calc(100% - 10px); opacity: 1; } 55%, 100% { left: calc(100% - 10px); opacity: 0; } }
@keyframes reveal { 0%, 40% { opacity: .35; } 41%, 88% { opacity: 1; } 89%, 100% { opacity: .35; } }
.race[data-mode="live"] .lane .pkt { opacity: 1; left: calc(100% - 10px); transition: left .5s var(--ease); }
.race[data-mode="live"] .lane.waiting .pkt { left: 40%; animation: wait .8s ease-in-out infinite alternate; }
@keyframes wait { from { left: 30%; } to { left: 60%; } }
.race-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
.race-foot p { color: var(--mute); font-size: .84rem; max-width: 46ch; }

/* sections */
section.band { padding: clamp(48px, 7vw, 96px) 0; border-top: 1px solid var(--line); }
.band-head { display: grid; gap: 12px; margin-bottom: clamp(24px, 4vw, 44px); max-width: 760px; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 14px; }
.feature { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; display: grid; gap: 8px; align-content: start; transition: border-color .2s, transform .2s var(--ease); }
.feature:hover { border-color: var(--line-2); transform: translateY(-2px); }
.feature .ico { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.feature .ico svg { width: 18px; height: 18px; }
.feature p { color: var(--ink-2); font-size: .92rem; }

/* latency strip */
.latency { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 12px; }
.metric { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; display: grid; gap: 4px; }
.metric .k { color: var(--mute); font: .74rem/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.metric .v { font: 600 1.9rem/1.1 var(--mono); letter-spacing: -0.02em; }
.metric .v small { font-size: .9rem; color: var(--mute); font-weight: 500; }
.metric .n { color: var(--mute); font-size: .8rem; }
.spark { width: 100%; height: 44px; display: block; margin-top: 6px; }

/* steps */
.steps { display: grid; gap: clamp(28px, 5vw, 56px); counter-reset: step; }
.step { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: clamp(18px, 3vw, 36px); align-items: start; }
@media (max-width: 960px) { .step { grid-template-columns: minmax(0, 1fr); } }
.step-text { display: grid; gap: 10px; position: sticky; top: 84px; }
@media (max-width: 960px) { .step-text { position: static; } }
.step-text h3 { display: flex; gap: 12px; align-items: baseline; }
.step-text h3::before { counter-increment: step; content: counter(step, decimal-leading-zero); font: 600 .8rem/1 var(--mono); color: var(--accent); }
.step-text p, .step-text li { color: var(--ink-2); font-size: .95rem; }
.step-text ul { margin: 0; padding-left: 1.1em; display: grid; gap: 4px; }
.step[data-done="true"] .step-text h3::before { content: "✓"; color: var(--ok); }

/* code panel */
.code { background: var(--code-bg); border: 1px solid var(--code-line); border-radius: var(--radius); overflow: hidden; color: var(--code-ink); min-width: 0; box-shadow: 0 24px 48px -32px #000; }
.code-bar { display: flex; align-items: center; gap: 4px; padding: 6px 6px 0 10px; border-bottom: 1px solid var(--code-line); }
.code-bar [role="tab"] { background: none; border: 0; color: var(--code-mute); font: 500 .8rem/1 var(--mono); padding: 9px 10px 11px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.code-bar [role="tab"][aria-selected="true"] { color: var(--code-ink); border-bottom-color: var(--amber); }
.code-bar .sp { flex: 1; }
.code-bar .copy { background: none; border: 1px solid var(--code-line); color: var(--code-mute); border-radius: 7px; font: .74rem/1 var(--mono); padding: 6px 8px; cursor: pointer; margin-bottom: 6px; }
.code-bar .copy:hover { color: var(--code-ink); }
.code pre { margin: 0; padding: 14px 16px; overflow-x: auto; font-size: .8rem; line-height: 1.65; tab-size: 2; }
.code pre:focus-visible { outline-offset: -2px; }
.tk-s { color: #a5e3a1; } .tk-k { color: #f6c453; } .tk-c { color: #8a92a3; font-style: italic; } .tk-n { color: #9ccfff; } .tk-p { color: #c9a8ff; } .tk-f { color: #ffb38a; }
.run-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--code-line); background: #0f1217; flex-wrap: wrap; }
.run-bar .hint { color: var(--code-mute); font: .76rem/1.3 var(--mono); flex: 1; min-width: 160px; }
.run-bar .btn.ghost { color: var(--code-ink); border-color: #343a48; }
.response { border-top: 1px solid var(--code-line); }
.response[hidden] { display: none; }
.resp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; font: .76rem/1 var(--mono); color: var(--code-mute); }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 7px; font: 600 .74rem/1 var(--mono); border: 1px solid; white-space: nowrap; }
.badge.s2 { color: var(--b-ok); border-color: color-mix(in oklab, var(--b-ok) 40%, transparent); background: color-mix(in oklab, var(--b-ok) 8%, transparent); }
.badge.s4, .badge.s5 { color: var(--b-bad); border-color: color-mix(in oklab, var(--b-bad) 40%, transparent); background: color-mix(in oklab, var(--b-bad) 7%, transparent); }
.badge.rp { color: var(--b-rp); border-color: color-mix(in oklab, var(--b-rp) 40%, transparent); background: color-mix(in oklab, var(--b-rp) 8%, transparent); }
.code { --b-ok: #4ade80; --b-bad: #fca5a5; --b-rp: #c9a8ff; }
.resp-body { max-height: 320px; overflow: auto; }
.resp-body pre { padding-top: 0; }
.flash { animation: flash .9s var(--ease); }
@keyframes flash { from { background: #f6c45322; } to { background: transparent; } }

/* method + path */
.m { display: inline-block; font: 650 .68rem/1 var(--mono); padding: 4px 6px; border-radius: 5px; letter-spacing: .04em; min-width: 46px; text-align: center; }
.m.get { color: #4ade80; background: #4ade8016; } .m.post { color: #f6c453; background: #f6c45316; }
.m.put { color: #7cc4ff; background: #7cc4ff16; } .m.delete { color: #f87171; background: #f8717116; }
:root[data-theme="light"] .m.get { color: #0f6b31; } :root[data-theme="light"] .m.post { color: #8a5b00; }
:root[data-theme="light"] .m.put { color: #175cd3; } :root[data-theme="light"] .m.delete { color: #b42318; }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .m.get { color: #0f6b31; } :root:not([data-theme="dark"]) .m.post { color: #8a5b00; } :root:not([data-theme="dark"]) .m.put { color: #175cd3; } :root:not([data-theme="dark"]) .m.delete { color: #b42318; } }
.code .m.get { color: #4ade80; } .code .m.post { color: #f6c453; } .code .m.put { color: #7cc4ff; } .code .m.delete { color: #f87171; }

/* docs layout */
.docs { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: clamp(20px, 4vw, 48px); padding-block: 32px 80px; }
@media (max-width: 960px) { .docs { grid-template-columns: minmax(0, 1fr); } }
.side { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 92px); overflow: auto; display: grid; gap: 18px; padding-right: 6px; }
.chips { display: none; }
@media (max-width: 960px) {
  .side { display: none; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 4px -16px 0; padding: 0 16px; }
  .chips a { flex: none; font-size: .86rem; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; color: var(--ink-2); background: var(--panel); }
}
.side-groups { display: grid; gap: 18px; }
.side h4 { font: 600 .72rem/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--mute); margin-bottom: 8px; }
.side a { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; text-decoration: none; color: var(--ink-2); font-size: .88rem; }
.side a:hover { background: var(--panel-2); color: var(--ink); }
.side a .m { min-width: 40px; font-size: .62rem; padding: 3px 4px; }
.doc { display: grid; gap: 56px; min-width: 0; }
.doc > *, .prose > *, .doc-head > * { min-width: 0; }
.doc-head { display: grid; gap: 12px; }
.op { display: grid; gap: 18px; scroll-margin-top: 80px; padding-top: 8px; border-top: 1px solid var(--line); padding-top: 32px; }
.op-head { display: grid; gap: 10px; }
.op-path { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font: 500 .95rem/1.3 var(--mono); }
.op-path code { overflow-wrap: anywhere; }
.op-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; align-items: start; }
@media (max-width: 1100px) { .op-grid { grid-template-columns: minmax(0, 1fr); } }
.op-desc { color: var(--ink-2); }
.lat-badge { display: inline-flex; gap: 10px; font: .76rem/1 var(--mono); color: var(--mute); border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; width: fit-content; }
.lat-badge b { color: var(--ink); font-weight: 600; }
.lat-badge { flex-wrap: wrap; row-gap: 4px; border-radius: 12px; } .lat-badge > * { white-space: nowrap; }
.fields { display: grid; gap: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.fields h4 { font: 600 .72rem/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--mute); padding: 10px 12px; background: var(--panel-2); border-bottom: 1px solid var(--line); }
.field { display: grid; gap: 3px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.field:last-child { border-bottom: 0; }
.field .nm { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font: 500 .84rem/1.3 var(--mono); }
.field .ty { color: var(--mute); font-size: .78rem; }
.field .rq { color: var(--accent); font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; }
.field p { color: var(--ink-2); font-size: .86rem; }
.responses { display: grid; gap: 6px; }
.responses div { display: flex; gap: 10px; align-items: baseline; font-size: .88rem; color: var(--ink-2); }
.prose { display: grid; gap: 14px; max-width: 74ch; color: var(--ink-2); }
.prose h2 { color: var(--ink); margin-top: 18px; scroll-margin-top: 80px; }
.prose h3 { color: var(--ink); margin-top: 8px; }
.prose ul, .prose ol { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; }
.prose strong { color: var(--ink); }
.callout { border: 1px solid var(--line); border-left: 3px solid var(--accent); background: var(--panel); border-radius: 10px; padding: 12px 14px; color: var(--ink-2); }

/* tables */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-size: .88rem; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font: 600 .72rem/1.2 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--mute); background: var(--panel-2); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.num { font-family: var(--mono); text-align: right; white-space: nowrap; }
th.num { text-align: right; }
tr:target td { background: var(--accent-soft); }
.bar { height: 6px; border-radius: 3px; background: var(--line); position: relative; min-width: 80px; }
.bar i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--accent); }

/* status */
.chart { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
.chart svg { width: 100%; height: 200px; display: block; }
.legend { display: flex; gap: 16px; font: .78rem/1 var(--mono); color: var(--mute); margin-top: 10px; flex-wrap: wrap; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }

/* playground */
.pg { display: grid; grid-template-columns: 280px minmax(0, 1fr) 340px; gap: 16px; padding-block: 24px 64px; }
@media (max-width: 1180px) { .pg { grid-template-columns: minmax(0, 1fr); } }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.card h2 { font: 600 .74rem/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--mute); }
.field-row { display: grid; gap: 5px; }
.field-row label { color: var(--ink-2); font-size: .84rem; }
input[type="text"], input[type="date"], select { width: 100%; background: var(--bg); border: 1px solid var(--line-2); color: var(--ink); border-radius: 9px; padding: 9px 11px; font: inherit; min-height: 40px; }
input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--amber); }
.check { display: flex; gap: 10px; align-items: center; color: var(--ink-2); font-size: .88rem; }
.week { display: grid; grid-template-columns: 54px repeat(7, minmax(0, 1fr)); gap: 4px; }
.week .d { font: .7rem/1.2 var(--mono); color: var(--mute); text-align: center; padding: 4px 0; }
.week .t { font: .7rem/30px var(--mono); color: var(--mute); text-align: right; padding-right: 6px; }
.slot { height: 30px; border-radius: 7px; border: 1px solid transparent; font: .7rem/1 var(--mono); display: grid; place-items: center; background: var(--panel-2); color: var(--mute); cursor: default; padding: 0; }
.slot.free { background: #4ade8014; color: var(--ok); border-color: #4ade8030; cursor: pointer; }
.slot.free:hover, .slot.free[aria-pressed="true"] { border-color: var(--ok); box-shadow: 0 0 0 2px #4ade8033; }
.slot.some { background: #f6c45314; color: var(--accent); border-color: #f6c45330; cursor: pointer; }
.slot.full { background: #f8717112; color: var(--bad); }
.slot.past { background: transparent; color: var(--mute); border-color: var(--line); }
.slot.closed { background: transparent; border: 1px dashed var(--line); }
.slot.pop { animation: pop .5s var(--ease); }
@keyframes pop { 40% { transform: scale(1.12); } }
.rows { display: grid; }
.rowi { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: .86rem; }
.rowi:last-child { border-bottom: 0; }
.pill { font: 600 .7rem/1 var(--mono); padding: 5px 8px; border-radius: 999px; border: 1px solid var(--line-2); color: var(--mute); }
.pill.confirmed { color: var(--ok); border-color: #2d6b45; } .pill.held { color: var(--hold); border-color: #5b4a8c; }
.log { display: grid; font: .74rem/1.3 var(--mono); max-height: 340px; overflow: auto; }
.log div { display: grid; grid-template-columns: 46px minmax(0, 1fr) 34px 64px; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.log div span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log .s2 { color: var(--ok); } .log .s4, .log .s5 { color: var(--bad); }

/* key chip */
.keychip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: .78rem/1.2 var(--mono); color: var(--ink-2); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.keychip code { color: var(--ink); overflow-wrap: anywhere; }

/* footer */
footer { border-top: 1px solid var(--line); padding: 28px 0 40px; color: var(--mute); font-size: .86rem; }
footer .wrap { display: flex; gap: 16px; justify-content: space-between; flex-wrap: wrap; }
footer nav { display: flex; gap: 14px; flex-wrap: wrap; }
footer a { color: var(--ink-2); }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translate(-50%, 20px); background: var(--panel-2); border: 1px solid var(--line-2); color: var(--ink); padding: 10px 16px; border-radius: 12px; opacity: 0; transition: opacity .2s, transform .25s var(--ease); pointer-events: none; z-index: 60; max-width: calc(100vw - 32px); font-size: .9rem; }
.toast.on { opacity: 1; transform: translate(-50%, 0); }

.js .reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s var(--ease), transform .6s var(--ease); }
.js .reveal.in { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  .js .reveal { opacity: 1; transform: none; }
  .race[data-mode="idle"] .lane .pkt { opacity: 0; }
  .race[data-mode="idle"] .lane .res { opacity: 1; }
}
`;
