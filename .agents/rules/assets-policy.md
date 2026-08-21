# External assets policy

Sample packs, test audio, drum kits, stems and any commercial or large media
live in a **dedicated assets directory outside every repo** — never inside a
project checkout.

1. **Location is per-machine, via an environment variable.** Point
   `DAWBUDDY_ASSETS` at wherever you keep your assets; never hardcode a personal
   absolute path in the repo or in rules. Examples:
   - **Linux / macOS:** `export DAWBUDDY_ASSETS="$HOME/Assets"`
   - **Windows (PowerShell):** `setx DAWBUDDY_ASSETS "$env:USERPROFILE\Documents\Assets"`

   Refer to assets as `$DAWBUDDY_ASSETS/...` (or `%DAWBUDDY_ASSETS%\...` on
   Windows cmd), so the same instructions work on every machine.

2. **Never copy media into a project repo.** No `.wav`, `.mp3`, `.flac`, `.aif`,
   `.aiff`, `.ogg`, `.m4a` (or other sample/audio media) inside `daw_buddy` or
   any project working tree. Reference them from `$DAWBUDDY_ASSETS` instead.

3. **Clean up debugging media immediately.** If audio is temporarily placed
   while debugging, delete it before the task ends — it must never be committed
   or distributed. `.gitignore` blocks these extensions as a backstop, so an
   accidental `git add` won't stage them (use `git add -f` only for a genuinely
   intended, reviewed asset).
