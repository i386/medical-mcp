type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type LiteratureResult = {
  title: string;
  sources: string[];
  pmid?: string;
  doi?: string;
  journal?: string;
  published?: string;
  authors?: string[];
  publicationTypes?: string[];
  abstract?: string;
  citations?: number;
  concepts?: string[];
  links: string[];
};

const USER_AGENT = "medical-mcp-cloudflare-worker/1.0";

const tools = [
  {
    name: "search-drugs",
    description: "Search for drug information using FDA database",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get-drug-details",
    description: "Get detailed information about a specific drug by NDC",
    inputSchema: {
      type: "object",
      properties: { ndc: { type: "string" } },
      required: ["ndc"],
    },
  },
  {
    name: "search-drug-nomenclature",
    description: "Search for drug information using RxNorm",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get-health-statistics",
    description: "Get health statistics and indicators from WHO Global Health Observatory",
    inputSchema: {
      type: "object",
      properties: {
        indicator: { type: "string" },
        country: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["indicator"],
    },
  },
  {
    name: "search-medical-literature",
    description: "Search PubMed articles with optional abstracts and practical literature-review filters",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 50, default: 10 },
        retstart: { type: "number", minimum: 0, default: 0 },
        include_abstracts: { type: "boolean", default: true },
        start_year: { type: "number", minimum: 1800 },
        end_year: { type: "number", minimum: 1800 },
        journal: { type: "string" },
        article_types: {
          type: "array",
          items: { type: "string" },
          description: "PubMed publication types, e.g. Review, Clinical Trial, Meta-Analysis",
        },
        sort: {
          type: "string",
          enum: ["relevance", "pub_date"],
          default: "relevance",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search-literature",
    description: "Federated abstract search across PubMed, Europe PMC, OpenAlex, and Semantic Scholar with normalized output and deduplication",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sources: {
          type: "array",
          items: {
            type: "string",
            enum: ["pubmed", "europe_pmc", "openalex", "semantic_scholar"],
          },
          default: ["pubmed", "europe_pmc"],
        },
        max_results: { type: "number", minimum: 1, maximum: 50, default: 10 },
        per_source_limit: { type: "number", minimum: 1, maximum: 20, default: 5 },
        include_abstracts: { type: "boolean", default: true },
        start_year: { type: "number", minimum: 1800 },
        end_year: { type: "number", minimum: 1800 },
        journal: { type: "string" },
        article_types: {
          type: "array",
          items: { type: "string" },
        },
        sort: {
          type: "string",
          enum: ["relevance", "pub_date"],
          default: "relevance",
        },
        deduplicate: { type: "boolean", default: true },
      },
      required: ["query"],
    },
  },
  {
    name: "get-article-details",
    description: "Get detailed information about a specific medical article by PMID",
    inputSchema: {
      type: "object",
      properties: { pmid: { type: "string" } },
      required: ["pmid"],
    },
  },
  {
    name: "search-medical-databases",
    description: "Search PubMed and ClinicalTrials.gov from a Worker-native MCP server",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "search-europe-pmc",
    description: "Search Europe PMC for biomedical abstracts and full-text/PDF availability links",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 50, default: 10 },
        include_abstracts: { type: "boolean", default: true },
        cursor: { type: "string", description: "Europe PMC cursorMark for pagination" },
      },
      required: ["query"],
    },
  },
  {
    name: "search-openalex",
    description: "Search OpenAlex works for abstracts, DOI, open-access pages, and PDF links",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 50, default: 10 },
        page: { type: "number", minimum: 1, default: 1 },
      },
      required: ["query"],
    },
  },
  {
    name: "search-semantic-scholar",
    description: "Search Semantic Scholar for abstracts, citations, open PDFs, and external IDs",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 20, default: 10 },
        offset: { type: "number", minimum: 0, default: 0 },
      },
      required: ["query"],
    },
  },
  {
    name: "search-clinvar",
    description: "Search ClinVar variants and clinical significance metadata",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "search-gwas-catalog",
    description: "Search GWAS Catalog studies for traits, accessions, PubMed links, and catalog pages",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 20, default: 10 },
        page: { type: "number", minimum: 0, default: 0 },
      },
      required: ["query"],
    },
  },
  {
    name: "search-metabolomics-workbench",
    description: "Search Metabolomics Workbench studies with study pages and license links",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "search-uniprot",
    description: "Search UniProt proteins for genetics/metabolic interpretation links and functional annotations",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 20, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get-cache-stats",
    description: "Get cache status for the Worker deployment",
    inputSchema: { type: "object", properties: {} },
  },
];

const browserOnlyTools = new Set([
  "search-google-scholar",
  "search-clinical-guidelines",
  "search-medical-journals",
  "search-pediatric-guidelines",
  "search-aap-guidelines",
]);

function jsonRpc(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { status });
}

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200,
) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status },
  );
}

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, max: number) {
  return Math.min(
    max,
    Math.max(1, typeof value === "number" && Number.isFinite(value) ? value : fallback),
  );
}

function asInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<any>;
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(xml: string, pattern: RegExp) {
  return decodeXml(xml.match(pattern)?.[1] ?? "");
}

function allMatches(xml: string, pattern: RegExp) {
  return [...xml.matchAll(pattern)].map(match => decodeXml(match[1])).filter(Boolean);
}

function parsePubMedArticles(xml: string) {
  return [...xml.matchAll(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g)].map(match => {
    const articleXml = match[0];
    const abstractParts = [...articleXml.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map(part => {
        const label = part[1].match(/Label="([^"]+)"/)?.[1];
        const text = decodeXml(part[2]);
        return label ? `${decodeXml(label)}: ${text}` : text;
      })
      .filter(Boolean);

    return {
      pmid: firstMatch(articleXml, /<PMID[^>]*>([\s\S]*?)<\/PMID>/),
      title: firstMatch(articleXml, /<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/),
      journal: firstMatch(articleXml, /<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>[\s\S]*?<\/Journal>/)
        || firstMatch(articleXml, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/),
      pubDate: [
        firstMatch(articleXml, /<PubDate>[\s\S]*?<Year>([\s\S]*?)<\/Year>/),
        firstMatch(articleXml, /<PubDate>[\s\S]*?<Month>([\s\S]*?)<\/Month>/),
        firstMatch(articleXml, /<PubDate>[\s\S]*?<Day>([\s\S]*?)<\/Day>/),
      ].filter(Boolean).join(" ") || firstMatch(articleXml, /<PubDate>[\s\S]*?<MedlineDate>([\s\S]*?)<\/MedlineDate>/),
      authors: [...articleXml.matchAll(/<Author\b[\s\S]*?<\/Author>/g)].slice(0, 8).map(author => {
        const lastName = firstMatch(author[0], /<LastName>([\s\S]*?)<\/LastName>/);
        const initials = firstMatch(author[0], /<Initials>([\s\S]*?)<\/Initials>/);
        return [lastName, initials].filter(Boolean).join(" ");
      }).filter(Boolean),
      publicationTypes: allMatches(articleXml, /<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g),
      meshTerms: allMatches(articleXml, /<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/g).slice(0, 12),
      abstract: abstractParts.join("\n"),
      doi: firstMatch(articleXml, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/),
      pmc: firstMatch(articleXml, /<ArticleId IdType="pmc">([\s\S]*?)<\/ArticleId>/),
    };
  });
}

function abstractFromOpenAlex(index: Record<string, number[]> | null | undefined) {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
}

function valueAtPath(object: any, path: string[], fallback = "") {
  let current = object;
  for (const segment of path) current = current?.[segment];
  return typeof current === "string" || typeof current === "number" ? String(current) : fallback;
}

function buildPubMedTerm(args: Record<string, unknown>) {
  const pieces = [asString(args.query).trim()];
  const journal = asString(args.journal).trim();
  const startYear = typeof args.start_year === "number" ? Math.trunc(args.start_year) : undefined;
  const endYear = typeof args.end_year === "number" ? Math.trunc(args.end_year) : undefined;
  const articleTypes = asStringArray(args.article_types);

  if (journal) pieces.push(`${journal}[journal]`);
  if (startYear || endYear) pieces.push(`("${startYear ?? 1800}"[Date - Publication] : "${endYear ?? new Date().getUTCFullYear()}"[Date - Publication])`);
  if (articleTypes.length) {
    pieces.push(`(${articleTypes.map(type => `${type}[Publication Type]`).join(" OR ")})`);
  }

  return pieces.filter(Boolean).join(" AND ");
}

