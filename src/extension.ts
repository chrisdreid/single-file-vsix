import * as vscode from 'vscode';
import * as path from 'path';
import { execFile, ExecFileException } from 'child_process';
import * as fs from 'fs';

/**
 * Data shape for global defaults (stored in globalState).
 */
interface SingleFileGlobalDefaults {
  singleFileRoot: string;   // Path to SingleFile (file or folder)
  configRoots: string[];    // Additional config directories
  pyenvVersion: string;     // e.g. "3.10.5" or "" if none
}

/**
 * Data shape for per-project "Run" settings (stored in workspaceState).
 */
interface SingleFileWorkspaceState {
  outputFile: string;
  paths: string[];
  config: string;
  extensions: string[];
  excludeExtensions: string[];
  ignoreErrors: boolean;
  replaceInvalidChars: boolean;
  formats: string;
  forceBinaryContent: boolean;
  metadataAdd: string[];
  metadataRemove: string[];
  excludeDirs: string[];
  excludeFiles: string[];
  includeDirs: string[];
  includeFiles: string[];
  disablePlugin: string[];
  depth: string;
}

/**
 * Return an initial fallback if no global defaults are stored.
 */
function getFallbackGlobalDefaults(): SingleFileGlobalDefaults {
  return {
    singleFileRoot: '',
    configRoots: [],
    pyenvVersion: ''
  };
}

/**
 * Get the global defaults from the extension's globalState storage.
 */
function getGlobalDefaults(context: vscode.ExtensionContext): SingleFileGlobalDefaults {
  return context.globalState.get<SingleFileGlobalDefaults>(
    'singlefileGlobalDefaults',
    getFallbackGlobalDefaults()
  );
}

/**
 * Save updated global defaults to globalState.
 */
async function setGlobalDefaults(context: vscode.ExtensionContext, data: SingleFileGlobalDefaults) {
  await context.globalState.update('singlefileGlobalDefaults', data);
}

/**
 * Return fallback workspace-level defaults if nothing is stored yet.
 */
function getFallbackWorkspaceState(): SingleFileWorkspaceState {
  return {
    outputFile: '',
    paths: [],
    config: '',
    extensions: [],
    excludeExtensions: [],
    ignoreErrors: false,
    replaceInvalidChars: false,
    formats: '',
    forceBinaryContent: false,
    metadataAdd: [],
    metadataRemove: [],
    excludeDirs: [],
    excludeFiles: [],
    includeDirs: [],
    includeFiles: [],
    disablePlugin: [],
    depth: ''
  };
}

/**
 * Retrieve the user's last-used "Run" settings from workspaceState.
 */
function getWorkspaceDefaults(context: vscode.ExtensionContext): SingleFileWorkspaceState {
  return context.workspaceState.get<SingleFileWorkspaceState>(
    'singlefileWorkspaceDefaults',
    getFallbackWorkspaceState()
  );
}

/**
 * Save "Run" settings back into workspaceState so they persist per-project.
 */
async function setWorkspaceDefaults(
  context: vscode.ExtensionContext,
  data: SingleFileWorkspaceState
) {
  await context.workspaceState.update('singlefileWorkspaceDefaults', data);
}

/**
 * Attempt to list pyenv versions with `pyenv versions --bare`.
 * Returns an empty array if pyenv is unavailable or an error occurs.
 */
