import { registerHandler } from '../jobs/handlers';
import { dxfExtractionHandler } from '../jobs/handlers/dxf-extraction.handler';

export function registerHandlers(): void {
    registerHandler('DXF_EXTRACTION', dxfExtractionHandler);
}