function formatLiteratureResults(results: LiteratureResult[], notes: string[] = [], includeAbstracts = true) {
  const rows = results.map((result, index) => {
    const parts = [
      `${index + 1}. ${result.title || "Untitled"}`,
      `Sources: ${result.sources.join(", ")}`,
      result.pmid ? `PMID: ${result.pmid}` : "",
      result.doi ? `DOI: ${result.doi}` : "",
      `Journal/Venue: ${result.journal || "Unknown"}`,
      `Published: ${result.published || "Unknown"}`,
      result.authors?.length ? `Authors: ${result.authors.join(", ")}` : "",
      result.publicationTypes?.length ? `Types: ${result.publicationTypes.join("; ")}` : "",
      typeof result.citations === "number" ? `Citations: ${result.citations}` : "",
      result.concepts?.length ? `Concepts: ${result.concepts.join("; ")}` : "",
      includeAbstracts ? `Abstract: ${result.abstract || "No abstract available."}` : "",
      result.links.length ? `Links:\n${result.links.map(link => `- ${link}`).join("\n")}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  return textResult(`${notes.length ? `Notes:\n${notes.map(note => `- ${note}`).join("\n")}\n\n` : ""}${rows.join("\n\n") || "No literature results found."}`);
}

function resultKey(result: LiteratureResult) {
  if (result.pmid) return `pmid:${result.pmid}`;
  if (result.doi) return `doi:${result.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`;
  return `title:${result.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

function mergeLiteratureResults(results: LiteratureResult[], deduplicate: boolean) {
  if (!deduplicate) return results;
  const merged = new Map<string, LiteratureResult>();
  for (const result of results) {
    const key = resultKey(result);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, result);
      continue;
    }
    existing.sources = [...new Set([...existing.sources, ...result.sources])];
    existing.links = [...new Set([...existing.links, ...result.links])];
    existing.abstract ||= result.abstract;
    existing.pmid ||= result.pmid;
    existing.doi ||= result.doi;
    existing.journal ||= result.journal;
    existing.published ||= result.published;
    existing.authors = existing.authors?.length ? existing.authors : result.authors;
    existing.publicationTypes = [...new Set([...(existing.publicationTypes ?? []), ...(result.publicationTypes ?? [])])];
    existing.concepts = [...new Set([...(existing.concepts ?? []), ...(result.concepts ?? [])])];
    existing.citations = Math.max(existing.citations ?? 0, result.citations ?? 0) || existing.citations || result.citations;
  }
  return [...merged.values()];
}

async function getPubMedLiterature(args: Record<string, unknown>): Promise<LiteratureResult[]> {
  const term = buildPubMedTerm(args);
  const max = asInteger(args.max_results, 5, 1, 20);
  const sort = asString(args.sort) === "pub_date" ? "pub+date" : "relevance";
  const search = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=${max}&sort=${sort}`,
  );
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const xml = await fetchText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml`,
  );
  return parsePubMedArticles(xml).map(article => ({
    title: article.title || "Untitled",
    sources: ["pubmed"],
    pmid: article.pmid,
    doi: article.doi,
    journal: article.journal,
    published: article.pubDate,
    authors: article.authors,
    publicationTypes: article.publicationTypes,
    abstract: article.abstract,
    concepts: article.meshTerms,
    links: [
      article.pmid ? `PubMed: https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/` : "",
      article.doi ? `DOI: https://doi.org/${article.doi}` : "",
      article.pmc ? `Free full text: https://pmc.ncbi.nlm.nih.gov/articles/${article.pmc}/` : "",
      article.pmc ? `PDF: https://pmc.ncbi.nlm.nih.gov/articles/${article.pmc}/pdf/` : "",
    ].filter(Boolean),
  }));
}

async function getEuropePmcLiterature(args: Record<string, unknown>): Promise<LiteratureResult[]> {
  const params = new URLSearchParams({
    query: asString(args.query).trim(),
    format: "json",
    resultType: "core",
    pageSize: String(asInteger(args.max_results, 5, 1, 20)),
  });
  const data = await fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`);
  return (data.resultList?.result ?? []).map((item: any) => ({
    title: decodeXml(item.title ?? "Untitled"),
    sources: ["europe_pmc"],
    pmid: item.pmid,
    doi: item.doi,
    journal: item.journalTitle,
    published: item.firstPublicationDate ?? item.pubYear,
    authors: item.authorString ? String(item.authorString).split(", ").slice(0, 8) : undefined,
    publicationTypes: item.pubType ? [item.pubType] : undefined,
    abstract: decodeXml(item.abstractText ?? ""),
    citations: typeof item.citedByCount === "number" ? item.citedByCount : undefined,
    links: [
      item.pmid ? `PubMed: https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/` : "",
      item.pmcid ? `Free full text: https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/` : "",
      item.pmcid ? `PDF: https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/pdf/` : "",
      item.doi ? `DOI: https://doi.org/${item.doi}` : "",
      `Europe PMC: https://europepmc.org/article/${item.source}/${item.id}`,
    ].filter(Boolean),
  }));
}

async function getOpenAlexLiterature(args: Record<string, unknown>): Promise<LiteratureResult[]> {
  const params = new URLSearchParams({
    search: asString(args.query).trim(),
    "per-page": String(asInteger(args.max_results, 5, 1, 20)),
  });
  const data = await fetchJson(`https://api.openalex.org/works?${params}`);
  return (data.results ?? []).map((work: any) => {
    const pdf = work.open_access?.oa_url || work.primary_location?.pdf_url;
    const landing = work.primary_location?.landing_page_url || work.id;
    return {
      title: work.title ?? "Untitled",
      sources: ["openalex"],
      pmid: typeof work.ids?.pmid === "string" ? work.ids.pmid.split("/").filter(Boolean).pop() : undefined,
      doi: work.doi,
      journal: work.primary_location?.source?.display_name,
      published: work.publication_date ?? String(work.publication_year ?? ""),
      authors: (work.authorships ?? []).slice(0, 8).map((a: any) => a.author?.display_name).filter(Boolean),
      abstract: abstractFromOpenAlex(work.abstract_inverted_index),
      citations: work.cited_by_count,
      concepts: (work.concepts ?? []).slice(0, 8).map((concept: any) => concept.display_name).filter(Boolean),
      links: [
        work.ids?.pmid ? `PubMed: ${work.ids.pmid}` : "",
        work.doi ? `DOI: ${work.doi}` : "",
        landing ? `Landing page: ${landing}` : "",
        pdf ? `PDF/Open access: ${pdf}` : "",
        work.id ? `OpenAlex: ${work.id}` : "",
      ].filter(Boolean),
    };
  });
}

