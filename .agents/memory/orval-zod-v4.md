---
name: Orval zod v4 codegen fix
description: Why the api-spec codegen script rewrites the zod import in generated code.
---

Orval v8 emits zod v4 syntax (`zod.int()`), but the workspace `zod` root entrypoint is v3, so typecheck fails after codegen.

**Fix in place:** the `@workspace/api-spec` codegen script runs a `sed` step rewriting `import * as zod from 'zod'` to `'zod/v4'` in `lib/api-zod/src/generated/api.ts` before typechecking. Do not remove that step; if codegen output paths change, update the sed path in lockstep.
