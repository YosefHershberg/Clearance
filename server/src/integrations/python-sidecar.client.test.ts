import axios from 'axios';
import { HttpPythonSidecarClient, SIDECAR_TIMEOUTS } from './python-sidecar.client';

jest.mock('axios');

type PostFn = (
    url: string,
    data: unknown,
    config: unknown,
) => Promise<{ data: unknown }>;

describe('HttpPythonSidecarClient', () => {
    const post = jest.fn() as jest.MockedFunction<PostFn>;

    beforeEach(() => {
        post.mockReset();
        (axios.create as unknown as jest.Mock).mockReturnValue({ post });
    });

    it('constructor registers no default timeout so per-endpoint values win', () => {
        new HttpPythonSidecarClient('http://sidecar:3002');
        // axios.create is the stub returning { post }; assert the config it
        // was called with does not carry a blanket timeout — we rely on each
        // method passing its own so render-thumbnails can run longer than
        // explore without blowing its budget.
        const createCall = (axios.create as unknown as jest.Mock).mock.calls.at(-1);
        expect(createCall?.[0]).toEqual({ baseURL: 'http://sidecar:3002' });
        expect(createCall?.[0]?.timeout).toBeUndefined();
    });

    it('explore() posts snake_case body + X-Request-Id header and unwraps response', async () => {
        const client = new HttpPythonSidecarClient('http://sidecar:3002');
        post.mockResolvedValueOnce({
            data: {
                exploration_json: { blocks: [] },
                structural_hash: 'abc123',
                ms: 42,
            },
        });

        const result = await client.explore({
            storedFileUri: 'uploads/dxf/xyz.dxf',
            reqId: 'req-1',
        });

        expect(post).toHaveBeenCalledWith(
            '/explore',
            { stored_file_uri: 'uploads/dxf/xyz.dxf' },
            {
                headers: { 'X-Request-Id': 'req-1' },
                timeout: SIDECAR_TIMEOUTS.explore,
            },
        );
        expect(result).toEqual({
            explorationJson: { blocks: [] },
            structuralHash: 'abc123',
            ms: 42,
        });
    });

    it('explore() rethrows on axios error', async () => {
        const client = new HttpPythonSidecarClient('http://sidecar:3002');
        post.mockRejectedValueOnce(new Error('network down'));
        await expect(
            client.explore({ storedFileUri: 'x', reqId: 'r' }),
        ).rejects.toThrow('network down');
    });

    describe('renderThumbnails', () => {
        it('posts to /render-thumbnails with snake_case body and maps response to camelCase', async () => {
            const client = new HttpPythonSidecarClient('http://sidecar:3002');
            post.mockResolvedValueOnce({
                data: {
                    thumbnails: [
                        {
                            sheet_key: 'VP1',
                            png_uri: 'tmp/a.png',
                            dot_count: 42,
                        },
                        {
                            sheet_key: 'VP2',
                            png_uri: 'tmp/b.png',
                            dot_count: 7,
                        },
                    ],
                    ms: 8123,
                },
            });

            const result = await client.renderThumbnails({
                storedFileUri: 'uploads/dxf/xyz.dxf',
                explorationJson: { blocks: [] },
                thumbnailDir: 'uploads/renders/thumbs',
                reqId: 'req-thumb',
            });

            expect(post).toHaveBeenCalledWith(
                '/render-thumbnails',
                {
                    stored_file_uri: 'uploads/dxf/xyz.dxf',
                    exploration_json: { blocks: [] },
                    thumbnail_dir: 'uploads/renders/thumbs',
                },
                {
                    headers: { 'X-Request-Id': 'req-thumb' },
                    timeout: SIDECAR_TIMEOUTS.renderThumbnails,
                },
            );
            expect(result.thumbnails[0]).toEqual({
                sheetKey: 'VP1',
                pngUri: 'tmp/a.png',
                dotCount: 42,
            });
            expect(result.thumbnails[1]).toEqual({
                sheetKey: 'VP2',
                pngUri: 'tmp/b.png',
                dotCount: 7,
            });
            expect(result.ms).toBe(8123);
        });

        it('rethrows on axios error', async () => {
            const client = new HttpPythonSidecarClient('http://sidecar:3002');
            post.mockRejectedValueOnce(new Error('boom'));
            await expect(
                client.renderThumbnails({
                    storedFileUri: 'u',
                    explorationJson: {},
                    thumbnailDir: 'd',
                    reqId: 'r',
                }),
            ).rejects.toThrow('boom');
        });
    });

    describe('execute', () => {
        it('returns { ok: true, ... } on success with render fields normalized', async () => {
            const client = new HttpPythonSidecarClient('http://sidecar:3002');
            post.mockResolvedValueOnce({
                data: {
                    ok: true,
                    complianceData: { setbacks: {} },
                    renders: [
                        {
                            filename: 'render_01.svg',
                            sheetIndex: 1,
                            displayName: 'Ground Floor',
                            classification: 'FLOOR_PLAN',
                            size_bytes: 30000,
                            svg_warning: 'hb-shape fallback',
                        },
                    ],
                    ms: 4100,
                },
            });

            const result = await client.execute({
                storedFileUri: 'uploads/dxf/xyz.dxf',
                scriptUri: 'uploads/scripts/ext.py',
                outputDir: 'uploads/renders/run-1',
                reqId: 'req-exec',
            });

            expect(post).toHaveBeenCalledWith(
                '/execute',
                {
                    stored_file_uri: 'uploads/dxf/xyz.dxf',
                    script_uri: 'uploads/scripts/ext.py',
                    output_dir: 'uploads/renders/run-1',
                },
                {
                    headers: { 'X-Request-Id': 'req-exec' },
                    timeout: SIDECAR_TIMEOUTS.execute,
                },
            );
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.complianceData).toEqual({ setbacks: {} });
                expect(result.renders[0].sizeBytes).toBe(30000);
                expect(result.renders[0].classification).toBe('FLOOR_PLAN');
                expect(result.renders[0].svgWarning).toBe('hb-shape fallback');
                expect(result.ms).toBe(4100);
            }
        });

        it('defaults classification to UNCLASSIFIED when missing', async () => {
            const client = new HttpPythonSidecarClient('http://sidecar:3002');
            post.mockResolvedValueOnce({
                data: {
                    ok: true,
                    complianceData: {},
                    renders: [
                        {
                            filename: 'render_02.svg',
                            sheetIndex: 2,
                            displayName: 'Unknown',
                            size_bytes: 100,
                        },
                    ],
                    ms: 10,
                },
            });
            const result = await client.execute({
                storedFileUri: 'u',
                scriptUri: 's',
                outputDir: 'o',
                reqId: 'r',
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.renders[0].classification).toBe('UNCLASSIFIED');
                expect(result.renders[0].sizeBytes).toBe(100);
            }
        });

        it('returns { ok: false, traceback } on script crash', async () => {
            const client = new HttpPythonSidecarClient('http://sidecar:3002');
            post.mockResolvedValueOnce({
                data: {
                    ok: false,
                    traceback: 'Traceback (most recent call last):\nRuntimeError: boom',
                    ms: 3200,
                },
            });

            const result = await client.execute({
                storedFileUri: 'u',
                scriptUri: 's',
                outputDir: 'o',
                reqId: 'r',
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.traceback).toContain('RuntimeError');
                expect(result.ms).toBe(3200);
            }
        });
    });
});
