# Medical MCP

Medical MCP is a Model Context Protocol server for biomedical literature search, genetics and metabolomics lookup, drug metadata, and global health statistics.

This branch adds a Cloudflare Workers deployment with a Streamable HTTP-style JSON-RPC MCP endpoint:

```text
https://medical-mcp.jameswdumay.workers.dev/mcp
```

The Worker implementation is designed for serverless API-backed lookups. It does not run Puppeteer or browser scraping. The original local Node server is still available for local stdio/HTTP use.

## What It Is Good For

- Searching PubMed and Europe PMC abstracts from an MCP client.
- Normalizing literature results across multiple scholarly sources.
- Finding DOI, PubMed, PMC full-text, and PDF/open-access links when APIs expose them.
- Looking up ClinVar variants, GWAS Catalog studies, Metabolomics Workbench studies, and UniProt protein records.
- Querying FDA drug labels, RxNorm names, and WHO health statistics.

This tool is for research and software workflows. It is not a clinical decision system.

## Live Worker

Root metadata:

```bash
curl https://medical-mcp.jameswdumay.workers.dev/
```

MCP endpoint:

```text
POST https://medical-mcp.jameswdumay.workers.dev/mcp
```

Initialize:

```bash
curl https://medical-mcp.jameswdumay.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": { "name": "example", "version": "0.0.1" }
    }
  }'
```

List tools:

```bash
curl https://medical-mcp.jameswdumay.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## Main Tool: `search-literature`

Use `search-literature` for normalized abstract search across literature sources.

Sources:

- `pubmed`
- `europe_pmc`
- `openalex`
- `semantic_scholar`

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search-literature",
    "arguments": {
      "query": "Alzheimer blood biomarkers",
      "sources": ["pubmed", "europe_pmc"],
      "max_results": 10,
      "per_source_limit": 5,
      "include_abstracts": true,
      "start_year": 2024,
      "end_year": 2026,
      "article_types": ["Review"],
      "deduplicate": true
    }
  }
}
```

Normalized result fields include:

- title
- contributing source or sources
- PMID
- DOI
- journal or venue
- publication date
- authors
- publication types
- citation count where available
- MeSH terms or concepts where available
- abstract
- links to PubMed, DOI, PMC full text, PDF/open access, and source records where available

Notes:

- PubMed and Europe PMC are the most reliable Worker sources today.
- OpenAlex and Semantic Scholar are implemented, but public unauthenticated calls can be rate-limited from Cloudflare egress. The tool reports source failures in the result notes instead of failing the whole search.

## Available Tools

### Literature and Abstract Search

`search-literature`

Federated literature search with normalized output and deduplication. Best default tool for abstract trawling.

`search-medical-literature`

PubMed-only search with support for abstracts, date range, journal filter, publication types, pagination, and sort.

`get-article-details`

Fetch one PubMed article by PMID. Returns title, abstract, journal, authors, MeSH terms, DOI, PubMed link, PMC full-text link, and PDF link when available.

`search-europe-pmc`

Europe PMC search. Useful for broader biomedical abstract discovery and open-access/full-text availability.

`search-openalex`

OpenAlex work search. Useful for broad scholarly metadata, citation counts, concepts, DOI, OA pages, and PDF links when available. May be rate-limited without tuning or an API email/key strategy.

`search-semantic-scholar`

Semantic Scholar paper search. Useful for abstracts, citation counts, open PDF links, DOI, PubMed IDs, and scholarly metadata. May be rate-limited without an API key.

`search-medical-databases`

Combined PubMed and ClinicalTrials.gov search for quick literature plus trial context.

### Genetics and Metabolomics

`search-clinvar`

Search ClinVar variants and clinical significance metadata. Useful for gene, variant, accession, pathogenicity, and genomic-location lookups.

`search-gwas-catalog`

Search GWAS Catalog studies by exact trait name. Useful for genotype-trait association discovery, neurogenetics, metabolic traits, accession IDs, sample sizes, and linked PubMed studies.

`search-metabolomics-workbench`

Search Metabolomics Workbench studies. Useful for metabolomics datasets, species, analysis type, sample count, release date, study page, and license links.

`search-uniprot`

Search UniProt proteins. Useful for gene/protein function, functional annotations, accessions, PDB cross-references, and biological interpretation.

### Drugs and Health Statistics

`search-drugs`

Search FDA drug labels by brand or generic name.

`get-drug-details`

Fetch FDA label details by National Drug Code.

`search-drug-nomenclature`

Search RxNorm for standardized drug names and RxCUIs.

`get-health-statistics`

Search WHO Global Health Observatory indicators, optionally filtered by country.

`get-cache-stats`

Placeholder on the Worker deployment. Worker cache storage is not enabled yet.

## Source Coverage

| Source | Used For | Links Returned |
| --- | --- | --- |
| PubMed | Biomedical abstracts, MeSH terms, publication metadata | PubMed, DOI, PMC full text, PMC PDF |
| Europe PMC | Biomedical abstracts, OA/full-text metadata | Europe PMC, PubMed, DOI, PMC full text, PMC PDF |
| OpenAlex | Broad scholarly metadata, citations, concepts | OpenAlex, DOI, landing page, OA/PDF when available |
| Semantic Scholar | Abstracts, citations, paper graph metadata | Semantic Scholar, DOI, PubMed, OA/PDF when available |
| ClinVar | Variant and clinical-significance metadata | ClinVar record |
| GWAS Catalog | GWAS studies and traits | GWAS record, PubMed |
| Metabolomics Workbench | Metabolomics studies and metadata | Study page, license |
| UniProt | Protein/gene functional annotation | UniProt record |
| FDA openFDA | Drug label metadata | FDA-derived label fields |
| RxNorm | Normalized drug terminology | RxCUI metadata |
| WHO GHO | Health indicators | WHO API-derived values |

## Deploy Your Own Worker

Requirements:

- Node.js 18+
- npm
- Cloudflare account
- Wrangler authentication or `CLOUDFLARE_API_TOKEN`

Install dependencies:

```bash
npm install
```

Build the local Node server:

```bash
npm run build
```

Dry-run Worker deployment:

```bash
npx wrangler deploy --dry-run
```

Deploy:

```bash
npm run deploy
```

The Worker entrypoint is:

```text
src/cloudflare-worker.ts
```

Wrangler config:

```text
wrangler.jsonc
```

## Local Node Server

The original Node MCP server is still available.

Build:

```bash
npm install
npm run build
```

Run stdio:

```bash
npm start
```

Run HTTP:

```bash
npm run start:http
```

Local HTTP endpoint:

```text
http://localhost:3000/mcp
```

The local Node server can support features that are not suitable for plain Cloudflare Workers, such as Puppeteer-backed scraping.

## Limitations

- The Cloudflare Worker does not run Puppeteer, Express, or local in-memory cache logic.
- Google Scholar and browser-scraped AAP/journal pages are not part of the Worker deployment.
- OpenAlex and Semantic Scholar may rate-limit unauthenticated calls from Worker egress. Add API-key support or backoff if those become core sources.
- Full text is only linked when an upstream API exposes an open full-text or PDF URL. The MCP does not bypass paywalls.

## Medical Disclaimer

This project retrieves biomedical and medical information from public data sources for research, education, and software workflows. It is not medical advice and must not be used as the sole basis for diagnosis, treatment, or clinical decisions. Always consult qualified healthcare professionals for patient care.

## License

MIT License. See [LICENSE.md](LICENSE.md).
