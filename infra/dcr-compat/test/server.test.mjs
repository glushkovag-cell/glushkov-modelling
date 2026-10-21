import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'server.mjs',
);

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function waitForHealth(port, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/healthz`);

            if (response.ok) {
                return true;
            }
        } catch {
            // Not listening yet.
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
}

function sendRaw(port, payload, timeoutMs = 2_000) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
        let data = '';

        const done = () => {
            socket.destroy();
            resolve(data);
        };

        socket.on('data', (chunk) => {
            data += chunk.toString();
        });
        socket.on('close', done);
        socket.on('error', done);
        setTimeout(done, timeoutMs);
    });
}

async function startServer(t) {
    const port = await freePort();
    const child = spawn(process.execPath, [SERVER_PATH], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    t.after(() => {
        child.kill('SIGTERM');
    });

    const started = await waitForHealth(port);

    assert.equal(started, true, `server did not start: ${stderr}`);

    return { port, child, stderr: () => stderr };
}

test('serves /healthz without touching the audit database', async (t) => {
    const { port } = await startServer(t);
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown path returns 404', async (t) => {
    const { port } = await startServer(t);
    const response = await fetch(`http://127.0.0.1:${port}/does-not-exist`);

    assert.equal(response.status, 404);
});

test('malformed request target is rejected with 400 and keeps the process alive', async (t) => {
    const { port, child } = await startServer(t);

    // `http://[` makes `new URL()` throw. Before the fix this escaped the
    // async request handler as an unhandled rejection and terminated Node.
    const raw = await sendRaw(
        port,
        'GET http://[ HTTP/1.1\r\nHost: localhost\r\n\r\n',
    );

    assert.match(raw, /^HTTP\/1\.1 400/);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);

    assert.equal(health.status, 200);
    assert.equal(child.exitCode, null, 'server exited after a malformed request');
});
