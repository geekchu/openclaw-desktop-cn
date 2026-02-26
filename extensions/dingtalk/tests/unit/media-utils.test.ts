import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectMediaTypeFromExtension, uploadMedia } from '../../src/media-utils';

vi.mock('axios', () => {
    const mockAxios = {
        post: vi.fn(),
        isAxiosError: (err: unknown) => Boolean((err as { isAxiosError?: boolean })?.isAxiosError),
    };
    return {
        default: mockAxios,
        isAxiosError: mockAxios.isAxiosError,
    };
});

const mockedAxiosPost = vi.mocked((axios as any).post);

function createTempFile(content: Buffer): string {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dingtalk-media-')), `f_${Date.now()}.bin`);
    fs.writeFileSync(file, content);
    return file;
}

afterEach(() => {
    mockedAxiosPost.mockReset();
});

describe('media-utils', () => {
    it('detects media type from file extension', () => {
        expect(detectMediaTypeFromExtension('/tmp/a.jpg')).toBe('image');
        expect(detectMediaTypeFromExtension('/tmp/a.mp3')).toBe('voice');
        expect(detectMediaTypeFromExtension('/tmp/a.mp4')).toBe('video');
        expect(detectMediaTypeFromExtension('/tmp/a.pdf')).toBe('file');
    });

    it('uploads media and returns media_id on success', async () => {
        const mediaPath = createTempFile(Buffer.from('hello world'));
        mockedAxiosPost.mockResolvedValueOnce({ data: { errcode: 0, media_id: 'media_123' } } as any);

        const mediaId = await uploadMedia(
            { clientId: 'id', clientSecret: 'sec' } as any,
            mediaPath,
            'file',
            vi.fn().mockResolvedValue('token_abc')
        );

        expect(mediaId).toBe('media_123');
        expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
        expect(mockedAxiosPost.mock.calls[0]?.[0]).toContain('access_token=token_abc&type=file');

        fs.rmSync(path.dirname(mediaPath), { recursive: true, force: true });
    });

    it('returns null when file exceeds media size limit', async () => {
        const tooLargeVoice = createTempFile(Buffer.alloc(2 * 1024 * 1024 + 10, 1));

        const mediaId = await uploadMedia(
            { clientId: 'id', clientSecret: 'sec' } as any,
            tooLargeVoice,
            'voice',
            vi.fn().mockResolvedValue('token_abc')
        );

        expect(mediaId).toBeNull();
        expect(mockedAxiosPost).not.toHaveBeenCalled();

        fs.rmSync(path.dirname(tooLargeVoice), { recursive: true, force: true });
    });

    it('returns null when axios upload throws', async () => {
        const mediaPath = createTempFile(Buffer.from('hello'));
        const log = { error: vi.fn(), debug: vi.fn() };
        mockedAxiosPost.mockRejectedValueOnce({
            isAxiosError: true,
            response: { status: 400, statusText: 'Bad Request', data: { code: 'invalidParameter', message: 'file invalid' } },
            message: 'upload failed',
        });

        const mediaId = await uploadMedia(
            { clientId: 'id', clientSecret: 'sec' } as any,
            mediaPath,
            'file',
            vi.fn().mockResolvedValue('token_abc'),
            log as any
        );

        expect(mediaId).toBeNull();
        expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
        const logs = log.error.mock.calls.map((args: unknown[]) => String(args[0]));
        expect(
            logs.some(
                (entry) =>
                    entry.includes('[DingTalk][ErrorPayload][media.upload]') &&
                    entry.includes('code=invalidParameter') &&
                    entry.includes('message=file invalid')
            )
        ).toBe(true);

        fs.rmSync(path.dirname(mediaPath), { recursive: true, force: true });
    });
});
