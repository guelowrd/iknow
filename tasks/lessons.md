# Lessons

- 2026-09-25 · Any change that makes text longer or wider in the lists (labels, fonts, casing, letter
  spacing) is a visible identity change: screenshot before and after, compare row widths, and say so
  in the report before pushing. Gaylord noticed the long pot titles and a font swap as "a catastrophe".
- 2026-09-25 · Never let the look depend on a third-party font CDN: one failed request swapped the
  whole app to Courier New. Self-host fonts (web/public/fonts) with `font-display: block`.
- 2026-09-25 · "Same font and size as X" means match the one that looks right, not the one that is
  easier to match. Show a screenshot of the result with the request.
- perl -pi with `|` as the s### delimiter turns `\|\|` in the pattern into alternation and prefixes every line with the replacement (Admin.tsx, 2026-09-28): use the Edit tool for exact strings, or `\Q…\E` with a delimiter absent from the pattern.
- 2026-09-29 · A test run on the mock chain rewrote web/public/markets.json and the live operator (IKNOW_PUBLISH=1) pushed it at its next tick: production showed a mock pot for two minutes. Before running anything in the working tree the operator publishes from, list every file the code writes (grep writeFileSync) and check `git status` right after the first run. Mock mode now writes operator/markets.mock.json and the cycle test asserts the live file is untouched.
- 2026-09-29 · `git rm` stages at once: a later `git add <one file> && git commit` swept the staged deletion into an unrelated commit (a5e9e0e). Commit with `git commit -- <paths>` or check `git diff --cached --stat` first.
