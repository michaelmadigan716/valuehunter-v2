# Always-Thinking engine

A Claude cloud routine (claude.ai/code/routines) runs every 2 hours, clones this repo, follows `thinking/HARNESS.md`, and reads/writes the board through `/api/thinking`. The dashboard is `/thinking`. Categories and defaults live in `lib/thinking.js`; the per-category reasoning briefs live in `thinking/categories/`. Edit those files to change how the engine thinks - the next run picks the change up automatically.
