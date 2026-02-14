import { spawn, execSync } from 'child_process';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

const runBruno = (collectionPath, environment) => {
  return new Promise((resolve, reject) => {
    try {
      const result = execSync(
        `npx @usebruno/cli run . -r --env ${environment} -f html`,
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
    await runBruno('./bruno/GPlayAPIUnitTests', 'Local');

    console.log('\n=== Running GooglePlayAPI Collection ===');
    await runBruno('./bruno/GooglePlayAPI', 'Local');

    console.log('\nAPI tests completed successfully!');
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    // Clean up: kill the server
    if (serverProcess) {
      console.log('Shutting down server...');
      serverProcess.kill('SIGTERM');
    }
  }
};

runTests();
