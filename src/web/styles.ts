export const authenticationStyles = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #111827; }
main { width: min(100% - 2rem, 28rem); margin: 2rem 0; padding: 2rem; border-radius: 1rem; background: #f9fafb; box-shadow: 0 1.5rem 4rem #0006; }
h1 { margin-top: 0; font-size: 1.65rem; }
p, li { line-height: 1.55; }
form { display: grid; gap: 1rem; }
label { display: grid; gap: 0.4rem; font-weight: 600; }
input { width: 100%; padding: 0.75rem; border: 1px solid #9ca3af; border-radius: 0.5rem; font: inherit; background: #fff; color: #111827; }
button, .button { display: inline-block; padding: 0.75rem 1rem; border: 0; border-radius: 0.5rem; background: #2563eb; color: #fff; font: inherit; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; }
button:hover, .button:hover { background: #1d4ed8; }
a { color: #1d4ed8; }
.links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.75rem; margin-top: 1.5rem; }
.error { padding: 0.75rem; border-radius: 0.5rem; background: #fee2e2; color: #991b1b; }
.muted { color: #4b5563; }
@media (prefers-color-scheme: dark) {
  main { background: #1f2937; color: #f9fafb; }
  .muted { color: #d1d5db; }
  a { color: #93c5fd; }
}
`
