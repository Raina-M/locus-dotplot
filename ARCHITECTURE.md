# Computation and implementation plan

## Separate biological specificity from display resolution

The Hi-C analogy is useful for navigation and rendering, but a Hi-C bin width and a k-mer length are different quantities. Bin width controls the spatial aggregation of evidence. k controls which exact matches exist. Increasing k reduces chance matches and repetitive matches, but can remove diverged homology: under a simplified independent 1% substitution model, a particular 101-mer survives with probability 0.99^101 ≈ 0.36. A coarse overview should therefore not rely solely on extremely large exact words.

Use three independent controls: (1) k for specificity, optionally adaptive; (2) minimizer/syncmer density for computation; (3) base pairs per pixel / tile level for rendering. Preserve user overrides, label sampling and filtering, and never silently change the biological interpretation at a zoom threshold. Distinguish exact matches, approximate alignment segments and aggregated seed density in the legend.

The current prototype adapts k to the larger axis span: <=2 kb → 9; <=10 kb → 15; <=50 kb → 21; <=250 kb → 31; <=1 Mb → 41; <=5 Mb → 71; larger → 101. These are demonstration defaults to tune on real datasets, not scientifically established optimal settings. The independent minimizer window targets 60,000 seeds per axis; pathological repeats are stopped at a hard seed limit.

## Production architecture

1. **Ingest once, query many times.** A Rust CLI or local companion service reads FASTA/FAI, stores two-bit sequence plus ambiguity masks, contig offsets, assembly fingerprints and provenance. Build canonical seed indexes at a few useful k/density levels, with sorted positional postings and explicit strand. Bound memory by partitioning hashes and sorting on disk. Large k matches can be obtained by extending and verifying shorter indexed seeds; repetitive short words need additional index levels or occurrence-aware planning. Do not rebuild an index while panning.
2. **Build a sparse overview pyramid.** For each comparison, optionally preprocess FASTGA, minimap2 or MashMap segments. Store alignment segments separately from exact-seed density. Aggregate sparse seed evidence into 256×256 or 512×512 tiles at geometric bin widths. Keep separate forward/reverse channels, provenance, occurrence filters and sample fractions. Do not construct an N×N base-resolution matrix or enumerate all repeat-pair products. Approximate overview evidence must be labeled as such.
3. **Query by both axis bounds.** Select a tile level from bp/pixel, retrieve only visible tiles plus one screen of prefetch, and query positional postings for local exact matches. Canonical seeds yield both orientation classes; verify candidates against reference bases. Bound time and output separately. Report filtered repeats, cap/truncation and unfinished jobs; permit an explicit slower repeat-rich query. Include assembly IDs, contigs, x/y bounds, tile level, k, sampling and filter configuration in cache keys.
4. **Render progressively.** A browser Canvas2D implementation is sufficient for the prototype; use WebGL2 instanced points/segments or texture tiles once profiling warrants it. Paint coarse cached tiles during movement, refine after a short debounce, cancel stale work, and keep a small CPU/GPU LRU cache. Use Web Workers with transferable typed arrays; consider WASM for local seed queries. IndexedDB can retain indexes with user consent. A local service supports sensitive genomes without sending them to a hosted analysis server.
5. **Give every track the same coordinate transforms.** Maintain one X viewport and one Y viewport, with a link toggle. Render horizontal and vertical track projections from the identical half-open intervals used by the 2D layer. Handle independent contigs/assemblies, unknown strand, negative signal, transcript/exon structure, overlapping lanes, reverse orientation, and consistent hover coordinates. Add assembly-scoped track assignment so identically named contigs from different references cannot mix.
6. **Read tracks lazily.** Reuse igv.js data readers or a mature genomic I/O library for indexed range access, decoupled from dotplot rendering. Test a small integration first: igv.js is a browser rather than a guaranteed stable standalone reader interface. An adapter may be preferable to coupling internal APIs. Support HTTP Range and CORS, local File.slice, Tabix and binary zoom summaries. Dense quantitative tracks use per-pixel min/max or mean summaries with declared semantics; methylation aggregation should use methylated/total counts, not an unweighted mean when coverage differs.

The browser-only static host runs the UI. Native whole-genome indexing belongs in the CLI/local companion or a separately provisioned compute service; it should not be put into a 128 MB edge worker. An optional hosted backend can use object storage for immutable tile pyramids plus job workers with explicit CPU/RAM quotas. The prototype has no such backend.

## How this relates to ALNview and faster alternatives

