import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, ExecException } from 'child_process';

/**
 * Data shape for global defaults (stored in globalState).
 */
interface SingleFileGlobalDefaults {
  singleFileRoot: string;   // Path to SingleFile
  configRoots: string[];    // Additional config directories
  pyenvVersion: string;     // e.g. "3.10.5" or "" if none
}

/**
 * Return an initial fallback if no global defaults are stored.
 */
function getFallbackDefaults(): SingleFileGlobalDefaults {
  return {
    singleFileRoot: '',
    configRoots: [],
    pyenvVersion: ''
  };
}

/**
 * Get the global defaults from the extension’s globalState storage.
 */
function getGlobalDefaults(context: vscode.ExtensionContext): SingleFileGlobalDefaults {
  return context.globalState.get<SingleFileGlobalDefaults>(
    'singlefileGlobalDefaults',
    getFallbackDefaults()
  );
}

/**
 * Save updated global defaults to globalState.
 */
async function setGlobalDefaults(context: vscode.ExtensionContext, data: SingleFileGlobalDefaults) {
  await context.globalState.update('singlefileGlobalDefaults', data);
}

/**
 * Attempt to list pyenv versions with `pyenv versions --bare`.
 * Returns an empty array if pyenv is unavailable or an error occurs.
 */
async function fetchPyenvVersions(): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    exec('pyenv versions --bare', (error: ExecException | null, stdout: string) => {
      if (error) {
        console.error('Failed to run "pyenv versions --bare":', error.message);
        // Return empty array so we don't crash
        return resolve([]);
      }
      const versions = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
      resolve(versions);
    });
  });
}

/**
 * Show a webview panel to let the user configure global defaults
 * like singleFileRoot, configRoots, and pyenvVersion.
 */
async function showGlobalConfigPanel(context: vscode.ExtensionContext) {
  const currentDefaults = getGlobalDefaults(context);

  // 1) Retrieve pyenv versions
  const versions = await fetchPyenvVersions();

  // 2) Create webview
  const panel = vscode.window.createWebviewPanel(
    'singlefileConfig',
    'Configure SingleFile Defaults',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  // 3) Provide the HTML, including the pyenv versions
  panel.webview.html = getGlobalConfigWebviewHTML(currentDefaults, versions);

  // 4) Listen for messages from the webview
  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case 'browseRoot': {
        // Example: let user pick a directory
        const chosen = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
          canSelectFiles: false
        });
        if (chosen && chosen.length > 0) {
          panel.webview.postMessage({
            command: 'setSingleFileRoot',
            value: chosen[0].fsPath
          });
        }
        break;
      }
      case 'addConfigRoot': {
        const chosen = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
          canSelectFiles: false
        });
        if (chosen && chosen.length > 0) {
          panel.webview.postMessage({
            command: 'appendConfigRoot',
            value: chosen[0].fsPath
          });
        }
        break;
      }
      case 'saveDefaults': {
        // The webview posts updated singleFileRoot, configRoots, and pyenvVersion
        const updated = msg.data as SingleFileGlobalDefaults;
        await setGlobalDefaults(context, updated);
        vscode.window.showInformationMessage('SingleFile defaults saved.');
        panel.dispose();
        break;
      }
    }
  });
}

/**
 * Build the HTML string for the config webview.
 */
