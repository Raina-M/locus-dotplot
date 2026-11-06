# Locus: genomic dotplot workbench

A browser prototype combining word-match dotplots, independent or linked genomic navigation, and feature tracks aligned to both axes. All imported sequence and track data stay in browser memory; no upload API is used.

## Download and run locally

Download the ZIP or tar.gz package from this repository's Releases, extract it, and start **Start Locus.command** (macOS), **Start Locus.bat** (Windows), or `sh start-locus.sh` (Linux). Python 3.9+ is the only runtime dependency. Everything runs offline on your machine; no npm packages, Python packages, account, or build step are required.

Alternatively, clone/download this repository and run `python3 run_locus.py`. The launcher selects a free loopback port and opens your browser. Use `--no-browser` to print the URL only, or `--port 8765` to select a fixed port. Press Ctrl+C in the terminal to stop. ES module workers require HTTP; opening `dist/index.html` directly with file:// will not work.

See [QUICKSTART.md](QUICKSTART.md) for installation and troubleshooting. Loaded genome files are held in browser memory and must be selected again after reload.

## Develop and package

With Node 18+: `node --test tests/core.test.mjs`. Run the launcher integration tests with `python3 -m unittest discover -s tests -p 'test_*.py'`. Build portable downloads with `python3 tools/package_release.py`; the ZIP, tar.gz and SHA256SUMS.txt are written to `releases/`. The release package excludes Git metadata, hosting configuration and local files.

## Implemented

- Synthetic 600 kb self-comparison with known duplication, inversion, and repeated elements, and illustrative gene/TE/ChIP/methylation tracks.
- Load plain multi-FASTA files, including multiple files for comparisons across references. Choose any loaded contig for either axis.
- Locus entry, linked/unlinked axes, pan, pointer-centered zoom, rectangle zoom, whole-contig fit, keyboard navigation, PNG export.
- Adaptive exact k-mer length (9–101 bp), independent minimizer density, forward/reverse colors, configurable repeat exclusion.
- BED3–12, GFF3, GTF and bedGraph import. BED12 exon blocks and GFF3 transcript blocks; GTF without transcript rows is displayed as individual exon features. Arrows preserve explicit +/- strand. Quantitative tracks preserve negative values and use per-track viewport scales; hover gives raw values.
- Matching runs in a Web Worker. A new navigation cancels stale computation; eight recent results are cached. Rolling hash candidates are checked against sequence text before output.
- Bounds: 20 MiB combined plain FASTA per workspace, 10 MiB per track, 12 tracks, 200,000 seeds per axis, 240,000 verified pairs. Repetitive seeds above the configured occurrence threshold are omitted. The seed cap stops computation with an explicit message rather than risking unbounded memory. The pair cap gives an explicitly truncated plot.

## Important limits

This is a prototype, not a genome-scale indexed service. It does not implement bigWig/bigBed/Tabix/FAI, PAF/.1aln, Hi-C files, remote range reads, persistent sessions, packing overlapping annotation lanes, or genome-wide preprocessing. BED/GFF input is loaded whole. Dense annotation models can overlap. Signal tracks have independent autoscaling and should not be visually compared as if they share a scale. The counts are sampled seed-pair counts, not alignment scores, coverage, or an exhaustive repeat census.

Internally all intervals are zero-based half-open. Locus input/output uses one-based inclusive source chromosome coordinates. GFF/GTF are converted on import; BED/bedGraph retain their zero-based coordinates. FASTA ambiguity and gaps are replaced by N without deleting positions. Tracks match the source chromosome name exactly. If different references share contig names, a track is projected onto all matching names; reference-scoped track assignment is a future extension.

### Extracted FASTA regions and missing annotations

A FASTA slice named `>chr7` does not encode where it came from: without metadata it starts at position 1. If the annotations still use full-chromosome coordinates, click **Sequence coordinates…**, select the loaded sequence, enter its source chromosome name, and set the **one-based source start**. Use the extraction coordinates, never an offset guessed from the annotation range. Navigation, tick labels, tooltips and feature tracks then use the source coordinate system, while k-mer computation continues to use local sequence indices.

Alternatively use an explicit header such as `>chr7:500001-600000` for a 100,000 bp slice. Region headers use one-based inclusive coordinates and their span must match the sequence length. If the extraction uses a zero-based BED start, add 1 to get the source start for this dialog/header.

Track import displays persistent overlap counts and distinguishes chromosome-name mismatches from records outside the loaded coordinates. Standard BED6/12 use strand in column 6. A four-column `chrom start end +/-` shorthand is also accepted, with a visible note that column 4 is interpreted as strand; ordinary BED4 names are preserved.

See [ARCHITECTURE.md](ARCHITECTURE.md) for a resource-aware whole-genome implementation plan, format recommendations, and source references.

## Validation

Twelve Node tests cover brute-force exact-match parity for k=3–101, sampled reverse matches, repeat and pair limits, ambiguous bases, FASTA validation, BED12 blocks, GFF/GTF coordinate conversion and strand, negative bedGraph values, viewport clamping, source-coordinate projection, interval boundaries and BED4 strand shorthand. Three Python integration tests verify the local server and extracted release. Browser QA checks linked locus entry, adaptive k reduction, independent inversion comparison, file import, and responsive controls.

Observed local CPU examples (single run; synthetic data, not performance guarantees): 50 kb / k21: 140 ms; 600 kb / k41: 275 ms; 3 Mb / k71 built from five repeats of the example: 360 ms, reaching the 240,000-pair cap. Worker startup, sequence transfer, parsing and painting are excluded. Benchmark representative real genomes and repeat content before choosing a production engine.
