import { record } from './audit-log.service';
import * as da from '../data-access/audit-log.da';
import logger from '../../config/logger';

jest.mock('../data-access/audit-log.da');
jest.mock('../../config/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockedInsert = da.insertAuditLog as jest.MockedFunction<typeof da.insertAuditLog>;

describe('audit-log.service.record', () => {
    afterEach(() => jest.clearAllMocks());

    it('delegates to insertAuditLog and does not throw on success', async () => {
        mockedInsert.mockResolvedValueOnce({} as never);
        await expect(
            record({ event: 'x', actorId: 'a', entity: 'User', entityId: 'u' }),
        ).resolves.toBeUndefined();
        expect(mockedInsert).toHaveBeenCalledWith({
            event: 'x',
            actorId: 'a',
            entity: 'User',
            entityId: 'u',
            metadata: undefined,
        });
    });

    it('swallows DA errors and logs at error level', async () => {
        mockedInsert.mockRejectedValueOnce(new Error('boom'));
        await expect(record({ event: 'x' })).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('audit-log.write_failed'),
            expect.objectContaining({ event: 'x' }),
        );
    });
});