function getGlobalConfigWebviewHTML(
  current: SingleFileGlobalDefaults,
  pyenvVersions: string[]
): string {
  const escapedConfigRoots = JSON.stringify(current.configRoots.map(escapeHtml));
  const escapedPyenv = escapeHtml(current.pyenvVersion);
  const versionsJson = JSON.stringify(pyenvVersions.map(escapeHtml));

  return /* html */ `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 16px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      margin-top: 8px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    input[type="text"] {
      width: 100%;
      padding: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .row {
      margin-bottom: 12px;
    }
    .config-root-item {
      display: flex;
      justify-content: space-between;
      border: 1px solid var(--vscode-editorHoverWidget-border);
      background: var(--vscode-editorHoverWidget-background);
      padding: 4px;
      margin-bottom: 4px;
    }
    .config-root-item button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    select {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px;
    }
  </style>
</head>
<body>
  <h2>SingleFile Global Defaults</h2>
  
  <div class="row">
    <label><strong>SingleFile Root Directory</strong></label><br/>
    <input type="text" id="singleFileRoot" value="${escapeHtml(current.singleFileRoot)}" />
    <button id="browseRootBtn">Browse...</button>
  </div>

  <div class="row">
    <label><strong>Preferred Pyenv Version</strong></label><br/>
    <select id="pyenvSelect"></select>
  </div>

  <div class="row">
    <label><strong>Additional Config Roots</strong></label><br/>
    <div id="configRootsList"></div>
    <button id="addConfigRootBtn">Add Config Root</button>
  </div>

  <button id="saveBtn">Save Defaults</button>

  <script>
    const vscode = acquireVsCodeApi();

    let configRoots = ${escapedConfigRoots};
    let pyenvVersions = ${versionsJson};
    let userPyenv = '${escapedPyenv}';

    function renderConfigRoots() {
      const container = document.getElementById('configRootsList');
      container.innerHTML = '';
      configRoots.forEach((root, idx) => {
        const div = document.createElement('div');
        div.className = 'config-root-item';
        const span = document.createElement('span');
        span.textContent = root;
        const rmBtn = document.createElement('button');
        rmBtn.textContent = '[X]';
        rmBtn.addEventListener('click', () => {
          configRoots.splice(idx, 1);
          renderConfigRoots();
        });
        div.appendChild(span);
        div.appendChild(rmBtn);
        container.appendChild(div);
      });
    }
    renderConfigRoots();

    const pyenvSelectEl = document.getElementById('pyenvSelect');
    function populatePyenvSelect() {
      pyenvSelectEl.innerHTML = '';
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(None)';
      pyenvSelectEl.appendChild(noneOpt);

      pyenvVersions.forEach(ver => {
        const opt = document.createElement('option');
        opt.value = ver;
        opt.textContent = ver;
        pyenvSelectEl.appendChild(opt);
      });
      pyenvSelectEl.value = userPyenv || '';
    }
    populatePyenvSelect();

    document.getElementById('browseRootBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'browseRoot' });
    });
    document.getElementById('addConfigRootBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'addConfigRoot' });
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const singleFileRoot = document.getElementById('singleFileRoot').value.trim();
      const chosenPyenv = pyenvSelectEl.value;
      vscode.postMessage({
        command: 'saveDefaults',
        data: {
          singleFileRoot,
          configRoots,
          pyenvVersion: chosenPyenv
        }
      });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'setSingleFileRoot') {
        document.getElementById('singleFileRoot').value = msg.value;
      } else if (msg.command === 'appendConfigRoot') {
        configRoots.push(msg.value);
        renderConfigRoots();
      }
    });
  </script>
</body>
</html>
`;
}

/**
 * Show a webview panel to let the user configure SingleFile arguments
 * and run SingleFile with the selected URIs from the Explorer.
 */
async function showSingleFileRunPanel(
  context: vscode.ExtensionContext,
  selectedUris: vscode.Uri[]
) {
  // 1) Grab global defaults
  const globals = getGlobalDefaults(context);

  // 2) Convert selected URIs to file system paths
  const selectedPaths = selectedUris.map((u) => u.fsPath);

  // 3) Create our webview panel
  const panel = vscode.window.createWebviewPanel(
    'singlefileRun',
    'Run SingleFile',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  // 4) Provide HTML for the run panel
  panel.webview.html = getRunPanelWebviewHTML(globals, selectedPaths);

  // 5) Listen for messages from the webview
  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case 'browseAddPath': {
        // Let user add more files/folders to the paths list
        const chosen = await vscode.window.showOpenDialog({
          canSelectMany: true,
          canSelectFiles: true,
          canSelectFolders: true
        });
        if (chosen) {
          chosen.forEach((uri) => {
            panel.webview.postMessage({ command: 'addPath', path: uri.fsPath });
          });
        }
        break;
      }

      case 'runSingleFile': {
        // The user clicked the "Run" button in the webview
        const args = message.data as {
          paths: string[];
          depth: string;
          outputFile: string;
          extensions: string[];
          excludeExtensions: string[];
          ignoreErrors: boolean;
          replaceInvalidChars: boolean;
        };

        // Actually run SingleFile
        await runSingleFileCLI(context, globals, args);
        vscode.window.showInformationMessage('SingleFile run completed.');
        panel.dispose();
        break;
      }
    }
  });
}

