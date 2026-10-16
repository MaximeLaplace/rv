import { gzipSync } from "node:zlib";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "precompress-assets",
    generateBundle: {
      // Vite must finish replacing preload markers before we compress chunks.
      order: "post",
      handler(_, bundle) {
        // Compress at build time, not on the first request. Include worker chunks
        // and language grammars, which are fetched independently of the entrypoint.
        for (const item of Object.values(bundle)) {
          if (!/\.(js|css|wasm|svg)$/.test(item.fileName)) continue;
          const source = item.type === "chunk" ? item.code : item.source;
          this.emitFile({
            type: "asset",
            fileName: `${item.fileName}.gz`,
            source: gzipSync(source, { level: 9 }),
          });
        }
      },
    },
  }],
  // The syntax highlighter loads language grammars from local bundled chunks.
  worker: { format: "es" },
});
