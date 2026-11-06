# Run Locus on your machine

1. Download `locus-0.1.1.zip` (or the `.tar.gz` archive) and extract it completely.
2. Install **Python 3.9 or newer** if it is not already available. No Python packages, Node, npm, account or Internet connection are needed to run Locus.
3. Start the launcher for your operating system:

| System | Launch |
|---|---|
| macOS | Double-click **Start Locus.command**. If your system does not allow opening a downloaded script, use Terminal: `python3 /path/to/Locus-0.1.1/run_locus.py`. |
| Windows | Double-click **Start Locus.bat**; the launcher tries `py -3`, then `python`. |
| Linux | Run `sh start-locus.sh` from the extracted directory. |

Locus prints a `http://127.0.0.1:PORT/` address and opens your default browser. If the browser does not open, copy the printed address into it. A free port is selected automatically. Keep the terminal open; press **Ctrl+C** there to stop the app. The next launch can use a different port.

For a predictable port, run `python3 run_locus.py --port 8765`. To start without opening the browser, add `--no-browser`. On Windows you can use `py -3` in place of `python3`.

## Explore

- The initial view is a synthetic 600 kb chromosome with a known duplication and inversion.
- Load your FASTA (up to 20 MiB combined), then BED/GFF/GTF or bedGraph annotations. Files are processed in browser memory; the server only serves the bundled UI.
- Type a one-based region such as `155001-205000`. Pan or zoom on the plot. Unlink X/Y to compare different regions or contigs.
- Annotation sequence names must match FASTA headers exactly. Track arrows show strand where supplied.
- Use **Export PNG** to save the dotplot and tracks. Reloading or closing the app clears loaded files; reselect them in a new session.

## Troubleshooting

- **Do not double-click `dist/index.html`.** Browser worker modules require the local HTTP server.
- **No Python:** use the official Python installer or your system package manager. Python must be available as `python3` on macOS/Linux, or `py -3`/`python` on Windows.
- **File not found:** extract the complete archive; keep `run_locus.py` alongside `dist/`.
- **Port in use:** omit `--port`, or choose a different one.
- **No matching annotations:** check the persistent overlap warning. For an extracted FASTA, set **Sequence coordinates…** to its source chromosome and one-based start, or encode a matching `chr:start-end` FASTA header. Chromosome-level BED coordinates are not local slice coordinates. Standard BED strand is column 6; the `chrom start end +/-` shorthand is also supported.
- **Very repetitive or large genome:** this is the bounded regional prototype. See `ARCHITECTURE.md` for the indexed whole-genome roadmap.

The server listens only on `127.0.0.1` and does not expose the application to your network. All visual assets are bundled; the downloadable app has no external font/CDN dependencies. Modern desktop Chrome, Firefox, Safari or Edge is recommended. The Python launcher and macOS shell launchers were tested locally. The Windows and Linux launchers have not been executed on their native platforms in this release.
