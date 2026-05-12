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
    };
  });
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
    return `${retstart + index + 1}. ${article.title || "Untitled"}\nPMID: ${article.pmid || ids[index]}\nJournal: ${article.journal || "Unknown"}\nPublished: ${article.pubDate || "Unknown"}${authors}${types}${mesh}${abstract}\nURL: https://pubmed.ncbi.nlm.nih.gov/${article.pmid || ids[index]}/`;
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
    `URL: https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
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
    case "get-article-details":
      return getArticleDetails(args);
    case "search-medical-databases":
      return searchMedicalDatabases(args);
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
