import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cardMocks = vi.hoisted(() => ({
    getActiveCardIdByTargetMock: vi.fn(),
    getCardByIdMock: vi.fn(),
    isCardInTerminalStateMock: vi.fn(),
    streamAICardMock: vi.fn(),
    deleteActiveCardByTargetMock: vi.fn(),
}));

vi.mock('../../src/auth', () => ({
    getAccessToken: vi.fn().mockResolvedValue('token_abc'),
}));

vi.mock('axios', () => {
    const mockAxios = vi.fn();
    return {
        default: mockAxios,
        isAxiosError: (err: unknown) => Boolean((err as { isAxiosError?: boolean })?.isAxiosError),
    };
});

vi.mock('../../src/card-service', () => ({
    getActiveCardIdByTarget: cardMocks.getActiveCardIdByTargetMock,
    getCardById: cardMocks.getCardByIdMock,
    isCardInTerminalState: cardMocks.isCardInTerminalStateMock,
    streamAICard: cardMocks.streamAICardMock,
    deleteActiveCardByTarget: cardMocks.deleteActiveCardByTargetMock,
}));

import { sendMessage } from '../../src/send-service';
import {
    clearProactiveRiskObservationsForTest,
    recordProactiveRiskObservation,
} from '../../src/proactive-risk-registry';
import { AICardStatus } from '../../src/types';

const mockedAxios = vi.mocked(axios);

describe('send-service advanced branches', () => {
    beforeEach(() => {
        mockedAxios.mockReset();
        clearProactiveRiskObservationsForTest();
        cardMocks.getActiveCardIdByTargetMock.mockReset();
        cardMocks.getCardByIdMock.mockReset();
        cardMocks.isCardInTerminalStateMock.mockReset();
        cardMocks.streamAICardMock.mockReset();
        cardMocks.deleteActiveCardByTargetMock.mockReset();
    });

    it('deletes active card mapping when card is terminal', async () => {
        cardMocks.getActiveCardIdByTargetMock.mockReturnValue('card_terminal');
        cardMocks.getCardByIdMock.mockReturnValue({ state: AICardStatus.FINISHED });
        cardMocks.isCardInTerminalStateMock.mockReturnValue(true);
        mockedAxios.mockResolvedValue({ data: { processQueryKey: 'q1' } } as any);

        const result = await sendMessage(
            { clientId: 'id', clientSecret: 'sec', robotCode: 'id', messageType: 'card' } as any,
            'cidA1B2C3',
            'text',
            { accountId: 'main' }
        );

        expect(cardMocks.deleteActiveCardByTargetMock).toHaveBeenCalledWith('main:cidA1B2C3');
        expect(result.ok).toBe(true);
    });

    it('returns {ok:false} when proactive send throws', async () => {
        mockedAxios.mockRejectedValueOnce({
            message: 'network failed',
            response: { data: { code: 'invalidParameter', message: 'robotCode missing' } },
        });
        const log = { error: vi.fn() };

        const result = await sendMessage(
            { clientId: 'id', clientSecret: 'sec', robotCode: 'id' } as any,
            'cidA1B2C3',
            'text',
            { log: log as any }
        );

        expect(result).toEqual({ ok: false, error: 'network failed' });
        const logs = log.error.mock.calls.map((args: unknown[]) => String(args[0]));
        expect(
            logs.some(
                (entry) =>
                    entry.includes('[DingTalk][ErrorPayload][send.message]') &&
                    entry.includes('code=invalidParameter') &&
                    entry.includes('message=robotCode missing')
            )
        ).toBe(true);
    });

    it('includes proactive risk context in logs when proactive send fails', async () => {
        recordProactiveRiskObservation({
            accountId: 'main',
            targetId: '0341234567',
            level: 'high',
            reason: 'numeric-user-id',
            source: 'webhook-hint',
        });

        mockedAxios.mockRejectedValueOnce({
            message: 'forbidden',
            response: { status: 403, data: { code: 'Forbidden.AccessDenied.AccessTokenPermissionDenied' } },
        });
        const log = { error: vi.fn(), debug: vi.fn() };

        const result = await sendMessage(
            { clientId: 'id', clientSecret: 'sec', robotCode: 'id' } as any,
            '0341234567',
            'text',
            { log: log as any, accountId: 'main' } as any,
        );

        expect(result).toEqual({ ok: false, error: 'forbidden' });
        const logs = log.error.mock.calls.map((args: unknown[]) => String(args[0]));
        expect(logs.some((entry) => entry.includes('proactiveRisk=high:numeric-user-id'))).toBe(true);
    });
});
