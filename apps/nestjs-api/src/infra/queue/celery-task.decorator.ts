import { SetMetadata } from "@nestjs/common";

export const CELERY_HANDLER = "celery:handler";

/**
 * Marks an @Injectable provider as a Celery task handler. The TaskHandlerRegistry discovers all
 * marked providers at boot (via DiscoveryService) and dispatches consumed messages to them by their
 * `name`. Feature/processor modules just provide the class; no manual registration needed.
 */
export const CeleryTaskHandler = (): ClassDecorator => SetMetadata(CELERY_HANDLER, true);