async function fetchPyenvVersions(): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    execFile('pyenv', ['versions', '--bare'], (error, stdout) => {
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
 * Query single-file for available formats and configs, respecting SINGLEFILE_CONFIG_PATH + PYENV_VERSION.
 * E.g. `python single-file --query formats configs`
 */
async function fetchQueryData(
  globals: SingleFileGlobalDefaults
): Promise<{ formats: Record<string, any>; configs: Array<{ path: string; file: string }> }> {
  return new Promise((resolve) => {
    // Determine the singleFileExe path
    let singleFileExe: string;
    if (!globals.singleFileRoot) {
      // fallback to just "single-file" on PATH
      singleFileExe = 'single-file';
    } else {
      // user might have set it to a file or folder
      if (globals.singleFileRoot.endsWith('single-file')) {
        // remove any wrapping quotes if present
        singleFileExe = globals.singleFileRoot.replace(/^"(.*)"$/, '$1');
      } else {
        singleFileExe = path.join(globals.singleFileRoot, 'single-file');
      }
    }

    // Build environment
    const env = buildSingleFileEnv(globals);

    // We'll execFile python <singleFileExe> --query formats configs
    // because singleFileExe might be a script to pass to python.
    const args = [singleFileExe, '--query', 'formats', 'configs'];

    execFile(
      'python',
      args,
      { env, encoding: 'utf8' },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (error) {
          console.error('Error fetching query data:', error.message);
          resolve({ formats: {}, configs: [] });
          return;
        }
    
        try {
          const data = JSON.parse(stdout);
          resolve({
            formats: data.formats || {},
            configs: data.configs || [],
          });
        } catch (parseErr) {
          console.error('Error parsing query data:', parseErr);
          resolve({ formats: {}, configs: [] });
        }
      }
    );
  });
}

/**
 * Build the environment object for spawning Single-File. This sets:
 *   - PYENV_VERSION (if any)
 *   - SINGLEFILE_CONFIG_PATH (joined from global configRoots, if any)
 */
function buildSingleFileEnv(globals: SingleFileGlobalDefaults): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (globals.pyenvVersion) {
    env['PYENV_VERSION'] = globals.pyenvVersion;
  }
  if (globals.configRoots && globals.configRoots.length > 0) {
    env['SINGLEFILE_CONFIG_PATH'] = globals.configRoots.join(path.delimiter);
  }

  return env;
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
    'Configure Single-File Defaults',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  // 3) Provide the HTML, including the pyenv versions
  panel.webview.html = getGlobalConfigWebviewHTML(currentDefaults, versions);

  // 4) Listen for messages from the webview
  panel.webview.onDidReceiveMessage(async (msg) => {
    switch (msg.command) {
      case 'browseRoot': {
        // Let user pick a directory or file for singleFileRoot
        const chosen = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
          canSelectFiles: true
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
        vscode.window.showInformationMessage('Single-File defaults saved.');
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
  <h2>Single-File Global Defaults</h2>
  
  <div class="row">
    <label><strong>Single-File Root (file or folder)</strong></label><br/>
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
 * Show a webview panel to let the user configure Single-File arguments
 * and run Single-File with the selected URIs from the Explorer (if any).
 */
async function showSingleFileRunPanel(
  context: vscode.ExtensionContext,
  selectedUris?: vscode.Uri[]
) {
  // 1) Grab global defaults
  const globals = getGlobalDefaults(context);

  // If singleFileRoot not set, prompt them to configure
  if (!globals.singleFileRoot) {
    vscode.window.showInformationMessage('Please configure Single-File global defaults first.');
    await showGlobalConfigPanel(context);
    return;
  }

  // 2) Load or create workspace defaults
  const wsDefaults = getWorkspaceDefaults(context);

  // 3) If invoked via right-click on files/folders, override the stored paths
  if (selectedUris && selectedUris.length > 0) {
    wsDefaults.paths = selectedUris.map(u => u.fsPath);
  }

  // 4) Query single-file for available formats and configs
  const { formats, configs } = await fetchQueryData(globals);

  // 5) Create the panel
  const panel = vscode.window.createWebviewPanel(
    'singlefileRun',
    'Run Single-File',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  // 6) Provide HTML for the run panel
  panel.webview.html = getRunPanelWebviewHTML(wsDefaults, formats, configs);

  // 7) Listen for messages from the webview
  panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case 'browseAddPath': {
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
      case 'browseOutputFile': {
        const chosen = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'], All: ['*'] }
        });
        if (chosen) {
          panel.webview.postMessage({
            command: 'setOutputFile',
            value: chosen.fsPath
          });
        }
        break;
      }
      case 'browseConfigFile': {
        const chosen = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFiles: true,
          canSelectFolders: false
        });
        if (chosen && chosen.length > 0) {
          panel.webview.postMessage({
            command: 'setConfigFile',
            value: chosen[0].fsPath
          });
        }
        break;
      }
      case 'runSingleFile': {
        // The user clicked "Run"
        const args = message.data as SingleFileWorkspaceState;
        // Save workspace defaults
        await setWorkspaceDefaults(context, args);
        // Actually run
        await runSingleFileCLI(globals, args);
        vscode.window.showInformationMessage('Single-File run completed.');
        panel.dispose();
        break;
      }
      case 'selectKnownConfig': {
        // The user selected a known config from the dropdown
        panel.webview.postMessage({
          command: 'setConfigFile',
          value: message.path
        });
        break;
      }
      case 'saveAsConfig': {
        // The user clicked "Save As Config"
        const args = message.data as SingleFileWorkspaceState;
        
        const dest = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'], All: ['*'] },
          saveLabel: 'Save Single-File Config'
        });
        
        if (dest) {
          const mapping: Record<string, keyof SingleFileWorkspaceState> = {
            paths: 'paths',
            depth: 'depth',
            output_file: 'outputFile',
            formats: 'formats',
            extensions: 'extensions',
            exclude_extensions: 'excludeExtensions',
            exclude_dirs: 'excludeDirs',
            exclude_files: 'excludeFiles',
            include_dirs: 'includeDirs',
            include_files: 'includeFiles',
            metadata_add: 'metadataAdd',
            metadata_remove: 'metadataRemove',
            config: 'config',
            disable_plugin: 'disablePlugin',
            replace_invalid_chars: 'replaceInvalidChars',
            force_binary_content: 'forceBinaryContent',
            ignore_errors: 'ignoreErrors'
          };

          const configData: Record<string, any> = {};
          for (const [configKey, stateKey] of Object.entries(mapping)) {
            const value = args[stateKey];
            if (value && (!Array.isArray(value) || value.length > 0)) {
              configData[configKey] = value;
            }
          }
          
          try {
            const jsonData = JSON.stringify(configData, null, 2);
            await fs.promises.writeFile(dest.fsPath, jsonData, 'utf8');
            vscode.window.showInformationMessage(`Saved config to: ${dest.fsPath}`);
          } catch (err: any) {
            vscode.window.showErrorMessage('Failed to save config: ' + err.message);
          }
        }
        break;
      }
      case 'openGitHubLink': {
        // Opens the Single-File GitHub link in the default browser
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/chrisdreid/single-file'));
        break;
      }
    }
  });
}

