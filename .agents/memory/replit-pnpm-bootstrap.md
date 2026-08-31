---
name: Replit pnpm bootstrap
description: Recovery and prevention for recursive pnpm self-install failures in this workspace.
---

Keep the root package-manager pin aligned with the pnpm version supplied by the Replit environment. Do not leave a generated local `pnpm` executable in the workspace dependency tree.

**Why:** When the requested pnpm version was unavailable, concurrent managed workflows triggered overlapping self-installs. The partial local install shadowed the system pnpm inside package scripts, recursively launched more self-installs, exhausted the process/thread limit, and left workspace links incomplete.

**How to apply:** If several workflows fail before their app commands with `pnpm add pnpm@...`, stop the runaway installers first. Align the pin with the available runtime, remove only the stray generated local pnpm package/bin, reinstall workspace links, regenerate API clients, and restart managed workflows sequentially.