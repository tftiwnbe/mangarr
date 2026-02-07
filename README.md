# Mangarr

I just tried to make something for myself.

---

## Features we want
- [ ] Paperback integration
- [ ] HTTP/SOCKS proxy for extensions
- [ ] Tasks scheduler
- [ ] Proper containerization

## Refactor needed
- [ ] BRIDGE: Move from `Manga` to `Title`, as it provides all kinds of entertainment

## It works, but...
- [ ] WEB: Show "No Extensions" instead of skeleton, when no extensions installed

## Things, that don't work at all
- [ ] BRIDGE: KCEF not installing with specified `installDir` (something wrong with paths?)
- [ ] BRIDGE: Have no endpoint to get source preferences
- [ ] BRIDGE: Return `supports_latest` in installed extension

---

# Special thanks
Many of the ideas and the groundwork adopted in this project comes from [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), that is spiritual successor of [TachiWeb-Server](https://github.com/Tachiweb/TachiWeb-server).
The AndroidCompat module was originally developed by [@null-dev](https://github.com/null-dev) for [TachiWeb-Server](https://github.com/Tachiweb/TachiWeb-server) and is licensed under Apache License Version 2.0 and Copyright 2019 Andy Bao and contributors.

Parts of [Mihon](https://github.com/mihonapp/mihon) is adopted into this codebase, also licensed under Apache License Version 2.0 and Copyright 2015 Javier Tomás.
Changes to codebases is licensed under MPL v. 2.0 as the rest of this project

---

# Disclaimer
The developer of this application does not have any affiliation with the content providers available.