/**
 * Actually spawns the Single-File process using environment variables:
 *   - PYENV_VERSION (if user set it)
 *   - SINGLEFILE_CONFIG_PATH (from global configRoots)
 */
async function runSingleFileCLI(
  globals: SingleFileGlobalDefaults,
  args: SingleFileWorkspaceState
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 1) Decide on the single-file script to call
    let singleFileExe: string;
    if (!globals.singleFileRoot) {
      singleFileExe = 'single-file';
    } else {
      if (globals.singleFileRoot.endsWith('single-file')) {
        singleFileExe = globals.singleFileRoot.replace(/^"(.*)"$/, '$1');
      } else {
        singleFileExe = path.join(globals.singleFileRoot, 'single-file');
      }
    }

    // 2) Build CLI arguments
    const cliArgs: string[] = [];

    if (args.outputFile) {
      cliArgs.push('--output-file', args.outputFile);
    }
    if (args.paths && args.paths.length > 0) {
      cliArgs.push('--paths', ...args.paths);
    }
    if (args.depth) {
      cliArgs.push('--depth', args.depth);
    }
    if (args.extensions && args.extensions.length > 0) {
      cliArgs.push('--extensions', ...args.extensions);
    }
    if (args.excludeExtensions && args.excludeExtensions.length > 0) {
      cliArgs.push('--exclude-extensions', ...args.excludeExtensions);
    }
    if (args.ignoreErrors) {
      cliArgs.push('--ignore-errors');
    }
    if (args.replaceInvalidChars) {
      cliArgs.push('--replace-invalid-chars');
    }
    if (args.formats) {
      const cleaned = args.formats.replace(/\s+/g, ',');
      cliArgs.push('--formats', cleaned);
    }
    if (args.config) {
      cliArgs.push('--config', args.config);
    }
    if (args.forceBinaryContent) {
      cliArgs.push('--force-binary-content');
    }
    if (args.metadataAdd && args.metadataAdd.length > 0) {
      cliArgs.push('--metadata-add', ...args.metadataAdd);
    }
    if (args.metadataRemove && args.metadataRemove.length > 0) {
      cliArgs.push('--metadata-remove', ...args.metadataRemove);
    }
    if (args.excludeDirs && args.excludeDirs.length > 0) {
      cliArgs.push('--exclude-dirs', ...args.excludeDirs);
    }
    if (args.excludeFiles && args.excludeFiles.length > 0) {
      cliArgs.push('--exclude-files', ...args.excludeFiles);
    }
    if (args.includeDirs && args.includeDirs.length > 0) {
      cliArgs.push('--include-dirs', ...args.includeDirs);
    }
    if (args.includeFiles && args.includeFiles.length > 0) {
      cliArgs.push('--include-files', ...args.includeFiles);
    }
    if (args.disablePlugin && args.disablePlugin.length > 0) {
      cliArgs.push('--disable-plugin', ...args.disablePlugin);
    }

    // 3) Environment
    const env = buildSingleFileEnv(globals);

    // 4) Command
    const pythonArgs = [singleFileExe, ...cliArgs];
    const channel = vscode.window.createOutputChannel('Single-File');
    channel.clear();
    channel.show(true);

    channel.appendLine('Running Single-File via:');
    channel.appendLine('  python ' + pythonArgs.join(' '));
    channel.appendLine(
      'with env: ' + JSON.stringify({
        PYENV_VERSION: env.PYENV_VERSION || '',
        SINGLEFILE_CONFIG_PATH: env.SINGLEFILE_CONFIG_PATH || ''
      }, null, 2)
    );
    channel.appendLine('');

    execFile('python', pythonArgs, { env }, (error, stdout, stderr) => {
      if (stdout) channel.appendLine(stdout);
      if (stderr) channel.appendLine(stderr);
      if (error) {
        vscode.window.showErrorMessage('Single-File run failed: ' + error.message);
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
  wsDefaults: SingleFileWorkspaceState,
  formatsData: Record<string, any>,
  configsData: Array<{ path: string; file: string }>
): string {
  const formatKeys = Object.keys(formatsData);
  const formatsPlaceholder = formatKeys.length > 0
    ? `e.g. ${formatKeys.join(',')}`
    : 'e.g. default,json,markdown';

  // Pre-fill inputs
  const escapedPaths = JSON.stringify(wsDefaults.paths.map(escapeHtml));
  const escapedOutputFile = escapeHtml(wsDefaults.outputFile);
  const escapedConfig = escapeHtml(wsDefaults.config);
  const escapedExtensions = escapeHtml(wsDefaults.extensions.join(','));
  const escapedExcludeExt = escapeHtml(wsDefaults.excludeExtensions.join(','));
  const escapedFormats = escapeHtml(wsDefaults.formats);
  const escapedMetadataAdd = escapeHtml(wsDefaults.metadataAdd.join(','));
  const escapedMetadataRemove = escapeHtml(wsDefaults.metadataRemove.join(','));
  const escapedExcludeDirs = escapeHtml(wsDefaults.excludeDirs.join(','));
  const escapedExcludeFiles = escapeHtml(wsDefaults.excludeFiles.join(','));
  const escapedIncludeDirs = escapeHtml(wsDefaults.includeDirs.join(','));
  const escapedIncludeFiles = escapeHtml(wsDefaults.includeFiles.join(','));
  const escapedDisablePlugins = escapeHtml(wsDefaults.disablePlugin.join(','));
  const escapedDepth = escapeHtml(wsDefaults.depth);

  // Known configs
  const knownConfigsJson = JSON.stringify(configsData.map(c => ({ path: c.path, file: c.file })));

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
    button, a {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      cursor: pointer;
      margin-top: 8px;
      text-decoration: none;
    }
    button:hover, a:hover {
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
    .inline-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .inline-right {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
    }
    a.link-btn {
      font-size: 0.9em;
      padding: 6px 10px;
      display: inline-flex;
      align-items: center;
    }
  </style>
</head>
<body>
  <h2>Run Single-File</h2>

  <div class="row">
    <label>Output File</label><br/>
    <div class="inline-group">
      <input type="text" id="outputFileInput" value="${escapedOutputFile}" placeholder="e.g. /home/user/out.json"/>
      <button id="browseOutputFileBtn">Browse...</button>
    </div>
  </div>

  <div class="row">
    <label>Paths</label><br/>
    <div id="pathsList"></div>
    <div class="inline-right">
      <span>Click to add files/directories</span>
      <button id="browsePathBtn">Browse...</button>
    </div>
  </div>

  <div class="row">
    <label>Config</label><br/>
    <div class="inline-group">
      <input type="text" id="configInput" value="${escapedConfig}" placeholder="Path to a JSON config"/>
      <button id="browseConfigBtn">Browse...</button>
    </div>
    <div class="inline-group">
      <label for="knownConfigsSelect">Known Configs:</label>
      <select id="knownConfigsSelect">
        <option value="">(None)</option>
      </select>
    </div>
  </div>

  <div class="row">
    <label>Extensions (space or comma separated)</label><br/>
    <input type="text" id="extensionsInput" value="${escapedExtensions}" placeholder="e.g. ts, js, json"/>
  </div>

  <div class="row">
    <label>Exclude Extensions</label><br/>
    <input type="text" id="excludeExtensionsInput" value="${escapedExcludeExt}" placeholder="e.g. lock, exe"/>
  </div>

  <div class="row">
    <label>Formats</label><br/>
    <input type="text" id="formatsInput" value="${escapedFormats}" placeholder="${formatsPlaceholder}"/>
  </div>

  <div class="row">
    <label>Metadata Add (space/comma separated KEY=VALUE pairs)</label><br/>
    <input type="text" id="metadataAddInput" value="${escapedMetadataAdd}" placeholder="e.g. foo=bar,example=123"/>
  </div>

  <div class="row">
    <label>Metadata Remove (space/comma separated keys)</label><br/>
    <input type="text" id="metadataRemoveInput" value="${escapedMetadataRemove}" placeholder="e.g. foo, bar"/>
  </div>

  <div class="row">
    <label>Exclude Dirs</label><br/>
    <input type="text" id="excludeDirsInput" value="${escapedExcludeDirs}" placeholder="Regex patterns (space/comma)"/>
  </div>

  <div class="row">
    <label>Exclude Files</label><br/>
    <input type="text" id="excludeFilesInput" value="${escapedExcludeFiles}" placeholder="Regex patterns (space/comma)"/>
  </div>

  <div class="row">
    <label>Include Dirs</label><br/>
    <input type="text" id="includeDirsInput" value="${escapedIncludeDirs}" placeholder="Regex patterns (space/comma)"/>
  </div>

  <div class="row">
    <label>Include Files</label><br/>
    <input type="text" id="includeFilesInput" value="${escapedIncludeFiles}" placeholder="Regex patterns (space/comma)"/>
  </div>

  <div class="row">
    <label>Disable Plugin</label><br/>
    <input type="text" id="disablePluginInput" value="${escapedDisablePlugins}" placeholder="space/comma separated plugin names"/>
  </div>

  <div class="row">
    <label>Depth</label><br/>
    <input type="text" id="depthInput" value="${escapedDepth}" placeholder="0 = unlimited (default)"/>
  </div>

  <div class="row">
    <label>Force Binary Content</label><br/>
    <input type="checkbox" id="forceBinaryCheck" ${wsDefaults.forceBinaryContent ? 'checked' : ''}/>
  </div>

  <div class="row">
    <label>Flags</label><br/>
    <input type="checkbox" id="ignoreErrorsCheck" ${wsDefaults.ignoreErrors ? 'checked' : ''}/> Ignore Errors<br/>
    <input type="checkbox" id="replaceInvalidCheck" ${wsDefaults.replaceInvalidChars ? 'checked' : ''}/> Replace Invalid Chars<br/>
  </div>

  <!-- Buttons Row -->
  <div class="row inline-right">
    <a href="#" class="link-btn" id="githubLink">GitHub</a>
    <button id="saveAsConfigBtn">Save As Config</button>
    <button id="runBtn">Run</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let paths = ${escapedPaths};
    const knownConfigs = ${knownConfigsJson};

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

    // Populate known configs in the dropdown
    const knownConfigsSelect = document.getElementById('knownConfigsSelect');
    knownConfigs.forEach(cfg => {
      const opt = document.createElement('option');
      opt.value = cfg.path;
      opt.textContent = cfg.file;
      knownConfigsSelect.appendChild(opt);
    });

    knownConfigsSelect.addEventListener('change', () => {
      const selectedVal = knownConfigsSelect.value;
      vscode.postMessage({
        command: 'selectKnownConfig',
        path: selectedVal
      });
    });

    document.getElementById('browsePathBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'browseAddPath' });
    });
    document.getElementById('browseOutputFileBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'browseOutputFile' });
    });
    document.getElementById('browseConfigBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'browseConfigFile' });
    });
    document.getElementById('githubLink').addEventListener('click', (evt) => {
      evt.preventDefault();
      vscode.postMessage({ command: 'openGitHubLink' });
    });

    document.getElementById('saveAsConfigBtn').addEventListener('click', () => {
      const currentSettings = collectSettings();
      vscode.postMessage({
        command: 'saveAsConfig',
        data: currentSettings
      });
    });

    document.getElementById('runBtn').addEventListener('click', () => {
      const currentSettings = collectSettings();
      vscode.postMessage({
        command: 'runSingleFile',
        data: currentSettings
      });
    });

    function collectSettings() {
      const outputFile = document.getElementById('outputFileInput').value.trim();
      const depthVal = document.getElementById('depthInput').value.trim();
      const extsRaw = document.getElementById('extensionsInput').value.trim();
      const exts = extsRaw ? extsRaw.split(/[,\\s]+/) : [];

      const excludeExtsRaw = document.getElementById('excludeExtensionsInput').value.trim();
      const excludeExts = excludeExtsRaw ? excludeExtsRaw.split(/[,\\s]+/) : [];

      const ignoreErrors = document.getElementById('ignoreErrorsCheck').checked;
      const replaceInvalidChars = document.getElementById('replaceInvalidCheck').checked;

      const formatsVal = document.getElementById('formatsInput').value.trim();
      const configVal = document.getElementById('configInput').value.trim();
      const forceBinary = document.getElementById('forceBinaryCheck').checked;

      const metadataAddRaw = document.getElementById('metadataAddInput').value.trim();
      const metadataAdd = metadataAddRaw ? metadataAddRaw.split(/[,\\s]+/) : [];

      const metadataRemoveRaw = document.getElementById('metadataRemoveInput').value.trim();
      const metadataRemove = metadataRemoveRaw ? metadataRemoveRaw.split(/[,\\s]+/) : [];

      const excludeDirsRaw = document.getElementById('excludeDirsInput').value.trim();
      const excludeDirs = excludeDirsRaw ? excludeDirsRaw.split(/[,\\s]+/) : [];

      const excludeFilesRaw = document.getElementById('excludeFilesInput').value.trim();
      const excludeFiles = excludeFilesRaw ? excludeFilesRaw.split(/[,\\s]+/) : [];

      const includeDirsRaw = document.getElementById('includeDirsInput').value.trim();
      const includeDirs = includeDirsRaw ? includeDirsRaw.split(/[,\\s]+/) : [];

      const includeFilesRaw = document.getElementById('includeFilesInput').value.trim();
      const includeFiles = includeFilesRaw ? includeFilesRaw.split(/[,\\s]+/) : [];

      const disablePluginRaw = document.getElementById('disablePluginInput').value.trim();
      const disablePlugin = disablePluginRaw ? disablePluginRaw.split(/[,\\s]+/) : [];

      return {
        outputFile,
        paths,
        config: configVal,
        extensions: exts,
        excludeExtensions: excludeExts,
        ignoreErrors,
        replaceInvalidChars,
        formats: formatsVal,
        forceBinaryContent: forceBinary,
        metadataAdd,
        metadataRemove,
        excludeDirs,
        excludeFiles,
        includeDirs,
        includeFiles,
        disablePlugin,
        depth: depthVal
      };
    }

    // Listen for extension -> webview messages
    window.addEventListener('message', (evt) => {
      const msg = evt.data;
      if (msg.command === 'addPath') {
        paths.push(msg.path);
        renderPathsList();
      } else if (msg.command === 'setOutputFile') {
        document.getElementById('outputFileInput').value = msg.value;
      } else if (msg.command === 'setConfigFile') {
        document.getElementById('configInput').value = msg.value;
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
 */
export function activate(context: vscode.ExtensionContext) {
  // Command: singlefile.configureGlobalDefaults
  const cmdConfig = vscode.commands.registerCommand('singlefile.configureGlobalDefaults', () => {
    showGlobalConfigPanel(context);
  });
  context.subscriptions.push(cmdConfig);

  // Command: singlefile.run (opens the Run dialog)
  const cmdRun = vscode.commands.registerCommand('singlefile.run', (uri: vscode.Uri, uris: vscode.Uri[]) => {
    let selected: vscode.Uri[] | undefined;
    if (uris && uris.length > 0) {
      selected = uris;
    } else if (uri) {
      selected = [uri];
    }
    showSingleFileRunPanel(context, selected);
  });
  context.subscriptions.push(cmdRun);

  // Command: singlefile.runLast (runs immediately with last settings)
  const cmdRunLast = vscode.commands.registerCommand('singlefile.runLast', async () => {
    const globals = getGlobalDefaults(context);
    if (!globals.singleFileRoot) {
      vscode.window.showInformationMessage('Please configure Single-File global defaults first.');
      await showGlobalConfigPanel(context);
      return;
    }

    // Use last workspace defaults exactly, do not override paths
    const wsDefaults = getWorkspaceDefaults(context);
    await runSingleFileCLI(globals, wsDefaults);
    vscode.window.showInformationMessage('Single-File (Last Settings) run started.');
  });
  context.subscriptions.push(cmdRunLast);
}

/**
 * The deactivate function, if needed.
 */
export function deactivate() {
  // Cleanup if needed
}