/**
 * Actually spawns the SingleFile process using the user's chosen arguments.
 * Respects pyenvVersion if set, by calling "pyenv exec python".
 */
async function runSingleFileCLI(
  context: vscode.ExtensionContext,
  globals: SingleFileGlobalDefaults,
  args: {
    paths: string[];
    depth: string;
    outputFile: string;
    extensions: string[];
    excludeExtensions: string[];
    ignoreErrors: boolean;
    replaceInvalidChars: boolean;
  }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Choose which python to invoke
    const pythonBin = globals.pyenvVersion
      ? `PYENV_VERSION=${globals.pyenvVersion} python`
      : 'python'; // or 'python3' depending on your system

    // Build CLI arguments
    const cliArgs: string[] = [];

    // --paths
    cliArgs.push('--paths', ...args.paths.map((p) => `"${p}"`));

    // --depth
    if (args.depth) {
      cliArgs.push('--depth', args.depth);
    }

    // --output-file
    if (args.outputFile) {
      cliArgs.push('--output-file', `"${args.outputFile}"`);
    }

    // --extensions
    if (args.extensions && args.extensions.length > 0) {
      cliArgs.push('--extensions', ...args.extensions);
    }

    // --exclude-extensions
    if (args.excludeExtensions && args.excludeExtensions.length > 0) {
      cliArgs.push('--exclude-extensions', ...args.excludeExtensions);
    }

    // --ignore-errors
    if (args.ignoreErrors) {
      cliArgs.push('--ignore-errors');
    }

    // --replace-invalid-chars
    if (args.replaceInvalidChars) {
      cliArgs.push('--replace-invalid-chars');
    }

    // SingleFile executable (assumes single-file is in singleFileRoot or on PATH)
    const singleFileExe = globals.singleFileRoot
      ? `"${globals.singleFileRoot}"`
      : 'single-file';

    // Final command
    const cmd = `${pythonBin} ${singleFileExe} ${cliArgs.join(' ')}`;
    console.log('Running SingleFile command:', cmd);

    // Create an output channel to show logs
    const singleFileChannel = vscode.window.createOutputChannel('SingleFile');
    singleFileChannel.clear();
    singleFileChannel.show(true);
    singleFileChannel.appendLine(`CMD: ${cmd}`);

    exec(cmd, (error, stdout, stderr) => {
      if (stdout) singleFileChannel.appendLine(stdout);
      if (stderr) singleFileChannel.appendLine(stderr);

      if (error) {
        vscode.window.showErrorMessage('SingleFile run failed: ' + error.message);
        return reject(error);
      }
      return resolve();
    });
  });
}

/**
 * Build the HTML for the Run Panel webview.
 */
