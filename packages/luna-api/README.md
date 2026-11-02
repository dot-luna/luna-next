# Luna API

Shared Luna operations for Bun, including project information and self setup.
From the workspace, call the API with an existing checkout:

```ts
import { Luna } from "@luna/api";

const response = await Luna.info({ repository: process.cwd() });
console.log(response);
```

See [DOCS.md](DOCS.md) for self operations, errors, and checks.
