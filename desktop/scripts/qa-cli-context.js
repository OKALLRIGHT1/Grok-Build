// Compare CLI transport metadata against a loopback-only model. No user credentials are loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { AcpClient } = require('../src/acp-client');
const { cliConnectionPolicy } = require('../src/cli-connection-policy');

const binary = path.resolve(__dirname, '../../target/release/xai-grok-pager.exe');
const output = path.resolve(__dirname, '../dist/qa-cli-context');
fs.mkdirSync(output, { recursive: true });
const observed = [];
let activeCase;
const server = http.createServer((req, res) => {
  req.resume();
  if (req.method === 'POST' && /chat\/completions/.test(req.url)) {
    const headers = Object.fromEntries(['user-agent', 'x-grok-client-version', 'x-grok-client-identifier', 'x-grok-client-mode', 'x-grok-model-override'].map((key) => [key, req.headers[key] || null]));
    observed.push({ name: activeCase, path: req.url, headers });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: ' + JSON.stringify({ id: 'qa', object: 'chat.completion.chunk', created: 1, model: 'qa-local', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'qa', object: 'chat.completion.chunk', created: 1, model: 'qa-local', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [], allow_access: true }));
});

async function compare(name, meta, clientVersion, policy) {
  activeCase = name;
  const home = fs.mkdtempSync(path.join(output, name + '-'));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  fs.mkdirSync(path.join(home, 'tmp'));
  fs.writeFileSync(path.join(home, 'config.toml'), `
[endpoints]
xai_api_base_url = "${url}"
cli_chat_proxy_base_url = "${url}"
models_base_url = "${url}"

[model.qa-local]
model = "qa-local"
name = "Loopback QA"
base_url = "${url}"
api_backend = "chat_completions"
context_window = 128000
env_key = "GROK_QA_LOCAL_KEY"

[models]
default = "qa-local"
`);
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'COMSPEC', 'PATHEXT'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  Object.assign(env, { GROK_HOME: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), NO_PROXY: '*', XAI_API_KEY: 'qa-local-dummy', GROK_QA_LOCAL_KEY: 'qa-local-dummy' });
  if (clientVersion) env.GROK_CLIENT_VERSION = clientVersion;
  const client = new AcpClient(binary, policy?.args || ['agent', '--no-leader', 'stdio'], { cwd: home, env });
  let diagnostic = '';
  let stage = 'initialize';
  client.on('diagnostic', (line) => { diagnostic = (diagnostic + line).slice(-6000); });
  client.on('request', (request) => {
    if (/folder.*trust|trust.*folder/i.test(request.method)) client.respond(request.id, { outcome: 'trust' });
    else if (/permission/.test(request.method)) client.respond(request.id, { outcome: { outcome: 'cancelled' } });
    else client.respondError(request.id, -32601, 'Unsupported in loopback QA');
  });
  let deadline;
  try {
    await Promise.race([(async () => {
      client.start();
      await client.request('initialize', policy?.initialize || { protocolVersion: '1', ...(meta ? { _meta: meta } : {}) });
      stage = 'session/new';
      const session = await client.request('session/new', { cwd: home, mcpServers: [], _meta: { modelId: 'qa-local', ...(meta?.clientIdentifier ? { clientIdentifier: meta.clientIdentifier } : {}) } });
      stage = 'session/set_model';
      await client.request('session/set_model', { sessionId: session.sessionId, modelId: 'qa-local' });
      stage = 'session/prompt';
      await client.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply exactly OK.' }] });
      assert.ok(observed.some((row) => row.name === name), 'model request must reach loopback server');
    })(), new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error(name + ': timed out at ' + stage)), 35000); })]);
  } catch (error) {
    fs.writeFileSync(path.join(home, 'qa-diagnostic.log'), diagnostic);
    throw new Error(name + ' at ' + stage + ': ' + error.message + '; diagnostic=' + path.join(home, 'qa-diagnostic.log'));
  } finally {
    clearTimeout(deadline);
    client.stop('loopback transport comparison complete');
  }
}

(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await compare('desktop', { clientIdentifier: 'grok-desktop', clientType: 'desktop', clientVersion: '0.1.13' }, '0.1.13');
    await compare('minimal-acp', null, null);
    await compare('new-desktop', null, null, cliConnectionPolicy('0.1.14', true));
    const baseline = observed.find((row) => row.name === 'minimal-acp');
    const updated = observed.find((row) => row.name === 'new-desktop');
    assert.deepEqual(updated.headers, baseline.headers, 'new desktop must retain the native CLI transport identity and engine version');
    fs.writeFileSync(path.join(output, 'headers.json'), JSON.stringify(observed, null, 2));
    console.log(JSON.stringify(observed, null, 2));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