async function getSemanticScholarLiterature(args: Record<string, unknown>): Promise<LiteratureResult[]> {
  const params = new URLSearchParams({
    query: asString(args.query).trim(),
    limit: String(asInteger(args.max_results, 5, 1, 20)),
    fields: "title,abstract,year,venue,authors,url,publicationTypes,publicationDate,externalIds,openAccessPdf,citationCount",
  });
  const data = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`);
  return (data.data ?? []).map((paper: any) => ({
    title: paper.title ?? "Untitled",
    sources: ["semantic_scholar"],
    pmid: paper.externalIds?.PubMed,
    doi: paper.externalIds?.DOI,
    journal: paper.venue,
    published: paper.publicationDate ?? String(paper.year ?? ""),
    authors: (paper.authors ?? []).slice(0, 8).map((author: any) => author.name).filter(Boolean),
    publicationTypes: paper.publicationTypes,
    abstract: paper.abstract,
    citations: paper.citationCount,
    links: [
      paper.externalIds?.PubMed ? `PubMed: https://pubmed.ncbi.nlm.nih.gov/${paper.externalIds.PubMed}/` : "",
      paper.externalIds?.DOI ? `DOI: https://doi.org/${paper.externalIds.DOI}` : "",
      paper.openAccessPdf?.url ? `PDF/Open access: ${paper.openAccessPdf.url}` : "",
      paper.url ? `Semantic Scholar: ${paper.url}` : "",
    ].filter(Boolean),
  }));
}

