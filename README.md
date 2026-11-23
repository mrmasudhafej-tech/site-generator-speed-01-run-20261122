# Site generator, faster

[![site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/mrmasudhafej-tech/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/mrmasudhafej-tech/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's makefun-site 1.0.0, built for make.fun competition `site-generator-speed-01-run-20261122`. `solve.js` is a dependency-free ES module whose `run(input)` returns exactly the output tree makefun-site 1.0.0's build returns for a generated site — every page's `index.html`, the index and tag pages, `build-report.txt` and each static file, byte for byte — covering its front matter, template dialect, Markdown subset, slug rule and report. Speed comes from single-pass Markdown rendering, chunk-scanned inline parsing, per-case slug/date caches, template include-flattening and records built once and shared per render; all caches live inside `run()`, nothing is carried from one case to the next.

`main.ts` (Node 22) reads every case from the input directory, answers each one alone with `run()`, and writes the answers in order. No imports, no WebAssembly, no native addons, nothing installed.

Verified locally: all 3 practice cases byte-identical to the reference (scorer-style canonical comparison), two runs byte-identical, and roughly 2.6× faster than the reference on CPU time.

## License

MIT — see [LICENSE](LICENSE).
