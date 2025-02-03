
![Banner](./images/banner.png)

# Single-File VSCode Extension

**Transform your codebase into LLM-friendly formats directly from Visual Studio Code.** This extension leverages [Single-File CLI](https://github.com/chrisdreid/single-file) under the hood to create optimized, context-aware representations of your code that are perfect for AI analysis and prompting. This extension provides a user-friendly interface to configure paths, arguments, metadata options, pyenv versions, and more—right inside VS Code.

### LLM Tuned - Smart Context Preservation
- Automatically maintains crucial relationships between files and dependencies.
- Preserves import hierarchies and module structures.
- Includes relevant metadata and hints that help LLMs understand your code better.
<br>

## Features

- **Global Defaults**: Configure your Single-File path, optional Pyenv version, and any additional config root paths.  
- **Run Dialog**: Right-click folders/files (or use the command palette) to open a Run panel where you can:
  - Adjust arguments like paths, output, formats, configs and more.
  - Quickly Export these arguments as a reusable JSON config.
- **Sticky Workspace Settings**: The last used arguments are saved per-project so you don’t have to re-enter them.  
- **Auto-Configuration Prompt**: If you haven’t set up Single-File yet, the extension will prompt you to configure it globally on first use.  
- **Run “Last Settings”**: Quickly re-run Single-File with your most recent arguments—no dialog required.  

<br>

## Requirements

1. **[Python 3.x](https://www.python.org/downloads/)**
2. The **[Single-File CLI](https://github.com/chrisdreid/single-file)** installed (or placed in your configured `singleFileRoot`).
3. *(Optional)* **[pyenv](https://github.com/pyenv/pyenv)** if you wish to specify a particular Python version inside VS Code.
3. *(Coming Soon)* **venv** if you wish to specify a particular Python virtual environment.

<br>

## Limitations 

1. **Cursor.ai** Context menus are not working. So use **[CTRL+SHFT + P]** to launch.

## Installation

1. **Install** or **Enable** the extension (from the VS Code Marketplace or by manual `.vsix` file).
2. Ensure that you have the **Single-File** CLI on your system or configured in the extension’s `single-file`  (singleFileRoot).

### Configure Global Defaults (Optional)

If you want a custom Single-File root or a specific Python version (via pyenv):

1. Press <kbd>Ctrl+Shift+P</kbd> (or <kbd>Cmd+Shift+P</kbd> on macOS) to open the command palette.
2. Type `Single-File: Configure Single-File Global Defaults`.
3. Set your `singleFileRoot`, `pyenvVersion`, and any additional config root paths.
4. Click **Save Defaults**.

<br>

## Usage

### 1. Right-Click Menu
- **Right-click** on any file(s) or folder(s) in the Explorer panel.
- Choose **Single-File → Run** to open a dialog:
  - Configure arguments, such as paths, output format(s), metadata, etc.
  - **Run** or **Save As Config** to store your chosen parameters in a JSON config file.
- Use **Single-File → Run (Last Settings)** to re-run with no additional prompts.

### 2. Command Palette
- Press <kbd>Ctrl+Shift+P</kbd> (or <kbd>Cmd+Shift+P</kbd>) and type:
  - `Single-File: Run` → Opens the argument dialog.
  - `Single-File: Run (Last Settings)` → Skips the dialog; uses your saved arguments.
  - `Single-File: Configure Single-File Global Defaults` → Adjust the global extension settings.

<br>

## Troubleshooting

- **Global Defaults Not Set**: If you haven’t configured `singleFileRoot`, the extension will prompt you on first use. Make sure Single-File is installed or accessible at the path you configure.
- **Check Output Logs**: Go to `View → Output` in VS Code, then select **Single-File** in the dropdown. This log may show errors about missing paths, invalid arguments, or Python environment issues.
- **Pyenv**: If you specify a `pyenvVersion`, ensure that version is installed via pyenv (and accessible on your system).

<br>

## Contributing

- **Pull Requests** are welcome!  
- For major changes, please open an issue first to discuss your proposed modifications.  
- Refer to the [ Single-File on GitHub](https://github.com/chrisdreid/single-file) for the CLI codebase, plugin development, and advanced usage examples.

<br>

## More on Single-File

The **Single-File** CLI is a Python-based tool that flattens codebases, gathering metadata such as file size, checksums, or custom plugin data. It supports multiple output formats—`text`, `markdown`, `json`, etc.—and can merge arguments from both CLI flags and JSON config files.

To dive deeper:
- [GitHub: chrisdreid/single-file](https://github.com/chrisdreid/single-file)
- For environment variables, advanced config, plugin architecture, or code-based usage, see the CLI repository’s documentation.

<br>

---

## License

This extension is provided under the **MIT License**, the same as the [Single-File CLI](https://github.com/chrisdreid/single-file/blob/main/LICENSE).  
Feel free to modify and distribute—credit is welcome but not required.