async function searchLiterature(args: Record<string, unknown>) {
  const requestedSources = asStringArray(args.sources);
  const sources = requestedSources.length ? requestedSources : ["pubmed", "europe_pmc"];
  const perSourceLimit = asInteger(args.per_source_limit, 5, 1, 20);
  const maxResults = asInteger(args.max_results, 10, 1, 50);
  const notes: string[] = [];
  const sourceArgs = { ...args, max_results: perSourceLimit };
  const results: LiteratureResult[] = [];

  for (const source of sources) {
    try {
      if (source === "pubmed") results.push(...await getPubMedLiterature(sourceArgs));
      else if (source === "europe_pmc") results.push(...await getEuropePmcLiterature(sourceArgs));
      else if (source === "openalex") results.push(...await getOpenAlexLiterature(sourceArgs));
      else if (source === "semantic_scholar") results.push(...await getSemanticScholarLiterature(sourceArgs));
      else notes.push(`Unknown source skipped: ${source}`);
    } catch (error) {
      notes.push(`${source} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const merged = mergeLiteratureResults(results, args.deduplicate !== false).slice(0, maxResults);
  return formatLiteratureResults(merged, notes, args.include_abstracts !== false);
}

async function searchDrugs(args: Record<string, unknown>) {
  const query = asString(args.query).trim();
  const limit = asNumber(args.limit, 10, 50);
  const search = encodeURIComponent(`openfda.brand_name:"${query}" openfda.generic_name:"${query}"`);
  const url = `https://api.fda.gov/drug/label.json?search=${search}&limit=${limit}`;
  const data = await fetchJson(url).catch(async () => {
    const fallback = encodeURIComponent(`openfda.brand_name:${query}`);
    return fetchJson(`https://api.fda.gov/drug/label.json?search=${fallback}&limit=${limit}`);
  });
  const rows = (data.results ?? []).map((drug: any, index: number) => {
    const fda = drug.openfda ?? {};
    return [
      `${index + 1}. ${fda.brand_name?.[0] ?? "Unknown brand"}`,
      `Generic: ${fda.generic_name?.[0] ?? "Unknown"}`,
      `NDC: ${fda.product_ndc?.[0] ?? "Unknown"}`,
      `Manufacturer: ${fda.manufacturer_name?.[0] ?? "Unknown"}`,
    ].join("\n");
  });
  return textResult(rows.length ? rows.join("\n\n") : `No FDA drug labels found for "${query}".`);
}

async function getDrugDetails(args: Record<string, unknown>) {
  const ndc = asString(args.ndc).trim();
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`openfda.product_ndc:${ndc}`)}&limit=1`;
  const data = await fetchJson(url);
  const drug = data.results?.[0];
  if (!drug) return textResult(`No FDA drug label found for NDC ${ndc}.`);
  const fda = drug.openfda ?? {};
  return textResult([
    `Brand: ${fda.brand_name?.[0] ?? "Unknown"}`,
    `Generic: ${fda.generic_name?.[0] ?? "Unknown"}`,
    `NDC: ${fda.product_ndc?.[0] ?? ndc}`,
    `Manufacturer: ${fda.manufacturer_name?.[0] ?? "Unknown"}`,
    `Purpose: ${(drug.purpose ?? []).slice(0, 2).join(" ") || "Not listed"}`,
    `Indications: ${(drug.indications_and_usage ?? []).slice(0, 2).join(" ") || "Not listed"}`,
    `Warnings: ${(drug.warnings ?? []).slice(0, 2).join(" ") || "Not listed"}`,
  ].join("\n\n"));
}

async function searchRxNorm(args: Record<string, unknown>) {
  const query = encodeURIComponent(asString(args.query).trim());
  const data = await fetchJson(`https://rxnav.nlm.nih.gov/REST/drugs.json?name=${query}`);
  const groups = data.drugGroup?.conceptGroup ?? [];
  const rows = groups.flatMap((group: any) =>
    (group.conceptProperties ?? []).map((drug: any) => `${drug.name} (${drug.tty}) - RxCUI ${drug.rxcui}`),
  );
  return textResult(rows.length ? rows.slice(0, 20).join("\n") : "No RxNorm results found.");
}

async function getHealthStatistics(args: Record<string, unknown>) {
  const indicator = asString(args.indicator).trim();
  const country = asString(args.country).trim();
  const limit = asNumber(args.limit, 10, 20);
  const indicators = await fetchJson(
    `https://ghoapi.azureedge.net/api/Indicator?$filter=${encodeURIComponent(`contains(IndicatorName, '${indicator}')`)}&$format=json`,
  );
  const code = indicators.value?.[0]?.IndicatorCode;
  if (!code) return textResult(`No WHO indicator found for "${indicator}".`);
  const filter = country ? `&$filter=${encodeURIComponent(`SpatialDim eq '${country}'`)}` : "";
  const data = await fetchJson(`https://ghoapi.azureedge.net/api/${code}?$format=json&$top=50${filter}`);
  const rows = (data.value ?? []).slice(0, limit).map((item: any) =>
    `${item.SpatialDim ?? "Unknown"} ${item.TimeDim ?? ""}: ${item.NumericValue ?? item.Value ?? "No value"}`,
  );
  return textResult(rows.length ? rows.join("\n") : `No WHO data found for "${indicator}".`);
}

async function searchPubMed(args: Record<string, unknown>) {
  const term = buildPubMedTerm(args);
  const query = encodeURIComponent(term);
  const max = asInteger(args.max_results, 10, 1, 50);
  const retstart = asInteger(args.retstart, 0, 0, 100000);
  const includeAbstracts = args.include_abstracts !== false;
  const sort = asString(args.sort) === "pub_date" ? "pub+date" : "relevance";
  const search = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmode=json&retmax=${max}&retstart=${retstart}&sort=${sort}`,
  );
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return textResult("No PubMed articles found.");

  const xml = await fetchText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml`,
  );
  const articles = parsePubMedArticles(xml);
  const rows = articles.map((article, index) => {
    const abstract = includeAbstracts
      ? `\nAbstract: ${article.abstract || "No abstract available."}`
      : "";
    const mesh = article.meshTerms.length ? `\nMeSH: ${article.meshTerms.join("; ")}` : "";
    const types = article.publicationTypes.length ? `\nTypes: ${article.publicationTypes.join("; ")}` : "";
    const authors = article.authors.length ? `\nAuthors: ${article.authors.join(", ")}` : "";
    const links = [
      `PubMed: https://pubmed.ncbi.nlm.nih.gov/${article.pmid || ids[index]}/`,
      article.doi ? `DOI: https://doi.org/${article.doi}` : "",
      article.pmc ? `Free full text: https://pmc.ncbi.nlm.nih.gov/articles/${article.pmc}/` : "",
      article.pmc ? `PDF: https://pmc.ncbi.nlm.nih.gov/articles/${article.pmc}/pdf/` : "",
    ].filter(Boolean).join("\n");
    return `${retstart + index + 1}. ${article.title || "Untitled"}\nPMID: ${article.pmid || ids[index]}\nJournal: ${article.journal || "Unknown"}\nPublished: ${article.pubDate || "Unknown"}${authors}${types}${mesh}${abstract}\n${links}`;
  });
  return textResult(`Query: ${term}\nShowing ${retstart + 1}-${retstart + rows.length} of ${search.esearchresult?.count ?? "unknown"} PubMed results.\n\n${rows.join("\n\n")}`);
}

async function getArticleDetails(args: Record<string, unknown>) {
  const pmid = asString(args.pmid).trim();
  const xml = await fetchText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=xml`,
  );
  const article = parsePubMedArticles(xml)[0];
  if (!article) return textResult(`No PubMed article found for PMID ${pmid}.`);
  return textResult([
    article.title || "Untitled",
    `PMID: ${pmid}`,
    `Journal: ${article.journal || "Unknown"}`,
    `Published: ${article.pubDate || "Unknown"}`,
    `Authors: ${article.authors.join(", ") || "Unknown"}`,
    `Types: ${article.publicationTypes.join("; ") || "Unknown"}`,
    `MeSH: ${article.meshTerms.join("; ") || "None listed"}`,
    `Abstract: ${article.abstract || "No abstract available."}`,
    `PubMed: https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    article.doi ? `DOI: https://doi.org/${article.doi}` : "",
    article.pmc ? `Free full text: https://pmc.ncbi.nlm.nih.gov/articles/${article.pmc}/` : "",
    article.pmc ? `PDF: https://pmc.ncbi.nlm.nih.gov/articles/${article.pmc}/pdf/` : "",
  ].join("\n\n"));
}

