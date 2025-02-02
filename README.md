# FlattenX

FlattenX is a Python script designed to scan folders and files, generating a detailed tree structure and collecting matching files based on specified patterns and extensions.

## Features

- Scans directories to create a tree-like structure of files and folders.
- Filters files and directories using patterns, extensions, or depth constraints.
- Handles various file encodings gracefully.
- Customizable behavior through command-line arguments.
- Remembers the last used settings for convenience.
- Automatically sets `--output_file` to the selected directory as `${folder_selected}/flattenx.md`.

## Requirements

- Python 3.7+

Install required dependencies:
```bash
pip install -r requirements.txt
```

## Usage

Run the script using the following command:
```bash
python flattenx.py [options]
```

### Command-line Arguments

| Argument                       | Description                                        |
|--------------------------------|----------------------------------------------------|
| `paths`                        | Paths to scan (can be files or directories).       |
| `--depth`                      | Maximum depth to scan (0 for unlimited).           |
| `--output_file`                | File to save the results (default: `${folder_selected}/flattenx.md`). |
| `--ext_only`                   | Include files with these extensions.               |
| `--ext_ignore`                 | Exclude files with these extensions.               |
| `--pattern_ignore_directories` | Skip directories matching these regex patterns.    |
| `--pattern_ignore_files`       | Skip files matching these regex patterns.          |
| `--pattern_only_directories`   | Include only directories matching these patterns.  |
| `--pattern_only_files`         | Include only files matching these patterns.        |
| `--system_instructions`        | Display system instructions for AI assistance.     |
| `--skip_errors`                | Continue on errors without stopping.               |
| `--replace_encoding_errors`    | Replace unreadable characters with placeholders.   |

### Example

Scan the current directory for `.py` and `.js` files, ignoring `.log` files:
```bash
python flattenx.py . --ext_only py js --ext_ignore log --depth 3
```

The output file will automatically be saved as `./flattenx.md`.

## Output

The script generates a Markdown file with:

1. A tree-like folder structure.
2. Contents of files that match the filtering criteria.

### Sample Output
```markdown
### DIRECTORY /path/to/scan FOLDER STRUCTURE ###
root_folder/
    file1.py
    subfolder/
        file2.js
### DIRECTORY /path/to/scan FLATTENED CONTENT ###
### /path/to/scan/file1.py BEGIN ###
(file contents)
### /path/to/scan/file1.py END ###
```

## License

This project is licensed under the MIT License. See the LICENSE file for details.
