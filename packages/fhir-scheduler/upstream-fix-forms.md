# Missing TypeScript Declaration Files in @mieweb/forms-renderer

## Summary

The `@mieweb/forms-renderer` package declares TypeScript types in its `package.json` exports but does not include the actual `.d.ts` files in the published npm package.

## Problem

In `package.json`, the package exports types:

```json
{
  "exports": {
    ".": {
      "import": "./dist/react.js",
      "types": "./dist/react.d.ts"
    }
  }
}
```

However, the published package only contains `.js` and `.js.map` files in the `dist/` folder:

```
dist/
├── blaze.js
├── blaze.js.map
├── blaze.umd.cjs
├── blaze.umd.cjs.map
├── react.js
├── react.js.map
├── standalone.js
├── standalone.js.map
├── standalone.umd.cjs
└── standalone.umd.cjs.map
```

**No `.d.ts` files are present.**

## Impact

Consumers of this package must create their own type declarations to use TypeScript, e.g.:

```typescript
// forms-renderer.d.ts - workaround for missing types
declare module '@mieweb/forms-renderer' {
  // ... manually maintained types
}
```

This is error-prone and creates maintenance burden for downstream projects.

## Suggested Fix

1. **Add TypeScript declaration generation** to the build process:

   In `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "declaration": true,
       "declarationDir": "./dist",
       "emitDeclarationOnly": false
     }
   }
   ```

   Or in `vite.config.js` using `vite-plugin-dts`:
   ```javascript
   import dts from 'vite-plugin-dts';

   export default {
     plugins: [
       dts({
         insertTypesEntry: true,
         include: ['src/**/*.ts', 'src/**/*.tsx']
       })
     ]
   };
   ```

2. **Verify `.d.ts` files are generated** during `npm run build`

3. **Ensure `files` in `package.json` includes the types** (already includes `dist`, so this should work once generated)

4. **Test the fix** by running `npm pack` and inspecting the tarball contents

## Environment

- Package version: 1.0.1
- Discovered in: FHIRTogether scheduler widget

## Related

- Workaround file: `packages/fhir-scheduler/src/types/forms-renderer.d.ts` in FHIRTogether
- Can be removed once upstream fix is published
