# Onitry (Monitry repo) patches

These are the Onitry side of the Onitry Plan integration, as `git am` patches:

1. `0001`: the local browser bridge (`core/bridge.py`), GUI wiring, pairing code, and `BRIDGE.md`.
2. `0002`: the weekly AI review (`/v1/review`, `ai/review.py`) and the native-messaging launcher (`native_host/`).

They're also committed on branch `claude/bold-davinci-spz652` in the Monitry repo. If that branch couldn't be pushed, apply them yourself:

```bash
cd path/to/Monitry
git checkout -b onitry-plan
git am path/to/ChromeExtensionTest/onitry-plan/onitry-patches/*.patch
python -m unittest tests.test_bridge tests.test_review tests.test_native_host
python native_host/install.py   # lets the extension launch Onitry
```
