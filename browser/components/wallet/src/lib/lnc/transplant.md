Copy it just as it is
- `index.ts`
- `wasm_exec.js`
- `/api`
- `/types`

Transplant carefully looking at git log
- `lnc.ts`

`/util` is actually the mock.
- Can't use the localstorage due to security for the aboutpage
- Don't use webstorage to save the credentials to be able to insert it to other tab pages

Put the wasm file in `browser/components/wallet/content/wasm`