# Onitry bridge patch

This patch is the Onitry (Monitry repo) side of the Today planner integration:
`core/bridge.py`, its tests, the GUI wiring, and `BRIDGE.md`.

It's also committed on branch `claude/bold-davinci-spz652` in the Monitry repo,
but in case that branch couldn't be pushed, you can apply it yourself:

```bash
cd path/to/Monitry
git checkout -b browser-bridge
git am path/to/ChromeExtensionTest/integrations/onitry/0001-*.patch
python -m unittest tests.test_bridge
```
