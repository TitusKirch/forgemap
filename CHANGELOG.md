# Changelog

## [0.3.0](https://github.com/TitusKirch/forgemap/compare/v0.2.0...v0.3.0) (2026-05-24)


### Features

* **cleanup:** add --include-dirty and --include-unpushed ([769bafa](https://github.com/TitusKirch/forgemap/commit/769bafa3a0f19540b3c2d5f00fd51eaf07b5d4f7))
* **cleanup:** add cleanup command for stale, safely-backed-up repos ([bc24909](https://github.com/TitusKirch/forgemap/commit/bc24909efc34cf4ff569912a2e3295ced23fca71))
* **cleanup:** explain why idle repos are kept ([97e8095](https://github.com/TitusKirch/forgemap/commit/97e8095da77cd61720845e415213d731da85ccad))
* **cleanup:** prune all empty owner/server dirs, not just this run's ([3a4f285](https://github.com/TitusKirch/forgemap/commit/3a4f285eaedab98756b08393f74737e6070531f3))
* **completion:** add --install; one-step shell setup with completion ([138477a](https://github.com/TitusKirch/forgemap/commit/138477abed663edf236cf80fda9388bbc981b38b))
* import & cleanup commands, one-step shell setup, network hardening ([#7](https://github.com/TitusKirch/forgemap/issues/7)) ([b896caf](https://github.com/TitusKirch/forgemap/commit/b896cafeb314ecb0706a6029cac4a93ecfd64f29))
* **import:** add import command to adopt existing repo trees ([30925f3](https://github.com/TitusKirch/forgemap/commit/30925f3fce155e8fb5f89e3ed62ef4f57c74a24d))
* **import:** group the report tree by owner under each forge ([98d9e68](https://github.com/TitusKirch/forgemap/commit/98d9e680ddac93c3e574e44d7de5946be050f7e5))
* **shell-init:** add --install to write the loader into the rc file ([dd6130a](https://github.com/TitusKirch/forgemap/commit/dd6130a7aa047295f5d3d5b497b1b97257acba7d))
* **status,search:** group tree output by owner under each forge ([2ed69c5](https://github.com/TitusKirch/forgemap/commit/2ed69c5d4f7bf1b755c33c8036dc304db93a625f))


### Bug Fixes

* **cleanup:** base staleness on local branches; prune empty owner dirs ([41c292b](https://github.com/TitusKirch/forgemap/commit/41c292b15de3ec9ca24e9e172f12ed9f0bab6dee))
* **config:** discover config via parent walk-up and global fallback ([3876e9c](https://github.com/TitusKirch/forgemap/commit/3876e9ca51c391690ab56198b8b85d8757fee4cc))
* **import:** only report a remote as gone on an explicit not-found ([5b5cf86](https://github.com/TitusKirch/forgemap/commit/5b5cf86187064732a46428ddd79f21f543ed232d))
* **import:** time out and never block on a hung remote check ([8547db5](https://github.com/TitusKirch/forgemap/commit/8547db50fd5398dcc066ca13fa502410c58a04bc))
* **pick:** make the interactive picker render under captured stdout ([15fd3e6](https://github.com/TitusKirch/forgemap/commit/15fd3e630fbe1ee0ad370b734c5f345790e5495d))
* **pick:** render the picker UI to stderr, keep stdout to the path ([8a1ffaf](https://github.com/TitusKirch/forgemap/commit/8a1ffafd1299e305cf2e6e99e10fefc669e25497))
* **shell-init:** collapse duplicate/legacy rc blocks on re-install ([388be31](https://github.com/TitusKirch/forgemap/commit/388be31e55087a58ce0a0b502bad1f4fc988079b))
* **sync:** never hang on an unreachable remote during fetch/pull ([f99befd](https://github.com/TitusKirch/forgemap/commit/f99befd1710a53beadd717d1bc529f0ba6b9f75f))


### Performance Improvements

* **import:** batch GitHub checks, limit concurrency, show progress ([98a8209](https://github.com/TitusKirch/forgemap/commit/98a82091effb2436c224c8b8f750c15c6b7d90c9))

## [0.2.0](https://github.com/TitusKirch/forgemap/compare/v0.1.0...v0.2.0) (2026-05-23)


### Features

* clickable paths, shell-init, and interactive pick ([969d834](https://github.com/TitusKirch/forgemap/commit/969d834ee2d23a60a25ba7fc3244b913485e876f))
* **completion:** emit shell completion scripts ([c47f3b7](https://github.com/TitusKirch/forgemap/commit/c47f3b7fdfce7fe448f454ebb974748f59bc489d))
* **examples:** add sandbox playground ([83382dd](https://github.com/TitusKirch/forgemap/commit/83382dd17e342bc029728c742c536fea6144471b))
* forgemap cd via shell wrapper, drop fcd ([66ff114](https://github.com/TitusKirch/forgemap/commit/66ff114d8d30bfe82ebb9ccf3b74acb66278af1f))
* **forges:** add vanilla git adapter ([744188d](https://github.com/TitusKirch/forgemap/commit/744188d3e0cbba12eba4e868db9f7b1b22b0bf7e))
* implement clone, path and config commands ([e313ccf](https://github.com/TitusKirch/forgemap/commit/e313ccfcb95ac6add451c1e5371344ea187f06b7))
* **open:** add forgemap open and drop unreliable OSC 8 links ([4352c3f](https://github.com/TitusKirch/forgemap/commit/4352c3f34987e3978d1018420f960b12664a0781))
* **repos:** add execCapture and git ops module ([e4d7833](https://github.com/TitusKirch/forgemap/commit/e4d7833e6d2c8d412726a1461ce021d55e6dbe7b))
* **repos:** cache scanRepos by depth-3 mtime fingerprint ([44fd6f0](https://github.com/TitusKirch/forgemap/commit/44fd6f08b09bb28dddb644741e1cb3bfcc0748ee))
* **search:** fuzzy-find cloned repos by owner/repo ([853f4a5](https://github.com/TitusKirch/forgemap/commit/853f4a510fe2403d109f0c5aaeb6ec0425967e66))
* **search:** translate file:// links to UNC form on WSL ([201b895](https://github.com/TitusKirch/forgemap/commit/201b895ff857519f0e0dd3bb553299c886467541))
* **search:** tty-aware output with pretty default ([889ceb3](https://github.com/TitusKirch/forgemap/commit/889ceb32b457f284a786208cb251a1a55b1f6d10))
* **status:** per-repo branch/dirty/ahead/behind output ([b8072bb](https://github.com/TitusKirch/forgemap/commit/b8072bb1af844c1151ee9c8a6b807370e653767f))
* **sync:** parallel git fetch/pull across all repos ([09ddb21](https://github.com/TitusKirch/forgemap/commit/09ddb212898f8183cd0517acde26f674a2396fa1))
* **validate:** preflight the config and required tooling ([e78914c](https://github.com/TitusKirch/forgemap/commit/e78914ca31370ca30a2caf1a44b3f81aeb4d99fa))


### Bug Fixes

* **config:** close file-system race in config init ([5003760](https://github.com/TitusKirch/forgemap/commit/50037601aa165d1e23208ec7743e1687a711437a))


### Performance Improvements

* **cache:** ttl fast path, parallel stats, incremental updates ([bf8140d](https://github.com/TitusKirch/forgemap/commit/bf8140df03cef8c6aa76492d04b8060275366c61))