function getRunPanelWebviewHTML(
  globals: SingleFileGlobalDefaults,
  initialPaths: string[]
): string {
  const escapedPaths = JSON.stringify(initialPaths.map(escapeHtml));
  return /* html */ `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 16px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      margin-top: 8px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    input[type="text"], select {
      width: 100%;
      padding: 6px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .row {
      margin-bottom: 12px;
    }
    .paths-list-item {
      display: flex;
      justify-content: space-between;
      border: 1px solid var(--vscode-editorHoverWidget-border);
      background: var(--vscode-editorHoverWidget-background);
      padding: 4px;
      margin-bottom: 4px;
    }
    .paths-list-item button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    label {
      font-weight: bold;
    }
  </style>
</head>
<body>
  <h2>Run SingleFile</h2>

  <div class="row">
    <label>Paths</label><br/>
    <div id="pathsList"></div>
    <button id="browsePathBtn">Browse...</button>
  </div>

  <div class="row">
    <label>Depth</label><br/>
    <input type="text" id="depthInput" placeholder="0 = unlimited (default)"/>
  </div>

  <div class="row">
    <label>Output File</label><br/>
    <input type="text" id="outputFileInput" placeholder="e.g. /home/user/out.json"/>
  </div>

  <div class="row">
    <label>Extensions (space or comma separated)</label><br/>
    <input type="text" id="extensionsInput" placeholder="e.g. ts, js, json"/>
  </div>

  <div class="row">
    <label>Exclude Extensions</label><br/>
    <input type="text" id="excludeExtensionsInput" placeholder="e.g. lock, exe"/>
  </div>

  <div class="row">
    <label>Flags</label><br/>
    <input type="checkbox" id="ignoreErrorsCheck"/> Ignore Errors<br/>
    <input type="checkbox" id="replaceInvalidCheck"/> Replace Invalid Chars
  </div>

  <button id="runBtn">Run</button>

  <script>
    const vscode = acquireVsCodeApi();
    let paths = ${escapedPaths};

    function renderPathsList() {
      const container = document.getElementById('pathsList');
      container.innerHTML = '';
      paths.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = 'paths-list-item';
        const span = document.createElement('span');
        span.textContent = p;
        const rmBtn = document.createElement('button');
        rmBtn.textContent = '[X]';
        rmBtn.addEventListener('click', () => {
          paths.splice(idx, 1);
          renderPathsList();
        });
        div.appendChild(span);
        div.appendChild(rmBtn);
        container.appendChild(div);
      });
    }
    renderPathsList();

    document.getElementById('browsePathBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'browseAddPath' });
    });

    document.getElementById('runBtn').addEventListener('click', () => {
      const depthVal = document.getElementById('depthInput').value.trim();
      const outputFile = document.getElementById('outputFileInput').value.trim();

      // For multiple items, user can type in comma or space separated
      const extsRaw = document.getElementById('extensionsInput').value.trim();
      const exts = extsRaw ? extsRaw.split(/[,\\s]+/) : [];

      const excludeExtsRaw = document.getElementById('excludeExtensionsInput').value.trim();
      const excludeExts = excludeExtsRaw ? excludeExtsRaw.split(/[,\\s]+/) : [];

      const ignoreErrors = document.getElementById('ignoreErrorsCheck').checked;
      const replaceInvalidChars = document.getElementById('replaceInvalidCheck').checked;

      vscode.postMessage({
        command: 'runSingleFile',
        data: {
          paths,
          depth: depthVal,
          outputFile,
          extensions: exts,
          excludeExtensions: excludeExts,
          ignoreErrors,
          replaceInvalidChars
        }
      });
    });

    // Listen for extension -> webview messages
    window.addEventListener('message', (evt) => {
      const msg = evt.data;
      if (msg.command === 'addPath') {
        paths.push(msg.path);
        renderPathsList();
      }
    });
  </script>
</body>
</html>
`;
}

/**
 * Minimal HTML-escape function.
 */
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The main entry point for your extension's activation.
 * We register both commands: configureGlobalDefaults & runSingleFile.
 */
export function activate(context: vscode.ExtensionContext) {
  // 1) Command: singlefile.configureGlobalDefaults
  const cmdConfig = vscode.commands.registerCommand(
    'singlefile.configureGlobalDefaults',
    () => {
      showGlobalConfigPanel(context);
    }
  );
  context.subscriptions.push(cmdConfig);

  // 2) Command: singlefile.run
  const cmdRun = vscode.commands.registerCommand(
    'singlefile.run',
    (uri: vscode.Uri, uris: vscode.Uri[]) => {
      // Handle multi-select if provided
      const selectedUris = uris && uris.length > 0 ? uris : [uri];
      showSingleFileRunPanel(context, selectedUris);
    }
  );
  context.subscriptions.push(cmdRun);
}

/**
 * The deactivate function, if needed.
 */
export function deactivate() {
  // Cleanup if needed
}
