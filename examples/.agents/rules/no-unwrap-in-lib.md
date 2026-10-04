---
description: Library code returns errors instead of panicking
condition: "\\.unwrap\\(\\)"
scope: "tool:edit(src/**/*.rs), tool:write(src/**/*.rs)"
interruptMode: never
---

Library code under `src/` should not call `.unwrap()`. Propagate the error with `?`
or return a typed error. `unwrap` is fine in tests, examples and `main`.
