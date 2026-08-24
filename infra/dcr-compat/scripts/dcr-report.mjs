#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
const ENV_FILE = process.env.DCR_REPORT_ENV_FILE || '/opt/glushkov-auth/.env';
const MOSCOW_TZ = 'Europe/Moscow';

if (!['daily', 'monthly', 'watchdog'].includes(mode)) {
    console.error('Usage: node scripts/dcr-report.mjs <daily|monthly|watchdog>');
    process.exit(64);
}

if (!fs.existsSync(ENV_FILE)) {
    console.error(`Environment file not found: ${ENV_FILE}`);
    process.exit(78);
}

dotenv.config({ path: ENV_FILE, override: false });

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function integer(name, fallback) {
    const value = process.env[name] ?? fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid integer environment variable: ${name}`);
    }
    return parsed;
}

function boolean(name, fallback = false) {
    const value = (process.env[name] ?? String(fallback)).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(value)) return true;
    if (['false', '0', 'no'].includes(value)) return false;
    throw new Error(`Invalid boolean environment variable: ${name}`);
}

function config() {
    const port = integer('KC_SMTP_PORT', '587');
    const secure = boolean('KC_SMTP_SECURE', false);
    if (port === 587 && secure) {
        throw new Error('KC_SMTP_SECURE must be false for Brevo STARTTLS port 587');
    }

    return {
        db: {
            host: required('AUDIT_DB_HOST'),
            port: integer('AUDIT_DB_PORT', '5432'),
            database: required('AUDIT_DB_NAME'),
            user: required('AUDIT_DB_USER'),
            password: required('AUDIT_DB_PASSWORD'),
            application_name: 'gm-dcr-report',
            max: 2,
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 10000,
        },
        smtp: {
            host: required('KC_SMTP_HOST'),
            port,
            secure,
            requireTLS: port === 587,
            auth: {
                user: required('KC_SMTP_USER'),
                pass: required('KC_SMTP_PASSWORD'),
            },
            from: required('KC_SMTP_FROM'),
        },
        recipient: required('DCR_REPORT_RECIPIENT'),
        proxyVersion: process.env.DCR_PROXY_VERSION?.trim() || 'unknown',
        allowList: process.env.DCR_TRUSTED_HOSTS?.trim() || '',
    };
}

function sqlDate(value) {
    return value.toISOString();
}

function partsInMoscow(date) {
    const dateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: MOSCOW_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    return dateParts;
}

function moscowMidnightUtc(year, month, day) {
    const candidate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const offsetText = new Intl.DateTimeFormat('en-US', {
        timeZone: MOSCOW_TZ,
        timeZoneName: 'longOffset',
    }).formatToParts(candidate).find((part) => part.type === 'timeZoneName')?.value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetText || '');
    if (!match) throw new Error('Unable to determine Europe/Moscow UTC offset');
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1);
    return new Date(candidate.getTime() - minutes * 60_000);
}

function dailyPeriod(now = new Date()) {
    const p = partsInMoscow(now);
    const todayStart = moscowMidnightUtc(Number(p.year), Number(p.month), Number(p.day));
    const start = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    return { start, end: todayStart, label: `${formatMoscow(start)} — ${formatMoscow(todayStart)}` };
}

function previousMonthPeriod(now = new Date()) {
    const p = partsInMoscow(now);
    let year = Number(p.year);
    let month = Number(p.month) - 1;
    if (month === 0) { month = 12; year -= 1; }
    const start = moscowMidnightUtc(year, month, 1);
    const end = moscowMidnightUtc(Number(p.year), Number(p.month), 1);
    const monthName = new Intl.DateTimeFormat('en-US', { timeZone: MOSCOW_TZ, month: 'long', year: 'numeric' }).format(start);
    return { start, end, label: monthName };
}

function formatMoscow(value) {
    if (!value) return 'never';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: MOSCOW_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).format(new Date(value)) + ' MSK';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function lineHtml(lines) {
    return `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(lines.join('\n'))}</pre>`;
}

function makeMailer(smtp) {
    return nodemailer.createTransport({
        ...smtp,
        tls: { minVersion: 'TLSv1.2' },
    });
}

async function createRun(client, jobName) {
    const runId = crypto.randomUUID();
    await client.query(
        `INSERT INTO audit.jobruns (jobname, runid, startedat, status, recordsprocessed, emailsent)
     VALUES ($1, $2, now(), 'running', 0, false)`,
        [jobName, runId],
    );
    return runId;
}

async function finishRun(client, jobName, runId, status, recordsProcessed, emailSent, errorMessage = null) {
    await client.query(
        `UPDATE audit.jobruns
        SET finishedat = now(), status = $3, recordsprocessed = $4, emailsent = $5, errormessage = $6
      WHERE jobname = $1 AND runid = $2`,
        [jobName, runId, status, recordsProcessed, emailSent, errorMessage?.slice(0, 1000) ?? null],
    );
}

async function setCheckpoint(client, name, value) {
    await client.query(
        `INSERT INTO audit.reportcheckpoints (checkpointname, checkpointvalue, updatedat)
     VALUES ($1, $2, now())
     ON CONFLICT (checkpointname)
     DO UPDATE SET checkpointvalue = EXCLUDED.checkpointvalue, updatedat = now()`,
        [name, value],
    );
}

async function summary(client, start, end) {
    const { rows: [row] } = await client.query(
        `SELECT
       count(*)::int AS attempts,
       count(*) FILTER (WHERE result = 'accepted')::int AS accepted,
       count(*) FILTER (WHERE result = 'rejected')::int AS rejected,
       count(*) FILTER (WHERE result = 'failed')::int AS failed,
       count(*) FILTER (WHERE result = 'invalidrequest')::int AS invalid_request,
       count(*) FILTER (WHERE rejectioncategory = 'trustedhosts')::int AS trusted_hosts_rejections,
       count(*) FILTER (WHERE result = 'unknown' OR rejectioncategory = 'unknown')::int AS unknown_count,
       count(*) FILTER (WHERE rejectioncategory IN ('keycloakerror', 'proxyerror'))::int AS system_errors,
       count(*) FILTER (WHERE rejectioncategory = 'keycloakerror')::int AS keycloak_errors,
       count(*) FILTER (WHERE rejectioncategory = 'proxyerror')::int AS proxy_errors
     FROM audit.dcrattempts
     WHERE occurredat >= $1 AND occurredat < $2`,
        [sqlDate(start), sqlDate(end)],
    );
    return row;
}

async function rejectedHosts(client, start, end) {
    const { rows } = await client.query(
        `SELECT host AS hostname, count(*)::int AS rejections,
            min(a.occurredat) AS first_seen, max(a.occurredat) AS last_seen
       FROM audit.dcrattempts a
       CROSS JOIN LATERAL jsonb_array_elements_text(a.redirecthosts) AS host
      WHERE a.occurredat >= $1 AND a.occurredat < $2
        AND a.rejectioncategory = 'trustedhosts'
      GROUP BY host
      ORDER BY rejections DESC, host ASC`,
        [sqlDate(start), sqlDate(end)],
    );
    return rows;
}

async function sourceIps(client, start, end) {
    const { rows } = await client.query(
        `SELECT coalesce(sourceip::text, 'unknown') AS source_ip, count(*)::int AS attempts
       FROM audit.dcrattempts
      WHERE occurredat >= $1 AND occurredat < $2
      GROUP BY sourceip
      ORDER BY attempts DESC, source_ip ASC
      LIMIT 100`,
        [sqlDate(start), sqlDate(end)],
    );
    return rows;
}

async function latest(client, sql, values = []) {
    const { rows: [row] } = await client.query(sql, values);
    return row?.value ?? null;
}

async function send(mail, recipient, from, subject, text) {
    const result = await mail.sendMail({ from, to: recipient, subject, text, html: lineHtml(text.split('\n')) });
    if (!result.accepted?.length) throw new Error('SMTP server did not accept the report recipient');
}

async function daily(client, cfg) {
    const job = 'daily-report';
    const runId = await createRun(client, job);
    let processed = 0;
    try {
        const period = dailyPeriod();
        const totals = await summary(client, period.start, period.end);
        processed = totals.attempts;
        const hosts = await rejectedHosts(client, period.start, period.end);

        if (Number(totals.trusted_hosts_rejections) === 0) {
            await finishRun(client, job, runId, 'success', processed, false);
            return;
        }

        const ips = await sourceIps(client, period.start, period.end);
        const lines = [
            'Glushkov Modelling MCP — DCR trusted-hosts daily report',
            '',
            `Period: ${period.label}`,
            `DCR attempts: ${totals.attempts}`,
            `Results: accepted=${totals.accepted}, rejected=${totals.rejected}, failed=${totals.failed}, invalid_request=${totals.invalid_request}`,
            `Trusted-hosts rejections: ${totals.trusted_hosts_rejections}`,
            `Unknown: ${totals.unknown_count}; Keycloak errors: ${totals.keycloak_errors}; proxy errors: ${totals.proxy_errors}`,
            '',
            'Rejected hostnames:',
            ...hosts.map((h) => `- ${h.hostname}: ${h.rejections}; first=${formatMoscow(h.first_seen)}; last=${formatMoscow(h.last_seen)}`),
            '',
            'Source IPs:',
            ...ips.map((ip) => `- ${ip.source_ip}: ${ip.attempts}`),
            '',
            'Recommendation: review only. Do not add hostnames to the allow-list automatically.',
        ];

        const mail = makeMailer(cfg.smtp);
        await send(mail, cfg.recipient, cfg.smtp.from, `[GM MCP] DCR trusted-hosts report — ${formatMoscow(period.start).slice(0, 10)}`, lines.join('\n'));
        await finishRun(client, job, runId, 'success', processed, true);
        await setCheckpoint(client, 'last_successful_daily_report_at', new Date().toISOString());
    } catch (error) {
        await finishRun(client, job, runId, 'failed', processed, false, safeError(error));
        throw error;
    }
}

function heartbeatStatus(totals, lastMonthly) {
    if (!lastMonthly || Number(totals.system_errors) > 0) return 'ERROR';
    if (Number(totals.trusted_hosts_rejections) > 0 || Number(totals.unknown_count) > 0) return 'WARNING';
    return 'OK';
}

async function monthly(client, cfg) {
    const job = 'monthly-heartbeat';
    const runId = await createRun(client, job);
    let processed = 0;
    try {
        const period = previousMonthPeriod();
        const totals = await summary(client, period.start, period.end);
        processed = totals.attempts;
        const hosts = await rejectedHosts(client, period.start, period.end);
        const previousMonthly = await latest(client,
            `SELECT finishedat AS value FROM audit.jobruns
        WHERE jobname = 'monthly-heartbeat' AND status = 'success'
        ORDER BY finishedat DESC NULLS LAST LIMIT 1`);
        const lastAuditEvent = await latest(client, `SELECT max(occurredat) AS value FROM audit.dcrattempts`);
        const lastDaily = await latest(client,
            `SELECT finishedat AS value FROM audit.jobruns
        WHERE jobname = 'daily-report' AND status = 'success' AND emailsent = true
        ORDER BY finishedat DESC NULLS LAST LIMIT 1`);
        const status = heartbeatStatus(totals, previousMonthly);
        const allowHash = cfg.allowList ? crypto.createHash('sha256').update(cfg.allowList).digest('hex').slice(0, 16) : 'not exported';
        const lines = [
            'Glushkov Modelling MCP — DCR audit heartbeat',
            '',
            `Status: ${status}`,
            `Reporting month: ${period.label}`,
            `DCR attempts: ${totals.attempts}`,
            `Results: accepted=${totals.accepted}, rejected=${totals.rejected}, failed=${totals.failed}, invalid_request=${totals.invalid_request}`,
            `Trusted-hosts rejections: ${totals.trusted_hosts_rejections}`,
            `Unknown: ${totals.unknown_count}; system errors: ${totals.system_errors}`,
            `Rejected hostnames: ${hosts.length ? hosts.map((h) => h.hostname).join(', ') : 'none'}`,
            `Last audit event: ${formatMoscow(lastAuditEvent)}`,
            `Last successful daily report: ${formatMoscow(lastDaily)}`,
            `Last successful monthly heartbeat: ${formatMoscow(previousMonthly)}`,
            `Proxy version: ${cfg.proxyVersion}`,
            'SMTP status: accepted by SMTP server for this heartbeat',
            `Allow-list hash: ${allowHash}`,
        ];

        const mail = makeMailer(cfg.smtp);
        await send(mail, cfg.recipient, cfg.smtp.from, `[GM MCP] DCR audit heartbeat — ${period.label} — ${status}`, lines.join('\n'));
        await finishRun(client, job, runId, 'success', processed, true);
        await setCheckpoint(client, 'last_successful_monthly_heartbeat_at', new Date().toISOString());
    } catch (error) {
        await finishRun(client, job, runId, 'failed', processed, false, safeError(error));
        throw error;
    }
}

async function watchdog(client, cfg) {
    const job = 'heartbeat-watchdog';
    const runId = await createRun(client, job);
    try {
        const period = previousMonthPeriod();
        const lastMonthly = await latest(client,
            `SELECT finishedat AS value FROM audit.jobruns
        WHERE jobname = 'monthly-heartbeat' AND status = 'success'
          AND finishedat >= $1 AND finishedat < $2
        ORDER BY finishedat DESC NULLS LAST LIMIT 1`,
            [sqlDate(period.end), sqlDate(new Date(period.end.getTime() + 32 * 24 * 60 * 60 * 1000))]);

        if (lastMonthly) {
            await finishRun(client, job, runId, 'success', 0, false);
            return;
        }

        const message = [
            'Glushkov Modelling MCP — ALERT',
            '',
            `No successful monthly heartbeat is recorded for ${period.label}.`,
            'Action required: inspect audit.jobruns, cron logs, PostgreSQL connectivity and Brevo SMTP configuration.',
        ].join('\n');
        const mail = makeMailer(cfg.smtp);
        await send(mail, cfg.recipient, cfg.smtp.from, `[GM MCP] ALERT — missing DCR audit heartbeat for ${period.label}`, message);
        await finishRun(client, job, runId, 'success', 0, true);
    } catch (error) {
        await finishRun(client, job, runId, 'failed', 0, false, safeError(error));
        throw error;
    }
}

function safeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replaceAll(process.env.KC_SMTP_PASSWORD || '', '[REDACTED]')
        .replaceAll(process.env.AUDIT_DB_PASSWORD || '', '[REDACTED]')
        .slice(0, 1000);
}

async function main() {
    const cfg = config();
    const pool = new Pool(cfg.db);
    const client = await pool.connect();
    try {
        if (mode === 'daily') await daily(client, cfg);
        if (mode === 'monthly') await monthly(client, cfg);
        if (mode === 'watchdog') await watchdog(client, cfg);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error(`dcr-report ${mode} failed: ${safeError(error)}`);
    process.exitCode = 1;
});