[ALNview](https://github.com/thegenemyers/ALNVIEW) displays FASTGA .1aln alignments as overview line segments, with a true adjustable-k dotplot enabled only when both dimensions are below 1 Mb. That is a useful precedent for switching between global alignment evidence and local exact matches. It does not establish a performance baseline for this browser implementation.

[FASTGA](https://github.com/thegenemyers/FASTGA) is a candidate for pairwise whole-genome preprocessing. [minimap2](https://github.com/lh3/minimap2) provides a practical minimizer-based alignment route with PAF output. [MashMap](https://github.com/marbl/MashMap) provides approximate long-sequence mapping. These produce different evidence from an exhaustive exact k-mer plot. None can be called universally faster without measuring equivalent output, sensitivity, repeat behavior and hardware.

For true local exact dots, begin with canonical rolling hashes plus minimizer sampling and verified positional joins (already implemented here), then port measured bottlenecks to Rust/WASM. If users require every match for variable k, evaluate an enhanced suffix-array/FM-index approach; it may avoid keeping many fixed-k indexes, but output size remains the limiting factor in repeats. A repeat-rich query with H matches cannot escape the cost of emitting H matches unless it switches explicitly to an aggregated representation.

Index construction scans/sorts sequence-derived seeds; query matching is roughly O(n + m + H) for the current hash-join design, excluding parsing and with expected hash lookup behavior, where H is candidate/output expansion. It is not O(nm), but repetitive seeds can make H enormous. The implemented occurrence and pair budgets are essential, not incidental optimizations. The prototype still scans the visible sequence on each uncached query; the indexed service replaces that with range queries.

## File formats

| Purpose | Recommended formats | Notes |
|---|---|---|
| Reference | FASTA + FAI; BGZF FASTA + FAI + GZI | Indexed region reads; preserve assembly fingerprint and contig lengths. |
| Genes | GFF3, GTF, BED12; bigGenePred / bigBed at scale | Preserve transcript/exon hierarchy, feature ID, parent and strand. |
| TE annotations | BED6/GFF3; bigBed or BGZF + Tabix | Preserve family, class, strand, optional divergence and consensus coordinates as attributes. |
| ChIP-seq / ATAC signal | bigWig | Multiresolution quantitative signal and range access. Prototype accepts bedGraph. |
| Peaks | narrowPeak/broadPeak; bigBed | Keep summit, score and significance fields instead of flattening to generic intervals. |
| Methylation | bedMethyl + Tabix; derived bigWig tracks | Keep fraction, total coverage, methylated counts, context and strand. Separate strand/context signals where useful. |
| Variants | VCF.gz + TBI/CSI | Structural variants can also project onto the 2D layer. |
| Read evidence | BAM + BAI/CSI, CRAM + CRAI | Useful at high zoom; CRAM requires the correct reference. |
| Genome alignments | PAF; adapter for FASTGA .1aln | Keep mapping orientation, segment endpoints and alignment provenance. |
| Links / contacts | BEDPE, bigInteract; .hic / .mcool for actual Hi-C | Optional distinct overlays/layers; do not conflate contact counts with k-mer density. |

BED/bedGraph are zero-based half-open; GFF/GTF use one-based inclusive coordinates. Normalize on ingestion and test boundary cases. Four-column bedGraph and typical bigWig signals do not supply a strand column; use separate plus/minus tracks or a strand-aware source such as bedMethyl. A BED6 strand must be explicitly + or -; unknown strand must stay unknown.

IGV recommends indexes for large text tracks and documents indexed reference/alignment formats in its [supported formats](https://igvteam.github.io/igv-webapp/fileFormats.html). Its [track format documentation](https://igv.org/doc/desktop/FileFormats/DataTracks/) explains bigWig/bigBed range-access advantages. [Juicebox-web](https://aidenlab.github.io/juicebox-web/) already supports associated 1D tracks and is a useful navigation/interaction reference. [re-DOT-able](https://www.bioinformatics.babraham.ac.uk/projects/redotable/) supplies the word-match and forward/reverse comparison precedent.

## Delivery order and acceptance criteria

1. **This prototype:** exact verified seed engine, navigation, matching axes and annotation imports. Validate against brute force, strand and coordinate fixtures, known synthetic rearrangements and UI import/export paths.
2. **Indexed regional MVP:** FAI + bigWig/bigBed/Tabix reads, assembly-scoped tracks, packed transcripts, explicit signal scales, PAF overview layer and persistent session metadata. Validate using bacterial and repeat-rich plant loci, including off-diagonal regions.
3. **Whole-genome engine:** CLI, sparse tile pyramid, on-disk seed index, local companion and cache. Benchmark FASTGA/minimap2/MashMap overview pipelines separately from exact-dot queries on identical datasets and hardware. Record index time/size, peak RSS, cold/warm query latency, pair density, sensitivity and rendering time.
4. **Performance targets to measure, not current claims:** cached pan <100 ms, regional refinement <500 ms where feasible, cancellable progress for slower work, bounded browser memory. Set compute budgets from viewport size and hardware. Never hide evidence loss behind a resolution change.

Before scientific release, add randomized parity/property tests, low-complexity and hash-collision stress tests, browser-worker race tests, indexed-I/O fixtures, overlapping transcript layout tests, real-data reproducibility fixtures and benchmarks across genome sizes. Eight deterministic core tests and focused browser checks are included now; they do not constitute full validation of a production genomics tool.
