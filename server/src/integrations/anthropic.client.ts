import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import env from '../utils/env';
import logger from '../config/logger';

const CODEGEN_MODEL = 'claude-opus-4-7';
const CODEGEN_MAX_TOKENS = 16000;

/**
 * Visual-bridge codegen system prompt. Describes the contract and the
 * visual-bridge protocol ONLY — no hardcoded Hebrew keyword tables, no
 * dual-viewport bbox-overlap heuristic, no spatial-correlation prose.
 * See spec §7.4.
 */
export const EXTRACTION_CODEGEN_SYSTEM_PROMPT = `You generate a Python extraction script for a single Israeli building-permit DXF file.

INPUTS YOU WILL RECEIVE
- explorationJson: structural fingerprint of the DXF. Each block has an ORDERED text_samples list with {raw, decoded?, x, y, block, handle, layer, entityType}. raw is byte-exact ezdxf output — the file may store Hebrew as Unicode escapes, UTF-8, SHX Latin substitution (e.g. "eu cbhhi" = "קו בניין"), or a CP862/Win-1255 code page. decoded is a best-effort hint only — nullable and may be wrong for SHX files. Encoding flags per block: has_unicode_escapes | has_native_hebrew | has_possible_shx | has_high_bytes.
- One PNG thumbnail per sheet: geometry in black, numbered red dots at text positions. Dot N in the PNG corresponds to text_samples[N-1] of that sheet (globally indexed after density-cap). You use the dots to decide what each raw string MEANS for THIS file.

VISUAL-BRIDGE PROTOCOL
1. Classify each sheet from its thumbnail (floor plan / elevation / cross-section / parking / survey / site plan / roof plan / index page / area calculation / unclassified).
2. Look at dots on top of recognizable features (building edges, plot boundaries, room centers, dimension chains). Map each recognized dot back to text_samples[N-1].raw. That raw string IS this file's label for that feature. Record the raw form — never a decoded Hebrew literal.

REQUIRED OUTPUT: a complete Python script (no fence, no commentary, no markdown). The script reads sys.argv[1] (dxf path) and sys.argv[2] (output directory), prints a JSON object to stdout with keys complianceData and renders, and writes one SVG per sheet to the output directory.

The script MUST begin with a LABELS dict mapping semantic names to raw strings from THIS file:

    LABELS = {
        "building_line":  "<raw from text_samples>",   # e.g. "eu cbhhi"
        "plot_boundary":  "<raw from text_samples>",
        "kitchen":        "<raw from text_samples>",
        # ... only the labels needed for the schema below
    }

All label matching MUST use LABELS (text.strip() == LABELS["building_line"], or "in" for substring). DO NOT write hardcoded Hebrew literals. Numbers are ASCII — match with regex directly.

complianceData schema (omit any key with no data — do not invent placeholders):
  setbacks          object: {front, rear, left, right}, each {value_m: float, evidence: {sheet_key, dot_numbers: int[]}}
  heights           object: {ground_level, floors[], roof, parapet, max_height} with values in meters
  dimensions        object: {building_envelope: {width_m, depth_m}, dimension_chains[]}
  parking           object: {bay_count, bay_dimensions[], covered_count, uncovered_count}
  survey            object: {terrain_elevations[], boundary_edges[], curve_radii[]}
  labelCorrelations array of {label: string (semantic name), raw: string, sheet_key: string, dot_number: int}

renders schema (one entry per sheet):
  {filename: "render_NN.svg", sheetIndex: int (1-based), displayName: string (Hebrew if decodable from exploration, else raw), classification: string (enum above), geometryBlock?: string, annotationBlock?: string}

SVG RENDERING CONTRACT
- Y-axis flip (DXF Y-up to SVG Y-down).
- bounding-box fit with 5% margin.
- stroke width scaled to diagonal/800.
- Use ACI color table for entity stroke colors (default ACI 7 = black).
- Text elements emitted as <text> with original raw content.
- ALWAYS write SVGs with \`open(path, "w", encoding="utf-8", errors="backslashreplace")\`. Raw DXF text may contain lone UTF-16 surrogates (from SHX glyph bytes or CP1255 mis-decoded as latin1) that strict UTF-8 cannot encode — \`backslashreplace\` preserves the byte pattern as visible literals instead of crashing the write and leaving a placeholder stub.

OUTPUT CONSTRAINT: your entire response must be the Python script. No preamble, no postscript, no code fence.`;