async function searchMedicalDatabases(args: Record<string, unknown>) {
  const pubmed = await searchPubMed({ query: args.query, max_results: 5 });
  const query = encodeURIComponent(asString(args.query).trim());
  const trials = await fetchJson(`https://clinicaltrials.gov/api/v2/studies?query.term=${query}&pageSize=5`);
  const trialRows = (trials.studies ?? []).map((study: any, index: number) => {
    const protocol = study.protocolSection ?? {};
    const id = protocol.identificationModule?.nctId ?? "Unknown";
    return `${index + 1}. ${protocol.identificationModule?.briefTitle ?? "Untitled"}\nNCT ID: ${id}\nStatus: ${protocol.statusModule?.overallStatus ?? "Unknown"}\nURL: https://clinicaltrials.gov/study/${id}`;
  });
  return textResult(`PubMed\n\n${pubmed.content[0].text}\n\nClinicalTrials.gov\n\n${trialRows.join("\n\n") || "No trials found."}`);
}

async function searchEuropePmc(args: Record<string, unknown>) {
  const params = new URLSearchParams({
    query: asString(args.query).trim(),
    format: "json",
    resultType: "core",
    pageSize: String(asInteger(args.max_results, 10, 1, 50)),
    cursorMark: asString(args.cursor, "*") || "*",
  });
  const data = await fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`);
  const includeAbstracts = args.include_abstracts !== false;
  const rows = (data.resultList?.result ?? []).map((item: any, index: number) => {
    const links = [
      item.pmid ? `PubMed: https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/` : "",
      item.pmcid ? `Free full text: https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/` : "",
      item.pmcid ? `PDF: https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/pdf/` : "",
      item.doi ? `DOI: https://doi.org/${item.doi}` : "",
      `Europe PMC: https://europepmc.org/article/${item.source}/${item.id}`,
    ].filter(Boolean).join("\n");
    return `${index + 1}. ${decodeXml(item.title ?? "Untitled")}\nPMID: ${item.pmid ?? "N/A"}\nJournal: ${item.journalTitle ?? "Unknown"}\nPublished: ${item.pubYear ?? "Unknown"}\nAuthors: ${item.authorString ?? "Unknown"}\nCited by: ${item.citedByCount ?? "Unknown"}${includeAbstracts ? `\nAbstract: ${decodeXml(item.abstractText ?? "No abstract available.")}` : ""}\n${links}`;
  });
  return textResult(`Next cursor: ${data.nextCursorMark ?? "N/A"}\n\n${rows.join("\n\n") || "No Europe PMC results found."}`);
}

async function searchOpenAlex(args: Record<string, unknown>) {
  const params = new URLSearchParams({
    search: asString(args.query).trim(),
    "per-page": String(asInteger(args.max_results, 10, 1, 50)),
    page: String(asInteger(args.page, 1, 1, 10000)),
  });
  const data = await fetchJson(`https://api.openalex.org/works?${params}`);
  const rows = (data.results ?? []).map((work: any, index: number) => {
    const source = work.primary_location?.source?.display_name ?? "Unknown";
    const pdf = work.open_access?.oa_url || work.primary_location?.pdf_url;
    const landing = work.primary_location?.landing_page_url || work.id;
    const authors = (work.authorships ?? []).slice(0, 8).map((a: any) => a.author?.display_name).filter(Boolean).join(", ");
    const links = [
      work.ids?.pmid ? `PubMed: ${work.ids.pmid}` : "",
      work.doi ? `DOI: ${work.doi}` : "",
      landing ? `Landing page: ${landing}` : "",
      pdf ? `PDF/Open access: ${pdf}` : "",
      work.id ? `OpenAlex: ${work.id}` : "",
    ].filter(Boolean).join("\n");
    return `${index + 1}. ${work.title ?? "Untitled"}\nVenue: ${source}\nPublished: ${work.publication_date ?? work.publication_year ?? "Unknown"}\nAuthors: ${authors || "Unknown"}\nCited by: ${work.cited_by_count ?? "Unknown"}\nAbstract: ${abstractFromOpenAlex(work.abstract_inverted_index) || "No abstract available."}\n${links}`;
  });
  return textResult(rows.join("\n\n") || "No OpenAlex results found.");
}

