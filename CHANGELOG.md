# Changelog

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
