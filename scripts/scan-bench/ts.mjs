/**
 * Lets this script import `packages/core` and `apps/web/lib` as they are. Node
 * strips the types itself; what it won't do is guess the `.ts` that the app's
 * extensionless imports (`./money`) leave off. docs/scan-bench.md
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});
