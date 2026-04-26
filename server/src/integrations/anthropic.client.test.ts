import { writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

jest.mock('@anthropic-ai/sdk', () => {
    const create = jest.fn();
    const Ctor = jest.fn().mockImplementation(() => ({
        messages: { create },
    }));
    // Expose the shared create mock on the constructor so the tests can get at it.
    (Ctor as unknown as { __create: jest.Mock }).__create = create;
    return { __esModule: true, default: Ctor };
});

// Import AFTER the mock so the module picks up the mocked Anthropic.
import Anthropic from '@anthropic-ai/sdk';
import {
    generateExtractionScript,
    fixExtractionScript,
    EXTRACTION_CODEGEN_SYSTEM_PROMPT,
} from './anthropic.client';

const mockedCreate = (Anthropic as unknown as { __create: jest.Mock })
    .__create;

beforeEach(() => mockedCreate.mockReset());

describe('generateExtractionScript', () => {
    it('sends multimodal content with system prompt and Opus model', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'ant-'));
        const pngPath = path.join(dir, 'sheet.png');
        await writeFile(pngPath, Buffer.from('fake-png-bytes'));

        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'print("hello")' }],
            usage: {
                input_tokens: 1000,
                output_tokens: 500,
                cache_read_input_tokens: 0,
            },
        });

        const r = await generateExtractionScript({
            explorationJson: { foo: 'bar' },
            thumbnails: [{ sheetKey: 'VP1', pngPath }],
            reqId: 'r1',
        });

        expect(mockedCreate).toHaveBeenCalledTimes(1);
        const call = mockedCreate.mock.calls[0][0];
        expect(call.model).toBe('claude-opus-4-7');
        expect(call.system).toBe(EXTRACTION_CODEGEN_SYSTEM_PROMPT);
        expect(call.max_tokens).toBe(16000);

        const userContent = call.messages[0].content;
        expect(Array.isArray(userContent)).toBe(true);
        expect(userContent[0].type).toBe('text');
        expect(userContent[0].text).toContain('explorationJson');
        expect(userContent[0].text).toContain('VP1');
        expect(userContent[1].type).toBe('image');
        expect(userContent[1].source.type).toBe('base64');
        expect(userContent[1].source.media_type).toBe('image/png');
        expect(userContent[1].source.data).toBe(
            Buffer.from('fake-png-bytes').toString('base64'),
        );

        expect(r.code).toBe('print("hello")');
        expect(r.costUsd).toBeGreaterThan(0);
        expect(r.ms).toBeGreaterThanOrEqual(0);
    });

    it('includes one image block per thumbnail', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'ant-'));
        const a = path.join(dir, 'a.png');
        const b = path.join(dir, 'b.png');
        await writeFile(a, Buffer.from('A'));
        await writeFile(b, Buffer.from('B'));

        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'x' }],
            usage: {
                input_tokens: 10,
                output_tokens: 10,
                cache_read_input_tokens: 0,
            },
        });

        await generateExtractionScript({
            explorationJson: {},
            thumbnails: [
                { sheetKey: 'S1', pngPath: a },
                { sheetKey: 'S2', pngPath: b },
            ],
            reqId: 'r',
        });
        const userContent = mockedCreate.mock.calls[0][0].messages[0].content;
        // 1 text + 2 images = 3 blocks
        expect(userContent).toHaveLength(3);
        expect(userContent[1].type).toBe('image');
        expect(userContent[2].type).toBe('image');
    });
});

describe('fixExtractionScript', () => {
    it('is text-only (no image blocks)', async () => {
        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'fixed code' }],
            usage: {
                input_tokens: 500,
                output_tokens: 300,
                cache_read_input_tokens: 0,
            },
        });

        const r = await fixExtractionScript({
            brokenCode: 'bad',
            traceback: 'Traceback: RuntimeError',
            reqId: 'r2',
        });
        const call = mockedCreate.mock.calls[0][0];
        const userContent = call.messages[0].content;
        expect(typeof userContent).toBe('string');
        expect(userContent).toContain('BROKEN SCRIPT');
        expect(userContent).toContain('TRACEBACK');
        expect(userContent).toContain('bad');
        expect(call.model).toBe('claude-opus-4-7');
        expect(call.system).toBe(EXTRACTION_CODEGEN_SYSTEM_PROMPT);
        expect(r.code).toBe('fixed code');
    });

    it('truncates traceback to last 4000 chars', async () => {
        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'x' }],
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_input_tokens: 0,
            },
        });
        const longTb = 'A'.repeat(10_000) + 'TAIL_MARKER';
        await fixExtractionScript({
            brokenCode: '',
            traceback: longTb,
            reqId: 'r',
        });
        const content: string =
            mockedCreate.mock.calls[0][0].messages[0].content;
        expect(content).toContain('TAIL_MARKER');
        // The full 10k A-run must NOT be in the prompt (slice(-4000) trims it).
        expect(content.includes('A'.repeat(5000))).toBe(false);
    });
});

describe('computeCost', () => {
    it('returns expected value for known usage shape', async () => {
        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'x' }],
            usage: {
                input_tokens: 1_000_000,
                output_tokens: 100_000,
                cache_read_input_tokens: 0,
            },
        });
        const r = await fixExtractionScript({
            brokenCode: '',
            traceback: '',
            reqId: 'r',
        });
        // 1M input * $15 + 100k output * $75/M = $15 + $7.5 = $22.50
        expect(r.costUsd).toBeCloseTo(22.5, 2);
    });

    it('adds cache-read cost at $1.5/MTok', async () => {
        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'x' }],
            usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_read_input_tokens: 1_000_000,
            },
        });
        const r = await fixExtractionScript({
            brokenCode: '',
            traceback: '',
            reqId: 'r',
        });
        expect(r.costUsd).toBeCloseTo(1.5, 2);
    });

    it('treats null cache_read_input_tokens as zero', async () => {
        mockedCreate.mockResolvedValue({
            content: [{ type: 'text', text: 'x' }],
            usage: {
                input_tokens: 1_000_000,
                output_tokens: 0,
                cache_read_input_tokens: null,
            },
        });
        const r = await fixExtractionScript({
            brokenCode: '',
            traceback: '',
            reqId: 'r',
        });
        expect(r.costUsd).toBeCloseTo(15, 2);
    });
});