export interface ThumbnailInput {
    sheetKey: string;
    pngPath: string;
}

export interface CodegenResult {
    code: string;
    costUsd: number;
    ms: number;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
    // Explicit timeout + retry caps so a stuck network call surfaces quickly
    // instead of tying up the job runner for tens of minutes. The SDK's
    // defaults (10 min timeout, 2 retries) have empirically failed to fire
    // on very-large prompts, so we pin them here.
    return (_client ??= new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        timeout: 180_000,
        maxRetries: 2,
    }));
}

const OPUS_INPUT_USD_PER_MTOK = 15.0;
const OPUS_OUTPUT_USD_PER_MTOK = 75.0;
const OPUS_CACHE_READ_USD_PER_MTOK = 1.5;

export async function generateExtractionScript(opts: {
    explorationJson: unknown;
    thumbnails: ThumbnailInput[];
    reqId: string;
}): Promise<CodegenResult> {
    const t0 = Date.now();
    const imageBlocks = await Promise.all(
        opts.thumbnails.map(async (t) => ({
            type: 'image' as const,
            source: {
                type: 'base64' as const,
                media_type: 'image/png' as const,
                data: (await readFile(t.pngPath)).toString('base64'),
            },
        })),
    );
    const userContent = [
        {
            type: 'text' as const,
            text: `sheet index:\n${opts.thumbnails
                .map((t, i) => `${i + 1}. ${t.sheetKey}`)
                .join('\n')}\n\nexplorationJson:\n${JSON.stringify(
                opts.explorationJson,
            )}`,
        },
        ...imageBlocks,
    ];
    const resp = await client().messages.create({
        model: CODEGEN_MODEL,
        max_tokens: CODEGEN_MAX_TOKENS,
        system: EXTRACTION_CODEGEN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
    });
    const ms = Date.now() - t0;
    const code = resp.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
    const costUsd = computeCost(resp.usage);
    logger.info('anthropic.codegen.ok', {
        reqId: opts.reqId,
        model: CODEGEN_MODEL,
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        ms,
        costUsd,
    });
    return { code, costUsd, ms };
}

export async function fixExtractionScript(opts: {
    brokenCode: string;
    traceback: string;
    reqId: string;
}): Promise<CodegenResult> {
    const t0 = Date.now();
    // Deliberately omit explorationJson — the fix is a targeted patch on the
    // crashed line, and the broken code + traceback already carry all the
    // context the model needs. Including the exploration (hundreds of KB of
    // JSON) made the fix call silently stall on very-large DXFs.
    const fixPrompt = `The previously generated extraction script crashed. Produce a minimal fix that preserves the rest of the script. DO NOT rewrite the LABELS dict unless the traceback directly implicates it.

--- BROKEN SCRIPT ---
${opts.brokenCode}

--- TRACEBACK ---
${opts.traceback.slice(-4000)}`;
    const resp = await client().messages.create({
        model: CODEGEN_MODEL,
        max_tokens: CODEGEN_MAX_TOKENS,
        system: EXTRACTION_CODEGEN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: fixPrompt }],
    });
    const ms = Date.now() - t0;
    const code = resp.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
    const costUsd = computeCost(resp.usage);
    logger.info('anthropic.fix.ok', {
        reqId: opts.reqId,
        model: CODEGEN_MODEL,
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        ms,
        costUsd,
    });
    return { code, costUsd, ms };
}

export function computeCost(usage: Anthropic.Usage): number {
    const inputCost =
        (usage.input_tokens / 1_000_000) * OPUS_INPUT_USD_PER_MTOK;
    const outputCost =
        (usage.output_tokens / 1_000_000) * OPUS_OUTPUT_USD_PER_MTOK;
    const cacheRead =
        ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
        OPUS_CACHE_READ_USD_PER_MTOK;
    return Math.round((inputCost + outputCost + cacheRead) * 10_000) / 10_000;
}
