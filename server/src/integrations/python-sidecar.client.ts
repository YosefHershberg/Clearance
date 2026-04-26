import axios, { type AxiosInstance } from 'axios';
import env from '../utils/env';

export interface ExploreResult {
    explorationJson: unknown;
    structuralHash: string;
    ms: number;
}

export interface ThumbnailRef {
    sheetKey: string;
    pngUri: string;
    dotCount: number;
}

export interface RenderThumbnailsResult {
    thumbnails: ThumbnailRef[];
    ms: number;
}

export interface ExecuteRender {
    filename: string;
    sheetIndex: number;
    displayName: string;
    classification: string;
    geometryBlock?: string;
    annotationBlock?: string;
    sizeBytes: number;
    svgWarning?: string;
}

export type ExecuteResult =
    | {
          ok: true;
          complianceData: Record<string, unknown>;
          renders: ExecuteRender[];
          ms: number;
      }
    | { ok: false; traceback: string; ms: number };

export interface PythonSidecarClient {
    explore(opts: {
        storedFileUri: string;
        reqId: string;
    }): Promise<ExploreResult>;
    renderThumbnails(opts: {
        storedFileUri: string;
        explorationJson: unknown;
        thumbnailDir: string;
        reqId: string;
    }): Promise<RenderThumbnailsResult>;
    execute(opts: {
        storedFileUri: string;
        scriptUri: string;
        outputDir: string;
        reqId: string;
    }): Promise<ExecuteResult>;
}

// Per-endpoint timeouts. Explore is CPU-bound but bounded by ezdxf's
// structural walk; render-thumbnails scales with the sheet-candidate count
// and can legitimately run for minutes on drawings with dozens of sheets;
// execute wraps the sidecar's internal 110 s subprocess budget plus RTT.
export const SIDECAR_TIMEOUTS = {
    explore: 130_000,
    renderThumbnails: 600_000,
    execute: 180_000,
} as const;

export class HttpPythonSidecarClient implements PythonSidecarClient {
    private readonly http: AxiosInstance;

    constructor(baseURL: string) {
        // No default timeout — every call passes an explicit per-endpoint one
        // so an unbudgeted request fails loud instead of inheriting a wrong default.
        this.http = axios.create({ baseURL });
    }

    async explore(opts: {
        storedFileUri: string;
        reqId: string;
    }): Promise<ExploreResult> {
        const res = await this.http.post<{
            exploration_json: unknown;
            structural_hash: string;
            ms: number;
        }>(
            '/explore',
            { stored_file_uri: opts.storedFileUri },
            {
                headers: { 'X-Request-Id': opts.reqId },
                timeout: SIDECAR_TIMEOUTS.explore,
            },
        );
        return {
            explorationJson: res.data.exploration_json,
            structuralHash: res.data.structural_hash,
            ms: res.data.ms,
        };
    }

    async renderThumbnails(opts: {
        storedFileUri: string;
        explorationJson: unknown;
        thumbnailDir: string;
        reqId: string;
    }): Promise<RenderThumbnailsResult> {
        const res = await this.http.post<{
            thumbnails: Array<{
                sheet_key: string;
                png_uri: string;
                dot_count: number;
            }>;
            ms: number;
        }>(
            '/render-thumbnails',
            {
                stored_file_uri: opts.storedFileUri,
                exploration_json: opts.explorationJson,
                thumbnail_dir: opts.thumbnailDir,
            },
            {
                headers: { 'X-Request-Id': opts.reqId },
                timeout: SIDECAR_TIMEOUTS.renderThumbnails,
            },
        );
        return {
            thumbnails: res.data.thumbnails.map((t) => ({
                sheetKey: t.sheet_key,
                pngUri: t.png_uri,
                dotCount: t.dot_count,
            })),
            ms: res.data.ms,
        };
    }

    async execute(opts: {
        storedFileUri: string;
        scriptUri: string;
        outputDir: string;
        reqId: string;
    }): Promise<ExecuteResult> {
        const res = await this.http.post<
            | {
                  ok: true;
                  complianceData: Record<string, unknown>;
                  renders: Array<Record<string, unknown>>;
                  ms: number;
              }
            | { ok: false; traceback: string; ms: number }
        >(
            '/execute',
            {
                stored_file_uri: opts.storedFileUri,
                script_uri: opts.scriptUri,
                output_dir: opts.outputDir,
            },
            {
                headers: { 'X-Request-Id': opts.reqId },
                timeout: SIDECAR_TIMEOUTS.execute,
            },
        );
        if (!res.data.ok) return res.data;
        return {
            ok: true,
            complianceData: res.data.complianceData,
            renders: res.data.renders.map((r) => ({
                filename: String(r.filename),
                sheetIndex: Number(r.sheetIndex),
                displayName: String(r.displayName),
                classification: String(r.classification ?? 'UNCLASSIFIED'),
                geometryBlock: r.geometryBlock as string | undefined,
                annotationBlock: r.annotationBlock as string | undefined,
                sizeBytes: Number(r.size_bytes ?? r.sizeBytes ?? 0),
                svgWarning: (r.svg_warning ?? r.svgWarning) as
                    | string
                    | undefined,
            })),
            ms: res.data.ms,
        };
    }
}

export const sidecar: PythonSidecarClient = new HttpPythonSidecarClient(
    env.PYTHON_SIDECAR_URL,
);