async function searchSemanticScholar(args: Record<string, unknown>) {
  const params = new URLSearchParams({
    query: asString(args.query).trim(),
    limit: String(asInteger(args.max_results, 10, 1, 20)),
    offset: String(asInteger(args.offset, 0, 0, 10000)),
    fields: "title,abstract,year,venue,authors,url,publicationTypes,publicationDate,externalIds,openAccessPdf,citationCount",
  });
  const data = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`);
  const rows = (data.data ?? []).map((paper: any, index: number) => {
    const authors = (paper.authors ?? []).slice(0, 8).map((author: any) => author.name).filter(Boolean).join(", ");
    const links = [
      paper.externalIds?.PubMed ? `PubMed: https://pubmed.ncbi.nlm.nih.gov/${paper.externalIds.PubMed}/` : "",
      paper.externalIds?.DOI ? `DOI: https://doi.org/${paper.externalIds.DOI}` : "",
      paper.openAccessPdf?.url ? `PDF/Open access: ${paper.openAccessPdf.url}` : "",
      paper.url ? `Semantic Scholar: ${paper.url}` : "",
    ].filter(Boolean).join("\n");
    return `${index + 1}. ${paper.title ?? "Untitled"}\nVenue: ${paper.venue ?? "Unknown"}\nPublished: ${paper.publicationDate ?? paper.year ?? "Unknown"}\nAuthors: ${authors || "Unknown"}\nCitations: ${paper.citationCount ?? "Unknown"}\nTypes: ${(paper.publicationTypes ?? []).join("; ") || "Unknown"}\nAbstract: ${paper.abstract ?? "No abstract available."}\n${links}`;
  });
  return textResult(`Total: ${data.total ?? "Unknown"}\nNext offset: ${data.next ?? "N/A"}\n\n${rows.join("\n\n") || "No Semantic Scholar results found."}`);
}

async function searchClinVar(args: Record<string, unknown>) {
  const max = asInteger(args.max_results, 10, 1, 20);
  const search = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${encodeURIComponent(asString(args.query).trim())}&retmode=json&retmax=${max}`);
  const ids = search.esearchresult?.idlist ?? [];
  if (!ids.length) return textResult("No ClinVar variants found.");
  const data = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${ids.join(",")}&retmode=json`);
  const rows = ids.map((id: string, index: number) => {
    const item = data.result?.[id] ?? {};
    const location = item.variation_set?.[0]?.variation_loc?.[0];
    return `${index + 1}. ${item.title ?? "Untitled"}\nAccession: ${item.accession_version ?? item.accession ?? "Unknown"}\nType: ${item.obj_type ?? item.variation_set?.[0]?.variant_type ?? "Unknown"}\nClinical significance: ${item.clinical_significance?.description ?? "Unknown"}\nGene: ${(item.gene_sort ?? "").trim() || "Unknown"}\nLocation: ${location ? `${location.assembly_name} chr${location.chr}:${location.display_start}-${location.display_stop}` : "Unknown"}\nClinVar: https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`;
  });
  return textResult(rows.join("\n\n"));
}

async function searchGwasCatalog(args: Record<string, unknown>) {
  const max = asInteger(args.max_results, 10, 1, 20);
  const page = asInteger(args.page, 0, 0, 10000);
  const trait = encodeURIComponent(asString(args.query).trim());
  const data = await fetchJson(`https://www.ebi.ac.uk/gwas/rest/api/studies/search/findByDiseaseTrait?diseaseTrait=${trait}&page=${page}&size=${max}`);
  const studies = data._embedded?.studies ?? [];
  const rows = studies.map((study: any, index: number) => {
    const publication = study.publicationInfo ?? {};
    return `${index + 1}. ${publication.title ?? study.diseaseTrait?.trait ?? "Untitled"}\nTrait: ${study.diseaseTrait?.trait ?? "Unknown"}\nAccession: ${study.accessionId ?? "Unknown"}\nPublication: ${publication.publication ?? "Unknown"} (${publication.publicationDate ?? "Unknown"})\nPMID: ${publication.pubmedId ?? "N/A"}\nInitial sample: ${study.initialSampleSize ?? "Unknown"}\nReplication sample: ${study.replicationSampleSize ?? "Unknown"}\nPubMed: ${publication.pubmedId ? `https://pubmed.ncbi.nlm.nih.gov/${publication.pubmedId}/` : "N/A"}\nGWAS Catalog: ${study._links?.self?.href ?? (study.accessionId ? `https://www.ebi.ac.uk/gwas/studies/${study.accessionId}` : "N/A")}`;
  });
  return textResult(rows.join("\n\n") || `No GWAS Catalog studies found for exact trait "${asString(args.query)}". Try the catalog trait label, e.g. "Alzheimer's disease".`);
}

