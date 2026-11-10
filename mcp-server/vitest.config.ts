import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // test/** — тесты паритета с кодом сайта (src/lib/rigging): они вне src/,
        // чтобы сборка tsc MCP-сервера не включала файлы сайта.
        include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        exclude: ["node_modules", "build"],
    },
});
