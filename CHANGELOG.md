# Changelog

## 0.1.1 — 2026-11-06

- Fix chromosome-coordinate annotations disappearing when an extracted FASTA starts partway through the chromosome. Add explicit source chromosome/start settings and validated `chr:start-end` FASTA headers.
- Apply source coordinates consistently to both feature-track axes, locus entry, tick labels, hover details and exported filenames; keep k-mer indices local.
- Recognize the nonstandard four-column BED strand shorthand and display an import note.
- Show persistent annotation overlap counts and warnings for out-of-range or unmatched records.
- Add regression tests for slice offsets, interval boundaries, exon projection, region headers and BED4 strand handling.

## 0.1.0 — 2026-11-06

- Package the interactive dotplot prototype as a portable, offline local tool.
- Add a dependency-free Python launcher bound to loopback, automatic free-port selection, browser opening and graceful shutdown.
- Add macOS, Windows and Linux launch scripts, quick-start instructions, reproducible ZIP/tar packaging and SHA-256 checksums.
- Remove the remote Google Fonts dependency; use system fonts offline.
- Include the adaptive k-mer engine, linked navigation, stranded annotations, example data and core correctness tests.