async function searchMetabolomicsWorkbench(args: Record<string, unknown>) {
  const query = encodeURIComponent(asString(args.query).trim());
  const max = asInteger(args.max_results, 10, 1, 20);
  const data = await fetchJson(`https://www.metabolomicsworkbench.org/rest/study/study_title/${query}/summary`);
  const studies = Object.values(data ?? {}).slice(0, max) as any[];
  const rows = studies.map((study, index) => `${index + 1}. ${study.study_title ?? "Untitled"}\nStudy ID: ${study.study_id ?? "Unknown"}\nSpecies: ${study.species ?? "Unknown"}\nAnalysis: ${study.analysis_type ?? "Unknown"}\nSamples: ${study.number_of_samples ?? "Unknown"}\nReleased: ${study.release_date ?? "Unknown"}\nLicense: ${study.license ?? "Unknown"}\nStudy page: ${study.study_url ?? (study.study_id ? `https://www.metabolomicsworkbench.org/data/DRCCMetadata.php?Mode=Study&StudyID=${study.study_id}` : "N/A")}\nLicense URL: ${study.license_url ?? "N/A"}`);
  return textResult(rows.join("\n\n") || "No Metabolomics Workbench studies found.");
}

async function searchUniprot(args: Record<string, unknown>) {
  const max = asInteger(args.max_results, 10, 1, 20);
  const params = new URLSearchParams({
    query: asString(args.query).trim(),
    fields: "accession,id,protein_name,gene_names,organism_name,cc_function,xref_pdb",
    format: "json",
    size: String(max),
  });
  const data = await fetchJson(`https://rest.uniprot.org/uniprotkb/search?${params}`);
  const rows = (data.results ?? []).map((entry: any, index: number) => {
    const accession = entry.primaryAccession;
    const protein = valueAtPath(entry, ["proteinDescription", "recommendedName", "fullName", "value"], entry.uniProtkbId ?? "Unknown");
    const genes = (entry.genes ?? []).map((gene: any) => gene.geneName?.value).filter(Boolean).join(", ");
    const functionText = (entry.comments ?? []).find((comment: any) => comment.commentType === "FUNCTION")?.texts?.map((text: any) => text.value).join(" ") ?? "No function annotation.";
    const pdbs = (entry.uniProtKBCrossReferences ?? []).filter((xref: any) => xref.database === "PDB").slice(0, 8).map((xref: any) => xref.id);
    return `${index + 1}. ${protein}\nAccession: ${accession ?? "Unknown"}\nEntry: ${entry.uniProtkbId ?? "Unknown"}\nGenes: ${genes || "Unknown"}\nOrganism: ${entry.organism?.scientificName ?? "Unknown"}\nFunction: ${functionText}\nPDB: ${pdbs.join(", ") || "None listed"}\nUniProt: ${accession ? `https://www.uniprot.org/uniprotkb/${accession}/entry` : "N/A"}`;
  });
  return textResult(rows.join("\n\n") || "No UniProt results found.");
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (browserOnlyTools.has(name)) {
    return textResult(
      `${name} is not available on the plain Cloudflare Workers deployment because it requires browser scraping/Puppeteer. Use the local Node server or a container runtime for this tool.`,
      true,
    );
  }

  switch (name) {
    case "search-drugs":
    case "search-pediatric-drugs":
      return searchDrugs(args);
    case "get-drug-details":
      return getDrugDetails(args);
    case "search-drug-nomenclature":
      return searchRxNorm(args);
    case "get-health-statistics":
    case "get-child-health-statistics":
      return getHealthStatistics(args);
    case "search-medical-literature":
    case "search-pediatric-literature":
      return searchPubMed(args);
    case "search-literature":
      return searchLiterature(args);
    case "get-article-details":
      return getArticleDetails(args);
    case "search-medical-databases":
      return searchMedicalDatabases(args);
    case "search-europe-pmc":
      return searchEuropePmc(args);
    case "search-openalex":
      return searchOpenAlex(args);
    case "search-semantic-scholar":
      return searchSemanticScholar(args);
    case "search-clinvar":
      return searchClinVar(args);
    case "search-gwas-catalog":
      return searchGwasCatalog(args);
    case "search-metabolomics-workbench":
      return searchMetabolomicsWorkbench(args);
    case "search-uniprot":
      return searchUniprot(args);
    case "get-cache-stats":
      return textResult("Cloudflare Workers cache storage is not enabled for this deployment.");
    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

async function handleRpc(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }

  if (body.method === "initialize") {
    return jsonRpc(body.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "medical-mcp", version: "1.0.8-worker" },
    });
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (body.method === "tools/list") {
    return jsonRpc(body.id, { tools });
  }

  if (body.method === "tools/call") {
    const name = asString(body.params?.name);
    const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
    try {
      return jsonRpc(body.id, await callTool(name, args));
    } catch (error) {
      return jsonRpc(body.id, textResult(`Tool failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  }

  return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.json({
        name: "medical-mcp",
        runtime: "cloudflare-workers",
        endpoint: "/mcp",
      });
    }

    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (request.method !== "POST") {
      return Response.json({ error: "Use POST /mcp for JSON-RPC MCP requests." }, { status: 405 });
    }

    const response = await handleRpc(request);
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Headers", "content-type, accept, mcp-protocol-version");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return new Response(response.body, { status: response.status, headers });
  },
};
