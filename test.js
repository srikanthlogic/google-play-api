import { spawn, execSync } from 'child_process';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const contractFetch = (url, options = {}) => fetch(url, {
  ...options,
  headers: { ...options.headers, Connection: 'close' }
});

const waitForServer = async (url, maxAttempts = 30) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await delay(1000);
  }
  throw new Error('Server failed to start within timeout');
};

const runBruno = (collectionPath, environment, junitPath) => {
  return new Promise((resolve, reject) => {
    try {
      const result = execSync(
        `npx @usebruno/cli run . -r --env ${environment} --reporter-junit ${junitPath}`,
        {
          stdio: 'inherit',
          cwd: collectionPath
        }
      );
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
};

const runTests = async () => {
  let serverProcess;

  try {
    // Start the server
    console.log('Starting server...');
    serverProcess = spawn('node', ['server.js'], {
      stdio: 'pipe',
      detached: false
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data.toString().trim()}`);
    });

    // Wait for server to be ready
    console.log('Waiting for server to be ready...');
    await waitForServer('http://localhost:3000/api-docs');
    console.log('Server is ready!');

    // Run tests
    console.log('\n=== Running GPlayAPIUnitTests ===');
    await runBruno('./bruno/GPlayAPIUnitTests', 'Local', 'junit.xml');

    console.log('\n=== Running GooglePlayAPI Collection ===');
    await runBruno('./bruno/GooglePlayAPI', 'Local', 'junit.xml');

    console.log('\n=== Running v2 API contract checks ===');
    const v1Response = await contractFetch('http://127.0.0.1:3000/api/apps/?num=0');
    if (v1Response.headers.get('deprecation') !== 'true' || !v1Response.headers.get('sunset')) {
      throw new Error('v1 responses must include Deprecation and Sunset headers');
    }

    const v2Response = await contractFetch('http://127.0.0.1:3000/v2/apps/?num=0');
    if (v2Response.status !== 400 || !v2Response.headers.get('content-type')?.startsWith('application/problem+json')) {
      throw new Error('v2 validation errors must use application/problem+json');
    }
    const v2Problem = await v2Response.json();
    for (const field of ['type', 'title', 'status', 'detail', 'code']) {
      if (!(field in v2Problem)) throw new Error(`v2 problem response is missing ${field}`);
    }

    const v2AppResponse = await contractFetch('http://127.0.0.1:3000/v2/apps/com.google.android.apps.translate?country=US&lang=en');
    if (v2AppResponse.status !== 200) throw new Error(`v2 app endpoint returned ${v2AppResponse.status}`);

    // B13: country/lang validation contract checks
    const badCountry = await contractFetch('http://127.0.0.1:3000/v2/apps/com.google.android.apps.translate?country=USA');
    if (badCountry.status !== 400) throw new Error(`invalid country must return 400, got ${badCountry.status}`);

    const badLang = await contractFetch('http://127.0.0.1:3000/v2/apps/com.google.android.apps.translate?lang=english');
    if (badLang.status !== 400) throw new Error(`invalid lang must return 400, got ${badLang.status}`);

    const defaultCountry = await contractFetch('http://127.0.0.1:3000/v2/apps/com.google.android.apps.translate');
    if (defaultCountry.status !== 200) throw new Error(`default country/lang request returned ${defaultCountry.status}`);

    // GraphQL (/v2/graphql) contract checks
    const gqlResponse = await contractFetch('http://127.0.0.1:3000/v2/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: '{ categories }' })
    });
    if (gqlResponse.status !== 200) throw new Error(`GraphQL endpoint returned ${gqlResponse.status}`);
    const gqlBody = await gqlResponse.json();
    if (gqlBody.errors) throw new Error(`GraphQL categories query errored: ${gqlBody.errors[0].message}`);
    if (!Array.isArray(gqlBody.data?.categories) || gqlBody.data.categories.length === 0) {
      throw new Error('GraphQL categories query returned no data');
    }

    const gqlIde = await contractFetch('http://127.0.0.1:3000/v2/graphql', {
      headers: { accept: 'text/html' }
    });
    const ideHtml = await gqlIde.text();
    if (gqlIde.status !== 200 || !ideHtml.includes('GraphiQL')) {
      throw new Error(`GraphiQL IDE page must be served to browsers, got ${gqlIde.status}`);
    }

    const gqlDepth = await contractFetch('http://127.0.0.1:3000/v2/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: '{ app(appId: "x") { f1 { f2 { f3 { f4 { f5 { f6 { f7 { f8 { f9 { f10 { f11 { appId } } } } } } } } } } } } }' })
    });
    if (gqlDepth.status !== 400) throw new Error(`over-deep GraphQL query must return 400, got ${gqlDepth.status}`);

    console.log('\nAPI tests completed successfully!');
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    // Clean up: kill the server and wait for it to exit so coverage is flushed
    if (serverProcess) {
      console.log('Shutting down server...');
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          serverProcess.kill('SIGKILL');
          resolve();
        }, 6000);
        serverProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        serverProcess.kill('SIGTERM');
      });
      console.log('Server shut down.');
    }
  }
};

runTests();
