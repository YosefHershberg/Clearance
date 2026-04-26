import { z } from 'zod';

// Allow only "render_<digits>.svg" — prevents path traversal at the schema layer.
const renderFilename = z.string().regex(/^render_\d+\.svg$/, 'invalid_filename');

export const renderParamSchema = z.object({
    params: z.object({
        dxfFileId: z.string().cuid(),
        filename: renderFilename,
    }),
});
